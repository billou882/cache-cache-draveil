let currentUser = { name: "", color: "#ff4757", role: "hider" };
let roomCode = null;
let roomRef = null;
let map = null, userMarker = null, seekerCircleLayer = null;
let currentPosition = null;
let outOfZoneStartTime = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'app-container' && map) {
    setTimeout(() => map.invalidateSize(), 200);
  }
}

// --- ÉCRAN 1 : SALON ---
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
    circleCenter: null,
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
        list.innerHTML += `<p><strong>${p.name}</strong> (${role === 'hider' ? 'Souris' : 'Chat'}) : ${p.ready ? '✅ Prêt' : '⏳ En attente'}</p>`;
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

// --- ÉCRAN 3 : CARTE ET RÈGLES DE JEU ---
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

      if (roomRef) {
        roomRef.child(`positions/${currentUser.role}`).set({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });

        // La souris gère le glissement du cercle si elle sort
        if (currentUser.role === 'hider') {
          handleHiderCircleMovement(pos.coords.latitude, pos.coords.longitude);
        }
      }

      verifyZoneStatus();
    },
    err => console.error(err),
    { enableHighAccuracy: true }
  );
}

// Générer un centre aléatoire qui englobe la souris
function generateRandomCircleCenter(hiderLat, hiderLng, radiusMeters) {
  const radiusInDegrees = radiusMeters / 111320;
  const randomDist = Math.random() * (radiusInDegrees * 0.7); // 70% max du rayon pour ne pas coller au bord
  const randomAngle = Math.random() * 2 * Math.PI;

  const latOffset = randomDist * Math.cos(randomAngle);
  const lngOffset = randomDist * Math.sin(randomAngle);

  return {
    lat: hiderLat + latOffset,
    lng: hiderLng + lngOffset
  };
}

// Effet "Glissement" du cercle si la souris dépasse la bordure
function handleHiderCircleMovement(hiderLat, hiderLng) {
  roomRef.once('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;

    if (!data.circleCenter) {
      // Première initialisation du cercle autour de la souris
      const center = generateRandomCircleCenter(hiderLat, hiderLng, data.circleRadius || 400);
      roomRef.update({ circleCenter: center });
      return;
    }

    const centerLatLng = L.latLng(data.circleCenter.lat, data.circleCenter.lng);
    const hiderLatLng = L.latLng(hiderLat, hiderLng);
    const distance = centerLatLng.distanceTo(hiderLatLng);

    // Si la souris s'éloigne au-delà du rayon, le cercle glisse avec elle
    if (distance > data.circleRadius) {
      const bearing = Math.atan2(hiderLat - data.circleCenter.lat, hiderLng - data.circleCenter.lng);
      const moveDist = (distance - data.circleRadius) / 111320;

      const newCenter = {
        lat: data.circleCenter.lat + (moveDist * Math.sin(bearing)),
        lng: data.circleCenter.lng + (moveDist * Math.cos(bearing))
      };

      roomRef.update({ circleCenter: newCenter });
    }
  });
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
      alert("Le chercheur indique vous avoir trouvé ! Confirmez l'attrapé.");
    }
    if (data.state === 'review') showReviewScreen(data);
    if (data.state === 'podium') showPodiumScreen(data);
  });
}

// Effacement total du cercle pour la souris
function handleMapLayers(data) {
  // La souris (hider) NE VOIT AUCUN CERCLE
  if (currentUser.role === 'hider') {
    if (seekerCircleLayer) {
      map.removeLayer(seekerCircleLayer);
      seekerCircleLayer = null;
    }
    return;
  }

  // Le chercheur (seeker) voit sa carte et le cercle SEULEMENT en phase de chasse
  if (currentUser.role === 'seeker' && data.phase === 'hunt' && data.circleCenter) {
    const center = [data.circleCenter.lat, data.circleCenter.lng];
    if (!seekerCircleLayer) {
      seekerCircleLayer = L.circle(center, {
        radius: data.circleRadius || 300,
        color: '#ff4757',
        fillOpacity: 0.2
      }).addTo(map);
    } else {
      seekerCircleLayer.setLatLng(center);
      seekerCircleLayer.setRadius(data.circleRadius || 300);
    }
  }
}

