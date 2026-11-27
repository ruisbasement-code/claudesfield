// Headless checks for the Xbox / FC-classic gamepad layer: Input polling with a fake pad and the
// HumanController's FC actions (contain, jockey, shield, right-stick skills and switching).
import { Vector3 } from 'three';
import { Input } from '../src/input/input.js';
import { HumanController } from '../src/input/humanController.js';
import { Match } from '../src/sim/match.js';
import { SIM } from '../src/core/constants.js';

globalThis.performance ??= { now: () => Date.now() };
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// ---- fake Xbox pad on the standard mapping
const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', connected: true, mapping: 'standard',
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [pad] }, configurable: true });
const press = (i, v = 1) => { pad.buttons[i] = { pressed: v > 0.5, value: v }; };
const release = (i) => { pad.buttons[i] = { pressed: false, value: 0 }; };

const target = new EventTarget();
const input = new Input(target);
const { GAMEPAD_DEFAULTS } = await import('../src/ui/settings.js');
input.setBindings({ gamepad: GAMEPAD_DEFAULTS });

press(0); input.poll();
ok(input.isDown('pass') && input.isDown('contain'), 'A = pass (attack) and contain (defend)');
release(0); press(1); input.poll();
ok(input.isDown('shoot') && input.isDown('tackle'), 'B = shoot and tackle');
release(1); press(2); input.poll();
ok(input.isDown('lob') && input.isDown('slide'), 'X = lob/cross and slide');
release(2); press(3); input.poll();
ok(input.isDown('through') && input.isDown('keeperRush'), 'Y = through ball and keeper rush');
release(3); press(4); press(5); input.poll();
ok(input.isDown('switch') && input.isDown('chip') && input.isDown('finesse') && input.isDown('teamContain'), 'LB = switch/chip mod, RB = finesse mod/teammate contain');
release(4); release(5);
pad.buttons[7] = { pressed: false, value: 0.45 }; input.poll();
ok(input.isDown('sprint'), 'RT sprint registers from the analogue value alone');
pad.buttons[7] = { pressed: false, value: 0 };
press(6); input.poll();
ok(input.isDown('shield') && input.isDown('jockey'), 'LT = shield and jockey');
release(6);
press(15); input.poll();
const mv = input.moveVector();
ok(mv.x === 0 && mv.y === 0, 'd-pad does not move the player (it is for tactics)');
release(15);
pad.axes = [0.9, 0, 0, 0]; input.poll();
ok(input.moveVector().x > 0.8, 'left stick moves');
pad.axes = [0, 0, 0, 0]; input.poll(); input.poll();
pad.axes = [0, 0, 0, -0.95]; input.poll();
const f = input.flicked();
ok(f && f.y < -0.9, 'right-stick flick detected with direction');
input.poll();
ok(!input.flicked(), 'flick is edge-triggered (one per flick)');
pad.axes = [0, 0, 0, 0]; input.poll();

