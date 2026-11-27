// Small geometry / physics helpers for the AI. Pure functions, no allocations in hot paths
// where it matters (we reuse plain {x,z} objects rather than Vector3 for planning).
import { PITCH, GOAL, BALL, PLAYER } from '../core/constants.js';

export const len2 = (x, z) => Math.sqrt(x * x + z * z);
export const dist2 = (a, b) => len2(a.x - b.x, a.z - b.z);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const randn = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58;

// Team-relative coordinates: d = 0 own goal line .. 1 opponent goal line, w = -1..1 across.
export function toRel(team, p) {
  return { d: (p.x * team.side + PITCH.halfL) / PITCH.length, w: (p.z * team.side) / PITCH.halfW };
}
export function toWorld(team, d, w) {
  return { x: team.side * (d * PITCH.length - PITCH.halfL), z: team.side * w * PITCH.halfW };
}

// Rough top speed (m/s) from stats. Uses the sim's value when it exposes one.
export function topSpeed(p, sprint = true) {
  if (typeof p.maxSpeed === 'function') return p.maxSpeed(sprint);
  if (typeof p.maxSpeed === 'number') return sprint ? p.maxSpeed : p.maxSpeed * 0.72;
  const pace = p.data?.stats?.pace ?? 70;
  const s = 6.2 + (pace / 99) * 3.2;
  const stam = p.stamina ?? 1;
  return (sprint ? s : s * 0.72) * (0.8 + 0.2 * stam);
}

export function stat(p, name, def = 65) {
  return p.data?.stats?.[name] ?? def;
}

// Lightweight ball trajectory sampler (drag, Magnus ignored, bounce, rolling).
// Returns an array of {t,x,y,z} samples every `step` seconds up to `horizon`.
export function sampleBall(ball, horizon = 3, step = 1 / 30, out = []) {
  let x = ball.pos.x, y = ball.pos.y, z = ball.pos.z;
  let vx = ball.vel.x, vy = ball.vel.y, vz = ball.vel.z;
  const n = Math.ceil(horizon / step);
  out.length = 0;
  out.push({ t: 0, x, y, z });
  const r = BALL.radius;
  for (let i = 1; i <= n; i++) {
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const airborne = y > r + 0.02 || vy > 0.3;
    if (airborne) {
      const k = BALL.dragK * sp;
      vx -= vx * k * step; vy -= vy * k * step + BALL.gravity * step; vz -= vz * k * step;
      x += vx * step; y += vy * step; z += vz * step;
      if (y < r) {
        y = r;
        vy = -vy * BALL.restitution;
        vx *= BALL.groundFriction + (1 - BALL.groundFriction) * 0.5;
        vz *= BALL.groundFriction + (1 - BALL.groundFriction) * 0.5;
        if (vy < 0.8) vy = 0;
      }
    } else {
      y = r; vy = 0;
      const h = Math.sqrt(vx * vx + vz * vz);
      if (h > 0) {
        const nh = Math.max(0, h - BALL.rollDecel * step - 0.06 * h * step);
        vx *= nh / h; vz *= nh / h;
      }
      x += vx * step; z += vz * step;
    }
    out.push({ t: i * step, x, y, z });
  }
  return out;
}

// Earliest time player p can reach the ball given trajectory samples.
// Returns {t, x, z, y} or null. reactDelay adds to the player's travel time.
export function interceptPoint(p, samples, reactDelay = 0, reach = PLAYER.controlRange) {
  const v = topSpeed(p, true);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.y > PLAYER.headerReach + 0.2) continue;
    const d = Math.max(0, len2(s.x - p.pos.x, s.z - p.pos.z) - reach);
    // ramp-up penalty: players don't start at top speed
    const tNeed = reactDelay + d / v + 0.25 * Math.min(1, d / 4);
    if (tNeed <= s.t) return s;
  }
  const last = samples[samples.length - 1];
  return last ? { ...last, t: last.t + len2(last.x - p.pos.x, last.z - p.pos.z) / v } : null;
}

// Time for an opponent to reach the segment a->b before the ball does.
// Returns the smallest "margin" (opponent arrival time - ball arrival time) over the opponents;
// positive = pass gets there first. ballSpeed = average ground speed.
export function laneMargin(a, b, ballSpeed, opponents, reactDelay = 0.15) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.max(0.01, len2(dx, dz));
  const ux = dx / L, uz = dz / L;
  let worst = Infinity;
  for (const o of opponents) {
    if (o.sentOff) continue;
    const ox = o.pos.x - a.x, oz = o.pos.z - a.z;
    let s = ox * ux + oz * uz;
    if (s < 0) s = 0;
    if (s > L) s = L;
    const px = a.x + ux * s, pz = a.z + uz * s;
    const dPerp = Math.max(0, len2(o.pos.x - px, o.pos.z - pz) - 0.9);
    // slow balls decelerate: crude correction
    const tBall = s / Math.max(4, ballSpeed * (1 - 0.15 * (s / L)));
    const tOpp = reactDelay + dPerp / topSpeed(o, true);
    const m = tOpp - tBall;
    if (m < worst) worst = m;
  }
  return worst;
}

export function nearestOf(list, pos, filter) {
  let best = null, bd = Infinity;
  for (const p of list) {
    if (filter && !filter(p)) continue;
    const d = len2(p.pos.x - pos.x, p.pos.z - pos.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : { p: null, d: Infinity };
}

export function inPitch(pt, margin = 1) {
  return Math.abs(pt.x) < PITCH.halfL - margin && Math.abs(pt.z) < PITCH.halfW - margin;
}

export function clampToPitch(pt, margin = 1) {
  pt.x = clamp(pt.x, -PITCH.halfL + margin, PITCH.halfL - margin);
  pt.z = clamp(pt.z, -PITCH.halfW + margin, PITCH.halfW - margin);
  return pt;
}

export { PITCH, GOAL, BALL, PLAYER };
