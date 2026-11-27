// Minimal fallback ruleset so the core is playable on its own:
// clock, goals, throw-ins, corners, goal kicks, kick-offs, half time, full time.
// The rules thread replaces this via src/rules/index.js.
import { Vector3 } from 'three';
import { PITCH } from '../core/constants.js';
import { kickoffLayout } from '../sim/formation.js';

export class BasicRules {
  constructor(match) {
    this.match = match;
    this.pending = null; // { at, fn }
    const ev = match.events;
    ev.on('goal', (e) => this.onGoal(e));
    ev.on('ballOut', (e) => this.onOut(e));
    this.started = false;
  }

  later(delay, fn) { this.pending = { at: this.match.time + delay, fn }; }

  kickoff(team) {
    const m = this.match;
    const taker = kickoffLayout(m, team);
    m.startSetPiece({ type: 'kickoff', team, taker, spot: new Vector3(0, 0, 0) });
    m.events.emit('whistle', { kind: 'short' });
  }

  preUpdate(dt) {
    const m = this.match;
    if (!this.started) {
      this.started = true;
      this.kickoff(m.teams[0]);
      m.clock.running = true;
    }
    if (this.pending && m.time >= this.pending.at) {
      const fn = this.pending.fn;
      this.pending = null;
      fn();
    }
    if (m.clock.running && (m.phase === 'live' || m.phase === 'setpiece')) {
      const scale = (45 * 60) / ((m.config.halfMinutes || 4) * 60);
      m.clock.seconds += dt * scale;
      const end = m.clock.half * 45 * 60;
      if (m.clock.seconds >= end && m.phase === 'live') this.endHalf();
    }
  }

  update() {}

  endHalf() {
    const m = this.match;
    m.clock.running = false;
    m.stopPlay('half');
    m.events.emit('whistle', { kind: 'long' });
    if (m.clock.half === 1) {
      m.setPhase('halftime');
      m.events.emit('message', { text: 'Half time' });
      this.later(3, () => {
        m.clock.half = 2;
        m.clock.seconds = 45 * 60;
        m.swapSides();
        m.clock.running = true;
        this.kickoff(m.teams[1]);
      });
    } else {
      m.setPhase('fulltime');
      m.events.emit('message', { text: 'Full time' });
    }
  }

  onGoal(e) {
    const m = this.match;
    e.team.score++;
    m.events.emit('message', { text: e.ownGoal ? 'Own goal' : 'Goal', kind: 'goal' });
    this.later(3.5, () => this.kickoff(e.team.opponent));
  }

  onOut(e) {
    const m = this.match;
    const last = e.lastTouch;
    const lastTeam = last ? last.team : m.teams[0];
    const other = lastTeam.opponent;
    if (e.line === 'side') {
      const spot = new Vector3(Math.max(-PITCH.halfL + 1, Math.min(PITCH.halfL - 1, e.pos.x)), 0, Math.sign(e.pos.z) * PITCH.halfW);
      this.later(1.2, () => m.startSetPiece({ type: 'throwin', team: other, spot }));
      return;
    }
    const sx = Math.sign(e.pos.x);
    // team defending this goal line
    const defending = m.teams.find((t) => t.ownGoal.x * sx > 0);
    if (lastTeam === defending) {
      const spot = new Vector3(sx * (PITCH.halfL - 0.3), 0, Math.sign(e.pos.z || 1) * (PITCH.halfW - 0.3));
      defending.opponent.stats.corners++;
      this.later(1.5, () => m.startSetPiece({ type: 'corner', team: defending.opponent, spot }));
    } else {
      const spot = new Vector3(sx * (PITCH.halfL - PITCH.sixDepth), 0, Math.sign(e.pos.z || 1) * 5);
      this.later(1.5, () => m.startSetPiece({ type: 'goalkick', team: defending, taker: defending.keeper, spot }));
    }
  }
}
