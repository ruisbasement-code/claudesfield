import { Vector3 } from 'three';
import { BALL, GOAL, PITCH, PLAYER, clamp, randn, rand } from '../core/constants.js';
import { solveLobSpeed, groundPassSpeed, SURFACE } from './ball.js';

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();

// ---------------------------------------------------------------------------
// Reach checks
// ---------------------------------------------------------------------------
export function ballReach(p, match) {
  const ball = match.ball;
  const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
  return { d: Math.hypot(dx, dz), y: ball.pos.y };
}

export function canReachBall(p, match) {
  const ball = match.ball;
  if (ball.owner === p) return true;
  if (ball.owner) return false;
  const sp = match.setPiece;
  if (match.phase === 'setpiece' && sp && sp.taker !== p) return false;
  const { d, y } = ballReach(p, match);
  if (y < 1.25) return d < 1.05;
  if (y < PLAYER.headerReach + (p.isGK ? 0.4 : 0)) return d < 0.8;
  return false;
}

// Pressure from the nearest opponent (0 = free, 1 = tight)
export function pressureOn(p, match) {
  let best = 99;
  for (const o of p.team.opponent.players) {
    if (o.sentOff) continue;
    const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
    if (d < best) best = d;
  }
  return clamp(1 - (best - 0.8) / 3.2, 0, 1);
}

// ---------------------------------------------------------------------------
// Receiver selection (FC-style assisted passing; AI may call it too)
// The stick direction picks the team-mate (a cone around it, angle weighted most), and the
// power held biases the choice towards nearer (tap) or further (long hold) options.
// opts: { power: 0..1 | null, prev: Player | null (hysteresis for the on-screen preview) }
// ---------------------------------------------------------------------------
export function pickReceiver(p, dir, match, kind = 'pass', opts = {}) {
  let dx = dir?.x || 0, dz = dir?.z || 0;
  let l = Math.hypot(dx, dz);
  if (l < 0.2) { dx = Math.cos(p.facing); dz = Math.sin(p.facing); l = 1; }
  dx /= l; dz /= l;
  const power = opts.power ?? null;
  const lofted = kind === 'lob' || kind === 'cross';
  const pref = power == null ? null
    : lofted ? 16 + power * 34
    : kind === 'through' ? 12 + power * 26
    : 7 + power * 28;
  const pick = (maxAng) => {
    let best = null, bestScore = -Infinity;
    for (const m of p.team.players) {
      if (m === p || m.sentOff) continue;
      if (m.isGK && kind !== 'pass') continue;
      const vx = m.pos.x - p.pos.x, vz = m.pos.z - p.pos.z;
      const d = Math.hypot(vx, vz);
      if (d < 2.5) continue;
      const ang = Math.acos(clamp((vx * dx + vz * dz) / d, -1, 1));
      if (ang > maxAng) continue;
      let score = -ang * 2.6;
      if (pref != null) score -= Math.abs(d - pref) / (lofted ? 28 : 20);
      else score -= d / (lofted ? 60 : 30);
      if (!lofted && d > 45) score -= (d - 45) / 10;
      if (kind === 'through') {
        // through balls favour the runner: ahead of the ball and moving forward
        score += clamp(((m.pos.x - p.pos.x) * p.team.side) / 40, -0.5, 0.6);
        score += clamp((m.vel.x * p.team.side) / 12, -0.2, 0.4);
      }
      score -= laneBlock(p.pos, m.pos, p.team.opponent) * (lofted ? 0.15 : 0.6);
      if (m.isGK) score -= 1.5;
      if (opts.prev && m === opts.prev) score += 0.3;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  };
  return pick(1.15) || pick(1.75);
}

export function laneBlock(from, to, team) {
  const lx = to.x - from.x, lz = to.z - from.z;
  const L2 = lx * lx + lz * lz;
  let block = 0;
  for (const o of team.players) {
    if (o.sentOff) continue;
    const t = clamp(((o.pos.x - from.x) * lx + (o.pos.z - from.z) * lz) / L2, 0, 1);
    if (t <= 0.02 || t >= 0.98) continue;
    const cx = from.x + lx * t, cz = from.z + lz * t;
    const d = Math.hypot(o.pos.x - cx, o.pos.z - cz);
    block = Math.max(block, clamp(1 - d / 2.5, 0, 1));
  }
  return block;
}

// ---------------------------------------------------------------------------
// Kick helpers
// ---------------------------------------------------------------------------
function statErr(stat, scale) { return (1 - stat / 99) * scale + scale * 0.08; }

function rotateY(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const x = v.x * c - v.z * s, z = v.x * s + v.z * c;
  v.x = x; v.z = z;
  return v;
}

function clampToPitch(t, margin = 1) {
  t.x = clamp(t.x, -PITCH.halfL + margin, PITCH.halfL - margin);
  t.z = clamp(t.z, -PITCH.halfW + margin, PITCH.halfW - margin);
  return t;
}

function leadTarget(m, speedGuess, from) {
  const d = Math.hypot(m.pos.x - from.x, m.pos.z - from.z);
  const t = d / speedGuess;
  return new Vector3(m.pos.x + m.vel.x * t * 0.85, 0, m.pos.z + m.vel.z * t * 0.85);
}

const rollDecel = () => BALL.rollDecel * SURFACE.roll + 0.35;

// Time for a ground ball kicked at v0 to roll `dist` metres (Infinity if it stops short).
function rollTime(v0, dist) {
  const a = rollDecel();
  const disc = v0 * v0 - 2 * a * dist;
  if (disc < 0) return Infinity;
  return (v0 - Math.sqrt(disc)) / a;
}

// Ground pass pace: the held power sets how hard it is struck (from a firm side-foot to a
// fizzing driven pass), never so soft that it fails to reach the target.
function assistedPassSpeed(dist, power, type) {
  const arrive = type === 'through' ? 5 + power * 9 : 6.5 + dist * 0.15 + Math.pow(power, 1.1) * 13;
  return clamp(groundPassSpeed(dist, arrive), 8, 34);
}

// Where to play the ball so a moving receiver meets it, given how the ball is struck.
function leadReceiver(m, from, speedFor, k = 0.9) {
  let target = new Vector3(m.pos.x, 0, m.pos.z);
  for (let i = 0; i < 3; i++) {
    const D = Math.hypot(target.x - from.x, target.z - from.z);
    const t = Math.min(speedFor.time(D), 3);
    target.set(m.pos.x + m.vel.x * t * k, 0, m.pos.z + m.vel.z * t * k);
  }
  return target;
}

// Velocity for a driven ball to pass through `target` at height ty with horizontal speed S
function drivenVelocity(from, target, S) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.hypot(dx, dz) || 0.01;
  const k = BALL.dragK;
  const t = (Math.exp(k * D) - 1) / (k * S);
  const vy = ((target.y ?? BALL.radius) - from.y) / t + 0.5 * BALL.gravity * t;
  return new Vector3((dx / D) * S, vy, (dz / D) * S);
}

