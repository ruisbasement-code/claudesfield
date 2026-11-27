// Fictional clubs. Every name, crest colour and player here is invented.
// Players are generated deterministically from a seed so squads never change between sessions.

const FIRST = [
  'Aron', 'Bastian', 'Cael', 'Dario', 'Elian', 'Fenn', 'Gael', 'Hugo', 'Ilan', 'Joren', 'Kasimir', 'Lio',
  'Matteo', 'Noor', 'Oskar', 'Paolo', 'Quinn', 'Rafe', 'Silas', 'Tavi', 'Ulric', 'Vasco', 'Wim', 'Yannick',
  'Zeno', 'Amadou', 'Bruno', 'Cosimo', 'Davi', 'Emre', 'Florin', 'Goran', 'Henrik', 'Idris', 'Jules', 'Kofi',
  'Leandro', 'Marek', 'Nico', 'Otto', 'Pim', 'Rui', 'Sami', 'Teo', 'Umar', 'Viggo', 'Xavi', 'Youssef',
  'Anders', 'Bram', 'Cyril', 'Dmitri', 'Eero', 'Fabio', 'Gideon', 'Hamza', 'Iker', 'Jasper', 'Kenji', 'Lars',
];
const LAST_A = ['Vel', 'Mar', 'Dur', 'Kas', 'Lun', 'Bor', 'Tem', 'Ost', 'Rav', 'Sel', 'Gra', 'Hol', 'Fen', 'Cor', 'Nak', 'Pel', 'Var', 'Ald', 'Bre', 'Mon', 'Ter', 'Ash', 'Kel', 'Dov'];
const LAST_B = ['ano', 'ström', 'ez', 'ovic', 'inho', 'sen', 'ard', 'elli', 'ane', 'ier', 'ura', 'ek', 'more', 'ow', 'ani', 'ius', 'ten', 'aux', 'ado', 'is', 'wick', 'ski', 'ou', 'ich'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Formation slots: position code, role, and base spot in team space.
// along: -1 own goal line .. +1 opponent goal line (base shape when in possession around midfield)
// across: -1 .. +1 (right to left as seen by the attacking team is not important; mirrored per side)
export const FORMATIONS = {
  '4-3-3': [
    ['GK', 'GK', -0.96, 0],
    ['RB', 'DF', -0.62, -0.68], ['CB', 'DF', -0.7, -0.24], ['CB', 'DF', -0.7, 0.24], ['LB', 'DF', -0.62, 0.68],
    ['CDM', 'MF', -0.46, 0], ['CM', 'MF', -0.36, -0.36], ['CM', 'MF', -0.36, 0.36],
    ['RW', 'FW', -0.08, -0.7], ['ST', 'FW', -0.04, 0], ['LW', 'FW', -0.08, 0.7],
  ],
  '4-4-2': [
    ['GK', 'GK', -0.96, 0],
    ['RB', 'DF', -0.62, -0.68], ['CB', 'DF', -0.7, -0.24], ['CB', 'DF', -0.7, 0.24], ['LB', 'DF', -0.62, 0.68],
    ['RM', 'MF', -0.34, -0.7], ['CM', 'MF', -0.4, -0.2], ['CM', 'MF', -0.4, 0.2], ['LM', 'MF', -0.34, 0.7],
    ['ST', 'FW', -0.08, -0.18], ['ST', 'FW', -0.06, 0.18],
  ],
  '4-2-3-1': [
    ['GK', 'GK', -0.96, 0],
    ['RB', 'DF', -0.62, -0.68], ['CB', 'DF', -0.7, -0.24], ['CB', 'DF', -0.7, 0.24], ['LB', 'DF', -0.62, 0.68],
    ['CDM', 'MF', -0.48, -0.2], ['CDM', 'MF', -0.48, 0.2],
    ['RM', 'MF', -0.2, -0.64], ['CAM', 'MF', -0.24, 0], ['LM', 'MF', -0.2, 0.64],
    ['ST', 'FW', -0.04, 0],
  ],
  '5-3-2': [
    ['GK', 'GK', -0.96, 0],
    ['RWB', 'DF', -0.55, -0.78], ['CB', 'DF', -0.7, -0.4], ['CB', 'DF', -0.72, 0], ['CB', 'DF', -0.7, 0.4], ['LWB', 'DF', -0.55, 0.78],
    ['CM', 'MF', -0.36, -0.35], ['CDM', 'MF', -0.44, 0], ['CM', 'MF', -0.36, 0.35],
    ['ST', 'FW', -0.08, -0.18], ['ST', 'FW', -0.06, 0.18],
  ],
  '3-5-2': [
    ['GK', 'GK', -0.96, 0],
    ['CB', 'DF', -0.7, -0.4], ['CB', 'DF', -0.72, 0], ['CB', 'DF', -0.7, 0.4],
    ['RWB', 'MF', -0.38, -0.78], ['CM', 'MF', -0.42, -0.26], ['CDM', 'MF', -0.5, 0], ['CM', 'MF', -0.42, 0.26], ['LWB', 'MF', -0.38, 0.78],
    ['ST', 'FW', -0.08, -0.18], ['ST', 'FW', -0.06, 0.18],
  ],
};

// Stat profile per position: offsets added to the team base rating.
const PROFILE = {
  GK: { pace: -25, accel: -20, shooting: -45, passing: -15, dribbling: -35, defending: -30, physical: -2, stamina: -10, diving: 4, reflexes: 5, handling: 2, positioning: 3 },
  CB: { pace: -8, accel: -10, shooting: -30, passing: -10, dribbling: -18, defending: 6, physical: 6, stamina: -2 },
  RB: { pace: 4, accel: 4, shooting: -24, passing: -4, dribbling: -6, defending: 0, physical: -2, stamina: 6 },
  LB: { pace: 4, accel: 4, shooting: -24, passing: -4, dribbling: -6, defending: 0, physical: -2, stamina: 6 },
  RWB: { pace: 6, accel: 6, shooting: -18, passing: -2, dribbling: -2, defending: -6, physical: -4, stamina: 8 },
  LWB: { pace: 6, accel: 6, shooting: -18, passing: -2, dribbling: -2, defending: -6, physical: -4, stamina: 8 },
  CDM: { pace: -6, accel: -4, shooting: -12, passing: 2, dribbling: -6, defending: 2, physical: 4, stamina: 6 },
  CM: { pace: -2, accel: 0, shooting: -6, passing: 4, dribbling: 0, defending: -8, physical: 0, stamina: 6 },
  CAM: { pace: 0, accel: 3, shooting: 0, passing: 5, dribbling: 5, defending: -26, physical: -8, stamina: 0 },
  RM: { pace: 6, accel: 6, shooting: -6, passing: 0, dribbling: 3, defending: -20, physical: -8, stamina: 4 },
  LM: { pace: 6, accel: 6, shooting: -6, passing: 0, dribbling: 3, defending: -20, physical: -8, stamina: 4 },
  RW: { pace: 8, accel: 8, shooting: -2, passing: -2, dribbling: 6, defending: -30, physical: -10, stamina: 0 },
  LW: { pace: 8, accel: 8, shooting: -2, passing: -2, dribbling: 6, defending: -30, physical: -10, stamina: 0 },
  ST: { pace: 4, accel: 4, shooting: 7, passing: -8, dribbling: 1, defending: -34, physical: 3, stamina: -2 },
};

const SKIN = ['#f1d2b6', '#e0b48f', '#c58c62', '#9a6643', '#6e4529', '#4a2e1c'];
const HAIR = ['#1b1410', '#3a2618', '#6b4a2b', '#a77b45', '#d8b878', '#2a2a2a', '#8c3b1f'];

// [id, name, short, city, formation, base rating, primary, secondary, accent, awayShirt, awayShorts, style]
const CLUBS = [
  ['kestrel', 'Kestrel Bay', 'KES', 'Kestrel Bay', '4-3-3', 82, '#0f7c80', '#ffffff', '#f2c14e', '#f4f1ea', '#0f7c80', 'possession'],
  ['ironmoor', 'Ironmoor', 'IRM', 'Ironmoor', '4-4-2', 80, '#2b2d30', '#f26b1d', '#f26b1d', '#f26b1d', '#2b2d30', 'direct'],
  ['valdora', 'Valdora CF', 'VAL', 'Valdora', '4-2-3-1', 84, '#a3192f', '#e9c46a', '#e9c46a', '#ffffff', '#a3192f', 'balanced'],
  ['northgate', 'Northgate Athletic', 'NGA', 'Northgate', '4-3-3', 78, '#1d2f5e', '#8ecae6', '#8ecae6', '#8ecae6', '#1d2f5e', 'counter'],
  ['solano', 'Solano Verde', 'SOL', 'Solano', '4-3-3', 81, '#1f7a3a', '#ffffff', '#ffffff', '#f5f5f0', '#1f7a3a', 'possession'],
  ['brightwater', 'Brightwater', 'BRW', 'Brightwater', '3-5-2', 77, '#6fb7e9', '#132c4c', '#ffffff', '#132c4c', '#6fb7e9', 'balanced'],
  ['castelmar', 'Castelmar', 'CAS', 'Castelmar', '4-2-3-1', 79, '#5b2a86', '#ffffff', '#d4b5ff', '#ffffff', '#5b2a86', 'possession'],
  ['redhollow', 'Redhollow', 'RDH', 'Redhollow', '4-4-2', 76, '#c8102e', '#111111', '#111111', '#111111', '#c8102e', 'direct'],
  ['lumen', 'Lumen City', 'LUM', 'Lumen', '4-3-3', 83, '#f2c300', '#121212', '#121212', '#121212', '#f2c300', 'counter'],
  ['frostvik', 'Frostvik', 'FRV', 'Frostvik', '4-4-2', 74, '#f4f7fb', '#7aa5c9', '#2c4a66', '#2c4a66', '#f4f7fb', 'direct'],
  ['duneport', 'Duneport', 'DUN', 'Duneport', '3-5-2', 72, '#d8b98a', '#5a3b22', '#5a3b22', '#5a3b22', '#d8b98a', 'balanced'],
  ['maribel', 'Maribel Sporting', 'MAR', 'Maribel', '4-2-3-1', 78, '#e86a92', '#151515', '#151515', '#151515', '#e86a92', 'counter'],
];

const STAT_KEYS = ['pace', 'accel', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'stamina'];
const GK_KEYS = ['diving', 'reflexes', 'handling', 'positioning'];

function clampStat(v) { return Math.max(25, Math.min(97, Math.round(v))); }

function makeName(r) {
  const f = FIRST[Math.floor(r() * FIRST.length)];
  const l = LAST_A[Math.floor(r() * LAST_A.length)] + LAST_B[Math.floor(r() * LAST_B.length)];
  return { name: `${f} ${l}`, short: l };
}

export function overallOf(pos, s) {
  if (pos === 'GK') return Math.round(s.diving * 0.25 + s.reflexes * 0.25 + s.handling * 0.2 + s.positioning * 0.22 + s.physical * 0.08);
  const w = {
    CB: { defending: 0.45, physical: 0.25, pace: 0.1, passing: 0.12, dribbling: 0.08 },
    RB: { defending: 0.32, pace: 0.22, passing: 0.18, dribbling: 0.12, physical: 0.16 },
    CDM: { defending: 0.32, passing: 0.3, physical: 0.18, dribbling: 0.1, pace: 0.1 },
    CM: { passing: 0.36, dribbling: 0.22, defending: 0.14, shooting: 0.12, physical: 0.08, pace: 0.08 },
    CAM: { passing: 0.32, dribbling: 0.3, shooting: 0.24, pace: 0.14 },
    RM: { pace: 0.26, dribbling: 0.28, passing: 0.26, shooting: 0.14, physical: 0.06 },
    RW: { pace: 0.26, dribbling: 0.32, shooting: 0.22, passing: 0.2 },
    ST: { shooting: 0.44, pace: 0.2, dribbling: 0.16, physical: 0.14, passing: 0.06 },
  };
  const map = { LB: 'RB', RWB: 'RB', LWB: 'RB', LM: 'RM', LW: 'RW' };
  const ww = w[map[pos] || pos] || w.CM;
  let o = 0;
  for (const k in ww) o += s[k] * ww[k];
  return Math.round(o);
}

function buildClub(row, idx) {
  const [id, name, short, city, formation, base, primary, secondary, accent, awayShirt, awayShorts, style] = row;
  const r = rng(1000 + idx * 7919);
  const usedNums = new Set();
  const slots = FORMATIONS[formation];
  const starIdx = 7 + Math.floor(r() * 4); // one attacker is the standout
  const players = slots.map(([pos, role], i) => {
    const prof = PROFILE[pos];
    const { name: pname, short: pshort } = makeName(r);
    const quality = base + (r() - 0.5) * 8 + (i === starIdx ? 6 : 0);
    const stats = {};
    for (const k of STAT_KEYS) stats[k] = clampStat(quality + (prof[k] || 0) + (r() - 0.5) * 12);
    for (const k of GK_KEYS) stats[k] = clampStat(role === 'GK' ? quality + (prof[k] || 0) + (r() - 0.5) * 8 : 30 + r() * 15);
    let number;
    const pref = { GK: 1, RB: 2, LB: 3, CB: usedNums.has(4) ? 5 : 4, CDM: 6, RW: 7, RM: 7, CM: 8, ST: 9, CAM: 10, LW: 11, LM: 11 }[pos];
    number = pref && !usedNums.has(pref) ? pref : 0;
    while (!number || usedNums.has(number)) number = 12 + Math.floor(r() * 26);
    usedNums.add(number);
    return {
      name: pname, short: pshort, number, pos, role, stats,
      overall: overallOf(pos, stats),
      look: {
        skin: SKIN[Math.floor(r() * SKIN.length)],
        hair: HAIR[Math.floor(r() * HAIR.length)],
        hairStyle: Math.floor(r() * 4), // 0 short, 1 buzz, 2 longer, 3 bald
        height: 1.72 + r() * 0.2,
      },
    };
  });
  const avg = (filter, keyFn) => {
    const ps = players.filter(filter);
    return Math.round(ps.reduce((a, p) => a + keyFn(p), 0) / ps.length);
  };
  const rating = {
    att: avg((p) => p.role === 'FW', (p) => p.overall),
    mid: avg((p) => p.role === 'MF', (p) => p.overall),
    def: avg((p) => p.role === 'DF' || p.role === 'GK', (p) => p.overall),
  };
  rating.ovr = Math.round((rating.att + rating.mid + rating.def) / 3);
  return {
    id, name, short, city, formation, style,
    colors: { primary, secondary, accent },
    kits: {
      home: { shirt: primary, shorts: secondary === '#ffffff' && primary !== '#ffffff' ? '#ffffff' : secondary, socks: primary, number: accent === primary ? secondary : accent, trim: secondary },
      away: { shirt: awayShirt, shorts: awayShorts, socks: awayShirt, number: awayShorts, trim: awayShorts },
      gk: { shirt: idx % 2 ? '#2ec27e' : '#8b5cf6', shorts: '#1a1a1a', socks: idx % 2 ? '#2ec27e' : '#8b5cf6', number: '#ffffff', trim: '#1a1a1a' },
    },
    rating,
    players,
  };
}

export const TEAMS = CLUBS.map(buildClub);
export const teamById = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDist(a, b) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

// Picks kits so the two teams are easy to tell apart. Returns {home, away} kit objects.
export function pickKits(homeTeam, awayTeam) {
  const home = homeTeam.kits.home;
  let away = awayTeam.kits.home;
  if (colorDist(home.shirt, away.shirt) < 120) away = awayTeam.kits.away;
  if (colorDist(home.shirt, away.shirt) < 120) away = { shirt: '#f4f1ea', shorts: '#222222', socks: '#f4f1ea', number: '#222222', trim: '#222222' };
  return { home, away };
}
