// Team AI entry point.
// Contract (ARCHITECTURE.md): createTeamAI(match, team, difficulty) -> { update(dt) }
import { TeamAI } from './teamAI.js';
export { DIFFICULTY_PROFILES, getProfile, teammateProfile } from './difficulty.js';
export { FORMATIONS, FORMATION_NAMES } from './formations.js';

export function createTeamAI(match, team, difficulty) {
  return new TeamAI(match, team, difficulty);
}
