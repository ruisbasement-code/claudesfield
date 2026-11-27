# Claudesfield architecture

Browser football game. Vite + Three.js, plain ES modules, no framework.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
npm run sim      # headless AI-vs-AI match in node (smoke test for sim/ai/rules)
```

## Folder ownership

| Folder | What | Owner thread |
|---|---|---|
| `src/core/` | constants, event bus, math helpers | core |
| `src/data/` | fictional teams, kits, players, stats | core |
| `src/sim/` | `Match`, `Ball`, `Player`, kick/tackle actions, physics | core |
| `src/input/` | keyboard + gamepad reading, `HumanController` | core |
| `src/render/` | Three.js scene, stadium, player models, cameras | core |
| `src/audio/` | synthesized whistle/kick/crowd | core |
| `src/rules/` | referee, fouls, cards, offside, restarts, set pieces, halves, shootouts | rules |
| `src/ai/` | formations, team AI, goalkeeper AI, difficulty | ai |
| `src/ui/` | title/menus/settings/rebinding/HUD/pause/results (DOM overlay) | menus |
| `src/main.js` | wires UI + Game together | core (menus may edit the UI calls) |

**The sim (`src/sim`, `src/rules`, `src/ai`, `src/data`, `src/core`) must never touch the DOM or Three.js rendering**, so it runs in node for `npm run sim`. It may import `three` for `Vector3` only.

## World conventions

* Metres. `x` = pitch length (goal line to goal line, -52.5..52.5), `z` = width (-34..34), `y` = up. Origin = centre spot.
* Constants: `src/core/constants.js` (`PITCH`, `GOAL`, `BALL`, `PLAYER`, `SIM`, `DIFFICULTIES`).
* `team.side` is `+1` if the team attacks towards `+x` (the goal at `x = +52.5`), `-1` otherwise. **Sides swap at half time** (`match.swapSides()`), so always use `team.side`, never assume.
* Helper: `team.attackGoal` / `team.ownGoal` are `Vector3` goal-centre positions (updated on swap).
* Fixed timestep: `SIM.dt = 1/60`. The ball integrates with 4 substeps.
* Difficulty ids: `'amateur' | 'semipro' | 'pro' | 'worldclass' | 'legendary'`.

## Match (`src/sim/match.js`)

```js
const match = new Match({ home: teamData, away: teamData, homeKit, awayKit,
                          difficulty, halfMinutes, humanSide: 'home'|'away'|'none', ... });
