// Match statistics gathered from match.events, plus summarize(match) for pause/result screens.
// Works with the documented Match API (ARCHITECTURE.md); every field is read defensively.

export const STAT_ROWS = [
  ['possession', 'Possession', (v) => `${Math.round(v)}%`],
  ['shots', 'Shots'],
  ['shotsOnTarget', 'On target'],
  ['xg', 'Expected goals', (v) => v.toFixed(1)],
  ['passes', 'Passes'],
  ['passAccuracy', 'Pass accuracy', (v) => `${Math.round(v)}%`],
  ['tackles', 'Tackles won'],
  ['saves', 'Saves'],
  ['corners', 'Corners'],
  ['offsides', 'Offsides'],
  ['fouls', 'Fouls'],
  ['yellows', 'Yellow cards'],
  ['reds', 'Red cards'],
];

const PASS_TYPES = new Set(['pass', 'through', 'lob', 'cross']);
const sideOf = (team) => (team == null ? null : team.id === 'away' || team.index === 1 ? 'away' : 'home');

export class StatsTracker {
  constructor(match) {
    this.match = match;
    this.t = { home: blank(), away: blank() };
    this.players = new Map(); // player -> {goals, assists, shots, passes, completed, tackles, saves, cards}
    this.goals = [];
    this.pendingPass = null;
    this.lastPasser = null;
    this.possTime = { home: 0, away: 0 };
    const ev = match.events;
    this.off = [];
    const on = (n, f) => { if (ev?.on) this.off.push(ev.on(n, f)); };
    on('kick', (p) => this.onKick(p));
    on('possession', (p) => this.onPossession(p));
    on('shot', (p) => this.onShot(p));
    on('tackle', (p) => this.onTackle(p));
    on('save', (p) => this.onSave(p));
    on('goal', (p) => this.onGoal(p));
    on('card', (p) => { const s = this.ps(p.player); if (s) s.cards.push(p.color); });
  }
  dispose() { for (const f of this.off) try { f?.(); } catch (e) { /* */ } }

  ps(player) {
    if (!player) return null;
    let s = this.players.get(player);
    if (!s) { s = { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, completed: 0, tackles: 0, saves: 0, cards: [], keyPasses: 0 }; this.players.set(player, s); }
    return s;
  }

  tick(dt) {
    const m = this.match;
    if (!m || m.paused) return;
    if (m.phase !== 'live' && m.phase !== 'setpiece') return;
    const side = sideOf(m.possession);
    if (side) this.possTime[side] += dt;
  }

  onKick({ player, type }) {
    const side = sideOf(player?.team);
    if (!side) return;
    if (PASS_TYPES.has(type)) {
      this.t[side].passes++;
      this.ps(player).passes++;
      this.pendingPass = { player, side };
    } else this.pendingPass = null;
  }
  onPossession({ player, team }) {
    const side = sideOf(team || player?.team);
    if (this.pendingPass) {
      if (this.pendingPass.side === side && player !== this.pendingPass.player) {
        this.t[side].completed++;
        this.ps(this.pendingPass.player).completed++;
        this.lastPasser = { player: this.pendingPass.player, receiver: player, side, time: performance.now() };
      } else this.lastPasser = null;
      this.pendingPass = null;
    } else if (this.lastPasser && this.lastPasser.side !== side) this.lastPasser = null;
  }
  onShot({ player, onTarget }) {
    const side = sideOf(player?.team);
    if (!side) return;
    const t = this.t[side];
    t.shots++; if (onTarget) t.shotsOnTarget++;
    const s = this.ps(player); s.shots++; if (onTarget) s.onTarget++;
    // crude xG from distance and angle to goal
    const g = player.team?.attackGoal;
    if (g && player.pos) {
      const dx = Math.abs(g.x - player.pos.x), dz = Math.abs((g.z ?? 0) - player.pos.z);
      const d = Math.hypot(dx, dz);
      const angle = Math.atan2(7.32 * dx, dx * dx + dz * dz - 3.66 * 3.66);
      t.xg += Math.min(0.85, Math.max(0.02, 1.1 * Math.max(0, angle) * Math.exp(-d / 22)));
    }
    if (this.lastPasser && this.lastPasser.receiver === player) this.ps(this.lastPasser.player).keyPasses++;
  }
  onTackle({ tackler, ballFirst, contact }) {
    const side = sideOf(tackler?.team);
    if (side && ballFirst !== false && contact !== false) { this.t[side].tackles++; this.ps(tackler).tackles++; }
  }
  onSave({ keeper }) {
    const side = sideOf(keeper?.team);
    if (side) { this.t[side].saves++; this.ps(keeper).saves++; }
  }
  onGoal({ team, scorer, ownGoal }) {
    const side = sideOf(team);
    const m = this.match;
    const minute = minuteLabel(m?.clock);
    const assist = !ownGoal && this.lastPasser && this.lastPasser.receiver === scorer ? this.lastPasser.player : null;
    if (scorer && !ownGoal) this.ps(scorer).goals++;
    if (assist) this.ps(assist).assists++;
    this.goals.push({ team: side, scorer: nameOf(scorer), minute, ownGoal: !!ownGoal, assist: nameOf(assist), penalty: m?.setPiece?.type === 'penalty' });
    this.lastPasser = null;
  }
}

