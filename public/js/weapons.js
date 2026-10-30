// Stylized weapon viewmodels with ADS, recoil, reload and tracers.
import * as THREE from 'three';
import { WEAPONS, WEAPONS_LETHAL } from '../shared/data.js';

const mat = (c, e = null, ei = 1) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.4, flatShading: true, ...(e ? { emissive: e, emissiveIntensity: ei } : {}) });

function buildModel(kind, accent) {
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, rx = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; g.add(mesh); return mesh; };
  const body = mat('#6b7079'), dark = mat('#33363c'), glow = mat(accent, accent, 2.2);
  const glove = new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.9, flatShading: true });
  const cuff = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6, flatShading: true });
  let muzzle = new THREE.Vector3(0, 0.03, -0.42);
  if (kind === 'tranq') {
    add(new THREE.BoxGeometry(0.05, 0.06, 0.24), body, 0, 0.03, -0.08);
    add(new THREE.BoxGeometry(0.045, 0.13, 0.07), dark, 0, -0.06, 0.0, 0.25);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10), dark, 0, 0.035, -0.3, Math.PI / 2);
    add(new THREE.BoxGeometry(0.012, 0.02, 0.1), glow, 0.026, 0.04, -0.08);
    muzzle = new THREE.Vector3(0, 0.035, -0.42);
  } else if (kind === 'smg') {
    add(new THREE.BoxGeometry(0.07, 0.09, 0.32), body, 0, 0.02, -0.12);
    add(new THREE.BoxGeometry(0.05, 0.14, 0.06), dark, 0, -0.08, -0.02, 0.2);
    add(new THREE.BoxGeometry(0.04, 0.16, 0.05), dark, 0, -0.09, -0.16);
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), dark, 0, 0.03, -0.32, Math.PI / 2);
    for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.03, 0.006, 4, 10), glow, 0, 0.03, -0.18 - i * 0.03).rotation.y = Math.PI / 2;
    muzzle = new THREE.Vector3(0, 0.03, -0.38);
  } else {
    add(new THREE.CylinderGeometry(0.018, 0.02, 0.26, 8), body, 0, 0.04, -0.2, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.042, 0.042, 0.07, 8), mat('#6d6f74'), 0, 0.03, -0.04, Math.PI / 2);
    add(new THREE.BoxGeometry(0.045, 0.14, 0.06), mat('#5a3420'), 0, -0.07, 0.04, 0.35);
    add(new THREE.BoxGeometry(0.02, 0.02, 0.04), glow, 0, 0.04, -0.34);
    muzzle = new THREE.Vector3(0, 0.04, -0.36);
  }
  // Gloved hand + sleeve so it reads as held
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.1), glove);
  hand.position.set(0.005, -0.075, 0.03); hand.rotation.x = 0.25; g.add(hand);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.3), new THREE.MeshStandardMaterial({ color: '#25252b', roughness: 0.8, flatShading: true }));
  sleeve.position.set(0.02, -0.12, 0.22); sleeve.rotation.x = 0.35; g.add(sleeve);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.094, 0.03), cuff);
  band.position.set(0.02, -0.095, 0.09); band.rotation.x = 0.35; g.add(band);
  g.scale.setScalar(0.85);
  g.userData.muzzle = muzzle.multiplyScalar(0.85);
  return g;
}

