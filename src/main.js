import { Game } from './game.js';

const uiModules = import.meta.glob('./ui/index.js');
const settingsModules = import.meta.glob('./ui/settings.js', { eager: true });
const settingsApi = settingsModules['./ui/settings.js'];

const canvas = document.getElementById('game');
const game = new Game(canvas, { settings: settingsApi?.getSettings?.() });
window.__game = game; // handy for debugging in the console

settingsApi?.onSettingsChange?.((s) => game.applySettings(s));

async function boot() {
  const loader = uiModules['./ui/index.js'];
  if (!loader) {
    // No UI module: jump straight into a match (developer fallback).
    game.startMatch({ homeId: 'kestrel', awayId: 'valdora', humanSide: 'home', difficulty: 'pro', halfMinutes: 4 });
    return;
  }
  const { createUI } = await loader();
  let lastConfig = null;
  const ui = createUI(document.getElementById('ui'), {
    onStartMatch(cfg) { lastConfig = cfg; game.startMatch(cfg); },
    onPause() { game.setPaused(true); },
    onResume() { game.setPaused(false); },
    onRestart() { if (lastConfig) game.startMatch(lastConfig); },
    onQuitToMenu() { game.endMatch(); },
    getMatch: () => game.match,
  });
  game.inputEnabled = () => ui.mode === 'match' && !game.match?.replay?.active;
  game.on('frame', () => { if (game.match && ui.mode === 'match') ui.hud.update(game.hudState()); });
  game.on('fullTime', () => { if (ui.mode === 'match') ui.showResult(); });
  // only drop the CSS fallback once the 3D stadium has actually drawn a few frames
  let drawn = 0;
  game.on('frame', () => { if (++drawn === 5) ui.setLiveBackground?.(true); });
  window.__ui = ui;
}
boot();
