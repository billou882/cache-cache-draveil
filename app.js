// --- CONFIGURATION FIREBASE (TES CLÉS) ---
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

// --- CONFIGURATION PORT AUX CERISES (DRAVEIL) ---
const CENTER_DRAVEIL = [48.6800, 2.4150];

// ÉTATS DE JEU
let roomCode = null;
let userRole = null; // 'hider' ou 'seeker'
let map, userMarker, zoneCircle, opponentMarker;
let userPos = null;
let opponentPos = null;
let circleCenter = null;

let currentRadius = 500;
let phase = 'PREPARATION'; // 'PREPARATION' (25 min) ou 'HUNTING'
let timerSeconds = 25 * 60;
let outOfZoneTimer = 0; // Se réagrandit si dehors 5 min

// ÉLÉMENTS UI
const lobbyScreen = document.getElementById('lobby-screen');
const appContainer = document.getElementById('app-container');
const statusText = document.getElementById('status-text');
const timerDisplay = document.getElementById('timer-display');
const displayRoomCode = document.getElementById('display-room-code');

// --- 1. SELECTION DU RÔLE & REJOINDRE LE SALON ---
document.getElementById('btn-role-hider').addEventListener('click', () => selectRole('hider'));
document.getElementById('btn-role-seeker').addEventListener('click', () => selectRole('seeker'));

function selectRole(role) {
  userRole = role;
  document.getElementById('btn-role-hider').classList.toggle('selected', role === 'hider');
  document.getElementById('btn-role-seeker').classList.toggle('selected', role === 'seeker');
  document.getElementById('selected-role-text').innerText = `Rôle choisi : ${role === 'hider' ? '🥷 Caché' : '🕵️ Chercheur'}`;
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis d'abord un rôle !");
  roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // Code à 4 chiffres
  initGameRoom();
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  if (!userRole) return alert("Choisis d'abord un rôle !");
  const inputCode = document.getElementById('room-code-input').value.trim();
  if (inputCode.length !== 4) return alert("Entre un code valide à 4 chiffres.");
  roomCode = inputCode;
  initGameRoom();
});

function initGameRoom() {
  lobbyScreen.style.display = 'none';
  appContainer.style.display = 'flex';
  displayRoomCode.innerText = roomCode;

  initMap();
  startGpsTracking();
  listenToFirebase();
}

// --- 2. CARTE & GEOLOCALISATION ---
function initMap() {
  map = L.map('map', { zoomControl: false }).setView(CENTER_DRAVEIL, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);
}

function startGpsTracking() {
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition(
      (pos) => {
        userPos = [pos.coords.latitude, pos.coords.longitude];
        updateUserPositionOnMap();
        
        // Envoi des coordonnées sur Firebase
        if (roomCode && userRole) {
          db.ref(`rooms/${roomCode}/${userRole}`).set({
            lat: userPos[0],
            lng: userPos[1],
            timestamp: Date.now()
          });
        }
        
        checkGameRules();
      },
      (err) => console.warn("Erreur GPS : " + err.message),
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
  }
}

function updateUserPositionOnMap() {
  if (!userPos) return;
  if (!userMarker) {
    userMarker = L.marker(userPos).addTo(map).bindPopup("Tu es ici");
  } else {
    userMarker.setLatLng(userPos);
  }
}

// --- 3. SYNCHRONISATION EN TEMPS RÉEL (FIREBASE) ---
function listenToFirebase() {
  const opponentRole = userRole === 'hider' ? 'seeker' : 'hider';

  // Écouter la position de l'autre joueur
  db.ref(`rooms/${roomCode}/${opponentRole}`).on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      opponentPos = [data.lat, data.lng];

      // Si c'est le chercheur et que la phase 1 est terminée, on met le premier cercle
      if (userRole === 'seeker' && phase === 'HUNTING' && !circleCenter && opponentPos) {
        generateRandomCircle(opponentPos, currentRadius);
      }
    }
  });

  // Écouter les mises à jour du cercle partagé
  db.ref(`rooms/${roomCode}/circle`).on('value', (snapshot) => {
    const circleData = snapshot.val();
    if (circleData) {
      circleCenter = [circleData.lat, circleData.lng];
      currentRadius = circleData.radius;
      renderCircle();
    }
  });
}

