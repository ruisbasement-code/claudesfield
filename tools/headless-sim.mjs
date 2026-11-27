// Headless AI-vs-AI match for smoke testing the sim. Usage: node tools/headless-sim.mjs [halfMinutes] [difficulty] [--fallback]
import { Match } from '../src/sim/match.js';
import { SIM } from '../src/core/constants.js';
import { TEAMS } from '../src/data/teams.js';
import { createFallbackAI } from '../src/sim/fallbackAI.js';

globalThis.performance ??= { now: () => Date.now() };
const half = Number(process.argv[2] || 4);
const diff = process.argv[3] || 'pro';
const fallback = process.argv.includes('--fallback');
const m = new Match({ homeId: TEAMS[0].id, awayId: TEAMS[2].id, humanSide: 'none', halfMinutes: half, difficulty: diff });
if (fallback) m.ai = m.teams.map((t) => createFallbackAI(m, t, diff));
const counts = {};
m.events.on('*', (name, e) => {
  counts[name] = (counts[name] || 0) + 1;
  if (name === 'goal') console.log(`GOAL ${e.team.data.short} ${Math.floor(m.clock.seconds / 60)}' by ${e.scorer?.data.name} (${e.ownGoal ? 'og' : m.ball.lastKick?.type})`);
});
const t0 = Date.now();
let steps = 0;
const maxSteps = (half * 2 * 60 + 120) / SIM.dt * 1.5;
while (m.phase !== 'fulltime' && steps < maxSteps) {
  m.update(SIM.dt);
  steps++;
  for (const p of m.players) if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) throw new Error('NaN player ' + p.data.name);
  if (!Number.isFinite(m.ball.pos.x)) throw new Error('NaN ball');
}
const [h, a] = m.teams;
console.log(`FT ${h.data.short} ${h.score} - ${a.score} ${a.data.short}  phase=${m.phase} sim ${(steps * SIM.dt).toFixed(0)}s in ${Date.now() - t0}ms`);
for (const t of m.teams) console.log(t.data.short, JSON.stringify({ ...t.stats, possessionTime: Math.round(t.stats.possessionTime) }));
console.log('events', JSON.stringify(counts));
