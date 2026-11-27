// Match setup: pick clubs, kits, who you control, difficulty and match length.
import { h, selectRow, button } from '../dom.js';
import { crestSVG, kitSVG, starsSVG, teamColors, colorDistance } from '../art.js';
import { sfx } from '../sound.js';
import { TEAMS } from '../../data/teams.js';
import { FORMATION_NAMES } from '../../ai/formations.js';
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../core/constants.js';
import { getSettings, setSetting, DIFFICULTY_BLURBS } from '../settings.js';

export const teamRating = (t) => t.rating || t.ratings || { att: 0, mid: 0, def: 0, ovr: 0 };
export const teamStars = (t) => Math.max(0.5, Math.min(5, Math.round(((teamRating(t).ovr - 62) / 24) * 10) / 2));
const playerOvr = (p) => p.overall ?? p.ovr ?? 0;
const playerName = (p) => p.short || p.name || '';

const HALF_LENGTHS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 45];
const SIDES = ['home', 'none', 'away'];

/** Choose kits so the two shirts are easy to tell apart. */
export function resolveKits(home, away, homeKit = 'home') {
  const hs = home.kits?.[homeKit]?.shirt || '#fff';
  const opts = ['home', 'away'].filter((k) => away.kits?.[k]);
  let best = opts[0], bestD = -1;
  for (const k of opts) {
    const d = colorDistance(hs, away.kits[k].shirt) + (k === 'home' ? 40 : 0); // prefer home kit when fine
    if (d > bestD) { bestD = d; best = k; }
  }
  return best;
}

