import { Vector3 } from 'three';
import { BALL, GOAL, PITCH, PLAYER, SIM, clamp } from '../core/constants.js';
import { EventBus } from '../core/events.js';
import { teamById, pickKits } from '../data/teams.js';
import { Ball } from './ball.js';
import { Player, emptyIntent } from './player.js';
import { createTeamAI } from '../ai/index.js';
import { createRules } from '../rules/index.js';

const _v = new Vector3();

export class Team {
  constructor(match, index, data, kit) {
    this.match = match;
    this.index = index;
    this.id = index === 0 ? 'home' : 'away';
    this.data = data;
    this.kit = kit;
    this.side = index === 0 ? 1 : -1;
    this.players = [];
    this.human = false;
    this.controlled = null;
    this.score = 0;
    this.opponent = null;
    this.attackGoal = new Vector3();
    this.ownGoal = new Vector3();
    this.stats = {
      shots: 0, onTarget: 0, passes: 0, passesCompleted: 0, possessionTime: 0,
      tackles: 0, tacklesWon: 0, saves: 0, fouls: 0, yellow: 0, red: 0, offsides: 0, corners: 0,
    };
    this.updateGoals();
  }
  updateGoals() {
    this.attackGoal.set(this.side * PITCH.halfL, 0, 0);
    this.ownGoal.set(-this.side * PITCH.halfL, 0, 0);
  }
  get name() { return this.data.name; }
  get keeper() { return this.players.find((p) => p.isGK && !p.sentOff); }
}

export class Match {
  constructor(config = {}) {
    this.config = { halfMinutes: 4, difficulty: 'pro', humanSide: 'home', ...config };
    this.events = new EventBus();
    this.ball = new Ball();
    this.ball.events = this.events;
    this.time = 0; // real sim seconds since construction
    this.phase = 'prematch';
    this.setPiece = null;
    this.paused = false;
    this.possession = null;
    this.difficulty = this.config.difficulty;
    this.clock = { seconds: 0, half: 1, addedTime: 0, running: false };
    this.officials = null; // rules may provide
    this.replay = null; // rules may provide

    const homeData = config.homeData || teamById(config.homeId || config.home || 'kestrel');
    const awayData = config.awayData || teamById(config.awayId || config.away || 'valdora');
    const kits = pickKits(homeData, awayData);
    if (config.homeKitData) kits.home = config.homeKitData;
    if (config.awayKitData) kits.away = config.awayKitData;
    this.teams = [new Team(this, 0, homeData, kits.home), new Team(this, 1, awayData, kits.away)];
    this.teams[0].opponent = this.teams[1];
    this.teams[1].opponent = this.teams[0];
    this.players = [];
    let id = 0;
    for (const team of this.teams) {
      team.data.players.forEach((pd, slot) => {
        const p = new Player(team, pd, slot, id++);
        p.match = this;
        team.players.push(p);
        this.players.push(p);
      });
    }
    const hs = this.config.humanSide;
    if (hs === 'home' || hs === 'both') this.teams[0].human = true;
    if (hs === 'away' || hs === 'both') this.teams[1].human = true;

    this.humanControllers = []; // set by Game: [{ team, update(dt) }]
    this.ai = this.teams.map((t) => createTeamAI(this, t, this.difficulty));
    this.rules = createRules(this);
    for (const t of this.teams) if (t.human) t.controlled = t.players.find((p) => p.data.role === 'FW') || t.players[9];
  }

  // ----------------------------------------------------------------------------
  update(dt = SIM.dt) {
    if (this.paused) return;
    this.time += dt;
    this.rules.preUpdate?.(dt);

    if (this.replay?.active) { this.rules.update?.(dt); return; }

    for (const p of this.players) if (!p.locked) p.intent.action = p.intent.action || null;
    for (const ai of this.ai) ai.update(dt);
    for (const hc of this.humanControllers) hc.update(dt);

    for (const p of this.players) p.update(dt, this);
    this.separatePlayers();

    this.updateBall(dt);
    this.checkBounds();
    this.updateStats(dt);
    this.rules.update?.(dt);
  }

