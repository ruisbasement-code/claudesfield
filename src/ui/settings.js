// Persistent user settings. Read anywhere with getSettings(); listen with onSettingsChange().
// Stored in localStorage under STORAGE_KEY. Safe when storage is unavailable.

export const STORAGE_KEY = 'claudesfield.settings.v1';

// Action metadata for the rebinding screen. Ids match what src/input/input.js reads.
// group: 'move' | 'attack' | 'defend' | 'general'. Keys may be shared between an attack and a
// defend action (context-sensitive, like console football) but not within the same group.
export const ACTIONS = [
  { id: 'moveUp', label: 'Move up', group: 'move' },
  { id: 'moveDown', label: 'Move down', group: 'move' },
  { id: 'moveLeft', label: 'Move left', group: 'move' },
  { id: 'moveRight', label: 'Move right', group: 'move' },
  { id: 'sprint', label: 'Sprint', group: 'general' },
  { id: 'pass', label: 'Short pass / Header', group: 'attack' },
  { id: 'through', label: 'Through ball', group: 'attack' },
  { id: 'lob', label: 'Lob pass / Cross', group: 'attack' },
  { id: 'shoot', label: 'Shoot / Volley', group: 'attack' },
  { id: 'finesse', label: 'Finesse shot modifier', group: 'attack' },
  { id: 'chip', label: 'Chip shot modifier', group: 'attack' },
  { id: 'skill', label: 'Skill move', group: 'attack' },
  { id: 'tackle', label: 'Standing tackle', group: 'defend' },
  { id: 'slide', label: 'Slide tackle', group: 'defend' },
  { id: 'switch', label: 'Switch player', group: 'defend' },
  { id: 'pause', label: 'Pause', group: 'general' },
];

export const ACTION_GROUPS = [
  { id: 'move', label: 'Movement' },
  { id: 'attack', label: 'Attacking' },
  { id: 'defend', label: 'Defending' },
  { id: 'general', label: 'General' },
];

/** Groups whose bindings must not overlap with the given group. */
export function conflictsWith(group) {
  if (group === 'attack') return ['move', 'attack', 'general'];
  if (group === 'defend') return ['move', 'defend', 'general'];
  return ['move', 'attack', 'defend', 'general'];
}

// Keyboard bindings: action -> [primary, secondary] KeyboardEvent.code values (null = unbound).
const KEYBOARD_DEFAULTS = {
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', null],
  pass: ['KeyJ', null],
  through: ['KeyI', null],
  lob: ['KeyL', null],
  shoot: ['KeyK', null],
  finesse: ['KeyE', null],
  chip: ['KeyC', null],
  skill: ['Space', null],
  tackle: ['KeyJ', null],
  slide: ['KeyK', null],
  switch: ['KeyQ', null],
  pause: ['Escape', 'KeyP'],
};

// Gamepad bindings use W3C "standard" mapping button indices (Xbox names / PlayStation names).
const GAMEPAD_DEFAULTS = {
  pass: 0,     // A / Cross
  shoot: 1,    // B / Circle
  lob: 2,      // X / Square
  through: 3,  // Y / Triangle
  finesse: 5,  // RB / R1
  chip: 4,     // LB / L1  (attack)
  sprint: 7,   // RT / R2
  skill: 11,   // R3
  tackle: 1,   // B / Circle (defence)
  slide: 2,    // X / Square (defence)
  switch: 4,   // LB / L1 (defence)
  pause: 9,    // Menu / Options
};

export const DEFAULTS = Object.freeze({
  audio: { master: 0.8, music: 0.5, sfx: 0.8, crowd: 0.7, commentary: true },
  graphics: {
    quality: 'high',        // 'low' | 'medium' | 'high'
    shadows: true,
    antialias: true,
    resolutionScale: 1,     // 0.5 .. 1.5 multiplier on devicePixelRatio
    grassDetail: true,
    showFps: false,
  },
  camera: {
    mode: 'broadcast',      // 'broadcast' | 'tele' | 'wide' | 'end'
    zoom: 0,                // -5 .. 5
    height: 0,              // -5 .. 5
    shake: true,
    replays: true,
  },
  gameplay: {
    difficulty: 'pro',      // see src/core/constants.js DIFFICULTIES
    halfMinutes: 4,
    passAssist: 'assisted', // 'assisted' | 'semi' | 'manual'
    shotAssist: 'assisted',
    autoSwitch: 'assisted', // 'off' | 'assisted' | 'auto'
    offside: true,
    fouls: true,
    cards: true,
    injuries: false,
  },
  hud: {
    scale: 1,
    radar: 'bottom',        // 'bottom' | 'off'
    indicator: 'name',      // 'name' | 'number' | 'off'
    clock: true,
    eventBanners: true,
  },
  controls: {
    keyboard: KEYBOARD_DEFAULTS,
    gamepad: GAMEPAD_DEFAULTS,
    vibration: true,
    stickDeadzone: 0.18,
  },
});

export const DIFFICULTY_BLURBS = {
  amateur: 'Slow to react, forgiving in front of goal.',
  semipro: 'Keeps its shape but rarely punishes mistakes.',
  pro: 'A fair contest. Presses when you dawdle.',
  worldclass: 'Quick passing, clever runs, tight marking.',
  legendary: 'Reads everything. Finishes everything.',
};

export const CAMERAS = [
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'tele', label: 'Tele Broadcast' },
  { id: 'wide', label: 'Wide' },
  { id: 'end', label: 'End to End' },
];

const clone = (o) => JSON.parse(JSON.stringify(o));

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k], v = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v);
    else if (Array.isArray(b)) out[k] = Array.isArray(v) ? b.map((x, i) => (i in v ? v[i] : x)) : b;
    else if (typeof v === typeof b || (b === null) || (v === null)) out[k] = v;
  }
  return out;
}

let current = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return merge(clone(DEFAULTS), JSON.parse(raw));
  } catch (e) { /* storage unavailable or corrupt */ }
  return clone(DEFAULTS);
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (e) { /* ignore */ }
}

/** Returns the live settings object. Treat as read-only; change via setSetting(). */
export function getSettings() { return current; }

/** setSetting('audio.master', 0.5) */
export function setSetting(path, value) {
  const keys = path.split('.');
  let o = current;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  const last = keys[keys.length - 1];
  if (o[last] === value) return;
  o[last] = value;
  persist();
  emit(path);
}

export function getSetting(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), current);
}

/** Reset one section ('controls.keyboard', 'audio', ...) or everything when omitted. */
export function resetSettings(section) {
  if (!section) current = clone(DEFAULTS);
  else {
    const keys = section.split('.');
    let o = current, d = DEFAULTS;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; d = d[keys[i]]; }
    o[keys[keys.length - 1]] = clone(d[keys[keys.length - 1]]);
  }
  persist();
  emit(section || '*');
}

/** fn(settings, changedPath). Returns an unsubscribe function. */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(path) {
  for (const fn of listeners) {
    try { fn(current, path); } catch (e) { console.error(e); }
  }
}

/** Effective volume for a channel ('music' | 'sfx' | 'crowd'), master applied. */
export function volume(channel) {
  const a = current.audio;
  return a.master * (a[channel] ?? 1);
}
