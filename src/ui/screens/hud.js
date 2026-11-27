// In-match HUD: broadcast scorebug, clock, set-piece/replay chips, controlled player card with
// stamina, shot power bar, radar, event banners, half-time panel, penalty shootout tracker.
//
// hud.update(state) is called every frame by main.js. It reads, when present:
//   state.homeScore, awayScore, clockSeconds, half, addedTime
//   state.activePlayer { name, number, pos?, stamina (0..1 or 0..100), id? }
//   state.power { value 0..1, visible }
//   state.players [{ x, z (or y), team:'home'|'away'|0|1, active?, gk? }], state.ball { x, z }
//   state.setPiece { type, team }, state.phase, state.message { text, kind, id }
// When handlers.getMatch() is provided the HUD also reads the Match directly (score, clock, radar,
// shootout, replay, half-time) and listens to match.events for banners and statistics.
import { h, esc } from '../dom.js';
import { getSettings } from '../settings.js';
import { teamColors, inkFor, colorDistance, visibleColor } from '../art.js';
import { StatsTracker, summarize, minuteLabel, nameOf } from '../summary.js';
import { scorelineEl, statsEl } from './common.js';
import { PITCH } from '../../core/constants.js';

const SETPIECE_LABEL = { kickoff: 'Kick-off', throwin: 'Throw-in', corner: 'Corner', goalkick: 'Goal kick', freekick: 'Free kick', penalty: 'Penalty', dropball: 'Drop ball' };

