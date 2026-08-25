// --- ÉTAT GLOBAL ---
let currentUser = { name: "", color: "#ff4757", role: "hider" };
let roomCode = null;
let roomRef = null;
let map = null, userMarker = null, seekerCircleLayer = null;
let currentPosition = null;
let outOfZoneStartTime = null;

// Naviguer entre les écrans
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'app-container' && map) {
    setTimeout(() => map.invalidateSize(), 200);
  }
}

// --- ÉCRAN 1 : FORMULAIRE & LOGIQUE DE SALON ---
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    currentUser.color = e.target.dataset.color;
  });
});

document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    currentUser.role = e.target.dataset.role;
  });
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  currentUser.name = document.getElementById('player-name-input').value || "Joueur 1";
  roomCode = Math.floor(1000 + Math.random() * 9000).toString();
  roomRef = db.ref('rooms/' + roomCode);

  const hideDuration = parseInt(document.getElementById('hide-time-input').value) || 5;

  roomRef.set({
    state: 'waiting',
    hideDuration: hideDuration,
    circleRadius: 400,
    players: {
      [currentUser.role]: { name: currentUser.name, color: currentUser.color, ready: false, score: 0 }
    }
  });

  initWaitingRoom();
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  currentUser.name = document.getElementById('player-name-input').value || "Joueur 2";
  roomCode = document.getElementById('room-code-input').value;
  if (!roomCode) return alert("Entrez un code !");
  roomRef = db.ref('rooms/' + roomCode);

  roomRef.once('value', snapshot => {
    if (!snapshot.exists()) return alert("Salon introuvable.");
    const data = snapshot.val();

    if (data.players && data.players[currentUser.role]) {
      currentUser.role = currentUser.role === 'hider' ? 'seeker' : 'hider';
    }

    roomRef.child('players/' + currentUser.role).set({
      name: currentUser.name,
      color: currentUser.color,
      ready: false,
      score: 0
    });

    initWaitingRoom();
  });
});

// --- ÉCRAN 2 : SALLE D'ATTENTE ---
function initWaitingRoom() {
  document.getElementById('waiting-room-code').innerText = roomCode;
  showScreen('waiting-room-screen');

  roomRef.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;

    const list = document.getElementById('players-status-list');
    list.innerHTML = '';
    if (data.players) {
      Object.keys(data.players).forEach(role => {
        const p = data.players[role];
        list.innerHTML += `<p><strong>${p.name}</strong> (${role === 'hider' ? 'Caché' : 'Chercheur'}) : ${p.ready ? '✅ Prêt' : '⏳ En attente'}</p>`;
      });
    }

    if (data.state === 'playing' && !map) {
      startGame(data);
    }
  });
}

document.getElementById('btn-ready').addEventListener('click', () => {
  roomRef.child(`players/${currentUser.role}/ready`).set(true);
  roomRef.child('players').once('value', snapshot => {
    const players = snapshot.val();
    if (players.hider && players.hider.ready && players.seeker && players.seeker.ready) {
      roomRef.update({
        state: 'playing',
        startTime: Date.now(),
        phase: 'hide'
      });
    }
  });
});

