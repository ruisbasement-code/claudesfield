// Team AI: shape, roles (chaser / presser / cover / markers / supporters / runners),
// on-ball decisions, set-piece takers and the goalkeeper.
import { FORMATIONS, ROLE_TRAITS } from './formations.js';
import { getProfile, teammateProfile } from './difficulty.js';
import {
  PITCH, PLAYER, clamp, len2, dist2, randn, stat, topSpeed, toRel, toWorld, sampleBall, interceptPoint,
  nearestOf, clampToPitch,
} from './util.js';
import { evaluateOptions, chooseOption, buildShot, buildPass, buildClear } from './decisions.js';
import { KeeperBrain } from './keeper.js';
import { takeSetPiece, setPiecePositions } from './setpieces.js';

const LIVE = new Set(['live']);
const BALL_HISTORY = 60; // frames of ball history kept for perception delay

export class TeamAI {
  constructor(match, team, difficulty) {
    this.match = match;
    this.team = team;
    this.difficultyId = difficulty;
    this.prof = team.human ? teammateProfile(difficulty) : getProfile(difficulty);
    this.time = 0;
    this.frame = 0;
    this.brains = new Map();
    this.samples = [];
    this.ballHist = [];
    this.chaser = null;
    this.presser = null;
    this.keeper = null;
    this.keeperBrain = null;
    this.lastKick = null;
    this.setPieceState = null;
    this.mentality = 0;        // -1 park the bus .. 0 balanced .. +1 all-out attack
    this.userMentality = null; // set by UI/tactics; null = AI decides from game state
    this.unsub = [];
    const ev = match.events;
    if (ev && ev.on) {
      this.unsub.push(ev.on('kick', (e) => this.onKick(e)));
      this.unsub.push(ev.on('phase', (e) => this.onPhase(e)));
      this.unsub.push(ev.on('possession', () => { for (const b of this.brains.values()) b.nextThink = Math.min(b.nextThink, this.time + this.prof.reactionTime * 0.5); }));
    }
  }

  setDifficulty(id) {
    this.difficultyId = id;
    this.prof = this.team.human ? teammateProfile(id) : getProfile(id);
    this.bonusesSet = false; this.keeper = null;
  }

  // Tactics hook for the UI: 'defensive' | 'balanced' | 'attacking' | null (auto).
  setMentality(m) {
    this.userMentality = m == null ? null : ({ defensive: -0.7, balanced: 0, attacking: 0.7 }[m] ?? 0);
  }

  // Game-state awareness: chase the game when losing late, protect a lead.
  updateMentality() {
    if (this.userMentality != null) { this.mentality = this.userMentality; return; }
    if (this.team.human) { this.mentality = 0; return; }
    const c = this.match.clock;
    const mins = c ? (c.seconds || 0) / 60 : 0;
    const diff = (this.team.score || 0) - (this.team.opponent.score || 0);
    const late = clamp((mins - 60) / 30, 0, 1);
    const want = clamp(-diff * 0.5 * late * this.prof.decisionQuality, -0.8, 0.9);
    this.mentality += (want - this.mentality) * 0.002;
  }

  dispose() { for (const u of this.unsub) if (typeof u === 'function') u(); }

  brain(p) {
    let b = this.brains.get(p);
    if (!b) {
      b = { nextThink: 0, dribbleAngle: null, mode: null, runUntil: 0, runTarget: null,
        workRate: Math.random(), tackleCooldown: 0, gotBallAt: -1, plan: null };
      this.brains.set(p, b);
    }
    return b;
  }

  formation() {
    const name = this.team.data?.formation || '4-4-2';
    return FORMATIONS[name] || FORMATIONS['4-4-2'];
  }

  slotOf(p) {
    const f = this.formation();
    const i = p.slot ?? this.team.players.indexOf(p);
    return f[clamp(i, 0, f.length - 1)];
  }

  isHuman(p) {
    return this.team.human && this.team.controlled === p;
  }

