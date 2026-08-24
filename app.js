// --- CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFZzJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16",
  measurementId: "G-GGFG133013"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const CENTER_DRAVEIL = [48.6800, 2.4150];

// VARIABLES DE JOUEUR & SALON
let roomCode = null;
let userRole = null;
let playerName = "Joueur";
let playerAvatar = "";
let isReady = false;

// VARIABLES DE JEU
let map, userMarker, zoneCircle;
let userPos = null;
let opponentPos = null;
let circleCenter = null;
let currentRadius = 500;

let gamePhase = 'WAITING';
let mainGameInterval = null; // Un seul intervalle unique pour éviter la superposition !
let gameStateData = null;

// ÉLÉMENTS UI
const lobbyScreen = document.getElementById('lobby-screen');
const waitingScreen = document.getElementById('waiting-room-screen');
const appContainer = document.getElementById('app-container');
const statusText = document.getElementById('status-text');
const timerDisplay = document.getElementById('timer-display');

// GESTION DE L'AVATAR
document.getElementById('avatar-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      playerAvatar = event.target.result;
      document.getElementById('avatar-preview-container').innerHTML = `<img src="${playerAvatar}" alt="Avatar">`;
    };
    reader.readAsDataURL(file);
  }
});

// CHOIX DU RÔLE
document.getElementById('btn-role-hider').addEventListener('click', () => setRole('hider'));
document.getElementById('btn-role-seeker').addEventListener('click', () => setRole('seeker'));

function setRole(role) {
  userRole = role;
  document.getElementById('btn-role-hider').classList.toggle('selected', role === 'hider');
  document.getElementById('btn-role-seeker').classList.toggle('selected', role === 'seeker');
  document.getElementById('hider-options').style.display = (role === 'hider') ? 'block' : 'none';
}

// CRÉER OU REJOINDRE
document.getElementById('btn-create-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis ton rôle !");
  playerName = document.getElementById('player-name-input').value.trim() || "Caché";
  roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  enterWaitingRoom();
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis ton rôle !");
  const codeInput = document.getElementById('room-code-input').value.trim();
  if (codeInput.length !== 4) return alert("Entre un code à 4 chiffres.");
  playerName = document.getElementById('player-name-input').value.trim() || "Chercheur";
  roomCode = codeInput;
  enterWaitingRoom();
});

function enterWaitingRoom() {
  lobbyScreen.style.display = 'none';
  waitingScreen.style.display = 'flex';
  document.getElementById('waiting-room-code').innerText = roomCode;

  db.ref(`rooms/${roomCode}/players/${userRole}`).set({
    name: playerName,
    avatar: playerAvatar,
    ready: false
  });

  listenToWaitingRoom();
}

// BOUTON PRÊT
document.getElementById('btn-ready').addEventListener('click', () => {
  isReady = true;
  document.getElementById('btn-ready').style.background = '#22c55e';
  document.getElementById('btn-ready').innerText = "Prêt ! En attente...";
  db.ref(`rooms/${roomCode}/players/${userRole}/ready`).set(true);
});

function listenToWaitingRoom() {
  db.ref(`rooms/${roomCode}/players`).on('value', (snapshot) => {
    const players = snapshot.val();
    if (!players) return;

    let html = '';
    let allReady = true;
    let count = 0;

    for (let role in players) {
      count++;
      const p = players[role];
      if (!p.ready) allReady = false;
      html += `<div class="player-row">
                <img src="${p.avatar || 'https://via.placeholder.com/30'}" />
                <span><b>${p.name}</b> (${role === 'hider' ? '🥷 Caché' : '🕵️ Chercheur'})</span>
                <span>${p.ready ? '✅ Prêt' : '⏳ En attente'}</span>
              </div>`;
    }

    document.getElementById('players-status-list').innerHTML = html;

    if (count >= 2 && allReady && userRole === 'hider') {
      const hidingMins = parseInt(document.getElementById('hiding-duration-select').value) || 10;
      const endTimeUTC = Date.now() + (hidingMins * 60 * 1000);

      db.ref(`rooms/${roomCode}/gameState`).set({
        phase: 'HIDING',
        hidingEndTime: endTimeUTC,
        zoneTimerEnd: Date.now() + (300 * 1000)
      });
    }
  });

  db.ref(`rooms/${roomCode}/gameState`).on('value', (snapshot) => {
    const state = snapshot.val();
    if (state && state.phase && gamePhase === 'WAITING') {
      startGameplay(state);
    }
  });
}

function startGameplay(state) {
  waitingScreen.style.display = 'none';
  appContainer.style.display = 'flex';

  initMap();
  startGpsTracking();
  listenToGameSync();

  if (userRole === 'hider') {
    document.getElementById('btn-hider-ready').style.display = 'block';
  }

  // Lancement de l'UNIQUE boucle de jeu
  if (!mainGameInterval) {
    mainGameInterval = setInterval(updateGameLoop, 1000);
  }
}

// --- GÉOLOCALISATION & CARTE ---
function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView(CENTER_DRAVEIL, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
}

function startGpsTracking() {
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(
      (pos) => {
        userPos = [pos.coords.latitude, pos.coords.longitude];
        updateUserMarker();

        if (roomCode && userRole) {
          db.ref(`rooms/${roomCode}/positions/${userRole}`).set({
            lat: userPos[0],
            lng: userPos[1],
            timestamp: Date.now()
          });
        }
      },
      (err) => console.warn("GPS error: " + err.message),
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
  }
}

