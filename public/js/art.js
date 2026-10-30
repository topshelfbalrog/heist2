// Procedural textures, materials and low-poly model builders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const THEMES = {
  crimson: { carpet: '#5b1020', carpet2: '#3a0913', accent: '#e8c06a', wall: '#2a0d14' },
  emerald: { carpet: '#0f4232', carpet2: '#08281e', accent: '#e8c06a', wall: '#0c2219' },
  royal: { carpet: '#1d2457', carpet2: '#111536', accent: '#e8c06a', wall: '#141733' },
};

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

export function makeTextures(theme) {
  const th = THEMES[theme] || THEMES.crimson;
  const T = {};
  T.carpet = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = th.carpet; g.fillRect(0, 0, w, h);
    // Deco diamond lattice
    g.strokeStyle = th.carpet2; g.lineWidth = 18;
    for (let i = -2; i < 4; i++) {
      g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256 + 512, 512); g.stroke();
      g.beginPath(); g.moveTo(i * 256 + 512, 0); g.lineTo(i * 256, 512); g.stroke();
    }
    g.strokeStyle = th.accent; g.globalAlpha = 0.55; g.lineWidth = 3;
    for (let i = -2; i < 4; i++) {
      g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256 + 512, 512); g.stroke();
      g.beginPath(); g.moveTo(i * 256 + 512, 0); g.lineTo(i * 256, 512); g.stroke();
    }
    g.globalAlpha = 1;
    for (const [x, y] of [[0, 0], [256, 256], [512, 0], [0, 512], [512, 512], [256, -256]]) {
      g.fillStyle = th.accent; g.globalAlpha = 0.8;
      g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = th.carpet2; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    // Starbursts in the diamonds
    for (const [x, y] of [[256, 0], [0, 256], [512, 256], [256, 512]]) {
      g.strokeStyle = '#f5d98f'; g.globalAlpha = 0.35; g.lineWidth = 2;
      for (let a = 0; a < 8; a++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a * Math.PI / 4) * 60, y + Math.sin(a * Math.PI / 4) * 60); g.stroke(); }
      g.globalAlpha = 1;
    }
    // Fibre noise
    const id = g.getImageData(0, 0, w, h);
    for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
    g.putImageData(id, 0, 0);
  });
  T.wallpaper = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = th.wall; g.fillRect(0, 0, w, h);
    g.strokeStyle = th.accent; g.globalAlpha = 0.5; g.lineWidth = 2.5;
    for (let y = 0; y < h + 128; y += 128) {
      for (const x of [0, 128, 256]) {
        const yy = y + (x === 128 ? 64 : 0);
        for (let r = 20; r <= 60; r += 20) { g.beginPath(); g.arc(x, yy, r, Math.PI, Math.PI * 2); g.stroke(); }
        for (let a = 0; a <= 6; a++) { const an = Math.PI + (a / 6) * Math.PI; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + Math.cos(an) * 60, yy + Math.sin(an) * 60); g.stroke(); }
      }
    }
    g.globalAlpha = 1;
  });
  T.wainscot = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#2b1a10'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a2416';
    for (let x = 8; x < w; x += 64) g.fillRect(x, 14, 48, h - 28);
    g.strokeStyle = '#d9a441'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, 6);
  });
  T.plaza = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8cdb8'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const v = 200 + Math.random() * 30;
      g.fillStyle = `rgb(${v + 10},${v},${v - 18})`;
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
    g.strokeStyle = '#b9ab92'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  });
  T.concrete = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5b5f66'; g.fillRect(0, 0, w, h);
    const id = g.getImageData(0, 0, w, h);
    for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 20; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
    g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(30,32,36,0.5)'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  });
  T.bohWall = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#c9c4b6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7d8a8f'; g.fillRect(0, h - 70, w, 70);
    g.fillStyle = '#e1b23a'; g.fillRect(0, h - 74, w, 5);
  });
  T.steel = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#8e959c'); gr.addColorStop(0.5, '#c4cbd2'); gr.addColorStop(1, '#7c838a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.08;
    for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(0, Math.random() * h, w, 1); }
    g.globalAlpha = 1;
    g.fillStyle = '#5f666c';
    for (const [x, y] of [[16, 16], [240, 16], [16, 240], [240, 240]]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  });
  T.marble = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#16151b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(217,164,65,0.35)';
    for (let k = 0; k < 14; k++) {
      g.lineWidth = Math.random() * 2 + 0.5;
      g.beginPath();
      let x = Math.random() * w, y = 0;
      g.moveTo(x, y);
      while (y < h) { x += (Math.random() - 0.5) * 40; y += 20; g.lineTo(x, y); }
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  });
  T.asphalt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3b3f'; g.fillRect(0, 0, w, h);
    const id = g.getImageData(0, 0, w, h);
    for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 26; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
    g.putImageData(id, 0, 0);
  });
  T.felt = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#0f6b43'; g.fillRect(0, 0, w, h);
    const id = g.getImageData(0, 0, w, h);
    for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 12; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
    g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(255,230,160,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.arc(64, 30, 50, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  });
  T.ceiling = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#120c0c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3d2a14'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
    g.strokeStyle = '#d9a441'; g.lineWidth = 2; g.globalAlpha = 0.5; g.strokeRect(24, 24, w - 48, h - 48); g.globalAlpha = 1;
  });
  T.roulette = canvasTex(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 37; i++) {
      const a0 = (i / 37) * Math.PI * 2, a1 = ((i + 1) / 37) * Math.PI * 2;
      g.fillStyle = i === 0 ? '#0f8a4a' : i % 2 ? '#c4202e' : '#141414';
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 250, a0, a1); g.closePath(); g.fill();
    }
    g.fillStyle = '#d9a441'; g.beginPath(); g.arc(cx, cy, 150, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7a5520'; g.beginPath(); g.arc(cx, cy, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f5d98f'; g.lineWidth = 10;
    for (let a = 0; a < 4; a++) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a * Math.PI / 2) * 150, cy + Math.sin(a * Math.PI / 2) * 150); g.stroke(); }
  }, false);
  T.wood = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#4a2a17'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${30 + Math.random() * 30},${15 + Math.random() * 10},8,0.5)`; g.lineWidth = Math.random() * 2; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(80, y + 6, 160, y - 6, 256, y); g.stroke(); }
  });
  T.stripes = canvasTex(256, 32, (g, w, h) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8b923';
    for (let x = -32; x < w; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, 0); g.lineTo(x + 48, 0); g.lineTo(x + 24, h); g.fill(); }
  });
  T.padded = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#23262c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2d3138';
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) g.fillRect(x * 64 + 3, y * 64 + 3, 58, 58);
  });
  // Animated slot screen (shared by every machine)
  const sc = document.createElement('canvas'); sc.width = 128; sc.height = 96;
  T.slotCanvas = sc;
  T.slotScreen = new THREE.CanvasTexture(sc); T.slotScreen.colorSpace = THREE.SRGBColorSpace;
  return T;
}

