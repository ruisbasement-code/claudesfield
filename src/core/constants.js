// World units are metres. Axes: x = pitch length (goal to goal), z = pitch width, y = up.
// Centre spot is the origin. Team.side = +1 attacks towards +x, -1 towards -x.

export const PITCH = {
  length: 105,
  width: 68,
  halfL: 52.5,
  halfW: 34,
  boxDepth: 16.5,
  boxHalfW: 20.16,
  sixDepth: 5.5,
  sixHalfW: 9.16,
  penaltySpot: 11, // distance from goal line
  centreCircleR: 9.15,
  cornerArcR: 1,
};

export const GOAL = {
  halfW: 3.66, // half of 7.32
  height: 2.44,
  depth: 2.0,
  postR: 0.06,
};

export const BALL = {
  radius: 0.11,
  mass: 0.43,
  gravity: 9.81,
  dragK: 0.0125, // a = -k * |v| * v   (0.5*rho*Cd*A/m)
  magnusK: 0.012, // a = k * (spin x v)
  spinDecay: 0.35, // per second (airborne)
  restitution: 0.62,
  groundFriction: 0.55, // tangential velocity kept on bounce impact
  rollDecel: 1.1, // m/s^2 rolling resistance on grass
  postRestitution: 0.7,
};

export const SIM = {
  dt: 1 / 60,
  ballSubsteps: 4,
};

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  controlRange: 0.85, // distance from player centre at which the ball can be collected
  headerReach: 2.45,
};

export const DIFFICULTIES = ['amateur', 'semipro', 'pro', 'worldclass', 'legendary'];
export const DIFFICULTY_LABELS = {
  amateur: 'Amateur',
  semipro: 'Semi-Pro',
  pro: 'Professional',
  worldclass: 'World Class',
  legendary: 'Legendary',
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randn = () => {
  // approx gaussian
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.58;
};
