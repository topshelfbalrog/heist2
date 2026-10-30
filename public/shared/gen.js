// Procedural heist generator for Stanley's Palace.
// Everything is derived from one seed, so server and clients agree.
import { makeRng } from './rng.js';
import { TRAITS, FIRST_NAMES, LAST_NAMES, PRIZES, EVENTS, PASSWORDS, MORSE_WORDS, BREAKER_COLORS } from './data.js';
import { yawTo } from './geom.js';

export const WIRE_COLORS = ['red', 'blue', 'yellow', 'white', 'black', 'green'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const ordIdx = (w, n) => (w === 'last' ? n - 1 : ORD.indexOf(w));

// ---------- Glyphs (random symbols with no standard names) ----------
function makeGlyphs(R, count) {
  const pts = [];
  for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) pts.push([x, y]);
  const seen = new Set();
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 5000) {
    const prims = [];
    const n = R.int(2, 4);
    for (let i = 0; i < n; i++) {
      const k = R.next();
      if (k < 0.55) {
        let a = R.pick(pts), b = R.pick(pts);
        if (a === b) continue;
        prims.push({ t: 'l', a, b });
      } else if (k < 0.72) {
        prims.push({ t: 'c', c: R.pick(pts), r: R.pick([0.5, 1]) });
      } else if (k < 0.86) {
        const c = R.pick(pts);
        const a0 = R.int(0, 3) * (Math.PI / 2);
        prims.push({ t: 'a', c, r: R.pick([0.5, 1]), a0, a1: a0 + Math.PI });
      } else {
        prims.push({ t: 'd', c: R.pick(pts) });
      }
    }
    if (prims.length < 2) continue;
    const key = prims.map((p) => JSON.stringify(p)).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prims);
  }
  return out;
}

function makeGlyphPuzzle(R) {
  const glyphs = makeGlyphs(R, 28);
  const ids = glyphs.map((_, i) => i);
  for (let attempt = 0; attempt < 200; attempt++) {
    const cols = [];
    for (let c = 0; c < 6; c++) cols.push(R.shuffle(ids).slice(0, 7));
    const target = R.int(0, 5);
    const chosenIdx = R.shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, 4).sort((a, b) => a - b);
    const chosen = chosenIdx.map((i) => cols[target][i]);
    const others = cols.filter((col, ci) => ci !== target && chosen.every((g) => col.includes(g)));
    if (others.length) continue;
    return { glyphs, columns: cols, order: chosen, shown: R.shuffle(chosen), column: target };
  }
  throw new Error('glyph puzzle failed');
}

// ---------- Wires ----------
function makeRulebook(R) {
  const book = {};
  for (let n = 3; n <= 6; n++) {
    const ords = () => R.pick([...ORD.slice(0, n), 'last']);
    const kinds = R.shuffle(['none', 'lastIs', 'multiOdd', 'exactlyOne', 'moreThan', 'firstIs']).slice(0, 3);
    const rules = kinds.map((kind) => {
      const c = R.pick(WIRE_COLORS);
      return { kind, c, c2: R.pick(WIRE_COLORS.filter((x) => x !== c)), o: ords() };
    });
    book[n] = { rules, otherwise: ords() };
  }
  return book;
}

export function wireRuleText(r) {
  switch (r.kind) {
    case 'none': return `If there are no ${r.c} wires, cut the ${r.o} wire.`;
    case 'lastIs': return `If the last wire is ${r.c}, cut the last wire.`;
    case 'multiOdd': return `If there is more than one ${r.c} wire and the serial number ends in an odd digit, cut the last ${r.c} wire.`;
    case 'exactlyOne': return `If there is exactly one ${r.c} wire, cut that ${r.c} wire.`;
    case 'moreThan': return `If there are more ${r.c} wires than ${r.c2} wires, cut the ${r.o} wire.`;
    case 'firstIs': return `If the first wire is ${r.c}, cut the ${r.o} wire.`;
  }
  return '';
}

export function solveWires(book, wires, serialOdd) {
  const n = wires.length;
  const { rules, otherwise } = book[n];
  const count = (c) => wires.filter((w) => w === c).length;
  for (const r of rules) {
    switch (r.kind) {
      case 'none': if (count(r.c) === 0) return ordIdx(r.o, n); break;
      case 'lastIs': if (wires[n - 1] === r.c) return n - 1; break;
      case 'multiOdd': if (count(r.c) > 1 && serialOdd) return wires.lastIndexOf(r.c); break;
      case 'exactlyOne': if (count(r.c) === 1) return wires.indexOf(r.c); break;
      case 'moreThan': if (count(r.c) > count(r.c2)) return ordIdx(r.o, n); break;
      case 'firstIs': if (wires[0] === r.c) return ordIdx(r.o, n); break;
    }
  }
  return ordIdx(otherwise, n);
}

export function makeWireInstance(seed, attempt, book) {
  const R = makeRng((seed ^ Math.imul(attempt + 1, 2654435761)) >>> 0);
  const n = R.int(3, 6);
  const wires = [];
  for (let i = 0; i < n; i++) wires.push(R.pick(WIRE_COLORS));
  const L = 'ABCDEFGHJKLMNPRSTVWXZ';
  const last = R.int(0, 9);
  const serial = `SP-${R.pick(L)}${R.pick(L)}${R.int(10, 99)}-${R.pick(L)}${last}`;
  return { wires, serial, solution: solveWires(book, wires, last % 2 === 1) };
}

