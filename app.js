import {
  db,
  storage,
  connectFirebase
} from "./firebase-config.js";

import {
  ref,
  set,
  update,
  get,
  onValue,
  onDisconnect,
  push,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";


/* ========================================================= */
/* ÉTAT GLOBAL */
/* ========================================================= */

const state = {

  uid: null,

  roomCode: null,

  role: null,

  nickname: null,

  color: "#2563eb",

  room: null,

  map: null,

  marker: null,

  circle: null,

  watchId: null,

  position: null,

  roomListener: null,

  challengeListener: null,

  clock: null,

  outSince: null,

  wasOutOfZone: false

};


/* ========================================================= */
/* OUTILS */
/* ========================================================= */

const $ = id => document.getElementById(id);


function showScreen(id) {

  document
    .querySelectorAll(".screen")
    .forEach(screen => {
      screen.classList.remove("active");
    });

  $(id).classList.add("active");

}


function showError(message) {

  const element = $("errorMessage");

  element.textContent = message;

  element.classList.remove("hidden");

  setTimeout(() => {
    element.classList.add("hidden");
  }, 6000);

}


function formatTime(milliseconds) {

  let seconds =
    Math.max(0, Math.floor(milliseconds / 1000));

  const hours =
    Math.floor(seconds / 3600);

  seconds %= 3600;

  const minutes =
    Math.floor(seconds / 60);

  seconds %= 60;

  if (hours > 0) {

    return (
      String(hours).padStart(2, "0") +
      ":" +
      String(minutes).padStart(2, "0") +
      ":" +
      String(seconds).padStart(2, "0")
    );

  }

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );

}


function randomRoomCode() {

  return Math
    .random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

}


