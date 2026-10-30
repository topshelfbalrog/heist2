// First-person movement: sprint, slide, crouch, jump with coyote time, landing dips and head bob.
import { collideBody, groundAt } from '../shared/geom.js';

const RADIUS = 0.32;
const STAND = 1.75, CROUCH = 1.05;
const EYE_STAND = 1.62, EYE_CROUCH = 0.95;
const GRAV = 18;

export class PlayerController {
  constructor(spawn) {
    this.x = spawn.x; this.y = 0; this.z = spawn.z;
    this.yaw = spawn.yaw; this.pitch = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.grounded = true;
    this.coyote = 0; this.jumpBuf = 0;
    this.crouch = false; this.height = STAND; this.eye = EYE_STAND;
    this.slideT = 0; this.slideDir = [0, 0];
    this.bob = 0; this.land = 0; this.roll = 0; this.fovKick = 0;
    this.sprinting = false; this.moving = false;
    this.keys = {};
    this.sens = 0.0022;
    this.lastLand = 0;
  }

  look(dx, dy) {
    this.yaw -= dx * this.sens;
    this.pitch -= dy * this.sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  // opts: {speedMul, silent, frozen, colliders}
  update(dt, input, opts) {
    const k = input;
    const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0);
    const str = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const frozen = opts.frozen;
    const wantCrouch = !frozen && k.crouch;
    const wantSprint = !frozen && k.sprint && fwd > 0 && !this.crouch;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos); right = (cos, -sin)
    let wx = (-sin * fwd + cos * str), wz = (-cos * fwd - sin * str);
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    if (frozen) { wx = 0; wz = 0; }

    // Slide: crouch while sprinting
    if (wantCrouch && !this.crouch && this.sprinting && this.grounded && this.slideT <= 0) {
      this.slideT = 0.75;
      const sp = Math.max(8.2, Math.hypot(this.vx, this.vz) + 1.8);
      this.slideDir = [wx || -sin, wz || -cos];
      this.vx = this.slideDir[0] * sp; this.vz = this.slideDir[1] * sp;
      this.fovKick = 10;
      if (opts.onSlide) opts.onSlide();
    }
    this.crouch = wantCrouch;

    let speed = 3.6;
    if (wantSprint) speed = opts.silent ? 7.2 : 6.3;
    if (this.crouch) speed = 1.9;
    speed *= opts.speedMul || 1;
    this.sprinting = wantSprint && wl > 0;

    const accel = this.grounded ? (this.slideT > 0 ? 2.5 : 48) : 9;
    if (this.slideT > 0) {
      this.slideT -= dt;
      const f = Math.exp(-dt * 1.6);
      this.vx *= f; this.vz *= f;
      // allow a little steering
      this.vx += wx * 6 * dt; this.vz += wz * 6 * dt;
    } else {
      const tvx = wx * speed, tvz = wz * speed;
      const ax = tvx - this.vx, az = tvz - this.vz;
      const al = Math.hypot(ax, az);
      const step = accel * dt;
      if (al <= step) { this.vx = tvx; this.vz = tvz; }
      else { this.vx += (ax / al) * step; this.vz += (az / al) * step; }
    }

    // Jump (buffer + coyote time)
    if (k.jumpPressed) { this.jumpBuf = 0.14; k.jumpPressed = false; }
    this.jumpBuf -= dt;
    this.coyote = this.grounded ? 0.11 : this.coyote - dt;
    if (!frozen && this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = this.crouch ? 4.6 : 6.1;
      this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
      if (this.slideT > 0) { this.slideT = 0; this.vx *= 1.08; this.vz *= 1.08; }
      if (opts.onJump) opts.onJump();
    }

    // Integrate
    const prevY = this.y;
    this.vy -= GRAV * dt;
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    const { boxes, circles } = opts.colliders;
    const body = { x: this.x, y: this.y, z: this.z, vy: this.vy, grounded: false };
    const h = this.crouch ? CROUCH : STAND;
    for (let i = 0; i < 2; i++) collideBody(body, RADIUS, h, boxes, circles, prevY);
    const g = groundAt(body.x, body.z, Math.max(body.y, prevY), RADIUS, boxes, circles);
    let landed = false;
    if (body.y <= g) {
      if (!this.grounded && this.vy < -3) { this.land = Math.min(0.18, -this.vy * 0.018); landed = true; }
      body.y = g; if (body.vy < 0) body.vy = 0; body.grounded = true;
    }
    if (body.grounded && !this.grounded && this.vy < -3 && !landed) { this.land = Math.min(0.18, -this.vy * 0.018); landed = true; }
    this.x = body.x; this.y = body.y; this.z = body.z; this.vy = body.vy; this.grounded = body.grounded;
    if (landed && opts.onLand) opts.onLand(this.land);

    // Eye height, bob, roll, FOV kick
    this.height += ((this.crouch ? CROUCH : STAND) - this.height) * Math.min(1, dt * 12);
    const eyeT = this.slideT > 0 ? 0.75 : (this.crouch ? EYE_CROUCH : EYE_STAND);
    this.eye += (eyeT - this.eye) * Math.min(1, dt * 14);
    const hs = Math.hypot(this.vx, this.vz);
    this.moving = hs > 0.4;
    if (this.grounded && hs > 0.4 && this.slideT <= 0) this.bob += dt * hs * 2.1;
    this.land *= Math.exp(-dt * 9);
    this.roll += ((-str * 0.022 * Math.min(1, hs / 4)) - this.roll) * Math.min(1, dt * 8);
    const fk = this.sprinting ? 7 : 0;
    this.fovKick += (Math.max(fk, this.slideT > 0 ? 10 : 0) - this.fovKick) * Math.min(1, dt * 5);
    return { speed: hs };
  }

  eyePos() {
    const bobY = this.grounded ? Math.abs(Math.sin(this.bob)) * 0.045 * Math.min(1, Math.hypot(this.vx, this.vz) / 4) : 0;
    const bobX = this.grounded ? Math.sin(this.bob) * 0.025 * Math.min(1, Math.hypot(this.vx, this.vz) / 4) : 0;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: this.x + c * bobX, y: this.y + this.eye - this.land + bobY, z: this.z - s * bobX };
  }

  teleport(x, y, z, yaw) {
    this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0;
    if (yaw != null) this.yaw = yaw;
  }
}

export { RADIUS, STAND, CROUCH };
