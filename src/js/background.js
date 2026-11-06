/*
 * Background: a picture shown behind the whole app, at an opacity the person sets with a slider (10% to 100%, 50% to start).
 *
 * The chosen file is shrunk (longest side 1920 px) and kept as a data URL, so the app has its own copy and keeps working
 * if the original file is moved or deleted. app.js saves it under one key of its own and paints it on #appBg. The opacity
 * is the CSS variable --bg-opacity on that layer; its fallback in the CSS (.app-bg) is OPACITY here, so a test can check
 * that the two agree.
 *
 * Preset backgrounds: every picture (PNG, JPEG or WebP) in src/img/backgrounds is offered in Settings > Theme. None is
 * chosen by default. The folder is read by main.js when the app starts, so a picture dropped in the folder before
 * `npm run dist` is part of the built app with no list to edit. Only the file name is remembered (never a path).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaBg = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPACITY = 0.5; // the opacity until the person moves the slider
  const MIN_OPACITY = 0.1;
  const MAX_OPACITY = 1;
  const MAX_EDGE = 1920; // longest side of the saved copy, in pixels
  const FALLBACK_EDGES = [1280, 800]; // tried in turn if the copy is still too big to keep
  const QUALITY = 0.85;
  const PRESET_DIR = 'img/backgrounds'; // under src/, next to index.html
  const PRESET_EXT = /\.(png|jpe?g|webp)$/i;
  const MAX_FILE = 25 * 1024 * 1024; // the file the person picks
  const MAX_STORED = 3 * 1024 * 1024; // the saved copy, as text (a data URL)

  /** The size to draw a w x h picture at so its longest side is at most `max`. Never enlarges. null for a bad size. */
  function fit(w, h, max = MAX_EDGE) {
    if (!(w > 0) || !(h > 0) || !(max > 0)) return null;
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /** Whatever was saved (a number or text) -> an opacity from MIN_OPACITY to MAX_OPACITY in steps of 0.05. Bad input gives OPACITY. */
  function clampOpacity(v) {
    const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return OPACITY;
    return Math.round(Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, n)) * 20) / 20;
  }

  /** True for a picture saved by this module (or an older copy of one). Anything else is ignored, never painted. */
  function isDataImage(s) {
    return typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
  }

  /** The CSS value that paints a saved picture: url("data:..."). */
  function cssUrl(s) {
    return isDataImage(s) ? `url("${s}")` : '';
  }

  /** True for a plain file name in the presets folder: a picture type, no folders, no dots-only tricks. */
  function isPresetName(s) {
    return (
      typeof s === 'string' &&
      s.length > 0 &&
      s.length <= 120 &&
      PRESET_EXT.test(s) &&
      !/[\\/:*?"<>|\u0000-\u001f]/.test(s) &&
      !s.startsWith('.')
    );
  }

  /** Whatever a folder listing gave -> the usable picture names, without repeats, in A to Z order (numbers as numbers). */
  function presetNames(list) {
    const out = [...new Set((Array.isArray(list) ? list : []).filter(isPresetName))];
    return out.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  }

  /** The address of a preset picture, relative to index.html. '' for a name that is not a preset. */
  function presetUrl(name) {
    return isPresetName(name) ? `${PRESET_DIR}/${encodeURIComponent(name)}` : '';
  }

  /** The CSS value that paints a preset: url("img/backgrounds/name.webp"). */
  function presetCss(name) {
    const u = presetUrl(name);
    return u ? `url("${u}")` : '';
  }

  /** A readable name for a file name: "dark-forest_01.webp" -> "Dark forest 01". */
  function presetLabel(name) {
    const base = String(name || '').replace(PRESET_EXT, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Picture';
  }

  /** A picked File -> a shrunk data URL. Rejects with a message that can be shown as it is. */
  async function fromFile(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('Pick a picture (PNG, JPEG or WebP).');
    if (file.size > MAX_FILE) throw new Error('That picture is too big (over 25 MB).');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not read that picture.'));
        i.src = url;
      });
      for (const edge of [MAX_EDGE, ...FALLBACK_EDGES]) {
        const d = fit(img.naturalWidth, img.naturalHeight, edge);
        if (!d) break;
        const c = document.createElement('canvas');
        c.width = d.w;
        c.height = d.h;
        c.getContext('2d').drawImage(img, 0, 0, d.w, d.h);
        const out = c.toDataURL('image/webp', QUALITY);
        if (isDataImage(out) && out.length <= MAX_STORED) return out;
      }
      throw new Error('That picture is too detailed to keep. Try a smaller one.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { OPACITY, MIN_OPACITY, MAX_OPACITY, clampOpacity, MAX_EDGE, MAX_STORED, PRESET_DIR, fit, isDataImage, cssUrl, isPresetName, presetNames, presetUrl, presetCss, presetLabel, fromFile };
});