const SYMS = ['7', '★', '♦', '$', 'BAR', '♣'];
const SYMC = ['#ff3d5a', '#ffd34d', '#4de1ff', '#7dff8a', '#ffffff', '#ff8af0'];
export function drawSlotScreen(T, t) {
  const g = T.slotCanvas.getContext('2d');
  g.fillStyle = '#12051c'; g.fillRect(0, 0, 128, 96);
  for (let r = 0; r < 3; r++) {
    const off = (t * (3 + r * 1.7)) % SYMS.length;
    for (let k = -1; k < 2; k++) {
      const i = Math.floor(off + k + 6) % SYMS.length;
      const y = 48 + (k - (off % 1)) * 34;
      g.fillStyle = SYMC[i]; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(SYMS[i], 22 + r * 42, y);
    }
  }
  g.strokeStyle = '#ffd34d'; g.lineWidth = 3; g.strokeRect(2, 2, 124, 92);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 40, 128, 16);
  T.slotScreen.needsUpdate = true;
}

export function neonTexture(text, color, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 256;
  return canvasTex(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.font = `${opts.weight || 400} ${opts.size || 150}px ${opts.font || 'Limelight, Georgia, serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 40;
    g.strokeStyle = color; g.lineWidth = 10; g.strokeText(text, w / 2, h / 2);
    g.shadowBlur = 12; g.fillStyle = '#fff8e6'; g.fillText(text, w / 2, h / 2);
  }, false);
}

export function labelTexture(text, opts = {}) {
  const w = opts.w || 512, h = opts.h || 128;
  return canvasTex(w, h, (g) => {
    g.fillStyle = opts.bg || '#1c1c1c'; g.fillRect(0, 0, w, h);
    g.fillStyle = opts.fg || '#f2e8d0';
    g.font = `${opts.weight || 700} ${opts.size || 64}px ${opts.font || 'Barlow Condensed, Arial Narrow, sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    if (opts.border) { g.strokeStyle = opts.border; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
  }, false);
}

