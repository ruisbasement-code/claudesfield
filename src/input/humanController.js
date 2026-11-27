import { Vector3 } from 'three';
import { PITCH, GOAL, clamp } from '../core/constants.js';
import { pickReceiver, previewPassTarget } from '../sim/actions.js';

const CHARGE_TIME = 0.9; // seconds for a full power bar
const BALL_ACTIONS = ['shoot', 'pass', 'through', 'lob'];

// Turns Input state into intents for the human team's controlled player.
export class HumanController {
  constructor(match, team, input, getBasis) {
    this.match = match;
    this.team = team;
    this.input = input;
    this.getBasis = getBasis; // () => {right:{x,z}, up:{x,z}}
    this.charging = null; // { action, t }
    this.power = 0;
    this.enabled = true;
    this.lastMove = { x: team.side, z: 0 };
    this.aimPoint = null; // for HUD/renderer (penalties / free kicks)
    this.previewReceiver = null;
    this.previewTarget = null;
    this.assist = { pass: 'assisted', shot: 'assisted' };
    this.autoSwitch = 'assisted';
    this.lastAutoSwitch = 0;
    this.unsub = match.events.on('kick', (e) => this.onKick(e));
  }

  dispose() { this.unsub?.(); }

  // Assisted auto-switching: when the opponent passes/clears or shoots, hand control to the
  // teammate best placed to win the ball where it is going.
  onKick(e) {
    const m = this.match;
    if (this.autoSwitch === 'off' || !e.player || e.player.team === this.team) return;
    const ctrl = this.team.controlled;
    const target = e.target || (m.ball.inAir() ? m.ball.predictLanding().pos : m.ball.predict(0.8));
    if (!target) return;
    let best = null, bd = Infinity;
    for (const p of this.team.players) {
      if (p.sentOff || p.isGK) continue;
      const d = Math.hypot(p.pos.x - target.x, p.pos.z - target.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || best === ctrl) return;
    const cd = ctrl ? Math.hypot(ctrl.pos.x - target.x, ctrl.pos.z - target.z) : Infinity;
    // only switch if clearly better and the human is not mid-input
    if (cd - bd > 6 && !this.charging) {
      m.setControlled(this.team, best);
      this.lastAutoSwitch = m.time;
    }
  }

  autoSwitchTick() {
    const m = this.match;
    if (this.autoSwitch !== 'auto' || m.time - this.lastAutoSwitch < 0.8) return;
    const ball = m.ball;
    if (ball.owner && ball.owner.team === this.team) return;
    const ctrl = this.team.controlled;
    const best = m.nearestPlayer(this.team, ball.pos, (p) => !p.isGK);
    if (best && best !== ctrl) {
      const cd = ctrl ? Math.hypot(ctrl.pos.x - ball.pos.x, ctrl.pos.z - ball.pos.z) : Infinity;
      const bd = Math.hypot(best.pos.x - ball.pos.x, best.pos.z - ball.pos.z);
      if (cd - bd > 4) { m.setControlled(this.team, best); this.lastAutoSwitch = m.time; }
    }
  }

  // Screen-space vector (x right, y down) -> world ground direction.
  toWorld(v) {
    const b = this.getBasis();
    const x = b.right.x * v.x - b.up.x * v.y;
    const z = b.right.z * v.x - b.up.z * v.y;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  worldMove() {
    const mv = this.input.moveVector();
    const b = this.getBasis();
    // screen up (-y) = camera forward on the ground
    const x = b.right.x * mv.x - b.up.x * mv.y;
    const z = b.right.z * mv.x - b.up.z * mv.y;
    const m = Math.hypot(mv.x, mv.y);
    const l = Math.hypot(x, z) || 1;
    return { x: (x / l) * m, z: (z / l) * m, mag: m };
  }

  // Which player the human drives right now (the keeper when facing a penalty).
  activePlayer() {
    const m = this.match;
    const sp = m.setPiece;
    if (sp && sp.type === 'penalty' && sp.team !== this.team) return this.team.keeper;
    if (m.lastSetPiece?.type === 'penalty' && m.lastSetPiece.team !== this.team && m.time - (m.lastSetPiece.takenAt || 0) < 1.5) return this.team.keeper;
    return this.team.controlled;
  }

  update(dt) {
    const m = this.match;
    const input = this.input;
    this.state = 'idle';
    if (!this.enabled) return;
    const p = this.activePlayer();
    if (!p || p.sentOff) return;
    if (p.locked) { this.charging = null; this.power = 0; return; }
    const it = p.intent;
    const mv = this.worldMove();
    if (mv.mag > 0.15) this.lastMove = { x: mv.x / mv.mag, z: mv.z / mv.mag };
    it.move.x = mv.x; it.move.z = mv.z;
    it.sprint = input.isDown('sprint');
    it.face = null;
    it.action = null;
    it.shield = false;
    it.jockey = false;
    this.state = 'idle';
    const flickScreen = input.flicked?.() || null;
    const flick = flickScreen ? this.toWorld(flickScreen) : null;

    const ball = m.ball;
    const sp = m.setPiece;
    const live = m.phase === 'live';
    const takingSetPiece = m.phase === 'setpiece' && sp && sp.taker === p;
    const facingPenalty = p.isGK && ((sp && sp.type === 'penalty' && sp.team !== this.team) || (m.lastSetPiece?.type === 'penalty' && m.lastSetPiece.team !== this.team && m.time - (m.lastSetPiece.takenAt || 0) < 1.5));
    const opp = ball.owner && ball.owner.team !== this.team;
    const attacking = !opp;

    if (live) this.autoSwitchTick();
    if (!live && !takingSetPiece && !facingPenalty) { this.charging = null; this.power = 0; this.aimPoint = null; return; }

    // ---------- keeper facing a penalty: shuffle on the line, dive with shoot/pass ----------
    if (facingPenalty) {
      this.state = 'penalty';
      it.move.z = mv.z * 0.6; it.move.x = 0;
      it.face = p.team.side > 0 ? 0 : Math.PI;
      if (input.pressed('shoot') || input.pressed('pass') || input.pressed('slide') || input.pressed('tackle')) {
        const high = input.isDown('lob') || mv.mag > 0 && Math.abs(mv.x) > 0.5;
        it.action = { type: 'dive', dir: { x: 0, z: Math.sign(mv.z) || 0 }, height: high ? 0.9 : 0.3 };
      }
      this.aimPoint = null;
      return;
    }

    // ---------- set-piece aiming ----------
    this.aimPoint = null;
    if (takingSetPiece) {
      it.move.x = 0; it.move.z = 0;
      if (mv.mag > 0.15) it.face = Math.atan2(mv.z, mv.x);
      if (sp.type === 'penalty' || (sp.type === 'freekick' && sp.direct)) {
        const gx = this.team.attackGoal.x;
        const az = clamp(mv.z * (sp.type === 'penalty' ? 1 : 1), -1, 1);
        const ay = this.charging ? this.power : 0.4;
        this.aimPoint = new Vector3(gx, 0.25 + Math.pow(ay, 1.7) * 2.2, az * GOAL.halfW * 0.88);
        it.face = Math.atan2(-sp.spot.z + this.aimPoint.z, gx - sp.spot.x);
      }
    }

    // ---------- defending (EA FC classic: A contain, B tackle, X slide, LT jockey, LB / right stick switch) ----------
    if (opp && !takingSetPiece) {
      this.state = 'defend';
      this.charging = null; this.power = 0;
      const o = ball.owner;
      if (input.pressed('switch')) m.switchPlayer(this.team);
      else if (flick) this.switchToward(flick);
      if (this.team.controlled !== p) return; // switched this frame; the new player takes over next step
      if (input.pressed('tackle')) it.action = { type: 'tackle' };
      else if (input.pressed('slide')) it.action = { type: 'slide', dir: mv.mag > 0.2 ? { x: mv.x, z: mv.z } : null };
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      // contain: close the carrier down without diving in
      if (input.isDown('contain') && !it.action) {
        const stand = 1.6;
        const k = d > stand ? 1 : 0.2;
        if (mv.mag < 0.2 || d > stand) { it.move.x = (dx / d) * k; it.move.z = (dz / d) * k; }
        it.face = Math.atan2(dz, dx);
      }
      // jockey: stay square-on to the carrier and shuffle (sprint jockey with RT)
      if (input.isDown('jockey')) {
        it.jockey = true;
        it.face = Math.atan2(dz, dx);
      }
      // teammate contain: the nearest team-mate presses the carrier
      if (input.isDown('teamContain')) {
        const mate = m.nearestPlayer(this.team, o.pos, (q) => q !== p && !q.isGK && !q.locked);
        if (mate) {
          const mx = o.pos.x - mate.pos.x, mz = o.pos.z - mate.pos.z;
          const md = Math.hypot(mx, mz) || 1;
          const k = md > 2 ? 1 : 0.15;
          mate.intent.move.x = (mx / md) * k; mate.intent.move.z = (mz / md) * k;
          mate.intent.sprint = md > 6;
          mate.intent.face = Math.atan2(mz, mx);
        }
      }
      // keeper rush: send the goalkeeper off his line towards the ball
      const gk = this.team.keeper;
      if (input.isDown('keeperRush') && gk && gk !== p && !gk.locked && gk.state !== 'hold') {
        const kx = ball.pos.x - gk.pos.x, kz = ball.pos.z - gk.pos.z;
        const kd = Math.hypot(kx, kz) || 1;
        gk.intent.move.x = kx / kd; gk.intent.move.z = kz / kd;
        gk.intent.sprint = true;
        gk.intent.face = Math.atan2(kz, kx);
      }
      return;
    }

    // ---------- attacking / loose ball ----------
    const mine = ball.owner === p;
    this.state = takingSetPiece ? 'setpiece' : mine ? (p.isGK && p.state === 'hold' ? 'keeper' : 'attack') : 'loose';
    if (!ball.owner && !takingSetPiece) {
      if (input.pressed('switch')) m.switchPlayer(this.team);
      else if (flick) this.switchToward(flick);
      if (this.team.controlled !== p) return;
      this.receiveAssist(p, mv, it);
    }

    // shield / protect the ball (LT)
    if (mine && !takingSetPiece && input.isDown('shield') && !this.charging) {
      it.shield = true;
      it.sprint = false;
    }

    // skill moves: right-stick flick (or the skill button): knock-on when moving, drag-back when standing
    if (mine && !takingSetPiece && !(p.isGK && p.state === 'hold') && (flick || input.pressed('skill'))) {
      this.skill(p, mv, flick);
      return;
    }

    for (const a of BALL_ACTIONS) {
      if (input.pressed(a) && !this.charging) this.charging = { action: a, t: 0 };
    }
    if (this.charging) {
      this.charging.t += dt;
      this.power = clamp(this.charging.t / CHARGE_TIME, 0, 1);
      const a = this.charging.action;
      const release = input.released(a) || !input.isDown(a) || this.charging.t > CHARGE_TIME * 1.6;
      // through/pass previews
      // assisted passing: the stick picks the team-mate, the bar biases near/far; the ring shows who
      const aimDir = mv.mag > 0.2 ? mv : this.lastMove;
      if (a !== 'shoot') {
        this.previewReceiver = pickReceiver(p, aimDir, m, a === 'lob' ? 'lob' : a, { power: this.power, prev: this.previewReceiver });
        const assisted = (this.assist?.pass || 'assisted') !== 'manual' && !(p.isGK && p.state === 'hold');
        this.previewTarget = assisted ? previewPassTarget(p, a === 'lob' ? 'lob' : a, this.previewReceiver, this.power, aimDir, m) : null;
        this.previewKind = a;
      }
      if (release) {
        const dir = mv.mag > 0.2 ? { x: mv.x, z: mv.z } : null;
        const action = {
          type: a,
          dir: dir || (a === 'shoot' ? null : this.lastMove),
          power: Math.max(0.12, this.power),
          finesse: input.isDown('finesse'),
          chip: input.isDown('chip'),
        };
        if (this.aimPoint && a === 'shoot') action.target = this.aimPoint.clone();
        // assistance levels from settings: 'assisted' | 'semi' | 'manual'
        const passAssist = this.assist?.pass || 'assisted';
        if (a !== 'shoot' && passAssist !== 'manual' && this.previewReceiver && !(p.isGK && p.state === 'hold' && a !== 'pass' && a !== 'through')) {
          action.receiver = this.previewReceiver;
        }
        if (a !== 'shoot' && passAssist !== 'assisted') {
          const d = dir || this.lastMove;
          if (passAssist === 'manual' && d) {
            const l = Math.hypot(d.x, d.z) || 1;
            const dist = a === 'lob' ? 12 + this.power * 45 : a === 'through' ? 10 + this.power * 35 : 6 + this.power * 36;
            action.target = new Vector3(p.pos.x + (d.x / l) * dist, 0, p.pos.z + (d.z / l) * dist);
            action.manual = true;
          }
          action.error = passAssist === 'manual' ? 0.8 : 1.35;
        }
        if (a === 'shoot' && this.assist?.shot === 'manual') action.error = 1.4;
        if (a === 'shoot' && !dir) action.dir = null;
        if (a === 'lob' && p.pos.x * this.team.side > PITCH.halfL - 30 && Math.abs(p.pos.z) > PITCH.boxHalfW - 4) action.type = 'cross';
        // keeper holding the ball: pass = throw, lob/shoot = kick
        if (p.isGK && p.state === 'hold') action.type = a === 'pass' || a === 'through' ? 'gkThrow' : 'gkKick';
        it.action = action;
        if (a !== 'shoot') this.lastPassDir = { ...(action.dir || this.lastMove) };
        this.previewTarget = null;
        this.charging = null;
        this.previewReceiver = null;
        this.lastPower = this.power;
        this.power = 0;
      }
    } else { this.previewReceiver = null; this.previewTarget = null; }
  }

  // Pass indicator for the renderer: { from, target, receiver, kind } while aiming a pass, and
  // the struck pass's path until someone gets to it.
  passIndicator() {
    const m = this.match, ball = m.ball;
    if (this.charging && this.charging.action !== 'shoot' && this.previewTarget) {
      return { from: ball.pos, target: this.previewTarget, receiver: this.previewReceiver, kind: this.charging.action, power: this.power, live: false };
    }
    const lk = ball.lastKick;
    if (!ball.owner && lk && lk.player?.team === this.team && lk.target && lk.receiver && ball.lastTouch === lk.player
      && ['pass', 'through', 'lob', 'cross', 'gkThrow'].includes(lk.type) && m.time - lk.time < 3) {
      return { from: ball.pos, target: lk.target, receiver: lk.receiver, kind: lk.type, power: 1, live: true };
    }
    return null;
  }

  // FC-style receiving: after our pass the intended receiver (now under the human's control)
  // comes to meet the ball on his own, until the stick is pushed somewhere new.
  receiveAssist(p, mv, it) {
    const m = this.match, ball = m.ball;
    const lk = ball.lastKick;
    if (!lk || lk.receiver !== p || lk.player?.team !== this.team || m.time - lk.time > 4) return;
    if (ball.lastTouch !== lk.player) return; // someone else has touched it since
    const held = this.lastPassDir;
    if (mv.mag > 0.3) {
      const same = held && (mv.x * held.x + mv.z * held.z) / (mv.mag * (Math.hypot(held.x, held.z) || 1)) > 0.75;
      if (!same) { this.lastPassDir = null; return; } // the player has taken over
    }
    if (lk.toFeet) {
      // a pass is coming to his feet: settle onto the ball's line, take a step towards it and open up to it
      const bx = ball.pos.x - p.pos.x, bz = ball.pos.z - p.pos.z;
      const bd = Math.hypot(bx, bz) || 1;
      const vs = Math.hypot(ball.vel.x, ball.vel.z);
      let tx = 0, tz = 0;
      if (vs > 0.5) {
        const ux = ball.vel.x / vs, uz = ball.vel.z / vs;
        const along = Math.max(0, -(bx * ux + bz * uz)); // how far down the line the ball still has to come
        tx = ball.pos.x + ux * along - p.pos.x; tz = ball.pos.z + uz * along - p.pos.z;
      }
      const td = Math.hypot(tx, tz);
      if (td > 0.3) { const k = Math.min(1, td / 1.5); it.move.x = (tx / td) * k; it.move.z = (tz / td) * k; }
      else if (bd > 3) { it.move.x = (bx / bd) * 0.35; it.move.z = (bz / bd) * 0.35; }
      else { it.move.x = 0; it.move.z = 0; }
      it.sprint = td > 3;
      it.face = Math.atan2(bz, bx);
      return;
    }
    const top = p.topSpeed(true);
    let tgt = null;
    for (const s of ball.path(3, 0.1)) {
      if (s.pos.y > 2.2) continue;
      const d = Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z);
      if (d / top + 0.15 <= s.t) { tgt = s.pos; break; }
    }
    if (!tgt) { const end = ball.predictLanding(); tgt = end?.pos || ball.pos; }
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) { it.move.x = 0; it.move.z = 0; }
    else { const k = Math.min(1, d / 2.5); it.move.x = (dx / d) * k; it.move.z = (dz / d) * k; }
    it.sprint = d > 4;
    it.face = Math.atan2(ball.pos.z - p.pos.z, ball.pos.x - p.pos.x);
  }

