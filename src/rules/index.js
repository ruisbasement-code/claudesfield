// Rules entry point. Contract: createRules(match) -> { preUpdate(dt), update(dt) }
// The full referee lives in referee.js; see src/rules/README.md for behaviour.
import { Referee } from './referee.js';
export function createRules(match) {
  return new Referee(match);
}