function escapeHTML(value) {

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


function distanceMeters(a, b) {

  const earthRadius = 6371000;

  const lat1 =
    a.lat * Math.PI / 180;

  const lat2 =
    b.lat * Math.PI / 180;

  const dLat =
    (b.lat - a.lat) *
    Math.PI / 180;

  const dLng =
    (b.lng - a.lng) *
    Math.PI / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  return (
    2 *
    earthRadius *
    Math.asin(Math.sqrt(x))
  );

}


/* ========================================================= */
/* FIREBASE */
/* ========================================================= */

async function initializeFirebase() {

  const user =
    await connectFirebase();

  state.uid =
    user.uid;

}


/* ========================================================= */
/* CRÉATION PARTIE */
/* ========================================================= */

async function createRoom() {

  try {

    validateHome();

    await initializeFirebase();

    const roomCode =
      randomRoomCode();

    const hideMinutes =
      Number($("hideTime").value);

    const roomData = {

      status: "lobby",

      phase: "lobby",

      createdAt: Date.now(),

      hostUid: state.uid,

      settings: {

        hideMinutes

      },

      players: {

        [state.role]: {

          uid: state.uid,

          nickname: state.nickname,

          color: state.color,

          ready: false,

          online: true,

          score: 0,

          position: null

        }

      },

      game: {

        hideEndAt: null,

        huntStartedAt: null,

        survivalMs: null,

        circle: {

          center: null,

          radius: 300

        },

        capture: {

          declaredBy: null,

          declaredAt: null,

          confirmed: false

        }

      },

      challenges: {}

    };


    await set(
      ref(db, `rooms/${roomCode}`),
      roomData
    );


    await onDisconnect(
      ref(
        db,
        `rooms/${roomCode}/players/${state.role}/online`
      )
    ).set(false);


    state.roomCode =
      roomCode;

    subscribeRoom();

    showScreen("lobby");

  }

  catch (error) {

    console.error(error);

    showError(error.message);

  }

}


/* ========================================================= */
/* REJOINDRE */
/* ========================================================= */

async function joinRoom() {

  try {

    validateHome();

    await initializeFirebase();

    const roomCode =
      $("roomCode")
        .value
        .trim()
        .toUpperCase();


    if (!roomCode) {

      throw new Error(
        "Entre le code de la partie."
      );

    }


    const snapshot =
      await get(
        ref(db, `rooms/${roomCode}`)
      );


    if (!snapshot.exists()) {

      throw new Error(
        "Cette partie n'existe pas."
      );

    }


    const room =
      snapshot.val();


    if (room.phase !== "lobby") {

      throw new Error(
        "Cette partie a déjà commencé."
      );

    }


    if (room.players?.[state.role]) {

      throw new Error(
        "Ce rôle est déjà pris."
      );

    }


    await update(
      ref(db, `rooms/${roomCode}`),
      {

        [`players/${state.role}`]: {

          uid: state.uid,

          nickname: state.nickname,

          color: state.color,

          ready: false,

          online: true,

          score: 0,

          position: null

        }

      }
    );


    await onDisconnect(
      ref(
        db,
        `rooms/${roomCode}/players/${state.role}/online`
      )
    ).set(false);


    state.roomCode =
      roomCode;

    subscribeRoom();

    showScreen("lobby");

  }

  catch (error) {

    console.error(error);

    showError(error.message);

  }

}


/* ========================================================= */
/* VALIDATION ACCUEIL */
/* ========================================================= */

function validateHome() {

  const nickname =
    $("nickname")
      .value
      .trim();


  if (!nickname) {

    throw new Error(
      "Choisis un pseudonyme."
    );

  }


  if (!navigator.geolocation) {

    throw new Error(
      "La géolocalisation n'est pas disponible."
    );

  }


  state.nickname =
    nickname;

  state.role =
    $("role").value;

  state.color =
    $("markerColor").value;

}


/* ========================================================= */
/* ÉCOUTE SALON */
/* ========================================================= */

function subscribeRoom() {

  if (state.roomListener) {

    state.roomListener();

  }


  state.roomListener =
    onValue(
      ref(db, `rooms/${state.roomCode}`),
      snapshot => {

        if (!snapshot.exists()) {

          goHome();

          return;

        }


        state.room =
          snapshot.val();


        renderLobby();

        handlePhase();

      }
    );

}


/* ========================================================= */
/* LOBBY */
/* ========================================================= */

function renderLobby() {

  if (!state.room) return;


  $("displayRoomCode")
    .textContent =
    state.roomCode;


  const chat =
    state.room.players?.chat;

  const mouse =
    state.room.players?.mouse;


  $("chatPlayerName")
    .textContent =
    chat?.nickname ||
    "En attente...";


  $("mousePlayerName")
    .textContent =
    mouse?.nickname ||
    "En attente...";


  $("chatReady")
    .textContent =
    chat?.ready
      ? "✓ Prêt"
      : "En attente";


  $("mouseReady")
    .textContent =
    mouse?.ready
      ? "✓ Prêt"
      : "En attente";


  const me =
    state.room.players?.[state.role];


  $("readyButton")
    .textContent =
    me?.ready
      ? "❌ Je ne suis plus prêt"
      : "✅ Je suis prêt";

}


/* ========================================================= */
/* READY */
/* ========================================================= */

async function toggleReady() {

  if (!state.room) return;


  const me =
    state.room.players?.[state.role];


  if (!me) return;


  await update(
    ref(
      db,
      `rooms/${state.roomCode}/players/${state.role}`
    ),
    {
      ready: !me.ready
    }
  );


  const snapshot =
    await get(
      ref(db, `rooms/${state.roomCode}`)
    );


  const room =
    snapshot.val();


  const bothReady =
    room.players?.chat?.ready &&
    room.players?.mouse?.ready;


  if (
    bothReady &&
    room.phase === "lobby"
  ) {

    const hideMinutes =
      Number(room.settings.hideMinutes);


    const hideEnd =
      Date.now() +
      hideMinutes * 60 * 1000;


    await update(
      ref(db, `rooms/${state.roomCode}`),
      {

        phase: "hide",

        status: "playing",

        "game/hideEndAt":
          hideEnd,

        "game/huntStartedAt":
          null,

        "game/circle/center":
          null,

        "game/circle/radius":
          300

      }
    );

  }

}


/* ========================================================= */
/* PHASE */
/* ========================================================= */

function handlePhase() {

  if (!state.room) return;


  const phase =
    state.room.phase;


  if (
    phase === "hide" ||
    phase === "hunt" ||
    phase === "review"
  ) {

    startGame();

  }


  if (
    phase === "finished"
  ) {

    renderResult();

  }

}


/* ========================================================= */
/* INITIALISATION CARTE */
/* ========================================================= */

function startGame() {

  showScreen("game");


  $("gameRoomCode")
    .textContent =
    state.roomCode;


  $("roleBadge")
    .textContent =
    state.role === "chat"
      ? "🐱 CHAT"
      : "🐭 SOURIS";


  if (!state.map) {

    state.map =
      L.map("map", {
        zoomControl: true
      });


    state.map.setView(
      [48.7, 2.45],
      15
    );


    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,

        attribution:
          "© OpenStreetMap contributors"
      }
    ).addTo(state.map);

  }


  startGPS();

  subscribeChallenges();

  updateMap();

  startClock();

}


