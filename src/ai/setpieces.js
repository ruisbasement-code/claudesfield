// Set pieces: what the AI taker does, and where AI players stand for restarts.
// Rules positions players for walls / kick-offs / penalties; for the rest we move into
// sensible spots while respecting the 9.15 m distance for the defending side.
import { Vector3 } from 'three';
import { GOAL, PITCH, clamp, dist2, len2, randn, stat, toRel, toWorld, nearestOf, clampToPitch } from './util.js';
import { evaluateOptions, chooseOption, buildShot, buildPass, jitterTarget, passPower } from './decisions.js';

export function takeSetPiece(ai, p, it, sp) {
  const st = ai.setPieceState || (ai.setPieceState = { since: ai.time, sp, done: false, plan: null });
  if (st.sp !== sp) { st.sp = sp; st.since = ai.time; st.done = false; st.plan = null; }
  it.move.x = 0; it.move.z = 0; it.sprint = false;
  const ball = ai.match.ball;
  // walk up to the ball first
  const db = dist2(p.pos, ball.pos);
  if (db > 0.9) { ai.moveTo(p, it, ball.pos, { urgency: 0.6, faceBall: true }); return; }
  const wait = sp.type === 'penalty' ? 1.2 : sp.type === 'kickoff' ? 0.6 : 0.9 + (1 - ai.prof.decisionQuality) * 0.8;
  if (st.done || ai.time - st.since < wait) { ai.faceBall(p, it); return; }
  st.done = true;
  it.action = setPieceAction(ai, p, sp);
}

function setPieceAction(ai, p, sp) {
  const team = ai.team, goal = team.attackGoal, prof = ai.prof;
  switch (sp.type) {
    case 'penalty': {
      const shooting = stat(p, 'shooting');
      const side = Math.random() < 0.5 ? -1 : 1;
      const r = Math.random();
      let z, y;
      if (r < 0.1) { z = goal.z; y = 1.0 + Math.random(); } // down the middle
      else { z = goal.z + side * (GOAL.halfW - 0.5 - Math.random() * 0.9); y = 0.3 + Math.random() * 1.6; }
      const err = prof.aimError * (1.4 - shooting / 99) * 0.8;
      const T = jitterTarget(p.pos, { x: goal.x, z }, err);
      T.y = y;
      return { type: 'shoot', target: T, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: 0.82 + Math.random() * 0.12, height: clamp((y - 0.3) / 1.6, 0, 1) };
    }
    case 'kickoff': {
      // short pass to the nearest teammate behind / beside
      let best = null, bd = Infinity;
      for (const q of team.players) {
        if (q === p || q.sentOff || q.isGK) continue;
        const d = dist2(q.pos, p.pos);
        if (d < bd) { bd = d; best = q; }
      }
      const T = best ? new Vector3(best.pos.x, 0, best.pos.z) : new Vector3(-team.side * 8, 0, 0);
      return { type: 'pass', receiver: best, target: T, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: passPower(bd) };
    }
    case 'corner': {
      const spots = [toWorld(team, 0.955, 0.06 * Math.sign(-p.pos.z * team.side || 1)), toWorld(team, 0.9, 0), toWorld(team, 0.95, 0.1 * Math.sign(p.pos.z * team.side || 1))];
      // short corner sometimes
      if (Math.random() < 0.12) {
        const q = nearestOf(team.players, p.pos, (x) => x !== p && !x.isGK).p;
        if (q) return { type: 'pass', receiver: q, target: new Vector3(q.pos.x, 0, q.pos.z), dir: { x: q.pos.x - p.pos.x, z: q.pos.z - p.pos.z }, power: passPower(dist2(p.pos, q.pos)) };
      }
      const S = spots[Math.floor(Math.random() * spots.length)];
      const T = jitterTarget(p.pos, S, prof.aimError * (1.3 - stat(p, 'passing') / 99));
      const recv = nearestOf(team.players, S, (x) => x !== p && !x.isGK).p;
      return { type: 'cross', target: T, receiver: recv, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: clamp(0.45 + dist2(p.pos, S) / 60, 0.5, 1) };
    }
    case 'goalkick': {
      if (Math.random() < 0.4 + prof.decisionQuality * 0.3) {
        // play it short to a centre back / full back if open
        const opps = team.opponent.players;
        const cands = team.players.filter((q) => q !== p && !q.sentOff && !q.isGK && toRel(team, q.pos).d < 0.3 && nearestOf(opps, q.pos).d > 7);
        if (cands.length) {
          const q = cands[Math.floor(Math.random() * cands.length)];
          return { type: 'pass', receiver: q, target: new Vector3(q.pos.x, 0, q.pos.z), dir: { x: q.pos.x - p.pos.x, z: q.pos.z - p.pos.z }, power: passPower(dist2(p.pos, q.pos)) };
        }
      }
      const T = toWorld(team, 0.62, (Math.random() - 0.5) * 1.2);
      const recv = nearestOf(team.players, T, (x) => x !== p && !x.isGK).p;
      return { type: p.isGK ? 'gkKick' : 'clear', receiver: recv, target: new Vector3(T.x, 0, T.z), dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: 0.95 };
    }
    case 'freekick': {
      const dGoal = dist2(p.pos, goal);
      const ang = Math.abs(Math.atan2(goal.z - p.pos.z, Math.abs(goal.x - p.pos.x)));
      if (sp.direct !== false && dGoal < 30 && ang < 0.9 && Math.random() < 0.45 + prof.riskTaking * 0.5) {
        const shot = buildShot(ai, p, { dGoal });
        shot.finesse = true; // curl it over / round the wall
        shot.chip = false;
        shot.target.y = 1.6 + Math.random() * 0.6;
        shot.height = 0.75;
        return shot;
      }
      // otherwise: cross into the box from the final third, or play the best pass
      const rel = toRel(team, p.pos);
      if (rel.d > 0.68) {
        const S = toWorld(team, 0.9, (Math.random() - 0.5) * 0.3);
        const recv = nearestOf(team.players, S, (x) => x !== p && !x.isGK).p;
        const T = jitterTarget(p.pos, S, prof.aimError);
        return { type: 'cross', target: T, receiver: recv, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: clamp(0.4 + dist2(p.pos, S) / 60, 0.45, 1) };
      }
      return bestPassAction(ai, p);
    }
    case 'throwin':
    case 'dropball':
    default:
      return bestPassAction(ai, p);
  }
}

