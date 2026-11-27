// On-ball decision making: shoot / pass / through / lob / cross / dribble / clear.
// Every option gets an expected-value score; difficulty adds noise to the choice
// (decisionQuality) and error to the execution (aimError), and player stats scale both.
import { Vector3 } from 'three';
import {
  GOAL, PITCH, clamp, len2, dist2, randn, topSpeed, stat, laneMargin, nearestOf, inPitch, toRel, toWorld,
} from './util.js';
import { xgAt, blockFactor, positionValue, turnoverCost, goalAngle } from './evaluate.js';

const sig = (x) => 1 / (1 + Math.exp(-x));
export const TUNE = { passBias: 0.2, dribbleHold: 0.02, progress: 0.1, shotWeight: 1.6 };
let PASS_BIAS = 0.2;

function activeOpps(team) { return team.opponent.players.filter((o) => !o.sentOff); }
function keeperOf(team) { return team.players.find((p) => p.isGK && !p.sentOff) || null; }

// Rough average ground speed of a pass of a given length (m/s).
export function passSpeed(d) { return clamp(9 + d * 0.42, 10, 24); }
// Power 0..1 for a ground pass of length d (sim maps power to kick speed).
export function passPower(d) { return clamp(0.18 + d / 42, 0.2, 0.95); }

