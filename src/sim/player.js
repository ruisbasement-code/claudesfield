import { Vector3 } from 'three';
import { PITCH, PLAYER, BALL, clamp } from '../core/constants.js';
import { executeBallAction, executeTackle, executeSlide, executeDive, canReachBall } from './actions.js';

const _v = new Vector3();

export function emptyIntent() {
  return { move: { x: 0, z: 0 }, sprint: false, face: null, action: null };
}

export class Player {
  constructor(team, data, slot, id) {
    this.id = id;
    this.team = team;
    this.data = data;
    this.slot = slot;
    this.isGK = data.role === 'GK';
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.facing = 0;
    this.stamina = 1;
    this.intent = emptyIntent();
    this.locked = false;
    this.lockTarget = null;
    this.state = 'run';
    this.stateTime = 0;
    this.yellow = 0;
    this.sentOff = false;
    this.touchCooldown = 0; // can't collect the ball while > 0 (after kicking / losing it)
    this.bufferedAction = null; // first-time action waiting for the ball
    this.bufferTime = 0;
    this.slideDir = new Vector3();
    this.slideResolved = false;
    this.diveVel = new Vector3();
    this.diveHeight = 0;
    this.animPhase = Math.random() * 10; // render: run cycle
    this.kickAnim = 0; // render: 0..1 kick swing
    this.lastKickType = null;
    this.match = null;
  }

  get stats() { return this.data.stats; }
  hasBall() { return this.match?.ball.owner === this; }
  forward() { return _v.set(Math.cos(this.facing), 0, Math.sin(this.facing)); }

  maxSpeed(sprint = true) { return this.topSpeed(sprint); }

  topSpeed(sprint) {
    const s = this.stats;
    const staminaF = 0.82 + 0.18 * clamp(this.stamina / 0.6, 0, 1);
    let top = 6.6 + (s.pace / 99) * 2.9; // ~9.5 m/s for 99 pace
    if (!sprint) top *= 0.68;
    if (this.hasBall()) top *= 0.88 + (s.dribbling / 99) * 0.08;
    if (this.isGK) top *= 0.92;
    return top * staminaF;
  }

  update(dt, match) {
    this.stateTime += dt;
    if (this.touchCooldown > 0) this.touchCooldown -= dt;
    if (this.kickAnim > 0) this.kickAnim = Math.max(0, this.kickAnim - dt * 3.2);
    if (this.sentOff) return;

    const it = this.intent;

    // ---- special states ----
    if (this.state === 'slide') {
      const t = this.stateTime;
      const sp = Math.max(0, 8.5 - t * 9);
      this.vel.copy(this.slideDir).multiplyScalar(sp);
      this.integrate(dt);
      if (!this.slideResolved) executeSlide(this, match);
      if (t > 0.95) this.setState('run');
      return;
    }
    if (this.state === 'dive') {
      const t = this.stateTime;
      this.vel.copy(this.diveVel).multiplyScalar(Math.max(0, 1 - t * 1.1));
      this.integrate(dt);
      if (t > 1.15) this.setState('run');
      return;
    }
    if (this.state === 'stumble') {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
      this.integrate(dt);
      if (this.stateTime > 0.9) this.setState('run');
      return;
    }
    if (this.state === 'tackle' && this.stateTime > 0.45) this.setState('run');
    if (this.state === 'kick' && this.stateTime > 0.25) this.setState('run');

    // ---- locked (walls, celebrations, set-piece positioning) ----
    if (this.locked) {
      let mx = 0, mz = 0;
      if (this.lockTarget) {
        const dx = this.lockTarget.x - this.pos.x, dz = this.lockTarget.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) { mx = dx / d; mz = dz / d; }
        const want = Math.min(d * 2, this.topSpeed(d > 6));
        this.steer(mx * want, mz * want, dt, 14);
      } else {
        this.steer(0, 0, dt, 14);
      }
      if (it.face != null) this.turnTo(it.face, dt, 10);
      else if (this.vel.lengthSq() > 0.3) this.turnTo(Math.atan2(this.vel.z, this.vel.x), dt, 8);
      this.integrate(dt);
      this.intent.action = null;
      return;
    }

