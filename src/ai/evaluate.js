// Pitch evaluation: expected-goal style shot quality and positional threat.
import { GOAL, PITCH, clamp, len2 } from './util.js';

// Opening angle of the goal mouth seen from (x,z) toward goal centre g.
export function goalAngle(gx, gz, x, z) {
  const ax = gx - x, az = gz - GOAL.halfW - z;
  const bx = gx - x, bz = gz + GOAL.halfW - z;
  const a1 = Math.atan2(az, ax), a2 = Math.atan2(bz, bx);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// Raw chance quality from a location (no blockers, average finisher).
export function xgAt(goal, x, z) {
  const d = len2(goal.x - x, goal.z - z);
  const ang = goalAngle(goal.x, goal.z, x, z);
  const base = 1.05 * Math.exp(-Math.max(0, d - 5) / 7.5);
  return clamp(base * Math.pow(Math.min(1, ang / 0.9), 0.65), 0, 0.85);
}

// Fraction of the shot cone blocked by bodies between shooter and goal.
export function blockFactor(goal, x, z, opponents, keeper) {
  const gx = goal.x - x, gz = goal.z - z;
  const L = len2(gx, gz);
  const ux = gx / L, uz = gz / L;
  let f = 1;
  for (const o of opponents) {
    if (o === keeper || o.sentOff) continue;
    const ox = o.pos.x - x, oz = o.pos.z - z;
    const along = ox * ux + oz * uz;
    if (along < 0.5 || along > L) continue;
    const perp = Math.abs(ox * uz - oz * ux);
    // cone half-width at this distance
    const cone = GOAL.halfW * (along / L) + 0.4;
    if (perp < cone) f *= 0.55 + 0.45 * (perp / cone) + Math.min(0.25, along / 60);
  }
  return clamp(f, 0.05, 1);
}

// Threat of simply *having the ball* at a location (rel d 0..1 toward attack goal).
export function positionValue(team, x, z) {
  const g = team.attackGoal;
  const dRel = (x * team.side + PITCH.halfL) / PITCH.length;
  return 0.015 + 0.45 * xgAt(g, x, z) + 0.05 * dRel * dRel;
}

// Cost of losing the ball at a location (higher near own goal).
export function turnoverCost(team, x, z) {
  const dRel = (x * team.side + PITCH.halfL) / PITCH.length;
  const og = team.ownGoal;
  return 0.02 + 0.04 * (1 - dRel) + 0.35 * xgAt(og, x, z);
}