export function evaluateOptions(ai, p) {
  PASS_BIAS = TUNE.passBias;
  const team = p.team, prof = ai.prof;
  const opps = activeOpps(team);
  const oppGK = keeperOf(team.opponent);
  const goal = team.attackGoal;
  const pos = p.pos;
  const rel = toRel(team, pos);
  const press = nearestOf(opps, pos).d;
  const here = positionValue(team, pos.x, pos.z);
  const lossHere = turnoverCost(team, pos.x, pos.z);
  const passing = stat(p, 'passing'), shooting = stat(p, 'shooting'), dribbling = stat(p, 'dribbling');
  const opts = [];

  // --- Shoot -------------------------------------------------------------
  const dGoal = dist2(pos, goal);
  if (dGoal < 36 && rel.d > 0.55) {
    const xg0 = xgAt(goal, pos.x, pos.z);
    const blk = blockFactor(goal, pos.x, pos.z, opps, oppGK);
    const skill = 0.45 + (shooting / 99) * 0.75;
    let xg = xg0 * blk * skill;
    // long range appetite
    if (dGoal > 20) xg *= 0.6 + prof.riskTaking * 0.8;
    // pressure hurts
    if (press < 2) xg *= 0.75;
    opts.push({ kind: 'shoot', score: xg * TUNE.shotWeight + 0.015, dGoal });
  }

  // --- Passes --------------------------------------------------------------
  for (const q of team.players) {
    if (q === p || q.sentOff) continue;
    const qd = dist2(pos, q.pos);
    if (qd < 3 || qd > 55) continue;
    const qRel = toRel(team, q.pos);
    if (q.isGK && (rel.d > 0.35 || press > 6)) continue;
    // lead the receiver slightly along their run
    const lead = clamp(qd / passSpeed(qd), 0, 1.6) * 0.7;
    const tx = q.pos.x + (q.vel?.x || 0) * lead, tz = q.pos.z + (q.vel?.z || 0) * lead;
    if (!inPitch({ x: tx, z: tz }, 0.5)) continue;
    // offside check (receiver beyond 2nd-last defender in opp half when we play it)
    // weaker passers sometimes miss that the receiver is offside
    if (ai.isOffside(q) && Math.random() < ai.prof.positioning + 0.12) continue;
    const tgt = { x: tx, z: tz };
    const margin = laneMargin(pos, tgt, passSpeed(qd), opps, 0.12);
    const openness = clamp((nearestOf(opps, tgt).d - 1) / 6, 0.15, 1);
    const accuracy = 1 - (qd / 70) * (1.15 - passing / 99);
    let succ = sig(margin * 5 + PASS_BIAS) * accuracy * (0.55 + 0.45 * openness);
    const val = positionValue(team, tx, tz) * (0.6 + 0.4 * openness);
    let score = succ * val - (1 - succ) * turnoverCost(team, tx, tz);
    // under heavy pressure, safe passes look better
    if (press < 2.2) score += succ * 0.02;
    // slight preference for forward progress
    score += (qRel.d - rel.d) * TUNE.progress * succ;
    opts.push({ kind: 'pass', score, receiver: q, target: tgt, dist: qd });

    // Lob/chipped pass over a blocked lane to an open receiver
    if (qd > 14 && margin < 0.1 && openness > 0.45) {
      const succL = (0.3 + 0.3 * (passing / 99)) * openness * (1 - qd / 90);
      opts.push({ kind: 'lob', score: succL * val - (1 - succL) * turnoverCost(team, tx, tz) - 0.004,
        receiver: q, target: tgt, dist: qd });
    }

    // Through ball into space ahead of a forward-facing runner
    if (qRel.d > rel.d - 0.02 && !q.isGK && qRel.d > 0.45) {
      const runLen = 6 + 8 * prof.riskTaking;
      // aim between straight-ahead and goal-bound
      const fx = team.side, fz = 0;
      const gx = goal.x - q.pos.x, gz = goal.z - q.pos.z, gl = len2(gx, gz) || 1;
      const ax = (fx + gx / gl) * 0.5, az = (fz + gz / gl) * 0.5;
      const al = len2(ax, az) || 1;
      const T = { x: q.pos.x + (ax / al) * runLen, z: q.pos.z + (az / al) * runLen };
      if (!inPitch(T, 3)) continue;
      if (Math.abs(T.x) > PITCH.halfL - 4) continue;
      const dT = dist2(pos, T);
      const tBall = dT / passSpeed(dT) + 0.25;
      const tQ = 0.1 + dist2(q.pos, T) / topSpeed(q, true);
      let tOpp = Infinity;
      for (const o of opps) tOpp = Math.min(tOpp, ai.prof.reactionTime * 0.4 + dist2(o.pos, T) / topSpeed(o, true));
      const arrive = Math.max(tBall, tQ);
      const lane = laneMargin(pos, T, passSpeed(dT), opps, 0.15);
      const succT = sig((tOpp - arrive) * 2.2) * sig(lane * 3 + 0.5) * (0.6 + 0.4 * passing / 99);
      const valT = positionValue(team, T.x, T.z) * 1.1;
      opts.push({ kind: 'through', score: succT * valT - (1 - succT) * turnoverCost(team, T.x, T.z) - 0.006 * (1 - prof.riskTaking),
        receiver: q, target: T, dist: dT });
    }
  }

  // --- Cross ---------------------------------------------------------------
  if (rel.d > 0.72 && Math.abs(rel.w) > 0.42) {
    const sideSign = Math.sign(rel.w) || 1;
    const spots = [
      toWorld(team, 0.95, sideSign * 0.08), // near post
      toWorld(team, 0.9, 0),                 // penalty spot
      toWorld(team, 0.95, -sideSign * 0.13), // far post
    ];
    let best = null;
    for (const s of spots) {
      const mate = nearestOf(team.players, s, (q) => q !== p && !q.isGK && !q.sentOff);
      const opp = nearestOf(opps, s);
      if (!mate.p || mate.d > 10) continue;
      const contest = clamp((opp.d - mate.d + 3) / 6, 0.05, 1);
      const sc = contest * 0.32 * (0.5 + passing / 200) * (0.6 + stat(mate.p, 'physical') / 250);
      if (!best || sc > best.score) best = { kind: 'cross', score: sc - 0.01, target: s, receiver: mate.p, dist: dist2(pos, s) };
    }
    if (best) opts.push(best);
  }

  // --- Dribble ------------------------------------------------------------
  const fwd = Math.atan2(goal.z - pos.z, goal.x - pos.x);
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = fwd + (i - (N - 1) / 2) * (Math.PI * 0.85 / ((N - 1) / 2));
    const step = 6;
    const T = { x: pos.x + Math.cos(a) * step, z: pos.z + Math.sin(a) * step };
    if (!inPitch(T, 1.5)) continue;
    // free space: how long until an opponent can get to the carried ball path
    let free = Infinity;
    for (const o of opps) {
      const dd = Math.min(dist2(o.pos, T), dist2(o.pos, { x: pos.x + Math.cos(a) * 2.5, z: pos.z + Math.sin(a) * 2.5 }));
      free = Math.min(free, dd / (topSpeed(o, true) / 7));
    }
    const keep = sig((free - 2.6) / 1.1 + (dribbling - 70) / 22) * (0.75 + 0.25 * prof.dribbleBravery);
    const val = positionValue(team, T.x, T.z);
    let score = keep * val - (1 - keep) * turnoverCost(team, T.x, T.z);
    // carrying the ball forward is progress too, and keeping it has value when unpressed
    const tRel = toRel(team, T);
    score += (tRel.d - rel.d) * TUNE.progress * keep + TUNE.dribbleHold * keep * clamp((press - 2) / 6, 0, 1);
    // continuity: prefer the current dribble heading
    const brain = ai.brain(p);
    if (brain.dribbleAngle != null) {
      const da = Math.abs(Math.atan2(Math.sin(a - brain.dribbleAngle), Math.cos(a - brain.dribbleAngle)));
      score += 0.004 * (1 - da / Math.PI);
    }
    opts.push({ kind: 'dribble', score: score * (0.92 + prof.dribbleBravery * 0.16), angle: a, free });
  }

  // --- Clear (defensive emergency) --------------------------------------------
  if (rel.d < 0.3 && press < 3.5) {
    const sw = Math.sign(rel.w) || (Math.random() < 0.5 ? -1 : 1);
    const T = toWorld(team, 0.62, sw * 0.7);
    opts.push({ kind: 'clear', score: lossHere * 0.55 - 0.01 + (press < 1.6 ? 0.03 : 0), target: T, dist: dist2(pos, T) });
  }

  return { opts, press, here };
}

