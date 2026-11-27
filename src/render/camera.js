import * as THREE from 'three';
import { PITCH, clamp, lerp } from '../core/constants.js';

// Broadcast-style camera rig. The main stand camera sits on the +z touchline looking towards -z,
// so +x is screen-right and +z is screen-down (the HUD radar relies on this).
const MODES = {
  broadcast: { fov: 40, height: 29, dist: 58, follow: 0.85, lookZ: 0.55, lookAhead: 4, lookOff: 6 },
  tele: { fov: 32, height: 21, dist: 48, follow: 0.92, lookZ: 0.6, lookAhead: 3, lookOff: 4 },
  wide: { fov: 40, height: 34, dist: 56, follow: 0.6, lookZ: 0.3, lookAhead: 2 },
};

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 0.5, 900);
    this.pos = new THREE.Vector3(0, 21, 50);
    this.look = new THREE.Vector3();
    this.mode = 'broadcast';
    this.zoom = 0; // -5..5
    this.heightAdj = 0; // -5..5
    this.shake = 0;
    this.shakeEnabled = true;
    this.override = null; // 'penalty' | 'replay' | 'title' | 'freekick'
    this.attackSide = 1; // for end-to-end: direction the human attacks
    this.t = 0;
    this.camera.position.copy(this.pos);
  }

  setSettings(cam) {
    if (!cam) return;
    this.mode = cam.mode || 'broadcast';
    this.zoom = cam.zoom || 0;
    this.heightAdj = cam.height || 0;
    this.shakeEnabled = cam.shake !== false;
  }

  bump(amount = 0.3) { if (this.shakeEnabled) this.shake = Math.max(this.shake, amount); }

  // Screen basis on the ground for input: returns {right:{x,z}, up:{x,z}}
  basis() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    // right = forward x up
    return { up: { x: f.x, z: f.z }, right: { x: -f.z, z: f.x } };
  }

  update(dt, ctx) {
    this.t += dt;
    const { ball, focus, match } = ctx;
    const k = 1 - Math.exp(-dt * 3.2);
    const kLook = 1 - Math.exp(-dt * 4.5);
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();
    const zoomF = Math.pow(0.9, this.zoom);
    const hF = 1 + this.heightAdj * 0.08;
    let fov = 30;

    if (this.override === 'title') {
      const a = this.t * 0.05;
      desiredPos.set(Math.cos(a) * 70, 26, Math.sin(a) * 52);
      desiredLook.set(0, 0, 0);
      fov = 42;
    } else if (this.override === 'replay' && ctx.replayBall) {
      const b = ctx.replayBall;
      const side = Math.sign(b.x) || 1;
      // stay inside the bowl: in front of the ad boards on both axes
      let cz = b.z + 12;
      if (cz > PITCH.halfW + 3) cz = b.z - 12 < -PITCH.halfW - 3 ? PITCH.halfW + 3 : b.z - 12;
      const cx = clamp(b.x - side * 9, -PITCH.halfL - 3, PITCH.halfL + 3);
      desiredPos.set(cx, 2.6, cz);
      desiredLook.set(b.x, 1, b.z);
      fov = 34;
    } else if (this.override === 'penalty' && ctx.setPiece) {
      const sp = ctx.setPiece;
      const gx = sp.team.attackGoal.x;
      const dir = Math.sign(gx - sp.spot.x) || 1;
      desiredPos.set(sp.spot.x - dir * 9, 3.4, sp.spot.z + 0.01);
      desiredLook.set(gx, 1.2, 0);
      fov = 40;
    } else if (this.override === 'freekick' && ctx.setPiece) {
      const sp = ctx.setPiece;
      const gx = sp.team.attackGoal.x;
      const dx = gx - sp.spot.x, dz = -sp.spot.z;
      const d = Math.hypot(dx, dz) || 1;
      desiredPos.set(sp.spot.x - (dx / d) * 11, 4.5, sp.spot.z - (dz / d) * 11);
      desiredLook.set(gx, 1.2, 0);
      fov = 46;
    } else if (this.mode === 'end') {
      const s = this.attackSide;
      const fx = clamp(focus.x, -PITCH.halfL + 5, PITCH.halfL - 5);
      desiredPos.set(fx - s * 26 * zoomF, 17 * hF, focus.z * 0.6);
      desiredLook.set(fx + s * 8, 0, focus.z * 0.75);
      fov = 44;
    } else {
      const m = MODES[this.mode] || MODES.broadcast;
      const fx = clamp(focus.x * m.follow, -PITCH.halfL + 6, PITCH.halfL - 6);
      // closer to the near touchline -> pull back a bit less
      const zf = clamp(focus.z, -PITCH.halfW, PITCH.halfW);
      desiredPos.set(fx, m.height * hF, m.dist * zoomF + PITCH.halfW * 0.05 + zf * 0.1);
      desiredLook.set(clamp(focus.x, -PITCH.halfL, PITCH.halfL) * (0.95), 0, zf * m.lookZ - m.lookAhead * 0.3 + (m.lookOff || 0));
      fov = m.fov;
    }
    if (ball && ball.y > 4 && !this.override) desiredLook.y = Math.min(ball.y * 0.25, 4);

    const snap = ctx.snap;
    this.pos.lerp(desiredPos, snap ? 1 : k);
    this.look.lerp(desiredLook, snap ? 1 : kLook);
    this.camera.fov = lerp(this.camera.fov, fov, snap ? 1 : k);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      const s = this.shake * 0.4;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.look);
  }
}
