import { h, esc } from '../dom.js';
import { crestSVG, teamColors } from '../art.js';
import { STAT_ROWS } from '../summary.js';

export function scorelineEl(sum) {
  const H = sum.home, A = sum.away;
  const crest = (t) => h('span', { html: crestSVG(t.data || t) }).firstChild;
  const pens = sum.pens ? h('div.cf-sl-pens', {}, `${sum.pens.home} – ${sum.pens.away} on penalties`) : null;
  return h('div', {},
    h('div.cf-scoreline', {},
      h('div.cf-sl-team', {}, crest(H), h('span', {}, H.name || H.short)),
      h('div', {}, h('div.cf-sl-score', {}, h('span', {}, H.score), h('i'), h('span', {}, A.score)), pens),
      h('div.cf-sl-team.is-away', {}, h('span', {}, A.name || A.short), crest(A))));
}

export function scorersEl(sum) {
  const list = (side) => {
    const ul = h('ul');
    for (const g of sum.goals || []) {
      if (g.team !== side) continue;
      const tag = g.ownGoal ? ' (OG)' : g.penalty ? ' (pen)' : '';
      ul.append(h('li', { html: side === 'home' ? `${esc(g.scorer)}${tag}<b>${esc(g.minute)}</b>` : `<b>${esc(g.minute)}</b>${esc(g.scorer)}${tag}` }));
    }
    return ul;
  };
  return h('div.cf-scorers', {}, h('div', {}, list('home')), h('div.is-away', {}, list('away')));
}

export function statsEl(sum, keys) {
  const wrap = h('div.cf-stats');
  const hc = teamColors(sum.home.data || sum.home).primary;
  const ac = teamColors(sum.away.data || sum.away).primary;
  for (const [key, label, fmt] of STAT_ROWS) {
    if (keys && !keys.includes(key)) continue;
    const a = sum.home.stats?.[key], b = sum.away.stats?.[key];
    if (a == null && b == null) continue;
    const f = fmt || ((v) => `${v}`);
    const tot = (a || 0) + (b || 0);
    const pa = key === 'possession' || key === 'passAccuracy' ? (a || 0) : tot ? ((a || 0) / tot) * 100 : 0;
    const pb = key === 'possession' || key === 'passAccuracy' ? (b || 0) : tot ? ((b || 0) / tot) * 100 : 0;
    wrap.append(h('div.cf-stat', {},
      h('span.v', {}, f(a || 0)),
      h('div.mid', {}, h('div.lbl', {}, label),
        h('div.bars', {},
          h('span', {}, h('i', { style: { width: `${pa}%`, '--c': hc } })),
          h('span', {}, h('i', { style: { width: `${pb}%`, '--c': ac } })))),
      h('span.v', {}, f(b || 0))));
  }
  // CSS custom props via style object don't apply; set them explicitly.
  wrap.querySelectorAll('.bars span:first-child i').forEach((i) => i.style.setProperty('--c', hc));
  wrap.querySelectorAll('.bars span:last-child i').forEach((i) => i.style.setProperty('--c', ac));
  return wrap;
}

/** Kick-by-kick penalty shootout grid. */
export function shootoutEl(sum) {
  const so = sum.shootout;
  if (!so?.kicks) return null;
  const n = Math.max(5, so.kicks.home.length, so.kicks.away.length);
  const row = (side) => {
    const t = sum[side];
    const cells = [];
    for (let i = 0; i < n; i++) {
      const v = so.kicks[side][i];
      cells.push(h('i', { style: { width: '22px', height: '22px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontStyle: 'normal', font: '700 13px/1 var(--cond)',
        background: v === true ? 'var(--good)' : v === false ? 'var(--bad)' : 'var(--line)', color: '#0b0b0b' } }, v === true ? '✓' : v === false ? '✕' : ''));
    }
    return h('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: '16px', padding: '10px 0', borderBottom: '1px solid var(--line)' } },
      h('span', { style: { font: '700 18px/1 var(--cond)', textTransform: 'uppercase' } }, t.short || t.name),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, cells));
  };
  return h('div', { style: { marginTop: '18px' } }, h('div.cf-overline', { style: { marginBottom: '6px' } }, 'Penalty shootout'), row('home'), row('away'));
}
