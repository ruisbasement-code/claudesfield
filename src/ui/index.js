// UI entry point. createUI(root, handlers) builds every screen as a DOM overlay above the canvas.
//
// handlers (all optional):
//   onStartMatch(config)  config = { mode:'match'|'shootout', homeId, awayId, homeKit:'home'|'away',
//                                    awayKit, difficulty, halfMinutes, controlledSide:'home'|'away'|'none',
//                                    timeOfDay:'day'|'evening'|'night', weather:'clear'|'overcast'|'rain' }
//   onPause()             game should freeze (match.paused = true)
//   onResume()
//   onRestart()           restart the same fixture
//   onQuitToMenu()        tear the match down; UI returns to the title screen by itself
//   getSummary()          -> summary (see result.js) used by the pause screen's live stats
//
// returns { showTitle(), showMenu(), pause(), resume(), showResult(summary), toast(text),
//           hud: { update(state), onEvent(name, payload), show(), hide() }, settings, nav, get mode() }
import './styles.css';
import { Nav } from './nav.js';
import { h } from './dom.js';
import { sfx } from './sound.js';
import { getSettings, onSettingsChange } from './settings.js';
import { buttonLabel, padStyle } from './labels.js';
import { titleScreen } from './screens/title.js';
import { setupScreen } from './screens/setup.js';
import { settingsScreen } from './screens/settings.js';
import { pauseScreen } from './screens/pause.js';
import { resultScreen } from './screens/result.js';
import { createHUD } from './screens/hud.js';