  // Manual switch: pick the team-mate best lined up with the right-stick flick.
  switchToward(dir) {
    const m = this.match;
    const cur = this.team.controlled;
    const from = cur ? cur.pos : m.ball.pos;
    let best = null, bs = Infinity;
    for (const q of this.team.players) {
      if (q === cur || q.sentOff || q.isGK) continue;
      const dx = q.pos.x - from.x, dz = q.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      const cos = (dx * dir.x + dz * dir.z) / d;
      if (cos < 0.5) continue; // within ~60 degrees of the flick
      const score = d * (2 - cos);
      if (score < bs) { bs = score; best = q; }
    }
    if (best) { m.setControlled(this.team, best); this.lastAutoSwitch = m.time; }
    return best;
  }

  skill(p, mv, flick = null) {
    const m = this.match;
    const ball = m.ball;
    // a flick back against the way the player faces is a drag-back; any other flick knocks the ball on
    let knock = null;
    if (flick) {
      const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
      if (flick.x * fx + flick.z * fz > -0.5) knock = flick;
    } else if (mv.mag > 0.3) knock = mv;
    if (knock) {
      // knock-on: push the ball into space and chase it
      const v = new Vector3(knock.x, 0, knock.z).normalize().multiplyScalar(7 + (p.stats.pace / 99) * 3);
      ball.kick(v, null, p, 'knock');
      ball.lastKick = { player: p, type: 'knock', time: m.time };
      p.touchCooldown = 0.25;
      p.kickAnim = 0.6;
      m.emitTouch(p, 'kick');
      p.intent.sprint = true;
      p.facing = Math.atan2(knock.z, knock.x);
    } else {
      // drag-back: turn 180 degrees with the ball
      p.facing += Math.PI;
      p.vel.multiplyScalar(-0.3);
      const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
      ball.pos.set(p.pos.x + fx * 0.5, ball.pos.y, p.pos.z + fz * 0.5);
    }
  }
}
