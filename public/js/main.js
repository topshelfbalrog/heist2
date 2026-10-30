// In Broad Daylight: client entry. Screens, lobby, briefing, game loop and event handling.
import * as THREE from 'three';
import { WsNet, LocalNet } from './net.js';
import { generateHeist } from '../shared/gen.js';
import { World } from './world.js';
import { FieldMode } from './field.js';
import { OverwatchMode } from './overwatch.js';
import { GetawayMode } from './getaway.js';
import { PuzzleUI } from './puzzles.js';
import { Voice } from './voice.js';
import { sound } from './audio.js';
import { music } from './music.js';
import { ROLES, ROLE_ORDER } from '../shared/data.js';
import { inRect } from '../shared/geom.js';

const $ = (id) => document.getElementById(id);
const CARD = { overwatch: ['A', '♠'], hacker: ['J', '♣'], infiltrator: ['Q', '♥'], face: ['K', '♦'] };

// ---------- Settings ----------
const settings = { sens: 0.0022, vol: 0.8, musicVol: 0.7, voiceVol: 1, quality: 'high' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('ibd-settings') || '{}')); } catch { /* storage unavailable */ }
const saveSettings = () => { try { localStorage.setItem('ibd-settings', JSON.stringify(settings)); } catch { /* storage unavailable */ } };
sound.setVolume(settings.vol);
music.setVolume(settings.vol); music.setMusicVolume(settings.musicVol);
// Music starts on the first click or key press (browsers block sound before that)
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => music.unlock(), { capture: true });

// ---------- Renderer ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const applyQuality = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'low' ? 0.85 : settings.quality === 'medium' ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
};
applyQuality();

// ---------- State ----------
let net = null, myId = null, lobby = null, ctx = null, mode = null, phase = 'title';
let brief = null;
let lastField = 'hacker';
const puzzle = new PuzzleUI($('panel'), (m) => ctx && ctx.send(m));
let voice = null;

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
}

function err(text) {
  const e = $('err');
  e.textContent = text;
  e.classList.add('show');
  clearTimeout(err.t);
  err.t = setTimeout(() => e.classList.remove('show'), 4200);
}

function toast(text, secs = 4.5) {
  const box = $('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  box.prepend(t);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, secs * 1000);
}

// ---------- Title ----------
// When the page is hosted without the game server (a preview link), only solo practice works.
fetch('./healthz', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(); }).catch(() => document.body.classList.add('no-server'));
try { $('nameInput').value = localStorage.getItem('ibd-name') || ''; } catch { /* storage unavailable */ }
const params = new URLSearchParams(location.search);
if (params.get('room')) $('codeInput').value = params.get('room').toUpperCase();
const myName = () => { const n = $('nameInput').value.trim().slice(0, 18) || 'Crew'; try { localStorage.setItem('ibd-name', n); } catch { /* storage unavailable */ } return n; };

async function connect(local) {
  sound.init();
  if (net) { net.close(); net = null; }
  net = local ? new LocalNet() : new WsNet();
  try { await net.ready; } catch (e) { err('No game server found here. Try Solo practice, or open the link your host shared.'); net = null; return null; }
  myId = net.id;
  wireNet(net);
  voice = new Voice(net);
  return net;
}

$('btnCreate').onclick = async () => { sound.ui(); if (await connect(false)) net.send({ type: 'create', name: myName() }); };
$('btnJoin').onclick = async () => {
  sound.ui();
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { err('Room codes are 4 letters.'); return; }
  if (await connect(false)) net.send({ type: 'join', code, name: myName() });
};
$('codeInput').addEventListener('keydown', (e) => { if (e.code === 'Enter') $('btnJoin').click(); });
$('btnSolo').onclick = async () => { sound.ui(); if (await connect(true)) net.send({ type: 'create', name: myName() }); };