// ---------- Layout ----------
export function generateHeist(seed, opts = {}) {
  const R = makeRng(seed);
  const playerCount = opts.playerCount || 4;
  const W = 2 * R.int(21, 24);
  const D = R.int(28, 32);
  const T = 0.4;
  const L = {
    seed, venue: "Stanley's Palace", W, D,
    theme: R.pick(['crimson', 'emerald', 'royal']),
    walls: [], solids: [], circles: [], doors: [], zones: [], interact: [], cams: [],
    guards: [], civilians: [], seats: [], slotBanks: [], tables: [], lounges: [], decor: [],
    lasers: [], corners: [], walkers: [], cash: [], spawn: [],
  };

  const wall = (x1, z1, x2, z2, h, kind) =>
    L.walls.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y1: 0, y2: h, kind });
  const hwall = (z, xa, xb, gaps, h, kind) => {
    let cur = xa;
    for (const [g1, g2] of gaps.slice().sort((a, b) => a[0] - b[0])) {
      if (g1 > cur) wall(cur, z - T / 2, g1, z + T / 2, h, kind);
      cur = Math.max(cur, g2);
    }
    if (cur < xb) wall(cur, z - T / 2, xb, z + T / 2, h, kind);
  };
  const vwall = (x, za, zb, gaps, h, kind) => {
    let cur = za;
    for (const [g1, g2] of gaps.slice().sort((a, b) => a[0] - b[0])) {
      if (g1 > cur) wall(x - T / 2, cur, x + T / 2, g1, h, kind);
      cur = Math.max(cur, g2);
    }
    if (cur < zb) wall(x - T / 2, cur, x + T / 2, zb, h, kind);
  };
  const door = (d) => { d.id = L.doors.length; L.doors.push(d); return d.id; };
  const solid = (x1, z1, x2, z2, h, kind) =>
    L.solids.push({ x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2), y1: 0, y2: h, kind });

  const hubEast = R.chance(0.5);
  const hx1 = hubEast ? W / 2 - 12 : -W / 2 + 9;
  const hx2 = hx1 + 12;
  const hubDoorX = hx1 + 6;
  const lx = hubEast ? R.int(-W / 2 + 12, W / 2 - 16) : R.int(-W / 2 + 25, W / 2 - 4);
  const sx = R.int(-W / 2 + 9, W / 2 - 13);
  L.lx = lx; L.sx = sx; L.hub = { x1: hx1, x2: hx2, east: hubEast };

  // Casino shell
  hwall(0, -W / 2, W / 2, [[-4, 4]], 7, 'casino');
  vwall(-W / 2, 0, D, [], 7, 'casino');
  vwall(W / 2, 0, D, [], 7, 'casino');
  hwall(D, -W / 2, W / 2, [[sx - 1, sx + 1]], 7, 'casino');
  // Back of house corridor
  hwall(D + 4, -W / 2, W / 2, [[-W / 2 + 3, -W / 2 + 5], [hubDoorX - 1, hubDoorX + 1], [lx - 1, lx + 1]], 3.6, 'boh');
  vwall(-W / 2, D, D + 4, [[D + 1, D + 3]], 3.6, 'boh');
  vwall(W / 2, D, D + 4, [], 3.6, 'boh');
  // Storage
  vwall(-W / 2, D + 4, D + 14, [], 3.6, 'boh');
  vwall(-W / 2 + 9, D + 4, D + 14, [], 3.6, 'boh');
  hwall(D + 14, -W / 2, -W / 2 + 9, [], 3.6, 'boh');
  // Security hub
  if (hubEast) vwall(hx1, D + 4, D + 14, [], 3.6, 'boh');
  vwall(hx2, D + 4, D + 14, [], 3.6, 'boh');
  hwall(D + 14, hx1, hx2, [], 3.6, 'boh');
  // Service elevator car
  vwall(lx - 2, D + 4, D + 8, [], 3.6, 'lift');
  vwall(lx + 2, D + 4, D + 8, [], 3.6, 'lift');
  hwall(D + 8, lx - 2, lx + 2, [], 3.6, 'lift');
  // Loading dock (west wall has the roll-up shutter)
  hwall(D - 6, -W / 2 - 14, -W / 2, [], 6, 'dock');
  hwall(D + 8, -W / 2 - 14, -W / 2, [], 6, 'dock');
  vwall(-W / 2 - 14, D - 6, D + 8, [[D - 2, D + 4]], 6, 'dock');
  // Plaza edge planters
  hwall(-12, -12, 12, [], 1.1, 'plaza');
  vwall(-12, -12, 0, [], 1.1, 'plaza');
  vwall(12, -12, 0, [], 1.1, 'plaza');

  // Doors
  door({ key: 'staff', type: 'glyph', label: 'STAFF ONLY', x: sx, z: D, axis: 'x', w: 2, h: 3, open: false, locked: true });
  door({ key: 'dock', type: 'basic', label: 'LOADING DOCK', x: -W / 2, z: D + 2, axis: 'z', w: 2, h: 3, open: false, locked: false });
  door({ key: 'storage', type: 'basic', label: 'STORAGE', x: -W / 2 + 4, z: D + 4, axis: 'x', w: 2, h: 3, open: true, locked: false });
  door({ key: 'hub', type: 'keycard', label: 'SECURITY', x: hubDoorX, z: D + 4, axis: 'x', w: 2, h: 3, open: false, locked: true });
  door({ key: 'elevator', type: 'elevator', label: 'SERVICE LIFT', x: lx, z: D + 4, axis: 'x', w: 2, h: 3, open: false, locked: true });
  door({ key: 'cage', type: 'basic', label: 'CASHIER', x: W / 2 - 1, z: D - 7, axis: 'x', w: 1.6, h: 3, open: false, locked: false });
  door({ key: 'shutter', type: 'shutter', label: 'LOADING BAY', x: -W / 2 - 14, z: D + 1, axis: 'z', w: 6, h: 4.6, open: false, locked: true });

  // Zones (first match wins)
  const zone = (name, x1, z1, x2, z2, restricted, light, extra = {}) =>
    L.zones.push({ name, x1, z1, x2, z2, restricted, light, ...extra });
  zone('bar', -W / 2, 0, -W / 2 + 3.0, D, true, 'casino', { label: 'Behind the bar' });
  zone('cage', W / 2 - 10, D - 7, W / 2, D, true, 'casino', { label: 'Cashier cage' });
  zone('casino', -W / 2, 0, W / 2, D, false, 'casino', { label: 'Casino floor' });
  zone('plaza', -12, -12, 12, 0, false, null, { label: 'Front plaza' });
  zone('boh', -W / 2, D, W / 2, D + 4, true, 'backhouse', { label: 'Back of house' });
  zone('storage', -W / 2, D + 4, -W / 2 + 9, D + 14, true, 'backhouse', { label: 'Storage' });
  zone('hub', hx1, D + 4, hx2, D + 14, true, 'backhouse', { label: 'Security hub' });
  zone('elevator', lx - 2, D + 4, lx + 2, D + 8, true, 'backhouse', { label: 'Service lift', car: 0 });
  zone('dock', -W / 2 - 14, D - 6, -W / 2, D + 8, true, null, { label: 'Loading dock', exit: true });

  // ---------- Casino furniture ----------
  // Bar along the west wall
  const barZ1 = 7, barZ2 = D - 7;
  solid(-W / 2 + 3, barZ1, -W / 2 + 3.8, barZ2, 1.1, 'bar');
  solid(-W / 2 + 0.2, barZ1, -W / 2 + 0.8, barZ2, 2.4, 'barshelf');
  for (let z = barZ1 + 0.8; z < barZ2 - 0.4; z += 1.3) L.seats.push({ x: -W / 2 + 4.6, z, yaw: Math.PI / 2, kind: 'stool' });
  // Cashier cage
  solid(W / 2 - 10, D - 7.3, W / 2 - 1.8, D - 6.7, 3.0, 'cage');
  solid(W / 2 - 10.3, D - 7, W / 2 - 9.7, D, 3.0, 'cage');
  solid(W / 2 - 9, D - 1.0, W / 2 - 2, D - 0.3, 2.0, 'cageshelf');
  for (let i = 0; i < 5; i++) {
    L.cash.push({ id: i, x: W / 2 - 8.3 + i * 1.4, y: 1.0, z: D - 1.25, value: 25000 + R.int(0, 4) * 5000 });
  }

  // Grid cells for slots, tables, lounges, stage
  const gx1 = -W / 2 + 6, gx2 = W / 2 - 2, gz1 = 3, gz2 = D - 9;
  const cw = 7, ch = 6.5;
  const cols = Math.floor((gx2 - gx1) / cw), rows = Math.floor((gz2 - gz1) / ch);
  const ox = gx1 + ((gx2 - gx1) - cols * cw) / 2, oz = gz1 + ((gz2 - gz1) - rows * ch) / 2;
  L.grid = { ox, oz, cw, ch, cols, rows };
  const cells = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x1 = ox + i * cw, z1 = oz + j * ch;
    cells.push({ i, j, x1, z1, x2: x1 + cw, z2: z1 + ch, cx: x1 + cw / 2, cz: z1 + ch / 2 });
  }
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) L.corners.push({ x: ox + i * cw, z: oz + j * ch, i, j });

  const lobbyCells = cells.filter((c) => c.x2 > -3.5 && c.x1 < 3.5 && c.z1 < 8);
  const stageCell = cells
    .filter((c) => !lobbyCells.includes(c))
    .sort((a, b) => (Math.abs(a.cx) + Math.abs(a.cz - D * 0.5)) - (Math.abs(b.cx) + Math.abs(b.cz - D * 0.5)))[0];
  const free = cells.filter((c) => c !== stageCell && !lobbyCells.includes(c));
  const shuffled = R.shuffle(free);
  const content = new Map();
  shuffled.forEach((c, idx) => {
    let kind;
    if (idx === 0) kind = 'blackjack';
    else if (idx === 1) kind = 'poker';
    else if (idx === 2) kind = 'slots';
    else {
      const east = c.cx > 0;
      const r = R.next();
      kind = r < (east ? 0.55 : 0.3) ? 'slots' : r < 0.72 ? 'blackjack' : r < 0.92 ? 'poker' : 'lounge';
    }
    content.set(c, kind);
  });
  lobbyCells.forEach((c) => content.set(c, 'lobby'));
  if (stageCell) content.set(stageCell, 'stage');

  for (const [c, kind] of content) {
    if (kind === 'slots') {
      const len = 5, x1 = c.cx - len / 2, x2 = c.cx + len / 2;
      solid(x1, c.cz - 0.7, x2, c.cz + 0.7, 1.95, 'slots');
      const bank = { id: L.slotBanks.length, x: c.cx, z: c.cz, len, machines: [] };
      for (let k = 0; k < len; k++) {
        const mx = x1 + 0.5 + k;
        for (const side of [-1, 1]) {
          bank.machines.push({ x: mx, z: c.cz + side * 0.35, face: side });
          L.seats.push({ x: mx, z: c.cz + side * 1.25, yaw: side > 0 ? 0 : Math.PI, kind: 'slot' });
        }
      }
      L.slotBanks.push(bank);
    } else if (kind === 'blackjack') {
      const flip = R.chance(0.5) ? 1 : -1; // which side the dealer stands
      L.circles.push({ x: c.cx, z: c.cz, r: 1.3, y2: 0.85, kind: 'blackjack' });
      const t = { id: L.tables.length, kind: 'blackjack', x: c.cx, z: c.cz, flip };
      L.tables.push(t);
      for (let k = 0; k < 5; k++) {
        const a = -0.95 + k * 0.475;
        const sxp = c.cx + Math.sin(a) * 1.85, szp = c.cz + flip * Math.cos(a) * 1.85;
        L.seats.push({ x: sxp, z: szp, yaw: yawTo(sxp, szp, c.cx, c.cz), kind: 'table', table: t.id });
      }
      t.dealer = { x: c.cx, z: c.cz - flip * 1.6 };
    } else if (kind === 'poker') {
      const rot = R.chance(0.5);
      const hw = rot ? 0.9 : 1.6, hd = rot ? 1.6 : 0.9;
      solid(c.cx - hw, c.cz - hd, c.cx + hw, c.cz + hd, 0.85, 'poker');
      const t = { id: L.tables.length, kind: 'poker', x: c.cx, z: c.cz, rot };
      L.tables.push(t);
      const spots = [];
      const lw = rot ? 1.6 : 0.9; // half-length along the long axis after rotation
      for (const s of [-1, 0, 1]) {
        if (!rot) { spots.push([c.cx + s * 1.05, c.cz - 1.65]); spots.push([c.cx + s * 1.05, c.cz + 1.65]); }
        else { spots.push([c.cx - 1.65, c.cz + s * 1.05]); spots.push([c.cx + 1.65, c.cz + s * 1.05]); }
      }
      if (!rot) { spots.push([c.cx - 2.35, c.cz]); spots.push([c.cx + 2.35, c.cz]); }
      else { spots.push([c.cx, c.cz - 2.35]); spots.push([c.cx, c.cz + 2.35]); }
      const dealerIdx = 1;
      spots.forEach(([px, pz], k) => {
        if (k === dealerIdx) { t.dealer = { x: px, z: pz }; return; }
        L.seats.push({ x: px, z: pz, yaw: yawTo(px, pz, c.cx, c.cz), kind: 'table', table: t.id });
      });
      void lw;
    } else if (kind === 'lounge') {
      solid(c.cx - 1.2, c.cz - 1.6, c.cx + 1.2, c.cz - 0.8, 0.8, 'sofa');
      solid(c.cx - 1.2, c.cz + 0.8, c.cx + 1.2, c.cz + 1.6, 0.8, 'sofa');
      solid(c.cx - 0.6, c.cz - 0.35, c.cx + 0.6, c.cz + 0.35, 0.45, 'ctable');
      L.lounges.push({ x: c.cx, z: c.cz });
      for (const s of [-1, 1]) for (const dx of [-0.6, 0.6]) {
        L.seats.push({ x: c.cx + dx, z: c.cz + s * 1.2, yaw: s < 0 ? Math.PI : 0, kind: 'sofa', sit: true, y: 0.45 });
      }
    } else if (kind === 'stage') {
      L.circles.push({ x: c.cx, z: c.cz, r: 2.6, y2: 0.45, kind: 'stage' });
      L.circles.push({ x: c.cx, z: c.cz, r: 1.0, y2: 4.0, kind: 'sculpture' });
      L.decor.push({ kind: 'stage', x: c.cx, z: c.cz });
    } else if (kind === 'lobby') {
      L.decor.push({ kind: 'planter', x: c.cx + (c.cx < 0 ? -1.8 : 1.8), z: c.cz });
      L.circles.push({ x: c.cx + (c.cx < 0 ? -1.8 : 1.8), z: c.cz, r: 0.7, y2: 0.9, kind: 'planter' });
    }
  }
  // Pillars along the hall
  for (const px of [-W / 2 + 5.5, W / 2 - 5.5]) {
    for (let pz = 6; pz < D - 3; pz += 9) {
      if (px > 0 && pz > D - 9) continue;
      L.circles.push({ x: px, z: pz, r: 0.45, y2: 7, kind: 'pillar' });
      L.decor.push({ kind: 'pillar', x: px, z: pz });
    }
  }

  // Back-of-house props
  // Security hub desk + racks
  solid(hx1 + 4, D + 8.2, hx1 + 8, D + 9.2, 0.9, 'desk');
  for (let k = 0; k < 3; k++) solid(hx1 + (hubEast ? 10.6 : 0.6), D + 5 + k * 1.6, hx1 + (hubEast ? 11.6 : 1.6), D + 6.2 + k * 1.6, 2.2, 'rack');
  // Storage crates
  const crateR = makeRng(seed ^ 0xC0FFEE);
  for (let k = 0; k < 6; k++) {
    const cx = -W / 2 + 2.5 + crateR.float(0, 4), cz = D + 6 + crateR.float(0, 5); // keeps the lockers on the east wall clear
    if (Math.abs(cx - (-W / 2 + 1)) < 1.6 && Math.abs(cz - (D + 13.2)) < 1.6) continue;
    const s = crateR.pick([0.8, 1.0, 1.2]);
    solid(cx - s / 2, cz - s / 2, cx + s / 2, cz + s / 2, s, 'crate');
  }

  // Interactables
  L.interact.push({ id: 'glyphPad', kind: 'glyphPad', x: sx + 1.6, y: 1.35, z: D - 0.25, r: 1.7, label: 'Use keypad' });
  L.interact.push({ id: 'wirePanel', kind: 'wirePanel', x: hubDoorX, y: 1.4, z: D + 13.75, r: 1.8, label: 'Open junction panel' });
  L.interact.push({ id: 'ventA', kind: 'vent', x: -W / 2 + 1.0, y: 0.45, z: D + 13.2, r: 1.5, role: 'infiltrator', to: 'ventB', label: 'Crawl into the vent' });
  const vbx = hubEast ? hx2 - 1.0 : hx1 + 1.0;
  L.interact.push({ id: 'ventB', kind: 'vent', x: vbx, y: 0.45, z: D + 13.2, r: 1.5, role: 'infiltrator', to: 'ventA', label: 'Crawl into the vent' });
  // Security hub terminals
  const termX = hubEast ? hx1 + 0.45 : hx2 - 0.45;
  L.interact.push({ id: 'passTerm', kind: 'password', x: termX, y: 1.3, z: D + 11.5, r: 1.8, wallX: hubEast ? 1 : -1, label: 'Use lift authorization terminal' });
  L.interact.push({ id: 'simonRack', kind: 'simon', x: hx1 + 9.5, y: 1.3, z: D + 13.7, r: 1.8, label: 'Open camera server' });
  L.interact.push({ id: 'elevG', kind: 'elevator', x: lx, y: 1.3, z: D + 7.6, r: 2.2, floor: 0, label: 'Ride the lift down to B1' });
  L.interact.push({ id: 'stairsG', kind: 'stairs', x: W / 2 - 0.5, y: 1.3, z: D + 2, r: 2.0, floor: 0, to: 'stairsB1up', label: 'Fire stairs down to B1' });
  L.interact.push({ id: 'breakerG', kind: 'breaker', x: -W / 2 + 6, y: 1.4, z: D + 3.75, r: 1.8, floor: 0, label: 'Flip the breaker' });
  L.cash.forEach((c) => L.interact.push({ id: 'cash' + c.id, kind: 'cash', x: c.x, y: c.y, z: c.z, r: 1.4, cash: c.id, label: 'Grab cash' }));
  // Wardrobes: a change of clothes shakes a description (two outfits each)
  const wardrobe = (id, x1, z1, x2, z2, nx, nz, sign) => {
    solid(x1, z1, x2, z2, 2.2, 'locker');
    const cx = (x1 + x2) / 2 + nx * ((x2 - x1) / 2 + 0.5), cz = (z1 + z2) / 2 + nz * ((z2 - z1) / 2 + 0.5);
    L.interact.push({ id, kind: 'wardrobe', x: cx, y: 1.3, z: cz, r: 1.7, nx, nz, sign, box: { x1, z1, x2, z2 }, label: 'Change clothes' });
  };
  L.wardrobe = wardrobe;
  wardrobe('wardCoat', 6.5, 0.2, 8.5, 0.65, 0, 1, 'COAT CHECK');
  wardrobe('wardStaff', -W / 2 + 8.4, D + 9.4, -W / 2 + 8.85, D + 11.4, -1, 0, 'STAFF LOCKERS');

  // Cameras
  const cam = (c) => { c.id = L.cams.length; L.cams.push(c); };
  const center = { x: 0, z: D * 0.5 };
  const corners = R.shuffle([
    { x: -W / 2 + 0.6, z: 0.6, label: 'FLOOR SW' },
    { x: W / 2 - 0.6, z: 0.6, label: 'FLOOR SE' },
    { x: -W / 2 + 0.6, z: D - 0.6, label: 'FLOOR NW' },
    { x: W / 2 - 0.6, z: D - 7.6, label: 'FLOOR NE' },
  ]).slice(0, 3);
  for (const c of corners) cam({ ...c, y: 6.2, yaw0: yawTo(c.x, c.z, center.x, center.z), sweep: 0.55, period: R.float(9, 13), fov: 1.0, range: 24, zone: 'casino' });
  const scx = sx + (sx < 0 ? 5 : -5);
  cam({ x: scx, y: 5.6, z: D - 0.6, label: 'STAFF DOOR', yaw0: yawTo(scx, D - 0.6, sx, D - 4), sweep: 0.3, period: R.float(7, 9), fov: 1.0, range: 16, zone: 'casino' });
  cam({ x: -W / 2 + 0.6, y: 3.1, z: D + 0.6, label: 'BACK HALL W', yaw0: yawTo(-W / 2, D + 0.6, W / 2, D + 3), sweep: 0.25, period: 8, fov: 1.0, range: 22, zone: 'boh' });
  cam({ x: W / 2 - 0.6, y: 3.1, z: D + 3.4, label: 'BACK HALL E', yaw0: yawTo(W / 2, D + 3.4, -W / 2, D + 1), sweep: 0.25, period: 9, fov: 1.0, range: 22, zone: 'boh' });
  cam({ x: hx1 + (hubEast ? 0.6 : 11.4), y: 3.1, z: D + 4.6, label: 'SECURITY', yaw0: yawTo(hx1 + (hubEast ? 0.6 : 11.4), D + 4.6, hubDoorX, D + 11), sweep: 0.35, period: 10, fov: 1.05, range: 14, zone: 'hub' });

  // Guards
  const names = R.shuffle(FIRST_NAMES.map((f) => f + ' ' + R.pick(LAST_NAMES)));
  const traits = R.shuffle(TRAITS.map((t) => t.id));
  let gi = 0;
  const guard = (kind, area, patrol, extra = {}) => {
    const id = L.guards.length;
    L.guards.push({
      id, kind, area, patrol, name: names[gi % names.length], trait: traits[gi % traits.length],
      spawn: { x: patrol[0].x, z: patrol[0].z }, range: area === 'casino' ? 13 : 10.5, fov: 1.65, ...extra,
    });
    gi++;
  };
  const aisle = L.corners.filter((c) => c.z > 1.5 && c.z < D - 1.5 && Math.abs(c.x) < W / 2 - 1.5);
  const casinoGuards = (playerCount >= 4 ? 3 : 2) + (W >= 46 ? 1 : 0);
  for (let k = 0; k < casinoGuards; k++) {
    const pts = R.shuffle(aisle).slice(0, R.int(4, 6)).map((c) => ({ x: c.x, z: c.z, wait: R.chance(0.4) ? R.float(1.5, 4) : 0 }));
    guard('guard', 'casino', pts);
  }
  guard('guard', 'casino', [{ x: sx - 2.6, z: D - 2.2, wait: 6 }, { x: sx + 2.6, z: D - 2.6, wait: 6 }, { x: sx, z: D - 4.5, wait: 3 }], { post: true });
  guard('guard', 'boh', [{ x: -W / 2 + 2.5, z: D + 2, wait: 2 }, { x: W / 2 - 2.5, z: D + 2, wait: 3 }, { x: -W / 2 + 5, z: D + 9, wait: 3 }]);
  guard('guard', 'hub', [{ x: hx1 + 3, z: D + 7, wait: 5 }, { x: hx1 + 9, z: D + 11, wait: 5 }, { x: hubDoorX, z: D + 6, wait: 2 }]);
  guard('manager', 'casino', [
    { x: W / 2 - 5, z: D - 3.5, wait: 6 },
    { x: W / 2 - 1, z: D - 8.2, wait: 0 },
    { x: sx, z: D - 2.5, wait: 0 },
    { x: sx, z: D + 2, wait: 0 },
    { x: hubDoorX, z: D + 2.6, wait: 5 },
    { x: sx, z: D + 2, wait: 0 },
    { x: sx, z: D - 2.5, wait: 2 },
    { x: W / 2 - 1, z: D - 8.2, wait: 0 },
  ], { range: 9, title: 'Floor Manager', keycard: true });

  // ---------- Basement floors ----------
  buildDeep(L, R, { wall, hwall, vwall, door, solid, zone, cam, guard, W, D, lx });

  // Civilians (visual crowd; deterministic)
  const crowdR = makeRng(seed ^ 0xBADA55);
  for (const s of L.seats) {
    const p = s.kind === 'slot' ? 0.55 : s.kind === 'table' ? 0.7 : s.kind === 'stool' ? 0.55 : 0.6;
    if (crowdR.chance(p)) {
      s.taken = true;
      L.civilians.push({ x: s.x, z: s.z, yaw: s.yaw, pose: s.kind === 'table' || s.kind === 'stool' || s.kind === 'slot' || s.sit ? 'sit' : 'stand', y: s.y || 0, look: crowdR.int(0, 9999), act: s.kind });
    }
  }
  for (const t of L.tables) if (t.dealer) L.civilians.push({ x: t.dealer.x, z: t.dealer.z, yaw: yawTo(t.dealer.x, t.dealer.z, t.x, t.z), pose: 'stand', look: crowdR.int(0, 9999), act: 'dealer' });
  for (let k = 0; k < 2; k++) {
    L.walkers.push({ path: [{ x: -W / 2 + 1.8, z: barZ1 + 1 }, { x: -W / 2 + 1.8, z: barZ2 - 1 }], speed: 0.5 + crowdR.float(0, 0.3), offset: crowdR.float(0, 40), look: crowdR.int(0, 9999), act: 'bartender' });
  }
  // Walkers stroll along aisle corners (4-neighbour random walks, ping-pong)
  const cornerAt = (i, j) => L.corners.find((c) => c.i === i && c.j === j);
  const walkerCount = 12 + crowdR.int(0, 5);
  for (let k = 0; k < walkerCount; k++) {
    let c = crowdR.pick(L.corners);
    const path = [{ x: c.x, z: c.z }];
    for (let s = 0; s < crowdR.int(3, 6); s++) {
      const opts2 = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => cornerAt(c.i + di, c.j + dj)).filter(Boolean);
      c = crowdR.pick(opts2);
      path.push({ x: c.x, z: c.z });
    }
    L.walkers.push({ path, speed: 0.9 + crowdR.float(0, 0.5), offset: crowdR.float(0, 100), look: crowdR.int(0, 9999), act: 'walk' });
  }
  // Standing groups chatting
  for (let k = 0; k < 4; k++) {
    const c = crowdR.pick(L.corners);
    const n = crowdR.int(2, 3);
    for (let m = 0; m < n; m++) {
      const a = (m / n) * Math.PI * 2;
      const x = c.x + Math.sin(a) * 0.6, z = c.z + Math.cos(a) * 0.6;
      L.civilians.push({ x, z, yaw: yawTo(x, z, c.x, c.z), pose: 'stand', look: crowdR.int(0, 9999), act: 'chat' });
    }
  }

  // Puzzles
  L.glyph = makeGlyphPuzzle(R);
  L.wireBook = makeRulebook(R);
  L.vaultCode = [R.int(0, 9), R.int(0, 9), R.int(0, 9), R.int(0, 9)];
  L.password = makePassword(R);
  L.simon = makeSimon(R);
  L.tiles = makeTiles(R);
  L.morse = makeMorse(R);
  L.maze = makeMazes(R);
  L.breakers = makeBreakers(R);
  L.city = makeCity(R);
  const prize = R.pick(PRIZES);
  L.prize = { id: prize.id, name: prize.name, value: Math.round(R.float(prize.value[0], prize.value[1]) * 10) / 10 * 1e6 };

  // Random events: three from the pool, spread over the run
  const evKeys = R.shuffle(Object.keys(EVENTS)).slice(0, 3);
  L.events = [
    { key: evKeys[0], t: R.float(240, 420) },
    { key: evKeys[1], t: R.float(900, 1300) },
    { key: evKeys[2], t: R.float(1800, 2400) },
  ];

  // Crew spawns on the plaza, facing the front doors
  for (let k = 0; k < 4; k++) L.spawn.push({ x: -3 + k * 2, z: -7, yaw: Math.PI });
  // Overwatch van parked in the dock
  L.van = { x: -W / 2 - 7, z: D + 1 };
  L.parking = { x: -W / 2 - 7, z: D + 1 };
  L.doorIdx = Object.fromEntries(L.doors.map((d) => [d.key, d.id]));
  L.floors = [
    { id: 0, name: 'Ground floor', x1: -W / 2 - 16, x2: W / 2 + 2, z1: -13, z2: D + 16 },
    { id: 1, name: 'B1: Count level', x1: L.deep.b1 - 14, x2: L.deep.b1 + 22, z1: -2, z2: 37 },
    { id: 2, name: 'B2: Vault level', x1: L.deep.b2 - 13, x2: L.deep.b2 + 13, z1: -2, z2: 49 },
  ];
  return L;
}

