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
