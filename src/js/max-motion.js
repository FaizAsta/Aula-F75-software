/*
 * Pointer and key motion for the F75 HE / F75 Max picture (max-ui.js). It is the F75 preview's "alive" behaviour (preview.js,
 * the canvas keyboard) done on the picture's own keys, so the two screens feel the same:
 *
 *   - the board leans a little toward the pointer, and drifts gently up and down when nobody is touching it
 *   - a soft spotlight follows the pointer, in the colour of the board's light (a cool white when the board is dark)
 *   - the keys near the pointer rise toward you, and glow a little
 *   - a click sends a ripple ring across the board, lifting the keys it passes
 *   - a key you press on your own keyboard sinks and springs back (and lights, with the Reactive effects)
 *   - the lights sweep on from left to right when the keyboard is first shown, and again when the effect changes
 *
 * The numbers (how far it leans, how far a key rises, how long a ripple lives, the intro's timing) are the F75 preview's own,
 * copied here. test/max-motion.test.js checks the shared ones still match preview.js, so the two cannot drift apart.
 *
 * Nothing here touches the keyboard or the lighting state: it moves the picture's elements (a transform on the board, a
 * transform on each key, one canvas over the keys) and asks max-ui.js for three things: whether it may move (animation on, Live
 * not Picture), whether the pointer effects are on (not while painting keys: the Per-key page stays square so a click lands where
 * it appears to), and the board's colour.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AulaMaxMotion = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const TILT_DEG = { x: 3.2, y: 4.5 }; // how far the whole board leans toward the pointer (preview.js: TILT_DEG)
  const TILT_VIEW = 1000; // px, perspective(...) the lean is seen through (preview.js: TILT_VIEW)
  const BOB_PX = 1.6; // how far the idle drift lifts and lowers the board (preview.js: BOB_PX)
  const RIPPLE_LIFE = 1.5; // seconds a click ripple lasts (preview.js: RIPPLE_LIFE)
  const PRESS_LIFE = 1.8; // seconds a key press is remembered: the cap springs back well before, the Reactive glow fades by then

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (v) => v * v * (3 - 2 * v);
  /** How strongly the pointer affects something `dist` away: 1 right under it, easing to 0 at `radius`. */
  const influence = (dist, radius) => (radius > 0 ? smooth(clamp01(1 - dist / radius)) : 0);

  /** The idle drift: the board's height offset in px at time `ms`; it settles when the pointer is over the board (`a` is 0..1). */
  const bobOf = (ms, a = 0) => Math.sin((ms / 1000) * 0.9) * BOB_PX * (1 - 0.7 * a);

  /** The lean toward a pointer at (nx, ny) (each -1..1 across the board), `a` (0..1) being how much the pointer is "there". */
  const leanOf = (nx, ny, a) => ({ rx: -ny * TILT_DEG.x * a, ry: nx * TILT_DEG.y * a });

  /** How lit a key `nx` (0..1) across the board is, `elapsed` seconds into the sweep. `fast` is the quick one an effect change plays. */
  function introFactor(elapsed, nx, fast = false) {
    const rate = fast ? 2.6 : 1.3;
    if (elapsed > (fast ? 1.2 : 2.4)) return 1;
    const f = smooth(clamp01((elapsed * rate - nx * 0.85) * 2.4));
    return fast ? 0.35 + 0.65 * f : f; // a quick sweep keeps a floor, so an effect change never blanks the board
  }

  /** How far a key is pressed down (1 at the press, 0 once it has sprung back) `age` seconds after the press. */
  const pressDepth = (age) => Math.exp(-age / 0.16);
  /** How much light a pressed key gives (for the Reactive effects), `age` seconds after the press. */
  const pressGlow = (age) => Math.exp(-age / 0.55);

  /**
   * How much the pointer and any click ripple are lifting a key centred at (kx, ky), 0..1.4. `hm` is the smoothed pointer
   * { x, y, a }, `u` the size of a key unit in px, `ripples` the live ripples { x, y, at } and `nowMs` the time they are judged at.
   */
  function touchOf(kx, ky, hm, u, ripples, nowMs) {
    let f = 0;
    if (hm && hm.a > 0.003) f = hm.a * influence(Math.hypot(kx - hm.x, ky - hm.y), u * 2.6);
    for (const r of ripples) {
      const age = (nowMs - r.at) / 1000;
      const diff = Math.hypot(kx - r.x, ky - r.y) - age * u * 11;
      const band = u * 1.8;
      f += Math.exp(-(diff * diff) / (band * band)) * Math.exp(-age / 0.8) * 1.25;
    }
    return Math.min(1.4, f);
  }

  // KeyboardEvent.code -> the layout's key name (layout names are the ones he.js / max.js give their keys)
  const CODE_NAMES = {
    Escape: 'esc', Backquote: 'grave', Minus: 'minus', Equal: 'equal', Backspace: 'backspace', Tab: 'tab', BracketLeft: 'bracketleft',
    BracketRight: 'bracketright', Backslash: 'backslash', CapsLock: 'capslock', Semicolon: 'semicolon', Quote: 'quote', Enter: 'enter',
    ShiftLeft: 'shiftleft', ShiftRight: 'shiftright', Comma: 'comma', Period: 'period', Slash: 'slash', ControlLeft: 'ctrlleft',
    ControlRight: 'ctrlright', MetaLeft: 'winleft', AltLeft: 'altleft', AltRight: 'altright', Space: 'space', ArrowLeft: 'left',
    ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right', Delete: 'delete', PageUp: 'pageup', PageDown: 'pagedown', End: 'end',
  };
  function codeToName(code) {
    if (CODE_NAMES[code]) return CODE_NAMES[code];
    let m = /^Key([A-Z])$/.exec(code || '');
    if (m) return m[1].toLowerCase();
    m = /^Digit([0-9])$/.exec(code || '');
    if (m) return m[1];
    return /^F([1-9]|1[0-2])$/.test(code || '') ? code.toLowerCase() : null;
  }

  const rgbOf = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /**
   * Gives a board its pointer and key motion.
   *   host      the stage: it never moves, so the board's lean cannot feed back into the pointer position
   *   board     the element that leans and drifts (.mx-board)
   *   grid      the keys' box (.mx-grid); one key unit is its width / gridW
   *   keys      Map led -> key element; layout [{ led, name, x, y, w }] in key units; gridW the board's width in key units
   *   enabled() may anything move now (animation on, Live and not Picture, the screen showing)
   *   pointerFx() are the pointer effects on (off while painting keys, so the board stays square under the brush)
   *   tint()    the board's average light [r, g, b] (any strength; a dark board gives a cool white)
   *   repaint() redraw the keys' light (called while the lights-on sweep runs, which scales it)
   * Returns { press(led), intro(fast), glow(led), lightFactor(led), sync(), destroy() }.
   */
  function create(o) {
    const { host, board, grid, keys, layout, gridW } = o;
    const doc = host.ownerDocument || document;
    const win = doc.defaultView || window;
    const cv = doc.createElement('canvas');
    cv.className = 'mx-fx';
    cv.setAttribute('aria-hidden', 'true');
    grid.append(cv);
    let g2 = null;
    try {
      g2 = cv.getContext ? cv.getContext('2d') : null;
    } catch (_) {
      g2 = null; // no canvas (a test window): the keys and the board still move, only the spotlight and rings are left out
    }

    const nameToLed = new Map(layout.map((k) => [k.name, k.led]));
    const hm = { x: 0, y: 0, a: 0, tx: 0, ty: 0, ta: 0 }; // the smoothed pointer (grid px) and where it is heading; a is how much it is "there"
    let ripples = [];
    const pressedAt = new Map(); // led -> ms of the press
    let introAt = -1;
    let introFast = false;
    let ia = new Map(); // led -> how lit it is now (the lights-on sweep)
    let raf = 0;
    let lastDraw = 0;
    let lastFrame = 0;
    let tintAt = -1e9;
    let tintRGB = [150, 200, 255];
    let size = { u: 0, w: 0, h: 0, m: 0, ml: 0, mt: 0, mr: 0, mb: 0, dpr: 1, gl: 0, gt: 0, bw: 0, bh: 0 };
    let boardTf = '';
    let canvasDirty = false;
    let on = false;

    // ------------------------------------------------------------------ size
    /*
     * The canvas holds the pointer's spotlight (about four keys wide), so it must reach as far as the light does: the whole picture area,
     * as the F75's canvas does (preview.js, tiltBleed), with the panel (.stage, overflow hidden) as the edge you see. A canvas that
     * stopped just past the keys cut the glow off in a hard rectangle beside the board. It also reaches a little past the area on every
     * side, because the board leans and a leaning canvas pulls its far edge inwards (the same reason the F75's has its bleed).
     * Where the area has no size (a test window) it falls back to reaching 0.6 of a key past the keys.
     */
    function measure() {
      const w = grid.clientWidth;
      const h = grid.clientHeight;
      const u = w / gridW;
      const m = Math.round(u * 0.6); // the light reaches at least this far past the keys, over the plate's rim
      const dpr = win.devicePixelRatio || 1;
      const hw = host.clientWidth;
      const hh = host.clientHeight;
      const gx = board.offsetLeft + grid.offsetLeft; // the keys' top left corner in the picture area
      const gy = board.offsetTop + grid.offsetTop;
      let ml = m;
      let mt = m;
      let mr = m;
      let mb = m;
      if (w && h && hw && hh) {
        const bleed = Math.ceil(Math.max(hw, hh) * 0.04) + 4;
        ml = Math.max(m, Math.ceil(gx) + bleed);
        mt = Math.max(m, Math.ceil(gy) + bleed);
        mr = Math.max(m, Math.ceil(hw - gx - w) + bleed);
        mb = Math.max(m, Math.ceil(hh - gy - h) + bleed);
      }
      size = { u, w, h, m, ml, mt, mr, mb, dpr, gl: grid.offsetLeft, gt: grid.offsetTop, bw: board.offsetWidth || w, bh: board.offsetHeight || h };
      if (w && h) {
        cv.style.left = `${-ml}px`;
        cv.style.top = `${-mt}px`;
        cv.style.width = `${w + ml + mr}px`;
        cv.style.height = `${h + mt + mb}px`;
        const pw = Math.round((w + ml + mr) * dpr);
        const ph = Math.round((h + mt + mb) * dpr);
        if (cv.width !== pw || cv.height !== ph) {
          cv.width = pw;
          cv.height = ph;
        }
      }
    }
    let ro = null;
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(() => measure());
      ro.observe(grid);
      ro.observe(board);
      ro.observe(host); // the picture area changes size: the canvas reaches its edges
    }
    measure();

    // ------------------------------------------------------------------ pointer
    const fine = (e) => e.pointerType !== 'touch';
    const pointerOn = () => on && o.enabled() && o.pointerFx();
    /** The pointer in the grid's own px, measured on the board's layout box (a lean never moves the box, so it cannot shift the answer). */
    const local = (e) => {
      const r = host.getBoundingClientRect();
      return [e.clientX - r.left - board.offsetLeft - grid.offsetLeft, e.clientY - r.top - board.offsetTop - grid.offsetTop];
    };
    const onMove = (e) => {
      if (!fine(e) || !o.enabled() || !o.pointerFx()) return;
      if (!on) sync();
      if (!size.u) measure();
      const [x, y] = local(e);
      hm.tx = x;
      hm.ty = y;
      hm.ta = 1;
      if (hm.a < 0.01) {
        hm.x = x; // first entry: start under the pointer instead of sweeping in from wherever it last was
        hm.y = y;
      }
      kick();
    };
    const onLeave = () => {
      hm.ta = 0;
      kick();
    };
    const onDown = (e) => {
      if (!fine(e) || !o.enabled() || !o.pointerFx()) return;
      if (!on) sync();
      const [x, y] = local(e);
      ripples.push({ x, y, at: performance.now() });
      if (ripples.length > 6) ripples.shift();
      kick();
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);

    // ------------------------------------------------------------------ your own keyboard
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.metaKey) return; // a shortcut is not typing
      const name = codeToName(e.code);
      const led = name ? nameToLed.get(name) : undefined;
      if (led !== undefined && o.typing && o.typing()) press(led);
    };
    win.addEventListener('keydown', onKey);

    function press(led) {
      if (!o.enabled()) return;
      pressedAt.set(led, performance.now());
      kick();
    }

    /** Lights the keys up in a left-to-right sweep, once (`fast`: the quick one for an effect change). */
    function intro(fast = false) {
      if (!o.enabled()) return;
      introAt = performance.now();
      introFast = !!fast;
      // The very first picture of it is the sweep's start, not full light for one frame: the caller repaints the keys right after this.
      ia = new Map(layout.map((k) => [k.led, introFactor(0, (k.x + k.w / 2) / gridW, introFast)]));
      kick();
    }

    /** How much light a key you just pressed gives, 0..1 (0 once it has faded). For the Reactive effects. */
    function glow(led) {
      const at = pressedAt.get(led);
      return at === undefined ? 0 : pressGlow((performance.now() - at) / 1000);
    }

    /** How lit a key is now (1 unless the lights-on sweep is running). */
    const lightFactor = (led) => (introAt < 0 ? 1 : ia.has(led) ? ia.get(led) : 1);

    // ------------------------------------------------------------------ the loop
    const gliding = () =>
      ripples.length > 0 ||
      introAt >= 0 ||
      pressedAt.size > 0 ||
      Math.abs(hm.ta - hm.a) > 0.004 ||
      (hm.ta > 0 && (Math.abs(hm.tx - hm.x) > 0.25 || Math.abs(hm.ty - hm.y) > 0.25));

    function kick() {
      if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
    }

    /** Starts (or stops) the motion to match what max-ui.js allows now. Safe to call as often as needed. */
    function sync() {
      if (o.enabled()) {
        if (!on) {
          on = true;
          host.dataset.fx = '1';
          measure();
        }
        kick();
      } else if (on) stopAll();
    }

    /** Everything back to rest: the board square, the keys where they are, nothing on the canvas. */
    function stopAll() {
      on = false;
      delete host.dataset.fx;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ripples = [];
      pressedAt.clear();
      introAt = -1;
      ia = new Map();
      hm.a = hm.ta = 0;
      if (boardTf) board.style.transform = '';
      boardTf = '';
      for (const b of keys.values()) {
        if (b._fx) {
          b.style.transform = '';
          b.style.opacity = '';
          b._fx = '';
        }
      }
      clearCanvas();
      if (o.repaint) o.repaint();
    }

    function clearCanvas() {
      if (g2 && canvasDirty) {
        g2.setTransform(1, 0, 0, 1, 0, 0);
        g2.clearRect(0, 0, cv.width, cv.height);
      }
      canvasDirty = false;
    }

    function frame(ts) {
      raf = 0;
      if (!o.enabled()) {
        if (on) stopAll();
        return;
      }
      if (!on) sync();
      raf = requestAnimationFrame(frame);
      const now = ts || performance.now();
      // Plain idle drift: ~30 frames a second is plenty and keeps the idle cost low. Anything the pointer, a press or the sweep is moving is
      // drawn on every display frame so it stays smooth.
      if (now - lastDraw < 30 && !gliding()) return;
      lastDraw = now;
      if (typeof document !== 'undefined' && document.hidden) return;
      draw(performance.now());
    }

    function draw(nowMs) {
      if (!size.u) measure();
      const { u, w, h, ml, mt, mr, mb, dpr } = size;
      if (!u) return;
      const pfx = pointerOn();

      // ---- the smoothed pointer
      const dt = Math.min(0.05, Math.max(0, (nowMs - (lastFrame || nowMs)) / 1000));
      lastFrame = nowMs;
      if (!pfx) {
        hm.ta = 0;
        hm.a = 0;
        ripples = [];
      } else {
        const follow = 1 - Math.exp(-dt * 14); // pointer follow speed
        const fade = 1 - Math.exp(-dt * (hm.ta > hm.a ? 9 : 5)); // quicker in than out
        hm.x += (hm.tx - hm.x) * follow;
        hm.y += (hm.ty - hm.y) * follow;
        hm.a += (hm.ta - hm.a) * fade;
        if (hm.a < 0.002 && hm.ta === 0) hm.a = 0;
      }
      ripples = ripples.filter((r) => (nowMs - r.at) / 1000 < RIPPLE_LIFE);

      // ---- the board: lean toward the pointer, and drift when nobody is touching it
      const nx = size.bw ? clamp01((hm.x + size.gl) / size.bw) * 2 - 1 : 0;
      const ny = size.bh ? clamp01((hm.y + size.gt) / size.bh) * 2 - 1 : 0;
      const lean = pfx ? hm.a : 0;
      const { rx, ry } = leanOf(nx, ny, lean);
      // Whole device pixels while it is only drifting: a fraction of a pixel makes the legends and edges soft.
      const bob = pfx ? Math.round(bobOf(nowMs, hm.a) * dpr) / dpr : 0;
      let tf = '';
      if (lean > 0.002) tf = `perspective(${TILT_VIEW}px) translateY(${bob.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
      else if (bob) tf = `translateY(${bob.toFixed(2)}px)`;
      if (tf !== boardTf) {
        boardTf = tf;
        board.style.transform = tf;
      }

      // ---- the lights-on sweep
      let sweeping = false;
      if (introAt >= 0) {
        const e = (nowMs - introAt) / 1000;
        if (e > (introFast ? 1.2 : 2.4)) {
          introAt = -1;
          ia = new Map();
          sweeping = true; // one more repaint, back at full light
        } else {
          sweeping = true;
          for (const k of layout) ia.set(k.led, introFactor(e, (k.x + k.w / 2) / gridW, introFast));
        }
      }

      // ---- the keys: rise near the pointer, sink when pressed, rise into place during the sweep
      const touched = [];
      for (const k of layout) {
        const b = keys.get(k.led);
        if (!b) continue;
        const kx = (k.x + k.w / 2) * u;
        const ky = (k.y + 0.5) * u;
        const tk = pfx ? touchOf(kx, ky, hm, u, ripples, nowMs) : 0;
        const at = pressedAt.get(k.led);
        const age = at === undefined ? 99 : (nowMs - at) / 1000;
        if (at !== undefined && age > PRESS_LIFE) pressedAt.delete(k.led);
        const dep = at === undefined ? 0 : pressDepth(age) < 0.01 ? 0 : pressDepth(age);
        const f = introAt >= 0 ? (ia.has(k.led) ? ia.get(k.led) : 1) : 1;
        // A key under the pointer rises toward you; a pressed key still sinks (and wins when both happen).
        const rawY = (1 - f) * u * 0.14 + dep * u * 0.05 - tk * u * 0.06 * (1 - dep);
        const rawS = 1 + Math.min(1, tk) * 0.03 * (1 - dep) - dep * 0.03;
        const rawO = introAt >= 0 ? 0.3 + 0.7 * f : 1;
        // Rounded to what the eye can tell apart, so "at rest" is one exact state (a key that is all but at rest is put exactly there).
        const yoff = Math.abs(rawY) < 0.05 ? 0 : Math.round(rawY * 10) / 10;
        const sc = Math.abs(rawS - 1) < 0.0005 ? 1 : Math.round(rawS * 1000) / 1000;
        const op = rawO > 0.995 ? 1 : Math.round(rawO * 100) / 100;
        const sig = `${yoff}|${sc}|${op}`;
        if (b._fx !== sig) {
          const rest = yoff === 0 && sc === 1 && op === 1;
          b.style.transform = rest ? '' : `translateY(${yoff}px) scale(${sc})`;
          b.style.opacity = op === 1 ? '' : String(op);
          b._fx = sig;
        }
        if (tk > 0.05) touched.push({ k, tk, yoff });
      }

      if (sweeping && o.repaint) o.repaint();

      // ---- the light on the board: the pointer's spotlight, the glow of the keys it touches, and the rings of any click ripples
      const drawing = g2 && (hm.a > 0.01 || ripples.length > 0);
      if (drawing) {
        if (nowMs - tintAt > 160) {
          tintAt = nowMs;
          const t = o.tint ? o.tint() : null;
          const peak = t ? Math.max(t[0], t[1], t[2]) : 0;
          tintRGB = peak < 24 ? [150, 200, 255] : t.map((v) => Math.min(255, Math.round((v * 255) / peak)));
        }
        g2.setTransform(dpr, 0, 0, dpr, ml * dpr, mt * dpr);
        g2.clearRect(-ml, -mt, w + ml + mr, h + mt + mb);
        g2.globalCompositeOperation = 'lighter';
        for (const { k, tk, yoff } of touched) {
          // the cap's flat face (the picture's keycap sprite has it 12.5% in from the sides, 9.5% down, 33.9% up from the foot of a key)
          g2.fillStyle = rgbOf(tintRGB, 0.2 * Math.min(1, tk));
          roundRect(g2, (k.x + 0.125) * u, k.y * u + u * 0.095 + yoff, (k.w - 0.25) * u, u * 0.566, u * 0.1);
          g2.fill();
        }
        if (hm.a > 0.01) {
          const sr = u * 4.2;
          const sg = g2.createRadialGradient(hm.x, hm.y, 0, hm.x, hm.y, sr);
          sg.addColorStop(0, rgbOf(tintRGB, 0.2 * hm.a));
          sg.addColorStop(0.45, rgbOf(tintRGB, 0.07 * hm.a));
          sg.addColorStop(1, rgbOf(tintRGB, 0));
          g2.fillStyle = sg;
          g2.fillRect(hm.x - sr, hm.y - sr, sr * 2, sr * 2);
        }
        g2.globalCompositeOperation = 'source-over';
        for (const r of ripples) {
          const age = (nowMs - r.at) / 1000;
          g2.beginPath();
          g2.arc(r.x, r.y, Math.max(1, age * u * 11), 0, TAU);
          g2.lineWidth = 2;
          g2.strokeStyle = rgbOf(tintRGB, 0.65 * Math.exp(-age / 0.6));
          g2.stroke();
        }
        canvasDirty = true;
      } else clearCanvas();
    }

    function destroy() {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
      win.removeEventListener('keydown', onKey);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      on = false;
      delete host.dataset.fx;
      board.style.transform = '';
      cv.remove();
    }

    return { press, intro, glow, lightFactor, sync, measure, destroy, state: () => ({ on, hm: { ...hm }, ripples: ripples.length, presses: pressedAt.size, sweeping: introAt >= 0 }) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  return { create, influence, bobOf, leanOf, introFactor, pressDepth, pressGlow, touchOf, codeToName, TILT_DEG, TILT_VIEW, BOB_PX, RIPPLE_LIFE };
});
