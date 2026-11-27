// Tiny synthesized UI sounds (no audio files). Respects settings audio.master * audio.sfx.
import { volume } from './settings.js';

let ctx = null;
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function blip(freq, dur, type = 'sine', gain = 0.12, slide = 0) {
  const v = volume('sfx');
  if (v <= 0) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  unlock() { ac(); },
  move() { blip(1250, 0.045, 'triangle', 0.05); },
  change() { blip(900, 0.05, 'square', 0.03); },
  select() { blip(660, 0.09, 'triangle', 0.1, 1.5); },
  back() { blip(520, 0.09, 'triangle', 0.08, 0.6); },
  error() { blip(180, 0.16, 'sawtooth', 0.05); },
  start() { blip(440, 0.12, 'triangle', 0.1, 2); setTimeout(() => blip(880, 0.22, 'triangle', 0.08, 1.2), 90); },
};
