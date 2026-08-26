// ==========================================
// CACHE-CACHE GPS — VERSION 1.92
// ==========================================

// --- 1. CONFIGURATION FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFZzJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// --- 2. VARIABLES GLOBALES ---
let roomCode = null;
let myRole = null; // 'mouse' ou 'cat'
let myName = "Joueur";
let myColor = "#38bdf8";

let map = null;
let myMarker = null;
let zoneCircleLayer = null;
let currentPos = null;

const RADIUS_MAX = 400;
const RADIUS_MIN = 50;
let circleCenter = null;
let circleRadius = RADIUS_MAX;

const CIRCLE_COLOR = "#1e3a8a"; // BLEU MARINE

let gameStartTime = null;
let hideDurationMinutes = 5;
let isHidingPhase = true;

let gameLoopTimer = null;
let activeChallenges = {};
let currentChallengeForPhoto = null;

// --- 3. CALCUL DE DISTANCE (METRES) ---
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// --- 4. INITIALISATION DOM ---
document.addEventListener('DOMContentLoaded', () => {
  initRoleButtons();
  initColorButtons();
  initNavigation();
  initLobbyEvents();
  initGameEvents();
});

function initRoleButtons() {
  const btnMouse = document.getElementById('btn-role-hider') || document.getElementById('btn-role-mouse');
  const btnCat = document.getElementById('btn-role-seeker') || document.getElementById('btn-role-cat');

  if (btnMouse) {
    btnMouse.onclick = () => {
      myRole = 'mouse';
      btnMouse.classList.add('selected');
      if (btnCat) btnCat.classList.remove('selected');
    };
  }
  if (btnCat) {
    btnCat.onclick = () => {
      myRole = 'cat';
      btnCat.classList.add('selected');
      if (btnMouse) btnMouse.classList.remove('selected');
    };
  }
}

function initColorButtons() {
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.onclick = (e) => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
      e.currentTarget.classList.add('selected');
      myColor = e.currentTarget.dataset.color || "#38bdf8";
    };
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.onclick = (e) => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));

      e.target.classList.add('active');
      const pageId = e.target.dataset.tab;
      const page = document.getElementById(pageId);
      if (page) page.classList.add('active');

      if (pageId === 'tab-map' && map) {
        setTimeout(() => {
          map.invalidateSize();
          if (currentPos) map.setView(currentPos, 16);
        }, 200);
      }
    };
  });
}

function initLobbyEvents() {
  const btnCreate = document.getElementById('btn-create-room');
  if (btnCreate) {
    btnCreate.onclick = () => {
      if (!myRole) return alert("Choisissez un rôle (Chat ou Souris).");
      myName = (document.getElementById('player-name-input')?.value || "Joueur").trim();
      hideDurationMinutes = parseInt(document.getElementById('hide-time-input')?.value) || 5;
      roomCode = Math.floor(1000 + Math.random() * 9000).toString();
      enterWaitingRoom();
    };
  }

  const btnJoin = document.getElementById('btn-join-room');
  if (btnJoin) {
    btnJoin.onclick = () => {
      if (!myRole) return alert("Choisissez un rôle (Chat ou Souris).");
      roomCode = (document.getElementById('room-code-input')?.value || "").trim();
      if (!roomCode) return alert("Entrez un code de salon valide.");
      myName = (document.getElementById('player-name-input')?.value || "Joueur").trim();
      enterWaitingRoom();
    };
  }

  const btnReady = document.getElementById('btn-ready');
  if (btnReady) {
    btnReady.onclick = () => {
      db.ref(`rooms/${roomCode}/players/${myRole}/ready`).set(true);
    };
  }
}