// Pick an option: the best one with probability rising with decisionQuality, otherwise
// a noise-perturbed choice. Option scores are small (~0..0.5), so noise is scaled to them.
export function chooseOption(ai, opts) {
  const q = ai.prof.decisionQuality;
  let best = null, bs = -Infinity;
  const noise = (1 - q) * 0.05;
  for (const o of opts) {
    const s = o.score + randn() * noise;
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}

// Turn an aim point into a Vector3 with gaussian angular error around the kicker.
export function jitterTarget(from, T, errRad) {
  const dx = T.x - from.x, dz = T.z - from.z;
  const a = Math.atan2(dz, dx) + randn() * errRad;
  const L = len2(dx, dz) * (1 + randn() * errRad * 0.6);
  return new Vector3(from.x + Math.cos(a) * L, 0, from.z + Math.sin(a) * L);
}

export function buildShot(ai, p, opt) {
  const team = p.team, goal = team.attackGoal;
  const gk = keeperOf(team.opponent);
  const prof = ai.prof;
  const shooting = stat(p, 'shooting');
  const gz = gk ? gk.pos.z : goal.z;
  const inset = GOAL.halfW - 0.55;
  const c1 = goal.z - inset, c2 = goal.z + inset;
  // pick the corner farther from the keeper most of the time
  let z = Math.abs(c1 - gz) > Math.abs(c2 - gz) ? c1 : c2;
  if (Math.random() > 0.55 + prof.decisionQuality * 0.4) z = z === c1 ? c2 : c1;
  const d = opt.dGoal;
  const gkOff = gk ? Math.abs(gk.pos.x - goal.x) : 0;
  const chip = gk && gkOff > 6 && d > 13 && d < 32 && Math.random() < 0.25 + prof.riskTaking * 0.4;
  const finesse = !chip && d > 12 && d < 26 && shooting > 72 && Math.random() < 0.45;
  const err = prof.aimError * (1.35 - shooting / 99) * (opt.dGoal > 20 ? 1.3 : 1);
  const T = jitterTarget(p.pos, { x: goal.x, z }, err);
  const height = chip ? 0 : clamp(0.15 + Math.random() * 0.6 + randn() * err * 2, 0, 1);
  T.y = chip ? 2.0 : 0.3 + height * 1.6;
  return {
    type: 'shoot', target: T, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z },
    power: chip ? clamp(0.35 + d / 80, 0.4, 0.7) : clamp(0.62 + d / 50, 0.68, 1),
    finesse, chip, height,
  };
}

export function buildPass(ai, p, opt) {
  const passing = stat(p, 'passing');
  const err = ai.prof.aimError * (1.3 - passing / 99) * (0.6 + opt.dist / 40);
  const T = jitterTarget(p.pos, opt.target, err);
  const type = opt.kind; // pass | through | lob | cross
  let power;
  if (type === 'lob' || type === 'cross') power = clamp(0.3 + opt.dist / 55, 0.35, 1);
  else if (type === 'through') power = clamp(passPower(opt.dist) + 0.06, 0.25, 1);
  else power = passPower(opt.dist);
  return {
    type, target: T, receiver: opt.receiver || null,
    dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power,
  };
}

export function buildClear(ai, p, opt) {
  const T = jitterTarget(p.pos, opt.target, ai.prof.aimError * 2);
  return { type: 'clear', target: T, dir: { x: T.x - p.pos.x, z: T.z - p.pos.z }, power: 1 };
}
