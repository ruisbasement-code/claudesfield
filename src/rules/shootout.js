// Penalty shootout: five kicks each, alternating, then sudden death.
// All kicks are taken at the +x goal (sides are swapped so the shooting team
// always attacks +x). HUD reads match.shootout:
//   { active, kicks:{home:[bool], away:[bool]}, first:'home'|'away', current:{team, taker}|null, done, winner }
import { activePlayers, keeperOf } from './geometry.js';

export class Shootout {
  constructor(match, referee) {
    this.match = match;
    this.ref = referee;
    const [home, away] = match.teams;
    this.first = Math.random() < 0.5 ? home : away;
    this.queues = new Map(match.teams.map((t) => [t, this.order(t)]));
    this.used = new Map(match.teams.map((t) => [t, 0]));
    this.cur = null;
    this.state = match.shootout = {
      active: true, kicks: { home: [], away: [] }, first: this.first.id, current: null, done: false, winner: null,
    };
  }

  // Best penalty takers first, keeper last.
  order(team) {
    const score = (p) => (p.data?.stats?.shooting ?? 50) * 0.8 + (p.data?.stats?.physical ?? 50) * 0.1 + (p.data?.stats?.passing ?? 50) * 0.1;
    const field = activePlayers(team).filter((p) => !p.isGK).sort((a, b) => score(b) - score(a));
    const gk = activePlayers(team).filter((p) => p.isGK);
    return field.concat(gk);
  }

  taken(team) { return this.state.kicks[team.id].length; }
  goals(team) { return this.state.kicks[team.id].filter(Boolean).length; }

  decided() {
    const a = this.first, b = this.first.opponent;
    const na = this.taken(a), nb = this.taken(b), sa = this.goals(a), sb = this.goals(b);
    if (na <= 5 && nb <= 5) {
      if (sa > sb + (5 - nb)) return a;
      if (sb > sa + (5 - na)) return b;
      if (na < 5 || nb < 5) return null;
    }
    if (na === nb && sa !== sb) return sa > sb ? a : b;
    return null;
  }

  next() {
    const m = this.match, ref = this.ref;
    const winner = this.decided();
    if (winner) return this.finish(winner);
    const total = this.taken(m.teams[0]) + this.taken(m.teams[1]);
    const team = total % 2 === 0 ? this.first : this.first.opponent;
    if (team.side !== 1) m.swapSides();
    const q = this.queues.get(team);
    const i = this.used.get(team);
    this.used.set(team, i + 1);
    const taker = q[i % q.length];
    this.cur = { team, taker, kicked: false, t: 0, resolved: false, holdT: 0 };
    this.state.current = { team: team.id, taker };
    ref.setupRestart({ type: 'penalty', team, taker, spot: null });
    const n = this.taken(team) + 1;
    ref.say(`${team.data?.short ?? team.data?.name ?? team.id} – kick ${n}: ${taker.data?.short ?? taker.data?.name ?? ''}`, 'info');
  }

  onKick(taker) {
    if (!this.cur || taker !== this.cur.taker) return;
    this.cur.kicked = true;
    this.cur.t = 0;
  }

  onTouch(player) {
    const c = this.cur;
    if (!c || !c.kicked || c.resolved) return;
    if (player === c.taker && c.t > 0.2) this.resolve(false); // no second touch for the taker
  }

  onGoal(e) {
    const c = this.cur;
    if (!c || !c.kicked || c.resolved) return;
    // Only goals in the goal the shooter is attacking count.
    const gx = Math.sign(e?.pos?.x ?? this.match.ball.pos.x);
    this.resolve(gx === c.team.side);
  }

  onOut() { if (this.cur?.kicked && !this.cur.resolved) this.resolve(false); }
  onSave() { /* wait: the ball may still spin in */ }

  update(dt) {
    const c = this.cur;
    if (!c || !c.kicked || c.resolved) return;
    c.t += dt;
    const ball = this.match.ball;
    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
    const gk = keeperOf(c.team.opponent);
    if (ball.owner && ball.owner === gk) c.holdT += dt;
    // moving away from goal after a save, or stopped, or held by the keeper
    const away = ball.vel.x * c.team.side < -1 && Math.abs(ball.pos.x) < 40;
    if (c.holdT > 0.25 || (c.t > 1 && speed < 0.5) || (c.t > 1.2 && away) || c.t > 5) this.resolve(false);
  }

  resolve(scored) {
    const c = this.cur, ref = this.ref;
    c.resolved = true;
    this.state.kicks[c.team.id].push(scored);
    ref.stopPlay(scored ? 'goal' : 'miss');
    ref.say(scored ? 'Scored!' : 'Missed!', scored ? 'goal' : 'info');
    ref.emit('shootoutKick', { team: c.team, taker: c.taker, scored });
    ref.after(2.4, () => { ref.setPhase('shootout'); ref.mode = 'shootout'; this.next(); });
  }

  finish(winner) {
    const m = this.match;
    const [home, away] = m.teams;
    this.state.done = true;
    this.state.active = false;
    this.state.current = null;
    this.state.winner = winner.id;
    this.cur = null;
    const pens = { home: this.goals(home), away: this.goals(away) };
    this.ref.say(`${winner.data?.name ?? winner.id} win ${Math.max(pens.home, pens.away)}–${Math.min(pens.home, pens.away)} on penalties`, 'period');
    this.ref.whistle('long');
    this.ref.finish(pens);
  }
}