export function floorOf(L, x) {
  if (x > L.deep.b2 - 20) return 2;
  if (x > L.deep.b1 - 20) return 1;
  return 0;
}

// ---------- Basement floors (B1 count level, B2 vault level) ----------
function buildDeep(L, R, H) {
  const { hwall, vwall, door, solid, zone, cam, guard } = H;
  const b1 = 80, b2 = 150;
  L.deep = { b1, b2 };
  const hw = (o) => (z, xa, xb, gaps, h, kind) => hwall(z, xa + o, xb + o, gaps.map(([a, b]) => [a + o, b + o]), h, kind);
  const vw = (o) => (x, za, zb, gaps, h, kind) => vwall(x + o, za, zb, gaps, h, kind);

  // ===== B1: count level =====
  let h = hw(b1), v = vw(b1), X = (x) => x + b1;
  v(-2, 0, 4, [], 3.6, 'lift'); v(2, 0, 4, [], 3.6, 'lift'); h(0, -2, 2, [], 3.6, 'lift');
  h(4, -9, 9, [[-2, 2]], 3.6, 'b1'); v(-9, 4, 8, [], 3.6, 'b1'); v(9, 4, 8, [], 3.6, 'b1');
  h(8, -9, 9, [[-1, 1]], 4.2, 'b1');
  v(-6, 8, 22, [], 4.2, 'gallery'); v(6, 8, 22, [], 4.2, 'gallery');
  h(22, -11, 11, [[-1, 1]], 4.2, 'count'); v(-11, 22, 34, [], 4.2, 'count'); v(11, 22, 34, [[27, 29]], 4.2, 'count'); h(34, -11, 11, [], 4.2, 'count');
  h(24, 11, 19, [], 3.6, 'b1'); h(32, 11, 19, [], 3.6, 'b1'); v(19, 24, 32, [], 3.6, 'b1');
  door({ key: 'gallery', type: 'basic', label: 'GALLERY', x: X(0), z: 8, axis: 'x', w: 2, h: 3, open: false, locked: false });
  door({ key: 'countdoor', type: 'basic', label: 'COUNT ROOM', x: X(0), z: 22, axis: 'x', w: 2, h: 3, open: false, locked: false });
  door({ key: 'annex', type: 'basic', label: 'ANNEX', x: X(11), z: 28, axis: 'z', w: 2, h: 3, open: false, locked: false });
  zone('b1car', X(-2), 0, X(2), 4, true, 'b1', { label: 'Service lift (B1)', car: 1 });
  zone('b1lobby', X(-9), 4, X(9), 8, true, 'b1', { label: 'B1 lobby' });
  zone('gallery', X(-6), 8, X(6), 22, true, 'b1', { label: 'Pressure gallery' });
  zone('count', X(-11), 22, X(11), 34, true, 'b1', { label: 'Count room' });
  zone('annex', X(11), 24, X(19), 32, true, 'b1', { label: 'B1 annex' });
  L.tileArea = { x1: X(-6), z1: 10, cols: 6, rows: 5, size: 2 };
  // Count room furniture
  for (const [x1, z1] of [[-8.5, 25], [-8.5, 29.5], [4.5, 25], [4.5, 29.5]]) {
    solid(X(x1), z1, X(x1 + 4), z1 + 1.2, 0.9, 'counttable');
    for (let k = 0; k < 3; k++) L.seats.push({ x: X(x1 + 0.7 + k * 1.3), z: z1 - 0.7, yaw: Math.PI, kind: 'table', count: true });
  }
  solid(X(-0.8), 32.6, X(0.8), 34, 1.8, 'safe');
  for (const [x1, z1] of [[13, 30.6], [16.5, 24.6]]) solid(X(x1), z1, X(x1 + 1.2), z1 + 1.2, 1.2, 'crate');
  const cashBase = L.cash.length;
  [[-10, 23.2], [10, 33], [-10, 33]].forEach(([x, z], i) => L.cash.push({ id: cashBase + i, x: X(x), y: 0.9, z, my: 0.9, mz: z, value: 40000 + R.int(0, 4) * 5000 }));
  for (const [x, z] of [[-10, 23.2], [10, 33], [-10, 33]]) solid(X(x) - 0.45, z - 0.35, X(x) + 0.45, z + 0.35, 0.85, 'cart');
  L.interact.push({ id: 'elevB1', kind: 'elevator', x: X(0), y: 1.3, z: 0.4, r: 2.2, floor: 1, label: 'Ride the lift up to the ground floor' });
  L.interact.push({ id: 'stairsB1up', kind: 'stairs', x: X(-8.5), y: 1.3, z: 5.0, r: 1.5, floor: 1, to: 'stairsG', label: 'Fire stairs up to the ground floor' });
  L.interact.push({ id: 'stairsB1down', kind: 'stairs', x: X(-8.5), y: 1.3, z: 7.0, r: 1.5, floor: 1, to: 'stairsB2', label: 'Fire stairs down to B2' });
  L.interact.push({ id: 'breakerB1', kind: 'breaker', x: X(8.55), y: 1.4, z: 6, r: 1.8, floor: 1, label: 'Flip the breaker' });
  L.wardrobe('wardB1', X(4.5), 4.15, X(6.5), 4.6, 0, 1, 'UNIFORMS');
  L.interact.push({ id: 'morseSafe', kind: 'morse', x: X(0), y: 1.2, z: 32.3, r: 2.0, label: 'Tune the safe receiver' });
  L.interact.push({ id: 'mazeLock', kind: 'maze', x: X(18.55), y: 1.35, z: 26.5, r: 1.8, label: 'Work the hatch lock' });
  L.interact.push({ id: 'descend', kind: 'descend', x: X(18.4), y: 0.8, z: 30, r: 1.8, to: 'ascend', label: 'Climb down the hatch to B2' });
  cam({ x: X(8.5), y: 3.2, z: 4.5, label: 'B1 LOBBY', yaw0: yawTo(X(8.5), 4.5, X(-6), 7), sweep: 0.3, period: 9, fov: 1.0, range: 20, zone: 'b1lobby', floor: 1, deep: true });
  cam({ x: X(0), y: 4.0, z: 21.5, label: 'THERMAL', yaw0: 0, sweep: 0, period: 10, fov: 1.15, range: 16, pitch: -0.72, zone: 'gallery', thermal: true, noDetect: true, floor: 1, deep: true });
  cam({ x: X(-10.5), y: 3.8, z: 22.6, label: 'COUNT ROOM W', yaw0: yawTo(X(-10.5), 22.6, X(4), 31), sweep: 0.4, period: 11, fov: 1.05, range: 22, zone: 'count', floor: 1, deep: true });
  cam({ x: X(10.5), y: 3.8, z: 33.4, label: 'COUNT ROOM E', yaw0: yawTo(X(10.5), 33.4, X(-4), 24), sweep: 0.4, period: 12, fov: 1.05, range: 22, zone: 'count', floor: 1, deep: true });
  cam({ x: X(11.6), y: 3.2, z: 31.4, label: 'B1 ANNEX', yaw0: yawTo(X(11.6), 31.4, X(18), 25), sweep: 0.25, period: 9, fov: 1.0, range: 14, zone: 'annex', floor: 1, deep: true });
  guard('guard', 'b1', [{ x: X(-7), z: 6, wait: 3 }, { x: X(7), z: 6, wait: 3 }]);
  guard('guard', 'b1', [{ x: X(-9.5), z: 24.2, wait: 2 }, { x: X(-9.5), z: 32, wait: 3 }, { x: X(2.5), z: 32, wait: 2 }, { x: X(9.5), z: 31, wait: 2 }, { x: X(9.5), z: 24.2, wait: 3 }]);
  guard('guard', 'b1', [{ x: X(14), z: 26.2, wait: 6 }, { x: X(17), z: 29, wait: 6 }]);

  // ===== B2: vault level =====
  h = hw(b2); v = vw(b2); X = (x) => x + b2;
  h(0, -3, 3, [], 3.6, 'b2'); v(-3, 0, 4, [], 3.6, 'b2'); v(3, 0, 4, [], 3.6, 'b2'); h(4, -3, 3, [[-1, 1]], 3.6, 'b2');
  v(-2, 4, 28, [], 3.6, 'b2'); v(2, 4, 28, [], 3.6, 'b2');
  h(28, -10, 10, [[-2, 2]], 4.6, 'vault'); v(-10, 28, 36, [], 4.6, 'vault'); v(10, 28, 36, [], 4.6, 'vault');
  h(36, -10, 10, [[-1.6, 1.6]], 4.6, 'vault');
  v(-10, 36, 46, [], 4.6, 'vault'); v(10, 36, 46, [], 4.6, 'vault'); h(46, -10, 10, [], 4.6, 'vault');
  door({ key: 'irdoor', type: 'basic', label: 'RESTRICTED', x: X(0), z: 4, axis: 'x', w: 2, h: 3, open: false, locked: false });
  door({ key: 'vault', type: 'vault', label: 'VAULT', x: X(0), z: 36, axis: 'x', w: 3.2, h: 3.4, open: false, locked: true });
  zone('b2landing', X(-3), 0, X(3), 4, true, 'b2', { label: 'B2 landing' });
  zone('lasers', X(-2), 4, X(2), 28, true, 'b2', { label: 'IR corridor' });
  zone('ante', X(-10), 28, X(10), 36, true, 'b2', { label: 'Vault antechamber' });
  zone('vault', X(-10), 36, X(10), 46, true, 'b2', { label: 'Vault', jammer: true });
  L.circles.push({ x: X(0), z: 43, r: 0.55, y2: 1.05, kind: 'pedestal' });
  L.interact.push({ id: 'ascend', kind: 'descend', x: X(0), y: 0.8, z: 0.6, r: 1.8, to: 'descend', label: 'Climb back up to B1' });
  L.wardrobe('wardB2', X(-2.85), 1.6, X(-2.4), 3.2, 1, 0, 'SPARE KIT');
  delete L.wardrobe;
  L.interact.push({ id: 'vaultPad', kind: 'vaultPad', x: X(2.5), y: 1.35, z: 35.75, r: 1.8, label: 'Use vault keypad' });
  L.interact.push({ id: 'keyA', kind: 'key', console: 'A', x: X(-7), y: 1.2, z: 35.6, r: 1.8, label: 'Key console A' });
  L.interact.push({ id: 'keyB', kind: 'key', console: 'B', x: X(7), y: 1.2, z: 35.6, r: 1.8, label: 'Key console B' });
  L.interact.push({ id: 'breakerB2', kind: 'breaker', x: X(-9.55), y: 1.4, z: 30.5, r: 1.8, floor: 2, label: 'Flip the breaker' });
  L.interact.push({ id: 'stairsB2', kind: 'stairs', x: X(-9.5), y: 1.3, z: 33.5, r: 1.6, floor: 2, to: 'stairsB1down', label: 'Fire stairs up to B1' });
  L.interact.push({ id: 'prize', kind: 'prize', x: X(0), y: 1.25, z: 43, r: 1.8, label: 'Grab the score' });
  const gz = [6.5, 9.5, 12.5, 15.5, 18.5, 21.5, 24.5];
  const st = R.pick(['high', 'low']);
  const plan = [
    [{ type: st }],
    [{ type: 'curtain', period: R.float(2.6, 3.4), duty: 0.55, phase: R.next() }],
    [{ type: 'sweep', period: R.float(3.6, 4.6), phase: R.next() }],
    [{ type: 'slide', period: R.float(3.0, 3.8), phase: R.next() }],
    [{ type: st === 'high' ? 'low' : 'high' }, { type: 'curtain', period: R.float(2.2, 2.8), duty: 0.5, phase: R.next() }],
    [{ type: 'slide', period: R.float(2.6, 3.2), phase: R.next() }, { type: 'sweep', period: R.float(3.0, 3.6), phase: R.next() }],
    [{ type: 'sweep', period: R.float(2.6, 3.2), phase: R.next() }, { type: 'sweep', period: R.float(2.6, 3.2), phase: R.next() + 0.5 }, { type: 'curtain', period: R.float(4.2, 5), duty: 0.35, phase: R.next() }],
  ];
  gz.forEach((z, i) => L.lasers.push({ z, x1: X(-1.95), x2: X(1.95), cx: X(0), beams: plan[i] }));
  cam({ x: X(0), y: 3.0, z: 27.6, label: 'IR GRID', yaw0: 0, sweep: 0, period: 10, fov: 0.95, range: 26, zone: 'lasers', ir: true, noDetect: true, floor: 2, deep: true });
  cam({ x: X(9.5), y: 4.0, z: 28.5, label: 'ANTECHAMBER', yaw0: yawTo(X(9.5), 28.5, X(-6), 34), sweep: 0.35, period: 10, fov: 1.05, range: 22, zone: 'ante', floor: 2, deep: true });
  guard('guard', 'b2', [{ x: X(-6), z: 31, wait: 4 }, { x: X(6), z: 31, wait: 4 }, { x: X(0), z: 29.6, wait: 3 }]);
  guard('guard', 'b2', [{ x: X(-8), z: 34.4, wait: 6 }, { x: X(8), z: 34.4, wait: 6 }]);
  L.responseSpawn = [{ x: X(-8.5), z: 33.5 }, { x: X(-8), z: 30 }, { x: b1 - 8, z: 6 }, { x: H.W / 2 - 2, z: H.D + 2 }];
  L.timelockSpawn = [{ x: X(0), z: 2 }, { x: X(0.8), z: 1.2 }];
}