// Box with UVs scaled to world size so tiling textures stay consistent.
export function boxGeo(w, h, d, scale = 2) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * sizes[f][0] / scale, uv.getY(i) * sizes[f][1] / scale);
    }
  }
  return geo;
}

// Static batching: collect transformed geometries per material and merge.
export class Batch {
  constructor() { this.map = new Map(); }
  add(geo, mat, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }
  addAt(geo, mat, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
    this.add(geo, mat, m);
  }
  build(parent) {
    const meshes = [];
    for (const [mat, list] of this.map) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh); meshes.push(mesh);
      list.forEach((g) => g.dispose());
    }
    this.map.clear();
    return meshes;
  }
}

// ---------- People ----------
export const SKIN = ['#f1c9a5', '#e0ac85', '#c58c63', '#9b6845', '#70482f', '#4a2e1f'];
export const HAIR = ['#1b1410', '#3b2516', '#6b4220', '#b8884a', '#d9c28c', '#8a8a8a', '#a3361f'];
export const OUTFIT = ['#c4202e', '#1f3a78', '#2c6e49', '#d9a441', '#f2e8d0', '#4b2a5e', '#e86f3f', '#2f2f35', '#9fc4d9', '#7a1f3d', '#e6d3b3', '#355c7d'];
export const PANTS = ['#1b1b22', '#2b2f3a', '#3c2e24', '#5a5a62', '#1c2a40'];

// Part layout for the shared rig (local space, standing).
export const RIG = {
  legL: { size: [0.16, 0.84, 0.18], pivot: [-0.11, 0.86, 0], center: [0, -0.42, 0] },
  legR: { size: [0.16, 0.84, 0.18], pivot: [0.11, 0.86, 0], center: [0, -0.42, 0] },
  torso: { size: [0.46, 0.62, 0.28], pivot: [0, 0.86, 0], center: [0, 0.31, 0] },
  armL: { size: [0.12, 0.6, 0.13], pivot: [-0.31, 1.44, 0], center: [0, -0.28, 0] },
  armR: { size: [0.12, 0.6, 0.13], pivot: [0.31, 1.44, 0], center: [0, -0.28, 0] },
  head: { size: [0.25, 0.28, 0.26], pivot: [0, 1.5, 0], center: [0, 0.17, 0] },
  hair: { size: [0.27, 0.1, 0.28], pivot: [0, 1.5, 0], center: [0, 0.33, -0.01] },
};
export const RIG_PARTS = Object.keys(RIG);

export function rigGeometry(part) {
  const r = RIG[part];
  const g = part === 'head' ? new THREE.IcosahedronGeometry(0.155, 0) : new THREE.BoxGeometry(...r.size);
  if (part === 'head') g.scale(1, 1.1, 1);
  g.translate(...r.center);
  return g;
}

