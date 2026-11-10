// Runs in <head>, before first paint. Inside the desktop app the window has no native title bar, so the page draws its
// own window buttons and drag area (.frameless). In a plain browser tab it keeps the normal page without them.
(() => {
  'use strict';
  const host = window.aulaHost;
  if (!host || !host.winControl) return;
  const root = document.documentElement;
  root.classList.add('frameless');
  const set = (s) => root.classList.toggle('is-max', !!(s && s.maximized));
  host.winState().then(set).catch(() => {});
  host.onWinState(set);
})();
