(() => {
  'use strict';

  const P = window.AulaProtocol;
  const L = window.AulaLayout;
  const V = window.AulaPreview;
  const W = window.AulaWebHID;
  const E = window.AulaEngine;
  const M = window.AulaMock;
  const T = window.AulaTheme || null; // theme.js, loaded in <head>
  const BG = window.AulaBg; // background.js: the custom background picture
  const host = window.aulaHost || null;
  const B = window.AulaBattery; // battery.js: estimates, hourly bars, stretch since the last charge
  const MO = window.AulaMotion || null; // motion.js: ripples, button tasks and the data-link animation (optional)

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) n.append(c);
    return n;
  };

  // ------------------------------------------------------------------ prefs

  // Everything the app remembers goes through `store`. In the desktop app it lives in a file in the user's data folder
  // (written immediately, so a restart cannot lose it); in a plain browser tab it falls back to localStorage.
  // Data an older version left in localStorage is picked up the first time it is read.
  const store = (() => {
    let ls = null;
    try {
      localStorage.getItem('aula.probe');
      ls = localStorage;
    } catch (_) {
      ls = null;
    }
    if (!host || !host.loadMemory || !host.setMemory) {
      return ls || E.memoryStorage();
    }
    let disk = {};
    try {
      disk = host.loadMemory() || {};
    } catch (_) {
      disk = {};
    }
    return {
      getItem(k) {
        if (Object.prototype.hasOwnProperty.call(disk, k)) return disk[k];
        let v = null;
        try {
          v = ls ? ls.getItem(k) : null;
        } catch (_) {
          v = null;
        }
        if (v != null) {
          disk[k] = v;
          host.setMemory(k, v);
        }
        return v;
      },
      setItem(k, v) {
        v = String(v);
        disk[k] = v;
        host.setMemory(k, v);
      },
      removeItem(k) {
        delete disk[k];
        host.removeMemory(k);
        try {
          if (ls) ls.removeItem(k);
        } catch (_) {
          /* ignore */
        }
      },
    };
  })();

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PREF_KEY = 'aula.prefs';
  // Shown under the switch. The light is written by this app, so it needs the app to be running: hidden in the tray counts, quitting does not.
  const LOW_LIGHT_NOTE =
    'This only works while Aula Control is running in the background (hidden in the tray is fine). If the app is closed or quit, nothing watches the battery and the light will not turn red. Turn on Start with Windows in Settings > App to keep it running. Needs the 2.4G dongle or the USB-C cable. Hover the tray icon to see what the app uses right now.';
  const prefs = { demo: false, low: 20, full: true, lowLight: true, animate: !reduceMotion, tool: 'select', theme: 'dark', frost: true };
  try {
    Object.assign(prefs, JSON.parse(store.getItem(PREF_KEY) || '{}'));
  } catch (_) {
    /* storage unavailable: defaults apply for this run */
  }
  // The pause button is gone, so an old saved "paused" state must not stick.
  prefs.animate = !reduceMotion;
  // The app always opens on Lighting. A tab saved by an older version is ignored (and dropped on the next save).
  delete prefs.tab;
  prefs.lowLight = prefs.lowLight !== false; // red breathing light on the keyboard while the battery is low: on unless the person turned it off
  prefs.frost = prefs.frost !== false; // frosted window (Settings > Theme): on unless the person turned it off
  // Keyboard model: decides the preview layout and which LED each key is. Unknown or missing falls back to the F75.
  // What the keyboard picture shows: 'live' (follows the keyboard, the original behaviour) or 'picture' (just the board).
  prefs.view = prefs.view === 'picture' ? 'picture' : 'live';
  if (!L.hasModel(prefs.model)) prefs.model = L.DEFAULT_MODEL;
  L.use(prefs.model);
  // Colour theme: dark (the original look), light, or system. theme.js already applied the saved one before first paint.
  if (!['dark', 'light', 'system'].includes(prefs.theme)) prefs.theme = 'dark';
  if (T && T.pref() !== prefs.theme) T.set(prefs.theme);
  const savePrefs = () => {
    try {
      store.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (_) {
      /* ignore */
    }
  };

  // ----------------------------------------------------------------- session

  let demoKb = null;
  const discover = async () => {
    if (prefs.demo) {
      demoKb = demoKb || new M.MockKeyboard({ latency: 14, battery: 78, ledCount: L.requiredLeds() > 96 ? 126 : 96, layoutKeys: L.KEYS.slice() }); // key layers follow the chosen model
      return [{ io: demoKb, meta: { id: 'demo', mode: 'demo', label: 'Demo keyboard', supported: true } }];
    }
    return W.discover();
  };
  const session = new E.Session({ discover, storage: store });

  // Key assignment (the Keys tab) lives in keys-ui.js; it gets the session, the layout and a few callbacks.
  const KUI = window.AulaKeysUI
    ? window.AulaKeysUI.create({
        session,
        L,
        MO,
        storage: store,
        toast: (m, kind, ms) => toast(m, kind, ms),
        rerender: () => scheduleRender(),
        isTab: () => tab === 'keys',
        busy: () => applying || session.restoring,
      })
    : null;

  // F75 Max (max-ui.js): its own protocol and screen. It takes over the window while an F75 Max is connected, and only
  // starts looking when nothing else is: the F75 session never talks to a Max.
  const MXU = window.AulaMaxUI
    ? window.AulaMaxUI.create({
        storage: store,
        toast: (m, kind, ms) => toast(m, kind, ms),
        busyElsewhere: () => !!prefs.demo || !!session.connected,
        getView: () => prefs.view, // the Live / Picture switch on the keyboard picture
        // the F75 preview has nothing to draw while a Max is connected (the Max's own picture is in the stage), so it rests
        idlePreview: (on) => {
          if (on) view.stop();
          else if (prefs.animate) view.start();
        },
        onLeave: () => scheduleRender(),
      })
    : null;

  let KEYMAP = new Map();
  let ALL_LEDS = [];
  const rebuildKeyCaches = () => {
    KEYMAP = new Map(L.KEYS.map((k) => [k.led, k]));
    ALL_LEDS = L.KEYS.map((k) => k.led);
  };
  rebuildKeyCaches();
  const keyX = (k) => (k.x + k.w / 2) / L.WIDTH;

  let tab = 'lighting';
  let applying = false;
  const sel = new Set();
  let drag = null;

  // ------------------------------------------------------------------ helpers

  const hexOf = (c) => P.rgbToHex(c);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s} s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }

  function toast(msg, kind = 'info', ms = 4600) {
    const box = $('#toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    const n = el('div', { class: 'toast', 'data-k': kind, text: msg });
    box.append(n);
    setTimeout(() => {
      n.classList.add('out');
      setTimeout(() => n.remove(), 280);
    }, ms);
  }

  async function saveText(name, text) {
    if (host && host.saveFile) return host.saveFile(name, text);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  async function pickJson() {
    if (host && host.openFile) return host.openFile();
    return new Promise((resolve) => {
      const input = $('#bkFile');
      input.value = '';
      input.onchange = async () => {
        const f = input.files && input.files[0];
        resolve(f && f.size < 1024 * 1024 ? await f.text() : null);
      };
      input.click();
    });
  }

  // ------------------------------------------------------------------ canvas

  const canvas = $('#kb');
  const rootStyle = document.documentElement.style;
  let lastGlow = 0;
  let glowNow = [124, 214, 255];
  // --glow is the keyboard's bright colour (tints, fills). --glow-ink is the same hue for text and thin lines: unchanged
  // on the dark theme, darkened on the light one until it can be read on white.
  const applyGlowInk = () => {
    const ink = T ? T.inkFor(glowNow) : glowNow;
    rootStyle.setProperty('--glow-ink', ink.map((v) => Math.round(v)).join(' '));
  };
  applyGlowInk();

  const view = new V.KeyboardView(canvas, {
    interactive: true,
    animate: prefs.animate,
    inset: { top: 16, bottom: 38 }, // room for the status bar under the keyboard
    flat: false,
    enabled: () => (tab === 'perkey' || tab === 'keys') && session.ready && !applying,
    onPick: handlePick,
    onHover: () => {},
  });
  view.onFrameColor = (mean) => {
    const now = performance.now();
    if (now - lastGlow < 140) return;
    lastGlow = now;
    const m = Math.max(mean[0], mean[1], mean[2]);
    const c = m < 14 ? [124, 214, 255] : mean.map((v) => Math.min(255, (v * 255) / m));
    if (Math.abs(c[0] - glowNow[0]) + Math.abs(c[1] - glowNow[1]) + Math.abs(c[2] - glowNow[2]) < 8) return;
    glowNow = c;
    rootStyle.setProperty('--glow', c.map((v) => Math.round(v)).join(' '));
    applyGlowInk();
  };
  if (prefs.animate) view.start();

  /** The picture is just a picture (no lighting) when the person chose Picture. Key editing always needs the live board. */
  const pictureOnly = () => prefs.view === 'picture' && tab !== 'perkey' && tab !== 'keys';
  /**
   * The real keyboard is off: asleep, unplugged, not found, or nothing read from it yet. While the app is only
   * (re)connecting or reading settings it keeps the last answer, so a sleeping keyboard that is being checked every few
   * seconds does not make the picture flash on and off.
   */
  let kbOff = true;
  const keyboardOff = () => {
    const st = session.status;
    if (!session.cur) return true;
    if (st === 'ready') kbOff = false;
    else if (['idle', 'searching', 'asleep', 'unsupported', 'error'].includes(st)) kbOff = true;
    return kbOff;
  };

  function previewState() {
    const s = session;
    if (!s.cur) {
      return { mode: 0, dim: true, brightness: 4, speed: 2, colorIndex: 7, palette: M.DEFAULT_PALETTE, colors: null, selection: sel, legends: null };
    }
    const e = s.effect();
    const perKey = tab === 'perkey' || tab === 'keys'; // both draw the board flat, as it is typed on, in the colours painted per key
    const eff = perKey ? P.effectOf(P.MODE_CUSTOM) : e;
    const palette = e.slot >= 0 ? [0, 1, 2, 3, 4, 5, 6].map((j) => P.getPaletteColor(s.cur.rgb, e, j)) : M.DEFAULT_PALETTE;
    return {
      mode: perKey ? P.MODE_CUSTOM : e.mode,
      dim: pictureOnly() || (!perKey && keyboardOff()), // Picture: no lights. Live: dark while the real keyboard is off or asleep
      brightness: (P.getBrightness(s.cur.led, eff) * P.LEVEL_MAX) / s.brightMax, // the preview's scale is 0..4 whatever the keyboard offers
      speed: P.getSpeed(s.cur.led, e),
      colorIndex: P.effectiveColorIndex(s.cur.led, e),
      palette,
      colors: s.cur.colors,
      selection: tab === 'perkey' ? sel : tab === 'keys' && KUI ? KUI.selection() : new Set(),
      legends: tab === 'keys' && KUI ? KUI.legends() : null,
    };
  }

  // ------------------------------------------------------------ static UI build

  const EFFECT_LIST = [...P.EFFECTS, P.EFFECT_OFF];

  /** One line on what each effect looks like, shown under the Effect heading and as the card's tooltip. */
  const EFFECT_INFO = {
    0: 'All lighting is switched off.',
    1: 'Every key stays lit in one colour.',
    2: 'All keys fade up and down together, like a slow breath.',
    3: 'The whole board steps from one colour to the next.',
    4: 'Keys flash and fade away one after another.',
    5: 'Drops of light fall down through the board.',
    6: 'Colour rotates around the middle of the board.',
    7: 'Rings of light spread out across the keys.',
    8: 'Keys twinkle on and off at random.',
    10: 'A trail of light winds across the keys.',
    11: 'Bands of colour flow across the board.',
    12: 'Keys light up when you press them.',
    13: 'A wave of light sweeps across the board.',
    15: 'Coloured spokes spin around the board.',
    16: 'Colours flow down the board like a waterfall.',
    17: 'Colour blooms outward from the middle.',
    21: 'Shows the colours you paint in the Per-key tab.',
  };

  /** Short label for how an effect treats colour, used on the cards and as a chip. */
  function effectTag(e) {
    if (e.off) return 'Lights off';
    if (e.custom) return 'Your colours';
    if (e.mode === 12) return 'Reacts to typing';
    if (e.colorful) return 'Multicolour';
    if (e.color && e.multi) return 'Colour or multi';
    if (e.color) return 'Single colour';
    return '';
  }
  const effectButtons = new Map();

  function buildEffects() {
    const box = $('#effects');
    let n = 0;
    for (const e of EFFECT_LIST) {
      const c = el('canvas', { width: 224, height: 76, 'aria-hidden': 'true' });
      const b = el(
        'button',
        { class: 'effect', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-mode': e.mode, style: `--n:${n++}`, title: EFFECT_INFO[e.mode] || '', onclick: () => session.setEffect(e.mode) },
        c,
        el('span', { class: 'effect-name' }, el('span', { text: e.name }), el('i', { class: 'live-dot', title: 'Running on the keyboard' })),
        el('span', { class: 'effect-tag', text: effectTag(e) }),
      );
      box.append(b);
      const entry = { b, c, e, hot: false };
      effectButtons.set(e.mode, entry);
      bindThumbHover(entry);
    }
  }

  // Hovering an effect plays it in its thumbnail.
  function bindThumbHover(entry) {
    let raf = 0;
    let t0 = 0;
    const run = (now) => {
      if (!t0) t0 = now;
      drawThumb(entry.c, entry.e, V.stillTime(entry.e.mode) + (now - t0) / 1000);
      raf = requestAnimationFrame(run);
    };
    const stop = () => {
      if (!entry.hot) return;
      cancelAnimationFrame(raf);
      entry.hot = false;
      drawThumb(entry.c, entry.e);
    };
    entry.b.addEventListener('pointerenter', () => {
      if (reduceMotion || !prefs.animate || entry.b.disabled || entry.e.off) return;
      entry.hot = true;
      t0 = 0;
      raf = requestAnimationFrame(run);
    });
    entry.b.addEventListener('pointerleave', stop);
    entry.b.addEventListener('blur', stop);
  }

  /**
   * Switches the keyboard model (preview layout and LED map). The firmware effects do not depend on it, so a wrong
   * choice only makes the preview and per-key painting land on the wrong keys; it never changes what is sent.
   * `manual` marks a choice the person made, which the app then stops second-guessing from the USB name.
   */
  function applyModel(id, { manual = false } = {}) {
    if (!L.hasModel(id)) return;
    if (manual) prefs.modelSet = true;
    prefs.model = id;
    savePrefs();
    if (L.use(id)) {
      rebuildKeyCaches();
      sel.clear();
      drag = null;
      view.hover = -1;
      if (prefs.demo) {
        // The simulated keyboard's colour block is sized for the model, so it starts again.
        demoKb = null;
        session.disconnect();
        session.connectAuto().catch(() => {});
      }
      render();
    }
    const box = $('#modelSel');
    if (box) box.value = id;
  }

  // Once per connection: when the USB product name says which model this is and nobody picked one by hand, follow it.
  let modelHintFor = null;
  function suggestModel() {
    const s = session;
    if (!s.connected || prefs.demo || prefs.modelSet) return;
    const key = `${s.ifaceId}|${s.productName}`;
    if (modelHintFor === key) return;
    modelHintFor = key;
    const guess = L.guessModel(s.productName);
    if (guess && guess !== prefs.model) {
      applyModel(guess);
      toast(`Detected ${L.modelName(guess)}: preview layout switched.`, 'info');
    }
  }

  // A keyboard that reports fewer lights than the chosen layout has keys cannot be the model the layout is for.
  let fitWarnedFor = null;
  function checkModelFits() {
    const s = session;
    if (!s.ready || !s.cur || prefs.demo) return;
    const have = P.ledCount(s.cur.colors);
    const need = L.requiredLeds();
    const key = `${prefs.model}|${have}`;
    if (L.fits(have) || fitWarnedFor === key) return;
    fitWarnedFor = key;
    toast(`This keyboard has ${have} lights but the ${L.modelName(prefs.model)} layout needs ${need}. Pick the right model in Settings.`, 'warn');
  }

  function drawThumb(c, e, t) {
    const tt = t === undefined ? V.stillTime(e.mode) : t;
    const g = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    const pad = 7;
    const sx = (w - pad * 2) / L.WIDTH;
    const sy = (h - pad * 2) / L.HEIGHT;
    const cur = session.cur;
    const palette = cur && e.slot >= 0 ? [0, 1, 2, 3, 4, 5, 6].map((j) => P.getPaletteColor(cur.rgb, e, j)) : M.DEFAULT_PALETTE;
    const st = {
      palette,
      colorIndex: cur && e.slot >= 0 ? P.effectiveColorIndex(cur.led, e) : P.MULTICOLOR,
      speed: t === undefined ? 2 : 3,
      colors: cur ? cur.colors : null,
      pressed: (led, now) => ((Math.floor((t === undefined ? 0 : now) * 3) + led * 37) % 11 === 0 ? 1 : 0),
    };
    for (const k of L.KEYS) {
      const col = e.off ? [34, 38, 48] : V.keyColor(e.mode, k, tt, st);
      const lit = e.off ? col : col.map((v) => Math.max(v, 22));
      g.fillStyle = `rgb(${lit[0] | 0},${lit[1] | 0},${lit[2] | 0})`;
      g.fillRect(pad + k.x * sx + 0.8, pad + k.y * sy + 0.8, k.w * sx - 1.6, sy - 1.6);
    }
  }

  // The selected effect keeps playing in its own thumbnail (hovered ones play via bindThumbHover).
  let lastThumb = 0;
  // Whether anyone can see the window. Hidden in the tray or minimized it is false: the keyboard picture and the thumbnail loop
  // stop drawing (the window itself keeps running, so the battery is still read and the red light still works).
  let windowShown = true;
  let thumbRaf = 0;
  function kickThumb() {
    if (!thumbRaf && windowShown) thumbRaf = requestAnimationFrame(thumbLoop);
  }
  function thumbLoop(now) {
    thumbRaf = 0;
    if (!windowShown) return; // the loop ends here and is started again by kickThumb when the window is back
    thumbRaf = requestAnimationFrame(thumbLoop);
    if (document.hidden || tab !== 'lighting' || !prefs.animate || reduceMotion || now - lastThumb < 48) return;
    const cur = session.cur;
    if (!cur) return;
    const entry = effectButtons.get(P.getMode(cur.led));
    if (!entry || entry.hot || entry.e.off || entry.e.custom) return;
    lastThumb = now;
    drawThumb(entry.c, entry.e, V.stillTime(entry.e.mode) + now / 1000);
  }

  // The brightness slider and the little meter follow how many levels the keyboard has (session.brightMax), so they are
  // set up again whenever that changes.
  let brightBuilt = 0;
  function buildBrightScale() {
    const max = session.brightMax;
    if (brightBuilt === max) return;
    brightBuilt = max;
    $('#rngBright').max = max;
    const meter = $('#meterBright');
    meter.replaceChildren();
    for (let i = 0; i < max; i++) {
      const tick = el('i');
      if (max !== P.LEVEL_MAX) tick.style.height = `${Math.round(4 + (9 * i) / (max - 1))}px`;
      meter.append(tick);
    }
  }

  function buildSegs() {
    buildBrightScale();
    $('#rngBright').addEventListener('input', (e) => session.setBrightness(+e.target.value));
    const speed = $('#segSpeed');
    ['1', '2', '3', '4', '5'].forEach((label, v) =>
      speed.append(el('button', { class: 'seg-btn', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-v': v, 'aria-label': `Speed level ${v + 1}`, text: label, onclick: () => session.setSpeed(v) })),
    );
  }

  const QUICK = ['#ff2d2d', '#ff7a00', '#ffd400', '#00d26a', '#00c8ff', '#2f5bff', '#8a2be2', '#ff2fa0', '#ffffff', '#000000'];

  function buildQuickSwatches() {
    const box = $('#pkSwatches');
    for (const hex of QUICK) {
      box.append(
        el('button', {
          class: 'swatch', type: 'button', role: 'button', 'aria-label': `Use ${hex}`, title: hex,
          style: `background:${hex}`,
          onclick: () => setPkColor(hex),
        }),
      );
    }
  }

  function setPkColor(hex) {
    const rgb = P.hexToRgb(hex);
    if (!rgb) return;
    $('#pkInput').value = hexOf(rgb);
    $('#pkHex').value = hexOf(rgb);
    $('#pkHex').removeAttribute('aria-invalid');
  }

  const pkRGB = () => P.hexToRgb($('#pkInput').value) || [255, 255, 255];

  // ---------------------------------------------------------------- rendering

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function render() {
    suggestModel();
    checkModelFits();
    renderTabs();
    renderTop();
    renderOverlay();
    renderLighting();
    renderStageBar();
    renderStageView();
    renderPerKey();
    if (KUI) KUI.render();
    renderBattery();
    renderDevice();
    renderApply();
    if (MO) MO.writing(applying || session.restoring);
    view.opts.flat = tab === 'perkey' || tab === 'keys';
    view.setState(previewState());
    if (MXU && MXU.active()) MXU.show(tab); // also repaints the header chips with the Max's link and battery
  }

  function renderTabs() {
    // The Battery screen has no tab of its own: the battery pill in the header opens it, and shows it is open.
    const btns = $$('.tab-btn');
    const anyOn = btns.some((b) => b.dataset.tab === tab);
    for (const b of btns) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on || (!anyOn && b === btns[0]) ? 0 : -1; // keep the tab bar reachable by keyboard
    }
    const chip = $('#batChip');
    if (chip) {
      if (tab === 'battery') chip.setAttribute('aria-current', 'page');
      else chip.removeAttribute('aria-current');
    }
    for (const p of $$('.panel')) p.hidden = p.id !== `panel-${tab}`;
    placeTabInd();
  }

  let tabPlaced = false;
  function placeTabInd() {
    const b = $('.tab-btn[aria-selected="true"]');
    const ind = $('#tabInd');
    if (!ind) return;
    if (!b) {
      // On the Battery screen no tab is selected: hide the highlight, and jump it into place when a tab comes back.
      ind.style.opacity = '0';
      tabPlaced = false;
      return;
    }
    ind.style.opacity = '';
    const set = () => {
      ind.style.setProperty('--x', `${b.offsetLeft}px`);
      ind.style.setProperty('--w', `${b.offsetWidth}px`);
    };
    if (!tabPlaced) {
      // First placement jumps into position instead of sliding in from the left.
      ind.style.transition = 'none';
      set();
      ind.getBoundingClientRect();
      ind.style.transition = '';
      tabPlaced = true;
    } else {
      set();
    }
  }

  const STATUS = {
    idle: ['No keyboard found', 'bad'],
    searching: ['Looking for keyboard', 'busy'],
    connecting: ['Connecting', 'busy'],
    reading: ['Reading settings', 'busy'],
    asleep: ['Keyboard asleep', 'warn'],
    unsupported: ['Model not supported', 'warn'],
    error: ['Not connected', 'bad'],
  };

  const batState = (p) => (p === null ? '' : p <= Math.max(prefs.low, 15) ? 'bad' : p < 40 ? 'warn' : 'ok');

  function renderTop() {
    const s = session;
    let text;
    let kind;
    if (s.status === 'ready') {
      text = s.mode === 'demo' ? 'Demo keyboard' : s.iface;
      kind = 'ok';
    } else {
      [text, kind] = STATUS[s.settling ? 'connecting' : s.status] || ['Unknown', 'warn'];
    }
    $('#connText').textContent = text;
    $('#connDot').dataset.s = kind;
    $('#connChip').title = text;
    $('#sbLink b').textContent = text;
    $('#sbLink').dataset.s = kind;

    const p = s.battery.percent;
    const chg = s.charging;
    $('#batChipText').textContent = p !== null ? `${p}%` : chg ? 'Charging' : 'No reading';
    $('#batChip').dataset.stale = p !== null && !s.connected ? '1' : '';
    $('#batChip').dataset.chg = chg ? '1' : '';
    $('#batChip').dataset.unk = chg && p === null ? '1' : '';
    $('#batChip').dataset.wide = p === null ? '1' : ''; // "No reading" / "Charging" is wide: the header drops it first when space runs out
    let title = 'Battery';
    if (chg && !s.onCable) title = p === null ? 'Charging. The USB-C cable is plugged in.' : `Charging, ${p}%`;
    else if (chg) title = p === null ? 'Charging over USB-C. The cable does not report the charge level.' : s.battery.source === 'usb' ? 'Charging over USB-C' : 'Charging over USB-C. The percentage is the last one the keyboard reported.';
    else if (p !== null && !s.connected) title = 'Last reading. The keyboard is not connected.';
    $('#batChip').title = title;
    $('#batChip').dataset.s = batState(p);
    // Charging with no reading: a full bar that the style sheet fills up again and again, so no level is claimed.
    $('#batFill').style.width = `${p === null ? (chg ? 12.6 : 0) : (12.6 * p) / 100}px`;
  }

  /** Look now: end any wait for an answer that is still running, then join (or start) the connect. */
  function tryAgain() {
    session.poke();
    return session.connectAuto();
  }

  let ovSig = null;
  let ovLeave = 0;
  // The message card fades out (and the keyboard drawing fades back in) instead of vanishing.
  const hideOv = (o) => {
    if (o.hidden || o.classList.contains('leaving')) return;
    if (!MO || MO.reduced()) {
      o.hidden = true;
      return;
    }
    o.classList.add('leaving');
    clearTimeout(ovLeave);
    ovLeave = setTimeout(() => {
      o.hidden = true;
      o.classList.remove('leaving');
    }, 240);
  };
  const showOv = (o) => {
    clearTimeout(ovLeave);
    o.classList.remove('leaving');
    o.hidden = false;
  };
  function renderOverlay() {
    const s = session;
    const o = $('#overlay');
    // Rebuilding the buttons on every render would swallow clicks, so only do it when the content changes.
    const btOnly = s.status === 'idle' && s.battery.source === 'bluetooth' && s.battery.at && Date.now() - s.battery.at < 5 * 60 * 1000;
    const sig = `${s.status}|${s.statusDetail}|${prefs.demo}|${s.candidates.map((c) => c.mode).join()}|${s.cur ? 1 : 0}|${s.connecting ? 1 : 0}|${s.settling ? 1 : 0}|${btOnly ? 'bt' : ''}`;
    if (sig === ovSig) return;
    ovSig = sig;
    const title = $('#ovTitle');
    const body = $('#ovBody');
    const acts = $('#ovActions');
    acts.textContent = '';
    const show = (t, b, actions = []) => {
      title.textContent = t;
      body.textContent = b;
      for (const a of actions) acts.append(a);
      // A spinner shows while the app is working rather than waiting for the user. An error that is still within its
      // grace time counts as working: the app keeps trying behind it.
      const busy = ['searching', 'connecting', 'reading'].includes(s.status) || s.settling;
      o.dataset.busy = busy ? '1' : '';
      title.dataset.dots = busy ? '1' : '';
      showOv(o);
    };
    const btn = (label, fn, cls = 'btn') => el('button', { class: cls, type: 'button', text: label, onclick: fn });

    switch (s.status) {
      case 'ready':
        hideOv(o);
        return;
      case 'idle':
        show(
          btOnly ? 'Keyboard found over Bluetooth' : 'No keyboard found',
          btOnly
            ? `Windows reports its battery (${s.battery.percent}%). Windows does not let apps change lighting over Bluetooth: for that, plug in the 2.4G dongle or the USB-C cable and set the keyboard’s switch to match.`
            : W.hasHid() || prefs.demo
            ? 'Plug in the 2.4G dongle or the USB-C cable and set the keyboard’s switch to match. It shows up here within a few seconds.'
            : 'This window cannot reach USB devices.',
          [btn('Connect keyboard', connectFlow), btn('Try the demo keyboard', () => setDemo(true), 'btn ghost')],
        );
        return;
      case 'reading':
        if (s.cur) {
          hideOv(o);
          return;
        }
        show('Reading your keyboard', 'This takes a couple of seconds.');
        return;
      case 'searching':
      case 'connecting':
        show('Reading your keyboard', s.statusDetail || 'This takes a couple of seconds.');
        return;
      case 'asleep':
        show('Keyboard is asleep', 'Press any key to wake it. Settings load as soon as it responds.');
        return;
      case 'unsupported':
        show(
          'This model is not supported yet',
          `Found: ${s.statusDetail}. This app speaks the protocol of the AULA F75, F75 Pro and F87. This device uses a different one, and sending it commands meant for another model could change settings you did not intend, so the app leaves it alone. Settings, Connection help, Save compatibility report records what this keyboard looks like so support can be added.`,
          [btn('Search again', tryAgain), btn('Try the demo keyboard', () => setDemo(true), 'btn ghost')],
        );
        return;
      case 'error': {
        const cable = s.candidates.some((c) => c.mode === 'wired');
        const dongle = s.candidates.some((c) => c.mode === 'dongle');
        if (s.settling) {
          // Still inside the first stretch of trying: keep the animation going and only show the error if it does not work out.
          show('Connecting to your keyboard', 'Waking it up. Press any key on the keyboard if it stays asleep.');
          return;
        }
        // "no answer to command 0x44" is for the packet log; the screen says what it means.
        const what = /^no answer to command/i.test(s.statusDetail || '') ? 'The keyboard did not answer.' : s.statusDetail || 'No answer.';
        show(
          'Could not talk to the keyboard',
          `${what} ` +
            (dongle ? 'Press any key on the keyboard to wake it. ' : '') +
            'Close other keyboard software (such as the official AULA driver), then try again.' +
            (cable ? ' The keyboard was found on the USB-C cable but did not hand over its settings. Check that its mode switch is set to cable and try again. The cable uses its own protocol, which has not been checked on every unit: if it stays silent, the 2.4G dongle is the more tested path, and Settings, Connection help, Save compatibility report records what the cable did so it can be fixed.' : '') +
            (s.connecting ? ' Still trying in the background; this screen clears by itself when the keyboard answers.' : ''),
          [btn('Try again', tryAgain), btn('Open Settings', () => { setSettingsPage('keyboard'); setTab('settings'); }, 'btn ghost')],
        );
        return;
      }
      default:
        hideOv(o);
    }
  }

  // ------------------------------------------------------------- lighting tab

  let sleepSig = '';
  let lastMode = null;

  /** Lights the first `n` ticks of a level meter. */
  function setMeter(sel, n) {
    [...$(sel).children].forEach((tick, i) => tick.classList.toggle('on', i < n));
  }

  /** The status bar under the keyboard: model, link, and what is running (follows the Per-key tab too). */
  function renderStageBar() {
    const s = session;
    const cur = s.cur;
    $('#sbModel b').textContent = L.modelName(prefs.model);
    const e = cur ? s.effect() : null;
    const eff = e && tab === 'perkey' ? P.effectOf(P.MODE_CUSTOM) : e;
    const hasSlot = !!eff && eff.slot >= 0;
    $('#sbFx').hidden = !eff || !!eff.unknown;
    if (eff) $('#sbFx b').textContent = eff.name;
    $('#sbSpeed').hidden = !(hasSlot && eff.speed);
    if (hasSlot && eff.speed) $('#sbSpeed b').textContent = `Speed ${P.getSpeed(cur.led, eff) + 1}/5`;
    $('#sbBright').hidden = !hasSlot;
    if (hasSlot) {
      const b = P.getBrightness(cur.led, eff);
      $('#sbBright b').textContent = b === 0 ? 'Brightness off' : `Brightness ${b}/${session.brightMax}`;
    }
    const sw = $('#sbColor');
    const hasColor = hasSlot && !eff.custom && (eff.color || eff.colorful || eff.multi);
    sw.hidden = !hasColor;
    if (hasColor) {
      const ci = P.effectiveColorIndex(cur.led, eff);
      const multi = ci === P.MULTICOLOR;
      const hex = multi ? '' : hexOf(P.getPaletteColor(cur.rgb, eff, ci));
      sw.querySelector('.sb-sw').style.background = multi ? 'conic-gradient(#f33, #fa0, #ee0, #3d6, #0cf, #55f, #b4f, #f3a, #f33)' : hex;
      sw.querySelector('b').textContent = multi ? 'Multicolour' : hex.toUpperCase();
    }
  }

  function renderStageView() {
    const box = $('#stageView');
    if (!box) return;
    box.hidden = tab === 'perkey' || tab === 'keys'; // painting and key assignment always show the live board
    const picture = prefs.view === 'picture';
    for (const b of box.querySelectorAll('.sv-btn')) b.setAttribute('aria-pressed', String((b.dataset.view === 'picture') === picture));
    box.dataset.live = picture ? 'pic' : keyboardOff() ? 'off' : 'on';
  }

  function renderLighting() {
    const s = session;
    const ready = s.ready;
    const cur = s.cur;
    const e = cur ? s.effect() : null;
    const mode = cur ? P.getMode(cur.led) : -1;

    const liveMode = s.dev0 ? P.getMode(s.dev0.led) : null;
    const animSel = prefs.animate && !reduceMotion;
    for (const entry of effectButtons.values()) {
      const on = !!cur && entry.e.mode === mode;
      entry.b.setAttribute('aria-checked', on ? 'true' : 'false');
      entry.b.dataset.live = liveMode !== null && entry.e.mode === liveMode ? 'true' : 'false';
      entry.b.disabled = !ready;
      if (!entry.hot && !(on && animSel && !entry.e.off && !entry.e.custom)) drawThumb(entry.c, entry.e);
    }
    $('#effName').textContent = e ? e.name : '';
    $('#effDesc').textContent = e ? (e.unknown ? '' : EFFECT_INFO[e.mode] || '') : '';
    const chips = $('#effChips');
    chips.textContent = '';
    if (e && !e.unknown && !e.off) {
      const tag = effectTag(e);
      if (tag) chips.append(el('span', { class: 'chip accent', text: tag }));
      chips.append(el('span', { class: 'chip', text: e.speed ? 'Adjustable speed' : 'Fixed speed' }));
      if (e.slot >= 0) chips.append(el('span', { class: 'chip', text: 'Own brightness' }));
      chips.append(el('span', { class: 'chip mono', text: `Mode ${e.mode}` }));
    }
    // Switching effect sweeps the new look across the big preview once.
    if (cur && lastMode !== null && mode !== lastMode && tab === 'lighting' && !pictureOnly()) view.playIntro(true);
    lastMode = cur ? mode : null;

    const hasSlot = !!e && e.slot >= 0;
    $('#cardBright').hidden = !hasSlot;
    $('#cardSpeed').hidden = !(hasSlot && e.speed);
    $('#cardColor').hidden = !(hasSlot && (e.color || e.multi));

    if (hasSlot) {
      buildBrightScale();
      const b = P.getBrightness(cur.led, e);
      const sp = P.getSpeed(cur.led, e);
      $('#valBright').textContent = b === 0 ? 'Off' : `Level ${b} of ${session.brightMax}`;
      $('#valSpeed').textContent = `Level ${sp + 1} of 5`;
      setMeter('#meterBright', b);
      setMeter('#meterSpeed', sp + 1);
      const rng = $('#rngBright');
      if (+rng.value !== b) rng.value = b;
      rng.style.setProperty('--pf', b / session.brightMax);
      rng.setAttribute('aria-valuetext', b === 0 ? 'Off' : `Level ${b} of ${session.brightMax}`);
      rng.disabled = !ready;
      $('#segSpeed').style.setProperty('--i', sp);
      for (const x of $$('#segSpeed .seg-btn')) {
        x.setAttribute('aria-checked', +x.dataset.v === sp ? 'true' : 'false');
        x.disabled = !ready;
      }
      renderColorCard(e, cur, ready);
    }

    // note under the effect grid
    const notes = [];
    if (e) {
      if (e.off) notes.push('All lighting is switched off.');
      else if (e.unknown) notes.push(`The keyboard is set to a mode (${mode}) this app does not know. Choose an effect to replace it.`);
      else if (e.custom) notes.push('Shows the colours you paint in the Per-key tab.');
      else if (e.colorful) notes.push('This effect always runs in multicolour.');
      if (hasSlot && P.getBrightness(cur.led, e) === 0) notes.push('Brightness is Off, so this effect shows nothing.');
      if (hasSlot && e.color) {
        const ci = P.getColorIndex(cur.led, e);
        if (ci < 7 && P.getPaletteColor(cur.rgb, e, ci).every((v) => v < 3)) notes.push('The selected colour is black, so the effect looks off. Pick another swatch.');
        if (!s.readable.rgb) notes.push('Over the USB-C cable the keyboard did not hand over its colour palette. The swatches show typical colours and the keyboard may show slightly different ones. Choosing a swatch still works; editing its colour needs the 2.4G dongle.');
      }
    }
    $('#effNote').textContent = notes.join(' ');

    renderSleep(ready, cur);
  }

  function renderColorCard(e, cur, ready) {
    const box = $('#swatches');
    const ci = P.effectiveColorIndex(cur.led, e);
    const wanted = (e.color ? 7 : 0) + (e.multi ? 1 : 0);
    if (box.children.length !== wanted || box.dataset.slot !== String(e.slot)) {
      box.textContent = '';
      box.dataset.slot = String(e.slot);
      if (e.color) {
        for (let j = 0; j < 7; j++) {
          box.append(el('button', { class: 'swatch', type: 'button', role: 'radio', 'data-j': j, 'aria-checked': 'false', onclick: () => session.setColorIndex(j) }));
        }
      }
      if (e.multi) {
        box.append(el('button', { class: 'swatch rainbow', type: 'button', role: 'radio', 'data-j': 7, 'aria-checked': 'false', 'aria-label': 'Multicolour', title: 'Multicolour', onclick: () => session.setColorIndex(7) }));
      }
    }
    for (const b of box.children) {
      const j = +b.dataset.j;
      b.setAttribute('aria-checked', j === ci ? 'true' : 'false');
      b.disabled = !ready;
      if (j < 7) {
        const hex = hexOf(P.getPaletteColor(cur.rgb, e, j));
        b.style.background = hex;
        b.title = session.readable.rgb ? hex : `${hex} (typical colour, not read from the keyboard)`;
        b.setAttribute('aria-label', `Colour ${j + 1}, ${hex}`);
      }
    }
    const multi = ci === P.MULTICOLOR;
    $('#colorEdit').hidden = multi || !e.color;
    $('#valColor').textContent = multi ? 'Multicolour' : e.color ? `Swatch ${ci + 1}` : '';
    if (!multi && e.color) {
      const hex = hexOf(P.getPaletteColor(cur.rgb, e, ci));
      const input = $('#palInput');
      const hexIn = $('#palHex');
      if (document.activeElement !== hexIn) hexIn.value = hex;
      if (input.value.toLowerCase() !== hex) input.value = hex;
      input.disabled = !ready || !session.readable.rgb;
      hexIn.disabled = !ready || !session.readable.rgb;
    }
  }

  function renderSleep(ready, cur) {
    const sel_ = $('#sleepSel');
    const raw = cur ? P.getSleepValue(cur.led) : null;
    const known = P.SLEEP_OPTIONS.some((o) => o.value === raw);
    const sig = `${raw !== null && !known ? raw : ''}`;
    if (!sel_.options.length || sig !== sleepSig) {
      sleepSig = sig;
      sel_.textContent = '';
      for (const o of P.SLEEP_OPTIONS) {
        const label = o.seconds < 120 ? `${o.seconds} seconds` : `${o.seconds / 60} minutes`;
        sel_.append(el('option', { value: o.value, text: o.seconds === 60 ? '1 minute' : label }));
      }
      if (raw !== null && !known) sel_.append(el('option', { value: raw, text: `Custom (${raw * 30} seconds)` }));
    }
    if (raw !== null) sel_.value = String(raw);
    sel_.disabled = !ready;
  }

  // -------------------------------------------------------------- per-key tab

  function renderPerKey() {
    const ready = session.ready;
    $('#selCount').textContent = `${plural(sel.size, 'key')} selected`;
    for (const b of $$('#segTool .seg-btn')) b.setAttribute('aria-checked', b.dataset.tool === prefs.tool ? 'true' : 'false');
    $('#segTool').style.setProperty('--i', prefs.tool === 'brush' ? 1 : 0);
    $('#toolHint').textContent =
      (prefs.tool === 'brush'
        ? 'Click or drag across the keys above to paint them with the colour below.'
        : 'Click or drag across the keys above to select them, then press Paint selected.') +
      (ready && !session.readable.colors
        ? ' Over the USB-C cable the keyboard cannot report the colours it shows now, so keys you do not paint go dark when you apply, and the result cannot be read back to check it.'
        : '');
    for (const id of ['pkPaintSel', 'pkSelAll', 'pkSelNone', 'pkRainbow', 'pkGradient', 'pkAll', 'pkBlack', 'pkInput', 'pkHex', 'pkInput2']) $('#' + id).disabled = !ready;
    $('#pkPaintSel').disabled = !ready || sel.size === 0;
    $('#pkSelNone').disabled = !ready || sel.size === 0;
  }

  function handlePick(k, e, phase) {
    if (tab === 'keys') {
      if (phase === 'down' && k && session.ready && !applying && KUI) KUI.pick(k);
      return;
    }
    if (tab !== 'perkey' || !session.ready || applying) return;
    if (phase === 'up') {
      drag = null;
      return;
    }
    const toggle = (led, mode) => {
      if (mode === 'add') sel.add(led);
      else sel.delete(led);
      scheduleRender();
    };
    if (phase === 'down') {
      if (!k) {
        if (prefs.tool === 'select' && sel.size) {
          sel.clear();
          scheduleRender();
        }
        return;
      }
      if (prefs.tool === 'brush') {
        drag = 'brush';
        session.paintKeys([k.led], pkRGB());
        return;
      }
      drag = sel.has(k.led) ? 'del' : 'add';
      toggle(k.led, drag);
      return;
    }
    if (phase === 'move' && k) {
      if (drag === 'brush') session.paintKeys([k.led], pkRGB());
      else if (drag) toggle(k.led, drag);
    }
  }

  // -------------------------------------------------------------- battery tab

  // Names Windows may list the keyboard under when it is paired over Bluetooth.
  const BT_PATTERN = 'AULA|F75|F87';
  const SOURCES = { dongle: '2.4G dongle', usb: 'USB-C cable', demo: 'Demo keyboard', bluetooth: 'Bluetooth, via Windows' };

  function renderBattery() {
    const b = session.battery;
    const p = b.percent;
    const chg = session.charging;
    $('#gauge').dataset.s = batState(p);
    $('#gauge').dataset.chg = chg ? '1' : '';
    $('#gauge').dataset.unk = chg && p === null ? '1' : '';
    $('#gChg').hidden = !chg;
    $('#gFill').style.width = `${p === null ? (chg ? 100 : 0) : p}%`;
    countTo($('#gNum'), p);
    // Right of the level: the time to full or empty when the readings so far allow an estimate, else a plain word.
    const hist = histData();
    const rate = p === null ? null : chg ? B.chargeRate(hist, Date.now()) : B.drainRate(hist, Date.now());
    let est = '';
    if (rate && p < 100 && (chg || p > 0)) est = chg ? `${B.duration((100 - p) / rate)} until full` : `${B.duration(p / rate)} left`;
    $('#gLbl').textContent = est || (p === 100 ? (chg ? 'Fully charged' : 'Full') : chg ? 'Charging' : p === null ? 'No reading yet' : p <= 10 ? 'Charge soon' : p <= 25 ? 'Getting low' : 'Good');
    $('#gStatus').textContent = chg ? (session.onCable || session.cablePlugged ? 'USB-C cable connected' : 'The level is rising, so the keyboard is charging') : p === null ? '' : 'Running on battery';
    $('#swFull').setAttribute('aria-checked', prefs.full ? 'true' : 'false');
    $('#swLowLight').setAttribute('aria-checked', prefs.lowLight ? 'true' : 'false');
    $('#lowLightHint').textContent = `${
      session.lowLight ? 'The keyboard is breathing red because the battery is low. Your own lighting comes back when you plug in the cable. ' : ''
    }${LOW_LIGHT_NOTE}`;
    $('#batSource').textContent = b.source ? SOURCES[b.source] || b.source : '—';
    renderBatteryAge();

    let hint = '';
    if (chg && !session.onCable) {
      if (p === 100) hint = 'Fully charged. You can unplug the cable.';
      else if (session.cablePlugged) hint = 'USB-C cable detected, so the keyboard is charging. The level is read every few seconds and goes up as it charges.';
      else hint = 'Charging. The level is read every few seconds and goes up as the keyboard charges.';
    }
    else if (chg && p === null) hint = 'Plugged in over USB-C, so the keyboard is charging. The cable has no battery report, so there is no percentage and no fully charged alert. Switch the keyboard to the 2.4G dongle (leave the cable plugged in to charge) to see the level rise.';
    else if (chg && b.source !== 'usb') hint = 'Charging over USB-C. The percentage is the last reading; the cable does not report it live. Switch to the 2.4G dongle to read it.';
    else if (p === null) {
      if (session.link === 'feature') hint = 'The USB-C cable has no battery report. Switch the keyboard to the 2.4G dongle to read it.';
      else if (session.mode === 'wired') hint = 'Some keyboards do not report battery over the USB-C cable. Switch to the 2.4G dongle to read it.';
      else if (!session.connected) hint = host ? 'Connect the keyboard, or pair it over Bluetooth so Windows can report its battery.' : 'Connect the keyboard to read its battery.';
    }
    $('#batHint').textContent = hint;

    renderChart();

    const low = $('#lowSel');
    if (!low.options.length) {
      for (const v of [0, 10, 15, 20, 30, 40, 50]) low.append(el('option', { value: v, text: v === 0 ? 'Never' : `${v}%` }));
    }
    low.value = String(prefs.low);
  }

  // The big battery number counts up or down to a new reading instead of jumping.
  const counters = new WeakMap();
  function countTo(node, value) {
    const prev = counters.get(node);
    const show = (v) => (node.textContent = v === null ? '\u2014' : `${Math.round(v)}%`);
    // Same reading again (every render repeats it): leave a count that is still running alone.
    if (prev && prev.value === value) {
      if (!prev.raf) show(value);
      return;
    }
    if (prev && prev.raf) cancelAnimationFrame(prev.raf);
    if (value === null || !prefs.animate || !prev || prev.value === null) {
      counters.set(node, { value, raf: 0 });
      show(value);
      return;
    }
    const from = prev.shown ?? prev.value;
    const t0 = performance.now();
    const state = { value, raf: 0, shown: from };
    counters.set(node, state);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      state.shown = from + (value - from) * e;
      show(state.shown);
      state.raf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    state.raf = requestAnimationFrame(step);
  }

  function renderBatteryAge() {
    const b = session.battery;
    $('#batAge').textContent = b.at ? ago(Date.now() - b.at) : '—';
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  // The history the charts draw. The demo keyboard has none, so it gets a made-up week (never saved) to show the layout.
  function histData() {
    const h = session.history;
    if (h.length >= 2 || session.mode !== 'demo') return h;
    const now = Math.floor(Date.now() / B.HOUR * 2) * (B.HOUR / 2);
    const pNow = session.battery.percent ?? 78;
    const phase0 = (100 - pNow) / 0.95; // hours since the last full charge, so the last point meets the live reading
    const out = [];
    for (let k = 336; k >= 0; k--) {
      const hBack = k / 2;
      const ph = (((phase0 - hBack) % 75) + 75) % 75;
      const charging = ph >= 72;
      out.push({ t: now - k * (B.HOUR / 2), p: Math.round(charging ? 31.6 + (ph - 72) * 22.8 : 100 - ph * 0.95), c: charging ? 1 : 0 });
    }
    return out;
  }

  let histDay = 0; // 0 is today, 6 is six days ago
  let chartSig = '';
  let daysSig = 0;
  const monthOf = (d) => d.toLocaleDateString([], { month: 'short' });

  function renderChart() {
    const now = Date.now();
    const hist = histData();
    const p = session.battery.percent;
    const chg = session.charging;
    $('#histClear').hidden = !session.history.length;
    const sig = [histDay, hist.length, hist.length ? hist[hist.length - 1].t : 0, p, chg ? 1 : 0, Math.floor(now / 60000)].join(':');
    if (sig === chartSig) return;
    chartSig = sig;
    renderDays(now);
    drawActivity(now, hist, p, chg);
    drawSince(now, hist, p, chg);
  }

  // The seven day buttons are built once a day; picking one only moves the pressed state, so keyboard focus stays on it.
  function renderDays(now) {
    const box = $('#days');
    const today = B.dayStart(now, 0);
    if (daysSig !== today) {
      daysSig = today;
      box.textContent = '';
      for (let back = 6; back >= 0; back--) {
        const d = new Date(B.dayStart(now, back));
        box.append(el('button', {
          class: 'day', type: 'button', 'data-back': back, text: String(d.getDate()),
          title: d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }),
          onclick: () => { histDay = back; chartSig = ''; renderChart(); },
        }));
      }
    }
    for (const b of $$('.day', box)) b.setAttribute('aria-pressed', String(Number(b.dataset.back) === histDay));
  }

  const BOLT = '13 2 3 14 12 14 11 22 21 10 12 10 13 2';

  /** Hourly bars for the picked day, like the phone's battery activity: green while charging, a marker at "now". */
  function drawActivity(now, hist, p, chg) {
    const box = $('#chart');
    const start = B.dayStart(now, histDay);
    const d = new Date(start);
    $('#dayTitle').textContent = `${d.getDate()} ${monthOf(d)} ${histDay === 0 ? 'Today' : histDay === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long' })}`;
    const today = histDay === 0;
    $('#lgEst').hidden = !today;
    box.textContent = '';
    const bars = B.hourBuckets(hist, start);
    const pts = hist.filter((h) => h.t >= start && h.t < start + B.DAY);
    if (!pts.length) {
      $('#histSummary').textContent = '';
      box.append(el('div', { class: 'empty', text: today ? 'History builds up while the app is running and the keyboard reports its battery.' : 'No readings on this day. The app records the battery only while it is running.' }));
      return;
    }
    const lo = Math.min(...pts.map((q) => q.p));
    const hi = Math.max(...pts.map((q) => q.p));
    $('#histSummary').textContent = `${plural(pts.length, 'reading')}, low ${lo}%, high ${hi}%`;

    const W_ = 600, H_ = 200;
    const m = { l: 6, r: 44, t: 38, b: 26 };
    const pw = W_ - m.l - m.r;
    const slot = pw / 24;
    const bw = slot * 0.52;
    const y = (v) => m.t + (1 - v / 100) * (H_ - m.t - m.b);
    const s = svg('svg', { viewBox: `0 0 ${W_} ${H_}`, role: 'img', 'aria-label': `Battery level by hour on ${$('#dayTitle').textContent}, from ${hi}% at most to ${lo}% at least.` });
    for (const [h0, h1] of [[0, 6], [18, 24]]) s.append(svg('rect', { class: 'night', x: m.l + h0 * slot, y: m.t, width: (h1 - h0) * slot, height: y(0) - m.t }));
    for (const g of [0, 100]) {
      s.append(svg('line', { class: 'grid', x1: m.l, x2: W_ - m.r, y1: y(g), y2: y(g) }));
      s.append(svg('text', { class: 'axis', x: W_ - m.r + 10, y: y(g) + 4 }, String(g)));
    }
    s.append(svg('text', { class: 'axis', x: W_ - m.r + 10, y: H_ - 6 }, '(%)'));
    s.append(svg('text', { class: 'axis', x: m.l, y: H_ - 6 }, '12 AM'));
    s.append(svg('text', { class: 'axis', x: m.l + 12 * slot, y: H_ - 6, 'text-anchor': 'middle' }, '12 PM'));

    const frac = (now - start) / B.DAY;
    const xn = m.l + Math.min(1, Math.max(0, frac)) * pw;
    const rate = today && p !== null ? (chg ? B.chargeRate(hist, now) : B.drainRate(hist, now)) : null;
    if (rate) { // the estimate: where the level is heading by the end of the day
      const mins = (B.DAY - (now - start)) / B.MIN;
      const end = chg ? Math.min(100, p + rate * mins) : Math.max(0, p - rate * mins);
      s.append(svg('polygon', { class: chg ? 'est up' : 'est', points: `${xn},${y(p)} ${W_ - m.r},${y(end)} ${W_ - m.r},${y(0)} ${xn},${y(0)}` }));
    }
    bars.forEach((b, h) => {
      if (!b) return;
      const top = Math.min(y(b.p), y(0) - 3);
      const r = svg('rect', { class: b.c ? 'bar chg' : 'bar', x: m.l + h * slot + (slot - bw) / 2, y: top, width: bw, height: y(0) - top, rx: bw / 2 });
      const hour = new Date(start + h * B.HOUR).toLocaleTimeString([], { hour: 'numeric' });
      r.append(svg('title', {}, `${hour}: ${b.p}%${b.c ? ', charging' : ''}`));
      s.append(r);
    });
    if (today && p !== null) {
      s.append(svg('line', { class: 'now', x1: xn, x2: xn, y1: 30, y2: y(0) }));
      const bx = Math.min(W_ - m.r - 26, Math.max(m.l + 26, xn));
      s.append(svg('rect', { class: 'bub', x: bx - 26, y: 4, width: 52, height: 26, rx: 13 }));
      if (chg) s.append(svg('polygon', { class: 'bub-bolt', points: BOLT, transform: `translate(${bx - 21} 9) scale(0.5)` }));
      s.append(svg('text', { class: 'bub-t', x: bx + (chg ? 6 : 0), y: 22, 'text-anchor': 'middle' }, String(p)));
    }
    box.append(s);
  }

  /** The level since the last charge (or during this one), with a dotted line to where it is heading. */
  function drawSince(now, hist, p, chg) {
    const box = $('#since');
    const run = B.sinceCharge(hist, chg, now);
    $('#sinceTitle').textContent = chg ? 'This charge' : run.known ? 'Since last charge' : 'Recent use';
    const pts = run.points.slice();
    if (p !== null) pts.push({ t: now, p, c: chg ? 1 : 0 });
    box.textContent = '';
    if (pts.length < 2) {
      $('#sinceSummary').textContent = '';
      box.append(el('div', { class: 'empty', text: 'Readings since the last charge will show here.' }));
      return;
    }
    const change = chg ? Math.max(0, p - pts[0].p) : Math.max(0, pts[0].p - p);
    $('#sinceSummary').textContent = chg ? `+${change}% so far` : `${change}% used`;

    const W_ = 600, H_ = 150;
    const m = { l: 6, r: 44, t: 10, b: 26 };
    const rate = p === null ? null : chg ? B.chargeRate(hist, now) : B.drainRate(hist, now);
    const rem = rate && p > 0 && p < 100 ? (chg ? (100 - p) / rate : p / rate) : 0; // minutes to full / to empty
    const t0 = pts[0].t;
    const tEnd = rem ? now + rem * B.MIN : Math.max(now, t0 + B.HOUR);
    const x = (t) => m.l + ((t - t0) / Math.max(1, tEnd - t0)) * (W_ - m.l - m.r);
    const y = (v) => m.t + (1 - v / 100) * (H_ - m.t - m.b);
    const s = svg('svg', { viewBox: `0 0 ${W_} ${H_}`, role: 'img', 'aria-label': `Battery level ${chg ? 'during this charge' : 'since the last charge'}, ${chg ? `up ${change}%` : `${change}% used`}${rem ? `, about ${B.duration(rem)} ${chg ? 'until full' : 'left'}` : ''}.` });
    for (const g of [0, 100]) {
      s.append(svg('line', { class: 'grid', x1: m.l, x2: W_ - m.r, y1: y(g), y2: y(g) }));
      s.append(svg('text', { class: 'axis', x: W_ - m.r + 10, y: y(g) + 4 }, String(g)));
    }
    s.append(svg('text', { class: 'axis', x: W_ - m.r + 10, y: H_ - 6 }, '(%)'));
    const line = pts.map((q) => `${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
    s.append(svg('polygon', { class: chg ? 'sarea up' : 'sarea', points: `${x(t0)},${y(0)} ${line} ${x(now)},${y(0)}` }));
    if (rem) {
      s.append(svg('line', { class: 'sline', x1: x(now), y1: y(p), x2: W_ - m.r, y2: y(chg ? 100 : 0) }));
      s.append(svg('text', { class: 'axis hi', x: W_ - m.r, y: H_ - 6, 'text-anchor': 'end' }, `${B.duration(rem)} ${chg ? 'until full' : 'left'}`));
    }
    s.append(svg('text', { class: 'axis', x: m.l, y: H_ - 6 }, new Date(t0).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
    $('#sinceLegend').lastElementChild.hidden = !rem;
    box.append(s);
  }

  // --------------------------------------------------------------- device tab

  /** What the USB-C cable did not hand over, in words (empty on the dongle, where everything is read). */
  function cableGaps(s) {
    const gone = [];
    if (s.unread.includes('rgb')) gone.push('colour palette (shown with typical colours, never written)');
    if (s.unread.includes('colors')) gone.push('per-key colours (written only when you paint keys)');
    if (!gone.length) return '';
    return ` Over the cable the keyboard did not hand over its ${gone.join(' or its ')}. The 2.4G dongle reads everything.`;
  }

  function renderDevice() {
    const s = session;
    const lines = {
      ready: s.mode === 'demo'
        ? 'Using the demo keyboard. Nothing here touches real hardware.'
        : `Connected through the ${s.iface}. Settings were read and can be edited.${cableGaps(s)}`,
      asleep: 'The keyboard is connected but asleep. Press any key to wake it.',
      searching: 'Looking for a keyboard.',
      connecting: 'Connecting.',
      reading: 'Reading settings.',
      idle: 'No keyboard found. Plug in the dongle or the cable and switch the keyboard to that mode.',
      unsupported: `Found ${s.statusDetail}, which this app does not support.`,
      error: s.statusDetail || 'The keyboard did not respond.',
    };
    $('#devStatus').textContent = lines[s.status] || '';
    $('#devConnect').disabled = prefs.demo || !W.hasHid();
    $('#devDisconnect').disabled = !s.connected;
    $('#swDemo').setAttribute('aria-checked', prefs.demo ? 'true' : 'false');
    $('#modelSel').value = prefs.model;
    const cur = !!s.cur;
    $('#bkExport').disabled = !cur;
    $('#bkImport').disabled = !s.ready;
    $('#bkFirst').disabled = !s.ready || !s.firstBackup();
    renderKeep();
  }

  function setTheme(pref) {
    if (!T || !T.CHOICES.includes(pref)) return;
    prefs.theme = pref;
    savePrefs();
    T.set(pref); // fires the change handler, which repaints the controls
    renderTheme();
  }

  function renderTheme() {
    if (!T) return;
    const seg = $('#segTheme');
    const i = Math.max(0, T.CHOICES.indexOf(T.pref()));
    for (const b of $$('.seg-btn', seg)) b.setAttribute('aria-checked', b.dataset.themePref === T.pref() ? 'true' : 'false');
    seg.style.setProperty('--i', i);
    $('#themeHint').textContent = T.pref() === 'system' ? `Following Windows, which is ${T.resolved()} right now.` : 'Dark, light, or the same as Windows.';
  }

  // Background: either a picture the person picked (kept as a data URL under 'aula.bg') or one of the preset pictures in
  // src/img/backgrounds (only its file name is kept, under 'aula.bgPreset'). Only one is kept at a time and none is the
  // default. #appBg shows whichever is set.
  const BG_KEY = 'aula.bg';
  const BG_PRESET_KEY = 'aula.bgPreset';
  const BG_OPACITY_KEY = 'aula.bgOpacity'; // how strongly the picture shows (0.1 to 1); one setting for both kinds
  let bgPresets = []; // the file names main.js found in the presets folder
  const bgOpacity = () => BG.clampOpacity(store.getItem(BG_OPACITY_KEY));
  // Shows an opacity on the layer, the slider and its label. Does not save it.
  function paintOpacity(op) {
    $('#appBg').style.setProperty('--bg-opacity', String(op));
    const rng = $('#bgOpacity');
    const pct = Math.round(op * 100);
    if (+rng.value !== pct) rng.value = pct;
    rng.style.setProperty('--pf', (pct - +rng.min) / (+rng.max - +rng.min));
    rng.setAttribute('aria-valuetext', `${pct}%`);
    $('#bgOpacityVal').textContent = `${pct}%`;
  }
  function currentBackground() {
    const data = store.getItem(BG_KEY);
    if (BG.isDataImage(data)) return { kind: 'custom', css: BG.cssUrl(data) };
    const name = store.getItem(BG_PRESET_KEY);
    if (BG.isPresetName(name)) return { kind: 'preset', name, css: BG.presetCss(name) };
    return { kind: 'none', css: '' };
  }
  // Frosted window (Windows 11): the switch in Settings > Theme. It only shows through on the default background, so with
  // a picture (preset or the person's own) the window stays solid whatever the switch says. Hidden where it cannot work.
  function renderFrost(picture) {
    const F = window.AulaFrost;
    const can = !!(F && F.supported);
    $('#frostRow').hidden = !can;
    if (!can) return;
    $('#swFrost').setAttribute('aria-checked', prefs.frost ? 'true' : 'false');
    $('#frostHint').textContent = picture
      ? 'Not shown while a background picture is chosen. Remove the picture to see it.'
      : 'Lets the desktop show through the window, blurred. Only with the default background.';
    F.set(prefs.frost && !picture);
  }
  function renderBackground() {
    const cur = currentBackground();
    const on = cur.kind !== 'none';
    const layer = $('#appBg');
    renderFrost(on);
    layer.style.backgroundImage = cur.css;
    layer.hidden = !on;
    const thumb = $('#bgThumb');
    thumb.style.backgroundImage = cur.css;
    thumb.hidden = !on;
    $('#bgClear').disabled = !on;
    $('#bgOpacity').disabled = !on;
    paintOpacity(bgOpacity());
    for (const t of $$('#bgPresets .bg-tile')) {
      const mine = t.dataset.preset ? cur.kind === 'preset' && cur.name === t.dataset.preset : cur.kind === 'none';
      t.setAttribute('aria-checked', mine ? 'true' : 'false');
      t.tabIndex = mine ? 0 : -1;
    }
  }
  function setBackground(kind, value) {
    store.removeItem(BG_KEY);
    store.removeItem(BG_PRESET_KEY);
    if (kind === 'custom') store.setItem(BG_KEY, value);
    else if (kind === 'preset') store.setItem(BG_PRESET_KEY, value);
  }
  // Builds the tiles for the pictures found in the presets folder. With none, the whole section stays hidden.
  function renderBgPresets(names) {
    bgPresets = BG.presetNames(names);
    const box = $('#bgPresets');
    box.replaceChildren();
    $('#bgPresetSet').hidden = !bgPresets.length;
    if (!bgPresets.length) return;
    const tile = (preset, label, pic) =>
      el('button', { class: preset ? 'bg-tile' : 'bg-tile bg-tile-none', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-preset': preset || null, title: label }, pic, el('span', { class: 'bg-tile-name', text: label }));
    box.append(tile('', 'None', el('span', { class: 'bg-tile-pic', 'aria-hidden': 'true' })));
    for (const n of bgPresets) {
      const pic = el('span', { class: 'bg-tile-pic', 'aria-hidden': 'true' });
      pic.style.backgroundImage = BG.presetCss(n);
      box.append(tile(n, BG.presetLabel(n), pic));
    }
    // A remembered preset whose file is no longer in the folder is forgotten.
    const saved = store.getItem(BG_PRESET_KEY);
    if (saved && !bgPresets.includes(saved)) store.removeItem(BG_PRESET_KEY);
    renderBackground();
  }

  function renderKeep() {
    const s = session;
    const snap = s.keepSnapshot();
    $('#swKeep').setAttribute('aria-checked', s.keepEnabled ? 'true' : 'false');
    let info;
    if (prefs.demo) info = 'Not used with the demo keyboard.';
    else if (!s.keepEnabled) info = 'Off. The app leaves the keyboard exactly as it finds it.';
    else if (snap && snap.at) info = `Remembered ${ago(Date.now() - snap.at)}. Settings you apply here, or change on the keyboard while this app is open, are remembered.`;
    else info = 'Nothing remembered yet. The app remembers your keyboard the first time it connects.';
    $('#keepInfo').textContent = info;
    $('#keepNow').disabled = !s.ready || prefs.demo || !snap || applying || s.restoring;
  }

  let ifaceBusy = false;
  /** A plain-text report on what is plugged in and how this app got on with it, for adding support for a model. */
  async function buildCompatReport() {
    const s = session;
    const lines = [
      `Aula Control ${$('#verText') ? $('#verText').textContent : ''}`.trim(),
      `Date: ${new Date().toISOString()}`,
      `System: ${navigator.userAgent}`,
      `Model selected in the app: ${L.modelName(prefs.model)}${prefs.modelSet ? ' (chosen by hand)' : ' (automatic)'}`,
      `Status: ${s.status}${s.statusDetail ? ` (${s.statusDetail})` : ''}`,
      `Connected through: ${s.iface || 'nothing'}${s.productName ? `, USB name "${s.productName}"` : ''}`,
      `Spoken to with: ${s.link === 'feature' ? 'feature report 0x06 (USB-C cable protocol)' : s.link === 'output' ? '20-byte reports 0x13 (dongle protocol)' : s.link || 'nothing'}`,
      `Not read from the keyboard: ${s.unread.length ? s.unread.join(', ') : 'nothing missing'}`,
      '',
      'USB devices visible to the app (ids, usages and report sizes come from the descriptor the keyboard already publishes; nothing was sent to it for this):',
    ];
    try {
      const list = prefs.demo ? [] : await W.listPermitted();
      if (!list.length) lines.push('  none');
      for (const d of list) {
        lines.push(`  ${d.id}  "${d.name}"  ${d.known ? `known as ${d.known}, ${d.supported ? 'supported' : 'NOT supported'}` : `not in the known list${d.why ? `, NOT supported: ${d.why}` : ''}`}  feature report 0x06: ${d.feature === null ? 'unknown' : d.feature ? 'declared' : 'not declared'}`);
        for (const c of d.collections) lines.push(`      usage page ${c.usagePage}, usage ${c.usage}${c.reports ? `  ${c.reports}` : ''}`);
      }
    } catch (err) {
      lines.push(`  could not list devices: ${err.message}`);
    }
    const log = s.exportLog();
    lines.push('', 'Connection log:', log || '  (empty)');
    return lines.join('\n');
  }

  async function refreshIfaces() {
    if (ifaceBusy) return;
    ifaceBusy = true;
    const box = $('#ifaces');
    try {
      box.textContent = '';
      if (prefs.demo) {
        box.append(el('p', { class: 'empty', text: 'Demo mode is on, so real USB devices are ignored.' }));
        return;
      }
      const list = await W.listPermitted();
      if (!list.length) {
        box.append(el('p', { class: 'empty', text: W.hasHid() ? 'No AULA interfaces visible to the app yet.' : 'USB access is not available in this window.' }));
        return;
      }
      for (const d of list) {
        const tag = d.known && d.vendor
          ? d.supported ? el('span', { class: 'tag good', text: 'Supported' }) : el('span', { class: 'tag warn', text: 'Not supported' })
          : el('span', { class: 'tag', text: d.vendor ? 'Vendor interface' : 'Standard input' });
        box.append(
          el('div', { class: 'iface' },
            el('div', { class: 'iface-top' }, el('span', { text: d.name }), tag),
            el('div', { class: 'iface-sub', text: `${d.id}  ${d.collections.map((c) => `${c.usagePage}/${c.usage}`).join('  ')}` }),
          ),
        );
      }
    } catch (err) {
      box.append(el('p', { class: 'empty', text: `Could not list devices: ${err.message}` }));
    } finally {
      ifaceBusy = false;
    }
  }

  // ---------------------------------------------------------------- apply bar

  function describeDirty() {
    const k = session.dirtyKeys();
    const parts = [];
    if (k.includes('led')) parts.push('lighting');
    if (k.includes('rgb')) parts.push('colours');
    if (k.includes('colors')) parts.push('per-key colours');
    return parts.length ? `Unsaved changes to ${parts.join(' and ')}` : 'Unsaved changes';
  }

  // The apply bar doubles as the transfer display. While writing it goes through three phases: 'prep' (the keyboard's
  // current blocks are read first), 'send' (packets going out; the fill is the real progress) and 'check' (reading it back).
  // When the write ends the bar stays for a moment showing the result ('ok', 'warn' or 'bad') before it leaves.
  let txPhase = '';
  let txHold = null; // { kind, msg }
  let txHoldTimer = 0;
  let barLeave = 0;
  const TX_TEXT = { prep: 'Preparing', send: 'Transmitting', check: 'Verifying' };
  const HOLD_TEXT = { ok: 'Sent to keyboard', warn: 'Sent, check the result', bad: 'Could not send' };

  function setProgress(p) {
    const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
    $('#progressFill').style.width = `${pct}%`;
    $('#txPct').textContent = `${pct}%`;
    const phase = p <= 0 ? 'prep' : p >= 1 ? 'check' : 'send';
    txPhase = phase;
    $('#applybar').dataset.tx = phase;
    $('#applyMsg').textContent = TX_TEXT[phase];
    if (MO) MO.label(phase === 'send' ? `Sending ${pct}%` : TX_TEXT[phase]);
  }

  /** Keeps the apply bar (and the link animation on the preview) on screen for a moment with the outcome. */
  function holdTx(kind) {
    clearTimeout(txHoldTimer);
    txHold = { kind, msg: HOLD_TEXT[kind] };
    txHoldTimer = setTimeout(() => {
      txHold = null;
      render();
    }, kind === 'ok' ? 1300 : 1900);
    if (MO) MO.link(kind, kind === 'ok' ? 'Sent' : kind === 'warn' ? 'Check result' : 'Failed');
  }

  function renderApply() {
    const bar = $('#applybar');
    const dirtyNow = session.ready && session.dirty && !session.restoring;
    const show = dirtyNow || applying || !!txHold;
    if (show) {
      clearTimeout(barLeave);
      bar.classList.remove('leaving');
      bar.hidden = false;
    } else if (!bar.hidden && !bar.classList.contains('leaving')) {
      if (!MO || MO.reduced()) {
        bar.hidden = true;
      } else {
        bar.classList.add('leaving');
        barLeave = setTimeout(() => {
          bar.hidden = true;
          bar.classList.remove('leaving');
        }, 220);
      }
    }
    if (!show) return;
    const holding = !applying && !dirtyNow ? txHold : null;
    bar.dataset.tx = applying ? txPhase || 'prep' : holding ? holding.kind : '';
    if (!applying) $('#applyMsg').textContent = holding ? holding.msg : describeDirty();
    const label = applying ? 'Sending…' : holding ? (holding.kind === 'ok' ? 'Sent' : holding.kind === 'warn' ? 'Check' : 'Failed') : 'Apply to keyboard';
    const lbl = $('#btnApply .lbl');
    if (lbl.textContent !== label) lbl.textContent = label;
    $('#btnApply').disabled = applying || !session.ready || !!holding;
    $('#btnRevert').disabled = applying || !!holding;
    $('#progress').hidden = !(applying || holding);
  }

  async function doApply() {
    if (applying || session.restoring || !session.ready || !session.dirty) return;
    applying = true;
    txPhase = '';
    clearTimeout(txHoldTimer);
    txHold = null;
    setProgress(0);
    if (MO) MO.link('tx', 'Preparing');
    renderApply();
    const asked = session.effect();
    try {
      const r = await session.apply(setProgress);
      const live = P.effectOf(r.mode);
      if (r.ok && r.modeOk && r.unverified && r.unverified.length) {
        toast(`${r.written.includes('led') && live ? `${live.name} is now running on the keyboard.` : 'Sent to the keyboard.'} The cable cannot report ${r.unverified.includes('colors') ? 'per-key colours' : 'the palette'} back, so that part could not be checked.`, 'ok', 7000);
      } else if (r.ok && r.modeOk) {
        toast(r.written.includes('led') && live ? `${live.name} is now running on the keyboard.` : 'Saved to the keyboard.', 'ok');
      } else if (!r.modeOk) {
        toast(`The keyboard is running ${live ? live.name : `mode ${r.mode}`} instead of ${asked ? asked.name : 'the effect you chose'}. Close other keyboard software (such as the official AULA driver) and try again.`, 'warn', 10000);
      } else {
        toast('The keyboard answered but did not keep every change. Try the other connection mode and close other keyboard software.', 'warn', 8000);
      }
      holdTx(r.ok && r.modeOk ? 'ok' : 'warn');
    } catch (err) {
      toast(`Could not write to the keyboard: ${err.message} Your changes are still here, so you can try again.`, 'bad', 8000);
      holdTx('bad');
    } finally {
      applying = false;
      render();
    }
  }

  // ------------------------------------------------------------------ actions

  const TAB_ORDER = ['lighting', 'perkey', 'keys', 'battery', 'settings'];

  // Settings has four pages: Keyboard, App, Theme and Debugging (always last). It opens on Keyboard; the page is not saved.
  const SET_PAGES = ['keyboard', 'app', 'theme', 'debug'];
  let setPage = 'keyboard';
  function renderSettingsPage() {
    const seg = $('#segSetPage');
    seg.style.setProperty('--i', SET_PAGES.indexOf(setPage));
    for (const b of $$('.seg-btn', seg)) {
      const on = b.dataset.setPage === setPage;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    for (const pg of $$('.set-page')) pg.hidden = pg.id !== `setpage-${setPage}`;
  }
  function setSettingsPage(p) {
    if (!SET_PAGES.includes(p) || p === setPage) return;
    setPage = p;
    renderSettingsPage();
    if (p === 'debug') refreshIfaces(); // the list of interfaces is current when the page opens
  }
  function setTab(t) {
    if (MXU && MXU.active() && t === 'battery') return; // the Max's battery sits in the header chip; the F75 panel does not apply
    // Panels slide in from the side the new tab sits on.
    const panels = $('.panels');
    if (panels && t !== tab) panels.dataset.dir = TAB_ORDER.indexOf(t) >= TAB_ORDER.indexOf(tab) ? 'fwd' : 'back';
    tab = t;
    drag = null;
    render();
    if (t === 'settings') refreshIfaces();
  }

  async function connectFlow() {
    if (prefs.demo) return setDemo(false);
    try {
      await W.requestAccess();
    } catch (err) {
      if (err && err.name !== 'NotFoundError' && err.name !== 'AbortError') toast(`Could not open the device chooser: ${err.message}`, 'bad');
    }
    await session.connectAuto();
    refreshIfaces();
  }

  async function setDemo(on) {
    prefs.demo = !!on;
    savePrefs();
    session.disconnect();
    demoKb = null;
    sel.clear();
    await session.connectAuto();
    refreshIfaces();
    if (on) toast('Demo keyboard on. Changes stay in the demo.', 'info');
  }

  async function readBatteryNow() {
    const btn = $('#batRefresh');
    if (btn.classList.contains('is-busy')) return;
    const read = async () => {
      let p = null;
      if (session.ready) {
        try {
          p = await session.pollBattery();
        } catch (_) {
          p = null;
        }
      }
      if (p === null && host && !prefs.demo) {
        const r = await host.bluetoothBattery(BT_PATTERN);
        if (r) {
          session.setBattery(r.level, 'bluetooth');
          p = r.level;
        }
      }
      if (p === null) toast('The keyboard did not report a battery level. Over USB-C some keyboards do not; try the 2.4G dongle.', 'warn', 7000);
      return p !== null;
    };
    if (MO) MO.link('rx', 'Reading battery');
    try {
      const got = MO ? await MO.task(btn, read) : await read();
      if (MO) MO.link(got ? 'ok' : 'warn', got ? 'Updated' : undefined);
    } catch (_) {
      if (MO) MO.link('bad');
    } finally {
      render();
    }
  }

  // ------------------------------------------------------- refresh (F5 / Ctrl+R)

  let refreshing = false;
  let refreshArmedAt = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function doRefresh() {
    if (MXU && MXU.active()) return MXU.refresh();
    if (refreshing) return;

    // A refresh throws away edits that were not applied, so ask once before doing it.
    if (session.ready && session.dirty && Date.now() - refreshArmedAt > 4000) {
      refreshArmedAt = Date.now();
      toast('Refreshing replaces your unsaved changes. Press F5 again to continue.', 'warn', 4200);
      return;
    }
    refreshArmedAt = 0;

    refreshing = true;
    if (MO) MO.link('rx', 'Reading');
    const t0 = Date.now();
    let result = { kind: 'ok', msg: '' };
    try {
      if (!session.connected || session.status === 'error') {
        await session.connectAuto();
        if (!session.ready && host && !prefs.demo) {
          const r = await host.bluetoothBattery(BT_PATTERN).catch(() => null);
          if (r) session.setBattery(r.level, 'bluetooth');
        }
        if (session.ready) result.msg = 'Keyboard found. Settings and battery read.';
        else if (session.status === 'asleep') result = { kind: 'warn', msg: 'The keyboard is asleep. Press any key on it to wake it.' };
        else if (session.battery.source === 'bluetooth' && session.battery.at && Date.now() - session.battery.at < 5000) result.msg = `Battery read over Bluetooth: ${session.battery.percent}%.`;
        else result = { kind: 'warn', msg: 'No keyboard answered. Check the cable or dongle and try again.' };
      } else if (session.status === 'asleep') {
        await session.checkOnline();
        if (session.ready) result.msg = 'The keyboard is awake. Settings read.';
        else result = { kind: 'warn', msg: 'The keyboard is still asleep. Press any key on it.' };
      } else {
        await session.refresh();
        const p = session.battery.percent;
        result.msg = p === null ? 'Settings read from the keyboard.' : `Settings read from the keyboard. Battery ${p}%.`;
      }
    } catch (err) {
      result = { kind: 'bad', msg: `Refresh failed: ${err.message}` };
    }
    // Keep the "Reading" animation on the status dot up long enough to be seen, even when the keyboard answers instantly.
    const left = 700 - (Date.now() - t0);
    if (left > 0) await wait(left);
    toast(result.msg, result.kind === 'ok' ? 'ok' : result.kind, result.kind === 'ok' ? 3200 : 6000);
    if (MO) MO.link(result.kind, result.kind === 'ok' ? 'Updated' : undefined);
    refreshing = false;
    refreshIfaces();
    render();
  }

  // Low battery alert fires once per drop, and re-arms after the level recovers.
  let lowArmed = true;
  function checkLowBattery(p) {
    if (!prefs.low) return;
    if (p > prefs.low + 5) lowArmed = true;
    if (p <= prefs.low && lowArmed) {
      lowArmed = false;
      const msg = `${p}% left. Plug in the USB-C cable to charge.`;
      toast(`Keyboard battery is low. ${msg}`, 'warn', 9000);
      if (host) host.notify('Keyboard battery is low', msg);
    }
  }

  // The red breathing light on the keyboard (Session.setLowLight). It comes on at the same level as the low battery alert and
  // goes off when the keyboard is charging or has climbed 5 points above that level, so a reading that hovers at the limit
  // does not make it flicker. It only ever acts while the keyboard is connected over the dongle or the cable.
  let lowLightBusy = false;
  let lowLightRetryAt = 0;
  async function syncLowLight() {
    if (lowLightBusy || !session.ready) return;
    const p = session.battery.percent;
    if (p === null && !session.charging) return; // no reading yet (just connected): the light stays as it is until there is one
    const low = prefs.lowLight && prefs.low > 0 && p !== null && !session.charging;
    const want = !!low && p <= (session.lowLight ? prefs.low + 5 : prefs.low);
    if (want === session.lowLight) return;
    if (Date.now() < lowLightRetryAt) return;
    lowLightBusy = true;
    try {
      const r = await session.setLowLight(want);
      // A write that failed is not tried again for two minutes, so a keyboard that refuses it is not written to every poll.
      if (!r.changed && (r.reason === 'write-failed' || r.reason === 'error')) lowLightRetryAt = Date.now() + 2 * 60 * 1000;
    } catch (_) {
      lowLightRetryAt = Date.now() + 2 * 60 * 1000;
    } finally {
      lowLightBusy = false;
      scheduleRender();
    }
  }

  // Fully charged: the engine says so once per charge, when a reading reaches 100 after a lower one.
  function onFullyCharged(b) {
    if (!prefs.full) return;
    const msg = 'Battery is at 100%. You can unplug the cable.';
    toast(`Keyboard fully charged. ${msg}`, 'ok', 9000);
    if (host) host.notify('Keyboard fully charged', msg);
  }

  // ------------------------------------------------------------------- wiring

  function wire() {
    if (KUI) KUI.wire();
    for (const b of $$('.tab-btn')) b.addEventListener('click', () => setTab(b.dataset.tab));
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const btns = $$('.tab-btn');
      const i = btns.findIndex((b) => b.dataset.tab === tab);
      const next = i < 0 ? btns[e.key === 'ArrowRight' ? 0 : btns.length - 1] : btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      setTab(next.dataset.tab);
      next.focus();
      e.preventDefault();
    });
    $('#batChip').addEventListener('click', () => setTab('battery'));

    // settings pages
    for (const b of $$('#segSetPage .seg-btn')) b.addEventListener('click', () => setSettingsPage(b.dataset.setPage));
    $('#segSetPage').addEventListener('keydown', (e) => {
      const i = SET_PAGES.indexOf(setPage);
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % SET_PAGES.length;
      else if (e.key === 'ArrowLeft') n = (i + SET_PAGES.length - 1) % SET_PAGES.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = SET_PAGES.length - 1;
      if (n < 0) return;
      setSettingsPage(SET_PAGES[n]);
      $(`#setnav-${SET_PAGES[n]}`).focus();
      e.preventDefault();
    });
    renderSettingsPage();

    // lighting
    $('#palInput').addEventListener('input', (e) => {
      const rgb = P.hexToRgb(e.target.value);
      const fx = session.effect();
      if (rgb && fx) session.setPaletteColor(P.getColorIndex(session.cur.led, fx), rgb);
    });
    $('#palHex').addEventListener('input', (e) => {
      const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
      const rgb = P.hexToRgb(v);
      e.target.setAttribute('aria-invalid', rgb ? 'false' : 'true');
      if (!rgb) return;
      const fx = session.effect();
      if (fx) session.setPaletteColor(P.getColorIndex(session.cur.led, fx), rgb);
    });
    $('#palHex').addEventListener('blur', () => scheduleRender());
    $('#sleepSel').addEventListener('change', (e) => session.setSleepValue(+e.target.value));

    // per-key
    for (const b of $$('#segTool .seg-btn')) {
      b.addEventListener('click', () => {
        prefs.tool = b.dataset.tool;
        savePrefs();
        render();
      });
    }
    $('#pkInput').addEventListener('input', (e) => setPkColor(e.target.value));
    $('#pkHex').addEventListener('input', (e) => {
      const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
      const rgb = P.hexToRgb(v);
      e.target.setAttribute('aria-invalid', rgb ? 'false' : 'true');
      if (rgb) $('#pkInput').value = hexOf(rgb);
    });
    $('#pkPaintSel').addEventListener('click', () => session.paintKeys([...sel], pkRGB()));
    $('#pkSelAll').addEventListener('click', () => {
      for (const l of ALL_LEDS) sel.add(l);
      render();
    });
    $('#pkSelNone').addEventListener('click', () => {
      sel.clear();
      render();
    });
    $('#pkAll').addEventListener('click', () => session.paintKeys(ALL_LEDS, pkRGB()));
    $('#pkBlack').addEventListener('click', () => session.paintKeys(ALL_LEDS, [0, 0, 0]));
    $('#pkRainbow').addEventListener('click', () => session.paintKeysWith(ALL_LEDS, (led) => P.hsv(keyX(KEYMAP.get(led)) * 0.85, 1, 1)));
    $('#pkGradient').addEventListener('click', () => {
      const a = pkRGB();
      const b = P.hexToRgb($('#pkInput2').value) || [255, 255, 255];
      session.paintKeysWith(ALL_LEDS, (led) => P.mix(a, b, keyX(KEYMAP.get(led))));
    });

    // battery
    $('#batRefresh').addEventListener('click', readBatteryNow);
    $('#histClear').addEventListener('click', () => {
      session.clearHistory();
      chartSig = '';
      render();
    });
    $('#swFrost').addEventListener('click', () => {
      prefs.frost = !prefs.frost;
      savePrefs();
      renderFrost(currentBackground().kind !== 'none');
    });
    $('#swFull').addEventListener('click', () => {
      prefs.full = !prefs.full;
      savePrefs();
      render();
      if (prefs.full) toast('You will be told when the keyboard is fully charged.', 'info');
    });
    $('#lowSel').addEventListener('change', (e) => {
      prefs.low = +e.target.value;
      lowArmed = true;
      savePrefs();
      syncLowLight();
    });
    $('#swLowLight').addEventListener('click', () => {
      prefs.lowLight = !prefs.lowLight;
      lowLightRetryAt = 0;
      savePrefs();
      render();
      syncLowLight();
    });

    // device
    const withTask = (sel, fn) => (MO ? MO.task($(sel), fn) : fn());
    $('#devConnect').addEventListener('click', () =>
      withTask('#devConnect', async () => {
        await connectFlow();
        return session.ready ? true : null;
      }),
    );
    $('#devRescan').addEventListener('click', () =>
      withTask('#devRescan', async () => {
        await session.connectAuto();
        refreshIfaces();
        return session.ready ? true : null;
      }),
    );
    $('#devDisconnect').addEventListener('click', () => session.disconnect());
    $('#devList').addEventListener('click', refreshIfaces);
    // What the app saw while looking for the keyboard (which interface answered, what each one said), for troubleshooting.
    $('#devLog').addEventListener('click', async () => {
      const text = session.exportLog();
      if (!text) return toast('Nothing has been logged yet.', 'warn');
      const ok = await saveText(`aula-connection-log-${new Date().toISOString().slice(0, 10)}.txt`, text);
      if (ok) toast('Log saved.', 'ok');
    });
    $('#swDemo').addEventListener('click', () => setDemo(!prefs.demo));
    // theme: Settings has the three choices (dark, light, system)
    for (const b of $$('#segTheme .seg-btn')) b.addEventListener('click', () => setTheme(b.dataset.themePref));
    // theme page: custom background
    $('#bgPick').addEventListener('click', () => {
      $('#bgFile').value = '';
      $('#bgFile').click();
    });
    $('#bgFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const data = await BG.fromFile(f);
        try {
          setBackground('custom', data);
        } catch (_) {
          throw new Error('Could not save that picture.');
        }
        renderBackground();
        toast('Background set.', 'ok');
      } catch (err) {
        toast(err && err.message ? err.message : 'Could not use that picture.', 'bad');
      }
    });
    $('#bgClear').addEventListener('click', () => {
      setBackground('none');
      renderBackground();
      toast('Background removed.', 'info');
    });
    // opacity slider: the picture follows the thumb as it moves, and the value is saved when it is let go
    $('#bgOpacity').addEventListener('input', (e) => paintOpacity(BG.clampOpacity(+e.target.value / 100)));
    $('#bgOpacity').addEventListener('change', (e) => {
      try {
        store.setItem(BG_OPACITY_KEY, String(BG.clampOpacity(+e.target.value / 100)));
      } catch (_) {
        /* not saved: it goes back to 50% next time */
      }
    });
    // preset pictures: pick a tile, or "None". The tiles are made when main.js has listed the folder.
    const presetBox = $('#bgPresets');
    presetBox.addEventListener('click', (e) => {
      const t = e.target.closest('.bg-tile');
      if (!t) return;
      const name = t.dataset.preset;
      if (name && !bgPresets.includes(name)) return;
      setBackground(name ? 'preset' : 'none', name);
      renderBackground();
      toast(name ? 'Background set.' : 'Background removed.', name ? 'ok' : 'info');
    });
    presetBox.addEventListener('keydown', (e) => {
      const tiles = $$('.bg-tile', presetBox);
      const i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      tiles[(i + step + tiles.length) % tiles.length].focus();
    });
    if (host && host.listBackgrounds) {
      host
        .listBackgrounds()
        .then((names) => renderBgPresets(names))
        .catch(() => {});
    }
    renderBackground();
    if (T) T.onChange(() => {
      applyGlowInk();
      renderTheme();
    });
    renderTheme();
    const modelSel = $('#modelSel');
    for (const m of L.MODELS) modelSel.append(el('option', { value: m.id, text: m.name }));
    modelSel.value = prefs.model;
    modelSel.addEventListener('change', () => applyModel(modelSel.value, { manual: true }));

    const brightSel = $('#brightMaxSel');
    for (let n = P.LEVEL_MAX; n <= P.BRIGHT_CAP; n++) brightSel.append(el('option', { value: n, text: `${n} levels` }));
    brightSel.value = session.brightMax;
    brightSel.addEventListener('change', () => session.setBrightMax(+brightSel.value));
    session.on('change', () => {
      if (+brightSel.value !== session.brightMax) brightSel.value = session.brightMax;
    });
    // Everything a developer needs to add support for a keyboard this app does not know, and nothing personal.
    $('#devReport').addEventListener('click', async () => {
      const text = await buildCompatReport();
      const ok = await saveText(`aula-compatibility-report-${new Date().toISOString().slice(0, 10)}.txt`, text);
      if (ok) toast('Report saved. It contains no personal data.', 'ok');
    });
    $('#swKeep').addEventListener('click', () => {
      session.setKeep(!session.keepEnabled);
      toast(session.keepEnabled ? 'Your settings will be put back if the keyboard resets.' : 'The app will leave the keyboard as it finds it.', 'info');
      if (session.keepEnabled && session.ready && !prefs.demo && !session.keepSnapshot()) session.rememberNow();
      render();
    });
    $('#keepNow').addEventListener('click', async () => {
      if (applying || session.restoring) return;
      await withTask('#keepNow', async () => {
        try {
          const r = await session.restoreNow();
          if (r.reason === 'same') toast('The keyboard already has your remembered settings.', 'info');
          else if (r.reason === 'none') toast('Nothing is remembered yet.', 'info');
          else if (r.reason === 'edits') toast('You have unsaved changes. Apply or revert them first.', 'warn');
          if (r.reason === 'edits') return false;
          return r.restored ? !!r.ok : null;
        } catch (err) {
          toast(`Could not restore: ${err.message}`, 'bad');
          return false;
        }
      });
      render();
    });

    $('#bkExport').addEventListener('click', async () => {
      const b = session.exportBackup();
      if (!b) return toast('Connect the keyboard first.', 'warn');
      const ok = await saveText(`aula-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b, null, 2));
      if (ok) toast('Backup saved.', 'ok');
    });
    $('#bkImport').addEventListener('click', async () => {
      const text = await pickJson();
      if (!text) return;
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch (_) {
        return toast('That file is not valid JSON.', 'bad');
      }
      const r = session.importBackup(obj);
      if (r.ok) toast('Backup loaded into the preview. Press Apply to write it to the keyboard.', 'ok', 7000);
      else toast(r.error, 'bad');
    });
    $('#bkFirst').addEventListener('click', () => {
      const b = session.firstBackup();
      if (!b) return toast('No original settings were saved yet.', 'warn');
      const r = session.importBackup(b);
      if (r.ok) toast('Original settings loaded into the preview. Press Apply to write them.', 'ok', 7000);
      else toast(r.error, 'bad');
    });

    // apply bar
    $('#btnApply').addEventListener('click', doApply);
    $('#btnRevert').addEventListener('click', () => session.revert());

    // host-only settings
    if (host) {
      $('#cardApp').hidden = false;
      const map = { swTray: 'closeToTray', swLogin: 'openAtLogin', swHidden: 'startMinimized', swUpdate: 'autoUpdate' };
      const paint = (st) => {
        for (const [id, key] of Object.entries(map)) $('#' + id).setAttribute('aria-checked', st && st[key] ? 'true' : 'false');
      };
      host.getSettings().then(paint).catch(() => {});
      for (const [id, key] of Object.entries(map)) {
        const btn = $('#' + id); // keep our own reference: e.currentTarget is null once the handler has awaited
        let busy = false;
        btn.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          const next = btn.getAttribute('aria-checked') !== 'true';
          btn.setAttribute('aria-checked', next ? 'true' : 'false'); // move right away, then confirm with the app
          try {
            const st = await host.setSettings({ [key]: next });
            paint(st); // shows what the app really ended up with
            if (key === 'openAtLogin' && next && !st.openAtLogin) toast('Windows did not accept the startup entry, so it stays off.', 'bad');
            else if (key === 'openAtLogin' && next && st.loginBlocked) toast('Windows has Aula Control switched off under Settings, Apps, Startup. Turn it on there.', 'warn', 8000);
          } catch (_) {
            btn.setAttribute('aria-checked', next ? 'false' : 'true');
            toast('Could not change that setting.', 'bad');
          } finally {
            busy = false;
          }
        });
      }
      host.version().then((v) => {
        $('#verText').textContent = ` ${v}`;
      });

      // Window buttons are drawn by the page (the window has no native title bar).
      if (host.winControl) {
        for (const b of $$('[data-win]')) b.addEventListener('click', () => host.winControl(b.dataset.win));
        const maxBtn = $('#winMax');
        const label = (s) => {
          const t = s && s.maximized ? 'Restore' : 'Maximize';
          maxBtn.title = t;
          maxBtn.setAttribute('aria-label', t);
        };
        host.winState().then(label).catch(() => {});
        host.onWinState(label);
      }
    }

    window.addEventListener('resize', placeTabInd);

    // Live / Picture switch on the keyboard picture
    const stageView = $('#stageView');
    if (stageView) {
      stageView.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.sv-btn');
        if (!b) return;
        const next = b.dataset.view === 'picture' ? 'picture' : 'live';
        if (next === prefs.view) return;
        prefs.view = next;
        savePrefs();
        if (next === 'live' && prefs.animate && !keyboardOff()) view.playIntro(true); // the lights sweep back on
        render();
      });
    }

    // keys: Ctrl+S applies, F5 / Ctrl+R refreshes, any key flashes the Reactive preview
    window.addEventListener(
      'keydown',
      () => {
        // The one thing a sleeping keyboard needs is a key press, and this is the moment it has just had one.
        if (!session.ready && !prefs.demo) session.poke();
      },
      true,
    );
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doApply();
        return;
      }
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')) {
        e.preventDefault();
        if (!e.repeat) doRefresh();
        return;
      }
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const led = L.CODE_TO_LED[e.code];
      if (led !== undefined && prefs.animate && tab === 'lighting' && !pictureOnly()) view.press(led);
    });

    // engine events
    let lastStatus = session.status;
    session.on('status', () => {
      if (session.status === 'ready' && lastStatus !== 'ready') {
        view.playIntro();
        syncLowLight(); // a light left red by a closed app is put back, or kept, as the battery says
      }
      lastStatus = session.status;
      scheduleRender();
    });
    session.on('change', scheduleRender);
    session.on('applied', scheduleRender);
    session.on('battery', (b) => {
      // A battery event without a level (the cable was plugged in or out) only needs the screen redrawn.
      if (b.percent !== null) {
        if (host) host.setTray(`Aula Control: keyboard ${b.percent}%`);
        checkLowBattery(b.percent);
      }
      syncLowLight(); // also for a plug event, which comes without a level
      scheduleRender();
    });
    session.on('lowlight', scheduleRender);
    session.on('full', onFullyCharged);
    session.on('keep', scheduleRender);
    session.on('busy', scheduleRender);
    session.on('restored', (r) => {
      if (MO) MO.link(r && r.ok && r.modeOk !== false ? 'ok' : 'warn', r && r.ok && r.modeOk !== false ? 'Restored' : 'Check result');
      if (r && r.ok && r.modeOk !== false) {
        toast('The keyboard had lost your settings. They have been written back.', 'ok', 5000);
      } else if (r && r.error) {
        toast(`Could not write your remembered settings back: ${r.error}`, 'bad', 8000);
      } else {
        toast('The keyboard did not keep every remembered setting. Check that no other keyboard software is running, then try Restore now in Settings.', 'warn', 9000);
      }
      scheduleRender();
    });
    session.on('lost', () => toast('Lost the keyboard. Searching again.', 'warn'));

    // hot-plug
    let plugTimer = null;
    W.onDevicesChanged(() => {
      clearTimeout(plugTimer);
      plugTimer = setTimeout(onPlug, 400);
    });
  }

  async function onPlug() {
    if (prefs.demo) return;
    await session.deviceListChanged();
    refreshIfaces();
  }

  // --------------------------------------------------------------------- boot

  async function boot() {
    // Start looking for the keyboard first thing; the interface below is built while the USB work is under way.
    const firstConnect = session.connectAuto();
    buildEffects();
    buildSegs();
    kickThumb();
    buildQuickSwatches();
    wire();
    tab = 'lighting';
    render();

    setInterval(() => {
      if (windowShown) renderBatteryAge();
    }, 1000);

    // Background watchdog: while there is no working link, keep looking without flicker (it backs off while nothing
    // turns up). Opening the window later, or bringing it back from the tray, looks again at once.
    session.watch({ intervalMs: 3000, firstMs: 1200 });
    const nudge = () => {
      if (document.visibilityState !== 'hidden' && !prefs.demo) session.nudge();
    };
    window.addEventListener('focus', nudge);
    document.addEventListener('visibilitychange', nudge);

    // Hidden in the tray or minimized: stop drawing. Back on screen: draw again and look for the keyboard at once.
    if (host && host.onShown) {
      let viewWas = false;
      const setShown = (shown) => {
        if (shown === windowShown) return;
        windowShown = shown;
        if (!shown) {
          viewWas = !!view.running;
          view.stop();
          return;
        }
        if (viewWas && prefs.animate) view.start();
        kickThumb();
        scheduleRender();
        if (!prefs.demo) session.nudge();
      };
      host.onShown(setShown);
      if (host.shown) host.shown().then(setShown).catch(() => {});
    }

    // Back from sleep, or the screen unlocked. The dongle has just come back and the keyboard may still be waking, and a
    // USB link can be dead with no plug event. USB takes a moment to come back, so look several times: poke the wait
    // (1.4.2), and check the link twice, once soon and once when everything has surely re-enumerated (1.4.1).
    if (host && host.onPower) {
      let powerTimers = [];
      host.onPower(() => {
        if (prefs.demo) return;
        powerTimers.forEach(clearTimeout);
        const at = (ms, fn) => powerTimers.push(setTimeout(fn, ms));
        for (const ms of [500, 2000, 5000, 12000]) {
          at(ms, () => {
            if (session.ready) return;
            if (ms === 500) session.restartGrace();
            session.nudge();
            session.poke();
          });
        }
        for (const ms of [2000, 7000]) at(ms, () => session.revive().then(refreshIfaces).catch(() => {}));
      });
    }

    // Bluetooth battery through Windows, only when the keyboard link is not giving us one.
    const pollBluetooth = async () => {
      if (!host || prefs.demo) return;
      const b = session.battery;
      const fresh = b.at && Date.now() - b.at < 3 * 60 * 1000 && b.source !== 'bluetooth';
      if (fresh) return;
      const r = await host.bluetoothBattery(BT_PATTERN).catch(() => null);
      if (r) session.setBattery(r.level, 'bluetooth');
    };
    setInterval(pollBluetooth, 2 * 60 * 1000);
    setTimeout(pollBluetooth, 4000);

    await firstConnect;
    refreshIfaces();
    if (MXU) MXU.watch();
  }

  window.aulaApp = { session, view, prefs, setTab, setDemo, toast, keys: KUI, max: MXU };
  boot();
})();
