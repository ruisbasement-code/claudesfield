import { Vector3 } from 'three';
import { PITCH, clamp } from '../core/constants.js';
import { FORMATIONS } from '../data/teams.js';

// Converts team-space (along -1..1 own goal -> opponent goal, across -1..1) into world space.
export function teamToWorld(team, along, across, out = new Vector3()) {
  return out.set(team.side * along * PITCH.halfL, 0, team.side * across * PITCH.halfW);
}

export function worldToTeam(team, pos) {
  return { along: (pos.x / PITCH.halfL) * team.side, across: (pos.z / PITCH.halfW) * team.side };
}

export function formationSlots(team) {
  return FORMATIONS[team.data.formation] || FORMATIONS['4-3-3'];
}

// Base formation spot for a player (no ball adjustment).
export function baseSpot(team, slot, out = new Vector3()) {
  const s = formationSlots(team)[slot];
  return teamToWorld(team, s[2], s[3], out);
}

// Simple shape that slides with the ball: used by the fallback AI and kick-off layouts.
export function shapeSpot(team, slot, ballPos, inPossession, out = new Vector3()) {
  const s = formationSlots(team)[slot];
  const role = s[1];
  let along = s[2], across = s[3];
  if (role === 'GK') return teamToWorld(team, -0.96, clamp(ballPos.z / PITCH.halfW * team.side * 0.1, -0.06, 0.06), out);
  const ballAlong = (ballPos.x / PITCH.halfL) * team.side;
  const ballAcross = (ballPos.z / PITCH.halfW) * team.side;
  const shift = inPossession ? 0.45 : 0.15;
  along = along + 0.25 + ballAlong * 0.55 + shift - 0.25;
  // compactness
  const depthMin = role === 'DF' ? -0.9 : -0.8;
  const depthMax = role === 'DF' ? (inPossession ? 0.35 : 0.1) : role === 'MF' ? 0.7 : 0.88;
  along = clamp(along, depthMin, depthMax);
  across = across * (inPossession ? 1.0 : 0.75) + ballAcross * 0.25;
  return teamToWorld(team, along, clamp(across, -0.95, 0.95), out);
}

// Kick-off: everyone in their own half, defending team outside the centre circle.
export function kickoffLayout(match, kickingTeam) {
  for (const team of match.teams) {
    const kicking = team === kickingTeam;
    const slots = formationSlots(team);
    let takerDone = false;
    const fws = team.players.filter((p) => !p.sentOff && slots[p.slot][1] === 'FW');
    const taker = fws[0] || team.players.find((p) => !p.isGK && !p.sentOff);
    const support = fws[1] || team.players.filter((p) => slots[p.slot][1] === 'MF')[0];
    for (const p of team.players) {
      if (p.sentOff) continue;
      const s = slots[p.slot];
      let along = Math.min(s[2] * 0.95 - 0.06, -0.04);
      let across = s[3];
      const pos = teamToWorld(team, along, across);
      if (kicking && p === taker && !takerDone) { pos.set(-team.side * 0.25, 0, 0); takerDone = true; }
      else if (kicking && p === support) pos.set(-team.side * 1.2, 0, team.side * 6);
      else {
        const d = Math.hypot(pos.x, pos.z);
        const minR = 9.6;
        if (d < minR) {
          const k = minR / (d || 1);
          pos.x *= k; pos.z *= k;
          if (pos.x * team.side > -0.5) pos.x = -team.side * 0.8;
        }
      }
      match.teleport(p, pos, team.side > 0 ? 0 : Math.PI);
    }
  }
  const taker = kickingTeam.players.find((p) => Math.abs(p.pos.x) < 0.5 && Math.abs(p.pos.z) < 0.5);
  return taker;
}