function lobVelocity(from, target, angleDeg, backspin, landHeight = BALL.radius) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.hypot(dx, dz) || 0.01;
  const S = solveLobSpeed(D, angleDeg, backspin, landHeight);
  const a = (angleDeg * Math.PI) / 180;
  const h = Math.cos(a) * S;
  const vel = new Vector3((dx / D) * h, Math.sin(a) * S, (dz / D) * h);
  // backspin axis = dir x up
  // backspin axis = d x up (for +x travel that is +z, which gives lift)
  const spin = new Vector3(dx / D, 0, dz / D).cross(UP).multiplyScalar(backspin);
  return { vel, spin };
}

function finishKick(p, match, vel, spin, type, extra = {}) {
  const ball = match.ball;
  if (ball.owner && ball.owner !== p) return false;
  ball.kick(vel, spin, p, type);
  ball.lastKick = { player: p, type, time: match.time, ...extra };
  p.touchCooldown = 0.28;
  p.setState('kick');
  p.kickAnim = 1;
  p.lastKickType = type;
  if (p.state === 'hold') p.state = 'run';
  match.onKick(p, type, extra);
  return true;
}

// Where an assisted ground pass to `receiver` is played, and (for through balls) how hard.
function groundPassTarget(p, type, receiver, power, dir, from) {
  if (type === 'through') {
    // into the space ahead of the runner: their run, the attacking direction and the stick
    const rs = Math.hypot(receiver.vel.x, receiver.vel.z);
    let vx = p.team.side * 1.2 + (rs > 1 ? receiver.vel.x / rs : 0) * 0.8;
    let vz = (rs > 1 ? receiver.vel.z / rs : 0) * 0.8;
    if (dir) { const al = Math.hypot(dir.x, dir.z) || 1; vx += (dir.x / al) * 0.6; vz += (dir.z / al) * 0.6; }
    const vl = Math.hypot(vx, vz) || 1;
    const lead = 5 + power * 13;
    const target = new Vector3(receiver.pos.x + (vx / vl) * lead, 0, receiver.pos.z + (vz / vl) * lead);
    clampToPitch(target, 1.5);
    // weighted into the space: it slows as it reaches the spot so the runner can collect it
    const D = Math.hypot(target.x - from.x, target.z - from.z);
    return { target, speed: groundPassSpeed(D, 3 + power * 5) };
  }
  if (p.team.human) {
    // human assisted ground pass: a straight ball to the receiver's feet, with only a touch of lead
    // (he settles to take it). It is only lost if it is cut out or badly hit.
    const sp = (D) => (type === 'gkThrow' ? Math.min(18, assistedPassSpeed(D, power, type)) : assistedPassSpeed(D, power, type));
    return { target: leadReceiver(receiver, from, { time: (D) => rollTime(sp(D), D) }, 0.25), speed: null };
  }
  const sp = (D) => (type === 'gkThrow' ? Math.min(18, assistedPassSpeed(D, power, type)) : assistedPassSpeed(D, power, type));
  return { target: leadReceiver(receiver, from, { time: (D) => rollTime(sp(D), D) }), speed: null };
}