// --- 4. LOGIQUE DE JEU & CERCLE ALÉATOIRE ---
function generateRandomCircle(hiderPos, radius) {
  // Décalage aléatoire autour du caché
  const randomAngle = Math.random() * 2 * Math.PI;
  const randomDistance = Math.random() * (radius * 0.5);

  const deltaLat = (randomDistance * Math.cos(randomAngle)) / 111111;
  const deltaLng = (randomDistance * Math.sin(randomAngle)) / (111111 * Math.cos(hiderPos[0] * Math.PI / 180));

  circleCenter = [hiderPos[0] + deltaLat, hiderPos[1] + deltaLng];

  // Enregistrer le cercle sur Firebase pour synchroniser les 2 joueurs
  db.ref(`rooms/${roomCode}/circle`).set({
    lat: circleCenter[0],
    lng: circleCenter[1],
    radius: radius
  });
}

function renderCircle() {
  if (!circleCenter) return;

  if (zoneCircle) map.removeLayer(zoneCircle);

  zoneCircle = L.circle(circleCenter, {
    color: '#ef4444',
    fillColor: '#ef4444',
    fillOpacity: 0.2,
    radius: currentRadius
  }).addTo(map);
}

// --- 5. RÈGLES & VÉRIFICATIONS (DÉPLACEMENT DU CERCLE + HORS ZONE) ---
function checkGameRules() {
  if (!userPos || !circleCenter || phase !== 'HUNTING') return;

  const distanceToCenter = map.distance(userPos, circleCenter);

  // Mécanique de tirage par le caché s'il sort du cercle
  if (userRole === 'hider' && opponentPos) {
    const distanceHiderToCenter = map.distance(userPos, circleCenter);
    if (distanceHiderToCenter > currentRadius) {
      // Le caché traîne le cercle avec lui
      generateRandomCircle(userPos, currentRadius);
    }
  }

  // Vérification de zone pour le chercheur
  if (userRole === 'seeker') {
    if (distanceToCenter <= currentRadius) {
      setStatusAlert('ok', 'Tu es DANS la zone !');
      outOfZoneTimer = 0; // Réinitialise le compteur hors-zone
    } else {
      setStatusAlert('critical', 'CRITIQUE : Tu es HORS de la zone !');
      outOfZoneTimer++;

      // Règle de secours : Si le chercheur est dehors pendant 5 min (300 secondes de check), la zone s'agrandit
      if (outOfZoneTimer >= 300) {
        currentRadius += 100;
        if (opponentPos) generateRandomCircle(opponentPos, currentRadius);
        playTingSound();
        alert("⚠️ Tu es resté 5 min hors de la zone. La zone s'est réagrandie pour te donner une chance !");
        outOfZoneTimer = 0;
      }
    }
  }
}

// --- 6. TIMERS ET PHASES ---
setInterval(() => {
  if (timerSeconds > 0) {
    timerSeconds--;
    const mins = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
    const secs = String(timerSeconds % 60).padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;
  } else {
    handlePhaseTimeout();
  }
}, 1000);

function handlePhaseTimeout() {
  if (phase === 'PREPARATION') {
    phase = 'HUNTING';
    playTingSound();
    alert("⏰ 25 minutes écoulées ! La traque commence au Port aux Cerises !");
    
    if (userRole === 'seeker' && opponentPos) {
      generateRandomCircle(opponentPos, 500);
    }
    
    timerSeconds = 5 * 60; // Prochain palier dans 5 minutes
    setStatusAlert('warning', 'Rejoins la zone de 500m !');
  } else if (phase === 'HUNTING') {
    // Réduction automatique de 50 mètres toutes les 5 minutes
    if (currentRadius > 50) {
      currentRadius -= 50;
      if (opponentPos) generateRandomCircle(opponentPos, currentRadius);
      playTingSound();
      setStatusAlert('warning', `La zone rétrécit ! Nouveau rayon : ${currentRadius}m`);
    }
    timerSeconds = 5 * 60;
  }
}

// --- 7. EFFETS VISUELS ET SON ---
function setStatusAlert(type, message) {
  statusText.innerText = message;
  const toggleEffects = document.getElementById('toggle-effects');
  if (toggleEffects && !toggleEffects.checked) {
    appContainer.className = 'status-normal';
    return;
  }
  appContainer.className = 'status-' + type;
}

function playTingSound() {
  const toggleSound = document.getElementById('toggle-sound');
  if (toggleSound && !toggleSound.checked) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch(e) {}
}

// UI NAVIGATION & RECENTRER
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

// PHOTO ANTI-TRICHE
const photoInput = document.getElementById('photo-input');
document.getElementById('btn-take-photo').addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      document.getElementById('photo-preview').innerHTML = `<img src="${event.target.result}" alt="Preuve zone">`;
      playTingSound();
      alert("Photo enregistrée !");
    };
    reader.readAsDataURL(file);
  }
});
