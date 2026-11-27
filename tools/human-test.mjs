// Drives the HumanController with a scripted fake input to check the controls end to end.
import { Vector3 } from 'three';
import { Match } from '../src/sim/match.js';
import { SIM } from '../src/core/constants.js';
import { HumanController } from '../src/input/humanController.js';

globalThis.performance ??= { now: () => Date.now() };
class FakeInput {
  constructor() { this.cur = {}; this.prev = {}; this.mv = { x: 0, y: 0 }; }
  set(a, v) { this.cur[a] = v; }
  step() { this.prev = { ...this.cur }; }
  isDown(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  released(a) { return !this.cur[a] && !!this.prev[a]; }
  moveVector() { return this.mv; }
}
const basis = () => ({ up: { x: 0, z: -1 }, right: { x: 1, z: 0 } });
const m = new Match({ homeId: 'kestrel', awayId: 'valdora', humanSide: 'home', halfMinutes: 4, difficulty: 'amateur' });
const inp = new FakeInput();
const hc = new HumanController(m, m.teams[0], inp, basis);
m.humanControllers = [hc];
const log = [];
m.events.on('*', (n, e) => { if (['kick', 'shot', 'goal', 'save', 'message'].includes(n)) log.push(`${n}:${e.type || e.text || ''}@${e.player?.team.id || e.team?.id || ''} ${e.onTarget ?? ''}`); });
const run = (sec) => { for (let i = 0; i < sec / SIM.dt; i++) { m.update(SIM.dt); inp.step(); } };
const tap = (a, hold = 0.15) => { inp.set(a, true); run(hold); inp.set(a, false); run(SIM.dt * 2); };

// wait for a home kickoff or force one
run(1);
const team = m.teams[0];
if (m.setPiece?.team !== team) {
  m.rules.restart = null;
  const taker = team.players[9];
  m.startSetPiece({ type: 'kickoff', team, taker, spot: new Vector3(0, 0, 0) });
}
console.log('setpiece', m.setPiece?.type, m.setPiece?.team.id, 'controlled', team.controlled?.data.name, 'taker', m.setPiece?.taker.data.name);
inp.mv = { x: -1, y: 0 };
tap('pass');
inp.mv = { x: 0, y: 0 };
run(2);
console.log('after kickoff pass: owner', m.ball.owner?.data.name, m.ball.owner?.team.id, 'controlled', team.controlled?.data.name);

// put the ball at a home striker's feet 20 m from goal and shoot
const st = team.players[9];
m.teleport(st, new Vector3(team.side * 32, 0, 4), team.side > 0 ? 0 : Math.PI);
m.placeBall(new Vector3(team.side * 32 + team.side * 0.5, 0.11, 4));
m.giveBall(st);
m.setControlled(team, st);
for (const o of m.teams[1].players) if (!o.isGK) m.teleport(o, new Vector3(-team.side * 10, 0, o.pos.z));
inp.mv = { x: 0, y: -1 };
tap('shoot', 0.5);
run(2);
console.log(log.join('\n'));
console.log('score', m.teams[0].score, m.teams[1].score, 'phase', m.phase);
