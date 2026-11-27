// Difficulty profiles for the team AI. Ids match DIFFICULTIES in core/constants.js.
// reactionTime: seconds between "thinks" (and delay before reacting to new events)
// decisionQuality: 0..1, how reliably the best-scoring option is chosen
// aimError: radians of extra gaussian aim error on passes / shots (scaled by stats)
// pressIntensity: how eagerly the team closes down and how high it presses
// tackleSkill: chance a tackle attempt is timed well (when close enough)
// positioning: how faithfully players hold shape and track runners (0..1)
// gkReflex: keeper reaction + read quality
// sprintUse: how readily players sprint (work rate)
// dribbleBravery: willingness to take players on instead of passing
// offsideTrap: how high/flat the defensive line holds
// riskTaking: appetite for through balls / long shots

export const DIFFICULTY_PROFILES = {
  amateur: {
    reactionTime: 0.55, decisionQuality: 0.35, aimError: 0.17, pressIntensity: 0.30,
    tackleSkill: 0.35, positioning: 0.55, gkReflex: 0.50, sprintUse: 0.45,
    dribbleBravery: 0.30, offsideTrap: 0.0, riskTaking: 0.25,
  },
  semipro: {
    reactionTime: 0.40, decisionQuality: 0.52, aimError: 0.11, pressIntensity: 0.45,
    tackleSkill: 0.48, positioning: 0.70, gkReflex: 0.64, sprintUse: 0.60,
    dribbleBravery: 0.40, offsideTrap: 0.15, riskTaking: 0.35,
  },
  pro: {
    reactionTime: 0.28, decisionQuality: 0.68, aimError: 0.07, pressIntensity: 0.60,
    tackleSkill: 0.62, positioning: 0.82, gkReflex: 0.78, sprintUse: 0.75,
    dribbleBravery: 0.52, offsideTrap: 0.35, riskTaking: 0.45,
  },
  worldclass: {
    reactionTime: 0.18, decisionQuality: 0.83, aimError: 0.04, pressIntensity: 0.76,
    tackleSkill: 0.76, positioning: 0.92, gkReflex: 0.88, sprintUse: 0.88,
    dribbleBravery: 0.62, offsideTrap: 0.55, riskTaking: 0.55,
  },
  legendary: {
    reactionTime: 0.10, decisionQuality: 0.95, aimError: 0.018, pressIntensity: 0.90,
    tackleSkill: 0.88, positioning: 0.98, gkReflex: 0.96, sprintUse: 1.0,
    dribbleBravery: 0.72, offsideTrap: 0.75, riskTaking: 0.62,
  },
};

export function getProfile(id) {
  return DIFFICULTY_PROFILES[id] || DIFFICULTY_PROFILES.pro;
}

// The human side's AI teammates: a competent "pro" baseline nudged slightly
// toward the opponent's level, so your team never plays itself at Legendary
// and never embarrasses you at Amateur.
export function teammateProfile(opponentId) {
  const base = DIFFICULTY_PROFILES.pro;
  const opp = getProfile(opponentId);
  const out = {};
  for (const k of Object.keys(base)) out[k] = base[k] * 0.7 + opp[k] * 0.3;
  return out;
}
