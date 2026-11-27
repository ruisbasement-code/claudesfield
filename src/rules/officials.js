// Referee and assistant referees: positions and gestures for the renderer.
// match.officials = { referee:{pos,vel,facing,state,cardColor}, assistants:[{pos,facing,flag}x2] }
import { Vector3 } from 'three';
import { PITCH, clamp } from '../core/constants.js';

const REF_SPEED = 7.2, REF_ACCEL = 6;
const AR_SPEED = 7.5, AR_ACCEL = 8;

function makeOfficial(x, z) {
  return { pos: new Vector3(x, 0, z), vel: new Vector3(), facing: 0, state: 'run', stateTime: 0, cardColor: null };
}

function steer(o, target, maxSpeed, accel, dt) {
  const dx = target.x - o.pos.x, dz = target.z - o.pos.z;
  const d = Math.hypot(dx, dz);
  // arrive: slow down near target
  const want = Math.min(maxSpeed, d * 1.6);
  const tvx = d > 0.05 ? (dx / d) * want : 0, tvz = d > 0.05 ? (dz / d) * want : 0;
  const ax = tvx - o.vel.x, az = tvz - o.vel.z;
  const a = Math.hypot(ax, az), maxA = accel * dt;
  const k = a > maxA ? maxA / a : 1;
  o.vel.x += ax * k; o.vel.z += az * k;
  o.pos.x += o.vel.x * dt; o.pos.z += o.vel.z * dt;
}

export class Officials {
  constructor(match) {
    this.match = match;
    this.referee = makeOfficial(-4, -8);
    // AR 0 on the near touchline covers the +x half, AR 1 the far touchline / -x half
    this.assistants = [
      { ...makeOfficial(20, -(PITCH.halfW + 1.2)), flag: 'down', flagTime: 0, half: 1 },
      { ...makeOfficial(-20, PITCH.halfW + 1.2), flag: 'down', flagTime: 0, half: -1 },
    ];
    match.officials = { referee: this.referee, assistants: this.assistants };
    this.refTarget = null; // fixed target during set pieces
  }

  gesture(state, seconds = 1.6, cardColor = null) {
    const r = this.referee;
    r.state = state; r.stateTime = seconds; r.cardColor = cardColor;
  }

  raiseFlag(xOrHalf, kind = 'offside', seconds = 2.2) {
    const half = Math.sign(xOrHalf) || 1;
    const ar = this.assistants.find((a) => a.half === half);
    ar.flag = kind; ar.flagTime = seconds;
    return ar;
  }

  // Put officials somewhere sensible instantly (kick-offs).
  reset() {
    const r = this.referee;
    r.pos.set(-6, 0, -10); r.vel.set(0, 0, 0);
    this.assistants[0].pos.set(10, 0, -(PITCH.halfW + 1.2));
    this.assistants[1].pos.set(-10, 0, PITCH.halfW + 1.2);
    for (const a of this.assistants) { a.vel.set(0, 0, 0); a.flag = 'down'; }
    this.refTarget = null;
  }

  update(dt, offsideLines) {
    const m = this.match;
    const ball = m.ball.pos;
    const r = this.referee;

    // --- referee: diagonal system, 12-20 m from play, never on top of the ball
    let target;
    const so = m.shootout?.active;
    if (so) target = new Vector3(PITCH.halfL - 15, 0, -11); // edge of the box, watching the kick
    else if (this.refTarget) target = this.refTarget;
    else {
      const bx = ball.x, bz = ball.z;
      target = new Vector3(
        bx - Math.sign(bx || 1) * 9 + (m.ball.vel.x || 0) * 0.6,
        0,
        bz * 0.45 + (bx >= 0 ? -1 : 1) * 11,
      );
    }
    target.x = clamp(target.x, -PITCH.halfL + 4, PITCH.halfL - 4);
    target.z = clamp(target.z, -PITCH.halfW + 2, PITCH.halfW - 2);
    // keep out of the ball's way
    const dbx = r.pos.x - ball.x, dbz = r.pos.z - ball.z, db = Math.hypot(dbx, dbz);
    if (db < 6 && !this.refTarget && !so) { target.x += (dbx / (db || 1)) * 6; target.z += (dbz / (db || 1)) * 6; }
    const moving = r.state === 'run' || r.state === 'point';
    steer(r, target, moving ? REF_SPEED : 0.5, REF_ACCEL, dt);
    r.facing = Math.atan2(ball.z - r.pos.z, ball.x - r.pos.x);
    if (r.stateTime > 0 && (r.stateTime -= dt) <= 0) { r.state = 'run'; r.cardColor = null; }

    // --- assistants: level with the second-last defender (or the ball if further)
    for (const a of this.assistants) {
      const attacking = m.teams.find((t) => t.side === a.half);
      let x = attacking ? offsideLines?.[attacking.index] ?? 0 : 0;
      x = a.half > 0 ? Math.max(x, ball.x) : Math.min(x, ball.x);
      x = a.half > 0 ? clamp(x, 0, PITCH.halfL) : clamp(x, -PITCH.halfL, 0);
      let tgt = new Vector3(x, 0, a.pos.z);
      if (so) {
        // shootout: one assistant on the goal line as goal judge, the other in the centre circle
        if (a.half > 0) { tgt = new Vector3(PITCH.halfL, 0, -PITCH.sixHalfW); steer(a, tgt, AR_SPEED, AR_ACCEL, dt); a.facing = Math.PI / 2; continue; }
        tgt = new Vector3(-2, 0, -12); steer(a, tgt, AR_SPEED, AR_ACCEL, dt); a.facing = 0; continue;
      }
      steer(a, tgt, a.flag === 'down' ? AR_SPEED : 0.4, AR_ACCEL, dt);
      a.pos.z = a.half > 0 ? -(PITCH.halfW + 1.2) : PITCH.halfW + 1.2;
      a.facing = a.half > 0 ? Math.PI / 2 : -Math.PI / 2; // facing the pitch
      if (a.flagTime > 0 && (a.flagTime -= dt) <= 0) a.flag = 'down';
    }
  }
}
