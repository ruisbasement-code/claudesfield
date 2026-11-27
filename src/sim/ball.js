import { Vector3 } from 'three';
import { BALL, GOAL, PITCH, SIM } from '../core/constants.js';

const _a = new Vector3();
const _t = new Vector3();
const _n = new Vector3();

// Ball physics: gravity, quadratic air drag, Magnus lift from spin, bounces with
// spin/friction coupling, rolling resistance, woodwork and goal nets.
export class Ball {
  constructor() {
    this.pos = new Vector3(0, BALL.radius, 0);
    this.vel = new Vector3();
    this.spin = new Vector3();
    this.owner = null;
    this.lastTouch = null;
    this.lastKick = null;
    this.prevPos = this.pos.clone();
    this.rollAngle = new Vector3(); // accumulated visual rotation (render only)
    this.events = null; // set by Match
    this.inNet = false; // after a goal the ball stays inside the net
  }

  inAir() { return this.pos.y > BALL.radius + 0.05; }
  speed() { return this.vel.length(); }

  place(p) {
    this.pos.set(p.x, p.y ?? BALL.radius, p.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.owner = null;
    this.inNet = false;
  }

  // Advance one sim step. `world` enables woodwork/net collisions.
  update(dt, world = true) {
    this.prevPos.copy(this.pos);
    const n = SIM.ballSubsteps;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      integrate(this.pos, this.vel, this.spin, h);
      if (world) this.collideGoals(h);
    }
    // visual rolling rotation
    this.rollAngle.x += (this.vel.z / BALL.radius) * dt;
    this.rollAngle.z -= (this.vel.x / BALL.radius) * dt;
    this.rollAngle.y += this.spin.y * dt * 0.2;
  }

  collideGoals() {
    for (const gx of [-PITCH.halfL, PITCH.halfL]) {
      const s = Math.sign(gx);
      const p = this.pos;
      // Posts (vertical cylinders) and crossbar (horizontal along z)
      for (const pz of [-GOAL.halfW, GOAL.halfW]) {
        if (p.y < GOAL.height + BALL.radius) {
          const dx = p.x - gx, dz = p.z - pz;
          const d = Math.hypot(dx, dz);
          const min = GOAL.postR + BALL.radius;
          if (d < min && d > 1e-6) {
            _n.set(dx / d, 0, dz / d);
            this.bounceOff(_n, BALL.postRestitution);
            p.x = gx + _n.x * min; p.z = pz + _n.z * min;
            this.events?.emit('post', { pos: p.clone() });
          }
        }
      }
      if (Math.abs(p.z) < GOAL.halfW) {
        const dx = p.x - gx, dy = p.y - GOAL.height;
        const d = Math.hypot(dx, dy);
        const min = GOAL.postR + BALL.radius;
        if (d < min && d > 1e-6) {
          _n.set(dx / d, dy / d, 0);
          this.bounceOff(_n, BALL.postRestitution);
          p.x = gx + _n.x * min; p.y = GOAL.height + _n.y * min;
          this.events?.emit('post', { pos: p.clone(), bar: true });
        }
      }
      // Net: box behind the goal line. Only when ball is behind the line.
      const behind = (p.x - gx) * s; // >0 behind the goal line
      if (behind > 0 && behind < GOAL.depth + 0.6) {
        const inside = Math.abs(p.z) < GOAL.halfW && p.y < GOAL.height;
        const wasInside = Math.abs(this.prevPos.z) < GOAL.halfW + 0.05 && this.prevPos.y < GOAL.height + 0.05;
        if (inside || wasInside) {
          // back net
          if (behind > GOAL.depth - BALL.radius) {
            p.x = gx + s * (GOAL.depth - BALL.radius);
            if (this.vel.x * s > 0) { this.vel.x *= -0.15; this.vel.y *= 0.5; this.vel.z *= 0.5; }
            this.inNet = true;
          }
          // side nets
          if (Math.abs(p.z) > GOAL.halfW - BALL.radius && wasInside) {
            p.z = Math.sign(p.z) * (GOAL.halfW - BALL.radius);
            this.vel.z *= -0.15; this.vel.x *= 0.6;
          }
          // roof
          if (p.y > GOAL.height - BALL.radius && wasInside && this.prevPos.y <= GOAL.height) {
            p.y = GOAL.height - BALL.radius;
            if (this.vel.y > 0) this.vel.y *= -0.2;
          }
        } else if (behind < GOAL.depth + 0.2 && Math.abs(p.z) < GOAL.halfW + 0.3 && p.y < GOAL.height + 0.3) {
          // hitting the outside of the side net / roof: deaden
          if (Math.abs(p.z) >= GOAL.halfW && Math.abs(this.prevPos.z) < GOAL.halfW + 0.3) {
            this.vel.z *= -0.1; this.vel.x *= 0.5;
            p.z = Math.sign(p.z) * (GOAL.halfW + BALL.radius);
          } else if (p.y >= GOAL.height && this.prevPos.y >= GOAL.height) {
            if (this.vel.y < 0) { this.vel.y *= -0.1; this.vel.x *= 0.6; this.vel.z *= 0.6; }
            p.y = GOAL.height + BALL.radius;
          }
        }
      }
    }
  }

