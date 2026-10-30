// Builds the 3D world for a generated heist and keeps dynamic objects in sync with snapshots.
import * as THREE from 'three';
import {
  makeTextures, drawSlotScreen, neonTexture, labelTexture, boxGeo, Batch,
  SKIN, HAIR, OUTFIT, PANTS, RIG_PARTS, rigGeometry, rigMatrix, makePersonGroup, posePerson, textSprite, diamondSprite,
} from './art.js';
import { doorBox } from '../shared/geom.js';
import { floorOf, tileArmed } from '../shared/gen.js';
import { MORSE } from '../shared/data.js';
import { ROLES } from '../shared/data.js';
import { makeRng } from '../shared/rng.js';

export const IR_LAYER = 1;
const CURTAIN_Y = [0.25, 0.6, 0.95, 1.3, 1.65];
// Crew outfits: 0 is the heist suit, the rest are what's in the lockers
const OUTFITS = [
  { top: '#1f1f26', pants: '#15151a' },
  { top: '#e8e4da', arms: '#e8e4da', pants: '#17171c' }, // waiter whites
  { top: '#3a4a5c', pants: '#2a3442' },                  // maintenance coveralls
  { top: '#5b1a26', pants: '#141418' },                  // floor staff blazer
  { top: '#2e3b2c', pants: '#23271f' },                  // count-room grey-green
];

export function beamState(b, t, locked = false) {
  if (locked) return CURTAIN_Y.map((y) => ({ y, on: true }));
  switch (b.type) {
    case 'slide': return [{ y: 1.0, on: true, vertical: true, dx: 1.55 * Math.sin((2 * Math.PI * t) / b.period + b.phase * 2 * Math.PI) }];
    case 'high': return [{ y: 1.3, on: true }];
    case 'low': return [{ y: 0.32, on: true }];
    case 'sweep': return [{ y: 0.95 + 0.75 * Math.sin((2 * Math.PI * t) / b.period + b.phase * 2 * Math.PI), on: true }];
    case 'curtain': { const on = ((t / b.period + b.phase) % 1) < b.duty; return CURTAIN_Y.map((y) => ({ y, on })); }
  }
  return [];
}

// Morse beacon: returns true while the lamp is lit. Unit = 0.22s.
const morseCache = new Map();
export function morseTimeline(word) {
  if (morseCache.has(word)) return morseCache.get(word);
  const segs = [];
  [...word].forEach((ch, li) => {
    [...MORSE[ch]].forEach((sym, si) => {
      segs.push([1, sym === '.' ? 1 : 3]);
      if (si < MORSE[ch].length - 1) segs.push([0, 1]);
    });
    if (li < word.length - 1) segs.push([0, 3]);
  });
  segs.push([0, 9]);
  const total = segs.reduce((a, s2) => a + s2[1], 0);
  const out = { segs, total };
  morseCache.set(word, out);
  return out;
}
export function morseOn(word, t) {
  const tl = morseTimeline(word);
  let u = (t / 0.22) % tl.total;
  for (const [on, len] of tl.segs) { if (u < len) return !!on; u -= len; }
  return false;
}

export function camYaw(c, t) { return c.yaw0 + c.sweep * Math.sin((t * Math.PI * 2) / c.period); }

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.0, ...o });
const sunlit = (m, k = 0.75) => { m.emissive = new THREE.Color(0xffffff); if (m.map) m.emissiveMap = m.map; else m.emissive = m.color.clone(); m.emissiveIntensity = k; return m; };

export class World {
  constructor(level, opts = {}) {
    this.L = level;
    this.opts = opts;
    this.scene = new THREE.Scene();
    this.T = makeTextures(level.theme);
    this.t = 0;
    this.simT = 0;
    this.dark = {};
    this.panicUntil = 0;
    this.panicAt = null;
    this.jackpot = null;
    this.surgeUntil = 0;
    this.build();
  }

