// Headless checks for the rules layer against a minimal mock of the Match contract
// in ARCHITECTURE.md. Run: node tools/rules-test.mjs
import { Vector3 } from 'three';
import { EventBus } from '../src/core/events.js';
import { createRules } from '../src/rules/index.js';

const ROLES = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'];
function mockMatch(config = {}) {
  const events = new EventBus();
  const ball = { pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), owner: null, lastTouch: null, lastKick: null };
  const m = {
    config: { halfMinutes: 1, ...config }, events, ball, phase: 'prematch', setPiece: null, clock: {}, paused: false,
    teams: [], players: [], log: [],
    placeBall(p) { ball.pos.set(p.x, 0.11, p.z); ball.vel.set(0, 0, 0); ball.owner = null; },
    teleport(pl, p, f) { pl.pos.set(p.x, 0, p.z); pl.vel.set(0, 0, 0); if (f != null) pl.facing = f; },
    startSetPiece(sp) { m.setPiece = sp; m.phase = 'setpiece'; m.placeBall(sp.spot); },
    resumePlay() { m.phase = 'live'; m.setPiece = null; },
    stopPlay(r) { m.phase = 'stopped'; },
    swapSides() { for (const t of m.teams) t.side *= -1; },
    setControlled() {},
  };
  for (let i = 0; i < 2; i++) {
    const t = { id: i ? 'away' : 'home', index: i, side: i ? -1 : 1, score: 0, stats: {}, players: [], human: false, data: { name: i ? 'Away FC' : 'Home FC', short: i ? 'AWY' : 'HOM' } };
    m.teams.push(t);
    ROLES.forEach((role, s) => {
      const p = { id: `${t.id}${s}`, team: t, slot: s, isGK: role === 'GK', pos: new Vector3(), vel: new Vector3(), facing: 0, state: 'run', intent: null, locked: false,
        data: { name: `${t.id}-${s}`, short: `${t.id[0].toUpperCase()}${s}`, role, stats: { shooting: 50 + s * 3, passing: 60, physical: 60 } } };
      t.players.push(p); m.players.push(p);
    });
  }
  m.teams[0].opponent = m.teams[1]; m.teams[1].opponent = m.teams[0];
  events.on('*', (name, p) => { if (['message', 'card', 'whistle', 'fulltime', 'shootoutKick'].includes(name)) m.log.push([name, p?.text ?? p?.color ?? p?.kind ?? '']); });
  return m;
}

const dt = 1 / 60;
function step(m, rules, seconds, each) {
  for (let t = 0; t < seconds; t += dt) {
    m.time = (m.time ?? 0) + dt; rules.preUpdate(dt);
    each?.();
    // take the set piece if pending (mock core: taker's intent → kick)
    if (m.phase === 'setpiece' && m.setPiece?.taker?.intent?.action) {
      const tk = m.setPiece.taker; tk.intent.action = null;
      m.events.emit('kick', { player: tk, type: 'pass' }); m.events.emit('touch', { player: tk, kind: 'kick' });
      ball.call(m, tk); m.resumePlay();
      if (m.shootout?.active && Math.random() < 0.72) { m.phase = 'stopped'; m.events.emit('goal', { team: tk.team, scorer: tk, pos: new Vector3(52.6, 1, 0) }); }
    }
    rules.update(dt);
  }
}
function ball(tk) { this.ball.lastTouch = tk; this.ball.vel.set(tk.team.side * 8, 0, 0); }

let fails = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

