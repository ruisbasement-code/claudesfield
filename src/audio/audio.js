// Synthesised match audio: crowd bed with swells, whistle, kicks, net, woodwork.
export class MatchAudio {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, sfx: 0.8, crowd: 0.7 };
    this.excite = 0; // 0..1 crowd excitement
  }

  ensure() {
    if (this.ctx) return true;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfxGain = c.createGain();
    this.sfxGain.connect(this.master);
    this.crowdGain = c.createGain();
    this.crowdGain.connect(this.master);
    // noise buffer
    const len = c.sampleRate * 3;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.97 + w * 0.03; d[i] = last * 6 + w * 0.15; }
    }
    this.noise = buf;
    // crowd bed: filtered brown-ish noise, two layers
    const bed = c.createBufferSource();
    bed.buffer = buf; bed.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 520; lp.Q.value = 0.5;
    this.bedGain = c.createGain(); this.bedGain.gain.value = 0.25;
    bed.connect(lp); lp.connect(this.bedGain); this.bedGain.connect(this.crowdGain);
    bed.start();
    const roar = c.createBufferSource();
    roar.buffer = buf; roar.loop = true; roar.playbackRate.value = 1.3;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    this.roarGain = c.createGain(); this.roarGain.gain.value = 0;
    roar.connect(bp); bp.connect(this.roarGain); this.roarGain.connect(this.crowdGain);
    roar.start();
    this.applyVolume();
    return true;
  }

  resume() { if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) { Object.assign(this.vol, v); this.applyVolume(); }
  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfxGain.gain.value = this.vol.sfx;
    this.crowdGain.gain.value = this.vol.crowd;
  }

  update(dt, active) {
    this.excite = Math.max(0, this.excite - dt * 0.25);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roarGain.gain.setTargetAtTime(active ? this.excite * 0.9 : 0, t, 0.25);
    this.bedGain.gain.setTargetAtTime(active ? 0.22 + this.excite * 0.1 : 0.08, t, 0.5);
  }

  cheer(amount) { this.excite = Math.min(1, Math.max(this.excite, amount)); }

  whistle(kind = 'short') {
    if (!this.ensure()) return;
    const c = this.ctx;
    const blasts = kind === 'long' ? [[0, 0.9]] : kind === 'double' ? [[0, 0.22], [0.3, 0.22]] : kind === 'triple' ? [[0, 0.3], [0.4, 0.3], [0.8, 1.0]] : [[0, 0.35]];
    for (const [off, dur] of blasts) {
      const t0 = c.currentTime + off;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.setValueAtTime(0.18, t0 + dur - 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      g.connect(this.sfxGain);
      for (const f of [2900, 3150]) {
        const o = c.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const lfo = c.createOscillator(); lfo.frequency.value = 28;
        const lg = c.createGain(); lg.gain.value = 60;
        lfo.connect(lg); lg.connect(o.frequency);
        o.connect(g); o.start(t0); o.stop(t0 + dur + 0.05); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
      }
    }
  }

  kick(power = 0.5) {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 + power * 60, t0);
    o.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25 + power * 0.45, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t0); o.stop(t0 + 0.2);
    const n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.12 + power * 0.2, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    n.connect(hp); hp.connect(ng); ng.connect(this.sfxGain);
    n.start(t0, Math.random() * 2, 0.08);
  }

  post() {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    for (const f of [520, 1310, 2150]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
      o.connect(g); g.connect(this.sfxGain); o.start(t0); o.stop(t0 + 0.7);
    }
    this.cheer(0.7);
  }

  net() {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    n.connect(bp); bp.connect(g); g.connect(this.sfxGain);
    n.start(t0, Math.random(), 0.4);
  }

  stop() { this.excite = 0; }
}