export class WeaponView {
  constructor(kind, accent) {
    this.kind = kind;
    this.def = WEAPONS[kind];
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#ffe7c2', '#3a2a20', 2.6));
    const d = new THREE.DirectionalLight('#ffffff', 1.4); d.position.set(1, 2, 1); this.scene.add(d);
    this.root = new THREE.Group();
    this.model = buildModel(kind, accent);
    this.root.add(this.model);
    this.scene.add(this.root);
    // Muzzle flash
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: kind === 'tranq' ? '#7dffb0' : '#9fd8ff', toneMapped: false }));
    this.flash.position.copy(this.model.userData.muzzle).divideScalar(0.85);
    this.flash.visible = false;
    this.model.add(this.flash);
    this.ammo = this.def.mag;
    this.cool = 0; this.reloadT = 0; this.kick = 0; this.ads = 0; this.flashT = 0; this.lastFire = -10;
    this.sway = { x: 0, y: 0 };
  }

  setLethal(on) {
    if (this.lethal === on) return;
    this.lethal = on;
    this.def = (on ? WEAPONS_LETHAL : WEAPONS)[this.kind];
    this.ammo = this.def.mag; this.reloadT = 0;
    this.flash.material.color.set(on ? '#ffc35a' : (this.kind === 'tranq' ? '#7dffb0' : '#9fd8ff'));
    this.model.traverse((o) => { if (o.material && o.material.emissive && o.material.emissiveIntensity > 1) { o.material.color.set(on ? '#5a1010' : o.material.color); o.material.emissive.set(on ? '#ff2a10' : o.material.emissive); o.material.emissiveIntensity = on ? 0.6 : o.material.emissiveIntensity; } });
  }

  canFire() { return this.cool <= 0 && this.reloadT <= 0 && this.ammo > 0; }

  fire() {
    this.ammo--; this.cool = this.def.rate; this.kick = 1; this.flashT = 0.05; this.lastFire = performance.now() / 1000;
    if (this.ammo <= 0) this.startReload();
  }

  startReload() {
    if (this.reloadT > 0 || this.ammo === this.def.mag) return false;
    this.reloadT = this.def.reload;
    return true;
  }

  update(dt, aiming, bob, moving, lookDX, lookDY) {
    this.cool -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = this.def.mag; }
    this.ads += ((aiming && this.reloadT <= 0 ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    this.kick *= Math.exp(-dt * 14);
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.sway.x += (-lookDX * 0.0006 - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (lookDY * 0.0006 - this.sway.y) * Math.min(1, dt * 10);
    const hip = new THREE.Vector3(0.22, -0.22, -0.5), ads = new THREE.Vector3(0, -0.105 - (this.kind === 'revolver' ? 0.0 : 0.0), -0.3);
    const p = hip.lerp(ads, this.ads);
    const bobAmt = moving ? (1 - this.ads * 0.8) : 0;
    p.x += Math.sin(bob) * 0.012 * bobAmt + this.sway.x;
    p.y += Math.abs(Math.cos(bob)) * 0.01 * bobAmt + this.sway.y;
    p.z += this.kick * 0.05;
    const rl = this.reloadT > 0 ? Math.sin((1 - this.reloadT / this.def.reload) * Math.PI) : 0;
    p.y -= rl * 0.12;
    this.root.position.copy(p);
    this.root.rotation.set(this.kick * 0.12 + rl * 0.8, 0, rl * 0.5);
  }

  muzzleWorld(camera) {
    const v = this.model.userData.muzzle.clone();
    this.model.localToWorld(v);
    // viewmodel space is camera space; convert to world
    return v.applyMatrix4(camera.matrixWorld);
  }

  weaponOut() { return this.ads > 0.3 || performance.now() / 1000 - this.lastFire < 3; }
}

// Tracer streaks in the world scene
export class Tracers {
  constructor(scene) { this.scene = scene; this.list = []; }
  add(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
    this.scene.add(line);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true }));
    spark.position.copy(to);
    this.scene.add(spark);
    this.list.push({ line, spark, t: 0.18 });
  }
  update(dt) {
    for (const tr of this.list) {
      tr.t -= dt;
      tr.line.material.opacity = Math.max(0, tr.t / 0.18);
      tr.spark.material.opacity = tr.line.material.opacity;
      tr.spark.scale.setScalar(1 + (0.18 - tr.t) * 6);
      if (tr.t <= 0) { this.scene.remove(tr.line, tr.spark); tr.line.geometry.dispose(); }
    }
    this.list = this.list.filter((t) => t.t > 0);
  }
}
