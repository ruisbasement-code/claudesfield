// Generated SVG art: club crests, kit shirts, stars. No external assets needed.

function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function hexToRgb(h) {
  const s = String(h || '#888888').replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
export function inkFor(hex) { return luminance(hex) > 0.6 ? '#0b0b0b' : '#ffffff'; }
export function colorDistance(a, b) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 0.6 + Math.abs(luminance(a) - luminance(b)) * 255 * 1.2;
}

export function teamColors(team) {
  const k = team?.kits?.home || {};
  const primary = team?.colors?.primary || k.shirt || '#cccccc';
  let secondary = team?.colors?.secondary || k.shorts || k.number || '#222222';
  if (colorDistance(primary, secondary) < 60) secondary = inkFor(primary);
  return { primary, secondary };
}

const SHAPES = {
  shield: 'M6 6 H94 V52 C94 82 66 100 50 108 C34 100 6 82 6 52 Z',
  round: null,
  diamond: 'M50 4 L96 56 L50 108 L4 56 Z',
  badge: 'M6 14 L50 4 L94 14 V62 C94 88 72 102 50 108 C28 102 6 88 6 62 Z',
  crown: 'M6 22 L28 8 L50 18 L72 8 L94 22 V60 C94 86 70 102 50 108 C30 102 6 86 6 60 Z',
};

/** Crest SVG markup for a team (deterministic from its id). */
export function crestSVG(team, { size } = {}) {
  const id = team?.id || 'x';
  const h = hash(id);
  const { primary, secondary } = teamColors(team);
  const keys = Object.keys(SHAPES);
  const shape = team?.crest && keys.includes(team.crest) ? team.crest : keys[h % keys.length];
  const motif = (h >> 4) % 4;
  const initials = (team?.short || team?.name || '?').slice(0, 3).toUpperCase();
  const ink = inkFor(primary);
  const uid = `c${h.toString(36)}`;
  const outline = shape === 'round'
    ? `<circle cx="50" cy="56" r="46"/>`
    : `<path d="${SHAPES[shape]}"/>`;
  let pattern = '';
  if (motif === 0) pattern = `<rect x="0" y="0" width="100" height="112" fill="${primary}"/><rect x="38" y="0" width="24" height="112" fill="${secondary}"/>`;
  else if (motif === 1) pattern = `<rect x="0" y="0" width="100" height="112" fill="${primary}"/><path d="M0 0 L100 0 L100 34 L0 64 Z" fill="${secondary}"/>`;
  else if (motif === 2) pattern = `<rect x="0" y="0" width="50" height="112" fill="${primary}"/><rect x="50" y="0" width="50" height="112" fill="${secondary}"/>`;
  else pattern = `<rect x="0" y="0" width="100" height="112" fill="${primary}"/>` + [0, 1, 2, 3].map((i) => `<rect x="${8 + i * 24}" y="0" width="10" height="112" fill="${secondary}" opacity=".9"/>`).join('');
  const textInk = motif === 2 || motif === 3 ? '#ffffff' : ink;
  const plate = motif === 2 || motif === 3 ? `<rect x="14" y="44" width="72" height="28" fill="#0b0b0b" opacity=".82"/>` : '';
  const sz = size ? `width="${size}" height="${size * 1.12}"` : '';
  return `<svg class="cf-crest" viewBox="0 0 100 112" ${sz} aria-hidden="true">
    <defs><clipPath id="${uid}">${outline}</clipPath></defs>
    <g clip-path="url(#${uid})">${pattern}${plate}</g>
    <g fill="none" stroke="#0b0b0b" stroke-opacity=".35" stroke-width="3">${outline}</g>
    <g fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.2" transform="translate(50 56) scale(.86) translate(-50 -56)">${outline}</g>
    <text x="50" y="66" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="${initials.length > 2 ? 26 : 32}" letter-spacing="1" fill="${textInk}">${initials}</text>
  </svg>`;
}