  // ---------- Build ----------
  build() {
    const L = this.L, T = this.T, S = this.scene;
    const W = L.W, D = L.D;
    S.background = new THREE.Color('#9fcff5');

    // Sky dome (broad daylight)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#3f8de0') }, mid: { value: new THREE.Color('#a9d6ff') }, bot: { value: new THREE.Color('#ffe2b0') } },
      vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.15 ? mix(mid, top, smoothstep(0.15, 0.8, h)) : mix(bot, mid, smoothstep(-0.05, 0.15, h)); gl_FragColor = vec4(c, 1.0); }',
    }));
    sky.layers.enableAll();
    S.add(sky);

    // Lights
    this.hemi = new THREE.HemisphereLight('#ffe7c2', '#3a1f12', 1.15);
    this.hemi.layers.enableAll();
    S.add(this.hemi);
    // A fixed pool of point lights is moved to whichever floor is being rendered,
    // so the light count (and shaders) never change.
    const X1 = (x) => x + L.deep.b1, X2 = (x) => x + L.deep.b2;
    const spec = (zone, color, x, y, z, intensity, dist) => ({ zone, color: new THREE.Color(color), x, y, z, intensity, dist });
    this.lightSpecs = [
      [
        spec('casino', '#ffcf8a', -W / 4, 6, D * 0.3, 70, 30), spec('casino', '#ffcf8a', W / 4, 6, D * 0.3, 70, 30),
        spec('casino', '#ffb36b', -W / 4, 6, D * 0.75, 70, 30), spec('casino', '#ffb36b', W / 4, 6, D * 0.75, 70, 30),
        spec('backhouse', '#d8f0ff', -W / 4, 3.2, D + 2, 22, 22), spec('backhouse', '#d8f0ff', W / 4, 3.2, D + 2, 22, 22),
        spec('backhouse', '#b8dcff', L.hub.x1 + 6, 3.2, D + 9, 22, 16),
      ],
      [
        spec('b1', '#d8f0ff', X1(0), 3.2, 6, 18, 18), spec('b1', '#ffcf9a', X1(0), 3.8, 15, 12, 16),
        spec('b1', '#fff1d0', X1(-6), 3.8, 27, 22, 18), spec('b1', '#fff1d0', X1(6), 3.8, 27, 22, 18),
        spec('b1', '#fff1d0', X1(0), 3.8, 32, 14, 14), spec('b1', '#d8f0ff', X1(15), 3.2, 28, 12, 12),
      ],
      [
        spec('b2', '#d8f0ff', X2(0), 3.2, 2, 10, 10), spec('b2', '#ff6b6b', X2(0), 3.2, 16, 10, 18),
        spec('b2', '#ffd88a', X2(-5), 4.2, 32, 14, 16), spec('b2', '#ffd88a', X2(5), 4.2, 32, 14, 16),
        spec('b2', '#ffe9b0', X2(-4), 4.2, 41, 10, 12), spec('b2', '#ffe9b0', X2(4), 4.2, 41, 10, 12),
      ],
    ];
    this.pool = [];
    for (let i = 0; i < 7; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 20, 1.4);
      l.layers.enableAll();
      S.add(l); this.pool.push(l);
    }
    this.protocolOn = false;

    const M = this.mats = {
      carpet: std({ map: T.carpet, roughness: 0.95 }),
      wallpaper: std({ map: T.wallpaper, roughness: 0.8 }),
      boh: std({ map: T.bohWall, roughness: 0.85 }),
      steel: std({ map: T.steel, color: '#8d939b', roughness: 0.4, metalness: 0.55 }),
      concrete: std({ map: T.concrete, roughness: 0.9 }),
      marble: std({ map: T.marble, roughness: 0.25, metalness: 0.1 }),
      plaza: sunlit(std({ map: T.plaza, roughness: 0.9 }), 0.8),
      asphalt: sunlit(std({ map: T.asphalt, roughness: 0.95 }), 0.55),
      dockFloor: std({ map: T.asphalt, roughness: 0.95 }),
      ceiling: std({ map: T.ceiling, roughness: 0.9 }),
      ceilingBoh: std({ color: '#8b8f96', roughness: 0.9 }),
      gold: std({ color: '#d9a441', roughness: 0.3, metalness: 0.8, emissive: '#3a2508', emissiveIntensity: 0.6 }),
      goldGlow: std({ color: '#ffd27a', emissive: '#ffb84d', emissiveIntensity: 1.6 }),
      wood: std({ map: T.wood, roughness: 0.6 }),
      darkwood: std({ color: '#2a170d', roughness: 0.6 }),
      felt: std({ map: T.felt, roughness: 0.95 }),
      rim: std({ color: '#3a1f10', roughness: 0.4 }),
      leather: std({ color: '#5c1420', roughness: 0.55 }),
      chrome: std({ color: '#c9ced4', roughness: 0.2, metalness: 0.9 }),
      slotBody: std({ color: '#2a0f3a', roughness: 0.45, metalness: 0.3 }),
      slotScreen: new THREE.MeshBasicMaterial({ map: T.slotScreen, toneMapped: false }),
      slotTop: [
        std({ color: '#ff2f6e', emissive: '#ff2f6e', emissiveIntensity: 1.8 }),
        std({ color: '#2fd8ff', emissive: '#2fd8ff', emissiveIntensity: 1.8 }),
        std({ color: '#ffd23f', emissive: '#ffc21f', emissiveIntensity: 1.8 }),
      ],
      glass: new THREE.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, depthWrite: false }),
      bottle: std({ color: '#7fd1a8', emissive: '#2f8a5d', emissiveIntensity: 0.9, roughness: 0.1 }),
      bottle2: std({ color: '#e09a52', emissive: '#a35a1e', emissiveIntensity: 0.9, roughness: 0.1 }),
      amber: std({ color: '#ffb24d', emissive: '#ff9a2e', emissiveIntensity: 2.0 }),
      velvet: std({ color: '#6b1530', roughness: 0.9 }),
      plant: std({ color: '#2f7a3a', roughness: 0.8, flatShading: true }),
      planterPot: std({ color: '#d9cdb5', roughness: 0.8 }),
      crate: std({ color: '#8a6238', roughness: 0.9, flatShading: true }),
      rack: std({ color: '#1c1f24', roughness: 0.5, metalness: 0.4 }),
      locker: sunlit(std({ color: '#4f6f8c', roughness: 0.45, metalness: 0.3 }), 0.35),
      led: std({ color: '#7dffb0', emissive: '#3dff8a', emissiveIntensity: 2.2 }),
      screenBlue: std({ color: '#5fb8ff', emissive: '#3f9bff', emissiveIntensity: 1.6 }),
      stucco: sunlit(std({ color: '#efe3c8', roughness: 0.85 }), 0.55),
      facadeGold: sunlit(std({ color: '#d9a441', roughness: 0.4, metalness: 0.5 }), 0.4),
      bulbs: std({ color: '#fff1c4', emissive: '#ffd77a', emissiveIntensity: 2.4 }),
      hedge: sunlit(std({ color: '#3f8f45', roughness: 0.9, flatShading: true }), 0.4),
      cityA: sunlit(std({ color: '#d8c8ae', roughness: 0.9 }), 0.6),
      cityB: sunlit(std({ color: '#b9c7d6', roughness: 0.9 }), 0.6),
      cityC: sunlit(std({ color: '#e7b98c', roughness: 0.9 }), 0.6),
      window: sunlit(std({ color: '#7fb3d8', roughness: 0.2, metalness: 0.4 }), 0.5),
      palm: sunlit(std({ color: '#7a5a3a', roughness: 0.9, flatShading: true }), 0.5),
      palmLeaf: sunlit(std({ color: '#3d9a4a', roughness: 0.8, flatShading: true, side: THREE.DoubleSide }), 0.5),
      stripes: std({ map: T.stripes, roughness: 0.8 }),
      vaultDark: std({ color: '#1a1b20', roughness: 0.4, metalness: 0.6 }),
      deposit: std({ color: '#9a7a3a', roughness: 0.35, metalness: 0.8 }),
      cash: std({ color: '#6fbf73', roughness: 0.8 }),
      redLed: std({ color: '#ff3030', emissive: '#ff2020', emissiveIntensity: 3 }),
      camBody: std({ color: '#e9e7e2', roughness: 0.4 }),
      camDark: std({ color: '#15161a', roughness: 0.3 }),
      van: std({ color: '#f2efe6', roughness: 0.5, metalness: 0.1 }),
      tire: std({ color: '#151515', roughness: 0.9 }),
      galleryWall: std({ color: '#2b2f36', roughness: 0.7, metalness: 0.2 }),
      countWall: std({ color: '#7f8a78', roughness: 0.85 }),
      plate: std({ color: '#5d636b', roughness: 0.45, metalness: 0.6 }),
      fireDoor: std({ color: '#b3261e', roughness: 0.5, metalness: 0.2 }),
      exitSign: std({ color: '#3dff8a', emissive: '#22ff77', emissiveIntensity: 1.6 }),
      beacon: new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }),
      chandelier: std({ color: '#fff3d6', emissive: '#ffd99a', emissiveIntensity: 2.2, roughness: 0.1, flatShading: true }),
    };

    const B = new Batch();
    const box = (mat, x1, y1, z1, x2, y2, z2, scale = 2) => B.addAt(boxGeo(x2 - x1, y2 - y1, z2 - z1, scale), mat, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    const plane = (mat, x1, z1, x2, z2, y, scale, down = false) => {
      const g = new THREE.PlaneGeometry(x2 - x1, z2 - z1);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x2 - x1) / scale, uv.getY(i) * (z2 - z1) / scale);
      const m = new THREE.Matrix4().makeRotationX(down ? Math.PI / 2 : -Math.PI / 2);
      m.setPosition((x1 + x2) / 2, y, (z1 + z2) / 2);
      B.add(g, mat, m);
    };

    // Floors
    plane(M.carpet, -W / 2, 0, W / 2, D, 0, 4);
    plane(M.plaza, -14, -14, 14, 0, 0, 3);
    plane(M.asphalt, -90, -70, 90, -14, -0.02, 6);
    plane(M.plaza, -90, -17, 90, -14, 0.01, 3);
    plane(M.concrete, -W / 2, D, W / 2, D + 14, 0, 4);
    plane(M.steel, L.lx - 2, D + 4, L.lx + 2, D + 8, 0.005, 2);
    // B1 + B2 floors
    plane(M.steel, X1(-2), 0, X1(2), 4, 0.005, 2);
    plane(M.concrete, X1(-9), 4, X1(9), 8, 0, 4);
    plane(M.concrete, X1(-6), 8, X1(6), 22, 0, 4);
    plane(M.marble, X1(-11), 22, X1(11), 34, 0, 6);
    plane(M.concrete, X1(11), 24, X1(19), 32, 0, 4);
    plane(M.concrete, X2(-3), 0, X2(3), 28, 0, 4);
    plane(M.marble, X2(-10), 28, X2(10), 46, 0, 6);
    plane(M.dockFloor, -W / 2 - 14, D - 6, -W / 2, D + 8, 0, 4);
    // Ceilings
    plane(M.ceiling, -W / 2, 0, W / 2, D, 7, 4, true);
    plane(M.ceilingBoh, -W / 2, D, W / 2, D + 4, 3.6, 4, true);
    plane(M.ceilingBoh, -W / 2, D + 4, -W / 2 + 9, D + 14, 3.6, 4, true);
    plane(M.ceilingBoh, L.hub.x1, D + 4, L.hub.x2, D + 14, 3.6, 4, true);
    plane(M.ceilingBoh, L.lx - 2, D + 4, L.lx + 2, D + 8, 3.6, 4, true);
    plane(M.ceilingBoh, X1(-9), 0, X1(9), 8, 3.6, 4, true);
    plane(M.vaultDark, X1(-6), 8, X1(6), 22, 4.2, 4, true);
    plane(M.ceilingBoh, X1(-11), 22, X1(11), 34, 4.2, 4, true);
    plane(M.ceilingBoh, X1(11), 24, X1(19), 32, 3.6, 4, true);
    plane(M.ceilingBoh, X2(-3), 0, X2(3), 28, 3.6, 4, true);
    plane(M.vaultDark, X2(-10), 28, X2(10), 46, 4.6, 4, true);
    plane(M.ceilingBoh, -W / 2 - 14, D - 6, -W / 2, D + 8, 6, 4, true);

    // Walls
    for (const w of L.walls) {
      const mat = { casino: M.wallpaper, boh: M.boh, b1: M.boh, b2: M.boh, vault: M.steel, lift: M.steel, dock: M.concrete, gallery: M.galleryWall, count: M.countWall }[w.kind] || M.planterPot;
      box(mat, w.x1, 0, w.z1, w.x2, w.y2, w.z2, w.kind === 'casino' ? 3 : 2.5);
      if (w.kind === 'plaza') {
        B.addAt(new THREE.BoxGeometry(w.x2 - w.x1 - 0.1, 0.5, w.z2 - w.z1 - 0.1), M.hedge, (w.x1 + w.x2) / 2, w.y2 + 0.2, (w.z1 + w.z2) / 2);
      }
      if (w.kind === 'casino') {
        // Gold chair rail and baseboard on casino walls
        const ex = w.x2 - w.x1 > w.z2 - w.z1;
        const g1 = ex ? new THREE.BoxGeometry(w.x2 - w.x1, 0.08, w.z2 - w.z1 + 0.06) : new THREE.BoxGeometry(w.x2 - w.x1 + 0.06, 0.08, w.z2 - w.z1);
        B.addAt(g1, M.gold, (w.x1 + w.x2) / 2, 1.1, (w.z1 + w.z2) / 2);
        B.addAt(g1, M.gold, (w.x1 + w.x2) / 2, 6.6, (w.z1 + w.z2) / 2);
        const g2 = ex ? new THREE.BoxGeometry(w.x2 - w.x1, 1.05, w.z2 - w.z1 + 0.03) : new THREE.BoxGeometry(w.x2 - w.x1 + 0.03, 1.05, w.z2 - w.z1);
        B.addAt(g2, M.darkwood, (w.x1 + w.x2) / 2, 0.53, (w.z1 + w.z2) / 2);
      }
    }

    // Facade of Stanley's Palace
    box(M.stucco, -W / 2 - 0.6, 0, -0.75, -4.6, 10, -0.22, 3);
    box(M.stucco, 4.6, 0, -0.75, W / 2 + 0.6, 10, -0.22, 3);
    box(M.stucco, -4.6, 3.6, -0.75, 4.6, 10, -0.22, 3);
    box(M.facadeGold, -W / 2 - 0.8, 9.6, -0.95, W / 2 + 0.8, 10.4, -0.2);
    box(M.facadeGold, -W / 2 - 0.8, 0, -0.95, W / 2 + 0.8, 0.4, -0.2);
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 4) { if (Math.abs(x) > 5) box(M.facadeGold, x - 0.25, 0.4, -0.95, x + 0.25, 9.6, -0.6); }
    // Marquee canopy over the doors
    box(M.facadeGold, -6.5, 3.6, -4.2, 6.5, 4.1, -0.6);
    for (let x = -6.2; x <= 6.2; x += 0.62) B.addAt(new THREE.SphereGeometry(0.07, 6, 4), M.bulbs, x, 3.55, -4.15);
    for (let z = -4.1; z <= -0.8; z += 0.55) { B.addAt(new THREE.SphereGeometry(0.07, 6, 4), M.bulbs, -6.45, 3.55, z); B.addAt(new THREE.SphereGeometry(0.07, 6, 4), M.bulbs, 6.45, 3.55, z); }
    // Revolving-door frames
    for (const x of [-3.2, 0, 3.2]) box(M.gold, x - 0.08, 0, -0.5, x + 0.08, 3.6, -0.2);
    box(M.gold, -4.4, 3.4, -0.5, 4.4, 3.6, -0.2);

    // City across the street (sunlit)
    const cityR = makeRng(L.seed ^ 0x777);
    for (let x = -88; x < 88; x += cityR.float(9, 15)) {
      const w = cityR.float(7, 12), h = cityR.float(12, 48), d = cityR.float(10, 16);
      const mat = cityR.pick([M.cityA, M.cityB, M.cityC]);
      box(mat, x, 0, -60 - d, x + w, h, -60, 6);
      for (let y = 3; y < h - 2; y += 3.4) box(M.window, x + 0.6, y, -60.05, x + w - 0.6, y + 1.6, -59.95);
    }
    // Palms + lamps on the plaza
    for (const px of [-10, 10]) for (const pz of [-3, -9]) {
      B.addAt(new THREE.CylinderGeometry(0.16, 0.24, 6, 6), M.palm, px, 3, pz);
      for (let k = 0; k < 6; k++) {
        const g = new THREE.ConeGeometry(0.5, 3, 4, 1, true);
        const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2 + 0.4);
        m.premultiply(new THREE.Matrix4().makeRotationY((k / 6) * Math.PI * 2));
        m.premultiply(new THREE.Matrix4().makeTranslation(px, 6, pz));
        g.translate(0, 1.5, 0);
        B.add(g, M.palmLeaf, m);
      }
    }

    // ---------- Casino furniture ----------
    // Bar
    const bx1 = -W / 2 + 3, bz1 = 7, bz2 = D - 7;
    box(M.wood, bx1, 0, bz1, bx1 + 0.8, 1.05, bz2);
    box(M.marble, bx1 - 0.1, 1.05, bz1 - 0.1, bx1 + 0.95, 1.12, bz2 + 0.1);
    box(M.amber, bx1 + 0.8, 0.12, bz1, bx1 + 0.83, 0.16, bz2);
    box(M.darkwood, -W / 2 + 0.2, 0, bz1, -W / 2 + 0.8, 2.4, bz2);
    for (const y of [1.0, 1.55, 2.1]) {
      box(M.amber, -W / 2 + 0.22, y - 0.04, bz1, -W / 2 + 0.26, y, bz2);
      for (let z = bz1 + 0.3; z < bz2 - 0.2; z += 0.22) {
        B.addAt(new THREE.CylinderGeometry(0.045, 0.05, 0.3, 6), (Math.floor(z * 5) % 2) ? M.bottle : M.bottle2, -W / 2 + 0.55, y + 0.16, z);
      }
    }
    for (const s of L.seats) {
      if (s.kind === 'stool') {
        B.addAt(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10), M.leather, s.x, 0.78, s.z);
        B.addAt(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), M.chrome, s.x, 0.38, s.z);
        B.addAt(new THREE.CylinderGeometry(0.22, 0.25, 0.04, 10), M.chrome, s.x, 0.02, s.z);
      }
    }
    // Cashier cage
    const cx1 = W / 2 - 10;
    box(M.wood, cx1, 0, D - 7.3, W / 2 - 1.8, 1.15, D - 6.7);
    box(M.marble, cx1, 1.15, D - 7.35, W / 2 - 1.8, 1.2, D - 6.65);
    box(M.glass, cx1, 1.2, D - 7.05, W / 2 - 1.8, 3.0, D - 6.95);
    for (let x = cx1; x < W / 2 - 1.8; x += 0.35) box(M.gold, x, 1.2, D - 7.02, x + 0.03, 3.0, D - 6.98);
    box(M.wood, cx1 - 0.3, 0, D - 7, cx1 + 0.3, 1.15, D);
    box(M.glass, cx1 - 0.05, 1.15, D - 7, cx1 + 0.05, 3.0, D);
    box(M.darkwood, W / 2 - 9, 0, D - 1.0, W / 2 - 2, 2.0, D - 0.3);
    // Ceiling chandeliers
    for (let x = -W / 2 + 6; x < W / 2 - 3; x += 8) for (let z = 5; z < D - 2; z += 8) {
      B.addAt(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4), M.gold, x, 6.4, z);
      B.addAt(new THREE.OctahedronGeometry(0.55, 0), M.chandelier, x, 5.6, z, 0, 1, 1.3, 1);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; B.addAt(new THREE.OctahedronGeometry(0.18, 0), M.chandelier, x + Math.cos(a) * 0.9, 5.5, z + Math.sin(a) * 0.9); }
    }

    // Slot banks
    this.slotTops = [];
    for (const bank of L.slotBanks) {
      for (const m of bank.machines) {
        const f = m.face; // +1 faces +z, -1 faces -z
        const ry = f > 0 ? 0 : Math.PI;
        B.addAt(new THREE.BoxGeometry(0.86, 1.45, 0.66), M.slotBody, m.x, 0.725, m.z, ry);
        B.addAt(new THREE.BoxGeometry(0.9, 0.06, 0.7), M.gold, m.x, 1.47, m.z, ry);
        const sg = new THREE.PlaneGeometry(0.62, 0.48);
        const mm = new THREE.Matrix4().makeRotationY(ry);
        mm.setPosition(m.x, 1.12, m.z + f * 0.335);
        B.add(sg, M.slotScreen, mm);
        B.addAt(new THREE.BoxGeometry(0.7, 0.12, 0.2), M.chrome, m.x, 0.78, m.z + f * 0.38, ry);
        B.addAt(new THREE.BoxGeometry(0.8, 0.38, 0.3), M.slotTop[(Math.round(m.x * 3) + bank.id) % 3], m.x, 1.7, m.z, ry);
        // Stool
        const sx = m.x, sz = m.z + f * 0.9;
        B.addAt(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 10), M.leather, sx, 0.66, sz);
        B.addAt(new THREE.CylinderGeometry(0.035, 0.035, 0.64, 6), M.chrome, sx, 0.33, sz);
      }
      // Bank sign
      const sign = new THREE.Mesh(new THREE.BoxGeometry(bank.len, 0.4, 0.1), M.slotTop[bank.id % 3]);
      sign.position.set(bank.x, 2.35, bank.z);
      this.scene.add(sign);
      this.slotTops.push(sign);
    }

    // Tables
    for (const t of L.tables) {
      if (t.kind === 'blackjack') {
        const start = t.flip > 0 ? -Math.PI / 2 : Math.PI / 2;
        const top = new THREE.CylinderGeometry(1.3, 1.3, 0.1, 24, 1, false, start, Math.PI);
        B.addAt(top, M.felt, t.x, 0.82, t.z);
        B.addAt(new THREE.CylinderGeometry(1.42, 1.42, 0.12, 24, 1, false, start, Math.PI), M.rim, t.x, 0.76, t.z);
        B.addAt(new THREE.BoxGeometry(2.84, 0.14, 0.2), M.rim, t.x, 0.79, t.z - t.flip * 0.0);
        B.addAt(new THREE.CylinderGeometry(0.3, 0.45, 0.72, 8), M.darkwood, t.x, 0.36, t.z);
        B.addAt(new THREE.BoxGeometry(0.6, 0.06, 0.16), M.gold, t.x, 0.9, t.z - t.flip * 0.12);
      } else {
        const g = new THREE.CylinderGeometry(1, 1, 0.1, 24);
        const sx = t.rot ? 0.95 : 1.7, sz = t.rot ? 1.7 : 0.95;
        B.addAt(g, M.felt, t.x, 0.82, t.z, 0, sx, 1, sz);
        B.addAt(new THREE.CylinderGeometry(1, 1, 0.12, 24), M.rim, t.x, 0.76, t.z, 0, sx + 0.12, 1, sz + 0.12);
        B.addAt(new THREE.CylinderGeometry(0.35, 0.5, 0.72, 8), M.darkwood, t.x, 0.36, t.z);
      }
    }
    for (const s of L.seats) {
      if (s.kind !== 'table') continue;
      B.addAt(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 10), M.leather, s.x, 0.62, s.z);
      B.addAt(new THREE.BoxGeometry(0.44, 0.5, 0.08), M.leather, s.x - Math.sin(s.yaw) * -0.22, 0.9, s.z - Math.cos(s.yaw) * -0.22, s.yaw);
      B.addAt(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), M.gold, s.x, 0.3, s.z);
    }
    // Lounges
    for (const lg of L.lounges) {
      for (const s of [-1, 1]) {
        box(M.velvet, lg.x - 1.2, 0, lg.z + s * 0.8, lg.x + 1.2, 0.45, lg.z + s * 1.6);
        box(M.velvet, lg.x - 1.2, 0.45, lg.z + s * 1.45, lg.x + 1.2, 0.95, lg.z + s * 1.6);
      }
      box(M.marble, lg.x - 0.6, 0, lg.z - 0.35, lg.x + 0.6, 0.45, lg.z + 0.35);
      B.addAt(new THREE.CylinderGeometry(0.3, 0.22, 0.6, 8), M.planterPot, lg.x + 1.7, 0.3, lg.z);
      B.addAt(new THREE.IcosahedronGeometry(0.5, 0), M.plant, lg.x + 1.7, 1.0, lg.z);
    }
    // Decor: stage, planters, pillars
    for (const d of L.decor) {
      if (d.kind === 'stage') {
        B.addAt(new THREE.CylinderGeometry(2.6, 2.75, 0.45, 32), M.marble, d.x, 0.225, d.z);
        B.addAt(new THREE.TorusGeometry(2.62, 0.06, 6, 40), M.goldGlow, d.x, 0.45, d.z);
        B.addAt(new THREE.CylinderGeometry(0.9, 1.0, 0.8, 16), M.gold, d.x, 0.85, d.z);
        const wheel = new THREE.Group();
        const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 37), [M.gold, new THREE.MeshStandardMaterial({ map: T.roulette, emissive: '#ffffff', emissiveMap: T.roulette, emissiveIntensity: 0.35, roughness: 0.4 }), M.gold]);
        disk.rotation.x = Math.PI / 2;
        wheel.add(disk);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.1, 8, 40), M.goldGlow);
        wheel.add(rim);
        wheel.position.set(d.x, 3.0, d.z);
        this.scene.add(wheel);
        this.wheel = wheel;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: neonTexture("Stanley's", '#ff3d8b'), transparent: true, toneMapped: false, depthWrite: false }));
        sign.position.set(d.x, 5.6, d.z);
        sign.rotation.y = Math.PI;
        this.scene.add(sign);
        this.stageSign = sign;
        const back = sign.clone(); back.rotation.y = 0; back.position.z += 0.02; this.scene.add(back);
      } else if (d.kind === 'planter') {
        B.addAt(new THREE.CylinderGeometry(0.7, 0.55, 0.9, 10), M.planterPot, d.x, 0.45, d.z);
        B.addAt(new THREE.IcosahedronGeometry(0.8, 0), M.plant, d.x, 1.4, d.z);
      } else if (d.kind === 'pillar') {
        B.addAt(new THREE.CylinderGeometry(0.42, 0.42, 7, 12), M.marble, d.x, 3.5, d.z);
        B.addAt(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12), M.gold, d.x, 0.18, d.z);
        B.addAt(new THREE.CylinderGeometry(0.6, 0.45, 0.4, 12), M.gold, d.x, 6.8, d.z);
        B.addAt(new THREE.TorusGeometry(0.44, 0.04, 4, 16), M.goldGlow, d.x, 2.6, d.z, 0, 1, 1, 1);
      }
    }

    // Neon signs
    const neon = (text, color, x, y, z, w, h, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: neonTexture(text, color), transparent: true, toneMapped: false, depthWrite: false }));
      m.position.set(x, y, z); m.rotation.y = ry;
      this.scene.add(m);
      return m;
    };
    neon('Bar', '#ff9a2e', -W / 2 + 0.25, 4.4, D / 2, 5, 1.25, Math.PI / 2);
    neon('Cashier', '#46e0ff', W / 2 - 5.5, 3.6, D - 7.45, 4.4, 1.1, Math.PI);
    neon("Stanley's Palace", '#ff3d8b', 0, 7.9, -1.0, 20, 5, Math.PI);
    neon('Open 24 hours', '#ffd23f', 0, 4.6, -4.25, 7, 1.75, Math.PI);
    if (L.slotBanks.length) { const b = L.slotBanks[0]; neon('Slots', '#2fd8ff', b.x, 5.2, b.z, 4, 1, 0); }

    // ---------- Back of house ----------
    const hub = L.hub;
    box(M.darkwood, hub.x1 + 4, 0, D + 8.2, hub.x1 + 8, 0.9, D + 9.2);
    for (let k = 0; k < 4; k++) {
      B.addAt(new THREE.BoxGeometry(0.75, 0.5, 0.06), M.screenBlue, hub.x1 + 4.5 + k, 1.25, D + 9.1);
    }
    for (let k = 0; k < 3; k++) {
      const rx = hub.x1 + (hub.east ? 10.6 : 0.6);
      box(M.rack, rx, 0, D + 5 + k * 1.6, rx + 1.0, 2.2, D + 6.2 + k * 1.6);
      for (let y = 0.3; y < 2.1; y += 0.25) B.addAt(new THREE.BoxGeometry(0.04, 0.03, 0.9), M.led, hub.east ? rx - 0.02 : rx + 1.02, y, D + 5.6 + k * 1.6);
    }
    for (const s of L.solids) if (s.kind === 'crate') box(M.crate, s.x1, 0, s.z1, s.x2, s.y2, s.z2, 1);
    // Wardrobes (change of clothes)
    for (const it of L.interact) {
      if (it.kind !== 'wardrobe') continue;
      const b = it.box;
      box(M.locker, b.x1, 0, b.z1, b.x2, 2.2, b.z2, 1);
      const along = it.nx === 0; // locker row runs along x
      const len = along ? b.x2 - b.x1 : b.z2 - b.z1;
      const n = Math.max(2, Math.round(len / 0.5));
      for (let k = 1; k < n; k++) {
        const u = (along ? b.x1 : b.z1) + (len * k) / n;
        const fx = it.nx > 0 ? b.x2 : b.x1, fz = it.nz > 0 ? b.z2 : b.z1;
        if (along) box(M.camDark, u - 0.015, 0.1, fz - 0.01, u + 0.015, 2.1, fz + 0.01);
        else box(M.camDark, fx - 0.01, 0.1, u - 0.015, fx + 0.01, 2.1, u + 0.015);
      }
    }
    // Storage shelves
    box(M.rack, -W / 2 + 0.3, 0, D + 4.6, -W / 2 + 1.0, 2.5, D + 8);
    // Hazard stripes at the service lift and the IR corridor entrance
    box(M.stripes, L.lx - 2, 0.01, D + 3.4, L.lx + 2, 0.02, D + 3.9, 1);
    box(M.stripes, X2(-2), 0.01, 4.3, X2(2), 0.02, 4.9, 1);
    // Laser emitters
    for (const g of L.lasers) {
      for (const sx of [g.x1 - 0.02, g.x2 + 0.02]) box(M.camDark, sx - 0.06, 0.1, g.z - 0.08, sx + 0.06, 1.85, g.z + 0.08);
      box(M.camDark, g.x1, 3.45, g.z - 0.08, g.x2, 3.55, g.z + 0.08);
    }
    // B1: count room tables with cash, carts, counting machines
    for (const so of L.solids) {
      if (so.kind === 'counttable') {
        box(M.darkwood, so.x1, 0, so.z1, so.x2, so.y2, so.z2, 1);
        for (let k = 0; k < 5; k++) box(M.cash, so.x1 + 0.4 + k * 0.7, so.y2, so.z1 + 0.3, so.x1 + 0.7 + k * 0.7, so.y2 + 0.08 + (k % 2) * 0.06, so.z1 + 0.5);
        box(M.rack, so.x2 - 1.0, so.y2, so.z1 + 0.6, so.x2 - 0.3, so.y2 + 0.35, so.z2 - 0.1);
        box(M.screenBlue, so.x2 - 0.95, so.y2 + 0.2, so.z1 + 0.59, so.x2 - 0.35, so.y2 + 0.32, so.z1 + 0.6);
      } else if (so.kind === 'cart') {
        box(M.chrome, so.x1, 0.15, so.z1, so.x2, 0.2, so.z2, 1);
        box(M.cash, so.x1 + 0.05, 0.2, so.z1 + 0.05, so.x2 - 0.05, 0.75, so.z2 - 0.05, 1);
      } else if (so.kind === 'safe') {
        box(M.vaultDark, so.x1, 0, so.z1, so.x2, so.y2, so.z2, 1);
        box(M.gold, so.x1 + 0.2, 0.7, so.z1 - 0.02, so.x2 - 0.2, 0.74, so.z1);
      }
    }
    // Pressure gallery floor plates (the armed ones only show on the thermal camera)
    const TA = L.tileArea;
    for (let r = 0; r < TA.rows; r++) for (let c = 0; c < TA.cols; c++) {
      box(M.plate, TA.x1 + c * TA.size + 0.06, 0, TA.z1 + r * TA.size + 0.06, TA.x1 + (c + 1) * TA.size - 0.06, 0.04, TA.z1 + (r + 1) * TA.size - 0.06, 1);
    }
    box(M.stripes, X1(-6), 0.01, 9.6, X1(6), 0.02, 9.95, 1);
    box(M.stripes, X1(-6), 0.01, 20.05, X1(6), 0.02, 20.4, 1);
    // B2 vault: deposit boxes, gold, pedestal
    for (const sx of [-1, 1]) {
      const x = X2(sx * 9.6);
      box(M.deposit, Math.min(x, x + sx * 0.3), 0, 37.5, Math.max(x, x + sx * 0.3), 4.2, 45.5, 0.5);
    }
    for (const gx of [-6, -5.5, 5, 5.5, 6]) for (let j = 0; j < 3; j++) box(M.gold, X2(gx) - 0.2, j * 0.12, 39.4, X2(gx) + 0.2, j * 0.12 + 0.12, 39.66);
    B.addAt(new THREE.CylinderGeometry(0.5, 0.6, 1.05, 12), M.marble, X2(0), 0.525, 43);
    B.addAt(new THREE.TorusGeometry(0.5, 0.04, 6, 20), M.goldGlow, X2(0), 1.05, 43, 0);
    // Fire doors (stairwells) with exit signs
    for (const it of L.interact) {
      if (it.kind !== 'stairs') continue;
      const onEast = it.id === 'stairsG';
      const wx = onEast ? it.x + 0.22 : it.x - 0.3;
      box(M.fireDoor, wx, 0, it.z - 0.55, wx + 0.08, 2.3, it.z + 0.55, 1);
      box(M.exitSign, wx + (onEast ? -0.02 : 0.08), 2.45, it.z - 0.25, wx + (onEast ? 0 : 0.1), 2.65, it.z + 0.25, 1);
    }
    // ---------- Loading dock + van ----------
    box(M.stripes, -W / 2 - 13.5, 0.01, D - 5.5, -W / 2 - 0.5, 0.02, D - 5.2, 1);
    box(M.crate, -W / 2 - 3, 0, D + 5, -W / 2 - 1.6, 1.2, D + 7, 1);
    box(M.crate, -W / 2 - 4.6, 0, D + 6, -W / 2 - 3.4, 1, D + 7.4, 1);
    this.buildVan(L.van.x, L.van.z);

    // Lintels above door gaps (walls are split full-height at each gap)
    for (const d of L.doors) {
      const zoneWall = L.walls.find((w) => Math.abs((d.axis === 'x' ? (w.z1 + w.z2) / 2 : (w.x1 + w.x2) / 2) - (d.axis === 'x' ? d.z : d.x)) < 0.3 && (d.axis === 'x' ? w.z2 - w.z1 < 0.6 : w.x2 - w.x1 < 0.6));
      const h = zoneWall ? zoneWall.y2 : 3.6;
      const top = d.h || 3;
      if (h <= top + 0.05) continue;
      const mat = zoneWall && zoneWall.kind === 'casino' ? M.wallpaper : zoneWall && zoneWall.kind === 'vault' ? M.steel : M.boh;
      if (d.axis === 'x') box(mat, d.x - d.w / 2 - 0.05, top, d.z - 0.2, d.x + d.w / 2 + 0.05, h, d.z + 0.2, 3);
      else box(mat, d.x - 0.2, top, d.z - d.w / 2 - 0.05, d.x + 0.2, h, d.z + d.w / 2 + 0.05, 3);
    }
    // Lintel over the IR corridor mouth into the antechamber
    box(M.steel, X2(-2), 3.6, 27.8, X2(2), 4.6, 28.2);

    B.build(S);

    // Interactable props
    this.buildInteractables();
    this.buildDoors();
    this.buildCams();
    this.buildLasers();
    this.buildCrowd();
    this.buildGuards();
    this.buildPrize();
    this.buildDeepProps();
    this.players = new Map();
    this.markers = [];
  }

  buildVan(x, z) {
    const M = this.mats;
    const van = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(5.2, 2.3, 2.2, 1), M.van);
    body.position.y = 1.5;
    van.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 2.15), M.van);
    cab.position.set(3.1, 1.15, 0);
    van.add(cab);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 1.9), M.window);
    ws.position.set(3.82, 1.6, 0);
    van.add(ws);
    for (const [wx, wz] of [[-1.6, 1.1], [1.9, 1.1], [-1.6, -1.1], [1.9, -1.1]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), M.tire);
      w.rotation.x = Math.PI / 2; w.position.set(wx, 0.42, wz);
      van.add(w);
    }
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.9), new THREE.MeshStandardMaterial({ map: labelTexture('LUCKY SEVEN LINEN CO.', { bg: '#f2efe6', fg: '#c4202e', size: 54 }), roughness: 0.6 }));
    decal.position.set(0, 1.7, 1.111);
    van.add(decal);
    const d2 = decal.clone(); d2.position.z = -1.111; d2.rotation.y = Math.PI; van.add(d2);
    van.position.set(x, 0, z);
    van.rotation.y = Math.PI / 2;
    this.scene.add(van);
    this.van = van;
    // Exit marker in the dock
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.8, 32), new THREE.MeshBasicMaterial({ color: '#4dffa6', transparent: true, opacity: 0.0, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x + 2.5, 0.03, z);
    this.scene.add(ring);
    this.exitRing = ring;
  }

  buildInteractables() {
    const L = this.L, M = this.mats;
    this.interactMeshes = {};
    for (const it of L.interact) {
      let m = null;
      if (it.kind === 'glyphPad' || it.kind === 'vaultPad') {
        m = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.08), M.camDark);
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.12), new THREE.MeshBasicMaterial({ color: '#ff3d3d', toneMapped: false }));
        scr.position.set(0, 0.12, 0.045);
        m.add(base, scr);
        m.userData.screen = scr;
        m.position.set(it.x, it.y, it.z);
        if (it.kind === 'glyphPad') m.rotation.y = Math.PI;
        else m.rotation.y = Math.PI;
      } else if (it.kind === 'wirePanel') {
        m = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 0.16), M.rack);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), M.redLed);
        led.position.set(0.35, 0.4, -0.09);
        m.add(base, led);
        m.userData.led = led;
        m.position.set(it.x, it.y, it.z);
      } else if (it.kind === 'vent') {
        m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.06), new THREE.MeshStandardMaterial({ map: this.T.stripes, color: '#9aa', metalness: 0.5, roughness: 0.5 }));
        m.position.set(it.x, 0.35, it.z + 0.7);
      }
      else if (it.kind === 'wardrobe') {
        const b = it.box;
        m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(it.sign, { bg: '#1d1f24', fg: '#9fdcff', size: 60 }), toneMapped: false }));
        const cx = (b.x1 + b.x2) / 2 + it.nx * ((b.x2 - b.x1) / 2 + 0.02), cz = (b.z1 + b.z2) / 2 + it.nz * ((b.z2 - b.z1) / 2 + 0.02);
        m.position.set(cx, 2.42, cz);
        m.rotation.y = Math.atan2(it.nx, it.nz);
      }
      if (m) { this.scene.add(m); this.interactMeshes[it.id] = m; }
    }
    // Cash bundles
    this.cashMeshes = L.cash.map((c) => {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.16), this.mats.cash);
        b.position.set((k - 1) * 0.36, 0.05, 0);
        g.add(b);
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.105, 0.165), this.mats.gold);
        band.position.copy(b.position); g.add(band);
      }
      g.position.set(c.x, c.my != null ? c.my : 2.02, c.mz != null ? c.mz : c.z + 0.6);
      this.scene.add(g);
      return g;
    });
  }

  buildDoors() {
    const L = this.L, M = this.mats;
    this.doorMeshes = L.doors.map((d) => {
      const grp = new THREE.Group();
      grp.position.set(d.x, 0, d.z);
      if (d.axis === 'z') grp.rotation.y = Math.PI / 2;
      let panel;
      if (d.type === 'vault') {
        panel = new THREE.Group();
        const disk = new THREE.Mesh(new THREE.CylinderGeometry(1.65, 1.65, 0.5, 32), M.steel);
        disk.rotation.x = Math.PI / 2;
        disk.position.set(1.6, 1.7, 0);
        const hubm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.62, 16), M.gold);
        hubm.rotation.x = Math.PI / 2; hubm.position.set(1.6, 1.7, 0);
        panel.add(disk, hubm);
        for (let k = 0; k < 4; k++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.08), M.gold);
          spoke.position.set(1.6, 1.7, -0.34); spoke.rotation.z = (k / 4) * Math.PI;
          panel.add(spoke);
        }
        panel.position.x = -1.6;
        // Frame
        const frame = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 32), M.gold);
        frame.position.set(0, 1.7, 0);
        grp.add(frame);
      } else {
        const mat = d.key === 'cage' ? M.glass : d.type === 'shutter' ? M.stripes : M.steel;
        const ph = d.type === 'shutter' ? 4.6 : 2.8;
        panel = new THREE.Mesh(boxGeo(d.w, ph, 0.1, 1), mat);
        panel.position.y = ph / 2;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.08, 0.12), d.type === 'glyph' || d.type === 'keycard' ? M.redLed : M.gold);
        strip.position.set(0, 1.35, 0);
        panel.add(strip);
        panel.userData.strip = strip;
      }
      grp.add(panel);
      // Header sign
      if (d.key !== 'cage') {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.32), new THREE.MeshBasicMaterial({ map: labelTexture(d.label, { bg: d.type === 'vault' ? '#2a2210' : '#1d1f24', fg: d.type === 'basic' ? '#f2e8d0' : '#ffcc4d', size: 66 }), toneMapped: false }));
        sign.position.set(0, d.type === 'vault' ? 3.75 : 3.1, -0.22);
        sign.rotation.y = Math.PI;
        const s2 = sign.clone(); s2.position.z = 0.22; s2.rotation.y = 0;
        grp.add(sign, s2);
      }
      this.scene.add(grp);
      return { grp, panel, d, open: d.open ? 1 : 0, target: d.open ? 1 : 0 };
    });
  }

  buildCams() {
    const M = this.mats;
    this.camMeshes = this.L.cams.map((c) => {
      const grp = new THREE.Group();
      grp.position.set(c.x, c.y, c.z);
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), M.camDark);
      mount.position.y = 0.15;
      grp.add(mount);
      const head = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.46), M.camBody);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 10), M.camDark);
      lens.rotation.x = Math.PI / 2; lens.position.z = -0.25;
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff2020', toneMapped: false }));
      led.position.set(0.08, 0.07, -0.22);
      head.add(body, lens, led);
      head.rotation.x = c.pitch != null ? c.pitch + 0.03 : -0.35;
      grp.add(head);
      this.scene.add(grp);
      const camera = new THREE.PerspectiveCamera(64, 16 / 10, 0.1, 60);
      camera.position.set(c.x, c.y - 0.15, c.z);
      camera.layers.enable(0);
      if (c.ir || c.thermal) camera.layers.enable(IR_LAYER);
      return { grp, head, led, camera, c };
    });
  }

  buildLasers() {
    const irMat = new THREE.MeshBasicMaterial({ color: '#ff2040', toneMapped: false });
    this.laserMeshes = [];
    for (const g of this.L.lasers) {
      const len = g.x2 - g.x1;
      for (const b of g.beams) {
        const count = CURTAIN_Y.length;
        for (let k = 0; k < count; k++) {
          const ir = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.035), irMat);
          ir.position.set((g.x1 + g.x2) / 2, 1, g.z);
          ir.layers.set(IR_LAYER);
          const sh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: '#ff6a7a', transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
          sh.position.copy(ir.position);
          this.scene.add(ir, sh);
          this.laserMeshes.push({ ir, sh, g, b, k });
        }
      }
    }
  }

  buildCrowd() {
    const L = this.L;
    const people = [];
    for (const c of L.civilians) people.push({ ...c, kind: 'static' });
    for (const w of L.walkers) people.push({ ...w, kind: 'walker', x: w.path[0].x, z: w.path[0].z, yaw: 0, pose: 'stand' });
    // Reserve a few slots for VIP-event extras
    const vipR = makeRng(L.seed ^ 0xF1F1);
    for (let k = 0; k < 8; k++) people.push({ kind: 'vip', x: -2 + vipR.float(0, 4), z: -3, yaw: Math.PI, pose: 'stand', look: vipR.int(0, 9999), hidden: true, act: 'walk', path: [{ x: vipR.float(-3, 3), z: -6 }, { x: vipR.float(-6, 6), z: 6 + vipR.float(0, 6) }], speed: 0.8, offset: k * 2 });
    this.people = people;
    const n = people.length;
    this.crowdMeshes = {};
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true });
    for (const part of RIG_PARTS) {
      const im = new THREE.InstancedMesh(rigGeometry(part), mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.scene.add(im);
      this.crowdMeshes[part] = im;
    }
    const col = new THREE.Color();
    people.forEach((p, i) => {
      const R = makeRng(p.look + 1);
      const isStaff = p.act === 'dealer' || p.act === 'bartender';
      const top = isStaff ? (p.act === 'dealer' ? '#f2e8d0' : '#1b1b22') : R.pick(OUTFIT);
      const pants = isStaff ? '#15151a' : R.pick(PANTS);
      const skin = R.pick(SKIN), hair = R.pick(HAIR);
      const set = (part, c) => this.crowdMeshes[part].setColorAt(i, col.set(c));
      set('torso', top); set('armL', isStaff && p.act === 'dealer' ? '#f2e8d0' : top); set('armR', isStaff && p.act === 'dealer' ? '#f2e8d0' : top);
      set('legL', pants); set('legR', pants); set('head', skin); set('hair', hair);
      p.phase = R.float(0, 6.28);
      if (p.kind === 'walker' || p.kind === 'vip') {
        let len = 0; for (let k = 1; k < p.path.length; k++) len += Math.hypot(p.path[k].x - p.path[k - 1].x, p.path[k].z - p.path[k - 1].z);
        p.len = Math.max(0.1, len);
      }
    });
    for (const part of RIG_PARTS) this.crowdMeshes[part].instanceColor.needsUpdate = true;
  }

  buildGuards() {
    this.guardViews = [];
    for (const def of this.L.guards) this.addGuardView(def);
  }

  addGuardView(def) {
    let colors, extras;
    const R = makeRng(def.id * 977 + 13);
    const skin = R.pick(SKIN), hair = R.pick(HAIR);
    if (def.kind === 'manager') { colors = { top: '#6b1d2c', pants: '#1a1a1f', skin, hair }; extras = { tie: '#d9a441' }; }
    else if (def.kind === 'pitboss') { colors = { top: '#d9a441', pants: '#1a1a1f', skin, hair }; extras = { tie: '#1a1a1f' }; }
    else if (def.title === 'VIP Bodyguard') { colors = { top: '#0d0d10', pants: '#0d0d10', skin, hair }; extras = { tie: '#0d0d10' }; }
    else { colors = { top: '#232a38', pants: '#151820', skin, hair }; extras = { cap: '#1a1f2b', band: '#c4202e', vest: '#2d3546' }; }
    const grp = makePersonGroup(colors, extras);
    const markers = {
      alert: textSprite('!', '#ff3048', 0.6),
      inv: textSprite('?', '#ffd23f', 0.55),
      conned: textSprite('…', '#46e0ff', 0.55),
      dist: textSprite('♪', '#ff8af0', 0.5),
      down: textSprite('z', '#c8d0ff', 0.45),
      tag: diamondSprite('#ffffff', 0.32),
      key: diamondSprite('#ffd23f', 0.2),
    };
    for (const k in markers) { markers[k].visible = false; markers[k].position.y = k === 'tag' ? 2.35 : 2.15; grp.add(markers[k]); }
    // Sidearm in the right hand (drawn when alert) + muzzle flash
    const gun = new THREE.Group();
    const gb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.26), new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.4, metalness: 0.5 }));
    gb.position.set(0, 0, -0.08); gun.add(gb);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffc35a', toneMapped: false }));
    flash.position.set(0, 0, -0.26); flash.visible = false; gun.add(flash);
    gun.position.set(0, -0.58, -0.02); gun.rotation.x = Math.PI / 2;
    grp.userData.parts.armR.add(gun);
    grp.userData.gun = gun; grp.userData.flash = flash;
    markers.key.position.set(0.3, 1.2, 0); markers.key.material.depthTest = true;
    grp.position.set(def.spawn.x, 0, def.spawn.z);
    this.scene.add(grp);
    this.guardViews[def.id] = { grp, def, markers, x: def.spawn.x, z: def.spawn.z, yaw: 0, tx: def.spawn.x, tz: def.spawn.z, tyaw: 0, state: 0, moving: false, phase: R.float(0, 6) };
  }

  buildPrize() {
    const L = this.L, M = this.mats;
    const g = new THREE.Group();
    if (L.prize.id === 'diamond') {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: '#bff4ff', emissive: '#46e0ff', emissiveIntensity: 1.4, roughness: 0.05, metalness: 0.3, flatShading: true }));
      gem.scale.y = 1.4;
      g.add(gem);
      g.userData.spin = gem;
    } else if (L.prize.id === 'gold') {
      for (let k = 0; k < 5; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.14), M.goldGlow);
        bar.position.set((k % 3 - 1) * 0.16, Math.floor(k / 3) * 0.1, 0);
        g.add(bar);
      }
    } else {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.26), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#d9a441', emissiveIntensity: 0.15 }));
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.27), M.goldGlow);
      edge.position.y = 0.05;
      g.add(book, edge);
    }
    const glow = new THREE.PointLight('#9fefff', 3, 4, 2);
    glow.position.y = 0.3;
    g.add(glow);
    g.position.set(L.deep.b2, 1.3, 43);
    this.scene.add(g);
    this.prizeMesh = g;
    const glassCase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.glass);
    glassCase.position.set(L.deep.b2, 1.4, 43);
    this.scene.add(glassCase);
    this.glassCase = glassCase;
  }

  // ---------- Light pool ----------
  applyLights(floor) {
    const specs = this.lightSpecs[floor] || [];
    const t = this.t, prot = this.protocolOn, surge = this.surgeUntil > t;
    this.pool.forEach((l, i) => {
      const sp = specs[i];
      if (!sp) { l.intensity = 0; return; }
      l.position.set(sp.x, sp.y, sp.z);
      l.distance = sp.dist;
      let k = this.dark[sp.zone] ? 0.06 : 1;
      if (surge && sp.zone === 'casino' && Math.sin(t * 37 + i) > 0.4) k *= 0.25;
      if (prot) {
        k *= 0.45 + 0.55 * Math.abs(Math.sin(t * 3.2 + i * 0.7));
        l.color.copy(sp.color).lerp(this._red || (this._red = new THREE.Color('#ff2a1a')), 0.75);
      } else l.color.copy(sp.color);
      l.intensity = sp.intensity * k;
    });
    const hemiBase = floor === 0 ? 1.15 : 0.8;
    this.hemi.intensity = hemiBase * (this.dark.casino && floor === 0 ? 0.3 : 1) * (prot ? 0.55 : 1);
  }

  // ---------- Basement and climax props ----------
  buildDeepProps() {
    const L = this.L, M = this.mats, S = this.scene;
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; S.add(m); return m; };
    this.deepProps = {};
    const it = (id) => L.interact.find((i) => i.id === id);
    // Lift terminal (password)
    const pt = it('passTerm');
    if (pt) {
      const ry = pt.wallX > 0 ? Math.PI / 2 : -Math.PI / 2;
      add(new THREE.BoxGeometry(0.9, 0.62, 0.12), M.rack, pt.x, 1.35, pt.z, ry);
      this.deepProps.passScreen = add(new THREE.PlaneGeometry(0.78, 0.48), new THREE.MeshBasicMaterial({ color: '#103a22', toneMapped: false }), pt.x + pt.wallX * 0.065, 1.36, pt.z, ry);
    }
    // Camera server rack with signal lamps
    const sr = it('simonRack');
    if (sr) {
      add(new THREE.BoxGeometry(1.1, 2.1, 0.5), M.rack, sr.x, 1.05, sr.z + 0.05);
      const cols = ['#ff3048', '#3d8bff', '#3dff8a', '#ffd23f'];
      this.deepProps.simonLamps = cols.map((c, i) => add(new THREE.BoxGeometry(0.18, 0.18, 0.04), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2 }), sr.x - 0.33 + i * 0.22, 1.5, sr.z - 0.22));
    }
    // Count room safe beacon
    const ms = it('morseSafe');
    if (ms) this.deepProps.beacon = add(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd77a', emissiveIntensity: 0.1 }), ms.x, 1.95, ms.z + 0.4);
    // Hatch lock panel + floor hatch
    const ml = it('mazeLock');
    if (ml) {
      add(new THREE.BoxGeometry(0.06, 0.6, 0.5), M.rack, ml.x + 0.38, 1.35, ml.z);
      this.deepProps.mazeLed = add(new THREE.BoxGeometry(0.03, 0.06, 0.06), M.redLed, ml.x + 0.34, 1.6, ml.z + 0.15);
    }
    const hd = it('descend');
    if (hd) { add(new THREE.BoxGeometry(1.2, 0.06, 1.2), M.stripes, hd.x - 0.2, 0.03, hd.z); this.deepProps.hatchLid = add(new THREE.BoxGeometry(1.0, 0.08, 1.0), M.steel, hd.x - 0.2, 0.07, hd.z); }
    const asc = it('ascend');
    if (asc) for (let y = 0.3; y < 3.4; y += 0.35) add(new THREE.BoxGeometry(0.8, 0.05, 0.05), M.chrome, asc.x, y, asc.z - 0.45);
    // Key consoles
    this.deepProps.keys = {};
    for (const id of ['keyA', 'keyB']) {
      const k = it(id);
      if (!k) continue;
      add(new THREE.BoxGeometry(0.8, 1.1, 0.5), M.vaultDark, k.x, 0.55, k.z + 0.1);
      add(new THREE.BoxGeometry(0.5, 0.05, 0.3), M.gold, k.x, 1.12, k.z + 0.05);
      const lamp = add(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#552200', toneMapped: false }), k.x, 1.25, k.z + 0.15);
      const key = add(new THREE.BoxGeometry(0.04, 0.12, 0.02), M.gold, k.x, 1.2, k.z - 0.05);
      key.visible = id === 'keyB';
      this.deepProps.keys[id] = { lamp, key };
    }
    // Breaker panels
    this.deepProps.breakers = {};
    for (const b of L.interact.filter((i) => i.kind === 'breaker')) {
      const nearWallZ = b.id === 'breakerG';
      const face = nearWallZ ? new THREE.BoxGeometry(0.7, 0.9, 0.12) : new THREE.BoxGeometry(0.12, 0.9, 0.7);
      add(face, M.rack, b.x + (nearWallZ ? 0 : (b.x > L.deep.b1 + 5 && b.x < L.deep.b1 + 20 ? 0.06 : -0.06)), 1.4, b.z + (nearWallZ ? 0.12 : 0));
      const lever = add(new THREE.BoxGeometry(0.08, 0.36, 0.08), M.redLed, b.x, 1.45, b.z + (nearWallZ ? 0.0 : 0));
      this.deepProps.breakers[b.id] = lever;
    }
    // Lift call panels
    for (const id of ['elevG', 'elevB1']) {
      const e = it(id);
      if (e) add(new THREE.BoxGeometry(0.3, 0.45, 0.06), M.rack, e.x + 1.6, 1.3, e.z);
    }
    // Lockdown beacons (one or two per area)
    const spots = [
      [0, 6.8, L.D - 1], [-L.W / 2 + 1, 3.4, L.D + 2], [L.W / 2 - 1, 3.4, L.D + 2],
      [L.deep.b1, 3.4, 5], [L.deep.b1, 4.0, 27], [L.deep.b2, 3.4, 2], [L.deep.b2 - 8, 4.4, 30], [L.deep.b2 + 8, 4.4, 30],
    ];
    this.beacons = spots.map(([x, y, z]) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.12, 10), M.camDark);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.beacon);
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.1), new THREE.MeshBasicMaterial({ color: '#ff3030', transparent: true, opacity: 0.6, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
      blade.position.y = 0.06; blade.position.x = 0.3;
      g.add(base, dome, blade);
      g.position.set(x, y - 0.2, z);
      g.rotation.x = Math.PI;
      g.visible = false;
      S.add(g);
      return g;
    });
    // Thermal overlay for the pressure gallery (IR layer: only the THERMAL camera sees it)
    const TA = L.tileArea;
    this.thermal = [];
    const hot = new THREE.MeshBasicMaterial({ color: '#ff5a1a', toneMapped: false });
    for (let r = 0; r < TA.rows; r++) for (let c = 0; c < TA.cols; c++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(TA.size - 0.25, TA.size - 0.25), hot);
      m.rotation.x = -Math.PI / 2;
      m.position.set(TA.x1 + (c + 0.5) * TA.size, 0.06, TA.z1 + (r + 0.5) * TA.size);
      m.layers.set(IR_LAYER);
      S.add(m);
      this.thermal.push({ m, c, r });
    }
  }

  updateDeepProps(snap, simT, t) {
    const L = this.L, D = this.deepProps, pz = snap.puzzle;
    for (const th of this.thermal) th.m.visible = tileArmed(L, simT, th.c, th.r);
    if (D.beacon) D.beacon.material.emissiveIntensity = !pz.morseSolved && morseOn(L.morse.word, simT) ? 3.2 : 0.08;
    if (D.passScreen) D.passScreen.material.color.set(pz.passSolved ? '#3dff8a' : '#103a22');
    if (D.simonLamps) {
      const S = L.simon;
      const cycle = pz.simonStage * 0.9 + 1.6;
      const u = simT % cycle;
      const k = Math.floor(u / 0.9);
      D.simonLamps.forEach((lamp, i) => {
        const lit = !pz.simonSolved && k < pz.simonStage && S.seq[k] === i && (u % 0.9) < 0.55;
        lamp.material.emissiveIntensity = pz.simonSolved ? 0.9 : lit ? 3 : 0.15;
      });
    }
    if (D.mazeLed) D.mazeLed.material = pz.mazeSolved ? this.mats.led : this.mats.redLed;
    if (D.hatchLid) D.hatchLid.position.y = pz.mazeSolved ? 0.6 : 0.07, D.hatchLid.rotation.z = pz.mazeSolved ? 1.2 : 0;
    for (const id in D.keys) {
      const k = D.keys[id];
      const turned = id === 'keyA' ? pz.turnA : pz.turnB;
      if (id === 'keyA') k.key.visible = pz.keyInserted;
      k.key.rotation.z = turned || pz.timelock != null || pz.vaultOpen ? Math.PI / 2 : 0;
      k.lamp.material.color.set(pz.vaultOpen ? '#3dff8a' : pz.timelock != null ? (Math.sin(t * 8) > 0 ? '#ffd23f' : '#664400') : pz.vaultCode ? '#ff8a2a' : '#331100');
    }
    const flipped = snap.protocol ? snap.protocol.flipped : {};
    for (const id in D.breakers) {
      const lever = D.breakers[id];
      lever.rotation.x = flipped[id] ? 1.2 : 0;
      lever.material = flipped[id] ? this.mats.led : this.mats.redLed;
    }
    const prot = !!snap.protocol;
    for (const b of this.beacons) { b.visible = prot; b.rotation.y = t * 6; }
  }

  // ---------- Players ----------
  // (outfits cycle when a player changes clothes at a locker)
  ensurePlayer(id, role, name) {
    if (this.players.has(id)) return this.players.get(id);
    const R = makeRng(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    const color = ROLES[role]?.color || '#ffffff';
    const grp = makePersonGroup({ top: '#1f1f26', arms: '#1f1f26', pants: '#15151a', skin: R.pick(SKIN), hair: R.pick(HAIR) }, { tie: color, band: color });
    const tag = textSprite('▼', color, 0.35);
    tag.position.y = 2.15;
    grp.add(tag);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.25), new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.8 }));
    bag.position.set(0, 1.15, 0.2); bag.visible = false;
    grp.add(bag);
    this.scene.add(grp);
    const v = { grp, tag, bag, role, name, x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, f: 0, down: false, moving: false, phase: R.float(0, 6), init: false };
    this.players.set(id, v);
    return v;
  }

  removePlayer(id) {
    const v = this.players.get(id);
    if (v) { this.scene.remove(v.grp); this.players.delete(id); }
  }

  // ---------- Colliders for the local player ----------
  colliders(doorsOpen) {
    const boxes = this.L.walls.concat(this.L.solids);
    const doors = [];
    this.L.doors.forEach((d, i) => { if (!doorsOpen || !doorsOpen[i]) doors.push(doorBox(d)); });
    return { boxes: boxes.concat(doors), circles: this.L.circles };
  }

  // ---------- Events ----------
  setDark(zone, on) { this.dark[zone] = on; }
  panic(x, z) { this.panicUntil = this.t + 15; this.panicAt = { x, z }; }
  doJackpot(bankId) { this.jackpot = { bank: bankId, until: this.t + 14 }; }
  surge(t) { this.surgeUntil = this.t + t; }
  showVip() { for (const p of this.people) if (p.kind === 'vip') { p.hidden = false; p.vipStart = this.t; } }

  // ---------- Per-frame update ----------
  update(dt, simT, snap, viewer, myId) {
    this.t += dt;
    this.simT = simT;
    const t = this.t, L = this.L;

    // Slot screens + jackpot
    if (Math.floor(t * 8) !== this._slotTick) { this._slotTick = Math.floor(t * 8); drawSlotScreen(this.T, t); }
    if (this.wheel) this.wheel.rotation.z = t * 0.35;
    if (this.stageSign) this.stageSign.material.opacity = 0.85 + Math.sin(t * 9) * (Math.sin(t * 0.7) > 0.95 ? 0.4 : 0.05);
    this.slotTops.forEach((s, i) => {
      const jp = this.jackpot && this.jackpot.until > t && this.jackpot.bank === i;
      s.material.emissiveIntensity = jp ? 2 + Math.sin(t * 20) * 1.8 : 1.6 + Math.sin(t * 2 + i) * 0.25;
      if (jp) s.material.emissive.setHSL((t * 2) % 1, 1, 0.5);
    });

    this.protocolOn = !!(snap && snap.protocol);
    this.viewFloor = viewer && viewer.y > -50 ? floorOf(L, viewer.x) : 0;
    if (snap) for (const zn of ['casino', 'backhouse', 'b1', 'b2']) this.dark[zn] = snap.lights.includes(zn);
    this.applyLights(this.viewFloor);

    if (!snap) return;

    // Doors
    snap.doors.forEach((o, i) => {
      const dm = this.doorMeshes[i];
      dm.target = o;
      dm.open += (dm.target - dm.open) * Math.min(1, dt * 6);
      if (dm.d.type === 'vault') dm.panel.rotation.y = -dm.open * 1.9;
      else if (dm.d.type === 'shutter') dm.panel.position.y = 2.3 + dm.open * 4.0;
      else dm.panel.position.x = dm.open * (dm.d.w - 0.1);
      const sealed = snap.seals && snap.seals.some((q) => q[0] === i);
      if (dm.panel.userData.strip) dm.panel.userData.strip.material = snap.locks[i] || sealed ? this.mats.redLed : this.mats.led;
    });

    // Interactable feedback
    const pz = snap.puzzle;
    const gp = this.interactMeshes.glyphPad;
    if (gp) gp.userData.screen.material.color.set(pz.glyphSolved ? '#3dff8a' : '#ff3d3d');
    const vp = this.interactMeshes.vaultPad;
    if (vp) vp.userData.screen.material.color.set(pz.vaultCode ? '#3dff8a' : pz.wireSolved ? '#ffd23f' : '#333');
    const wp = this.interactMeshes.wirePanel;
    if (wp) wp.userData.led.material = pz.wireSolved ? this.mats.led : this.mats.redLed;
    this.cashMeshes.forEach((m, i) => { m.visible = !snap.cash.includes(i); });

    // Cameras
    this.camMeshes.forEach((cm, i) => {
      const yaw = camYaw(cm.c, simT);
      cm.head.rotation.y = yaw; // model faces -z
      cm.camera.rotation.set(cm.c.pitch != null ? cm.c.pitch : -0.38, yaw, 0, 'YXZ');
      const [loop, online] = snap.cams[i] || [0, 1];
      cm.loop = loop; cm.online = online;
      cm.led.material.color.set(loop > 0 ? '#3d8bff' : online ? (Math.sin(t * 4) > 0 ? '#ff2020' : '#550000') : '#222');
    });

    // Lasers
    const vx = viewer ? viewer.x : 0, vz = viewer ? viewer.z : 0, vy = viewer ? viewer.y : 0;
    const locked = !!snap.protocol;
    for (const lm of this.laserMeshes) {
      const st = beamState(lm.b, simT, locked)[lm.k] || { on: false, y: 1 };
      if (st.vertical) {
        lm.ir.rotation.z = Math.PI / 2; lm.sh.rotation.z = Math.PI / 2;
        lm.ir.scale.x = lm.sh.scale.x = 3.4 / (lm.g.x2 - lm.g.x1);
        lm.ir.position.set(lm.g.cx + st.dx, 1.7, lm.g.z); lm.sh.position.copy(lm.ir.position);
      } else {
        lm.ir.rotation.z = 0; lm.sh.rotation.z = 0; lm.ir.scale.x = lm.sh.scale.x = 1;
        lm.ir.position.set((lm.g.x1 + lm.g.x2) / 2, st.y, lm.g.z); lm.sh.position.copy(lm.ir.position);
      }
      lm.ir.visible = st.on;
      const d = st.vertical ? Math.hypot(vz - lm.g.z, vx - lm.ir.position.x) : Math.hypot(vz - lm.g.z, (vy + 1) - st.y);
      lm.sh.visible = st.on;
      lm.sh.material.opacity = st.on ? Math.max(0, (locked ? 0.6 : 0.22) * (1 - d / (locked ? 5 : 1.8))) : 0;
    }
    this.updateDeepProps(snap, simT, t);

    // Prize
    const [holder, px, py, pzz, inVault] = snap.prize;
    this.prizeMesh.visible = !holder;
    if (!holder) {
      this.prizeMesh.position.set(px, inVault ? 1.3 : py + 0.15, pzz);
      if (this.prizeMesh.userData.spin) this.prizeMesh.userData.spin.rotation.y = t * 1.5;
      this.prizeMesh.position.y += Math.sin(t * 2) * 0.04;
    }
    this.glassCase.visible = !!inVault && !pz.vaultSolved;
    this.exitRing.material.opacity = holder ? 0.55 + Math.sin(t * 4) * 0.3 : 0;

    // Guards
    for (const g of snap.guards) {
      const [id, x, z, yaw, state, tied, tagged, moving, keycard, watching] = g;
      const gv = this.guardViews[id];
      if (!gv) continue;
      gv.tx = x; gv.tz = z; gv.tyaw = yaw; gv.state = state; gv.moving = !!moving; gv.tagged = !!tagged; gv.tied = !!tied; gv.dead = tied >= 2; gv.hidden = tied === 3; gv.keycard = !!keycard;
      void watching;
    }
    for (const gv of this.guardViews) {
      if (!gv) continue;
      const k = Math.min(1, dt * 10);
      gv.x += (gv.tx - gv.x) * k; gv.z += (gv.tz - gv.z) * k;
      let dy = gv.tyaw - gv.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      gv.yaw += dy * k;
      const down = gv.state === 3;
      gv.grp.visible = !gv.hidden;
      gv.grp.position.set(gv.x, down ? 0.14 : 0, gv.z);
      gv.grp.rotation.set(down ? -Math.PI / 2 : 0, gv.yaw, 0, 'YXZ');
      posePerson(gv.grp, down ? 'down' : gv.state === 2 ? 'aim' : gv.state === 4 ? 'talk' : 'stand', t, gv.phase, gv.moving);
      const mk = gv.markers;
      mk.alert.visible = gv.state === 2;
      mk.inv.visible = gv.state === 1;
      mk.conned.visible = gv.state === 4;
      mk.dist.visible = gv.state === 5;
      mk.down.visible = down && !gv.tied;
      gv.grp.userData.gun.visible = gv.state === 2 && !down;
      gv.flashT = Math.max(0, (gv.flashT || 0) - dt);
      gv.grp.userData.flash.visible = gv.flashT > 0;
      mk.tag.visible = gv.tagged && !down && !(viewer && viewer.role === 'overwatch');
      mk.key.visible = gv.keycard && !down;
      if (down) { for (const k2 of ['alert', 'inv', 'conned', 'dist', 'tag']) mk[k2].visible = false; }
    }

    // Other players
    const seen = new Set();
    for (const p of snap.players) {
      const [id, x, y, z, yaw, , f, , down, , inVent] = p;
      seen.add(id);
      if (id === myId) continue;
      const v = this.players.get(id);
      if (!v) continue;
      if (!v.init) { v.x = x; v.y = y; v.z = z; v.yaw = yaw; v.init = true; }
      v.tx = x; v.ty = y; v.tz = z; v.tyaw = yaw; v.f = f; v.down = !!down; v.inVent = !!inVent;
      const outfit = p[19] || 0;
      if (v.outfit !== outfit) {
        v.outfit = outfit;
        const o = OUTFITS[outfit % OUTFITS.length], m = v.grp.userData.mats;
        m.torso.color.set(o.top); m.arms.color.set(o.arms || o.top); m.legs.color.set(o.pants);
      }
      v.bag.visible = holder === id;
    }
    for (const [id, v] of this.players) {
      if (id === myId || v.role === 'overwatch') { v.grp.visible = false; continue; }
      const k = Math.min(1, dt * 14);
      const ox = v.x, oz = v.z;
      v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k; v.z += (v.tz - v.z) * k;
      let dy = v.tyaw - v.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw += dy * k;
      v.moving = Math.hypot(v.x - ox, v.z - oz) / Math.max(dt, 1e-3) > 0.5;
      v.grp.visible = !v.inVent;
      const crouch = v.f & 2;
      v.grp.position.set(v.x, v.down ? 0.14 : v.y, v.z);
      v.grp.rotation.set(v.down ? -Math.PI / 2 : 0, v.yaw, 0, 'YXZ');
      v.grp.scale.y = crouch && !v.down ? 0.68 : 1;
      posePerson(v.grp, v.down ? 'down' : (v.f & 4) ? 'aim' : 'stand', t, v.phase, v.moving);
    }

    // Crowd
    this.updateCrowd(t, dt);
  }

  updateCrowd(t) {
    const root = new THREE.Matrix4(), out = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    const panic = this.panicUntil > t;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.people.forEach((p, i) => {
      if (p.hidden) { for (const part of RIG_PARTS) this.crowdMeshes[part].setMatrixAt(i, hidden); return; }
      let x = p.x, z = p.z, yaw = p.yaw, moving = false, pose = p.pose;
      if (p.kind === 'walker' || p.kind === 'vip') {
        if (!panic) {
          const tt = p.kind === 'vip' ? (t - (p.vipStart || 0)) : t;
          let s = (tt * p.speed + p.offset) % (2 * p.len);
          let back = false;
          if (s > p.len) { s = 2 * p.len - s; back = true; }
          let acc = 0;
          for (let k = 1; k < p.path.length; k++) {
            const a = p.path[k - 1], b = p.path[k];
            const seg = Math.hypot(b.x - a.x, b.z - a.z);
            if (acc + seg >= s || k === p.path.length - 1) {
              const u = seg > 0 ? Math.min(1, (s - acc) / seg) : 0;
              x = a.x + (b.x - a.x) * u; z = a.z + (b.z - a.z) * u;
              yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)) + (back ? Math.PI : 0);
              break;
            }
            acc += seg;
          }
          moving = true;
          p.lx = x; p.lz = z; p.lyaw = yaw;
        } else { x = p.lx ?? x; z = p.lz ?? z; yaw = p.lyaw ?? yaw; }
      }
      if (panic && p.act !== 'dealer' && p.act !== 'bartender' && pose !== 'sit') pose = 'cower';
      else if (panic && pose === 'sit') pose = 'cower';
      else if (p.act === 'chat') pose = 'talk';
      e.set(0, yaw, 0); q.setFromEuler(e);
      root.compose(pos.set(x, p.y || 0, z), q, sc);
      for (const part of RIG_PARTS) {
        rigMatrix(out, root, part, pose, t, p.phase, moving);
        this.crowdMeshes[part].setMatrixAt(i, out);
      }
    });
    for (const part of RIG_PARTS) this.crowdMeshes[part].instanceMatrix.needsUpdate = true;
  }
}
