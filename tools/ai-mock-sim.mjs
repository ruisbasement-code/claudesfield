// Mock sim for exercising the team AI before/independently of the real engine.
// Crude physics: players steer by intent, ball rolls/flies, kicks go to targets.
// Usage: node tools/ai-mock-sim.mjs [homeDifficulty] [awayDifficulty] [minutes]
import { Vector3 } from 'three';
import { EventBus } from '../src/core/events.js';
import { PITCH, GOAL, BALL } from '../src/core/constants.js';
import { createTeamAI } from '../src/ai/index.js';

const [hd = 'pro', ad = 'pro', mins = '10'] = process.argv.slice(2);
const dt = 1 / 60;
const FORM = '4-3-3';

class Ball {
  constructor() { this.pos = new Vector3(0, BALL.radius, 0); this.vel = new Vector3(); this.spin = new Vector3(); this.owner = null; this.lastTouch = null; }
  inAir() { return this.pos.y > BALL.radius + 0.05; }
}

function mkTeam(id, side, diff) {
  const t = { id, side, players: [], human: false, score: 0, data: { formation: FORM }, stats: { shots: 0, passes: 0, passOk: 0, tackles: 0, saves: 0 } };
  t.attackGoal = new Vector3(side * PITCH.halfL, 0, 0);
  t.ownGoal = new Vector3(-side * PITCH.halfL, 0, 0);
  for (let i = 0; i < 11; i++) {
    const s = { pace: 60 + Math.random() * 30, accel: 70, shooting: 55 + Math.random() * 35, passing: 60 + Math.random() * 30, dribbling: 60 + Math.random() * 30, defending: 55 + Math.random() * 35, physical: 70, stamina: 80, diving: 75, reflexes: 75, handling: 75, positioning: 75 };
    t.players.push({ id: id + i, team: t, slot: i, isGK: i === 0, data: { stats: s }, pos: new Vector3(), vel: new Vector3(), facing: 0, stamina: 1, state: 'run', locked: false, sentOff: false, intent: null, hasBall() { return match.ball.owner === this; } });
  }
  return t;
}

const match = { events: new EventBus(), ball: new Ball(), phase: 'live', setPiece: null, difficulty: hd };
const home = mkTeam('H', 1, hd), away = mkTeam('A', -1, ad);
home.opponent = away; away.opponent = home;
match.teams = [home, away];
match.players = [...home.players, ...away.players];
const ais = [createTeamAI(match, home, hd), createTeamAI(match, away, ad)];
const KINDS = [{}, {}]; const DEPTH=[[0,0],[0,0]];
match.events.on("kick", e => { const i = match.teams.indexOf(e.player.team); KINDS[i][e.type] = (KINDS[i][e.type]||0)+1; const d=(e.player.pos.x*e.player.team.side+52.5)/105; DEPTH[i][0]+=d; DEPTH[i][1]++; });

function kickoff(team) {
  for (const t of match.teams) for (const p of t.players) {
    const i = p.slot; const f = [[0.03, 0], [0.22, -0.7], [0.18, -0.25], [0.18, 0.25], [0.22, 0.7], [0.33, 0], [0.42, -0.35], [0.42, 0.35], [0.45, -0.65], [0.48, 0], [0.45, 0.65]][i];
    p.pos.set(t.side * (f[0] * 105 - 52.5), 0, t.side * f[1] * 34); p.vel.set(0, 0, 0);
  }
  match.ball.pos.set(0, BALL.radius, 0); match.ball.vel.set(0, 0, 0); match.ball.owner = null;
  const taker = team.players[9]; taker.pos.set(-team.side * 0.5, 0, 0);
  match.phase = 'setpiece';
  match.setPiece = { type: 'kickoff', team, taker, spot: new Vector3() };
}

let lastKicker = null, kickTime = -9, time = 0;
const T = { goals: [0, 0], shots: [0, 0], onT: [0, 0], passes: [0, 0], passOk: [0, 0], tackles: [0, 0], saves: [0, 0], poss: [0, 0], outs: 0 };
let pendingPass = null;

