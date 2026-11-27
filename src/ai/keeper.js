// Goalkeeper AI: angle positioning, shot reading + diving, rushing out / sweeping,
// claiming loose balls, 1v1 narrowing, distribution and penalties.
import { Vector3 } from 'three';
import { GOAL, PITCH, PLAYER, clamp, len2, dist2, randn, stat, topSpeed, toRel, nearestOf } from './util.js';

const DIVE_REACH = 2.3; // extra lateral metres a full-stretch dive covers (scaled by diving stat)

export class KeeperBrain {
  constructor(ai, gk) {
    this.ai = ai;
    this.gk = gk;
    this.reactAt = Infinity;  // time when the keeper "sees" the current shot
    this.shotId = null;
    this.guess = 0;           // perception error (m) applied to the shot reading
    this.holdSince = -1;
    this.dived = false;
    this.penaltyGuess = null;
  }

  onKick(e) {
    const gk = this.gk, ai = this.ai;
    if (e.player.team === gk.team) return;
    const prof = ai.prof;
    const reflex = (stat(gk, 'reflexes', 70) / 99) * 0.5 + prof.gkReflex * 0.5;
    // reaction delay: elite keepers ~0.12s, poor ones ~0.4s
    this.reactAt = ai.time + 0.1 + (1 - reflex) * 0.35;
    this.guess = randn() * (1 - reflex) * 1.6;
    this.dived = false;
    this.shotId = ai.time;
  }

  update(dt, intent, ctx) {
    const { ai, gk } = this;
    const team = gk.team, ball = ai.match.ball;
    const goal = team.ownGoal;
    const out = goal.x > 0 ? -1 : 1; // direction from goal line into the pitch
    const prof = ai.prof;

    if (gk.state === 'dive' || gk.state === 'stumble') return;

    // --- Holding the ball: distribute -------------------------------------
    if (gk.hasBall && gk.hasBall()) {
      if (this.holdSince < 0) this.holdSince = ai.time;
      const held = ai.time - this.holdSince;
      // walk to the edge of the six-yard-ish area while looking up
      const target = { x: goal.x + out * 8, z: clamp(gk.pos.z, -10, 10) };
      ai.moveTo(gk, intent, target, { urgency: 0.35, faceBall: false });
      intent.face = out > 0 ? 0 : Math.PI;
      if (held > 1.4 + (1 - prof.decisionQuality) * 1.2) {
        intent.action = this.distribution();
        this.holdSince = -1;
      }
      return;
    }
    this.holdSince = -1;

    // --- Shot incoming ----------------------------------------------------------
    const towards = ball.vel.x * out < -4; // moving toward our goal line
    if (towards && !ball.owner && ai.time >= this.reactAt) {
      const cross = predictCross(ai, goal.x);
      if (cross && cross.t < 2.2 && Math.abs(cross.z - goal.z) < GOAL.halfW + 0.6 && cross.y < GOAL.height + 0.4) {
        const perceivedZ = cross.z + this.guess * Math.min(1, cross.t);
        const lineX = gk.pos.x; // move along current depth
        const dz = perceivedZ - gk.pos.z;
        const reachRun = topSpeed(gk, true) * Math.max(0, cross.t - 0.15);
        const diving = stat(gk, 'diving', 70) / 99;
        const diveReach = 0.8 + DIVE_REACH * (0.55 + 0.45 * diving);
        if (Math.abs(dz) > 0.7 && !this.dived && cross.t < 0.55 + diving * 0.15 && Math.abs(dz) < diveReach + reachRun * 0.4) {
          intent.action = { type: 'dive', dir: { x: 0, z: Math.sign(dz) }, height: clamp((cross.y - 0.2) / 2.2, 0, 1),
            target: new Vector3(lineX, cross.y, perceivedZ) };
          this.dived = true;
          return;
        }
        ai.moveTo(gk, intent, { x: lineX + (goal.x - lineX) * 0.0, z: perceivedZ }, { urgency: 1, sprint: true });
        return;
      }
    }

    // --- Loose ball we can claim: rush out ----------------------------------------
    const rel = toRel(team, ball.pos);
    const inBox = rel.d < PITCH.boxDepth / PITCH.length && Math.abs(ball.pos.z) < PITCH.boxHalfW;
    if (!ball.owner && ctx.samples) {
      const mine = ctx.interceptFor(gk);
      const theirs = ctx.oppBestIntercept;
      const claimable = mine && (!theirs || mine.t < theirs.t - 0.15) && mine.t < 2.5;
      const sweeperZone = rel.d < 0.3;
      if (claimable && (inBox || (sweeperZone && prof.positioning > 0.6))) {
        ai.moveTo(gk, intent, mine, { urgency: 1, sprint: true });
        return;
      }
    }

    // --- 1v1: carrier through on goal --------------------------------------------
    const carrier = ball.owner;
    if (carrier && carrier.team !== team) {
      const dGoal = dist2(carrier.pos, goal);
      const defendersBetween = team.players.some((p) => p !== gk && !p.sentOff &&
        dist2(p.pos, goal) < dGoal - 1 && Math.abs(p.pos.z - carrier.pos.z) < 4);
      if (dGoal < 20 && !defendersBetween) {
        // come out to narrow the angle, stop ~2.5m from the carrier
        const ux = (carrier.pos.x - goal.x) / dGoal, uz = (carrier.pos.z - goal.z) / dGoal;
        const want = Math.max(2, Math.min(dGoal - 2.5, dGoal * 0.55));
        const T = { x: goal.x + ux * want, z: goal.z + uz * want };
        ai.moveTo(gk, intent, T, { urgency: 1, sprint: dGoal < 14 });
        // smother: very close & ball off foot
        if (dist2(gk.pos, carrier.pos) < 1.8 && Math.random() < prof.gkReflex * 0.25) {
          intent.action = { type: 'dive', dir: { x: carrier.pos.x - gk.pos.x, z: carrier.pos.z - gk.pos.z }, height: 0 };
        }
        return;
      }
    }

    // --- Base positioning on the ball-goal line ------------------------------------
    const bx = ball.pos.x, bz = ball.pos.z;
    const dBall = len2(bx - goal.x, bz - goal.z);
    // depth off the line: close to line when ball near, sweeper position when ball far
    let depth;
    if (dBall < 25) depth = clamp(0.6 + dBall * 0.09, 0.6, 3.2);
    else depth = clamp(3 + (dBall - 25) * 0.18 * prof.positioning, 3, 14);
    const ux = (bx - goal.x) / (dBall || 1), uz = (bz - goal.z) / (dBall || 1);
    let T = { x: goal.x + ux * depth, z: goal.z + uz * depth };
    // stay within the goal width-ish laterally
    T.z = clamp(T.z, goal.z - GOAL.halfW * 0.85, goal.z + GOAL.halfW * 0.85);
    // positional error for weaker keepers / difficulties
    const posErr = (1 - (stat(gk, 'positioning', 70) / 99) * prof.gkReflex) * 0.8;
    T.z += Math.sin(ai.time * 0.7 + (gk.slot ?? 0) * 1.7) * posErr;
    ai.moveTo(gk, intent, T, { urgency: 0.8, sprint: dist2(gk.pos, T) > 4 });
  }