// ---- controller behaviour in a match
class FakeInput {
  constructor() { this.cur = {}; this.prev = {}; this.mv = { x: 0, y: 0 }; this.flick = null; }
  set(a, v) { this.cur[a] = v; }
  step() { this.prev = { ...this.cur }; this.flick = null; }
  isDown(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  released(a) { return !this.cur[a] && !!this.prev[a]; }
  moveVector() { return this.mv; }
  flicked() { return this.flick; }
}
const basis = () => ({ up: { x: 0, z: -1 }, right: { x: 1, z: 0 } }); // screen up = world -z
const m = new Match({ homeId: 'kestrel', awayId: 'valdora', humanSide: 'home', halfMinutes: 4, difficulty: 'amateur' });
const fi = new FakeInput();
const hc = new HumanController(m, m.teams[0], fi, basis);
m.humanControllers = [hc];
m.rules.update = () => {}; m.rules.preUpdate = () => {};
const home = m.teams[0], away = m.teams[1];
const step = (n = 1) => { for (let i = 0; i < n; i++) { m.update(SIM.dt); fi.step(); } };
m.resumePlay();
for (const ai of m.ai) ai.update = () => { for (const q of m.players) { q.intent.move.x = 0; q.intent.move.z = 0; q.intent.action = null; q.intent.sprint = false; } }; // freeze AI so only the human acts
hc.autoSwitch = 'off';

// shield: player with the ball slows down and is flagged
const st = home.players[9];
m.teleport(st, new Vector3(0, 0, 0), 0);
m.placeBall(new Vector3(0.5, 0.11, 0)); m.giveBall(st); m.setControlled(home, st);
for (const o of m.players) if (!o.isGK && o !== st) m.teleport(o, new Vector3(-30, 0, o.pos.z)); // clear the area around the carrier
fi.mv = { x: 1, y: 0 };
step(60);
const free = Math.hypot(st.vel.x, st.vel.z);
fi.set('shield', true); step(40);
const shielded = Math.hypot(st.vel.x, st.vel.z);
ok(st.shielding && shielded < free * 0.6, `LT shield slows the carrier (${free.toFixed(1)} -> ${shielded.toFixed(1)} m/s)`);
fi.set('shield', false); step(2);
ok(!st.shielding, 'shield releases');

// right-stick skill: forward flick knocks the ball on
m.teleport(st, new Vector3(0, 0, 0), 0); m.placeBall(new Vector3(0.5, 0.11, 0)); m.giveBall(st);
fi.mv = { x: 0, y: 0 }; fi.flick = { x: 1, y: 0 }; step(1);
ok(!m.ball.owner && m.ball.vel.x > 5, 'RS flick with the ball knocks it into space');

// defending: contain closes down, jockey slows, right-stick switch picks the flicked team-mate
const carrier = away.players[9];
m.teleport(carrier, new Vector3(-10, 0, 0), 0);
m.placeBall(new Vector3(-9.5, 0.11, 0)); m.giveBall(carrier);
const def = home.players[4];
m.teleport(def, new Vector3(-16, 0, 0), 0); m.setControlled(home, def);
fi.mv = { x: 0, y: 0 };
hc.autoSwitch = 'off';
fi.set('contain', true); step(30);
ok(def.pos.x > -15.5, `A contain closes the carrier down (defender x ${def.pos.x.toFixed(1)})`);
fi.set('contain', false);
const reset = () => {
  m.teleport(carrier, new Vector3(-10, 0, 0), 0);
  m.placeBall(new Vector3(-9.5, 0.11, 0)); m.giveBall(carrier);
  m.teleport(def, new Vector3(-16, 0, 12), 0); m.setControlled(home, def);
};
reset();
fi.mv = { x: 0, y: 1 }; step(60);
const run = Math.hypot(def.vel.x, def.vel.z);
fi.set('jockey', true); step(40);
const jog = Math.hypot(def.vel.x, def.vel.z);
ok(jog < run * 0.7, `LT jockey slows the defender (${run.toFixed(1)} -> ${jog.toFixed(1)} m/s)`);
fi.set('jockey', false); fi.mv = { x: 0, y: 0 }; reset(); step(2);
// put a team-mate clearly "up" the screen (world -z) and flick there
const mate = home.players[7];
m.teleport(mate, new Vector3(def.pos.x, 0, def.pos.z - 15));
for (const q of home.players) if (q !== mate && q !== def && !q.isGK) m.teleport(q, new Vector3(q.pos.x, 0, 30));
fi.flick = { x: 0, y: -1 }; step(1);
ok(home.controlled === mate, 'RS flick switches to the team-mate in that direction');
fi.set('switch', true); step(1); fi.set('switch', false); step(1);
ok(home.controlled !== mate, 'LB switches player');
reset(); step(1);
ok(hc.state === 'defend', `controller reports the defend context for HUD prompts (${hc.state})`);
// keeper rush
const gk = home.keeper;
m.teleport(gk, new Vector3(home.ownGoal.x + home.side * 2, 0, 0));
const d0 = gk.pos.distanceTo(m.ball.pos);
fi.set('keeperRush', true); step(60);
const d1 = gk.pos.distanceTo(m.ball.pos);
ok(d0 - d1 > 3, `Y rushes the keeper out towards the ball (${d0.toFixed(1)} -> ${d1.toFixed(1)} m)`);
fi.set('keeperRush', false);

console.log(fails ? `\n${fails} check(s) failed` : '\nall gamepad checks passed');
process.exit(fails ? 1 : 0);
