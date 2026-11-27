import { Vector3 } from 'three';
import { Match } from '../../src/sim/match.js';
import { SIM } from '../../src/core/constants.js';
globalThis.performance ??= { now: () => Date.now() };
const kinds = [
  ['plain 18m', { type: 'shoot', power: 0.55, dir: { x: 0, z: 0 } }, 18, 3],
  ['aimed 18m', { type: 'shoot', power: 0.55, dir: { x: 0, z: -1 } }, 18, 3],
  ['power 25m', { type: 'shoot', power: 0.85, dir: { x: 0, z: 1 } }, 25, -5],
  ['finesse 18m', { type: 'shoot', power: 0.55, finesse: true, dir: { x: 0, z: 0 } }, 18, 8],
  ['chip 14m', { type: 'shoot', power: 0.5, chip: true, dir: { x: 0, z: 0 } }, 14, 0],
];
for (const [name, act, dist, z] of kinds) {
  let on = 0, goals = 0, saves = 0, N = 60;
  for (let i = 0; i < N; i++) {
    const m = new Match({ homeId: 'kestrel', awayId: 'valdora', humanSide: 'none', halfMinutes: 4 });
    m.rules = { preUpdate() {}, update() {} };
    m.phase = 'live';
    const t = m.teams[0];
    for (const p of m.players) m.teleport(p, new Vector3(-30, 0, (p.id - 11) * 2));
    const gk = m.teams[1].keeper;
    m.teleport(gk, new Vector3(t.side * 51.5, 0, 0), Math.PI);
    const st = t.players[9];
    // keeper positioned
    m.teleport(gk, new Vector3(t.side * (52.5 - 1.5), 0, z * 0.1), Math.PI);
    m.teleport(st, new Vector3(t.side * (52.5 - dist), 0, z), 0);
    m.placeBall(new Vector3(st.pos.x + 0.5, 0.11, z));
    m.giveBall(st);
    let shotOn = null;
    m.events.on('shot', (e) => shotOn = e.onTarget);
    m.events.on('goal', () => goals++);
    m.events.on('save', () => saves++);
    st.intent.action = { ...act };
    for (let k = 0; k < 240 && m.phase === 'live'; k++) { m.update(SIM.dt); }
    if (shotOn) on++;
  }
  console.log(name.padEnd(12), 'on target', on, '/', 60, 'goals', goals, 'saves', saves);
}