function blank() { return { shots: 0, shotsOnTarget: 0, passes: 0, completed: 0, tackles: 0, saves: 0, xg: 0 }; }

export function nameOf(p) { return p ? (p.data?.short || p.data?.name || p.name || '') : ''; }

export function minuteLabel(clock) {
  if (!clock) return '';
  const s = clock.seconds ?? 0;
  const half = clock.half || 1;
  const regEnd = [0, 45, 90, 105, 120][half] ?? 90;
  const m = Math.floor(s / 60) + 1;
  return m > regEnd ? `${regEnd}+${m - regEnd}'` : `${m}'`;
}

/** Collect everything the pause/result screens show. Accepts a Match (+ optional tracker). */
export function summarize(match, tracker) {
  if (!match || !match.teams) return match || null;
  const sides = ['home', 'away'];
  const out = { minute: minuteLabel(match.clock), phase: match.phase };
  const pt = (i, side) => match.teams[i].stats?.possessionTime ?? tracker?.possTime[side] ?? 0;
  const totalPoss = pt(0, 'home') + pt(1, 'away');
  sides.forEach((side, i) => {
    const team = match.teams[i];
    const ts = team.stats || {};
    const tr = tracker?.t[side] || blank();
    const passes = ts.passes ?? tr.passes;
    const completed = ts.passesCompleted ?? tr.completed;
    out[side] = {
      id: team.data?.id, name: team.data?.name, short: team.data?.short, data: team.data, kit: team.kit,
      score: team.score ?? 0,
      stats: {
        possession: totalPoss > 0 ? (pt(i, side) / totalPoss) * 100 : 50,
        shots: ts.shots ?? tr.shots,
        shotsOnTarget: ts.onTarget ?? ts.shotsOnTarget ?? tr.shotsOnTarget,
        xg: tr.xg,
        passes,
        passAccuracy: passes ? (completed / passes) * 100 : 0,
        tackles: ts.tacklesWon ?? ts.tackles ?? tr.tackles,
        saves: ts.saves ?? tr.saves,
        corners: ts.corners ?? 0,
        offsides: ts.offsides ?? 0,
        fouls: ts.fouls ?? 0,
        yellows: ts.yellows ?? ts.yellow ?? 0,
        reds: ts.reds ?? ts.red ?? 0,
      },
    };
  });
  const log = match.goalsLog || match.result?.goals;
  out.goals = log ? log.map((g) => ({ ...g, scorer: typeof g.scorer === 'string' ? g.scorer : nameOf(g.scorer) })) : tracker?.goals || [];
  const so = match.shootout;
  if (match.result?.pens) out.pens = match.result.pens;
  else if (so && (so.active || so.done) && so.kicks) out.pens = { home: so.kicks.home.filter(Boolean).length, away: so.kicks.away.filter(Boolean).length };
  out.shootout = so?.kicks ? so : null;
  out.winner = match.result?.winner ?? (out.home.score > out.away.score ? 'home' : out.away.score > out.home.score ? 'away' : out.pens ? (out.pens.home > out.pens.away ? 'home' : 'away') : null);
  out.motm = manOfTheMatch(match, tracker, out);
  return out;
}

function manOfTheMatch(match, tracker, out) {
  let best = null, bestScore = -Infinity;
  for (const p of match.players || []) {
    const s = tracker?.players.get(p) || { goals: 0, assists: 0, shots: 0, onTarget: 0, passes: 0, completed: 0, tackles: 0, saves: 0, cards: [], keyPasses: 0 };
    const side = sideOf(p.team);
    const won = out.winner === side ? 0.4 : out.winner ? -0.2 : 0;
    let r = 6.2 + won + s.goals * 1.1 + s.assists * 0.7 + s.keyPasses * 0.15 + s.onTarget * 0.15 + s.completed * 0.03
      + s.tackles * 0.2 + s.saves * 0.35 - s.cards.filter((c) => c === 'yellow').length * 0.4 - (s.cards.includes('red') ? 2 : 0)
      + ((p.data?.overall || 70) - 75) * 0.02;
    if (p.isGK && side) { const conceded = out[side === 'home' ? 'away' : 'home'].score; r += conceded === 0 ? 0.8 : -conceded * 0.25; }
    r = Math.max(3, Math.min(10, r));
    if (r > bestScore) { bestScore = r; best = { player: p, stats: s, rating: r, side }; }
  }
  if (!best) return null;
  const d = best.player.data || {};
  return { name: d.name || nameOf(best.player), number: d.number, pos: d.pos, side: best.side, rating: best.rating, stats: best.stats };
}