  onKick(e) {
    this.lastKick = { player: e.player, type: e.type, time: this.time };
    const spType = this.match.setPiece?.type || this.lastSetPieceType;
    if (spType === 'penalty' && e.player && e.player.team !== this.team) this.penaltyKickAt = this.time;
    this.lastSetPieceType = null;
    if (this.keeperBrain) this.keeperBrain.onKick(e);
    if (e.player && e.player.team === this.team) {
      const b = this.brain(e.player);
      b.nextThink = this.time + 0.35; // pass-and-move: brief pause after kicking
      b.dribbleAngle = null;
    }
  }

  onPhase(e) {
    if (e.phase !== 'setpiece' && e.phase !== 'shootout') this.setPieceState = null;
    if (this.keeperBrain && e.phase === 'setpiece') this.keeperBrain.resetPenalty();
  }

  // Ball position as perceived with a reaction delay (positional play reacts late on low levels).
  perceivedBall() {
    const lag = Math.round(this.prof.reactionTime * 0.6 * 60);
    const h = this.ballHist;
    if (h.length === 0) return this.match.ball.pos;
    return h[Math.max(0, h.length - 1 - lag)];
  }

  // Is q in an offside position right now (for passes we would play)?
  isOffside(q) {
    if (q.team !== this.team) return false;
    const rel = toRel(this.team, q.pos);
    if (rel.d <= 0.5) return false;
    const ballD = toRel(this.team, this.match.ball.pos).d;
    return rel.d > Math.max(ballD, this.offsideLine) + 0.004;
  }

  // ---------------------------------------------------------------------------------------
  update(dt) {
    const match = this.match, team = this.team;
    this.time += dt;
    this.frame++;
    const ball = match.ball;
    this.ballHist.push({ x: ball.pos.x, y: ball.pos.y, z: ball.pos.z });
    if (this.ballHist.length > BALL_HISTORY) this.ballHist.shift();

    const gk = team.players.find((p) => p.isGK && !p.sentOff) || null;
    if (gk !== this.keeper) {
      this.keeper = gk;
      this.keeperBrain = gk ? new KeeperBrain(this, gk) : null;
      // difficulty nudges the sim's save/catch rolls for this keeper (Amateur -0.07 .. Legendary +0.05)
      if (gk) gk.saveBonus = (this.prof.gkReflex - 0.78) * 0.25;
    }
    if (!this.bonusesSet) {
      this.bonusesSet = true;
      for (const p of team.players) if (!p.isGK) p.tackleBonus = (this.prof.tackleSkill - 0.62) * 0.2;
    }

    const phase = match.phase;
    if (phase === 'setpiece' || phase === 'shootout') return this.updateSetPiece(dt);
    if (!LIVE.has(phase)) return this.updateIdle(dt, phase);
    this.updateLive(dt);
  }

  controllable() {
    return this.team.players.filter((p) => !p.sentOff && !p.locked && !this.isHuman(p));
  }