function bestPassAction(ai, p) {
  const { opts } = evaluateOptions(ai, p);
  const passes = opts.filter((o) => o.kind === 'pass' || o.kind === 'lob' || o.kind === 'through');
  const choice = chooseOption(ai, passes);
  if (choice) return buildPass(ai, p, choice);
  const q = nearestOf(p.team.players, p.pos, (x) => x !== p && !x.isGK).p;
  return { type: 'pass', receiver: q, target: q ? new Vector3(q.pos.x, 0, q.pos.z) : undefined, dir: q ? { x: q.pos.x - p.pos.x, z: q.pos.z - p.pos.z } : { x: p.team.side, z: 0 }, power: 0.5 };
}

// Target position for a non-taker during a set piece, or null to stand still
// (kick-offs, penalties and walls are arranged by the rules module).
export function setPiecePositions(ai, p, sp) {
  if (sp.type === 'kickoff' || sp.type === 'penalty') return null;
  const team = ai.team, ball = ai.match.ball;
  const attacking = sp.team === team;
  if (p.isGK) {
    if (attacking) return null;
    const g = team.ownGoal;
    return { x: g.x + (g.x > 0 ? -1 : 1) * 0.8, z: clamp(ball.pos.z * 0.1, -2, 2) };
  }
  let T;
  if (sp.type === 'corner') T = cornerSpot(ai, p, sp, attacking);
  else T = ai.shapeTarget(p, ball.pos, attacking);
  // defenders keep 9.15 m from the ball (rules may also enforce this)
  if (!attacking && (sp.type === 'freekick' || sp.type === 'corner')) {
    const dx = T.x - ball.pos.x, dz = T.z - ball.pos.z, d = len2(dx, dz);
    if (d < 9.4) { const k = 9.4 / (d || 1); T = { x: ball.pos.x + dx * k, z: ball.pos.z + dz * k }; }
  }
  if (sp.type === 'throwin' && !attacking) {
    const dx = T.x - ball.pos.x, dz = T.z - ball.pos.z, d = len2(dx, dz);
    if (d < 2.5) { const k = 2.5 / (d || 1); T = { x: ball.pos.x + dx * k, z: ball.pos.z + dz * k }; }
  }
  return clampToPitch(T, 0.5);
}

function cornerSpot(ai, p, sp, attacking) {
  const team = ai.team;
  const slot = ai.slotOf(p);
  const idx = p.slot ?? 0;
  if (attacking) {
    // centre-backs + forwards attack the box, others hold the edge / rest defence
    const inBox = ['CB', 'ST', 'W', 'AM'].includes(slot.role);
    if (slot.role === 'CB' && idx % 2 === 0) return toWorld(team, 0.42, 0); // one CB stays home
    if (inBox) {
      const lanes = [-0.22, -0.08, 0.05, 0.18, 0.28];
      return toWorld(team, 0.9 + (idx % 3) * 0.02, lanes[idx % lanes.length]);
    }
    if (slot.role === 'FB') return toWorld(team, 0.55, slot.w * 0.8);
    return toWorld(team, 0.8, (idx % 2 ? -0.3 : 0.3)); // edge of the box for rebounds
  }
  // defending a corner: zonal block in the six-yard box + markers on the penalty spot line
  if (slot.role === 'ST' && idx % 2 === 0) return toWorld(team, 0.35, 0); // outlet striker
  const zones = [-0.2, -0.1, 0, 0.1, 0.2, -0.05, 0.05, 0.15, -0.15];
  const depth = ['CB', 'DM'].includes(slot.role) ? 0.06 : 0.1;
  return toWorld(team, depth + (idx % 2) * 0.02, zones[idx % zones.length]);
}
