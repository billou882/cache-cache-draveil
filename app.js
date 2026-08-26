import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, update } from "firebase/database";

// Configuration Firebase
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

// Initialisation Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Variables globales du jeu
let currentRole = null; // 'mouse' ou 'cat'
let roomCode = '1234';
let myPosition = null;
let catPosition = null;
let circleRadius = 200; // Rayon initial en mètres
let circleCenter = null;

// Initialisation de la Carte Leaflet
const map = L.map('map').setView([48.68, 2.40], 15); // Centre par défaut (Draveil)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let playerMarker = null;
let zoneCircle = null;

// Gestion de la Géolocalisation GPS
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (pos) => {
      myPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updatePlayerMarker(myPosition);
      syncPositionToFirebase(myPosition);
      
      // La Souris gère l'ajustement du cercle si elle en sort
      if (currentRole === 'mouse') {
        manageCircleBoundary();
      }
    },
    (err) => console.error("Erreur GPS :", err),
    { enableHighAccuracy: true }
  );
}

// Mise à jour du marqueur sur la carte
function updatePlayerMarker(pos) {
  if (!playerMarker) {
    playerMarker = L.marker([pos.lat, pos.lng]).addTo(map);
  } else {
    playerMarker.setLatLng([pos.lat, pos.lng]);
  }
  map.panTo([pos.lat, pos.lng]);
}

// Synchronisation de la position GPS vers Firebase
function syncPositionToFirebase(pos) {
  if (!currentRole) return;
  set(ref(db, `rooms/${roomCode}/positions/${currentRole}`), pos);
}

// Rejoindre un rôle
document.getElementById('btnMouse').addEventListener('click', () => joinGame('mouse'));
document.getElementById('btnCat').addEventListener('click', () => joinGame('cat'));

function joinGame(role) {
  currentRole = role;
  roomCode = document.getElementById('roomInput').value || '1234';
  document.getElementById('status').innerText = `Rôle : ${role.toUpperCase()}`;

  // Initialisation des données du joueur
  set(ref(db, `rooms/${roomCode}/players/${role}`), {
    ready: true,
    score: 0
  });

  // Écoute de l'état du cercle
  onValue(ref(db, `rooms/${roomCode}/circle`), (snapshot) => {
    const circleData = snapshot.val();
    if (circleData) {
      drawCircle(circleData.lat, circleData.lng, circleData.radius);
    }
  });

  // Si c'est la Souris, elle écoute aussi la position du Chat pour ajuster la zone
  if (currentRole === 'mouse') {
    onValue(ref(db, `rooms/${roomCode}/positions/cat`), (snapshot) => {
      catPosition = snapshot.val();
    });

    // Boucle dynamique toutes les 30 secondes pour agrandir/rétrécir le cercle
    setInterval(updateCircleRadius, 30000);
  }
}

// Dessin / mise à jour du cercle sur Leaflet
function drawCircle(lat, lng, radius) {
  if (!zoneCircle) {
    zoneCircle = L.circle([lat, lng], { radius: radius, color: 'blue' }).addTo(map);
  } else {
    zoneCircle.setLatLng([lat, lng]);
    zoneCircle.setRadius(radius);
  }
}

// Gestion du recentrage si la Souris sort du cercle
function manageCircleBoundary() {
  if (!myPosition) return;

  if (!circleCenter) {
    circleCenter = myPosition;
    updateCircleInFirebase();
    return;
  }

  const distance = map.distance([myPosition.lat, myPosition.lng], [circleCenter.lat, circleCenter.lng]);
  if (distance > circleRadius) {
    circleCenter = myPosition;
    updateCircleInFirebase();
  }
}

// Ajustement dynamique du rayon (Toutes les 30s - exécuté par la Souris)
function updateCircleRadius() {
  if (!catPosition || !circleCenter) return;

  const distanceCat = map.distance([catPosition.lat, catPosition.lng], [circleCenter.lat, circleCenter.lng]);

  if (distanceCat <= circleRadius) {
    // Chat à l'intérieur : Rétrécissement (-50m)
    circleRadius = Math.max(50, circleRadius - 50);
  } else {
    // Chat à l'extérieur : Agrandissement (+50m)
    circleRadius = Math.min(400, circleRadius + 50);
  }

  updateCircleInFirebase();
}

// Mise à jour du cercle dans Firebase
function updateCircleInFirebase() {
  if (!circleCenter) return;
  update(ref(db, `rooms/${roomCode}/circle`), {
    lat: circleCenter.lat,
    lng: circleCenter.lng,
    radius: circleRadius
  });
}