// Lofted pass: lead the receiver by the ball's hang time (~1-2.5 s).
function lobPassTarget(receiver, from) {
  return leadReceiver(receiver, from, { time: (D) => {
    const ang = D < 18 ? 42 : D < 35 ? 33 : 27;
    const S = solveLobSpeed(D, ang, 7, BALL.radius);
    return (2 * S * Math.sin((ang * Math.PI) / 180)) / BALL.gravity;
  } }, 0.8);
}

// For the on-screen pass indicator: where an assisted pass/through/lob would be played now.
export function previewPassTarget(p, type, receiver, power, dir, match) {
  if (!receiver) return null;
  const from = match.ball.pos;
  const t = type === 'lob' ? lobPassTarget(receiver, from) : groundPassTarget(p, type, receiver, power, dir, from).target;
  return clampToPitch(t, 0.5);
}

// ---------------------------------------------------------------------------
// Ball actions
// ---------------------------------------------------------------------------
export function executeBallAction(p, a, match) {
  const ball = match.ball;
  const s = p.stats;
  const errScale = a.error ?? 1;
  const press = pressureOn(p, match);
  const airborne = ball.pos.y > 1.25 && ball.owner !== p;
  const volley = !airborne && ball.owner !== p && ball.pos.y > 0.4;
  const gkHands = p.isGK && p.state === 'hold';
  const from = ball.pos.clone();
  if (gkHands) from.y = 1.5;
  const power = clamp(a.power ?? 0.5, 0, 1);
  const type = a.type;

  const sp = match.setPiece;
  if (match.phase === 'setpiece' && sp && sp.taker === p && sp.type === 'throwin') return throwIn(p, a, match, power);

  if (airborne && !gkHands) return header(p, a, match, from, press);

  if (type === 'shoot') return shoot(p, a, match, from, power, press, volley, errScale);

  if (type === 'pass' || type === 'through' || type === 'gkThrow') {
    let target, receiver = a.receiver || null;
    let speed = null;
    if (a.target) target = a.target.clone();
    else {
      receiver = receiver || pickReceiver(p, a.dir, match, type, { power });
      if (receiver) ({ target, speed } = groundPassTarget(p, type, receiver, power, a.dir, from));
      else {
        // no receiver: pass into space in the aimed direction, as far as the power says
        let dx = a.dir?.x || Math.cos(p.facing), dz = a.dir?.z || Math.sin(p.facing);
        const l = Math.hypot(dx, dz) || 1;
        const dist = 8 + power * 32;
        target = new Vector3(from.x + (dx / l) * dist, 0, from.z + (dz / l) * dist);
      }
    }
    clampToPitch(target, 0.5);
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    if (speed == null) speed = a.target && a.manual ? groundPassSpeed(dist, 4 + power * 10) : assistedPassSpeed(dist, power, type);
    if (type === 'gkThrow') speed = Math.min(speed, 18);
    speed *= 1 + randn() * statErr(s.passing, 0.06) * errScale;
    const toFeet = !!receiver && type !== 'through' && !a.manual && !a.target && p.team.human;
    const errDeg = randn() * (statErr(s.passing, 5) * (1 + press * 1.2) + (volley ? 4 : 0) + dist * 0.03) * errScale * (toFeet ? 0.35 : 1);
    const dir = new Vector3(target.x - from.x, 0, target.z - from.z).normalize();
    rotateY(dir, (errDeg * Math.PI) / 180);
    const vel = dir.multiplyScalar(speed);
    vel.y = volley ? 1.5 : gkHands ? 1.0 : 0.25;
    return finishKick(p, match, vel, new Vector3(), type, { receiver, target, toFeet });
  }

  if (type === 'lob' || type === 'cross' || type === 'clear' || type === 'gkKick') {
    let target, receiver = a.receiver || null;
    if (a.target) target = a.target.clone();
    else if (type === 'clear' || type === 'gkKick') {
      let dx = a.dir?.x || p.team.side, dz = a.dir?.z || 0;
      if (dx * p.team.side < 0.2) dx = p.team.side;
      const l = Math.hypot(dx, dz);
      const dist = type === 'gkKick' ? 45 + power * 15 : 30 + power * 18;
      target = new Vector3(from.x + (dx / l) * dist, 0, from.z + (dz / l) * dist);
    } else {
      receiver = receiver || pickReceiver(p, a.dir, match, 'lob', { power });
      const inCrossZone = Math.abs(from.z) > PITCH.boxHalfW - 2 && (from.x * p.team.side) > PITCH.halfL - 30;
      if (inCrossZone && (!receiver || (receiver.pos.x * p.team.side) > PITCH.halfL - 20)) {
        // cross into the box: aim for the most advanced attacker in the box, or the penalty spot area
        let best = null, bd = Infinity;
        for (const m of p.team.players) {
          if (m === p || m.isGK) continue;
          const gx = p.team.side * PITCH.halfL;
          const d = Math.hypot(m.pos.x - (gx - p.team.side * 9), m.pos.z);
          if (d < bd) { bd = d; best = m; }
        }
        receiver = best;
        target = best ? leadTarget(best, 16, from) : new Vector3(p.team.side * (PITCH.halfL - 9), 0, -Math.sign(from.z) * 2);
      } else if (receiver) target = lobPassTarget(receiver, from);
      else {
        const dx = a.dir?.x || Math.cos(p.facing), dz = a.dir?.z || Math.sin(p.facing);
        const l = Math.hypot(dx, dz) || 1;
        const dist = 15 + power * 40;
        target = new Vector3(from.x + (dx / l) * dist, 0, from.z + (dz / l) * dist);
      }
    }
    clampToPitch(target, 0.5);
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const isCross = type === 'cross' || (receiver && Math.abs(from.z) > PITCH.boxHalfW - 2);
    let angle = dist < 18 ? 42 : dist < 35 ? 33 : 27;
    if (isCross) angle = 24;
    if (type === 'gkKick') angle = 38;
    if (type === 'clear') angle = 36;
    const backspin = isCross ? 4 : 7;
    // headers are met at ~1.7m: land a touch further for crosses
    const { vel, spin } = lobVelocity(from, target, angle, backspin, isCross ? 1.2 : BALL.radius);
    if (isCross) {
      // whip the cross away from the keeper (curl towards the goal's centre line)
      const side = -Math.sign(from.z) || 1;
      spin.y += side * p.team.side * -6;
    }
    const errDeg = randn() * (statErr(s.passing, 4.5) * (1 + press) + dist * 0.035) * errScale;
    rotateY(vel, (errDeg * Math.PI) / 180);
    vel.multiplyScalar(1 + randn() * statErr(s.passing, 0.05) * errScale);
    return finishKick(p, match, vel, spin, type, { receiver, target });
  }
  return false;
}