// ---------- Elevator terminal: password dials ----------
function makePassword(R) {
  const AZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (let attempt = 0; attempt < 2000; attempt++) {
    const answer = R.pick(PASSWORDS);
    const cols = [];
    for (let k = 0; k < 5; k++) {
      const set = new Set([answer[k]]);
      for (const ch of R.shuffle(PASSWORDS.filter((w) => w !== answer).map((w) => w[k]))) { if (set.size >= 4) break; set.add(ch); }
      while (set.size < 6) set.add(R.pick(AZ));
      cols.push(R.shuffle([...set]));
    }
    const fits = PASSWORDS.filter((w) => [...w].every((ch, k) => cols[k].includes(ch)));
    if (fits.length === 1) return { answer, cols };
  }
  throw new Error('password failed');
}

// ---------- Camera server: signal sequence (Simon) ----------
function makeSimon(R) {
  const vowel = R.chance(0.5);
  const CONS = 'BCDFGHJKLMNPRSTVWXZ', VOW = 'AEU';
  const chars = [];
  for (let i = 0; i < 4; i++) chars.push(R.pick(CONS.split('')));
  if (vowel) chars[R.int(0, 3)] = R.pick(VOW.split(''));
  const serial = `CS-${chars.slice(0, 2).join('')}${R.int(1, 9)}${chars.slice(2).join('')}`;
  const table = () => [0, 1, 2].map(() => {
    let p;
    do { p = R.shuffle([0, 1, 2, 3]); } while (p.every((v, i) => v === i));
    return p;
  });
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(R.int(0, 3));
  return { serial, vowel, tables: { vowel: table(), none: table() }, seq, stages: 5 };
}

