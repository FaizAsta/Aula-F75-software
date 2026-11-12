// Frosted window (Windows 11). Loaded in <head>, right after theme.js, so the first paint already has the right look.
//
// In the desktop app main.js can draw the window's background as blurred acrylic. This file only decides whether the page
// lets it show through: yes while the "Frosted window" switch (Settings > Theme) is on and no background picture is chosen,
// no otherwise. It puts class "frost" on <html>
// (the CSS in app.css does the rest) and tells the desktop app to switch the acrylic on or off with it, so the
// window's own material follows. app.js calls AulaFrost.set() whenever the background changes. Where frosting is not available (older Windows,
// another system, a browser tab) nothing happens and the page stays solid.
(() => {
  'use strict';
  const root = document.documentElement;
  const host = window.aulaHost || null;
  const supported = !!(host && host.frost && host.frost.supported);
  const PICTURE_KEYS = ['aula.bg', 'aula.bgPreset']; // where background.js / app.js keep the picture and the preset
  const PREF_KEY = 'aula.prefs'; // app.js keeps the switch there as prefs.frost (true unless the person turned it off)
  let on = false;

  function set(want) {
    if (!supported) return;
    want = !!want;
    root.classList.toggle('frost', want);
    if (want === on) return;
    on = want;
    try {
      host.frost.set(want);
    } catch (_) {
      /* the page still looks right; only the window material would stay as it was */
    }
  }

  window.AulaFrost = { supported, set, isOn: () => on };

  if (!supported) return;
  // Before the first paint, guess from what was saved last time; app.js corrects it as soon as the background is known.
  let saved = {};
  try {
    saved = host.loadMemory() || {};
  } catch (_) {
    saved = {};
  }
  let allowed = true;
  try {
    allowed = JSON.parse(saved[PREF_KEY] || '{}').frost !== false;
  } catch (_) {
    allowed = true;
  }
  let glass = false; // the Liquid glass style (glass.js) paints its own backdrop, so no frosting
  try {
    glass = JSON.parse(saved[PREF_KEY] || '{}').style === 'glass';
  } catch (_) {
    glass = false;
  }
  on = allowed && !glass && !PICTURE_KEYS.some((k) => !!saved[k]);
  root.classList.toggle('frost', on);
})();
