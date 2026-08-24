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
let seekerColor = "#ef4444";

let circleCenter = null;
let circleRadius = 400;

let playerScore = 0;
let activeChallengesList = {};
let gameStartTime = null;
let hidingDurationMinutes = 5;
let isHidingPhaseOver = false;

let survivalTimeFormatted = "00:00";

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

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
  } else {
    document.getElementById('seeker-challenge-creation').style.display = 'none';
    document.getElementById('btn-found-seeker').style.display = 'none';
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

    if (userRole === 'seeker') {
      if (!circleCenter) {
        circleCenter = userPos;
        db.ref(`rooms/${roomCode}/circle`).set({ 
          lat: circleCenter[0], 
          lng: circleCenter[1], 
          radius: circleRadius 
        });
      } else {
        const dist = getDistanceInMeters(userPos[0], userPos[1], circleCenter[0], circleCenter[1]);
        if (dist >= circleRadius) {
          const angle = Math.atan2(userPos[1] - circleCenter[1], userPos[0] - circleCenter[0]);
          const newLat = userPos[0] - (circleRadius / 111320) * Math.cos(angle);
          const newLng = userPos[1] - (circleRadius / (111320 * Math.cos(userPos[0] * Math.PI / 180))) * Math.sin(angle);
          circleCenter = [newLat, newLng];
          db.ref(`rooms/${roomCode}/circle`).set({ 
            lat: circleCenter[0], 
            lng: circleCenter[1], 
            radius: circleRadius 
          });
        }
      }
      renderCircle(circleCenter[0], circleCenter[1], circleRadius);
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

function renderCircle(centerLat, centerLng, radius) {
  if (!map) return;
  if (!seekerCircle) {
    seekerCircle = L.circle([centerLat, centerLng], {
      color: seekerColor,
      fillColor: seekerColor,
      fillOpacity: 0.15,
      weight: 2,
      radius: radius
    }).addTo(map);
  } else {
    seekerCircle.setLatLng([centerLat, centerLng]);
    seekerCircle.setRadius(radius);
    seekerCircle.setStyle({ color: seekerColor, fillColor: seekerColor });
  }
}

function listenSync() {
  db.ref(`rooms/${roomCode}/circle`).on('value', (snap) => {
    const c = snap.val();
    if (c) {
      circleCenter = [c.lat, c.lng];
      circleRadius = c.radius || 400;
      if (userRole === 'hider' && isHidingPhaseOver) {
        renderCircle(circleCenter[0], circleCenter[1], circleRadius);
      }
    }
  });

  db.ref(`rooms/${roomCode}/challenges`).on('value', (snap) => {
    const prevCount = Object.keys(activeChallengesList || {}).length;
    activeChallengesList = snap.val() || {};
    const newCount = Object.keys(activeChallengesList).length;

    if (newCount > prevCount && userRole === 'hider') {
      document.getElementById('challenge-badge').style.display = 'inline-block';
      document.getElementById('map-notification').style.display = 'block';
    }

    renderChallengesList();
  });

  db.ref(`rooms/${roomCode}/roundStatus`).on('value', (s) => {
    const status = s.val();
    if (status === 'SEEKER_CLAIMED' && userRole === 'hider') {
      document.getElementById('btn-confirm-hider').style.display = 'block';
      document.getElementById('status-text').innerText = "Le chercheur t'a trouvé ! Confirms-tu ?";
    } else if (status === 'CONFIRMED') {
      db.ref(`rooms/${roomCode}/players/hider/survivalTime`).set(survivalTimeFormatted);
      db.ref(`rooms/${roomCode}/gameState/phase`).set('REVIEW');
    }
  });
}

function renderChallengesList() {
  const container = document.querySelector('.challenges-container');
  let creationBox = document.getElementById('seeker-challenge-creation');
  
  let html = (userRole === 'seeker' && creationBox) ? creationBox.outerHTML : '';
  const keys = Object.keys(activeChallengesList);

  if (keys.length === 0) {
    html += `
      <div class="challenge-card">
        <h3>📋 Défis disponibles</h3>
        <p class="challenge-text">Aucun défi actif pour le moment.</p>
      </div>
    `;
  } else {
    keys.forEach((key) => {
      const ch = activeChallengesList[key];
      html += `
        <div class="challenge-card" id="card-${ch.id}">
          <h3>📋 Défi (${ch.pts} pts) — Temps restant : <span id="timer-${ch.id}">10:00</span></h3>
          <p class="challenge-text">${ch.text}</p>
          ${userRole === 'hider' ? `
            <button onclick="triggerPhotoUpload('${ch.id}')" class="btn-success">📷 Prendre la photo pour valider</button>
          ` : ''}
        </div>
      `;
    });
  }

  container.innerHTML = html;

  const newSendBtn = document.getElementById('btn-send-challenge');
  if (newSendBtn) {
    newSendBtn.onclick = () => {
      const text = document.getElementById('custom-challenge-text').value.trim();
      const pts = parseInt(document.getElementById('custom-challenge-pts').value) || 20;
      if (!text) return alert("Écris d'abord un défi !");

      const challengeId = 'ch_' + Date.now();
      db.ref(`rooms/${roomCode}/challenges/${challengeId}`).set({
        id: challengeId,
        text: text,
        pts: pts,
        endTime: Date.now() + (10 * 60 * 1000)
      });
      document.getElementById('custom-challenge-text').value = '';
    };
  }
}

let selectedChallengeIdForPhoto = null;

window.triggerPhotoUpload = function(challengeId) {
  selectedChallengeIdForPhoto = challengeId;
  document.getElementById('challenge-photo-input').click();
};

document.getElementById('challenge-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && selectedChallengeIdForPhoto && activeChallengesList[selectedChallengeIdForPhoto]) {
    const ch = activeChallengesList[selectedChallengeIdForPhoto];
    const reader = new FileReader();
    reader.onload = (event) => {
      db.ref(`rooms/${roomCode}/submittedPhotos`).push({
        challengeText: ch.text,
        pts: ch.pts,
        photo: event.target.result,
        status: 'PENDING'
      });

      db.ref(`rooms/${roomCode}/challenges/${selectedChallengeIdForPhoto}`).remove();
      alert("📸 Photo envoyée pour validation !");
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
  }
  db.ref(`rooms/${roomCode}/submittedPhotos/${photoKey}`).remove();
  openReviewScreen();
};

document.getElementById('btn-finish-review').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/gameState/phase`).set('PODIUM');
});

function displayPodium() {
  document.getElementById('review-screen').style.display = 'none';
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('podium-screen').style.display = 'flex';

  db.ref(`rooms/${roomCode}/players`).once('value', (snap) => {
    const players = snap.val();
    let playersList = [];

    for (let r in players) {
      playersList.push({ role: r, ...players[r] });
    }

    playersList.sort((a, b) => (b.score || 0) - (a.score || 0));

    let podiumHtml = '';
    playersList.forEach((p, index) => {
      const medal = index === 0 ? '🥇' : '🥈';
      const rankClass = index === 0 ? 'first' : 'second';
      const survivalInfo = p.role === 'hider' && p.survivalTime ? ` — Temps de survie : ⏱️ <b>${p.survivalTime}</b>` : '';

      podiumHtml += `
        <div class="podium-item ${rankClass}">
          <div>
            <span class="podium-rank">${medal}</span>
            <span class="podium-name">${p.name} (${p.role === 'hider' ? '🥷 Caché' : '🕵️ Chercheur'})</span>
            ${survivalInfo}
          </div>
          <span class="podium-score">${p.score || 0} pts</span>
        </div>
      `;
    });

    document.getElementById('podium-display').innerHTML = podiumHtml;
  });
}

// LEMENT POUR RECOMMENCER ET REINITIALISER
document.getElementById('btn-swap-roles').addEventListener('click', () => {
  userRole = userRole === 'hider' ? 'seeker' : 'hider';
  updateRoleUI();

  // Reinitialisation des variables de manche
  circleCenter = null;
  circleRadius = 400;
  activeChallengesList = {};
  if (seekerCircle && map) {
    map.removeLayer(seekerCircle);
    seekerCircle = null;
  }

  // Nettoyage de la base de donnees Firebase pour la manche
  db.ref(`rooms/${roomCode}/challenges`).remove();
  db.ref(`rooms/${roomCode}/circle`).remove();
  db.ref(`rooms/${roomCode}/roundStatus`).remove();
  db.ref(`rooms/${roomCode}/submittedPhotos`).remove();

  db.ref(`rooms/${roomCode}/players/${userRole}`).set({ 
    name: playerName, 
    color: userColor, 
    ready: false,
    score: playerScore 
  });

  db.ref(`rooms/${roomCode}/gameState`).set({ phase: 'WAITING' });

  enterWaitingRoom();
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  location.reload();
});

function gameLoop() {
  const now = Date.now();

  if (gameStartTime) {
    const hideDurationMs = hidingDurationMinutes * 60 * 1000;
    const hideEndTime = gameStartTime + hideDurationMs;
    const remainingMs = hideEndTime - now;

    if (remainingMs > 0) {
      isHidingPhaseOver = false;
      const totalSec = Math.floor(remainingMs / 1000);
      const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      document.getElementById('timer-display').innerText = `${m}:${s}`;
      document.getElementById('status-text').innerText = userRole === 'hider' 
        ? "Cache-toi vite !" 
        : "Reste dans la zone 5 min (rétrécissement à venir)";
    } else {
      if (!isHidingPhaseOver) {
        isHidingPhaseOver = true;
        circleRadius = 200; 
        if (userRole === 'seeker' && circleCenter) {
          db.ref(`rooms/${roomCode}/circle/radius`).set(circleRadius);
        }
        if (userRole === 'hider' && circleCenter) {
          renderCircle(circleCenter[0], circleCenter[1], circleRadius);
        }
      }

      document.getElementById('status-text').innerText = "La chasse est lancée ! 🏃";
      const elapsedMs = now - hideEndTime;
      const totalSec = Math.floor(elapsedMs / 1000);
      const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      
      survivalTimeFormatted = `${m}:${s}`;
      document.getElementById('timer-display').innerText = survivalTimeFormatted;
    }
  }

  for (let id in activeChallengesList) {
    const ch = activeChallengesList[id];
    const rem = Math.floor((ch.endTime - now) / 1000);

    if (rem <= 0) {
      if (userRole === 'seeker') {
        db.ref(`rooms/${roomCode}/challenges/${id}`).remove();
      }
    } else {
      const timerElem = document.getElementById(`timer-${id}`);
      if (timerElem) {
        const m = String(Math.floor(rem / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        timerElem.innerText = `${m}:${s}`;
      }
    }
  }
}

document.getElementById('btn-recenter').addEventListener('click', () => {
  if (userPos && map) {
    map.setView(userPos, 16);
    map.invalidateSize();
  }
});