    // ---- set-piece taker pinned on the spot ----
    const sp = match.setPiece;
    const pinned = match.phase === 'setpiece' && sp && sp.taker === this;
    const frozen = match.phase === 'stopped' || match.phase === 'halftime' || match.phase === 'fulltime' || match.phase === 'prematch';

    // ---- movement ----
    let mx = it.move.x || 0, mz = it.move.z || 0;
    let mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; mag = 1; }
    const sprint = !!it.sprint && mag > 0.3 && this.stamina > 0.05;
    let top = this.topSpeed(sprint);
    if (this.state === 'tackle' || this.state === 'kick') top *= 0.5;
    if (pinned) { mx = 0; mz = 0; mag = 0; }
    const accel = 7 + (this.stats.accel / 99) * 7;
    this.steer(mx * top, mz * top, dt, accel);

    // stamina
    if (sprint) this.stamina -= dt * (0.012 + (1 - this.stats.stamina / 99) * 0.02);
    else this.stamina += dt * 0.006;
    this.stamina = clamp(this.stamina, 0, 1);

    // facing
    if (it.face != null) this.turnTo(it.face, dt, 9);
    else if (pinned && mag > 0.1) this.turnTo(Math.atan2(it.move.z, it.move.x), dt, 6);
    else if (this.vel.lengthSq() > 0.25) {
      const turn = this.hasBall() ? 5 + (this.stats.dribbling / 99) * 6 : 11;
      this.turnTo(Math.atan2(this.vel.z, this.vel.x), dt, turn);
    }

    this.integrate(dt);
    if (pinned) this.pos.set(sp.taker === this ? this.pos.x : this.pos.x, 0, this.pos.z);

    // ---- actions ----
    if (frozen) { it.action = null; this.bufferedAction = null; return; }
    if (it.action) {
      const a = it.action;
      it.action = null;
      this.doAction(a, match);
    }
    if (this.bufferedAction) {
      this.bufferTime -= dt;
      if (this.bufferTime <= 0) this.bufferedAction = null;
      else if (canReachBall(this, match)) {
        const a = this.bufferedAction;
        this.bufferedAction = null;
        executeBallAction(this, a, match);
      }
    }
  }

  doAction(a, match) {
    switch (a.type) {
      case 'tackle': executeTackle(this, match); return;
      case 'slide':
        if (this.state === 'slide' || this.isGK) return;
        this.setState('slide');
        this.slideResolved = false;
        this.slideDir.set(Math.cos(this.facing), 0, Math.sin(this.facing));
        if (a.dir && (a.dir.x || a.dir.z)) {
          const l = Math.hypot(a.dir.x, a.dir.z);
          this.slideDir.set(a.dir.x / l, 0, a.dir.z / l);
          this.facing = Math.atan2(this.slideDir.z, this.slideDir.x);
        }
        return;
      case 'dive': executeDive(this, a, match); return;
      default:
        if (canReachBall(this, match)) executeBallAction(this, a, match);
        else { this.bufferedAction = a; this.bufferTime = 0.45; }
    }
  }

  steer(tx, tz, dt, accel) {
    const dx = tx - this.vel.x, dz = tz - this.vel.z;
    const d = Math.hypot(dx, dz);
    const maxDv = accel * dt * (d > 0 && (tx * this.vel.x + tz * this.vel.z) < 0 ? 1.4 : 1);
    if (d <= maxDv) { this.vel.x = tx; this.vel.z = tz; }
    else { this.vel.x += (dx / d) * maxDv; this.vel.z += (dz / d) * maxDv; }
  }

  turnTo(angle, dt, rate) {
    let d = angle - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = rate * dt;
    this.facing += Math.abs(d) < step ? d : Math.sign(d) * step;
  }

  integrate(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // keep inside the stadium apron
    this.pos.x = clamp(this.pos.x, -PITCH.halfL - 4, PITCH.halfL + 4);
    this.pos.z = clamp(this.pos.z, -PITCH.halfW - 4, PITCH.halfW + 4);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.animPhase += dt * (sp * 1.55 + 0.001);
  }

  setState(s) { this.state = s; this.stateTime = 0; }
}

export { PLAYER, BALL };
