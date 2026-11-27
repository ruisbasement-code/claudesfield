// The referee: owns the clock, periods, every stoppage and every restart.
//
// Flow:  play --(ballOut/goal/foul/offside)--> stoppage --(delay)--> restart setup
//        --> setpiece (waiting for the taker) --(first touch by taker)--> play
// Goals add a celebration and an optional replay before the kick-off.
import { Vector3 } from 'three';
import { PITCH, GOAL, clamp } from '../core/constants.js';
import {
  ownGoalX, attackGoalX, dist2D, angleTo, activePlayers, outfield, keeperOf, nearest, inOwnBox,
} from './geometry.js';
import { OffsideTracker } from './offside.js';
import { judgeTackle } from './fouls.js';
import { Officials } from './officials.js';
import { ReplayRecorder } from './replay.js';
import {
  arrangeKickoff, arrangePenalty, buildWall, enforceZones, freeKickSpot, throwInSpot, cornerSpot,
  goalKickSpot, pickNearestTaker, pickSpecialist, placeTaker,
} from './setpieces.js';
import { Shootout } from './shootout.js';

const HALF = 45 * 60, ET_HALF = 15 * 60;
const PERIOD_START = [0, 0, HALF, 2 * HALF, 2 * HALF + ET_HALF];
const PERIOD_END = [0, HALF, 2 * HALF, 2 * HALF + ET_HALF, 2 * HALF + 2 * ET_HALF];
const DELIBERATE = new Set(['control', 'kick', 'header', 'catch']);

export class Referee {
  constructor(match) {
    this.match = match;
    this.cfg = match.config ?? {};
    this.mode = 'pre'; // pre | play | restart | setpiece | celebrate | replay | break | shootout | over
    this.timers = [];
    this.locked = new Set();
    this.offside = new OffsideTracker(match);
    this.officials = new Officials(match);
    this.recorder = new ReplayRecorder(match);
    this.shootout = null;
    this.restart = null;     // the restart currently being taken / just taken
    this.advantage = null;   // { foul, time, team }
    this.pendingCards = [];  // cards held back while advantage is played
    this.periodStats = { goals: 0, cards: 0, fouls: 0, subs: 0, setpieces: 0 };
    this.firstKickoff = Math.random() < 0.5 ? match.teams[0] : match.teams[1];
    this.lastTouchFrame = { player: null, n: -1 };
    this.frame = 0;
    this.setpieceTime = 0;
    this.endPending = false;
    this.goals = [];
    match.goalsLog = this.goals;
    match.rules = this;

    const clk = match.clock ?? (match.clock = {});
    Object.assign(clk, { seconds: 0, half: 1, addedTime: 0, running: false });

    const ev = match.events;
    ev.on('touch', (e) => this.onPlayed(e.player, e.kind ?? 'control'));
    ev.on('kick', (e) => this.onPlayed(e.player, 'kick'));
    ev.on('ballOut', (e) => this.onBallOut(e));
    ev.on('goal', (e) => this.onGoal(e));
    ev.on('tackle', (e) => this.onTackle(e));
    ev.on('save', (e) => this.shootout?.onSave(e));
  }

