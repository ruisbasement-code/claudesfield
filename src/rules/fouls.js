// Foul and misconduct judgement for 'tackle' events emitted by the core.
//
// The core applies the physics of a challenge (ball knocked loose, victim stumbles)
// and reports { tackler, victim, kind, ballFirst, contact, fromBehind, severity, pos }.
// The referee here decides: foul or not, direct free kick or penalty, which card,
// and whether a denial of an obvious goal-scoring opportunity (DOGSO) happened.
import { PITCH, clamp } from '../core/constants.js';
import { attackGoalX, dist2D, goalAngle, inOwnBox, outfield } from './geometry.js';

export const STRICTNESS = { lenient: 0.72, normal: 1, strict: 1.3 };

export function strictnessOf(match) {
  const s = match.config?.referee ?? match.config?.refereeStrictness ?? 'normal';
  return typeof s === 'number' ? s : STRICTNESS[s] ?? 1;
}

// Obvious goal-scoring opportunity denied? Distance to goal, direction of play,
// control of the ball and the number of defenders that could still cover.
export function isDOGSO(match, victim, tackler, pos) {
  const team = victim.team;
  const gx = attackGoalX(team);
  const distGoal = Math.hypot(gx - pos.x, pos.z);
  if (distGoal > 30) return false;
  if (goalAngle(pos, gx) < 0.16) return false; // very tight angle
  const ball = match.ball;
  const control = ball.owner === victim || dist2D(ball.pos, victim.pos) < 2.2;
  if (!control) return false;
  // Moving towards goal (or standing still)
  const vx = victim.vel?.x ?? 0;
  if (vx * team.side < -1.5) return false;
  // Defenders between the ball and the goal who could still challenge
  const s = team.side;
  const covering = outfield(tackler.team).filter((d) => d !== tackler && d.pos.x * s > pos.x * s - 1 && Math.abs(d.pos.z - pos.z) < 18);
  return covering.length === 0;
}

// Returns null (no foul) or
// { tackler, victim, pos, penalty, card: null|'yellow'|'red', reason, dogso }
export function judgeTackle(match, ev) {
  const { tackler, victim, kind, ballFirst, contact, fromBehind } = ev;
  if (!contact || !victim || !tackler || tackler.team === victim.team) return null;
  const strict = strictnessOf(match);
  const severity = clamp(ev.severity ?? 0.5, 0, 1);
  const slide = kind === 'slide';

  // Probability the referee calls it.
  let pFoul;
  if (ballFirst) pFoul = (slide ? 0.08 : 0.03) + (fromBehind ? 0.18 : 0) + Math.max(0, severity - 0.75) * 0.9;
  else pFoul = 0.62 + severity * 0.3 + (fromBehind ? 0.15 : 0) + (slide ? 0.08 : 0);
  pFoul = clamp(pFoul * strict, 0, 0.98);
  if (Math.random() > pFoul) return null;

  const pos = ev.pos?.clone ? ev.pos.clone() : victim.pos.clone();
  pos.y = 0;
  const penalty = inOwnBox(tackler.team, pos);

  // Misconduct: reckless (yellow) / excessive force (red)
  let card = null, reason = 'foul';
  const danger = severity * (slide ? 1.25 : 0.9) + (fromBehind ? 0.3 : 0) + (ballFirst ? -0.35 : 0);
  const pRed = clamp((danger - 1.35) * 1.2 * strict, 0, 0.9);
  const pYellow = clamp((danger - 0.78) * 1.1 * strict, 0, 0.9);
  const r = Math.random();
  if (r < pRed) { card = 'red'; reason = 'serious foul play'; }
  else if (r < pRed + pYellow) { card = 'yellow'; reason = 'reckless challenge'; }

  // Tactical fouls: stopping a promising attack is a yellow, DOGSO a red
  // (in the box, a genuine attempt to play the ball is downgraded to yellow).
  const dogso = isDOGSO(match, victim, tackler, pos);
  if (dogso) {
    if (penalty && !fromBehind && severity < 0.8) { if (card !== 'red') { card = 'yellow'; reason = 'denied a goal-scoring chance'; } }
    else { card = 'red'; reason = 'denied an obvious goal-scoring opportunity'; }
  } else if (!card) {
    const depth = victim.pos.x * victim.team.side + PITCH.halfL;
    const breakaway = depth > 55 && (victim.vel?.x ?? 0) * victim.team.side > 3.5;
    if (breakaway && Math.random() < 0.35 * strict) { card = 'yellow'; reason = 'stopped a promising attack'; }
  }

  return { tackler, victim, pos, penalty, card, reason, dogso };
}