// 1. kick-off, throw-in, corner, goal kick
{
  const m = mockMatch(); const r = createRules(m);
  step(m, r, 2);
  check(m.phase === 'setpiece' && m.setPiece.type === 'kickoff', 'kick-off set up');
  const own = m.players.filter((p) => !p.sentOff).every((p) => p.pos.x * p.team.side <= 0.01);
  check(own, 'everyone in own half at kick-off');
  step(m, r, 4); // AI fallback takes it
  check(m.phase === 'live' && r.mode === 'play', 'kick-off taken, play live');
  check(!m.players.some((p) => p.locked), 'locks released after kick-off');

  const home = m.teams[0];
  m.ball.lastTouch = home.players[5];
  m.phase = 'stopped'; m.events.emit('ballOut', { line: 'side', pos: new Vector3(10, 0, 34.5), lastTouch: home.players[5] });
  step(m, r, 1.6);
  check(m.setPiece?.type === 'throwin' && m.setPiece.team === m.teams[1], 'throw-in to the other team');
  step(m, r, 4);
  check(m.phase === 'live', 'throw-in taken');

  // home attacks +x. Away (defending +x goal) touches last → corner for home
  m.phase = 'stopped'; m.events.emit('ballOut', { line: 'goal', pos: new Vector3(53, 0, 10), lastTouch: m.teams[1].players[3] });
  step(m, r, 2);
  check(m.setPiece?.type === 'corner' && m.setPiece.team === home && Math.abs(m.setPiece.spot.z) > 33, 'corner to attackers at the corner flag');
  const tooClose = m.teams[1].players.some((p) => p.pos.distanceTo(m.setPiece.spot) < 9.1);
  check(!tooClose, 'defenders 9.15 m from the corner');
  step(m, r, 4);
  m.phase = 'stopped'; m.events.emit('ballOut', { line: 'goal', pos: new Vector3(53, 0, -10), lastTouch: home.players[9] });
  step(m, r, 2);
  check(m.setPiece?.type === 'goalkick' && m.setPiece.team === m.teams[1] && m.setPiece.taker.isGK, 'goal kick taken by the keeper');
  step(m, r, 4);
}

