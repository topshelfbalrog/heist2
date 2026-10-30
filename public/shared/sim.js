// Authoritative heist simulation. Runs on the server, or in the browser for solo practice.
import { hasLOS, inRect, yawTo, angDiff, doorBox } from './geom.js';
import { makeRng } from './rng.js';
import { makeWireInstance, floorOf, tileArmed, mazeMoves, breakerEntry } from './gen.js';
import { TRAITS, CHATTER, EVENTS, WEAPONS, BLEED_OUT, LOSE_T, SEAL_T, SEAL_CD, CUT_T, CUT_CD, OUTFITS_PER_LOCKER, FIRST_NAMES, LAST_NAMES, PROTOCOL_LINES } from './data.js';

export const FLAGS = { SPRINT: 1, CROUCH: 2, WEAPON: 4, INTERACT: 8, SILENT: 16, TALK: 32, WHISPER: 64, RADIO: 128, MOVING: 256 };
export const GSTATE = ['patrol', 'investigate', 'alert', 'down', 'conned', 'distracted'];
const STRIKE_COST = 4;
const PROTOCOL_TIME = 420;

// ---------- Navigation grid (one per floor) ----------
function buildNav(L, F) {
  const minX = F.x1, maxX = F.x2, minZ = F.z1, maxZ = F.z2;
  const cs = 0.5;
  const nx = Math.ceil((maxX - minX) / cs), nz = Math.ceil((maxZ - minZ) / cs);
  const block = new Uint8Array(nx * nz);
  const inf = 0.38;
  const markBox = (b) => {
    if (b.x2 < minX || b.x1 > maxX || b.z2 < minZ || b.z1 > maxZ) return;
    const i1 = Math.max(0, Math.floor((b.x1 - inf - minX) / cs)), i2 = Math.min(nx - 1, Math.floor((b.x2 + inf - minX) / cs));
    const j1 = Math.max(0, Math.floor((b.z1 - inf - minZ) / cs)), j2 = Math.min(nz - 1, Math.floor((b.z2 + inf - minZ) / cs));
    for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
      const cx = minX + (i + 0.5) * cs, cz = minZ + (j + 0.5) * cs;
      if (cx > b.x1 - inf && cx < b.x2 + inf && cz > b.z1 - inf && cz < b.z2 + inf) block[j * nx + i] = 1;
    }
  };
  for (const w of L.walls) markBox(w);
  for (const s of L.solids) markBox(s);
  for (const c of L.circles) markBox({ x1: c.x - c.r, x2: c.x + c.r, z1: c.z - c.r, z2: c.z + c.r });
  return { minX, minZ, cs, nx, nz, block };
}

function navFree(nav, i, j) {
  return i >= 0 && j >= 0 && i < nav.nx && j < nav.nz && !nav.block[j * nav.nx + i];
}
function cellOf(nav, x, z) { return [Math.floor((x - nav.minX) / nav.cs), Math.floor((z - nav.minZ) / nav.cs)]; }
function nearestFree(nav, i, j) {
  if (navFree(nav, i, j)) return [i, j];
  for (let r = 1; r < 8; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (navFree(nav, i + di, j + dj)) return [i + di, j + dj];
    }
  }
  return null;
}
function lineFree(nav, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d / 0.25);
  for (let k = 0; k <= n; k++) {
    const t = k / Math.max(1, n);
    const [i, j] = cellOf(nav, ax + (bx - ax) * t, az + (bz - az) * t);
    if (!navFree(nav, i, j)) return false;
  }
  return true;
}

