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

let map, userMarker, zoneCircle;
let userPos = null;
let opponentPos = null;
let circleCenter = null;
let currentRadius = 500;

let playerScore = 0;
let lastAutoChallengeTime = Date.now();
let activeChallenge = null;

const defaultChallenges = [
  "Prendre en photo un point d'eau / robinet 🚰",
  "Prendre en photo une structure en béton 🧱",
  "Prendre en photo une table ou un banc 🧺"
];

// GESTION DU LOBBY ET DU PROFIL
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

// NAVIGATION ONGLETS
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    
    e.target.classList.add('active');
    document.getElementById(e.target.dataset.tab).classList.add('active');

    if (e.target.dataset.tab === 'tab-challenges') {
      document.getElementById('challenge-badge').style.display = 'none';
      document.getElementById('map-notification').style.display = 'none';
    }
  });
});

// CRÉATION ET REJOINDRE SALON
document.getElementById('btn-create-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis ton rôle !");
  playerName = document.getElementById('player-name-input').value.trim() || "Joueur";
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
  document.getElementById('waiting-room-screen').style.display = 'flex';
  document.getElementById('waiting-room-code').innerText = roomCode;

  db.ref(`rooms/${roomCode}/players/${userRole}`).set({ name: playerName, color: userColor, ready: false });

  db.ref(`rooms/${roomCode}/players`).on('value', (snap) => {
    const p = snap.val();
    if (!p) return;
    let html = '';
    let readyCount = 0;
    for (let r in p) {
      if (p[r].ready) readyCount++;
      html += `<div><b>${p[r].name}</b> (${r === 'hider' ? '🥷 Caché' : '🕵️ Chercheur'}) - ${p[r].ready ? '✅ Prêt' : '⏳ En attente'}</div>`;
    }
    document.getElementById('players-status-list').innerHTML = html;
    if (readyCount >= 2 && userRole === 'hider') {
      db.ref(`rooms/${roomCode}/gameState`).set({ phase: 'HUNTING', startTime: Date.now() });
    }
  });

  db.ref(`rooms/${roomCode}/gameState`).on('value', (snap) => {
    const st = snap.val();
    if (st && st.phase === 'HUNTING') startGame();
  });
}

document.getElementById('btn-ready').addEventListener('click', () => {
  db.ref(`rooms/${roomCode}/players/${userRole}/ready`).set(true);
});

function startGame() {
  document.getElementById('waiting-room-screen').style.display = 'none';
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
  map = L.map('map', { zoomControl: false }).setView([48.6800, 2.4150], 15);
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
    className: 'custom-icon',
    html: `<div class="custom-color-marker" style="background:${userColor};"></div>`,
    iconSize: [22, 22]
  });
  if (!userMarker) userMarker = L.marker(userPos, { icon }).addTo(map);
  else userMarker.setLatLng(userPos);
}

function listenSync() {
  const opp = userRole === 'hider' ? 'seeker' : 'hider';
  db.ref(`rooms/${roomCode}/positions/${opp}`).on('value', (s) => {
    if (s.val()) opponentPos = [s.val().lat, s.val().lng];
  });

  // SYNCHRONISATION DU DÉFI
  db.ref(`rooms/${roomCode}/activeChallenge`).on('value', (snap) => {
    const ch = snap.val();
    if (ch && (!activeChallenge || activeChallenge.id !== ch.id)) {
      activeChallenge = ch;
      triggerChallengeNotification();
    }
  });
}

// EXPÉDITION D'UN DÉFI PERSONNALISÉ (CHERCHEUR)
document.getElementById('btn-send-challenge').addEventListener('click', () => {
  const text = document.getElementById('custom-challenge-text').value.trim();
  const pts = parseInt(document.getElementById('custom-challenge-pts').value) || 20;

  if (!text) return alert("Écris d'abord un défi !");

  db.ref(`rooms/${roomCode}/activeChallenge`).set({
    id: Date.now(),
    text: text,
    pts: pts,
    endTime: Date.now() + (10 * 60 * 1000) // 10 minutes de délai
  });

  document.getElementById('custom-challenge-text').value = '';
  alert("Défi envoyé au caché !");
});

function triggerChallengeNotification() {
  document.getElementById('challenge-badge').style.display = 'inline-block';
  document.getElementById('map-notification').style.display = 'block';

  document.getElementById('active-challenge-desc').innerText = activeChallenge.text;
  document.getElementById('active-challenge-pts').innerText = `Récompense : +${activeChallenge.pts} pts`;

  if (userRole === 'hider') {
    document.getElementById('btn-complete-challenge').style.display = 'block';
  }
}

// VALIDATION DU DÉFI PAR LE CACHÉ
document.getElementById('btn-complete-challenge').addEventListener('click', () => {
  if (!activeChallenge) return;

  if (Date.now() <= activeChallenge.endTime) {
    playerScore += activeChallenge.pts;
    document.getElementById('player-score').innerText = `${playerScore} pts`;
    alert(`🎉 Bravo ! Tu gagnes ${activeChallenge.pts} points !`);
  } else {
    alert("⏰ Temps écoulé ! Défi expiré.");
  }

  document.getElementById('btn-complete-challenge').style.display = 'none';
  document.getElementById('active-challenge-desc').innerText = "Aucun défi actif pour le moment.";
  document.getElementById('active-challenge-pts').innerText = "";
  activeChallenge = null;
});

function gameLoop() {
  const now = Date.now();

  // DÉFI AUTOMATIQUE TOUTES LES 20 MIN
  if (now - lastAutoChallengeTime >= 20 * 60 * 1000 && userRole === 'seeker') {
    lastAutoChallengeTime = now;
    const randText = defaultChallenges[Math.floor(Math.random() * defaultChallenges.length)];
    db.ref(`rooms/${roomCode}/activeChallenge`).set({
      id: now,
      text: randText,
      pts: 20,
      endTime: now + (10 * 60 * 1000)
    });
  }

  // DECOMPTE TIMER DU DEFI
  if (activeChallenge) {
    const rem = Math.max(0, Math.floor((activeChallenge.endTime - now) / 1000));
    const m = String(Math.floor(rem / 60)).padStart(2, '0');
    const s = String(rem % 60).padStart(2, '0');
    document.getElementById('challenge-timer').innerText = `${m}:${s}`;
  }
}

// RECENTRER
document.getElementById('btn-recenter').addEventListener('click', () => {
  if (userPos) map.setView(userPos, 16);
});
