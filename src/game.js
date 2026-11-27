// Game: owns the render loop, the current Match, input and audio.
import { Match } from './sim/match.js';
import { SIM } from './core/constants.js';
import { Renderer } from './render/renderer.js';
import { Input } from './input/input.js';
import { HumanController } from './input/humanController.js';
import { MatchAudio } from './audio/audio.js';

export class Game {
  constructor(canvas, { settings } = {}) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, { antialias: settings?.graphics?.antialias });
    this.input = new Input(window);
    this.audio = new MatchAudio();
    this.match = null;
    this.controllers = [];
    this.acc = 0;
    this.last = performance.now();
    this.paused = false;
    this.inputEnabled = () => true;
    this.listeners = {};
    this.unsub = [];
    if (settings) this.applySettings(settings);
    const unlock = () => this.audio.resume();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, e) { for (const fn of this.listeners[name] || []) fn(e); }

  applySettings(s) {
    this.settings = s;
    this.input.setBindings(s.controls);
    this.renderer.rig.setSettings(s.camera);
    this.renderer.setQuality(s.graphics);
    const a = s.audio || {};
    this.audio.setVolume({ master: a.master ?? 0.8, sfx: a.sfx ?? 0.8, crowd: a.crowd ?? 0.7 });
    if (this.match) this.match.config.autoSwitch = s.gameplay?.autoSwitch !== 'off';
  }

  startMatch(config) {
    this.endMatch();
    const cfg = { ...config };
    cfg.humanSide = cfg.humanSide || cfg.controlledSide || 'home';
    if (this.settings?.gameplay) cfg.autoSwitch = this.settings.gameplay.autoSwitch !== 'off';
    const match = new Match(cfg);
    this.match = match;
    this.controllers = match.teams.filter((t) => t.human).map((t) => new HumanController(match, t, this.input, () => this.renderer.rig.basis()));
    match.humanControllers = this.controllers;
    this.renderer.attach(match);
    this.renderer.setEnvironment(cfg.timeOfDay || 'night', cfg.weather || 'clear');
    this.hookAudio(match);
    this.paused = false;
    this.acc = 0;
    this.fullTimeSent = false;
    this.emit('matchStart', match);
    return match;
  }

  hookAudio(match) {
    const ev = match.events;
    const a = this.audio;
    const rig = this.renderer.rig;
    this.unsub.push(
      ev.on('kick', (e) => {
        const shot = ['shot', 'finesse', 'chip', 'headerShot'].includes(e.type);
        a.kick(shot ? 0.9 : e.type === 'pass' ? 0.4 : 0.6);
        if (shot) a.cheer(0.55);
        if (e.player.team.human) this.input.rumble(shot ? 0.6 : 0.25, shot ? 140 : 60);
      }),
      ev.on('whistle', (e) => a.whistle(e.kind)),
      ev.on('post', () => { a.post(); rig.bump(0.25); }),
      ev.on('save', () => a.cheer(0.6)),
      ev.on('goal', () => { a.net(); a.cheer(1); rig.bump(0.5); }),
      ev.on('tackle', (e) => { if (e.contact) a.kick(0.2); }),
    );
  }

  endMatch() {
    for (const u of this.unsub) u();
    this.unsub = [];
    if (this.match) for (const ai of this.match.ai) ai.dispose?.();
    this.match = null;
    this.controllers = [];
    this.renderer.detach();
    this.audio.stop();
  }

  setPaused(p) { this.paused = p; if (this.match) this.match.paused = p; }

  hudState() {
    const m = this.match;
    if (!m) return null;
    const hc = this.controllers[0];
    const p = hc?.activePlayer();
    return {
      activePlayer: p ? { name: p.data.name, short: p.data.short, number: p.data.number, pos: p.data.pos, stamina: p.stamina, team: p.team.id, id: p.id } : null,
      power: { value: hc?.power || 0, visible: !!hc?.charging, action: hc?.charging?.action || null },
    };
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const m = this.match;
    const playing = m && !this.paused;
    this.input.enabled = !!playing && this.inputEnabled();
    this.input.poll();
    if (playing) {
      for (const c of this.controllers) c.enabled = this.inputEnabled();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM.dt && steps < 6) {
        m.update(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
        // edge-triggered input is only valid for the first sim step of a frame
        if (steps === 1) this.input.prev = { ...this.input.cur };
      }
      if (steps === 6) this.acc = 0;
      if (m.phase === 'fulltime' && !this.fullTimeSent && !m.shootout?.active) {
        this.fullTimeSent = true;
        setTimeout(() => this.emit('fullTime', m), 2500);
      }
    }
    this.audio.update(dt, !!m && !this.paused);
    const hc = this.controllers[0];
    const view = {
      aim: hc?.aimPoint || null,
      receiver: hc?.previewReceiver || null,
      attackSide: hc ? hc.team.side : 1,
    };
    if (hc && m) {
      const ap = hc.activePlayer();
      if (ap && ap !== hc.team.controlled) view.controlledOverride = { [hc.team.index]: ap };
    }
    this.renderer.render(this.paused ? 0 : dt, view);
    this.emit('frame', dt);
  }
}
