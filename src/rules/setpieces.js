// Positioning for restarts: kick-offs, throw-ins, corners, goal kicks, free kicks
// (with walls) and penalties. Everything here is instant placement plus the
// per-frame "exclusion zones" that keep opponents the required distance away.
import { Vector3 } from 'three';
import { PITCH, GOAL } from '../core/constants.js';
import {
  activePlayers, outfield, keeperOf, nearest, dist2D, angleTo, ownGoalX, attackGoalX,
  outsideCircle, outsideBox, inPenaltyArea, goalAngle, penaltySpot,
} from './geometry.js';

const DIST = 9.15;
const ROLE_DEPTH = { GK: 3, DF: 17, MF: 33, FW: 45 };

// Default shape by role, in metres from the team's own goal line.
export function basePositions(team) {
  const out = new Map();
  const groups = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of activePlayers(team).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))) {
    const role = p.isGK ? 'GK' : p.data?.role ?? 'MF';
    (groups[role] ?? groups.MF).push(p);
  }
  for (const [role, list] of Object.entries(groups)) {
    const n = list.length;
    const span = role === 'FW' ? 18 : role === 'GK' ? 0 : 44;
    list.forEach((p, i) => {
      const z = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
      out.set(p, { depth: ROLE_DEPTH[role], z });
    });
  }
  return out;
}

const fromDepth = (team, depth, z) => new Vector3(team.side * (depth - PITCH.halfL), 0, z);

function face(player, target) { return angleTo(player.pos, target); }

// ---------------------------------------------------------------- kick-off
export function arrangeKickoff(match, kickTeam) {
  const centre = new Vector3(0, 0, 0);
  for (const team of match.teams) {
    const base = basePositions(team);
    for (const [p, { depth, z }] of base) {
      let pos = fromDepth(team, Math.min(depth, PITCH.halfL - 1.5), z);
      if (team !== kickTeam) pos = outsideCircle(pos, centre, DIST + 0.6);
      match.teleport(p, pos, face({ pos }, centre));
      p.locked = true; p.lockTarget = null;
    }
  }
  // kick-off pair: taker on the ball, a partner alongside
  const fwds = outfield(kickTeam).sort((a, b) => roleRank(b) - roleRank(a));
  const taker = fwds[0];
  const partner = fwds[1];
  const s = kickTeam.side;
  match.teleport(taker, new Vector3(-s * 0.55, 0, 0.15), s > 0 ? 0 : Math.PI);
  if (partner) match.teleport(partner, new Vector3(-s * 2.5, 0, -6), angleTo(new Vector3(-s * 2.5, 0, -6), centre));
  return taker;
}
const roleRank = (p) => ({ FW: 3, MF: 2, DF: 1, GK: 0 }[p.data?.role] ?? 1) + (p.data?.stats?.passing ?? 50) / 1000;

// ---------------------------------------------------------------- throw-in / corner / goal kick
export function throwInSpot(pos) {
  return new Vector3(Math.max(-PITCH.halfL + 0.5, Math.min(PITCH.halfL - 0.5, pos.x)), 0, Math.sign(pos.z || 1) * PITCH.halfW);
}
export function cornerSpot(goalX, z) {
  return new Vector3(goalX - Math.sign(goalX) * 0.45, 0, Math.sign(z || 1) * (PITCH.halfW - 0.45));
}
export function goalKickSpot(goalX, z) {
  return new Vector3(goalX - Math.sign(goalX) * (PITCH.sixDepth - 0.2), 0, Math.sign(z || 1) * (PITCH.sixHalfW - 3));
}

export function pickNearestTaker(team, spot) {
  return nearest(outfield(team), spot) ?? nearest(activePlayers(team), spot);
}

