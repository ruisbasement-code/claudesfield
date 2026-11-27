// Human-readable names for key codes and gamepad buttons.
const SPECIAL = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Meta', MetaRight: 'R Meta',
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Bksp', Tab: 'Tab', CapsLock: 'Caps',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (SPECIAL[code]) return SPECIAL[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
const PS = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'PS'];

export function padStyle(id = '') {
  return /playstation|dualshock|dualsense|054c|sony/i.test(id) ? 'ps' : 'xbox';
}

export function buttonLabel(index, style = 'xbox') {
  if (index == null) return '—';
  const set = style === 'ps' ? PS : XBOX;
  return set[index] ?? `B${index}`;
}

// Face-button colours (Xbox convention), used for small glyphs.
export const FACE_COLORS = { 0: '#5dbb46', 1: '#e0463c', 2: '#3d7fd9', 3: '#f2c230' };

const PS_FACE = { 0: '✕', 1: '○', 2: '□', 3: '△' };
const PS_COLORS = { 0: '#7aa7e6', 1: '#e86a5f', 2: '#d88fc8', 3: '#5cc9a7' };

/** HTML for one gamepad button glyph: coloured face buttons, pill-shaped shoulders/triggers. */
export function padGlyph(index, style = 'xbox') {
  if (index == null) return '<span class="cf-glyph">—</span>';
  if (index <= 3) {
    const bg = style === 'ps' ? PS_COLORS[index] : FACE_COLORS[index];
    const sym = style === 'ps' ? PS_FACE[index] : buttonLabel(index, style);
    return `<span class="cf-glyph is-pad" style="background:${bg}">${sym}</span>`;
  }
  const arrows = { 12: '▲', 13: '▼', 14: '◀', 15: '▶' };
  const t = arrows[index] ? `D-pad ${arrows[index]}` : buttonLabel(index, style);
  return `<span class="cf-glyph is-pad is-wide">${t}</span>`;
}

/** HTML glyph for whatever the given action is bound to on the current device. */
export function actionGlyph(controls, action, pad, style = 'xbox') {
  if (pad) return padGlyph(controls.gamepad?.[action], style);
  const k = (controls.keyboard?.[action] || []).find(Boolean);
  return `<span class="cf-glyph">${keyLabel(k)}</span>`;
}