function throwIn(p, a, match, power) {
  const from = match.ball.pos.clone();
  from.y = 2.0;
  match.ball.pos.y = 2.0;
  let target;
  let receiver = a.receiver || null;
  if (a.target) target = a.target.clone();
  else {
    receiver = receiver || pickReceiver(p, a.dir, match, 'pass');
    if (receiver && Math.hypot(receiver.pos.x - from.x, receiver.pos.z - from.z) < 30) target = leadTarget(receiver, 11, from);
    else {
      let dx = a.dir?.x || 0, dz = a.dir?.z || -Math.sign(from.z);
      const l = Math.hypot(dx, dz) || 1;
      const dist = 8 + power * 16;
      target = new Vector3(from.x + (dx / l) * dist, 0, from.z + (dz / l) * dist);
    }
  }
  clampToPitch(target, 1);
  const D = Math.min(28, Math.hypot(target.x - from.x, target.z - from.z));
  const long = a.type === 'lob' || a.type === 'cross' || D > 16;
  const { vel } = lobVelocity(from, target, long ? 30 : 18, 0, 0.6);
  if (vel.length() > 17) vel.multiplyScalar(17 / vel.length());
  rotateY(vel, (randn() * 2 * Math.PI) / 180);
  return finishKick(p, match, vel, new Vector3(), 'throwin', { receiver, target });
}