export function createUI(mount, handlers = {}) {
  const root = h('div.cf-root');
  mount.append(root);
  const nav = new Nav();
  const toasts = h('div.cf-toasts');

  const ui = {
    root, nav, handlers,
    mode: 'menu',            // 'menu' | 'match' | 'paused' | 'result'
    lastConfig: null,
    screens: {},
    hintBars: new Set(),
  };

  // ---------- footer hints that swap glyphs between keyboard and gamepad
  ui.hints = (items) => {
    const bar = h('div.cf-hints');
    bar.items = items;
    ui.hintBars.add(bar);
    renderHints(bar);
    return bar;
  };
  function glyph(kind) {
    const pad = nav.inputMode === 'gamepad';
    const style = padStyle(nav.pad?.id);
    const G = (t, cls = '') => `<span class="cf-glyph ${cls}">${t}</span>`;
    const face = (i) => {
      const colors = style === 'ps' ? { 0: '#7aa7e6', 1: '#e86a5f', 2: '#d88fc8', 3: '#5cc9a7' } : { 0: '#5dbb46', 1: '#e0463c', 2: '#3d7fd9', 3: '#f2c230' };
      const sym = style === 'ps' ? ['✕', '○', '□', '△'][i] : buttonLabel(i);
      return `<span class="cf-glyph is-pad" style="background:${colors[i]}">${sym}</span>`;
    };
    if (kind === 'confirm') return pad ? face(0) : G('Enter');
    if (kind === 'back') return pad ? face(1) : G('Esc');
    if (kind === 'tabs') return pad ? G(buttonLabel(4, style), 'is-pad is-wide') + G(buttonLabel(5, style), 'is-pad is-wide') : G('Q') + G('E');
    if (kind === 'adjust') return pad ? G('◀ ▶') : G('←') + G('→');
    if (kind === 'clear') return G('Del');
    return '';
  }
  function renderHints(bar) {
    bar.innerHTML = '';
    for (const it of bar.items) {
      if (it.grow) { bar.append(h('span.cf-grow')); continue; }
      if (it.text) { bar.append(h('span', {}, it.text)); continue; }
      bar.append(h('span.cf-hint', { html: `${glyph(it.key)} ${it.label}` }));
    }
  }
  nav.onInputMode = () => { for (const b of ui.hintBars) renderHints(b); ui.screens.settings?.onInputMode?.(); };

  ui.toast = (text, ms = 2600) => {
    const t = h('div.cf-toast', {}, text);
    toasts.append(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
  };

  /** Modal confirm. buttons: [{label, primary?, value}] -> Promise<value|null> */
  ui.dialog = (title, text, buttons) => new Promise((resolve) => {
    const box = h('div.cf-dialog-box', {}, h('div.cf-overline', {}, 'Confirm'), h('h2.cf-h2', { style: { marginTop: '10px' } }, title), h('p', {}, text));
    const actions = h('div.cf-dialog-actions');
    const wrap = h('div.cf-dialog', {}, h('div.cf-scrim'), box);
    let ctx;
    const done = (v) => { nav.pop(ctx); wrap.remove(); resolve(v); };
    for (const b of buttons) {
      const el = h('button.cf-btn', { nav: true, class: b.primary ? 'is-primary' : null }, b.label);
      el.addEventListener('click', () => { sfx.select(); done(b.value); });
      actions.append(el);
    }
    box.append(actions);
    root.append(wrap);
    ctx = nav.push({ el: wrap, onBack: () => done(null), initial: actions.lastElementChild });
  });

  // ---------- screens
  ui.screens.title = titleScreen(ui);
  ui.screens.setup = setupScreen(ui);
  ui.screens.settings = settingsScreen(ui);
  ui.screens.pause = pauseScreen(ui);
  ui.screens.result = resultScreen(ui);
  ui.hud = createHUD(ui);
  for (const s of Object.values(ui.screens)) root.append(s.el);
  root.insertBefore(ui.hud.el, root.firstChild);
  root.append(toasts);

  let current = null;
  ui.show = (name, params) => {
    if (current && current !== ui.screens[name]) current.el.classList.remove('is-active');
    current = ui.screens[name];
    current.el.classList.add('is-active');
    current.show?.(params);
  };
  ui.hideAll = () => { if (current) current.el.classList.remove('is-active'); current = null; nav.clear(); };

  // ---------- flow
  ui.showTitle = () => { ui.mode = 'menu'; ui.hud.hide(); ui.show('title'); };
  ui.showMenu = ui.showTitle;
  ui.openSetup = (mode = 'match') => ui.show('setup', { mode });
  ui.openSettings = (opts = {}) => ui.show('settings', opts);

  ui.startMatch = (config) => {
    ui.lastConfig = config;
    ui.mode = 'match';
    ui.mentality = 'balanced';
    ui.hideAll();
    ui.hud.start(config);
    sfx.start();
    handlers.onStartMatch?.(config);
  };

  ui.pause = () => {
    if (ui.mode !== 'match') return;
    ui.mode = 'paused';
    handlers.onPause?.();
    ui.show('pause');
  };
  ui.resume = () => {
    if (ui.mode !== 'paused') return;
    ui.hideAll();
    ui.mode = 'match';
    handlers.onResume?.();
  };
  ui.restart = () => {
    ui.hideAll();
    ui.mode = 'match';
    ui.mentality = 'balanced';
    ui.hud.start(ui.lastConfig);
    if (handlers.onRestart) handlers.onRestart();
    else handlers.onStartMatch?.(ui.lastConfig);
  };
  ui.quit = () => {
    ui.hud.hide();
    handlers.onQuitToMenu?.();
    ui.showTitle();
  };
  ui.showResult = (summary) => {
    ui.mode = 'result';
    ui.show('result', ui.hud.completeSummary(summary));
  };

  // Team mentality (tactics) for the human side: defensive / balanced / attacking.
  const MENTALITIES = ['balanced', 'attacking', 'defensive'];
  ui.mentality = 'balanced';
  ui.humanTeamAI = () => {
    const m = handlers.getMatch?.();
    const side = ui.lastConfig?.controlledSide;
    if (!m || (side !== 'home' && side !== 'away')) return null;
    return m.ai?.[side === 'home' ? 0 : 1] || null;
  };
  ui.setMentality = (v, announce = true) => {
    const ai = ui.humanTeamAI();
    if (!ai?.setMentality) return false;
    ui.mentality = v;
    ai.setMentality(v === 'balanced' ? null : v);
    if (announce) ui.hud.banner('Mentality', v.charAt(0).toUpperCase() + v.slice(1), { ms: 1300, force: true });
    return true;
  };
  const cycleMentality = () => ui.setMentality(MENTALITIES[(MENTALITIES.indexOf(ui.mentality) + 1) % MENTALITIES.length]);

  // In-match: the pause binding (keyboard or gamepad) opens the pause menu.
  nav.onIdleKey = (e) => {
    if (ui.mode !== 'match' || e.repeat) return;
    const kb = getSettings().controls.keyboard;
    if ((kb.pause || []).includes(e.code)) { e.preventDefault(); ui.pause(); }
    else if ((kb.mentality || []).includes(e.code)) cycleMentality();
  };
  nav.onIdlePad = (i) => {
    if (ui.mode !== 'match') return;
    const gp = getSettings().controls.gamepad;
    if (i === gp.pause || i === 9) ui.pause();
    else if (i === gp.mentality) cycleMentality();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && ui.mode === 'match') ui.pause(); });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  const applyHudScale = () => root.style.setProperty('--hud-scale', getSettings().hud.scale);
  onSettingsChange(applyHudScale);
  applyHudScale();

  ui.showTitle();

  return {
    showTitle: ui.showTitle,
    showMenu: ui.showMenu,
    pause: ui.pause,
    resume: ui.resume,
    showResult: ui.showResult,
    startMatch: ui.startMatch,
    /** Call with true once the renderer draws a live stadium behind the title screen. */
    setLiveBackground: (on) => root.classList.toggle('has-live-bg', !!on),
    openSetup: ui.openSetup,
    openSettings: ui.openSettings,
    toast: ui.toast,
    hud: ui.hud,
    nav,
    get mode() { return ui.mode; },
    get config() { return ui.lastConfig; },
  };
}
