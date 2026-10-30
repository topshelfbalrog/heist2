// In Broad Daylight - game server: static files, lobbies, authoritative heist sim, voice signaling.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateHeist } from '../public/shared/gen.js';
import { HeistSim } from '../public/shared/sim.js';
import { ROLE_ORDER } from '../public/shared/data.js';
import { loginCrew, publicCrew, recordHeist } from './crews.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const THREE = path.join(ROOT, 'node_modules', 'three');
const PORT = process.env.PORT || 8080;
const TICK = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};

function serveFile(res, file, cache, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const media = type.startsWith('audio/');
    const headers = { 'Content-Type': type, 'Cache-Control': cache || media ? 'public, max-age=86400' : 'no-cache', 'Accept-Ranges': 'bytes' };
    // Range requests let the browser stream long music files and loop them without re-downloading
    const m = req && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
      let end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (url.startsWith('/vendor/three/')) {
    const rel = url.slice('/vendor/three/'.length);
    const file = path.join(THREE, rel);
    if (!file.startsWith(THREE)) { res.writeHead(403); res.end(); return; }
    serveFile(res, file, true);
    return;
  }
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  serveFile(res, file, false, req);
});

// ---------- Rooms ----------
const rooms = new Map();
const clients = new Map();

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const newCode = () => {
  const A = 'BCDFGHJKLMNPQRSTVWXZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
};

function lobbyState(room) {
  return {
    type: 'lobby',
    code: room.code,
    host: room.host,
    state: room.state,
    practice: room.practice,
    crew: publicCrew(room.crew),
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role })),
  };
}

function broadcast(room, msg) { for (const p of room.players.values()) send(p.ws, msg); }
function pushLobby(room) { broadcast(room, lobbyState(room)); }

function leaveRoom(c) {
  const room = rooms.get(c.room);
  if (!room) return;
  room.players.delete(c.id);
  if (room.sim) room.sim.removePlayer(c.id);
  broadcast(room, { type: 'left', id: c.id });
  c.room = null;
  if (!room.players.size) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.host === c.id) room.host = room.players.keys().next().value;
  pushLobby(room);
}

function startGame(room) {
  const roster = [...room.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role }));
  const seed = crypto.randomInt(1, 2 ** 31);
  const level = generateHeist(seed, { playerCount: roster.length });
  room.sim = new HeistSim(level, roster, { practice: room.practice, blind: process.env.IBD_DEBUG_BLIND === '1' });
  room.state = 'game';
  broadcast(room, { type: 'start', seed, playerCount: roster.length, roster, practice: room.practice });
  clearInterval(room.timer);
  let tick = 0;
  room.timer = setInterval(() => {
    const sim = room.sim;
    if (!sim) return;
    try { sim.step(TICK / 1000); }
    catch (e) { console.error('sim step error', room.code, e); }
    for (const ev of sim.drain()) {
      if (ev.to === 'all') broadcast(room, { type: 'ev', ev });
      else { const p = room.players.get(ev.to); if (p) send(p.ws, { type: 'ev', ev }); }
      if (ev.type === 'over') {
        room.state = 'results';
        if (room.crew) {
          const c = recordHeist(room.crew.name, ev.over);
          if (c) broadcast(room, { type: 'crew', crew: publicCrew(c) });
        }
      }
    }
    tick++;
    broadcast(room, { type: 'snap', s: sim.snapshot() });
    if (sim.over && tick % 20 === 0) { clearInterval(room.timer); room.timer = null; }
  }, TICK);
}

function validateStart(room) {
  const ps = [...room.players.values()];
  if (ps.some((p) => !p.role)) return 'Everyone needs a role first.';
  if (room.practice) return null;
  if (ps.length < 3) return 'Need 3-4 players (or turn on Practice).';
  if (!ps.some((p) => p.role === 'overwatch')) return 'Someone has to be Overwatch.';
  return null;
}

