import { Vector3 } from 'three';
import { PITCH, GOAL, clamp } from '../core/constants.js';
import { pickReceiver } from '../sim/actions.js';

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

    const ball = m.ball;
    const sp = m.setPiece;
    const live = m.phase === 'live';
    const takingSetPiece = m.phase === 'setpiece' && sp && sp.taker === p;
    const facingPenalty = p.isGK && ((sp && sp.type === 'penalty' && sp.team !== this.team) || (m.lastSetPiece?.type === 'penalty' && m.lastSetPiece.team !== this.team && m.time - (m.lastSetPiece.takenAt || 0) < 1.5));
    const opp = ball.owner && ball.owner.team !== this.team;
    const attacking = !opp;

    if (!live && !takingSetPiece && !facingPenalty) { this.charging = null; this.power = 0; this.aimPoint = null; return; }

    // ---------- keeper facing a penalty: shuffle on the line, dive with shoot/pass ----------
    if (facingPenalty) {
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

    // ---------- defending ----------
    if (opp && !takingSetPiece) {
      this.charging = null; this.power = 0;
      if (input.pressed('switch')) m.switchPlayer(this.team);
      if (input.pressed('tackle')) it.action = { type: 'tackle' };
      else if (input.pressed('slide')) it.action = { type: 'slide', dir: mv.mag > 0.2 ? { x: mv.x, z: mv.z } : null };
      // holding tackle = contain: move towards the ball carrier
      if (input.isDown('tackle') && !it.action && mv.mag < 0.2) {
        const o = ball.owner;
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        it.move.x = dx / d; it.move.z = dz / d;
        it.face = Math.atan2(dz, dx);
      }
      return;
    }

    // ---------- attacking / loose ball ----------
    if (!ball.owner && input.pressed('switch') && !takingSetPiece) m.switchPlayer(this.team);

    // skill move: knock-on when moving, drag-back when standing
    if (input.pressed('skill') && ball.owner === p && !takingSetPiece) {
      this.skill(p, mv);
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
      if (a !== 'shoot') this.previewReceiver = pickReceiver(p, mv.mag > 0.2 ? mv : this.lastMove, m, a === 'lob' ? 'lob' : a);
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
        if (a !== 'shoot' && passAssist !== 'assisted') {
          const d = dir || this.lastMove;
          if (passAssist === 'manual' && d) {
            const l = Math.hypot(d.x, d.z) || 1;
            const dist = a === 'lob' ? 12 + this.power * 40 : a === 'through' ? 10 + this.power * 30 : 6 + this.power * 28;
            action.target = new Vector3(p.pos.x + (d.x / l) * dist, 0, p.pos.z + (d.z / l) * dist);
          }
          action.error = passAssist === 'manual' ? 0.8 : 1.35;
        }
        if (a === 'shoot' && this.assist?.shot === 'manual') action.error = 1.4;
        if (a === 'shoot' && !dir) action.dir = null;
        if (a === 'lob' && p.pos.x * this.team.side > PITCH.halfL - 30 && Math.abs(p.pos.z) > PITCH.boxHalfW - 4) action.type = 'cross';
        // keeper holding the ball: pass = throw, lob/shoot = kick
        if (p.isGK && p.state === 'hold') action.type = a === 'pass' || a === 'through' ? 'gkThrow' : 'gkKick';
        it.action = action;
        this.charging = null;
        this.previewReceiver = null;
        this.lastPower = this.power;
        this.power = 0;
      }
    } else this.previewReceiver = null;
  }

  skill(p, mv) {
    const m = this.match;
    const ball = m.ball;
    if (mv.mag > 0.3) {
      // knock-on: push the ball into space and chase it
      const v = new Vector3(mv.x, 0, mv.z).normalize().multiplyScalar(7 + (p.stats.pace / 99) * 3);
      ball.kick(v, null, p, 'knock');
      ball.lastKick = { player: p, type: 'knock', time: m.time };
      p.touchCooldown = 0.25;
      p.kickAnim = 0.6;
      m.emitTouch(p, 'kick');
      p.intent.sprint = true;
    } else {
      // drag-back: turn 180 degrees with the ball
      p.facing += Math.PI;
      p.vel.multiplyScalar(-0.3);
      const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
      ball.pos.set(p.pos.x + fx * 0.5, ball.pos.y, p.pos.z + fz * 0.5);
    }
  }
}