  updateBall(dt) {
    const ball = this.ball;
    const o = ball.owner;
    if (o) {
      if (o.sentOff || o.state === 'stumble' || o.state === 'slide' || o.locked && !(this.setPiece?.taker === o)) {
        ball.owner = null;
        o.touchCooldown = 0.4;
      }
    }
    if (ball.owner) {
      const p = ball.owner;
      const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
      if (p.isGK && p.state === 'hold') {
        ball.pos.set(p.pos.x + fx * 0.35, 1.15, p.pos.z + fz * 0.35);
        ball.vel.set(p.vel.x, 0, p.vel.z);
        ball.spin.set(0, 0, 0);
      } else {
        const sp = Math.hypot(p.vel.x, p.vel.z);
        const lead = 0.45 + sp * 0.075;
        const tx = p.pos.x + fx * lead, tz = p.pos.z + fz * lead;
        const rate = 9 + (p.stats.dribbling / 99) * 9;
        const k = 1 - Math.exp(-rate * dt);
        const nx = ball.pos.x + (tx - ball.pos.x) * k;
        const nz = ball.pos.z + (tz - ball.pos.z) * k;
        ball.vel.set((nx - ball.pos.x) / dt, 0, (nz - ball.pos.z) / dt);
        ball.prevPos.copy(ball.pos);
        ball.pos.set(nx, BALL.radius, nz);
        ball.rollAngle.x += (ball.vel.z / BALL.radius) * dt;
        ball.rollAngle.z -= (ball.vel.x / BALL.radius) * dt;
        ball.spin.set(0, 0, 0);
      }
      return;
    }
    ball.update(dt);
    if (this.phase === 'live') this.resolveTouches();
  }

  resolveTouches() {
    const ball = this.ball;
    const sp = this.setPiece;
    // candidates sorted by distance
    const cands = [];
    for (const p of this.players) {
      if (p.sentOff || p.locked || p.touchCooldown > 0 || p.state === 'stumble') continue;
      if (this.phase === 'setpiece' && sp && p !== sp.taker) continue;
      const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
      if (d < 2.4) cands.push({ p, d });
    }
    if (!cands.length) return;
    cands.sort((a, b) => a.d - b.d);
    for (const { p, d } of cands) {
      if (p.isGK && this.inOwnBox(p) && this.tryKeeper(p, d)) return;
      if (this.tryOutfieldTouch(p, d)) return;
    }
  }

  inOwnBox(p, pos = p.pos) {
    const gx = p.team.ownGoal.x;
    return Math.abs(pos.x - gx) < PITCH.boxDepth + 0.3 && Math.abs(pos.z) < PITCH.boxHalfW + 0.3;
  }

