// Pitch geometry helpers used by the rules layer. Pure functions, no state.
import { Vector3 } from 'three';
import { PITCH, GOAL, clamp } from '../core/constants.js';

// x of the goal line a team defends / attacks.
export const ownGoalX = (team) => -team.side * PITCH.halfL;
export const attackGoalX = (team) => team.side * PITCH.halfL;

// Distance "up the pitch" for a team: 0 at own goal line, 105 at the opponent's.
export const depthFor = (team, pos) => pos.x * team.side + PITCH.halfL;

export function inPenaltyArea(pos, goalX) {
  return Math.abs(pos.z) <= PITCH.boxHalfW && Math.abs(pos.x - goalX) <= PITCH.boxDepth && Math.abs(pos.x) <= PITCH.halfL + 0.01;
}
export function inGoalArea(pos, goalX) {
  return Math.abs(pos.z) <= PITCH.sixHalfW && Math.abs(pos.x - goalX) <= PITCH.sixDepth;
}

// Inside the defending team's own penalty area.
export const inOwnBox = (team, pos) => inPenaltyArea(pos, ownGoalX(team));

export function penaltySpot(goalX) {
  return new Vector3(goalX - Math.sign(goalX) * PITCH.penaltySpot, 0, 0);
}

export function clampToPitch(pos, margin = 0.3) {
  return new Vector3(
    clamp(pos.x, -PITCH.halfL + margin, PITCH.halfL - margin),
    0,
    clamp(pos.z, -PITCH.halfW + margin, PITCH.halfW - margin),
  );
}

export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const angleTo = (from, to) => Math.atan2(to.z - from.z, to.x - from.x);

// Push `pos` so it is at least `r` away from `centre` (2D). Returns a new vector.
export function outsideCircle(pos, centre, r) {
  const dx = pos.x - centre.x, dz = pos.z - centre.z;
  const d = Math.hypot(dx, dz);
  if (d >= r) return pos.clone();
  const ux = d > 1e-3 ? dx / d : 1, uz = d > 1e-3 ? dz / d : 0;
  return new Vector3(centre.x + ux * r, 0, centre.z + uz * r);
}

// Push a point out of a penalty area (towards the pitch centre) if inside it.
export function outsideBox(pos, goalX, margin = 0.6) {
  if (!inPenaltyArea(pos, goalX)) return pos.clone();
  const p = pos.clone();
  const toEdgeX = PITCH.boxDepth + margin - Math.abs(p.x - goalX);
  const toEdgeZ = PITCH.boxHalfW + margin - Math.abs(p.z);
  if (toEdgeX < toEdgeZ) p.x = goalX - Math.sign(goalX) * (PITCH.boxDepth + margin);
  else p.z = Math.sign(p.z || 1) * (PITCH.boxHalfW + margin);
  return p;
}

// Angle (radians) the goal mouth subtends from `pos` – used for wall sizes and DOGSO.
export function goalAngle(pos, goalX) {
  const a1 = Math.atan2(GOAL.halfW - pos.z, goalX - pos.x);
  const a2 = Math.atan2(-GOAL.halfW - pos.z, goalX - pos.x);
  let d = Math.abs(a1 - a2);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export const activePlayers = (team) => team.players.filter((p) => !p.sentOff);
export const outfield = (team) => activePlayers(team).filter((p) => !p.isGK);
export const keeperOf = (team) => team.players.find((p) => p.isGK && !p.sentOff) || null;

export function nearest(players, pos) {
  let best = null, bd = Infinity;
  for (const p of players) {
    const d = dist2D(p.pos, pos);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
