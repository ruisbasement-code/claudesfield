// Keyboard + gamepad input with rebindable actions.
// Bindings: { keyboard: { action: [code, code] | code }, gamepad: { action: buttonIndex } }
// Fallbacks only; the real defaults live in src/ui/settings.js and arrive through setBindings().
const DEFAULT_KB = {
  moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'], pass: ['KeyJ'], through: ['KeyI'], lob: ['KeyL'], shoot: ['KeyK'], finesse: ['KeyE'], chip: ['KeyC'],
  skill: ['Space'], shield: ['KeyF'], tackle: ['KeyJ'], slide: ['KeyK'], contain: ['KeyU'], jockey: ['KeyF'], teamContain: ['KeyO'],
  keeperRush: ['KeyY'], switch: ['KeyQ'], pause: ['Escape', 'KeyP'],
};
// EA FC "Classic" layout on the W3C standard mapping (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 12-15 d-pad).
const DEFAULT_PAD = {
  pass: 0, shoot: 1, lob: 2, through: 3, chip: 4, finesse: 5, shield: 6, sprint: 7, skill: null,
  contain: 0, tackle: 1, slide: 2, keeperRush: 3, switch: 4, teamContain: 5, jockey: 6,
  mentality: 8, pause: 9, tacticsDefend: 14, tacticsAttack: 15,
};
const TRIGGER_THRESHOLD = 0.3;
const FLICK_ON = 0.65, FLICK_OFF = 0.35;

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.kb = DEFAULT_KB;
    this.pad = DEFAULT_PAD;
    this.deadzone = 0.18;
    this.padIndex = null; // which gamepad drives this Input (null = first connected)
    this.useKeyboard = true;
    this.prev = {};
    this.cur = {};
    this.padAxes = { x: 0, y: 0 };
    this.rightStick = { x: 0, y: 0 };
    this.flickDir = null;     // screen-space direction of the last right-stick flick
    this.flickHeld = false;
    this.vibration = true;
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      if (this.isGameKey(e.code)) e.preventDefault();
    };
    this.onKeyUp = (e) => this.down.delete(e.code);
    this.onBlur = () => this.down.clear();
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  setBindings(controls) {
    if (!controls) return;
    if (controls.keyboard) this.kb = { ...DEFAULT_KB, ...controls.keyboard };
    if (controls.gamepad) this.pad = { ...DEFAULT_PAD, ...controls.gamepad };
    if (controls.stickDeadzone != null) this.deadzone = controls.stickDeadzone;
    if (controls.vibration != null) this.vibration = !!controls.vibration;
  }

  isGameKey(code) {
    for (const k in this.kb) {
      const v = this.kb[k];
      if (Array.isArray(v) ? v.includes(code) : v === code) return true;
    }
    return false;
  }

  keyDown(action) {
    const v = this.kb[action];
    if (!v) return false;
    if (Array.isArray(v)) return v.some((c) => c && this.down.has(c));
    return this.down.has(v);
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex != null) return pads[this.padIndex] || null;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // Call once per frame before reading.
  poll() {
    this.prev = this.cur;
    const cur = {};
    const gp = this.gamepad();
    this.padAxes.x = 0; this.padAxes.y = 0;
    if (gp) {
      let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      const m = Math.hypot(x, y);
      if (m < this.deadzone) { x = 0; y = 0; }
      else { const k = (m - this.deadzone) / (1 - this.deadzone) / m; x *= Math.min(k, 1 / m); y *= Math.min(k, 1 / m); }
      // The d-pad is for tactics in a match (as in FC); menus read it separately in ui/nav.js.
      this.padAxes.x = x; this.padAxes.y = y;
      // Right stick: flicks drive skill moves (attacking) and manual player switching (defending).
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
      const rm = Math.hypot(rx, ry);
      this.rightStick.x = rx; this.rightStick.y = ry;
      if (!this.flickHeld && rm > FLICK_ON) { this.flickHeld = true; this.flickDir = { x: rx / rm, y: ry / rm }; }
      else if (this.flickHeld && rm < FLICK_OFF) this.flickHeld = false;
      if (x || y || rm > FLICK_OFF || gp.buttons.some((b) => b.pressed)) this.lastDevice = 'gamepad';
    } else this.flickHeld = false;
    const actions = new Set([...Object.keys(this.kb), ...Object.keys(this.pad)]);
    for (const a of actions) {
      let d = this.useKeyboard && this.keyDown(a);
      if (!d && gp && this.pad[a] != null) d = this.padButton(gp, this.pad[a]);
      cur[a] = d;
    }
    cur.flick = this.flickHeld;
    this.cur = cur;
  }

  padButton(gp, i) {
    const b = gp.buttons[i];
    if (!b) return false;
    // analogue triggers report pressed at different depths per browser; use the value too
    return b.pressed || b.value > TRIGGER_THRESHOLD;
  }

  /** Screen-space direction of a right-stick flick that started this frame, else null. */
  flicked() { return this.pressed('flick') ? this.flickDir : null; }

  isDown(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  released(a) { return !this.cur[a] && !!this.prev[a]; }

  // Screen-space move vector: x right, y down. Length 0..1.
  moveVector() {
    let x = 0, y = 0;
    if (this.useKeyboard) {
      if (this.keyDown('moveLeft')) x -= 1;
      if (this.keyDown('moveRight')) x += 1;
      if (this.keyDown('moveUp')) y -= 1;
      if (this.keyDown('moveDown')) y += 1;
      const m = Math.hypot(x, y);
      if (m > 0) { x /= m; y /= m; }
    }
    if (!x && !y) { x = this.padAxes.x; y = this.padAxes.y; }
    return { x, y };
  }

  rumble(strength = 0.5, ms = 120) {
    if (!this.vibration) return;
    const gp = this.gamepad();
    try { gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch (e) { /* unsupported */ }
  }

  dispose(target = window) {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }
}
