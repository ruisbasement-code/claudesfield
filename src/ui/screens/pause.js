import { h, selectRow } from '../dom.js';
import { sfx } from '../sound.js';
import { scorelineEl, scorersEl, statsEl } from './common.js';
import { getSettings } from '../settings.js';
import { keyLabel, buttonLabel, padStyle } from '../labels.js';

const QUICK = [['pass', 'Pass'], ['contain', 'Contain'], ['through', 'Through'], ['tackle', 'Tackle'], ['lob', 'Lob / Cross'], ['slide', 'Slide'], ['shoot', 'Shoot'], ['jockey', 'Jockey'], ['finesse', 'Finesse mod'], ['switch', 'Switch'], ['chip', 'Chip mod'], ['teamContain', 'Team press'], ['sprint', 'Sprint'], ['shield', 'Shield'], ['skill', 'Skills'], ['tacticsAttack', 'Tactics']];

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
  const tactics = selectRow({
    label: 'Mentality',
    options: [{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }],
    get: () => ui.mentality, set: (v) => ui.setMentality(v, false), wrap: false,
  });
  tactics.style.marginTop = '28px';
  const quick = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', columnGap: '20px', marginTop: '22px', fontSize: '13px', color: 'var(--ink-2)' } });
  function renderQuick() {
    const pad = ui.nav.inputMode === 'gamepad';
    const c = getSettings().controls;
    const style = padStyle(ui.nav.pad?.id);
    quick.innerHTML = '';
    for (const [id, label] of QUICK) {
      let v = pad ? buttonLabel(c.gamepad[id], style) : keyLabel((c.keyboard[id] || [])[0]);
      if (pad && id === 'skill' && c.gamepad.skill == null) v = 'RS';
      if (id === 'tacticsAttack') v = pad ? 'D-pad ◀ ▶' : `${keyLabel((c.keyboard.tacticsDefend || [])[0])} ${keyLabel((c.keyboard.tacticsAttack || [])[0])}`;
      quick.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--line)' } },
        h('span', {}, label), h('span.cf-glyph', {}, v)));
    }
  }
  tactics.style.gridTemplateColumns = '1fr 220px';
  const el = h('section.cf-screen', {},
    h('div.cf-scrim'),
    h('div.cf-pause-inner', {},
      h('div', {}, minute, h('h1.cf-h1', { style: { marginTop: '12px' } }, 'Paused'), menu, tactics, quick),
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
      tactics.hidden = !ui.humanTeamAI();
      tactics.render();
      renderQuick();
      ui.nav.set({ el, initial: '[data-id="resume"]', wrap: true, onBack: () => ui.resume(), onStart: () => ui.resume() });
    },
  };
}