  bounceOff(n, e) {
    const vn = this.vel.dot(n);
    if (vn < 0) {
      _t.copy(n).multiplyScalar(-(1 + e) * vn);
      this.vel.add(_t);
      this.spin.multiplyScalar(0.5);
    }
  }

  // Kick: set velocity and spin directly.
  kick(vel, spin, player, type) {
    this.owner = null;
    this.vel.copy(vel);
    this.spin.copy(spin || _a.set(0, 0, 0));
    if (this.pos.y < BALL.radius) this.pos.y = BALL.radius;
    this.lastTouch = player || this.lastTouch;
    this.lastKick = { player, type, time: performance?.now?.() ?? Date.now() };
  }

  // ---------- prediction helpers (no player interaction) ----------
  predict(t, out = new Vector3()) {
    const p = this.pos.clone(), v = this.vel.clone(), w = this.spin.clone();
    const h = 1 / 120;
    for (let s = 0; s < t; s += h) integrate(p, v, w, h);
    return out.copy(p);
  }

  // Returns {pos, t} of the next ground contact (or where it is if already rolling).
  predictLanding(maxT = 6) {
    const p = this.pos.clone(), v = this.vel.clone(), w = this.spin.clone();
    const h = 1 / 120;
    if (!this.inAir() && v.y <= 0.5) return { pos: p, t: 0 };
    for (let t = 0; t < maxT; t += h) {
      const vy = v.y;
      integrate(p, v, w, h);
      if (vy < 0 && p.y <= BALL.radius + 0.01) return { pos: p, t };
    }
    return { pos: p, t: maxT };
  }

  // Simulates until the ball crosses the plane x = X. Returns {pos, t} or null.
  predictCrossX(X, maxT = 3) {
    const p = this.pos.clone(), v = this.vel.clone(), w = this.spin.clone();
    const h = 1 / 120;
    const s0 = Math.sign(p.x - X);
    for (let t = 0; t < maxT; t += h) {
      integrate(p, v, w, h);
      if (Math.sign(p.x - X) !== s0) return { pos: p, t };
      if (v.lengthSq() < 0.05) return null;
    }
    return null;
  }

  // Samples the future path: array of {pos, t} every `step` seconds.
  path(T = 3, step = 0.1) {
    const p = this.pos.clone(), v = this.vel.clone(), w = this.spin.clone();
    const h = 1 / 120;
    const out = [];
    let next = 0;
    for (let t = 0; t <= T; t += h) {
      if (t >= next) { out.push({ pos: p.clone(), t }); next += step; }
      integrate(p, v, w, h);
    }
    return out;
  }
}

// Pitch surface (wet pitches skid and bounce lower). Set by Match from config.weather.
export const SURFACE = { roll: 1, bounce: 1 };
export function setSurface(weather) {
  SURFACE.roll = weather === 'rain' ? 0.78 : 1;
  SURFACE.bounce = weather === 'rain' ? 0.88 : 1;
}

