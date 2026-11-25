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
// The rim is a real reflection, not a painted line. Every filter ends with a thin band along the edge of the surface that shows
// the picture itself: the colours that lie just inside the rim (bent by the rim, or pulled in from inside on a small surface),
// brightened and made richer, and shown only where the edge faces the light. How much of it shows depends on the angle of the
// edge at that very spot (rimMapUrl below): the strongest where the edge faces the light (top left), a softer bounce on the
// opposite side (bottom right), a faint thread elsewhere, and it turns smoothly round every corner. The old look was a few
// fixed white lines painted with box-shadow, the same on every control whatever was behind it.
//
// Sliders and scroll bars are glass too: the slider thumb and the scroll bar thumb are lenses laid over the native control (see
// "sliders" and "scroll bars" below). The update dialog's progress bar is a glass tube like the rest (.upd-bar, in TARGETS); its
// fill is plain CSS (css/glass.css), with no lens: a lens at the head would make it look like a slider.
//
// Two TYPES of glass (Settings > Theme > Liquid glass > Glass type), chosen with prefs.glassType:
//  - NORMAL (the default) is the glass of iOS bars, Telegram and most music players: the picture behind a surface is blurred and
//    tinted, and the edge is a thin light line that is brightest at the top left and the bottom right. Nothing here measures,
//    draws a map or builds a filter for it: the page only carries one blur on <html> (--ag-filter) and marks the surfaces (.ag,
//    .ag-panel) so css/glass.css and css/glass-normal.css can paint them. It is cheap, so it never lags.
//  - REALISTIC is thick glass: each surface bends the picture at the rim, with a colour fringe and a reflection. The graphics card
//    draws it: one WebGL shader per surface (js/glass-gpu.js), so it stays smooth and nothing is encoded when a setting changes.
//    The few surfaces that must bend HTML (the slider lens, the tab highlight, the scroll thumb, menus, messages, dialogs and the apply bar) cannot be
//    drawn on a canvas, so they use an SVG filter each. If WebGL, or the picture, is not available, every surface uses its SVG filter
//    instead (gpuFailed below), so Realistic still looks the same, only heavier.
//    The sliders cannot make those filters cheaper: they only change numbers inside each filter (how far it shifts, how wide the
//    rim is), never whether it runs, and a filter that shifts by 0 still blurs, draws a rim map and runs the reflection on every
//    surface, again every frame the picture behind it moves (a scroll, a page change). So with Refraction at 0 (nothing to bend)
//    Realistic takes the NORMAL path instead (isLight below): one plain blur, a painted edge, no filter at all. It keeps
//    Realistic's own blur scale, so the frost looks the same as it did, and it is as light as Normal.
//    (Older versions had a separate "GPU" type next to an SVG-only "Realistic". They are one type now: a saved 'gpu' is Realistic,
//    and so is a saved 'realistic'.)
//
// app.js owns the saved choice (prefs.style, prefs.glassType, prefs.glass) and calls set() / setType() / setParams(). Classic: nothing here runs.
(() => {
  'use strict';
  const root = document.documentElement;
  const host = window.aulaHost || null;
  const PREF_KEY = 'aula.prefs';
  const DEFAULTS = { blur: 2.5, bezel: 14, amount: 60, chroma: 30 }; // px, px, px, percent
  const LIMITS = { blur: [0, 12], bezel: [4, 28], amount: [0, 60], chroma: [0, 100] };
  // The ready-made looks in Settings > Theme > Liquid glass (the same four numbers the sliders set). Blur glass is the default look.
  // All four share the Default look's edge width (14) and its strongest bend (Refraction at its top, 60); they differ only in Blur
  // and Colour fringe. Clear: no frost at all and a colour fringe, so the picture shows through. Blur glass: a soft frost and a
  // fringe. Frosted: heavy blur and no colour fringe, so it reads like frosted glass. Default: the Blur glass frost with no colour
  // fringe. A look the sliders land on by hand is "custom".
  const PRESETS = {
    clear: { blur: 0, bezel: 14, amount: 60, chroma: 35 },
    blur: { ...DEFAULTS },
    frosted: { blur: 9, bezel: 14, amount: 60, chroma: 0 },
    default: { blur: 2.5, bezel: 14, amount: 60, chroma: 0 },
  };
  // The two types of glass (see the header). Normal is the default, and anything unknown counts as Normal. A saved 'gpu' (the name
  // the graphics card type had before it became Realistic) is Realistic.
  const TYPES = ['normal', 'realistic'];
  const DEFAULT_TYPE = 'normal';
  const cleanType = (t) => (t === 'realistic' || t === 'gpu' ? 'realistic' : DEFAULT_TYPE);
  // Normal glass has nothing that bends the picture, so the Blur slider is the whole look. A blur is far more visible as the only
  // thing between you and the picture than it was inside a bending filter, so a point of the slider is worth NORMAL.blur px of blur:
  // the default 2.5 is about 11 px, Frosted (9) about 40 px, 0 stays clear.
  const NORMAL = { blur: 4.5 };
  const TARGETS = [
    '.tabs, .tab-ind, .seg, .btn, .pill-btn', // controls
    '.select, .text-in, .color-pick, .win-btn, .day, .ka-chip, .ka-key', // dropdowns, inputs, window buttons, small buttons
    '.chip, .sb-chip, .stage-view, .exp-badge, .bat-bar', // pills, status chips, the battery bar
    '.effect, .hm-dev, .sp-card, .toast, .sup-pop, .sel-pop, .upd-card, .upd-bar', // cards, device tiles, the UI choice, messages, the Support menu, the dropdown menu, dialogs, the update progress bar
  ].join(', ');
  const PANELS = '.group, .help-body, .stage, .applybar'; // boxes that hold other glass controls (see the note above); the Unsaved changes bar holds Revert and Apply
  // A box is big next to its rim, so the same numbers that look right on a pill read as a thin outline on it. Panels get a
  // wider, stronger bending rim and a little more frost (they carry paragraphs of text) on top of the person's settings.
  const PANEL = { bezel: 1.6, amount: 0.6, blur: 2 };
  // The big blocks are a lighter glass than the controls: a gentler bend, half the colour fringe and a thinner, softer reflection on the edge
  // (their tint and sheen are lighter too, in css/glass.css). The reflection settings replace RIM's, like RIM.lens does for the lenses.
  const PANEL_FRINGE = 0.5; // times the person's Colour fringe setting
  const PANEL_RIM = { gain: 1.45, lift: 0.05, floor: 0.12, width: -0.5 };
  // The extra frost of a panel follows the Blur slider down: it is the full PANEL.blur from the default setting up, and fades to
  // nothing at 0, so that 0 really is clear glass (before, a panel kept 2.5 px of blur however low the slider went).
  const panelFrost = (panel) => (panel ? PANEL.blur * Math.min(1, params.blur / DEFAULTS.blur) : 0);
  // The pull of the rim is in pixels, so on a small control it can reach past the control itself: a 28 px pill pulled the picture
  // from 30 px away, and everything the pull fetched from outside the pill came back empty. Red is pulled further than blue, so
  // red and green came back empty first and the rim kept only a blue line (the odd blue edge on pills, chips and the scroll
  // thumb). So how far the rim may pull is held to a share of the control's shorter side, and so is the gap between the colours.
  // Cards and panels are big next to both limits, so they look exactly as the settings say.
  const REACH = 0.3; // the strongest pull, as a share of the shorter side (a pill 44 px high: 13.2 px)
  const FRINGE = 0.1; // the widest gap between the red and the blue shift, as a share of the shorter side (80 px: 8 px)
  // Holding the pull inside the control was not enough: on a small control even a short pull bends everything in it (a 26 px chip
  // had its whole face squeezed towards the middle), and splitting red from blue on top of that put a blue line round the edge of
  // every chip, pill, switch knob and scroll thumb. So the smallest surfaces are plain frosted glass (no bending, no colour split),
  // and the colour split is kept for surfaces big enough to show it as a soft glow on the rim, not as a line.
  const FLAT_BELOW = 36; // px, shorter side: under this a surface is only frosted (chips, the Live/Picture switch, switch knobs, scroll thumbs)
  const FRINGE_FROM = 64; // px, shorter side: the red/blue split is only for surfaces at least this size (cards, panels, the stage)
  // The rim reflection (see the header). Light comes from the top left; `d` below is how squarely an edge faces it (-1 to 1).
  const RIM = {
    light: [-0.62, -0.78], // direction towards the light (x right, y down): top left
    floor: 0.2, // a faint thread of reflection all the way round, so no edge ever vanishes
    hi: 1, // the share that faces the light (d > 0)
    bounce: 0.7, // the share that faces away (d < 0): the light that comes back from the far side of the glass
    power: 1.3, // how quickly the reflection falls off as the edge turns away from the light
    sat: 1.5, // the reflected colours are richer than the picture ...
    gain: 2.2, // ... brighter ...
    lift: 0.12, // ... and never fully dark, so even a dark picture leaves a visible edge
    width: [2, 3], // px, how deep the reflection reaches in from the edge (smallest and largest) ...
    widthShare: 0.05, // ... as a share of the shorter side
    // The slider thumb and the sliding tab highlight are clear lenses, held and dragged by hand: they get a brighter, deeper reflection.
    lens: { gain: 2.8, lift: 0.3, floor: 0.4, width: 0.9 }, // gain and lift replace the ones above, floor too, width is added
    pull: [3, 9], // px, on a surface too small to bend: how far in the reflected colours are fetched from (smallest and largest) ...
    pullShare: 0.32, // ... as a share of the shorter side
  };

  const LENSES = '.range-lens, .tab-ind'; // clear lenses that are held and dragged: their rim reflects more (see RIM.lens)
  // The slider lens is different from the other lens: it is a clear drop you look through at the track, and the track runs through
  // its middle. To show the bar bending round the edge the rim has to pull from as far in as the middle (so the reach is the whole
  // half-height, not 30%), with a wide bezel, and the frost is nearly off so the bar inside stays sharp. Its reflection is a thin,
  // soft line: the lens is clear, the edge only has to be seen.
  const SLIDER_LENS = '.range-lens';
  const SLIDER = {
    amount: 1.7, // times the person's Refraction setting
    reach: 0.36, // the strongest pull, as a share of the shorter side (a lens 44 px high: 22 px, the middle of it)
    bezel: 1.1, // times the person's Edge width setting
    blur: 0.25, // times the person's Blur setting
    rim: { gain: 1.15, lift: 0.04, floor: 0.16, width: 0.45 }, // like RIM.lens, softer
  };
  // `lens` is false (a plain surface), true (the tab highlight and other lenses) or 'slider' (the slider lens). Its reflection settings:
  const lensRim = (lens) => (lens === 'slider' ? SLIDER.rim : lens === 'panel' ? PANEL_RIM : lens ? RIM.lens : null);
  const RANGES = 'input.range'; // sliders: the native thumb is hidden and a glass lens is drawn over it (see "sliders" below)
  const THUMB = 42; // px, width of the native (invisible) thumb: the lens rests on it, so the travel stays the same
  const PEEK_MS = 700; // how long the lens stays swollen after a key press or wheel nudge
  const JELLY_SPEED = 14; // px per frame of pointer speed at which the held lens stretches the most
  const GLIDE_HELD_MS = 25; // the slider lens follows the pointer with this time constant (a snug follow, no steps) ...
  const GLIDE_MS = 70; // ... and settles into its step with this one after letting go, a key press or a change from the page
  const SCROLLERS = '.panels, #maxRoot, .upd-body'; // the areas that scroll: their native bar is hidden and a glass one is drawn
  const SB_GRAB = 18; // px, width of the strip you can grab (the glass thumb in it is 12 px: css/glass.css)
  const SB_INSET = 8; // px, space above and below the thumb's track
  const SB_MIN = 40; // px, the shortest the thumb gets, however long the page is
  const SB_BUSY_MS = 900; // how long the thumb stays bright after the page scrolled

  function clean(p) {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const v = p && p[k] != null && p[k] !== '' && Number.isFinite(+p[k]) ? +p[k] : DEFAULTS[k];
      out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    }
    return out;
  }

  // Which ready-made look the numbers are: 'clear', 'blur', 'frosted' or 'default', or 'custom' when they match none of them.
  function presetOf(p) {
    const c = clean(p);
    for (const name of Object.keys(PRESETS)) if (Object.keys(DEFAULTS).every((k) => c[k] === PRESETS[name][k])) return name;
    return 'custom';
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
  let type = cleanType(saved.glassType);
  // LIGHT glass paints a surface with one plain blur and a painted edge and builds no SVG filter. Normal is always light; Realistic is
  // light while Refraction is 0 (see the header). Everything below that used to ask "is it Normal?" asks this.
  const isLight = () => type === 'normal' || params.amount === 0;
  const syncClass = () => root.classList.toggle('glass-normal', on && isLight()); // css/glass-normal.css reads it; Classic and a bending Realistic never carry it

  // Realistic is drawn by the graphics card: the renderer (js/glass-gpu.js) and what it may not take. It draws the surfaces that sit on the page; these bend HTML (the
  // controls and text under them, which a canvas below the page cannot see), so they keep their SVG filters.
  let gpu = null; // the renderer while the graphics card is drawing Realistic, otherwise null
  let gpuFailed = false; // WebGL or the picture refused: Realistic uses the SVG filters on every surface until the page is reloaded
  const GPU_NOT = '.toast, .sup-pop, .sel-pop, .upd-card, .upd, .applybar, .range-lens, .tab-ind, .ag-scroll-thumb';
  const gpuWanted = () => on && type === 'realistic' && !isLight() && !gpuFailed && !!window.AulaGpuGlass;
  const gpuTakes = (el) => !!gpu && !el.closest(GPU_NOT);
  function initGpu() {
    if (gpu || !gpuWanted()) return;
    gpu = window.AulaGpuGlass.create({
      shell: document.querySelector('.shell'),
      onFail: () => {
        // WebGL was lost or the picture cannot be read: carry on with the SVG filters, in the next turn of the event loop
        gpuFailed = true;
        setTimeout(() => {
          if (on) rebuild();
        }, 0);
      },
    });
    if (!gpu) gpuFailed = true;
    root.classList.toggle('glass-gpu', !!gpu);
  }
  function stopGpu() {
    if (gpu) gpu.destroy();
    gpu = null;
    root.classList.toggle('glass-gpu', false);
    for (const el of live) if (el.classList) el.classList.toggle('ag-gpu', false);
  }
  root.classList.toggle('glass', on);
  syncClass();

  // ---- Normal glass: one blur for every surface. It is a variable on <html> that every glass rule reads as its backdrop filter (the
  // same variable Realistic sets per surface to a url(#filter)), so the stylesheet has a single path and the surfaces need no
  // measuring. Realistic removes it again, because there each surface carries its own.
  const normalBlur = () => Math.round(params.blur * NORMAL.blur * 10) / 10;
  // Realistic without bending keeps Realistic's own scale (a point of the slider is a pixel of blur, as inside its filters), so
  // dragging Refraction down to 0 does not change how frosted the glass looks.
  const lightBlur = () => (type === 'normal' ? normalBlur() : Math.round(params.blur * 10) / 10);
  function applyNormal() {
    if (root.style) root.style.setProperty('--ag-filter', `blur(${lightBlur()}px)`);
  }
  function clearNormal() {
    if (root.style) root.style.removeProperty('--ag-filter');
  }
  // A surface of Normal glass needs only its class (the page does the rest); Realistic also gives it a filter, in paint() below.
  function markNormal(el) {
    const panel = el.matches(PANELS);
    el.classList.add(panel ? 'ag-panel' : 'ag');
    // Realistic's boxes carry a little more frost than its controls (panelFrost), and keep it without the bending. Normal glass has
    // one blur for every surface, so nothing is set on the surface itself (and an old one is removed).
    if (el.style) {
      if (panel && type !== 'normal') el.style.setProperty('--ag-filter', `blur(${Math.round((params.blur + panelFrost(true)) * 100) / 100}px)`);
      else if (el.style.getPropertyValue('--ag-filter')) el.style.removeProperty('--ag-filter');
    }
  }

  // ---- displacement map: for a w x h rounded box, where each pixel at the rim should look from (R = x, G = y; 128 = still).
  // Drawn at CSS pixels, and only where it is not flat (see the header).
  const maps = new Map();
  // One canvas does for every map: making a canvas and its 2d context for each of them was a big part of what a new size cost.
  // Setting the size also clears it, so each map starts empty.
  // The oldest maps go first when there are too many (all of them used to go at once, which made the next page start from nothing).
  const MAPS_MAX = 480;
  function trimMaps() {
    while (maps.size >= MAPS_MAX) maps.delete(maps.keys().next().value);
  }
  let scratch = null;
  function scratchCanvas(w, h) {
    if (!scratch) {
      const cv = document.createElement('canvas');
      scratch = { cv, ctx: cv.getContext('2d') };
    }
    scratch.cv.width = w;
    scratch.cv.height = h;
    return scratch;
  }
  const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1)); // sizes the smoothing blur (see smoothing())
  const FLAT = new Uint32Array(1); // one "still" pixel (128, 128, 128, opaque), written byte by byte so byte order never matters
  new Uint8Array(FLAT.buffer).set([128, 128, 128, 255]);
  function mapUrl(w, h, r, bezel) {
    const key = `${w}x${h}r${Math.round(r)}b${bezel}`;
    if (maps.has(key)) return maps.get(key);
    trimMaps(); // panels have large maps and sizes change while the window is dragged
    const mw = Math.max(1, w);
    const mh = Math.max(1, h);
    const mr = r;
    const mb = Math.max(1, bezel);
    const { cv, ctx } = scratchCanvas(mw, mh);
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

  // ---- the rim map: for a w x h rounded box, a thin band along the edge that says, pixel by pixel, how much reflection shows
  // (B) and which way the edge faces (R, G: 128 = still; the same coding as the displacement map above, so the same pixels can
  // be fetched from inside). Only the band is drawn; the rest is flat and empty (B = 0). Drawn at CSS pixels like the other map.
  const RIM_LIGHT = (() => {
    const len = Math.hypot(RIM.light[0], RIM.light[1]) || 1;
    return [RIM.light[0] / len, RIM.light[1] / len];
  })();
  const FLAT_RIM = new Uint32Array(1);
  new Uint8Array(FLAT_RIM.buffer).set([128, 128, 0, 255]);
  // How deep the reflection reaches (width) and, on a surface too small to bend, how far in its colours are fetched from (pull).
  function rimSpec(w, h, lens) {
    const side = Math.min(w, h);
    const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    const width = Math.round((clamp(side * RIM.widthShare, RIM.width) + (lens ? lensRim(lens).width : 0)) * 10) / 10;
    const pull = Math.round(Math.min(clamp(side * RIM.pullShare, RIM.pull), side * 0.45) * 10) / 10; // never from beyond the middle
    return { width, pull };
  }
  // How strongly the reflection shows where the edge's outward normal is (nx, ny): 0 to 1.
  function rimLight(nx, ny, lens) {
    const d = nx * RIM_LIGHT[0] + ny * RIM_LIGHT[1];
    const lit = RIM.hi * Math.pow(Math.max(d, 0), RIM.power);
    const back = RIM.bounce * Math.pow(Math.max(-d, 0), RIM.power);
    return Math.min(1, (lens ? lensRim(lens).floor : RIM.floor) + lit + back);
  }
  function rimMapUrl(w, h, r, width, lens) {
    const key = `rim${w}x${h}r${Math.round(r)}w${width}${lens === 'slider' ? 'S' : lens === 'panel' ? 'P' : lens ? 'L' : ''}`;
    if (maps.has(key)) return maps.get(key);
    trimMaps();
    const mw = Math.max(1, w);
    const mh = Math.max(1, h);
    const { cv, ctx } = scratchCanvas(mw, mh);
    const img = ctx.createImageData(mw, mh);
    const px = img.data;
    new Uint32Array(px.buffer).fill(FLAT_RIM[0]);
    const hw = mw / 2;
    const hh = mh / 2;
    const reach = width + 0.5;
    const side = Math.ceil(reach) + 1; // columns at each side that can hold the band, on rows that are not near the top or bottom
    const cell = (x, y) => {
      const cx = x + 0.5 - hw;
      const cy = y + 0.5 - hh;
      const qx = Math.abs(cx) - (hw - r);
      const qy = Math.abs(cy) - (hh - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const depth = r - outside - Math.min(Math.max(qx, qy), 0); // how far inside the edge this pixel is
      if (depth >= reach) return;
      let nx;
      let ny; // outward normal: the way this bit of edge faces
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
      const t = Math.min(1, Math.max(0, 1 - (Math.max(depth, 0) - 0.5) / width)); // 1 on the edge, 0 at the inner end of the band
      const fade = t * t * (3 - 2 * t); // smooth, so the reflection has no hard inner line
      const i = (y * mw + x) * 4;
      px[i] = Math.round(127.5 - nx * 127.5);
      px[i + 1] = Math.round(127.5 - ny * 127.5);
      px[i + 2] = Math.round(255 * fade * rimLight(nx, ny, lens));
    };
    for (let y = 0; y < mh; y++) {
      const qy = Math.abs(y + 0.5 - hh) - (hh - r);
      if (qy >= -reach - 1 || side * 2 >= mw) {
        for (let x = 0; x < mw; x++) cell(x, y); // near the top or bottom edge: the whole row holds the band
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
  let pending = null; // while a batch is painted, the new filters wait here and go into the page together (see flush)
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
  // The colour matrix that turns the picture at the rim into its reflection: richer (saturation), brighter (gain), never fully dark (lift).
  function rimBoost(lens) {
    const { sat } = RIM;
    const gain = lens ? lensRim(lens).gain : RIM.gain;
    const lift = lens ? lensRim(lens).lift : RIM.lift;
    const lum = [0.2126, 0.7152, 0.0722]; // how much each colour counts towards brightness
    const rows = lum.map((_, row) => lum.map((l, col) => (l * (1 - sat) + (row === col ? sat : 0)) * gain));
    const f = (v) => v.toFixed(4);
    return rows.map((r3) => `${r3.map(f).join(' ')} 0 ${f(lift)}`).join('  ') + '  0 0 0 1 0';
  }
  // The reflection: a band along the edge, in the picture's own colours, brighter where the edge faces the light.
  //  - `from` is the picture the colours come from: the bent picture (`o`) where the surface bends, so the reflection is what the rim
  //    bends in from inside; on a surface too small to bend it is the frosted picture fetched again from `pull` px further in (the
  //    direction of each edge is in the map), so even a 12 px thumb reflects what lies inside it, not a fixed white line;
  //  - the map's blue channel says how much of it shows at each pixel (it becomes the mask's alpha).
  function rimPass(w, h, r, base, bent, lens) {
    const { width, pull } = rimSpec(w, h, lens);
    const map = `<feImage href="${rimMapUrl(w, h, r, width, lens)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="rm"/>`;
    const fetch = bent
      ? ''
      : `<feDisplacementMap in="${base}" in2="rm" scale="${(pull * 2).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="rr"/>`;
    return (
      map +
      fetch +
      `<feColorMatrix in="${bent ? 'o' : 'rr'}" type="matrix" values="${rimBoost(lens)}" result="rc"/>` +
      '<feColorMatrix in="rm" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="ra"/>' +
      '<feComposite in="rc" in2="ra" operator="in" result="rl"/>' +
      `<feComposite in="rl" in2="${base}" operator="over" result="f"/>`
    );
  }
  function makeFilter(id, w, h, r, bezel, blur, amount, ca, lens) {
    const s = amount * 2; // feDisplacementMap moves a pixel by scale * (value - 0.5)
    // A blur of 0 changes nothing, but the primitive would still be a pass over the whole surface, so with Blur at 0 (the Clear look)
    // the picture is used as it is and the later steps read it from there.
    const src = blur > 0 ? 'b' : 'SourceGraphic';
    const frost = blur > 0 ? `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" edgeMode="duplicate" result="b"/>` : '';
    const disp = (k, result) =>
      `<feDisplacementMap in="${src}" in2="m" scale="${(s * k).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
    let body;
    let post = '';
    if (s === 0) {
      body = frost; // nothing to bend: just the frost, no bending map at all (the rim below has a map of its own)
    } else {
      const soft = smoothing(blur);
      const map = `<feImage href="${mapUrl(w, h, r, bezel)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>`;
      post = soft ? `<feGaussianBlur in="f" stdDeviation="${soft.toFixed(2)}" edgeMode="duplicate"/>` : '';
      if (ca === 0) {
        body = frost + map + disp(1, 'o'); // no colour fringe: one shift
      } else {
        // Red is shifted a little more and blue a little less. Green is the mean of both, so two shifts give three colours.
        body =
          frost +
          map +
          disp(1 + ca, 'dA') +
          disp(1 - ca, 'dB') +
          `<feColorMatrix in="dA" type="matrix" values="${keep(1, 0.5, 0)}" result="cA"/>` +
          `<feColorMatrix in="dB" type="matrix" values="${keep(0, 0.5, 1)}" result="cB"/>` +
          '<feComposite in="cA" in2="cB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="o"/>';
      }
    }
    body += rimPass(w, h, r, s === 0 ? src : 'o', s !== 0, lens) + post; // the reflection goes over the finished glass; the smoothing covers both
    const holder = document.createElement('div');
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${body}</filter></svg>`;
    return holder.firstChild.firstChild;
  }
  // How hard the rim of a w x h surface pulls the picture (amount, px) and how far apart red and blue are pulled (ca, a share of
  // the amount), from the person's settings, held to what fits the surface (see REACH and FRINGE above).
  function rim(w, h, panel, slider) {
    const side = Math.min(w, h);
    if (side < FLAT_BELOW) return { amount: 0, ca: 0 }; // frost only: nothing to bend, nothing to split
    const gain = panel ? PANEL.amount : slider ? SLIDER.amount : 1;
    const amount = Math.round(Math.min(params.amount * gain, side * (slider ? SLIDER.reach : REACH)) * 100) / 100;
    // The person's fringe, cut down where the gap between the two shifts (2 x fringe x amount) would pass FRINGE of the side.
    let ca = (params.chroma / 100) * 0.6;
    if (amount > 0) ca = Math.min(ca, (side * FRINGE) / (2 * amount));
    if (panel) ca *= PANEL_FRINGE; // the big blocks: a lighter glass, a quieter fringe
    if (side < FRINGE_FROM) ca = 0; // pills, buttons, inputs: bent a little, never split into colours
    ca = ca < 0.01 ? 0 : Math.round(ca * 1000) / 1000; // none worth a second shift: one pass fewer
    return { amount, ca };
  }
  // Gives `el` the filter that fits its size (making it if nobody has one like it) and lets go of the one it had.
  function describe(w, h, radius, panel, lens, slider) {
    const r = Math.min(radius, w / 2, h / 2);
    const bezel = Math.min(params.bezel * (panel ? PANEL.bezel : 1) * (slider ? SLIDER.bezel : 1), Math.min(w, h) / 2);
    const blur = slider ? Math.round(params.blur * SLIDER.blur * 100) / 100 : Math.round((params.blur + panelFrost(panel)) * 100) / 100;
    const { amount, ca } = rim(w, h, panel, slider);
    const kind = slider ? 'slider' : panel ? 'panel' : lens; // which reflection the filter ends with (see lensRim)
    const key = `${w}x${h}r${Math.round(r)}b${bezel}|${blur}|${amount}|${ca}|${lens ? 'L' : ''}${slider ? 'S' : ''}${panel ? 'P' : ''}|${dpr()}`;
    return { r, bezel, blur, amount, ca, kind, key };
  }
  // The filter for a description, built if it does not exist yet (it starts with nobody using it).
  function ensure(w, h, d) {
    let f = filters.get(d.key);
    if (!f) {
      const id = `ag-${++seq}`;
      const node = makeFilter(id, w, h, d.r, d.bezel, d.blur, d.amount, d.ca, d.kind);
      if (pending) pending.push(node);
      else defs.append(node);
      f = { id, node, refs: 0, key: d.key };
      filters.set(d.key, f);
    }
    return f;
  }
  function acquire(el, w, h, radius, panel, lens, slider) {
    const d = describe(w, h, radius, panel, lens, slider);
    const key = d.key;
    if (el._agKey === key && filters.has(key)) return filters.get(key).id;
    drop(el);
    if (!filters.has(key)) noteSize(w, h, radius, panel, lens, slider);
    const f = ensure(w, h, d);
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

  // ---- the first visit to a page: the maps of its surfaces are the slow part of it (each is drawn and then encoded as a PNG).
  // The sizes of the surfaces that got a filter are remembered (only the sizes: a few hundred bytes, and nothing that could go
  // stale when the maps are drawn differently some day), and after the next start the maps for them are made while nothing
  // else is happening, and so are the filters themselves: the first visit finds them ready and only has to point at them.
  // A filter that nobody has used yet stays until the settings change (their key holds the settings, so it can never be the
  // right one again); see sweep().
  const SIZES_KEY = 'aula.glassSizes';
  const MAX_SIZES = 160;
  const sizes = new Map(); // "w,h,radius,panel,lens,slider" -> [w, h, radius, panel, lens, slider], the newest last
  let sizesTimer = 0;
  function noteSize(w, h, radius, panel, lens, slider) {
    const a = [w, h, Math.round(radius * 100) / 100, panel ? 1 : 0, lens ? 1 : 0, slider ? 1 : 0];
    const k = a.join(',');
    sizes.delete(k);
    sizes.set(k, a);
    while (sizes.size > MAX_SIZES) sizes.delete(sizes.keys().next().value);
    if (!sizesTimer) sizesTimer = setTimeout(saveSizes, 3000);
  }
  // Where it is kept is where the app keeps everything it remembers (see app.js): the desktop app's data file, and only without
  // one, localStorage (a browser tab). With neither, nothing is remembered and nothing else changes.
  function saveSizes() {
    sizesTimer = 0;
    if (window.AULA_PREVIEW) return; // the live picture on the UI question (boot.js) keeps nothing of its own
    const raw = JSON.stringify([...sizes.values()]);
    try {
      if (host && host.setMemory) return host.setMemory(SIZES_KEY, raw);
    } catch (e) {}
    try {
      localStorage.setItem(SIZES_KEY, raw);
    } catch (e) {}
  }
  function loadSizes() {
    if (window.AULA_PREVIEW) return [];
    let raw = null;
    try {
      if (host && host.loadMemory) raw = (host.loadMemory() || {})[SIZES_KEY] ?? null;
    } catch (e) {}
    if (raw == null) {
      try {
        raw = localStorage.getItem(SIZES_KEY);
      } catch (e) {}
    }
    try {
      return JSON.parse(raw || '[]');
    } catch (e) {
      return [];
    }
  }
  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(() => fn({ timeRemaining: () => 0 }), 60));
  // `list`: sizes, the newest first. A newer run replaces the one in progress (the settings may have changed meanwhile).
  let warmTimer = 0;
  let warmRun = 0;
  function warmUp(list, delay) {
    if (gpu) return; // the GPU draws the big surfaces: no filters to build ahead of time for them
    const run = ++warmRun;
    clearTimeout(warmTimer);
    let i = 0;
    const step = (deadline) => {
      if (!on || run !== warmRun) return;
      do {
        const a = list[i++];
        if (!Array.isArray(a) || a.length !== 6 || !(a[0] > 0 && a[1] > 0)) continue;
        const [w, h, radius, panel, lens, slider] = a;
        ensureDefs();
        ensure(w, h, describe(w, h, radius, !!panel, !!lens, !!slider)); // the maps and the filter, as the surface will ask for them
      } while (i < list.length && deadline.timeRemaining() > 12);
      if (i < list.length) idle(step);
    };
    warmTimer = setTimeout(() => idle(step), delay);
  }
  function warm() {
    let list = loadSizes();
    if (!Array.isArray(list) || !list.length) return;
    list = list.slice(-MAX_SIZES).reverse(); // the newest first
    for (const a of list.slice().reverse()) if (Array.isArray(a)) sizes.set(a.join(','), a); // remembered again, so a start without a visit does not forget them
    warmUp(list, 1500); // let the first screen settle first
  }

  // ---- sliders: the thumb is a glass lens. At rest it is a small frosted pill; while held it swells into a clear lens that
  // bends the track (css/glass.css does the looks). The native <input type=range> stays in charge of dragging, keys and
  // screen readers; the lens is a decorative sibling that follows its value. It goes through the same refraction filter as
  // every other control: it is laid out at its swollen size and shrunk with CSS `scale`, so the filter is built only once.
  const lensOf = new Map(); // range input -> { lens, off() }
  const roRange = new ResizeObserver((entries) => {
    if (!on) return;
    const recs = [];
    for (const e of entries) {
      const rec = lensOf.get(e.target);
      if (rec) recs.push(rec);
    }
    const spots = recs.map((rec) => rec.measure());
    recs.forEach((rec, i) => rec.apply(spots[i]));
  });
  function mountRange(rng) {
    if (lensOf.has(rng) || !rng.parentNode) return;
    const lens = document.createElement('span');
    lens.className = 'range-lens';
    lens.setAttribute('aria-hidden', 'true');
    rng.after(lens); // empty: what you see through it while it is held is the real track, bent by its filter
    let peek = 0;
    const hold = (v) => lens.classList.toggle('held', v);
    // The lens (and the filled part of the track, --vf) does not jump from step to step: what is drawn is a position along the
    // track, `vis` (0 to 1), not the value. While the pointer holds the lens, `cont` is the pointer's own position and `vis`
    // follows it, so the lens slides freely under the finger even where the value only has a few steps (brightness has 9 levels);
    // the value still snaps, in the number beside the slider. Without the pointer (a key, the wheel, a change the page makes, or
    // letting go) `vis` glides to `target`, the position of the value itself: the lens settles into its step.
    let geo = null; // where the track is, from the last measurement ({ left, span, y }); null while the slider is hidden
    let target = 0; // the value's own position, 0 to 1
    let vis = 0; // the position that is drawn
    let cont = null; // pointer held: its position along the track, 0 to 1, not rounded to a step; otherwise null
    let grab = 0; // px between the pointer and the middle of the thumb at the moment it was picked up
    let glide = 0; // the animation frame of the glide, 0 when none is pending
    let glideT = 0;
    let sig = ''; // what the style watcher last saw (see below)
    const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const paint = () => {
      if (!geo) return;
      lens.style.setProperty('--lx', `${geo.left + THUMB / 2 + geo.span * vis}px`);
      rng.style.setProperty('--vf', vis.toFixed(4)); // css/glass.css fills the track up to here instead of up to --pf
    };
    // One step of the glide: exponential easing by elapsed time (so a slow machine glides at the same pace). It follows the pointer
    // closely while held and takes its time to settle into a step afterwards.
    const stepGlide = (now) => {
      glide = 0;
      if (!geo) return;
      const goal = cont != null ? cont : target;
      const dt = Math.min(100, glideT ? now - glideT : 16.7);
      glideT = now;
      vis += (goal - vis) * (1 - Math.exp(-dt / (cont != null ? GLIDE_HELD_MS : GLIDE_MS)));
      if (Math.abs(goal - vis) < 0.0004) {
        vis = goal;
        glideT = 0;
      } else glide = requestAnimationFrame(stepGlide);
      paint();
    };
    const go = () => {
      if (!geo) return;
      if (reduced() || typeof requestAnimationFrame !== 'function') {
        vis = cont != null ? cont : target;
        paint();
      } else if (!glide) glide = requestAnimationFrame(stepGlide);
    };
    // Where the lens goes is measured (measure) and written (apply) apart, so that several sliders shown together (a page that
    // has just been opened) are all measured before the first is changed; one by one, each write made the next measurement lay
    // the page out again.
    const measure = () => {
      const w = rng.offsetWidth;
      if (!w) return null; // hidden for now: the observer fires again when it is shown
      const min = rng.min === '' ? 0 : +rng.min;
      const max = rng.max === '' ? 100 : +rng.max;
      const pf = max > min ? Math.min(1, Math.max(0, (+rng.value - min) / (max - min))) : 0;
      return { left: rng.offsetLeft, span: w - THUMB, y: rng.offsetTop + rng.offsetHeight / 2, pf };
    };
    const apply = (m) => {
      if (!m) {
        geo = null; // hidden: when it is shown again it simply appears at its value
        return;
      }
      const fresh = !geo;
      geo = m;
      target = m.pf;
      lens.style.setProperty('--ly', `${m.y}px`);
      lens.style.setProperty('--lp', String(m.pf));
      if (fresh && cont == null) vis = target; // first sight of the slider: no glide in from the start of the track
      paint();
      if (vis !== (cont != null ? cont : target)) go();
    };
    const place = () => {
      sig = sigOf();
      apply(measure());
    };
    // The pointer's position along the track (0 to 1), for the middle of the thumb to follow it. A panel that is scaled while it
    // opens is allowed for (the on-screen width against the layout width).
    const contFrom = (clientX) => {
      const r = rng.getBoundingClientRect();
      const k = rng.offsetWidth ? r.width / rng.offsetWidth : 1;
      const span = r.width - THUMB * k;
      return span > 0 ? Math.min(1, Math.max(0, (clientX - grab - r.left - (THUMB * k) / 2) / span)) : 0;
    };
    // The held lens is a drop of liquid: dragged fast it stretches (css/glass.css reads --lv, -1 to 1: the smoothed pointer speed,
    // signed by direction), then settles back. Only a scale is applied, never a change of shape, so the filter built for the lens stays exact. `kick` is the latest move, `vel` follows it with a lag, and a frame loop runs only while either moves.
    // Speeds are in px per 16.7 ms (one frame at 60 Hz) and the easing is by elapsed time, so a slow machine eases at the same pace.
    let lastX = 0;
    let lastT = 0;
    let kick = 0;
    let vel = 0;
    let jelly = 0;
    let stepT = 0;
    const jellyStep = (now) => {
      jelly = 0;
      const dt = Math.min(100, stepT ? now - stepT : 16.7) / 16.7; // frames since the last step
      stepT = now;
      vel += (kick - vel) * (1 - Math.pow(0.7, dt));
      kick *= Math.pow(0.8, dt);
      lens.style.setProperty('--lv', Math.max(-1, Math.min(1, vel / JELLY_SPEED)).toFixed(3));
      if (Math.abs(vel) > 0.02 || Math.abs(kick) > 0.02) jelly = requestAnimationFrame(jellyStep);
      else {
        vel = kick = stepT = 0;
        lens.style.removeProperty('--lv');
      }
    };
    const onMove = (e) => {
      if (!lens.classList.contains('held')) return;
      if (cont != null) {
        cont = contFrom(e.clientX); // the lens follows the pointer, not the step the value has snapped to
        go();
      }
      const t = e.timeStamp || 0;
      const frames = Math.max(0.5, lastT ? (t - lastT) / 16.7 : 1); // a burst of events is fast, not many separate nudges
      kick = Math.max(-60, Math.min(60, (e.clientX - lastX) / frames));
      lastX = e.clientX;
      lastT = t;
      if (!jelly) jelly = requestAnimationFrame(jellyStep);
    };
    const letGo = () => {
      hold(false);
      window.removeEventListener('pointerup', letGo, true);
      window.removeEventListener('pointercancel', letGo, true);
      window.removeEventListener('pointermove', onMove, true);
      if (cont != null) {
        cont = null;
        grab = 0;
        place(); // the lens glides from where the pointer left it into the step the value snapped to
      }
    };
    const onDown = (e) => {
      if (rng.disabled || (e.button != null && e.button > 0)) return;
      clearTimeout(peek);
      hold(true);
      lastX = e.clientX || 0;
      lastT = e.timeStamp || 0;
      // Like the native slider: picked up on the thumb, it keeps the distance between the pointer and the thumb's middle; a press on
      // the track puts the middle of the thumb under the pointer.
      const r = rng.getBoundingClientRect();
      const k = rng.offsetWidth ? r.width / rng.offsetWidth : 1;
      const mid = r.left + (THUMB * k) / 2 + (r.width - THUMB * k) * target;
      const onThumb = Math.abs(e.clientX - mid) <= (THUMB * k) / 2 && Math.abs(e.clientY - (r.top + r.height / 2)) <= 14 * k;
      grab = onThumb ? e.clientX - mid : 0;
      cont = contFrom(e.clientX);
      go();
      window.addEventListener('pointerup', letGo, true);
      window.addEventListener('pointercancel', letGo, true);
      window.addEventListener('pointermove', onMove, true);
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
    // app.js moves a slider by setting .value and the --pf variable on its style, which fires no event: watch the style.
    // paint() writes --vf on the same style, so only a change of what matters (value, range, disabled, --pf) counts.
    const sigOf = () => `${rng.value}|${rng.min}|${rng.max}|${rng.disabled}|${rng.style.getPropertyValue('--pf')}`;
    const watch = new MutationObserver(() => {
      if (sigOf() !== sig) place();
    });
    watch.observe(rng, { attributes: true, attributeFilter: ['style', 'min', 'max', 'disabled'] });
    roRange.observe(rng);
    live.add(lens);
    ro.observe(lens); // reports the size straight away, which gives the lens its refraction filter
    lensOf.set(rng, {
      lens,
      place,
      measure,
      apply,
      off() {
        clearTimeout(peek);
        letGo();
        if (jelly && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(jelly);
        if (glide && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glide);
        glide = 0;
        geo = null;
        lens.style.removeProperty('--lv');
        rng.style.removeProperty('--vf'); // Classic fills the track from --pf alone
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

  // ---- scroll bars: the native bar of a scrolling area is hidden (data-ag-scroll) and a glass thumb is drawn beside it. The thumb
  // is a lens like the slider's: it refracts the page and the picture that pass behind it. It is a sibling of the area, not a child
  // (a child would scroll away with the content). The area stays in charge of scrolling (wheel, touch, keys, find); the thumb only
  // follows scrollTop, can be dragged, and a click on the strip beside it pages up or down.
  // Sizes are read when the area or its content resizes; a scroll event only moves the thumb (a translate), so scrolling does no layout.
  const barOf = new Map(); // scrolling area -> { bar, thumb, layout, sync, off }
  const roScroll = new ResizeObserver((entries) => {
    if (!on) return;
    for (const e of entries) {
      const rec = barOf.get(e.target) || barOf.get(e.target._agArea);
      if (rec) rec.layout();
    }
  });
  function mountScroll(area) {
    if (barOf.has(area) || !area.parentNode) return;
    const bar = document.createElement('span');
    bar.className = 'ag-scroll';
    bar.setAttribute('aria-hidden', 'true');
    bar.hidden = true;
    const thumb = document.createElement('i');
    thumb.className = 'ag-scroll-thumb';
    bar.append(thumb);
    area.after(bar);
    area.setAttribute('data-ag-scroll', '');
    let geo = null; // { track, th, max } from the last layout
    let busy = 0;
    let drag = null;
    const move = () => {
      if (!geo) return;
      const f = geo.max > 0 ? Math.min(1, Math.max(0, area.scrollTop / geo.max)) : 0;
      thumb.style.setProperty('--ty', `${((geo.track - geo.th) * f).toFixed(1)}px`);
    };
    const layout = () => {
      const w = area.offsetWidth;
      const vh = area.clientHeight;
      const sh = area.scrollHeight;
      if (!w || vh < 2 * SB_INSET + SB_MIN || sh <= vh + 1) {
        bar.hidden = true; // hidden for now, or nothing to scroll: the observer fires again when that changes
        geo = null;
        return;
      }
      const track = vh - 2 * SB_INSET;
      const th = Math.min(track, Math.round(Math.max(SB_MIN, (track * vh) / sh)));
      // Beside the area when its parent leaves a gutter there (the page area has the window's 22 px margin), else inside its right edge.
      const par = area.parentElement;
      const room = par && par.offsetParent === area.offsetParent ? par.offsetLeft + par.clientWidth - (area.offsetLeft + w) : 0;
      const x = room >= SB_GRAB - 4 ? w + Math.round((room - SB_GRAB) / 2) : w - SB_GRAB - 2;
      bar.style.setProperty('--sl', `${area.offsetLeft + x}px`);
      bar.style.setProperty('--st', `${area.offsetTop + SB_INSET}px`);
      bar.style.setProperty('--sh', `${track}px`);
      thumb.style.setProperty('--th', `${th}px`);
      geo = { track, th, max: sh - vh };
      bar.hidden = false;
      move();
    };
    const onScroll = () => {
      move();
      bar.classList.add('busy');
      clearTimeout(busy);
      busy = setTimeout(() => bar.classList.remove('busy'), SB_BUSY_MS);
    };
    const endDrag = () => {
      drag = null;
      bar.classList.remove('held');
    };
    const onDown = (e) => {
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      if (!geo) return;
      if (e.target === thumb) {
        drag = { y: e.clientY, top: area.scrollTop, ratio: geo.track > geo.th ? geo.max / (geo.track - geo.th) : 0 };
        bar.classList.add('held');
        try {
          thumb.setPointerCapture(e.pointerId);
        } catch (_) {
          /* the pointer is already gone: the drag simply does nothing */
        }
      } else {
        const up = e.clientY < thumb.getBoundingClientRect().top;
        area.scrollBy({ top: (up ? -1 : 1) * area.clientHeight * 0.9, behavior: 'smooth' });
      }
    };
    const onMove = (e) => {
      if (drag) area.scrollTop = drag.top + (e.clientY - drag.y) * drag.ratio;
    };
    const onWheel = (e) => {
      // a wheel turned over the strip scrolls the area, as it would over the area itself
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? area.clientHeight : 1;
      area.scrollBy({ top: e.deltaY * unit });
      e.preventDefault();
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    bar.addEventListener('pointerdown', onDown);
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);
    bar.addEventListener('lostpointercapture', endDrag);
    bar.addEventListener('wheel', onWheel, { passive: false });
    // The area's own size, and the size of what is in it (a longer page, a panel that was shown or hidden, a list that grew).
    const watched = new Set();
    const sync = () => {
      for (const c of area.children) {
        if (watched.has(c)) continue;
        watched.add(c);
        c._agArea = area;
        roScroll.observe(c);
      }
      for (const c of watched) {
        if (c.parentNode === area) continue;
        watched.delete(c);
        roScroll.unobserve(c);
      }
    };
    roScroll.observe(area);
    sync();
    live.add(thumb);
    ro.observe(thumb); // reports the size straight away, which gives the thumb its refraction filter
    barOf.set(area, {
      bar,
      thumb,
      layout,
      sync() {
        sync();
        layout();
      },
      off() {
        clearTimeout(busy);
        endDrag();
        area.removeEventListener('scroll', onScroll);
        area.removeAttribute('data-ag-scroll');
        roScroll.unobserve(area);
        for (const c of watched) roScroll.unobserve(c);
        watched.clear();
        live.delete(thumb);
        ro.unobserve(thumb);
        drop(thumb);
        bar.remove();
      },
    });
    layout();
  }
  function unmountScrolls() {
    for (const rec of barOf.values()) rec.off();
    barOf.clear();
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
  // Everything is measured first and only then changed. Painting one surface after another meant that each style, class and
  // filter written for one made the next measurement recalculate the whole page's styles and layout again: with forty surfaces
  // that was forty recalculations in a row (a first visit to a page, or a change of a glass setting), now it is one.
  function flush() {
    raf = 0;
    if (!on) return dirty.clear();
    if (isLight()) {
      // Light glass (Normal, or Realistic with no bending): nothing to measure and no filter to build, a surface only has to be marked.
      for (const el of dirty) if (el.isConnected) markNormal(el);
      dirty.clear();
      return;
    }
    ensureDefs();
    const batch = [];
    for (const el of dirty) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w || !h || !el.isConnected) continue; // hidden for now: the observer fires again when it is shown
      batch.push([el, w, h, cornerOf(el)]);
    }
    dirty.clear();
    pending = [];
    try {
      for (const [el, w, h, radius] of batch) paint(el, w, h, radius);
    } finally {
      if (pending.length) defs.append(...pending);
      pending = null;
    }
    if (sweepAfter) sweep();
    if (rootBlurStale) {
      rootBlurStale = false; // every surface that is shown has its own filter now: the blur Normal left on <html> is not needed
      clearNormal();
    }
  }
  // The corner radius a surface rests at. A menu opens with an animation that squeezes its corners into its button's (js/glass-motion.js),
  // and a filter sized to the squeezed corners keeps them for as long as the menu stays the same size, so the glass edge and the menu's
  // own edge part ways at every corner. glass-motion.js writes the radius the menu settles at (--ag-rest-r) before it starts the animation.
  function cornerOf(el) {
    const rest = parseFloat(el.style.getPropertyValue('--ag-rest-r'));
    return Number.isFinite(rest) ? rest : parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  }
  let rootBlurStale = false; // set when Realistic takes over from Normal, cleared once the surfaces have been painted
  // A surface the GPU draws: the filter's numbers go to the renderer, and the element only keeps its tint (css/glass-gpu.css).
  function paintGpu(el, w, h, radius) {
    const panel = el.matches(PANELS);
    const d = describe(w, h, radius, panel, false, false);
    const spec = rimSpec(w, h, panel ? 'panel' : false);
    const rr = panel ? PANEL_RIM : RIM;
    drop(el);
    el.style.removeProperty('--ag-filter');
    el.classList.add(panel ? 'ag-panel' : 'ag', 'ag-gpu');
    gpu.set(el, { w, h, r: d.r, bezel: d.bezel, blur: d.blur, amount: d.amount, ca: d.ca, panel, rimW: spec.width, pull: spec.pull, rimGain: rr.gain, rimLift: rr.lift, rimFloor: rr.floor, rimSat: RIM.sat });
  }
  function paint(el, w, h, radius) {
    if (gpuTakes(el)) return paintGpu(el, w, h, radius);
    if (el.classList.contains('ag-gpu')) el.classList.remove('ag-gpu'); // it was the GPU's and is not any more (a menu that opened inside it)
    const panel = el.matches(PANELS);
    el.style.setProperty('--ag-filter', `url(#${acquire(el, w, h, radius, panel, !panel && el.matches(LENSES), !panel && el.matches(SLIDER_LENS))})`);
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
        if (gpu) gpu.remove(el);
      }
    }
    for (const el of document.querySelectorAll(`${TARGETS}, ${PANELS}`)) {
      if (live.has(el)) continue;
      live.add(el);
      if (isLight()) markNormal(el); // nothing to measure: marked at once
      ro.observe(el); // reports the size straight away, which paints it (Normal: only marks it, see flush)
    }
    for (const [rng, rec] of lensOf) {
      if (!rng.isConnected) {
        rec.off();
        lensOf.delete(rng);
      }
    }
    for (const rng of document.querySelectorAll(RANGES)) mountRange(rng);
    for (const [area, rec] of barOf) {
      if (!area.isConnected) {
        rec.off();
        barOf.delete(area);
      }
    }
    for (const area of document.querySelectorAll(SCROLLERS)) mountScroll(area);
    for (const rec of barOf.values()) rec.sync(); // new or removed children, and a size that changed without the area itself resizing
  }
  // Only elements that come or go can change what is glass or scrolls. A text that changes (a battery age, a latency, a status)
  // arrives as a node too, but not an element, and used to start a scan of the whole page (with a layout) every time.
  const hasElement = (nodes) => {
    for (const n of nodes) if (n.nodeType === 1) return true;
    return false;
  };
  const mo = new MutationObserver((list) => {
    if (scanTimer) return;
    for (const m of list) {
      if (hasElement(m.addedNodes) || hasElement(m.removedNodes)) {
        scanTimer = setTimeout(scan, isLight() ? 16 : 150); // light glass: a scan costs next to nothing, and a new menu should not wait for it
        return;
      }
    }
  });
  // A new pixel density (zoom, or the window moved to another screen) changes the size of the smoothing blur.
  let seenDpr = dpr();
  function onResize() {
    const now = dpr();
    if (now === seenDpr) return;
    seenDpr = now;
    if (on && !isLight()) repaintAll(); // only the smoothing blur of the filters depends on it
  }
  // The filters are not thrown away first: the key of each one holds the settings and the pixel density, so acquire() gives every
  // surface the filter that fits the new ones and lets go of its old one (which is removed when nobody else uses it). That is
  // done in one go, so a setting that is dragged never shows a frame with the glass missing.
  function repaintAll() {
    if (isLight()) {
      applyNormal(); // the blur is one variable on <html>: every surface follows it
      for (const el of live) if (el.matches(PANELS)) markNormal(el); // Realistic's boxes have a little more frost of their own
      return;
    }
    ensureDefs();
    sweepAfter = true;
    for (const el of live) queueNow(el);
    warmUp([...sizes.values()].reverse(), 2500); // the filters made ahead of time were for the old settings (sweep), so make them again once nothing is being changed
  }
  // Filters made ahead of time (warm) for settings that are gone are removed once everything has been given its new filter.
  let sweepAfter = false;
  function sweep() {
    sweepAfter = false;
    for (const f of [...filters.values()]) {
      if (f.refs > 0) continue;
      f.node.remove();
      filters.delete(f.key);
    }
  }
  function release() {
    stopGpu();
    mo.disconnect();
    if (window.removeEventListener) window.removeEventListener('resize', onResize);
    clearTimeout(scanTimer);
    scanTimer = 0;
    clearTimeout(warmTimer);
    warmRun++;
    dirty.clear();
    unmountRanges();
    unmountScrolls();
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
    clearNormal();
    rootBlurStale = false;
  }
  function start() {
    if (!document.body) return;
    initGpu(); // before the first scan, so the surfaces it takes are never given a filter
    syncClass();
    if (isLight()) applyNormal();
    else ensureDefs(); // before the observer, so adding the holder does not start a scan
    mo.observe(document.body, { childList: true, subtree: true });
    seenDpr = dpr();
    if (window.addEventListener) window.addEventListener('resize', onResize);
    scan();
    if (!isLight()) warm();
  }

  // ---- changing the type while glass is on (Settings > Theme > Liquid glass > Glass type): the surfaces stay marked and in place, only
  // what paints them changes, so nothing is rebuilt from scratch.
  function leaveRealistic() {
    stopGpu();
    clearTimeout(warmTimer);
    warmRun++; // a warm-up in progress is for the filters that are about to go
    dirty.clear();
    for (const el of live) {
      clearTimeout(settle.get(el));
      drop(el);
      if (el.style) el.style.removeProperty('--ag-filter'); // back to the one blur on <html>
    }
    if (defs) defs.replaceChildren();
    filters.clear();
    maps.clear();
    sweepAfter = false;
    rootBlurStale = false;
    applyNormal();
    for (const el of live) markNormal(el);
  }
  function enterRealistic() {
    initGpu();
    ensureDefs();
    seenDpr = dpr();
    rootBlurStale = true; // the blur on <html> keeps the glass blurred until each surface has its own filter (the next frame)
    warm(); // the sizes the last Realistic session remembered, made while nothing else is happening
    for (const el of live) ro.observe(el); // Normal did not need the sizes: report them now (a repeated observe changes nothing)
    repaintAll();
  }

  // After the type or the numbers changed: from the filters to light glass, from light glass to the filters, or on the same path, where
  // everything is just painted again.
  // From or to the GPU type, or when the GPU gave up: everything is let go and found again, so each surface lands on the right path.
  function rebuild() {
    release();
    syncClass();
    start();
  }
  function moveTo(wasLight) {
    const light = isLight();
    if (light && !wasLight) leaveRealistic();
    else if (!light && wasLight) enterRealistic();
    else repaintAll();
  }

  window.AulaGlass = {
    DEFAULTS,
    LIMITS,
    PRESETS,
    TYPES,
    DEFAULT_TYPE,
    NORMAL,
    clean,
    cleanType,
    presetOf,
    normalBlur,
    isLight,
    rim,
    rimSpec,
    rimLight,
    isOn: () => on,
    type: () => type,
    gpuActive: () => !!gpu,
    gpuFailed: () => gpuFailed,
    gpuStats: () => (gpu ? gpu.stats() : null),
    params: () => ({ ...params }),
    set(next) {
      next = !!next;
      if (next === on) return;
      on = next;
      root.classList.toggle('glass', on);
      syncClass();
      if (on) start();
      else release();
    },
    // 'normal' or 'realistic'. With glass off it is only remembered, so it is right when glass comes on.
    setType(next) {
      next = cleanType(next);
      if (next === type) return;
      const wasLight = isLight();
      if (next === 'realistic') gpuFailed = false; // choosing it again is a new try (WebGL, or the picture, may be fine now)
      type = next;
      syncClass();
      if (!on) return;
      // The graphics card draws Realistic where it can: to or from it, everything is let go and found again, so each surface lands on
      // the right path. Without a renderer (no WebGL module) only the paint changes.
      if (gpu || (next === 'realistic' && window.AulaGpuGlass)) return rebuild();
      moveTo(wasLight);
    },
    setParams(p) {
      const next = clean({ ...params, ...p });
      if (next.bezel !== params.bezel) maps.clear();
      const wasLight = isLight();
      params = next;
      syncClass();
      if (on) moveTo(wasLight); // Refraction reaching 0 (or leaving it) changes which path paints the glass
    },
  };

  if (on) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