export function findPath(nav, sx, sz, tx, tz) {
  const s = nearestFree(nav, ...cellOf(nav, sx, sz));
  const g = nearestFree(nav, ...cellOf(nav, tx, tz));
  if (!s || !g) return null;
  const N = nav.nx * nav.nz;
  const start = s[1] * nav.nx + s[0], goal = g[1] * nav.nx + g[0];
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [];
  const push = (node, f) => {
    heap.push([f, node]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const h = (n) => { const i = n % nav.nx, j = (n / nav.nx) | 0; const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  gScore[start] = 0; push(start, h(start));
  let found = false, iter = 0;
  while (heap.length && iter++ < 40000) {
    const [, cur] = pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % nav.nx, cj = (cur / nav.nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!navFree(nav, ni, nj)) continue;
      if (di && dj && (!navFree(nav, ci + di, cj) || !navFree(nav, ci, cj + dj))) continue;
      const nn = nj * nav.nx + ni;
      const cost = gScore[cur] + (di && dj ? 1.414 : 1);
      if (cost < gScore[nn]) { gScore[nn] = cost; came[nn] = cur; push(nn, cost + h(nn)); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let n = goal; n !== -1; n = came[n]) cells.push(n);
  cells.reverse();
  const pts = cells.map((n) => ({ x: nav.minX + ((n % nav.nx) + 0.5) * nav.cs, z: nav.minZ + (((n / nav.nx) | 0) + 0.5) * nav.cs }));
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !lineFree(nav, pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
    out.push(pts[b]); a = b;
  }
  out[out.length - 1] = { x: tx, z: tz };
  if (!navFree(nav, ...cellOf(nav, tx, tz))) out[out.length - 1] = pts[pts.length - 1];
  return out;
}

// ---------- Simulation ----------
export class HeistSim {
  constructor(level, roster, opts = {}) {
    this.L = level;
    this.t = 0;
    this.over = null;
    this.out = [];
    this.practice = !!opts.practice;
    this.blind = !!opts.blind; // debug: guards and cameras see nothing
    this.R = makeRng((level.seed ^ 0x51515) >>> 0);
    this.DI = level.doorIdx;
    this.players = new Map();
    let si = 0;
    for (const p of roster) {
      const sp = level.spawn[si++ % level.spawn.length];
      this.players.set(p.id, {
        id: p.id, name: p.name, role: p.role, x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, f: 0,
        hp: 3, down: false, susp: 0, keycard: false, overrideKey: false, inVent: false, ventT: 0, ventTo: null,
        abilityCd: 0, silentT: 0, spotCd: 0, tileCd: 0, speed: 0, lastT: 0, zone: 'plaza', blended: false,
        stats: { takedowns: 0, kills: 0, solves: 0, spotted: 0, cons: 0, shots: 0, revives: 0, peakSusp: 0 },
        dead: false, bleed: 0, made: false, lostT: 0, marked: false, outfit: 0, relayT: 0,
      });
    }
    this.doors = level.doors.map((d) => ({ open: d.open, locked: d.locked, guardT: 0, override: false }));
    this.guardDefs = level.guards.slice();
    this.guards = level.guards.map((g) => this.makeGuard(g));
    this.cams = level.cams.map(() => ({ loop: 0, off: 0 }));
    this.heat = 0; this.intel = 0; this.intelEarned = 0; this.strikesUsed = 0;
    this.lights = {};
    this.surgeT = 0;
    this.puzzle = {
      glyphStep: 0, glyphStrikes: 0, glyphSolved: false,
      wireAttempt: 0, wire: makeWireInstance(level.seed, 0, level.wireBook), wireSolved: false, wireLockT: 0,
      passSolved: false, passStrikes: 0,
      simonSolved: false, simonStage: 1, simonIdx: 0, simonStrikes: 0, simonFlashT: 0,
      morseSolved: false, morseStrikes: 0,
      mazeSolved: false, mazePos: level.maze.start.slice(), mazeStrikes: 0,
      vaultCode: false, vaultStrikes: 0, keyInserted: false, turns: {}, timelock: null, vaultOpen: false,
    };
    this.deepCams = false;
    this.prize = { holder: null, x: level.deep.b2, y: 1.25, z: 43, inVault: true };
    this.cashTaken = new Set();
    this.loot = 0;
    this.radio = [];
    this.radioId = 0;
    this.nextChatter = 14;
    this.events = level.events.map((e) => ({ ...e, warned: false, fired: false }));
    this.reinforce = 0;
    this.laserCd = 0; this.loudCd = 0; this.huntT = 0;
    this.navs = level.floors.map((F) => buildNav(level, F));
    this.tags = new Set();
    this.bodies = new Set();
    this.milestones = new Set();
    this.pendingCon = new Map();
    this.protocol = null;
    this.getaway = null;
    this.seals = new Map(); // door index -> seconds left
    this.owCd = { seal: 0, cut: 0 };
    this.wardrobes = {};
    for (const it of level.interact) if (it.kind === 'wardrobe') this.wardrobes[it.id] = OUTFITS_PER_LOCKER;
  }

  makeGuard(def) {
    return {
      id: def.id, def, kind: def.kind, x: def.spawn.x, z: def.spawn.z, yaw: 0, state: 'patrol',
      wp: 0, path: null, pi: 0, wait: 0, look: 0, target: null, lastKnown: null, lostT: 0,
      fireCd: 1, hits: 0, stunT: 0, tied: false, conT: 0, distractT: 0, distractAt: null, watchT: 0,
      keycard: !!def.keycard, invT: 0, invAt: null, repathT: 0, range: def.range || 11, fov: def.fov || 1.65,
      speedMul: def.speedMul || 1, immuneCon: !!def.immuneCon, moving: false, floor: floorOf(this.L, def.spawn.x),
    };
  }

  emit(type, data = {}, to = 'all') { this.out.push({ to, type, ...data }); }
  drain() { const o = this.out; this.out = []; return o; }
  field() { return [...this.players.values()].filter((p) => p.role !== 'overwatch'); }
  overwatchIds() { return [...this.players.values()].filter((p) => p.role === 'overwatch').map((p) => p.id); }
  toField(type, data) { for (const p of this.field()) this.emit(type, data, p.id); }

  zoneAt(x, z) {
    for (const zn of this.L.zones) if (inRect(x, z, zn)) return zn;
    return null;
  }
  doorsOpen() { return this.doors.map((d, i) => !this.seals.has(i) && (d.open || d.guardT > 0)); }
  door(key) { return this.doors[this.DI[key]]; }

  award(n, reason) {
    this.intel += n; this.intelEarned += n;
    this.emit('intel', { n, reason, total: this.intel });
  }
  strikeCap() { return 2 + (this.intelEarned >= 16 ? 1 : 0) + (this.intelEarned >= 26 ? 1 : 0); }

  addHeat(n, why) {
    if (this.over || n <= 0) return;
    const before = this.heat;
    this.heat = Math.min(100, this.heat + n);
    this.emit('heat', { n, why, total: this.heat });
    if (before < 35 && this.heat >= 35 && this.reinforce < 1) { this.reinforce = 1; this.spawnGuard('casino', 'Reinforcement'); this.say('Dispatch: sending an extra unit to the floor. Stay alert.'); }
    if (before < 70 && this.heat >= 70 && this.reinforce < 2) { this.reinforce = 2; this.spawnGuard('boh', 'Reinforcement'); this.spawnGuard('b1', 'Reinforcement'); this.say('Dispatch: back of house and the count level are getting extra units.'); }
    if (this.heat >= 100 && !this.protocol) this.startProtocol('heat');
  }

  say(text, clue = null) {
    const line = { id: ++this.radioId, t: this.t, text, clue: !!clue, until: clue ? clue.until : 0, flagged: false };
    this.radio.push(line);
    if (this.radio.length > 40) this.radio.shift();
    this.emit('radio', { line });
    return line;
  }

  spawnGuard(area, title, extra = {}) {
    const L = this.L;
    let patrol, spawn;
    if (area === 'boh') { patrol = [{ x: -L.W / 2 + 3, z: L.D + 2, wait: 1 }, { x: L.W / 2 - 3, z: L.D + 2, wait: 2 }, { x: L.lx, z: L.D + 2.5, wait: 2 }]; spawn = { x: L.sx, z: L.D + 2 }; }
    else if (area === 'b1') { const X = (x) => x + L.deep.b1; patrol = [{ x: X(-8), z: 6, wait: 2 }, { x: X(0), z: 27.5, wait: 2 }, { x: X(9), z: 28, wait: 2 }]; spawn = { x: X(-8), z: 6 }; }
    else if (area === 'b2') { const X = (x) => x + L.deep.b2; patrol = [{ x: X(-6), z: 32, wait: 2 }, { x: X(6), z: 32, wait: 2 }]; spawn = extra.spawn || { x: X(0), z: 2 }; }
    else {
      const corners = this.R.shuffle(L.corners.filter((c) => c.z > 1.5 && c.z < L.D - 1.5)).slice(0, 5);
      patrol = corners.map((c) => ({ x: c.x, z: c.z, wait: this.R.chance(0.4) ? 2 : 0 }));
      spawn = { x: 0, z: 1.5 };
    }
    if (extra.spawn) spawn = extra.spawn;
    const name = this.R.pick(FIRST_NAMES) + ' ' + this.R.pick(LAST_NAMES);
    const def = { id: this.guardDefs.length, kind: extra.kind || 'guard', area, patrol, name, title, trait: this.R.pick(TRAITS).id, spawn, range: area === 'casino' ? 13 : 10.5, fov: 1.65, ...extra };
    delete def.spawnAt;
    this.guardDefs.push(def);
    const g = this.makeGuard(def);
    this.guards.push(g);
    this.emit('guardAdd', { def });
    return g;
  }

  active(g) { return g.state !== 'down' && !g.tied && g.stunT <= 0; }

  guardSees(g, x, z, opened) {
    if (this.blind || !this.active(g) || g.conT > 0) return false;
    const zn = this.zoneAt(g.x, g.z);
    let range = g.range * (this.heat >= 70 ? 1.15 : 1);
    if (zn && zn.light && this.lights[zn.light] > 0) range = 3.5;
    const dx = x - g.x, dz = z - g.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 1.2 && Math.abs(angDiff(g.yaw, yawTo(g.x, g.z, x, z))) > g.fov / 2) return false;
    return hasLOS(this.L, opened, g.x, g.z, x, z);
  }

  camYaw(i) { const c = this.L.cams[i]; return c.yaw0 + c.sweep * Math.sin((this.t * Math.PI * 2) / c.period); }
  camOnline(i) {
    const c = this.L.cams[i], s = this.cams[i];
    if (s.loop > 0 || s.off > 0 || this.surgeT > 0) return false;
    if (c.deep && !this.deepCams) return false;
    const zn = this.zoneAt(c.x, c.z);
    if (zn && zn.light && this.lights[zn.light] > 0) return false;
    return true;
  }
  camSees(i, x, z, opened) {
    if (this.blind || !this.camOnline(i)) return false;
    const c = this.L.cams[i];
    if (Math.hypot(x - c.x, z - c.z) > c.range) return false;
    if (Math.abs(angDiff(this.camYaw(i), yawTo(c.x, c.z, x, z))) > c.fov / 2 + 0.05) return false;
    return hasLOS(this.L, opened, c.x, c.z, x, z);
  }

  it(id) { return this.L.interact.find((i) => i.id === id); }

  strike(kind, pid, heat, why, x, z) {
    this.addHeat(heat, why);
    const key = kind + 'Strikes';
    this.puzzle[key] = (this.puzzle[key] || 0) + 1;
    if (this.puzzle[key] >= 3) { this.puzzle[key] = 0; this.alarm(x, z, 16, `${why} lockout`); }
    return this.puzzle[key];
  }

  teleport(p, x, z, yaw = 0) {
    p.x = x; p.z = z; p.y = 0; p.lastT = this.t; p.tpT = this.t;
    const zn = this.zoneAt(x, z); p.zone = zn ? zn.name : 'outside';
    this.emit('teleport', { x, y: 0, z, yaw }, p.id);
  }

  // ---------- Inputs ----------
  input(pid, m) {
    const p = this.players.get(pid);
    if (!p || this.over) return;
    const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
    const L = this.L, pz = this.puzzle;
    if (this.getaway && m.type !== 'van' && m.type !== 'ping') return;
    if (p.down && !['state', 'ping', 'tag', 'strike', 'flag', 'override', 'van', 'practiceRole'].includes(m.type)) return;
    switch (m.type) {
      case 'state': {
        if (p.inVent) return;
        const dt = Math.max(0.01, this.t - p.lastT);
        const moved = Math.hypot(m.x - p.x, m.z - p.z);
        if (moved > 12 && this.t - (p.tpT || -9) < 1.0) return; // stale state from before a teleport
        p.speed = p.speed * 0.6 + (moved / dt) * 0.4;
        p.lastT = this.t;
        p.x = m.x; p.y = m.y; p.z = m.z; p.yaw = m.yaw; p.pitch = m.pitch; p.f = m.f | 0;
        break;
      }
      case 'door': {
        const d = L.doors[m.id], ds = this.doors[m.id];
        if (!d || !near(d.x, d.z, 3)) return;
        if (this.seals.has(m.id)) { this.emit('toast', { text: `Overwatch has this door sealed for ${Math.ceil(this.seals.get(m.id))}s.` }, pid); return; }
        if (d.type === 'basic' && !ds.locked) { ds.open = !ds.open; this.emit('door', { id: m.id, open: ds.open }); }
        else if (d.type === 'keycard') {
          if (p.keycard || ds.override || !ds.locked) { ds.locked = false; ds.open = !ds.open; this.emit('door', { id: m.id, open: ds.open }); }
          else this.emit('toast', { text: 'Keycard required. The Floor Manager carries one.' }, pid);
        } else if (d.type === 'elevator') {
          if (this.protocol) this.emit('toast', { text: 'The lift is locked down.' }, pid);
          else if (ds.locked) this.emit('toast', { text: 'Lift locked. Authorize it at the terminal in Security.' }, pid);
          else { ds.open = !ds.open; this.emit('door', { id: m.id, open: ds.open }); }
        } else if (ds.locked) {
          const msg = { vault: 'Sealed. Code, two keys, then the time lock.', glyph: 'Locked. The keypad beside the door opens it.', shutter: 'The loading bay shutter only opens from the security console.' };
          this.emit('toast', { text: msg[d.type] || 'Locked.' }, pid);
        }
        break;
      }
      case 'glyph': {
        const it = this.it('glyphPad');
        if (pz.glyphSolved || !near(it.x, it.z, 2.6)) return;
        if (m.g === L.glyph.order[pz.glyphStep]) {
          pz.glyphStep++;
          this.emit('glyphOk', { step: pz.glyphStep });
          if (pz.glyphStep >= 4) {
            pz.glyphSolved = true;
            const ds = this.door('staff'); ds.locked = false; ds.open = true;
            p.stats.solves++;
            this.emit('solved', { what: 'glyph', by: pid, text: 'Staff door unlocked.' });
            this.award(2, 'Manual decoded: staff keypad');
          }
        } else {
          pz.glyphStep = 0;
          const n = this.strike('glyph', pid, 6, 'Staff keypad error', it.x, it.z);
          this.emit('glyphBad', { strikes: n });
        }
        break;
      }
      case 'wire': {
        const it = this.it('wirePanel');
        if (pz.wireSolved || pz.wireLockT > 0 || !near(it.x, it.z, 2.6)) return;
        if (m.i === pz.wire.solution) {
          pz.wireSolved = true;
          p.stats.solves++;
          const code = L.vaultCode;
          this.emit('wireOk', { prefix: [code[0], code[1]] }, pid);
          this.emit('solved', { what: 'wire', by: pid, text: 'Vault controller rebooted. The vault keypad is live.' });
          for (const oid of this.overwatchIds()) this.emit('vaultSuffix', { suffix: [code[2], code[3]] }, oid);
          this.say(`[VAULT CTRL] Reboot complete. Rotation suffix ${code[2]}${code[3]}.`);
          this.award(2, 'Manual decoded: junction panel');
        } else {
          pz.wireLockT = 4; pz.wireAttempt++;
          this.emit('wireBad', {});
          this.alarm(it.x, it.z, 20, 'Junction panel tamper alarm');
        }
        break;
      }
      case 'pass': {
        const it = this.it('passTerm');
        if (pz.passSolved || !near(it.x, it.z, 2.6)) return;
        if (String(m.word || '').toUpperCase() === L.password.answer) {
          pz.passSolved = true;
          p.stats.solves++;
          const ds = this.door('elevator'); ds.locked = false; ds.open = true;
          this.emit('solved', { what: 'pass', by: pid, text: 'Service lift authorized. It goes down to B1.' });
          this.award(2, 'Manual decoded: lift password');
        } else {
          const n = this.strike('pass', pid, 6, 'Lift terminal login failure', it.x, it.z);
          this.emit('passBad', { strikes: n }, pid);
        }
        break;
      }
      case 'simon': {
        const it = this.it('simonRack');
        if (pz.simonSolved || !near(it.x, it.z, 2.6)) return;
        const S = L.simon;
        const table = (S.vowel ? S.tables.vowel : S.tables.none)[Math.min(2, pz.simonStrikes)];
        const want = table[S.seq[pz.simonIdx]];
        if (m.c === want) {
          pz.simonIdx++;
          if (pz.simonIdx >= pz.simonStage) {
            pz.simonStage++; pz.simonIdx = 0;
            if (pz.simonStage > S.stages) {
              pz.simonSolved = true; this.deepCams = true;
              p.stats.solves++;
              this.emit('solved', { what: 'simon', by: pid, text: 'Camera server synced. Overwatch now has eyes on B1 and B2.' });
              this.award(2, 'Manual decoded: camera server');
            } else this.emit('simonStage', { stage: pz.simonStage });
          }
        } else {
          pz.simonIdx = 0;
          const n = this.strike('simon', pid, 5, 'Camera server handshake failure', it.x, it.z);
          pz.simonStrikes = n; // strikes change the color table, like the manual says
          this.emit('simonBad', { strikes: pz.simonStrikes });
        }
        break;
      }
      case 'tx': {
        const it = this.it('morseSafe');
        if (pz.morseSolved || !near(it.x, it.z, 2.6)) return;
        if (m.freq === L.morse.freq) {
          pz.morseSolved = true;
          p.overrideKey = true;
          p.stats.solves++;
          this.emit('solved', { what: 'morse', by: pid, text: `${p.name} opened the count room safe and took the vault override key.` });
          this.award(2, 'Manual decoded: safe frequency');
        } else {
          const n = this.strike('morse', pid, 6, 'Safe receiver mismatch', it.x, it.z);
          this.emit('morseBad', { strikes: n }, pid);
        }
        break;
      }
      case 'maze': {
        const it = this.it('mazeLock');
        if (pz.mazeSolved || !near(it.x, it.z, 2.6)) return;
        const d = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] }[m.dir];
        if (!d) return;
        const mz = L.maze.mazes[L.maze.which];
        const [x, y] = pz.mazePos;
        const nx = x + d[0], ny = y + d[1];
        if (mazeMoves(mz, x, y).some(([a, b]) => a === nx && b === ny)) {
          pz.mazePos = [nx, ny];
          if (nx === L.maze.target[0] && ny === L.maze.target[1]) {
            pz.mazeSolved = true;
            p.stats.solves++;
            this.emit('solved', { what: 'maze', by: pid, text: 'Hatch unlocked. The way down to B2 is open.' });
            this.award(2, 'Manual decoded: hatch maze');
          }
        } else {
          const n = this.strike('maze', pid, 4, 'Hatch tumbler jam', it.x, it.z);
          this.emit('mazeBump', { strikes: n }, pid);
        }
        break;
      }
      case 'vault': {
        const it = this.it('vaultPad');
        if (pz.vaultCode || !near(it.x, it.z, 2.6)) return;
        if (!pz.wireSolved) { this.emit('toast', { text: 'Keypad is dead. The vault controller in Security needs a reboot.' }, pid); return; }
        const ok = Array.isArray(m.code) && m.code.length === 4 && m.code.every((d, i) => d === L.vaultCode[i]);
        if (ok) {
          pz.vaultCode = true;
          p.stats.solves++;
          this.emit('solved', { what: 'vault', by: pid, text: 'Code accepted. Insert the override key at console A, then turn both keys together.' });
          this.award(1, 'Vault code accepted');
        } else {
          const n = this.strike('vault', pid, 8, 'Vault code error', it.x, it.z);
          this.emit('vaultBad', { strikes: n }, pid);
        }
        break;
      }
      case 'key': {
        const it = this.it(m.console === 'A' ? 'keyA' : 'keyB');
        if (!it || !near(it.x, it.z, 2.4) || pz.timelock != null || pz.vaultOpen) return;
        if (!pz.vaultCode) { this.emit('toast', { text: 'The key consoles wake up after the vault code is accepted.' }, pid); return; }
        if (m.console === 'A' && !pz.keyInserted) {
          if (p.overrideKey) { pz.keyInserted = true; p.overrideKey = false; this.emit('toast', { text: 'Override key inserted in console A. Now turn both keys together.' }); }
          else this.emit('toast', { text: 'Console A needs the override key from the count room safe.' }, pid);
          return;
        }
        if (!pz.keyInserted) { this.emit('toast', { text: 'Console A has no override key yet.' }, pid); return; }
        pz.turns[m.console] = this.t;
        const other = m.console === 'A' ? 'B' : 'A';
        const solo = this.practice && this.field().length < 2;
        if (solo || (pz.turns[other] != null && Math.abs(this.t - pz.turns[other]) <= 1.5)) this.startTimelock();
        else this.emit('keyTurn', { console: m.console, text: `Key ${m.console} turned. Both keys must turn within a second and a half.` });
        break;
      }
      case 'take': {
        if (m.what === 'prize') {
          const pr = this.prize;
          if (pr.holder || !pz.vaultOpen || !near(pr.x, pr.z, 2.4)) return;
          pr.holder = pid; pr.inVault = false;
          this.emit('prize', { holder: pid, text: `${p.name} has ${L.prize.name}.` });
          if (!this.protocol) this.startProtocol('prize');
        } else if (m.what === 'cash') {
          const c = L.cash[m.id];
          if (!c || this.cashTaken.has(c.id) || !near(c.x, c.z, 2.4)) return;
          this.cashTaken.add(c.id); this.loot += c.value;
          this.emit('cash', { id: c.id, by: pid, value: c.value, total: this.loot });
        }
        break;
      }
      case 'ride': {
        const it = this.it(m.id);
        if (!it || it.kind !== 'elevator' || !near(it.x, it.z, 2.6)) return;
        if (this.protocol) { this.emit('toast', { text: 'The lift is locked down. Take the fire stairs.' }, pid); return; }
        if (!pz.passSolved) { this.emit('toast', { text: 'The lift is not authorized yet.' }, pid); return; }
        const fromZone = it.floor === 0 ? 'elevator' : 'b1car';
        const from = L.zones.find((z) => z.name === fromZone), to = L.zones.find((z) => z.name === (it.floor === 0 ? 'b1car' : 'elevator'));
        const riders = this.field().filter((q) => !q.inVent && inRect(q.x, q.z, from));
        for (const q of riders) {
          const rx = q.x - (from.x1 + from.x2) / 2, rz = q.z - from.z1;
          const tx = (to.x1 + to.x2) / 2 + Math.max(-1.3, Math.min(1.3, rx));
          const tz = to.z1 + Math.max(0.8, Math.min(3.2, rz));
          this.emit('ride', { down: it.floor === 0 }, q.id);
          this.teleport(q, tx, tz, it.floor === 0 ? Math.PI : 0);
        }
        if (it.floor === 0) { this.door('elevator').open = false; }
        else this.door('elevator').open = true;
        break;
      }
      case 'stairs': {
        const it = this.it(m.id);
        if (!it || it.kind !== 'stairs' || !near(it.x, it.z, 2.4)) return;
        const to = this.it(it.to);
        if (!this.protocol) this.alarm(it.x, it.z, 18, 'Fire door alarm');
        const out = this.stairExit(to);
        this.emit('ride', { stairs: true }, pid);
        this.teleport(p, out.x, out.z, out.yaw);
        break;
      }
      case 'hatch': {
        const it = this.it(m.id);
        if (!it || it.kind !== 'descend' || !near(it.x, it.z, 2.4)) return;
        if (!pz.mazeSolved) { this.emit('toast', { text: 'The hatch is locked. Work the lock panel beside it.' }, pid); return; }
        const to = this.it(it.to);
        this.emit('ride', { stairs: true }, pid);
        if (to.id === 'ascend') this.teleport(p, to.x, to.z + 1.6, Math.PI);
        else this.teleport(p, to.x - 1.6, to.z, Math.PI / 2);
        break;
      }
      case 'breaker': {
        const it = this.it(m.id);
        if (!it || it.kind !== 'breaker' || !near(it.x, it.z, 2.4)) return;
        if (!this.protocol) { this.emit('toast', { text: 'Emergency breaker. It only does something during a lockdown.' }, pid); return; }
        const panel = L.breakers.panels.find((b) => b.id === m.id);
        if (!this.protocol.flipped[m.id]) {
          this.protocol.flipped[m.id] = true;
          this.emit('breakerFlip', { id: m.id });
        }
        this.toField('breakerOpen', { id: m.id, color: panel.color, phase: panel.phase, code: panel.code, by: pid });
        break;
      }
      case 'override': {
        if (p.role !== 'overwatch' && !(this.practice && this.overwatchIds().length === 0)) return;
        const pr = this.protocol;
        if (!pr || pr.shutterOpen) return;
        const color = L.breakers.order[pr.idx];
        const panel = L.breakers.panels.find((b) => b.color === color);
        if (!pr.flipped[panel.id]) { this.emit('toast', { text: `The ${color} breaker hasn't been flipped yet. The console can't see it.` }, pid); return; }
        const want = breakerEntry(panel.code, panel.phase);
        const ok = Array.isArray(m.code) && m.code.length === 4 && m.code.every((d, i) => d === want[i]);
        if (ok) {
          pr.idx++;
          this.emit('overrideOk', { idx: pr.idx, color });
          if (pr.idx >= 3) {
            pr.shutterOpen = true;
            const ds = this.door('shutter'); ds.locked = false; ds.open = true;
            this.emit('solved', { what: 'shutter', text: 'Loading bay shutter is open. Everyone to the van!' });
            this.say('[BUILDING CTRL] Loading bay shutter released. Manual override.');
          }
        } else {
          pr.t -= 12;
          this.emit('overrideBad', { color, penalty: 12 });
        }
        break;
      }
      case 'van': {
        const g = this.getaway;
        if (!g || pid !== g.driver) return;
        if ([m.x, m.z, m.yaw, m.speed].some((v) => typeof v !== 'number' || !isFinite(v))) return;
        g.van = { x: m.x, z: m.z, yaw: m.yaw, speed: m.speed };
        break;
      }
      case 'vent': {
        const it = this.it(m.id);
        if (!it || p.role !== 'infiltrator' || !near(it.x, it.z, 2.2) || p.inVent) return;
        const to = this.it(it.to);
        p.inVent = true; p.ventT = 2.4; p.ventTo = to;
        this.emit('vent', { pid, from: it.id, to: to.id });
        break;
      }
      case 'silent': {
        if (p.role !== 'infiltrator' || p.abilityCd > 0) return;
        p.silentT = 6; p.abilityCd = 20;
        this.emit('ability', { pid, kind: 'silent', cd: 20, dur: 6 });
        break;
      }
      case 'loop': {
        const c = L.cams[m.cam];
        if (p.role !== 'hacker' || p.abilityCd > 0 || !c) return;
        if (Math.hypot(p.x - c.x, p.z - c.z) > 38) return;
        this.cams[m.cam].loop = 20; p.abilityCd = 40;
        this.emit('ability', { pid, kind: 'loop', cam: m.cam, cd: 40, dur: 20, text: `${c.label} feed looped for 20s.` });
        break;
      }
      case 'con': {
        const g = this.guards[m.gid];
        if (p.role !== 'face' || p.abilityCd > 0 || !g || !this.active(g) || g.state === 'alert') return;
        if (Math.hypot(p.x - g.x, p.z - g.z) > 3.4) return;
        if (g.immuneCon) {
          p.abilityCd = 10;
          this.emit('conResult', { ok: false, gid: g.id, text: `${g.def.name}: "Nice try. Move along."` }, pid);
          p.susp = Math.min(100, p.susp + 20);
          return;
        }
        const trait = TRAITS.find((t) => t.id === g.def.trait);
        const wrong = this.R.shuffle(TRAITS.filter((t) => t.id !== trait.id)).slice(0, 2);
        const lines = this.R.shuffle([trait, ...wrong]);
        this.pendingCon.set(pid, { gid: g.id, correct: lines.indexOf(trait), until: this.t + 20 });
        g.conT = 20; g.yaw = yawTo(g.x, g.z, p.x, p.z);
        this.emit('conOptions', { gid: g.id, name: g.def.name, title: g.def.title || 'Security', lines: lines.map((l) => l.line) }, pid);
        break;
      }
      case 'conPick': {
        const pc = this.pendingCon.get(pid);
        if (!pc) return;
        this.pendingCon.delete(pid);
        const g = this.guards[pc.gid];
        if (!g || !this.active(g)) return;
        if (m.i === pc.correct) {
          p.stats.cons++;
          g.conT = 25;
          let text = `${g.def.name} bought it and is looking the other way.`;
          if (g.keycard) { g.keycard = false; p.keycard = true; text = `${g.def.name} handed over the Security keycard.`; }
          p.abilityCd = 30;
          this.emit('conResult', { ok: true, gid: g.id, text }, pid);
          this.emit('toast', { text: `Face conned ${g.def.name}.` });
        } else {
          g.conT = 0; g.watchT = 12;
          p.susp = Math.min(100, p.susp + 35);
          p.abilityCd = 20;
          this.emit('conResult', { ok: false, gid: g.id, text: `${g.def.name} isn't buying it, and is watching you now.` }, pid);
        }
        break;
      }
      case 'conCancel': {
        const pc = this.pendingCon.get(pid);
        if (pc) { this.pendingCon.delete(pid); const g = this.guards[pc.gid]; if (g) g.conT = 0; }
        break;
      }
      case 'shot': {
        const w = WEAPONS[m.weapon];
        if (!w || p.down) return;
        p.stats.shots++;
        if (m.gid != null) {
          const g = this.guards[m.gid];
          if (g && this.active(g)) {
            const armor = g.def.armor || 1;
            const need = Math.ceil((g.state === 'alert' ? w.koAlert : w.koUnaware) * armor);
            g.hits++;
            if (g.hits >= need) this.kill(g, p);
            else this.alertOn(g, p);
          }
        }
        if (w.loud > 0) {
          this.noise(p.x, p.z, w.loud, p);
          const zn = this.zoneAt(p.x, p.z);
          if (zn && (zn.name === 'casino' || zn.name === 'bar' || zn.name === 'cage')) this.emit('panic', { x: p.x, z: p.z });
          if (this.loudCd <= 0) { this.loudCd = 3; this.addHeat(6, 'Gunfire'); }
        }
        break;
      }
      case 'takedown': {
        const g = this.guards[m.gid];
        if (!g || !this.active(g) || g.state === 'alert' || g.def.armor) return;
        if (Math.hypot(p.x - g.x, p.z - g.z) > 2.1) return;
        const behind = Math.abs(angDiff(g.yaw, yawTo(g.x, g.z, p.x, p.z))) > 1.7;
        if (!behind && g.conT <= 0) { this.emit('toast', { text: 'Get behind them first.' }, pid); return; }
        this.kill(g, p, true);
        this.emit('takedown', { gid: g.id, by: pid });
        break;
      }
      case 'hide': {
        const g = this.guards[m.gid];
        if (!g || !g.dead || g.hidden || Math.hypot(p.x - g.x, p.z - g.z) > 2.2) return;
        const zn = this.zoneAt(g.x, g.z);
        if (zn && !zn.restricted) { this.emit('toast', { text: 'Nowhere to stash a body on the public floor.' }, pid); return; }
        if (g.keycard) { g.keycard = false; p.keycard = true; this.emit('toast', { text: 'You lifted the Security keycard first.' }); }
        g.hidden = true; this.bodies.add(g.id);
        this.emit('hidden', { gid: g.id, by: pid });
        this.emit('toast', { text: `${g.def.name}'s body is stashed out of sight.` }, pid);
        break;
      }
      case 'outfit': {
        const it = this.it(m.id);
        if (!it || it.kind !== 'wardrobe' || !near(it.x, it.z, 2.4)) return;
        if (!this.wardrobes[it.id]) { this.emit('toast', { text: 'Nothing left in here that fits.' }, pid); return; }
        const opened = this.doorsOpen();
        const watcher = this.guards.find((g) => this.guardSees(g, p.x, p.z, opened));
        if (watcher || L.cams.some((c, i) => this.camSees(i, p.x, p.z, opened))) { this.emit('toast', { text: 'Not while someone is watching. Get out of sight first.' }, pid); return; }
        this.wardrobes[it.id]--;
        p.outfit++; p.made = false; p.marked = false; p.lostT = 0; p.susp = 0;
        for (const g of this.guards) if (g.target === p.id) { g.target = null; if (this.active(g)) this.investigate(g, g.lastKnown ? g.lastKnown.x : g.x, g.lastKnown ? g.lastKnown.z : g.z, 6); }
        this.emit('outfit', { pid, id: it.id, left: this.wardrobes[it.id], text: `${p.name} changed clothes. Security is looking for someone else now.` });
        break;
      }
      case 'loot': {
        const g = this.guards[m.gid];
        if (!g || g.state !== 'down' || !g.keycard || Math.hypot(p.x - g.x, p.z - g.z) > 2.2) return;
        g.keycard = false; p.keycard = true;
        this.emit('toast', { text: 'You lifted the Security keycard.' });
        break;
      }
      case 'revive': {
        const tp = this.players.get(m.pid);
        if (!tp || !tp.down || Math.hypot(p.x - tp.x, p.z - tp.z) > 2.6 || p.down) return;
        if (tp.dead) { this.emit('toast', { text: `${tp.name} is gone. Nothing you can do.` }, pid); return; }
        tp.down = false; tp.hp = 2; tp.bleed = 0;
        p.stats.revives++;
        this.emit('revived', { pid: tp.id, by: pid });
        break;
      }
      case 'laser': {
        if (this.laserCd > 0) return;
        this.laserCd = 4;
        this.emit('laserTrip', { pid, gate: m.gate });
        this.alarm(L.deep.b2, 6, 18, 'IR grid tripped');
        break;
      }
      // ----- Overwatch -----
      case 'seal': {
        if (p.role !== 'overwatch' && !this.practice) return;
        if (this.owCd.seal > 0) { this.emit('toast', { text: `Door seal recharging: ${Math.ceil(this.owCd.seal)}s.` }, pid); return; }
        const d = L.doors[m.target];
        if (!d || !['basic', 'keycard', 'glyph'].includes(d.type)) { this.emit('toast', { text: 'Only basic, keycard and keypad doors can be sealed.' }, pid); return; }
        const ds = this.doors[m.target];
        ds.open = false; ds.guardT = 0;
        this.seals.set(d.id, SEAL_T);
        this.owCd.seal = SEAL_CD;
        this.emit('door', { id: d.id, open: false });
        this.emit('sealed', { id: d.id, t: SEAL_T, label: d.label });
        this.say(`[BUILDING CTRL] Door fault: ${d.label}. Maintenance notified.`);
        break;
      }
      case 'cut': {
        if (p.role !== 'overwatch' && !this.practice) return;
        if (this.owCd.cut > 0) { this.emit('toast', { text: `Power cut recharging: ${Math.ceil(this.owCd.cut)}s.` }, pid); return; }
        if (!['casino', 'backhouse', 'b1', 'b2'].includes(m.target)) return;
        this.lights[m.target] = Math.max(this.lights[m.target] || 0, CUT_T);
        this.owCd.cut = CUT_CD;
        this.emit('lights', { zone: m.target, t: CUT_T, quick: true });
        break;
      }
      case 'tag': {
        if (p.role !== 'overwatch') return;
        const g = this.guards[m.gid];
        if (!g || this.tags.has(g.id)) return;
        const opened = this.doorsOpen();
        const seen = this.L.cams.some((c, i) => this.camOnline(i) && Math.hypot(g.x - c.x, g.z - c.z) < c.range + 4 && hasLOS(this.L, opened, c.x, c.z, g.x, g.z) && Math.abs(angDiff(this.camYaw(i), yawTo(c.x, c.z, g.x, g.z))) < c.fov / 2 + 0.25);
        if (!seen) { this.emit('toast', { text: 'No camera has eyes on that guard right now.' }, pid); return; }
        this.tags.add(g.id);
        this.award(1, `Tagged ${g.def.name}`);
        this.emit('tagged', { gid: g.id });
        break;
      }
      case 'strike': {
        if (p.role !== 'overwatch') return;
        if (this.intel < STRIKE_COST) { this.emit('toast', { text: `Need ${STRIKE_COST} Intel for a Strike.` }, pid); return; }
        if (this.strikesUsed >= this.strikeCap()) { this.emit('toast', { text: 'No Strikes left this run.' }, pid); return; }
        if (m.kind === 'siren') {
          const b = L.slotBanks[m.target];
          if (!b) return;
          let n = 0;
          for (const g of this.guards) {
            if (!this.active(g) || g.state === 'alert' || Math.hypot(g.x - b.x, g.z - b.z) > 20) continue;
            g.distractT = 14; g.distractAt = { x: b.x, z: b.z + 2 }; g.path = null; n++;
          }
          this.emit('jackpot', { bank: b.id, x: b.x, z: b.z, guards: n });
        } else if (m.kind === 'lights') {
          if (!['casino', 'backhouse', 'b1', 'b2'].includes(m.target)) return;
          this.lights[m.target] = 15;
          this.emit('lights', { zone: m.target, t: 15 });
        } else if (m.kind === 'override') {
          const d = L.doors[m.target];
          if (!d || !['basic', 'keycard'].includes(d.type)) { this.emit('toast', { text: 'Override only works on basic and keycard doors.' }, pid); return; }
          const ds = this.doors[m.target];
          ds.locked = false; ds.override = true; ds.open = true;
          this.emit('door', { id: d.id, open: true });
        } else return;
        this.intel -= STRIKE_COST; this.strikesUsed++;
        this.emit('strike', { kind: m.kind, target: m.target, left: this.strikeCap() - this.strikesUsed, intel: this.intel });
        break;
      }
      case 'ping': {
        this.emit('ping', { x: m.x, z: m.z, by: pid, label: (m.label || '').slice(0, 24) });
        break;
      }
      case 'flag': {
        if (p.role !== 'overwatch') return;
        const line = this.radio.find((l) => l.id === m.id);
        if (!line || line.flagged) return;
        line.flagged = true;
        if (line.clue && this.t <= line.until) this.award(1, 'Flagged radio chatter');
        else this.emit('toast', { text: 'Nothing useful in that one.' }, pid);
        this.emit('flagged', { id: line.id, good: line.clue });
        break;
      }
      case 'practiceRole': {
        if (!this.practice) return;
        p.role = m.role;
        if (m.role === 'overwatch') { p.made = false; p.lostT = 0; for (const g of this.guards) if (g.target === p.id) g.target = null; }
        break;
      }
    }
  }

  stairExit(to) {
    // Step out of the stairwell door into the room
    const L = this.L;
    if (to.id === 'stairsG') return { x: to.x - 1.4, z: to.z, yaw: Math.PI / 2 };
    if (to.id === 'stairsB1up' || to.id === 'stairsB1down') return { x: to.x + 1.4, z: to.z, yaw: -Math.PI / 2 };
    if (to.id === 'stairsB2') return { x: to.x + 1.4, z: to.z, yaw: -Math.PI / 2 };
    return { x: to.x, z: to.z, yaw: 0, L };
  }

  startTimelock() {
    const pz = this.puzzle;
    pz.timelock = 45;
    this.emit('timelock', { t: 45, text: 'Both keys turned. The time lock needs 45 seconds. Hold the antechamber!' });
    this.say('[VAULT CTRL] Time lock disengaging. Security: vault level, now!');
    for (const sp of this.L.timelockSpawn) {
      const g = this.spawnGuard('b2', 'Response Team', { kind: 'response', armor: 1.5, speedMul: 1.15, range: 14, spawn: sp });
      const target = this.field().filter((q) => !q.down)[0];
      if (target) this.investigate(g, this.L.deep.b2, 32, 8);
    }
  }

  startProtocol(reason) {
    if (this.protocol) return;
    this.protocol = { t: PROTOCOL_TIME, reason, flipped: {}, idx: 0, shutterOpen: false, lineT: 0, lineIdx: 0 };
    this.heat = 100;
    const ds = this.door('elevator'); ds.open = false; ds.locked = true;
    this.emit('protocol', { reason, t: PROTOCOL_TIME, order: this.L.breakers.order, lethal: true });
    for (const g of this.guards) if (this.active(g)) g.fireCd = Math.max(g.fireCd, 1.2);
    this.say(PROTOCOL_LINES[0]);
    this.protocol.lineIdx = 1;
    // Response team: one per floor, more on the vault level
    for (const sp of this.L.responseSpawn) {
      const area = floorOf(this.L, sp.x) === 2 ? 'b2' : floorOf(this.L, sp.x) === 1 ? 'b1' : 'boh';
      this.spawnGuard(area, 'Response Team', { kind: 'response', armor: 1.5, speedMul: 1.15, range: 14, spawn: sp });
    }
    this.hunt();
  }

  startGetaway() {
    const L = this.L, C = L.city;
    const ow = this.overwatchIds();
    const driver = ow[0] || this.field()[0]?.id;
    const secured = !!this.prize.holder && this.field().some((p) => p.id === this.prize.holder);
    this.getaway = { t: C.time, damage: 0, driver, van: { x: C.start.x, z: C.start.z, yaw: Math.PI, speed: 0 }, trail: [], trailLen: 0, pursuers: [{ d: -1, start: 9 }, { d: -1, start: 16 }], hitCd: 0, secured, elapsed: 0 };
    this.emit('getaway', { driver, t: C.time, secured });
    this.say('[DISPATCH] All units: white linen van fleeing Stanley\'s Palace. Roadblocks are up.');
  }

  alarm(x, z, heat, why) {
    this.addHeat(heat, why);
    this.emit('alarm', { x, z, why });
    this.say(`Security: ${why.toLowerCase()} near ${this.zoneAt(x, z)?.label || 'the floor'}. Checking it out.`);
    const fl = floorOf(this.L, x);
    const gs = this.guards.filter((g) => this.active(g) && g.state !== 'alert' && g.kind !== 'manager' && floorOf(this.L, g.x) === fl)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, 2);
    for (const g of gs) this.investigate(g, x, z, 6);
  }

  hunt() {
    for (const g of this.guards) {
      if (!this.active(g) || g.kind === 'manager' || g.state === 'alert') continue;
      const fl = floorOf(this.L, g.x);
      let best = null, bd = 1e9;
      for (const p of this.field()) {
        if (p.down || p.inVent || floorOf(this.L, p.x) !== fl) continue;
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) this.investigate(g, best.x, best.z, 5);
    }
  }

  noise(x, z, radius, src) {
    const opened = this.doorsOpen();
    for (const g of this.guards) {
      if (!this.active(g) || g.state === 'alert' || g.kind === 'manager') continue;
      if (Math.hypot(g.x - x, g.z - z) > radius) continue;
      if (src && hasLOS(this.L, opened, g.x, g.z, src.x, src.z)) this.alertOn(g, src);
      else this.investigate(g, x, z, 5);
    }
  }

  knockout(g, by) {
    g.state = 'down'; g.stunT = g.kind === 'response' ? 45 : 90; g.hits = 0; g.conT = 0; g.distractT = 0; g.path = null; g.target = null;
    if (by) by.stats.takedowns++;
    this.emit('ko', { gid: g.id, by: by ? by.id : null });
  }

  alertOn(g, p) {
    if (!this.active(g)) return;
    if (g.kind === 'manager') { this.investigate(g, g.x, g.z, 4); return; }
    const was = g.state === 'alert';
    g.state = 'alert'; g.target = p.id; g.lastKnown = { x: p.x, z: p.z }; g.lostT = 0; g.conT = 0; g.distractT = 0; g.path = null;
    if (!was) {
      g.fireCd = Math.max(g.fireCd, this.protocol ? 0.6 : 1.1); // a beat to react before the first shot
      this.emit('guardAlert', { gid: g.id, pid: p.id });
      this.say(`${g.def.name}: ${this.R.pick(["Armed suspect! Engaging!", "Got one! Shots, shots!", "Hostile in the building! Drop them!"])}`);
    }
    this.setMade(p, g);
  }

  // A player who's been made is shot on sight until they break contact or change clothes.
  setMade(p, by) {
    if (!p || p.down || p.role === 'overwatch') return;
    p.lostT = 0;
    if (p.made) return;
    p.made = true; p.marked = true; p.susp = 100; p.stats.spotted++;
    this.emit('made', { pid: p.id, by: by ? by.id : null, text: `${p.name} has been made! Break line of sight, change clothes, or get Overwatch to seal a door or cut the lights.` });
    // Everyone on the floor gets the radio call
    const fl = floorOf(this.L, p.x);
    const near = this.guards.filter((g) => g !== by && this.active(g) && g.kind !== 'manager' && g.state !== 'alert' && floorOf(this.L, g.x) === fl)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, 2);
    for (const g of near) { g.state = 'alert'; g.target = p.id; g.lastKnown = { x: p.x, z: p.z }; g.lostT = 0; g.conT = 0; g.distractT = 0; g.path = null; g.fireCd = Math.max(g.fireCd, 1.1); }
  }

  sealBlocks(x1, z1, x2, z2) {
    for (const i of this.seals.keys()) {
      const b = doorBox(this.L.doors[i]);
      const pad = 0.35;
      const inB = (x, z) => x > b.x1 - pad && x < b.x2 + pad && z > b.z1 - pad && z < b.z2 + pad;
      if (!inB(x1, z1) && inB(x2, z2)) return true;
      // crossing straight through in one tick
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      if (!inB(x1, z1) && inB(mx, mz)) return true;
    }
    return false;
  }

  investigate(g, x, z, lookT = 5) {
    if (!this.active(g)) return;
    g.state = 'investigate'; g.invAt = { x, z }; g.invT = lookT; g.path = null; g.conT = 0;
  }

  // ---------- Step ----------
  step(dt) {
    if (this.over) return;
    this.t += dt;
    if (this.getaway) { this.stepGetaway(dt); return; }
    const L = this.L, pz = this.puzzle;
    for (const k in this.lights) { this.lights[k] -= dt; if (this.lights[k] <= 0) delete this.lights[k]; }
    if (this.surgeT > 0) this.surgeT -= dt;
    this.laserCd -= dt; this.loudCd -= dt;
    if (pz.wireLockT > 0) {
      pz.wireLockT -= dt;
      if (pz.wireLockT <= 0) { pz.wire = makeWireInstance(L.seed, pz.wireAttempt, L.wireBook); this.emit('wireReset', {}); }
    }
    if (pz.timelock != null) {
      pz.timelock -= dt;
      if (pz.timelock <= 0) {
        pz.timelock = null; pz.vaultOpen = true;
        const ds = this.door('vault'); ds.locked = false; ds.open = true;
        this.emit('solved', { what: 'timelock', text: `The vault is open. ${L.prize.name} is inside.` });
        this.award(2, 'Held the vault');
      }
    }
    for (const c of this.cams) { if (c.loop > 0) c.loop -= dt; if (c.off > 0) c.off -= dt; }
    for (const ds of this.doors) if (ds.guardT > 0) ds.guardT -= dt;
    for (const [i, t] of this.seals) {
      if (t - dt <= 0) { this.seals.delete(i); this.emit('unsealed', { id: i }); } else this.seals.set(i, t - dt);
    }
    if (this.owCd.seal > 0) this.owCd.seal -= dt;
    if (this.owCd.cut > 0) this.owCd.cut -= dt;
    for (const [pid, pc] of this.pendingCon) if (this.t > pc.until) { this.pendingCon.delete(pid); const g = this.guards[pc.gid]; if (g) g.conT = 0; }

    for (const p of this.players.values()) {
      if (p.abilityCd > 0) p.abilityCd -= dt;
      if (p.down && !p.dead && p.bleed > 0) {
        p.bleed -= dt;
        if (p.bleed <= 0) { p.bleed = 0; p.dead = true; this.emit('died', { pid: p.id, text: `${p.name} bled out.` }); }
      }
      if (p.silentT > 0) p.silentT -= dt;
      if (p.spotCd > 0) p.spotCd -= dt;
      if (p.tileCd > 0) p.tileCd -= dt;
      if (p.inVent) {
        p.ventT -= dt;
        if (p.ventT <= 0) { p.inVent = false; this.teleport(p, p.ventTo.x, p.ventTo.z - 1.2, 0); }
      }
      const zn = this.zoneAt(p.x, p.z);
      p.zone = zn ? zn.name : 'outside';
    }

    // Pressure gallery
    const TA = L.tileArea;
    for (const p of this.field()) {
      if (p.down || p.inVent || p.zone !== 'gallery' || p.y > 0.08 || p.tileCd > 0) continue;
      const c = Math.floor((p.x - TA.x1) / TA.size), r = Math.floor((p.z - TA.z1) / TA.size);
      if (c < 0 || r < 0 || c >= TA.cols || r >= TA.rows) continue;
      if (tileArmed(L, this.t, c, r)) {
        p.tileCd = 3;
        this.emit('tileTrip', { pid: p.id, c, r });
        this.alarm(p.x, p.z, 10, 'Pressure sensor tripped');
      }
    }

    // Radio chatter + random events
    if (this.t >= this.nextChatter) {
      this.nextChatter = this.t + this.R.float(22, 38);
      this.say(this.R.pick(CHATTER));
    }
    for (const e of this.events) {
      if (!e.warned && this.t >= e.t - 30) { e.warned = true; this.say(EVENTS[e.key].warn, { until: e.t }); }
      if (!e.fired && this.t >= e.t) { e.fired = true; this.fireEvent(e.key); }
    }

    // Stanley Protocol (lockdown climax)
    const pr = this.protocol;
    if (pr) {
      pr.t -= dt;
      this.huntT -= dt;
      if (this.huntT <= 0) { this.huntT = 6; this.hunt(); }
      pr.lineT -= dt;
      if (pr.lineT <= 0 && pr.lineIdx < PROTOCOL_LINES.length) { pr.lineT = 9; this.say(PROTOCOL_LINES[pr.lineIdx++]); }
      if (pr.t <= 0) { this.finish('caught', 'The Stanley Protocol timer ran out. The building sealed shut.'); return; }
      if (pr.shutterOpen) {
        const standing = this.field().filter((p) => !p.down);
        if (standing.length && standing.every((p) => p.zone === 'dock' && !p.inVent)) { this.startGetaway(); return; }
      }
    }

    const opened = this.doorsOpen();
    for (const g of this.guards) this.stepGuard(g, dt, opened);
    this.stepSuspicion(dt, opened);
    this.stepBodies(opened);
    this.checkMilestones();
  }

  stepGetaway(dt) {
    const g = this.getaway, C = this.L.city;
    g.t -= dt; g.elapsed += dt; g.hitCd -= dt;
    // Trail of the van for pursuers to follow
    const last = g.trail[g.trail.length - 1];
    if (!last || Math.hypot(g.van.x - last.x, g.van.z - last.z) > 1.5) {
      if (last) g.trailLen += Math.hypot(g.van.x - last.x, g.van.z - last.z);
      g.trail.push({ x: g.van.x, z: g.van.z, d: g.trailLen });
      if (g.trail.length > 2000) g.trail.shift();
    }
    for (const rb of C.roadblocks) {
      if (g.hitCd > 0) break;
      if (Math.hypot(g.van.x - rb.x, g.van.z - rb.z) < 6.5) { g.hitCd = 2; this.crash('Roadblock!'); }
    }
    for (const pu of g.pursuers) {
      if (g.elapsed < pu.start) continue;
      if (pu.d < 0) pu.d = Math.max(0, g.trailLen - 70);
      pu.d += 17.5 * dt;
      if (pu.d >= g.trailLen - 5 && g.hitCd <= 0) { g.hitCd = 2; pu.d = Math.max(0, g.trailLen - 60); this.crash('A cruiser rammed the van!'); }
    }
    if (this.over) return;
    if (Math.hypot(g.van.x - C.safe.x, g.van.z - C.safe.z) < 10) { this.finish('escaped', 'Made it to the safehouse.'); return; }
    if (g.t <= 0) this.finish('caught', 'The police closed in before you reached the safehouse.');
  }

  crash(text) {
    const g = this.getaway;
    g.damage++;
    this.emit('crash', { damage: g.damage, text });
    if (g.damage >= 4) this.finish('caught', 'The van is wrecked. The police boxed you in.');
  }

  pursuerPos(pu) {
    const tr = this.getaway.trail;
    if (pu.d < 0 || !tr.length) return null;
    let lo = 0, hi = tr.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tr[mid].d < pu.d) lo = mid + 1; else hi = mid; }
    const b = tr[lo], a = tr[Math.max(0, lo - 1)];
    const u = b.d > a.d ? (pu.d - a.d) / (b.d - a.d) : 0;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: yawTo(a.x, a.z, b.x, b.z) };
  }

  fireEvent(key) {
    const ev = EVENTS[key];
    this.emit('event', { key, name: ev.name, text: ev.toast });
    if (key === 'shift') this.spawnGuard('casino', 'Day Shift');
    else if (key === 'vip') { this.spawnGuard('casino', 'VIP Bodyguard', { speedMul: 1.1 }); this.emit('vip', {}); }
    else if (key === 'surge') { this.surgeT = 8; this.emit('surge', { t: 8 }); }
    else if (key === 'pitboss') this.spawnGuard('casino', 'Pit Boss', { kind: 'pitboss', immuneCon: true, range: 14 });
  }

  stepGuard(g, dt, opened) {
    const L = this.L;
    if (g.tied) return;
    if (g.state === 'down') {
      g.stunT -= dt;
      if (g.stunT <= 0) {
        g.state = 'patrol'; g.hits = 0;
        this.investigate(g, g.x, g.z, 6);
        this.addHeat(5, `${g.def.name} woke up`);
        this.say(`${g.def.name}: Ugh... somebody jumped me! Checking the area.`);
        this.bodies.delete(g.id);
      }
      return;
    }
    if (g.watchT > 0) g.watchT -= dt;
    if (g.conT > 0) { g.conT -= dt; g.moving = false; return; }

    let goal = null, speed = 1.35, faceTarget = null;
    const hurry = (this.protocol ? 1.25 : 1) * (this.heat >= 70 ? 1.1 : 1) * g.speedMul;

    if (g.distractT > 0) {
      g.distractT -= dt;
      goal = g.distractAt; speed = 2.0;
      if (Math.hypot(goal.x - g.x, goal.z - g.z) < 1.5) { goal = null; faceTarget = g.distractAt; }
      if (g.distractT <= 0) { g.path = null; g.state = 'patrol'; }
    } else if (g.state === 'alert') {
      const p = this.players.get(g.target);
      if (!p || p.down || p.inVent || p.role === 'overwatch' || floorOf(L, p.x) !== floorOf(L, g.x)) {
        g.target = null;
        const next = this.field().find((q) => !q.down && !q.inVent && this.guardSees(g, q.x, q.z, opened));
        if (next) this.alertOn(g, next);
        else this.investigate(g, g.lastKnown ? g.lastKnown.x : g.x, g.lastKnown ? g.lastKnown.z : g.z, 6);
        return;
      }
      const sees = this.guardSees(g, p.x, p.z, opened) || (Math.hypot(p.x - g.x, p.z - g.z) < 2.5 && hasLOS(L, opened, g.x, g.z, p.x, p.z));
      if (sees) { g.lastKnown = { x: p.x, z: p.z }; g.lostT = 0; if (!p.made) this.setMade(p, g); }
      else g.lostT += dt;
      if (g.lostT > 6) { this.investigate(g, g.lastKnown.x, g.lastKnown.z, 6); this.say(`${g.def.name}: Lost visual. Sweeping the area.`); return; }
      const d = Math.hypot(p.x - g.x, p.z - g.z);
      goal = d > 3.2 || !sees ? g.lastKnown : null;
      speed = g.kind === 'response' ? 3.8 : 3.4;
      if (sees) faceTarget = p;
      g.repathT -= dt;
      if (g.repathT <= 0) { g.path = null; g.repathT = 0.6; }
      g.fireCd -= dt;
      const resp = g.kind === 'response';
      const range = resp ? 22 : 18;
      if (sees && d < range && g.fireCd <= 0) {
        g.fireCd = (resp ? 0.55 : 0.8) + this.R.float(0, 0.4);
        const evade = (p.f & FLAGS.SPRINT ? 0.2 : 0) + (p.f & FLAGS.CROUCH ? 0.1 : 0) + (d > 8 ? 0.15 : d > 6 ? 0.08 : 0);
        const zn = this.zoneAt(g.x, g.z);
        const dark = zn && zn.light && this.lights[zn.light] > 0 ? 0.2 : 0;
        const base = resp ? 0.55 : 0.45;
        const hit = this.R.chance(base - evade - dark);
        this.emit('taser', { gid: g.id, pid: p.id, hit, lethal: true });
        this.noise(g.x, g.z, 16, null);
        if (this.loudCd <= 0 && zn && ['casino', 'bar', 'cage'].includes(zn.name)) { this.loudCd = 3; this.emit('panic', { x: g.x, z: g.z }); }
        if (hit) { p.hp--; if (p.hp <= 0) this.downPlayer(p); }
      }
    } else if (g.state === 'investigate') {
      goal = g.invAt; speed = 2.2;
      if (Math.hypot(goal.x - g.x, goal.z - g.z) < 1.0) {
        goal = null;
        g.invT -= dt;
        g.look += dt;
        g.yaw += Math.sin(g.look * 1.6) * dt * 1.6;
        if (g.invT <= 0) { g.state = 'patrol'; g.path = null; g.wp = this.nearestWp(g); }
      }
    } else {
      const pts = g.def.patrol;
      const wp = pts[g.wp % pts.length];
      goal = wp; speed = g.kind === 'response' ? 2.4 : 1.35;
      if (Math.hypot(wp.x - g.x, wp.z - g.z) < 0.6) {
        goal = null;
        if (g.wait <= 0 && !g.arrived) { g.wait = wp.wait || 0; g.arrived = true; g.look = 0; g.lookBase = g.yaw; }
        g.wait -= dt;
        if (wp.wait) { g.look += dt; g.yaw = g.lookBase + Math.sin(g.look * 1.1) * 0.9; }
        if (g.wait <= 0) { g.wp = (g.wp + 1) % pts.length; g.path = null; g.arrived = false; }
      }
    }

    g.moving = false;
    if (goal) {
      if (!g.path || g.pathGoal?.x !== goal.x || g.pathGoal?.z !== goal.z) {
        const nav = this.navs[floorOf(L, g.x)];
        g.path = findPath(nav, g.x, g.z, goal.x, goal.z) || [{ x: goal.x, z: goal.z }];
        g.pi = g.path.length < 2 ? 0 : 1; g.pathGoal = { x: goal.x, z: goal.z };
      }
      const tgt = g.path[Math.min(g.pi, g.path.length - 1)];
      const dx = tgt.x - g.x, dz = tgt.z - g.z, d = Math.hypot(dx, dz);
      const step = speed * hurry * dt;
      const nx = d <= step ? tgt.x : g.x + (dx / d) * step, nz = d <= step ? tgt.z : g.z + (dz / d) * step;
      if (this.sealBlocks(g.x, g.z, nx, nz)) { g.moving = false; g.blockedT = (g.blockedT || 0) + dt; return; }
      g.blockedT = 0;
      if (d <= step) { g.x = tgt.x; g.z = tgt.z; if (g.pi < g.path.length - 1) g.pi++; }
      else { g.x = nx; g.z = nz; }
      if (d > 0.05) {
        g.yaw += angDiff(g.yaw, yawTo(0, 0, dx, dz)) * Math.min(1, dt * 8);
        g.moving = true;
      }
      L.doors.forEach((dr, i) => {
        if (dr.type === 'vault' || dr.type === 'shutter' || dr.type === 'elevator') return;
        if (Math.hypot(dr.x - g.x, dr.z - g.z) < 1.8 && !this.doors[i].open && !this.seals.has(i)) this.doors[i].guardT = 2.6;
      });
    }
    if (faceTarget) g.yaw += angDiff(g.yaw, yawTo(g.x, g.z, faceTarget.x, faceTarget.z)) * Math.min(1, dt * 6);
  }

  nearestWp(g) {
    let best = 0, bd = 1e9;
    g.def.patrol.forEach((w, i) => { const d = Math.hypot(w.x - g.x, w.z - g.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  lethal() { return true; }

  kill(g, by, silent = false) {
    g.state = 'down'; g.dead = true; g.tied = true; g.stunT = 0; g.hits = 0; g.conT = 0; g.distractT = 0; g.path = null; g.target = null;
    if (by) { by.stats.kills++; if (silent) by.stats.takedowns++; }
    this.emit('killed', { gid: g.id, by: by ? by.id : null, silent });
  }

  downPlayer(p) {
    p.down = true; p.hp = 0;
    p.bleed = BLEED_OUT; p.made = false; p.lostT = 0;
    this.emit('downed', { pid: p.id, lethal: true, text: `${p.name} is shot and bleeding out! ${BLEED_OUT} seconds to reach them (hold E).` });
    if (this.prize.holder === p.id) {
      this.prize.holder = null;
      this.prize.x = p.x; this.prize.z = p.z; this.prize.y = 0.3;
      this.emit('prizeDrop', { x: p.x, z: p.z });
    }
    for (const g of this.guards) if (g.target === p.id) g.target = null;
    const fl = this.field();
    if (fl.length && fl.every((q) => q.down)) this.finish('caught', 'Security shot the whole crew down.');
  }

  stepSuspicion(dt, opened) {
    const L = this.L;
    for (const p of this.field()) {
      if (p.made) { this.stepMade(p, dt, opened); continue; }
      if (p.down || p.inVent) { p.susp = Math.max(0, p.susp - 20 * dt); continue; }
      const zn = this.zoneAt(p.x, p.z);
      const restricted = zn ? zn.restricted && !zn.exit : false;
      const f = p.f;
      const moving = p.speed > 0.4;
      p.blended = !moving && !(f & FLAGS.WEAPON) && L.seats.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 1.0);
      const acts = [];
      if (restricted) acts.push(55);
      if (f & FLAGS.WEAPON) acts.push(45);
      if (f & FLAGS.INTERACT) acts.push(restricted ? 30 : 38);
      if ((f & FLAGS.SPRINT) && p.silentT <= 0 && moving) acts.push(22);
      if ((f & FLAGS.CROUCH) && !restricted) acts.push(10);
      if (this.prize.holder === p.id) acts.push(20);
      acts.sort((a, b) => b - a);
      const base = acts.length ? acts[0] + acts.slice(1).reduce((s, v) => s + v * 0.25, 0) : 0;
      let gain = 0, spotter = null, byCam = null;
      if (base > 0) {
        for (const g of this.guards) {
          if (!this.guardSees(g, p.x, p.z, opened)) continue;
          const d = Math.hypot(p.x - g.x, p.z - g.z);
          const prox = 1 - Math.min(1, d / g.range) * 0.55;
          const v = base * prox * (p.blended ? 0.3 : 1) * (g.watchT > 0 ? 1.8 : 1) * (this.protocol ? 1.6 : 1) * (p.marked ? 1.6 : 1);
          if (v > gain) { gain = v; spotter = g; }
        }
        for (let i = 0; i < L.cams.length; i++) {
          if (L.cams[i].noDetect) continue;
          if (!this.camSees(i, p.x, p.z, opened)) continue;
          const v = base * 0.85 * (p.blended ? 0.3 : 1) * (p.marked ? 1.6 : 1);
          if (v > gain) { gain = v; spotter = null; byCam = i; }
        }
      }
      let hearer = null;
      if (restricted && (f & FLAGS.TALK) && !this.blind) {
        const r = f & FLAGS.WHISPER ? 1.6 : 7;
        for (const g of this.guards) {
          if (!this.active(g) || g.conT > 0) continue;
          if (Math.hypot(g.x - p.x, g.z - p.z) < r) {
            if (16 > gain) { gain = 16; hearer = g; spotter = null; byCam = null; }
            if (g.state === 'patrol' && p.susp > 45) this.investigate(g, p.x, p.z, 4);
          }
        }
      }
      // In a lockdown, any guard who lays eyes on the crew opens fire
      if (this.protocol && spotter && spotter.kind !== 'manager' && gain > 0) { this.alertOn(spotter, p); continue; }
      if (gain > 0) p.susp = Math.min(100, p.susp + gain * dt);
      else p.susp = Math.max(0, p.susp - (p.blended ? 28 : 10) * dt);
      p.stats.peakSusp = Math.max(p.stats.peakSusp, p.susp);
      if (p.susp >= 100 && p.spotCd <= 0) {
        p.spotCd = 4; p.susp = 65;
        if (spotter) {
          if (spotter.kind === 'manager') {
            this.addHeat(12, `${p.name} spotted by the Floor Manager`);
            this.say(`${spotter.def.name}: Security! Someone's where they shouldn't be!`);
            const g2 = this.guards.filter((g) => this.active(g) && g.kind !== 'manager' && floorOf(L, g.x) === floorOf(L, p.x)).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
            if (g2) this.alertOn(g2, p);
          } else {
            this.alertOn(spotter, p);
            this.addHeat(15, `${p.name} spotted by ${spotter.def.name}`);
          }
          this.emit('spotted', { pid: p.id, gid: spotter.id });
        } else if (byCam != null) {
          this.emit('spotted', { pid: p.id, cam: byCam });
          this.alarm(p.x, p.z, 15, `Camera ${L.cams[byCam].label} flagged ${p.name}`);
          this.setMade(p, null);
        } else if (hearer) {
          this.emit('spotted', { pid: p.id, gid: hearer.id });
          this.addHeat(10, `${hearer.def.name} heard ${p.name}`);
          if (hearer.kind === 'manager') this.investigate(hearer, p.x, p.z, 4); else this.alertOn(hearer, p);
        }
      }
    }
  }

  stepMade(p, dt, opened) {
    const L = this.L;
    p.susp = 100;
    if (p.down) { p.made = false; return; }
    let seen = false, camSeen = false;
    if (!p.inVent) {
      for (const g of this.guards) {
        if (!this.guardSees(g, p.x, p.z, opened)) continue;
        seen = true;
        if (g.kind === 'manager') continue;
        if (g.state !== 'alert' || g.target !== p.id) {
          const cur = g.target != null ? this.players.get(g.target) : null;
          if (!cur || cur.down || Math.hypot(cur.x - g.x, cur.z - g.z) > Math.hypot(p.x - g.x, p.z - g.z)) this.alertOn(g, p);
        }
      }
      for (let i = 0; i < L.cams.length && !camSeen; i++) if (!L.cams[i].noDetect && this.camSees(i, p.x, p.z, opened)) camSeen = true;
    }
    p.relayT -= dt;
    if (camSeen) {
      seen = true;
      for (const g of this.guards) if (g.target === p.id) { g.lastKnown = { x: p.x, z: p.z }; g.lostT = 0; }
      if (p.relayT <= 0) {
        p.relayT = 3;
        const fl = floorOf(L, p.x);
        const g = this.guards.filter((q) => this.active(q) && q.kind !== 'manager' && q.state !== 'alert' && floorOf(L, q.x) === fl)
          .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (g) { g.state = 'alert'; g.target = p.id; g.lastKnown = { x: p.x, z: p.z }; g.lostT = 0; g.path = null; g.fireCd = Math.max(g.fireCd, 1.1); this.say(`Security: cameras have the shooter near ${this.zoneAt(p.x, p.z)?.label || 'the floor'}. ${g.def.name}, move!`); }
      }
    }
    if (seen) p.lostT = 0;
    else {
      p.lostT += dt;
      if (p.lostT >= LOSE_T) {
        p.made = false; p.lostT = 0; p.susp = 55;
        this.emit('lost', { pid: p.id, text: `${p.name} shook them. Security still has a description: change clothes at a locker to lose it.` });
        this.say('Security: lost the suspect. Everyone keep your eyes open, they could be anywhere.');
      }
    }
  }

  stepBodies(opened) {
    for (const body of this.guards) {
      if (body.state !== 'down' || body.hidden || this.bodies.has(body.id)) continue;
      for (const g of this.guards) {
        if (g === body || !this.active(g)) continue;
        if (this.guardSees(g, body.x, body.z, opened)) {
          this.bodies.add(body.id);
          this.addHeat(15, 'Body found');
          this.say(`${g.def.name}: Man down! ${body.def.name} is dead! We've got a shooter in the building!`);
          this.emit('bodyFound', { gid: body.id, by: g.id });
          if (g.state !== 'alert') this.investigate(g, body.x, body.z, 7);
          break;
        }
      }
    }
  }

  checkMilestones() {
    const award = (key, n, why) => { if (!this.milestones.has(key)) { this.milestones.add(key); this.award(n, why); } };
    for (const p of this.field()) {
      if (p.zone === 'boh' && this.heat < 25) award('boh', 2, 'Clean entry to back of house');
      if (p.zone === 'b1lobby' && this.heat < 40) award('b1', 2, 'Reached B1 quietly');
      if (p.zone === 'ante' && this.heat < 55) award('ante', 2, 'Reached the vault antechamber quietly');
    }
  }

  finish(result, reason) {
    if (this.over) return;
    const L = this.L;
    const field = this.field();
    const left = field.filter((p) => p.down).length;
    const g = this.getaway;
    let payout = 0;
    if (result === 'escaped') {
      payout = (g && g.secured ? L.prize.value : 0) + this.loot;
      if (this.protocol && this.protocol.reason === 'heat') payout *= 0.8;
      if (g) payout *= Math.max(0.5, 1 - g.damage * 0.1);
      payout *= Math.max(0.4, 1 - left * 0.15);
      payout = Math.round(payout / 1000) * 1000;
    }
    const stats = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, role: p.role, ...p.stats, down: p.down, dead: p.dead }));
    this.over = { result, reason, payout, heat: Math.round(this.heat), time: Math.round(this.t), loot: this.loot, intelEarned: this.intelEarned, strikes: this.strikesUsed, stats, prize: L.prize.name, secured: !!(g && g.secured), damage: g ? g.damage : 0, left };
    this.emit('over', { over: this.over });
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    if (this.prize.holder === pid) { this.prize.holder = null; this.prize.x = p.x; this.prize.z = p.z; this.prize.y = 0.3; }
    this.players.delete(pid);
    if (this.getaway && this.getaway.driver === pid) this.getaway.driver = [...this.players.keys()][0];
  }

  snapshot() {
    const r1 = (v) => Math.round(v * 100) / 100;
    const opened = this.doorsOpen();
    const pz = this.puzzle, pr = this.protocol, g = this.getaway;
    return {
      t: r1(this.t),
      heat: Math.round(this.heat * 10) / 10,
      intel: this.intel, intelEarned: this.intelEarned,
      strikesLeft: this.strikeCap() - this.strikesUsed,
      lockdown: pr ? r1(pr.t) : null,
      lethal: this.lethal(),
      surge: this.surgeT > 0,
      deepCams: this.deepCams,
      lights: Object.keys(this.lights),
      seals: [...this.seals].map(([i, t]) => [i, Math.ceil(t)]),
      owCd: [Math.max(0, Math.ceil(this.owCd.seal)), Math.max(0, Math.ceil(this.owCd.cut))],
      wardrobes: this.wardrobes,
      players: [...this.players.values()].map((p) => [p.id, r1(p.x), r1(p.y), r1(p.z), r1(p.yaw), r1(p.pitch), p.f, p.hp, p.down ? 1 : 0, p.keycard ? 1 : 0, p.inVent ? 1 : 0, Math.round(p.susp), p.abilityCd > 0 ? r1(p.abilityCd) : 0, p.blended ? 1 : 0, p.overrideKey ? 1 : 0, p.dead ? 1 : 0, p.bleed > 0 ? Math.ceil(p.bleed) : 0, p.made ? 1 : p.marked ? 2 : 0, p.made ? r1(p.lostT / LOSE_T) : 0, p.outfit]),
      guards: this.guards.map((q) => [q.id, r1(q.x), r1(q.z), r1(q.yaw), GSTATE.indexOf(q.conT > 0 ? 'conned' : q.distractT > 0 ? 'distracted' : q.state), q.hidden ? 3 : q.dead ? 2 : q.tied ? 1 : 0, this.tags.has(q.id) ? 1 : 0, q.moving ? 1 : 0, q.keycard ? 1 : 0, q.watchT > 0 ? 1 : 0]),
      cams: this.cams.map((c, i) => [c.loop > 0 ? r1(c.loop) : 0, this.camOnline(i) ? 1 : 0]),
      doors: opened.map((o) => (o ? 1 : 0)),
      locks: this.doors.map((d) => (d.locked ? 1 : 0)),
      prize: [this.prize.holder || '', r1(this.prize.x), r1(this.prize.y), r1(this.prize.z), this.prize.inVault ? 1 : 0],
      cash: [...this.cashTaken],
      loot: this.loot,
      puzzle: {
        glyphStep: pz.glyphStep, glyphSolved: pz.glyphSolved,
        wireSolved: pz.wireSolved, wireLocked: pz.wireLockT > 0,
        wire: { wires: pz.wire.wires, serial: pz.wire.serial },
        passSolved: pz.passSolved,
        simonSolved: pz.simonSolved, simonStage: pz.simonStage, simonStrikes: pz.simonStrikes,
        morseSolved: pz.morseSolved,
        mazeSolved: pz.mazeSolved, mazePos: pz.mazePos,
        vaultCode: pz.vaultCode, keyInserted: pz.keyInserted, timelock: pz.timelock != null ? r1(pz.timelock) : null, vaultOpen: pz.vaultOpen,
        turnA: pz.turns.A != null && this.t - pz.turns.A < 1.5, turnB: pz.turns.B != null && this.t - pz.turns.B < 1.5,
      },
      protocol: pr ? { flipped: pr.flipped, idx: pr.idx, shutterOpen: pr.shutterOpen, reason: pr.reason } : null,
      getaway: g ? {
        t: r1(g.t), damage: g.damage, driver: g.driver, van: { x: r1(g.van.x), z: r1(g.van.z), yaw: r1(g.van.yaw), speed: r1(g.van.speed) },
        pursuers: g.pursuers.map((pu) => this.pursuerPos(pu)).map((q) => (q ? [r1(q.x), r1(q.z), r1(q.yaw)] : null)),
      } : null,
    };
  }
}

export { doorBox };
