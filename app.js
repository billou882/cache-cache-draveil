const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFZzJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let roomCode = null;
let userRole = null;
let playerName = "Joueur";
let userColor = "#38bdf8";

let map, userMarker, seekerCircle;
let userPos = null;
let opponentPos = null;
let seekerColor = "#ef4444";

let playerScore = 0;
let lastAutoChallengeTime = Date.now();
let activeChallenge = null;
let gameStartTime = null;
let hidingDurationMinutes = 5;

const defaultChallenges = [
  "Prendre en photo un point d'eau / robinet 🚰",
  "Prendre en photo une structure en béton 🧱",
  "Prendre en photo une table ou un banc 🧺"
];

// SELECTION DU PROFIL
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    userColor = e.target.dataset.color;
  });
});

document.getElementById('btn-role-hider').addEventListener('click', () => { userRole = 'hider'; updateRoleUI(); });
document.getElementById('btn-role-seeker').addEventListener('click', () => { userRole = 'seeker'; updateRoleUI(); });

function updateRoleUI() {
  document.getElementById('btn-role-hider').classList.toggle('selected', userRole === 'hider');
  document.getElementById('btn-role-seeker').classList.toggle('selected', userRole === 'seeker');
}

// GESTION DES ONGLETS
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    
    e.target.classList.add('active');
    const targetTabId = e.target.dataset.tab;
    document.getElementById(targetTabId).classList.add('active');

    if (targetTabId === 'tab-map') {
      setTimeout(() => {
        if (map) {
          map.invalidateSize();
          if (userPos) map.setView(userPos, 16);
        }
      }, 100);
    }

    if (targetTabId === 'tab-challenges') {
      document.getElementById('challenge-badge').style.display = 'none';
      document.getElementById('map-notification').style.display = 'none';
    }
  });
});

// LOBBY & REJOINDRE
document.getElementById('btn-create-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis ton rôle !");
  playerName = document.getElementById('player-name-input').value.trim() || "Joueur";
  hidingDurationMinutes = parseInt(document.getElementById('hide-time-input').value) || 5;
  roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  enterWaitingRoom();
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis ton rôle !");
  roomCode = document.getElementById('room-code-input').value.trim();
  playerName = document.getElementById('player-name-input').value.trim() || "Joueur";
  enterWaitingRoom();
});

function enterWaitingRoom() {
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('podium-screen').style.display = 'none';
  document.getElementById('waiting-room-screen').style.display = 'flex';
  document.getElementById('waiting-room-code').innerText = roomCode;

  db.ref(`rooms/${roomCode}/players/${userRole}`).set({ 
    name: playerName, 
    color: userColor, 
    ready: false,
    score: playerScore 
  });

  db.ref(`rooms/${roomCode}/players`).on('value', (snap) => {
    const p = snap.val();
    if (!p) return;
    let html = '';
    let readyCount = 0;
    for (let r in p) {
      if (p[r].ready) readyCount++;
      if (r === 'seeker') seekerColor = p[r].color || "#ef4444";
      html += `<div><b>${p[r].name}</b> (${r === 'hider' ? '🥷 Caché' : '🕵️ Chercheur'}) - ${p[r].ready ? '✅ Prêt' : '⏳ En attente'}</div>`;
    }
    document.getElementById('players-status-list').innerHTML = html;

    if (readyCount >= 2 && userRole === 'hider') {
      db.ref(`rooms/${roomCode}/gameState`).set({
        phase: 'HIDING',
        startTime: Date.now(),
        hideDuration: hidingDurationMinutes
      });
    }
  });

  db.ref(`rooms/${roomCode}/gameState`).on('value', (snap) => {
    const st = snap.val();
    if (st && (st.phase === 'HIDING' || st.phase === 'HUNTING')) {
      gameStartTime = st.startTime;
      hidingDurationMinutes = st.hideDuration || 5;
      startGame();
    }
    if (st && st.phase === 'REVIEW') openReviewScreen();
    if (st && st.phase === 'PODIUM') displayPodium();
  });
}

