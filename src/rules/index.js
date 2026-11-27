// Rules entry point. The rules thread replaces this with the full referee.
// Contract: createRules(match) -> { preUpdate(dt), update(dt) }
import { BasicRules } from './basic.js';
export function createRules(match) {
  return new BasicRules(match);
}
