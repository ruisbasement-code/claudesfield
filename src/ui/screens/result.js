import { h } from '../dom.js';
import { sfx } from '../sound.js';
import { button } from '../dom.js';
import { scorelineEl, scorersEl, statsEl } from './common.js';

export function resultScreen(ui) {
  const main = h('div');
  const motm = h('aside.cf-motm');
  const overline = h('div.cf-overline', {}, 'Full time');
  const rematch = button('Rematch', { primary: true, onClick: () => ui.restart() });
  const swap = button('Swap sides', { onClick: () => {
    const c = ui.lastConfig; if (!c) return;
    ui.lastConfig = { ...c, homeId: c.awayId, awayId: c.homeId, home: c.away, away: c.home, homeKit: c.awayKit === 'away' ? 'home' : c.awayKit, awayKit: c.homeKit,
      controlledSide: c.controlledSide === 'home' ? 'away' : c.controlledSide === 'away' ? 'home' : 'none' };
    ui.startMatch(ui.lastConfig);
  } });
  const menuBtn = button('Main menu', { onClick: () => ui.quit() });
  const el = h('section.cf-screen.is-solid', {},
    h('header.cf-topbar', {}, h('div.cf-crumbs', {}, overline, h('h1.cf-h1', {}, 'Match report'))),
    h('div.cf-result-body', {}, main, motm),
    h('div.cf-result-actions', {}, rematch, swap, menuBtn),
    ui.hints([{ key: 'confirm', label: 'Select' }, { key: 'back', label: 'Main menu' }]));

  function render(sum) {
    main.innerHTML = ''; motm.innerHTML = '';
    if (!sum || !sum.home) { main.append(h('p', {}, 'No match data.')); return; }
    const you = ui.lastConfig?.controlledSide;
    let verdict = 'Full time';
    if (you === 'home' || you === 'away') verdict = sum.winner == null ? 'Full time · Draw' : sum.winner === you ? 'Full time · Victory' : 'Full time · Defeat';
    overline.textContent = verdict;
    main.append(scorelineEl(sum), scorersEl(sum), statsEl(sum));
    if (sum.motm) {
      const m = sum.motm;
      const team = sum[m.side];
      const bits = [];
      if (m.stats?.goals) bits.push(`${m.stats.goals} goal${m.stats.goals > 1 ? 's' : ''}`);
      if (m.stats?.assists) bits.push(`${m.stats.assists} assist${m.stats.assists > 1 ? 's' : ''}`);
      if (m.stats?.saves) bits.push(`${m.stats.saves} save${m.stats.saves > 1 ? 's' : ''}`);
      if (m.stats?.tackles) bits.push(`${m.stats.tackles} tackle${m.stats.tackles > 1 ? 's' : ''}`);
      if (m.stats?.passes) bits.push(`${m.stats.completed}/${m.stats.passes} passes`);
      motm.append(h('div.cf-overline', {}, 'Player of the match'),
        h('div.name', {}, m.name),
        h('div.meta', {}, `${m.pos || ''}${m.number != null ? ' · #' + m.number : ''} · ${team?.name || ''}`),
        h('div.meta', {}, bits.join(' · ')),
        h('div.rating', {}, m.rating.toFixed(1)));
    }
  }

  return {
    el,
    show(sum) {
      render(sum);
      sfx.select();
      ui.nav.set({ el, initial: rematch, onBack: () => ui.quit() });
    },
  };
}