// ---------- Lobby ----------
function renderLobby(m) {
  lobby = m;
  const isHost = m.host === myId;
  $('roomCode').textContent = m.code;
  $('btnCopy').style.display = net.local ? 'none' : '';
  const me = m.players.find((p) => p.id === myId);
  // Player list
  $('playerList').innerHTML = m.players.map((p) => {
    const r = p.role ? ROLES[p.role] : null;
    return `<li><span class="pname">${esc(p.name)}${p.id === m.host ? ' <em>host</em>' : ''}${p.id === myId ? ' <em>you</em>' : ''}</span><span class="prole" style="color:${r ? r.color : '#8a8170'}">${r ? r.name : 'Choosing...'}</span></li>`;
  }).join('');
  // Cards
  const cards = $('cards');
  cards.innerHTML = '';
  ROLE_ORDER.forEach((rid, i) => {
    const R = ROLES[rid];
    const owner = m.players.find((p) => p.role === rid);
    const mine = owner && owner.id === myId;
    const [rank, suit] = CARD[rid];
    const red = suit === '♥' || suit === '♦';
    const c = document.createElement('button');
    c.className = 'card' + (mine ? ' mine' : '') + (owner && !mine ? ' taken' : '');
    c.style.setProperty('--role', R.color);
    c.style.setProperty('--i', i);
    c.innerHTML = `
      <div class="corner tl ${red ? 'red' : ''}"><b>${rank}</b><span>${suit}</span></div>
      <div class="corner br ${red ? 'red' : ''}"><b>${rank}</b><span>${suit}</span></div>
      <div class="card-tag">${R.tag.toLowerCase()}</div>
      <h2>${R.name}</h2>
      <div class="card-ability"><h4>${R.ability}</h4><p>${R.text}</p></div>
      <dl><dt>Loadout</dt><dd>${R.loadout}</dd><dt>Puzzles</dt><dd>${R.focus}</dd></dl>
      <div class="card-keys">${R.keys.map(([k, d]) => `<span><kbd>${k}</kbd>${d}</span>`).join('')}</div>
      <div class="card-claim">${mine ? 'Your role. Click to release' : owner ? `Taken by ${esc(owner.name)}` : 'Click to take this role'}</div>`;
    c.onclick = () => { sound.ui(); if (owner && !mine) return; net.send({ type: 'role', role: mine ? null : rid }); };
    cards.append(c);
  });
  $('hostControls').style.display = isHost ? '' : 'none';
  $('waitHost').style.display = isHost ? 'none' : '';
  $('practiceToggle').checked = !!m.practice;
  $('practiceRow').style.display = net.local ? 'none' : '';
  const crew = m.crew;
  $('crewBox').innerHTML = crew
    ? `<div class="crew-name">${esc(crew.name)}</div><div class="crew-stats"><span>Bankroll <b>$${fmt(crew.bankroll)}</b></span><span>Heists <b>${crew.heists}</b></span><span>Clean escapes <b>${crew.escapes}</b></span><span>Rep <b>${crew.rep}</b></span></div>`
    : `<div class="crew-none">Playing as guests. The host can save progress under a crew name and passcode.</div>`;
  const ready = m.players.every((p) => p.role) && (m.practice || (m.players.length >= 3 && m.players.some((p) => p.role === 'overwatch')));
  $('btnStart').disabled = !ready;
  $('startHint').textContent = ready ? '' : !m.players.every((p) => p.role) ? 'Everyone needs a role.' : m.practice ? '' : m.players.length < 3 ? 'Need 3-4 players, or turn on Practice.' : 'Someone has to be Overwatch.';
  if (me && me.role && me.role !== 'overwatch') lastField = me.role;
  if (m.state === 'lobby' && phase !== 'lobby') { endGame(); phase = 'lobby'; show('lobby'); }
}

$('btnCopy').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${lobby.code}`;
  navigator.clipboard?.writeText(url).then(() => toastLobby('Invite link copied.'), () => toastLobby(url));
};
function toastLobby(t) { err(t); }
$('btnRandom').onclick = () => { sound.ui(); net.send({ type: 'randomize' }); };
$('practiceToggle').onchange = (e) => net.send({ type: 'practice', on: e.target.checked });
$('btnCrew').onclick = () => { sound.ui(); net.send({ type: 'crew', name: $('crewName').value, pass: $('crewPass').value }); };
$('btnStart').onclick = () => { sound.ui(); net.send({ type: 'start' }); };
$('btnLeave').onclick = () => { sound.ui(); if (net) { net.send({ type: 'leave' }); net.close(); } net = null; phase = 'title'; show('title'); };
$('btnMic').onclick = async () => {
  sound.init();
  if (!voice) return;
  const ok = await voice.getMic();
  if (!ok) { err('Microphone blocked. Allow mic access in your browser to use in-game voice.'); return; }
  $('btnMic').textContent = 'Mic on';
};

// ---------- Network ----------
function wireNet(n) {
  n.on('lobby', (m) => renderLobby(m));
  n.on('error', (m) => err(m.text));
  n.on('toast', (m) => (phase === 'game' ? toast(m.text) : err(m.text)));
  n.on('crew', (m) => { if (lobby) lobby.crew = m.crew; renderResultsCrew(m.crew); });
  n.on('start', (m) => startHeist(m));
  n.on('snap', (m) => onSnap(m.s));
  n.on('ev', (m) => onEvent(m.ev));
  n.on('left', (m) => { if (ctx) { ctx.world.removePlayer(m.id); toast(`${ctx.nameOf(m.id)} left the job.`); } });
  n.on('disconnected', () => { if (phase !== 'title') { err('Lost connection to the server.'); endGame(); phase = 'title'; show('title'); } });
}

// ---------- Heist ----------
function startHeist(m) {
  endGame();
  const level = generateHeist(m.seed, { playerCount: m.playerCount });
  const world = new World(level);
  const roster = m.roster;
  const me = roster.find((p) => p.id === myId);
  ctx = {
    net, myId, level, world, renderer, roster, settings, puzzle, voice,
    practice: !!m.practice,
    snap: null, snapT: 0, snapRecv: 0, simOffset: 0,
    pings: [], over: null, radio: [],
    send: (msg) => net && net.send(msg),
    simT: () => (ctx.snap ? ctx.snap.t + Math.min(0.3, (performance.now() - ctx.snapRecv) / 1000) : 0),
    toast,
    nameOf: (id) => roster.find((p) => p.id === id)?.name || 'Someone',
    roleOf: (id) => ctx.roles[id] || roster.find((p) => p.id === id)?.role,
    roles: Object.fromEntries(roster.map((p) => [p.id, p.role])),
    openPanel: (fn) => { document.exitPointerLock?.(); fn(); },
    hitmarker: () => { const h = $('hitmarker'); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit'); },
  };
  puzzle.onClose = () => { if (phase === 'game' && mode && mode instanceof FieldMode) lockPointer(); };
  puzzle.prefix = null;
  puzzle.simTime = () => (ctx ? ctx.simT() : 0);
  $('breakerNotes').innerHTML = '';
  $('protocolBanner').classList.remove('show');
  for (const p of roster) if (p.role !== 'overwatch') world.ensurePlayer(p.id, p.role, p.name);
  mode = me.role === 'overwatch' ? new OverwatchMode(ctx) : new FieldMode(ctx, me.role);
  if (me.role !== 'overwatch') lastField = me.role;
  $('owRadioLog').innerHTML = '';
  if (!net.local) voice.start(myId, roster);
  sound.startAmbience();
  sound.setAmbience(0.9);
  startBriefing(me.role, level);
}

function startBriefing(role, level) {
  phase = 'brief';
  show('briefing');
  const L = level;
  const R = ROLES[role];
  $('briefLine1').textContent = `Stanley's Palace. 2:14 in the afternoon.`;
  $('briefLine2').textContent = '';
  const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 600);
  const path = [
    { p: [0, 14, -26], l: [0, 6, 0] },
    { p: [0, 3.2, -9], l: [0, 3, 2] },
    { p: [0, 3.5, 4], l: [L.sx * 0.5, 2, L.D * 0.6] },
    { p: [L.sx + 3, 2.4, L.D - 6], l: [L.sx, 1.4, L.D] },
  ];
  // Warm up shaders for the in-game pipeline while the briefing plays.
  try { mode.composer.render(); } catch (e) { console.warn(e); }
  brief = { t: 0, dur: 13.5, cam, path, role, R };
  const lines = [
    [0, `Stanley's Palace. 2:14 in the afternoon.`, ''],
    [2.6, `The score: ${L.prize.name}.`, `Roughly $${(L.prize.value / 1e6).toFixed(1)} million, two floors underground.`],
    [5.4, 'Three floors. Eleven locks.', 'Staff door, Security, the count level, the vault level. Every lock needs the van to open it.'],
    [8.0, 'Taking it trips the Stanley Protocol.', 'Lockdown, a response team, a city full of roadblocks. Then you drive.'],
    [10.6, `You're the ${R.name}.`, `${R.ability}. ${R.text}`],
  ];
  brief.lines = lines;
}

