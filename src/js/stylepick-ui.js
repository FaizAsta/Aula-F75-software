/*
 * "Which UI do you want to use?" (home.js draws the screen, stylepick.js decides who is asked): what goes with the SELECTED card.
 *
 *   - Under it, that style's options: Classic has Blur and Keyboard background, Liquid glass has its four sliders (the same ones as
 *     Settings, Theme). They are a draft kept here: nothing is applied or saved until Continue (home.js asks for draft()).
 *   - On it, a LIVE picture of the app. It is this same page opened inside an iframe in preview mode (boot.js, app.js): the demo
 *     keyboard over the preset background, with its settings in memory only. Each change is sent to it with postMessage, so the
 *     picture changes as the switch or slider moves. The two screenshots (img/ui) stay underneath until the live picture says it is
 *     ready, and they are all the card that is not selected shows, so only one extra copy of the app runs, and only while the
 *     question is on screen.
 */
(() => {
  'use strict';

  const root = document.getElementById('spScreen');
  if (!root) return;
  const A = () => window.aulaApp;
  const $ = (sel, from = root) => from.querySelector(sel);
  const $$ = (sel, from = root) => Array.from(from.querySelectorAll(sel));

  const UNITS = { blur: ' px', bezel: ' px', amount: ' px', chroma: '%' };
  const FRAME_W = 1200; // the app's default window size: the picture is that window, scaled down to the card
  const FRAME_H = 800;

  let opened = false;
  let pick = 'classic';
  let draftState = null; // { blur, stageBgOn, glass: { blur, bezel, amount, chroma }, glassType } (the type is only read: Settings has its switch)
  const frames = new Map(); // style -> { frame, shot, ready }
  let pushQueued = false;

  const card = (style) => root.querySelector(`.sp-card[data-style-choice="${style}"]`);
  const defaults = () => (window.AulaGlass && window.AulaGlass.clean ? window.AulaGlass.clean(null) : { blur: 2.5, bezel: 14, amount: 30, chroma: 30 });

  // ------------------------------------------------------------------- the controls

  const setSwitch = (el, on) => el.setAttribute('aria-checked', on ? 'true' : 'false');

  function paintControls() {
    if (!draftState) return;
    setSwitch($('#spBlur'), draftState.blur);
    setSwitch($('#spStageBg'), draftState.stageBgOn);
    for (const rng of $$('input[data-glass]')) {
      const k = rng.dataset.glass;
      const v = draftState.glass[k];
      if (+rng.value !== v) rng.value = v;
      rng.style.setProperty('--pf', (v - +rng.min) / (+rng.max - +rng.min));
      const out = document.getElementById(`${rng.id}Val`);
      if (out) out.textContent = `${v}${UNITS[k]}`;
    }
    // Normal glass only blurs, so edge width, refraction and colour fringe have nothing to do: they show only for Realistic
    for (const row of $$('[data-glass-real]')) row.hidden = draftState.glassType === 'normal';
  }

  // ------------------------------------------------------------------- the live picture

  const config = (style) => ({
    style,
    theme: A().theme(),
    blur: draftState.blur,
    stageBgOn: draftState.stageBgOn,
    glass: draftState.glass,
    glassType: draftState.glassType,
    bg: A().previewBg(),
    bgOpacity: 0.5, // the same picture and strength as the two screenshots
  });

  function fit(entry) {
    const k = entry.shot.clientWidth / FRAME_W;
    if (k > 0) entry.frame.style.transform = `scale(${k})`;
  }

  function makeFrame(style) {
    const c = card(style);
    const shot = c && c.querySelector('.sp-shot');
    if (!shot || !draftState) return;
    const frame = document.createElement('iframe');
    frame.className = 'sp-live';
    frame.title = `Live preview of the ${style === 'glass' ? 'Liquid glass' : 'Classic'} UI`;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('inert', '');
    frame.width = FRAME_W;
    frame.height = FRAME_H;
    frame.src = `index.html?preview=1&cfg=${encodeURIComponent(JSON.stringify(config(style)))}`;
    const entry = { frame, shot, ready: false };
    frames.set(style, entry);
    shot.append(frame);
    fit(entry);
    if (window.ResizeObserver) {
      entry.ro = new ResizeObserver(() => fit(entry));
      entry.ro.observe(shot);
    }
  }

  function dropFrame(style) {
    const entry = frames.get(style);
    if (!entry) return;
    if (entry.ro) entry.ro.disconnect();
    entry.shot.classList.remove('live');
    entry.frame.remove();
    frames.delete(style);
  }

  // The newest draft goes to the picture, at most once per frame drawn (a slider fires many times a second).
  function push() {
    if (pushQueued) return;
    pushQueued = true;
    requestAnimationFrame(() => {
      pushQueued = false;
      const entry = frames.get(pick);
      if (!entry || !entry.ready || !draftState || !entry.frame.contentWindow) return;
      entry.frame.contentWindow.postMessage({ aulaPreview: 'set', style: pick, blur: draftState.blur, stageBgOn: draftState.stageBgOn, glass: draftState.glass, glassType: draftState.glassType }, '*');
    });
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.aulaPreview !== 'ready') return;
    for (const entry of frames.values()) {
      if (entry.frame.contentWindow !== e.source) continue;
      entry.ready = true;
      entry.shot.classList.add('live'); // the live picture fades in over the screenshot
      push(); // whatever was changed while it was loading
    }
  });

  // ------------------------------------------------------------------- what home.js calls

  /** The question opened with `style` selected: start the draft from what is saved right now. */
  function open(style) {
    opened = true;
    draftState = A().styleOptions();
    paintControls();
    select(style);
  }

  /** A card was selected: its options show under it, and its live picture replaces the other one. */
  function select(style) {
    if (!opened) return;
    pick = style;
    for (const box of $$('.sp-opts')) box.hidden = box.dataset.opts !== style;
    for (const s of Array.from(frames.keys())) if (s !== style) dropFrame(s);
    if (!frames.has(style)) makeFrame(style);
  }

  /** The question is gone (Continue, Back, or Start's way back): stop the live picture. */
  function close() {
    opened = false;
    for (const s of Array.from(frames.keys())) dropFrame(s);
  }

  /**
   * The options to apply with the style when Continue is pressed: only those shown under the selected card. Somebody who tried the
   * Classic switches and then picked Liquid glass keeps the Classic settings exactly as they were.
   */
  function draft() {
    if (!draftState) return null;
    if (pick === 'glass') return { glass: { ...draftState.glass } };
    return { blur: draftState.blur, stageBgOn: draftState.stageBgOn };
  }

  // ------------------------------------------------------------------- wiring (once)

  $('#spBlur').addEventListener('click', () => {
    if (!draftState) return;
    draftState.blur = !draftState.blur;
    paintControls();
    push();
  });
  $('#spStageBg').addEventListener('click', () => {
    if (!draftState) return;
    draftState.stageBgOn = !draftState.stageBgOn;
    paintControls();
    push();
  });
  for (const rng of $$('input[data-glass]')) {
    rng.addEventListener('input', () => {
      if (!draftState) return;
      draftState.glass = { ...draftState.glass, [rng.dataset.glass]: +rng.value };
      paintControls();
      push();
    });
  }
  $('#spGlassReset').addEventListener('click', () => {
    if (!draftState) return;
    draftState.glass = defaults();
    paintControls();
    push();
  });

  window.AulaStylePickUI = { open, select, close, draft };
})();
