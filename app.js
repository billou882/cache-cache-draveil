// ==========================================
// CACHE-CACHE GPS — VERSION V81
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFZzJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let roomCode = null;
let myRole = null;
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

let gameStartTime = null;
let hideDurationMinutes = 5;
let isHidingPhase = true;
let gameLoopTimer = null;

let activeChallenges = {};
let currentChallengeForPhoto = null;
let lastStepCalculated = -1;

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

document.addEventListener('DOMContentLoaded', () => {
  initRoleButtons();
  initColorButtons();
  initNavigation();
  initLobbyEvents();
  initGameEvents();
});

function initRoleButtons() {
  const btnMouse = document.getElementById('btn-role-hider');
  const btnCat = document.getElementById('btn-role-seeker');

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

function enterWaitingRoom() {
  hideAllScreens();
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
      html += `<div style="padding:8px; background:rgba(255,255,255,0.05); border-radius:8px;"><b>${p.name}</b> (${label}) — ${p.ready ? '✅ Prêt' : '⏳ En attente'}</div>`;
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

function startGameSession() {
  hideAllScreens();
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

    if (myRole === 'mouse') {
      if (!circleCenter) {
        const latOffset = (Math.random() - 0.5) * 0.0015;
        const lngOffset = (Math.random() - 0.5) * 0.0015;
        circleCenter = [currentPos[0] + latOffset, currentPos[1] + lngOffset];
        drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius, myColor);
        syncCircleDb();
      } else {
        const dist = getDistanceInMeters(currentPos[0], currentPos[1], circleCenter[0], circleCenter[1]);
        if (dist > circleRadius) {
          const latDiff = currentPos[0] - circleCenter[0];
          const lngDiff = currentPos[1] - circleCenter[1];
          const moveRatio = (dist - circleRadius) / dist;

          circleCenter = [
            circleCenter[0] + (latDiff * moveRatio),
            circleCenter[1] + (lngDiff * moveRatio)
          ];
          drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius, myColor);
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
    html: `<div style="width:16px; height:16px; background-color:${myColor}; border:2px solid #fff; border-radius:50%; box-shadow:0 0 8px ${myColor};"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  if (!myMarker) {
    myMarker = L.marker(currentPos, { icon: customIcon }).addTo(map);
  } else {
    myMarker.setLatLng(currentPos);
  }
}

function drawCircleOnMap(lat, lng, radius, color) {
  if (!map || !lat || !lng) return;
  const drawColor = color || myColor;

  if (!zoneCircleLayer) {
    zoneCircleLayer = L.circle([lat, lng], {
      color: drawColor,
      fillColor: drawColor,
      fillOpacity: 0.25,
      weight: 3,
      radius: radius
    }).addTo(map);
  } else {
    zoneCircleLayer.setLatLng([lat, lng]);
    zoneCircleLayer.setRadius(radius);
    zoneCircleLayer.setStyle({ color: drawColor, fillColor: drawColor });
  }
}

function syncCircleDb() {
  if (myRole === 'mouse' && roomCode && circleCenter) {
    db.ref(`rooms/${roomCode}/circle`).set({
      lat: circleCenter[0],
      lng: circleCenter[1],
      radius: circleRadius,
      color: myColor
    });
  }
}

function listenFirebaseGameData() {
  db.ref(`rooms/${roomCode}/circle`).on('value', (snap) => {
    const c = snap.val();
    if (c && c.lat && c.lng) {
      circleCenter = [c.lat, c.lng];
      circleRadius = c.radius || RADIUS_MAX;
      const activeColor = c.color || myColor;

      if (myRole === 'mouse' || (myRole === 'cat' && !isHidingPhase)) {
        drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius, activeColor);
      }
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
    
    if (isHidingPhase) {
      isHidingPhase = false;
      if (myRole === 'mouse') {
        circleRadius = 300;
        syncCircleDb();
      } else if (myRole === 'cat' && circleCenter) {
        drawCircleOnMap(circleCenter[0], circleCenter[1], circleRadius, myColor);
      }
    }

    const sec = Math.floor(elapsedMs / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;

    const INTERVAL_SEC = 30;
    const currentStep = Math.floor(sec / INTERVAL_SEC);
    const nextChangeSec = ((currentStep + 1) * INTERVAL_SEC) - sec;
    const sNext = String(nextChangeSec).padStart(2, '0');

    if (myRole === 'mouse' && circleCenter && currentStep > lastStepCalculated) {
      lastStepCalculated = currentStep;

      db.ref(`rooms/${roomCode}/positions/cat`).once('value', (snap) => {
        const catPos = snap.val();
        let catInside = false;

        if (catPos && catPos.lat && catPos.lng) {
          const distCatToCenter = getDistanceInMeters(catPos.lat, catPos.lng, circleCenter[0], circleCenter[1]);
          if (distCatToCenter <= circleRadius) catInside = true;
        }

        if (catInside) {
          circleRadius = Math.max(RADIUS_MIN, circleRadius - 50);
        } else {
          circleRadius = Math.min(RADIUS_MAX, circleRadius + 50);
        }

        syncCircleDb();
      });
    }

    if (statusTxt) {
      db.ref(`rooms/${roomCode}/positions/cat`).once('value', (snap) => {
        const catPos = snap.val();
        let isCatIn = false;
        if (catPos && circleCenter) {
          const d = getDistanceInMeters(catPos.lat, catPos.lng, circleCenter[0], circleCenter[1]);
          if (d <= circleRadius) isCatIn = true;
        }

        if (isCatIn) {
          statusTxt.innerText = `Chat DANS le cercle ! Rétrécissement (-50m) dans 00:${sNext}`;
        } else {
          statusTxt.innerText = `Chat HORS du cercle ! Agrandissement (+50m) dans 00:${sNext}`;
        }
      });
    }
  }
}

function renderChallengesList() {
  const container = document.getElementById('challenges-list');
  if (!container) return;

  const keys = Object.keys(activeChallenges);
  let html = '';

  if (keys.length === 0) {
    html = `<div class="card"><p>Aucun défi actif.</p></div>`;
  } else {
    keys.forEach((key) => {
      const ch = activeChallenges[key];
      html += `
        <div class="card" style="margin-bottom:10px;">
          <h3>📋 Défi (${ch.pts} pts)</h3>
          <p style="margin:8px 0; color:var(--text-muted);">${ch.text}</p>
          ${myRole === 'mouse' ? `<button onclick="openCamera('${ch.id}')" class="btn btn-success">📷 Prendre la photo</button>` : ''}
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

function showReviewScreen() {
  hideAllScreens();
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
        <div class="card" style="margin-bottom:12px;">
          <p><b>${p.challengeText}</b> (${p.pts} pts)</p>
          <img src="${p.photo}" style="width:100%; border-radius:8px; margin:8px 0;">
          ${myRole === 'cat' ? `
            <div style="display:flex; gap:8px;">
              <button onclick="valPhoto('${key}', true, ${p.pts})" class="btn btn-success">✅ Valider (+${p.pts} pts)</button>
              <button onclick="valPhoto('${key}', false, 0)" class="btn btn-danger">❌ Rejeter</button>
            </div>
          ` : `<p style="font-size:0.85rem; color:var(--text-muted);">En attente du Chat...</p>`}
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
  hideAllScreens();
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
        <div style="display:flex; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.05); border-radius:10px;">
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

  if (roomCode) db.ref(`rooms/${roomCode}`).remove();

  hideAllScreens();
  showScreen('lobby-screen');
}

function showScreen(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}
