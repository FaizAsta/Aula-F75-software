// Start screen -> device picker -> main app. A layer on top of the existing UI; the engine is untouched.
// The crosshair follows the pointer, locks onto buttons and cards, and lights up a grid of keycaps.
(() => {
  'use strict';
  const A = window.aulaApp;
  const home = document.getElementById('home');
  if (!A || !home) return;
  const { session, prefs } = A;
  const W = window.AulaWebHID;
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

  function go(name) {
    if (name === screen) return;
    if (home.hidden) {
      home.hidden = false;
      void home.offsetWidth; // so the layer fades in instead of popping
    }
    screen = name;
    home.dataset.screen = name;
    shell.dataset.screen = name;
    lock = null;
    lockBox = null;
    lastTarget = null;
    small = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (name === 'app') {
      entered = true;
      setHeavy(true);
      paintStatic();
      shell.classList.add('entering');
      setTimeout(() => shell.classList.remove('entering'), 900);
      // Once it has faded out, take the start layer out of the page so its animations stop costing anything.
      setTimeout(() => {
        if (screen === 'app') home.hidden = true;
      }, reduce ? 0 : 700);
      // The keyboard may have connected while the start screen was up, so play its intro now.
      setTimeout(() => {
        if (session.ready && A.view && A.view.playIntro) A.view.playIntro();
      }, 250);
      kick();
      return;
    }
    setHeavy(false);
    kick();
    if (name === 'devices') openDevices();
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
      go('devices');
    }, reduce ? 0 : 420);
  }

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

  function items() {
    const s = session;
    const out = [];
    const seen = new Set();
    for (const d of found) {
      if (seen.has(d.id)) continue; // one card per physical device, not per HID interface
      seen.add(d.id);
      const isMax = d.family === 'max';
      const mx = isMax && A.max ? A.max : null;
      const mine = isMax ? !!(mx && mx.active()) : !prefs.demo && s.ifaceId === d.id;
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
        confirm: !!d.confirm,
        real: true,
        st,
        k,
        bat: isMax ? (mine && mx.max.dongle ? mx.max.battery.percent : null) : mine && s.status === 'ready' ? s.battery.percent : null,
        chg: isMax ? false : mine && s.status === 'ready' && s.charging,
      });
    }
    if (!out.length && s.battery.source === 'bluetooth' && s.battery.percent != null) {
      out.push({ kind: 'bt', name: 'Bluetooth keyboard', sub: 'Battery only · reported by Windows', supported: true, real: true, st: 'Battery', k: 'warn', bat: s.battery.percent });
    }
    const live = prefs.demo && s.status === 'ready';
    out.push({ kind: 'kb', name: 'Demo keyboard', sub: 'Simulated · try every control without hardware', supported: true, demo: true, st: live ? 'Connected' : prefs.demo ? 'Starting' : 'Available', k: live ? 'ok' : prefs.demo ? 'busy' : 'idle', bat: live ? s.battery.percent : null });
    return out;
  }

  function card(it, i) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hm-dev';
    b.setAttribute('data-lock', '');
    b.dataset.k = it.k;
    b.style.setProperty('--i', i);
    b.innerHTML = `<span class="hm-dev-ico"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[it.kind] || ICON.kb}</svg></span><span class="hm-dev-txt"><b></b><small></small></span><span class="hm-dev-st"><i></i><em></em></span>`;
    b.querySelector('b').textContent = it.name;
    b.querySelector('small').textContent = it.sub;
    b.querySelector('em').textContent = it.st;
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

  function renderDevices() {
    const its = items();
    const real = its.filter((i) => i.real).length;
    const sub = real ? `${real} device${real === 1 ? '' : 's'} found. Choose one to continue.` : 'No keyboard found yet. Plug in the 2.4G dongle or the USB-C cable, or try the demo keyboard.';
    const next = sub + JSON.stringify(its.map((i) => [i.name, i.st, i.bat, i.chg]));
    if (next === sig) return;
    sig = next;
    $('#hmSub').textContent = sub;
    $('#hmRadar').hidden = real > 0;
    listEl.textContent = '';
    its.forEach((it, i) => listEl.append(card(it, i)));
  }

  let enterTimer = 0;
  function openDevices() {
    sig = '';
    // The cards cascade in once, when the screen opens; later refreshes of the list do not replay it.
    listEl.dataset.enter = '1';
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => delete listEl.dataset.enter, 1100);
    renderDevices();
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
    if (it.family === 'max' && A.max) {
      // Other AULA keyboards share the F75 Max's USB ids, so a device whose name does not say which model it is waits for a yes.
      if (it.confirm && !A.max.max.confirmed.size) {
        const ok = window.confirm('This keyboard shares its USB ids with several AULA models (S98 Pro, L99, F108 Pro and others) and its name does not say which one it is.\n\nUse it as an F75 Max? Choose Cancel if it is another model.');
        if (!ok) return;
      }
      go('app');
      if (prefs.demo) await A.setDemo(false).catch(() => {});
      const opened = await A.max.enter({ confirmed: it.confirm });
      if (!opened) A.toast('Could not reach the F75 Max. Close the official AULA driver and try again.', 'warn', 6000);
      return;
    }
    if (A.max && A.max.active()) A.max.leave(); // choosing an F75 or the demo leaves the Max screen
    go('app');
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
  $('#hmBack').addEventListener('click', () => go(entered ? 'app' : 'home'));
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
      go(entered ? 'app' : 'home');
    }
  });

  const live = () => {
    if (screen === 'devices') renderDevices();
  };
  session.on('status', live);
  session.on('battery', live);
  if (W) W.onDevicesChanged(() => screen === 'devices' && setTimeout(scan, 500));
  setInterval(() => screen === 'devices' && scan(), 3000);

  resize();
  setHeavy(false);
  setTimeout(() => screen !== 'app' && setHeavy(false), 600);
  kick();
})();