/* ========================================================= */
/* GPS */
/* ========================================================= */

function startGPS() {

  if (state.watchId !== null) {
    return;
  }


  state.watchId =
    navigator.geolocation.watchPosition(

      position => {

        state.position = {

          lat:
            position.coords.latitude,

          lng:
            position.coords.longitude,

          accuracy:
            position.coords.accuracy

        };


        updateMarker();


        const path =
          `rooms/${state.roomCode}/players/${state.role}/position`;


        update(
          ref(db, path),
          state.position
        );


        checkZone();

      },


      error => {

        console.error(
          "Erreur GPS:",
          error
        );

      },

      {

        enableHighAccuracy: true,

        maximumAge: 2000,

        timeout: 15000

      }

    );

}


/* ========================================================= */
/* MARQUEUR */
/* ========================================================= */

function updateMarker() {

  if (
    !state.position ||
    !state.map
  ) {

    return;

  }


  const icon =
    L.divIcon({

      className: "",

      html:
        `<div
          class="player-marker"
          style="background:${state.color}"
        ></div>`,

      iconSize: [28, 28],

      iconAnchor: [14, 28]

    });


  if (!state.marker) {

    state.marker =
      L.marker(
        [
          state.position.lat,
          state.position.lng
        ],
        { icon }
      )
      .addTo(state.map);

  }

  else {

    state.marker.setLatLng([
      state.position.lat,
      state.position.lng
    ]);

  }

}


/* ========================================================= */
/* CARTE SELON PHASE */
/* ========================================================= */

function updateMap() {

  const phase =
    state.room?.phase;


  $("hideOverlay")
    .classList.toggle(
      "hidden",
      phase !== "hide"
    );


  if (phase === "hide") {

    $("phaseText")
      .textContent =
      "CACHE-TTE";


    if (state.role === "chat") {

      if (state.marker) {

        state.map.removeLayer(
          state.marker
        );

        state.marker = null;

      }


      if (state.circle) {

        state.map.removeLayer(
          state.circle
        );

        state.circle = null;

      }

    }

  }


  if (phase === "hunt") {

    $("phaseText")
      .textContent =
      "CHASSE";


    if (state.role === "chat") {

      updateCircle();

    }

  }


  if (phase === "review") {

    $("phaseText")
      .textContent =
      "RÉVISION";

  }

}


/* ========================================================= */
/* CERCLE CHAT */
/* ========================================================= */

function updateCircle() {

  if (
    state.role !== "chat" ||
    state.room?.phase !== "hunt"
  ) {

    return;

  }


  const circle =
    state.room.game?.circle;


  if (
    !circle?.center
  ) {

    return;

  }


  if (!state.circle) {

    state.circle =
      L.circle(

        [
          circle.center.lat,
          circle.center.lng
        ],

        {

          radius:
            circle.radius,

          color:
            "#ef4444",

          fillOpacity:
            0.12,

          weight:
            4

        }

      ).addTo(state.map);

  }

  else {

    state.circle
      .setLatLng([
        circle.center.lat,
        circle.center.lng
      ])
      .setRadius(
        circle.radius
      );

  }

}


/* ========================================================= */
/* DÉBUT CHASSE */
/* ========================================================= */

async function startHunt() {

  const snapshot =
    await get(
      ref(db, `rooms/${state.roomCode}`)
    );


  const room =
    snapshot.val();


  if (room.phase !== "hide") {
    return;
  }


  const mousePosition =
    room.players?.mouse?.position;


  const center =
    mousePosition
      ? {
          lat:
            mousePosition.lat,

          lng:
            mousePosition.lng
        }
      : null;


  const time =
    Date.now();


  await update(
    ref(db, `rooms/${state.roomCode}`),
    {

      phase: "hunt",

      "game/huntStartedAt":
        time,

      "game/circle/center":
        center,

      "game/circle/radius":
        300

    }
  );

}


/* ========================================================= */
/* HORLOGE */
/* ========================================================= */

