import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, push,
  onDisconnect, runTransaction, remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBcxudeQK91giQA5kzSa6wnFZzJIgODjq8",
  authDomain: "cache-cache-draveil.firebaseapp.com",
  databaseURL: "https://cache-cache-draveil-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "cache-cache-draveil",
  storageBucket: "cache-cache-draveil.firebasestorage.app",
  messagingSenderId: "809078029731",
  appId: "1:809078029731:web:83e384a38ce01254016e16"
};

window.addEventListener('error', (e) => toast(`Erreur: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => toast(`Erreur Async: ${e.reason}`));

let app, db, storage;
try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  storage = getStorage(app);
} catch(e) {
  console.error("Erreur d'initialisation Firebase", e);
}

const CIRCLE_START = 300;
const CIRCLE_MIN = 50;
const CIRCLE_MAX = 500;
const CIRCLE_STEP = 50;
const TIME_5_MIN_MS = 5 * 60 * 1000; 
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const COLORS = ["#f5a623","#4fd1ae","#ff5470","#8fc6ff","#c792ea","#ffd166","#ff8fab","#7bd389"];

function uuid(){
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}

let uid;
try {
  uid = localStorage.getItem('ccd_uid');
  if (!uid){ uid = uuid(); localStorage.setItem('ccd_uid', uid); }
} catch(e) {
  uid = uuid();
}

let state = {
  roomCode: null,
  role: null,
  pseudo: '',
  color: COLORS[0],
  isHost: false,
  watchId: null,
  map: null,
  myMarker: null,
  circleLayer: null,
  lastSentPos: 0,
  lastPos: null,
  gameStarted: false,
  wakeLock: null
};

let roomData = {};
let fileInputEl = null;

function $(id){ return document.getElementById(id); }

function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(id);
  if (target) target.classList.add('active');
}

function toast(msg, ms=3000){
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { t.style.display='none'; }, ms);
}

function fmtMMSS(ms){
  if (ms < 0) ms = 0;
  const s = Math.floor(ms/1000);
  const m = Math.floor(s/60);
  const r = s%60;
  return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0');
}

function haversine(lat1,lng1,lat2,lng2){
  const R = 6371000;
  const toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function generateRandomOffsetCenter(centerLat, centerLng, radius) {
  const minOffset = radius * 0.3;
  const maxOffset = radius * 0.7;
  const dist = minOffset + Math.random() * (maxOffset - minOffset);
  const angle = Math.random() * 2 * Math.PI;
  const dLat = (dist * Math.cos(angle)) / 111111;
  const dLng = (dist * Math.sin(angle)) / (111111 * Math.cos(centerLat * Math.PI / 180));
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

function makeCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i=0;i<5;i++) c += chars[Math.floor(Math.random()*chars.length)];
  return c;
}

function escapeHtml(s){
  const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML;
}

async function requestWakeLock(){
  try {
    if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
  } catch(e){}
}

function saveSession() {
  localStorage.setItem('ccd_session', JSON.stringify({
    roomCode: state.roomCode,
    role: state.role,
    pseudo: state.pseudo,
    color: state.color
  }));
}

function clearSession() {
  localStorage.removeItem('ccd_session');
}

// RESTAURATION AUTOMATIQUE DE LA SESSION AU CHARGEMENT DE LA PAGE
async function checkAndRestoreSession() {
  const rawSession = localStorage.getItem('ccd_session');
  if (!rawSession) return false;

  try {
    const session = JSON.parse(rawSession);
    const snap = await get(ref(db, `rooms/${session.roomCode}`));
    
    if (!snap.exists()) {
      clearSession();
      return false;
    }

    const room = snap.val();
    if (room.phase === 'ended') {
      clearSession();
      return false;
    }

    // Restauration de l'état
    state.roomCode = session.roomCode;
    state.role = session.role;
    state.pseudo = session.pseudo;
    state.color = session.color;

    // Mise à jour sur Firebase
    await update(ref(db, `rooms/${state.roomCode}/players/${uid}`), {
      connected: true,
      updatedAt: Date.now()
    });
    onDisconnect(ref(db, `rooms/${state.roomCode}/players/${uid}/connected`)).set(false);

    toast("Session restaurée !");

    if (room.phase === 'lobby') {
      enterWaiting();
    } else {
      enterGame();
    }
    return true;

  } catch (e) {
    console.error("Échec de la restauration", e);
    clearSession();
    return false;
  }
}

// QUITTER LA PARTIE VOLONTAIREMENT
async function quitGame() {
  if (confirm("Es-tu sûr de vouloir quitter la partie ?")) {
    if (state.roomCode) {
      await remove(ref(db, `rooms/${state.roomCode}/players/${uid}`));
    }
    clearSession();
    if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
    if (state.wakeLock) try { state.wakeLock.release(); } catch(e){}
    location.reload();
  }
}

function selectRole(r){
  state.role = r;
  $('role-chat').classList.toggle('sel-chat', r==='chat');
  $('role-mouse').classList.toggle('sel-mouse', r==='mouse');
  $('create-block').style.display = 'block';
}

async function createGame(){
  try {
    const pseudo = $('in-pseudo').value.trim();
    const hideMin = Math.max(1, parseInt($('in-hide-min').value||'5',10));
    if (!pseudo){ $('home-err').textContent = 'Choisis un pseudo.'; return; }
    if (!state.role){ $('home-err').textContent = 'Choisis un rôle (Chat ou Souris).'; return; }
    $('home-err').textContent = '';
    state.pseudo = pseudo; state.isHost = true;

    let code;
    for (let tries=0; tries<8; tries++){
      code = makeCode();
      const snap = await get(ref(db, `rooms/${code}`));
      if (!snap.exists()) break;
    }
    state.roomCode = code;

    await set(ref(db, `rooms/${code}`), {
      createdAt: Date.now(),
      hideDurationMin: hideMin,
      phase: 'lobby',
      circle: null,
      capture: { requestedByCat:false, confirmed:false }
    });

    saveSession();
    await writeSelfPlayer();
    await enterWaiting();
  } catch(e) {
    toast("Erreur création: " + e.message);
  }
}

async function joinGame(){
  try {
    const pseudo = $('in-pseudo').value.trim();
    const code = $('in-join-code').value.trim().toUpperCase();
    if (!pseudo){ $('home-err').textContent = 'Choisis un pseudo.'; return; }
    if (!state.role){ $('home-err').textContent = 'Choisis un rôle (Chat ou Souris).'; return; }
    if (!code){ $('home-err').textContent = 'Entre un code de salon.'; return; }
    $('home-err').textContent = '';

    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()){ $('home-err').textContent = "Ce salon n'existe pas."; return; }
    const room = snap.val();
    const players = room.players || {};
    const takenRoles = Object.values(players).filter(p=>p.uid!==uid).map(p=>p.role);
    if (takenRoles.includes(state.role)){
      $('home-err').textContent = `Le rôle ${state.role==='chat'?'Chat':'Souris'} est déjà pris.`;
      return;
    }
    state.pseudo = pseudo; state.roomCode = code; state.isHost = false;

    saveSession();
    await writeSelfPlayer();
    await enterWaiting();
  } catch(e) {
    toast("Erreur connexion: " + e.message);
  }
}

async function writeSelfPlayer(){
  const pRef = ref(db, `rooms/${state.roomCode}/players/${uid}`);
  await set(pRef, {
    uid, pseudo: state.pseudo, color: state.color, role: state.role,
    ready:false, connected:true, score:0, lat:null, lng:null, updatedAt:Date.now()
  });
  onDisconnect(ref(db, `rooms/${state.roomCode}/players/${uid}/connected`)).set(false);
}

async function enterWaiting(){
  showScreen('screen-wait');
  $('wait-code').textContent = state.roomCode;
  $('wait-code').onclick = ()=>{
    if (navigator.clipboard) navigator.clipboard.writeText(state.roomCode).then(()=>toast('Code copié !'));
  };

  const pRef = ref(db, `rooms/${state.roomCode}/players`);
  onValue(pRef, (snap)=>{
    const players = snap.val() || {};
    renderWaitPlayers(players);
    maybeStartGame(players);
  });

  const phaseRef = ref(db, `rooms/${state.roomCode}/phase`);
  onValue(phaseRef, (snap)=>{
    const phase = snap.val();
    if ((phase === 'hiding' || phase === 'hunting') && state.roomCode && state.role) {
      enterGame();
    }
  });

  $('btn-ready').onclick = async ()=>{
    await update(ref(db, `rooms/${state.roomCode}/players/${uid}`), { ready:true, connected:true });
    $('btn-ready').textContent = 'En attente de l\'autre joueur…';
    $('btn-ready').disabled = true;
  };
}

function renderWaitPlayers(players){
  const wrap = $('wait-players');
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = Object.values(players);
  ['chat','mouse'].forEach(role=>{
    const p = list.find(pl=>pl.role===role);
    const div = document.createElement('div');
    div.className = 'player-slot';
    if (p){
      div.innerHTML = `
        <div class="dot" style="background:${p.color}"></div>
        <div>
          <div class="pname">${escapeHtml(p.pseudo)} ${p.uid===uid?'(toi)':''}</div>
          <div class="prole">${role==='chat'?'🐱 Chat':'🐭 Souris'}</div>
        </div>
        <span class="status-pill ${p.ready?'status-ready':'status-wait'}">${p.ready?'Prêt':'En attente'}</span>`;
    } else {
      div.style.opacity = .5;
      div.innerHTML = `
        <div class="dot" style="background:#444"></div>
        <div><div class="pname">En attente…</div><div class="prole">${role==='chat'?'🐱 Chat':'🐭 Souris'}</div></div>`;
    }
    wrap.appendChild(div);
  });
}

async function maybeStartGame(players){
  const list = Object.values(players);
  const chat = list.find(p=>p.role==='chat');
  const mouse = list.find(p=>p.role==='mouse');
  if (chat && mouse && chat.ready && mouse.ready){
    await runTransaction(ref(db, `rooms/${state.roomCode}/phase`), (cur)=>{
      if (cur === 'lobby' || cur == null) return 'hiding';
      return cur;
    });
    const roomSnap = await get(ref(db, `rooms/${state.roomCode}`));
    const rd = roomSnap.val();
    if (rd && rd.phase === 'hiding' && !rd.hidingEndAt){
      await runTransaction(ref(db, `rooms/${state.roomCode}/hidingEndAt`), (cur)=>{
        if (cur) return cur;
        return Date.now() + (rd.hideDurationMin||5)*60000;
      });
    }
  }
}

async function enterGame(){
  if (!state.roomCode || !state.role) {
    showScreen('screen-home');
    return;
  }
  
  if (state.gameStarted) return;
  state.gameStarted = true;
  showScreen('screen-game');
  requestWakeLock();

  $('gt-code').textContent = 'SALON ' + state.roomCode;
  $('gt-role-chip').textContent = state.role==='chat' ? '🐱 CHAT' : '🐭 SOURIS';
  $('gt-role-chip').className = `role-chip ${state.role==='chat'?'chat':'mouse'}`;

  initMap();

  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 300);

  startGeolocation();
  listenRoom();
  listenChallenges();
  setupTabs();
  setupChallengeForm();
  setupCapture();
}

function initMap(){
  if (state.map || typeof L === 'undefined') return;
  try {
    state.map = L.map('map', { zoomControl:false, attributionControl:false }).setView([48.699,2.417], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(state.map);
    $('btn-recenter').onclick = ()=>{
      if (state.lastPos && state.map) state.map.setView([state.lastPos.lat, state.lastPos.lng], 16);
    };
  } catch(e) {
    toast("Erreur Carte: " + e.message);
  }
}

function markerIcon(color, emoji){
  return L.divIcon({
    className:'',
    html:`<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px #0008;border:2px solid #fff2;">
      <span style="transform:rotate(45deg);font-size:16px;">${emoji}</span></div>`,
    iconSize:[34,34], iconAnchor:[17,34]
  });
}

function startGeolocation(){
  if (!navigator.geolocation){ toast("GPS non supporté."); return; }
  state.watchId = navigator.geolocation.watchPosition(pos=>{
    const { latitude:lat, longitude:lng } = pos.coords;
    state.lastPos = { lat, lng };
    updateMyMarker(lat,lng);
    const now = Date.now();
    if (now - state.lastSentPos > 2500){
      state.lastSentPos = now;
      update(ref(db, `rooms/${state.roomCode}/players/${uid}`), { lat, lng, updatedAt: now });
    }
    
    if (state.role === 'mouse') handleMouseCircleSlide(lat, lng);
    if (state.role === 'chat') handleZoneLogic(lat, lng);
  }, err=>{
    toast("Erreur GPS : " + err.message);
  }, { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
}

function updateMyMarker(lat,lng){
  if (!state.map) return;
  if (!state.myMarker){
    state.myMarker = L.marker([lat,lng], { icon: markerIcon(state.color, state.role==='chat'?'🐱':'🐭') }).addTo(state.map);
    state.map.setView([lat,lng], 16);
  } else {
    state.myMarker.setLatLng([lat,lng]);
  }
}

function listenRoom(){
  if (!state.roomCode) return;
  onValue(ref(db, `rooms/${state.roomCode}`), (snap)=>{
    roomData = snap.val() || {};
    renderPhase();
    renderCircle();
  });
  setInterval(renderPhase, 1000);
}

function renderPhase(){
  const phase = roomData.phase;
  if (!phase) return;

  if (phase === 'review'){ showScreen('screen-review'); renderReview(); return; }
  if (phase === 'ended'){ clearSession(); showScreen('screen-end'); renderEnd(); return; }
  showScreen('screen-game');

  if (phase === 'hiding'){
    $('gt-phase').textContent = 'Phase de cachette';
    const remain = (roomData.hidingEndAt||0) - Date.now();
    $('gt-timer').textContent = fmtMMSS(remain);
    $('hiding-overlay').style.display = 'flex';
    $('hiding-count').textContent = fmtMMSS(remain);

    if (state.role === 'chat'){
      $('hiding-label').textContent = 'La Souris se cache…';
      $('hiding-sub').textContent = "Ta carte reste masquée jusqu'à la fin du décompte.";
    } else {
      $('hiding-label').textContent = 'Trouve ta cachette !';
      $('hiding-sub').textContent = "Le Chat ne voit rien pour l'instant. Planque-toi bien.";
    }
    if (remain <= 0) tryStartHunt();
  } else if (phase === 'hunting'){
    $('hiding-overlay').style.display = 'none';
    $('gt-phase').textContent = 'Chasse en cours';
    if (roomData.huntStartAt){
      $('gt-timer').textContent = fmtMMSS(Date.now() - roomData.huntStartAt);
    }
  }
}

async function tryStartHunt(){
  const mySnap = await get(ref(db, `rooms/${state.roomCode}/players`));
  const players = mySnap.val() || {};
  const mouse = Object.values(players).find(p=>p.role==='mouse');
  if (!mouse || mouse.lat==null) return;

  await runTransaction(ref(db, `rooms/${state.roomCode}/phase`), cur=>{
    if (cur === 'hiding') return 'hunting';
    return cur;
  });

  await runTransaction(ref(db, `rooms/${state.roomCode}/circle`), cur=>{
    if (cur) return cur;
    const initCenter = generateRandomOffsetCenter(mouse.lat, mouse.lng, CIRCLE_START);
    return { 
      lat: initCenter.lat, 
      lng: initCenter.lng, 
      radius: CIRCLE_START, 
      outOfZoneSince: null, 
      inZoneSince: Date.now() 
    };
  });

  await runTransaction(ref(db, `rooms/${state.roomCode}/huntStartAt`), cur=>{
    if (cur) return cur;
    return Date.now();
  });
}

function renderCircle(){
  if (state.role !== 'chat' || !state.map) return;
  const c = roomData.circle;
  if (!c || !c.lat) return;
  if (state.circleLayer) state.map.removeLayer(state.circleLayer);
  state.circleLayer = L.circle([c.lat,c.lng], {
    radius: c.radius, color: '#ff7a33', weight:2.5, fillColor:'#ff7a33', fillOpacity:.08,
    dashArray:'6 6', className:'radar-ring'
  }).addTo(state.map);
}

function handleMouseCircleSlide(mLat, mLng) {
  const c = roomData.circle;
  if (!c || !c.lat || roomData.phase !== 'hunting') return;

  const dist = haversine(mLat, mLng, c.lat, c.lng);
  
  if (dist > c.radius) {
    const angle = Math.atan2(mLng - c.lng, mLat - c.lat);
    const dLat = (dist - c.radius) * Math.cos(angle) / 111111;
    const dLng = (dist - c.radius) * Math.sin(angle) / (111111 * Math.cos(mLat * Math.PI / 180));
    
    update(ref(db, `rooms/${state.roomCode}/circle`), {
      lat: c.lat + dLat,
      lng: c.lng + dLng
    });
  }
}

async function handleZoneLogic(lat, lng){
  const c = roomData.circle;
  if (!c || !c.lat || roomData.phase !== 'hunting') return;
  
  const dist = haversine(lat, lng, c.lat, c.lng);
  const outside = dist > c.radius;
  const banner = $('ooz-banner');
  const now = Date.now();

  banner.style.display = 'flex';

  if (outside) {
    banner.className = "ooz-banner danger";
    if (c.outOfZoneSince == null) {
      update(ref(db, `rooms/${state.roomCode}/circle`), { outOfZoneSince: now, inZoneSince: null });
      $('ooz-text').textContent = "⚠️ VOUS ÊTES HORS-ZONE ! REVENEZ DANS LE CERCLE !";
    } else {
      const remain = TIME_5_MIN_MS - (now - c.outOfZoneSince);
      if (remain <= 0) {
        const newRadius = Math.min(CIRCLE_MAX, c.radius + CIRCLE_STEP);
        update(ref(db, `rooms/${state.roomCode}/circle`), { radius: newRadius, outOfZoneSince: now });
        toast(`⚠️ Hors-zone depuis 5 min ! La zone s'agrandit à ${newRadius}m`);
      } else {
        $('ooz-text').textContent = `🚨 HORS-ZONE ! Entrez dans le cercle sinon il s'agrandit (+50m) dans ${fmtMMSS(remain)}`;
      }
    }

  } else {
    banner.className = "ooz-banner ok";
    if (c.inZoneSince == null) {
      update(ref(db, `rooms/${state.roomCode}/circle`), { inZoneSince: now, outOfZoneSince: null });
      $('ooz-text').textContent = "✅ VOUS ÊTES DANS LA ZONE";
    } else {
      const remain = TIME_5_MIN_MS - (now - c.inZoneSince);
      if (remain <= 0) {
        const newRadius = Math.max(CIRCLE_MIN, c.radius - CIRCLE_STEP);
        
        const playersSnap = await get(ref(db, `rooms/${state.roomCode}/players`));
        const players = playersSnap.val() || {};
        const mouse = Object.values(players).find(p => p.role === 'mouse');

        let newCenter = { lat: c.lat, lng: c.lng };
        if (mouse && mouse.lat != null) {
          newCenter = generateRandomOffsetCenter(mouse.lat, mouse.lng, newRadius);
        }

        update(ref(db, `rooms/${state.roomCode}/circle`), { 
          lat: newCenter.lat,
          lng: newCenter.lng,
          radius: newRadius, 
          inZoneSince: now 
        });
        toast(`🎯 5 min dans la zone ! Le cercle s'est réduit à ${newRadius}m et s'est régénéré décalé.`);
      } else {
        $('ooz-text').textContent = `🎯 DANS LA ZONE. Rétrécissement (-50m) dans ${fmtMMSS(remain)}`;
      }
    }
  }
}