function initGameEvents() {
  const photoInput = document.getElementById('challenge-photo-input');
  if (photoInput) {
    photoInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file && currentChallengeForPhoto && activeChallenges[currentChallengeForPhoto]) {
        const ch = activeChallenges[currentChallengeForPhoto];
        const reader = new FileReader();
        reader.onload = (ev) => {
          db.ref(`rooms/${roomCode}/submittedPhotos`).push({
            challengeText: ch.text,
            pts: ch.pts,
            photo: ev.target.result
          });
          db.ref(`rooms/${roomCode}/challenges/${currentChallengeForPhoto}`).remove();
          alert("📸 Photo envoyée au Chat !");
        };
        reader.readAsDataURL(file);
      }
    };
  }

  const btnFound = document.getElementById('btn-found-seeker');
  if (btnFound) {
    btnFound.onclick = () => {
      db.ref(`rooms/${roomCode}/roundStatus`).set('CAT_CLAIMED');
      alert("Alerte envoyée à la Souris.");
    };
  }

  const btnConfirm = document.getElementById('btn-confirm-hider');
  if (btnConfirm) {
    btnConfirm.onclick = () => {
      db.ref(`rooms/${roomCode}/roundStatus`).set('CONFIRMED');
    };
  }

  const btnFinish = document.getElementById('btn-finish-review');
  if (btnFinish) {
    btnFinish.onclick = () => {
      db.ref(`rooms/${roomCode}/gameState/phase`).set('PODIUM');
    };
  }

  const btnSwap = document.getElementById('btn-swap-roles');
  if (btnSwap) btnSwap.onclick = resetGame;

  const btnLeave = document.getElementById('btn-leave-room');
  if (btnLeave) btnLeave.onclick = () => location.reload();

  const btnRecenter = document.getElementById('btn-recenter');
  if (btnRecenter) {
    btnRecenter.onclick = () => {
      if (currentPos && map) map.setView(currentPos, 16);
    };
  }
}

// --- 5. SALLE D'ATTENTE ---
function enterWaitingRoom() {
  hideScreen('lobby-screen');
  hideScreen('podium-screen');
  showScreen('waiting-room-screen');
  
  const codeElem = document.getElementById('waiting-room-code');
  if (codeElem) codeElem.innerText = roomCode;

  db.ref(`rooms/${roomCode}/players/${myRole}`).set({
    role: myRole,
    name: myName,
    color: myColor,
    ready: false,
    score: 0
  });

  db.ref(`rooms/${roomCode}/players`).on('value', (snap) => {
    const players = snap.val();
    if (!players) return;

    let html = '';
    let countReady = 0;
    for (let r in players) {
      const p = players[r];
      if (p.ready) countReady++;
      const label = (r === 'mouse') ? '🐭 Souris' : '🐱 Chat';
      html += `<div style="padding:6px 0; border-bottom:1px solid #eee;"><b>${p.name}</b> (${label}) — ${p.ready ? '✅ Prêt' : '⏳ En attente'}</div>`;
    }

    const listElem = document.getElementById('players-status-list');
    if (listElem) listElem.innerHTML = html;

    if (countReady >= 2 && myRole === 'mouse') {
      db.ref(`rooms/${roomCode}/gameState`).set({
        phase: 'HIDING',
        startTime: Date.now(),
        hideDuration: hideDurationMinutes
      });
    }
  });

  db.ref(`rooms/${roomCode}/gameState`).on('value', (snap) => {
    const st = snap.val();
    if (st && (st.phase === 'HIDING' || st.phase === 'HUNTING')) {
      gameStartTime = st.startTime;
      hideDurationMinutes = st.hideDuration || 5;
      if (document.getElementById('app-container').style.display !== 'flex') {
        startGameSession();
      }
    }
    if (st && st.phase === 'REVIEW') showReviewScreen();
    if (st && st.phase === 'PODIUM') showPodiumScreen();
  });
}