/** Shirt SVG for a kit {shirt, shorts, socks, number?, trim?, pattern?}. */
export function kitSVG(kit = {}) {
  const shirt = kit.shirt || '#dddddd';
  const trim = kit.trim || kit.number || kit.shorts || inkFor(shirt);
  const pattern = kit.pattern || 'solid';
  const uid = `k${hash(JSON.stringify(kit)).toString(36)}`;
  const body = 'M30 8 L42 4 C44 10 56 10 58 4 L70 8 L92 22 L84 40 L74 35 L74 92 L26 92 L26 35 L16 40 L8 22 Z';
  let deco = '';
  if (pattern === 'stripes') deco = [34, 46, 58].map((x) => `<rect x="${x}" y="0" width="7" height="100" fill="${trim}"/>`).join('');
  else if (pattern === 'hoops') deco = [30, 48, 66].map((y) => `<rect x="0" y="${y}" width="100" height="9" fill="${trim}"/>`).join('');
  else if (pattern === 'halves') deco = `<rect x="50" y="0" width="50" height="100" fill="${trim}"/>`;
  else if (pattern === 'sash') deco = `<path d="M20 20 L34 10 L84 84 L70 94 Z" fill="${trim}"/>`;
  else if (pattern === 'band') deco = `<rect x="0" y="40" width="100" height="12" fill="${trim}"/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><clipPath id="${uid}"><path d="${body}"/></clipPath></defs>
    <g clip-path="url(#${uid})"><rect width="100" height="100" fill="${shirt}"/>${deco}
      <path d="M42 4 C44 10 56 10 58 4 L58 8 C55 14 45 14 42 8 Z" fill="${trim}"/>
      <path d="M8 22 L16 40 L26 35 L26 31 L14 36 L8 22 Z" fill="${trim}" opacity=".9"/>
      <path d="M92 22 L84 40 L74 35 L74 31 L86 36 Z" fill="${trim}" opacity=".9"/>
    </g>
    <path d="${body}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <rect x="28" y="92" width="44" height="6" fill="${kit.shorts || '#222'}"/>
  </svg>`;
}

const STAR = 'M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.3 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z';
export function starsSVG(value) {
  let out = '';
  for (let i = 0; i < 5; i++) {
    const fill = Math.max(0, Math.min(1, value - i));
    const id = `s${i}${Math.round(value * 10)}${Math.random().toString(36).slice(2, 6)}`;
    out += `<svg viewBox="0 0 24 24"><defs><linearGradient id="${id}"><stop offset="${fill}" stop-color="currentColor"/><stop offset="${fill}" stop-color="currentColor" stop-opacity=".18"/></linearGradient></defs><path d="${STAR}" fill="url(#${id})"/></svg>`;
  }
  return out;
}

/** Pitch markings SVG for the title backdrop (viewBox in metres, 105 x 68 with margin). */
export function pitchLinesSVG() {
  const s = 'stroke="rgba(255,255,255,.55)" stroke-width=".22" fill="none"';
  return `<svg viewBox="-2 -2 109 72" preserveAspectRatio="none">
    <g ${s}>
      <rect x="0" y="0" width="105" height="68"/>
      <line x1="52.5" y1="0" x2="52.5" y2="68"/>
      <circle cx="52.5" cy="34" r="9.15"/>
      <rect x="0" y="13.84" width="16.5" height="40.32"/><rect x="88.5" y="13.84" width="16.5" height="40.32"/>
      <rect x="0" y="24.84" width="5.5" height="18.32"/><rect x="99.5" y="24.84" width="5.5" height="18.32"/>
      <path d="M16.5 26.7 A9.15 9.15 0 0 1 16.5 41.3"/><path d="M88.5 26.7 A9.15 9.15 0 0 0 88.5 41.3"/>
      <path d="M0 1 A1 1 0 0 0 1 0"/><path d="M104 0 A1 1 0 0 0 105 1"/><path d="M0 67 A1 1 0 0 1 1 68"/><path d="M104 68 A1 1 0 0 1 105 67"/>
    </g>
    <g fill="rgba(255,255,255,.6)"><circle cx="52.5" cy="34" r=".3"/><circle cx="11" cy="34" r=".25"/><circle cx="94" cy="34" r=".25"/></g>
  </svg>`;
}
