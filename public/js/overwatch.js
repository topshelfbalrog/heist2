// Overwatch: first-person in the van. Live CCTV monitors, tactical map, manuals, roster, radio, Intel and Strikes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { camYaw, beamState } from './world.js';
import { labelTexture } from './art.js';
import { buildManual, traitDossier } from './puzzles.js';
import { sound } from './audio.js';
import { ROLES } from '../shared/data.js';
import { hasLOS, angDiff, yawTo, doorBox } from '../shared/geom.js';
import { floorOf, tileArmed, breakerEntry } from '../shared/gen.js';

const $ = (id) => document.getElementById(id);
const GSTATE_NAMES = ['Patrolling', 'Investigating', 'ALERT', 'Down', 'Conned', 'Distracted'];

const CCTV_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const CCTV_FRAG = `
uniform sampler2D map; uniform float time; uniform float stat; uniform float ir; uniform float bright; uniform float outGamma; varying vec2 vUv;
float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
void main(){
  vec2 c = vUv - 0.5;
  vec2 uv = 0.5 + c * (1.0 + 0.07 * dot(c, c));
  vec3 tex = texture2D(map, uv).rgb;
  float g = dot(tex, vec3(0.3, 0.59, 0.11));
  vec3 col = mix(tex, vec3(g) * vec3(0.9, 1.0, 0.95), 0.3);
  if (ir > 0.5) {
    float red = max(0.0, tex.r - max(tex.g, tex.b));
    col = vec3(g * 0.25, g * 0.85, g * 0.45) + vec3(red * 2.4, red * 0.2, red * 0.3);
  }
  col *= bright;
  col *= 0.92 + 0.08 * sin(uv.y * 520.0 + time * 12.0);
  col += (rnd(uv * 400.0 + time) - 0.5) * 0.07;
  col *= mix(0.55, 1.0, smoothstep(0.75, 0.25, length(c)));
  float n = rnd(floor(uv * vec2(180.0, 110.0)) + floor(time * 30.0));
  col = mix(col, vec3(n * 0.8), stat);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / outGamma));
  gl_FragColor = vec4(col, 1.0);
}`;

function cctvMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, stat: { value: 0 }, ir: { value: 0 }, bright: { value: 1.25 }, outGamma: { value: 1 } },
    vertexShader: CCTV_VERT, fragmentShader: CCTV_FRAG, toneMapped: false,
  });
}