  // ------------------------------------------------------------------ helpers
  get scale() { return (45 * 60) / ((this.cfg.halfMinutes ?? 4) * 60); }
  emit(name, payload) { this.match.events.emit(name, payload); }
  say(text, kind = 'info') { this.emit('message', { text, kind }); }
  whistle(kind = 'short') { this.emit('whistle', { kind }); this.officials.gesture('whistle', 0.7); }
  after(t, fn, tag = null) { this.timers.push({ t, fn, tag }); }
  clearTimers(tag) {
    if (!tag) { this.timers.length = 0; return; }
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].tag === tag) this.timers.splice(i, 1);
  }
  setPhase(phase) {
    const m = this.match;
    if (m.phase === phase) return;
    const prev = m.phase; m.phase = phase;
    this.emit('phase', { phase, prev });
  }
  lock(p, target = null) { p.locked = true; p.lockTarget = target; this.locked.add(p); }
  releaseLocks() {
    for (const p of this.locked) { if (!p.sentOff) { p.locked = false; p.lockTarget = null; } p.inWall = false; }
    this.locked.clear();
  }
  stat(team, key, n = 1) { if (team?.stats) team.stats[key] = (team.stats[key] ?? 0) + n; }
  minuteOf(seconds = this.match.clock.seconds) { return Math.floor(seconds / 60) + 1; }
  minuteLabel() {
    const c = this.match.clock, end = PERIOD_END[c.half];
    if (c.seconds >= end) return `${end / 60}+${Math.floor((c.seconds - end) / 60) + 1}'`;
    return `${this.minuteOf()}'`;
  }
  controlFor(team, player) { if (team.human && player) this.match.setControlled?.(team, player); }

  stopPlay(reason) {
    const m = this.match;
    if (m.phase === 'live' || m.phase === 'setpiece') m.stopPlay(reason);
    else this.setPhase('stopped');
    this.offside.reset();
  }

  // ------------------------------------------------------------------ contract
  preUpdate(dt) {
    const m = this.match;
    this.frame++;
    for (let i = 0; i < this.timers.length; i++) {
      const tm = this.timers[i];
      if ((tm.t -= dt) <= 0) { this.timers.splice(i--, 1); tm.fn(); }
    }
    if (this.mode === 'pre') this.beginMatch();

    const c = m.clock;
    // The clock stops for goals/replays/breaks and while waiting for any kick-off.
    c.running = ['play', 'restart', 'setpiece'].includes(this.mode) && !this.shootout && this.pendingType !== 'kickoff';
    if (c.running) {
      c.seconds += dt * this.scale;
      this.checkPeriodEnd();
    }
  }

  update(dt) {
    const m = this.match;
    if (this.mode === 'replay') {
      if (this.recorder.advance(dt)) this.afterReplay();
    } else {
      this.recorder.record(dt);
    }
    this.offside.update();
    this.officials.update(dt, this.offside.lines);

    if (m.setPiece && (m.phase === 'setpiece')) {
      enforceZones(m, m.setPiece);
      this.setpieceTime += dt;
      this.fallbackTaker();
    } else if (this.mode === 'setpiece' && m.phase === 'live' && this.restart && !this.restart.taken) {
      // core resumed play without us seeing the touch – treat as taken
      this.onRestartTaken();
    }
    if (this.advantage) this.updateAdvantage(dt);
    this.shootout?.update(dt);
  }

  skipReplay() {
    if (this.mode === 'replay') { this.recorder.stop(); this.afterReplay(); }
  }

  // ------------------------------------------------------------------ periods
  beginMatch() {
    const m = this.match;
    m.result = null;
    if (this.cfg.mode === 'penalties' || this.cfg.mode === 'shootout') { this.startShootout(); return; }
    this.startPeriod(1);
  }

  startPeriod(half) {
    const m = this.match, c = m.clock;
    c.half = half; c.seconds = PERIOD_START[half]; c.addedTime = 0;
    this.endPending = false;
    this.periodStats = { goals: 0, cards: 0, fouls: 0, subs: 0, setpieces: 0 };
    const kickTeam = half % 2 === 1 ? this.firstKickoff : this.firstKickoff.opponent;
    if (half === 3) this.firstKickoff = this.firstKickoff.opponent; // fresh toss for extra time
    if (half > 1) m.swapSides();
    this.officials.reset();
    const label = ['', 'First half', 'Second half', 'Extra time, first half', 'Extra time, second half'][half];
    this.say(label, 'period');
    this.kickoff(half === 3 ? this.firstKickoff : kickTeam, 1.6);
  }

  checkPeriodEnd() {
    const m = this.match, c = m.clock;
    const end = PERIOD_END[c.half];
    if (c.seconds >= end - 60 && !c.addedAnnounced) {
      c.addedAnnounced = true;
      const ps = this.periodStats;
      const base = c.half === 1 || c.half === 3 ? 1 : 2;
      const extra = ps.goals * 0.6 + ps.cards * 0.4 + ps.fouls * 0.12 + ps.setpieces * 0.03 + Math.random() * 1.4;
      c.addedTime = clamp(Math.round(base + extra), c.half >= 3 ? 0 : 1, c.half % 2 ? 4 : 7);
      if (c.addedTime > 0) this.say(`+${c.addedTime} min added`, 'added');
    }
    if (c.seconds < end + c.addedTime * 60) return;
    this.endPending = true;
    // Don't blow in the middle of an attack (or before a penalty is taken).
    const overrun = c.seconds - (end + c.addedTime * 60);
    if (this.mode === 'setpiece' && m.setPiece?.type === 'penalty') return;
    if (this.mode === 'play' && overrun < 60) {
      const b = m.ball.pos;
      if (Math.abs(b.x) > PITCH.halfL - 28 && Math.abs(b.z) < 30) return;
    }
    if (this.mode === 'play' || this.mode === 'setpiece' || this.mode === 'restart' || overrun > 90) this.endPeriod();
  }

  endPeriod() {
    const m = this.match, c = m.clock;
    this.clearTimers();
    this.advantage = null;
    this.flushCards();
    this.stopPlay('period');
    this.releaseLocks();
    c.addedAnnounced = false;
    const half = c.half;
    const [h, a] = m.teams.map((t) => t.score);
    const level = h === a;
    let next = null;
    if (half === 1) next = () => this.startPeriod(2);
    else if (half === 2 && level && this.cfg.extraTime) next = () => this.startPeriod(3);
    else if (half === 3) next = () => this.startPeriod(4);
    else if (level && (this.cfg.penalties || this.cfg.shootout)) next = () => this.startShootout();
    this.whistle(next && (half === 1 || half === 3) ? 'double' : 'long');
    this.mode = 'break';
    if (next) {
      this.setPhase('halftime');
      this.say(half === 1 ? 'Half time' : half === 2 ? (this.cfg.extraTime && level ? 'Full time – extra time' : 'Full time – penalties') : half === 3 ? 'End of first half of extra time' : 'Penalties!', 'period');
      this.breakNext = next;
      if (!this.cfg.halftimeWait) this.after(this.cfg.breakSeconds ?? 4.5, () => this.continueFromBreak());
    } else {
      this.finish();
    }
  }

  // UI may call this to leave the half-time screen early.
  continueFromBreak() {
    if (this.mode !== 'break' || !this.breakNext) return;
    const fn = this.breakNext; this.breakNext = null;
    this.clearTimers();
    fn();
  }

  finish(pens = null) {
    const m = this.match;
    this.mode = 'over';
    this.clearTimers();
    this.releaseLocks();
    const [home, away] = m.teams;
    let winner = home.score > away.score ? home : away.score > home.score ? away : null;
    if (!winner && pens) winner = pens.home > pens.away ? home : away;
    m.result = { home: home.score, away: away.score, pens, winner, goals: this.goals.slice() };
    this.setPhase('fulltime');
    this.say('Full time', 'period');
    this.emit('fulltime', m.result);
  }

  // ------------------------------------------------------------------ restarts
  // Stop play (if needed) and set up a restart after `delay` real seconds.
  scheduleRestart(r, delay = 1.6) {
    this.mode = 'restart';
    this.restart = null;
    this.pendingType = r.type;
    this.clearTimers('restart');
    this.after(delay, () => {
      if (this.endPending && !this.shootout && r.type !== 'penalty') { this.endPeriod(); return; }
      this.setupRestart(r);
    }, 'restart');
  }

  setupRestart(r) {
    const m = this.match;
    const team = r.team, opp = team.opponent;
    this.releaseLocks();
    let spot = r.spot ? r.spot.clone() : new Vector3(); spot.y = 0;
    let taker = r.taker;
    switch (r.type) {
      case 'kickoff':
        taker = arrangeKickoff(m, team);
        for (const p of m.players) if (p.locked && p !== taker) this.locked.add(p);
        taker.locked = false;
        spot = new Vector3(0, 0, 0);
        break;
      case 'throwin':
        taker = taker ?? pickNearestTaker(team, spot);
        placeTaker(m, taker, spot, new Vector3(spot.x + team.side * 6, 0, 0));
        break;
      case 'corner':
        taker = taker ?? pickSpecialist(team, spot, false);
        placeTaker(m, taker, spot, new Vector3(attackGoalX(team) - team.side * 11, 0, 0));
        break;
      case 'goalkick':
        taker = keeperOf(team) ?? pickNearestTaker(team, spot);
        placeTaker(m, taker, spot, new Vector3(0, 0, spot.z * 2));
        break;
      case 'freekick': {
        const gx = attackGoalX(team);
        const shooting = r.direct && Math.hypot(gx - spot.x, spot.z) < 32;
        taker = taker ?? (shooting ? pickSpecialist(team, spot, true) : pickNearestTaker(team, spot));
        placeTaker(m, taker, spot, shooting ? new Vector3(gx, 0, 0) : new Vector3(spot.x + team.side * 10, 0, spot.z * 0.7));
        const wall = r.direct || Math.hypot(gx - spot.x, spot.z) < 26 ? buildWall(m, opp, spot) : [];
        for (const p of wall) this.locked.add(p);
        break;
      }
      case 'penalty':
        taker = taker && !taker.sentOff ? taker : pickSpecialist(team, spot, true);
        spot = arrangePenalty(m, team, taker, !!this.shootout);
        for (const p of m.players) if (p.locked && p !== taker) this.locked.add(p);
        this.controlFor(opp, keeperOf(opp));
        break;
    }
    if (!taker) { this.mode = 'play'; m.resumePlay(); return; }
    const direct = r.direct ?? !['throwin'].includes(r.type);
    m.startSetPiece({ type: r.type, team, taker, spot, direct });
    this.controlFor(team, taker);
    this.restart = { type: r.type, team, taker, direct, taken: false, otherTouched: false, spot };
    this.setpieceTime = 0;
    this.mode = 'setpiece';
    this.periodStats.setpieces++;
    if (r.type === 'freekick' && !direct) this.say('Indirect free kick', 'info');
  }

  kickoff(team, delay = 1.2) {
    this.offside.reset();
    this.recorder.clear();
    this.scheduleRestart({ type: 'kickoff', team, spot: new Vector3() }, delay);
  }

  // AI teams take their set pieces themselves; this is a safety net so a match
  // can never stall if the AI doesn't act. Humans get a long grace period.
  fallbackTaker() {
    const m = this.match, sp = m.setPiece, r = this.restart;
    if (!sp || !r || r.taken) return;
    const limit = sp.team.human ? (this.cfg.humanSetPieceTimeout ?? 30) : (sp.type === 'penalty' ? 2.6 : 3.4);
    if (this.setpieceTime < limit || sp.taker.intent?.action) return;
    const t = sp.taker, team = sp.team;
    t.intent = t.intent ?? { move: { x: 0, z: 0 }, sprint: false, face: null, action: null };
    if (sp.type === 'penalty') {
      const gx = attackGoalX(team);
      const z = (Math.random() < 0.5 ? -1 : 1) * (GOAL.halfW - 0.6 - Math.random() * 1.2);
      t.intent.action = { type: 'shoot', target: new Vector3(gx, 0.3 + Math.random() * 1.2, z), power: 0.75, dir: { x: Math.sign(gx), z: 0 } };
      return;
    }
    if (sp.type === 'goalkick') {
      const tgt = new Vector3(team.side * 5, 0, (Math.random() - 0.5) * 40);
      t.intent.action = { type: 'gkKick', target: tgt, power: 0.8, dir: { x: team.side, z: 0 } };
      return;
    }
    // pass to a sensible team-mate
    const mates = outfield(team).filter((p) => p !== t);
    let best = null, bs = -Infinity;
    for (const p of mates) {
      const d = dist2D(p.pos, sp.spot);
      if (d < 4 || d > 32) continue;
      const fwd = (p.pos.x - sp.spot.x) * team.side;
      const pressure = Math.min(...activePlayers(team.opponent).map((o) => dist2D(o.pos, p.pos)));
      const s = fwd * 0.3 + Math.min(pressure, 8) * 1.2 - d * 0.1 + Math.random() * 3;
      if (s > bs) { bs = s; best = p; }
    }
    best = best ?? nearest(mates, sp.spot);
    if (!best) return;
    const lofted = sp.type === 'corner';
    t.intent.action = { type: lofted ? 'cross' : 'pass', receiver: best, power: lofted ? 0.75 : 0.5, dir: { x: best.pos.x - t.pos.x, z: best.pos.z - t.pos.z } };
    if (lofted) t.intent.action.target = new Vector3(attackGoalX(team) - team.side * (6 + Math.random() * 6), 0, (Math.random() - 0.5) * 10);
  }

  onRestartTaken() {
    const r = this.restart;
    if (!r || r.taken) return;
    r.taken = true;
    r.time = this.match.clock.seconds;
    this.pendingType = null;
    this.releaseLocks();
    this.mode = this.shootout ? 'shootout' : 'play';
    if (this.shootout) this.shootout.onKick(r.taker);
  }

  // ------------------------------------------------------------------ events
  onPlayed(player, kind) {
    if (!player) return;
    // de-duplicate touch+kick for the same contact
    if (this.lastTouchFrame.player === player && this.lastTouchFrame.n >= this.frame - 1) {
      this.lastTouchFrame.n = this.frame;
      if (this.restart && !this.restart.taken && player === this.restart.taker) this.onRestartTaken();
      return;
    }
    this.lastTouchFrame = { player, n: this.frame };
    const m = this.match;
    let restartType = null;
    const r = this.restart;
    if (r && !r.taken && player === r.taker) { restartType = r.type; this.onRestartTaken(); }
    else if (r && r.taken && player !== r.taker) r.otherTouched = true;

    if (this.shootout) { this.shootout.onTouch(player, kind); return; }
    if (this.mode !== 'play') return;

    // advantage: did the fouled team lose the ball?
    if (this.advantage && player.team !== this.advantage.team && DELIBERATE.has(kind) && this.advantage.time > 0.4) {
      const a = this.advantage; this.advantage = null;
      this.say('Advantage over – free kick', 'foul');
      this.awardFoul(a.foul, true);
      return;
    }

    const off = this.offside.onTouch(player, kind, restartType);
    if (off) this.callOffside(off);
  }

  onBallOut(e) {
    if (this.shootout) { this.shootout.onOut(e); return; }
    if (this.mode !== 'play') return;
    const m = this.match;
    this.commitAdvantage();
    const last = e.lastTouch ?? m.ball.lastTouch;
    const lastTeam = last?.team ?? null;
    if (e.line === 'side') {
      const team = lastTeam ? lastTeam.opponent : m.teams[e.pos.z > 0 ? 0 : 1];
      this.stopPlay('throwin');
      this.officials.raiseFlag(e.pos.x, 'up', 1.2);
      this.flushCards();
      this.scheduleRestart({ type: 'throwin', team, spot: throwInSpot(e.pos) }, 1.3);
      return;
    }
    const goalX = Math.sign(e.pos.x) * PITCH.halfL;
    const defTeam = m.teams.find((t) => ownGoalX(t) === goalX) ?? m.teams[0];
    this.stopPlay('goalline');
    this.flushCards();
    if (lastTeam === defTeam) {
      const att = defTeam.opponent;
      this.stat(att, 'corners');
      this.officials.gesture('point', 1.5);
      this.say('Corner', 'info');
      this.scheduleRestart({ type: 'corner', team: att, spot: cornerSpot(goalX, e.pos.z) }, 1.8);
    } else {
      this.scheduleRestart({ type: 'goalkick', team: defTeam, spot: goalKickSpot(goalX, e.pos.z) }, 1.8);
    }
  }

  onGoal(e) {
    if (this.shootout) { this.shootout.onGoal(e); return; }
    if (this.mode !== 'play') return;
    const m = this.match;
    const goalX = Math.sign(e.pos?.x ?? m.ball.pos.x) * PITCH.halfL;
    const defTeam = m.teams.find((t) => ownGoalX(t) === goalX) ?? e.team.opponent;
    const team = defTeam.opponent;
    const r = this.restart;
    // Goals that can't be scored directly from a restart
    if (r && r.taken && !r.otherTouched) {
      const own = r.team === defTeam;
      if (r.type === 'throwin' || (r.type === 'freekick' && !r.direct) || (own && r.type !== 'penalty')) {
        this.stopPlay('nogoal');
        this.say(r.type === 'throwin' ? 'No goal – straight from a throw-in' : own ? 'Corner kick' : 'No goal – indirect free kick', 'info');
        if (own) this.scheduleRestart({ type: 'corner', team, spot: cornerSpot(goalX, m.ball.pos.z) }, 2);
        else this.scheduleRestart({ type: 'goalkick', team: defTeam, spot: goalKickSpot(goalX, m.ball.pos.z) }, 2);
        return;
      }
    }
    this.advantage = null;
    const scorer = e.scorer ?? m.ball.lastTouch;
    const ownGoal = !!scorer && scorer.team !== team;
    team.score = (team.score ?? 0) + 1;
    this.stat(team, 'goals');
    const entry = {
      team: team.id, teamIndex: team.index, scorer: scorer?.data?.short ?? scorer?.data?.name ?? '?',
      player: scorer, minute: this.minuteLabel(), ownGoal, penalty: r?.type === 'penalty' && !r.otherTouched,
    };
    this.goals.push(entry);
    this.periodStats.goals++;
    this.stopPlay('goal');
    this.whistle('short');
    this.officials.gesture('point', 2);
    this.say(`GOAL! ${entry.scorer}${ownGoal ? ' (o.g.)' : entry.penalty ? ' (pen)' : ''} ${entry.minute}`, 'goal');
    this.mode = 'celebrate';
    this.clearTimers();
    this.celebrate(scorer, team);
    let frames = null;
    this.after(1.0, () => { frames = this.recorder.snapshot(6.5); });
    this.after(this.cfg.celebrationSeconds ?? 3.4, () => {
      this.releaseLocks();
      if (this.cfg.replays !== false && frames) {
        const dur = this.recorder.play(`${entry.scorer} ${entry.minute}`, frames, 0.55);
        if (dur > 0) { this.mode = 'replay'; this.afterGoalTeam = defTeam; return; }
      }
      this.afterGoalTeam = defTeam;
      this.afterReplay();
    });
    this.flushCards();
  }

  celebrate(scorer, team) {
    if (!scorer || scorer.team !== team) return;
    const gx = attackGoalX(team);
    const corner = new Vector3(gx * 0.82, 0, Math.sign(scorer.pos.z || 1) * (PITCH.halfW - 4));
    this.lock(scorer, corner);
    scorer.state = 'celebrate';
    for (const p of outfield(team)) {
      if (p === scorer) continue;
      if (dist2D(p.pos, scorer.pos) < 30) this.lock(p, new Vector3(corner.x - Math.sign(gx) * (2 + Math.random() * 3), 0, corner.z - Math.sign(corner.z) * (1 + Math.random() * 4)));
    }
  }

  afterReplay() {
    if (this.mode !== 'replay' && this.mode !== 'celebrate') return;
    const team = this.afterGoalTeam;
    this.afterGoalTeam = null;
    this.mode = 'restart';
    if (this.endPending) { this.endPeriod(); return; }
    this.kickoff(team, 0.4);
  }

  // ------------------------------------------------------------------ fouls
  onTackle(e) {
    if (this.mode !== 'play' || this.shootout) return;
    const foul = judgeTackle(this.match, e);
    if (!foul) return;
    const m = this.match;
    this.stat(foul.tackler.team, 'fouls');
    this.periodStats.fouls++;
    const victimTeam = foul.victim.team;
    // Advantage: only outside the box, in the fouled team's attacking half, and
    // only if they still have the ball.
    if (!foul.penalty && !this.advantage && this.cfg.advantage !== false && foul.card !== 'red') {
      const depth = foul.pos.x * victimTeam.side + PITCH.halfL;
      const holder = m.ball.owner;
      const keeps = (holder && holder.team === victimTeam && holder !== foul.victim)
        || (!holder && nearest(activePlayers(victimTeam).concat(activePlayers(victimTeam.opponent)), m.ball.pos)?.team === victimTeam && foul.victim.state !== 'stumble');
      if (depth > 48 && keeps) {
        this.advantage = { foul, time: 0, team: victimTeam };
        this.officials.gesture('advantage', 1.6);
        this.say('Advantage', 'advantage');
        return;
      }
    }
    this.awardFoul(foul, false);
  }

  updateAdvantage(dt) {
    const a = this.advantage;
    a.time += dt;
    if (a.time > 3.0) this.commitAdvantage();
  }

  // Advantage was played: keep any card for the next stoppage.
  commitAdvantage() {
    const a = this.advantage;
    if (!a) return;
    this.advantage = null;
    if (a.foul.card) this.pendingCards.push(a.foul);
  }

  flushCards() {
    const list = this.pendingCards.splice(0);
    list.forEach((f, i) => this.after(0.6 + i * 1.2, () => this.book(f.tackler, f.card, f.reason)));
  }

  awardFoul(foul, fromAdvantage) {
    const m = this.match;
    this.stopPlay('foul');
    this.whistle('short');
    const team = foul.victim.team;
    let delay = 1.8;
    if (foul.card) {
      const f = foul;
      this.after(0.7, () => this.book(f.tackler, f.card, f.reason));
      delay += 1.8;
    }
    this.flushCards();
    this.stat(team, 'freekicks');
    if (foul.penalty) {
      this.officials.gesture('point', 2);
      this.say('Penalty!', 'foul');
      this.scheduleRestart({ type: 'penalty', team, spot: new Vector3(), taker: null }, delay + 0.6);
    } else {
      this.say(fromAdvantage ? 'Free kick' : `Foul by ${foul.tackler.data?.short ?? foul.tackler.data?.name ?? ''}`, 'foul');
      const spot = freeKickSpot(foul.pos, team, true);
      this.scheduleRestart({ type: 'freekick', team, spot, direct: true }, delay);
    }
  }

  book(player, color, reason = '') {
    if (!player || player.sentOff) return;
    const team = player.team;
    let shown = color;
    if (color === 'yellow') {
      player.yellow = (player.yellow ?? 0) + 1;
      this.stat(team, 'yellow');
      if (player.yellow >= 2) shown = 'second';
    }
    this.officials.gesture('card', 1.8, color === 'yellow' && shown !== 'second' ? 'yellow' : 'red');
    this.periodStats.cards++;
    const name = player.data?.short ?? player.data?.name ?? 'Player';
    if (shown === 'yellow') {
      this.emit('card', { player, color: 'yellow', reason });
      this.say(`Yellow card – ${name}`, 'card');
    } else {
      if (shown === 'second') this.emit('card', { player, color: 'yellow', reason, second: true });
      this.emit('card', { player, color: 'red', reason });
      this.stat(team, 'red');
      this.say(`${shown === 'second' ? 'Second yellow – ' : 'Red card – '}${name}`, 'card');
      this.sendOff(player);
    }
  }

  sendOff(player) {
    const m = this.match;
    player.sentOff = true;
    player.locked = true;
    this.locked.delete(player);
    if (m.ball.owner === player) m.ball.owner = null;
    const exit = new Vector3(clamp(player.pos.x, -10, 10), 0, -(PITCH.halfW + 4));
    player.lockTarget = exit;
    // walk off, then vanish to the tunnel
    this.after(4, () => { m.teleport(player, new Vector3(0, 0, -(PITCH.halfW + 12))); player.lockTarget = null; });
    if (player.team.human) {
      const repl = nearest(outfield(player.team), player.pos);
      if (repl) m.setControlled?.(player.team, repl);
    }
  }

  callOffside(off) {
    const m = this.match;
    this.advantage = null;
    this.stopPlay('offside');
    this.officials.raiseFlag(off.pos.x, 'offside', 2.4);
    this.after(0.35, () => this.whistle('short'));
    this.stat(off.team, 'offsides');
    this.say(`Offside – ${off.player.data?.short ?? off.player.data?.name ?? ''}`, 'offside');
    const def = off.team.opponent;
    const spot = freeKickSpot(new Vector3(off.pos.x, 0, off.pos.z), def, false);
    this.flushCards();
    this.scheduleRestart({ type: 'freekick', team: def, spot, direct: false }, 2.2);
  }

  // ------------------------------------------------------------------ shootout
  startShootout() {
    const m = this.match;
    this.mode = 'shootout';
    this.clearTimers();
    this.releaseLocks();
    this.shootout = new Shootout(m, this);
    this.setPhase('shootout');
    this.say('Penalty shootout', 'period');
    this.after(2, () => this.shootout.next());
  }
}