function updateBriefing(dt) {
  const b = brief;
  b.t += dt;
  const k = Math.min(1, b.t / b.dur) * (b.path.length - 1);
  const i = Math.min(b.path.length - 2, Math.floor(k)), u = k - i;
  const e = u * u * (3 - 2 * u);
  const A = b.path[i], B = b.path[i + 1];
  const lerp = (a, c) => a.map((v, j) => v + (c[j] - v) * e);
  const p = lerp(A.p, B.p), l = lerp(A.l, B.l);
  b.cam.position.set(...p);
  b.cam.lookAt(...l);
  for (const [t, a, c] of b.lines) if (b.t >= t && b.shown !== t) { b.shown = t; $('briefLine1').textContent = a; $('briefLine2').textContent = c; $('briefing').classList.remove('pulse'); void $('briefing').offsetWidth; $('briefing').classList.add('pulse'); }
  ctx.world.update(dt, ctx.simT(), ctx.snap, null, myId);
  b.cam.aspect = innerWidth / innerHeight; b.cam.updateProjectionMatrix();
  renderer.render(ctx.world.scene, b.cam);
  if (b.t >= b.dur) endBriefing();
}

function endBriefing() {
  if (phase !== 'brief') return;
  phase = 'game';
  brief = null;
  show('none');
  mode.enter();
  lockPointer();
  if (mode instanceof OverwatchMode) toast('Look around with the mouse. Click a monitor to zoom it. M map, B manuals, G guards. Hold V to talk.', 8);
  else toast('WASD move, Shift sprint, Ctrl crouch (slide while sprinting), Space jump. E interact, F ability. Hold V for radio.', 8);
}

function endGame() {
  if (mode) { mode.exit(); mode = null; }
  if (voice) voice.stop();
  puzzle.close(true);
  if (ctx) {
    ctx.world.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    ctx = null;
  }
  sound.stopAmbience();
  sound.stopAlarmLoop();
  sound.stopEngine();
  $('protocolBanner').classList.remove('show');
  $('hud').className = '';
  $('owhud').classList.remove('show');
}

function onSnap(s) {
  if (!ctx) return;
  ctx.snap = s;
  ctx.snapRecv = performance.now();
  if (puzzle.kind === 'maze') puzzle.mazeSync(s.puzzle.mazePos);
  // keep roles in sync (practice role swaps)
}

const ZONE_NAMES = { casino: 'the casino floor', backhouse: 'the back of house', b1: 'B1', b2: 'B2' };

