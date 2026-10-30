// The getaway: Overwatch drives the van (windshield only), the field crew navigates from the police scanner.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Batch, boxGeo, labelTexture } from './art.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const VAN_R = 1.5;

function windowTex(tint) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = tint; g.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 256; y += 32) for (let x = 8; x < 128; x += 30) {
    g.fillStyle = Math.random() < 0.25 ? '#ffe7a8' : '#5a7a98';
    g.fillRect(x, y, 20, 18);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function policeCar(scene) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.8, 4.4), new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.4 }));
  body.position.y = 0.75;
  const doors = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.42, 2.2), new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.4 }));
  doors.position.y = 0.72;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.62, 2.2), new THREE.MeshStandardMaterial({ color: '#202630', roughness: 0.2, metalness: 0.3 }));
  cab.position.set(0, 1.45, -0.2);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: '#ff2030', toneMapped: false }));
  red.position.set(-0.35, 1.85, -0.2);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: '#2a6bff', toneMapped: false }));
  blue.position.set(0.35, 1.85, -0.2);
  g.add(body, doors, cab, red, blue);
  for (const [x, z] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), new THREE.MeshStandardMaterial({ color: '#111' }));
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w);
  }
  g.userData.red = red; g.userData.blue = blue;
  scene.add(g);
  return g;
}

