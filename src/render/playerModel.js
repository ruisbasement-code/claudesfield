import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural footballer.
//
// Each body segment (pelvis, torso, head, thighs, shins, feet, arms) is ONE mesh: its parts are
// merged into a single geometry with per-vertex colours, so a player costs ~16 draw calls while
// still having a kit with trim, socks, boots, hair, beard and face details.
// The model faces +x, +z is the player's right, y is up. Joints swing around z (forward/back)
// and x (out to the side).

// ---------------------------------------------------------------------------------------------
// materials (shared by everyone: colours live in the vertices)
const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
const bootMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
const SHADOW_GEO = new THREE.CircleGeometry(0.42, 20);

// ---------------------------------------------------------------------------------------------
// geometry helpers
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// A primitive placed in segment space and painted one colour.
function part(geo, color, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const g = geo;
  _m.compose(_v.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(scale[0], scale[1], scale[2]));
  g.applyMatrix4(_m);
  _c.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const sphere = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cap = (r, thetaLen, tilt = 0, w = 18, h = 10) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, thetaLen).rotateZ(tilt);
const cyl = (rt, rb, h, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const lathe = (pts, seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const merge = (parts) => {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
};

function shade(hex, f) {
  _c.set(hex);
  const hsl = {};
  _c.getHSL(hsl);
  _c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return '#' + _c.getHexString();
}
function luminance(hex) { _c.set(hex); return 0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b; }

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const BOOTS = [
  { boot: '#121212', sole: '#e9e9e9', accent: '#f4f4f4' },
  { boot: '#f2f2f2', sole: '#202020', accent: '#d62839' },
  { boot: '#d7ff2f', sole: '#1b1b1b', accent: '#111111' },
  { boot: '#ff6a1a', sole: '#1b1b1b', accent: '#121212' },
  { boot: '#21c7e8', sole: '#f2f2f2', accent: '#ff3d8b' },
  { boot: '#ff3d8b', sole: '#202020', accent: '#f2f2f2' },
  { boot: '#1c3fae', sole: '#f2f2f2', accent: '#ffd21f' },
  { boot: '#b8bcc4', sole: '#202020', accent: '#d62839' },
  { boot: '#d62839', sole: '#151515', accent: '#ffffff' },
];

// ---------------------------------------------------------------------------------------------
// shirt print textures
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
const FONT = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
function backTexture(num, color, outline, name) {
  return canvasTex(`b|${num}|${color}|${outline}|${name}`, 256, 256, (g, w) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.fillStyle = color;
    g.strokeStyle = outline;
    const nm = (name || '').toUpperCase().slice(0, 13);
    if (nm) {
      g.font = `700 40px ${FONT}`;
      const sx = Math.min(1, 220 / Math.max(1, g.measureText(nm).width));
      g.save(); g.translate(w / 2, 34); g.scale(sx, 1);
      g.lineWidth = 5; g.strokeText(nm, 0, 0); g.fillText(nm, 0, 0);
      g.restore();
    }
    g.font = `800 178px ${FONT}`;
    g.lineWidth = 9;
    g.strokeText(String(num), w / 2, 156);
    g.fillText(String(num), w / 2, 156);
  });
}
function frontTexture(num, color, outline, crest) {
  return canvasTex(`f|${num}|${color}|${outline}|${crest}`, 256, 128, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // number on the viewer's left (player's right chest)
    g.font = `800 92px ${FONT}`;
    g.lineWidth = 6;
    g.strokeStyle = outline;
    g.fillStyle = color;
    g.strokeText(String(num), 64, 68);
    g.fillText(String(num), 64, 68);
    // crest on the viewer's right (player's left chest, over the heart)
    g.save();
    g.translate(192, 62);
    g.beginPath();
    g.moveTo(-24, -28); g.lineTo(24, -28); g.lineTo(24, 4);
    g.quadraticCurveTo(24, 26, 0, 36); g.quadraticCurveTo(-24, 26, -24, 4); g.closePath();
    g.fillStyle = crest; g.fill();
    g.lineWidth = 5; g.strokeStyle = color; g.stroke();
    g.beginPath(); g.arc(0, 2, 9, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    g.restore();
  });
}

// A decal that hugs the elliptical torso. side: -1 back, +1 front.
// rx/rz: torso half depth / half width at the decal's height (spine space).
const decalGeoCache = new Map();
function torsoDecal(w, h, y, side, rx, rz) {
  const key = [w, h, y, side, rx, rz].join('|');
  if (decalGeoCache.has(key)) return decalGeoCache.get(key);
  const g = new THREE.PlaneGeometry(w, h, 10, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i);
    const zz = side < 0 ? u : -u; // texture left->right maps to the viewer's left->right
    const d = rx * Math.sqrt(Math.max(0, 1 - (zz / rz) ** 2)) + 0.006;
    p.setXYZ(i, side * d, y + v, zz);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  decalGeoCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// body dimensions (metres for a 1.80 m player; the whole body is scaled by height)
const HIP_Y = 0.92;
const THIGH = 0.42;
const SHIN = 0.42;
const SPINE_Y = 0.1; // spine pivot above the pelvis
const SHOULDER = { y: 0.41, z: 0.205 };
const UPPER_ARM = 0.28;
const TORSO_DEPTH = 0.62; // torso x-scale (front-to-back flattening)

// Torso profile (radius, height above the spine pivot): narrow waist, wide chest and shoulders.
const TORSO_PROFILE = [[0.0, -0.11], [0.158, -0.1], [0.162, 0.0], [0.168, 0.1], [0.182, 0.22], [0.195, 0.32], [0.198, 0.37], [0.18, 0.425], [0.13, 0.46], [0.065, 0.48], [0.0, 0.485]];
const PELVIS_PROFILE = [[0.0, -0.135], [0.11, -0.13], [0.158, -0.07], [0.172, 0.02], [0.166, 0.13], [0.0, 0.135]];
const THIGH_PROFILE = [[0.0, 0.02], [0.08, 0.0], [0.087, -0.09], [0.083, -0.19], [0.071, -0.29], [0.058, -0.37], [0.054, -0.42], [0.0, -0.43]];
const SOCK_PROFILE = [[0.0, -0.03], [0.05, -0.035], [0.06, -0.09], [0.064, -0.15], [0.058, -0.22], [0.046, -0.31], [0.04, -0.38], [0.041, -0.43], [0.0, -0.435]];

function torsoRadiusAt(y) {
  for (let i = 1; i < TORSO_PROFILE.length; i++) {
    const [r1, y1] = TORSO_PROFILE[i];
    if (y <= y1) { const [r0, y0] = TORSO_PROFILE[i - 1]; return r0 + (r1 - r0) * ((y - y0) / (y1 - y0)); }
  }
  return 0;
}

// Turn the sim's look data into a full appearance; the extra details come from a stable hash so
// a player always looks the same.
function appearance(player) {
  const d = player.data || {};
  const look = d.look || {};
  const seed = hashStr(`${d.name || d.short || ''}|${d.number ?? ''}|${look.skin || ''}|${look.hair || ''}`) || ((Math.random() * 1e9) | 0);
  const r = rng(seed);
  const skin = look.skin || '#e0b48f';
  const dark = luminance(skin) < 0.18;
  const base = look.hairStyle ?? 0;
  let hair;
  if (base === 3) hair = 'bald';
  else if (base === 1) hair = r() < 0.75 ? 'buzz' : 'fade';
  else if (base === 2) hair = dark && r() < 0.55 ? 'afro' : r() < 0.4 ? 'bun' : 'long';
  else hair = r() < 0.45 ? 'quiff' : r() < 0.3 ? 'fade' : 'short';
  const fr = r();
  const facial = fr < 0.28 ? 'beard' : 'none';
  return {
    seed,
    skin,
    hairColor: look.hair || '#2a2a2a',
    hair,
    facial,
    height: look.height || 1.8,
    build: 0.95 + r() * 0.12,
    boots: BOOTS[Math.floor(r() * BOOTS.length)],
    longSleeves: r() < 0.12,
    tape: r() < 0.3,
    celebrate: Math.floor(r() * 3),
    phase: r() * Math.PI * 2,
  };
}

// ---------------------------------------------------------------------------------------------
// pose: every animated value, blended as plain numbers
const POSE_KEYS = [
  'bodyY', 'bodyRX', 'bodyRZ', 'pelvisY', 'pelvisRX', 'pelvisRY', 'spineRX', 'spineRY', 'spineRZ', 'headRY', 'headRZ',
  'LhipZ', 'LhipA', 'LkneeZ', 'LankZ', 'RhipZ', 'RhipA', 'RkneeZ', 'RankZ',
  'LshZ', 'LshA', 'LelbZ', 'RshZ', 'RshA', 'RelbZ',
];
const newPose = () => Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));
function lerpPose(out, a, b, t) { for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; }
function copyPose(out, a) { for (const k of POSE_KEYS) out[k] = a[k]; return out; }

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
// keyframes: [t0, v0, t1, v1, ...] with eased segments
function kf(t, k) {
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (t <= k[i]) { const u = (t - k[i - 2]) / (k[i] - k[i - 2]); const e = u * u * (3 - 2 * u); return k[i - 1] + (k[i + 1] - k[i - 1]) * e; }
  }
  return k[k.length - 1];
}
const KICK = {
  RhipZ: [0, 0.05, 0.3, -0.55, 0.55, 1.15, 0.78, 0.85, 1, 0.15],
  RkneeZ: [0, -0.3, 0.3, -1.5, 0.48, -0.55, 0.6, -0.08, 1, -0.25],
  RankZ: [0, 0, 0.3, -0.55, 0.6, -0.45, 1, 0],
  pelvisRY: [0, 0, 0.3, -0.28, 0.6, 0.25, 1, 0],
  spineRY: [0, 0, 0.3, 0.22, 0.6, -0.2, 1, 0],
  spineRZ: [0, -0.08, 0.3, -0.12, 0.55, 0.08, 1, -0.05],
};