function startClock() {

  if (state.clock) {
    return;
  }


  state.clock =
    setInterval(() => {

      if (!state.room) {
        return;
      }


      if (
        state.room.phase === "hide"
      ) {

        const end =
          Number(
            state.room.game?.hideEndAt
          );


        const remaining =
          Math.max(
            0,
            end - Date.now()
          );


        $("hideTimer")
          .textContent =
          formatTime(
            remaining
          );


        $("mainTimer")
          .textContent =
          formatTime(
            remaining
          );


        if (
          remaining <= 0
        ) {

          startHunt();

        }

      }


      if (
        state.room.phase === "hunt"
      ) {

        const start =
          Number(
            state.room.game?.huntStartedAt
          );


        const elapsed =
          Date.now() - start;


        $("mainTimer")
          .textContent =
          formatTime(
            elapsed
          );


        updateCircle();

        checkZone();

      }

    }, 500);

}


/* ========================================================= */
/* HORS-ZONE */
/* ========================================================= */

async function checkZone() {

  if (
    state.role !== "chat" ||
    state.room?.phase !== "hunt" ||
    !state.position
  ) {

    return;

  }


  const circle =
    state.room.game?.circle;


  if (!circle?.center) {
    return;
  }


  const distance =
    distanceMeters(
      state.position,
      circle.center
    );


  /*
   * Le Chat est hors-zone
   * lorsqu'il se trouve à plus
   * de 400 m du centre.
   */

  const out =
    distance > 400;


  $("zoneWarning")
    .classList.toggle(
      "hidden",
      !out
    );


  document.body
    .classList.toggle(
      "out-of-zone",
      out
    );


  if (
    out &&
    !state.wasOutOfZone
  ) {

    state.wasOutOfZone =
      true;

    state.outSince =
      Date.now();

  }


  if (!out) {

    state.wasOutOfZone =
      false;

    state.outSince =
      null;

  }


  /*
   * Agrandissement après
   * 5 minutes hors-zone.
   */

  if (
    out &&
    state.outSince &&
    circle.radius < 400 &&
    Date.now() -
      state.outSince >=
      5 * 60 * 1000
  ) {

    const newRadius =
      Math.min(
        400,
        circle.radius + 50
      );


    await update(
      ref(
        db,
        `rooms/${state.roomCode}/game/circle`
      ),
      {
        radius:
          newRadius
      }
    );


    state.outSince =
      Date.now();

  }

}


/* ========================================================= */
/* DÉFIS */
/* ========================================================= */

function subscribeChallenges() {

  if (state.challengeListener) {

    state.challengeListener();

  }


  state.challengeListener =
    onValue(
      ref(
        db,
        `rooms/${state.roomCode}/challenges`
      ),

      snapshot => {

        renderChallenges(
          snapshot.val() || {}
        );

      }

    );

}


function renderChallenges(
  challenges
) {

  const entries =
    Object.entries(
      challenges
    );


  const active =
    entries.filter(
      ([, challenge]) =>
        !challenge.status &&
        challenge.expiresAt >
        Date.now()
    );


  if (
    state.role === "mouse"
  ) {

    const unseen =
      active.filter(
        ([, challenge]) =>
          challenge.seenByMouse !== true
      ).length;


    $("challengeBadge")
      .textContent =
      unseen;


    $("challengeBadge")
      .classList.toggle(
        "hidden",
        unseen === 0
      );

  }


  $("challengeList")
    .innerHTML =
    entries.length === 0

      ? "<p>Aucun défi.</p>"

      : entries
        .sort(
          (a, b) =>
            (b[1].createdAt || 0) -
            (a[1].createdAt || 0)
        )
        .map(
          ([id, challenge]) =>
            renderChallenge(
              id,
              challenge
            )
        )
        .join("");

}


/* ========================================================= */
/* AFFICHAGE DÉFI */
/* ========================================================= */

