import { h } from '../dom.js';
import { pitchLinesSVG } from '../art.js';
import { sfx } from '../sound.js';
import { TEAMS } from '../../data/teams.js';
import { getSettings } from '../settings.js';

const ITEMS = [
  { id: 'kickoff', label: 'Kick Off', note: 'Exhibition', help: 'Pick two clubs, kits and the AI difficulty, then play a full match with fouls, cards, offside and set pieces.' },
  { id: 'quick', label: 'Quick Match', note: 'Random teams', help: 'Straight onto the pitch with two random clubs and your saved match settings.' },
  { id: 'shootout', label: 'Penalty Shootout', note: 'Sudden death', help: 'Five kicks each, then sudden death. Aim, hold to power, release to strike.' },
  { id: 'settings', label: 'Settings', note: 'Game · Camera · Audio', help: 'Gameplay rules, camera, audio, graphics quality and HUD layout. Everything saves automatically.' },
  { id: 'controls', label: 'Controls', note: 'Keyboard · Gamepad', help: 'Rebind every action for keyboard and gamepad. Attacking and defending actions can share a button.' },
];

export function titleScreen(ui) {
  const helpTitle = h('h3');
  helpTitle.style.cssText = 'margin:10px 0 0;font:700 26px/1 var(--cond);text-transform:uppercase';
  const helpText = h('p');
  const aside = h('div.cf-title-aside', {}, h('div.cf-overline', {}, 'Selected'), helpTitle, helpText);

  const menu = h('nav.cf-mainmenu');
  for (const it of ITEMS) {
    const b = h('button.cf-item', { nav: true, 'data-id': it.id }, it.label, h('small', {}, it.note));
    b.cfHelp = it;
    b.addEventListener('click', () => { sfx.select(); choose(it.id); });
    menu.append(b);
  }

  const press = h('div.cf-press', {}, 'Press any key');
  const hints = ui.hints([{ key: 'confirm', label: 'Select' }, { grow: true }, { text: 'v0.1 · Fictional clubs, real football' }]);

  const el = h('section.cf-screen.cf-title', {},
    h('div.cf-backdrop', {}, h('div.cf-pitch3d', { html: pitchLinesSVG() }), h('div.cf-grain')),
    h('div.cf-title-inner', {},
      h('header.cf-wordmark', {},
        h('div.cf-overline', {}, 'Association Football'),
        h('h1.cf-mark', { html: 'Claudes<span>field</span>' })),
      press, menu, aside, hints));

  let awake = false;
  const wake = (e) => {
    if (awake || !el.classList.contains('is-active')) return;
    if (e && e.type === 'keydown' && ['F5', 'F11', 'F12'].includes(e.code)) return;
    awake = true;
    sfx.unlock(); sfx.select();
    // Defer so the waking key/click doesn't also activate the first menu item.
    setTimeout(reveal, 0);
  };
  window.addEventListener('keydown', wake);
  window.addEventListener('pointerdown', wake);
  const padWake = () => {
    if (awake) return;
    if (el.classList.contains('is-active')) {
      for (const p of navigator.getGamepads?.() || []) if (p && p.buttons.some((b) => b.pressed)) { wake(); break; }
    }
    requestAnimationFrame(padWake);
  };
  requestAnimationFrame(padWake);

  function reveal() {
    press.hidden = true; menu.hidden = false; aside.hidden = false; hints.hidden = false;
    ui.nav.set({
      el, initial: '[data-id="kickoff"]', wrap: true,
      onFocus: (b) => { helpTitle.textContent = b.cfHelp.label; helpText.textContent = b.cfHelp.help; },
    });
  }

  function choose(id) {
    if (id === 'kickoff') ui.openSetup('match');
    else if (id === 'shootout') ui.openSetup('shootout');
    else if (id === 'settings') ui.openSettings({ from: 'title' });
    else if (id === 'controls') ui.openSettings({ from: 'title', tab: 'controls' });
    else if (id === 'quick') {
      const a = Math.floor(Math.random() * TEAMS.length);
      let b = Math.floor(Math.random() * (TEAMS.length - 1)); if (b >= a) b++;
      const g = getSettings().gameplay;
      ui.startMatch(ui.screens.setup.buildConfig({ mode: 'match', home: TEAMS[a], away: TEAMS[b], difficulty: g.difficulty, halfMinutes: g.halfMinutes }));
    }
  }

  return {
    el,
    show() {
      if (!awake) { press.hidden = false; menu.hidden = true; aside.hidden = true; hints.hidden = true; ui.nav.clear(); }
      else reveal();
    },
  };
}