match.update(dt)   // called with SIM.dt by the game loop
```

Fields everyone may read:

* `match.ball` – `Ball` (see below)
* `match.teams[0|1]` – `Team { id:'home'|'away', index, data, kit, side, players[], human:bool, score, stats, attackGoal, ownGoal, opponent }`
* `match.players` – all 22 `Player`s
* `match.events` – `EventBus` (`on(name, fn)`, `emit(name, payload)`)
* `match.phase` – `'prematch' | 'kickoff' | 'live' | 'stopped' | 'setpiece' | 'halftime' | 'fulltime' | 'shootout'`
  * Players only collide with/touch the ball and run "free" when `phase === 'live'` or `'setpiece'` (for the taker).
* `match.setPiece` – `null | { type:'kickoff'|'throwin'|'corner'|'goalkick'|'freekick'|'penalty'|'dropball', team, taker, spot:Vector3, direct:bool }`
  * While a set piece is pending, **only `setPiece.taker` may touch the ball**; the first kick by the taker emits `kick` and the match goes back to `live` automatically (`match.resumePlay()`).
* `match.clock` – `{ seconds, half, addedTime, running }` (game seconds; 45*60 per half). Rules owns advancing it.
* `match.difficulty`, `match.config`
* `match.possession` – the `Team` that last had controlled possession (or null).
* `match.paused` – UI pause; `update` returns immediately.

Methods (used by rules/ai/ui):

* `match.placeBall(pos)` – put ball still at pos (y defaults to radius), clears owner.
* `match.teleport(player, pos, faceAngle?)` – move a player instantly, zero velocity.
* `match.startSetPiece({type, team, taker, spot, direct})` – sets `phase='setpiece'`, puts ball at spot, gives the taker the ball "on the spot", locks nobody else (rules positions the other players itself, e.g. walls / 9.15 m).
* `match.resumePlay()` – `phase='live'`.
* `match.stopPlay(reason)` – `phase='stopped'`, ball/players freeze AI targets until rules restarts.
* `match.swapSides()` – flip `team.side` (half time / extra time).
* `match.setControlled(team, player)` – change which player the human controls.
* `match.nearestPlayer(team, pos, filter?)`
* `player.locked = true` – player ignores intents and stands still (or walks to `player.lockTarget` if set). Use for walls, celebrations, cut-scenes.

### Per-frame order inside `match.update(dt)`

1. `rules.preUpdate(dt)` – clock, phase timers
2. human controller writes `intent` for the controlled player
3. `teamAI.update(dt)` for both teams – writes `intent` for every other non-locked player (including the human team's teammates and both goalkeepers unless human-controlled)
4. players integrate (movement, stamina, consume `intent.action` → kicks/tackles)
5. ball physics (posts, crossbar, nets, ground)
6. ball pickup / possession resolution → `touch`, `possession` events
7. boundary checks → `ballOut` / `goal` events
8. `rules.update(dt)`

### Player (`src/sim/player.js`)

```
player.id, player.team, player.data {name, short, number, pos:'GK'|'CB'|..., role:'GK'|'DF'|'MF'|'FW', stats}
player.pos: Vector3, player.vel: Vector3, player.facing (radians, 0 = +x, atan2(z, x))
player.stamina 0..1, player.isGK, player.locked, player.lockTarget
player.state: 'run' | 'kick' | 'slide' | 'tackle' | 'stumble' | 'dive' | 'celebrate' | 'hold' (GK holding ball)
player.yellow (count), player.sentOff
player.hasBall()  // ball.owner === player
player.slot        // formation index 0..10 (0 = GK), used by AI
```

Stats (0-99) in `player.data.stats`: `pace, accel, shooting, passing, dribbling, defending, physical, stamina` and for keepers also `diving, reflexes, handling, positioning`. `player.data.overall` is precomputed.

### Intents – the single input interface (human AND AI)

Every frame the controller/AI sets `player.intent`:

```js
player.intent = {
  move: { x, z },        // desired direction, length 0..1 (1 = full jog / sprint)
  sprint: false,
  face: null,            // optional radians override
  action: null | {
    type: 'pass' | 'through' | 'lob' | 'cross' | 'shoot' | 'clear'
        | 'tackle' | 'slide' | 'dive' | 'gkThrow' | 'gkKick',
    dir: { x, z },        // aim direction (human stick) – used to auto-pick receiver/target
    power: 0..1,          // charged power
    target: Vector3?,     // explicit target point (AI); overrides dir
    receiver: Player?,    // explicit receiver (AI); overrides dir
    finesse: false, chip: false,  // shot modifiers
    height: 0..1,         // for 'dive': 0 = low, 1 = high
  }
}
```

`action` is consumed (set back to null) by `Player.update` when executed. Ball-actions are ignored unless the player has the ball or the ball is within reach (volleys/headers/first-time passes are allowed). `tackle`/`slide` work without the ball.

AI entry point (ai thread): `src/ai/index.js` exports `createTeamAI(match, team, difficulty) -> { update(dt), onEvent?(name,payload) }`. The core only calls `update`. A placeholder lives there until the AI thread replaces it.

### Ball (`src/sim/ball.js`)

```
ball.pos, ball.vel, ball.spin (Vector3 rad/s, Magnus), ball.owner (Player|null)
ball.lastTouch (Player|null), ball.lastKick {player, type, time}
ball.inAir()            // y > radius + 0.05
ball.predict(t)         // position after t seconds (simulated, no players)
ball.predictLanding()   // {pos, t} where it next hits the ground
ball.predictCrossX(x)   // {pos, t} when it crosses plane x (for GK)
```

### Events (`match.events`)

| name | payload |
|---|---|
| `touch` | `{ player, kind:'control'|'kick'|'header'|'deflect'|'save'|'catch'|'parry' }` – every ball contact by a player |
| `kick` | `{ player, type, power }` – deliberate kicks (passes/shots/clears) including set-piece takes |
| `possession` | `{ player, team, prev }` |
| `tackle` | `{ tackler, victim, kind:'tackle'|'slide', ballFirst:bool, contact:bool, fromBehind:bool, severity:0..1, pos }` – rules decides if it's a foul |
| `ballOut` | `{ line:'side'|'goal', pos, lastTouch, isGoal:false }` – ball fully crossed a line (not a goal) |
| `goal` | `{ team /*scoring*/, scorer /*lastTouch, may be own goal*/, ownGoal, pos }` – ball crossed the goal line inside the goal frame |
| `post` | `{ pos }` – hit woodwork |
| `save` | `{ keeper, shooter }` |
| `shot` | `{ player, onTarget:bool }` |
| `phase` | `{ phase, prev }` |
| `whistle` | `{ kind:'short'|'long'|'double' }` – audio hook (rules emits) |
| `card` | `{ player, color:'yellow'|'red' }` (rules emits; UI/render listen) |
| `message` | `{ text, kind? }` – generic banner for the HUD (rules/core emit) |

When the ball goes out / a goal is scored the core sets `phase='stopped'` and emits the event; **it does not restart play – rules does** (via `startSetPiece`). A minimal fallback ruleset in `src/rules/basic.js` restarts with throw-ins/corners/goal kicks/kickoffs so the game is playable on its own; the rules thread replaces it through `src/rules/index.js` → `createRules(match) -> { preUpdate(dt), update(dt) }`.

## Settings & input

* Settings module (menus thread): `src/ui/settings.js` → `getSettings()`, `onSettingsChange(fn)`, persisted in `localStorage`.
* Control actions: `moveUp, moveDown, moveLeft, moveRight, sprint, pass, through, shoot, lob, switch, finesse, chip, tackle, slide, skill, pause`. Keyboard maps use `KeyboardEvent.code` (e.g. `'KeyW'`, `'ShiftLeft'`). `tackle` defaults to the same key as `pass` and `slide` to `shoot` (context-sensitive, like console football).
* `src/input/input.js` (core) reads the bindings from settings and exposes `input.isDown(action)`, `input.pressed(action)`, `input.released(action)`, `input.moveVector()`.

## Rendering (`src/render/`)

`new Renderer(canvas, match)`; `renderer.render(alpha)` reads sim state only. Camera modes: `'broadcast' | 'tele' | 'wide' | 'end' | 'penalty'` from settings `camera.mode` (+ `zoom`, `height`).

## UI (`src/ui/`)

`createUI(root, handlers)` – see `src/ui/index.js` (menus thread). `main.js` calls `ui.hud.update(game.hudState())` every frame. HUD state shape is produced by `Game.hudState()` in `src/game.js`.

## Rules (`src/rules/`)

`createRules(match)` returns the `Referee` (`referee.js`), also reachable as `match.rules`. It owns the clock, periods, scoring and every restart.

* `match.config` keys read: `halfMinutes` (default 4), `extraTime`, `penalties` (shootout if level), `mode: 'penalties'` (straight shootout), `referee: 'lenient'|'normal'|'strict'`, `offside` (default on), `advantage` (default on), `replays` (default on), `halftimeWait` (hold the break until `match.rules.continueFromBreak()`), `breakSeconds`, `celebrationSeconds`.
* `match.officials` = `{ referee:{pos,vel,facing,state:'run'|'whistle'|'card'|'advantage'|'point',cardColor}, assistants:[{pos,facing,flag:'down'|'up'|'offside'} x2] }`.
* `match.replay` = `{ active, frames:[{ball:{x,y,z}, players:[{x,y,z,facing,state,speed,sentOff}] (match.players order), referee:{x,z,facing}}], t, fps, speed, title }` while a goal replay plays; `match.rules.skipReplay()`.
* `match.goalsLog`, `match.shootout` (`{active, kicks:{home:[bool],away:[bool]}, first, current, done, winner}`), `match.result` (`{home, away, pens, winner, goals}` at full time).
* Extra events: `fulltime` (result), `shootoutKick` `{team, taker, scored}`. `team.stats` counters: `goals, fouls, yellow, red, offsides, corners, freekicks`.
* Modules: `offside.js` (snapshot at each touch, flagged when an offside-position player becomes involved), `fouls.js` (foul/card/DOGSO judgement), `setpieces.js` (positions, walls, 9.15 m zones), `officials.js`, `replay.js`, `shootout.js`.
* `node tools/rules-test.mjs` runs headless checks against a mock match.