function renderChallenge(
  id,
  challenge
) {

  const expired =
    challenge.expiresAt <=
    Date.now();


  let buttons = "";


  if (
    state.role === "mouse" &&
    !expired &&
    !challenge.proofUrl
  ) {

    buttons = `
      <div class="challenge-actions">

        <button
          onclick="window.sendProof('${id}')"
        >
          📷 Envoyer une preuve
        </button>

      </div>
    `;

  }


  if (
    state.role === "chat" &&
    challenge.proofUrl &&
    !challenge.status
  ) {

    buttons = `
      <div class="challenge-actions">

        <button
          onclick="window.reviewChallenge('${id}', 'validated')"
        >
          ✅ Valider
        </button>

        <button
          onclick="window.reviewChallenge('${id}', 'refused')"
        >
          ❌ Refuser
        </button>

      </div>
    `;

  }


  const status =
    challenge.status === "validated"
      ? "✅ Validé"

      : challenge.status === "refused"
        ? "❌ Refusé"

        : expired
          ? "⌛ Expiré"

          : "⏳ En cours";


  return `

    <div class="challenge-item">

      <h4>
        ${escapeHTML(
          challenge.text
        )}
      </h4>

      <div class="challenge-meta">

        +${Number(
          challenge.points
        )} points

        ·

        ${status}

      </div>

      ${buttons}

    </div>

  `;

}


/* ========================================================= */
/* CRÉER DÉFI */
/* ========================================================= */

async function createChallenge() {

  if (
    state.role !== "chat"
  ) {

    return;

  }


  const text =
    $("challengeText")
      .value
      .trim();


  const points =
    Number(
      $("challengePoints")
        .value
    );


  if (!text) {

    alert(
      "Écris le défi."
    );

    return;

  }


  if (
    !Number.isFinite(points) ||
    points < 1
  ) {

    alert(
      "Nombre de points invalide."
    );

    return;

  }


  const challengeRef =
    push(
      ref(
        db,
        `rooms/${state.roomCode}/challenges`
      )
    );


  const createdAt =
    Date.now();


  await set(
    challengeRef,
    {

      text,

      points,

      createdAt,

      expiresAt:
        createdAt +
        10 * 60 * 1000,

      createdBy:
        state.uid,

      status:
        null,

      proofUrl:
        null,

      seenByMouse:
        false

    }
  );


  $("challengeText")
    .value = "";

}


/* ========================================================= */
/* PREUVE PHOTO */
/* ========================================================= */

window.sendProof =
async function (
  challengeId
) {

  const input =
    document.createElement(
      "input"
    );


  input.type =
    "file";

  input.accept =
    "image/*";

  input.capture =
    "environment";


  input.onchange =
  async () => {

    const file =
      input.files?.[0];


    if (!file) {
      return;
    }


    if (
      file.size >
      8 * 1024 * 1024
    ) {

      alert(
        "La photo doit faire moins de 8 Mo."
      );

      return;

    }


    try {

      const path =
        `rooms/${state.roomCode}/proofs/${challengeId}/${state.uid}_${Date.now()}`;


      const fileRef =
        storageRef(
          storage,
          path
        );


      await uploadBytes(
        fileRef,
        file,
        {
          contentType:
            file.type
        }
      );


      const url =
        await getDownloadURL(
          fileRef
        );


      await update(
        ref(
          db,
          `rooms/${state.roomCode}/challenges/${challengeId}`
        ),
        {

          proofUrl:
            url,

          proofAt:
            Date.now(),

          proofBy:
            state.uid,

          seenByMouse:
            true

        }
      );


      alert(
        "Preuve envoyée !"
      );

    }

    catch (error) {

      console.error(
        error
      );

      alert(
        "Erreur lors de l'envoi."
      );

    }

  };


  input.click();

};


/* ========================================================= */
/* VALIDATION DÉFI */
/* ========================================================= */

window.reviewChallenge =
async function (
  challengeId,
  status
) {

  if (
    state.role !== "chat"
  ) {

    return;

  }


  const challenge =
    state.room?.challenges?.[
      challengeId
    ];


  if (!challenge) {
    return;
  }


  if (
    status === "validated"
  ) {

    await runTransaction(
      ref(
        db,
        `rooms/${state.roomCode}/players/mouse/score`
      ),

      score => {

        return (
          Number(score) || 0
        ) +
        Number(
          challenge.points
        );

      }

    );

  }


  await update(
    ref(
      db,
      `rooms/${state.roomCode}/challenges/${challengeId}`
    ),
    {

      status,

      reviewedBy:
        state.uid,

      reviewedAt:
        Date.now()

    }
  );

};


/* ========================================================= */
/* CAPTURE */
/* ========================================================= */