// Best dead-ball specialist for shots, best passer otherwise.
export function pickSpecialist(team, spot, shooting) {
  const cands = outfield(team);
  let best = null, bs = -Infinity;
  for (const p of cands) {
    const st = p.data?.stats ?? {};
    const skill = shooting ? (st.shooting ?? 50) * 0.7 + (st.passing ?? 50) * 0.3 : (st.passing ?? 50);
    const score = skill - dist2D(p.pos, spot) * 0.35;
    if (score > bs) { bs = score; best = p; }
  }
  return best;
}

// Put the taker a step behind the ball, facing the direction of play.
export function placeTaker(match, taker, spot, lookAt) {
  const a = angleTo(spot, lookAt);
  const pos = new Vector3(spot.x - Math.cos(a) * 0.6, 0, spot.z - Math.sin(a) * 0.6);
  if (Math.abs(spot.z) >= PITCH.halfW - 0.01) pos.z = Math.sign(spot.z) * (PITCH.halfW + 0.3); // throw-in from behind the line
  match.teleport(taker, pos, a);
}

// ---------------------------------------------------------------- free kicks
// Number of players in the wall, by distance and angle to goal.
export function wallSize(spot, goalX) {
  const d = Math.hypot(goalX - spot.x, spot.z);
  const ang = goalAngle(spot, goalX);
  if (d > 34 || ang < 0.1) return 0;
  if (d > 29) return 2;
  if (d > 24) return ang > 0.22 ? 4 : 3;
  return ang > 0.26 ? 5 : ang > 0.18 ? 4 : 3;
}

// Build the wall 9.15 m from the ball between the ball and the near post.
export function buildWall(match, defTeam, spot) {
  const gx = ownGoalX(defTeam);
  const n = wallSize(spot, gx);
  if (!n) return [];
  const nearPostZ = Math.sign(spot.z || 1) * GOAL.halfW * 0.55;
  const aim = new Vector3(gx, 0, nearPostZ);
  const a = angleTo(spot, aim);
  const cx = spot.x + Math.cos(a) * DIST, cz = spot.z + Math.sin(a) * DIST;
  const px = -Math.sin(a), pz = Math.cos(a); // perpendicular
  const gk = keeperOf(defTeam);
  const cands = outfield(defTeam).sort((p, q) => dist2D(p.pos, { x: cx, z: cz }) - dist2D(q.pos, { x: cx, z: cz }));
  const wall = cands.slice(0, n);
  // the wall's outermost man covers the near post side
  const sideSign = Math.sign(spot.z || 1);
  wall.forEach((p, i) => {
    const off = (i - (n - 1) / 2) * 0.62 + sideSign * 0.3;
    const pos = new Vector3(cx + px * off, 0, cz + pz * off);
    match.teleport(p, pos, a + Math.PI);
    p.locked = true; p.lockTarget = null; p.inWall = true;
  });
  // keeper covers the far side
  if (gk) {
    const kpos = new Vector3(gx - Math.sign(gx) * 0.8, 0, -sideSign * 0.9);
    match.teleport(gk, kpos, angleTo(kpos, spot));
  }
  return wall;
}

export function freeKickSpot(pos, attackingTeam, direct) {
  let p = new Vector3(
    Math.max(-PITCH.halfL + 0.3, Math.min(PITCH.halfL - 0.3, pos.x)), 0,
    Math.max(-PITCH.halfW + 0.3, Math.min(PITCH.halfW - 0.3, pos.z)),
  );
  // Indirect free kick inside the opponents' goal area: move to the goal-area line.
  const gx = attackGoalX(attackingTeam);
  if (!direct && Math.abs(p.z) <= PITCH.sixHalfW && Math.abs(p.x - gx) < PITCH.sixDepth) {
    p.x = gx - Math.sign(gx) * PITCH.sixDepth;
  }
  return p;
}