// ---------- Pressure gallery: two alternating armed-tile patterns ----------
function makeTiles(R) {
  const cols = 6, rows = 5;
  const pattern = () => {
    const safe = new Set();
    let c = R.int(0, cols - 1);
    for (let r = 0; r < rows; r++) {
      safe.add(r * cols + c);
      if (r === rows - 1) break;
      let steps = R.int(0, 3);
      const dir = c < 2 ? 1 : c > 3 ? -1 : (R.chance(0.5) ? 1 : -1);
      while (steps-- > 0 && c + dir >= 0 && c + dir < cols) { c += dir; safe.add(r * cols + c); }
    }
    const armed = [];
    for (let i = 0; i < cols * rows; i++) armed.push(safe.has(i) ? 0 : R.chance(0.74) ? 1 : 0);
    return armed;
  };
  return { cols, rows, period: 16, A: pattern(), B: pattern() };
}

export function tileArmed(L, t, c, r) {
  const T = L.tiles;
  const pat = Math.floor(t / T.period) % 2 ? T.B : T.A;
  return !!pat[r * T.cols + c];
}

// ---------- Count room safe: Morse beacon ----------
function makeMorse(R) {
  const words = R.shuffle(MORSE_WORDS);
  const table = words.map((w, i) => ({ word: w, freq: (3.505 + i * 0.01).toFixed(3) }));
  const pick = R.pick(table);
  return { word: pick.word, freq: pick.freq, table };
}

