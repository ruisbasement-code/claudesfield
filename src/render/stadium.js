import * as THREE from 'three';
import { PITCH } from '../core/constants.js';

function crowdTexture(seed, colors) {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1c20';
  g.fillRect(0, 0, W, H);
  const rows = 16;
  const rowH = H / rows;
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let row = 0; row < rows; row++) {
    // seat row step
    g.fillStyle = row % 2 ? '#24272c' : '#1f2226';
    g.fillRect(0, row * rowH, W, rowH);
    for (let x = 0; x < W; x += 5 + r() * 3) {
      if (r() < 0.1) continue; // empty seat
      const col = r() < 0.45 ? colors[Math.floor(r() * colors.length)] : ['#d9d4c7', '#6b6f78', '#2d3440', '#8a6d52', '#b8b0a0', '#3d4f6b'][Math.floor(r() * 6)];
      g.fillStyle = col;
      const hx = x, hy = row * rowH + rowH * 0.25;
      g.fillRect(hx, hy + 3, 4, rowH * 0.7); // body
      g.fillStyle = ['#e9c8a8', '#c99a72', '#8d5f3e', '#5a3a26'][Math.floor(r() * 4)];
      g.beginPath(); g.arc(hx + 2, hy + 2, 2, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function adTexture(texts) {
  const W = 2048, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const palettes = [['#101418', '#f2f2ee'], ['#0f7c80', '#ffffff'], ['#f2c14e', '#111111'], ['#1d2f5e', '#8ecae6'], ['#a3192f', '#ffffff']];
  const seg = W / texts.length;
  texts.forEach((t, i) => {
    const [bg, fg] = palettes[i % palettes.length];
    g.fillStyle = bg; g.fillRect(i * seg, 0, seg, H);
    g.fillStyle = fg;
    g.font = '700 38px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, i * seg + seg / 2, H / 2 + 2);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

const ADS = ['CLAUDESFIELD', 'NORTHWIND AIR', 'KOBALT', 'FIELDLINE', 'HALCYON', 'GRAINHOUSE', 'MERIDIAN', 'PITCHSIDE', 'OAKLINE', 'TIDEWATER'];

export function buildStadium(homeColors = ['#0f7c80'], awayColors = ['#a3192f']) {
  const group = new THREE.Group();
  const L = PITCH.halfL, W = PITCH.halfW;
  // ad boards
  const adMat = new THREE.MeshBasicMaterial({ map: adTexture(ADS) });
  const board = (len, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), adMat.clone());
    m.material.map = adMat.map.clone(); m.material.map.needsUpdate = true;
    m.material.map.repeat.set(len / 60, 1);
    m.position.set(x, 0.45, z); m.rotation.y = ry;
    group.add(m);
  };
  board(PITCH.length + 6, 0, -W - 5, 0);
  board(PITCH.length + 6, 0, W + 5, Math.PI);
  board(PITCH.width + 4, -L - 5.5, 0, Math.PI / 2);
  board(PITCH.width + 4, L + 5.5, 0, -Math.PI / 2);

  // stands: four sloped tiers with a crowd texture
  const crowdMats = [];
  const standMat = (seed, cols) => {
    const m = new THREE.MeshStandardMaterial({ map: crowdTexture(seed, cols), roughness: 1, side: THREE.DoubleSide, color: 0xb8b8b8 });
    crowdMats.push(m);
    return m;
  };
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, side: THREE.DoubleSide });
  const mkStand = (len, depth, rise, cols, seed, roofed = true) => {
    const s = new THREE.Group();
    const steps = 2;
    for (let i = 0; i < steps; i++) {
      const d0 = i * (depth / steps) + 2 * i;
      const slope = new THREE.Mesh(new THREE.PlaneGeometry(len, Math.hypot(depth / steps, rise / steps)), standMat(seed + i, cols));
      const ang = Math.atan2(rise / steps, depth / steps);
      slope.material.map.repeat.set(len / 40, 1);
      slope.position.set(0, (rise / steps) * (i + 0.5) + 1.2 + i * 2, d0 + depth / steps / 2);
      slope.rotation.x = Math.PI / 2 - ang;
      s.add(slope);
      // fascia
      const fascia = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2 + (i ? 2 : 0)), concrete);
      fascia.position.set(0, (rise / steps) * i + (i ? 2 : 0) * 0.5 + 0.6 + (i ? 0.4 : 0), d0);
      s.add(fascia);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(len, rise + 10), concrete);
    back.position.set(0, (rise + 10) / 2, depth + 2.5);
    back.rotation.y = Math.PI;
    s.add(back);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(len, depth * 0.8), roofMat);
    roof.rotation.x = -Math.PI / 2 + 0.12;
    roof.position.set(0, rise + 9, depth * 0.6);
    if (roofed) s.add(roof);
    return s;
  };
  const crowdCols = [...homeColors, ...homeColors, ...awayColors];
  const sideLen = PITCH.length + 14;
  const endLen = PITCH.width + 14;
  // no roof on the near stand: the broadcast camera sits above it
  const near = mkStand(sideLen, 26, 18, crowdCols, 11, false);
  near.position.set(0, 0, W + 7);
  group.add(near);
  const far = mkStand(sideLen, 30, 24, crowdCols, 23);
  far.position.set(0, 0, -W - 7);
  far.rotation.y = Math.PI;
  group.add(far);
  const e1 = mkStand(endLen, 22, 16, [...homeColors, ...homeColors], 37);
  e1.position.set(-L - 8, 0, 0); e1.rotation.y = -Math.PI / 2;
  group.add(e1);
  const e2 = mkStand(endLen, 22, 16, [...awayColors, ...homeColors], 51);
  e2.position.set(L + 8, 0, 0); e2.rotation.y = Math.PI / 2;
  group.add(e2);
  // corner fill blocks
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const blk = new THREE.Mesh(new THREE.BoxGeometry(22, 26, 22), concrete);
    blk.position.set(sx * (L + 20), 13, sz * (W + 20));
    group.add(blk);
  }
  // floodlight pylons
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 50, 8), pylonMat);
    pole.position.set(sx * (L + 22), 25, sz * (W + 22));
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), lightMat);
    head.position.set(sx * (L + 21), 50, sz * (W + 21));
    head.lookAt(0, 0, 0);
    group.add(head);
  }
  // ground outside
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x1b1d20 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05;
  group.add(outer);
  // dugouts
  const dugMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.6 });
  for (const sx of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 1.8), dugMat);
    d.position.set(sx * 10, 1, W + 3.2);
    group.add(d);
  }
  group.userData.crowdMats = crowdMats;
  return group;
}

export function buildSky(scene, timeOfDay = 'night') {
  const night = timeOfDay === 'night';
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(night ? 0x05070d : 0x4f86c6) },
      bottom: { value: new THREE.Color(night ? 0x1a2433 : 0xcfe2f0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
  return sky;
}