function kick(p, a) {
  const b = match.ball;
  const st = p.data.stats;
  let tx, tz;
  if (a.target) { tx = a.target.x; tz = a.target.z; } else { tx = p.pos.x + a.dir.x; tz = p.pos.z + a.dir.z; }
  const dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz) || 1;
  const ti = match.teams.indexOf(p.team);
  let speed, vy = 0;
  if (a.type === 'shoot') { speed = 18 + a.power * 12; vy = a.chip ? 7 : (a.target?.y ?? 0.5) * 2; T.shots[ti]++; const onT = Math.abs(tz) < GOAL.halfW; if (onT) T.onT[ti]++; }
  else if (a.type === 'lob' || a.type === 'cross' || a.type === 'gkKick' || a.type === 'clear') { const tf = Math.max(0.6, d / 18); speed = d / tf * 0.95; vy = 9.81 * tf / 2; }
  else { speed = Math.min(26, 6 + d * 0.65); }
  if (['pass', 'through', 'lob', 'cross', 'gkThrow'].includes(a.type)) { T.passes[ti]++; pendingPass = { team: p.team, ti }; }
  // stat error
  const err = (1 - st.passing / 120) * 0.05 * (Math.random() - 0.5);
  const ang = Math.atan2(dz, dx) + err;
  b.vel.set(Math.cos(ang) * speed, vy, Math.sin(ang) * speed);
  b.owner = null; lastKicker = p; kickTime = time; b.lastTouch = p;
  match.events.emit('kick', { player: p, type: a.type, power: a.power });
}

function stepPlayers() {
  for (const p of match.players) {
    if (p.sentOff) continue;
    const it = p.intent || { move: { x: 0, z: 0 } };
    const a = it.action;
    if (a) {
      it.action = null;
      const near = Math.hypot(match.ball.pos.x - p.pos.x, match.ball.pos.z - p.pos.z) < 1.2;
      const ballAct = ['pass', 'through', 'lob', 'cross', 'shoot', 'clear', 'gkThrow', 'gkKick'].includes(a.type);
      if (ballAct && (match.ball.owner === p || (near && !match.ball.owner))) kick(p, a);
      if ((a.type === 'tackle' || a.type === 'slide') && match.ball.owner && match.ball.owner.team !== p.team) {
        const ti = match.teams.indexOf(p.team);
        const d = Math.hypot(match.ball.pos.x - p.pos.x, match.ball.pos.z - p.pos.z);
        if (d < (a.type === 'slide' ? 2.5 : 1.6) && Math.random() < p.data.stats.defending / 140) { match.ball.owner = null; match.ball.vel.set((Math.random() - .5) * 6, 0, (Math.random() - .5) * 6); T.tackles[ti]++; }
      }
      if (a.type === 'dive') {
        const d = Math.hypot(match.ball.pos.x - p.pos.x, match.ball.pos.z - p.pos.z);
        if (d < 3 && Math.random() < 0.7) { match.ball.vel.multiplyScalar(-0.3); T.saves[match.teams.indexOf(p.team)]++; }
      }
    }
    const v = (6.2 + p.data.stats.pace / 99 * 3.2) * (it.sprint ? 1 : 0.72);
    const tvx = it.move.x * v, tvz = it.move.z * v;
    p.vel.x += (tvx - p.vel.x) * Math.min(1, dt * 4);
    p.vel.z += (tvz - p.vel.z) * Math.min(1, dt * 4);
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
    if (Math.hypot(p.vel.x, p.vel.z) > 0.3) p.facing = Math.atan2(p.vel.z, p.vel.x);
  }
}