function onEvent(ev) {
  if (!ctx) return;
  const me = ev.pid === myId;
  const isOW = mode instanceof OverwatchMode;
  const W = ctx.world;
  switch (ev.type) {
    case 'toast': toast(ev.text); break;
    case 'radio': addRadio(ev.line); break;
    case 'heat': break;
    case 'alarm': sound.alarm(); toast(`Alarm: ${ev.why}. Heat is rising.`); break;
    case 'lockdown': toast('LOCKDOWN. Two minutes to get the score to the van.', 8); sound.alarm(); break;
    case 'spotted':
      if (me) { sound.spotted(); toast(ev.cam != null ? 'A camera flagged you!' : 'You were spotted!'); }
      else if (isOW) toast(`${ctx.nameOf(ev.pid)} was spotted!`);
      break;
    case 'guardAlert': sound.spotted(); break;
    case 'guardAdd': W.addGuardView(ev.def); W.L.guards.push(ev.def); break;
    case 'event': toast(ev.text, 6); sound.toast(); break;
    case 'vip': W.showVip(); break;
    case 'surge': W.surge(ev.t); sound.static(0.8); break;
    case 'panic': W.panic(ev.x, ev.z); break;
    case 'jackpot': W.doJackpot(ev.bank); sound.jackpot(); toast(`Jackpot Siren! ${ev.guards} guard${ev.guards === 1 ? '' : 's'} pulled away.`); break;
    case 'lights': toast(`${ev.quick ? 'Power cut' : 'Lights out'}: ${ZONE_NAMES[ev.zone] || ev.zone} is dark for ${ev.t}s. Cameras there are blind and guards can barely see.`); sound.static(0.5); break;
    case 'made':
      sound.spotted(); sound.alarm();
      if (me) { toast("You've been made! They're shooting. Break line of sight, hit a locker to change, or call Overwatch.", 7); }
      else if (isOW) toast(`${ctx.nameOf(ev.pid)} has been made! Seal a door behind them or cut the lights (M).`, 7);
      else toast(`${ctx.nameOf(ev.pid)} has been made!`, 5);
      break;
    case 'lost': if (me || isOW) toast(me ? 'You shook them. They still have your description: change clothes at a locker to lose it.' : ev.text, 7); sound.success(); break;
    case 'outfit': toast(me ? `New clothes. Security is looking for someone else. (${ev.left} outfit${ev.left === 1 ? '' : 's'} left in there)` : ev.text, 6); sound.success(); break;
    case 'sealed': toast(`Overwatch sealed the ${ev.label} door for ${ev.t}s.`); sound.thud(); break;
    case 'unsealed': break;
    case 'hidden': sound.thud(); break;
    case 'strike': if (isOW) toast(`Strike used. ${ev.left} left.`); break;
    case 'door': break;
    case 'glyphOk': puzzle.setGlyphStep(ev.step); puzzle.glyphFeedback(true); break;
    case 'glyphBad': puzzle.setGlyphStep(0); puzzle.glyphFeedback(false, ev.strikes); break;
    case 'wireOk': puzzle.wireResult(true, ev.prefix); toast(`Vault code, first two digits: ${ev.prefix.join(' ')}. Remember them.`, 10); if (ctx.snap) { ctx.snap.puzzle.wireSolved = true; puzzle.renderWires(ctx.snap.puzzle); } break;
    case 'wireBad': puzzle.wireResult(false); if (ctx.snap) { ctx.snap.puzzle.wireLocked = true; puzzle.renderWires(ctx.snap.puzzle); } break;
    case 'wireReset': setTimeout(() => ctx && ctx.snap && puzzle.renderWires(ctx.snap.puzzle), 150); break;
    case 'vaultBad': puzzle.vaultBad(ev.strikes); break;
    case 'passBad': puzzle.passBad(ev.strikes); break;
    case 'simonStage': puzzle.simonUpdate(ev.stage, null, false); break;
    case 'simonBad': puzzle.simonUpdate(null, ev.strikes, true); break;
    case 'morseBad': puzzle.morseBad(ev.strikes); break;
    case 'mazeBump': puzzle.mazeBump(ev.strikes); break;
    case 'tileTrip': if (ev.pid === myId) { sound.alarm(); toast('Pressure plate! Get off it.'); } break;
    case 'keyTurn': toast(ev.text); sound.key(); break;
    case 'timelock': toast(ev.text, 8); sound.alarm(); break;
    case 'solved': {
      sound.success(); toast(ev.text, 6);
      const closeKinds = { glyph: 'glyph', vault: 'vault', pass: 'password', simon: 'simon', morse: 'morse', maze: 'maze' };
      if (closeKinds[ev.what] && puzzle.kind === closeKinds[ev.what]) puzzle.close(true);
      if (ev.what === 'shutter') { $('protocolBanner').querySelector('small').textContent = 'Shutter open. Everyone to the van in the loading dock!'; }
      break;
    }
    case 'protocol':
      sound.alarm(); sound.startAlarmLoop();
      $('protocolBanner').classList.add('show');
      $('protocolBanner').classList.remove('mini');
      setTimeout(() => $('protocolBanner').classList.add('mini'), 11000);
      $('protocolBanner').querySelector('small').textContent = (ev.reason === 'heat' ? 'Too much heat. Lockdown.' : 'You took the score. Lockdown.') + ' Response teams on every floor. Flip the three breakers (B2, B1, ground) and read the codes to Overwatch.';
      if (mode instanceof OverwatchMode) toast('Lockdown! Press O for the override console. Your crew reads you the breaker codes.', 9);
      break;
    case 'breakerOpen': addBreakerNote(ev); break;
    case 'breakerFlip': sound.thud(); break;
    case 'overrideOk': toast(`Override accepted: ${ev.color}. ${ev.idx}/3`); sound.success(); break;
    case 'overrideBad': toast(`Override rejected (${ev.color}). Lost ${ev.penalty} seconds.`); sound.fail(); break;
    case 'ride': break;
    case 'getaway': startGetaway(ev); break;
    case 'crash': break;
    case 'conOptions': ctx.openPanel(() => puzzle.openCon(ev)); break;
    case 'conResult': toast(ev.text); ev.ok ? sound.success() : sound.fail(); break;
    case 'ko': sound.thud(); break;
    case 'killed': sound.thud(); break;
    case 'died': toast(ev.text, 6); sound.fail(); break;
    case 'takedown': break;
    case 'bodyFound': sound.spotted(); break;
    case 'taser': break;
    case 'downed': toast(ev.text, 6); sound.fail(); break;
    case 'revived': toast(`${ctx.nameOf(ev.pid)} is back up.`); sound.success(); break;
    case 'prize': toast(ev.text, 7); sound.success(); break;
    case 'prizeDrop': toast('The score hit the floor! Someone grab it.'); break;
    case 'cash': if (ev.by === myId) { sound.coin(); toast(`+$${fmt(ev.value)} side loot.`); } break;
    case 'laserTrip': toast(`${ctx.nameOf(ev.pid)} tripped the IR grid!`); break;
    case 'ping': ctx.pings.push({ x: ev.x, z: ev.z, t: performance.now(), by: ev.by }); if (!isOW) sound.beep(true); break;
    case 'flagged': markFlag(ev.id, ev.good); break;
    case 'over': ctx.over = ev.over; setTimeout(() => showResults(ev.over), 1600); break;
  }
  if (mode && mode.onEvent) mode.onEvent(ev);
}

