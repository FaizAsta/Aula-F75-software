/*
 * The keyboard picture on the device screen (home.js): one still picture of a model, drawn from the same rendered pictures the
 * Lighting page uses (src/img/board: the case, and a sprite for each kind of keycap, see boardphoto.js) with the legends
 * printed on the caps the way preview.js prints them. Nothing is lit and nothing moves, so it costs one drawing, not a loop.
 *
 *   draw(canvas, id, { width, dpr })   id: 'f75' | 'f75pro' | 'f87' | 'max' | 'he'
 *
 * It returns true when the picture was painted, and false when the pictures are not here yet (still loading, missing, or no
 * browser): the caller shows a placeholder and draws again when boardphoto.js says another picture arrived (subscribe).
 *
 * modelOf(id) says where every key is (key units) and which skin the model wears; it needs no browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./skins.js'), require('./boardart.js'), require('./boardphoto.js'), require('./layout.js'), require('./max.js'), require('./he.js'), null);
  else root.AulaDevPic = factory(root.AulaSkins, root.AulaBoardArt, root.AulaBoardPhoto, root.AulaLayout, root.AulaMax, root.AulaHe, root);
})(typeof self !== 'undefined' ? self : globalThis, function (S, A, BP, L, MX, HE, win) {
  'use strict';

  // The legend font, the same one preview.js prints with ("Aula Legend" is bundled, css/app.css; the others stand in until it loads).
  const FAMILY = '"Aula Legend","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  const FONT = (px) => `600 ${px}px ${FAMILY}`;
  const REF = 100; // px a legend is measured at, once

  /** The F75 Max and F75 HE name their keys 'shiftleft', 'grave' ...; the legends are written for the F75 layout's names. */
  const NAMES = {
    esc: 'Esc', grave: '`', minus: '-', equal: '=', backspace: 'Backspace', delete: 'Del', tab: 'Tab', bracketleft: '[', bracketright: ']',
    backslash: '\\', pageup: 'PgUp', capslock: 'Caps', semicolon: ';', quote: "'", enter: 'Enter', pagedown: 'PgDn', shiftleft: 'Shift',
    shiftright: 'Shift', comma: ',', period: '.', slash: '/', up: 'Up', end: 'End', ctrlleft: 'Ctrl', ctrlright: 'Ctrl', winleft: 'Win',
    altleft: 'Alt', altright: 'Alt', space: 'Space', fn: 'Fn', left: 'Left', down: 'Down', right: 'Right',
  };
  const legendName = (name) => NAMES[name] || (/^f\d+$/.test(name) ? name.toUpperCase() : name.length === 1 ? name.toUpperCase() : name);

  /** Which pictures each model is. `id` is a layout model (f75, f75pro, f87) or one of the two boards max-ui.js drives. */
  const IDS = ['f75', 'f75pro', 'f87', 'max', 'he'];

  /**
   * { id, skin, keys: [{ n, acc, x, y, w }], w, h }: where each key sits (key units from the top left of the key block), `n` the
   * name its legend is printed from and `acc` the name its accent colour is looked up by (skins.js).
   */
  function modelOf(id) {
    if (id === 'max' || id === 'he') {
      const api = id === 'he' ? HE : MX;
      const grid = (api && api.GRID) || { w: 16, h: 6 };
      const keys = ((api && api.keyLayout && api.keyLayout()) || []).map((k) => ({ n: legendName(k.name), acc: legendName(k.name), x: k.x, y: k.y, w: k.w }));
      return { id, skin: id === 'he' ? 'f75he' : 'max', keys, w: grid.w, h: grid.h };
    }
    const m = L.MODELS.find((x) => x.id === id) || L.MODELS.find((x) => x.id === L.DEFAULT_MODEL);
    return { id: m.id, skin: m.skin || m.id, keys: m.keys.map((k) => ({ n: k.n, acc: k.n, x: k.x, y: k.y, w: k.w })), w: m.width, h: m.height };
  }

  /** Whether a model id is one this module can picture. */
  const knows = (id) => IDS.includes(id);

  /**
   * Where a cap sprite goes, in the picture's pixels. `U` is pixels per key unit, (ox, oy) the key block's corner in key units.
   * The sprite reaches `mc` key units past the key on every side (for its shadow), as in preview.js.
   */
  function spriteRect(k, ox, oy, U, mc) {
    return { x: (ox + k.x - mc) * U, y: (oy + k.y - mc) * U, w: (k.w + mc * 2) * U, h: (1 + mc * 2) * U };
  }

  /** The flat top of a cap, in the picture's pixels (preview.js: faceGeo on a key drawn A.GAP in from its box). */
  function faceRect(k, ox, oy, U, face, gap) {
    const x = (ox + k.x + gap) * U;
    const y = (oy + k.y + gap) * U;
    const kw = (k.w - gap * 2) * U;
    const kh = (1 - gap * 2) * U;
    return { x: x + face.l * U, y: y + face.t * U, w: kw - (face.l + face.r) * U, h: kh - (face.t + face.b) * U };
  }

  /** The base picture's size in key units, and where the key block starts in it. */
  function frameOf(man, skinId) {
    const top = man && man.skins && man.skins[skinId] && man.skins[skinId].base;
    if (!top || !man.scale) return null;
    return { aspect: top.w / top.h, across: top.w / man.scale, ox: top.ox / man.scale, oy: top.oy / man.scale };
  }

  function draw(canvas, id, opts = {}) {
    const man = opts.manifest || (win && win.AulaBoardManifest) || null;
    const photoApi = opts.photo || BP;
    const model = modelOf(id);
    const skin = S.get(model.skin);
    const fr = frameOf(man, skin.id);
    if (!fr || !photoApi || !model.keys.length) return false;
    const dpr = Math.max(1, Math.min(2, opts.dpr || (win && win.devicePixelRatio) || 1));
    const cssW = Math.max(40, Math.round(opts.width || canvas.clientWidth || 560));
    const W = Math.round(cssW * dpr);
    const U = W / fr.across; // device pixels per key unit
    const photo = photoApi.skin(skin.id, U);
    if (!photo) return false; // still loading: nothing is half photo, half drawing
    const H = Math.round(W / fr.aspect);
    // Drawn already at this size, from this copy of the pictures: nothing to do (unless the legend font has just arrived: `force`).
    const stamp = `${id}|${W}|${H}|${photo.scale}`;
    if (!opts.force && canvas._picStamp === stamp) return true;
    canvas._picStamp = stamp;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    canvas.style.aspectRatio = String(fr.aspect); // the box keeps the picture's shape before the picture has loaded
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.base.img, 0, 0, W, H);

    // The caps
    const caps = [];
    for (const k of model.keys) {
      const acc = S.accentOf(skin, k.acc);
      const pic = photo.cap(k.w, acc ? acc.name : '-');
      const r = spriteRect(k, fr.ox, fr.oy, U, photo.mc);
      if (pic) ctx.drawImage(pic.img, r.x, r.y, r.w, r.h);
      else {
        // a width with no sprite (none should be missing): a plain cap in the skin's colours
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        const f = (acc && acc.face) || skin.cap.face;
        g.addColorStop(0, f[0]);
        g.addColorStop(1, f[1]);
        ctx.fillStyle = g;
        A.roundRect(ctx, r.x + photo.mc * U, r.y + photo.mc * U, k.w * U, U, U * 0.14);
        ctx.fill();
      }
      caps.push({ k, acc });
    }

    // The legends, printed as on the real caps: big letters, a shifted symbol above its plain one, one size for every word.
    const gap = A.GAP;
    const widths = new Map();
    const textW = (text, px) => {
      let w = widths.get(text);
      if (w === undefined) {
        ctx.font = FONT(REF);
        w = ctx.measureText(text).width;
        widths.set(text, w);
      }
      return (w * px) / REF;
    };
    const wordKinds = (k) => {
      const st = S.legendStyle(k.n, k.x);
      return st.kind === 'letter' || st.kind === 'stack' || st.kind === 'arrow' || st.kind === 'none' ? null : st;
    };
    let wordPx = U * 0.24;
    for (const { k } of caps) {
      const st = wordKinds(k);
      if (!st) continue;
      const extra = st.kind === 'shift' ? 1.45 : st.kind === 'enter' ? 2.1 : st.kind === 'back' ? 1.85 : 0; // the picture beside the word, in font sizes
      const room = k.w * U - gap * 2 * U - (photo.face.l + photo.face.r) * U - U * 0.16;
      wordPx = Math.min(wordPx, room / (textW(S.legendOf(k.n).text, 1) + extra));
    }
    wordPx = Math.max(7, wordPx);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const { k, acc } of caps) {
      const printed = S.legendOf(k.n);
      const style = S.legendStyle(k.n, k.x);
      if (!printed.text && style.kind !== 'arrow') continue;
      const f = faceRect(k, fr.ox, fr.oy, U, photo.face, gap);
      const ink = (acc && acc.legend) || skin.cap.legend;
      const lx = f.x + U * 0.08;
      ctx.fillStyle = ink;
      if (style.kind === 'letter') {
        ctx.font = FONT(U * 0.4);
        ctx.fillText(printed.text, f.x + f.w * 0.2, f.y + f.h * 0.46);
      } else if (style.kind === 'stack') {
        const [hi, lo] = printed.stack;
        ctx.font = FONT(Math.max(8, U * (hi === '~' ? 0.42 : 0.27)));
        ctx.fillText(hi, lx, f.y + f.h * (hi === '~' ? 0.26 : 0.2) + (hi === '_' ? -U * 0.06 : 0));
        ctx.font = FONT(Math.max(8.5, U * 0.31));
        ctx.fillText(lo, lx, f.y + f.h * 0.78 + (lo === '`' || lo === "'" ? U * 0.07 : 0));
      } else if (style.kind === 'arrow') {
        A.drawLegendIcon(ctx, style.dir, f.x + f.w / 2, f.y + f.h * 0.5, U * 0.4, ink);
      } else if (style.kind !== 'none') {
        ctx.font = FONT(wordPx);
        const wy = f.y + f.h * 0.5;
        let wx = lx;
        if (style.kind === 'tab') {
          A.drawLegendIcon(ctx, 'tabL', lx, f.y + f.h * 0.14, wordPx, ink);
          A.drawLegendIcon(ctx, 'tabR', lx, f.y + f.h * 0.86, wordPx, ink);
        } else if (style.kind !== 'word') {
          wx = lx + A.drawLegendIcon(ctx, style.kind, lx, wy, wordPx, ink) + wordPx * (style.kind === 'back' ? 0.35 : 0.4);
        }
        if (style.italic) {
          ctx.save();
          ctx.translate(wx, wy);
          ctx.transform(1, 0, -0.2, 1, 0, 0);
          ctx.fillText(printed.text, 0, 0);
          ctx.restore();
        } else ctx.fillText(printed.text, wx, wy);
      }
    }
    return true;
  }

  return { IDS, FAMILY, knows, modelOf, spriteRect, faceRect, frameOf, legendName, draw };
});