// Core integrator shared by live physics and predictions.
export function integrate(p, v, w, h) {
  const r = BALL.radius;
  const airborne = p.y > r + 0.002 || v.y > 0.05;
  if (airborne) {
    const sp = v.length();
    // drag
    _a.copy(v).multiplyScalar(-BALL.dragK * sp);
    // magnus: spin x v
    _t.crossVectors(w, v).multiplyScalar(BALL.magnusK);
    _a.add(_t);
    _a.y -= BALL.gravity;
    v.addScaledVector(_a, h);
    p.addScaledVector(v, h);
    w.multiplyScalar(1 - BALL.spinDecay * h);
    if (p.y < r) {
      p.y = r;
      if (v.y < 0) {
        const vin = -v.y;
        // vertical restitution decreases a bit for hard impacts
        const e = BALL.restitution * SURFACE.bounce * (vin > 12 ? 0.85 : 1);
        v.y = vin * e;
        if (v.y < 0.6) v.y = 0;
        // tangential: friction + spin coupling. Topspin (w perpendicular) makes it kick on.
        // contact-point velocity = v + w x (-r up)
        const cvx = v.x + w.z * r; // (w x (0,-r,0)).x = w.y*0 - w.z*(-r) = w.z*r
        const cvz = v.z - w.x * r; // (w x (0,-r,0)).z = w.x*(-r) - w.y*0
        const mu = 1 - BALL.groundFriction;
        const imp = Math.min(1, (mu * vin * 1.8) / (Math.hypot(cvx, cvz) + 1e-6));
        v.x -= cvx * imp * 0.4;
        v.z -= cvz * imp * 0.4;
        w.x *= 0.55; w.z *= 0.55; w.y *= 0.7;
      }
    }
  } else {
    // rolling on the grass
    p.y = r;
    v.y = 0;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0) {
      const dec = BALL.rollDecel * SURFACE.roll + 0.035 * sp * sp * 0.1 + BALL.dragK * sp * sp * 0.4;
      const ns = Math.max(0, sp - dec * h);
      const k = ns / sp;
      v.x *= k; v.z *= k;
      // residual sidespin bends a rolling ball slightly
      if (Math.abs(w.y) > 0.5 && ns > 2) {
        _t.set(v.z, 0, -v.x).multiplyScalar((w.y * 0.004) * h * 60 / ns);
        v.add(_t);
      }
    }
    // spin converges to rolling spin
    w.x += ((v.z / r) - w.x) * Math.min(1, 6 * h);
    w.z += ((-v.x / r) - w.z) * Math.min(1, 6 * h);
    w.y *= 1 - 1.5 * h;
    p.x += v.x * h;
    p.z += v.z * h;
  }
}

// ---------- launch solvers ----------
// Given a desired horizontal distance for a lofted ball with a launch angle,
// find the speed (bisection on the real integrator). Returns speed in m/s.
export function solveLobSpeed(dist, angleDeg, backspin = 0, landHeight = BALL.radius) {
  let lo = 2, hi = 40;
  const ang = (angleDeg * Math.PI) / 180;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const d = carry(mid, ang, backspin, landHeight);
    if (d < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const _p = new Vector3(), _v = new Vector3(), _w = new Vector3();
function carry(speed, ang, backspin, landHeight) {
  _p.set(0, BALL.radius, 0);
  _v.set(Math.cos(ang) * speed, Math.sin(ang) * speed, 0);
  _w.set(0, 0, backspin); // +z spin with +x velocity => spin x v = (0,0,w)x(vx,..) gives +y lift
  const h = 1 / 60;
  for (let t = 0; t < 8; t += h) {
    integrate(_p, _v, _w, h);
    if (_v.y < 0 && _p.y <= landHeight) return _p.x;
    if (_p.y <= BALL.radius + 0.001 && t > 0.05) return _p.x;
  }
  return _p.x;
}

// Ground pass: speed so that the ball arrives at `dist` with `arrive` m/s.
export function groundPassSpeed(dist, arrive = 5) {
  // Approx decel: rollDecel plus a little drag term
  const a = BALL.rollDecel * SURFACE.roll + 0.35;
  return Math.sqrt(arrive * arrive + 2 * a * dist);
}
