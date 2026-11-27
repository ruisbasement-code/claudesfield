// Minimal DOM helpers + reusable option widgets.
import { sfx } from './sound.js';

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'nav') el.setAttribute('data-nav', v === true ? '' : v);
    else if (k.startsWith('--')) el.style.setProperty(k, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Selector row: label  ◀ value ▶
 * opts: { label, options:[{value,label}], get():value, set(value), help?, pips?:bool, wrap?:bool, disabled?():bool }
 */
export function selectRow(opts) {
  const valueEl = h('div.cf-value');
  const pips = opts.pips ? h('div.cf-pips') : null;
  const left = h('button.cf-arrow', { tabindex: -1, 'aria-label': 'Previous', html: '&#9664;' });
  const right = h('button.cf-arrow', { tabindex: -1, 'aria-label': 'Next', html: '&#9654;' });
  const row = h('div.cf-row', { nav: true, role: 'group' },
    h('div.cf-row-label', {}, opts.label),
    h('div.cf-select', {}, left, h('div', {}, valueEl, pips), right));
  const idx = () => Math.max(0, opts.options.findIndex((o) => o.value === opts.get()));
  const render = () => {
    const i = idx();
    valueEl.textContent = opts.options[i]?.label ?? '';
    if (pips) pips.innerHTML = opts.options.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('');
    const dis = opts.disabled?.();
    row.classList.toggle('is-disabled', !!dis);
  };
  row.cfAdjust = (d) => {
    if (opts.disabled?.()) { sfx.error(); return; }
    let i = idx() + d;
    const n = opts.options.length;
    if (opts.wrap === false) i = Math.max(0, Math.min(n - 1, i)); else i = (i + n) % n;
    opts.set(opts.options[i].value);
    render();
  };
  row.cfActivate = () => row.cfAdjust(1);
  left.addEventListener('click', (e) => { e.stopPropagation(); row.cfAdjust(-1); sfx.change(); });
  right.addEventListener('click', (e) => { e.stopPropagation(); row.cfAdjust(1); sfx.change(); });
  row.addEventListener('click', () => { row.cfAdjust(1); sfx.change(); });
  row.cfHelp = { title: opts.label, text: opts.help || '' };
  row.render = render;
  render();
  return row;
}

export const toggleRow = (opts) => selectRow({ ...opts, options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] });

/** Slider row. opts: { label, min, max, step, get, set, format?(v), help? } */
export function sliderRow(opts) {
  const fill = h('div.cf-fill');
  const track = h('div.cf-track', {}, fill);
  const valueEl = h('div.cf-value');
  const row = h('div.cf-row', { nav: true }, h('div.cf-row-label', {}, opts.label), h('div.cf-slider', {}, track, valueEl));
  const fmt = opts.format || ((v) => Math.round(v * 100));
  const render = () => {
    const v = opts.get();
    fill.style.width = `${((v - opts.min) / (opts.max - opts.min)) * 100}%`;
    valueEl.textContent = fmt(v);
  };
  const setV = (v) => {
    const s = opts.step;
    v = Math.round(Math.max(opts.min, Math.min(opts.max, v)) / s) * s;
    opts.set(+v.toFixed(4)); render();
  };
  row.cfAdjust = (d) => setV(opts.get() + d * opts.step);
  row.cfActivate = () => {};
  let dragging = false;
  const fromPointer = (e) => { const r = track.getBoundingClientRect(); setV(opts.min + ((e.clientX - r.left) / r.width) * (opts.max - opts.min)); };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); fromPointer(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  track.addEventListener('pointerup', () => { dragging = false; sfx.change(); });
  row.cfHelp = { title: opts.label, text: opts.help || '' };
  row.render = render;
  render();
  return row;
}

export function button(label, { primary, onClick, cls } = {}) {
  const b = h('button.cf-btn', { nav: true, class: [primary && 'is-primary', cls].filter(Boolean).join(' ') || null }, label);
  b.addEventListener('click', () => { sfx.select(); onClick?.(); });
  return b;
}
