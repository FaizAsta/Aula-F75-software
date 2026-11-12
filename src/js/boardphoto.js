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

  const loaded = (file) => {
    const f = files.get(file);
    return !!(f && f.ok);
  };

  /**
   * The pictures at one size: the big ones from the manifest itself (`man.scale` pixels per key), or a smaller copy from
   * `man.mips` (made by scripts/render-board/mips.py). Both have the same shape: { base, caps }.
   */
  function entryAt(id, level) {
    const e = man.skins[id];
    if (!e || !e.base) return null;
    if (level === man.scale) return e;
    const m = man.mips && man.mips[level] && man.mips[level][id];
    return m && m.base ? m : null;
  }

  /** The sizes there are, biggest first (the manifest's own size, then every smaller copy). */
  function levelsOf() {
    const out = [man.scale];
    if (man.mips) for (const k of Object.keys(man.mips)) if (Number(k) < man.scale) out.push(Number(k));
    return out.sort((x, y) => y - x);
  }

  /** The smallest size that is still at least `ppu` pixels per key (never stretched), or the biggest when none is. */
  function levelFor(ppu) {
    const all = levelsOf();
    if (!(ppu > 0)) return all[0];
    let best = all[0];
    for (const L of all) if (L >= ppu - 0.5 && L < best) best = L;
    return best;
  }

  const complete = (e) => !!e && loaded(e.base.file) && Object.values(e.caps || {}).every((c) => loaded(c.file));

  function request(e) {
    load(e.base.file);
    for (const c of Object.values(e.caps || {})) load(c.file);
  }

  function build(e, level) {
    return {
      scale: level,
      mc: man.mc || 0.2,
      face: man.face || { l: 0.057, t: 0.03, r: 0.057, b: 0.265 },
      base: { img: files.get(e.base.file).img, w: e.base.w, h: e.base.h, ox: e.base.ox, oy: e.base.oy },
      cap(w, accent) {
        const c = e.caps[`${w}|${accent || '-'}`] || e.caps[`${w}|-`];
        return c ? { img: files.get(c.file).img, w: c.w, h: c.h, file: c.file } : null;
      },
    };
  }

  /**
   * The pictures of a skin, or null until every one of them has loaded (so a board is never half photo, half drawing), and
   * for a skin that has none.
   * { scale, mc, face, base: { img, w, h, ox, oy }, cap(w, accentName) -> { img, w, h, file } | null }
   * `scale` is pixels per key unit in the files; `mc` the margin kept round each cap sprite (key units); `face` where the
   * flat top of a cap is (key units from the cap's corner: l, t, r from the sides and top, b up from the bottom).
   *
   * `ppu` (optional) is how many device pixels one key will take on screen. The copy that fits it best is used, so the
   * browser only has to shrink it a little instead of squeezing the biggest picture down by 3 to 6 times, which smears
   * every cap. Until that copy has loaded, a copy that has loaded already stands in (the board is redrawn when the better
   * one arrives). Without `ppu` (or without smaller copies) it is the one big picture, as before.
   */
  function skin(id, ppu) {
    if (!man || !man.skins || !man.skins[id]) return null;
    const top = man.skins[id];
    if (!top.base) return null;
    const want = levelFor(ppu);
    const wanted = entryAt(id, want);
    if (wanted) request(wanted);
    if (complete(wanted)) return build(wanted, want);
    // The copy that fits is still on its way: show the nearest one that is already here rather than the plain drawing.
    const rest = levelsOf().sort((x, y) => Math.abs(x - want) - Math.abs(y - want));
    for (const L of rest) {
      const e = entryAt(id, L);
      if (e && e !== wanted && complete(e)) return build(e, L);
    }
    if (!wanted) request(top);
    return null;
  }

  /** Ask for every picture a skin needs (so they are on their way before the first frame wants them). */
  function preload(id, ppu) {
    const e = man && man.skins && man.skins[id];
    if (!e || !e.base) return;
    const at = entryAt(id, levelFor(ppu)) || e;
    request(at);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { skin, preload, subscribe, setManifest, version: () => version };
});
