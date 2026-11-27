import { Vector3 } from 'three';
import { Match } from '../../src/sim/match.js';
import { SIM } from '../../src/core/constants.js';
globalThis.performance ??= { now: () => Date.now() };
const types = ['pass', 'through', 'lob'];
for (const type of types) for (const dist of [10, 20, 35]) {
  let ok = 0, N = 30, tsum = 0;
  for (let i = 0; i < N; i++) {
    const m = new Match({ homeId: 'kestrel', awayId: 'valdora', humanSide: 'none' });
    m.rules = { preUpdate() {}, update() {} };
    m.ai = [{ update() {} }, { update() {} }];
    m.phase = 'live';
    for (const p of m.players) m.teleport(p, new Vector3(-50 + p.id * 0.3, 0, 33));
    const a = m.teams[0].players[6], b = m.teams[0].players[9];
    m.teleport(a, new Vector3(-10, 0, 0), 0);
    const ang = (Math.random() - 0.5) * 1.2;
    m.teleport(b, new Vector3(-10 + Math.cos(ang) * dist, 0, Math.sin(ang) * dist), 0);
    m.placeBall(new Vector3(-9.5, 0.11, 0)); m.giveBall(a);
    a.intent.action = { type, receiver: b, power: 0.5 };
    let got = null;
    m.events.on('possession', (e) => { if (e.player === b && got == null) got = m.time; });
    m.events.on('touch', (e) => { if (e.player === b && got == null && e.kind === 'control') got = m.time; });
    // receiver: simple AI - run to ball landing / ball
    for (let k = 0; k < 6 / SIM.dt; k++) {
      if (m.ball.owner !== a && !m.ball.owner) {
        const tgt = m.ball.inAir() ? m.ball.predictLanding().pos : m.ball.pos;
        const dx = tgt.x - b.pos.x, dz = tgt.z - b.pos.z, d = Math.hypot(dx, dz);
        b.intent.move = d > 0.3 ? { x: dx / d, z: dz / d } : { x: 0, z: 0 };
        b.intent.sprint = d > 3;
      }
      m.update(SIM.dt);
      if (got != null) break;
    }
    if (got != null) { ok++; tsum += got; }
  }
  console.log(type.padEnd(8), String(dist).padStart(3), 'm  received', ok, '/', N, ' avg t', (tsum / Math.max(ok, 1)).toFixed(2));
}
