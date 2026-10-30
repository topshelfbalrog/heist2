// Geometry helpers shared by the simulation and the client.
// Convention: yaw 0 faces -z. forward(yaw) = (-sin yaw, -cos yaw).

export const fwdX = (yaw) => -Math.sin(yaw);
export const fwdZ = (yaw) => -Math.cos(yaw);
export const yawTo = (ax, az, bx, bz) => Math.atan2(-(bx - ax), -(bz - az));
export const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function inRect(x, z, r) {
  return x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
}

// 2D segment vs axis-aligned box (slab test).
export function segHitsBox(ax, az, bx, bz, b) {
  let tmin = 0, tmax = 1;
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < b.x1 || ax > b.x2) return false; }
  else {
    let t1 = (b.x1 - ax) / dx, t2 = (b.x2 - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < b.z1 || az > b.z2) return false; }
  else {
    let t1 = (b.z1 - az) / dz, t2 = (b.z2 - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Ray (origin + dir * t, t in [0, max]) vs box; returns t or -1.
export function rayBox(ox, oz, dx, dz, b, max) {
  let tmin = 0, tmax = max;
  if (Math.abs(dx) < 1e-9) { if (ox < b.x1 || ox > b.x2) return -1; }
  else {
    let t1 = (b.x1 - ox) / dx, t2 = (b.x2 - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.z1 || oz > b.z2) return -1; }
  else {
    let t1 = (b.z1 - oz) / dz, t2 = (b.z2 - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function doorBox(d) {
  const t = 0.18;
  return d.axis === 'x'
    ? { x1: d.x - d.w / 2, x2: d.x + d.w / 2, z1: d.z - t, z2: d.z + t, y1: 0, y2: d.h || 3 }
    : { x1: d.x - t, x2: d.x + t, z1: d.z - d.w / 2, z2: d.z + d.w / 2, y1: 0, y2: d.h || 3 };
}

// Line of sight against walls and closed doors.
export function hasLOS(level, doorsOpen, ax, az, bx, bz) {
  for (const w of level.walls) if (segHitsBox(ax, az, bx, bz, w)) return false;
  for (let i = 0; i < level.doors.length; i++) {
    if (!doorsOpen[i] && segHitsBox(ax, az, bx, bz, doorBox(level.doors[i]))) return false;
  }
  return true;
}

// Push a circle out of solid boxes/circles. Supports landing on top of low solids.
// p: {x, y, z, vy, grounded}. Returns p (mutated).
export function collideBody(p, radius, height, boxes, circles, prevY) {
  const top = p.y + height;
  for (const b of boxes) {
    if (top <= b.y1 + 0.01 || p.y >= b.y2 - 0.001) continue;
    const cx = Math.max(b.x1, Math.min(p.x, b.x2));
    const cz = Math.max(b.z1, Math.min(p.z, b.z2));
    let dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    // Land on top if we were above it last frame (or it's a small step).
    if (b.y2 - p.y <= 0.36 || prevY >= b.y2 - 0.06) {
      if (b.y2 < 2.2) { p.y = b.y2; if (p.vy < 0) p.vy = 0; p.grounded = true; continue; }
    }
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2), push = radius - d;
      p.x += (dx / d) * push; p.z += (dz / d) * push;
    } else {
      // Center inside box: push out along shortest axis.
      const l = p.x - b.x1, r = b.x2 - p.x, n = p.z - b.z1, s = b.z2 - p.z;
      const m = Math.min(l, r, n, s);
      if (m === l) p.x = b.x1 - radius; else if (m === r) p.x = b.x2 + radius;
      else if (m === n) p.z = b.z1 - radius; else p.z = b.z2 + radius;
    }
  }
  for (const c of circles) {
    if (top <= 0.01 || p.y >= c.y2 - 0.001) continue;
    const dx = p.x - c.x, dz = p.z - c.z, rr = radius + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    if (c.y2 - p.y <= 0.36 || prevY >= c.y2 - 0.06) {
      if (c.y2 < 2.2 && d2 < c.r * c.r) { p.y = c.y2; if (p.vy < 0) p.vy = 0; p.grounded = true; continue; }
    }
    const d = Math.sqrt(d2) || 1e-4, push = rr - d;
    p.x += (dx / d) * push; p.z += (dz / d) * push;
  }
  return p;
}

// Highest solid surface under a point (for ground detection).
export function groundAt(x, z, y, radius, boxes, circles) {
  let g = 0;
  for (const b of boxes) {
    if (b.y2 > y + 0.05 || b.y2 > 2.2) continue;
    if (x + radius * 0.6 < b.x1 || x - radius * 0.6 > b.x2 || z + radius * 0.6 < b.z1 || z - radius * 0.6 > b.z2) continue;
    if (b.y2 > g) g = b.y2;
  }
  for (const c of circles) {
    if (c.y2 > y + 0.05 || c.y2 > 2.2) continue;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz > c.r * c.r) continue;
    if (c.y2 > g) g = c.y2;
  }
  return g;
}