  tryKeeper(p, d) {
    const ball = this.ball;
    const diving = p.state === 'dive';
    const reach = diving ? 1.5 + (p.stats.diving / 99) * 0.7 : 0.95;
    const maxY = diving ? 1.0 + p.diveHeight * 1.7 : 2.55;
    if (d > reach || ball.pos.y > maxY) return false;
    if (p.touchCooldown > 0) return false;
    // back-pass: keeper may not handle a deliberate pass from a teammate -> treat as outfield
    const lk = ball.lastKick;
    const backPass = lk && lk.player && lk.player.team === p.team && lk.player !== p && ['pass', 'through', 'lob', 'cross'].includes(lk.type) && ball.lastTouch === lk.player;
    if (backPass) return false;
    const speed = ball.speed();
    const s = p.stats;
    const fromShot = lk && ['shot', 'finesse', 'chip', 'headerShot'].includes(lk.type) && lk.player?.team !== p.team;
    let catchP = 1.15 - speed / 38 + (s.handling - 70) / 140 + (p.saveBonus || 0);
    if (diving) catchP -= 0.15;
    const reachMargin = 1 - d / reach; // nearer the body = easier
    let saveP = 0.55 + reachMargin * 0.5 + (s.reflexes - 70) / 110 + (p.saveBonus || 0) - Math.max(0, speed - 22) / 40;
    if (!fromShot) { catchP += 0.35; saveP = 1; }
    if (Math.random() > clamp(saveP, 0.05, 0.99)) {
      p.touchCooldown = 0.6; // beaten
      return false;
    }
    const shooter = lk?.player;
    if (Math.random() < clamp(catchP, 0.05, 0.98)) {
      ball.owner = p;
      ball.vel.set(0, 0, 0);
      ball.lastTouch = p;
      p.setState('hold');
      this.emitTouch(p, 'catch');
      this.onPossession(p);
    } else {
      // parry away from goal
      const out = new Vector3(p.team.side, 0, Math.sign(ball.pos.z - p.pos.z) || (Math.random() < 0.5 ? -1 : 1)).normalize();
      const v = out.multiplyScalar(Math.max(4, speed * 0.35));
      v.y = 1.5 + Math.random() * 3;
      ball.kick(v, null, p, 'parry');
      p.touchCooldown = 0.5;
      this.emitTouch(p, 'parry');
    }
    if (fromShot) {
      p.team.stats.saves++;
      this.events.emit('save', { keeper: p, shooter });
    }
    return true;
  }

  tryOutfieldTouch(p, d) {
    const ball = this.ball;
    const y = ball.pos.y;
    const rel = _v.copy(ball.vel).sub(p.vel);
    rel.y = ball.vel.y;
    const vr = rel.length();
    const dribble = p.stats.dribbling / 99;
    if (y < 0.6) {
      if (d > PLAYER.controlRange) return false;
      const maxControl = 10 + dribble * 13 + (p.isGK ? 2 : 0);
      if (vr < maxControl) {
        this.giveBall(p);
        return true;
      }
      this.deflect(p, 0.35);
      return true;
    }
    if (y < 1.6) {
      if (d > 0.62) return false;
      if (vr < 12 + dribble * 6) {
        this.giveBall(p);
        return true;
      }
      this.deflect(p, 0.3);
      return true;
    }
    if (y < PLAYER.headerReach) {
      if (d > 0.5) return false;
      // automatic header: knock it on in the facing direction
      const v = new Vector3(Math.cos(p.facing), 0, Math.sin(p.facing)).multiplyScalar(Math.max(4, ball.speed() * 0.45));
      v.y = 2.5;
      ball.kick(v, null, p, 'header');
      p.touchCooldown = 0.35;
      p.kickAnim = 1;
      this.emitTouch(p, 'header');
      return true;
    }
    return false;
  }

  deflect(p, keep) {
    const ball = this.ball;
    const nx = ball.pos.x - p.pos.x, nz = ball.pos.z - p.pos.z;
    const l = Math.hypot(nx, nz) || 1;
    const vn = (ball.vel.x * nx + ball.vel.z * nz) / l;
    if (vn < 0) {
      ball.vel.x -= (1.6 * vn * nx) / l;
      ball.vel.z -= (1.6 * vn * nz) / l;
    }
    ball.vel.multiplyScalar(keep + Math.random() * 0.2);
    ball.vel.y = Math.abs(ball.vel.y) * 0.5 + Math.random() * 1.5;
    ball.lastTouch = p;
    p.touchCooldown = 0.35;
    this.emitTouch(p, 'deflect');
  }

  giveBall(p) {
    const ball = this.ball;
    const prevOwner = ball.owner;
    if (prevOwner && prevOwner !== p) prevOwner.touchCooldown = 0.5;
    ball.owner = p;
    ball.lastTouch = p;
    ball.vel.set(0, 0, 0);
    ball.spin.set(0, 0, 0);
    ball.pos.y = BALL.radius;
    if (p.isGK && this.inOwnBox(p) && p.state !== 'hold') {
      // keeper picks a loose ball up unless it was a back-pass
      const lk = ball.lastKick;
      const backPass = lk && lk.player && lk.player.team === p.team && lk.player !== p && ['pass', 'through', 'lob', 'cross'].includes(lk.type);
      if (!backPass) p.setState('hold');
    }
    this.emitTouch(p, 'control');
    this.onPossession(p);
  }