export function setupScreen(ui) {
  const state = {
    mode: 'match',
    home: 0, away: 1,
    homeKit: 'home', awayKit: 'away',
    side: 'home',
    timeOfDay: 'evening',
    weather: 'clear',
    extraTime: false,
    penalties: true,
    referee: 'normal',
    formation: { home: null, away: null }, // null = club default
  };
  const formationOf = (side) => state.formation[side] || TEAMS[state[side]].formation;
  const mySide = () => (state.side === 'away' ? 'away' : 'home');

  const title = h('h1.cf-h1', {}, 'Kick Off');
  const overline = h('div.cf-overline', {}, 'Exhibition · Match setup');

  // ---- team cards
  function teamCard(which) {
    const card = h('div.cf-teamcard');
    const sideLabel = h('div.cf-overline', {}, which === 'home' ? 'Home' : 'Away');
    const randomBtn = h('button.cf-overline', { style: { cursor: 'pointer' } }, 'Random');
    const head = h('div.cf-teamhead');
    const pick = h('div.cf-teampick', { nav: true },
      h('button.cf-arrow', { tabindex: -1, html: '&#9664;', onclick: (e) => { e.stopPropagation(); change(-1); sfx.change(); } }),
      head,
      h('button.cf-arrow', { tabindex: -1, html: '&#9654;', onclick: (e) => { e.stopPropagation(); change(1); sfx.change(); } }));
    pick.cfAdjust = (d) => change(d);
    pick.cfActivate = () => change(1);
    randomBtn.addEventListener('click', () => {
      const other = state[which === 'home' ? 'away' : 'home'];
      let i; do { i = Math.floor(Math.random() * TEAMS.length); } while (i === other && TEAMS.length > 1);
      state[which] = i; autoKits(which); render(); sfx.change();
    });
    const ratings = h('div.cf-ratings');
    const kits = h('div.cf-kits');
    const lineup = h('div.cf-lineup');
    card.append(h('div.cf-side', {}, sideLabel, randomBtn), pick, ratings,
      h('div.cf-kitrow', {},
        h('div', {}, h('div.cf-overline', { style: { marginBottom: '10px' } }, 'Kit'), kits),
        h('div.cf-keyplayers', {}, h('div.cf-overline', { style: { marginBottom: '6px' } }, 'Key players'), lineup)));

    function change(d) {
      const other = state[which === 'home' ? 'away' : 'home'];
      let i = state[which];
      do { i = (i + d + TEAMS.length) % TEAMS.length; } while (i === other && TEAMS.length > 1);
      state[which] = i;
      state.formation[which] = null;
      autoKits(which);
      render();
      formRow?.render();
    }

    function render() {
      const t = TEAMS[state[which]];
      const r = teamRating(t);
      card.style.setProperty('--team', teamColors(t).primary);
      head.innerHTML = '';
      head.append(
        h('div', { html: crestSVG(t) }).firstChild,
        h('div', { style: { minWidth: 0 } },
          h('div.cf-teamname', {}, t.name),
          h('div.cf-teamcity', {}, `${t.city || ''} · ${formationOf(which)}`),
          h('div.cf-stars', { html: starsSVG(teamStars(t)) })));
      ratings.innerHTML = '';
      for (const [k, lbl] of [['ovr', 'OVR'], ['att', 'ATT'], ['mid', 'MID'], ['def', 'DEF']]) {
        ratings.append(h('div.cf-rating', {}, h('b', {}, r[k] ?? '–'), h('span', {}, lbl)));
      }
      kits.innerHTML = '';
      for (const k of ['home', 'away']) {
        if (!t.kits?.[k]) continue;
        const sel = state[which + 'Kit'] === k;
        const b = h('button.cf-kit', { nav: true, class: sel ? 'is-selected' : null, html: kitSVG(t.kits[k]) }, k);
        b.addEventListener('click', () => {
          state[which + 'Kit'] = k;
          if (which === 'home') autoKits('home');
          sfx.change(); renderAll();
          const again = kits.querySelector(`[data-kit="${k}"]`);
          if (again && ui.nav.top) { ui.nav.top.focused = null; ui.nav.focus(again, { silent: true }); }
        });
        b.setAttribute('data-kit', k);
        kits.append(b);
      }
      lineup.innerHTML = '';
      const top = (t.players || []).slice(0, 11).sort((a, b) => playerOvr(b) - playerOvr(a)).slice(0, 3);
      for (const p of top) {
        lineup.append(h('div', {}, h('span.pos', {}, p.pos), h('span.num', {}, p.number ?? ''), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, playerName(p)), h('span.ovr', {}, playerOvr(p))));
      }
    }
    card.render = render;
    return card;
  }

  function autoKits(changed) {
    const H = TEAMS[state.home], A = TEAMS[state.away];
    if (changed === 'home' && !H.kits?.[state.homeKit]) state.homeKit = 'home';
    state.awayKit = resolveKits(H, A, state.homeKit);
  }

  const homeCard = teamCard('home');
  const awayCard = teamCard('away');

  // ---- controller side picker
  const pad = h('div.cf-pad', {}, 'You');
  const caption = h('div.cf-sidecaption');
  const sidepick = h('div.cf-sidepick', { nav: true },
    h('div.cf-overline', {}, 'Controller'),
    h('div.cf-sidebar', {}, h('i'), h('i'), h('i'), pad),
    caption);
  sidepick.cfAdjust = (d) => { const i = Math.max(0, Math.min(2, SIDES.indexOf(state.side) + d)); state.side = SIDES[i]; renderSide(); };
  sidepick.cfActivate = () => { const i = (SIDES.indexOf(state.side) + 1) % 3; state.side = SIDES[i]; renderSide(); sfx.change(); };
  sidepick.addEventListener('click', (e) => {
    const r = sidepick.querySelector('.cf-sidebar').getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return;
    state.side = SIDES[Math.max(0, Math.min(2, Math.floor(((e.clientX - r.left) / r.width) * 3)))]; renderSide(); sfx.change();
  });
  function renderSide() {
    formRow?.render();
    const i = SIDES.indexOf(state.side);
    pad.style.left = `calc(${i * 33.333}% + 5px)`;
    pad.textContent = state.side === 'none' ? 'CPU' : 'You';
    caption.textContent = state.side === 'none' ? 'Watch the AI play itself' : `You control ${TEAMS[state[state.side]].short || TEAMS[state[state.side]].name}`;
  }
  const versus = h('div.cf-versus', {}, h('div.vs', {}, 'VS'), sidepick);

  // ---- options
  const g = () => getSettings().gameplay;
  const diffRow = selectRow({
    label: 'Difficulty', pips: true, wrap: false,
    options: DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })),
    get: () => g().difficulty, set: (v) => setSetting('gameplay.difficulty', v),
  });
  const halfRow = selectRow({
    label: 'Half length', wrap: false,
    options: HALF_LENGTHS.map((m) => ({ value: m, label: `${m} min` })),
    get: () => g().halfMinutes, set: (v) => setSetting('gameplay.halfMinutes', v),
  });
  const todRow = selectRow({
    label: 'Kick-off time',
    options: [{ value: 'day', label: 'Afternoon' }, { value: 'evening', label: 'Evening' }, { value: 'night', label: 'Night' }],
    get: () => state.timeOfDay, set: (v) => { state.timeOfDay = v; },
  });
  const weatherRow = selectRow({
    label: 'Weather',
    options: [{ value: 'clear', label: 'Clear' }, { value: 'overcast', label: 'Overcast' }, { value: 'rain', label: 'Rain' }],
    get: () => state.weather, set: (v) => { state.weather = v; },
  });
  const diffBlurb = h('div', { style: { padding: '10px 18px 0', color: 'var(--muted)', fontSize: '14px', minHeight: '28px' } });
  const updBlurb = () => { diffBlurb.textContent = DIFFICULTY_BLURBS[g().difficulty] || ''; };
  const origDiffAdjust = diffRow.cfAdjust;
  diffRow.cfAdjust = (d) => { origDiffAdjust(d); updBlurb(); };

  const extraRow = selectRow({
    label: 'If level at full time',
    options: [{ value: 'none', label: 'Draw' }, { value: 'pens', label: 'Penalties' }, { value: 'et', label: 'Extra time + pens' }],
    get: () => (state.extraTime ? 'et' : state.penalties ? 'pens' : 'none'),
    set: (v) => { state.extraTime = v === 'et'; state.penalties = v !== 'none'; },
  });
  const formRow = selectRow({
    label: 'Your formation',
    options: (FORMATION_NAMES || []).map((f) => ({ value: f, label: f })),
    get: () => formationOf(mySide()),
    set: (v) => { state.formation[mySide()] = v; (mySide() === 'home' ? homeCard : awayCard).render(); },
    help: 'Shape your team lines up in. The AI uses it for positioning and runs.',
  });
  const refRow = selectRow({
    label: 'Referee',
    options: [{ value: 'lenient', label: 'Lenient' }, { value: 'normal', label: 'Normal' }, { value: 'strict', label: 'Strict' }],
    get: () => state.referee, set: (v) => { state.referee = v; },
  });

  const options = h('div.cf-setup-options', {},
    h('div', {}, diffRow, halfRow, extraRow, diffBlurb),
    h('div', {}, formRow, refRow, todRow, weatherRow));

  const playBtn = button('Play match', { primary: true, onClick: () => ui.startMatch(buildFromState()) });
  const backBtn = button('Back', { onClick: () => ui.showTitle() });
  const actions = h('div.cf-setup-actions', {}, backBtn, playBtn);

  const el = h('section.cf-screen.is-solid', {},
    h('header.cf-topbar', {}, h('div.cf-crumbs', {}, overline, title)),
    h('div.cf-setup-body', {}, homeCard, versus, awayCard),
    options, actions,
    ui.hints([{ key: 'adjust', label: 'Change' }, { key: 'confirm', label: 'Select' }, { key: 'back', label: 'Back' }]));

  function renderAll() { homeCard.render(); awayCard.render(); renderSide(); updBlurb(); diffRow.render(); halfRow.render(); }

  function buildConfig({ mode, home, away, homeKit = 'home', awayKit, side = 'home', difficulty, halfMinutes, timeOfDay = 'evening', weather = 'clear',
    extraTime = false, penalties = false, referee = 'normal', formations = null }) {
    const gp = g();
    return {
      mode: mode === 'shootout' || mode === 'penalties' ? 'penalties' : 'match',
      extraTime, penalties, referee,
      offside: gp.offside, fouls: gp.fouls, cards: gp.cards, injuries: gp.injuries, advantage: true,
      passAssist: gp.passAssist, shotAssist: gp.shotAssist, autoSwitch: gp.autoSwitch !== 'off', autoSwitchMode: gp.autoSwitch,
      replays: getSettings().camera.replays,
      halftimeWait: !!ui.handlers.getMatch || !!ui.handlers.onContinue,
      homeId: home.id, awayId: away.id,
      homeKit, awayKit: awayKit || resolveKits(home, away, homeKit),
      controlledSide: side,
      humanSide: side,
      difficulty: difficulty ?? g().difficulty,
      halfMinutes: halfMinutes ?? g().halfMinutes,
      timeOfDay, weather,
      // Convenience for consumers that want the data without importing teams:
      home, away,
      homeData: formations?.home && formations.home !== home.formation ? { ...home, formation: formations.home } : home,
      awayData: formations?.away && formations.away !== away.formation ? { ...away, formation: formations.away } : away,
      homeKitData: home.kits?.[homeKit], awayKitData: away.kits?.[awayKit || resolveKits(home, away, homeKit)],
    };
  }
  function buildFromState() {
    return buildConfig({
      mode: state.mode, home: TEAMS[state.home], away: TEAMS[state.away], homeKit: state.homeKit, awayKit: state.awayKit,
      side: state.side, timeOfDay: state.timeOfDay, weather: state.weather,
      extraTime: state.extraTime, penalties: state.penalties, referee: state.referee,
      formations: { home: formationOf('home'), away: formationOf('away') },
    });
  }

  return {
    el,
    buildConfig,
    show({ mode = 'match' } = {}) {
      state.mode = mode;
      if (state.home === state.away) state.away = (state.home + 1) % TEAMS.length;
      title.textContent = mode === 'shootout' ? 'Penalty Shootout' : 'Kick Off';
      overline.textContent = mode === 'shootout' ? 'Sudden death · Setup' : 'Exhibition · Match setup';
      halfRow.hidden = mode === 'shootout';
      extraRow.hidden = mode === 'shootout';
      formRow.hidden = mode === 'shootout';
      todRow.hidden = false;
      playBtn.textContent = mode === 'shootout' ? 'Take penalties' : 'Play match';
      autoKits('home');
      renderAll();
      ui.nav.set({ el, initial: playBtn, onBack: () => ui.showTitle() });
    },
  };
}
