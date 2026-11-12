// Liquid glass (Settings > Theme > Style). Loaded in <head>, after frost.js, so the first paint already has the right look.
//
// How it works: every glass control gets its own SVG filter. A small canvas draws a "displacement map" for the control's
// size and corner radius: at the rim the map pushes each pixel towards the middle, fading to nothing inside. The filter
// blurs what is behind the control, shifts it by that map and CSS applies it with backdrop-filter (css/glass.css).
// Chromium (so Electron) supports this.
//
// Sharpness and cost (the reasons for the choices below):
//  - The map is drawn at CSS pixels for every size (big panels used to get a half-size one, which made their rim soft). Only
//    the rim band of the map has anything in it, so only the band is calculated; the middle is filled flat. It is not drawn at
//    the screen's real pixel density: that costs four times the pixels at 200% scaling for a rim that looks the same.
//  - feDisplacementMap picks whole pixels (no smoothing), so a refracted edge came out as little stairs. A very small blur
//    after the shift (under one pixel on screen) smooths the stairs and is left out where the frost blur already hides them.
//  - The colour fringe needs a different shift per colour. Two shifts do it (red and blue; green is the mean of both), not
//    three, and with the fringe at 0 or no bending there is one shift or none. Fewer passes per control, and there are many.
//
// Two kinds of glass surface:
//  - LEAVES (TARGETS: controls, chips, pills, cards, tiles) carry the backdrop-filter themselves (class .ag).
//  - PANELS (PANELS: the boxes that hold controls) must not: an element with a backdrop-filter becomes the "backdrop" of
//    everything inside it, so a switch inside a refracting panel could no longer see the picture. A panel (class .ag-panel)
//    therefore keeps its refraction on a pseudo-element layer behind its content (css/glass.css), which is a sibling of the
//    controls, not their ancestor. The pseudo-element inherits the panel's --ag-filter.
//
// app.js owns the saved choice (prefs.style, prefs.glass) and calls set() / setParams(). Classic: nothing here runs.
(() => {
  'use strict';
  const root = document.documentElement;
  const host = window.aulaHost || null;
  const PREF_KEY = 'aula.prefs';
  const DEFAULTS = { blur: 2.5, bezel: 14, amount: 30, chroma: 30 }; // px, px, px, percent
  const LIMITS = { blur: [0, 12], bezel: [4, 28], amount: [0, 60], chroma: [0, 100] };
  const TARGETS = [
    '.tabs, .tab-ind, .seg, .switch i, .btn, .pill-btn', // controls
    '.select, .text-in, .color-pick, .win-btn, .day, .ka-chip, .ka-key', // dropdowns, inputs, window buttons, small buttons
    '.chip, .sb-chip, .stage-view, .exp-badge, .bat-bar', // pills, status chips, the battery bar
    '.effect, .hm-dev, .toast, .sup-pop, .upd-card, .upd-bar', // cards, device tiles, messages, the Support menu, dialogs
  ].join(', ');
  const PANELS = '.group, .help-body, .stage'; // boxes that hold other glass controls (see the note above)
  // A box is big next to its rim, so the same numbers that look right on a pill read as a thin outline on it. Panels get a
  // wider, stronger bending rim and a little more frost (they carry paragraphs of text) on top of the person's settings.
  const PANEL = { bezel: 2, amount: 1.25, blur: 2.5 };
  const RANGES = 'input.range'; // sliders: the native thumb is hidden and a glass lens is drawn over it (see "sliders" below)
  const THUMB = 42; // px, width of the native (invisible) thumb: the lens rests on it, so the travel stays the same
  const PEEK_MS = 700; // how long the lens stays swollen after a key press or wheel nudge

  function clean(p) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const v = p && p[k] != null && p[k] !== '' && Number.isFinite(+p[k]) ? +p[k] : DEFAULTS[k];
      out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    }
    return out;
  }

  // Same lookup order as theme.js: the desktop app's data file first, then localStorage.
  let saved = {};
  try {
    let raw = null;
    try {
      if (host && host.loadMemory) raw = (host.loadMemory() || {})[PREF_KEY] ?? null;
    } catch (_) {
      raw = null;
    }
    if (raw == null) raw = localStorage.getItem(PREF_KEY);
    saved = JSON.parse(raw || '{}') || {};
  } catch (_) {
    saved = {};
  }
  let on = saved.style === 'glass';
  let params = clean(saved.glass);
  root.classList.toggle('glass', on);

  // ---- displacement map: for a w x h rounded box, where each pixel at the rim should look from (R = x, G = y; 128 = still).
  // Drawn at CSS pixels, and only where it is not flat (see the header).
  const maps = new Map();
  const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1)); // sizes the smoothing blur (see smoothing())
  const FLAT = new Uint32Array(1); // one "still" pixel (128, 128, 128, opaque), written byte by byte so byte order never matters
  new Uint8Array(FLAT.buffer).set([128, 128, 128, 255]);
  function mapUrl(w, h, r, bezel) {
    const key = `${w}x${h}r${Math.round(r)}b${bezel}`;
    if (maps.has(key)) return maps.get(key);
    if (maps.size > 60) maps.clear(); // panels have large maps and sizes change while the window is dragged
    const mw = Math.max(1, w);
    const mh = Math.max(1, h);
    const mr = r;
    const mb = Math.max(1, bezel);
    const cv = document.createElement('canvas');
    cv.width = mw;
    cv.height = mh;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(mw, mh);
    const px = img.data;
    new Uint32Array(px.buffer).fill(FLAT[0]);
    const hw = mw / 2;
    const hh = mh / 2;
    const side = Math.ceil(mb) + 1; // columns at each side that can hold a bend, on rows that are not near the top or bottom
    const cell = (x, y) => {
      const cx = x + 0.5 - hw;
      const cy = y + 0.5 - hh;
      const qx = Math.abs(cx) - (hw - mr);
      const qy = Math.abs(cy) - (hh - mr);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const depth = mr - outside - Math.min(Math.max(qx, qy), 0); // how far inside the rim this pixel is
      if (depth >= mb) return;
      let nx;
      let ny; // outward normal
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        nx = (Math.sign(cx) * qx) / len;
        ny = (Math.sign(cy) * qy) / len;
      } else if (qx > qy) {
        nx = Math.sign(cx);
        ny = 0;
      } else {
        nx = 0;
        ny = Math.sign(cy);
      }
      const t = Math.max(depth, 0) / mb;
      const mag = (1 - t) * (1 - t); // strongest on the rim, eases to nothing
      const i = (y * mw + x) * 4;
      px[i] = Math.round(127.5 - nx * mag * 127.5); // look from further in: the rim bends the picture inwards
      px[i + 1] = Math.round(127.5 - ny * mag * 127.5);
    };
    for (let y = 0; y < mh; y++) {
      const qy = Math.abs(y + 0.5 - hh) - (hh - mr);
      if (qy >= -mb - 1 || side * 2 >= mw) {
        for (let x = 0; x < mw; x++) cell(x, y); // near the top or bottom edge: the whole row can bend
      } else {
        for (let x = 0; x < side; x++) cell(x, y);
        for (let x = mw - side; x < mw; x++) cell(x, y);
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = cv.toDataURL('image/png');
    maps.set(key, url);
    return url;
  }

  // ---- one SVG filter per distinct (size, radius, settings); shared by surfaces that match, and dropped when none uses it
  let defs = null;
  const filters = new Map(); // key -> { id, node, refs }
  let seq = 0;
  function ensureDefs() {
    if (defs && defs.isConnected) return;
    const holder = document.createElement('div');
    holder.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;pointer-events:none"><defs></defs></svg>';
    const svg = holder.firstChild;
    document.body.append(svg);
    defs = svg.firstChild;
    filters.clear();
  }
  // Keeps one colour channel of an image (and its alpha); `g` scales green, so the green of two shifts can be averaged.
  const keep = (r, g, b) => `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
  // The size, in CSS pixels, of the small blur after the shift (0: none). About 0.75 screen pixels, which hides the
  // one-pixel stairs of the shift. With a strong frost blur there are no stairs to hide, so it is left out (saves a pass).
  const smoothing = (blur) => (blur >= 4 ? 0 : Math.max(0.3, 0.75 / dpr()));
  function makeFilter(id, w, h, r, bezel, blur, amount) {
    const s = amount * 2; // feDisplacementMap moves a pixel by scale * (value - 0.5)
    const ca = (params.chroma / 100) * 0.6;
    const frost = `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" edgeMode="duplicate" result="b"/>`;
    const disp = (k, result) =>
      `<feDisplacementMap in="b" in2="m" scale="${(s * k).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
    let body;
    if (s === 0) {
      body = frost; // nothing to bend: just the frost, no map at all
    } else {
      const soft = smoothing(blur);
      const map = `<feImage href="${mapUrl(w, h, r, bezel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`;
      const post = soft ? `<feGaussianBlur stdDeviation="${soft.toFixed(2)}" edgeMode="duplicate"/>` : '';
      if (ca === 0) {
        body = frost + map + disp(1, 'o') + post; // no colour fringe: one shift
      } else {
        // Red is shifted a little more and blue a little less. Green is the mean of both, so two shifts give three colours.
        body =
          frost +
          map +
          disp(1 + ca, 'dA') +
          disp(1 - ca, 'dB') +
          `<feColorMatrix in="dA" type="matrix" values="${keep(1, 0.5, 0)}" result="cA"/>` +
          `<feColorMatrix in="dB" type="matrix" values="${keep(0, 0.5, 1)}" result="cB"/>` +
          `<feComposite in="cA" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"${post ? ' result="o"' : ''}/>` +
          post;
      }
    }
    const holder = document.createElement('div');
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${body}</filter></svg>`;
    return holder.firstChild.firstChild;
  }
  // Gives `el` the filter that fits its size (making it if nobody has one like it) and lets go of the one it had.
  function acquire(el, w, h, radius, panel) {
    const r = Math.min(radius, w / 2, h / 2);
    const bezel = Math.min(params.bezel * (panel ? PANEL.bezel : 1), Math.min(w, h) / 2);
    const blur = params.blur + (panel ? PANEL.blur : 0);
    const amount = params.amount * (panel ? PANEL.amount : 1);
    const key = `${w}x${h}r${Math.round(r)}b${bezel}|${blur}|${amount}|${params.chroma}|${dpr()}`;
    if (el._agKey === key && filters.has(key)) return filters.get(key).id;
    drop(el);
    let f = filters.get(key);
    if (!f) {
      const id = `ag-${++seq}`;
      const node = makeFilter(id, w, h, r, bezel, blur, amount);
      defs.append(node);
      f = { id, node, refs: 0, key };
      filters.set(key, f);
    }
    f.refs++;
    el._agKey = key;
    return f.id;
  }
  function drop(el) {
    const f = el._agKey && filters.get(el._agKey);
    el._agKey = null;
    if (f && --f.refs <= 0) {
      f.node.remove();
      filters.delete(f.key);
    }
  }

  // ---- sliders: the thumb is a glass lens. At rest it is a small frosted pill; while held it swells into a clear lens that
  // bends the track (css/glass.css does the looks). The native <input type=range> stays in charge of dragging, keys and
  // screen readers; the lens is a decorative sibling that follows its value. It goes through the same refraction filter as
  // every other control: it is laid out at its swollen size and shrunk with CSS `scale`, so the filter is built only once.
  const lensOf = new Map(); // range input -> { lens, off() }
  const roRange = new ResizeObserver((entries) => {
    if (!on) return;
    for (const e of entries) {
      const rec = lensOf.get(e.target);
      if (rec) rec.place();
    }
  });
  function mountRange(rng) {
    if (lensOf.has(rng) || !rng.parentNode) return;
    const lens = document.createElement('span');
    lens.className = 'range-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<i></i>'; // the magnified bar you see through the lens while it is held
    rng.after(lens);
    let peek = 0;
    const hold = (v) => lens.classList.toggle('held', v);
    const place = () => {
      const w = rng.offsetWidth;
      if (!w) return; // hidden for now: the observer fires again when it is shown
      const min = rng.min === '' ? 0 : +rng.min;
      const max = rng.max === '' ? 100 : +rng.max;
      const pf = max > min ? Math.min(1, Math.max(0, (+rng.value - min) / (max - min))) : 0;
      lens.style.setProperty('--lx', `${rng.offsetLeft + THUMB / 2 + (w - THUMB) * pf}px`);
      lens.style.setProperty('--ly', `${rng.offsetTop + rng.offsetHeight / 2}px`);
      lens.style.setProperty('--lp', String(pf));
    };
    const letGo = () => {
      hold(false);
      window.removeEventListener('pointerup', letGo, true);
      window.removeEventListener('pointercancel', letGo, true);
    };
    const onDown = (e) => {
      if (rng.disabled || (e.button != null && e.button > 0)) return;
      clearTimeout(peek);
      hold(true);
      window.addEventListener('pointerup', letGo, true);
      window.addEventListener('pointercancel', letGo, true);
    };
    const onInput = () => {
      place();
      if (lens.classList.contains('held')) return; // already swollen by the pointer
      hold(true); // a key press or wheel nudge: swell briefly so the change is visible
      clearTimeout(peek);
      peek = setTimeout(() => hold(false), PEEK_MS);
    };
    rng.addEventListener('pointerdown', onDown);
    rng.addEventListener('input', onInput);
    rng.addEventListener('change', place);
    rng.addEventListener('blur', letGo);
    // app.js moves a slider by setting .value and the --pf variable on its style, which fires no event: watch the style
    const watch = new MutationObserver(place);
    watch.observe(rng, { attributes: true, attributeFilter: ['style', 'min', 'max', 'disabled'] });
    roRange.observe(rng);
    live.add(lens);
    ro.observe(lens); // reports the size straight away, which gives the lens its refraction filter
    lensOf.set(rng, {
      lens,
      place,
      off() {
        clearTimeout(peek);
        letGo();
        rng.removeEventListener('pointerdown', onDown);
        rng.removeEventListener('input', onInput);
        rng.removeEventListener('change', place);
        rng.removeEventListener('blur', letGo);
        watch.disconnect();
        roRange.unobserve(rng);
        live.delete(lens);
        ro.unobserve(lens);
        drop(lens);
        lens.remove();
      },
    });
    place();
  }
  function unmountRanges() {
    for (const rec of lensOf.values()) rec.off();
    lensOf.clear();
  }

  // ---- which controls are glass, and keeping each one's filter right as it appears, resizes or is shown
  const live = new Set();
  const dirty = new Set();
  let raf = 0;
  let scanTimer = 0;
  const ro = new ResizeObserver((entries) => {
    if (!on) return;
    for (const e of entries) queue(e.target);
  });
  const settle = new WeakMap(); // panel -> timer: a panel is repainted once its size has stopped changing (its map is big)
  function queue(el) {
    if (el.classList.contains('ag-panel') && el._agKey) {
      clearTimeout(settle.get(el));
      settle.set(el, setTimeout(() => queueNow(el), 140));
      return;
    }
    queueNow(el);
  }
  function queueNow(el) {
    dirty.add(el);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function flush() {
    raf = 0;
    if (!on) return dirty.clear();
    ensureDefs();
    for (const el of dirty) paint(el);
    dirty.clear();
  }
  function paint(el) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!w || !h || !el.isConnected) return; // hidden for now: the observer fires again when it is shown
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const panel = el.matches(PANELS);
    el.style.setProperty('--ag-filter', `url(#${acquire(el, w, h, radius, panel)})`);
    el.classList.add(panel ? 'ag-panel' : 'ag');
  }
  function scan() {
    scanTimer = 0;
    if (!on) return;
    for (const el of live) {
      if (!el.isConnected) {
        live.delete(el);
        ro.unobserve(el);
        clearTimeout(settle.get(el));
        drop(el);
      }
    }
    for (const el of document.querySelectorAll(`${TARGETS}, ${PANELS}`)) {
      if (live.has(el)) continue;
      live.add(el);
      ro.observe(el); // reports the size straight away, which paints it
    }
    for (const [rng, rec] of lensOf) {
      if (!rng.isConnected) {
        rec.off();
        lensOf.delete(rng);
      }
    }
    for (const rng of document.querySelectorAll(RANGES)) mountRange(rng);
  }
  const mo = new MutationObserver(() => {
    if (!scanTimer) scanTimer = setTimeout(scan, 150);
  });
  // A new pixel density (zoom, or the window moved to another screen) changes the size of the smoothing blur.
  let seenDpr = dpr();
  function onResize() {
    const now = dpr();
    if (now === seenDpr) return;
    seenDpr = now;
    if (on) repaintAll();
  }
  function repaintAll() {
    ensureDefs();
    defs.replaceChildren();
    filters.clear();
    for (const el of live) {
      el._agKey = null;
      queueNow(el);
    }
  }
  function release() {
    mo.disconnect();
    if (window.removeEventListener) window.removeEventListener('resize', onResize);
    clearTimeout(scanTimer);
    scanTimer = 0;
    dirty.clear();
    unmountRanges();
    for (const el of live) {
      ro.unobserve(el);
      clearTimeout(settle.get(el));
      el._agKey = null;
      el.classList.remove('ag', 'ag-panel');
      el.style.removeProperty('--ag-filter');
    }
    live.clear();
    if (defs) defs.replaceChildren();
    filters.clear();
    maps.clear();
  }
  function start() {
    if (!document.body) return;
    ensureDefs();
    mo.observe(document.body, { childList: true, subtree: true });
    seenDpr = dpr();
    if (window.addEventListener) window.addEventListener('resize', onResize);
    scan();
  }

  window.AulaGlass = {
    DEFAULTS,
    LIMITS,
    clean,
    isOn: () => on,
    params: () => ({ ...params }),
    set(next) {
      next = !!next;
      if (next === on) return;
      on = next;
      root.classList.toggle('glass', on);
      if (on) start();
      else release();
    },
    setParams(p) {
      const next = clean({ ...params, ...p });
      if (next.bezel !== params.bezel) maps.clear();
      params = next;
      if (on) repaintAll();
    },
  };

  if (on) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
