// Sruti Trainer for the web — entry point. The iOS app (SrutiTrainer/) is the reference: every feature
// here mirrors it (see CLAUDE.md ▸ Website). Plain ES modules, no build step, no third-party code.
import { AppState } from './state.js';
import { MainScreen } from './ui/main.js';

const state = new AppState();
const screen = new MainScreen(state);
window.sruti = { state, screen };   // handy in the DevTools console

// Offline + installable: the service worker caches the whole app. A new version takes over at the next
// quiet moment (not while you're singing or have a sheet open).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let pendingReload = false;
  const reloadWhenIdle = () => {
    if (!pendingReload) return;
    if (state.isListening || screen.sheets.isOpen) return;
    pendingReload = false;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    pendingReload = true;
    reloadWhenIdle();
  });
  state.onChange(reloadWhenIdle);
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