// ---------- Hatch lock: six mazes, two marker circles each ----------
function makeMazes(R) {
  const N = 6;
  const mazes = [];
  const used = new Set();
  while (mazes.length < 6) {
    const right = Array.from({ length: N }, () => Array(N).fill(1)); // right[y][x]: wall east of cell
    const down = Array.from({ length: N }, () => Array(N).fill(1)); // down[y][x]: wall south of cell
    const seen = Array.from({ length: N }, () => Array(N).fill(false));
    const stack = [[R.int(0, N - 1), R.int(0, N - 1)]];
    seen[stack[0][1]][stack[0][0]] = true;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy, dx, dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < N && ny < N && !seen[ny][nx]);
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = R.pick(nb);
      if (dx === 1) right[y][x] = 0; if (dx === -1) right[y][nx] = 0;
      if (dy === 1) down[y][x] = 0; if (dy === -1) down[ny][x] = 0;
      seen[ny][nx] = true;
      stack.push([nx, ny]);
    }
    // Knock out a couple of extra walls so there are loops
    for (let k = 0; k < 3; k++) { const x = R.int(0, N - 2), y = R.int(0, N - 1); right[y][x] = 0; }
    const m1 = [R.int(0, N - 1), R.int(0, N - 1)];
    let m2;
    do { m2 = [R.int(0, N - 1), R.int(0, N - 1)]; } while (m2[0] === m1[0] && m2[1] === m1[1]);
    const key = [m1.join(','), m2.join(',')].sort().join('|');
    const cells = [m1.join(','), m2.join(',')];
    if (used.has(key) || mazes.some((mz) => mz.markers.some((mk) => cells.includes(mk.join(','))))) continue;
    used.add(key);
    mazes.push({ right, down, markers: [m1, m2] });
  }
  const which = R.int(0, 5);
  const mz = mazes[which];
  const dist = (s) => {
    const d = Array.from({ length: N }, () => Array(N).fill(-1));
    const q = [s]; d[s[1]][s[0]] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [nx, ny] of mazeMoves(mz, x, y)) if (d[ny][nx] < 0) { d[ny][nx] = d[y][x] + 1; q.push([nx, ny]); }
    }
    return d;
  };
  let start, target;
  for (let tries = 0; tries < 400; tries++) {
    start = [R.int(0, N - 1), R.int(0, N - 1)];
    const d = dist(start);
    const far = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[y][x] >= 8) far.push([x, y]);
    if (far.length) { target = R.pick(far); break; }
  }
  return { mazes, which, start, target, size: N };
}

