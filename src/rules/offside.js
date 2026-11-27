// Offside tracking.
//
// Law 11 in short: a player is in an offside position if, at the moment a team-mate
// plays or touches the ball, they are in the opponents' half, ahead of the ball and
// ahead of the second-last opponent. They are only penalised when they then become
// involved, which we approximate as "touches the ball next before an opponent
// deliberately plays it". Saves, parries and deflections don't reset it.
// No offside directly from a throw-in, corner or goal kick.
import { activePlayers } from './geometry.js';

const NO_OFFSIDE_RESTARTS = new Set(['throwin', 'corner', 'goalkick', 'dropball']);
const DELIBERATE = new Set(['control', 'kick', 'header', 'catch']);

export class OffsideTracker {
  constructor(match) {
    this.match = match;
    this.snapshot = null; // { team, kicker, players: Map<Player, {x,z}>, lineX, time }
    this.enabled = match.config?.offside !== false;
    // Debug/HUD: the current offside line of each team's opponents (x, or null)
    this.lines = [null, null];
  }

  reset() { this.snapshot = null; }

  // x of the offside line a team's attackers must stay behind: the second-last
  // opponent (usually the last outfield defender, GK being last), or the ball if
  // further forward, and never inside the attacker's own half.
  offsideLine(team) {
    const opp = activePlayers(team.opponent)
      .map((p) => p.pos.x * team.side)
      .sort((a, b) => b - a);
    const second = opp.length >= 2 ? opp[1] : opp[0] ?? 0;
    return Math.max(second, 0) * team.side;
  }

  isInOffsidePosition(player, ballX) {
    const team = player.team;
    const s = team.side;
    const px = player.pos.x * s;
    if (px <= 0.0) return false; // own half (on the halfway line counts as onside)
    if (px <= ballX * s) return false; // level with or behind the ball
    const line = this.offsideLine(team) * s;
    // Small tolerance in favour of the attacker ("level is onside")
    return px > line + 0.25;
  }

  // Called whenever a player plays the ball. `restartType` is the set piece the
  // touch restarted play from (if any).
  // Returns an offence { player, pos, team } when the toucher was offside.
  onTouch(player, kind, restartType) {
    if (!this.enabled) return null;
    const snap = this.snapshot;
    if (snap) {
      if (player.team === snap.team && player !== snap.kicker && snap.players.has(player)) {
        const at = snap.players.get(player);
        this.snapshot = null;
        return { player, team: player.team, pos: at, from: snap.kicker };
      }
      if (player.team !== snap.team && !DELIBERATE.has(kind)) {
        // save / parry / deflection by the defending side: offside still stands.
        return null;
      }
    }
    // New phase of play from this touch.
    this.snapshot = null;
    if (restartType && NO_OFFSIDE_RESTARTS.has(restartType)) return null;
    const ballX = this.match.ball.pos.x;
    const players = new Map();
    for (const mate of activePlayers(player.team)) {
      if (mate === player) continue;
      if (this.isInOffsidePosition(mate, ballX)) players.set(mate, { x: mate.pos.x, z: mate.pos.z });
    }
    if (players.size) this.snapshot = { team: player.team, kicker: player, players, time: this.match.clock.seconds };
    return null;
  }

  update() {
    const m = this.match;
    for (const t of m.teams) this.lines[t.index] = this.offsideLine(t);
  }
}