// --- ÉCRAN 3 : CARTE, LOGIQUE GEOLOCALISATION ET ZONES ---
function initMap() {
  map = L.map('map').setView([0, 0], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  navigator.geolocation.watchPosition(
    pos => {
      currentPosition = [pos.coords.latitude, pos.coords.longitude];

      if (!userMarker) {
        userMarker = L.circleMarker(currentPosition, { color: currentUser.color, radius: 8, fillOpacity: 1 }).addTo(map);
        map.setView(currentPosition, 16);
      } else {
        userMarker.setLatLng(currentPosition);
      }

      // Exigence 1 : Inversion et isolation des données Firebase (pas d'écrasement)
      if (roomRef) {
        roomRef.child(`positions/${currentUser.role}`).set({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      }

      verifyZoneStatus();
    },
    err => console.error("Erreur GPS :", err),
    { enableHighAccuracy: true }
  );
}

function startGame(roomData) {
  showScreen('app-container');
  initMap();

  if (currentUser.role === 'seeker') {
    document.getElementById('seeker-challenge-form').style.display = 'block';
    document.getElementById('btn-found-seeker').style.display = 'block';
  } else {
    document.getElementById('hider-challenge-form').style.display = 'block';
    document.getElementById('btn-confirm-hider').style.display = 'block';
  }

  roomRef.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;

    handleTimersAndPhases(data);
    handleMapLayers(data);
    handleChallengesUI(data);

    if (data.foundAlert && currentUser.role === 'hider') {
      alert("Le chercheur indique vous avoir trouvé ! Confirmez si c'est le cas.");
    }

    if (data.state === 'review') {
      showReviewScreen(data);
    }
    if (data.state === 'podium') {
      showPodiumScreen(data);
    }
  });
}

// Exigence 2 : Nettoyage strict du calque cercle pour le rôle 'hider'
function handleMapLayers(data) {
  if (currentUser.role === 'hider') {
    if (seekerCircleLayer) {
      map.removeLayer(seekerCircleLayer);
      seekerCircleLayer = null;
    }
    return;
  }

  // Si chercheur (seeker) : affichage du cercle dynamique sur le chercheur
  if (currentUser.role === 'seeker' && data.positions && data.positions.seeker) {
    const center = [data.positions.seeker.lat, data.positions.seeker.lng];
    if (!seekerCircleLayer) {
      seekerCircleLayer = L.circle(center, {
        radius: data.circleRadius || 400,
        color: '#ff4757',
        fillOpacity: 0.15
      }).addTo(map);
    } else {
      seekerCircleLayer.setLatLng(center);
      seekerCircleLayer.setRadius(data.circleRadius || 400);
    }
  }
}

// Gestion des phases, réduction du cercle & calculs du temps
function handleTimersAndPhases(data) {
  const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
  const hideTimeSec = (data.hideDuration || 5) * 60;

  if (elapsed < hideTimeSec) {
    // Phase 1 : Cachette
    const remaining = hideTimeSec - elapsed;
    document.getElementById('timer-display').innerText = formatTime(remaining);
    document.getElementById('status-text').innerText = "Phase de Cachette";
  } else {
    // Phase 2 : Chasse
    if (data.phase === 'hide') {
      roomRef.update({ phase: 'hunt' });
    }

    const huntElapsed = elapsed - hideTimeSec;
    document.getElementById('timer-display').innerText = formatTime(huntElapsed);
    document.getElementById('status-text').innerText = "Traque en cours !";

    // Réduction automatique du rayon ($50\text{ m}$ toutes les 5 min, min $50\text{ m}$)
    const intervals = Math.floor(huntElapsed / 300);
    const newRadius = Math.max(50, 400 - (intervals * 50));
    if (data.circleRadius !== newRadius) {
      roomRef.update({ circleRadius: newRadius });
    }
  }
}

// Exigence 3 & 4 : Hors-zone, Clignotement Orange & Plafond du Rayon
function verifyZoneStatus() {
  if (!currentPosition || currentUser.role !== 'hider' || !roomRef) return;

  roomRef.once('value', snapshot => {
    const data = snapshot.val();
    if (!data || !data.positions || !data.positions.seeker) return;

    const seekerPos = L.latLng(data.positions.seeker.lat, data.positions.seeker.lng);
    const hiderPos = L.latLng(currentPosition[0], currentPosition[1]);
    const distance = seekerPos.distanceTo(hiderPos);

    const appElem = document.getElementById('app-container');

    if (distance > data.circleRadius) {
      // Entrée Hors-Zone
      appElem.classList.add('screen-warning-blink');
      document.getElementById('status-text').innerText = "⚠️ VOUS ÊTES HORS-ZONE !";

      if (!outOfZoneStartTime) outOfZoneStartTime = Date.now();

      // Règle des 5 min hors-zone
      if (Date.now() - outOfZoneStartTime > 300000) {
        if (data.circleRadius < 400) {
          // Agrandissement (+50m) sous plafond strict de 400m
          const expanded = Math.min(400, data.circleRadius + 50);
          roomRef.update({ circleRadius: expanded });
          outOfZoneStartTime = Date.now();
        } else {
          // Plafond de 400m atteint : message strict sans décompte
          document.getElementById('status-text').innerText = "⚠️ REJOIGNEZ LA ZONE IMMÉDIATEMENT !";
        }
      }
    } else {
      // Réintégration de la Zone
      appElem.classList.remove('screen-warning-blink');
      outOfZoneStartTime = null;
    }
  });
}

// --- DÉFIS PHOTO & BOUTONS D'ACTION ---
document.getElementById('btn-send-challenge').addEventListener('click', () => {
  const text = document.getElementById('custom-challenge-text').value;
  const pts = parseInt(document.getElementById('custom-challenge-pts').value) || 10;
  if (!text) return;

  roomRef.child('activeChallenge').set({ text, pts, status: 'pending' });
  document.getElementById('custom-challenge-text').value = '';
});

function handleChallengesUI(data) {
  if (!data.activeChallenge) return;

  if (currentUser.role === 'hider') {
    const ch = data.activeChallenge;
    if (ch.status === 'pending') {
      document.getElementById('hider-challenge-desc').innerText = `Défi (${ch.pts} pts): ${ch.text}`;
    } else {
      document.getElementById('hider-challenge-desc').innerText = "Défi soumis ! En attente du chercheur.";
    }
  }
}

document.getElementById('btn-trigger-photo').addEventListener('click', () => {
  document.getElementById('challenge-photo-input').click();
});

document.getElementById('challenge-photo-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const base64Photo = evt.target.result;
    roomRef.child('challenges').push({
      photo: base64Photo,
      status: 'pending'
    });
    roomRef.child('activeChallenge/status').set('completed');
  };
  reader.readAsDataURL(file);
});