export class OverwatchMode {
  constructor(ctx) {
    this.ctx = ctx;
    const L = ctx.level;
    this.yaw = 0; this.pitch = -0.12;
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 50);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07080b');
    this.feeds = [];
    // Monitors 1-3 stay on the ground floor; 4-6 follow the crew between floors
    const ground = L.cams.map((c, i) => i).filter((i) => !L.cams[i].floor);
    this.monitorCam = ground.slice(0, 6);
    while (this.monitorCam.length < 6) this.monitorCam.push(this.monitorCam.length % L.cams.length);
    this.manualMon = new Set();
    this.crewFloor = 0;
    this.mapFloor = null;
    this.zoom = -1;
    this.overlay = null;
    this.mapMode = 'ping';
    this.lastSeen = new Map();
    this.cueT = {};
    this.state = { suffix: null, manualPage: null };
    this.feedTick = 0;
    this.buildVan();
    this.setupComposer();
    this.mapCanvas = $('owMapCanvas');
    this.raycaster = new THREE.Raycaster();
    this.hover = null;
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0 };
  }

  setupComposer() {
    const r = this.ctx.renderer;
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.45, 0.5, 0.8);
    this.bloom.enabled = this.ctx.settings.quality !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // Zoomed feed
    this.zoomRT = new THREE.WebGLRenderTarget(1280, 800);
    this.zoomScene = new THREE.Scene();
    this.zoomCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.zoomMat = cctvMaterial(this.zoomRT.texture);
    this.zoomMat.uniforms.outGamma.value = 2.2;
    this.zoomScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.zoomMat));
  }

  buildVan() {
    const S = this.scene, T = this.ctx.world.T;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.7, ...o });
    S.add(new THREE.HemisphereLight('#c9e8ff', '#3a2a18', 1.6));
    const lamp = new THREE.PointLight('#ffc98a', 14, 7, 1.2); lamp.position.set(0, 2.1, 0.4); S.add(lamp);
    const glow = new THREE.PointLight('#46e0ff', 3, 4, 2); glow.position.set(0, 1.3, -0.5); S.add(glow);
    const padded = std({ map: T.padded });
    const room = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 3.4), [padded, padded, std({ color: '#1b1d22' }), std({ color: '#2a2a2e', map: T.asphalt }), padded, padded]);
    room.material.forEach((m) => { m.side = THREE.BackSide; });
    room.position.set(0, 1.2, 0.3);
    S.add(room);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.03, 0.05), std({ color: '#46e0ff', emissive: '#46e0ff', emissiveIntensity: 2 }));
    strip.position.set(0, 2.36, -0.8); S.add(strip);
    // Desk
    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.8), std({ color: '#3a2a1c', map: T.wood }));
    desk.position.set(0, 0.78, -0.65); S.add(desk);
    // Monitors
    this.monitors = [];
    const bezel = std({ color: '#111216', roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const row = i < 3 ? 1 : 0, col = i % 3;
      const rt = new THREE.WebGLRenderTarget(400, 250);
      const mat = cctvMaterial(rt.texture);
      const grp = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.05), bezel);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), mat);
      scr.position.z = 0.028;
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.07), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false }));
      lbl.position.set(0, -0.155, 0.031);
      grp.add(b, scr, lbl);
      const ang = (col - 1) * -0.42;
      grp.position.set(Math.sin(-ang) * -0.0 + (col - 1) * 0.68, 1.05 + row * 0.47, -0.95 + Math.abs(col - 1) * 0.14);
      grp.rotation.y = ang;
      grp.rotation.x = row ? 0.12 : 0.02;
      S.add(grp);
      scr.userData = { action: 'monitor', idx: i };
      this.monitors.push({ grp, scr, mat, rt, lbl, lblKey: '' });
    }
    // Blueprint table (left)
    this.bpCanvas = document.createElement('canvas'); this.bpCanvas.width = 768; this.bpCanvas.height = 768;
    this.bpTex = new THREE.CanvasTexture(this.bpCanvas); this.bpTex.colorSpace = THREE.SRGBColorSpace;
    const bp = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.72), new THREE.MeshBasicMaterial({ map: this.bpTex, toneMapped: false }));
    bp.position.set(-0.98, 0.95, -0.25); bp.rotation.set(-1.0, 0.75, 0.62);
    bp.userData = { action: 'map' };
    S.add(bp);
    const bpFrame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.78), bezel);
    bpFrame.position.copy(bp.position); bpFrame.rotation.copy(bp.rotation); bpFrame.rotateX(Math.PI / 2); bpFrame.translateY(-0.025);
    S.add(bpFrame);
    // Suspicion board (right)
    this.sbCanvas = document.createElement('canvas'); this.sbCanvas.width = 512; this.sbCanvas.height = 384;
    this.sbTex = new THREE.CanvasTexture(this.sbCanvas); this.sbTex.colorSpace = THREE.SRGBColorSpace;
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ map: this.sbTex, toneMapped: false }));
    sb.position.set(1.02, 1.2, -0.3); sb.rotation.y = -1.0;
    S.add(sb);
    const sbB = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.49, 0.04), bezel);
    sbB.position.copy(sb.position); sbB.rotation.copy(sb.rotation); sbB.translateZ(-0.025);
    S.add(sbB);
    // Binder (manual) and clipboard (roster)
    const binder = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.33), std({ color: '#c4202e', emissive: '#3a0508', emissiveIntensity: 0.5 }));
    binder.position.set(0.55, 0.85, -0.42); binder.rotation.y = -0.3;
    binder.userData = { action: 'manual' };
    S.add(binder);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.06), new THREE.MeshBasicMaterial({ map: labelTexture('MANUALS', { bg: '#f2e8d0', fg: '#17110c', size: 80 }) }));
    tag.rotation.x = -Math.PI / 2; tag.position.set(0, 0.031, 0); binder.add(tag);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.32), std({ color: '#8a6238' }));
    clip.position.set(-0.45, 0.83, -0.42); clip.rotation.y = 0.25;
    clip.userData = { action: 'roster' };
    S.add(clip);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.26), new THREE.MeshBasicMaterial({ map: labelTexture('GUARDS', { bg: '#f2e8d0', fg: '#17110c', size: 70, w: 256, h: 320 }) }));
    paper.rotation.x = -Math.PI / 2; paper.position.y = 0.012; clip.add(paper);
    // Radio unit
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.22), std({ color: '#2b2e33', metalness: 0.4 }));
    radio.position.set(0.0, 0.89, -0.42);
    radio.userData = { action: 'radio' };
    S.add(radio);
    this.radioLed = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), new THREE.MeshBasicMaterial({ color: '#3dff8a', toneMapped: false }));
    this.radioLed.position.set(0.15, 0.97, -0.31); S.add(this.radioLed);
    // Coffee + dice
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 12), std({ color: '#f2e8d0' }));
    cup.position.set(0.85, 0.87, -0.5); S.add(cup);
    for (const [x, r] of [[-0.2, 0.3], [-0.12, 1.1]]) {
      const die = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), std({ color: '#c4202e' }));
      die.position.set(x, 0.84, -0.3); die.rotation.y = r; S.add(die);
    }
    this.clickables = [...this.monitors.map((m) => m.scr), bp, binder, clip, radio];
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  enter() {
    this.yaw = 0; this.pitch = -0.12; this.skipMove = 3;
    $('hud').className = 'show overwatch';
    $('owhud').classList.add('show');
    this.resize();
    this.renderRoster();
  }

  exit() { $('owhud').classList.remove('show'); $('hud').className = ''; this.closeOverlay(); }

  // ---------- Input ----------
  keydown(e) {
    const k = e.code;
    if (/^Digit[1-6]$/.test(k) && !this.overlay) { this.setZoom(+k.slice(5) - 1); return; }
    if (k === 'KeyM') { this.toggleOverlay('map'); return; }
    if (k === 'KeyB') { this.toggleOverlay('manual'); return; }
    if (k === 'KeyG') { this.toggleOverlay('roster'); return; }
    if (k === 'KeyO') { this.toggleOverlay('console'); return; }
    if (k === 'KeyQ' || k === 'KeyC') { if (this.overlay !== 'map') this.toggleOverlay('map'); this.armTool(k === 'KeyQ' ? 'seal' : 'cut', true); return; }
    if (this.overlay === 'map' && /^Digit[1-3]$/.test(k)) { this.mapFloor = +k.slice(5) - 1; this.updateFloorTabs(); return; }
    if (k === 'Tab') { e.preventDefault(); this.closeOverlay(); this.setZoom(-1); return; }
    if (this.zoom >= 0) {
      if (k === 'ArrowRight' || k === 'KeyD') this.cycleZoomCam(1);
      if (k === 'ArrowLeft' || k === 'KeyA') this.cycleZoomCam(-1);
    }
  }
  keyup() {}

  escape() {
    if (this.overlay) { this.closeOverlay(); return true; }
    if (this.zoom >= 0) { this.setZoom(-1); return true; }
    return false;
  }

  mousemove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.nx = (e.clientX / innerWidth) * 2 - 1; this.mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
    if (this.skipMove > 0) { this.skipMove--; return; }
    if (document.pointerLockElement && this.zoom < 0 && !this.overlay) {
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.yaw -= e.movementX * this.ctx.settings.sens;
      this.pitch -= e.movementY * this.ctx.settings.sens;
      this.yaw = Math.max(-1.6, Math.min(1.6, this.yaw));
      this.pitch = Math.max(-0.9, Math.min(0.7, this.pitch));
    }
  }

  mousedown(e) {
    if (e.button !== 0) return;
    if (this.zoom >= 0 && !this.overlay) { this.clickZoom(); return; }
    if (!this.overlay && this.hover) this.activate(this.hover.userData);
  }
  mouseup() {}
  releaseAll() {}

  wantsPointerLock() { return this.zoom < 0 && !this.overlay; }

  activate(ud) {
    sound.ui();
    if (ud.action === 'monitor') this.setZoom(ud.idx);
    else if (ud.action === 'map') this.toggleOverlay('map');
    else if (ud.action === 'manual') this.toggleOverlay('manual');
    else if (ud.action === 'roster') this.toggleOverlay('roster');
    else if (ud.action === 'radio') this.ctx.toast('Hold V to talk on the radio. Your crew hears you unless they are in a jammer zone.');
  }

  setZoom(i) {
    this.zoom = i;
    $('owZoom').classList.toggle('show', i >= 0);
    if (i >= 0) { document.exitPointerLock?.(); sound.radioClick(true); }
    this.updateZoomLabel();
  }

  cycleZoomCam(dir) {
    const n = this.ctx.level.cams.length;
    this.monitorCam[this.zoom] = (this.monitorCam[this.zoom] + dir + n) % n;
    this.manualMon.add(this.zoom);
    sound.ui();
    this.updateZoomLabel();
  }

  updateZoomLabel() {
    if (this.zoom < 0) return;
    const c = this.ctx.level.cams[this.monitorCam[this.zoom]];
    $('owZoomLabel').textContent = `Monitor ${this.zoom + 1}: ${c.label}${c.ir ? ' (infrared)' : c.thermal ? ' (thermal)' : ''}`;
  }

  toggleOverlay(name) {
    if (this.overlay === name) { this.closeOverlay(); return; }
    this.closeOverlay();
    this.overlay = name;
    document.exitPointerLock?.();
    sound.ui();
    if (name === 'map') $('owMap').classList.add('show');
    if (name === 'manual') { $('owManual').classList.add('show'); buildManual($('owManualBody'), this.ctx.level, this.state); }
    if (name === 'roster') { $('owRoster').classList.add('show'); this.renderRoster(); }
    if (name === 'console') { $('owConsole').classList.add('show'); this.renderConsole(); setTimeout(() => $('owConsoleInput')?.focus(), 50); }
    if (name === 'map') this.updateFloorTabs();
  }

  closeOverlay() {
    this.overlay = null;
    for (const id of ['owMap', 'owManual', 'owRoster', 'owConsole']) $(id).classList.remove('show');
    this.mapMode = 'ping';
    this.updateStrikeButtons();
  }

  // ---------- Zoomed feed: click guards to tag ----------
  feedGuards(camIdx, cam) {
    const out = [];
    const v = new THREE.Vector3();
    for (const gv of this.ctx.world.guardViews) {
      if (!gv) continue;
      v.set(gv.x, gv.state === 3 ? 0.3 : 1.4, gv.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      if (!this.camSeesPoint(camIdx, gv.x, gv.z)) continue;
      out.push({ gv, sx: (v.x + 1) / 2, sy: (1 - v.y) / 2 });
    }
    return out;
  }

  clickZoom() {
    const camIdx = this.monitorCam[this.zoom];
    const cm = this.ctx.world.camMeshes[camIdx];
    if (!cm.online) { this.ctx.toast('That feed is down.'); return; }
    const rect = $('owZoomFrame').getBoundingClientRect();
    const mx = (this.mouse.x - rect.left) / rect.width, my = (this.mouse.y - rect.top) / rect.height;
    let best = null, bd = 0.06;
    for (const f of this.feedGuards(camIdx, cm.camera)) {
      const d = Math.hypot(f.sx - mx, (f.sy - my) * 0.7);
      if (d < bd) { bd = d; best = f; }
    }
    if (best) this.ctx.send({ type: 'tag', gid: best.gv.def.id });
  }

  camSeesPoint(i, x, z) {
    const s = this.ctx.snap, L = this.ctx.level;
    if (!s || !s.cams[i] || !s.cams[i][1]) return false;
    const c = L.cams[i];
    if (Math.hypot(x - c.x, z - c.z) > c.range + 4) return false;
    if (Math.abs(angDiff(camYaw(c, this.ctx.simT()), yawTo(c.x, c.z, x, z))) > c.fov / 2 + 0.3) return false;
    return hasLOS(L, s.doors.map((d) => !!d), c.x, c.z, x, z);
  }

  // ---------- Events ----------
  onEvent(ev) {
    const ctx = this.ctx;
    switch (ev.type) {
      case 'vaultSuffix':
        this.state.suffix = ev.suffix;
        ctx.toast(`Vault code, last two digits: ${ev.suffix.join(' ')}. Tell your crew before they enter the vault.`, 9);
        sound.success();
        if (this.overlay === 'manual') buildManual($('owManualBody'), ctx.level, this.state);
        break;
      case 'intel': ctx.toast(`+${ev.n} Intel: ${ev.reason}`); sound.coin(); break;
      case 'tagged': sound.beep(true); this.renderRoster(); break;
      case 'guardAdd': this.renderRoster(); break;
      case 'strike': this.updateStrikeButtons(); break;
      case 'protocol': this.renderConsole(); break;
      case 'overrideOk': case 'overrideBad': case 'breakerFlip': this.renderConsole(ev); break;
    }
  }

  // ---------- Strikes ----------
  updateStrikeButtons() {
    const s = this.ctx.snap;
    if (!s) return;
    const can = s.intel >= 4 && s.strikesLeft > 0;
    document.querySelectorAll('#owStrikes button').forEach((b) => {
      b.disabled = !can;
      b.classList.toggle('on', this.mapMode === b.dataset.kind);
    });
    const cd = s.owCd || [0, 0];
    document.querySelectorAll('#owTools button').forEach((b) => {
      const c = cd[b.dataset.tool === 'seal' ? 0 : 1];
      b.disabled = c > 0;
      b.classList.toggle('on', this.mapMode === b.dataset.tool);
    });
    $('owMapHint').textContent = {
      ping: 'Click the map to ping a spot for your crew. Click a guard your cameras can see to tag them.',
      siren: 'Jackpot Siren: click a slot bank. Nearby guards go look.',
      lights: 'Kill the Lights: click an area. The whole lighting zone (casino, back of house, B1 or B2) goes dark for 10s.',
      override: 'Override: click a basic or keycard door to open it.',
      seal: 'Seal a door: click any normal door. It slams shut and nobody gets through for 12s. Guards chasing your crew get stuck behind it.',
      cut: 'Cut power: click an area. It goes dark for 7s: cameras there go blind, guards can barely see and they miss more shots.',
    }[this.mapMode];
  }

  armTool(tool, fromKey = false) {
    const s = this.ctx.snap;
    const c = s && s.owCd ? s.owCd[tool === 'seal' ? 0 : 1] : 0;
    if (c > 0) { this.ctx.toast(`${tool === 'seal' ? 'Door seal' : 'Power cut'} recharging: ${c}s.`); return; }
    this.mapMode = this.mapMode === tool && !fromKey ? 'ping' : tool;
    sound.ui();
    this.updateStrikeButtons();
  }

  armStrike(kind) {
    const s = this.ctx.snap;
    if (!s || s.intel < 4) { this.ctx.toast('Strikes cost 4 Intel. Tag guards, decode manuals and flag radio chatter to earn it.'); return; }
    if (s.strikesLeft <= 0) { this.ctx.toast('No Strikes left this run.'); return; }
    this.mapMode = this.mapMode === kind ? 'ping' : kind;
    sound.ui();
    this.updateStrikeButtons();
  }

  // ---------- Tactical map ----------
  shownFloor() { return this.mapFloor != null ? this.mapFloor : this.crewFloor; }

  updateFloorTabs() {
    const box = $('owFloorTabs');
    if (!box) return;
    const L = this.ctx.level;
    box.innerHTML = '';
    L.floors.forEach((F) => {
      const b = document.createElement('button');
      b.textContent = F.id === 0 ? 'Ground' : F.id === 1 ? 'B1' : 'B2';
      b.className = this.shownFloor() === F.id ? 'on' : '';
      b.onclick = () => { this.mapFloor = F.id; this.updateFloorTabs(); };
      box.append(b);
    });
    const auto = document.createElement('button');
    auto.textContent = 'Follow crew';
    auto.className = this.mapFloor == null ? 'on' : '';
    auto.onclick = () => { this.mapFloor = null; this.updateFloorTabs(); };
    box.append(auto);
  }

  mapTransform(w, h, floor = this.shownFloor()) {
    const L = this.ctx.level;
    const F = L.floors[floor];
    const x1 = F.x1, x2 = F.x2, z1 = F.z1, z2 = F.z2;
    const sc = Math.min(w / (x2 - x1), h / (z2 - z1)) * 0.96;
    const ox = (w - (x2 - x1) * sc) / 2, oy = (h - (z2 - z1) * sc) / 2;
    return {
      sc,
      X: (x) => ox + (x - x1) * sc,
      Y: (z) => oy + (z2 - z) * sc,
      inv: (px, py) => ({ x: x1 + (px - ox) / sc, z: z2 - (py - oy) / sc }),
    };
  }

  mapClick(e) {
    const c = this.mapCanvas, rect = c.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (c.width / rect.width), py = (e.clientY - rect.top) * (c.height / rect.height);
    const tf = this.mapTransform(c.width, c.height);
    const p = tf.inv(px, py);
    const L = this.ctx.level, ctx = this.ctx;
    if (this.mapMode === 'siren') {
      const b = L.slotBanks.map((bk) => [bk, Math.hypot(bk.x - p.x, bk.z - p.z)]).sort((a, b2) => a[1] - b2[1])[0];
      if (b && b[1] < 5) { ctx.send({ type: 'strike', kind: 'siren', target: b[0].id }); this.mapMode = 'ping'; }
      else ctx.toast('Click on a slot bank (the pink blocks).');
    } else if (this.mapMode === 'lights') {
      const zn = L.zones.find((z) => p.x >= z.x1 && p.x <= z.x2 && p.z >= z.z1 && p.z <= z.z2);
      const zone = zn && ['casino', 'backhouse', 'b1', 'b2'].includes(zn.light) ? zn.light : null;
      if (zone) { ctx.send({ type: 'strike', kind: 'lights', target: zone }); this.mapMode = 'ping'; }
      else ctx.toast('Click inside a lit area: the casino, the back of house, B1 or B2.');
    } else if (this.mapMode === 'seal') {
      const d = L.doors.map((dr) => [dr, Math.hypot(dr.x - p.x, dr.z - p.z)]).filter(([dr]) => ['basic', 'keycard', 'glyph'].includes(dr.type)).sort((a, b2) => a[1] - b2[1])[0];
      if (d && d[1] < 3) { ctx.send({ type: 'seal', target: d[0].id }); this.mapMode = 'ping'; }
      else ctx.toast('Click on a door (not the lift, vault or loading bay).');
    } else if (this.mapMode === 'cut') {
      const zn = L.zones.find((z) => p.x >= z.x1 && p.x <= z.x2 && p.z >= z.z1 && p.z <= z.z2);
      const zone = zn && ['casino', 'backhouse', 'b1', 'b2'].includes(zn.light) ? zn.light : null;
      if (zone) { ctx.send({ type: 'cut', target: zone }); this.mapMode = 'ping'; }
      else ctx.toast('Click inside a lit area: the casino, the back of house, B1 or B2.');
    } else if (this.mapMode === 'override') {
      const d = L.doors.map((dr) => [dr, Math.hypot(dr.x - p.x, dr.z - p.z)]).filter(([dr]) => dr.type === 'basic' || dr.type === 'keycard').sort((a, b2) => a[1] - b2[1])[0];
      if (d && d[1] < 3) { ctx.send({ type: 'strike', kind: 'override', target: d[0].id }); this.mapMode = 'ping'; }
      else ctx.toast('Click on a basic or keycard door.');
    } else {
      // tag a visible guard, otherwise ping
      let best = null, bd = 1.6;
      for (const gv of this.ctx.world.guardViews) {
        if (!gv || !this.visibleGuards.has(gv.def.id)) continue;
        const d = Math.hypot(gv.x - p.x, gv.z - p.z);
        if (d < bd) { bd = d; best = gv; }
      }
      if (best && !best.tagged) ctx.send({ type: 'tag', gid: best.def.id });
      else { ctx.send({ type: 'ping', x: p.x, z: p.z }); sound.ui(); }
    }
    this.updateStrikeButtons();
  }

  computeVisible() {
    const set = new Set();
    const L = this.ctx.level;
    for (const gv of this.ctx.world.guardViews) {
      if (!gv) continue;
      if (gv.tagged) { set.add(gv.def.id); continue; }
      for (let i = 0; i < L.cams.length; i++) if (this.camSeesPoint(i, gv.x, gv.z)) { set.add(gv.def.id); break; }
    }
    this.visibleGuards = set;
    for (const id of set) { const gv = this.ctx.world.guardViews[id]; this.lastSeen.set(id, { x: gv.x, z: gv.z, t: performance.now() }); }
  }

  drawMap(g, w, h, big) {
    const ctx = this.ctx, L = ctx.level, s = ctx.snap;
    const tf = this.mapTransform(w, h);
    const { X, Y, sc } = tf;
    g.fillStyle = '#071019'; g.fillRect(0, 0, w, h);
    // Grid
    g.strokeStyle = 'rgba(70,224,255,0.06)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += sc * 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += sc * 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // Zones
    const zc = { casino: 'rgba(196,32,46,0.16)', bar: 'rgba(217,164,65,0.18)', cage: 'rgba(217,164,65,0.22)', plaza: 'rgba(240,220,180,0.08)', boh: 'rgba(160,170,190,0.14)', storage: 'rgba(160,170,190,0.18)', hub: 'rgba(70,224,255,0.16)', lasers: 'rgba(255,48,72,0.18)', vault: 'rgba(217,164,65,0.2)', dock: 'rgba(77,255,166,0.12)' };
    for (const zn of L.zones.slice().reverse()) {
      g.fillStyle = zc[zn.name] || 'rgba(255,255,255,0.05)';
      g.fillRect(X(zn.x1), Y(zn.z2), (zn.x2 - zn.x1) * sc, (zn.z2 - zn.z1) * sc);
    }
    if (s && s.lights.length) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (const zn of L.zones) if (s.lights.includes(zn.light)) g.fillRect(X(zn.x1), Y(zn.z2), (zn.x2 - zn.x1) * sc, (zn.z2 - zn.z1) * sc);
    }
    // Props
    g.fillStyle = 'rgba(255,61,139,0.55)';
    for (const b of L.slotBanks) g.fillRect(X(b.x - b.len / 2), Y(b.z + 0.7), b.len * sc, 1.4 * sc);
    g.fillStyle = 'rgba(15,107,67,0.8)';
    for (const t of L.tables) { g.beginPath(); g.arc(X(t.x), Y(t.z), 1.3 * sc, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(242,232,208,0.18)';
    for (const so of L.solids) if (so.kind !== 'slots' && so.kind !== 'poker') g.fillRect(X(so.x1), Y(so.z2), (so.x2 - so.x1) * sc, (so.z2 - so.z1) * sc);
    // Walls
    g.fillStyle = '#9fdcff';
    for (const wl of L.walls) g.fillRect(X(wl.x1), Y(wl.z2), Math.max(1, (wl.x2 - wl.x1) * sc), Math.max(1, (wl.z2 - wl.z1) * sc));
    // Doors
    L.doors.forEach((d, i) => {
      const b = doorBox(d);
      const open = s ? s.doors[i] : 0, locked = s ? s.locks[i] : 1;
      const seal = s && s.seals ? s.seals.find((q) => q[0] === i) : null;
      g.fillStyle = seal ? '#46e0ff' : open ? '#4dffa6' : locked ? '#ff3048' : '#f2e8d0';
      g.fillRect(X(b.x1), Y(b.z2), Math.max(2, (b.x2 - b.x1) * sc), Math.max(2, (b.z2 - b.z1) * sc));
      if (seal) {
        g.strokeStyle = '#46e0ff'; g.lineWidth = 2;
        g.strokeRect(X(b.x1) - 4, Y(b.z2) - 4, Math.max(2, (b.x2 - b.x1) * sc) + 8, Math.max(2, (b.z2 - b.z1) * sc) + 8);
        if (big) { g.font = '700 12px Barlow Condensed, sans-serif'; g.fillStyle = '#46e0ff'; g.textAlign = 'left'; g.textAlign = 'center'; g.fillText(`SEALED ${seal[1]}s`, X((b.x1 + b.x2) / 2), Y(b.z2) - 10); }
      }
    });
    // Pressure plates (only while the THERMAL camera is online)
    const thIdx = L.cams.findIndex((c) => c.thermal);
    if (s && s.cams[thIdx] && s.cams[thIdx][1]) {
      const TA = L.tileArea;
      for (let r = 0; r < TA.rows; r++) for (let c = 0; c < TA.cols; c++) {
        g.fillStyle = tileArmed(L, ctx.simT(), c, r) ? 'rgba(255,90,26,0.75)' : 'rgba(77,255,166,0.18)';
        g.fillRect(X(TA.x1 + c * TA.size) + 1, Y(TA.z1 + (r + 1) * TA.size) + 1, TA.size * sc - 2, TA.size * sc - 2);
      }
      if (big) {
        const left = L.tiles.period - (ctx.simT() % L.tiles.period);
        g.font = '700 14px Barlow Condensed, sans-serif'; g.fillStyle = '#ffb06b'; g.textAlign = 'center';
        g.fillText(`Pattern swaps in ${Math.ceil(left)}s`, X(TA.x1 + TA.cols), Y(TA.z1 - 0.6));
      }
    }
    // Lasers (only if the IR camera is online)
    const irIdx = L.cams.findIndex((c) => c.ir);
    if (s && s.cams[irIdx] && s.cams[irIdx][1]) {
      for (const lg of L.lasers) {
        const on = lg.beams.some((b) => beamState(b, ctx.simT(), !!s.protocol).some((x) => x.on));
        g.strokeStyle = on ? '#ff3048' : 'rgba(255,48,72,0.25)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(X(lg.x1), Y(lg.z)); g.lineTo(X(lg.x2), Y(lg.z)); g.stroke();
      }
    }
    // Labels
    if (big) {
      g.font = `600 ${Math.max(11, sc * 1.2)}px Barlow Condensed, sans-serif`; g.fillStyle = 'rgba(242,232,208,0.55)'; g.textAlign = 'center';
      for (const zn of L.zones) if (zn.name !== 'bar' && floorOf(L, (zn.x1 + zn.x2) / 2) === this.shownFloor()) g.fillText(zn.label, X((zn.x1 + zn.x2) / 2), Y(zn.z2) + sc * 1.6);
      // Interactable markers so Overwatch can direct the crew
      const icon = { glyphPad: 'Keypad', wirePanel: 'Wires', password: 'Lift terminal', simon: 'Cam server', morse: 'Safe', maze: 'Hatch lock', vaultPad: 'Vault pad', key: 'Key', breaker: 'Breaker', stairs: 'Stairs', elevator: 'Lift', descend: 'Hatch' };
      g.font = '600 11px Barlow Condensed, sans-serif'; g.textAlign = 'left';
      for (const it of L.interact) {
        if (!icon[it.kind] || floorOf(L, it.x) !== this.shownFloor()) continue;
        g.fillStyle = it.kind === 'breaker' && s && s.protocol ? (s.protocol.flipped[it.id] ? '#4dffa6' : '#ff3048') : '#ffd23f';
        g.fillRect(X(it.x) - 3, Y(it.z) - 3, 6, 6);
        g.fillText(icon[it.kind] + (it.console ? ' ' + it.console : ''), X(it.x) + 5, Y(it.z) + 4);
      }
    }
    // Cameras
    L.cams.forEach((c, i) => {
      const st = s ? s.cams[i] : [0, 1];
      const yaw = camYaw(c, ctx.simT());
      g.fillStyle = st[0] > 0 ? 'rgba(61,139,255,0.18)' : st[1] ? 'rgba(255,48,72,0.13)' : 'rgba(120,120,120,0.08)';
      g.beginPath(); g.moveTo(X(c.x), Y(c.z));
      for (let a = -c.fov / 2; a <= c.fov / 2 + 0.01; a += c.fov / 8) {
        const yy = yaw + a;
        g.lineTo(X(c.x - Math.sin(yy) * c.range), Y(c.z - Math.cos(yy) * c.range));
      }
      g.closePath(); g.fill();
      g.fillStyle = st[0] > 0 ? '#3d8bff' : st[1] ? '#ff3048' : '#666';
      g.fillRect(X(c.x) - 4, Y(c.z) - 4, 8, 8);
    });
    // Guards
    const now = performance.now();
    for (const [id, ls] of this.lastSeen) {
      if (this.visibleGuards.has(id)) continue;
      const age = (now - ls.t) / 1000;
      if (age > 12) continue;
      g.strokeStyle = `rgba(255,210,63,${0.5 * (1 - age / 12)})`; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X(ls.x), Y(ls.z), 0.5 * sc, 0, Math.PI * 2); g.stroke();
    }
    for (const gv of ctx.world.guardViews) {
      if (!gv || !this.visibleGuards.has(gv.def.id)) continue;
      const col = gv.state === 2 ? '#ff3048' : gv.state === 1 ? '#ffd23f' : gv.state === 3 ? '#6b7280' : gv.state === 4 ? '#46e0ff' : gv.state === 5 ? '#ff8af0' : '#f2e8d0';
      if (gv.state !== 3 && gv.state !== 4) {
        g.fillStyle = gv.state === 2 ? 'rgba(255,48,72,0.12)' : 'rgba(242,232,208,0.07)';
        g.beginPath(); g.moveTo(X(gv.x), Y(gv.z));
        for (let a = -0.82; a <= 0.83; a += 0.2) { const yy = gv.yaw + a; g.lineTo(X(gv.x - Math.sin(yy) * gv.def.range), Y(gv.z - Math.cos(yy) * gv.def.range)); }
        g.closePath(); g.fill();
      }
      g.save(); g.translate(X(gv.x), Y(gv.z)); g.rotate(-gv.yaw);
      g.fillStyle = col; g.beginPath(); g.moveTo(0, -0.9 * sc); g.lineTo(0.6 * sc, 0.6 * sc); g.lineTo(-0.6 * sc, 0.6 * sc); g.closePath(); g.fill();
      g.restore();
      if (gv.tagged) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(X(gv.x), Y(gv.z), 1.1 * sc, 0, Math.PI * 2); g.stroke(); }
      if (big) { g.font = '600 12px Barlow Condensed, sans-serif'; g.fillStyle = col; g.textAlign = 'left'; g.fillText(gv.def.name.split(' ')[0] + (gv.def.kind === 'manager' ? ' (Mgr)' : ''), X(gv.x) + sc, Y(gv.z) - sc); }
    }
    // Prize
    if (s) {
      const [holder, px, , pz] = s.prize;
      if (!holder) { g.fillStyle = '#46e0ff'; g.beginPath(); g.moveTo(X(px), Y(pz) - 7); g.lineTo(X(px) + 6, Y(pz)); g.lineTo(X(px), Y(pz) + 7); g.lineTo(X(px) - 6, Y(pz)); g.fill(); }
      // Players
      for (const p of s.players) {
        const role = ctx.roleOf(p[0]);
        if (role === 'overwatch') continue;
        const col = ROLES[role]?.color || '#fff';
        const susp = p[11];
        g.strokeStyle = susp > 70 ? '#ff3048' : susp > 35 ? '#ffd23f' : 'rgba(255,255,255,0.3)';
        g.lineWidth = 3;
        g.beginPath(); g.arc(X(p[1]), Y(p[3]), 0.9 * sc, -Math.PI / 2, -Math.PI / 2 + (susp / 100) * Math.PI * 2); g.stroke();
        if (p[17] === 1 && !p[8]) {
          const pulse = (now / 600) % 1;
          g.strokeStyle = `rgba(255,48,72,${1 - pulse})`; g.lineWidth = 2;
          g.beginPath(); g.arc(X(p[1]), Y(p[3]), (1.2 + pulse * 2.2) * sc, 0, Math.PI * 2); g.stroke();
          if (big) { g.font = '700 13px Barlow Condensed, sans-serif'; g.fillStyle = '#ff3048'; g.textAlign = 'left'; g.fillText(`MADE (losing them ${Math.round((p[18] || 0) * 100)}%)`, X(p[1]) + sc, Y(p[3]) - sc * 1.2); }
        }
        g.fillStyle = p[8] ? '#666' : col;
        g.beginPath(); g.arc(X(p[1]), Y(p[3]), 0.55 * sc, 0, Math.PI * 2); g.fill();
        if (holder === p[0]) { g.fillStyle = '#46e0ff'; g.fillRect(X(p[1]) - 3, Y(p[3]) - 3, 6, 6); }
        if (big) { g.font = '700 13px Barlow Condensed, sans-serif'; g.fillStyle = col; g.textAlign = 'left'; g.fillText(ctx.nameOf(p[0]), X(p[1]) + sc, Y(p[3]) + sc * 1.8); }
      }
    }
    // Pings
    for (const pg of ctx.pings) {
      const age = (now - pg.t) / 1000;
      g.strokeStyle = `rgba(70,224,255,${1 - age / 10})`; g.lineWidth = 2;
      g.beginPath(); g.arc(X(pg.x), Y(pg.z), sc * (1 + (age * 2) % 2), 0, Math.PI * 2); g.stroke();
    }
  }

  drawSuspBoard() {
    const g = this.sbCanvas.getContext('2d'), s = this.ctx.snap, w = 512, h = 384;
    g.fillStyle = '#0a0d12'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#46e0ff'; g.font = '700 30px Barlow Condensed, sans-serif'; g.textAlign = 'left';
    g.fillText('Suspicion', 20, 42);
    if (!s) return;
    let y = 80;
    for (const p of s.players) {
      const role = this.ctx.roleOf(p[0]);
      if (role === 'overwatch') continue;
      const col = ROLES[role]?.color || '#fff';
      g.fillStyle = col; g.font = '700 26px Barlow Condensed, sans-serif';
      g.fillText(`${this.ctx.nameOf(p[0])} (${ROLES[role]?.name})`, 20, y);
      g.fillStyle = '#1c232c'; g.fillRect(20, y + 10, 470, 26);
      const v = p[11];
      g.fillStyle = v > 70 ? '#ff3048' : v > 35 ? '#ffd23f' : '#4dffa6';
      g.fillRect(20, y + 10, 470 * v / 100, 26);
      if (p[8]) { g.fillStyle = '#ff3048'; g.fillText('DOWN', 420, y); }
      else if (p[17] === 1) { g.fillStyle = '#ff3048'; g.fillText('MADE', 420, y); }
      else if (p[17] === 2) { g.fillStyle = '#ffb347'; g.fillText('described', 390, y); }
      else if (p[13]) { g.fillStyle = '#46e0ff'; g.fillText('blending', 400, y); }
      y += 88;
    }
    this.sbTex.needsUpdate = true;
  }

  renderRoster() {
    const body = $('owRosterBody');
    if (!body) return;
    const ctx = this.ctx;
    body.innerHTML = '';
    for (const gv of ctx.world.guardViews) {
      if (!gv) continue;
      const d = gv.def;
      const row = document.createElement('div');
      row.className = 'roster-row' + (gv.tagged ? ' tagged' : '');
      row.innerHTML = `<div class="r-name">${d.name}<span>${d.title || (d.kind === 'manager' ? 'Floor Manager' : 'Security')}${d.keycard ? ' · carries the keycard' : ''}</span></div>
        <div class="r-dossier">${traitDossier(d.trait)}${d.immuneCon ? ' <b>Cannot be conned.</b>' : ''}</div>
        <div class="r-state">${GSTATE_NAMES[gv.state] || ''}${gv.tagged ? ' · tagged' : ''}</div>`;
      body.append(row);
    }
  }

  renderSuspHtml(dt) {
    const s = this.ctx.snap;
    if (!s) return;
    const el = $('owSusp');
    let html = '';
    let idx = 0;
    for (const p of s.players) {
      const role = this.ctx.roleOf(p[0]);
      if (role === 'overwatch') continue;
      const v = p[11];
      const col = ROLES[role]?.color;
      html += `<div class="susp-row"><span style="color:${col}">${this.ctx.nameOf(p[0])}</span><div class="susp-bar"><i style="width:${v}%;background:${v > 70 ? '#ff3048' : v > 35 ? '#ffd23f' : '#4dffa6'}"></i></div><em>${p[8] ? 'down' : p[17] === 1 ? `MADE ${Math.round((p[18] || 0) * 100)}%` : p[10] ? 'in vent' : Math.round(v)}</em></div>`;
      // Audio cue: beep rate rises with suspicion
      if (v > 25 && !p[8]) {
        this.cueT[p[0]] = (this.cueT[p[0]] || 0) - dt;
        if (this.cueT[p[0]] <= 0) {
          this.cueT[p[0]] = Math.max(0.12, 1.4 - v / 80);
          sound.suspCue(v, [-0.6, 0, 0.6][idx % 3]);
        }
      }
      idx++;
    }
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    $('owIntelVal').textContent = s.intel;
    $('owStrikesVal').textContent = s.strikesLeft;
    const cd = s.owCd || [0, 0];
    for (const [id, c] of [['owSealVal', cd[0]], ['owCutVal', cd[1]]]) {
      const el = $(id); const t = c > 0 ? `${c}s` : 'ready';
      if (el.textContent !== t) { el.textContent = t; el.classList.toggle('cd', c > 0); }
    }
    if (this.overlay === 'map' && (this._cdKey !== cd.join())) { this._cdKey = cd.join(); this.updateStrikeButtons(); }
  }

  // ---------- Lockdown override console ----------
  renderConsole(ev) {
    const body = $('owConsoleBody');
    if (!body) return;
    const s = this.ctx.snap, L = this.ctx.level;
    if (ev && ev.type === 'overrideBad') { sound.fail(); this.ctx.toast(`Rejected. The ${ev.color} code was wrong: 12 seconds lost.`); }
    if (ev && ev.type === 'overrideOk') sound.success();
    const pr = s && s.protocol;
    if (!pr) { body.innerHTML = '<p class="fine">Standby. This console only wakes up in a lockdown.</p>'; return; }
    const order = L.breakers.order;
    const idx = ev && ev.type === 'overrideOk' ? ev.idx : pr.idx;
    body.innerHTML = `
      <p>Enter each breaker code in this order, converted by its phase (manual: Lockdown override). Your crew reads the breakers; they are on B2, B1 and the ground floor.</p>
      <ol class="console-order">${order.map((c, i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur' : ''}"><b class="bc ${c.toLowerCase()}">${c}</b> ${i < idx ? 'accepted' : i === idx ? 'waiting for code' : ''}</li>`).join('')}</ol>
      ${idx < 3 ? `<div class="console-entry"><input id="owConsoleInput" maxlength="4" inputmode="numeric" autocomplete="off" placeholder="0000"><button id="owConsoleGo" class="btn primary">Enter ${order[idx]}</button></div>` : '<p class="ok">Shutter released. Get them to the van.</p>'}
      <p class="fine">Breakers flipped: ${['breakerB2', 'breakerB1', 'breakerG'].map((id) => `${id.replace('breaker', '')} ${pr.flipped[id] ? '✓' : '·'}`).join('   ')}</p>`;
    const go = $('owConsoleGo'), inp = $('owConsoleInput');
    if (go && inp) {
      const submit = () => {
        const v = inp.value.replace(/\D/g, '');
        if (v.length !== 4) { this.ctx.toast('Codes are four digits.'); return; }
        this.ctx.send({ type: 'override', code: [...v].map(Number) });
        inp.value = '';
      };
      go.onclick = submit;
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.code === 'Enter') submit(); if (e.code === 'Escape') this.closeOverlay(); };
      if (this.overlay === 'console') setTimeout(() => inp.focus(), 30);
    }
    void breakerEntry;
  }

  // ---------- Frame ----------
  frame(dt) {
    const ctx = this.ctx, W = ctx.world, r = ctx.renderer;
    const s = ctx.snap;
    W.update(dt, ctx.simT(), s, { x: 0, y: -100, z: 0, role: 'overwatch' }, ctx.myId);
    this.computeVisible();
    const t = performance.now() / 1000;

    // Render feeds (2 per frame round-robin) to monitor RTs
    const feedsPerFrame = ctx.settings.quality === 'low' ? 1 : 2;
    for (let k = 0; k < feedsPerFrame; k++) {
      const i = this.feedTick++ % 6;
      const m = this.monitors[i];
      const ci = this.monitorCam[i];
      const cm = W.camMeshes[ci];
      const live = cm.online && !(cm.loop > 0);
      if (live) { W.applyLights(floorOf(W.L, cm.c.x)); r.setRenderTarget(m.rt); r.render(W.scene, cm.camera); }
      m.mat.uniforms.stat.value = live ? 0 : 1;
      m.mat.uniforms.ir.value = W.L.cams[ci].ir || W.L.cams[ci].thermal ? 1 : 0;
    }
    r.setRenderTarget(null);
    // Follow the crew between floors
    if (s) {
      const counts = [0, 0, 0];
      for (const p of s.players) if (ctx.roleOf(p[0]) !== 'overwatch') counts[floorOf(W.L, p[1])]++;
      const f = counts.indexOf(Math.max(...counts));
      if (f !== this.crewFloor) {
        this.crewFloor = f;
        const cams = W.L.cams.map((c, i) => i).filter((i) => (W.L.cams[i].floor || 0) === f);
        [3, 4, 5].forEach((m, k) => { if (!this.manualMon.has(m) && cams[k] != null) this.monitorCam[m] = cams[k]; });
        if (this.overlay === 'map') this.updateFloorTabs();
      }
    }
    for (const m of this.monitors) m.mat.uniforms.time.value = t;
    // Monitor labels (2 Hz)
    if (Math.floor(t * 2) !== this._lblTick) {
      this._lblTick = Math.floor(t * 2);
      this.monitors.forEach((m, i) => {
        const ci = this.monitorCam[i], cm = W.camMeshes[ci];
        const status = cm.loop > 0 ? 'LOOPED' : cm.online ? '● REC' : W.L.cams[ci].deep && !(s && s.deepCams) ? 'SERVER OFFLINE' : 'NO SIGNAL';
        const key = `${i + 1} ${W.L.cams[ci].label} ${status}`;
        if (key !== m.lblKey) {
          m.lblKey = key;
          if (m.lbl.material.map) m.lbl.material.map.dispose();
          m.lbl.material.map = labelTexture(`${i + 1}  ${W.L.cams[ci].label}   ${status}`, { bg: 'rgba(0,0,0,0.55)', fg: cm.loop > 0 ? '#3d8bff' : cm.online ? '#f2e8d0' : '#ff3048', size: 46, w: 640, h: 72 });
          m.lbl.material.needsUpdate = true;
        }
      });
      this.drawSuspBoard();
    }
    // Blueprint table (5 Hz)
    if (Math.floor(t * 5) !== this._bpTick) {
      this._bpTick = Math.floor(t * 5);
      const keep = this.mapFloor; this.mapFloor = null;
      this.drawMap(this.bpCanvas.getContext('2d'), 768, 768, false);
      this.mapFloor = keep;
      this.bpTex.needsUpdate = true;
    }
    // Big map overlay
    if (this.overlay === 'map') {
      const c = this.mapCanvas;
      const rect = c.getBoundingClientRect();
      const w = Math.round(rect.width * devicePixelRatio), h = Math.round(rect.height * devicePixelRatio);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.drawMap(c.getContext('2d'), w, h, true);
    }
    this.renderSuspHtml(dt);
    this.radioLed.material.color.set(ctx.voice.radio ? '#ff3048' : '#3dff8a');

    if (this.zoom >= 0) {
      const ci = this.monitorCam[this.zoom];
      const cm = W.camMeshes[ci];
      const live = cm.online && !(cm.loop > 0);
      if (live) { W.applyLights(floorOf(W.L, cm.c.x)); r.setRenderTarget(this.zoomRT); r.render(W.scene, cm.camera); r.setRenderTarget(null); }
      this.zoomMat.uniforms.stat.value = live ? 0 : 1;
      this.zoomMat.uniforms.ir.value = W.L.cams[ci].ir || W.L.cams[ci].thermal ? 1 : 0;
      this.zoomMat.uniforms.time.value = t;
      r.render(this.zoomScene, this.zoomCam);
      // Guard labels on the zoomed feed
      const lbls = $('owZoomTags');
      let html = '';
      if (live) {
        for (const f of this.feedGuards(ci, cm.camera)) {
          const st = GSTATE_NAMES[f.gv.state];
          html += `<div class="ztag${f.gv.tagged ? ' tagged' : ''}" style="left:${f.sx * 100}%;top:${f.sy * 100}%"><b>${f.gv.def.name}</b><span>${f.gv.tagged ? 'Tagged' : 'Click to tag'} · ${st}</span></div>`;
        }
      }
      if (lbls.dataset.h !== html) { lbls.innerHTML = html; lbls.dataset.h = html; }
      $('owZoomStatus').textContent = cm.loop > 0 ? 'Feed looped by your Hacker' : cm.online ? 'Live' : W.L.cams[ci].deep && !(s && s.deepCams) ? 'Offline until the camera server in Security is synced' : 'No signal';
      return;
    }

    // Van view
    this.camera.position.set(0, 1.22, 0.75);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    // Hover detection from screen center (pointer locked) or mouse
    const ndc = document.pointerLockElement ? new THREE.Vector2(0, 0) : new THREE.Vector2(this.mouse.nx, this.mouse.ny);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.clickables, false)[0];
    this.hover = hit ? hit.object : null;
    const hint = $('owHover');
    if (this.hover) {
      const ud = this.hover.userData;
      hint.textContent = ud.action === 'monitor' ? `Click: zoom monitor ${ud.idx + 1}` : ud.action === 'map' ? 'Click: tactical map (M)' : ud.action === 'manual' ? 'Click: manuals (B)' : ud.action === 'roster' ? 'Click: guard roster (G)' : 'Radio: hold V to talk';
      hint.classList.add('show');
    } else hint.classList.remove('show');
    this.composer.render();
  }
}