async function declareCapture() {

  if (
    state.role !== "chat" ||
    state.room?.phase !== "hunt"
  ) {

    return;

  }


  const survival =
    Date.now() -
    Number(
      state.room.game.huntStartedAt
    );


  await update(
    ref(db, `rooms/${state.roomCode}`),
    {

      "game/capture/declaredBy":
        state.uid,

      "game/capture/declaredAt":
        Date.now(),

      "game/survivalMs":
        survival

    }
  );


  renderCapture();

}


async function confirmCapture() {

  if (
    state.role !== "mouse"
  ) {

    return;

  }


  await update(
    ref(db, `rooms/${state.roomCode}`),
    {

      "game/capture/confirmed":
        true,

      phase:
        "review"

    }
  );

}


function renderCapture() {

  const capture =
    state.room?.game?.capture;


  if (
    state.role === "chat"
  ) {

    if (
      capture?.declaredBy
    ) {

      $("captureContent")
        .innerHTML = `

          <p>
            📍 Capture déclarée.
          </p>

          <p>
            En attente de la confirmation
            de la Souris.
          </p>

        `;

    }

    else {

      $("captureContent")
        .innerHTML = `

          <p>
            Tu as trouvé la Souris ?
          </p>

          <button
            id="declareCaptureButton"
            class="main-button"
          >
            🐱 J'ai trouvé la Souris
          </button>

        `;


      $("declareCaptureButton")
        .onclick =
        declareCapture;

    }

  }

  else {

    if (
      capture?.declaredBy
    ) {

      $("captureContent")
        .innerHTML = `

          <p>
            🐱 Le Chat déclare
            t'avoir trouvé.
          </p>

          <button
            id="confirmCaptureButton"
            class="main-button"
          >
            🐭 Confirmer la capture
          </button>

        `;


      $("confirmCaptureButton")
        .onclick =
        confirmCapture;

    }

    else {

      $("captureContent")
        .innerHTML = `

          <p>
            La capture apparaîtra ici
            lorsque le Chat la déclarera.
          </p>

        `;

    }

  }

}


/* ========================================================= */
/* RÉVISION */
/* ========================================================= */

function renderReview() {

  const challenges =
    state.room?.challenges ||
    {};


  const proofs =
    Object.entries(
      challenges
    )
    .filter(
      ([, challenge]) =>
        challenge.proofUrl
    );


  $("reviewList")
    .innerHTML =
    proofs.length === 0

      ? "<p>Aucune preuve envoyée.</p>"

      : proofs
        .map(
          ([id, challenge]) => `

            <div class="review-item">

              <h4>
                ${escapeHTML(
                  challenge.text
                )}
              </h4>

              <img
                class="photo-preview"
                src="${escapeHTML(
                  challenge.proofUrl
                )}"
                alt="Preuve"
              >

              <p>
                +${challenge.points}
                points
              </p>

              ${
                state.role === "chat" &&
                !challenge.status

                  ? `

                    <div
                      class="challenge-actions"
                    >

                      <button
                        onclick="window.reviewChallenge('${id}', 'validated')"
                      >
                        ✅ Valider
                      </button>

                      <button
                        onclick="window.reviewChallenge('${id}', 'refused')"
                      >
                        ❌ Refuser
                      </button>

                    </div>

                  `

                  : ""

              }

            </div>

          `
        )
        .join("");


  $("reviewButton")
    .classList.toggle(
      "hidden",
      state.role !== "chat"
    );

}


/* ========================================================= */
/* TERMINER PARTIE */
/* ========================================================= */

async function finishGame() {

  if (
    state.role !== "chat"
  ) {

    return;

  }


  await update(
    ref(
      db,
      `rooms/${state.roomCode}`
    ),
    {

      phase:
        "finished",

      status:
        "finished",

      finishedAt:
        Date.now()

    }
  );

}


/* ========================================================= */
/* RÉSULTATS */
/* ========================================================= */

function renderResult() {

  showScreen(
    "resultScreen"
  );


  const room =
    state.room;


  const mouseScore =
    Number(
      room.players?.mouse?.score ||
      0
    );


  const chatScore =
    Number(
      room.players?.chat?.score ||
      0
    );


  const survival =
    Number(
      room.game?.survivalMs ||
      0
    );


  $("mouseScore")
    .textContent =
    mouseScore;


  $("chatScore")
    .textContent =
    chatScore;


  $("survivalTime")
    .textContent =
    formatTime(
      survival
    );


  if (
    mouseScore >
    chatScore
  ) {

    $("resultIcon")
      .textContent =
      "🐭";

    $("resultTitle")
      .textContent =
      "La Souris gagne !";

  }

  else if (
    chatScore >
    mouseScore
  ) {

    $("resultIcon")
      .textContent =
      "🐱";

    $("resultTitle")
      .textContent =
      "Le Chat gagne !";

  }

  else {

    $("resultIcon")
      .textContent =
      "🤝";

    $("resultTitle")
      .textContent =
      "Égalité !";

  }


  $("resultSubtitle")
    .textContent =
    `Temps de survie : ${formatTime(
      survival
    )}`;

}