document.getElementById('btn-found-seeker').addEventListener('click', () => {
  roomRef.update({ foundAlert: true });
});

document.getElementById('btn-confirm-hider').addEventListener('click', () => {
  roomRef.update({ state: 'review', endTime: Date.now() });
});

// --- ÉCRAN 4 : RÉVISION DES DÉFIS ---
function showReviewScreen(data) {
  showScreen('review-screen');
  const container = document.getElementById('photos-review-list');
  container.innerHTML = '';

  if (!data.challenges) {
    container.innerHTML = '<p style="text-align:center;">Aucun défi réalisé.</p>';
    return;
  }

  Object.keys(data.challenges).forEach(key => {
    const item = data.challenges[key];
    const isSeeker = currentUser.role === 'seeker';

    container.innerHTML += `
      <div class="photo-card">
        <img src="${item.photo}" alt="Preuve photo" />
        ${isSeeker && item.status === 'pending' ? `
          <button class="btn btn-success" onclick="validatePhoto('${key}', true)">✅ Valider</button>
          <button class="btn" style="background:#e74c3c" onclick="validatePhoto('${key}', false)">❌ Rejeter</button>
        ` : `<p>Statut : ${item.status}</p>`}
      </div>
    `;
  });
}

function validatePhoto(challengeKey, isValid) {
  if (isValid) {
    roomRef.child('players/hider/score').transaction(sc => (sc || 0) + 50);
  }
  roomRef.child(`challenges/${challengeKey}/status`).set(isValid ? 'validated' : 'rejected');
}

document.getElementById('btn-finish-review').addEventListener('click', () => {
  roomRef.update({ state: 'podium' });
});

// --- ÉCRAN 5 : PODIUM & RESTART ---
function showPodiumScreen(data) {
  showScreen('podium-screen');
  const display = document.getElementById('podium-display');

  const survivalSec = Math.floor(((data.endTime || Date.now()) - data.startTime) / 1000);
  const hiderScore = (data.players && data.players.hider) ? data.players.hider.score : 0;

  display.innerHTML = `
    <p style="font-size: 1.5rem; color: var(--secondary);">⏱️ Temps de survie : <strong>${formatTime(survivalSec)}</strong></p>
    <br>
    <p>Points défis accumulés : <strong>${hiderScore} pts</strong></p>
  `;
}

document.getElementById('btn-swap-roles').addEventListener('click', () => {
  currentUser.role = currentUser.role === 'hider' ? 'seeker' : 'hider';
  location.reload();
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  location.reload();
});

// Utilitaire de formatage mm:ss
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

document.getElementById('btn-recenter').addEventListener('click', () => {
  if (currentPosition && map) map.setView(currentPosition, 17);
});