function addRadio(line) {
  const log = $('owRadioLog');
  const d = document.createElement('div');
  d.className = 'rline';
  d.dataset.id = line.id;
  const mm = Math.floor(line.t / 60), ss = String(Math.floor(line.t % 60)).padStart(2, '0');
  d.innerHTML = `<time>${mm}:${ss}</time><span>${esc(line.text)}</span><button title="Flag as useful intel">Flag</button>`;
  d.querySelector('button').onclick = () => { sound.ui(); ctx.send({ type: 'flag', id: line.id }); };
  log.prepend(d);
  while (log.children.length > 14) log.lastChild.remove();
  if (mode instanceof OverwatchMode) sound.radioClick(false);
}

function markFlag(id, good) {
  const d = document.querySelector(`.rline[data-id="${id}"]`);
  if (d) { d.classList.add(good ? 'good' : 'meh'); d.querySelector('button').disabled = true; }
}

function showResults(o) {
  endGame();
  phase = 'results';
  document.exitPointerLock?.();
  show('results');
  const won = o.result === 'escaped';
  $('resTitle').textContent = won ? 'Clean getaway' : 'Busted';
  $('resTitle').className = won ? 'won' : 'lost';
  $('resReason').textContent = o.reason;
  $('resPayout').textContent = won ? `$${fmt(o.payout)}` : '$0';
  $('resMeta').innerHTML = `<span>${o.prize}${won ? (o.secured ? ' secured' : ' left behind') : ''}</span>${won ? `<span>Van damage <b>${o.damage}/4</b></span>` : ''}<span>Time <b>${Math.floor(o.time / 60)}:${String(o.time % 60).padStart(2, '0')}</b></span><span>Heat <b>${o.heat}</b></span><span>Side loot <b>$${fmt(o.loot)}</b></span><span>Intel earned <b>${o.intelEarned}</b></span><span>Strikes used <b>${o.strikes}</b></span>`;
  $('resStats').innerHTML = `<tr><th>Crew</th><th>Role</th><th>Kills</th><th>Silent</th><th>Solves</th><th>Cons</th><th>Times made</th><th>Revives</th></tr>` +
    o.stats.map((s) => `<tr><td>${esc(s.name)}${s.dead ? ' (killed)' : ''}</td><td style="color:${ROLES[s.role]?.color}">${ROLES[s.role]?.name}</td><td>${s.kills || 0}</td><td>${s.takedowns}</td><td>${s.solves}</td><td>${s.cons}</td><td>${s.spotted}</td><td>${s.revives}</td></tr>`).join('');
  $('btnAgain').style.display = lobby && lobby.host === myId ? '' : 'none';
  $('resWait').style.display = lobby && lobby.host === myId ? 'none' : '';
  if (lobby && lobby.crew) renderResultsCrew(lobby.crew);
  else $('resCrew').innerHTML = '';
  sound[won ? 'success' : 'fail']();
}

function renderResultsCrew(crew) {
  if (!crew) return;
  $('resCrew').innerHTML = `<b>${esc(crew.name)}</b> bankroll $${fmt(crew.bankroll)} after ${crew.heists} heist${crew.heists === 1 ? '' : 's'}. Rep ${crew.rep}.`;
}

$('btnAgain').onclick = () => { sound.ui(); net.send({ type: 'again' }); };
$('btnResLeave').onclick = () => { sound.ui(); if (net) { net.send({ type: 'leave' }); net.close(); } net = null; phase = 'title'; show('title'); };

// ---------- Music ----------
// Heist jazz everywhere; the chase track while you're made; the pause track in the pause menu.
setInterval(() => {
  let track = 'main';
  if ($('pause').classList.contains('show')) track = 'pause';
  else if (phase === 'game' && ctx && ctx.snap && !ctx.over) {
    if (mode instanceof FieldMode) { if (mode.me && mode.me.made && !mode.me.down) track = 'made'; }
    else if (mode instanceof OverwatchMode) { if (ctx.snap.players.some((p) => p[17] === 1 && !p[8] && ctx.roleOf(p[0]) !== 'overwatch')) track = 'made'; }
  }
  music.set(track);
}, 150);