  updateIdle(dt, phase) {
    for (const p of this.controllable()) {
      const it = this.intent(p);
      if (phase === 'stopped') {
        const T = this.shapeTarget(p, this.perceivedBall(), false, true);
        this.moveTo(p, it, T, { urgency: 0.45 });
      } else {
        it.move.x = 0; it.move.z = 0; it.sprint = false;
        this.faceBall(p, it);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  updateLive(dt) {
    const match = this.match, team = this.team, ball = match.ball, prof = this.prof;
    const opp = team.opponent;
    if (this.frame % 2 === 0 || this.samples.length === 0) sampleBall(ball, 3, 1 / 30, this.samples);
    this.computeLines();
    this.updateMentality();

    const carrier = ball.owner;
    const weHave = carrier && carrier.team === team;
    const theyHave = carrier && carrier.team !== team;
    const pb = this.perceivedBall();

    // ---- intercept table for loose ball ----
    const intercepts = new Map();
    let ourBest = null, ourBestP = null, oppBest = null;
    const justKicked = this.lastKick && this.time - this.lastKick.time < 0.35 ? this.lastKick.player : null;
    if (!carrier) {
      for (const p of team.players) {
        if (p.sentOff || p === justKicked) continue;
        const ip = interceptPoint(p, this.samples, p.isGK ? 0.05 : prof.reactionTime * 0.35);
        intercepts.set(p, ip);
        if (!p.isGK && ip && (!ourBest || ip.t < ourBest.t)) { ourBest = ip; ourBestP = p; }
      }
      for (const o of opp.players) {
        if (o.sentOff || o === justKicked) continue;
        const ip = interceptPoint(o, this.samples, 0.1);
        if (ip && (!oppBest || ip.t < oppBest.t)) oppBest = ip;
      }
      // hysteresis: keep the current chaser unless someone is clearly better
      if (this.chaser && intercepts.get(this.chaser) && ourBest && this.chaser !== ourBestP && !this.chaser.isGK) {
        const cur = intercepts.get(this.chaser);
        if (cur.t < ourBest.t + 0.25) { ourBest = cur; ourBestP = this.chaser; }
      }
      // the intended receiver of our pass goes to meet it (unless an opponent clearly gets there first)
      const lk = ball.lastKick;
      const rcv = lk && lk.receiver;
      if (rcv && rcv.team === team && !rcv.sentOff && !rcv.isGK && lk.player?.team === team && intercepts.get(rcv)) {
        const ip = intercepts.get(rcv);
        if (!oppBest || ip.t < oppBest.t + 0.3) { ourBest = ip; ourBestP = rcv; }
      }
      this.chaser = ourBestP;
    } else {
      this.chaser = null;
    }

    // ---- defensive assignments ----
    let presser = null, cover = null;
    const marks = new Map();
    const defending = theyHave || (!carrier && oppBest && ourBest && oppBest.t < ourBest.t - 0.1);
    if (defending) {
      const threatPos = theyHave ? carrier.pos : { x: oppBest.x, z: oppBest.z };
      const cands = team.players.filter((p) => !p.isGK && !p.sentOff && p !== this.chaser)
        .map((p) => ({ p, t: dist2(p.pos, threatPos) / topSpeed(p, true) }))
        .sort((a, b) => a.t - b.t);
      // the human usually presses on their own side; their AI mates provide the cover
      let i = 0;
      if (theyHave) {
        if (cands[i] && !this.isHuman(cands[i].p)) presser = cands[i++].p;
        else if (cands[i]) i++;
        if (cands[i]) cover = cands[i++].p;
        // keep presser stable for a bit
        if (this.presser && this.presser !== presser && !this.isHuman(this.presser) && !this.presser.sentOff) {
          const tOld = dist2(this.presser.pos, threatPos) / topSpeed(this.presser, true);
          const tNew = presser ? dist2(presser.pos, threatPos) / topSpeed(presser, true) : Infinity;
          if (tOld < tNew + 0.3) { if (cover === this.presser) cover = presser; presser = this.presser; }
        }
      }
      this.presser = presser;
      // greedy man-marking of dangerous opponents near our players' zones
      const threats = opp.players.filter((o) => !o.sentOff && !o.isGK && o !== carrier)
        .map((o) => ({ o, danger: 1 - toRel(team, o.pos).d }))
        .sort((a, b) => b.danger - a.danger);
      const free = new Set(team.players.filter((p) => !p.isGK && !p.sentOff && p !== presser && p !== cover && p !== this.chaser && !this.isHuman(p)));
      for (const { o, danger } of threats) {
        if (danger < 0.35 - prof.pressIntensity * 0.25) continue; // ignore far-away attackers
        let best = null, bd = Infinity;
        for (const p of free) {
          const zone = this.shapeTarget(p, pb, false);
          const d = dist2(zone, o.pos);
          const limit = 9 + prof.positioning * 6;
          if (d < limit && d < bd) { bd = d; best = p; }
        }
        if (best) { marks.set(best, o); free.delete(best); }
      }
    } else {
      this.presser = null;
    }

    // ---- attacking roles ----
    const supporters = new Set();
    if (weHave) {
      const sup = team.players.filter((p) => p !== carrier && !p.isGK && !p.sentOff)
        .sort((a, b) => dist2(a.pos, carrier.pos) - dist2(b.pos, carrier.pos));
      for (let i = 0; i < Math.min(2, sup.length); i++) supporters.add(sup[i]);
    }

    // ---- write intents ----
    const ctx = {
      samples: this.samples, oppBestIntercept: oppBest,
      interceptFor: (p) => intercepts.get(p) || interceptPoint(p, this.samples, 0.05),
    };
    for (const p of team.players) {
      if (p.sentOff || p.locked || this.isHuman(p)) continue;
      const it = this.intent(p);
      it.face = null;
      if (p.isGK) {
        if (this.penaltyKickAt != null && this.time - this.penaltyKickAt < 1.2 && !ball.owner) { this.keeperBrain?.penalty(it); continue; }
        this.keeperBrain?.update(dt, it, ctx);
        continue;
      }
      if (p === carrier) { this.onBall(p, it); continue; }
      if (p === this.chaser) {
        const ip = intercepts.get(p);
        this.moveTo(p, it, ip || ball.pos, { urgency: 1, sprint: true, arrive: false });
        this.maybeFirstTime(p, it);
        continue;
      }
      if (p === presser) { this.press(p, it, carrier); continue; }
      if (p === cover) { this.coverPress(p, it, carrier); continue; }
      if (marks.has(p)) { this.mark(p, it, marks.get(p)); continue; }
      if (weHave) { this.attackShape(p, it, carrier, supporters.has(p)); continue; }
      // loose / defending shape
      const T = this.shapeTarget(p, pb, false);
      this.moveTo(p, it, T, { urgency: 0.9, sprint: dist2(p.pos, T) > 12 });
    }
  }

  // Second-last opponent (usually last outfielder) depth from our attacking view,
  // and our own defensive line depth.
  computeLines() {
    const team = this.team;
    const ds = team.opponent.players.filter((o) => !o.sentOff).map((o) => toRel(team, o.pos).d).sort((a, b) => b - a);
    this.offsideLine = Math.max(0.5, ds[1] ?? 0.5);
    const ballD = toRel(team, this.perceivedBall()).d;
    // our back line: deeper when the ball is deep, holds higher with a better offside trap
    const trap = this.prof.offsideTrap;
    // defenders read runners late: use where attackers were ~reactionTime ago
    const lag = this.prof.reactionTime * 1.5;
    const oppDs = team.opponent.players.filter((o) => !o.sentOff && !o.isGK)
      .map((o) => toRel(team, { x: o.pos.x - (o.vel?.x || 0) * lag, z: o.pos.z }).d);
    const deepestAttacker = oppDs.length ? Math.min(...oppDs) : 0.5;
    let line = clamp(ballD - 0.28 + trap * 0.06 + this.mentality * 0.04, 0.1, 0.52);
    // without a trap, never let the deepest attacker get goal-side
    if (trap < 0.5) line = Math.min(line, deepestAttacker - 0.01 * (1 - trap));
    // never deeper than the six-yard box edge
    this.defLine = clamp(line, 0.07, 0.55);
  }

  // Formation target for player p given (perceived) ball position.
  shapeTarget(p, bp, attacking, relaxed = false) {
    const team = this.team, slot = this.slotOf(p);
    const tr = ROLE_TRAITS[slot.role] || ROLE_TRAITS.CM;
    const b = toRel(team, bp);
    const shiftD = (b.d - 0.5) * tr.followD;
    let d = slot.d + shiftD + (attacking ? tr.attackPush : -tr.defendDrop) + this.mentality * 0.05;
    let w = slot.w * (attacking ? 1.05 : 0.78) + b.w * tr.followW * (attacking ? 0.5 : 0.8);
    // back line flat when defending
    if (!attacking && (slot.role === 'CB' || slot.role === 'FB')) d = this.defLine + (slot.role === 'FB' ? 0.01 : 0);
    if (attacking && (slot.role === 'CB')) d = Math.max(d, Math.min(this.defLine + 0.1, b.d - 0.2));
    // forwards stay onside in possession
    if (attacking && slot.role !== 'GK') d = Math.min(d, Math.max(this.offsideLine, b.d) - 0.006);
    // positioning quality: weaker AIs drift
    if (!relaxed) {
      const drift = (1 - this.prof.positioning) * 0.05;
      const br = this.brain(p);
      d += Math.sin(this.time * 0.3 + br.workRate * 10) * drift;
      w += Math.cos(this.time * 0.27 + br.workRate * 7) * drift * 2;
    }
    d = clamp(d, 0.05, 0.96);
    w = clamp(w, -0.94, 0.94);
    return toWorld(team, d, w);
  }

  // Off-ball attacking movement: support angles, runs in behind, width.
  attackShape(p, it, carrier, isSupport) {
    const team = this.team, br = this.brain(p), prof = this.prof;
    const slot = this.slotOf(p);
    const base = this.shapeTarget(p, this.match.ball.pos, true);
    const cRel = toRel(team, carrier.pos);

    // runs in behind for forwards / wingers / AMs (and overlapping fullbacks)
    const canRun = ['ST', 'W', 'AM'].includes(slot.role) || (slot.role === 'FB' && cRel.d > 0.55 && Math.random() < 0.002);
    if (br.runUntil > this.time && br.runTarget) {
      this.moveTo(p, it, br.runTarget, { urgency: 1, sprint: true });
      return;
    }
    if (canRun && this.time > br.nextThink) {
      br.nextThink = this.time + 0.8 + Math.random() * 1.5;
      const pRel = toRel(team, p.pos);
      if (pRel.d > cRel.d - 0.05 && Math.random() < 0.25 + prof.riskTaking * 0.4) {
        // diagonal run along the offside line, then the through-ball logic picks it up
        const w = clamp(pRel.w + (Math.random() - 0.5) * 0.5, -0.8, 0.8);
        // weaker sides mistime runs and drift offside now and then
        const early = Math.random() < (1 - prof.positioning) * 0.9 ? 0.015 + Math.random() * 0.03 : 0;
        const d = Math.min(0.94, this.offsideLine - 0.005 + early);
        br.runTarget = toWorld(team, d, w);
        br.runUntil = this.time + 1.6;
      }
    }

    if (isSupport) {
      // find an open spot ~10-14 m from the carrier at a passing angle
      const opps = team.opponent.players.filter((o) => !o.sentOff);
      let best = base, bs = -Infinity;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 10 + (i % 2) * 4;
        const T = { x: carrier.pos.x + Math.cos(a) * r, z: carrier.pos.z + Math.sin(a) * r };
        clampToPitch(T, 2);
        const open = nearestOf(opps, T).d;
        const fwd = (toRel(team, T).d - cRel.d) * 10;
        const fromBase = dist2(T, base) * 0.08;
        const s = Math.min(open, 8) + fwd - fromBase;
        if (s > bs) { bs = s; best = T; }
      }
      if (toRel(team, best).d > this.offsideLine) best = toWorld(team, this.offsideLine - 0.006, toRel(team, best).w);
      this.moveTo(p, it, best, { urgency: 0.95, sprint: dist2(p.pos, best) > 7 });
      return;
    }
    this.moveTo(p, it, base, { urgency: 0.85, sprint: dist2(p.pos, base) > 10 });
  }

  press(p, it, carrier) {
    const team = this.team, prof = this.prof, br = this.brain(p);
    const goal = team.ownGoal;
    const dc = dist2(p.pos, carrier.pos);
    const cRel = toRel(team, carrier.pos);
    // pressing height: low-intensity teams only engage in their own half
    const engage = cRel.d < 0.45 + prof.pressIntensity * 0.5 + this.mentality * 0.15;
    if (!engage) {
      const T = this.shapeTarget(p, this.perceivedBall(), false);
      return this.moveTo(p, it, T, { urgency: 0.8 });
    }
    // jockey goal-side of the carrier
    const gx = goal.x - carrier.pos.x, gz = goal.z - carrier.pos.z;
    const gl = len2(gx, gz) || 1;
    const standOff = dc > 4 ? 1.2 : 1.6 - prof.pressIntensity * 0.6;
    const T = { x: carrier.pos.x + (gx / gl) * standOff + (carrier.vel?.x || 0) * 0.25, z: carrier.pos.z + (gz / gl) * standOff + (carrier.vel?.z || 0) * 0.25 };
    this.moveTo(p, it, T, { urgency: 1, sprint: dc > 3 && Math.random() < 0.5 + prof.pressIntensity, arrive: true });
    this.faceBall(p, it);

    // tackle attempts on think ticks
    // only commit when close, roughly in front of the carrier (not from behind), and settled
    const toMeX = p.pos.x - carrier.pos.x, toMeZ = p.pos.z - carrier.pos.z;
    const cvl = len2(carrier.vel?.x || 0, carrier.vel?.z || 0);
    const inFront = cvl < 1 || ((carrier.vel.x * toMeX + carrier.vel.z * toMeZ) / (cvl * (dc || 1))) > -0.2;
    if (this.time >= br.tackleCooldown && dc < 1.5 && inFront) {
      br.tackleCooldown = this.time + 0.7 + this.prof.reactionTime * 2 + Math.random() * 0.5;
      const def = stat(p, 'defending') / 99;
      const goodTiming = Math.random() < prof.tackleSkill * (0.55 + def * 0.5);
      if (goodTiming) {
        // slide tackles only when beaten / chasing from the side and outside our box
        const behind = ((carrier.pos.x - p.pos.x) * (goal.x - p.pos.x)) < 0 ? false : true;
        const inBox = cRel.d < PITCH.boxDepth / PITCH.length && Math.abs(carrier.pos.z) < PITCH.boxHalfW;
        if (behind && !inBox && dc > 1.2 && Math.random() < 0.3 * prof.pressIntensity) {
          it.action = { type: 'slide', dir: { x: carrier.pos.x - p.pos.x, z: carrier.pos.z - p.pos.z }, power: 1 };
        } else {
          it.action = { type: 'tackle', dir: { x: carrier.pos.x - p.pos.x, z: carrier.pos.z - p.pos.z }, power: 1 };
        }
      }
    }
  }

  coverPress(p, it, carrier) {
    const goal = this.team.ownGoal;
    const gx = goal.x - carrier.pos.x, gz = goal.z - carrier.pos.z, gl = len2(gx, gz) || 1;
    const back = Math.min(7, gl * 0.4);
    const T = { x: carrier.pos.x + (gx / gl) * back, z: carrier.pos.z + (gz / gl) * back };
    this.moveTo(p, it, T, { urgency: 0.95, sprint: dist2(p.pos, T) > 6 });
    this.faceBall(p, it);
  }

  mark(p, it, o) {
    const team = this.team, goal = team.ownGoal, ball = this.match.ball;
    // goal-side and slightly ball-side of the attacker
    const gx = goal.x - o.pos.x, gz = goal.z - o.pos.z, gl = len2(gx, gz) || 1;
    const bx = ball.pos.x - o.pos.x, bz = ball.pos.z - o.pos.z, bl = len2(bx, bz) || 1;
    const tight = 1.2 + (1 - this.prof.positioning) * 2.5;
    let T = { x: o.pos.x + (gx / gl) * tight + (bx / bl) * 0.8 + (o.vel?.x || 0) * 0.3,
      z: o.pos.z + (gz / gl) * tight + (bz / bl) * 0.8 + (o.vel?.z || 0) * 0.3 };
    // defenders don't step too far out of the line to follow deep runners
    const rel = toRel(team, T);
    const slot = this.slotOf(p);
    if ((slot.role === 'CB' || slot.role === 'FB') && rel.d > this.defLine + 0.12) T = toWorld(team, this.defLine + 0.12, rel.w);
    this.moveTo(p, it, T, { urgency: 1, sprint: dist2(p.pos, T) > 4 });
    this.faceBall(p, it);
  }

  // The chaser: if the ball arrives in the air near goal, try a first-time shot/header.
  maybeFirstTime(p, it) {
    const ball = this.match.ball, team = this.team;
    const d = dist2(p.pos, ball.pos);
    if (d > 1.6) return;
    const gd = dist2(p.pos, team.attackGoal);
    const br = this.brain(p);
    if (gd < 16 && toRel(team, p.pos).d > 0.82 && this.time > br.nextThink) {
      br.nextThink = this.time + 0.5;
      if (Math.random() < 0.5 + this.prof.decisionQuality * 0.4) {
        it.action = buildShot(this, p, { dGoal: gd });
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  onBall(p, it) {
    const br = this.brain(p);
    if (br.gotBallAt < 0 || this.match.ball.owner !== p || br.ownerSeen !== p) {
      br.gotBallAt = this.time;
      br.ownerSeen = p;
      br.nextThink = Math.max(br.nextThink, this.time + this.prof.reactionTime * 0.5);
    }
    if (this.time >= br.nextThink) {
      const { opts, press } = evaluateOptions(this, p);
      const choice = chooseOption(this, opts);
      br.plan = choice;
      // think faster when pressed
      const base = Math.max(0.1, this.prof.reactionTime * 0.8);
      br.nextThink = this.time + (press < 2.5 ? base * 0.6 : base + 0.25) + Math.random() * 0.15;
      if (choice) {
        if (choice.kind === 'shoot') it.action = buildShot(this, p, choice);
        else if (choice.kind === 'clear') it.action = buildClear(this, p, choice);
        else if (choice.kind !== 'dribble') it.action = buildPass(this, p, choice);
        if (choice.kind === 'dribble') br.dribbleAngle = choice.angle;
        else br.dribbleAngle = null;
      }
    }
    // carry the ball along the dribble heading (also while a kick winds up)
    const a = br.dribbleAngle ?? Math.atan2(this.team.attackGoal.z - p.pos.z, this.team.attackGoal.x - p.pos.x);
    const free = br.plan?.free ?? 3;
    it.move.x = Math.cos(a);
    it.move.z = Math.sin(a);
    it.sprint = free > 5 && (p.stamina ?? 1) > 0.3 && br.workRate < 0.3 + this.prof.sprintUse;
    it.face = null;
  }

  // ---------------------------------------------------------------------------------------
  updateSetPiece(dt) {
    const sp = this.match.setPiece;
    if (sp) this.lastSetPieceType = sp.type;
    for (const p of this.team.players) {
      if (p.sentOff || p.locked || this.isHuman(p)) continue;
      const it = this.intent(p);
      it.face = null;
      if (sp && sp.taker === p) { takeSetPiece(this, p, it, sp); continue; }
      if (p.isGK && sp && sp.type === 'penalty' && sp.team !== this.team) { this.keeperBrain?.penalty(it); continue; }
      const T = sp ? setPiecePositions(this, p, sp) : null;
      if (T) this.moveTo(p, it, T, { urgency: 0.8, sprint: dist2(p.pos, T) > 10 });
      else { it.move.x = 0; it.move.z = 0; it.sprint = false; this.faceBall(p, it); }
    }
  }

  // ---------------------------------------------------------------------------------------
  intent(p) {
    if (!p.intent) p.intent = { move: { x: 0, z: 0 }, sprint: false, face: null, action: null };
    if (!p.intent.move) p.intent.move = { x: 0, z: 0 };
    return p.intent;
  }

  faceBall(p, it) {
    const b = this.match.ball.pos;
    it.face = Math.atan2(b.z - p.pos.z, b.x - p.pos.x);
  }

  // Steering: arrive at T with gentle separation from teammates.
  moveTo(p, it, T, { urgency = 1, sprint = false, arrive = true, faceBall = true } = {}) {
    let dx = T.x - p.pos.x, dz = T.z - p.pos.z;
    const d = len2(dx, dz);
    // separation from teammates (avoid clumping)
    let sx = 0, sz = 0;
    for (const q of this.team.players) {
      if (q === p || q.sentOff) continue;
      const ox = p.pos.x - q.pos.x, oz = p.pos.z - q.pos.z;
      const od = len2(ox, oz);
      if (od < 2.5 && od > 0.01) { sx += (ox / od) * (2.5 - od); sz += (oz / od) * (2.5 - od); }
    }
    if (d < 0.35 && len2(sx, sz) < 0.3) {
      it.move.x = 0; it.move.z = 0; it.sprint = false;
      if (faceBall) this.faceBall(p, it);
      return;
    }
    dx = dx / (d || 1) + sx * 0.25;
    dz = dz / (d || 1) + sz * 0.25;
    const l = len2(dx, dz) || 1;
    const mag = arrive ? clamp(d / 3, 0.25, 1) * urgency : urgency;
    it.move.x = (dx / l) * mag;
    it.move.z = (dz / l) * mag;
    const br = this.brain(p);
    const willing = br.workRate < 0.25 + this.prof.sprintUse * 0.75;
    it.sprint = !!sprint && willing && (p.stamina ?? 1) > 0.22 && d > 2;
    if (faceBall && d < 3) this.faceBall(p, it);
  }
}