// --- 6. GESTION DE LA CARTE ET DE LA LOCALISATION ---
function startGameSession() {
  hideScreen('waiting-room-screen');
  hideScreen('review-screen');
  hideScreen('podium-screen');
  showScreen('app-container');

  initLeafletMap();
  startGPS();
  listenFirebaseGameData();

  const isCat = (myRole === 'cat');
  const creationBox = document.getElementById('seeker-challenge-creation');
  const btnFound = document.getElementById('btn-found-seeker');
  if (creationBox) creationBox.style.display = isCat ? 'block' : 'none';
  if (btnFound) btnFound.style.display = isCat ? 'block' : 'none';

  if (gameLoopTimer) clearInterval(gameLoopTimer);
  gameLoopTimer = setInterval(mainGameLoop, 1000);
}

function initLeafletMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([48.6800, 2.4150], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}

function startGPS() {
  navigator.geolocation.watchPosition((pos) => {
    currentPos = [pos.coords.latitude, pos.coords.longitude];

    if (roomCode) {
      db.ref(`rooms/${roomCode}/positions/${myRole}`).set({ lat: currentPos[0], lng: currentPos[1] });
    }

    updateMyMarker();

    // DYNAMIQUE DE LA ZONE (SOURIS SEULEMENT)
    if (myRole === 'mouse') {
      if (!circleCenter) {
        // Décalage aléatoire léger autour de la souris (~100m à 150m) pour ne pas qu'elle soit pile au centre
        const latOffset = (Math.random() - 0.5) * 0.002;
        const lngOffset = (Math.random() - 0.5) * 0.002;
        
        circleCenter = [currentPos[0] + latOffset, currentPos[1] + lngOffset];
        drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius);
        syncCircleDb();
      } else {
        // Glissement du cercle lorsque la souris atteint le bord du cercle
        const dist = getDistanceInMeters(currentPos[0], currentPos[1], circleCenter[0], circleCenter[1]);
        if (dist > circleRadius) {
          const latDiff = currentPos[0] - circleCenter[0];
          const lngDiff = currentPos[1] - circleCenter[1];
          const moveRatio = (dist - circleRadius) / dist;

          circleCenter = [
            circleCenter[0] + (latDiff * moveRatio),
            circleCenter[1] + (lngDiff * moveRatio)
          ];
          drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius);
          syncCircleDb();
        }
      }
    }
  }, null, { enableHighAccuracy: true });
}