function setupTabs(){
  document.querySelectorAll('.ft-btn').forEach(btn=>{
    btn.onclick = ()=>{
      document.querySelectorAll('.ft-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-map' && state.map) setTimeout(()=>state.map.invalidateSize(), 100);
    };
  });
}

function setupChallengeForm(){
  if (state.role === 'chat') $('chat-challenge-form').style.display = 'block';
  $('btn-send-challenge').onclick = async ()=>{
    const text = $('ch-text').value.trim();
    const points = Math.max(1, parseInt($('ch-points').value||'10',10));
    if (!text){ toast('Écris un texte de défi.'); return; }
    const newRef = push(ref(db, `rooms/${state.roomCode}/challenges`));
    await set(newRef, {
      text, points, createdAt: Date.now(), expiresAt: Date.now()+CHALLENGE_TTL_MS,
      status:'pending', photoURL:null
    });
    $('ch-text').value = '';
    toast('Défi envoyé !');
  };
}

function listenChallenges(){
  if (!state.roomCode) return;
  onValue(ref(db, `rooms/${state.roomCode}/challenges`), (snap)=>{
    renderChallenges(snap.val() || {});
  });
}

function renderChallenges(data){
  const wrap = $('challenges-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const entries = Object.entries(data).sort((a,b)=>b[1].createdAt-a[1].createdAt);
  $('challenges-empty').style.display = entries.length ? 'none' : 'block';

  entries.forEach(([id,c])=>{
    const now = Date.now();
    const expired = now > c.expiresAt && c.status === 'pending';
    const div = document.createElement('div');
    div.className = 'challenge-card';
    let statusChip = '';
    if (expired) statusChip = '<span class="chip-status chip-expired">Expiré</span>';
    else if (c.status==='pending') statusChip = '<span class="chip-status chip-pending">En attente</span>';
    else if (c.status==='submitted') statusChip = '<span class="chip-status chip-submitted">Preuve envoyée</span>';
    else if (c.status==='validated') statusChip = '<span class="chip-status chip-validated">Validé ✓</span>';
    else if (c.status==='refused') statusChip = '<span class="chip-status chip-refused">Refusé ✕</span>';

    div.innerHTML = `
      <div class="ch-top">
        <div class="ch-text">${escapeHtml(c.text)}</div>
        <div class="ch-pts">+${c.points}</div>
      </div>
      <div class="ch-meta">${statusChip}</div>
      ${c.photoURL ? `<img class="ch-photo" src="${c.photoURL}">` : ''}
      <div class="ch-actions"></div>
    `;
    const actions = div.querySelector('.ch-actions');
    if (state.role === 'mouse' && c.status === 'pending' && !expired){
      const btn = document.createElement('button');
      btn.className = 'btn btn-mint btn-sm';
      btn.textContent = '📷 Envoyer une preuve';
      btn.onclick = ()=> openCameraFor(id);
      actions.appendChild(btn);
    }
    wrap.appendChild(div);
  });
}

function openCameraFor(challengeId){
  if (fileInputEl) fileInputEl.remove();
  fileInputEl = document.createElement('input');
  fileInputEl.type = 'file';
  fileInputEl.accept = 'image/*';
  fileInputEl.capture = 'environment';
  fileInputEl.style.display = 'none';
  document.body.appendChild(fileInputEl);
  fileInputEl.onchange = async ()=>{
    const file = fileInputEl.files[0];
    if (!file) return;
    toast('Envoi de la photo…');
    try{
      const path = `rooms/${state.roomCode}/challenges/${challengeId}.jpg`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      const url = await getDownloadURL(sRef);
      await update(ref(db, `rooms/${state.roomCode}/challenges/${challengeId}`), {
        photoURL:url, status:'submitted', submittedAt:Date.now()
      });
      toast('Preuve envoyée !');
    }catch(e){
      toast("Échec : " + e.message);
    }
  };
  fileInputEl.click();
}

function setupCapture(){
  if (state.role === 'chat'){
    $('capture-title').textContent = 'Capture';
    $('capture-desc').textContent = "Déclare la capture lorsque tu as attrapé la Souris.";
    $('btn-declare-capture').style.display = 'block';
    $('btn-declare-capture').onclick = async ()=>{
      await update(ref(db, `rooms/${state.roomCode}/capture`), { requestedByCat:true, requestedAt:Date.now() });
      toast('Demande envoyée…');
    };
  } else {
    $('capture-title').textContent = 'Capture';
    $('capture-desc').textContent = "Si le Chat t'attrape, confirme ici.";
  }

  onValue(ref(db, `rooms/${state.roomCode}/capture`), (snap)=>{
    const cap = snap.val() || {};
    if (state.role === 'mouse'){
      if (cap.requestedByCat && !cap.confirmed){
        $('capture-desc').textContent = "Le Chat déclare t'avoir trouvée. Confirme !";
        $('btn-confirm-capture').style.display = 'block';
      } else {
        $('btn-confirm-capture').style.display = 'none';
      }
    }
    if (cap.confirmed && roomData.phase === 'hunting'){
      update(ref(db, `rooms/${state.roomCode}`), { phase:'review' });
    }
  });

  $('btn-confirm-capture').onclick = async ()=>{
    const survival = Date.now() - (roomData.huntStartAt || Date.now());
    await update(ref(db, `rooms/${state.roomCode}/capture`), {
      confirmed:true, confirmedAt:Date.now(), survivalTimeMs: survival
    });
    await update(ref(db, `rooms/${state.roomCode}`), { phase:'review' });
  };
}

function renderReview(){
  $('review-title').textContent = state.role==='chat' ? 'Validation des défis' : 'Révision en cours';
  onValue(ref(db, `rooms/${state.roomCode}/challenges`), (snap)=>{
    const data = snap.val() || {};
    const gallery = $('review-gallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    const submitted = Object.entries(data).filter(([,c])=>c.photoURL);
    $('review-empty').style.display = submitted.length ? 'none' : 'block';

    submitted.forEach(([id,c])=>{
      const div = document.createElement('div');
      div.className = 'gallery-item';
      div.innerHTML = `
        <img src="${c.photoURL}" style="width:100%;border-radius:8px;">
        <div class="gi-body" style="margin-top:8px;">
          <div class="ch-text">${escapeHtml(c.text)}</div>
          <div class="ch-meta">+${c.points} pts</div>
          <div class="gi-actions" style="margin-top:5px;"></div>
        </div>`;
      const actions = div.querySelector('.gi-actions');
      if (state.role === 'chat' && c.status === 'submitted'){
        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-mint btn-sm'; okBtn.textContent = '✓ Valider';
        okBtn.onclick = async ()=>{
          await update(ref(db, `rooms/${state.roomCode}/challenges/${id}`), { status:'validated' });
          const players = (await get(ref(db, `rooms/${state.roomCode}/players`))).val() || {};
          const mouse = Object.entries(players).find(([,p])=>p.role==='mouse');
          if (mouse) await update(ref(db, `rooms/${state.roomCode}/players/${mouse[0]}`), { score:(mouse[1].score||0)+c.points });
        };
        const noBtn = document.createElement('button');
        noBtn.className = 'btn btn-ghost btn-sm'; noBtn.textContent = '✕ Refuser';
        noBtn.onclick = ()=> update(ref(db, `rooms/${state.roomCode}/challenges/${id}`), { status:'refused' });
        actions.appendChild(okBtn); actions.appendChild(noBtn);
      }
      gallery.appendChild(div);
    });

    if (state.role === 'chat') $('btn-finish-review').style.display = 'block';
  });
}

$('btn-finish-review').onclick = async ()=>{
  await update(ref(db, `rooms/${state.roomCode}`), { phase:'ended' });
};

function renderEnd(){
  const survival = (roomData.capture && roomData.capture.survivalTimeMs) || 0;
  $('end-survival').textContent = fmtMMSS(survival);
  get(ref(db, `rooms/${state.roomCode}/players`)).then(snap=>{
    const players = snap.val() || {};
    const wrap = $('end-scores');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.values(players).forEach(p=>{
      const row = document.createElement('div');
      row.className = 'player-slot';
      row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;width:100%;">
        <div class="dot" style="background:${p.color}"></div>
        <div><div style="font-weight:700;">${escapeHtml(p.pseudo)}</div>
        <div class="muted" style="font-size:11px;">${p.role==='chat'?'🐱 Chat':'🐭 Souris'}</div></div>
        <div style="margin-left:auto;font-weight:bold;color:#4fd1ae;">${p.score||0} pts</div></div>`;
      wrap.appendChild(row);
    });
  });
}

function resetGame(){
  clearSession();
  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.wakeLock) try{ state.wakeLock.release(); }catch(e){}
  location.reload();
}

document.addEventListener('DOMContentLoaded', async ()=>{
  // Vérification de session enregistrée au démarrage
  const restored = await checkAndRestoreSession();
  if (!restored) {
    showScreen('screen-home');
  }

  const swatchesEl = $('swatches');
  if (swatchesEl) {
    swatchesEl.innerHTML = '';
    COLORS.forEach((c,i)=>{
      const s = document.createElement('div');
      s.className = 'swatch' + (i===0?' active':'');
      s.style.background = c;
      s.addEventListener('click', ()=>{
        document.querySelectorAll('.swatch').forEach(e=>e.classList.remove('active'));
        s.classList.add('active');
        state.color = c;
      });
      swatchesEl.appendChild(s);
    });
  }

  $('role-chat').addEventListener('click', ()=> selectRole('chat'));
  $('role-mouse').addEventListener('click', ()=> selectRole('mouse'));

  $('btn-create').addEventListener('click', createGame);
  $('btn-join').addEventListener('click', joinGame);
  $('btn-new-game').addEventListener('click', resetGame);
  
  $('btn-quit-wait').addEventListener('click', quitGame);
  $('btn-quit-game').addEventListener('click', quitGame);
});