export class PlayerModel {
  // Renderer sets this every frame so players turn their heads towards the ball.
  static lookTarget = null;

  constructor(player, kit) {
    this.player = player;
    const ap = appearance(player);
    this.ap = ap;
    const isGK = !!player.isGK;
    const trim = kit.trim || kit.shorts || '#ffffff';
    const sockBand = kit.socks === trim ? kit.shorts : trim;
    const glove = '#f1f1f1';
    const boots = ap.boots;

    const root = new THREE.Group();
    this.root = root;
    const body = new THREE.Group(); // rotates for slides/dives
    root.add(body);
    this.body = body;
    const sc = ap.height / 1.8;
    body.scale.set(sc, sc, sc * ap.build);

    const seg = (parent, parts, x = 0, y = 0, z = 0, material = clothMat) => {
      const m = new THREE.Mesh(merge(parts), material);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.geos = [];

    // ---- pelvis + shorts
    const pelvis = new THREE.Group();
    pelvis.position.y = HIP_Y;
    body.add(pelvis);
    this.pelvis = pelvis;
    seg(pelvis, [
      part(lathe(PELVIS_PROFILE, 14), kit.shorts, [0, 0, 0], [0.74, 1, 1]),
      part(cyl(0.168, 0.168, 0.03, 14, true), shade(kit.shorts, 0.8), [0, 0.11, 0], [0.75, 1, 1]),
    ]);

    // ---- torso: shirt, collar, neck
    const spine = new THREE.Group();
    spine.position.y = SPINE_Y;
    pelvis.add(spine);
    this.spine = spine;
    seg(spine, [
      part(lathe(TORSO_PROFILE, 16), kit.shirt, [0, 0, 0], [TORSO_DEPTH, 1, 1]),
      part(new THREE.TorusGeometry(0.062, 0.016, 6, 16), trim, [0.008, 0.468, 0], [0.95, 1.1, 1], [Math.PI / 2, 0, 0]),
      part(cyl(0.056, 0.064, 0.12, 12), ap.skin, [0.01, 0.5, 0]),
    ]);

    // prints: name + number on the back, number + crest on the front
    if (player.data?.number !== '' && player.data?.number != null) {
      const outline = luminance(kit.number) > 0.5 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)';
      const mk = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const backY = 0.23;
      const back = new THREE.Mesh(
        torsoDecal(0.25, 0.25, backY, -1, torsoRadiusAt(backY + 0.03) * TORSO_DEPTH, torsoRadiusAt(backY)),
        mk(backTexture(player.data.number, kit.number, outline, player.data.short)),
      );
      spine.add(back);
      const frontY = 0.3;
      const front = new THREE.Mesh(
        torsoDecal(0.24, 0.12, frontY, 1, torsoRadiusAt(frontY) * TORSO_DEPTH, torsoRadiusAt(frontY)),
        mk(frontTexture(player.data.number, kit.number, outline, kit.trim === kit.shirt ? kit.shorts : kit.trim || '#ffffff')),
      );
      spine.add(front);
    }

    // ---- head
    const head = new THREE.Group();
    head.position.set(0.014, 0.53, 0);
    spine.add(head);
    this.head = head;
    const hp = [
      part(sphere(0.1, 20, 16), ap.skin, [0, 0.115, 0], [1.0, 1.17, 0.86]),
      part(sphere(0.07, 16, 12), ap.skin, [0.022, 0.058, 0], [1.0, 0.86, 0.9]), // jaw
      part(sphere(0.019, 8, 6), shade(ap.skin, 0.95), [0.1, 0.1, 0], [1.0, 1.5, 0.8]), // nose
      part(sphere(0.024, 8, 6), shade(ap.skin, 0.93), [-0.005, 0.105, 0.087], [0.6, 1.15, 0.45]), // ears
      part(sphere(0.024, 8, 6), shade(ap.skin, 0.93), [-0.005, 0.105, -0.087], [0.6, 1.15, 0.45]),
      part(sphere(0.011, 6, 5), '#17120e', [0.088, 0.128, 0.034]), // eyes
      part(sphere(0.011, 6, 5), '#17120e', [0.088, 0.128, -0.034]),
      part(box(0.012, 0.008, 0.036), shade(ap.hairColor, 0.9), [0.087, 0.148, 0.036], [1, 1, 1], [0.15, 0, 0]), // brows
      part(box(0.012, 0.008, 0.036), shade(ap.hairColor, 0.9), [0.087, 0.148, -0.036], [1, 1, 1], [-0.15, 0, 0]),
      part(box(0.006, 0.008, 0.034), shade(ap.skin, 0.68), [0.093, 0.056, 0]), // mouth
    ];
    const H = ap.hairColor;
    const hairCap = (r, theta, tilt, y = 0.118) => part(cap(r, theta, tilt), H, [-0.004, y, 0], [1.0, 1.17, 0.88]);
    switch (ap.hair) {
      case 'short': hp.push(hairCap(0.106, Math.PI * 0.55, 0.3)); break;
      case 'buzz': hp.push(hairCap(0.103, Math.PI * 0.56, 0.36)); break;
      case 'fade': hp.push(hairCap(0.104, Math.PI * 0.42, 0.2), part(sphere(0.05, 10, 6), H, [0.0, 0.215, 0], [1.4, 0.45, 1.0])); break;
      case 'quiff': hp.push(hairCap(0.107, Math.PI * 0.54, 0.3), part(sphere(0.06, 10, 7), H, [0.045, 0.205, 0], [1.25, 0.65, 1.15], [0, 0, -0.3])); break;
      case 'long': hp.push(hairCap(0.11, Math.PI * 0.6, 0.36), part(sphere(0.088, 12, 8), H, [-0.05, 0.06, 0], [0.75, 1.15, 1.05])); break;
      case 'afro': hp.push(hairCap(0.108, Math.PI * 0.55, 0.3), part(sphere(0.128, 14, 10), H, [-0.018, 0.165, 0], [1.0, 0.86, 1.0])); break;
      case 'bun': hp.push(hairCap(0.107, Math.PI * 0.55, 0.32), part(sphere(0.042, 10, 7), H, [-0.075, 0.2, 0])); break;
      default: break; // bald
    }
    if (ap.facial === 'beard') hp.push(part(sphere(0.079, 16, 12), H, [0.018, 0.052, 0], [1.0, 0.86, 0.95]));
    seg(head, hp);

    // ---- legs: hip -> knee -> ankle
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, -0.01, side * 0.092);
      pelvis.add(hip);
      seg(hip, [
        part(cyl(0.104, 0.097, 0.2, 12), kit.shorts, [0, -0.075, 0], [0.92, 1, 1]), // short leg
        part(cyl(0.099, 0.099, 0.02, 12, true), shade(kit.shorts, 0.82), [0, -0.172, 0], [0.92, 1, 1]), // hem
        part(box(0.04, 0.17, 0.008), trim, [0, -0.075, side * 0.1]), // side stripe
        part(lathe(THIGH_PROFILE, 12), ap.skin, [0.006, 0, 0], [1, 1, 0.94]),
      ]);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(knee);
      const sp = [
        part(sphere(0.057, 10, 8), ap.skin, [0.006, 0, 0]),
        part(lathe(SOCK_PROFILE, 12), kit.socks, [-0.004, 0, 0], [1, 1, 0.95]),
        part(cyl(0.058, 0.058, 0.035, 12, true), sockBand, [-0.002, -0.06, 0], [1.02, 1, 0.97]),
      ];
      if (ap.tape) sp.push(part(cyl(0.044, 0.045, 0.04, 12, true), '#f2f2f2', [-0.004, -0.36, 0], [1.04, 1, 1]));
      seg(knee, sp);
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN;
      knee.add(ankle);
      seg(ankle, [
        part(sphere(1, 16, 10), boots.boot, [0.05, -0.036, 0], [0.13, 0.045, 0.047]),
        part(sphere(0.045, 12, 8), boots.boot, [-0.028, -0.03, 0], [1, 1.05, 1.0]),
        part(cyl(0.043, 0.048, 0.07, 12), boots.boot, [-0.008, -0.005, 0]),
        part(sphere(1, 16, 6), boots.sole, [0.048, -0.07, 0], [0.135, 0.011, 0.05]),
        part(box(0.1, 0.012, 0.004), boots.accent, [0.045, -0.04, side * 0.046], [1, 1, 1], [0, 0, 0.3]),
      ], 0, 0, 0, bootMat);
      this.legs.push({ hip, knee, ankle, side });
    }

    // ---- arms: shoulder -> elbow
    this.arms = [];
    const longSleeves = isGK || ap.longSleeves;
    for (const side of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0, SHOULDER.y, side * SHOULDER.z);
      spine.add(sh);
      seg(sh, [
        part(sphere(0.062, 16, 12), kit.shirt, [0, -0.008, 0]), // deltoid
        part(cyl(0.061, 0.055, longSleeves ? 0.27 : 0.15, 16), kit.shirt, [0, longSleeves ? -0.135 : -0.065, 0]),
        longSleeves ? part(cyl(0.046, 0.042, UPPER_ARM, 8), kit.shirt, [0, -0.14, 0]) : part(cyl(0.046, 0.04, UPPER_ARM, 8), ap.skin, [0, -0.14, 0]),
        longSleeves ? part(sphere(0.02, 4, 3), kit.shirt, [0, -0.1, 0]) : part(cyl(0.0595, 0.0595, 0.018, 16, true), trim, [0, -0.133, 0]), // cuff
      ]);
      const elbow = new THREE.Group();
      elbow.position.y = -UPPER_ARM;
      sh.add(elbow);
      const ap2 = [
        part(sphere(0.041, 8, 6), longSleeves ? kit.shirt : ap.skin),
        part(cyl(0.04, 0.031, 0.24, 8), longSleeves ? kit.shirt : ap.skin, [0, -0.12, 0]),
      ];
      if (longSleeves) ap2.push(part(cyl(0.036, 0.036, 0.03, 8, true), trim, [0, -0.215, 0]));
      if (isGK) ap2.push(part(sphere(0.055, 10, 8), glove, [0.005, -0.29, 0], [0.8, 1.25, 0.6]), part(cyl(0.042, 0.042, 0.05, 8), shade(glove, 0.55), [0, -0.235, 0]));
      else ap2.push(part(sphere(0.04, 10, 8), shade(ap.skin, 0.97), [0.004, -0.285, 0], [0.78, 1.2, 0.48]));
      seg(elbow, ap2);
      this.arms.push({ sh, elbow, side });
    }

    const shadow = new THREE.Mesh(SHADOW_GEO, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    shadow.scale.set(1, 0.7, 1);
    root.add(shadow);
    this.shadow = shadow;

    // animation state
    this.t = ap.phase * 3;
    this.phase = ap.phase;
    this.spd = 0;
    this.accel = 0;
    this.turn = 0;
    this.fwd = 1;
    this.lat = 0;
    this.prevFacing = null;
    this.prevKick = 0;
    this.kickT0 = 0;
    this.overW = 0;
    this.readyW = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.base = newPose();
    this.over = newPose();
    this.pose = newPose();
    this.celebrate = 0;
  }

  update(dt, state) {
    const p = state || this.player;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    const ap = this.ap;
    this.root.position.set(p.pos.x, 0, p.pos.z);
    this.root.rotation.y = -p.facing; // facing angle measured from +x toward +z
    this.root.visible = !p.sentOff;
    this.t += dt;

    // ---- smoothed motion signals
    const speed = Math.hypot(p.vel.x, p.vel.z);
    // direction of travel relative to where the player faces (jockeying, shielding and keepers
    // side-step or back-pedal): fwd = cos, lat = sin of that angle, smoothed
    if (speed > 0.25) {
      const rel = wrapAngle(Math.atan2(p.vel.z, p.vel.x) - p.facing);
      const k = Math.min(1, dt * 8);
      this.fwd += (Math.cos(rel) - this.fwd) * k;
      this.lat += (Math.sin(rel) - this.lat) * k;
    }
    const prevSpd = this.spd;
    this.spd += (speed - this.spd) * Math.min(1, dt * 9);
    if (dt > 0) {
      this.accel += ((this.spd - prevSpd) / dt - this.accel) * Math.min(1, dt * 5);
      if (this.prevFacing !== null) {
        const w = wrapAngle(p.facing - this.prevFacing) / dt;
        this.turn += (clamp(w, -8, 8) - this.turn) * Math.min(1, dt * 7);
      }
    }
    this.prevFacing = p.facing;
    const s = this.spd;
    const gait = smooth(0.12, 0.9, s); // standing -> moving
    const run = smooth(2.2, 4.8, s); // walk -> run
    const sprint = smooth(5.4, 7.6, s);
    const cyc = Math.min(1.85, 0.62 + 0.16 * s); // strides per second
    this.phase += dt * TAU * cyc * Math.min(1, s * 4);

    const B = this.base;
    // ---- idle: breathing, weight shifts, looking around
    const t = this.t;
    const br = Math.sin(t * 2.3);
    const shift = Math.sin(t * 0.55 + ap.phase);
    B.bodyY = 0; B.bodyRX = 0; B.bodyRZ = 0;
    B.pelvisY = -0.012 - Math.abs(shift) * 0.008; B.pelvisRX = shift * 0.035; B.pelvisRY = Math.sin(t * 0.4 + ap.phase) * 0.05;
    B.spineRX = -shift * 0.03; B.spineRY = -B.pelvisRY * 0.6; B.spineRZ = -0.03 + br * 0.012;
    B.headRY = 0; B.headRZ = 0.03 - br * 0.008;
    B.LhipZ = 0.02; B.RhipZ = 0.02;
    B.LhipA = 0.06 + shift * 0.035; B.RhipA = 0.06 - shift * 0.035;
    B.LkneeZ = -0.06 - Math.max(0, -shift) * 0.1; B.RkneeZ = -0.06 - Math.max(0, shift) * 0.1;
    B.LankZ = 0.04; B.RankZ = 0.04;
    B.LshZ = 0.05 + br * 0.015; B.RshZ = 0.05 + br * 0.015;
    B.LshA = 0.12 + br * 0.01; B.RshA = 0.12 + br * 0.01;
    B.LelbZ = 0.22 + br * 0.03; B.RelbZ = 0.25 + br * 0.03;

    // ---- locomotion cycle (blended over the idle by gait)
    if (gait > 0.001) {
      const ph = this.phase;
      const A = clamp(s / (0.86 * TAU * cyc), 0.22, 0.92); // stride amplitude that keeps feet roughly planted
      const flex = 0.5 + 1.0 * run + 0.45 * sprint;
      const fwd = this.fwd, lat = this.lat;
      const fa = Math.abs(fwd);
      const legPose = (phi) => {
        const hipZ = A * Math.sin(phi) * fwd + 0.12 * run * Math.max(0, fwd);
        const sw = Math.max(0, Math.cos(phi + 0.25));
        const stance = Math.max(0, Math.sin(phi)) * Math.max(0, -Math.cos(phi)) * 2;
        const kneeZ = -(0.07 + 0.22 * run * stance + flex * Math.pow(sw, 1.6));
        const ankZ = -(hipZ + kneeZ) * 0.55 - 0.35 * Math.max(0, -Math.sin(phi)) * (0.4 + run * 0.6) + 0.05;
        return [hipZ, kneeZ, ankZ];
      };
      const [lh, lk, la] = legPose(ph);
      const [rh, rk, ra] = legPose(ph + Math.PI);
      const sL = Math.sin(ph);
      const armAmp = (0.32 + 0.33 * run + 0.3 * sprint) * (0.35 + 0.65 * fa);
      const elb = 0.28 + 1.05 * run + 0.25 * sprint;
      const lean = (0.05 + 0.12 * run + 0.1 * sprint) * fwd + clamp(this.accel * 0.03, -0.12, 0.22) * fa;
      const bob = 0.055 * run * (Math.abs(sL) - 0.5) + 0.022 * (1 - run) * (Math.abs(Math.cos(ph)) - 0.5);
      const roll = clamp(Math.atan((this.turn * s) / 9.8) * 0.85, -0.42, 0.42);
      const G = this.over; // scratch
      G.bodyY = bob; G.bodyRX = roll; G.bodyRZ = 0;
      G.pelvisY = -0.025 * run - 0.03 * (1 - fa); G.pelvisRX = -0.04 * Math.cos(ph) * (1 - run * 0.5); G.pelvisRY = -0.13 * sL * fa;
      G.spineRX = -G.pelvisRX * 0.7 + lat * 0.06; G.spineRY = 0.27 * sL * fa; G.spineRZ = -lean;
      G.headRY = -G.spineRY * 0.75; G.headRZ = lean * 0.75;
      // side-steps: the leading leg reaches out, the trailing one closes in (never crossing over)
      const sideAmp = A * 0.55 * lat;
      G.LhipZ = lh; G.LkneeZ = lk; G.LankZ = la; G.LhipA = 0.03 + Math.max(-0.06, -sideAmp * Math.sin(ph));
      G.RhipZ = rh; G.RkneeZ = rk; G.RankZ = ra; G.RhipA = 0.03 + Math.max(-0.06, sideAmp * Math.sin(ph + Math.PI));
      G.LshZ = -armAmp * sL + 0.06; G.RshZ = armAmp * sL + 0.06;
      G.LshA = 0.1 + 0.04 * run; G.RshA = 0.1 + 0.04 * run;
      G.LelbZ = elb + 0.25 * run * Math.max(0, -sL); G.RelbZ = elb + 0.25 * run * Math.max(0, sL);
      lerpPose(B, B, G, gait);
    }

    // ---- goalkeeper set stance when standing still
    const ready = p.isGK && p.state === 'run' && s < 1.4 ? 1 : 0;
    this.readyW += (ready - this.readyW) * Math.min(1, dt * 6);
    if (this.readyW > 0.001) {
      const w = this.readyW, R = this.over;
      copyPose(R, B);
      R.pelvisY = -0.075; R.spineRZ = -0.32; R.headRZ = 0.28;
      R.LhipZ = R.RhipZ = 0.42; R.LkneeZ = R.RkneeZ = -0.8; R.LankZ = R.RankZ = 0.36;
      R.LhipA = R.RhipA = 0.14;
      R.LshZ = R.RshZ = 0.5; R.LshA = R.RshA = 0.42; R.LelbZ = R.RelbZ = 0.75;
      lerpPose(B, B, R, w);
    }

    // ---- kick (right foot) layered over locomotion
    const k = p.kickAnim || 0;
    if (k > this.prevKick + 0.05) this.kickT0 = 1 - k;
    this.prevKick = k;
    if (k > 0) {
      const kt = 1 - k;
      const kw = smooth(this.kickT0, this.kickT0 + 0.09, kt) * (1 - smooth(0.78, 1, kt));
      for (const key in KICK) B[key] += (kf(kt, KICK[key]) - B[key]) * kw;
      const plant = { LhipZ: 0.22, LkneeZ: -0.42, LankZ: 0.18, pelvisY: -0.045, spineRX: -0.12, LshZ: 0.45, LshA: 1.05, LelbZ: 0.5, RshZ: -0.35, RshA: 0.6, RelbZ: 0.45, headRZ: -0.2 };
      for (const key in plant) B[key] += (plant[key] - B[key]) * kw;
    }

    // ---- state poses (slides, dives, falls, catches, celebrations)
    const O = this.over;
    let active = true;
    const st = p.stateTime || 0;
    switch (p.state) {
      case 'slide': {
        copyPose(O, B);
        O.bodyRZ = 1.32; O.bodyY = 0.03; O.bodyRX = 0;
        O.spineRZ = -0.55; O.headRZ = -0.25; O.spineRY = 0; O.pelvisRY = 0;
        O.RhipZ = 0.2; O.RkneeZ = -0.05; O.RankZ = 0.1;
        O.LhipZ = 0.3; O.LkneeZ = -0.6; O.LhipA = 0.15;
        O.LshZ = -0.6; O.LshA = 0.55; O.LelbZ = 0.2;
        O.RshZ = 0.4; O.RshA = 0.9; O.RelbZ = 0.3;
        break;
      }
      case 'dive': {
        copyPose(O, B);
        const dv = p.diveVel || { x: 0, z: 0 };
        const lat = -Math.sin(p.facing) * dv.x + Math.cos(p.facing) * dv.z; // + = towards the keeper's right
        const dir = Math.sign(lat) || 1;
        const u = Math.min(1, st * 3);
        O.bodyRX = dir * 1.38 * u; O.bodyRZ = 0;
        O.bodyY = (0.25 + (p.diveHeight || 0) * 0.9) * Math.sin(Math.min(Math.PI, st * 3.2));
        O.spineRX = dir * 0.12 * u; O.spineRZ = -0.1; O.spineRY = 0; O.pelvisRY = 0;
        O.headRZ = 0.1; O.headRY = 0;
        O.LshZ = O.RshZ = 0.25; O.LshA = O.RshA = 2.75; O.LelbZ = O.RelbZ = 0.12;
        O.LhipZ = 0.15; O.RhipZ = -0.05; O.LhipA = O.RhipA = 0.2;
        O.LkneeZ = dir > 0 ? -0.55 : -0.15; O.RkneeZ = dir > 0 ? -0.15 : -0.55;
        break;
      }
      case 'stumble': {
        copyPose(O, B);
        const u = Math.min(1, st * 2.5);
        const down = st < 0.6 ? u : Math.max(0, 1 - (st - 0.6) * 3);
        O.bodyRZ = -1.15 * down; O.bodyY = 0.06 * down;
        O.spineRZ = -0.2 * down; O.headRZ = 0.5 * down;
        O.LshZ = O.RshZ = 1.3 * down; O.LshA = O.RshA = 0.35; O.LelbZ = O.RelbZ = 0.3;
        O.LkneeZ = -0.5 * down; O.RkneeZ = -0.2 * down; O.LhipZ = 0.25 * down;
        break;
      }
      case 'hold': {
        copyPose(O, B);
        O.LshZ = O.RshZ = 0.75; O.LshA = O.RshA = 0.22; O.LelbZ = O.RelbZ = 1.45;
        O.spineRZ = Math.min(O.spineRZ, -0.06);
        break;
      }
      case 'tackle': {
        copyPose(O, B);
        O.RhipZ = 0.95; O.RkneeZ = -0.15; O.RankZ = 0.2;
        O.LhipZ = 0.15; O.LkneeZ = -0.6; O.LankZ = 0.3;
        O.pelvisY = -0.09; O.spineRZ = -0.32; O.pelvisRY = -0.2;
        O.LshA = 0.6; O.RshA = 0.5; O.LshZ = 0.3; O.RshZ = -0.2;
        break;
      }
      case 'celebrate': {
        copyPose(O, B);
        const style = ap.celebrate;
        if (style === 0) { // arms up, jumping
          O.LshA = O.RshA = 2.65; O.LshZ = O.RshZ = 0.15; O.LelbZ = O.RelbZ = 0.25;
          O.bodyY = B.bodyY + Math.abs(Math.sin(st * 6)) * 0.14; O.headRZ = -0.2;
        } else if (style === 1) { // aeroplane
          O.LshA = O.RshA = 1.45; O.LshZ = O.RshZ = -0.05; O.LelbZ = O.RelbZ = 0.08;
          O.bodyRX = B.bodyRX + Math.sin(st * 2.2) * 0.22;
        } else { // fist pump
          O.RshA = 0.25; O.RshZ = 1.4 + Math.sin(st * 9) * 0.35; O.RelbZ = 1.9;
          O.LshA = 0.5; O.LelbZ = 1.2; O.LshZ = 0.2; O.headRZ = -0.15;
        }
        break;
      }
      default: active = false;
    }
    this.overW += ((active ? 1 : 0) - this.overW) * Math.min(1, dt * (active ? 14 : 7));
    const P = this.overW > 0.001 ? lerpPose(this.pose, B, O, this.overW) : copyPose(this.pose, B);

    // ---- head tracks the ball (scaled down during dives/slides)
    const look = PlayerModel.lookTarget;
    if (look) {
      const dx = look.x - p.pos.x, dz = look.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const a = wrapAngle(Math.atan2(dz, dx) - p.facing);
      const w = dist > 0.3 ? (1 - smooth(32, 55, dist)) * (Math.abs(a) < 2.1 ? 1 : 0.3) : 0;
      const yaw = -clamp(a, -1.05, 1.05) * w;
      const pitch = -clamp(0.9 / Math.max(1, dist), 0, 0.35) * w;
      this.lookYaw += (yaw - this.lookYaw) * Math.min(1, dt * 5);
      this.lookPitch += (pitch - this.lookPitch) * Math.min(1, dt * 5);
      const lw = 1 - this.overW;
      P.headRY += this.lookYaw * 0.75 * lw;
      P.spineRY += this.lookYaw * 0.2 * lw * (1 - gait * 0.7);
      P.headRZ += this.lookPitch * lw;
    }

    // ---- write joints
    this.body.position.y = P.bodyY;
    this.body.rotation.set(P.bodyRX, 0, P.bodyRZ);
    this.pelvis.position.y = HIP_Y + P.pelvisY;
    this.pelvis.rotation.set(P.pelvisRX, P.pelvisRY, 0);
    this.spine.rotation.set(P.spineRX, P.spineRY, P.spineRZ);
    this.head.rotation.set(0, P.headRY, P.headRZ);
    const [L, R] = this.legs;
    L.hip.rotation.set(P.LhipA, 0, P.LhipZ); // left side: +x rotation swings the leg outwards
    L.knee.rotation.z = P.LkneeZ;
    L.ankle.rotation.z = P.LankZ;
    R.hip.rotation.set(-P.RhipA, 0, P.RhipZ);
    R.knee.rotation.z = P.RkneeZ;
    R.ankle.rotation.z = P.RankZ;
    const [AL, AR] = this.arms;
    AL.sh.rotation.set(P.LshA, 0, P.LshZ);
    AL.elbow.rotation.set(0, 0, P.LelbZ);
    AR.sh.rotation.set(-P.RshA, 0, P.RshZ);
    AR.elbow.rotation.set(0, 0, P.RelbZ);

    // shadow follows the body (dives and slides move it off the feet)
    const off = Math.sin(P.bodyRZ) * -0.5;
    const offZ = Math.sin(P.bodyRX) * 0.5;
    this.shadow.position.set(off, 0.015, offZ);
    this.shadow.scale.set(1 + Math.abs(off) * 1.2, 0.7 + Math.abs(offZ) * 1.2, 1);
  }
}
