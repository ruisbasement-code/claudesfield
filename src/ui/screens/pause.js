import { h } from '../dom.js';
import { sfx } from '../sound.js';
import { scorelineEl, scorersEl, statsEl } from './common.js';

export function pauseScreen(ui) {
  const side = h('div.cf-pause-side');
  const menu = h('nav.cf-pause-menu');
  const minute = h('div.cf-overline');
  const items = [
    ['resume', 'Resume'],
    ['restart', 'Restart match'],
    ['settings', 'Settings'],
    ['controls', 'Controls'],
    ['quit', 'Quit match'],
  ];
  for (const [id, label] of items) {
    const b = h('button.cf-item', { nav: true, 'data-id': id }, label);
    b.addEventListener('click', () => { sfx.select(); act(id); });
    menu.append(b);
  }
  const el = h('section.cf-screen', {},
    h('div.cf-scrim'),
    h('div.cf-pause-inner', {},
      h('div', {}, minute, h('h1.cf-h1', { style: { marginTop: '12px' } }, 'Paused'), menu),
      side),
    ui.hints([{ key: 'confirm', label: 'Select' }, { key: 'back', label: 'Resume' }]));
  el.style.zIndex = 5;

  async function act(id) {
    if (id === 'resume') ui.resume();
    else if (id === 'settings') ui.openSettings({ from: 'pause' });
    else if (id === 'controls') ui.openSettings({ from: 'pause', tab: 'controls' });
    else if (id === 'restart') {
      const ok = await ui.dialog('Restart match', 'Start this fixture again from kick-off? The current score will be lost.', [{ label: 'Cancel', value: false }, { label: 'Restart', value: true, primary: true }]);
      if (ok) ui.restart();
    } else if (id === 'quit') {
      const ok = await ui.dialog('Quit match', 'Leave this match and return to the main menu?', [{ label: 'Stay', value: false }, { label: 'Quit', value: true, primary: true }]);
      if (ok) ui.quit();
    }
  }

  function renderSide() {
    side.innerHTML = '';
    const sum = ui.hud.summary();
    if (!sum || !sum.home) return;
    minute.textContent = sum.minute ? `Match paused · ${sum.minute}` : 'Match paused';
    side.append(scorelineEl(sum), scorersEl(sum), statsEl(sum, ['possession', 'shots', 'shotsOnTarget', 'passAccuracy', 'tackles', 'fouls', 'corners']));
  }

  return {
    el,
    show() {
      renderSide();
      ui.nav.set({ el, initial: '[data-id="resume"]', wrap: true, onBack: () => ui.resume(), onStart: () => ui.resume() });
    },
  };
}