  emitTouch(p, kind) {
    this.ball.lastTouch = p;
    this.events.emit('touch', { player: p, kind });
  }

  onPossession(p) {
    const lk = this.ball.lastKick;
    if (lk && lk.player && lk.player !== p && ['pass', 'through', 'lob', 'cross', 'gkThrow', 'gkKick'].includes(lk.type) && !lk.counted) {
      lk.counted = true;
      if (lk.player.team === p.team) lk.player.team.stats.passesCompleted++;
    }
    const prevTeam = this.possession;
    if (prevTeam !== p.team) {
      this.possession = p.team;
      this.events.emit('possession', { player: p, team: p.team, prev: prevTeam });
    }
    if (p.team.human && !p.isGK) this.setControlled(p.team, p);
  }

  onKick(p, type, extra) {
    if (['pass', 'through', 'lob', 'cross', 'gkThrow', 'gkKick'].includes(type)) p.team.stats.passes++;
    if (['shot', 'finesse', 'chip', 'headerShot'].includes(type)) p.team.stats.shots++;
    this.emitTouch(p, type.startsWith('header') ? 'header' : 'kick');
    this.events.emit('kick', { player: p, type, power: extra.power, receiver: extra.receiver, target: extra.target });
    if (this.phase === 'setpiece' && this.setPiece?.taker === p) this.resumePlay();
    // auto-switch the human to the intended receiver
    if (p.team.human && extra.receiver && !extra.receiver.isGK && this.config.autoSwitch !== false) {
      this.setControlled(p.team, extra.receiver);
    }
  }

  checkBounds() {
    if (this.phase !== 'live' && this.phase !== 'setpiece') return;
    const b = this.ball.pos;
    const r = BALL.radius;
    if (Math.abs(b.x) > PITCH.halfL + r) {
      const s = Math.sign(b.x);
      const prev = this.ball.prevPos;
      if (Math.abs(b.z) < GOAL.halfW - r * 0.5 && b.y < GOAL.height - r * 0.5 && Math.abs(prev.x) <= PITCH.halfL + r + 0.5) {
        const scoring = this.teams.find((t) => t.side === s);
        const scorer = this.ball.lastTouch;
        this.stopPlay('goal');
        this.events.emit('goal', { team: scoring, scorer, ownGoal: !!scorer && scorer.team !== scoring, pos: b.clone() });
        return;
      }
      this.stopPlay('out');
      this.events.emit('ballOut', { line: 'goal', pos: b.clone(), lastTouch: this.ball.lastTouch, isGoal: false });
      return;
    }
    if (Math.abs(b.z) > PITCH.halfW + r) {
      this.stopPlay('out');
      this.events.emit('ballOut', { line: 'side', pos: b.clone(), lastTouch: this.ball.lastTouch, isGoal: false });
    }
  }

  updateStats(dt) {
    if (this.phase === 'live' && this.possession) this.possession.stats.possessionTime += dt;
  }