// Local pose for each part: returns {pivot:[x,y,z], rot:[x,y,z]}.
export function rigPose(part, pose, t, phase, moving) {
  const r = RIG[part];
  const p = [...r.pivot];
  const rot = [0, 0, 0];
  const sw = moving ? Math.sin(t * 8 + phase) : 0;
  const idle = Math.sin(t * 1.4 + phase) * 0.04;
  if (pose === 'sit') {
    if (part === 'legL' || part === 'legR') { p[1] = 0.6; rot[0] = -1.45; p[2] = 0.05; }
    else p[1] -= 0.26;
    if (part === 'armL' || part === 'armR') rot[0] = -0.9 + Math.sin(t * 2 + phase + (part === 'armL' ? 0 : 1.2)) * 0.12;
  } else if (pose === 'cower') {
    p[1] -= part === 'legL' || part === 'legR' ? 0.3 : 0.55;
    if (part === 'legL' || part === 'legR') rot[0] = -1.0;
    if (part === 'armL' || part === 'armR') { rot[0] = -2.4; rot[2] = part === 'armL' ? 0.4 : -0.4; }
    if (part === 'torso' || part === 'head' || part === 'hair') rot[0] = 0.5;
  } else if (pose === 'down') {
    // lying on the back (handled by root rotation), arms out
    if (part === 'armL') rot[2] = 1.2;
    if (part === 'armR') rot[2] = -1.2;
  } else if (pose === 'aim') {
    if (part === 'armR' || part === 'armL') rot[0] = -1.5;
    if (part === 'armL') rot[2] = -0.35;
  } else {
    if (part === 'legL') rot[0] = sw * 0.6;
    if (part === 'legR') rot[0] = -sw * 0.6;
    if (part === 'armL') rot[0] = -sw * 0.5 + idle;
    if (part === 'armR') rot[0] = sw * 0.5 - idle;
    if (pose === 'talk' && part === 'armR') rot[0] = -0.6 + Math.sin(t * 3 + phase) * 0.3;
    if (part === 'torso' || part === 'head' || part === 'hair') p[1] += moving ? Math.abs(sw) * 0.03 : idle * 0.3;
  }
  return { p, rot };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
export function rigMatrix(out, root, part, pose, t, phase, moving) {
  const { p, rot } = rigPose(part, pose, t, phase, moving);
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _m.compose(_v.set(p[0], p[1], p[2]), _q, _s);
  return out.multiplyMatrices(root, _m);
}

// A person built from regular meshes (guards, crew).
export function makePersonGroup(colors, extras = {}) {
  const grp = new THREE.Group();
  const mats = {
    legs: new THREE.MeshStandardMaterial({ color: colors.pants, roughness: 0.8, flatShading: true }),
    torso: new THREE.MeshStandardMaterial({ color: colors.top, roughness: 0.7, flatShading: true }),
    arms: new THREE.MeshStandardMaterial({ color: colors.arms || colors.top, roughness: 0.7, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: colors.skin, roughness: 0.6, flatShading: true }),
    hair: new THREE.MeshStandardMaterial({ color: colors.hair, roughness: 0.9, flatShading: true }),
  };
  const parts = {};
  for (const part of RIG_PARTS) {
    const mat = part.startsWith('leg') ? mats.legs : part === 'torso' ? mats.torso : part.startsWith('arm') ? mats.arms : part === 'head' ? mats.skin : mats.hair;
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(rigGeometry(part), mat);
    mesh.castShadow = false;
    pivot.add(mesh);
    pivot.position.set(...RIG[part].pivot);
    grp.add(pivot);
    parts[part] = pivot;
  }
  if (extras.cap) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.08, 8), new THREE.MeshStandardMaterial({ color: extras.cap, flatShading: true }));
    cap.position.set(0, 0.33, 0); parts.hair.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.12), cap.material);
    brim.position.set(0, 0.3, -0.16); parts.hair.add(brim);
  }
  if (extras.band) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.15), new THREE.MeshStandardMaterial({ color: extras.band, emissive: extras.band, emissiveIntensity: 0.6 }));
    band.position.set(0, -0.12, 0); parts.armL.add(band);
  }
  if (extras.tie) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: extras.tie }));
    tie.position.set(0, 0.42, -0.15); parts.torso.add(tie);
  }
  if (extras.vest) {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.3), new THREE.MeshStandardMaterial({ color: extras.vest, flatShading: true, roughness: 0.5 }));
    vest.position.set(0, 0.36, 0); parts.torso.add(vest);
  }
  grp.userData.parts = parts;
  grp.userData.mats = mats;
  return grp;
}

export function posePerson(grp, pose, t, phase, moving) {
  const parts = grp.userData.parts;
  for (const part of RIG_PARTS) {
    const { p, rot } = rigPose(part, pose, t, phase, moving);
    parts[part].position.set(p[0], p[1], p[2]);
    parts[part].rotation.set(rot[0], rot[1], rot[2]);
  }
}

// Sprite with text (markers over heads).
export function textSprite(text, color, size = 0.5, bg = null) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = color; g.font = 'bold 96px Barlow Condensed, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(size, size, size);
  s.renderOrder = 10;
  return s;
}

export function diamondSprite(color, size = 0.35) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.strokeStyle = '#000'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(32, 4); g.lineTo(58, 32); g.lineTo(32, 60); g.lineTo(6, 32); g.closePath(); g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(size, size, size);
  s.renderOrder = 11;
  return s;
}