// Horloges et logique de rétrécissement automatique
function handleTimersAndPhases(data) {
  const elapsed = Math.floor((Date.now() - data.startTime) / 1000);
  const hideTimeSec = (data.hideDuration || 5) * 60;

  if (elapsed < hideTimeSec) {
    // PHASE CACHETTE
    const remaining = hideTimeSec - elapsed;
    document.getElementById('timer-display').innerText = "Temps cachette : " + formatTime(remaining);
    document.getElementById('status-text').innerText = "Souris : Cachez-vous !";
    document.getElementById('shrink-timer').innerText = "Phase de traque imminente";

    if (currentUser.role === 'seeker') {
      document.getElementById('seeker-blind-overlay').style.display = 'flex';
      document.getElementById('blind-timer').innerText = formatTime(remaining);
    }
  } else {
    // PHASE CHASSE
    if (currentUser.role === 'seeker') {
      document.getElementById('seeker-blind-overlay').style.display = 'none';
    }

    if (data.phase === 'hide') {
      // Début de la traque : passage automatique à 300 m
      roomRef.update({ 
        phase: 'hunt',
        circleRadius: 300,
        huntStartTime: Date.now()
      });
    }

    const huntElapsed = elapsed - hideTimeSec;
    document.getElementById('timer-display').innerText = "Survie : " + formatTime(huntElapsed);
    document.getElementById('status-text').innerText = "Chasse en cours !";

    // Rétrécissement toutes les 5 min (300s)
    const shrinkInterval = 300;
    const nextShrinkSeconds = shrinkInterval - (huntElapsed % shrinkInterval);
    document.getElementById('shrink-timer').innerText = `Prochain rétrécissement (-50m) : ${formatTime(nextShrinkSeconds)}`;

    const currentStep = Math.floor(huntElapsed / shrinkInterval);
    const targetRadius = Math.max(50, 300 - (currentStep * 50));

    if (data.circleRadius !== targetRadius && targetRadius >= 50) {
      roomRef.update({ circleRadius: targetRadius });
    }
  }
}

// Vérification de zone et avertissements
function verifyZoneStatus() {
  if (!currentPosition || currentUser.role !== 'hider' || !roomRef) return;

  roomRef.once('value', snapshot => {
    const data = snapshot.val();
    if (!data || !data.circleCenter) return;

    const centerLatLng = L.latLng(data.circleCenter.lat, data.circleCenter.lng);
    const hiderLatLng = L.latLng(currentPosition[0], currentPosition[1]);
    const distance = centerLatLng.distanceTo(hiderLatLng);

    const appElem = document.getElementById('app-container');

    if (distance > data.circleRadius) {
      appElem.classList.add('screen-warning-blink');
      document.getElementById('status-text').innerText = "⚠️ VOUS ÊTES HORS-ZONE ! REJOIGNEZ LE PÉRIMÈTRE !";

      if (!outOfZoneStartTime) outOfZoneStartTime = Date.now();

      // Si le caché reste hors-zone + de 5 minutes : agrandissement de la zone (+50m, max 400m)
      if (Date.now() - outOfZoneStartTime > 300000) {
        if (data.circleRadius < 400) {
          const expanded = Math.min(400, data.circleRadius + 50);
          roomRef.update({ circleRadius: expanded });
          outOfZoneStartTime = Date.now();
        }
      }
    } else {
      appElem.classList.remove('screen-warning-blink');
      outOfZoneStartTime = null;
    }
  });
}

// --- DÉFIS PHOTO ET REVISION ---
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
      document.getElementById('hider-challenge-desc').innerText = "Défi envoyé ! En attente d'évaluation.";
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
    roomRef.child('challenges').push({
      photo: evt.target.result,
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
          <button class="btn btn-success" onclick="validatePhoto('${key}', true)">✅ Valider (+50 pts)</button>
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

function showPodiumScreen(data) {
  showScreen('podium-screen');
  const display = document.getElementById('podium-display');

  const survivalSec = Math.floor(((data.endTime || Date.now()) - data.startTime) / 1000);
  const hiderScore = (data.players && data.players.hider) ? data.players.hider.score : 0;

  display.innerHTML = `
    <p style="font-size: 1.5rem; color: var(--secondary);">⏱️ Temps de survie : <strong>${formatTime(survivalSec)}</strong></p>
    <br>
    <p>Score bonus défis : <strong>${hiderScore} pts</strong></p>
  `;
}

document.getElementById('btn-swap-roles').addEventListener('click', () => {
  currentUser.role = currentUser.role === 'hider' ? 'seeker' : 'hider';
  location.reload();
});

document.getElementById('btn-leave-room').addEventListener('click', () => {
  location.reload();
});

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

document.getElementById('btn-recenter').addEventListener('click', () => {
  if (currentPosition && map) map.setView(currentPosition, 17);
});