  separatePlayers() {
    const ps = this.players;
    const min = PLAYER.radius * 2 * 0.9;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.sentOff) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.sentOff) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          // stronger players push weaker ones a little more
          const wa = a.locked ? 0 : 0.5 + (b.stats.physical - a.stats.physical) / 200;
          const wb = b.locked ? 0 : 1 - wa;
          a.pos.x -= nx * push * 2 * wa; a.pos.z -= nz * push * 2 * wa;
          b.pos.x += nx * push * 2 * wb; b.pos.z += nz * push * 2 * wb;
        }
      }
    }
  }

  // ---------------- control API (rules / ai / ui) ----------------
  placeBall(pos) {
    this.ball.place(pos);
  }

  teleport(p, pos, face) {
    p.pos.set(pos.x, 0, pos.z);
    p.vel.set(0, 0, 0);
    if (face != null) p.facing = face;
    if (p.state !== 'run') p.setState('run');
    p.bufferedAction = null;
    p.intent = emptyIntent();
  }

  startSetPiece({ type, team, taker, spot, direct = false, ...rest }) {
    if (!taker) taker = this.nearestPlayer(team, spot, (p) => !p.isGK || type === 'goalkick');
    this.setPiece = { type, team, taker, spot: spot.clone ? spot.clone() : new Vector3(spot.x, 0, spot.z), direct, ...rest };
    const prev = this.phase;
    this.phase = 'setpiece';
    this.placeBall(new Vector3(spot.x, BALL.radius, spot.z));
    // stand the taker behind the ball, facing the attacking direction or pitch centre
    const toward = type === 'throwin' ? new Vector3(0, 0, -Math.sign(spot.z) || 1)
      : type === 'corner' ? new Vector3(-Math.sign(spot.x), 0, -Math.sign(spot.z) * 0.8)
      : type === 'goalkick' ? new Vector3(team.side, 0, 0)
      : new Vector3().subVectors(team.attackGoal, spot).setY(0);
    if (toward.lengthSq() < 0.01) toward.set(team.side, 0, 0);
    toward.normalize();
    const back = type === 'throwin' ? 0.3 : 0.55;
    this.teleport(taker, new Vector3(spot.x - toward.x * back, 0, spot.z - toward.z * back), Math.atan2(toward.z, toward.x));
    this.ball.owner = null;
    taker.touchCooldown = 0;
    if (type === 'goalkick' && taker.isGK) taker.setState('run');
    if (team.human && !taker.isGK) this.setControlled(team, taker);
    if (team.human && taker.isGK && type === 'penalty') this.setControlled(team, taker);
    this.events.emit('phase', { phase: 'setpiece', prev, setPiece: this.setPiece });
  }

  resumePlay() {
    const prev = this.phase;
    this.phase = 'live';
    if (this.setPiece) this.setPiece.takenAt = this.time;
    this.lastSetPiece = this.setPiece;
    this.setPiece = null;
    if (prev !== 'live') this.events.emit('phase', { phase: 'live', prev });
  }

  stopPlay(reason) {
    const prev = this.phase;
    this.phase = 'stopped';
    this.stopReason = reason;
    for (const p of this.players) { p.bufferedAction = null; p.intent.action = null; }
    if (prev !== 'stopped') this.events.emit('phase', { phase: 'stopped', prev, reason });
  }

  setPhase(phase) {
    const prev = this.phase;
    this.phase = phase;
    if (prev !== phase) this.events.emit('phase', { phase, prev });
  }

  swapSides() {
    for (const t of this.teams) { t.side = -t.side; t.updateGoals(); }
    this.events.emit('sidesSwapped', {});
  }

  setControlled(team, p) {
    if (!team.human || !p || p.sentOff) return;
    if (team.controlled === p) return;
    const prev = team.controlled;
    team.controlled = p;
    if (prev) prev.intent = emptyIntent();
    this.events.emit('controlChanged', { team, player: p, prev });
  }

  // Human "switch player": the best teammate to engage the ball.
  switchPlayer(team) {
    const ball = this.ball;
    const fut = ball.owner ? ball.pos : ball.predict(0.5);
    let best = null, bd = Infinity;
    for (const p of team.players) {
      if (p.sentOff || p.isGK || p === team.controlled) continue;
      const d = Math.hypot(p.pos.x - fut.x, p.pos.z - fut.z) + Math.max(0, (p.pos.x - fut.x) * team.side) * 0.35; // prefer goal-side players
      if (d < bd) { bd = d; best = p; }
    }
    if (best) this.setControlled(team, best);
  }

  nearestPlayer(team, pos, filter = () => true) {
    let best = null, bd = Infinity;
    for (const p of team.players) {
      if (p.sentOff || !filter(p)) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  teamOf(id) { return id === 'away' ? this.teams[1] : this.teams[0]; }
}