function shotTarget(p, a, match, power) {
  const goalX = p.team.side * PITCH.halfL;
  const from = match.ball.pos;
  let aimZ;
  const dz = a.dir?.z || 0, dx = a.dir?.x || 0;
  if (a.target) return { goalX, tz: a.target.z, ty: a.target.y ?? 0.5 };
  if (Math.hypot(dx, dz) > 0.25 && Math.abs(dz) > 0.2) aimZ = Math.sign(dz) * (0.45 + Math.min(Math.abs(dz), 1) * 0.42);
  else aimZ = from.z > 0.5 ? -0.62 : from.z < -0.5 ? 0.62 : (Math.random() < 0.5 ? -0.6 : 0.6); // far post
  const tz = aimZ * GOAL.halfW;
  const ty = 0.25 + Math.pow(power, 1.7) * 2.2;
  return { goalX, tz, ty };
}

function shoot(p, a, match, from, power, press, volley, errScale) {
  const s = p.stats;
  const { goalX, tz, ty } = shotTarget(p, a, match, power);
  const target = new Vector3(goalX, ty, tz);
  const D = Math.hypot(goalX - from.x, tz - from.z);
  let spin = new Vector3();
  let vel;
  const distF = clamp((D - 12) / 25, 0, 1.5);
  const errBase = statErr(s.shooting, 3.2) * (1 + press * 1.1) * (1 + distF * 0.8) + (volley ? 2.5 : 0);
  const facingOff = Math.abs(angleDiff(p.facing, Math.atan2(tz - from.z, goalX - from.x)));
  const offBalance = clamp((facingOff - 0.7) / 1.5, 0, 1) * 3;

  if (a.chip) {
    const land = new Vector3(goalX, 0, tz * 0.6);
    const ang = clamp(42 + (20 - D) * 0.6, 38, 55);
    const lv = lobVelocity(from, land, ang, 9, 1.6);
    vel = lv.vel; spin = lv.spin;
    vel.multiplyScalar(1 + randn() * 0.035 * errScale * (1 + distF));
  } else {
    let S = 16 + power * 15 + (s.shooting / 99) * 4 + (s.physical / 99) * 2;
    if (a.finesse) S *= 0.78;
    if (volley) S *= 0.92;
    let aim = target.clone();
    if (a.finesse) {
      // curl into the corner: spin around y, aim outside the post so it bends back in.
      const dir = new Vector3(goalX - from.x, 0, tz - from.z).normalize();
      const lat = new Vector3(0, 1, 0).cross(dir); // = up x d
      const towardCentre = Math.sign(-tz * lat.z + 0.0001) || 1; // goal centre z = 0
      const W = 16 + (s.shooting / 99) * 6;
      // lateral accel = k * W * S (using d x... sign handled by wy)
      const t = (Math.exp(BALL.dragK * D) - 1) / (BALL.dragK * S);
      const defl = 0.5 * BALL.magnusK * W * S * 0.85 * t * t;
      aim.addScaledVector(lat, -towardCentre * Math.min(defl, 3.5));
      spin.set(0, towardCentre * W, 0);
      // finesse aims a bit more into the corner
      aim.z = clamp(aim.z, -GOAL.halfW - 3.5, GOAL.halfW + 3.5);
    } else {
      // driven shots carry a little topspin
      const dir = new Vector3(goalX - from.x, 0, tz - from.z).normalize();
      spin.copy(dir).cross(UP).multiplyScalar(-4); // topspin => dips
    }
    vel = drivenVelocity(from, aim, S);
    // power over 0.85 increasingly risks skying it
    if (power > 0.85) vel.y += (power - 0.85) * 18 * Math.random() * (1.2 - s.shooting / 99);
  }
  const errDeg = randn() * (errBase + offBalance) * errScale;
  const errV = randn() * (errBase * 0.5 + offBalance * 0.4) * errScale;
  rotateY(vel, (errDeg * Math.PI) / 180);
  vel.y += errV * 0.35;
  const ok = finishKick(p, match, vel, spin, a.chip ? 'chip' : a.finesse ? 'finesse' : 'shot', { target });
  if (ok) {
    const cross = match.ball.predictCrossX(goalX, 4);
    const onTarget = !!cross && Math.abs(cross.pos.z) < GOAL.halfW && cross.pos.y < GOAL.height;
    if (onTarget) p.team.stats.onTarget++;
    match.events.emit('shot', { player: p, onTarget, power });
  }
  return ok;
}