// 2. fouls, wall, cards, penalty, offside, goal + replay
{
  const m = mockMatch({ referee: 'strict' }); const r = createRules(m);
  step(m, r, 6);
  const [home, away] = m.teams;
  // foul 22 m from away's goal (home attacks +x)
  const victim = home.players[9], tackler = away.players[2];
  victim.pos.set(30, 0, 5); tackler.pos.set(29.5, 0, 5.5); m.ball.pos.set(30.3, 0.11, 5); m.ball.owner = victim;
  let got = null;
  for (let i = 0; i < 40 && !got; i++) {
    m.events.emit('tackle', { tackler, victim, kind: 'slide', ballFirst: false, contact: true, fromBehind: true, severity: 0.95, pos: victim.pos.clone() });
    if (r.mode !== 'play') got = true;
  }
  check(got, 'reckless slide from behind is a foul');
  step(m, r, 4.5);
  check(m.setPiece?.type === 'freekick' && m.setPiece.team === home, 'direct free kick to fouled team');
  const wall = away.players.filter((p) => p.inWall);
  check(wall.length >= 3, `wall built (${wall.length} players)`);
  check(wall.every((p) => Math.abs(p.pos.distanceTo(m.setPiece.spot) - 9.15) < 1.6), 'wall ~9.15 m away');
  check(m.log.some(([n]) => n === 'card'), 'card shown for reckless foul');
  step(m, r, 5);
  check(m.phase === 'live' && wall.every((p) => !p.locked), 'free kick taken, wall released');

  // penalty: foul inside away's box
  victim.pos.set(46, 0, 2); m.ball.owner = victim; m.ball.pos.set(46.3, 0.11, 2);
  for (let i = 0; i < 40 && r.mode === 'play'; i++) m.events.emit('tackle', { tackler: away.players[3], victim, kind: 'tackle', ballFirst: false, contact: true, fromBehind: false, severity: 0.5, pos: victim.pos.clone() });
  step(m, r, 6);
  check(m.setPiece?.type === 'penalty', 'penalty awarded for foul in the box');
  const gk = away.players[0];
  check(Math.abs(gk.pos.x - 52.35) < 0.2, 'keeper on the goal line');
  const inBox = m.players.filter((p) => p !== m.setPiece.taker && p !== gk && p.pos.x > 36 && Math.abs(p.pos.z) < 20.16);
  check(inBox.length === 0, 'everyone else outside the box'); if (inBox.length) console.log(inBox.map((p) => [p.id, p.pos.x.toFixed(1), p.pos.z.toFixed(1), p.locked]));
  step(m, r, 4);
  check(m.phase === 'live', 'penalty taken');

  // goal
  const before = home.score;
  m.ball.lastTouch = m.setPiece?.taker ?? home.players[10];
  m.phase = 'stopped'; m.events.emit('goal', { team: home, scorer: home.players[10], pos: new Vector3(53, 1, 0) });
  check(home.score === before + 1, 'goal counted');
  step(m, r, 4.5);
  check(m.replay?.active, 'replay playing');
  r.skipReplay();
  step(m, r, 1);
  check(m.setPiece?.type === 'kickoff' && m.setPiece.team === away, 'conceding team kicks off');
  step(m, r, 4);

  // offside: home pass with a forward beyond the last defender
  for (const p of away.players) p.pos.set(p.isGK ? 50 : 20, 0, (p.slot - 5) * 4);
  const passer = home.players[6], runner = home.players[10];
  passer.pos.set(5, 0, 0); runner.pos.set(30, 0, 3); m.ball.pos.set(5.3, 0.11, 0);
  m.events.emit('touch', { player: passer, kind: 'kick' });
  step(m, r, 0.1);
  m.events.emit('touch', { player: runner, kind: 'control' });
  check(r.mode !== 'play' && m.log.some(([, t]) => String(t).startsWith('Offside')), 'offside called');
  check(m.officials.assistants.some((a) => a.flag === 'offside'), 'linesman flag up');
  step(m, r, 3);
  check(m.setPiece?.type === 'freekick' && !m.setPiece.direct && m.setPiece.team === away, 'indirect free kick to defenders');
  step(m, r, 4);
  // onside: runner behind the line
  runner.pos.set(15, 0, 3);
  m.events.emit('touch', { player: passer, kind: 'kick' });
  step(m, r, 0.1);
  m.events.emit('touch', { player: runner, kind: 'control' });
  check(r.mode === 'play', 'onside player not flagged');

  // VAR: tight call (runner 15 cm beyond the line) not flagged live, overturned on review
  for (const p of away.players) p.pos.set(p.isGK ? 50 : 20, 0, (p.slot - 5) * 4);
  runner.pos.set(20.18, 0, 3); m.ball.pos.set(5.3, 0.11, 0);
  const score = home.score;
  m.events.emit('touch', { player: passer, kind: 'kick' });
  step(m, r, 0.1);
  m.events.emit('touch', { player: runner, kind: 'control' });
  check(r.mode === 'play', 'tight offside not flagged by the linesman');
  m.phase = 'stopped'; m.events.emit('goal', { team: home, scorer: runner, pos: new Vector3(53, 1, 0) });
  check(r.mode === 'var', 'VAR check started');
  step(m, r, 3.5);
  check(home.score === score && m.log.some(([, t]) => String(t).includes('offside by')), 'VAR disallows the goal');
  step(m, r, 6);
  // level (onside) → goal stands
  for (const p of away.players) p.pos.set(p.isGK ? 50 : 20, 0, (p.slot - 5) * 4);
  runner.pos.set(19.9, 0, 3); m.ball.pos.set(5.3, 0.11, 0);
  m.events.emit('touch', { player: passer, kind: 'kick' });
  step(m, r, 0.1);
  m.events.emit('touch', { player: runner, kind: 'control' });
  m.phase = 'stopped'; m.events.emit('goal', { team: home, scorer: runner, pos: new Vector3(53, 1, 0) });
  step(m, r, 3.5);
  check(home.score === score + 1, 'VAR: goal stands when onside');
}

// 3. full match with extra time and penalties
{
  const m = mockMatch({ halfMinutes: 0.25, extraTime: true, penalties: true, replays: false }); const r = createRules(m);
  const phases = [];
  m.events.on('phase', (e) => phases.push(e.phase));
  let guard = 0;
  while (m.phase !== 'fulltime' && guard++ < 20000) step(m, r, 0.1);
  check(m.phase === 'fulltime', `match reaches full time (${(guard * 0.1).toFixed(0)} s)`);
  check(m.clock.half === 4, 'played extra time');
  check(phases.includes('shootout'), 'went to a shootout');
  const so = m.shootout;
  check(so?.done && so.winner, `shootout decided ${so?.kicks.home.map(Number).join('')} / ${so?.kicks.away.map(Number).join('')}`);
  check(m.result?.winner && m.result.pens, 'result has a winner and pens');
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall rules checks passed');
process.exit(fails ? 1 : 0);