function stepBall() {
  const b = match.ball;
  if (b.owner) {
    const p = b.owner;
    b.pos.set(p.pos.x + Math.cos(p.facing) * 0.6, BALL.radius, p.pos.z + Math.sin(p.facing) * 0.6);
    b.vel.set(p.vel.x, 0, p.vel.z);
    return;
  }
  const sp = b.vel.length();
  if (b.pos.y > BALL.radius + 0.02 || b.vel.y > 0.3) {
    b.vel.multiplyScalar(1 - BALL.dragK * sp * dt); b.vel.y -= 9.81 * dt;
    b.pos.addScaledVector(b.vel, dt);
    if (b.pos.y < BALL.radius) { b.pos.y = BALL.radius; b.vel.y = -b.vel.y * BALL.restitution; b.vel.x *= 0.78; b.vel.z *= 0.78; if (b.vel.y < 0.8) b.vel.y = 0; }
  } else {
    const h = Math.hypot(b.vel.x, b.vel.z);
    if (h > 0) { const nh = Math.max(0, h - BALL.rollDecel * dt - 0.06 * h * dt); b.vel.x *= nh / h; b.vel.z *= nh / h; }
    b.pos.addScaledVector(b.vel, dt); b.pos.y = BALL.radius;
  }
  // pickup
  if (b.pos.y < 2.0) {
    let best = null, bd = 0.9;
    for (const p of match.players) {
      if (p === lastKicker && time - kickTime < 0.3) continue;
      const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const prev = b.owner;
      b.owner = best; b.lastTouch = best;
      if (pendingPass) { if (pendingPass.team === best.team) T.passOk[pendingPass.ti]++; pendingPass = null; }
      if (match.phase === 'setpiece') { match.phase = 'live'; match.setPiece = null; }
      match.events.emit('possession', { player: best, team: best.team, prev });
    }
  }
}

function checkOut() {
  const b = match.ball;
  if (Math.abs(b.pos.x) > PITCH.halfL) {
    const scorer = b.pos.x > 0 ? match.teams.find((t) => t.side === 1) : match.teams.find((t) => t.side === -1);
    if (Math.abs(b.pos.z) < GOAL.halfW && b.pos.y < GOAL.height) {
      T.goals[match.teams.indexOf(scorer)]++;
      kickoff(scorer.opponent);
    } else {
      T.outs++;
      // goal kick-ish: give it to the defending keeper
      const def = scorer.opponent; const gk = def.players[0];
      b.owner = gk; b.pos.copy(gk.pos); b.vel.set(0, 0, 0); pendingPass = null;
    }
    return;
  }
  if (Math.abs(b.pos.z) > PITCH.halfW) {
    T.outs++;
    const last = b.lastTouch; const team = last ? last.team.opponent : home;
    b.pos.z = Math.sign(b.pos.z) * (PITCH.halfW - 0.3); b.vel.set(0, 0, 0); b.owner = null; pendingPass = null;
    let near = null, nd = 1e9; for (const p of team.players) { if (p.isGK) continue; const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z); if (d < nd) { nd = d; near = p; } }
    near.pos.set(b.pos.x, 0, b.pos.z + Math.sign(b.pos.z) * 0.6); near.vel.set(0, 0, 0);
    match.phase = 'setpiece'; match.setPiece = { type: 'throwin', team, taker: near, spot: b.pos.clone() };
  }
}

kickoff(home);
const total = Number(mins) * 60;
const t0 = Date.now();
let errors = 0;
for (; time < total; time += dt) {
  try { for (const ai of ais) ai.update(dt); } catch (e) { if (errors++ < 3) console.error(e); }
  stepPlayers(); stepBall(); checkOut();
  if (!globalThis.__nan) for (const p of match.players) if (Number.isNaN(p.pos.x)) { globalThis.__nan=1; console.log("NaN", p.id, time.toFixed(2), JSON.stringify(p.intent)); }
  if (match.ball.owner) T.poss[match.teams.indexOf(match.ball.owner.team)]++;
  if (match.phase === 'setpiece' && match.setPiece && time - kickTime > 8 && match.setPiece._t === undefined) match.setPiece._t = time;
  if (match.phase === 'setpiece' && match.setPiece?._t && time - match.setPiece._t > 6) { console.log('stuck setpiece', match.setPiece.type); match.phase = 'live'; match.setPiece = null; }
}
const ps = T.poss[0] + T.poss[1] || 1;
console.log(`${hd} vs ${ad}: ${mins} min in ${Date.now() - t0}ms, errors ${errors}`);
console.log(`goals ${T.goals}  shots ${T.shots} (on target ${T.onT})  passes ${T.passes} completed ${T.passOk}  tackles ${T.tackles}  saves ${T.saves}  possession ${Math.round(T.poss[0] / ps * 100)}%  outs ${T.outs}`);
console.log(JSON.stringify(KINDS), DEPTH.map(a=>(a[0]/a[1]).toFixed(2)));