// ---------------------------------------------------------------- penalties
export function arrangePenalty(match, attTeam, taker, shootout = false) {
  const defTeam = attTeam.opponent;
  const gx = attackGoalX(attTeam);
  const spot = penaltySpot(gx);
  const gk = keeperOf(defTeam);
  if (gk) {
    const kpos = new Vector3(gx - Math.sign(gx) * 0.15, 0, 0);
    match.teleport(gk, kpos, angleTo(kpos, spot));
    gk.locked = false;
  }
  placeTaker(match, taker, spot, new Vector3(gx, 0, 0));
  const arcCentre = spot;
  if (shootout) {
    // everyone else waits in the centre circle
    let i = 0;
    for (const team of match.teams) {
      for (const p of activePlayers(team)) {
        if (p === taker || p === gk) continue;
        if (p.isGK) {
          const pos = new Vector3(Math.sign(gx) * 22, 0, team.index ? 14 : -14);
          match.teleport(p, pos, angleTo(pos, spot));
        } else {
          const k = i++;
          const ang = (k / 20) * Math.PI * 2;
          const pos = new Vector3(Math.cos(ang) * 4 + (team.index ? 2.5 : -2.5), 0, Math.sin(ang) * 4);
          match.teleport(p, pos, angleTo(pos, spot));
        }
        p.locked = true; p.lockTarget = null;
      }
    }
  } else {
    for (const p of match.players) {
      if (p === taker || p === gk || p.sentOff) continue;
      let pos = outsideBox(p.pos, gx, 1.0);
      pos = outsideCircle(pos, arcCentre, DIST + 0.5);
      // behind the penalty mark
      if (Math.abs(pos.x - gx) < PITCH.penaltySpot + 0.5) pos.x = gx - Math.sign(gx) * (PITCH.boxDepth + 1.0);
      match.teleport(p, pos, angleTo(pos, spot));
    }
  }
  return spot;
}

// ---------------------------------------------------------------- exclusion zones
// Each frame until the set piece is taken, keep players out of where they may not be.
export function enforceZones(match, sp) {
  if (!sp) return;
  const spot = sp.spot;
  const att = sp.team, def = sp.team.opponent;
  const push = (p, pos) => {
    if (pos.x !== p.pos.x || pos.z !== p.pos.z) {
      p.pos.x = pos.x; p.pos.z = pos.z;
      // kill velocity towards the forbidden zone
      p.vel.x *= 0.3; p.vel.z *= 0.3;
    }
  };
  switch (sp.type) {
    case 'kickoff':
      for (const p of match.players) {
        if (p.sentOff || p === sp.taker) continue;
        const pos = p.pos.clone();
        if (pos.x * p.team.side > -0.2) pos.x = -p.team.side * 0.2; // own half
        push(p, p.team === def ? outsideCircle(pos, spot, DIST) : pos);
      }
      break;
    case 'penalty': {
      const gx = attackGoalX(att);
      const gk = keeperOf(def);
      for (const p of match.players) {
        if (p.sentOff || p === sp.taker || p === gk || p.locked) continue;
        let pos = outsideBox(p.pos, gx, 0.3);
        pos = outsideCircle(pos, spot, DIST);
        push(p, pos);
      }
      // keeper on the line, between the posts, until the kick
      if (gk) {
        const lineX = gx - Math.sign(gx) * 0.15;
        gk.pos.x = lineX; if (gk.vel.x * Math.sign(gx) < 0) gk.vel.x = 0;
        gk.pos.z = Math.max(-GOAL.halfW + 0.3, Math.min(GOAL.halfW - 0.3, gk.pos.z));
      }
      break;
    }
    case 'goalkick': {
      const gx = ownGoalX(att);
      for (const p of activePlayers(def)) push(p, outsideBox(p.pos, gx, 0.3));
      break;
    }
    case 'throwin':
      for (const p of activePlayers(def)) push(p, outsideCircle(p.pos, spot, 2));
      break;
    default: // corner, freekick
      for (const p of activePlayers(def)) if (!p.inWall) push(p, outsideCircle(p.pos, spot, DIST));
  }
  // nobody but the taker on top of the ball
  for (const p of activePlayers(att)) if (p !== sp.taker) push(p, outsideCircle(p.pos, spot, 1.5));
}

export { inPenaltyArea };
