// Colour theme: dark (the original look), light, or follow the system.
// Loaded in <head>, right after boot.js, so the right colours are on screen before the first paint.
//
// This file only applies a theme. app.js owns the saved preference (prefs.theme) and calls set() when it changes.
// The page reads it from <html data-theme="dark|light">; the CSS does the rest (see :root in app.css).
(() => {
  'use strict';
  const root = document.documentElement;
  const host = window.aulaHost || null;
  const PREF_KEY = 'aula.prefs';
  const CHOICES = ['dark', 'light', 'system'];
  const DEFAULT = 'dark'; // existing users keep the look they know until they pick something else
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  const listeners = [];

  // Same lookup order as app.js: the desktop app's data file first, then localStorage (browser tab / older versions).
  function readSaved() {
    let raw = null;
    try {
      if (host && host.loadMemory) raw = (host.loadMemory() || {})[PREF_KEY] ?? null;
    } catch (_) {
      raw = null;
    }
    if (raw == null) {
      try {
        raw = localStorage.getItem(PREF_KEY);
      } catch (_) {
        raw = null;
      }
    }
    try {
      const t = JSON.parse(raw || '{}').theme;
      return CHOICES.includes(t) ? t : DEFAULT;
    } catch (_) {
      return DEFAULT;
    }
  }

  let pref = readSaved();

  const resolve = (p) => (p === 'system' ? (mq && mq.matches ? 'light' : 'dark') : p);
  let resolved = resolve(pref);

  function apply(notify) {
    resolved = resolve(pref);
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
    // Lets the desktop app match native dialogs and the tray menu, and keeps prefers-color-scheme in step with 'system'.
    try {
      if (host && host.setTheme) host.setTheme(pref);
    } catch (_) {
      /* the page still themes itself */
    }
    if (notify) for (const fn of listeners) fn(resolved, pref);
  }

  // Relative luminance, WCAG definition (0 = black, 1 = white).
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

  // The keyboard's live colour is a bright, saturated "r g b" (the CSS --glow). That is great as a tint and as light
  // on a dark page, but yellow, lime, cyan or white text on a light page cannot be read. For text and thin lines the
  // light theme uses the same hue, darkened (towards black, hue kept) until it reaches 4.5:1 against white. The dark
  // theme returns the colour untouched.
  const MAX_LUM = 0.18; // 1.05 / 4.5 - 0.05: the brightest colour that still has 4.5:1 against white
  function inkFor(c, theme) {
    if ((theme || resolved) !== 'light') return c;
    let k = 1;
    let out = c;
    while (luminance(out) > MAX_LUM && k > 0.1) {
      k -= 0.02;
      out = c.map((v) => v * k);
    }
    return out;
  }

  if (mq) {
    const onSystem = () => {
      if (pref === 'system') apply(true);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
    else if (mq.addListener) mq.addListener(onSystem);
  }

  window.AulaTheme = {
    CHOICES,
    pref: () => pref,
    resolved: () => resolved,
    set(next) {
      if (!CHOICES.includes(next)) return;
      pref = next;
      apply(true);
    },
    // Dark <-> light in one step. From 'system' it goes to the opposite of what is showing now.
    toggle() {
      this.set(resolved === 'light' ? 'dark' : 'light');
    },
    onChange(fn) {
      listeners.push(fn);
    },
    inkFor,
    luminance,
  };

  apply(false);
})();
