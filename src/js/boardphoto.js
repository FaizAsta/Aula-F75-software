/*
 * The rendered keyboard pictures. scripts/render-board/render.py makes, for each model's skin, one picture of the case
 * (plate, slots, knob, the shadow on the desk) and one picture of each kind of keycap (a width and an accent colour).
 * src/img/board/manifest.js says what exists and where.
 *
 * This module loads those pictures on demand and hands them to preview.js, which puts the case down once and a cap
 * sprite on every key, then adds the lighting on top. Anything that is not there (not loaded yet, missing, or no
 * browser, as in the tests) simply returns null, and the preview falls back to the drawing in boardart.js.
 */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? null : root.AulaBoardManifest);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaBoardPhoto = api;
})(typeof self !== 'undefined' ? self : globalThis, function (manifest) {
  'use strict';

  let man = manifest || null;
  const files = new Map(); // file -> { img, ok }
  const listeners = new Set();
  let version = 0; // goes up every time another picture finishes loading, so callers know to redraw

  const canLoad = () => !!(man && man.skins && typeof Image !== 'undefined');

  /** Test hook / late binding: give it a manifest and an image constructor-like loader. */
  function setManifest(m) {
    man = m || null;
    files.clear();
    version++;
  }

  function load(file) {
    let e = files.get(file);
    if (e) return e.ok ? e.img : null;
    if (!canLoad()) return null;
    e = { img: new Image(), ok: false };
    files.set(file, e);
    e.img.onload = () => {
      e.ok = true;
      version++;
      for (const fn of listeners) {
        try {
          fn(file);
        } catch (_) {
          /* a listener that throws must not stop the others */
        }
      }
    };
    e.img.onerror = () => {}; // stays unloaded: the drawing is used instead
    e.img.src = (man.dir || '') + file;
    return null;
  }

  /**
   * The pictures of a skin, or null until every one of them has loaded (so a board is never half photo, half drawing), and
   * for a skin that has none.
   * { scale, mc, face, base: { img, w, h, ox, oy }, cap(w, accentName) -> { img, w, h, file } | null }
   * `scale` is pixels per key unit in the files; `mc` the margin kept round each cap sprite (key units); `face` where the
   * flat top of a cap is (key units from the cap's corner: l, t, r from the sides and top, b up from the bottom).
   */
  function skin(id) {
    if (!man || !man.skins || !man.skins[id]) return null;
    const e = man.skins[id];
    if (!e.base) return null;
    preload(id);
    const loaded = (file) => {
      const f = files.get(file);
      return !!(f && f.ok);
    };
    if (!loaded(e.base.file)) return null;
    for (const c of Object.values(e.caps || {})) if (!loaded(c.file)) return null;
    return {
      scale: man.scale,
      mc: man.mc || 0.2,
      face: man.face || { l: 0.057, t: 0.03, r: 0.057, b: 0.265 },
      base: { img: files.get(e.base.file).img, w: e.base.w, h: e.base.h, ox: e.base.ox, oy: e.base.oy },
      cap(w, accent) {
        const c = e.caps[`${w}|${accent || '-'}`] || e.caps[`${w}|-`];
        return c ? { img: files.get(c.file).img, w: c.w, h: c.h, file: c.file } : null;
      },
    };
  }

  /** Ask for every picture a skin needs (so they are on their way before the first frame wants them). */
  function preload(id) {
    const e = man && man.skins && man.skins[id];
    if (!e) return;
    if (e.base) load(e.base.file);
    for (const c of Object.values(e.caps || {})) load(c.file);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { skin, preload, subscribe, setManifest, version: () => version };
});
