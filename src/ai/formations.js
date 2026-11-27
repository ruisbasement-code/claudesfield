// Formations in team-relative normalized coordinates.
//   d: depth, 0 = own goal line, 1 = opponent goal line
//   w: width, -1 = left touchline, +1 = right touchline (from the team's attacking view)
// role drives behaviour (GK, CB, FB, DM, CM, AM, W, ST).
// Index 0 is always the goalkeeper.

const F = (role, d, w) => ({ role, d, w });

export const FORMATIONS = {
  '4-4-2': [
    F('GK', 0.03, 0),
    F('FB', 0.22, -0.72), F('CB', 0.18, -0.25), F('CB', 0.18, 0.25), F('FB', 0.22, 0.72),
    F('W', 0.45, -0.70), F('CM', 0.40, -0.20), F('CM', 0.40, 0.20), F('W', 0.45, 0.70),
    F('ST', 0.62, -0.18), F('ST', 0.62, 0.18),
  ],
  '4-3-3': [
    F('GK', 0.03, 0),
    F('FB', 0.22, -0.72), F('CB', 0.18, -0.25), F('CB', 0.18, 0.25), F('FB', 0.22, 0.72),
    F('DM', 0.33, 0), F('CM', 0.42, -0.35), F('CM', 0.42, 0.35),
    F('W', 0.62, -0.68), F('ST', 0.66, 0), F('W', 0.62, 0.68),
  ],
  '4-2-3-1': [
    F('GK', 0.03, 0),
    F('FB', 0.22, -0.72), F('CB', 0.18, -0.25), F('CB', 0.18, 0.25), F('FB', 0.22, 0.72),
    F('DM', 0.33, -0.2), F('DM', 0.33, 0.2),
    F('W', 0.52, -0.66), F('AM', 0.50, 0), F('W', 0.52, 0.66),
    F('ST', 0.66, 0),
  ],
  '3-5-2': [
    F('GK', 0.03, 0),
    F('CB', 0.18, -0.42), F('CB', 0.16, 0), F('CB', 0.18, 0.42),
    F('FB', 0.40, -0.80), F('CM', 0.38, -0.28), F('DM', 0.32, 0), F('CM', 0.38, 0.28), F('FB', 0.40, 0.80),
    F('ST', 0.63, -0.18), F('ST', 0.63, 0.18),
  ],
  '5-3-2': [
    F('GK', 0.03, 0),
    F('FB', 0.25, -0.80), F('CB', 0.17, -0.40), F('CB', 0.15, 0), F('CB', 0.17, 0.40), F('FB', 0.25, 0.80),
    F('CM', 0.38, -0.35), F('DM', 0.34, 0), F('CM', 0.38, 0.35),
    F('ST', 0.60, -0.18), F('ST', 0.60, 0.18),
  ],
};

export const FORMATION_NAMES = Object.keys(FORMATIONS);

// How each role shifts with the ball. Higher follow = tracks the ball more.
export const ROLE_TRAITS = {
  GK: { followD: 0.06, followW: 0.10, attackPush: 0.00, defendDrop: 0.00 },
  CB: { followD: 0.45, followW: 0.30, attackPush: 0.22, defendDrop: 0.10 },
  FB: { followD: 0.55, followW: 0.20, attackPush: 0.35, defendDrop: 0.12 },
  DM: { followD: 0.55, followW: 0.40, attackPush: 0.20, defendDrop: 0.12 },
  CM: { followD: 0.60, followW: 0.45, attackPush: 0.25, defendDrop: 0.10 },
  AM: { followD: 0.60, followW: 0.45, attackPush: 0.25, defendDrop: 0.06 },
  W:  { followD: 0.60, followW: 0.25, attackPush: 0.28, defendDrop: 0.08 },
  ST: { followD: 0.55, followW: 0.35, attackPush: 0.22, defendDrop: 0.03 },
};