  distribution() {
    const { ai, gk } = this;
    const team = gk.team;
    const opps = team.opponent.players.filter((o) => !o.sentOff);
    let best = null, bs = -Infinity;
    for (const q of team.players) {
      if (q === gk || q.sentOff) continue;
      const d = dist2(gk.pos, q.pos);
      const open = nearestOf(opps, q.pos).d;
      if (d < 35 && open > 6) {
        const s = open * 0.4 - d * 0.05 + toRel(team, q.pos).d * 3 + randn() * (1 - ai.prof.decisionQuality);
        if (s > bs) { bs = s; best = { type: 'gkThrow', q, d }; }
      }
    }
    if (best && Math.random() < 0.55 + ai.prof.decisionQuality * 0.3) {
      const q = best.q;
      return { type: 'gkThrow', receiver: q, target: new Vector3(q.pos.x, 0, q.pos.z),
        dir: { x: q.pos.x - gk.pos.x, z: q.pos.z - gk.pos.z }, power: clamp(best.d / 35, 0.3, 1) };
    }
    // long kick toward the most advanced teammate
    let fw = null, fd = -1;
    for (const q of team.players) {
      if (q.sentOff || q === gk) continue;
      const d = toRel(team, q.pos).d;
      if (d > fd) { fd = d; fw = q; }
    }
    const T = fw ? new Vector3(fw.pos.x, 0, fw.pos.z) : new Vector3(team.side * 10, 0, 0);
    return { type: 'gkKick', receiver: fw, target: T, dir: { x: T.x - gk.pos.x, z: T.z - gk.pos.z }, power: 0.95 };
  }

  // Penalty (in-game or shootout): pick a side when the kick happens.
  penalty(intent) {
    const { ai, gk } = this;
    const ball = ai.match.ball;
    const goal = gk.team.ownGoal;
    intent.face = goal.x > 0 ? Math.PI : 0;
    if (!this.dived && ball.vel.lengthSq && ball.vel.lengthSq() > 25 && ai.time >= this.reactAt - 0.1) {
      const cross = predictCross(ai, goal.x);
      const reflex = ai.prof.gkReflex * 0.6 + (stat(gk, 'reflexes', 70) / 99) * 0.4;
      // keepers commit before seeing the ball properly: read the side with p ~ 0.35..0.65
      let side;
      if (cross && Math.random() < 0.3 + reflex * 0.35) side = Math.sign(cross.z - goal.z) || 1;
      else side = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.12) side = 0; // stay up the middle
      this.dived = true;
      if (side !== 0) {
        intent.action = { type: 'dive', dir: { x: 0, z: side }, height: cross ? clamp((cross.y - 0.2) / 2.2, 0, 1) : 0.4 };
      }
      return;
    }
    // shuffle on the line
    const T = { x: goal.x, z: goal.z + Math.sin(ai.time * 3) * 0.4 };
    ai.moveTo(gk, intent, T, { urgency: 0.4 });
    intent.face = goal.x > 0 ? Math.PI : 0;
  }

  resetPenalty() { this.dived = false; this.reactAt = Infinity; }
}

// Where/when the ball crosses the plane x = gx. Prefer the sim's predictor.
function predictCross(ai, gx) {
  const ball = ai.match.ball;
  if (typeof ball.predictCrossX === 'function') {
    const r = ball.predictCrossX(gx);
    if (r && r.pos) return { t: r.t, x: r.pos.x, y: r.pos.y, z: r.pos.z };
    if (r == null) return null;
  }
  const s = ai.samples;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if ((a.x - gx) * (b.x - gx) <= 0) {
      const f = (gx - a.x) / ((b.x - a.x) || 1e-6);
      return { t: a.t + (b.t - a.t) * f, x: gx, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  return null;
}