export function mazeMoves(mz, x, y) {
  const N = mz.right.length, out = [];
  if (x < N - 1 && !mz.right[y][x]) out.push([x + 1, y]);
  if (x > 0 && !mz.right[y][x - 1]) out.push([x - 1, y]);
  if (y < N - 1 && !mz.down[y][x]) out.push([x, y + 1]);
  if (y > 0 && !mz.down[y - 1][x]) out.push([x, y - 1]);
  return out;
}

// ---------- Climax: lockdown breakers ----------
function makeBreakers(R) {
  const colors = R.shuffle(BREAKER_COLORS);
  const phases = R.shuffle(['I', 'II', 'III']);
  const panels = ['breakerB2', 'breakerB1', 'breakerG'].map((id, i) => ({
    id, color: colors[i], phase: phases[i], code: [R.int(0, 9), R.int(0, 9), R.int(0, 9), R.int(0, 9)],
  }));
  return { panels, order: R.shuffle(BREAKER_COLORS) };
}

export function breakerEntry(code, phase) {
  if (phase === 'I') return code.slice().reverse();
  if (phase === 'II') return code.map((d) => (d + 1) % 10);
  const c = code.slice(); const t = c[0]; c[0] = c[3]; c[3] = t; return c;
}

// ---------- Getaway: a city grid with roadblocks ----------
function makeCity(R) {
  const cols = 6, rows = 6, S = 46, road = 12;
  const ox = -(cols * S) / 2, oz = -640;
  const node = (i, j) => ({ x: ox + i * S, z: oz + j * S });
  const start = { i: R.int(1, cols - 1), j: 0 };
  const safe = { i: R.int(0, cols), j: rows };
  const allEdges = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i < cols; i++) allEdges.push([i, j, i + 1, j]);
  for (let i = 0; i <= cols; i++) for (let j = 0; j < rows; j++) allEdges.push([i, j, i, j + 1]);
  const ek = (e) => e.join(',');
  const pathLen = (blocked) => {
    const key = (i, j) => i + ',' + j;
    const dist = new Map([[key(start.i, start.j), 0]]);
    const q = [[start.i, start.j]];
    while (q.length) {
      const [i, j] = q.shift();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni > cols || nj > rows) continue;
        const e = di + dj > 0 ? [i, j, ni, nj] : [ni, nj, i, j];
        if (blocked.has(ek(e)) || dist.has(key(ni, nj))) continue;
        dist.set(key(ni, nj), dist.get(key(i, j)) + 1);
        q.push([ni, nj]);
      }
    }
    return dist.get(key(safe.i, safe.j)) ?? -1;
  };
  let blocks = [];
  for (let attempt = 0; attempt < 400; attempt++) {
    const cand = R.shuffle(allEdges).filter((e) => !(e[0] === start.i && e[1] === start.j) && !(e[2] === start.i && e[3] === start.j)).slice(0, 13);
    const set = new Set(cand.map(ek));
    const len = pathLen(set);
    if (len >= 9) { blocks = cand; break; }
  }
  const roadblocks = blocks.map((e) => { const a = node(e[0], e[1]), b = node(e[2], e[3]); return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, axis: e[1] === e[3] ? 'x' : 'z' }; });
  const buildings = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = node(i, j);
    buildings.push({ x1: a.x + road / 2, z1: a.z + road / 2, x2: a.x + S - road / 2, z2: a.z + S - road / 2, h: R.float(10, 42), tint: R.int(0, 2) });
  }
  const s0 = node(start.i, start.j), s1 = node(safe.i, safe.j);
  return { cols, rows, S, road, ox, oz, start: s0, safe: s1, roadblocks, buildings, time: 210 };
}
