// Field-role gameplay: first-person movement, weapons, interactions, abilities, lasers and HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PlayerController } from './player.js';
import { WeaponView, Tracers } from './weapons.js';
import { beamState } from './world.js';
import { sound } from './audio.js';
import { ROLES, WEAPONS } from '../shared/data.js';
import { rayBox } from '../shared/geom.js';
import { FLAGS } from '../shared/sim.js';

const $ = (id) => document.getElementById(id);

export class FieldMode {
  constructor(ctx, role) {
    this.ctx = ctx;
    this.role = role;
    const L = ctx.level;
    const idx = Math.max(0, ctx.roster.findIndex((p) => p.id === ctx.myId));
    const sp = L.spawn[idx % L.spawn.length];
    this.pc = new PlayerController(sp);
    this.pc.sens = ctx.settings.sens;
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 600);
    this.vmCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
    this.weapon = ROLES[role].weapon ? new WeaponView(ROLES[role].weapon, ROLES[role].color) : null;
    if (this.weapon) this.weapon.setLethal(true);
    this.tracers = new Tracers(ctx.world.scene);
    this.input = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false, jumpPressed: false };
    this.aiming = false; this.firing = false; this.ePressed = false; this.eHeld = false;
    this.holdT = 0; this.holdTarget = null;
    this.silentT = 0;
    this.sendT = 0;
    this.stepT = 0;
    this.laserCd = 0;
    this.ventT = 0;
    this.hitFlash = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.me = null;
    this.setupComposer();
  }

  setupComposer() {
    const r = this.ctx.renderer;
    this.composer = new EffectComposer(r);
    const rp = new RenderPass(this.ctx.world.scene, this.camera);
    this.composer.addPass(rp);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.45, 0.82);
    this.bloom.enabled = this.ctx.settings.quality !== 'low';
    this.composer.addPass(this.bloom);
    if (this.weapon) {
      const vp = new RenderPass(this.weapon.scene, this.vmCamera);
      vp.clear = false; vp.clearDepth = true;
      this.composer.addPass(vp);
    }
    this.composer.addPass(new OutputPass());
  }

  resize() {
    this.camera.aspect = this.vmCamera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    this.composer.setSize(innerWidth, innerHeight);
  }

  enter() {
    $('hud').className = 'show field';
    const R = ROLES[this.role];
    $('roleName').textContent = R.name;
    $('roleName').style.color = R.color;
    $('abilityName').textContent = R.ability;
    $('ammo').style.display = this.weapon ? '' : 'none';
    this.resize();
  }

  exit() { $('hud').className = ''; }

  // ---------- Input ----------
  keydown(e) {
    const k = e.code;
    if (k === 'KeyW') this.input.forward = true;
    if (k === 'KeyS') this.input.back = true;
    if (k === 'KeyA') this.input.left = true;
    if (k === 'KeyD') this.input.right = true;
    if (k === 'ShiftLeft' || k === 'ShiftRight') this.input.sprint = true;
    if (k === 'ControlLeft' || k === 'KeyC') { this.input.crouch = true; e.preventDefault(); }
    if (k === 'Space') { if (!e.repeat) this.input.jumpPressed = true; e.preventDefault(); }
    if (k === 'KeyE' && !e.repeat) { this.ePressed = true; this.eHeld = true; }
    if (k === 'KeyF' && !e.repeat) this.useAbility();
    if (k === 'KeyR' && this.weapon && this.weapon.startReload()) sound.reload();
  }

  keyup(e) {
    const k = e.code;
    if (k === 'KeyW') this.input.forward = false;
    if (k === 'KeyS') this.input.back = false;
    if (k === 'KeyA') this.input.left = false;
    if (k === 'KeyD') this.input.right = false;
    if (k === 'ShiftLeft' || k === 'ShiftRight') this.input.sprint = false;
    if (k === 'ControlLeft' || k === 'KeyC') this.input.crouch = false;
    if (k === 'KeyE') { this.eHeld = false; this.holdT = 0; }
  }

  mousemove(e) {
    if (this.frozen() || !document.pointerLockElement) return;
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    this.pc.look(e.movementX, e.movementY);
    this.lookDX += e.movementX; this.lookDY += e.movementY;
  }

  mousedown(e) {
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.aiming = true;
  }

  mouseup(e) {
    if (e.button === 0) this.firing = false;
    if (e.button === 2) this.aiming = false;
  }

  releaseAll() {
    for (const k in this.input) this.input[k] = false;
    this.firing = this.aiming = this.eHeld = false;
  }

  frozen() { return this.ctx.puzzle.isOpen() || (this.me && (this.me.down || this.me.inVent)) || this.ventT > 0 || this.ctx.over; }

  // ---------- Snapshot helpers ----------
  myState() {
    const s = this.ctx.snap;
    if (!s) return null;
    const p = s.players.find((q) => q[0] === this.ctx.myId);
    if (!p) return null;
    return { hp: p[7], down: !!p[8], keycard: !!p[9], inVent: !!p[10], susp: p[11], cd: p[12], blended: !!p[13], overrideKey: !!p[14], dead: !!p[15], bleed: p[16], made: p[17] === 1, marked: p[17] === 2, lostP: p[18] || 0 };
  }

  // ---------- Abilities ----------
  useAbility() {
    const ctx = this.ctx, L = ctx.level;
    if (this.frozen()) return;
    if (this.me && this.me.cd > 0) { ctx.toast(`${ROLES[this.role].ability} recharging (${Math.ceil(this.me.cd)}s).`); return; }
    const eye = this.pc.eyePos();
    const dir = this.viewDir();
    if (this.role === 'infiltrator') {
      ctx.send({ type: 'silent' });
    } else if (this.role === 'hacker') {
      let best = null, bestA = 0.12;
      L.cams.forEach((c, i) => {
        const v = new THREE.Vector3(c.x - eye.x, c.y - 0.1 - eye.y, c.z - eye.z);
        const d = v.length();
        if (d > 38) return;
        const a = v.normalize().angleTo(dir);
        if (a < bestA && this.losTo(eye, c.x, c.y - 0.2, c.z)) { bestA = a; best = i; }
      });
      if (best == null) { ctx.toast('Aim at a security camera to loop it.'); sound.beep(false); return; }
      ctx.send({ type: 'loop', cam: best });
    } else if (this.role === 'face') {
      const g = this.guardInView(3.4, 0.5, (gv) => gv.state !== 2 && gv.state !== 3);
      if (!g) { ctx.toast('Face a guard or the Floor Manager, up close, to run a Con.'); sound.beep(false); return; }
      ctx.send({ type: 'con', gid: g.def.id });
    }
  }

  viewDir() {
    const cp = Math.cos(this.pc.pitch);
    return new THREE.Vector3(-Math.sin(this.pc.yaw) * cp, Math.sin(this.pc.pitch), -Math.cos(this.pc.yaw) * cp).normalize();
  }

  losTo(eye, x, y, z) {
    const dx = x - eye.x, dz = z - eye.z, d = Math.hypot(dx, dz);
    const boxes = this.ctx.world.colliders(this.ctx.snap ? this.ctx.snap.doors : null).boxes;
    for (const b of boxes) {
      if (b.y2 < 2.2) continue;
      const t = rayBox(eye.x, eye.z, dx / d, dz / d, b, d - 0.3);
      if (t >= 0) return false;
    }
    return true;
  }

  guardInView(range, maxAngle, filter) {
    const eye = this.pc.eyePos();
    const dir = this.viewDir();
    let best = null, bestA = maxAngle;
    for (const gv of this.ctx.world.guardViews) {
      if (!gv || (filter && !filter(gv))) continue;
      const v = new THREE.Vector3(gv.x - eye.x, (gv.state === 3 ? 0.3 : 1.3) - eye.y, gv.z - eye.z);
      const d = v.length();
      if (d > range) continue;
      const a = v.normalize().angleTo(dir);
      if (a < bestA) { bestA = a; best = gv; }
    }
    return best;
  }

  // ---------- Shooting ----------
  shoot() {
    const ctx = this.ctx, w = this.weapon;
    if (!w || !w.canFire()) { if (w && w.ammo <= 0 && w.reloadT <= 0 && w.startReload()) sound.reload(); return; }
    w.fire();
    sound.shot(w.lethal ? 'live-' + w.kind : w.kind);
    const eye = this.pc.eyePos();
    const dir = this.viewDir();
    const spread = w.def.spread * (w.ads > 0.5 ? 0.4 : 1.5);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
    // Walls / props
    let tMax = 80;
    const cols = ctx.world.colliders(ctx.snap ? ctx.snap.doors : null);
    for (const b of cols.boxes) {
      const t = rayBox3(origin, dir, b, tMax);
      if (t >= 0 && t < tMax) tMax = t;
    }
    // Guards as vertical cylinders
    let hit = null;
    for (const gv of ctx.world.guardViews) {
      if (!gv || gv.state === 3) continue;
      const t = rayCylinder(origin, dir, gv.x, gv.z, 0.36, 0, 1.85, tMax);
      if (t >= 0 && t < tMax) { tMax = t; hit = gv; }
    }
    const end = origin.clone().addScaledVector(dir, tMax);
    const muzzle = w.muzzleWorld(this.camera);
    this.tracers.add(muzzle, end, w.lethal ? '#ffd27a' : w.kind === 'tranq' ? '#7dffb0' : '#8fd4ff');
    ctx.send({ type: 'shot', weapon: w.kind, gid: hit ? hit.def.id : null });
    if (hit) { ctx.hitmarker(); }
  }

  // ---------- Interactions ----------
  findTarget() {
    const ctx = this.ctx, L = ctx.level, s = ctx.snap;
    if (!s) return null;
    const eye = this.pc.eyePos();
    const dir = this.viewDir();
    const flat = new THREE.Vector2(dir.x, dir.z).normalize();
    const cands = [];
    const consider = (x, y, z, r, obj) => {
      const dx = x - this.pc.x, dz = z - this.pc.z, d = Math.hypot(dx, dz);
      if (d > r) return;
      const v = new THREE.Vector3(x - eye.x, y - eye.y, z - eye.z).normalize();
      let a = v.angleTo(dir);
      if (d < 0.9) a = Math.min(a, new THREE.Vector2(dx, dz).normalize().angle() - flat.angle());
      a = Math.abs(a);
      if (a > 0.75) return;
      cands.push({ ...obj, score: a + d * 0.15 });
    };
    const pz = s.puzzle;
    const [holder, prx, pry, prz, inVault] = s.prize;
    const prot = s.protocol;
    for (const it of L.interact) {
      switch (it.kind) {
        case 'glyphPad': if (!pz.glyphSolved) consider(it.x, it.y, it.z, it.r, { kind: 'glyphPad', label: 'Use keypad' }); break;
        case 'wirePanel': consider(it.x, it.y, it.z, it.r, { kind: 'wirePanel', label: pz.wireSolved ? 'Check junction panel' : 'Open junction panel' }); break;
        case 'password': if (!pz.passSolved) consider(it.x, it.y, it.z, it.r, { kind: 'password', label: 'Use lift authorization terminal' }); break;
        case 'simon': if (!pz.simonSolved) consider(it.x, it.y, it.z, it.r, { kind: 'simon', label: 'Open camera server' }); break;
        case 'morse': if (!pz.morseSolved) consider(it.x, it.y, it.z, it.r, { kind: 'morse', label: 'Tune the safe receiver' }); break;
        case 'maze': if (!pz.mazeSolved) consider(it.x, it.y, it.z, it.r, { kind: 'maze', label: 'Work the hatch lock' }); break;
        case 'descend': consider(it.x, 0.6, it.z, it.r, { kind: 'descend', id: it.id, label: pz.mazeSolved ? it.label : 'Hatch locked' }); break;
        case 'vaultPad': if (!pz.vaultCode) consider(it.x, it.y, it.z, it.r, { kind: 'vaultPad', label: 'Use vault keypad' }); break;
        case 'key': {
          if (pz.vaultOpen || pz.timelock != null) break;
          const insert = it.console === 'A' && !pz.keyInserted;
          const label = !pz.vaultCode ? `Key console ${it.console} (asleep)` : insert ? (this.me && this.me.overrideKey ? 'Insert the override key' : 'Console A needs the override key') : `Turn key ${it.console} (together!)`;
          consider(it.x, it.y, it.z, it.r, { kind: 'key', console: it.console, label, hold: insert ? 0 : 0.6 });
          break;
        }
        case 'breaker': if (prot) consider(it.x, it.y, it.z, it.r, { kind: 'breaker', id: it.id, label: prot.flipped[it.id] ? 'Read the breaker again' : 'Flip the breaker', hold: prot.flipped[it.id] ? 0 : 2.0 }); break;
        case 'elevator': consider(it.x, it.y, it.z, it.r, { kind: 'elevator', id: it.id, label: prot ? 'Lift locked down' : it.label }); break;
        case 'stairs': consider(it.x, it.y, it.z, it.r, { kind: 'stairs', id: it.id, label: prot ? it.label : `${it.label} (alarmed fire door)`, hold: prot ? 0 : 1.2 }); break;
        case 'vent': consider(it.x, 0.5, it.z, it.r, { kind: 'vent', id: it.id, label: this.role === 'infiltrator' ? 'Crawl into the vent' : 'Only the Infiltrator fits in here' }); break;
        case 'wardrobe': {
          const left = s.wardrobes ? s.wardrobes[it.id] : 0;
          consider(it.x, 1.3, it.z, it.r, { kind: 'outfit', id: it.id, label: left ? `${it.sign.toLowerCase().replace(/^./, (c) => c.toUpperCase())}: change clothes (${left} left)` : 'Nothing left that fits', hold: left ? 2.5 : 0 });
          break;
        }
        case 'cash': if (!s.cash.includes(it.cash)) { const c = L.cash[it.cash]; consider(it.x, c.my != null ? c.my : 1.9, c.mz != null ? c.mz : it.z + 0.6, 2.0, { kind: 'cash', id: it.cash, label: 'Grab cash', hold: 0.6 }); } break;
      }
    }
    if (!holder && (pz.vaultOpen || !inVault)) consider(prx, inVault ? 1.3 : pry, prz, 2.2, { kind: 'prize', label: `Grab ${L.prize.name}`, hold: 1.0 });
    L.doors.forEach((d, i) => {
      if (d.type === 'glyph' || d.type === 'vault') return;
      const open = s.doors[i], locked = s.locks[i];
      let label = open ? 'Close door' : 'Open door';
      if (!open && locked && d.type === 'keycard') label = this.me && this.me.keycard ? 'Swipe keycard' : 'Keycard required';
      consider(d.x, 1.3, d.z, 2.4, { kind: 'door', id: i, label });
    });
    for (const gv of ctx.world.guardViews) {
      if (!gv) continue;
      const down = gv.state === 3;
      if (down) {
        if (gv.keycard) consider(gv.x, 0.4, gv.z, 2.1, { kind: 'loot', gid: gv.def.id, label: 'Lift the keycard' });
        else if (gv.dead && !gv.hidden) consider(gv.x, 0.4, gv.z, 2.1, { kind: 'hide', gid: gv.def.id, label: 'Stash the body', hold: 2.2 });
      } else if (gv.state !== 2) {
        const behind = Math.abs(angleDiff(gv.yaw, Math.atan2(-(this.pc.x - gv.x), -(this.pc.z - gv.z)))) > 1.7;
        if (behind || gv.state === 4) consider(gv.x, 1.3, gv.z, 2.0, { kind: 'takedown', gid: gv.def.id, label: 'Silent takedown' });
      }
    }
    for (const p of s.players) {
      if (p[0] === ctx.myId || !p[8] || p[15]) continue;
      consider(p[1], 0.5, p[3], 2.3, { kind: 'revive', pid: p[0], label: p[16] ? `Patch up ${ctx.nameOf(p[0])} (${p[16]}s)` : `Revive ${ctx.nameOf(p[0])}`, hold: p[16] ? 4.5 : 3.5 });
    }
    cands.sort((a, b) => a.score - b.score);
    return cands[0] || null;
  }

  activate(t) {
    const ctx = this.ctx, s = ctx.snap;
    switch (t.kind) {
      case 'glyphPad': ctx.openPanel(() => ctx.puzzle.openGlyph(ctx.level, s.puzzle.glyphStep)); break;
      case 'wirePanel': ctx.openPanel(() => ctx.puzzle.openWires(s.puzzle)); break;
      case 'vaultPad': ctx.openPanel(() => ctx.puzzle.openVault(s.puzzle)); break;
      case 'password': ctx.openPanel(() => ctx.puzzle.openPassword(ctx.level)); break;
      case 'simon': ctx.openPanel(() => ctx.puzzle.openSimon(ctx.level, s.puzzle)); break;
      case 'morse': ctx.openPanel(() => ctx.puzzle.openMorse(ctx.level)); break;
      case 'maze': ctx.openPanel(() => ctx.puzzle.openMaze(ctx.level, s.puzzle)); break;
      case 'descend': ctx.send({ type: 'hatch', id: t.id }); break;
      case 'key': ctx.send({ type: 'key', console: t.console }); sound.key(); break;
      case 'breaker': ctx.send({ type: 'breaker', id: t.id }); sound.thud(); break;
      case 'elevator': ctx.send({ type: 'ride', id: t.id }); break;
      case 'stairs': ctx.send({ type: 'stairs', id: t.id }); break;
      case 'vent':
        if (this.role !== 'infiltrator') { ctx.toast("Too tight. Only the Infiltrator fits in the vents."); return; }
        ctx.send({ type: 'vent', id: t.id }); break;
      case 'cash': ctx.send({ type: 'take', what: 'cash', id: t.id }); break;
      case 'prize': ctx.send({ type: 'take', what: 'prize' }); break;
      case 'door': ctx.send({ type: 'door', id: t.id }); break;
      case 'loot': ctx.send({ type: 'loot', gid: t.gid }); break;
      case 'hide': ctx.send({ type: 'hide', gid: t.gid }); break;
      case 'outfit': if (t.hold) ctx.send({ type: 'outfit', id: t.id }); break;
      case 'takedown': ctx.send({ type: 'takedown', gid: t.gid }); sound.thud(); break;
      case 'revive': ctx.send({ type: 'revive', pid: t.pid }); break;
    }
  }

  // ---------- Events ----------
  onEvent(ev) {
    const ctx = this.ctx;
    switch (ev.type) {
      case 'teleport':
        this.pc.teleport(ev.x, ev.y, ev.z, ev.yaw);
        this.ventT = Math.max(this.ventT, 0.2);
        this.sendT = 0;
        break;
      case 'ride':
        this.ventT = 1.1;
        $('rideOverlay').textContent = ev.stairs ? 'Taking the stairs' : ev.down ? 'Going down' : 'Going up';
        $('rideOverlay').classList.remove('show'); void $('rideOverlay').offsetWidth; $('rideOverlay').classList.add('show');
        sound.elevator(!!ev.stairs);
        break;
      case 'vent':
        if (ev.pid === ctx.myId) { this.ventT = 2.4; sound.vent(); $('ventOverlay').classList.add('show'); }
        break;
      case 'ability':
        if (ev.pid === ctx.myId) {
          if (ev.kind === 'silent') { this.silentT = ev.dur; sound.radioClick(true); ctx.toast('Silent Sprint: 6 seconds.'); }
          if (ev.kind === 'loop') { sound.success(); ctx.toast(ev.text); }
        }
        break;
      case 'taser': {
        const gv = ctx.world.guardViews[ev.gid];
        if (gv) {
          const from = new THREE.Vector3(gv.x - Math.sin(gv.yaw) * 0.4, 1.35, gv.z - Math.cos(gv.yaw) * 0.4);
          const tp = ctx.snap && ctx.snap.players.find((q) => q[0] === ev.pid);
          const to = ev.pid === ctx.myId ? new THREE.Vector3(this.pc.x + (ev.hit ? 0 : (Math.random() - 0.5) * 2), this.pc.y + 1.3, this.pc.z) : tp ? new THREE.Vector3(tp[1], tp[2] + 1.2, tp[3]) : null;
          if (to) this.tracers.add(from, to, '#ffd27a');
          gv.flashT = 0.06;
          const d = Math.hypot(gv.x - this.pc.x, gv.z - this.pc.z);
          if (ev.pid !== ctx.myId && d < 40) sound.shot('guard');
        }
        if (ev.pid === ctx.myId) {
          sound.shot('guard');
          if (ev.hit) { this.hitFlash = 1; this.bloodFlash = 1; sound.hurt(); }
        }
        break;
      }
    }
  }

  // ---------- Frame ----------
  frame(dt) {
    const ctx = this.ctx, L = ctx.level, s = ctx.snap;
    this.me = this.myState();
    const frozen = this.frozen();
    if (this.ventT > 0) { this.ventT -= dt; if (this.ventT <= 0) $('ventOverlay').classList.remove('show'); }
    this.silentT -= dt;
    const carrying = s && s.prize[0] === ctx.myId;
    const cols = ctx.world.colliders(s ? s.doors : null);
    this.pc.sens = ctx.settings.sens;
    const res = this.pc.update(dt, this.input, {
      colliders: cols, frozen,
      silent: this.silentT > 0,
      speedMul: (carrying ? 0.86 : 1) * (this.aiming ? 0.7 : 1),
      onSlide: () => sound.slide(), onJump: () => sound.jump(), onLand: (k) => sound.land(k),
    });
    // Footsteps
    if (this.pc.grounded && res.speed > 0.6 && this.pc.slideT <= 0) {
      this.stepT -= dt * res.speed * 0.55;
      if (this.stepT <= 0) { this.stepT = 1; sound.step(this.pc.crouch || this.silentT > 0); }
    }

    // Camera
    const eye = this.pc.eyePos();
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(this.pc.pitch, this.pc.yaw, this.pc.roll, 'YXZ');
    const ads = this.weapon ? this.weapon.ads : 0;
    this.camera.fov = 78 + this.pc.fovKick - ads * 14;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    if (this.weapon) {
      const canAim = !frozen;
      this.weapon.update(dt, this.aiming && canAim, this.pc.bob, this.pc.moving, this.lookDX, this.lookDY);
      if (this.firing && canAim && document.pointerLockElement) {
        if (this.weapon.kind === 'smg' || !this._firedThisPress) { this.shoot(); this._firedThisPress = true; }
      }
      if (!this.firing) this._firedThisPress = false;
      $('ammoCount').textContent = this.weapon.reloadT > 0 ? 'Reloading' : `${this.weapon.ammo} / ${this.weapon.def.mag}`;
      $('ammoName').textContent = this.weapon.def.name || WEAPONS[this.weapon.kind].name;
    }
    this.lookDX = 0; this.lookDY = 0;
    this.tracers.update(dt);

    // Interactions
    const target = frozen ? null : this.findTarget();
    const prompt = $('prompt');
    if (target) {
      prompt.classList.add('show');
      $('promptText').textContent = target.label;
      $('promptKey').textContent = target.hold ? 'Hold E' : 'E';
      if (target.hold) {
        const same = this.holdTarget && this.holdTarget.kind === target.kind && (this.holdTarget.gid ?? this.holdTarget.pid ?? this.holdTarget.id) === (target.gid ?? target.pid ?? target.id);
        if (!same) this.holdT = 0;
        this.holdTarget = target;
        if (this.eHeld) {
          this.holdT += dt;
          if (this.holdT >= target.hold) { this.activate(target); this.holdT = -999; }
        }
        $('promptRing').style.setProperty('--p', Math.max(0, this.holdT / target.hold));
      } else {
        $('promptRing').style.setProperty('--p', 0);
        if (this.ePressed) this.activate(target);
      }
    } else {
      prompt.classList.remove('show');
      this.holdT = 0;
    }
    this.ePressed = false;

    // Lasers
    this.laserCd -= dt;
    if (!frozen && this.laserCd <= 0) {
      const feet = this.pc.y, top = this.pc.y + this.pc.height;
      for (let gi = 0; gi < L.lasers.length; gi++) {
        const g = L.lasers[gi];
        if (Math.abs(this.pc.z - g.z) > 0.3 || this.pc.x < g.x1 - 0.3 || this.pc.x > g.x2 + 0.3) continue;
        for (const b of g.beams) {
          for (const st of beamState(b, ctx.simT(), !!(ctx.snap && ctx.snap.protocol))) {
            const hitV = st.vertical && Math.abs(this.pc.x - (g.cx + st.dx)) < 0.36;
            if (st.on && (hitV || (!st.vertical && st.y > feet + 0.02 && st.y < top))) {
              ctx.send({ type: 'laser', gate: gi });
              this.laserCd = 1.5;
              this.hitFlash = 0.6;
              sound.alarm();
            }
          }
        }
      }
    }

    // Send state (20 Hz)
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.05;
      let f = 0;
      if (this.pc.sprinting) f |= FLAGS.SPRINT;
      if (this.pc.crouch) f |= FLAGS.CROUCH;
      if (this.weapon && this.weapon.weaponOut()) f |= FLAGS.WEAPON;
      if (ctx.puzzle.isOpen()) f |= FLAGS.INTERACT;
      if (this.silentT > 0) f |= FLAGS.SILENT;
      if (this.pc.moving) f |= FLAGS.MOVING;
      f |= ctx.voice.flags();
      ctx.send({ type: 'state', x: r2(this.pc.x), y: r2(this.pc.y), z: r2(this.pc.z), yaw: r2(this.pc.yaw), pitch: r2(this.pc.pitch), f });
    }

    // World update + render
    ctx.world.update(dt, ctx.simT(), s, { x: this.pc.x, y: this.pc.y, z: this.pc.z, role: this.role }, ctx.myId);
    this.updateHud(dt);
    this.composer.render();
  }

  updateHud(dt) {
    const ctx = this.ctx, s = ctx.snap, me = this.me;
    if (!s || !me) return;
    // HP pips
    const hp = $('hp');
    if (hp.dataset.v !== String(me.hp)) { hp.dataset.v = me.hp; hp.innerHTML = [0, 1, 2].map((i) => `<i class="${i < me.hp ? 'on' : ''}"></i>`).join(''); }
    // Ability cooldown
    const cdEl = $('abilityCd');
    const silent = this.silentT > 0;
    cdEl.textContent = silent ? `Active ${Math.ceil(this.silentT)}s` : me.cd > 0 ? `${Math.ceil(me.cd)}s` : 'Ready (F)';
    cdEl.className = me.cd > 0 && !silent ? 'cd' : 'ready';
    // Items
    $('itemKeycard').classList.toggle('show', me.keycard);
    $('itemOverride').classList.toggle('show', me.overrideKey);
    $('itemPrize').classList.toggle('show', s.prize[0] === ctx.myId);
    $('blendInd').classList.toggle('show', me.blended);
    // Down overlay
    $('downOverlay').classList.toggle('show', me.down);
    $('downOverlay').classList.toggle('dead', me.dead);
    const dt2 = $('downTitle'), dp = $('downText');
    if (me.dead) { dt2.textContent = "You're out"; dp.textContent = 'You bled out. Stay on the radio and help your crew finish the job.'; }
    else if (me.bleed > 0) { dt2.textContent = `Bleeding out: ${me.bleed}s`; dp.textContent = 'A teammate has to reach you and hold E. You can still talk on the radio.'; }
    else { dt2.textContent = "You're down"; dp.textContent = 'A teammate has to reach you and hold E. You can still talk on the radio.'; }
    // Made / marked
    const mb = $('madeBanner');
    const showMade = !me.down && (me.made || me.marked);
    mb.classList.toggle('show', showMade);
    mb.classList.toggle('made', me.made);
    if (showMade) {
      const html = me.made
        ? `<b>You've been made</b><span>Break line of sight with every guard and camera. Lockers change your look. Overwatch can seal a door or cut the lights.</span><i style="--p:${me.lostP}"></i>`
        : `<b>They have your description</b><span>Guards and cameras clock you faster. Change clothes at a locker to lose it.</span>`;
      if (mb.dataset.h !== html) { mb.innerHTML = html; mb.dataset.h = html; }
    }
    if (me.made && !this._wasMade) this.bloodFlash = Math.max(this.bloodFlash || 0, 0.35);
    this._wasMade = me.made;
    this.bloodFlash = Math.max(0, (this.bloodFlash || 0) - dt * 1.2);
    $('bloodFlash').style.opacity = this.bloodFlash;
    // Hit flash
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.8);
    $('hitFlash').style.opacity = this.hitFlash;
    $('crosshair').classList.toggle('ads', !!(this.weapon && this.weapon.ads > 0.5));
  }
}

function r2(v) { return Math.round(v * 100) / 100; }
function angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

// 3D ray vs AABB with y extents
function rayBox3(o, d, b, max) {
  let tmin = 0, tmax = max;
  const ax = [['x', b.x1, b.x2], ['y', b.y1 ?? 0, b.y2], ['z', b.z1, b.z2]];
  for (const [k, lo, hi] of ax) {
    const oo = o[k], dd = d[k];
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return -1; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

function rayCylinder(o, d, cx, cz, r, y1, y2, max) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > max) return -1;
  const y = o.y + d.y * t;
  return y >= y1 && y <= y2 ? t : -1;
}