document.getElementById('btn-ready').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/players/${userRole}/ready`).set(true);
});

function startGame() {
  document.getElementById('waiting-room-screen').style.display = 'none';
  document.getElementById('review-screen').style.display = 'none';
  document.getElementById('podium-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  initMap();
  startGps();
  listenSync();

  if (userRole === 'seeker') {
    document.getElementById('seeker-challenge-creation').style.display = 'block';
    document.getElementById('btn-found-seeker').style.display = 'block';
  }

  setInterval(gameLoop, 1000);
}

function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([48.6800, 2.4150], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}

function startGps() {
  navigator.geolocation.watchPosition((pos) => {
    userPos = [pos.coords.latitude, pos.coords.longitude];
    updateMarker();
    if (roomCode) {
      db.ref(`rooms/${roomCode}/positions/${userRole}`).set({ lat: userPos[0], lng: userPos[1] });
    }
  }, null, { enableHighAccuracy: true });
}

function updateMarker() {
  if (!userPos) return;
  const icon = L.divIcon({
    className: 'custom-dot-container',
    html: `<div class="user-location-dot" style="--dot-color: ${userColor};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  if (!userMarker) userMarker = L.marker(userPos, { icon }).addTo(map);
  else userMarker.setLatLng(userPos);
}

function updateSeekerZoneCircle(centerLat, centerLng) {
  if (!map) return;
  if (!seekerCircle) {
    seekerCircle = L.circle([centerLat, centerLng], {
      color: seekerColor,
      fillColor: seekerColor,
      fillOpacity: 0.15,
      weight: 2,
      radius: 400
    }).addTo(map);
  } else {
    seekerCircle.setLatLng([centerLat, centerLng]);
    seekerCircle.setStyle({ color: seekerColor, fillColor: seekerColor });
  }
}

function listenSync() {
  const opp = userRole === 'hider' ? 'seeker' : 'hider';
  db.ref(`rooms/${roomCode}/positions/${opp}`).on('value', (s) => {
    if (s.val()) {
      opponentPos = [s.val().lat, s.val().lng];
      if (userRole === 'hider') updateSeekerZoneCircle(opponentPos[0], opponentPos[1]);
    }
  });

  db.ref(`rooms/${roomCode}/activeChallenge`).on('value', (snap) => {
    const ch = snap.val();
    if (ch && (!activeChallenge || activeChallenge.id !== ch.id)) {
      activeChallenge = ch;
      triggerChallengeNotification();
    }
  });

  db.ref(`rooms/${roomCode}/roundStatus`).on('value', (s) => {
    const status = s.val();
    if (status === 'SEEKER_CLAIMED' && userRole === 'hider') {
      document.getElementById('btn-confirm-hider').style.display = 'block';
      document.getElementById('status-text').innerText = "Le chercheur t'a trouvé ! Confirms-tu ?";
    } else if (status === 'CONFIRMED') {
      db.ref(`rooms/${roomCode}/gameState/phase`).set('REVIEW');
    }
  });
}

// ENVOYER ET RECEVOIR DEFIS
document.getElementById('btn-send-challenge').addEventListener('click', () => {
  const text = document.getElementById('custom-challenge-text').value.trim();
  const pts = parseInt(document.getElementById('custom-challenge-pts').value) || 20;

  if (!text) return alert("Écris d'abord un défi !");

  db.ref(`rooms/${roomCode}/activeChallenge`).set({
    id: Date.now(),
    text: text,
    pts: pts,
    endTime: Date.now() + (10 * 60 * 1000)
  });

  document.getElementById('custom-challenge-text').value = '';
  alert("Défi envoyé au caché !");
});

function triggerChallengeNotification() {
  document.getElementById('challenge-badge').style.display = 'inline-block';
  document.getElementById('map-notification').style.display = 'block';

  document.getElementById('active-challenge-desc').innerText = activeChallenge.text;
  document.getElementById('active-challenge-pts').innerText = `Valeur : ${activeChallenge.pts} pts`;

  if (userRole === 'hider') {
    document.getElementById('btn-take-challenge-photo').style.display = 'block';
    document.getElementById('photo-submitted-status').style.display = 'none';
  }
}

document.getElementById('btn-take-challenge-photo').addEventListener('click', () => {
  document.getElementById('challenge-photo-input').click();
});

document.getElementById('challenge-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && activeChallenge) {
    const reader = new FileReader();
    reader.onload = (event) => {
      db.ref(`rooms/${roomCode}/submittedPhotos`).push({
        challengeText: activeChallenge.text,
        pts: activeChallenge.pts,
        photo: event.target.result,
        status: 'PENDING'
      });

      document.getElementById('btn-take-challenge-photo').style.display = 'none';
      document.getElementById('photo-submitted-status').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('btn-found-seeker').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/roundStatus`).set('SEEKER_CLAIMED');
  alert("Demande envoyée au caché !");
});

document.getElementById('btn-confirm-hider').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/roundStatus`).set('CONFIRMED');
});