function randomizeRoles(room) {
  const ps = [...room.players.values()];
  const shuffled = ps.map((p) => [crypto.randomInt(1e9), p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const field = ROLE_ORDER.filter((r) => r !== 'overwatch').map((r) => [crypto.randomInt(1e9), r]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const roles = ['overwatch', ...field];
  shuffled.forEach((p, i) => { p.role = roles[i] || null; });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  const c = { id: crypto.randomBytes(5).toString('hex'), ws, room: null, name: 'Crew' };
  clients.set(c.id, c);
  send(ws, { type: 'hello', id: c.id });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const room = c.room ? rooms.get(c.room) : null;
    const me = room ? room.players.get(c.id) : null;
    const isHost = room && room.host === c.id;

    switch (m.type) {
      case 'create': {
        if (room) leaveRoom(c);
        c.name = String(m.name || 'Crew').slice(0, 18) || 'Crew';
        const code = newCode();
        const r = { code, host: c.id, players: new Map(), state: 'lobby', practice: false, crew: null, sim: null, timer: null };
        r.players.set(c.id, { id: c.id, name: c.name, role: null, ws });
        rooms.set(code, r);
        c.room = code;
        pushLobby(r);
        return;
      }
      case 'join': {
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) { send(ws, { type: 'error', text: 'No crew room with that code.' }); return; }
        if (r.players.size >= 4) { send(ws, { type: 'error', text: 'That room is full (4 players).' }); return; }
        if (r.state === 'game') { send(ws, { type: 'error', text: 'That heist is already underway.' }); return; }
        if (room) leaveRoom(c);
        c.name = String(m.name || 'Crew').slice(0, 18) || 'Crew';
        r.players.set(c.id, { id: c.id, name: c.name, role: null, ws });
        c.room = r.code;
        pushLobby(r);
        return;
      }
      case 'leave': if (room) leaveRoom(c); return;
      case 'rtc': {
        if (!room) return;
        const to = room.players.get(m.to);
        if (to) send(to.ws, { type: 'rtc', from: c.id, data: m.data });
        return;
      }
    }

    if (!room || !me) return;

    if (room.state !== 'game') {
      switch (m.type) {
        case 'role': {
          const r = m.role;
          if (r !== null && !ROLE_ORDER.includes(r)) return;
          if (r && [...room.players.values()].some((p) => p.role === r && p.id !== c.id)) {
            send(ws, { type: 'error', text: 'Someone already has that role.' });
            return;
          }
          me.role = r;
          pushLobby(room);
          return;
        }
        case 'randomize': if (isHost) { randomizeRoles(room); pushLobby(room); } return;
        case 'practice': if (isHost) { room.practice = !!m.on; pushLobby(room); } return;
        case 'crew': {
          if (!isHost) return;
          const res = loginCrew(m.name, m.pass);
          if (res.error) { send(ws, { type: 'error', text: res.error }); return; }
          room.crew = res.crew;
          broadcast(room, { type: 'toast', text: res.created ? `New crew "${res.crew.name}" founded.` : `Welcome back, ${res.crew.name}.` });
          pushLobby(room);
          return;
        }
        case 'start': {
          if (!isHost) return;
          const err = validateStart(room);
          if (err) { send(ws, { type: 'error', text: err }); return; }
          startGame(room);
          return;
        }
        case 'again': {
          if (!isHost) return;
          room.state = 'lobby'; room.sim = null;
          clearInterval(room.timer); room.timer = null;
          pushLobby(room);
          return;
        }
      }
      return;
    }

    if (m.type === 'abort' && isHost && room.sim && !room.sim.over) { room.sim.finish('caught', 'The host called off the job.'); return; }
    if (room.sim) { try { room.sim.input(c.id, m); } catch (e) { console.error('sim input error', m.type, e); } }
  });

  ws.on('close', () => { leaveRoom(c); clients.delete(c.id); });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`In Broad Daylight running on http://localhost:${PORT}`));
