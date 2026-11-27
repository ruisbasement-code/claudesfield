// AI benchmark: N headless matches, home difficulty vs away difficulty, aggregated stats.
// Usage: node tools/ai-bench.mjs [homeDiff] [awayDiff] [matches] [halfMinutes]
import { Match } from '../src/sim/match.js';
import { SIM } from '../src/core/constants.js';
import { TEAMS } from '../src/data/teams.js';
import { createTeamAI } from '../src/ai/index.js';

globalThis.performance ??= { now: () => Date.now() };
const [hd = 'pro', ad = 'pro', nArg = '4', halfArg = '4'] = process.argv.slice(2);
const N = Number(nArg), half = Number(halfArg);
const keys = ['goals', 'shots', 'onTarget', 'passes', 'passesCompleted', 'tackles', 'tacklesWon', 'saves', 'fouls', 'offsides', 'corners', 'possessionTime'];
const agg = [{}, {}];
const kinds = [{}, {}];
const okBy = {};
const zones = [[0, 0, 0], [0, 0, 0]];
let wins = [0, 0, 0];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const swap = i % 2 === 1; // alternate which team data each difficulty uses
  const m = new Match({ homeId: TEAMS[swap ? 2 : 0].id, awayId: TEAMS[swap ? 0 : 2].id, humanSide: 'none', halfMinutes: half, difficulty: hd });
  for (const ai of m.ai) ai.dispose?.();
  m.ai = [createTeamAI(m, m.teams[0], hd), createTeamAI(m, m.teams[1], ad)];
  let pend = null;
  m.events.on('kick', (e) => { const k = kinds[e.player.team.index]; k[e.type] = (k[e.type] || 0) + 1; pend = { type: e.type, team: e.player.team }; });
  m.events.on('touch', (e) => { if (pend && e.player && e.kind !== 'kick') { const r = okBy[pend.type] ||= [0, 0]; r[1]++; if (e.player.team === pend.team) r[0]++; } if (e.kind !== 'kick') pend = null; });
  let steps = 0;
  const maxSteps = ((half * 2 * 60 + 200) / SIM.dt) * 1.5;
  while (m.phase !== 'fulltime' && steps < maxSteps) {
    m.update(SIM.dt);
    steps++;
    const o = m.ball.owner;
    if (o && m.phase === 'live') { const d = (o.pos.x * o.team.side + 52.5) / 105; const z = zones[o.team.index]; z[d < 0.33 ? 0 : d < 0.67 ? 1 : 2]++; }
  }
  m.teams.forEach((t, j) => { for (const k of keys) agg[j][k] = (agg[j][k] || 0) + (k === 'goals' ? t.score : t.stats[k] || 0); });
  const [h, a] = m.teams;
  wins[h.score > a.score ? 0 : h.score < a.score ? 2 : 1]++;
  if (m.phase !== 'fulltime') console.log('match did not finish, phase', m.phase);
}
console.log(`${hd} vs ${ad}: ${N} matches (${half} min halves) in ${((Date.now() - t0) / 1000).toFixed(1)}s   W/D/L ${wins.join('/')}`);
const poss = agg[0].possessionTime + agg[1].possessionTime || 1;
for (let j = 0; j < 2; j++) {
  const a = agg[j];
  const per = (k) => (a[k] / N).toFixed(1);
  console.log(`${j ? 'away' : 'home'}: goals ${per('goals')} shots ${per('shots')} onT ${per('onTarget')} passes ${per('passes')} (${Math.round((a.passesCompleted / a.passes) * 100)}%) tackles ${per('tackles')}/${per('tacklesWon')} saves ${per('saves')} fouls ${per('fouls')} offsides ${per('offsides')} corners ${per('corners')} poss ${Math.round((a.possessionTime / poss) * 100)}%`);
  console.log('   kicks', JSON.stringify(kinds[j]));
}
console.log('completion by kick type', Object.entries(okBy).map(([k, [a, b]]) => `${k} ${Math.round(a / b * 100)}% of ${b}`).join(', '));
console.log('carrier thirds (own/mid/final) %', zones.map((z) => { const t = z[0] + z[1] + z[2] || 1; return z.map((v) => Math.round(v / t * 100)).join('/'); }).join('  '));
