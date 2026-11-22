// Start screen -> device picker -> main app. A layer on top of the existing UI; the engine is untouched.
// The crosshair follows the pointer, locks onto buttons and cards, and lights up a grid of keycaps.
(() => {
  'use strict';
  const A = window.aulaApp;
  const home = document.getElementById('home');
  if (!A || !home) return;
  const { session, prefs } = A;
  const W = window.AulaWebHID;
  const SP = window.AulaStylePick || null; // stylepick.js: which UI is owed, and the arrow-key order of the choices
  const SPUI = window.AulaStylePickUI || null; // stylepick-ui.js: the options under the selected card and the live picture on it
  const $ = (s) => home.querySelector(s);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shell = document.querySelector('.shell');
  const MO = window.AulaMotion || null; // motion.js (optional)
  // LITE = no full-window grid canvas and no crosshair (far lighter). Set to false for the v1.4.3 look.
  const LITE = true;
  if (LITE) shell.classList.add('lite');
  const cv = document.getElementById('hmFx');
  const ctx = cv.getContext('2d');
  const xh = document.getElementById('hmXh');
  const listEl = $('#hmList');
  const stageEl = $('#hmStage');
  const prevBtn = $('#hmPrev');
  const nextBtn = $('#hmNext');
  const dotsEl = $('#hmDots');
  const DP = window.AulaDevPic || null; // devpic.js: the keyboard picture in the big box
  const BP = window.AulaBoardPhoto || null; // boardphoto.js: tells when another rendered picture has arrived
  const GL = window.AulaGlide || null; // glide.js: the keyboard picture flies from the big box into the preview (devices -> app) and back again (app -> devices)

  let screen = 'home';
  let entered = false; // has the person been in the main app yet (decides where Back goes)
  let raf = 0;
  let cssW = 1;
  let cssH = 1;
  let lock = null;
  let lastLock = null;
  let small = false;
  let lastHue = 0;
  let tick = 0;
  // What the crosshair locks onto inside the main app.
  const APP_LOCK = 'button:not(:disabled):not(.win-btn), [role="radio"]:not(:disabled), [role="tab"], [role="button"], select, summary, input:not([type="file"]), .color-pick';
  const mouse = { x: 0, y: 0, in: false };
  const cur = { x: 0, y: 0, w: 56, h: 56 };
  const ripples = [];

  // ------------------------------------------------------------ canvas + crosshair
  // Kept light on purpose. On the start screens the grid animates at 30 fps. Inside the app it is painted once and only
  // the few keys near the pointer are redrawn, and the loop stops as soon as the pointer is still.

  const S = 52; // key pitch
  const G = 6; // gap between keys
  let cols = 1;
  let rows = 1;
  let x0 = 0;
  let y0 = 0;
  let sRect = { left: 0, top: 0 };
  let lockBox = null;
  let lastTarget = null;
  let hueNow = 200;
  let lastT = 0;
  let litPrev = [];

  function cell(c, r, v, hue) {
    const x = x0 + c * S;
    const y = y0 + r * S;
    const h = (hue + x * 0.12 + y * 0.08) % 360;
    ctx.fillStyle = `hsl(${h} 100% 60% / ${(0.03 + v * 0.5).toFixed(3)})`;
    ctx.strokeStyle = `hsl(${h} 100% 70% / ${(0.07 + v * 0.7).toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(x - S / 2 + G / 2, y - S / 2 + G / 2, S - G, S - G, 9);
    ctx.fill();
    ctx.stroke();
  }

  function paintStatic() {
    ctx.clearRect(0, 0, cssW, cssH);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cell(c, r, 0, 200);
    litPrev = [];
  }

  function resize() {
    if (LITE) return;
    const r = shell.getBoundingClientRect();
    sRect = r;
    const dpr = Math.min(1, window.devicePixelRatio || 1); // a soft background does not need more pixels
    cssW = r.width || 1;
    cssH = r.height || 1;
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(cssW / S) + 1;
    rows = Math.ceil(cssH / S) + 1;
    x0 = (cssW - (cols - 1) * S) / 2;
    y0 = (cssH - (rows - 1) * S) / 2;
    if (!mouse.in) {
      mouse.x = cur.x = cssW / 2;
      mouse.y = cur.y = cssH * 0.62;
    }
    paintStatic();
    kick();
  }
  new ResizeObserver(resize).observe(shell);

  const kick = () => {
    if (!LITE && !raf) raf = requestAnimationFrame(frame);
  };
  const fire = () => {
    xh.classList.remove('fire');
    void xh.offsetWidth;
    xh.classList.add('fire');
  };
  const addRipple = (x, y) => {
    ripples.push({ x, y, t: performance.now() });
    if (ripples.length > 6) ripples.shift();
  };

  shell.addEventListener('pointermove', (e) => {
    if (LITE) return;
    const r = shell.getBoundingClientRect();
    sRect = r;
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.in = true;
    if (e.target !== lastTarget) {
      lastTarget = e.target;
      const inApp = screen === 'app';
      let t = e.target.closest ? e.target.closest(inApp ? APP_LOCK : '[data-lock]') : null;
      let box = null;
      if (t) {
        const b = t.getBoundingClientRect();
        if (b.width > 420 || b.height > 160) t = null; // too big to wrap in a ring
        else box = { x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height / 2, w: Math.max(36, b.width + 22), h: Math.max(36, b.height + 22) };
      }
      lock = t;
      lockBox = box;
      small = inApp && !!(e.target.closest && e.target.closest('canvas'));
    }
    kick();
  });
  shell.addEventListener('pointerdown', (e) => {
    if (LITE) return;
    const r = shell.getBoundingClientRect();
    if (screen !== 'app') addRipple(e.clientX - r.left, e.clientY - r.top);
    fire();
    kick();
  });

  // Start screens: the whole grid, with an idle wave, at 30 fps.
  function drawAll(now, hue) {
    ctx.clearRect(0, 0, cssW, cssH);
    while (ripples.length && now - ripples[0].t > 1300) ripples.shift();
    const reach = Math.max(cssW, cssH) * 0.9;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * S;
        const y = y0 + r * S;
        const dx = x - cur.x;
        const dy = y - cur.y;
        let v = Math.exp(-(dx * dx + dy * dy) / 45000);
        if (!reduce) v += 0.1 * (0.5 + 0.5 * Math.sin((x + y) * 0.008 - now * 0.0013));
        for (const rp of ripples) {
          const age = (now - rp.t) / 1200;
          const off = Math.hypot(x - rp.x, y - rp.y) - age * reach;
          v += Math.exp(-(off * off) / 7200) * (1 - age) * 1.1;
        }
        cell(c, r, Math.min(1, v), hue);
      }
    }
  }

  // Inside the app: put back the keys that were lit, light the ~40 nearest the crosshair. Nothing else is touched.
  function drawLocal(hue) {
    for (const i of litPrev) {
      const c = i % cols;
      const r = (i - c) / cols;
      ctx.clearRect(x0 + c * S - S / 2, y0 + r * S - S / 2, S, S);
      cell(c, r, 0, 200);
    }
    litPrev = [];
    const R = 190;
    const c0 = Math.max(0, Math.floor((cur.x - R - x0) / S));
    const c1 = Math.min(cols - 1, Math.ceil((cur.x + R - x0) / S));
    const r0 = Math.max(0, Math.floor((cur.y - R - y0) / S));
    const r1 = Math.min(rows - 1, Math.ceil((cur.y + R - y0) / S));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = x0 + c * S - cur.x;
        const dy = y0 + r * S - cur.y;
        const v = Math.exp(-(dx * dx + dy * dy) / 20000) * 0.8;
        if (v < 0.05) continue;
        ctx.clearRect(x0 + c * S - S / 2, y0 + r * S - S / 2, S, S);
        cell(c, r, v, hue);
        litPrev.push(r * cols + c);
      }
    }
  }

  function frame(now) {
    raf = 0;
    const inApp = screen === 'app';
    if (!inApp && !reduce && now - lastT < 30) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(60, now - (lastT || now - 16));
    lastT = now;
    if (lock && !lock.isConnected) {
      lock = null;
      lockBox = null;
      lastTarget = null;
    }
    const tx = lockBox ? lockBox.x : mouse.x;
    const ty = lockBox ? lockBox.y : mouse.y;
    const tw = lockBox ? lockBox.w : small ? 30 : 56;
    const th = lockBox ? lockBox.h : tw;
    const k = reduce ? 1 : 1 - Math.exp(-dt / 70);
    cur.x += (tx - cur.x) * k;
    cur.y += (ty - cur.y) * k;
    cur.w += (tw - cur.w) * k;
    cur.h += (th - cur.h) * k;
    const moving = Math.abs(tx - cur.x) > 0.4 || Math.abs(ty - cur.y) > 0.4 || Math.abs(tw - cur.w) > 0.4 || Math.abs(th - cur.h) > 0.4;
    if (!moving) {
      cur.x = tx;
      cur.y = ty;
      cur.w = tw;
      cur.h = th;
    }
    hueNow = reduce ? 200 : (now / 16) % 360;
    xh.style.cssText = `--x:${cur.x.toFixed(1)}px;--y:${cur.y.toFixed(1)}px;--w:${cur.w.toFixed(1)}px;--h:${cur.h.toFixed(1)}px;--mx:${mouse.x.toFixed(1)}px;--my:${mouse.y.toFixed(1)}px;--hue:${hueNow.toFixed(0)}`;
    if (lock !== lastLock) {
      lastLock = lock;
      xh.dataset.lock = lock ? '1' : '';
    }
    if (inApp) {
      drawLocal(hueNow);
    } else {
      home.style.setProperty('--hue', hueNow.toFixed(0));
      drawAll(now, hueNow);
    }
    // Inside the app the loop only runs while something is moving; a still pointer costs nothing.
    if ((!inApp && !reduce) || moving || ripples.length) raf = requestAnimationFrame(frame);
  }

  // The app's own preview and thumbnails animate on their own; park them while a start screen covers them.
  let viewWas = false;
  function setHeavy(on) {
    const v = A.view;
    if (on) {
      prefs.animate = !reduce;
      if (viewWas && v && v.start) v.start();
      viewWas = false;
    } else {
      if (v && v.running) {
        viewWas = true;
        v.stop();
      }
      prefs.animate = false;
    }
  }

  // ------------------------------------------------------------------- screens

  /** `opts.from`: the keyboard that was pressed on the devices screen; its picture then glides into the preview (glide.js). */
  function go(name, opts = {}) {
    if (name === screen) return;
    if (home.hidden) {
      home.hidden = false;
      void home.offsetWidth; // so the layer fades in instead of popping
    }
    const left = screen;
    if (GL) GL.end(); // another screen while a glide is still under way: put everything back at once
    // Measured before the screen changes, because the picture is still where it is now.
    const flight = GL && name === 'app' && left === 'devices' && opts.from ? GL.begin(opts.from) : null;
    // The other way round (the Aula logo in the app): the picture flies from the preview back into its box. Only the rules that
    // hold the old fade off are switched on here; the flight itself starts once the box is built (below).
    const back = GL && name === 'devices' && left === 'app' ? GL.beginBack() : null;
    screen = name;
    if (name !== 'devices') demoView = false;
    home.dataset.screen = name;
    shell.dataset.screen = name;
    if (left === 'style' && name !== 'style' && SPUI) SPUI.close(); // the live pictures stop costing anything once the question is gone
    lock = null;
    lockBox = null;
    lastTarget = null;
    small = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (name === 'app') {
      entered = true;
      setHeavy(true);
      paintStatic();
      if (flight) flight.play(); // the picture flies, the header and the page arrive piece by piece (glide.js)
      else {
        shell.classList.add('entering');
        setTimeout(() => shell.classList.remove('entering'), 900);
      }
      // Once it has faded out, take the start layer out of the page so its animations stop costing anything.
      setTimeout(() => {
        if (screen === 'app') home.hidden = true;
      }, reduce ? 0 : 700);
      // The keyboard may have connected while the start screen was up, so play its intro now (after a glide: as the picture melts into the live keyboard).
      setTimeout(() => {
        if (session.ready && A.view && A.view.playIntro) A.view.playIntro();
      }, flight ? flight.landAt : 250);
      kick();
      return;
    }
    setHeavy(false);
    kick();
    if (name === 'style') openStyle();
    if (name === 'devices') {
      openDevices();
      if (back) {
        paintPics(false); // the picture of the box has to be drawn before it can be copied and flown
        back.play(slides[shown]); // measures both ends and starts every movement; the old fade when it cannot (glide.js)
      }
    }
  }

  let starting = false;
  function start() {
    if (screen !== 'home' || starting) return;
    starting = true;
    const b = $('#hmStart').getBoundingClientRect();
    const r = home.getBoundingClientRect();
    addRipple(b.left - r.left + b.width / 2, b.top - r.top + b.height / 2);
    fire();
    setTimeout(() => {
      starting = false;
      // Everybody who has not chosen a UI yet (a first install, or an update from a build without the question) is asked once,
      // between Start and the device list. After that Start goes straight to the devices.
      go(A.styleOwed && A.styleOwed() ? 'style' : 'devices');
    }, reduce ? 0 : 420);
  }

  // ------------------------------------------------------------------- UI choice (once, after Start)

  const spCards = Array.from(home.querySelectorAll('#spCards .sp-card'));
  let spPick = 'classic'; // the card that is selected; nothing is applied or saved until Continue
  let spDone = false;

  // Selects a card (a radio group with one tab stop, like the other segmented choices in the app).
  function markStyle(style, focus) {
    spPick = style;
    if (SPUI && screen === 'style') SPUI.select(style);
    for (const c of spCards) {
      const on = c.dataset.styleChoice === style;
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
      if (on && focus) c.focus({ preventScroll: true });
    }
  }
  function openStyle() {
    spDone = false;
    markStyle(A.styleStart ? A.styleStart() : 'classic', false);
    if (SPUI) SPUI.open(spPick);
    const on = spCards.find((c) => c.dataset.styleChoice === spPick);
    if (on) on.focus({ preventScroll: true }); // for the keyboard: arrows pick, Enter continues (a mouse click shows no focus ring)
  }
  // Applies the choice, remembers that the question was answered, and carries on to the devices.
  function confirmStyle() {
    if (screen !== 'style' || spDone) return;
    spDone = true;
    try {
      A.chooseStyle(spPick, SPUI ? SPUI.draft() : null); // the style and the options shown under it
    } catch (_) {
      /* the style could not be applied; the devices still open and Settings, Theme, UI still has the choice */
    }
    go('devices');
  }
  for (const c of spCards) {
    c.addEventListener('click', () => markStyle(c.dataset.styleChoice, false));
    c.addEventListener('dblclick', () => {
      markStyle(c.dataset.styleChoice, false);
      confirmStyle();
    });
  }
  $('#spGo').addEventListener('click', confirmStyle);

  // ------------------------------------------------------------------- devices

  const ICON = {
    dongle: '<rect x="8" y="3" width="8" height="10" rx="1.6"/><path d="M10.5 6.5V8M13.5 6.5V8M12 13v8"/>',
    wired: '<rect x="3" y="9" width="11" height="6" rx="3"/><path d="M14 12h7"/>',
    bt: '<path d="M7 8l10 8-5 4V4l5 4-10 8"/>',
    kb: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  };
  let found = [];
  let scanning = false;
  let sig = '';
  // The demo keyboards sit behind the small Demo keyboards button beside Search again; once it is pressed the list shows only them (Back returns to the devices).
  let demoView = false;

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      found = W && W.hasHid() ? await W.listPermitted() : [];
    } catch (_) {
      found = [];
    }
    scanning = false;
    renderDevices();
  }

  /** The picture of the F75 family boards: the model chosen in Settings (F75, F75 Pro or F87). */
  const modelPic = () => (DP && DP.knows(window.AulaLayout && window.AulaLayout.id) ? window.AulaLayout.id : 'f75');

  /** The simulated keyboards, in the order they are listed once the Demo keyboards button is pressed. */
  function demoItems() {
    const s = session;
    const out = [];
    const live = prefs.demo && s.status === 'ready';
    out.push({ kind: 'kb', name: 'Demo keyboard', sub: 'Simulated · try every control without hardware', supported: true, demo: true, pic: modelPic(), st: live ? 'Connected' : prefs.demo ? 'Starting' : 'Available', k: live ? 'ok' : prefs.demo ? 'busy' : 'idle', bat: live ? s.battery.percent : null });
    if (A.max) {
      for (const [fam, name] of [['max', 'F75 Max'], ['he', 'F75 HE']]) {
        if (!A.max.session(fam)) continue;
        const onDemo = !!(A.max.active() && A.max.family() === fam && A.max.max.demo);
        out.push({ kind: 'kb', name: `Demo ${name}`, sub: `Simulated · all ${name} pages`, supported: true, demo: true, demoFamily: fam, demoName: name, pic: fam, st: onDemo ? 'Connected' : 'Available', k: onDemo ? 'ok' : 'idle', bat: onDemo ? A.max.max.battery.percent : null });
      }
    }
    return out;
  }

  function items() {
    if (demoView) return demoItems();
    const s = session;
    const out = [];
    const seen = new Set();
    for (const d of found) {
      if (seen.has(d.id)) continue; // one card per physical device, not per HID interface
      seen.add(d.id);
      const isMax = d.family === 'max' || d.family === 'he'; // the boards driven by max-ui.js (F75 Max, F75 HE)
      const mx = isMax && A.max ? A.max : null;
      const mine = isMax ? !!(mx && mx.active() && mx.family() === d.family && !mx.max.demo) : !prefs.demo && s.ifaceId === d.id;
      // the battery of those boards: read through the dongle; the F75 HE's receiver has nothing behind it while the cable is in
      const mxBat = isMax && mine && mx.max.dongle && !(d.family === 'he' && mx.max.cable) ? mx.max.battery.percent : null;
      let st = 'Detected';
      let k = 'idle';
      if (!d.supported) [st, k] = ['Not supported', 'warn'];
      else if (isMax) [st, k] = mine ? ['Connected', 'ok'] : d.confirm ? ['Confirm model', 'warn'] : ['Available', 'idle'];
      else if (mine) [st, k] = { ready: ['Connected', 'ok'], asleep: ['Asleep', 'warn'], error: ['No answer', 'bad'] }[s.status] || ['Connecting', 'busy'];
      out.push({
        kind: d.mode === 'dongle' || d.mode === 'wired' ? d.mode : 'kb',
        name: d.name || d.label,
        sub: d.label && d.label !== d.name ? `${d.label} · ${d.id}` : d.id,
        supported: d.supported,
        family: d.family,
        pic: isMax ? d.family : modelPic(), // the F75 Max and F75 HE have their own picture; the other boards are the model chosen in Settings
        confirm: !!d.confirm,
        real: true,
        st,
        k,
        bat: isMax ? mxBat : mine && s.status === 'ready' ? s.battery.percent : null,
        chg: isMax ? d.family === 'he' && mxBat !== null && !!mx.max.battery.charging : mine && s.status === 'ready' && s.charging,
      });
    }
    if (!out.length && s.battery.source === 'bluetooth' && s.battery.percent != null) {
      out.push({ kind: 'bt', name: 'Bluetooth keyboard', sub: 'Battery only · reported by Windows', supported: true, real: true, pic: modelPic(), st: 'Battery', k: 'warn', bat: s.battery.percent });
    }
    return out;
  }

  /** One keyboard of the big box: its picture, then its name, how it is connected and its state. */
  function card(it, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hm-dev';
    b.setAttribute('data-lock', '');
    b.dataset.k = it.k;
    b.dataset.pic = it.pic || 'f75';
    b.style.setProperty('--i', i);
    b.innerHTML = `<span class="hm-dev-pic" aria-hidden="true"><canvas class="hm-pic"></canvas><svg class="ico hm-pic-ph" viewBox="0 0 24 24">${ICON.kb}</svg></span><span class="hm-dev-foot"><span class="hm-dev-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[it.kind] || ICON.kb}</svg></span><span class="hm-dev-txt"><b></b><small></small></span><span class="hm-dev-st"><i></i><em></em></span></span>`;
    b.querySelector('b').textContent = it.name;
    b.querySelector('small').textContent = it.sub;
    b.querySelector('em').textContent = it.st;
    if (!it.supported) b.dataset.off = '1'; // a board this app cannot drive yet: its picture is dimmed
    if (it.bat != null || it.chg) {
      const bat = document.createElement('span');
      bat.className = it.chg ? 'bat chg' : 'bat';
      if (it.chg) bat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
      bat.append(document.createTextNode(it.bat != null ? `${it.bat}%` : 'Charging'));
      b.querySelector('.hm-dev-st').append(bat);
    }
    b.addEventListener('click', () => pick(it, b));
    return b;
  }

  // ---- the big box: a carousel of the keyboards (one shown at a time; the arrows and dots only exist for two or more)
  let slides = []; // the .hm-dev of each keyboard, in list order
  let slideItems = []; // the item behind each slide
  let shown = 0; // the keyboard that is showing
  let curKey = ''; // which keyboard that is (a list that refreshes keeps showing the same one)
  const keyOf = (it) => `${it.name}|${it.sub}`;

  /** Draws the keyboard pictures that are not drawn yet (or were drawn at another size). Cheap when nothing changed. */
  let paintQueued = 0;
  function paintPics(force) {
    paintQueued = 0;
    if (!DP) return;
    for (const sl of slides) {
      const cv = sl.querySelector('canvas');
      if (!cv) continue;
      const ok = DP.draw(cv, sl.dataset.pic, { force });
      cv.parentElement.dataset.ready = ok ? '1' : '';
    }
  }
  const queuePaint = (force) => {
    if (!DP || paintQueued) return;
    paintQueued = requestAnimationFrame(() => paintPics(force));
  };
  if (BP && BP.subscribe) BP.subscribe(() => queuePaint(false)); // another rendered picture arrived
  if (window.ResizeObserver) new ResizeObserver(() => queuePaint(false)).observe(listEl); // the window, or the box, changed size
  if (document.fonts && document.fonts.load) {
    // the legend font arrives a moment after the first drawing: print the legends again with it
    document.fonts.load('600 20px "Aula Legend"', 'Qq1!@Ag').then(() => queuePaint(true)).catch(() => {});
  }

  /** Shows keyboard `i` (wrapping round at both ends). `dir` is 1 for next, -1 for previous, 0 for no sliding. */
  function showSlide(i, dir = 0) {
    const n = slides.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    const from = shown;
    if (dir && i !== from && slides[i]) {
      // the incoming keyboard starts on the side it comes from, with no transition, so it slides in instead of fading in place
      const inc = slides[i];
      inc.classList.add('no-tr');
      inc.dataset.pos = dir > 0 ? 'after' : 'before';
      void inc.offsetWidth;
      inc.classList.remove('no-tr');
    }
    shown = i;
    curKey = keyOf(slideItems[i]);
    slides.forEach((sl, k) => {
      const pos = k === i ? 'cur' : dir && k === from ? (dir > 0 ? 'before' : 'after') : k < i ? 'before' : 'after';
      sl.dataset.pos = pos;
      sl.inert = pos !== 'cur'; // the keyboards that are not showing cannot be tabbed to or clicked
      sl.setAttribute('aria-hidden', pos === 'cur' ? 'false' : 'true');
    });
    dotsEl.querySelectorAll('i').forEach((d, k) => {
      d.dataset.on = k === i ? '1' : '';
    });
    const label = `Keyboard ${i + 1} of ${n}`;
    listEl.setAttribute('aria-label', n > 1 ? label : 'Keyboards');
  }
  const stepSlide = (dir) => {
    if (slides.length > 1) showSlide(shown + dir, dir);
  };

  function renderDevices() {
    const its = items();
    const real = its.filter((i) => i.real).length;
    const sub = demoView
      ? `Simulated keyboards, no hardware needed. Changes stay in the demo. ${its.length > 1 ? 'Use the arrows, then click one.' : 'Click it to continue.'}`
      : real > 1 ? `${real} devices found. Use the arrows to switch, then click one.` : real ? '1 device found. Click the keyboard to continue.' : 'No keyboard found yet. Plug in the 2.4G dongle or the USB-C cable, or press Demo keyboards to try the app.';
    const next = (demoView ? 'demos|' : '') + sub + JSON.stringify(its.map((i) => [i.name, i.st, i.bat, i.chg, i.pic]));
    if (next === sig) return;
    sig = next;
    $('#hmTitle').textContent = demoView ? 'Demo keyboards' : 'Connected devices';
    $('#hmSub').textContent = sub;
    $('#hmRadar').hidden = real > 0 || demoView;
    $('#hmRescan').parentElement.hidden = demoView; // searching again is for real devices
    listEl.textContent = '';
    dotsEl.textContent = '';
    slideItems = its;
    slides = its.map((it, i) => listEl.appendChild(card(it, i)));
    for (let i = 0; i < slides.length; i++) dotsEl.append(document.createElement('i'));
    // The arrows and the dots are only there when there is more than one keyboard to go between.
    const many = slides.length > 1;
    prevBtn.hidden = nextBtn.hidden = dotsEl.hidden = !many;
    stageEl.hidden = !slides.length;
    // The same keyboard stays on show when the list refreshes; a list that has just opened starts on the one that is connected.
    let at = curKey ? its.findIndex((it) => keyOf(it) === curKey) : -1;
    if (at < 0) at = Math.max(0, its.findIndex((it) => it.k === 'ok'));
    showSlide(at, 0);
    queuePaint(false);
  }

  let enterTimer = 0;
  /** The cards cascade in when the screen opens or the list changes to the demo keyboards; later refreshes do not replay it. */
  function cascade() {
    sig = '';
    curKey = ''; // a list that has just opened starts on the connected keyboard (see renderDevices)
    listEl.dataset.enter = '1';
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => delete listEl.dataset.enter, 1100);
    renderDevices();
  }

  /** Opens the list of demo keyboards (the Demo keyboards button), or returns to the devices. */
  function showDemos(on) {
    if (demoView === on) return;
    demoView = on;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    listEl.scrollTop = 0;
    cascade();
  }

  function openDevices() {
    demoView = false;
    cascade();
    scan();
    if (!prefs.demo && !session.connected && session.nudge) session.nudge();
  }

  async function pick(it, node) {
    if (it.real && !it.supported) {
      A.toast('This model is not supported yet. Settings, Connection help can save a compatibility report.', 'warn', 6000);
      node.classList.remove('shake');
      void node.offsetWidth;
      node.classList.add('shake');
      return;
    }
    if (it.demoFamily && A.max) {
      go('app', { from: node });
      if (A.max.active() && A.max.family() === it.demoFamily && A.max.max.demo) return; // already on it
      if (prefs.demo) await A.setDemo(false).catch(() => {});
      const opened = await A.max.enterDemo(it.demoFamily);
      if (!opened) A.toast(`Could not start the demo ${it.demoName}.`, 'warn', 6000);
      else A.toast(`Demo ${it.demoName} on. Changes stay in the demo.`, 'info');
      return;
    }
    if ((it.family === 'max' || it.family === 'he') && A.max) {
      const fam = it.family;
      const name = fam === 'he' ? 'F75 HE' : 'F75 Max';
      // Other AULA keyboards share these USB ids, so a device whose name does not say which model it is waits for a yes.
      const sess = A.max.session(fam);
      if (it.confirm && sess && !sess.confirmed.size) {
        const ask = fam === 'he'
          ? 'The 2.4G receiver is shared by several AULA Hall-effect keyboards (MINI 60 HE PRO, MINI 68 HE and others) and its name does not say which one it is.\n\nUse it as an F75 HE? The keyboard is asked who it is before anything is written, and the app stops if it names another model. Choose Cancel if it is another model.'
          : 'This keyboard shares its USB ids with several AULA models (S98 Pro, L99, F108 Pro and others) and its name does not say which one it is.\n\nUse it as an F75 Max? Choose Cancel if it is another model.';
        if (!window.confirm(ask)) return;
      }
      go('app', { from: node });
      if (A.max.active() && A.max.max.demo) A.max.leave(); // the demo keyboard is let go, so the real one is the one that opens
      if (prefs.demo) await A.setDemo(false).catch(() => {});
      const opened = await A.max.enter({ family: fam, confirmed: it.confirm });
      if (!opened) A.toast(`Could not reach the ${name}. Close the official AULA driver and try again.`, 'warn', 6000);
      return;
    }
    if (A.max && A.max.active()) A.max.leave(); // choosing an F75 or the demo leaves the Max screen
    go('app', { from: node });
    try {
      if (it.demo) {
        if (!prefs.demo) await A.setDemo(true);
      } else if (prefs.demo) {
        await A.setDemo(false);
      } else if (!session.connected) {
        session.connectAuto().catch(() => {});
      }
    } catch (_) {
      /* the main screen shows the connection state */
    }
  }

  // -------------------------------------------------------------------- wiring

  $('#hmStart').addEventListener('click', start);
  // Back and Escape go one step up: from the demo keyboards to the devices, from the devices to where the person came from.
  const backFromDevices = () => (demoView ? showDemos(false) : go(entered ? 'app' : 'home'));
  $('#hmBack').addEventListener('click', backFromDevices);
  $('#hmDemos').addEventListener('click', () => showDemos(true));
  prevBtn.addEventListener('click', () => stepSlide(-1));
  nextBtn.addEventListener('click', () => stepSlide(1));
  $('#hmRescan').addEventListener('click', () => {
    if (session.poke) session.poke();
    const run = async () => {
      await session.connectAuto().catch(() => {});
      await scan();
      return found.some((d) => d.supported) ? true : null; // nothing found ends quietly, it is not an error
    };
    if (MO) MO.task($('#hmRescan'), run);
    else run();
  });
  const brand = document.getElementById('brand');
  if (brand) {
    brand.addEventListener('click', () => go('devices'));
    brand.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go('devices');
      }
    });
  }
  window.addEventListener('keydown', (e) => {
    if (screen === 'home' && (e.key === 'Enter' || e.key === ' ') && !(e.target.closest && e.target.closest('button'))) {
      e.preventDefault();
      start();
    } else if (screen === 'devices' && e.key === 'Escape') {
      backFromDevices();
    } else if (screen === 'devices' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && slides.length > 1 && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.target.closest && e.target.closest('input, select, textarea'))) {
      e.preventDefault();
      stepSlide(e.key === 'ArrowLeft' ? -1 : 1); // the same as the arrow buttons
    } else if (screen === 'style' && !document.querySelector('.upd:not([hidden])')) {
      // Left / Up and Right / Down move the choice, Enter continues, Escape goes back to Start. Enter only counts from the
      // question itself (or from nowhere in particular), never from the Back, Support or Update buttons.
      const t = e.target;
      // The sliders and switches under the selected card keep their own arrow keys and Enter.
      const here = t === document.body || t === document.documentElement || (!!(t.closest && t.closest('.scr-style')) && !t.closest('.sp-opts'));
      if (e.key === 'Escape') {
        go('home');
      } else if (here && SP && /^Arrow(Left|Up|Right|Down)$/.test(e.key)) {
        e.preventDefault();
        markStyle(SP.step(spPick, /Left|Up/.test(e.key) ? -1 : 1), true);
      } else if (here && e.key === 'Enter') {
        e.preventDefault();
        confirmStyle();
      }
    }
  });

  const live = () => {
    if (screen === 'devices') renderDevices();
  };
  session.on('status', live);
  session.on('battery', live);
  if (W) W.onDevicesChanged(() => screen === 'devices' && setTimeout(scan, 500));
  setInterval(() => screen === 'devices' && scan(), 3000);

  // What the tests and the screenshot scripts use to bring one keyboard of the big box to the front (the others are not clickable).
  window.AulaDevices = {
    count: () => slides.length,
    index: () => shown,
    names: () => slideItems.map((it) => it.name),
    /** Shows the keyboard whose name or description matches (a string is a part of the text, a RegExp is tested). */
    show(match) {
      const at = slideItems.findIndex((it) => (match instanceof RegExp ? match.test(`${it.name} ${it.sub}`) : `${it.name} ${it.sub}`.toLowerCase().includes(String(match).toLowerCase())));
      if (at < 0) return false;
      showSlide(at, 0);
      return true;
    },
    next: () => stepSlide(1),
    prev: () => stepSlide(-1),
  };

  resize();
  setHeavy(false);
  setTimeout(() => screen !== 'app' && setHeavy(false), 600);
  kick();
  // The live picture on a card of the UI question (boot.js, stylepick-ui.js) is this page with no start screens: straight to the app.
  if (window.AULA_PREVIEW) go('app');
})();
