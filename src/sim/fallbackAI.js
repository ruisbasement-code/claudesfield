// Minimal team AI used by the core for testing and as a fallback.
// The real AI lives in src/ai/ (AI thread). Same contract: { update(dt) }.
import { Vector3 } from 'three';
import { GOAL, PITCH, clamp } from '../core/constants.js';
import { shapeSpot } from './formation.js';
import { pressureOn, pickReceiver, laneBlock } from './actions.js';

const LEVEL = { amateur: 0.2, semipro: 0.4, pro: 0.6, worldclass: 0.8, legendary: 1 };

export function createFallbackAI(match, team, difficulty = 'pro') {
  const skill = LEVEL[difficulty] ?? 0.6;
  let think = 0;
  const _t = new Vector3();

  function moveTo(p, target, sprint = false, stopDist = 0.4) {
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const it = p.intent;
    if (d < stopDist) { it.move.x = 0; it.move.z = 0; it.sprint = false; return d; }
    const m = clamp(d / 3, 0.25, 1);
    it.move.x = (dx / d) * m; it.move.z = (dz / d) * m;
    it.sprint = sprint && d > 3;
    return d;
  }

  function faceBall(p) {
    const b = match.ball.pos;
    p.intent.face = Math.atan2(b.z - p.pos.z, b.x - p.pos.x);
  }

  function keeper(p, dt) {
    const ball = match.ball;
    const it = p.intent;
    it.face = null;
    const goal = team.ownGoal;
    if (ball.owner === p) {
      it.move.x = 0; it.move.z = 0;
      if (p.stateTime > 1.2) {
        const r = pickReceiver(p, { x: team.side, z: 0 }, match, 'pass');
        if (r && Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z) < 35 && laneBlock(p.pos, r.pos, team.opponent) < 0.3) it.action = { type: 'gkThrow', receiver: r, power: 0.6 };
        else it.action = { type: 'gkKick', dir: { x: team.side, z: (Math.random() - 0.5) * 0.6 }, power: 0.7 };
      }
      return;
    }
    // incoming shot?
    if (!ball.owner && ball.vel.x * team.side < -6) {
      const c = ball.predictCrossX(goal.x + team.side * 0.6, 1.5);
      if (c && Math.abs(c.pos.z) < GOAL.halfW + 1) {
        const dz = c.pos.z - p.pos.z;
        if (Math.abs(dz) > 1.1 && c.t < 0.6 + (1 - skill) * -0.2 && p.state !== 'dive') {
          it.action = { type: 'dive', dir: { x: 0, z: Math.sign(dz) }, height: clamp(c.pos.y / 2.4, 0, 1) };
        } else moveTo(p, new Vector3(goal.x + team.side * 0.6, 0, c.pos.z), true, 0.1);
        faceBall(p);
        return;
      }
    }
    // loose ball in the box near me: claim it
    const inBox = Math.abs(ball.pos.x - goal.x) < PITCH.boxDepth && Math.abs(ball.pos.z) < PITCH.boxHalfW;
    if (!ball.owner && inBox && ball.speed() < 12) {
      const mine = match.nearestPlayer(team, ball.pos) === p;
      const opp = match.nearestPlayer(team.opponent, ball.pos);
      const myD = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      const oppD = opp ? Math.hypot(ball.pos.x - opp.pos.x, ball.pos.z - opp.pos.z) : 99;
      if (mine || myD < oppD) { moveTo(p, ball.pos, true, 0.1); return; }
    }
    // positioning on the ball-goal line
    const bx = ball.pos.x - goal.x, bz = ball.pos.z;
    const bd = Math.hypot(bx, bz) || 1;
    const depth = clamp(bd * 0.08, 0.5, 4);
    _t.set(goal.x + (bx / bd) * depth, 0, (bz / bd) * depth * 1.2);
    _t.z = clamp(_t.z, -GOAL.halfW + 0.4, GOAL.halfW - 0.4);
    moveTo(p, _t, false, 0.2);
    faceBall(p);
  }

  function carrier(p) {
    const it = p.intent;
    it.face = null;
    const goal = team.attackGoal;
    const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const press = pressureOn(p, match);
    const angleOK = Math.abs(p.pos.z) < 20 || dist < 14;
    if (dist < 24 && angleOK && Math.random() < 0.25 + skill * 0.3) {
      it.action = { type: 'shoot', dir: { x: 0, z: (Math.random() - 0.5) * 2 }, power: 0.55 + Math.random() * 0.3, finesse: Math.random() < 0.3, error: 1.6 - skill };
      return;
    }
    if (press > 0.55 || Math.random() < 0.08) {
      const r = pickReceiver(p, { x: dx / dist, z: dz / dist * 0.3 + (Math.random() - 0.5) }, match, 'pass')
        || pickReceiver(p, { x: Math.random() - 0.5, z: Math.random() - 0.5 }, match, 'pass');
      if (r) {
        const fwd = (r.pos.x - p.pos.x) * team.side;
        const wide = Math.abs(p.pos.z) > PITCH.boxHalfW && (p.pos.x * team.side) > PITCH.halfL - 25;
        const type = wide ? 'cross' : fwd > 15 && Math.random() < 0.4 ? 'through' : laneBlock(p.pos, r.pos, team.opponent) > 0.5 ? 'lob' : 'pass';
        it.action = { type, receiver: r, power: 0.4 + Math.random() * 0.4, error: 1.7 - skill };
        return;
      }
    }
    // dribble towards goal, sidestepping the nearest opponent a bit
    let mx = dx / dist, mz = dz / dist;
    const opp = match.nearestPlayer(team.opponent, p.pos);
    if (opp) {
      const ox = opp.pos.x - p.pos.x, oz = opp.pos.z - p.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 5) { mx -= (ox / od) * 0.6; mz -= (oz / od) * 0.6; }
    }
    const l = Math.hypot(mx, mz) || 1;
    it.move.x = mx / l; it.move.z = mz / l;
    it.sprint = press < 0.3 && Math.random() < 0.8;
  }

  return {
    placeholder: true,
    update(dt) {
      think -= dt;
      const ball = match.ball;
      const phase = match.phase;
      const sp = match.setPiece;
      const inPos = ball.owner ? ball.owner.team === team : match.possession === team;
      // chaser: nearest to the ball (predicted)
      const fut = ball.owner ? ball.pos : ball.predict(0.4);
      let chaser = null, cd = Infinity, second = null;
      for (const p of team.players) {
        if (p.sentOff || p.isGK) continue;
        const d = Math.hypot(p.pos.x - fut.x, p.pos.z - fut.z);
        if (d < cd) { second = chaser; cd = d; chaser = p; }
      }
      for (const p of team.players) {
        if (p.sentOff || p.locked) continue;
        if (team.human && team.controlled === p) continue;
        const it = p.intent;
        it.action = null;
        it.face = null;
        if (phase === 'setpiece' && sp) {
          if (sp.taker === p) {
            it.move.x = 0; it.move.z = 0;
            if (sp.team === team && match.time - (sp.readyAt ?? (sp.readyAt = match.time)) > 1.3) {
              const toGoal = Math.hypot(team.attackGoal.x - sp.spot.x, sp.spot.z);
              if (sp.type === 'penalty') it.action = { type: 'shoot', dir: { x: 0, z: Math.random() < 0.5 ? -1 : 1 }, power: 0.6 + Math.random() * 0.2, error: 1.4 - skill };
              else if (sp.type === 'corner') it.action = { type: 'cross', power: 0.6 };
              else if (sp.type === 'goalkick') it.action = { type: 'gkKick', dir: { x: team.side, z: 0 }, power: 0.7 };
              else if (sp.type === 'freekick' && sp.direct && toGoal < 28) it.action = { type: 'shoot', finesse: true, dir: { x: 0, z: Math.random() < 0.5 ? -1 : 1 }, power: 0.7, error: 1.4 - skill };
              else {
                const r = pickReceiver(p, { x: team.side, z: -Math.sign(p.pos.z) * 0.5 }, match, 'pass') || pickReceiver(p, { x: -team.side, z: 0 }, match, 'pass');
                it.action = r ? { type: 'pass', receiver: r, power: 0.5 } : { type: 'lob', dir: { x: team.side, z: 0 }, power: 0.6 };
              }
            }
            continue;
          }
          moveTo(p, shapeSpot(team, p.slot, ball.pos, sp.team === team, _t), false, 0.6);
          continue;
        }
        if (phase !== 'live') {
          moveTo(p, shapeSpot(team, p.slot, ball.pos, inPos, _t), false, 0.6);
          continue;
        }
        if (p.isGK) { keeper(p, dt); continue; }
        if (ball.owner === p) { if (think <= 0 || p.intent.move.x === 0) carrier(p); continue; }
        if (!ball.owner && (p === chaser || (p === second && !inPos))) {
          moveTo(p, fut, true, 0.05);
          continue;
        }
        if (ball.owner && ball.owner.team !== team && (p === chaser || (p === second && skill > 0.5))) {
          const o = ball.owner;
          const d = moveTo(p, o.pos, true, 0.1);
          if (p === chaser && d < 1.7 && Math.random() < dt * (1 + skill * 3)) it.action = { type: Math.random() < 0.15 ? 'slide' : 'tackle' };
          continue;
        }
        const spot = shapeSpot(team, p.slot, ball.pos, inPos, _t);
        moveTo(p, spot, Math.hypot(spot.x - p.pos.x, spot.z - p.pos.z) > 12, 0.8);
        if (p.intent.move.x === 0 && p.intent.move.z === 0) faceBall(p);
      }
      if (think <= 0) think = 0.25 + (1 - skill) * 0.3;
    },
  };
}