export function createHUD(ui) {
  // ---------------------------------------------------------------- DOM
  const homeTeam = h('div.seg.team'), awayTeam = h('div.seg.team.is-away');
  const homeName = h('span'), awayName = h('span');
  const homeBar = h('i'), awayBar = h('i');
  homeTeam.append(homeBar, homeName); awayTeam.append(awayName, awayBar);
  const homeScore = h('span'), awayScore = h('span');
  const score = h('div.seg.score', {}, homeScore, h('s'), awayScore);
  const clock = h('div.seg.clock');
  const added = h('div.seg.added');
  const scorebug = h('div.cf-scorebug', {}, h('div.seg.brand'), homeTeam, score, awayTeam, clock, added);
  const sub = h('div.cf-scorebug-sub');

  const pcNum = h('div.num'), pcName = h('span'), pcPos = h('small'), stamina = h('i');
  const meter = h('div.cf-meter', {}, stamina);
  const playercard = h('div.cf-playercard', {}, h('div.pc', {}, pcNum, h('div.info', {}, h('div.nm', {}, pcName, pcPos), meter)));
  const powerFill = h('i');
  const powerLabel = h('b');
  const power = h('div.cf-power', {}, powerFill, powerLabel);

  const canvas = h('canvas', { width: 560, height: 364 });
  const radar = h('div.cf-radar', {}, canvas);
  const banner = h('div.cf-banner');
  const fps = h('div.cf-fps');
  const halftime = h('div.cf-halftime', { hidden: true });

  const el = h('div.cf-hud', {}, scorebug, sub, playercard, power, radar, halftime, banner, fps);

  // ---------------------------------------------------------------- state
  let config = null;
  let match = null;
  let tracker = null;
  let unsub = [];
  let colors = { home: '#fff', away: '#000' };
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;
  let lastScore = [0, 0];
  let lastMessageId = null;
  let lastPhase = null;
  const queue = [];
  let bannerBusy = false;

  function teamFor(side) {
    if (config?.[side]) return config[side];
    return match?.teams?.[side === 'home' ? 0 : 1]?.data || null;
  }
  function kitFor(side) {
    const t = teamFor(side);
    const k = config?.[side + 'Kit'] || 'home';
    return match?.teams?.[side === 'home' ? 0 : 1]?.kit || t?.kits?.[k] || t?.kits?.home || {};
  }

  function setupTeams() {
    const H = teamFor('home'), A = teamFor('away');
    homeName.textContent = (H?.short || H?.name || 'HOM').toUpperCase();
    awayName.textContent = (A?.short || A?.name || 'AWY').toUpperCase();
    const hk = kitFor('home'), ak = kitFor('away');
    colors.home = visibleColor(hk, teamColors(H).primary);
    colors.away = visibleColor(ak, teamColors(A).primary);
    if (colorDistance(colors.home, colors.away) < 90) colors.away = [ak.trim, ak.number, ak.shorts].find((c) => c && colorDistance(c, colors.home) >= 90) || inkFor(colors.home);
    homeBar.style.setProperty('--c', colors.home);
    awayBar.style.setProperty('--c', colors.away);
  }

  function attach(m) {
    for (const f of unsub) try { f?.(); } catch (e) { /* */ }
    unsub = [];
    tracker?.dispose();
    match = m; tracker = null;
    if (!m) return;
    tracker = new StatsTracker(m);
    const ev = m.events;
    if (ev?.on) {
      unsub.push(ev.on('goal', (p) => onEvent('goal', p)));
      unsub.push(ev.on('card', (p) => onEvent('card', p)));
      unsub.push(ev.on('message', (p) => onEvent('message', p)));
      unsub.push(ev.on('shootoutKick', (p) => onEvent('shootoutKick', p)));
      unsub.push(ev.on('var', (p) => onEvent('var', p)));
    }
    autoEvents = true;
    lastScore = [0, 0];
    setupTeams();
  }
  let autoEvents = false;

  // ---------------------------------------------------------------- banners
  function pushBanner(b) {
    if (!getSettings().hud.eventBanners && !b.force) return;
    // collapse duplicates arriving in the same moment
    if (queue.some((q) => q.title === b.title && q.sub === b.sub)) return;
    queue.push(b);
    if (!bannerBusy) nextBanner();
  }
  function nextBanner() {
    const b = queue.shift();
    if (!b) { bannerBusy = false; return; }
    bannerBusy = true;
    const node = h('div.b', {},
      h('div.t', { class: b.tone ? `is-${b.tone}` : null }, b.title),
      h('div.s', { html: b.sub || b.meta ? `${b.sub ? `<b>${esc(b.sub)}</b>` : ''}${b.meta ? `<span>${esc(b.meta)}</span>` : ''}` : '' }));
    banner.innerHTML = '';
    banner.append(node);
    const dur = b.ms || 2200;
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => { node.remove(); nextBanner(); }, 340);
    }, dur);
  }

  let pendingGoal = null;
  let varCheck = null; // { logLen } while a VAR review runs
  function goalBanner(side, p, entry) {
    const t = teamFor(side);
    const scorer = entry?.scorer ? (typeof entry.scorer === 'string' ? entry.scorer : nameOf(entry.scorer)) : nameOf(p?.scorer);
    const own = entry ? entry.ownGoal : p?.ownGoal;
    const tag = own ? ' (OG)' : entry?.penalty ? ' (pen)' : '';
    pushBanner({ title: 'Goal', tone: 'accent', sub: scorer ? scorer + tag : t?.name, meta: `${t?.short || t?.name || ''} · ${entry?.minute || minuteLabel(match?.clock)}`, ms: 3200, force: true });
    ui.nav.pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: 300, strongMagnitude: 0.8, weakMagnitude: 0.5 }).catch?.(() => {});
  }
  function checkPendingGoal() {
    if (!pendingGoal || !match) return;
    const log = match.goalsLog || [];
    if (log.length > pendingGoal.logLen) {
      const e = log[log.length - 1];
      goalBanner(e.team || pendingGoal.side, pendingGoal.p, e);
      pendingGoal = null;
    } else if (!varCheck && performance.now() > pendingGoal.until) pendingGoal = null; // disallowed
  }

  function onEvent(name, p = {}) {
    if (name === 'goal') {
      if (match?.shootout?.active || match?.phase === 'shootout') return; // shootoutKick handles these
      const side = p.team?.id === 'away' || p.team?.index === 1 ? 'away' : 'home';
      if (Array.isArray(match?.goalsLog)) {
        // Wait for the rules to confirm the goal (they can disallow it) and use their minute label.
        pendingGoal = { side, p, logLen: match.goalsLog.length, until: performance.now() + 800 };
        return;
      }
      goalBanner(side, p, null);
    } else if (name === 'card') {
      const red = p.color === 'red';
      pushBanner({ title: red ? 'Red card' : 'Yellow card', tone: red ? 'red' : 'yellow', sub: nameOf(p.player), meta: p.reason || p.player?.team?.data?.short || '', ms: 2600 });
    } else if (name === 'message') {
      const k = p.kind || 'info';
      if (k === 'goal' || k === 'card' || k === 'var') return;
      if (k === 'offside') pushBanner({ title: 'Offside', sub: p.text && !/^offside!?$/i.test(p.text) ? p.text : '' });
      else if (k === 'foul') pushBanner({ title: 'Foul', sub: p.text && !/^foul!?$/i.test(p.text) ? p.text : '' });
      else if (k === 'advantage') pushBanner({ title: 'Advantage', ms: 1500 });
      else if (k === 'period') pushBanner({ title: p.text || 'Kick-off', ms: 2400, force: true });
      else if (k === 'added') pushBanner({ title: p.text || 'Added time', ms: 2000 });
      else pushBanner({ title: p.text || '', ms: 1800 });
    } else if (name === 'var') {
      if (p.state === 'checking') {
        varCheck = { logLen: match?.goalsLog?.length ?? 0 };
        pushBanner({ title: 'VAR check', tone: 'accent', sub: p.kind === 'offside' ? 'Possible offside' : (p.kind || ''), meta: nameOf(p.player), ms: 2800, force: true });
      } else if (p.state === 'stands') {
        const len = varCheck?.logLen ?? match?.goalsLog?.length ?? 0;
        varCheck = null;
        if (!pendingGoal) pendingGoal = { side: p.player?.team?.id === 'away' ? 'away' : 'home', p: { scorer: null }, logLen: len, until: performance.now() + 1500 };
        else pendingGoal.until = performance.now() + 1500;
      } else if (p.state === 'overturned') {
        varCheck = null; pendingGoal = null; // the rules' offside message explains it
      }
    } else if (name === 'shootoutKick') {
      const t = teamFor(p.team?.id === 'away' || p.team === 'away' || p.team?.index === 1 ? 'away' : 'home');
      pushBanner({ title: p.scored ? 'Scored' : p.saved ? 'Saved' : 'Missed', tone: p.scored ? 'accent' : null, sub: nameOf(p.taker), meta: t?.short || '', ms: 1500, force: true });
    } else if (name === 'banner') pushBanner(p);
  }

  // ---------------------------------------------------------------- radar
  const ctx2d = canvas.getContext('2d');
  function drawRadar(players, ball, activeId) {
    const W = canvas.width, H = canvas.height, pad = 14;
    const L = PITCH?.length || 105, Wd = PITCH?.width || 68;
    const sx = (W - pad * 2) / L, sz = (H - pad * 2) / Wd;
    const X = (x) => pad + (x + L / 2) * sx, Y = (z) => pad + (z + Wd / 2) * sz;
    const c = ctx2d;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 2;
    c.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    c.beginPath(); c.moveTo(W / 2, pad); c.lineTo(W / 2, H - pad); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 9.15 * sx, 0, Math.PI * 2); c.stroke();
    const bx = 16.5 * sx, bw = 40.32 * sz;
    c.strokeRect(pad, H / 2 - bw / 2, bx, bw); c.strokeRect(W - pad - bx, H / 2 - bw / 2, bx, bw);
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.fillRect(pad - 4, H / 2 - 3.66 * sz, 4, 7.32 * sz); c.fillRect(W - pad, H / 2 - 3.66 * sz, 4, 7.32 * sz);
    for (const p of players) {
      const side = p.team === 1 || p.team === 'away' ? 'away' : 'home';
      const x = X(p.x), y = Y(p.z ?? p.y ?? 0);
      const r = p.active ? 9 : 7;
      c.fillStyle = colors[side];
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 2;
      c.beginPath();
      if (p.gk) { c.rect(x - r + 1, y - r + 1, (r - 1) * 2, (r - 1) * 2); } else c.arc(x, y, r, 0, Math.PI * 2);
      c.fill(); c.stroke();
      if (p.active || (activeId != null && p.id === activeId)) {
        c.strokeStyle = '#fff'; c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, r + 5, 0, Math.PI * 2); c.stroke();
      }
    }
    if (ball) {
      const x = X(ball.x), y = Y(ball.z ?? ball.y ?? 0);
      c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }

  // ---------------------------------------------------------------- half-time panel
  let halftimeShown = false;
  function showHalftime() {
    halftimeShown = true;
    queue.length = 0;
    const sum = summarize(match, tracker);
    const canContinue = !!(match?.config?.halftimeWait && (ui.handlers.onContinue || match?.rules?.continueFromBreak));
    halftime.innerHTML = '';
    const label = match?.clock?.half >= 2 ? 'End of normal time' : 'Half-time';
    const panel = h('div.panel', {},
      h('div.cf-overline', { style: { marginBottom: '14px' } }, label),
      scorelineEl(sum),
      statsEl(sum, ['possession', 'shots', 'shotsOnTarget', 'passAccuracy', 'fouls']),
      canContinue ? h('div.cf-overline', { style: { marginTop: '18px', color: 'var(--ink)' } }, 'Press confirm to continue') : null);
    halftime.append(panel);
    halftime.hidden = false;
  }
  function hideHalftime() { halftimeShown = false; halftime.hidden = true; }

  // confirm during a break / replay skip
  window.addEventListener('keydown', (e) => {
    if (ui.mode !== 'match' || !match) return;
    if (match.replay?.active) { skipReplay(); return; }
    if (halftimeShown && (e.code === 'Enter' || e.code === 'Space' || (getSettings().controls.keyboard.pass || []).includes(e.code))) continueBreak();
  });
  let padPrev = false;
  function pollPadConfirm() {
    const pad = ui.nav.pad;
    const a = !!pad?.buttons?.[0]?.pressed;
    if (a && !padPrev && ui.mode === 'match' && match) {
      if (match.replay?.active) skipReplay();
      else if (halftimeShown) continueBreak();
    }
    padPrev = a;
  }
  function skipReplay() { if (ui.handlers.onSkipReplay) ui.handlers.onSkipReplay(); else match.rules?.skipReplay?.(); }
  function continueBreak() {
    if (!match?.config?.halftimeWait) return;
    if (ui.handlers.onContinue) ui.handlers.onContinue(); else match.rules?.continueFromBreak?.();
  }

  // ---------------------------------------------------------------- update
  function fmtClock(s) {
    s = Math.max(0, Math.floor(s || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function update(state = {}) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const m = ui.handlers.getMatch?.() || state.match || null;
    if (m !== match) attach(m);
    if (tracker && ui.mode === 'match') tracker.tick(dt);
    pollPadConfirm();
    checkPendingGoal();
    const S = getSettings();

    // score
    const hs = state.homeScore ?? match?.teams?.[0]?.score ?? 0;
    const as = state.awayScore ?? match?.teams?.[1]?.score ?? 0;
    if (hs !== lastScore[0] || as !== lastScore[1]) {
      score.classList.remove('goalflash'); void score.offsetWidth; score.classList.add('goalflash');
      lastScore = [hs, as];
    }
    homeScore.textContent = hs; awayScore.textContent = as;

    // clock
    const secs = state.clockSeconds ?? match?.clock?.seconds ?? 0;
    const ph = match?.shootout?.active || match?.shootout?.done ? 'shootout' : state.phase ?? match?.phase;
    clock.textContent = ph === 'halftime' ? (match?.clock?.half >= 2 ? 'FT' : 'HT') : ph === 'fulltime' ? 'FT' : ph === 'shootout' ? 'PENS' : fmtClock(secs);
    clock.hidden = !S.hud.clock;
    const addMin = state.addedTime ?? match?.clock?.addedTime ?? 0;
    const half = state.half ?? match?.clock?.half ?? 1;
    const regEnd = [0, 45, 90, 105, 120][half] ?? 90;
    added.hidden = !(addMin > 0 && secs >= (regEnd - 1) * 60) || ph === 'halftime' || ph === 'fulltime' || ph === 'shootout';
    added.textContent = `+${addMin}`;

    // chips: set piece, replay, shootout
    const chips = [];
    const sp = state.setPiece ?? match?.setPiece;
    const phase = state.phase ?? match?.phase;
    if (match?.replay?.active) chips.push(`<span class="cf-chip is-accent">Replay</span><span class="cf-chip">${esc(match.replay.title || '')} · any key to skip</span>`);
    else if (sp && sp.type && phase === 'setpiece' && sp.type !== 'kickoff') {
      const t = sp.team?.data || (sp.team === 'away' ? teamFor('away') : sp.team === 'home' ? teamFor('home') : null);
      chips.push(`<span class="cf-chip is-accent">${esc(SETPIECE_LABEL[sp.type] || sp.type)}</span>${t ? `<span class="cf-chip">${esc(t.short || t.name)}</span>` : ''}`);
    }
    const so = match?.shootout;
    if (so && (so.active || so.done) && so.kicks) {
      const dots = (arr, n) => { let s = ''; for (let i = 0; i < Math.max(5, n); i++) { const v = arr[i]; s += `<i style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-left:4px;background:${v === true ? 'var(--good)' : v === false ? 'var(--bad)' : 'rgba(255,255,255,.18)'}"></i>`; } return s; };
      const n = Math.max(so.kicks.home.length, so.kicks.away.length);
      chips.push(`<span class="cf-chip">${esc(homeName.textContent)}${dots(so.kicks.home, n)}</span><span class="cf-chip">${esc(awayName.textContent)}${dots(so.kicks.away, n)}</span>`);
    }
    if (varCheck) chips.unshift('<span class="cf-chip is-accent">VAR</span><span class="cf-chip">Checking goal</span>');
    if (ui.mentality && ui.mentality !== 'balanced') chips.push(`<span class="cf-chip">${ui.mentality === 'attacking' ? '▲ Attacking' : '▼ Defensive'}</span>`);
    const chipHTML = chips.join('');
    if (sub.innerHTML !== chipHTML) sub.innerHTML = chipHTML;

    // controlled player
    const ap = state.activePlayer;
    playercard.hidden = !ap;
    if (ap) {
      const side = ap.team === 'away' || ap.team === 1 ? 'away' : ap.team === 'home' || ap.team === 0 ? 'home' : (config?.controlledSide === 'away' ? 'away' : 'home');
      const kc = colors[side];
      pcNum.style.setProperty('--c', kc); pcNum.style.setProperty('--ci', inkFor(kc));
      pcNum.textContent = ap.number ?? '';
      pcName.textContent = ap.name || '';
      pcPos.textContent = ap.pos || '';
      let st = ap.stamina ?? 1; if (st > 1) st /= 100;
      stamina.style.width = `${Math.max(0, Math.min(1, st)) * 100}%`;
      meter.classList.toggle('is-low', st < 0.45 && st >= 0.2);
      meter.classList.toggle('is-empty', st < 0.2);
    }

    // power bar
    const pw = state.power;
    power.classList.toggle('is-visible', !!(pw && pw.visible));
    if (pw) powerLabel.textContent = { pass: 'Pass', shoot: 'Shot', lob: 'Lob', through: 'Through ball', cross: 'Cross' }[pw.action] || '';
    if (pw) powerFill.style.setProperty('--p', `${Math.max(0, Math.min(1, pw.value || 0)) * 100}%`);

    // radar
    radar.hidden = S.hud.radar === 'off';
    if (!radar.hidden) {
      let players = state.players, ball = state.ball;
      if (!players && match?.players) {
        players = match.players.filter((p) => !p.sentOff).map((p) => ({ x: p.pos.x, z: p.pos.z, team: p.team?.id, gk: p.isGK, active: p === state.activePlayer?.ref || (state.activePlayer?.id != null && p.id === state.activePlayer.id) }));
      }
      if (!ball && match?.ball?.pos) ball = { x: match.ball.pos.x, z: match.ball.pos.z };
      drawRadar(players || [], ball);
    }

    // legacy single-message channel
    const msg = state.message;
    if (msg && msg.text && msg.id !== lastMessageId) { lastMessageId = msg.id ?? msg.text + now; if (!autoEvents) onEvent('message', msg); }

    // half-time / break panel
    if (phase !== lastPhase) {
      if (phase === 'halftime') showHalftime(); else if (halftimeShown) hideHalftime();
      lastPhase = phase;
    }

    // fps
    fps.hidden = !S.graphics.showFps;
    if (!fps.hidden) {
      fpsAcc += dt; fpsFrames++;
      if (fpsAcc > 0.5) { fps.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS`; fpsAcc = 0; fpsFrames = 0; }
    }
  }

  return {
    el,
    start(cfg) {
      config = cfg;
      attach(null);
      queue.length = 0; banner.innerHTML = ''; bannerBusy = false;
      hideHalftime(); lastPhase = null; lastScore = [0, 0]; pendingGoal = null; varCheck = null;
      setupTeams();
      el.classList.add('is-active');
    },
    show() { el.classList.add('is-active'); },
    hide() { el.classList.remove('is-active'); hideHalftime(); },
    update,
    onEvent(name, payload) { if (!autoEvents || name === 'banner') onEvent(name, payload); },
    banner: (title, sub, opts = {}) => pushBanner({ title, sub, ...opts }),
    summary: () => (match ? summarize(match, tracker) : null),
    completeSummary(s) {
      if (s && s.teams) return summarize(s, tracker);
      if (!s && match) return summarize(match, tracker);
      if (s && match) {
        const base = summarize(match, tracker);
        return { ...base, ...s, home: { ...base.home, ...(s.home || {}), stats: { ...base.home.stats, ...(s.home?.stats || {}) } }, away: { ...base.away, ...(s.away || {}), stats: { ...base.away.stats, ...(s.away?.stats || {}) } } };
      }
      return s;
    },
    get tracker() { return tracker; },
  };
}