function updateUserMarker() {
  if (!userPos) return;
  const icon = L.divIcon({
    className: 'custom-map-avatar',
    html: `<div class="avatar-marker-frame"><img src="${playerAvatar || 'https://via.placeholder.com/40'}"></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });

  if (!userMarker) {
    userMarker = L.marker(userPos, { icon }).addTo(map);
  } else {
    userMarker.setLatLng(userPos);
  }
}

// --- SYNCHRONISATION DU JEU (FIREBASE) ---
function listenToGameSync() {
  const oppRole = userRole === 'hider' ? 'seeker' : 'hider';

  db.ref(`rooms/${roomCode}/positions/${oppRole}`).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) opponentPos = [data.lat, data.lng];
  });

  db.ref(`rooms/${roomCode}/circle`).on('value', (snapshot) => {
    const cData = snapshot.val();
    if (cData) {
      circleCenter = [cData.lat, cData.lng];
      currentRadius = cData.radius;
      renderCircle();
    }
  });

  db.ref(`rooms/${roomCode}/gameState`).on('value', (snapshot) => {
    gameStateData = snapshot.val();
    if (gameStateData) gamePhase = gameStateData.phase;
  });
}

// BOUTON "JE SUIS CACHÉ !"
document.getElementById('btn-hider-ready').addEventListener('click', () => {
  if (userRole === 'hider' && opponentPos) {
    generateRandomCircle(opponentPos, 500);
  }
  db.ref(`rooms/${roomCode}/gameState`).update({
    phase: 'HUNTING',
    zoneTimerEnd: Date.now() + (300 * 1000)
  });
  document.getElementById('btn-hider-ready').style.display = 'none';
});

// --- UNIQUE BOUCLE PRINCIPALE DU JEU (1 TICK / SECONDE) ---
function updateGameLoop() {
  if (!gameStateData) return;

  const now = Date.now();

  if (gamePhase === 'HIDING') {
    const timeLeft = Math.max(0, Math.floor((gameStateData.hidingEndTime - now) / 1000));
    const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
    const secs = String(timeLeft % 60).padStart(2, '0');
    
    timerDisplay.innerText = `${mins}:${secs}`;
    statusText.innerText = "🥷 Phase de cachette en cours...";

    if (timeLeft <= 0 && userRole === 'hider' && opponentPos && !circleCenter) {
      generateRandomCircle(opponentPos, 500);
      db.ref(`rooms/${roomCode}/gameState`).update({ phase: 'HUNTING', zoneTimerEnd: Date.now() + (300 * 1000) });
    }
  } 
  else if (gamePhase === 'HUNTING') {
    document.getElementById('btn-hider-ready').style.display = 'none';

    const zoneTimeLeft = Math.max(0, Math.floor((gameStateData.zoneTimerEnd - now) / 1000));
    const mins = String(Math.floor(zoneTimeLeft / 60)).padStart(2, '0');
    const secs = String(zoneTimeLeft % 60).padStart(2, '0');

    timerDisplay.innerText = `${mins}:${secs}`;
    statusText.innerText = `Traque (Zone : ${currentRadius}m)`;

    // Vérifier les règles de zone pour le chercheur
    checkGameRules();

    // Réduction de zone quand le chrono arrive à 0
    if (zoneTimeLeft <= 0 && userRole === 'hider') {
      if (currentRadius > 50) {
        currentRadius -= 50;
        if (opponentPos) generateRandomCircle(opponentPos, currentRadius);
        playTingSound();
      }
      db.ref(`rooms/${roomCode}/gameState`).update({ zoneTimerEnd: Date.now() + (300 * 1000) });
    }
  }
}

// CERCLE ET ZONE
function generateRandomCircle(hPos, radius) {
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * (radius * 0.4);
  const dLat = (dist * Math.cos(angle)) / 111111;
  const dLng = (dist * Math.sin(angle)) / (111111 * Math.cos(hPos[0] * Math.PI / 180));

  circleCenter = [hPos[0] + dLat, hPos[1] + dLng];
  db.ref(`rooms/${roomCode}/circle`).set({ lat: circleCenter[0], lng: circleCenter[1], radius: radius });
}

function renderCircle() {
  if (!circleCenter) return;
  if (zoneCircle) map.removeLayer(zoneCircle);
  zoneCircle = L.circle(circleCenter, {
    color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, radius: currentRadius
  }).addTo(map);
}

function checkGameRules() {
  if (!userPos || !circleCenter || gamePhase !== 'HUNTING') return;

  const distance = map.distance(userPos, circleCenter);

  if (userRole === 'seeker') {
    if (distance <= currentRadius) {
      setVisualAlert('ok');
    } else {
      setVisualAlert('critical');
      // Si le chercheur est dehors, réagrandissement + reset du chrono à 5 min
      if (currentRadius < 800) {
        currentRadius += 50;
        if (opponentPos) generateRandomCircle(opponentPos, currentRadius);
        db.ref(`rooms/${roomCode}/gameState`).update({ zoneTimerEnd: Date.now() + (300 * 1000) });
        playTingSound();
      }
    }
  }
}

function setVisualAlert(type) {
  const toggle = document.getElementById('toggle-effects');
  if (toggle && !toggle.checked) {
    appContainer.className = 'status-normal';
    return;
  }
  appContainer.className = 'status-' + type;
}

function playTingSound() {
  const toggle = document.getElementById('toggle-sound');
  if (toggle && !toggle.checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

// UI NAVIGATION & RECENTER
document.getElementById('btn-recenter').addEventListener('click', () => {
  if (userPos) map.setView(userPos, 16);
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    e.target.classList.add('active');
    document.getElementById(e.target.dataset.tab).classList.add('active');
  });
});

// PHOTO PREUVE
const photoInput = document.getElementById('photo-input');
document.getElementById('btn-take-photo').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      document.getElementById('photo-preview').innerHTML = `<img src="${event.target.result}">`;
      alert("Preuve photo enregistrée !");
    };
    reader.readAsDataURL(file);
  }
});