/* ========================================================= */
/* PANNEAUX */
/* ========================================================= */

$("challengeButton")
  .onclick =
  () => {

    $("challengePanel")
      .classList
      .toggle("hidden");

  };


$("captureButton")
  .onclick =
  () => {

    renderCapture();

    $("capturePanel")
      .classList
      .toggle("hidden");

  };


$("reviewButton")
  .onclick =
  () => {

    renderReview();

    $("reviewPanel")
      .classList
      .toggle("hidden");

  };


document
  .querySelectorAll(
    "[data-close]"
  )
  .forEach(button => {

    button.onclick =
      () => {

        const panel =
          button.dataset.close;

        $(panel)
          .classList
          .add("hidden");

      };

  });


/* ========================================================= */
/* BOUTONS */
/* ========================================================= */

$("createRoomButton")
  .onclick =
  createRoom;


$("joinRoomButton")
  .onclick =
  joinRoom;


$("readyButton")
  .onclick =
  toggleReady;


$("sendChallengeButton")
  .onclick =
  createChallenge;


$("centerButton")
  .onclick =
  () => {

    if (
      state.position &&
      state.map
    ) {

      state.map.setView(
        [
          state.position.lat,
          state.position.lng
        ],
        17
      );

    }

  };


$("finishButton")
  .onclick =
  () => {

    if (
      state.role === "chat"
    ) {

      finishGame();

    }

    else {

      alert(
        "La fin de partie doit être confirmée par le Chat."
      );

    }

  };


$("leaveRoomButton")
  .onclick =
  goHome;


$("homeButton")
  .onclick =
  goHome;


/* ========================================================= */
/* NOUVELLE PARTIE */
/* ========================================================= */

$("rematchButton")
  .onclick =
  async () => {

    const newRole =
      state.role === "chat"
        ? "mouse"
        : "chat";


    const newCode =
      randomRoomCode();


    const hideMinutes =
      Number(
        state.room?.settings?.hideMinutes ||
        5
      );


    await set(
      ref(
        db,
        `rooms/${newCode}`
      ),
      {

        status:
          "lobby",

        phase:
          "lobby",

        createdAt:
          Date.now(),

        hostUid:
          state.uid,

        settings: {
          hideMinutes
        },

        players: {

          [newRole]: {

            uid:
              state.uid,

            nickname:
              state.nickname,

            color:
              state.color,

            ready:
              false,

            online:
              true,

            score:
              0,

            position:
              null

          }

        },

        game: {

          hideEndAt:
            null,

          huntStartedAt:
            null,

          survivalMs:
            null,

          circle: {

            center:
              null,

            radius:
              300

          },

          capture: {

            declaredBy:
              null,

            declaredAt:
              null,

            confirmed:
              false

          }

        },

        challenges:
          {}

      }
    );


    state.role =
      newRole;


    state.roomCode =
      newCode;


    subscribeRoom();

    showScreen(
      "lobbyScreen"
    );

  };


/* ========================================================= */
/* RETOUR ACCUEIL */
/* ========================================================= */

function goHome() {

  if (
    state.watchId !== null
  ) {

    navigator.geolocation
      .clearWatch(
        state.watchId
      );

    state.watchId =
      null;

  }


  if (
    state.roomListener
  ) {

    state.roomListener();

    state.roomListener =
      null;

  }


  if (
    state.challengeListener
  ) {

    state.challengeListener();

    state.challengeListener =
      null;

  }


  state.room =
    null;

  state.roomCode =
    null;

  state.marker =
    null;

  state.circle =
    null;


  document.body
    .classList
    .remove(
      "out-of-zone"
    );


  showScreen(
    "homeScreen"
  );

}


/* ========================================================= */
/* INITIALISATION */
/* ========================================================= */

console.log(
  "🐱 Chat & Souris chargé."
);