function openReviewScreen() {
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('review-screen').style.display = 'flex';

  db.ref(`rooms/${roomCode}/submittedPhotos`).once('value', (snap) => {
    const photos = snap.val();
    const container = document.getElementById('photos-review-list');

    if (!photos) {
      container.innerHTML = "<p>Aucune photo soumise pendant cette manche.</p>";
      return;
    }

    let html = '';
    for (let key in photos) {
      const p = photos[key];
      html += `
        <div class="review-card">
          <p><b>${p.challengeText}</b> (${p.pts} pts)</p>
          <img src="${p.photo}" style="width:100%; border-radius:8px; margin:8px 0;">
          ${userRole === 'seeker' ? `
            <div class="review-actions">
              <button onclick="reviewPhoto('${key}', true, ${p.pts})" class="btn-success">✅ Valider (+${p.pts} pts)</button>
              <button onclick="reviewPhoto('${key}', false, 0)" class="btn-danger">❌ Refuser</button>
            </div>
          ` : `<p>En attente de validation du chercheur...</p>`}
        </div>
      `;
    }
    container.innerHTML = html;
  });
}

window.reviewPhoto = function(photoKey, accept, pts) {
  if (accept) {
    playerScore += pts;
    db.ref(`rooms/${roomCode}/players/${userRole}/score`).set(playerScore);
    document.getElementById('player-score').innerText = `${playerScore} pts`;
  }
  db.ref(`rooms/${roomCode}/submittedPhotos/${photoKey}`).remove();
  openReviewScreen();
};

document.getElementById('btn-finish-review').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/gameState/phase`).set('PODIUM');
});

// AFFICHER LE PODIUM
function displayPodium() {
  document.getElementById('review-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('podium-screen').style.display = 'flex';

  db.ref(`rooms/${roomCode}/players`).once('value', (snap) => {
    const players = snap.val();
    let playersList = [];

    for (let r in players) {
      playersList.push(players[r]);
    }

    // Trier les joueurs par score décroissant
    playersList.sort((a, b) => (b.score || 0) - (a.score || 0));

    let podiumHtml = '';
    playersList.forEach((p, index) => {
      const medal = index === 0 ? '🥇' : '🥈';
      const rankClass = index === 0 ? 'first' : 'second';
      podiumHtml += `
        <div class="podium-item ${rankClass}">
          <span class="podium-rank">${medal}</span>
          <span class="podium-name">${p.name}</span>
          <span class="podium-score">${p.score || 0} pts</span>
        </div>
      `;
    });

    document.getElementById('podium-display').innerHTML = podiumHtml;
  });
}

// INVERSER LES ROLES & RECOMMENCER
document.getElementById('btn-swap-roles').addEventListener('click', () => {
  userRole = userRole === 'hider' ? 'seeker' : 'hider';
  updateRoleUI();
  
  // Re-initialiser le statut prêt
  db.ref(`rooms/${roomCode}/players/${userRole}`).set({ 
    name: playerName, 
    color: userColor, 
    ready: false,
    score: playerScore 
  });

  db.ref(`rooms/${roomCode}/gameState`).set({ phase: 'WAITING' });
  db.ref(`rooms/${roomCode}/roundStatus`).remove();
  db.ref(`rooms/${roomCode}/activeChallenge`).remove();

  enterWaitingRoom();
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  location.reload();
});

// BOUCLE DE JEU & CHRONO
function gameLoop() {
  const now = Date.now();

  if (gameStartTime) {
    const hideDurationMs = hidingDurationMinutes * 60 * 1000;
    const hideEndTime = gameStartTime + hideDurationMs;
    const remainingMs = hideEndTime - now;

    if (remainingMs > 0) {
      const totalSec = Math.floor(remainingMs / 1000);
      const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      document.getElementById('timer-display').innerText = `${m}:${s}`;
      document.getElementById('status-text').innerText = userRole === 'hider' ? "Cache-toi vite !" : "Le caché se cache...";
    } else {
      document.getElementById('status-text').innerText = "La chasse est lancée ! 🏃";
      const elapsedMs = now - hideEndTime;
      const totalSec = Math.floor(elapsedMs / 1000);
      const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      document.getElementById('timer-display').innerText = `${m}:${s}`;
    }
  }

  if (activeChallenge) {
    const rem = Math.max(0, Math.floor((activeChallenge.endTime - now) / 1000));
    const m = String(Math.floor(rem / 60)).padStart(2, '0');
    const s = String(rem % 60).padStart(2, '0');
    document.getElementById('challenge-timer').innerText = `${m}:${s}`;
  }
}

document.getElementById('btn-recenter').addEventListener('click', () => {
  if (userPos && map) {
    map.setView(userPos, 16);
    map.invalidateSize();
  }
});
