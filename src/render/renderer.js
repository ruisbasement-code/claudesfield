import * as THREE from 'three';
import { BALL, PITCH, GOAL } from '../core/constants.js';
import { buildPitch } from './pitch.js';
import { buildStadium, buildSky } from './stadium.js';
import { PlayerModel } from './playerModel.js';
import { CameraRig } from './camera.js';

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, 256, 128);
  // simple modern panel design: curved stripes + dots
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 6;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    const x = i * 64 + 10;
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 40, 40, x - 20, 88, x + 30, 128);
    g.stroke();
  }
  g.fillStyle = '#e04a2f';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(20 + i * 44, 64 + (i % 2 ? 20 : -20), 9, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function officialKit() {
  return { shirt: '#111214', shorts: '#111214', socks: '#111214', number: '#f2c300', trim: '#f2c300' };
}

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias !== false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.92;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.rig = new CameraRig(innerWidth / innerHeight);
    this.resScale = 1;
    this.timeOfDay = 'night';

    const { group: pitch, goals } = buildPitch(this.gl);
    this.goals = goals;
    this.scene.add(pitch);
    this.stadium = buildStadium();
    this.scene.add(this.stadium);
    this.sky = buildSky(this.scene, 'night');

    // lighting: floodlit evening
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a3a20, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e5, 2.2);
    this.sun.position.set(-30, 70, 40);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 50; sc.bottom = -50; sc.near = 10; sc.far = 200;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    this.fill.position.set(40, 50, -40);
    this.scene.add(this.fill);

    // ball
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 16),
      new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 }),
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL.radius * 1.3, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.ballQuat = new THREE.Quaternion();

    // controlled player marker: chevron above the head + ground ring
    const chev = new THREE.Shape();
    chev.moveTo(-0.22, 0.2); chev.lineTo(0, -0.05); chev.lineTo(0.22, 0.2); chev.lineTo(0.12, 0.2); chev.lineTo(0, 0.08); chev.lineTo(-0.12, 0.2);
    this.marker = new THREE.Mesh(new THREE.ShapeGeometry(chev), new THREE.MeshBasicMaterial({ color: 0xf2c14e, side: THREE.DoubleSide, depthTest: false }));
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 32), new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
    // second human (local co-op) marker
    this.marker2 = this.marker.clone();
    this.marker2.material = this.marker.material.clone();
    this.marker2.material.color.set(0x8ecae6);
    this.scene.add(this.marker2);
    // pass/shot aim helpers
    this.aim = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.36, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.aim.renderOrder = 11;
    this.aim.visible = false;
    this.scene.add(this.aim);
    this.receiverRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    this.receiverRing.rotation.x = -Math.PI / 2;
    this.receiverRing.visible = false;
    this.scene.add(this.receiverRing);

    this.playerModels = [];
    this.officialModels = [];
    this.match = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(g = {}) {
    const shadows = g.shadows !== false && g.quality !== 'low';
    this.gl.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(g.quality === 'high' ? 2048 : 1024, g.quality === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resScale = g.resolutionScale || 1;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  setEnvironment(timeOfDay = 'night', weather = 'clear') {
    this.timeOfDay = timeOfDay;
    const day = timeOfDay === 'day', eve = timeOfDay === 'evening';
    this.scene.remove(this.sky);
    this.sky = buildSky(this.scene, day ? 'day' : 'night');
    if (eve) {
      this.sky.material.uniforms.top.value.set(0x283a66);
      this.sky.material.uniforms.bottom.value.set(0xe59a5c);
    }
    if (weather === 'overcast' || weather === 'rain') {
      this.sky.material.uniforms.top.value.lerp(new THREE.Color(0x4a5058), 0.7);
      this.sky.material.uniforms.bottom.value.lerp(new THREE.Color(0x8a9098), 0.7);
    }
    this.sun.intensity = day ? 2.6 : eve ? 2.0 : 2.2;
    this.sun.color.set(day ? 0xfff1d6 : eve ? 0xffd2a1 : 0xf4f6ff);
    this.sun.position.set(day ? -40 : -30, day ? 80 : 70, day ? 30 : 40);
    this.hemi.intensity = day ? 1.1 : 0.85;
    if (weather === 'overcast' || weather === 'rain') { this.sun.intensity *= 0.55; this.hemi.intensity *= 1.15; }
    this.scene.fog = weather === 'rain' ? new THREE.Fog(0x6a7078, 60, 260) : null;
    this.setRain(weather === 'rain');
  }

  setRain(on) {
    // crowd bounce with excitement
    const ex = view.excite || 0;
    const mats = this.stadium.userData.crowdMats || [];
    const tt = performance.now() / 1000;
    mats.forEach((mm, i) => { mm.map.offset.y = Math.abs(Math.sin(tt * 9 + i)) * 0.004 * ex; });
    if (this.rain) { this.scene.remove(this.rain); this.rain = null; }
    if (!on) return;
    const N = 6000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 160, y = Math.random() * 40, z = (Math.random() - 0.5) * 110;
      pos.set([x, y, z, x + 0.05, y - 0.6, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.35 }));
    this.scene.add(this.rain);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setPixelRatio(Math.min(2, devicePixelRatio) * this.resScale);
    this.gl.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  attach(match) {
    this.detach();
    this.match = match;
    for (const p of match.players) {
      let kit = p.team.kit;
      if (p.isGK) {
        kit = p.team.data.kits.gk;
        const other = match.teams.find((t) => t !== p.team).data.kits.gk;
        if (p.team.index === 1 && other.shirt === kit.shirt) kit = { ...kit, shirt: '#3a3a3a', socks: '#3a3a3a' };
      }
      const m = new PlayerModel(p, kit);
      this.scene.add(m.root);
      this.playerModels.push(m);
    }
    // officials
    const offKit = officialKit();
    const fake = (name, num) => ({ data: { number: '', short: '', look: { skin: '#d9a982', hair: '#222', hairStyle: 1, height: 1.8 } }, isGK: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, animPhase: 0, kickAnim: 0, state: 'run' });
    this.officialStates = [fake('ref'), fake('ar1'), fake('ar2')];
    this.officialModels = this.officialStates.map((s, i) => {
      const m = new PlayerModel(s, offKit);
      m.root.visible = false;
      this.scene.add(m.root);
      if (i > 0) {
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.28), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
        flag.position.set(0.18, -0.25, 0);
        m.arms[1].elbow.add(flag);
        m.flag = flag;
      }
      return m;
    });
    // crowd colours
    this.scene.remove(this.stadium);
    this.stadium = buildStadium([match.teams[0].kit.shirt, match.teams[0].kit.shorts], [match.teams[1].kit.shirt]);
    this.scene.add(this.stadium);
    this.rig.override = null;
    this.snapNext = true;
  }

  detach() {
    for (const m of [...this.playerModels, ...this.officialModels]) this.scene.remove(m.root);
    this.playerModels = [];
    this.officialModels = [];
    this.match = null;
  }

  render(dt, view = {}) {
    const match = this.match;
    const rig = this.rig;
    if (!match) {
      rig.override = 'title';
      rig.update(dt, { focus: new THREE.Vector3(), ball: null });
      this.ballMesh.visible = false;
      this.ballShadow.visible = false;
      this.marker.visible = this.ring.visible = this.marker2.visible = false;
      this.aim.visible = false;
      this.receiverRing.visible = false;
      this.gl.render(this.scene, rig.camera);
      return;
    }
    this.ballMesh.visible = this.ballShadow.visible = true;
    const replay = match.replay?.active ? match.replay : null;
    let ballPos;
    if (replay) {
      const fr = replay.frames;
      const i = Math.min(fr.length - 1, Math.floor(replay.t));
      const j = Math.min(fr.length - 1, i + 1);
      const a = replay.t - i;
      const A = fr[i], B = fr[j];
      ballPos = new THREE.Vector3(A.ball.x + (B.ball.x - A.ball.x) * a, A.ball.y + (B.ball.y - A.ball.y) * a, A.ball.z + (B.ball.z - A.ball.z) * a);
      if (!this.replayStates) this.replayStates = match.players.map((p) => ({ ...p, pos: new THREE.Vector3(), vel: new THREE.Vector3(), animPhase: 0, kickAnim: 0, data: p.data, isGK: p.isGK }));
      match.players.forEach((p, k) => {
        const s = this.replayStates[k];
        const pa = A.players[k], pb = B.players[k];
        s.pos.set(pa.x + (pb.x - pa.x) * a, 0, pa.z + (pb.z - pa.z) * a);
        let df = pb.facing - pa.facing;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        s.facing = pa.facing + df * a;
        const sp = pa.speed ?? 0;
        s.vel.set(Math.cos(s.facing) * sp, 0, Math.sin(s.facing) * sp);
        s.animPhase += dt * (replay.speed ?? 0.6) * sp * 1.55;
        s.state = pa.state;
        s.stateTime = (s.state === s._lastState ? (s.stateTime || 0) + dt * 0.6 : 0);
        s._lastState = s.state;
        s.sentOff = pa.sentOff;
        s.kickAnim = 0;
        this.playerModels[k].update(dt, s);
      });
      rig.override = 'replay';
    } else {
      this.replayStates = null;
      ballPos = match.ball.pos;
      const prev = view.prev, al = Math.min(1, Math.max(0, view.alpha ?? 1));
      if (prev && prev.players.length === this.playerModels.length && al < 1) {
        const b = prev.ball;
        ballPos = new THREE.Vector3(b.x + (ballPos.x - b.x) * al, b.y + (ballPos.y - b.y) * al, b.z + (ballPos.z - b.z) * al);
        this.playerModels.forEach((m, i) => {
          m.update(dt);
          const q = prev.players[i], p = m.player;
          m.root.position.x = q.x + (p.pos.x - q.x) * al;
          m.root.position.z = q.z + (p.pos.z - q.z) * al;
        });
      } else for (const m of this.playerModels) m.update(dt);
      const sp = match.setPiece;
      const humanTaker = sp && sp.team.human;
      const humanKeeper = sp && sp.type === 'penalty' && sp.team.opponent.human;
      if (match.phase === 'setpiece' && sp?.type === 'penalty') rig.override = 'penalty';
      else if (match.phase === 'setpiece' && sp?.type === 'freekick' && sp.direct && humanTaker && Math.hypot(sp.team.attackGoal.x - sp.spot.x, sp.spot.z) < 32) rig.override = 'freekick';
      else if (match.phase === 'shootout' && sp) rig.override = 'penalty';
      else rig.override = null;
      void humanKeeper;
    }

    // ball transform + rotation
    this.ballMesh.position.copy(ballPos);
    if (!replay) {
      const b = match.ball;
      const w = b.inAir() ? b.spin : new THREE.Vector3(b.vel.z / BALL.radius, 0, -b.vel.x / BALL.radius);
      const ang = w.length() * dt;
      if (ang > 1e-5) {
        const q = new THREE.Quaternion().setFromAxisAngle(w.clone().normalize(), ang);
        this.ballQuat.premultiply(q);
        this.ballMesh.quaternion.copy(this.ballQuat);
      }
    }
    this.ballShadow.position.set(ballPos.x, 0.014, ballPos.z);
    const hgt = Math.max(0, ballPos.y - BALL.radius);
    this.ballShadow.scale.setScalar(1 + hgt * 0.25);
    this.ballShadow.material.opacity = Math.max(0.08, 0.35 - hgt * 0.04);

    // net bulge when the ball is in the net
    for (const g of this.goals) {
      const back = g.userData.back;
      const inThis = Math.sign(ballPos.x) === Math.sign(g.position.x) && Math.abs(ballPos.x) > PITCH.halfL + GOAL.depth - 0.5 && Math.abs(ballPos.z) < GOAL.halfW && ballPos.y < GOAL.height;
      const target = inThis ? 0.35 : 0;
      back.position.x += ((GOAL.depth + target) - back.position.x) * Math.min(1, dt * 10);
    }

    // officials
    const off = match.officials;
    if (off && !replay) {
      const list = [off.referee, ...(off.assistants || [])];
      list.forEach((o, i) => {
        const m = this.officialModels[i];
        if (!m || !o) return;
        const s = this.officialStates[i];
        s.pos.copy(o.pos); s.vel.copy(o.vel || new THREE.Vector3()); s.facing = o.facing || 0;
        s.animPhase += dt * Math.hypot(s.vel.x, s.vel.z) * 1.55;
        s.state = 'run';
        m.root.visible = true;
        m.update(dt, s);
        if (i === 0 && (o.state === 'card' || o.state === 'whistle' || o.state === 'point' || o.state === 'advantage')) {
          m.arms[1].sh.rotation.x = o.state === 'card' ? 2.8 : 1.6;
          m.arms[1].elbow.rotation.z = 0;
        }
        if (m.flag) {
          const up = o.flag && o.flag !== 'down';
          m.arms[1].sh.rotation.x = up ? 2.9 : 0.1;
          m.flag.material.color.set(o.flag === 'offside' ? 0xff4136 : 0xffd400);
        }
      });
    } else if (replay && replay.frames[0]?.referee) {
      const fr = replay.frames[Math.min(replay.frames.length - 1, Math.floor(replay.t))];
      const m = this.officialModels[0];
      if (m && fr.referee) {
        const s = this.officialStates[0];
        s.pos.set(fr.referee.x, 0, fr.referee.z); s.facing = fr.referee.facing; s.vel.set(0, 0, 0);
        m.update(dt, s);
      }
    } else for (const m of this.officialModels) m.root.visible = false;

    // markers for human-controlled players
    const humans = match.teams.filter((t) => t.human);
    const markers = [this.marker, this.marker2];
    markers.forEach((mk) => (mk.visible = false));
    this.ring.visible = false;
    if (!replay) {
      humans.forEach((t, i) => {
        const p = view.controlledOverride?.[t.index] || t.controlled;
        if (!p || p.sentOff) return;
        const mk = markers[i];
        mk.visible = true;
        const h = (p.data.look?.height || 1.8) + 0.45 + Math.sin(performance.now() / 200) * 0.04;
        mk.position.set(p.pos.x, h, p.pos.z);
        mk.quaternion.copy(rig.camera.quaternion);
        if (i === 0) {
          this.ring.visible = true;
          this.ring.position.set(p.pos.x, 0.02, p.pos.z);
          this.ring.material.color.set(t.kit && view.markerColor ? view.markerColor : 0xf2c14e);
        }
      });
    }
    // aim reticle (penalty / direct free kick) supplied by the game
    if (view.aim && !replay) {
      this.aim.visible = true;
      this.aim.position.copy(view.aim);
      this.aim.lookAt(rig.camera.position);
    } else this.aim.visible = false;
    if (view.receiver && !replay) {
      this.receiverRing.visible = true;
      this.receiverRing.position.set(view.receiver.pos.x, 0.025, view.receiver.pos.z);
    } else this.receiverRing.visible = false;

    // camera
    const focus = new THREE.Vector3(ballPos.x, 0, ballPos.z);
    if (!replay && match.ball.owner) {
      const o = match.ball.owner;
      focus.x += Math.cos(o.facing) * 3;
    }
    rig.attackSide = view.attackSide || 1;
    rig.update(dt, { ball: ballPos, focus, match, setPiece: match.setPiece, replayBall: replay ? ballPos : null, snap: this.snapNext });
    this.snapNext = false;
    // crowd bounce with excitement
    const ex = view.excite || 0;
    const mats = this.stadium.userData.crowdMats || [];
    const tt = performance.now() / 1000;
    mats.forEach((mm, i) => { mm.map.offset.y = Math.abs(Math.sin(tt * 9 + i)) * 0.004 * ex; });
    if (this.rain) {
      this.rain.position.y -= dt * 30;
      if (this.rain.position.y < -20) this.rain.position.y += 20;
      this.rain.position.x = rig.camera.position.x * 0.5;
    }
    this.gl.render(this.scene, rig.camera);
  }
}
