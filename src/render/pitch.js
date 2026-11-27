import * as THREE from 'three';
import { PITCH, GOAL } from '../core/constants.js';

// Grass: canvas texture with mowing stripes, subtle noise and wear in the goalmouths.
function grassTexture(maxAniso) {
  const W = 2048, H = 1366;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f6a2c' : '#3a7834';
    g.fillRect((i * W) / stripes, 0, W / stripes + 1, H);
  }
  // cross mow (faint)
  g.globalAlpha = 0.025;
  for (let j = 0; j < 12; j++) {
    g.fillStyle = j % 2 ? '#000' : '#fff';
    g.fillRect(0, (j * H) / 12, W, H / 12 + 1);
  }
  g.globalAlpha = 1;
  // noise
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n; d[i + 1] += n * 1.2; d[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  // wear patches: goalmouths and centre
  const wear = (x, y, rx, ry, a) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, rx);
    grd.addColorStop(0, `rgba(120,105,70,${a})`);
    grd.addColorStop(1, 'rgba(120,105,70,0)');
    g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, rx, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const px = (m) => ((m + PITCH.halfL + 3) / (PITCH.length + 6)) * W;
  const pz = (m) => ((m + PITCH.halfW + 3) / (PITCH.width + 6)) * H;
  wear(px(-PITCH.halfL + 3), pz(0), 90, 70, 0.35);
  wear(px(PITCH.halfL - 3), pz(0), 90, 70, 0.35);
  wear(px(0), pz(0), 60, 60, 0.15);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function lineMat() {
  return new THREE.MeshBasicMaterial({ color: 0xf4f4ee, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

// Pitch markings as real geometry so they stay crisp at any zoom.
function markings() {
  const group = new THREE.Group();
  const mat = lineMat();
  const w = 0.12;
  const y = 0.012;
  const rect = (x0, z0, x1, z1) => {
    const geo = new THREE.PlaneGeometry(Math.abs(x1 - x0) || w, Math.abs(z1 - z0) || w);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    group.add(m);
  };
  const lineX = (x0, x1, z) => rect(x0, z - w / 2, x1, z + w / 2);
  const lineZ = (z0, z1, x) => rect(x - w / 2, z0, x + w / 2, z1);
  const { halfL: L, halfW: W } = PITCH;
  lineX(-L - w / 2, L + w / 2, -W); lineX(-L - w / 2, L + w / 2, W);
  lineZ(-W, W, -L); lineZ(-W, W, L); lineZ(-W, W, 0);
  for (const s of [-1, 1]) {
    const gx = s * L;
    const bx = gx - s * PITCH.boxDepth;
    lineZ(-PITCH.boxHalfW, PITCH.boxHalfW, bx);
    lineX(Math.min(gx, bx), Math.max(gx, bx), -PITCH.boxHalfW);
    lineX(Math.min(gx, bx), Math.max(gx, bx), PITCH.boxHalfW);
    const sx = gx - s * PITCH.sixDepth;
    lineZ(-PITCH.sixHalfW, PITCH.sixHalfW, sx);
    lineX(Math.min(gx, sx), Math.max(gx, sx), -PITCH.sixHalfW);
    lineX(Math.min(gx, sx), Math.max(gx, sx), PITCH.sixHalfW);
    // penalty spot
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), mat);
    spot.rotation.x = -Math.PI / 2; spot.position.set(gx - s * PITCH.penaltySpot, y, 0);
    group.add(spot);
    // D arc: part of circle r 9.15 around spot outside the box
    const cx = gx - s * PITCH.penaltySpot;
    const dxBox = PITCH.boxDepth - PITCH.penaltySpot; // 5.5
    const half = Math.acos(dxBox / PITCH.centreCircleR);
    const start = s > 0 ? Math.PI - half : -half;
    const arc = new THREE.Mesh(new THREE.RingGeometry(PITCH.centreCircleR - w / 2, PITCH.centreCircleR + w / 2, 48, 1, start, half * 2), mat);
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(cx, y, 0);
    // RingGeometry is in XY plane; after rotation, +y maps to -z. Mirror so the arc angle is about x.
    arc.scale.y = -1;
    group.add(arc);
    // corner arcs
    for (const t of [-1, 1]) {
      const a0 = Math.atan2(-t, -s); // pointing into the pitch
      const ca = new THREE.Mesh(new THREE.RingGeometry(PITCH.cornerArcR - w / 2, PITCH.cornerArcR + w / 2, 12, 1, a0 - Math.PI / 4, Math.PI / 2), mat);
      ca.rotation.x = -Math.PI / 2;
      ca.scale.y = -1;
      ca.position.set(gx, y, t * W);
      group.add(ca);
    }
  }
  const cc = new THREE.Mesh(new THREE.RingGeometry(PITCH.centreCircleR - w / 2, PITCH.centreCircleR + w / 2, 72), mat);
  cc.rotation.x = -Math.PI / 2; cc.position.y = y;
  group.add(cc);
  const cs = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), mat);
  cs.rotation.x = -Math.PI / 2; cs.position.y = y;
  group.add(cs);
  return group;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildGoal(side, netTex) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  const r = GOAL.postR;
  const postGeo = new THREE.CylinderGeometry(r, r, GOAL.height + r, 16);
  for (const z of [-GOAL.halfW, GOAL.halfW]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.set(0, (GOAL.height + r) / 2, z);
    p.castShadow = true;
    g.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL.halfW * 2 + r * 2, 16), postMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, GOAL.height, 0);
  bar.castShadow = true;
  g.add(bar);
  // back frame (thin)
  const thin = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
  const D = GOAL.depth;
  const rod = (len, x, y, z, rx, rz) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), thin);
    m.position.set(x, y, z); m.rotation.x = rx || 0; m.rotation.z = rz || 0; g.add(m);
  };
  rod(GOAL.halfW * 2, D, 0.02, 0, Math.PI / 2, 0);
  for (const z of [-GOAL.halfW, GOAL.halfW]) {
    rod(Math.hypot(D, GOAL.height), D / 2, GOAL.height / 2, z, 0, Math.atan2(D, GOAL.height));
    rod(D, D / 2, 0.02, z, 0, Math.PI / 2);
  }
  // nets
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
  const mk = (w, h, rep) => {
    const mat = netMat.clone();
    mat.map = netTex.clone(); mat.map.needsUpdate = true;
    mat.map.repeat.set(rep[0], rep[1]);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  };
  const back = mk(GOAL.halfW * 2, GOAL.height, [GOAL.halfW * 2 / 0.14, GOAL.height / 0.14]);
  back.rotation.y = Math.PI / 2;
  back.position.set(D, GOAL.height / 2, 0);
  g.add(back);
  const roof = mk(D, GOAL.halfW * 2, [D / 0.14, GOAL.halfW * 2 / 0.14]);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(D / 2, GOAL.height, 0);
  g.add(roof);
  for (const z of [-GOAL.halfW, GOAL.halfW]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(D, 0); shape.lineTo(D, GOAL.height); shape.lineTo(0, GOAL.height); shape.lineTo(0, 0);
    const sideNet = mk(D, GOAL.height, [D / 0.14, GOAL.height / 0.14]);
    sideNet.position.set(D / 2, GOAL.height / 2, z);
    g.add(sideNet);
  }
  g.position.set(side * PITCH.halfL, 0, 0);
  if (side < 0) g.rotation.y = Math.PI;
  g.userData.back = back;
  return g;
}

export function buildPitch(renderer) {
  const group = new THREE.Group();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length + 6, PITCH.width + 6),
    new THREE.MeshStandardMaterial({ map: grassTexture(aniso), roughness: 0.95, metalness: 0 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  group.add(grass);
  // surrounding apron
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length + 40, PITCH.width + 40),
    new THREE.MeshStandardMaterial({ color: 0x2f5a29, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  group.add(apron);
  group.add(markings());
  const netTex = netTexture();
  const goals = [buildGoal(1, netTex), buildGoal(-1, netTex)];
  goals.forEach((g) => group.add(g));
  // corner flags
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, side: THREE.DoubleSide });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), poleMat);
    pole.position.set(sx * PITCH.halfL, 0.75, sz * PITCH.halfW);
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.25), flagMat);
    flag.position.set(sx * PITCH.halfL + 0.17, 1.35, sz * PITCH.halfW);
    group.add(flag);
  }
  return { group, goals };
}
