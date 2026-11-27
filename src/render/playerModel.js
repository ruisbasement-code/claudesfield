import * as THREE from 'three';

// Procedural low-poly footballer. Geometry is shared; materials are per kit.
const GEO = {
  torso: new THREE.CapsuleGeometry(0.17, 0.36, 4, 10),
  hips: new THREE.CapsuleGeometry(0.16, 0.12, 4, 10),
  thigh: new THREE.CapsuleGeometry(0.075, 0.3, 4, 8),
  shin: new THREE.CapsuleGeometry(0.058, 0.32, 4, 8),
  boot: new THREE.BoxGeometry(0.11, 0.08, 0.25),
  upperArm: new THREE.CapsuleGeometry(0.052, 0.22, 4, 8),
  foreArm: new THREE.CapsuleGeometry(0.045, 0.22, 4, 8),
  head: new THREE.SphereGeometry(0.115, 16, 12),
  neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8),
  hair: [
    new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
    new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    null,
  ],
  numberPlane: new THREE.PlaneGeometry(0.24, 0.24),
  shadow: new THREE.CircleGeometry(0.45, 20),
};

const matCache = new Map();
function mat(color, rough = 0.75) {
  const key = color + rough;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return matCache.get(key);
}

const numberTexCache = new Map();
function numberTexture(num, color, name) {
  const key = `${num}|${color}|${name}`;
  if (numberTexCache.has(key)) return numberTexCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 22px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillText((name || '').toUpperCase().slice(0, 12), 64, 16);
  g.font = '700 84px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillText(String(num), 64, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numberTexCache.set(key, t);
  return t;
}

const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });

export class PlayerModel {
  constructor(player, kit) {
    this.player = player;
    const look = player.data.look || { skin: '#e0b48f', hair: '#2a2a2a', hairStyle: 0, height: 1.8 };
    const root = new THREE.Group();
    this.root = root;
    const body = new THREE.Group(); // rotates for slides/dives
    root.add(body);
    this.body = body;
    const scale = look.height / 1.8;
    body.scale.setScalar(scale);

    const shirt = mat(kit.shirt, 0.8);
    const shorts = mat(kit.shorts, 0.8);
    const socks = mat(kit.socks, 0.85);
    const skin = mat(look.skin, 0.6);
    const boots = mat('#151515', 0.4);

    const mesh = (geo, m, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    // pelvis pivot at hip height
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.92;
    body.add(pelvis);
    this.pelvis = pelvis;
    mesh(GEO.hips, shorts, pelvis, 0, 0.02, 0).rotation.z = Math.PI / 2;
    const spine = new THREE.Group();
    spine.position.y = 0.08;
    pelvis.add(spine);
    this.spine = spine;
    mesh(GEO.torso, shirt, spine, 0, 0.3, 0).scale.set(1.15, 1, 0.75);
    mesh(GEO.neck, skin, spine, 0, 0.62, 0);
    const head = new THREE.Group();
    head.position.y = 0.76;
    spine.add(head);
    this.head = head;
    mesh(GEO.head, skin, head).scale.set(0.95, 1.05, 1);
    if (GEO.hair[look.hairStyle]) {
      const h = mesh(GEO.hair[look.hairStyle], mat(look.hair, 0.9), head, 0, 0.012, -0.004);
      h.rotation.x = -0.15;
    }
    // number on the back (local -x is back since the model faces +x)
    const num = new THREE.Mesh(GEO.numberPlane, new THREE.MeshBasicMaterial({ map: numberTexture(player.data.number, kit.number, player.data.short), transparent: true, depthWrite: false }));
    num.position.set(-0.155, 0.32, 0);
    num.rotation.y = -Math.PI / 2;
    spine.add(num);

    // legs: pivots at the hip; model faces +x so legs swing around z
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, -0.02, side * 0.1);
      pelvis.add(hip);
      const thigh = mesh(GEO.thigh, side < 0 ? shorts : shorts, hip, 0, -0.2, 0);
      thigh.scale.set(1.15, 1, 1.15);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      mesh(GEO.shin, socks, knee, 0, -0.2, 0);
      mesh(GEO.boot, boots, knee, 0.06, -0.44, 0).rotation.y = Math.PI / 2;
      // bare knee band of skin
      mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.08, 8), skin, knee, 0, 0.0, 0);
      this.legs.push({ hip, knee });
    }
    this.arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0, 0.52, side * 0.24);
      spine.add(sh);
      mesh(GEO.upperArm, shirt, sh, 0, -0.14, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      sh.add(elbow);
      mesh(GEO.foreArm, player.isGK ? mat('#e8e8e8', 0.6) : skin, elbow, 0, -0.13, 0);
      sh.rotation.x = side * 0.12;
      this.arms.push({ sh, elbow, side });
    }
    const shadow = new THREE.Mesh(GEO.shadow, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.scale.set(1, 0.7, 1);
    root.add(shadow);
    this.shadow = shadow;
    this.celebrate = 0;
  }

  update(dt, state) {
    const p = state || this.player;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    this.root.position.set(p.pos.x, 0, p.pos.z);
    this.root.rotation.y = -p.facing; // facing angle measured from +x toward +z
    this.root.visible = !p.sentOff;
    const ph = p.animPhase;
    const runAmp = Math.min(1, sp / 7);
    const swing = Math.sin(ph * 1.0) * (0.25 + runAmp * 0.65) * Math.min(1, sp / 1.2);
    const bob = Math.abs(Math.cos(ph)) * 0.05 * runAmp;
    this.body.position.y = bob;
    this.body.rotation.set(0, 0, 0);
    this.spine.rotation.set(0, 0, -runAmp * 0.18); // lean forward when running

    const [L, R] = this.legs;
    L.hip.rotation.z = swing;
    R.hip.rotation.z = -swing;
    L.knee.rotation.z = -Math.max(0, -Math.sin(ph)) * 1.2 * runAmp - 0.05;
    R.knee.rotation.z = -Math.max(0, Math.sin(ph)) * 1.2 * runAmp - 0.05;
    const [AL, AR] = this.arms;
    AL.sh.rotation.z = -swing * 0.8;
    AR.sh.rotation.z = swing * 0.8;
    AL.elbow.rotation.z = 0.4 + runAmp * 0.6;
    AR.elbow.rotation.z = 0.4 + runAmp * 0.6;
    AL.sh.rotation.x = -0.12; AR.sh.rotation.x = 0.12;

    // kick swing on the right leg
    if (p.kickAnim > 0) {
      const k = p.kickAnim; // 1 -> 0
      const t = 1 - k;
      const back = t < 0.3 ? -t / 0.3 : -1 + (t - 0.3) / 0.7 * 2.4;
      R.hip.rotation.z = -back * 0.9 * -1;
      R.knee.rotation.z = t < 0.35 ? -1.3 * (t / 0.35) : -1.3 * (1 - (t - 0.35) / 0.65);
      AL.sh.rotation.x = -0.9; AR.sh.rotation.x = 0.5;
      this.spine.rotation.z = -0.1;
    }

    switch (p.state) {
      case 'slide': {
        this.body.rotation.z = 1.15;
        this.body.position.y = 0.12;
        R.hip.rotation.z = 1.4; L.hip.rotation.z = 0.6; L.knee.rotation.z = -1.2; R.knee.rotation.z = 0;
        AL.sh.rotation.x = -1.2; AR.sh.rotation.x = 1.2;
        break;
      }
      case 'dive': {
        const dv = p.diveVel || { x: 0, z: 0 };
        // dive direction relative to facing: lateral component
        const lat = -Math.sin(p.facing) * dv.x + Math.cos(p.facing) * dv.z;
        const t = Math.min(1, p.stateTime * 3);
        this.body.rotation.x = -Math.sign(lat || 1) * 1.35 * t;
        this.body.position.y = (0.25 + (p.diveHeight || 0) * 0.9) * Math.sin(Math.min(Math.PI, p.stateTime * 3.2)) ;
        AL.sh.rotation.x = -2.9; AR.sh.rotation.x = 2.9;
        AL.sh.rotation.z = 0; AR.sh.rotation.z = 0;
        AL.elbow.rotation.z = 0; AR.elbow.rotation.z = 0;
        break;
      }
      case 'stumble': {
        const t = Math.min(1, p.stateTime * 2.5);
        const down = p.stateTime < 0.6 ? t : Math.max(0, 1 - (p.stateTime - 0.6) * 3);
        this.body.rotation.z = -1.2 * down;
        this.body.position.y = 0.1 * down;
        AL.sh.rotation.z = -1.2 * down; AR.sh.rotation.z = -1.2 * down;
        break;
      }
      case 'hold': {
        AL.sh.rotation.z = -1.1; AR.sh.rotation.z = -1.1;
        AL.sh.rotation.x = 0.2; AR.sh.rotation.x = -0.2;
        AL.elbow.rotation.z = -0.4; AR.elbow.rotation.z = -0.4;
        break;
      }
      case 'celebrate': {
        AL.sh.rotation.x = -2.6; AR.sh.rotation.x = 2.6;
        AL.elbow.rotation.z = 0; AR.elbow.rotation.z = 0;
        this.body.position.y = Math.abs(Math.sin(p.stateTime * 6)) * 0.12;
        break;
      }
      case 'tackle': {
        R.hip.rotation.z = 0.9; R.knee.rotation.z = -0.2;
        this.spine.rotation.z = -0.15;
        break;
      }
      default:
        break;
    }
    // GK ready stance when still
    if (p.isGK && sp < 0.5 && p.state === 'run') {
      AL.sh.rotation.x = -0.5; AR.sh.rotation.x = 0.5;
      AL.elbow.rotation.z = -0.6; AR.elbow.rotation.z = -0.6;
      this.pelvis.position.y = 0.88;
    } else this.pelvis.position.y = 0.92;

    // lean into turns at speed (inside of the turn is local +z when facing increases)
    let turnRate = 0;
    if (this._prevFacing != null && dt > 0) {
      let df = p.facing - this._prevFacing;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      turnRate = df / dt;
    }
    this._prevFacing = p.facing;
    if (p.state === 'run' && !(p.kickAnim > 0)) {
      this.body.rotation.x = Math.max(-0.2, Math.min(0.2, turnRate * sp * 0.01));
    }
    this.blendPose(dt, p);
  }

  // Ease every joint towards this frame's pose so state changes (kick, tackle, slide, getting up,
  // starting and stopping) flow into each other instead of snapping.
  blendPose(dt, p) {
    if (!this._joints) {
      this._joints = [this.body, this.spine, ...this.legs.flatMap((l) => [l.hip, l.knee]), ...this.arms.flatMap((a) => [a.sh, a.elbow])];
      this._pose = this._joints.map((j) => j.rotation.clone());
      this._bodyY = this.body.position.y;
      this._lastState = p.state;
      return;
    }
    if (p.state !== this._lastState) { this._lastState = p.state; this._blendT = 0.22; }
    if (!(dt > 0)) {
      this._joints.forEach((j, i) => j.rotation.copy(this._pose[i]));
      this.body.position.y = this._bodyY;
      return;
    }
    const transition = (this._blendT || 0) > 0;
    if (transition) this._blendT -= dt;
    const a = 1 - Math.exp(-(transition ? 14 : 32) * dt);
    this._joints.forEach((j, i) => {
      const q = this._pose[i];
      q.x += (j.rotation.x - q.x) * a; q.y += (j.rotation.y - q.y) * a; q.z += (j.rotation.z - q.z) * a;
      j.rotation.copy(q);
    });
    this._bodyY += (this.body.position.y - this._bodyY) * a;
    this.body.position.y = this._bodyY;
  }
}