// ---------- Pause / settings ----------
function openPause() {
  if (phase !== 'game') return;
  $('pause').classList.add('show');
  $('sensRange').value = Math.round(settings.sens * 10000);
  $('volRange').value = Math.round(settings.vol * 100);
  $('musicRange').value = Math.round(settings.musicVol * 100);
  $('qualSel').value = settings.quality;
  $('btnAbort').style.display = lobby && lobby.host === myId ? '' : 'none';
  $('practiceSwap').style.display = ctx && ctx.practice ? '' : 'none';
  mode && mode.releaseAll && mode.releaseAll();
}
function closePause() { $('pause').classList.remove('show'); lockPointer(); }
$('btnResume').onclick = () => closePause();
$('sensRange').oninput = (e) => { settings.sens = e.target.value / 10000; saveSettings(); };
$('volRange').oninput = (e) => { settings.vol = e.target.value / 100; sound.setVolume(settings.vol); music.setVolume(settings.vol); saveSettings(); };
$('musicRange').oninput = (e) => { settings.musicVol = e.target.value / 100; music.setMusicVolume(settings.musicVol); saveSettings(); };
$('qualSel').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applyQuality(); if (mode) { mode.bloom.enabled = settings.quality !== 'low'; mode.resize(); } };
$('btnAbort').onclick = () => { net.send({ type: 'abort' }); $('pause').classList.remove('show'); };
$('btnQuit').onclick = () => { $('pause').classList.remove('show'); if (net) { net.send({ type: 'leave' }); net.close(); } net = null; endGame(); phase = 'title'; show('title'); };
$('practiceSwap').onclick = () => { $('pause').classList.remove('show'); swapPracticeRole(); };

function swapPracticeRole() {
  if (!ctx || !ctx.practice || mode instanceof GetawayMode) return;
  const toOW = !(mode instanceof OverwatchMode);
  const role = toOW ? 'overwatch' : lastField;
  ctx.send({ type: 'practiceRole', role });
  ctx.roles[myId] = role;
  mode.exit();
  mode = toOW ? new OverwatchMode(ctx) : new FieldMode(ctx, role);
  if (!toOW && ctx.lastPos) { mode.pc.teleport(ctx.lastPos.x, ctx.lastPos.y, ctx.lastPos.z, ctx.lastPos.yaw); }
  mode.enter();
  toast(toOW ? 'Practice: you are in the van. F1 to go back.' : `Practice: back in the field as ${ROLES[role].name}.`);
  lockPointer();
}

// ---------- Input ----------
function lockPointer() {
  if (phase !== 'game' || !mode) return;
  if (mode.wantsPointerLock && !mode.wantsPointerLock()) return;
  if (puzzle.isOpen()) return;
  canvas.requestPointerLock?.();
}
canvas.addEventListener('click', () => { sound.init(); if (phase === 'game' && !$('pause').classList.contains('show')) lockPointer(); });
$('clickToPlay').onclick = () => { $('clickToPlay').classList.remove('show'); lockPointer(); };
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && phase === 'game' && mode instanceof FieldMode && !puzzle.isOpen() && !ctx.over && !$('pause').classList.contains('show')) {
    mode.releaseAll();
    $('clickToPlay').classList.add('show');
  }
  if (locked) $('clickToPlay').classList.remove('show');
});