export class GetawayMode {
  constructor(ctx, driver) {
    this.ctx = ctx;
    this.driver = driver;
    this.C = ctx.level.city;
    this.van = { x: this.C.start.x, z: this.C.start.z, yaw: Math.PI, speed: 0, steer: 0 };
    this.input = { up: false, down: false, left: false, right: false, brake: false };
    this.shake = 0;
    this.sendT = 0;
    this.headingUp = false;
    this.showMap = !driver;
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 800);
    this.buildCity();
    this.setupComposer();
  }

  setupComposer() {
    const r = this.ctx.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.4, 0.85);
    this.bloom.enabled = this.ctx.settings.quality !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  buildCity() {
    const C = this.C;
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color('#a9d6ff');
    S.fog = new THREE.Fog('#c9dff0', 40, 150);
    S.add(new THREE.HemisphereLight('#fff3dc', '#5a5040', 1.6));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.0); sun.position.set(80, 140, 40); S.add(sun);
    const B = new Batch();
    const asphalt = new THREE.MeshStandardMaterial({ color: '#3b3d42', roughness: 0.95 });
    const walk = new THREE.MeshStandardMaterial({ color: '#b9b2a2', roughness: 0.9 });
    const lane = new THREE.MeshBasicMaterial({ color: '#f2d24a' });
    const W = C.cols * C.S, H = C.rows * C.S;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 400, H + 400), asphalt);
    ground.rotation.x = -Math.PI / 2; ground.position.set(C.ox + W / 2, 0, C.oz + H / 2);
    S.add(ground);
    const mats = ['#d8c8ae', '#b9c7d6', '#e7b98c'].map((c) => new THREE.MeshStandardMaterial({ map: windowTex(c), roughness: 0.8 }));
    this.solids = [];
    for (const b of C.buildings) {
      B.addAt(boxGeo(b.x2 - b.x1 + 3, 0.18, b.z2 - b.z1 + 3, 4), walk, (b.x1 + b.x2) / 2, 0.09, (b.z1 + b.z2) / 2);
      const g = boxGeo(b.x2 - b.x1, b.h, b.z2 - b.z1, 10);
      B.addAt(g, mats[b.tint], (b.x1 + b.x2) / 2, b.h / 2, (b.z1 + b.z2) / 2);
      this.solids.push({ x1: b.x1 - 1.5, x2: b.x2 + 1.5, z1: b.z1 - 1.5, z2: b.z2 + 1.5 });
    }
    // Lane markings
    for (let i = 0; i <= C.cols; i++) for (let j = 0; j < C.rows; j++) {
      const x = C.ox + i * C.S;
      for (let z = C.oz + j * C.S + 8; z < C.oz + (j + 1) * C.S - 6; z += 6) B.addAt(new THREE.BoxGeometry(0.25, 0.02, 3), lane, x, 0.02, z);
    }
    for (let j = 0; j <= C.rows; j++) for (let i = 0; i < C.cols; i++) {
      const z = C.oz + j * C.S;
      for (let x = C.ox + i * C.S + 8; x < C.ox + (i + 1) * C.S - 6; x += 6) B.addAt(new THREE.BoxGeometry(3, 0.02, 0.25), lane, x, 0.02, z);
    }
    // City edge walls so the van stays in the grid
    const edge = new THREE.MeshStandardMaterial({ color: '#6b6f78' });
    const pad = 8;
    for (const [x1, z1, x2, z2] of [[C.ox - pad - 2, C.oz - pad - 2, C.ox + W + pad + 2, C.oz - pad], [C.ox - pad - 2, C.oz + H + pad, C.ox + W + pad + 2, C.oz + H + pad + 2], [C.ox - pad - 2, C.oz - pad, C.ox - pad, C.oz + H + pad], [C.ox + W + pad, C.oz - pad, C.ox + W + pad + 2, C.oz + H + pad]]) {
      B.addAt(boxGeo(x2 - x1, 3, z2 - z1, 4), edge, (x1 + x2) / 2, 1.5, (z1 + z2) / 2);
      this.solids.push({ x1, z1, x2, z2 });
    }
    // Roadblocks: barrier + two cruisers
    const stripe = new THREE.MeshStandardMaterial({ map: this.ctx.world.T.stripes, roughness: 0.6 });
    this.blockCars = [];
    for (const rb of C.roadblocks) {
      const along = rb.axis === 'x';
      B.addAt(boxGeo(along ? 0.5 : 11, 1.1, along ? 11 : 0.5, 1), stripe, rb.x, 0.55, rb.z);
      for (const s of [-1, 1]) {
        const car = policeCar(S);
        car.position.set(rb.x + (along ? 2.2 : s * 3.3), 0, rb.z + (along ? s * 3.3 : 2.2));
        car.rotation.y = along ? Math.PI / 2 * s : (s > 0 ? 0.3 : -0.3);
        this.blockCars.push(car);
      }
      this.solids.push({ x1: rb.x - (along ? 1.2 : 6), x2: rb.x + (along ? 1.2 : 6), z1: rb.z - (along ? 6 : 1.2), z2: rb.z + (along ? 6 : 1.2), roadblock: true });
    }
    // Safehouse: a garage with a tall green beacon
    const sf = C.safe;
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 120, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#4dffa6', transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beacon.position.set(sf.x, 60, sf.z);
    S.add(beacon);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: labelTexture('SAFEHOUSE', { bg: '#0f3a2c', fg: '#4dffa6', size: 80 }), side: THREE.DoubleSide }));
    sign.position.set(sf.x, 6, sf.z); S.add(sign);
    this.signMesh = sign;
    // Streetlights
    const pole = new THREE.MeshStandardMaterial({ color: '#2b2e33' });
    for (let i = 0; i <= C.cols; i++) for (let j = 0; j <= C.rows; j++) B.addAt(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), pole, C.ox + i * C.S + 5.5, 3.5, C.oz + j * C.S + 5.5);
    B.build(S);
    // Pursuers
    this.pursuers = [policeCar(S), policeCar(S)];
    this.pursuers.forEach((p) => { p.visible = false; });
    // The van (visible to navigators' chase view? we keep the driver's dash only)
    this.dash = new THREE.Group();
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.3, 0.7), new THREE.MeshStandardMaterial({ color: '#23252a', roughness: 0.7 }));
    dash.position.set(0, -0.62, -0.95);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 20), new THREE.MeshStandardMaterial({ color: '#111' }));
    wheel.position.set(-0.38, -0.42, -0.62); wheel.rotation.x = -0.9;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 1.6), new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.5 }));
    hood.position.set(0, -0.82, -2.2);
    this.wheel = wheel;
    this.dash.add(dash, wheel, hood);
    this.camera.add(this.dash);
    S.add(this.camera);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  enter() {
    $('hud').className = 'show getaway';
    $('getawayHud').classList.add('show');
    $('scanner').classList.toggle('show', this.showMap);
    $('gwRole').textContent = this.driver ? 'You are driving. You have no map: your crew calls the turns.' : 'You are navigating. The driver can only see the road. Call every turn.';
    this.resize();
    sound.startEngine();
  }

  exit() {
    $('getawayHud').classList.remove('show');
    $('scanner').classList.remove('show');
    $('hud').className = '';
    sound.stopEngine();
  }

  keydown(e) {
    const k = e.code;
    if (k === 'KeyW' || k === 'ArrowUp') this.input.up = true;
    if (k === 'KeyS' || k === 'ArrowDown') this.input.down = true;
    if (k === 'KeyA' || k === 'ArrowLeft') this.input.left = true;
    if (k === 'KeyD' || k === 'ArrowRight') this.input.right = true;
    if (k === 'Space') { this.input.brake = true; e.preventDefault(); }
    if (k === 'KeyH') this.headingUp = !this.headingUp;
    if (k === 'KeyM' && (!this.driver || this.ctx.practice)) { this.showMap = !this.showMap; $('scanner').classList.toggle('show', this.showMap); }
  }
  keyup(e) {
    const k = e.code;
    if (k === 'KeyW' || k === 'ArrowUp') this.input.up = false;
    if (k === 'KeyS' || k === 'ArrowDown') this.input.down = false;
    if (k === 'KeyA' || k === 'ArrowLeft') this.input.left = false;
    if (k === 'KeyD' || k === 'ArrowRight') this.input.right = false;
    if (k === 'Space') this.input.brake = false;
  }
  mousemove() {}
  mousedown() {}
  mouseup() {}
  releaseAll() { for (const k in this.input) this.input[k] = false; }
  wantsPointerLock() { return false; }

  onEvent(ev) {
    if (ev.type === 'crash') {
      this.shake = 1;
      sound.crash();
      this.ctx.toast(`${ev.text} Damage ${ev.damage}/4.`);
      if (this.driver) { this.van.speed *= -0.25; }
    }
  }

  drive(dt) {
    const v = this.van, I = this.input;
    const throttle = (I.up ? 1 : 0) - (I.down ? 1 : 0);
    const max = 27;
    if (throttle > 0) v.speed += (v.speed < 0 ? 22 : 10) * dt;
    else if (throttle < 0) v.speed -= (v.speed > 0 ? 22 : 6) * dt;
    else v.speed *= Math.exp(-dt * 0.55);
    if (I.brake) v.speed *= Math.exp(-dt * 3.2);
    v.speed = Math.max(-8, Math.min(max, v.speed));
    const steerIn = (I.left ? 1 : 0) - (I.right ? 1 : 0);
    v.steer += (steerIn - v.steer) * Math.min(1, dt * 6);
    const grip = I.brake ? 1.5 : 1;
    const turn = v.steer * Math.min(1, Math.abs(v.speed) / 8) * (1.35 - Math.min(0.6, Math.abs(v.speed) / 45)) * grip * Math.sign(v.speed || 1);
    v.yaw += turn * dt;
    v.x += -Math.sin(v.yaw) * v.speed * dt;
    v.z += -Math.cos(v.yaw) * v.speed * dt;
    // Collide with blocks, edges and roadblocks
    for (const b of this.solids) {
      const cx = Math.max(b.x1, Math.min(v.x, b.x2)), cz = Math.max(b.z1, Math.min(v.z, b.z2));
      const dx = v.x - cx, dz = v.z - cz, d = Math.hypot(dx, dz);
      if (d < VAN_R) {
        const n = d > 1e-4 ? [dx / d, dz / d] : [0, 1];
        v.x = cx + n[0] * VAN_R; v.z = cz + n[1] * VAN_R;
        if (Math.abs(v.speed) > 6 && !b.roadblock) { this.shake = Math.max(this.shake, 0.5); sound.thud(); }
        v.speed *= b.roadblock ? -0.3 : 0.55;
      }
    }
  }

  frame(dt) {
    const ctx = this.ctx, s = ctx.snap, g = s && s.getaway;
    const t = performance.now() / 1000;
    if (this.driver) {
      this.drive(dt);
      this.sendT -= dt;
      if (this.sendT <= 0) { this.sendT = 0.05; ctx.send({ type: 'van', x: this.van.x, z: this.van.z, yaw: this.van.yaw, speed: this.van.speed }); }
    } else if (g) {
      const k = Math.min(1, dt * 10);
      this.van.x += (g.van.x - this.van.x) * k; this.van.z += (g.van.z - this.van.z) * k;
      let dy = g.van.yaw - this.van.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      this.van.yaw += dy * k; this.van.speed = g.van.speed;
    }
    sound.setEngine(Math.abs(this.van.speed) / 27);
    // Pursuers + flashing lights
    if (g) {
      g.pursuers.forEach((pp, i) => {
        const car = this.pursuers[i];
        car.visible = !!pp;
        if (pp) { car.position.x += (pp[0] - car.position.x) * Math.min(1, dt * 8); car.position.z += (pp[1] - car.position.z) * Math.min(1, dt * 8); car.rotation.y = pp[2]; }
      });
      const near = g.pursuers.filter(Boolean).map((pp) => Math.hypot(pp[0] - this.van.x, pp[1] - this.van.z));
      sound.setSiren(near.length ? Math.max(0, 1 - Math.min(...near) / 120) : 0);
    }
    for (const car of [...this.blockCars, ...this.pursuers]) {
      const on = Math.sin(t * 12 + car.position.x) > 0;
      car.userData.red.visible = on; car.userData.blue.visible = !on;
    }
    this.signMesh.lookAt(this.van.x, 6, this.van.z);
    // Camera: the driver's seat
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.12;
    this.camera.position.set(this.van.x + (Math.random() - 0.5) * sh, 2.0 + (Math.random() - 0.5) * sh, this.van.z + (Math.random() - 0.5) * sh);
    this.camera.rotation.set(-0.06, this.van.yaw, 0, 'YXZ');
    this.camera.fov = 72 + Math.min(14, Math.abs(this.van.speed) * 0.5);
    this.camera.updateProjectionMatrix();
    this.wheel.rotation.z = this.van.steer * 1.4;
    // HUD
    if (g) {
      $('gwTime').textContent = `${Math.floor(g.t / 60)}:${String(Math.max(0, Math.floor(g.t % 60))).padStart(2, '0')}`;
      $('gwDamage').innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < g.damage ? 'hit' : ''}"></i>`).join('');
      $('gwSpeed').textContent = `${Math.round(Math.abs(this.van.speed) * 3.6)} km/h`;
      const hd = ((this.van.yaw * 180 / Math.PI + 180) % 360 + 360) % 360;
      $('gwCompass').textContent = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hd / 45) % 8];
    }
    if (this.showMap) this.drawScanner(g);
    this.composer.render();
  }

  drawScanner(g) {
    const c = $('scannerCanvas');
    const rect = c.getBoundingClientRect();
    const w = Math.round(rect.width * devicePixelRatio), h = Math.round(rect.height * devicePixelRatio);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const G = c.getContext('2d'), C = this.C;
    const W = C.cols * C.S, H = C.rows * C.S;
    const sc = Math.min(w, h) / (Math.max(W, H) + 60);
    G.fillStyle = '#04110c'; G.fillRect(0, 0, w, h);
    G.save();
    G.translate(w / 2, h / 2);
    if (this.headingUp) G.rotate(-(Math.PI + this.van.yaw));
    // north (+z) is up on the scanner
    const P = (x, z) => [(x - (C.ox + W / 2)) * sc, -(z - (C.oz + H / 2)) * sc];
    G.fillStyle = '#0c2a1e';
    G.fillRect(...P(C.ox - 6, C.oz + H + 6), (W + 12) * sc, (H + 12) * sc);
    G.fillStyle = '#123d2c';
    for (const b of C.buildings) { const [x, y] = P(b.x1, b.z2); G.fillRect(x, y, (b.x2 - b.x1) * sc, (b.z2 - b.z1) * sc); }
    G.strokeStyle = 'rgba(77,255,166,0.25)'; G.lineWidth = 1;
    for (let i = 0; i <= C.cols; i++) { G.beginPath(); G.moveTo(...P(C.ox + i * C.S, C.oz)); G.lineTo(...P(C.ox + i * C.S, C.oz + H)); G.stroke(); }
    for (let j = 0; j <= C.rows; j++) { G.beginPath(); G.moveTo(...P(C.ox, C.oz + j * C.S)); G.lineTo(...P(C.ox + W, C.oz + j * C.S)); G.stroke(); }
    // Roadblocks
    G.strokeStyle = '#ff3048'; G.lineWidth = Math.max(3, 4 * devicePixelRatio);
    for (const rb of C.roadblocks) {
      const [x, y] = P(rb.x, rb.z);
      G.beginPath();
      if (rb.axis === 'x') { G.moveTo(x, y - 6 * sc); G.lineTo(x, y + 6 * sc); } else { G.moveTo(x - 6 * sc, y); G.lineTo(x + 6 * sc, y); }
      G.stroke();
    }
    // Safehouse
    const [sx, sy] = P(C.safe.x, C.safe.z);
    G.fillStyle = '#4dffa6'; G.beginPath(); G.arc(sx, sy, 9 * devicePixelRatio, 0, Math.PI * 2); G.fill();
    G.font = `700 ${14 * devicePixelRatio}px Barlow Condensed, sans-serif`; G.textAlign = 'center';
    G.fillText('SAFEHOUSE', sx, sy - 14 * devicePixelRatio);
    // Pursuers
    if (g) for (const pp of g.pursuers) {
      if (!pp) continue;
      const [x, y] = P(pp[0], pp[1]);
      G.fillStyle = Math.sin(performance.now() / 120) > 0 ? '#ff3048' : '#3d8bff';
      G.beginPath(); G.arc(x, y, 6 * devicePixelRatio, 0, Math.PI * 2); G.fill();
    }
    // Van arrow
    const [vx, vy] = P(this.van.x, this.van.z);
    G.save(); G.translate(vx, vy); G.rotate(Math.PI + this.van.yaw);
    G.fillStyle = '#ffd23f';
    G.beginPath(); G.moveTo(0, -12 * devicePixelRatio); G.lineTo(8 * devicePixelRatio, 9 * devicePixelRatio); G.lineTo(-8 * devicePixelRatio, 9 * devicePixelRatio); G.closePath(); G.fill();
    G.restore();
    G.restore();
    G.fillStyle = 'rgba(77,255,166,0.8)'; G.font = `600 ${13 * devicePixelRatio}px Barlow Condensed, sans-serif`; G.textAlign = 'left';
    G.fillText(this.headingUp ? 'H: north-up' : 'H: heading-up', 12, h - 12);
  }
}