function updateMyMarker() {
  if (!currentPos || !map) return;

  const customIcon = L.divIcon({
    className: 'custom-dot-container',
    html: `<div class="user-location-dot" style="background-color: ${myColor};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  if (!myMarker) {
    myMarker = L.marker(currentPos, { icon: customIcon }).addTo(map);
  } else {
    myMarker.setLatLng(currentPos);
  }
}

// AFFICHAGE DU CERCLE BLEU MARINE UNIQUE POUR TOUS
function drawCircleOnMap(lat, lng, radius) {
  if (!map || !lat || !lng) return;

  if (!zoneCircleLayer) {
    zoneCircleLayer = L.circle([lat, lng], {
      color: CIRCLE_COLOR,
      fillColor: CIRCLE_COLOR,
      fillOpacity: 0.2,
      weight: 3,
      radius: radius
    }).addTo(map);
  } else {
    zoneCircleLayer.setLatLng([lat, lng]);
    zoneCircleLayer.setRadius(radius);
  }
}

function syncCircleDb() {
  if (myRole === 'mouse' && roomCode && circleCenter) {
    db.ref(`rooms/${roomCode}/circle`).set({
      lat: circleCenter[0],
      lng: circleCenter[1],
      radius: circleRadius
    });
  }
}

// SYNCHRONISATION EN TEMPS RÉEL DE FIREBASE
function listenFirebaseGameData() {
  db.ref(`rooms/${roomCode}/circle`).on('value', (snap) => {
    const c = snap.val();
    if (c && c.lat && c.lng) {
      circleCenter = [c.lat, c.lng];
      circleRadius = c.radius || RADIUS_MAX;
      // Met à jour la carte chez le Chat ET chez la Souris
      drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius);
    }
  });

  db.ref(`rooms/${roomCode}/challenges`).on('value', (snap) => {
    activeChallenges = snap.val() || {};
    renderChallengesList();
  });

  db.ref(`rooms/${roomCode}/roundStatus`).on('value', (snap) => {
    const status = snap.val();
    if (status === 'CAT_CLAIMED' && myRole === 'mouse') {
      const btnConfirm = document.getElementById('btn-confirm-hider');
      const statusTxt = document.getElementById('status-text');
      if (btnConfirm) btnConfirm.style.display = 'block';
      if (statusTxt) statusTxt.innerText = "Le Chat affirme vous avoir attrapé ! Confirmez-vous ?";
    } else if (status === 'CONFIRMED') {
      db.ref(`rooms/${roomCode}/gameState/phase`).set('REVIEW');
    }
  });
}

// --- 7. BOUCLE TEMPS RÉEL (1 SECONDE) ---
function mainGameLoop() {
  if (!gameStartTime) return;
  const now = Date.now();

  const hideDurationMs = hideDurationMinutes * 60 * 1000;
  const hideEndTime = gameStartTime + hideDurationMs;
  const remainingHideMs = hideEndTime - now;

  const timerDisplay = document.getElementById('timer-display');
  const statusTxt = document.getElementById('status-text');

  if (remainingHideMs > 0) {
    isHidingPhase = true;
    const sec = Math.floor(remainingHideMs / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');

    if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;
    if (statusTxt) {
      statusTxt.innerText = (myRole === 'mouse') 
        ? `Cachez-vous ! Le Chat arrive dans ${m}:${s}` 
        : `Patientez, la Souris se cache... (${m}:${s})`;
    }
  } else {
    const elapsedMs = now - hideEndTime;
    const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));

    if (isHidingPhase) {
      isHidingPhase = false;
      if (myRole === 'mouse') {
        circleRadius = 300;
        syncCircleDb();
      }
    }

    const sec = Math.floor(elapsedMs / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');

    if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;

    const shrinkSteps = Math.floor(elapsedMinutes / 5);
    const nextShrinkMs = ((shrinkSteps + 1) * 5 * 60 * 1000) - elapsedMs;
    const nextSec = Math.max(0, Math.floor(nextShrinkMs / 1000));
    const mNext = String(Math.floor(nextSec / 60)).padStart(2, '0');
    const sNext = String(nextSec % 60).padStart(2, '0');

    if (myRole === 'mouse') {
      const targetRadius = Math.max(RADIUS_MIN, 300 - (shrinkSteps * 50));
      if (circleRadius > targetRadius) {
        circleRadius = targetRadius;
        syncCircleDb();
      }
    }

    if (statusTxt) {
      statusTxt.innerText = `Traque en cours ! Rétrécissement (-50m) dans ${mNext}:${sNext}`;
    }
  }
}

// --- 8. DÉFIS ---
function renderChallengesList() {
  const container = document.querySelector('.challenges-container');
  if (!container) return;

  const creationBox = document.getElementById('seeker-challenge-creation');
  let html = (myRole === 'cat' && creationBox) ? creationBox.outerHTML : '';
  const keys = Object.keys(activeChallenges);

  if (keys.length === 0) {
    html += `<div class="challenge-card"><h3>📋 Défis</h3><p>Aucun défi en cours.</p></div>`;
  } else {
    keys.forEach((key) => {
      const ch = activeChallenges[key];
      html += `
        <div class="challenge-card">
          <h3>📋 Défi (${ch.pts} pts)</h3>
          <p>${ch.text}</p>
          ${myRole === 'mouse' ? `<button onclick="openCamera('${ch.id}')" class="btn-success">📷 Prendre la photo</button>` : ''}
        </div>
      `;
    });
  }

  container.innerHTML = html;

  const sendBtn = document.getElementById('btn-send-challenge');
  if (sendBtn) {
    sendBtn.onclick = () => {
      const txtElem = document.getElementById('custom-challenge-text');
      const ptsElem = document.getElementById('custom-challenge-pts');
      const text = txtElem ? txtElem.value.trim() : '';
      const pts = ptsElem ? parseInt(ptsElem.value) || 20 : 20;

      if (!text) return alert("Saisissez l'intitulé du défi.");

      const id = 'ch_' + Date.now();
      db.ref(`rooms/${roomCode}/challenges/${id}`).set({
        id: id,
        text: text,
        pts: pts
      });
      if (txtElem) txtElem.value = '';
    };
  }
}

window.openCamera = function(challengeId) {
  currentChallengeForPhoto = challengeId;
  const input = document.getElementById('challenge-photo-input');
  if (input) input.click();
};

// --- 9. FIN DE PARTIE & PODIUM ---
function showReviewScreen() {
  hideScreen('app-container');
  showScreen('review-screen');

  db.ref(`rooms/${roomCode}/submittedPhotos`).once('value', (snap) => {
    const photos = snap.val();
    const container = document.getElementById('photos-review-list');
    if (!container) return;

    if (!photos) {
      container.innerHTML = "<p>Aucune photo soumise.</p>";
      return;
    }

    let html = '';
    for (let key in photos) {
      const p = photos[key];
      html += `
        <div class="challenge-card" style="margin-bottom:12px;">
          <p><b>${p.challengeText}</b> (${p.pts} pts)</p>
          <img src="${p.photo}" style="width:100%; border-radius:8px; margin:8px 0;">
          ${myRole === 'cat' ? `
            <div style="display:flex; gap:8px;">
              <button onclick="valPhoto('${key}', true, ${p.pts})" class="btn-success">✅ Valider (+${p.pts} pts)</button>
              <button onclick="valPhoto('${key}', false, 0)" class="btn-danger">❌ Rejeter</button>
            </div>
          ` : `<p style="font-size:0.85rem; color:#64748b;">En attente du Chat...</p>`}
        </div>
      `;
    }
    container.innerHTML = html;
  });
}

window.valPhoto = function(photoKey, accept, pts) {
  if (accept) {
    db.ref(`rooms/${roomCode}/players/mouse/score`).transaction((curr) => (curr || 0) + pts);
  }
  db.ref(`rooms/${roomCode}/submittedPhotos/${photoKey}`).remove();
  showReviewScreen();
};

function showPodiumScreen() {
  hideScreen('review-screen');
  hideScreen('app-container');
  showScreen('podium-screen');

  db.ref(`rooms/${roomCode}/players`).once('value', (snap) => {
    const players = snap.val();
    let list = [];
    for (let r in players) list.push({ role: r, ...players[r] });

    list.sort((a, b) => (b.score || 0) - (a.score || 0));

    let html = '';
    list.forEach((p, idx) => {
      const medal = idx === 0 ? '🥇' : '🥈';
      html += `
        <div class="podium-item">
          <div><b>${medal} ${p.name}</b> (${p.role === 'mouse' ? '🐭 Souris' : '🐱 Chat'})</div>
          <b>${p.score || 0} pts</b>
        </div>
      `;
    });

    const display = document.getElementById('podium-display');
    if (display) display.innerHTML = html;
  });
}

function resetGame() {
  myRole = null;
  circleCenter = null;
  circleRadius = RADIUS_MAX;
  activeChallenges = {};
  isHidingPhase = true;

  if (zoneCircleLayer && map) {
    map.removeLayer(zoneCircleLayer);
    zoneCircleLayer = null;
  }
  if (myMarker && map) {
    map.removeLayer(myMarker);
    myMarker = null;
  }

  if (roomCode) {
    db.ref(`rooms/${roomCode}`).remove();
  }

  hideScreen('podium-screen');
  hideScreen('review-screen');
  hideScreen('app-container');
  showScreen('lobby-screen');
}

// --- 10. AFFICHAGE ÉCRANS ---
function showScreen(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = (id === 'app-container' || id === 'waiting-room-screen' || id === 'review-screen' || id === 'podium-screen' || id === 'lobby-screen') ? 'flex' : 'block';
}

function hideScreen(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
