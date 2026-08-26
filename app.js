import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// ID Joueur unique pour la session
const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
let myRole = null;
let timerInterval = null;
let secondsElapsed = 0;
let markers = {};
let zoneCircle = null;
let inBuilding = false;

// Coordonnées de base (Draveil)
const baseLat = 48.6828;
const baseLng = 2.4081;

// Initialisation Carte Leaflet
const map = L.map('map', { zoomControl: false }).setView([baseLat, baseLng], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Cercle de Zone Rétrécissable & Glissant
zoneCircle = L.circle([baseLat, baseLng], {
  color: '#38bdf8',
  fillColor: '#0284c7',
  fillOpacity: 0.15,
  weight: 2,
  radius: 400
}).addTo(map);

// Éléments du DOM
const roleBadge = document.getElementById('role-badge');
const timerEl = document.getElementById('timer');
const btnSouris = document.getElementById('btn-souris');
const btnChat = document.getElementById('btn-chat');
const btnHotel = document.getElementById('btn-hotel');
const btnZone = document.getElementById('btn-zone');

// Synchronisation de la Zone en Temps Réel
onValue(ref(db, 'zone'), (snapshot) => {
  const data = snapshot.val();
  if (data && zoneCircle) {
    zoneCircle.setLatLng([data.lat, data.lng]);
    zoneCircle.setRadius(data.radius);
  }
});

// Déplacement et rétrécissement de la zone
function moveZoneRandomly() {
  const currentCenter = zoneCircle.getLatLng();
  const currentRadius = zoneCircle.getRadius();
  
  // Décalage aléatoire (~200m - 300m)
  const randomLat = currentCenter.lat + (Math.random() - 0.5) * 0.006;
  const randomLng = currentCenter.lng + (Math.random() - 0.5) * 0.006;
  const newRadius = Math.max(100, currentRadius * 0.8);

  set(ref(db, 'zone'), {
    lat: randomLat,
    lng: randomLng,
    radius: newRadius,
    updatedAt: Date.now()
  });
}

// Gestion des rôles
btnSouris.addEventListener('click', () => joinGame('souris'));
btnChat.addEventListener('click', () => joinGame('chat'));
btnZone.addEventListener('click', moveZoneRandomly);

btnHotel.addEventListener('click', () => {
  inBuilding = !inBuilding;
  if (inBuilding) {
    btnHotel.textContent = '🏃 Sortir du bâtiment (Reprendre GPS)';
    btnHotel.style.background = 'rgba(234, 179, 8, 0.2)';
    btnHotel.style.borderColor = '#eab308';
  } else {
    btnHotel.textContent = '🏢 En bâtiment (Pause GPS)';
    btnHotel.style.background = 'rgba(255, 255, 255, 0.08)';
    btnHotel.style.borderColor = 'rgba(255, 255, 255, 0.15)';
  }
});

function joinGame(role) {
  myRole = role;
  roleBadge.textContent = role === 'souris' ? '🐭 Souris' : '🐱 Chat';
  roleBadge.className = `badge badge-${role}`;
  
  btnSouris.disabled = true;
  btnChat.disabled = true;
  btnHotel.disabled = false;
  btnZone.disabled = false;

  if (role === 'souris') startTimer();
  
  // Géolocalisation active
  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      if (!inBuilding) {
        set(ref(db, 'players/' + playerId), {
          role: myRole,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          updatedAt: Date.now()
        });
      }
    }, (err) => console.error(err), { enableHighAccuracy: true });
  }
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

// Écoute des joueurs sur Firebase
onValue(ref(db, 'players'), (snapshot) => {
  const players = snapshot.val();
  if (!players) return;

  Object.keys(players).forEach((id) => {
    const p = players[id];
    const iconColor = p.role === 'souris' ? '#0284c7' : '#e11d48';

    if (!markers[id]) {
      markers[id] = L.circleMarker([p.lat, p.lng], {
        radius: 9,
        fillColor: iconColor,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(map);
    } else {
      markers[id].setLatLng([p.lat, p.lng]);
    }
  });
});
