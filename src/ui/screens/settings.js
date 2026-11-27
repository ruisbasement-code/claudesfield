// Settings: tabbed option lists + control rebinding for keyboard and gamepad.
import { h, selectRow, toggleRow, sliderRow, button } from '../dom.js';
import { sfx } from '../sound.js';
import {
  getSettings, setSetting, resetSettings, ACTIONS, ACTION_GROUPS, conflictsWith, CAMERAS, DIFFICULTY_BLURBS,
} from '../settings.js';
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../core/constants.js';
import { keyLabel, buttonLabel, padStyle } from '../labels.js';

const S = () => getSettings();
const pct = (v) => `${Math.round(v * 100)}`;

const TABS = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'camera', label: 'Camera' },
  { id: 'audio', label: 'Audio' },
  { id: 'graphics', label: 'Graphics' },
  { id: 'hud', label: 'HUD' },
  { id: 'controls', label: 'Controls' },
];

function group(label) { return h('div.cf-group.cf-overline', {}, label); }

function buildTab(id, ui) {
  const sel = (path, label, options, help, extra = {}) => selectRow({ label, options, help, get: () => path.split('.').reduce((o, k) => o[k], S()), set: (v) => setSetting(path, v), ...extra });
  const tog = (path, label, help) => toggleRow({ label, help, get: () => path.split('.').reduce((o, k) => o[k], S()), set: (v) => setSetting(path, v) });
  const sld = (path, label, help, o = {}) => sliderRow({ label, help, min: 0, max: 1, step: 0.05, format: pct, get: () => path.split('.').reduce((x, k) => x[k], S()), set: (v) => setSetting(path, v), ...o });
  const assist = [{ value: 'assisted', label: 'Assisted' }, { value: 'semi', label: 'Semi' }, { value: 'manual', label: 'Manual' }];

  switch (id) {
    case 'gameplay': return [
      group('Match'),
      sel('gameplay.difficulty', 'Default difficulty', DIFFICULTIES.map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] })),
        'How sharp the computer-controlled side is. ' + Object.values(DIFFICULTY_BLURBS).join(' '), { pips: true, wrap: false }),
      sel('gameplay.halfMinutes', 'Half length', [2, 3, 4, 5, 6, 8, 10, 15, 20, 45].map((m) => ({ value: m, label: `${m} min` })),
        'Real minutes per half. The match clock always runs 0 to 90.', { wrap: false }),
      group('Rules'),
      tog('gameplay.offside', 'Offside', 'Flag runners who are beyond the second-last defender when the ball is played.'),
      tog('gameplay.fouls', 'Fouls', 'Award free kicks and penalties for mistimed tackles.'),
      tog('gameplay.cards', 'Bookings', 'Show yellow and red cards for reckless challenges. Two yellows means off.'),
      tog('gameplay.injuries', 'Injuries', 'Players can pick up knocks that slow them down.'),
      group('Assistance'),
      sel('gameplay.passAssist', 'Pass assistance', assist, 'Assisted picks the receiver and power for you. Manual passes go exactly where you aim, as hard as you charge them.'),
      sel('gameplay.shotAssist', 'Shot assistance', assist, 'Assisted guides shots towards the frame. Manual can miss the target entirely.'),
      sel('gameplay.autoSwitch', 'Auto switching', [{ value: 'off', label: 'Off' }, { value: 'assisted', label: 'Assisted' }, { value: 'auto', label: 'Automatic' }],
        'How the game changes your controlled player when the ball moves. Off means you always switch yourself.'),
    ];
    case 'camera': return [
      group('View'),
      sel('camera.mode', 'Camera', CAMERAS.map((c) => ({ value: c.id, label: c.label })),
        'Broadcast follows play from the stand like TV coverage. Tele is tighter, Wide shows more of the pitch, End to End looks down the length of the field.'),
      sliderRow({ label: 'Zoom', min: -5, max: 5, step: 1, format: (v) => (v > 0 ? `+${v}` : `${v}`), get: () => S().camera.zoom, set: (v) => setSetting('camera.zoom', v), help: 'Negative pulls the camera back, positive brings it closer.' }),
      sliderRow({ label: 'Height', min: -5, max: 5, step: 1, format: (v) => (v > 0 ? `+${v}` : `${v}`), get: () => S().camera.height, set: (v) => setSetting('camera.height', v), help: 'Raise the camera for a tactical view or lower it for a pitch-side feel.' }),
      group('Presentation'),
      tog('camera.shake', 'Camera shake', 'Small camera kicks on powerful shots and crunching tackles.'),
      tog('camera.replays', 'Goal replays', 'Show an instant replay after every goal. Press confirm to skip.'),
    ];
    case 'audio': return [
      group('Volume'),
      sld('audio.master', 'Master', 'Overall volume.'),
      sld('audio.crowd', 'Crowd', 'Stadium atmosphere: chants, groans and the roar after a goal.'),
      sld('audio.sfx', 'Effects', 'Ball strikes, whistles and menu sounds.'),
      sld('audio.music', 'Music', 'Menu music.'),
      group('Voices'),
      tog('audio.commentary', 'Referee calls', 'Short spoken calls from the referee and touchline when supported by your browser.'),
    ];
    case 'graphics': return [
      group('Quality'),
      sel('graphics.quality', 'Preset', [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
        'Low runs well on laptops and older machines. High adds detailed grass, softer shadows and more crowd.', { wrap: false, pips: true }),
      sliderRow({ label: 'Resolution scale', min: 0.5, max: 1.5, step: 0.1, format: (v) => `${Math.round(v * 100)}%`, get: () => S().graphics.resolutionScale, set: (v) => setSetting('graphics.resolutionScale', v), help: 'Render resolution relative to your screen. Lower it if the game stutters.' }),
      tog('graphics.shadows', 'Shadows', 'Player and stadium shadows.'),
      tog('graphics.antialias', 'Anti-aliasing', 'Smooths jagged edges on pitch lines. Takes effect on the next match.'),
      tog('graphics.grassDetail', 'Grass detail', 'Mowing patterns and fine grass texture.'),
      group('Diagnostics'),
      tog('graphics.showFps', 'Show frame rate', 'Display frames per second in the corner during a match.'),
    ];
    case 'hud': return [
      group('Layout'),
      sliderRow({ label: 'HUD size', min: 0.8, max: 1.3, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, get: () => S().hud.scale, set: (v) => setSetting('hud.scale', v), help: 'Scale the scoreboard, player card and radar.' }),
      sel('hud.radar', 'Radar', [{ value: 'bottom', label: 'On' }, { value: 'off', label: 'Off' }], 'Overhead mini-map of every player and the ball.'),
      sel('hud.indicator', 'Player indicator', [{ value: 'name', label: 'Name' }, { value: 'number', label: 'Number' }, { value: 'off', label: 'Arrow only' }], 'What appears above the player you control.'),
      tog('hud.clock', 'Match clock', 'Show the running clock beside the score.'),
      tog('hud.eventBanners', 'Event banners', 'On-screen captions for goals, cards, offsides and set pieces.'),
    ];
    default: return [];
  }
}