function header(p, a, match, from, press) {
  const s = p.stats;
  const ball = match.ball;
  let vel;
  const type = a.type === 'shoot' ? 'headerShot' : 'header';
  if (a.type === 'shoot') {
    const goalX = p.team.side * PITCH.halfL;
    const { tz } = shotTarget(p, a, match, 0.5);
    const S = 11 + (s.physical / 99) * 4 + (a.power ?? 0.5) * 4;
    vel = drivenVelocity(from, new Vector3(goalX, 0.4, tz), S);
    const err = randn() * statErr(s.shooting, 7) * (1 + press);
    rotateY(vel, (err * Math.PI) / 180);
    vel.y += randn() * 0.8;
  } else {
    let target;
    const receiver = a.receiver || (a.type === 'clear' ? null : pickReceiver(p, a.dir, match, 'pass'));
    if (a.target) target = a.target;
    else if (receiver) target = receiver.pos;
    else {
      const dx = a.dir?.x || p.team.side, dz = a.dir?.z || 0;
      const l = Math.hypot(dx, dz) || 1;
      target = new Vector3(from.x + (dx / l) * 14, 0, from.z + (dz / l) * 14);
    }
    const D = Math.hypot(target.x - from.x, target.z - from.z);
    const S = clamp(D * 0.7, 6, 14);
    vel = new Vector3(target.x - from.x, 0, target.z - from.z).normalize().multiplyScalar(S);
    vel.y = 2 + D * 0.12;
    rotateY(vel, (randn() * statErr(s.passing, 9) * Math.PI) / 180);
  }
  // inherit a little of the incoming ball speed
  vel.addScaledVector(ball.vel, 0.08);
  return finishKick(p, match, vel, new Vector3(), type, {});
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// Defending
// ---------------------------------------------------------------------------
export function executeTackle(p, match) {
  if (p.state === 'tackle' || p.state === 'slide' || p.isGK && p.state === 'hold') return;
  p.setState('tackle');
  const ball = match.ball;
  const victim = ball.owner && ball.owner.team !== p.team ? ball.owner : null;
  const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
  const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (!victim) {
    // poke a loose ball
    if (!ball.owner && d < 1.5 && ball.pos.y < 0.6) {
      match.giveBall(p);
    }
    return;
  }
  if (d > 1.9) return; // whiff
  const inFront = (dx * fx + dz * fz) / (d || 1);
  const vfx = Math.cos(victim.facing), vfz = Math.sin(victim.facing);
  const fromBehind = ((p.pos.x - victim.pos.x) * vfx + (p.pos.z - victim.pos.z) * vfz) / (d || 1) < -0.35;
  const def = p.stats.defending, drib = victim.stats.dribbling;
  let chance = 0.5 + (def - drib) / 110 + (p.tackleBonus || 0);
  chance -= clamp(1 - inFront, 0, 1) * 0.3;
  chance -= (Math.hypot(victim.vel.x, victim.vel.z) / 9) * 0.12; // harder vs fast dribblers
  if (fromBehind) chance -= 0.2;
  if (victim.shielding) chance -= 0.1 + (victim.stats.physical / 99) * 0.15; // body between man and ball
  const won = Math.random() < clamp(chance, 0.08, 0.92);
  let contact = false;
  if (won) {
    victim.touchCooldown = 0.6;
    if (Math.random() < 0.55) match.giveBall(p);
    else {
      ball.owner = null;
      const v = new Vector3(fx, 0, fz).multiplyScalar(3 + Math.random() * 3);
      rotateY(v, (Math.random() - 0.5) * 1.2);
      ball.kick(v, null, p, 'tackle');
      match.emitTouch(p, 'deflect');
    }
    contact = fromBehind && Math.random() < 0.4;
  } else {
    contact = fromBehind ? Math.random() < 0.6 : Math.random() < 0.12;
  }
  if (contact) { victim.setState('stumble'); if (ball.owner === victim) { ball.owner = null; victim.touchCooldown = 0.5; } }
  p.team.stats.tackles++;
  if (won) p.team.stats.tacklesWon++;
  match.events.emit('tackle', {
    tackler: p, victim, kind: 'tackle', ballFirst: won, contact, fromBehind,
    severity: clamp((fromBehind ? 0.45 : 0.15) + (won ? -0.1 : 0.15) + Math.hypot(p.vel.x, p.vel.z) / 25, 0, 1),
    pos: victim.pos.clone(),
  });
}

export function executeSlide(p, match) {
  const t = p.stateTime;
  if (t > 0.6) { p.slideResolved = true; return; }
  const ball = match.ball;
  const foot = _a.copy(p.slideDir).multiplyScalar(0.85).add(p.pos);
  const bd = Math.hypot(ball.pos.x - foot.x, ball.pos.z - foot.z);
  const owner = ball.owner;
  let ballFirst = false;
  if (bd < 0.8 && ball.pos.y < 0.5 && owner !== p) {
    ballFirst = true;
    if (owner) { owner.touchCooldown = 0.7; }
    ball.owner = null;
    const v = p.slideDir.clone().multiplyScalar(5 + Math.random() * 4);
    rotateY(v, (Math.random() - 0.5) * 0.8);
    ball.kick(v, null, p, 'slide');
    match.emitTouch(p, 'deflect');
  }
  // body contact with opponents
  for (const o of p.team.opponent.players) {
    if (o.sentOff || o.state === 'stumble') continue;
    const od = Math.hypot(o.pos.x - foot.x, o.pos.z - foot.z);
    if (od < 0.85) {
      const vfx = Math.cos(o.facing), vfz = Math.sin(o.facing);
      const dd = Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z) || 1;
      const fromBehind = ((p.pos.x - o.pos.x) * vfx + (p.pos.z - o.pos.z) * vfz) / dd < -0.35;
      const wasOwner = owner === o || ball.lastTouch === o;
      o.setState('stumble');
      if (ball.owner === o) ball.owner = null;
      p.slideResolved = true;
      match.events.emit('tackle', {
        tackler: p, victim: o, kind: 'slide', ballFirst, contact: true, fromBehind,
        severity: clamp(0.35 + (fromBehind ? 0.35 : 0) + (ballFirst ? -0.3 : 0.2) + (wasOwner ? 0 : 0.1), 0, 1),
        pos: o.pos.clone(),
      });
      return;
    }
  }
  if (ballFirst) {
    p.slideResolved = true;
    match.events.emit('tackle', { tackler: p, victim: owner, kind: 'slide', ballFirst: true, contact: false, fromBehind: false, severity: 0.1, pos: p.pos.clone() });
  }
}

export function executeDive(p, a, match) {
  if (!p.isGK || p.state === 'dive' || p.state === 'hold') return;
  const dx = a.dir?.x || 0, dz = a.dir?.z || 0;
  const l = Math.hypot(dx, dz);
  p.setState('dive');
  p.diveHeight = clamp(a.height ?? 0.5, 0, 1);
  const sp = 3.5 + (p.stats.diving / 99) * 3;
  if (l > 0.05) p.diveVel.set((dx / l) * sp, 0, (dz / l) * sp);
  else p.diveVel.set(0, 0, 0);
}

export { rand };
