// Keyboard + gamepad input with rebindable actions.
// Bindings: { keyboard: { action: [code, code] | code }, gamepad: { action: buttonIndex } }
const DEFAULT_KB = {
  moveUp: ['KeyW', 'ArrowUp'], moveDown: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'], pass: ['KeyJ'], through: ['KeyI'], lob: ['KeyL'], shoot: ['KeyK'], finesse: ['KeyE'], chip: ['KeyC'],
  skill: ['Space'], tackle: ['KeyJ'], slide: ['KeyK'], switch: ['KeyQ'], pause: ['Escape', 'KeyP'],
};
const DEFAULT_PAD = { pass: 0, shoot: 1, lob: 2, through: 3, finesse: 5, chip: 4, sprint: 7, skill: 11, tackle: 1, slide: 2, switch: 4, pause: 9 };

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
      // d-pad
      if (gp.buttons[12]?.pressed) y = -1;
      if (gp.buttons[13]?.pressed) y = 1;
      if (gp.buttons[14]?.pressed) x = -1;
      if (gp.buttons[15]?.pressed) x = 1;
      this.padAxes.x = x; this.padAxes.y = y;
      if (x || y || gp.buttons.some((b) => b.pressed)) this.lastDevice = 'gamepad';
    }
    const actions = new Set([...Object.keys(this.kb), ...Object.keys(this.pad)]);
    for (const a of actions) {
      let d = this.useKeyboard && this.keyDown(a);
      if (!d && gp && this.pad[a] != null) d = !!gp.buttons[this.pad[a]]?.pressed;
      cur[a] = d;
    }
    this.cur = cur;
  }

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
    const gp = this.gamepad();
    try { gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }); } catch (e) { /* unsupported */ }
  }

  dispose(target = window) {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }
}