export function settingsScreen(ui) {
  let tab = 'gameplay';
  let from = 'title';
  let device = 'keyboard';

  const tabsEl = h('div.cf-tabs');
  const tabBtns = {};
  tabsEl.append(h('span.cf-tabhint', { html: '' }));
  for (const t of TABS) {
    const b = h('button.cf-tab', {}, t.label);
    b.addEventListener('click', () => { sfx.change(); setTab(t.id); });
    tabBtns[t.id] = b; tabsEl.append(b);
  }
  const list = h('div.cf-settings-list');
  const helpTitle = h('h3');
  const helpText = h('p');
  const help = h('aside.cf-help', {}, h('div.cf-overline', {}, 'About this setting'), helpTitle, helpText);
  const overline = h('div.cf-overline', {}, 'Saved automatically');

  const hints = ui.hints([{ key: 'tabs', label: 'Switch tab' }, { key: 'adjust', label: 'Change' }, { key: 'back', label: 'Back' }]);
  const el = h('section.cf-screen.is-solid', {},
    h('header.cf-topbar', {}, h('div.cf-crumbs', {}, overline, h('h1.cf-h1', {}, 'Settings'))),
    tabsEl,
    h('div.cf-settings-body', {}, list, help),
    hints);

  function setHelp(node) {
    const hp = node?.cfHelp;
    helpTitle.textContent = hp?.title || '';
    helpText.textContent = hp?.text || '';
  }

  function setTab(id, focusFirst = true) {
    tab = id;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('is-current', k === id);
    list.innerHTML = '';
    list.scrollTop = 0;
    if (id === 'controls') buildControls();
    else {
      list.append(...buildTab(id, ui));
      const reset = button('Reset to defaults', { onClick: async () => {
        const ok = await ui.dialog('Reset ' + TABS.find((t) => t.id === id).label, 'Put every option on this tab back to its default value?', [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, primary: true }]);
        if (ok) { resetSettings(id); setTab(id); ui.toast('Defaults restored'); }
      } });
      reset.style.marginTop = '24px';
      reset.cfHelp = { title: 'Reset', text: 'Restore the defaults for this tab only.' };
      list.append(reset);
    }
    if (focusFirst && ui.nav.top?.el === el) { ui.nav.top.focused?.classList.remove('is-focus'); ui.nav.top.focused = null; ui.nav.refresh(); }
  }

  // ---------------------------------------------------------------- controls
  function buildControls() {
    const seg = h('div.cf-segment');
    for (const d of ['keyboard', 'gamepad']) {
      const b = h('button', { nav: true, class: device === d ? 'is-current' : null }, d === 'keyboard' ? 'Keyboard' : 'Gamepad');
      b.cfHelp = { title: d === 'keyboard' ? 'Keyboard' : 'Gamepad', text: d === 'keyboard' ? 'Each action can have two keys. Select a slot and press the new key. Delete clears a slot.' : 'Select an action and press the gamepad button to use. Layout follows the standard Xbox / PlayStation mapping.' };
      b.addEventListener('click', () => { if (device !== d) { device = d; sfx.change(); setTab('controls', false); ui.nav.focus(list.querySelector('.cf-segment .is-current'), { silent: true }); } });
      seg.append(b);
    }
    list.append(seg);

    if (device === 'gamepad') {
      const pad = ui.nav.pad;
      const status = h('div', { style: { padding: '0 18px 14px', color: 'var(--muted)', fontSize: '14px' } },
        pad ? `Connected: ${pad.id.replace(/\(.*?\)/g, '').trim()}` : 'No gamepad detected. Connect one and press any button.');
      list.append(status);
    }

    const isPad = device === 'gamepad';
    for (const g of ACTION_GROUPS) {
      const acts = ACTIONS.filter((a) => a.group === g.id && (!isPad || g.id !== 'move'));
      if (!acts.length) continue;
      list.append(group(g.label));
      list.append(h('div.cf-bind-head.cf-overline', { class: isPad ? 'is-pad' : null }, h('span', {}, 'Action'), ...(isPad ? [h('span', {}, 'Button')] : [h('span', {}, 'Primary'), h('span', {}, 'Secondary')])));
      for (const a of acts) {
        const row = h('div.cf-bind', { class: isPad ? 'is-pad' : null }, h('div.cf-row-label', {}, a.label));
        if (isPad) row.append(bindCell(a, null));
        else { row.append(bindCell(a, 0)); row.append(bindCell(a, 1)); }
        list.append(row);
      }
    }
    if (isPad) {
      list.append(group('Feel'));
      list.append(toggleRow({ label: 'Vibration', help: 'Rumble on shots, tackles and goals.', get: () => S().controls.vibration, set: (v) => setSetting('controls.vibration', v) }));
      list.append(sliderRow({ label: 'Stick dead zone', min: 0.05, max: 0.4, step: 0.01, format: pct, help: 'Raise this if players drift when you are not touching the stick.', get: () => S().controls.stickDeadzone, set: (v) => setSetting('controls.stickDeadzone', v) }));
    }
    const reset = button(`Reset ${isPad ? 'gamepad' : 'keyboard'} controls`, { onClick: async () => {
      const ok = await ui.dialog('Reset controls', `Restore the default ${device} layout?`, [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, primary: true }]);
      if (ok) { resetSettings(`controls.${device}`); setTab('controls', false); ui.toast('Default controls restored'); ui.nav.refresh(); }
    } });
    reset.style.marginTop = '24px';
    reset.cfHelp = { title: 'Reset', text: 'Put every binding for this device back to the default.' };
    list.append(reset);
  }

  function bindCell(action, slot) {
    const isPad = slot == null;
    const cell = h('button.cf-key', { nav: true });
    const render = () => {
      const c = S().controls;
      const v = isPad ? c.gamepad[action.id] : (c.keyboard[action.id] || [])[slot];
      cell.textContent = isPad ? buttonLabel(v, padStyle(ui.nav.pad?.id)) : keyLabel(v);
      cell.classList.toggle('is-empty', v == null);
    };
    cell.render = render;
    cell.cfHelp = {
      title: action.label,
      text: (isPad ? 'Press confirm, then the gamepad button you want. ' : 'Press confirm, then the key you want. Delete clears this slot, Esc cancels. ')
        + (action.group === 'attack' ? 'Attacking actions can share a button with defending ones.' : action.group === 'defend' ? 'Defending actions can share a button with attacking ones.' : ''),
    };
    cell.addEventListener('click', () => listen(cell, action, slot));
    render();
    return cell;
  }

  function listen(cell, action, slot) {
    const isPad = slot == null;
    sfx.select();
    cell.classList.add('is-listening');
    cell.textContent = isPad ? 'Press button' : 'Press key';
    let timer;
    const finish = () => {
      clearTimeout(timer);
      ui.nav.capture = null; ui.nav.padCapture = null;
      cell.classList.remove('is-listening');
      for (const c of list.querySelectorAll('.cf-key')) c.render?.();
    };
    if (isPad) {
      ui.nav.padCapture = (btn) => { assignPad(action, btn); finish(); };
      ui.nav.capture = (e) => { if (e.code === 'Escape') { sfx.back(); finish(); } return true; };
      timer = setTimeout(finish, 6000);
    } else {
      ui.nav.capture = (e) => {
        if (e.repeat) return true;
        if (e.code === 'Escape') { sfx.back(); finish(); return true; }
        if (e.code === 'Delete' || e.code === 'Backspace') { assignKey(action, slot, null); finish(); return true; }
        assignKey(action, slot, e.code); finish(); return true;
      };
    }
  }

  function assignKey(action, slot, code) {
    const kb = structuredClone(S().controls.keyboard);
    const mine = kb[action.id] || [null, null];
    const prev = mine[slot];
    if (code) {
      if (mine[1 - slot] === code) mine[1 - slot] = prev; // swap within the action
      const blocked = conflictsWith(action.group);
      for (const other of ACTIONS) {
        if (other.id === action.id || !blocked.includes(other.group)) continue;
        if (!conflictsWith(other.group).includes(action.group)) continue;
        const arr = kb[other.id] || [];
        const j = arr.indexOf(code);
        if (j >= 0) { arr[j] = prev; ui.toast(`${keyLabel(code)} moved from ${other.label}${prev ? `, which now uses ${keyLabel(prev)}` : ''}`); }
      }
    }
    mine[slot] = code;
    kb[action.id] = mine;
    setSetting('controls.keyboard', kb);
    sfx.select();
  }

  function assignPad(action, btn) {
    const gp = { ...S().controls.gamepad };
    const prev = gp[action.id];
    for (const other of ACTIONS) {
      if (other.id === action.id || gp[other.id] !== btn) continue;
      if (!conflictsWith(action.group).includes(other.group) || !conflictsWith(other.group).includes(action.group)) continue;
      gp[other.id] = prev ?? null;
      ui.toast(`${buttonLabel(btn)} moved from ${other.label}`);
    }
    gp[action.id] = btn;
    setSetting('controls.gamepad', gp);
    sfx.select();
  }

  const back = () => {
    if (from === 'pause') ui.show('pause');
    else ui.showTitle();
  };

  return {
    el,
    onInputMode() { if (tab === 'controls') for (const c of list.querySelectorAll('.cf-key')) c.render?.(); },
    show({ from: f = 'title', tab: t = 'gameplay' } = {}) {
      from = f;
      if (t === 'controls' && ui.nav.inputMode === 'gamepad') device = 'gamepad';
      setTab(t, false);
      const order = TABS.map((x) => x.id);
      ui.nav.set({
        el,
        onBack: back,
        onTab: (d) => setTab(order[(order.indexOf(tab) + d + order.length) % order.length]),
        onFocus: setHelp,
      });
    },
  };
}
