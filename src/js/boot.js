// Runs in <head>, before first paint. Inside the desktop app the window has no native title bar, so the page draws its
// own window buttons and drag area (.frameless). In a plain browser tab it keeps the normal page without them.
(() => {
  'use strict';
  // Preview mode: this page is the small live picture on a card of "Which UI do you want to use?" (see js/stylepick-ui.js). It is the
  // same app, opened inside that card with `?preview=1&cfg=...` (the look to show), and it never reads or writes the person's real
  // settings or talks to the desktop side: app.js keeps its settings in memory, and `aulaHost` is switched off here.
  // Only a page inside another page can be one (opening the file on its own with that address is an ordinary start).
  try {
    if (window.parent !== window && /[?&]preview=1(&|$)/.test(location.search)) {
      const m = /[?&]cfg=([^&]*)/.exec(location.search);
      const cfg = m ? JSON.parse(decodeURIComponent(m[1])) : {};
      window.AULA_PREVIEW = cfg && typeof cfg === 'object' ? cfg : {};
      document.documentElement.classList.add('preview');
      window.aulaHost = undefined;
    }
  } catch (_) {
    /* not a preview after all: start as usual */
  }
  const host = window.aulaHost;
  if (!host || !host.winControl) return;
  const root = document.documentElement;
  root.classList.add('frameless');
  const set = (s) => root.classList.toggle('is-max', !!(s && s.maximized));
  host.winState().then(set).catch(() => {});
  host.onWinState(set);
})();