addEventListener('keydown', (e) => {
  if (phase === 'brief') { if (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter') endBriefing(); return; }
  if (phase !== 'game' || !mode) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (puzzle.isOpen()) { if (puzzle.key(e)) { e.preventDefault(); } return; }
  if (e.code === 'Escape') {
    if (mode instanceof OverwatchMode && mode.escape()) return;
    if ($('pause').classList.contains('show')) closePause(); else { document.exitPointerLock?.(); openPause(); }
    return;
  }
  if (e.code === 'F1') { e.preventDefault(); if (ctx.practice) swapPracticeRole(); return; }
  if (e.code === 'KeyV' && !e.repeat) { voice.radio = true; sound.radioClick(true); }
  if (e.code === 'KeyX') voice.whisper = true;
  if (e.code === 'KeyT' && !e.repeat) { voice.setMuted(!voice.muted); toast(voice.muted ? 'Mic muted.' : 'Mic live.'); }
  if ($('pause').classList.contains('show')) return;
  mode.keydown(e);
});
addEventListener('keyup', (e) => {
  if (phase !== 'game' || !mode) return;
  if (e.code === 'KeyV') { voice.radio = false; sound.radioClick(false); }
  if (e.code === 'KeyX') voice.whisper = false;
  mode.keyup(e);
});
addEventListener('mousemove', (e) => { if (phase === 'game' && mode && !puzzle.isOpen()) mode.mousemove(e); });
addEventListener('mousedown', (e) => {
  if (phase === 'brief') { endBriefing(); return; }
  if (phase !== 'game' || !mode || puzzle.isOpen() || $('pause').classList.contains('show')) return;
  if (mode instanceof FieldMode && document.pointerLockElement !== canvas) return;
  if (e.target.closest && e.target.closest('#owhud .ow-modal-box, #owhud button, #owRadio, #scanner, #getawayHud')) return;
  mode.mousedown(e);
});
addEventListener('mouseup', (e) => { if (mode) mode.mouseup(e); });
addEventListener('contextmenu', (e) => { if (phase === 'game') e.preventDefault(); });
addEventListener('resize', () => { applyQuality(); if (mode) mode.resize(); });
addEventListener('blur', () => { if (mode) mode.releaseAll(); if (voice) { voice.radio = false; voice.whisper = false; } });

// Overwatch UI buttons
document.querySelectorAll('#owhud .close').forEach((b) => (b.onclick = () => mode && mode.closeOverlay && mode.closeOverlay()));
document.querySelectorAll('#owStrikes button').forEach((b) => (b.onclick = () => mode && mode.armStrike && mode.armStrike(b.dataset.kind)));
document.querySelectorAll('#owTools button').forEach((b) => (b.onclick = () => mode && mode.armTool && mode.armTool(b.dataset.tool)));
$('owMapCanvas').addEventListener('click', (e) => mode && mode.mapClick && mode.mapClick(e));
$('zPrev').onclick = () => mode && mode.cycleZoomCam && mode.cycleZoomCam(-1);
$('zNext').onclick = () => mode && mode.cycleZoomCam && mode.cycleZoomCam(1);
$('owZoomFrame').addEventListener('mousedown', (e) => { if (mode && mode.clickZoom) { mode.mouse.x = e.clientX; mode.mouse.y = e.clientY; mode.clickZoom(); } });

// ---------- HUD shared ----------
function objectiveText(s) {
  const L = ctx.level, pz = s.puzzle;
  const isOW = mode instanceof OverwatchMode;
  if (s.getaway) return isOW ? 'Drive to the safehouse. Your crew has the map.' : 'Navigate! Call the turns to the driver.';
  if (s.protocol) {
    const left = `${Math.floor(s.lockdown / 60)}:${String(Math.floor(s.lockdown % 60)).padStart(2, '0')}`;
    if (s.protocol.shutterOpen) return `Shutter open. Everyone to the van in the loading dock. ${left}`;
    const flipped = Object.keys(s.protocol.flipped).length;
    return isOW ? `Lockdown ${left}. Press O. Enter breaker codes (${s.protocol.idx}/3).` : `Lockdown ${left}. Take the fire stairs up. Flip all three breakers (${flipped}/3) and read the codes to Overwatch.`;
  }
  if (isOW) {
    if (!pz.glyphSolved) return 'Staff door: have your crew describe the four keypad symbols, then find their column (B, Staff keypad).';
    if (!pz.wireSolved || !pz.passSolved || !pz.simonSolved) return `Security: junction panel ${pz.wireSolved ? '✓' : '·'}, lift password ${pz.passSolved ? '✓' : '·'}, camera server ${pz.simonSolved ? '✓' : '·'}. Keycard from the Floor Manager (G for his dossier).`;
    if (!pz.morseSolved || !pz.mazeSolved) return `B1: call the pressure plates on THERMAL, decode the safe's Morse ${pz.morseSolved ? '✓' : '·'}, walk them through the hatch maze ${pz.mazeSolved ? '✓' : '·'}.`;
    if (!pz.vaultCode) return 'B2: call the IR beams on IR GRID. Give them the last two vault digits before the vault.';
    if (!pz.vaultOpen) return pz.timelock != null ? `Time lock ${Math.ceil(pz.timelock)}s. Warn them about the response team.` : 'Two keys: override key in console A, then count both keys in together.';
    return `Your crew is in the vault. Grab ${L.prize.name}.`;
  }
  if (!pz.glyphSolved) return 'Get through the STAFF ONLY door. Describe the keypad symbols to Overwatch.';
  if (!pz.wireSolved || !pz.passSolved || !pz.simonSolved) return `Security hub (keycard from the Floor Manager, or vents): junction panel ${pz.wireSolved ? '✓' : '·'}, lift terminal ${pz.passSolved ? '✓' : '·'}, camera server ${pz.simonSolved ? '✓' : '·'}.`;
  if (!pz.morseSolved || !pz.mazeSolved) return `B1 (service lift): cross the pressure gallery, open the count room safe ${pz.morseSolved ? '✓' : '·'}, unlock the annex hatch ${pz.mazeSolved ? '✓' : '·'}.`;
  if (!pz.vaultCode) return 'B2: cross the IR corridor. Vault code: two digits from the junction panel, two from Overwatch.';
  if (!pz.vaultOpen) return pz.timelock != null ? `Time lock: ${Math.ceil(pz.timelock)}s. Hold the antechamber!` : 'Override key into console A. Then two of you turn keys A and B together.';
  return `Grab ${L.prize.name}. This triggers the lockdown.`;
}

function addBreakerNote(ev) {
  const id = 'bn-' + ev.id;
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'bnote'; $('breakerNotes').append(el); }
  el.innerHTML = `<b class="bc ${ev.color.toLowerCase()}">${ev.color}</b> Phase ${ev.phase} <span>${ev.code.join(' ')}</span><em>${ev.id.replace('breaker', '')}</em>`;
  if (ev.by === myId) { toast(`Breaker ${ev.color}, phase ${ev.phase}, code ${ev.code.join(' ')}. Read it to Overwatch.`, 8); }
}

function startGetaway(ev) {
  if (!ctx) return;
  puzzle.close(true);
  sound.stopAlarmLoop();
  $('protocolBanner').classList.remove('show');
  document.exitPointerLock?.();
  if (mode) mode.exit();
  const driver = ev.driver === myId;
  mode = new GetawayMode(ctx, driver);
  mode.enter();
  toast(driver ? 'GO! W/S throttle, A/D steer, Space handbrake. Your crew has the map.' : 'You have the police scanner. Call every turn. H flips the map heading.', 9);
}

function updateSharedHud(dt) {
  const s = ctx.snap;
  if (!s) return;
  $('heatFill').style.width = `${s.heat}%`;
  $('heat').classList.toggle('hot', s.heat >= 70);
  $('lockdown').textContent = s.lockdown != null && !s.getaway ? `STANLEY PROTOCOL ${Math.floor(s.lockdown / 60)}:${String(Math.floor(s.lockdown % 60)).padStart(2, '0')}` : '';
  $('lockdown').classList.toggle('urgent', s.lockdown != null && s.lockdown < 60);
  const obj = objectiveText(s);
  if ($('objective').textContent !== obj) $('objective').textContent = obj;
  // Comms
  const isOW = mode instanceof OverwatchMode;
  const inVan = mode instanceof GetawayMode;
  const meP = s.players.find((p) => p[0] === myId);
  const myPos = isOW || inVan ? null : mode.pc;
  const jammedAt = (x, z) => ctx.level.zones.some((zn) => zn.jammer && inRect(x, z, zn));
  const meJam = myPos ? jammedAt(myPos.x, myPos.z) : false;
  $('radioInd').classList.toggle('on', voice.radio && !meJam);
  $('whisperInd').classList.toggle('on', voice.whisper);
  $('muteInd').classList.toggle('on', voice.muted);
  $('jamInd').classList.toggle('on', meJam);
  if (voice.radio && meJam && !updateSharedHud.jamT) { sound.static(0.3); updateSharedHud.jamT = 0.5; }
  updateSharedHud.jamT = Math.max(0, (updateSharedHud.jamT || 0) - dt);
  // Voice mixing
  voice.sample();
  const others = new Map();
  for (const p of s.players) if (p[0] !== myId) others.set(p[0], { role: ctx.roleOf(p[0]), x: p[1], y: p[2], z: p[3], f: p[6], down: !!p[8], jammed: ctx.roleOf(p[0]) !== 'overwatch' && jammedAt(p[1], p[3]) });
  voice.update({ id: myId, role: isOW ? 'overwatch' : 'field', van: inVan, x: myPos ? myPos.x : 0, y: myPos ? myPos.y : 0, z: myPos ? myPos.z : 0, yaw: myPos ? myPos.yaw : 0, jammed: meJam }, others);
  const sp = [];
  for (const [id, kind] of voice.speaking) if (kind) sp.push(`<span class="spk ${kind}" style="--c:${ROLES[ctx.roleOf(id)]?.color}">${esc(ctx.nameOf(id))}</span>`);
  const sph = sp.join('');
  if ($('speakers').dataset.h !== sph) { $('speakers').innerHTML = sph; $('speakers').dataset.h = sph; }
  // Pings + exit marker (field)
  const now = performance.now();
  ctx.pings = ctx.pings.filter((p) => now - p.t < 10000);
  const mk = $('markers');
  let html = '';
  if (!isOW && !inVan && mode.camera) {
    const v = new THREE.Vector3();
    const items = ctx.pings.map((p) => ({ x: p.x, y: 1.2, z: p.z, label: 'Ping', cls: 'ping' }));
    if (s.prize[0]) items.push({ x: ctx.level.van.x + 2, y: 1.5, z: ctx.level.van.z, label: 'Van', cls: 'exit' });
    for (const it of items) {
      v.set(it.x, it.y, it.z).project(mode.camera);
      if (v.z > 1) continue;
      const x = Math.max(0.03, Math.min(0.97, (v.x + 1) / 2)), y = Math.max(0.05, Math.min(0.95, (1 - v.y) / 2));
      const d = Math.hypot(it.x - mode.pc.x, it.z - mode.pc.z);
      html += `<div class="mk ${it.cls}" style="left:${x * 100}%;top:${y * 100}%"><i></i><span>${it.label} ${Math.round(d)}m</span></div>`;
    }
    ctx.lastPos = { x: mode.pc.x, y: mode.pc.y, z: mode.pc.z, yaw: mode.pc.yaw };
  }
  if (mk.dataset.h !== html) { mk.innerHTML = html; mk.dataset.h = html; }
  // Ambience by zone
  if (myPos) {
    const zn = ctx.level.zones.find((z) => inRect(myPos.x, myPos.z, z));
    const casino = zn && (zn.name === 'casino' || zn.name === 'bar' || zn.name === 'cage');
    const outside = zn && zn.name === 'plaza';
    sound.setAmbience(casino ? 0.9 : outside ? 0.45 : 0.25, casino ? 1 : 0.3);
  } else sound.setAmbience(0.2, 0.2);
  void meP;
}

// ---------- Loop ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === 'brief' && brief) { updateBriefing(dt); return; }
  if (phase === 'game' && mode) {
    mode.frame(dt);
    updateSharedHud(dt);
  } else if (phase === 'title' || phase === 'lobby') {
    renderer.setClearColor('#0f3a2c', 1);
    renderer.clear();
  }
}
requestAnimationFrame(loop);

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

// Debug hook for automated tests
window.__ibd = { get ctx() { return ctx; }, get mode() { return mode; }, get phase() { return phase; }, endBriefing, get lobby() { return lobby; } };
