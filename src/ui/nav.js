// Console-style focus navigation for the menus: arrows / WASD / d-pad / left stick move focus
// spatially, Enter / A activates, Esc / B goes back, Q-E / LB-RB switch tabs. Mouse hover focuses.
//
// Focusable elements carry [data-nav]. Optional element hooks:
//   el.cfAdjust(dir)   left/right on the element changes its value instead of moving focus
//   el.cfActivate()    Enter/A (defaults to el.click())
//   el.cfHelp          { title, text } shown by screens that have a help panel
import { getSettings } from './settings.js';
import { sfx } from './sound.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export class Nav {
  constructor() {
    this.stack = [];
    this.capture = null;         // fn(event) -> true to swallow (key rebinding)
    this.padCapture = null;      // fn(buttonIndex) for gamepad rebinding
    this.onIdleKey = null;       // keydown when no menu context is active (in-match)
    this.onIdlePad = null;       // gamepad button press when no context
    this.onFocusChange = null;
    this.inputMode = 'keyboard';
    this.onInputMode = null;
    this._padPrev = [];
    this._padRepeat = { dir: null, next: 0 };
    this._lastPointer = { x: -1, y: -1 };

    window.addEventListener('keydown', (e) => this._key(e), true);
    window.addEventListener('pointermove', (e) => this._pointer(e), { passive: true });
    window.addEventListener('mousedown', () => this._setMode('keyboard'));
    const loop = () => { this._pollPad(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  get top() { return this.stack[this.stack.length - 1] || null; }

  /** ctx: { el, onBack?, onTab?(dir), initial?: Element|selector, keepFocus? } */
  push(ctx) {
    if (this.top) this.top.lastFocus = this.top.focused;
    this.stack.push(ctx);
    this._enter(ctx);
    return ctx;
  }
  pop(ctx) {
    const i = ctx ? this.stack.indexOf(ctx) : this.stack.length - 1;
    if (i < 0) return;
    const [removed] = this.stack.splice(i, 1);
    removed.focused?.classList.remove('is-focus');
    if (this.top && i === this.stack.length) this._enter(this.top, true);
  }
  set(ctx) { for (const c of this.stack) c.focused?.classList.remove('is-focus'); this.stack = []; if (ctx) this.push(ctx); }
  clear() { this.set(null); }

  _enter(ctx, restore) {
    let target = restore ? ctx.lastFocus || ctx.focused : null;
    if (!target || !target.isConnected) {
      target = typeof ctx.initial === 'string' ? ctx.el.querySelector(ctx.initial) : ctx.initial;
    }
    if (!target || !target.isConnected || !this._visible(target)) target = this.items(ctx)[0];
    this.focus(target, { silent: true, ctx });
  }

  items(ctx = this.top) {
    if (!ctx) return [];
    return [...ctx.el.querySelectorAll('[data-nav]')].filter((el) => !el.disabled && this._visible(el));
  }
  _visible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }

  focus(el, { silent = false, ctx = this.top } = {}) {
    if (!ctx || !el) return;
    if (ctx.focused === el) return;
    ctx.focused?.classList.remove('is-focus');
    ctx.focused = el;
    el.classList.add('is-focus');
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (!silent) sfx.move();
    this.onFocusChange?.(el, ctx);
    ctx.onFocus?.(el);
  }

  refresh() {
    const ctx = this.top; if (!ctx) return;
    if (!ctx.focused || !ctx.focused.isConnected || !this._visible(ctx.focused)) {
      ctx.focused = null; this._enter(ctx);
    } else ctx.focused.classList.add('is-focus');
  }

  move(dir) {
    const ctx = this.top; if (!ctx) return;
    const cur = ctx.focused;
    if ((dir === 'left' || dir === 'right') && cur?.cfAdjust) {
      cur.cfAdjust(dir === 'left' ? -1 : 1); sfx.change(); return;
    }
    const items = this.items(ctx);
    if (!cur) { this.focus(items[0]); return; }
    const [dx, dy] = DIRS[dir];
    const a = cur.getBoundingClientRect();
    const ac = [a.left + a.width / 2, a.top + a.height / 2];
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      // Edge-based primary distance so long rows next to short buttons behave.
      let primary;
      if (dx > 0) primary = b.left - a.right + 1;
      else if (dx < 0) primary = a.left - b.right + 1;
      else if (dy > 0) primary = b.top - a.bottom + 1;
      else primary = a.top - b.bottom + 1;
      const bc = [b.left + b.width / 2, b.top + b.height / 2];
      if (primary < -4) {
        // allow overlapping-but-forward elements via centres
        const pc = dx ? (bc[0] - ac[0]) * dx : (bc[1] - ac[1]) * dy;
        if (pc <= 4) continue;
        primary = 0;
      }
      let secondary;
      if (dx) secondary = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) + Math.abs(bc[1] - ac[1]) * 0.3;
      else secondary = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) + Math.abs(bc[0] - ac[0]) * 0.3;
      const score = Math.max(0, primary) + secondary * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
    else if (ctx.wrap && dy) {
      const sorted = items.slice().sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top);
      this.focus(dy > 0 ? sorted[0] : sorted[sorted.length - 1]);
    }
  }

  activate() {
    const el = this.top?.focused; if (!el) return;
    if (el.cfActivate) el.cfActivate(); else el.click();
  }

  back() {
    const ctx = this.top;
    if (ctx?.onBack) { sfx.back(); ctx.onBack(); }
  }

  _setMode(m) {
    if (this.inputMode === m) return;
    this.inputMode = m;
    this.onInputMode?.(m);
  }

  _matches(e, action) {
    const b = getSettings().controls.keyboard[action];
    return !!(b && b.includes(e.code));
  }

  _key(e) {
    this._setMode('keyboard');
    if (this.capture) { if (this.capture(e)) { e.preventDefault(); e.stopPropagation(); } return; }
    const ctx = this.top;
    if (!ctx) { this.onIdleKey?.(e); return; }
    if (ctx.onKey && ctx.onKey(e)) { e.preventDefault(); return; }
    let handled = true;
    const c = e.code;
    if (c === 'ArrowUp' || (this._matches(e, 'moveUp') && c !== 'Space')) this.move('up');
    else if (c === 'ArrowDown' || this._matches(e, 'moveDown')) this.move('down');
    else if (c === 'ArrowLeft' || this._matches(e, 'moveLeft')) this.move('left');
    else if (c === 'ArrowRight' || this._matches(e, 'moveRight')) this.move('right');
    else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space' || this._matches(e, 'pass')) { if (!e.repeat) this.activate(); }
    else if (c === 'Escape' || c === 'Backspace') { if (!e.repeat) this.back(); }
    else if ((c === 'KeyQ' || c === 'PageUp' || c === 'BracketLeft') && ctx.onTab) { ctx.onTab(-1); sfx.change(); }
    else if ((c === 'KeyE' || c === 'PageDown' || c === 'BracketRight') && ctx.onTab) { ctx.onTab(1); sfx.change(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  _pointer(e) {
    if (Math.abs(e.clientX - this._lastPointer.x) + Math.abs(e.clientY - this._lastPointer.y) < 2) return;
    this._lastPointer = { x: e.clientX, y: e.clientY };
    const ctx = this.top; if (!ctx || this.capture) return;
    const el = e.target.closest?.('[data-nav]');
    if (el && ctx.el.contains(el) && !el.disabled) this.focus(el);
  }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    this.pad = pad;
    const now = performance.now();
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.6);
    const prev = this._padPrev;
    const edge = (i) => pressed[i] && !prev[i];
    this._padPrev = pressed;
    if (pressed.some((p, i) => p && !prev[i])) this._setMode('gamepad');

    if (this.padCapture) {
      for (let i = 0; i < pressed.length; i++) if (edge(i)) { this.padCapture(i); return; }
      return;
    }
    const ctx = this.top;
    if (!ctx) {
      for (let i = 0; i < pressed.length; i++) if (edge(i)) this.onIdlePad?.(i);
      return;
    }
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    let dir = null;
    if (pressed[12] || ay < -0.6) dir = 'up';
    else if (pressed[13] || ay > 0.6) dir = 'down';
    else if (pressed[14] || ax < -0.6) dir = 'left';
    else if (pressed[15] || ax > 0.6) dir = 'right';
    if (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6) this._setMode('gamepad');
    const r = this._padRepeat;
    if (dir) {
      if (dir !== r.dir) { r.dir = dir; r.next = now + 380; this.move(dir); }
      else if (now >= r.next) { r.next = now + 110; this.move(dir); }
    } else r.dir = null;

    if (edge(0)) this.activate();
    else if (edge(1)) this.back();
    else if (edge(4) && ctx.onTab) { ctx.onTab(-1); sfx.change(); }
    else if (edge(5) && ctx.onTab) { ctx.onTab(1); sfx.change(); }
    else if (edge(9) && ctx.onStart) ctx.onStart();
  }
}
