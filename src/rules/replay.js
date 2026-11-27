// Goal replays: a ring buffer of recent world state, played back by the renderer.
// match.replay = { active, frames, t, speed, title } while a replay is showing.
const FPS = 30;
const SECONDS = 12;

export class ReplayRecorder {
  constructor(match) {
    this.match = match;
    this.frames = new Array(FPS * SECONDS);
    this.head = 0;
    this.count = 0;
    this.acc = 0;
  }

  clear() { this.head = 0; this.count = 0; }

  record(dt) {
    this.acc += dt;
    if (this.acc < 1 / FPS) return;
    this.acc -= 1 / FPS;
    if (this.acc > 1 / FPS) this.acc = 0;
    const m = this.match;
    const b = m.ball.pos;
    const ref = m.officials?.referee;
    const frame = {
      ball: { x: b.x, y: b.y, z: b.z },
      players: m.players.map((p) => ({ x: p.pos.x, y: p.pos.y, z: p.pos.z, facing: p.facing, state: p.state, speed: Math.hypot(p.vel.x, p.vel.z), sentOff: !!p.sentOff })),
      referee: ref ? { x: ref.pos.x, z: ref.pos.z, facing: ref.facing } : null,
    };
    this.frames[this.head] = frame;
    this.head = (this.head + 1) % this.frames.length;
    this.count = Math.min(this.count + 1, this.frames.length);
  }

  // Chronological copy of the last `seconds` of play (optionally skipping the last `tail` seconds).
  snapshot(seconds = 6, tail = 0) {
    const n = Math.min(this.count, Math.round(seconds * FPS));
    const skip = Math.min(this.count - n, Math.round(tail * FPS));
    const out = [];
    const len = this.frames.length;
    for (let i = n + skip; i > skip; i--) out.push(this.frames[(this.head - i + len * 2) % len]);
    return out;
  }

  // Start a replay. Returns its duration in real seconds.
  play(title = 'Replay', frames = this.snapshot(6), speed = 0.6) {
    if (!frames || frames.length < FPS) return 0;
    this.match.replay = { active: true, frames, t: 0, speed, fps: FPS, title };
    return frames.length / FPS / speed;
  }

  // Advances playback; returns true when finished.
  advance(dt) {
    const r = this.match.replay;
    if (!r?.active) return true;
    r.t += dt * r.fps * r.speed;
    if (r.t >= r.frames.length - 1) { this.stop(); return true; }
    return false;
  }

  stop() { if (this.match.replay) this.match.replay.active = false; this.match.replay = null; }
}
