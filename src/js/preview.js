/*
 * Canvas keyboard. Draws the keyboard in the style of the manufacturer's own picture (a different one for each model,
 * see skins.js) and simulates the firmware effects on it so changes can be judged before they are written. It is an approximation: the firmware's
 * own animation timing is not published.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'), require('./layout.js'), require('./skins.js'), require('./boardart.js'), require('./boardphoto.js'));
  else root.AulaPreview = factory(root.AulaProtocol, root.AulaLayout, root.AulaSkins, root.AulaBoardArt, root.AulaBoardPhoto);
})(typeof self !== 'undefined' ? self : globalThis, function (P, L, S, A, BP) {
  'use strict';

  const TAU = Math.PI * 2;
  // Frame (in seconds) shown when the preview is paused; chosen so each effect looks like itself.
  const STILL = { 12: 1.7 };
  const speedFactor = (speed) => 0.35 + speed * 0.45;
  const stillTime = (mode, speed = 2) => {
    if (mode === 2) return Math.PI / (2 * speedFactor(speed)); // top of the first breath, in the first colour
    if (mode === 3) return 0.1; // first colour of the cycle
    return STILL[mode] !== undefined ? STILL[mode] : 1.7;
  };
  const LEVELS = [0, 0.25, 0.5, 0.75, 1];
  /** The glow for a brightness on the 0..4 scale; in-between values (a keyboard with more levels) fall between the steps. */
  const levelFor = (b) => {
    const x = Math.max(0, Math.min(4, Number(b) || 0));
    const i = Math.min(3, Math.floor(x));
    return LEVELS[i] + (LEVELS[i + 1] - LEVELS[i]) * (x - i);
  };

  const frac = (v) => v - Math.floor(v);
  const hash = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const smooth = (v) => v * v * (3 - 2 * v);
  /** How strongly the pointer affects something `dist` away: 1 right under it, easing to 0 at `radius`. */
  const hoverInfluence = (dist, radius) => (radius > 0 ? smooth(clamp01(1 - dist / radius)) : 0);
  const TILT_DEG = { x: 3.2, y: 4.5 }; // how far the whole board leans toward the pointer
  const RIPPLE_LIFE = 1.5; // seconds
  const LABEL_REF = 100; // px size the legends are measured at, once; widths at any other size are scaled from it
  // Heavy and rounded, like the legends on the real caps: thin strokes blur on small caps. "Aula Legend" is the bundled
  // font (css/app.css); the system fonts after it only stand in until it has loaded, and for the arrow glyphs it lacks.
  const LABEL_FAMILY = '"Aula Legend","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  const LABEL_WEIGHT = 600;
  const LABEL_FONT = (px) => `${LABEL_WEIGHT} ${px}px ${LABEL_FAMILY}`;

  // Colours the keyboard steps through when an effect runs multicolour, used when the palette has nothing usable.
  const FACTORY_CYCLE = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255]];

  /** The effect's palette colours in order, skipping black ones (a black step would just look like a glitch). */
  function cycleColors(s) {
    const lit = (s.palette || []).filter((c) => c && Math.max(c[0], c[1], c[2]) >= 3);
    return lit.length ? lit : FACTORY_CYCLE;
  }

  /**
   * One colour out of `colors`, changing every `period` seconds. The keyboard jumps from one colour to the next rather
   * than blending, so the change is only softened over the last `fade` fraction of a step (enough to avoid a flicker).
   */
  function stepColor(colors, t, period, fade) {
    const n = colors.length;
    const pos = t / period;
    const i = Math.floor(pos);
    const f = pos - i;
    const cur = colors[((i % n) + n) % n];
    if (f <= 1 - fade) return cur;
    return P.mix(cur, colors[(((i + 1) % n) + n) % n], smooth((f - (1 - fade)) / fade));
  }

  // Serpentine path through the keys for the Snake effect. Built for the layout in use and rebuilt when it changes.
  let snakeFor = null;
  let SNAKE = [];
  let SNAKE_INDEX = new Map();
  function ensureSnake() {
    if (snakeFor === L.id) return;
    const rows = new Map();
    for (const k of L.KEYS) {
      const r = Math.round(k.y * 10);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(k);
    }
    SNAKE = [...rows.keys()]
      .sort((a, b) => a - b)
      .flatMap((r, i) => {
        const row = rows.get(r).sort((a, b) => a.x - b.x);
        return i % 2 ? row.reverse() : row;
      })
      .map((k) => k.led);
    SNAKE_INDEX = new Map(SNAKE.map((led, i) => [led, i]));
    snakeFor = L.id;
  }

  /**
   * Colour of one key for a given effect.
   * s: { palette, colorIndex, speed, colors, pressed(led, t) }
   */
  function keyColor(mode, k, t, s) {
    return rawKeyColor(mode, k, t, s).map((v) => Math.min(255, Math.max(0, v)));
  }

  function rawKeyColor(mode, k, t, s) {
    const nx = (k.x + k.w / 2) / L.WIDTH;
    const ny = (k.y + 0.5) / L.HEIGHT;
    const h = hash(k.led + 1);
    const sp = speedFactor(s.speed);
    const multi = s.colorIndex === P.MULTICOLOR;
    const base = multi ? null : s.palette[Math.min(s.colorIndex, 6)] || [255, 255, 255];
    const tint = (hue, f) => (base ? scale(base, f) : scale(P.hsv(hue, 1, 1), f));
    const cx = nx - 0.5;
    const cy = ny - 0.5;
    const angle = Math.atan2(cy, cx * 2.2) / TAU;
    const dist = Math.hypot(cx * 2.2, cy);

    switch (mode) {
      case 1:
        return tint(nx * 0.9, 1);
      case 2: {
        // One breath fades up from dark and back down to dark. Multicolour moves to the next colour at the dark point.
        const period = Math.PI / sp;
        const ph = t / period;
        const f = 0.5 - 0.5 * Math.cos(TAU * frac(ph));
        let col = base;
        if (!col) {
          const cyc = cycleColors(s);
          col = cyc[Math.floor(ph) % cyc.length];
        }
        return scale(col, 0.03 + 0.97 * f);
      }
      case 3:
        // The whole board shows one colour at a time and steps through the palette (red, green, ...), not a gradient.
        return stepColor(cycleColors(s), t, 2.2 / sp, 0.1);
      case 4: {
        const ph = (t * sp * 0.9 + h * 5) % 5;
        return tint(h, Math.max(0, 1 - ph * 1.6));
      }
      case 5: {
        const col = Math.floor(nx * 16);
        const y = frac(t * sp * 0.35 * (0.6 + hash(col + 3)) + hash(col + 9) * 3);
        const dy = y - ny;
        const f = dy >= 0 && dy < 0.45 ? 1 - dy / 0.45 : 0;
        return tint(hash(col), f * f);
      }
      case 6: {
        const a = angle + t * 0.1 * sp;
        if (!base) return P.hsv(a, 1, 1);
        return scale(base, 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(a * TAU * 2)));
      }
      case 7: {
        let f = 0;
        for (let i = 0; i < 3; i++) {
          const period = 3.2 / sp;
          const n = Math.floor(t / period + i * 0.37);
          const r = frac(t / period + i * 0.37) * 1.4;
          const rx = (hash(n * 3 + i) - 0.5) * 1.6;
          const ry = (hash(n * 5 + i) - 0.5) * 0.8;
          const d = Math.hypot((cx - rx * 0.5) * 2.2, cy - ry * 0.5);
          f = Math.max(f, Math.exp(-Math.pow(d - r, 2) / 0.015) * (1 - r / 1.4));
        }
        return tint(nx, f);
      }
      case 8: {
        const f = Math.pow(Math.max(0, Math.sin(t * sp * 1.3 + h * 40)), 6);
        return tint(h, Math.min(1, 0.04 + f));
      }
      case 10: {
        ensureSnake();
        const n = SNAKE.length;
        const head = Math.floor(t * sp * 14) % n;
        const behind = (head - SNAKE_INDEX.get(k.led) + n) % n;
        return tint(behind / 12, Math.max(0, 1 - behind / 10));
      }
      case 11: {
        const w = 0.5 + 0.5 * Math.sin(nx * 7 - t * sp * 2 + Math.sin(ny * 3 + t * sp) * 1.4);
        return base ? scale(base, 0.15 + 0.85 * w) : P.hsv(nx * 1.1 - t * 0.15 * sp + w * 0.2, 1, 0.35 + 0.65 * w);
      }
      case 12: {
        const f = s.pressed ? s.pressed(k.led, t) : 0;
        return tint(h, 0.06 + 0.94 * f);
      }
      case 13: {
        const f = 0.5 + 0.5 * Math.sin(nx * 8 - t * sp * 3 + ny * 2);
        return base ? scale(base, 0.1 + 0.9 * f) : P.hsv(nx * 0.6 + t * 0.05, 1, 0.2 + 0.8 * f);
      }
      case 15: {
        const spoke = 0.5 + 0.5 * Math.sin((angle * 3 + t * 0.25 * sp) * TAU);
        return P.hsv(angle + t * 0.1 * sp, 1, 0.25 + 0.75 * spoke);
      }
      case 16:
        return P.hsv(ny * 0.7 - t * 0.2 * sp + nx * 0.1, 1, 1);
      case 17: {
        const f = 0.6 + 0.4 * Math.sin(dist * 10 - t * sp * 3);
        return P.hsv(dist * 1.1 - t * 0.18 * sp, 1, f);
      }
      case 21:
        return s.colors ? P.getKeyColor(s.colors, k.led) : [0, 0, 0];
      default:
        return [0, 0, 0];
    }
  }

  class KeyboardView {
    /**
     * @param canvas
     * @param opts { interactive, flat, animate, onPick(key, ev), onHover(key) }
     */
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.state = {
        mode: 0, brightness: 4, speed: 2, colorIndex: 7, palette: [], colors: null, selection: new Set(), legends: null, dim: false,
      };
      this.pressedAt = new Map();
      this._dimAmt = null; // 0 = lit as the state says, 1 = dark; eases toward state.dim so switching off fades instead of blinking
      this._dimMs = 0;
      this.introAt = -1;
      this.hover = null;
      this.running = false;
      this.raf = 0;
      this.t0 = performance.now();
      this.mean = [120, 160, 255];
      this.hm = { x: 0, y: 0, a: 0, tx: 0, ty: 0, ta: 0 }; // smoothed pointer (x, y in canvas px, a = presence 0..1) and its targets
      this.ripples = [];
      this._labelW = new Map(); // legend text -> its width at LABEL_REF px (measured once, scaled after that)
      this._lastFrame = 0;
      this._sl = null; // the case layer (see _layer)
      this._caps = new Map(); // keycap sprites (see _cap)
      // The rendered pictures (boardphoto.js) arrive a little after the first frame; when one does, draw again so it shows.
      this._unsubPhoto = BP && BP.subscribe ? BP.subscribe(() => { if (!this.running) this.draw(); }) : null;
      // The legend font arrives a moment after the first frame too: widths measured in the stand-in font are thrown away
      // and the board is drawn again with the real one.
      if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.load === 'function') {
        document.fonts
          .load(LABEL_FONT(20), 'Qq1!@Ag')
          .then(() => {
            this._labelW.clear();
            this._wordKey = null;
            if (!this.running) this.draw();
          })
          .catch(() => {});
      }
      this.onFrameColor = null;
      this.layout = { u: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

      this._resize = () => this.resize();
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(this._resize);
        this.ro.observe(canvas.parentElement || canvas);
      }
      if (opts.interactive) this._bindPointer();
      if (opts.hoverFx !== false) this._bindHover();
      this.resize();
    }

    setState(patch) {
      Object.assign(this.state, patch);
      if (!this.running) this.draw();
    }

    press(led) {
      // A paused preview has no loop to let the cap spring back up, so it ignores presses.
      if (this.opts.animate === false) return;
      this.pressedAt.set(led, (performance.now() - this.t0) / 1000);
      if (!this.running) this.draw();
    }

    /** Lights the keys up in a left-to-right sweep, once. */
    playIntro(fast = false) {
      if (this.opts.animate === false) return;
      this.introAt = performance.now();
      this.introFast = !!fast;
    }

    _introFactor(nx) {
      if (this.introAt < 0 || this.opts.animate === false) return 1;
      const e = (performance.now() - this.introAt) / 1000;
      const rate = this.introFast ? 2.6 : 1.3;
      if (e > (this.introFast ? 1.2 : 2.4)) {
        this.introAt = -1;
        return 1;
      }
      // A quick sweep keeps a floor so an effect change never blanks the board.
      const f = smooth(clamp01((e * rate - nx * 0.85) * 2.4));
      return this.introFast ? 0.35 + 0.65 * f : f;
    }

    /**
     * True while something the pointer started is still moving: a click ripple, the spotlight / lean catching up with
     * the pointer, or the intro sweep. Those are judged by eye against the display's refresh rate, so they get a frame
     * every time the screen refreshes. (At a fixed 30 fps the ripple visibly steps.)
     */
    _gliding() {
      if (this.opts.animate === false || this.opts.flat) return false; // flat (key editing) draws no pointer effects
      const m = this.hm;
      return (
        this.ripples.length > 0 ||
        this.introAt >= 0 ||
        Math.abs(m.ta - m.a) > 0.004 ||
        (m.ta > 0 && (Math.abs(m.tx - m.x) > 0.25 || Math.abs(m.ty - m.y) > 0.25))
      );
    }

    start() {
      if (this.running) return;
      this.running = true;
      let last = 0;
      const loop = (ts) => {
        if (!this.running) return;
        this.raf = requestAnimationFrame(loop);
        const now = ts || performance.now();
        // Plain lighting animation: ~30 fps is plenty, and keeps the idle cost low. Anything the pointer is moving
        // (see _gliding) is drawn on every display frame so it stays smooth.
        if (now - last < 30 && !this._gliding()) return;
        last = now;
        this.draw();
      };
      this.raf = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }

    resize() {
      const host = this.canvas.parentElement || this.canvas;
      const r = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(10, Math.floor(r.width));
      const h = Math.max(10, Math.floor(r.height));
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      // Room kept clear for the status pill above and the hint line below.
      const inset = this.opts.inset || { top: 0, bottom: 0 };
      const availH = Math.max(10, h - inset.top - inset.bottom);
      const pad = Math.min(w, availH) * 0.04; // the keyboard is the point of this view, so it gets nearly all of it
      const u = Math.min(((w - pad * 2) / (L.WIDTH + 0.6)) * 0.85, (availH - pad * 2) / (L.HEIGHT + 0.6)); // 0.85: keeps the keyboard a little smaller than the full width of the stage
      this.layout = {
        u, dpr, w, h,
        ox: (w - L.WIDTH * u) / 2,
        oy: inset.top + (availH - L.HEIGHT * u) / 2,
      };
      this.draw();
    }

    destroy() {
      this.stop();
      if (this.ro) this.ro.disconnect();
      if (this._unsubPhoto) this._unsubPhoto();
      if (this._unbindHover) this._unbindHover();
    }

    // ---------------------------------------------------------- pointer

    keyAt(x, y) {
      const { u, ox, oy } = this.layout;
      const gx = (x - ox) / u;
      const gy = (y - oy) / u;
      return L.KEYS.find((k) => gx >= k.x && gx <= k.x + k.w && gy >= k.y && gy <= k.y + k.h) || null;
    }

    _bindPointer() {
      const c = this.canvas;
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      const on = () => !this.opts.enabled || this.opts.enabled();
      c.addEventListener('pointerdown', (e) => {
        if (!on()) return;
        c.setPointerCapture(e.pointerId);
        const k = this.keyAt(...pos(e));
        if (this.opts.onPick) this.opts.onPick(k, e, 'down');
      });
      c.addEventListener('pointermove', (e) => {
        if (!on()) {
          if (this.hover) {
            this.hover = null;
            c.style.cursor = 'default';
          }
          return;
        }
        const k = this.keyAt(...pos(e));
        if (k !== this.hover) {
          this.hover = k;
          c.style.cursor = k ? 'pointer' : 'default';
          if (this.opts.onHover) this.opts.onHover(k);
          if (!this.running) this.draw();
        }
        if (e.buttons & 1 && k && this.opts.onPick) this.opts.onPick(k, e, 'move');
      });
      c.addEventListener('pointerup', (e) => {
        if (on() && this.opts.onPick) this.opts.onPick(null, e, 'up');
      });
      c.addEventListener('pointerleave', () => {
        if (this.hover) {
          this.hover = null;
          if (this.opts.onHover) this.opts.onHover(null);
          if (!this.running) this.draw();
        }
      });
    }

    // ------------------------------------------------------- hover effects

    /**
     * Pointer tracking for the "alive" effects: a spotlight that follows the cursor, keys that rise and glow as it
     * passes, a slight lean of the whole board toward it, and a ripple on click. It listens on the parent element
     * (which never moves) rather than on the canvas (which leans), so the tilt can not feed back into the pointer
     * position. Works whether or not the canvas is interactive; per-key editing keeps its own pointer handling.
     */
    _bindHover() {
      const host = this.canvas.parentElement;
      if (!host || !host.addEventListener) return;
      const local = (e) => {
        const r = host.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      const fine = (e) => e.pointerType !== 'touch';
      const move = (e) => {
        if (!fine(e)) return;
        const [x, y] = local(e);
        this.hm.tx = x;
        this.hm.ty = y;
        this.hm.ta = 1;
        if (this.hm.a < 0.01) {
          // First entry: start under the pointer instead of sweeping in from wherever it last was.
          this.hm.x = x;
          this.hm.y = y;
        }
      };
      const leave = () => {
        this.hm.ta = 0;
      };
      const down = (e) => {
        if (!fine(e) || this.opts.animate === false) return;
        if (this.opts.enabled && this.opts.enabled()) return; // editing keys: no ripples under the brush
        const [x, y] = local(e);
        this.ripples.push({ x, y, at: performance.now() });
        if (this.ripples.length > 6) this.ripples.shift();
        if (!this.running) this.draw();
      };
      host.addEventListener('pointermove', move);
      host.addEventListener('pointerleave', leave);
      host.addEventListener('pointerdown', down);
      this._unbindHover = () => {
        host.removeEventListener('pointermove', move);
        host.removeEventListener('pointerleave', leave);
        host.removeEventListener('pointerdown', down);
        this.canvas.style.transform = '';
      };
    }

    /** Eases the smoothed pointer toward its target and leans/floats the canvas. Returns the smoothed state. */
    _hoverStep(nowMs) {
      const m = this.hm;
      const dt = Math.min(0.05, Math.max(0, (nowMs - (this._lastFrame || nowMs)) / 1000));
      this._lastFrame = nowMs;
      const follow = 1 - Math.exp(-dt * 14); // pointer follow speed
      const fade = 1 - Math.exp(-dt * (m.ta > m.a ? 9 : 5)); // quicker in than out
      m.x += (m.tx - m.x) * follow;
      m.y += (m.ty - m.y) * follow;
      m.a += (m.ta - m.a) * fade;
      if (m.a < 0.002 && m.ta === 0) m.a = 0;

      const { w, h } = this.layout;
      const flat = !!this.opts.flat;
      // Lean toward the pointer, and drift gently when nobody is touching it. Flat (key editing) stays square so
      // clicks land exactly where they appear to.
      const lean = flat || !w || !h ? 0 : m.a;
      const nx = w ? clamp01(m.x / w) * 2 - 1 : 0;
      const ny = h ? clamp01(m.y / h) * 2 - 1 : 0;
      const rx = -ny * TILT_DEG.x * lean;
      const ry = nx * TILT_DEG.y * lean;
      const bob = flat ? 0 : Math.sin(nowMs / 1000 * 0.9) * 1.6 * (1 - 0.7 * m.a);
      const tf = `perspective(1000px) translateY(${bob.toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
      if (tf !== this._tf) {
        this._tf = tf;
        this.canvas.style.transform = tf;
      }
      return m;
    }

    // ------------------------------------------------------------ draw

    _t() {
      return this.opts.animate === false ? stillTime(this.state.mode, this.state.speed) : (performance.now() - this.t0) / 1000;
    }

    /** The case layer (shadow, case, plate, slots, knob). Drawn once per size and model, then reused every frame. */
    _layer(skin, geo) {
      // `photo`: the rendered picture of this skin, once it has loaded (boardphoto.js); until then the drawing stands in.
      const photo = BP ? BP.skin(skin.id) : null;
      const key = [L.id, skin.id, geo.u.toFixed(2), geo.w, geo.h, geo.dpr, geo.ox.toFixed(1), geo.oy.toFixed(1), photo ? 'p' : 'd'].join('|');
      if (this._sl && this._sl.key === key) return this._sl;
      const lay = A.offscreen(Math.ceil(geo.w * geo.dpr), Math.ceil(geo.h * geo.dpr));
      if (lay) {
        lay.ctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
        A.drawStatic(lay.ctx, skin, geo, L.KEYS, { knob: L.KNOB, photo });
      }
      this._caps.clear(); // cap sprites are sized for the layout, so they go with it
      this._sl = { key, lay, photo };
      return this._sl;
    }

    /** One keycap as a small sprite, per skin, accent colour and size. `m` is the margin kept round it for its shadow. */
    _cap(skin, acc, kw, kh, u, dpr, units, photo) {
      const key = `${skin.id}|${acc ? acc.body[0] : ''}|${kw.toFixed(2)}|${kh.toFixed(2)}|${u.toFixed(2)}|${dpr}|${photo ? 'p' : 'd'}`;
      let sp = this._caps.get(key);
      if (sp) return sp;
      const pic = photo ? photo.cap(units, acc ? acc.name : '-') : null;
      if (pic) {
        // The rendered cap, scaled once to this size. Its picture reaches `mc` key units past the key on every side (for
        // its shadow), so it is drawn that much larger than the key and placed that much up and to the left.
        const cw = (units + photo.mc * 2) * u;
        const chh = (1 + photo.mc * 2) * u;
        const pl = A.offscreen(Math.ceil(cw * dpr), Math.ceil(chh * dpr));
        if (pl) {
          pl.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          pl.ctx.imageSmoothingEnabled = true;
          if ('imageSmoothingQuality' in pl.ctx) pl.ctx.imageSmoothingQuality = 'high';
          pl.ctx.drawImage(pic.img, 0, 0, cw, chh);
          sp = { lay: pl, m: u * A.GAP + photo.mc * u, photo: true, face: photo.face };
          this._caps.set(key, sp);
          return sp;
        }
      }
      const m = Math.ceil(u * 0.14);
      const lay = A.offscreen(Math.ceil((kw + m * 2) * dpr), Math.ceil((kh + m * 2) * dpr));
      if (lay) {
        lay.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        A.drawCap(lay.ctx, skin, acc, m, m, kw, kh, u);
      }
      sp = { lay, m, photo: false };
      this._caps.set(key, sp);
      return sp;
    }

    draw() {
      const { ctx } = this;
      const { u, ox, oy, w, h, dpr } = this.layout;
      const s = this.state;
      const t = this._t();
      const nowSec = (performance.now() - this.t0) / 1000;
      const animate = this.opts.animate !== false;
      const level = levelFor(s.brightness);
      const nowMs = performance.now();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Pointer effects: smoothed pointer, click ripples (dropped once they have faded)
      const fx = animate && this.opts.hoverFx !== false;
      const hm = fx ? this._hoverStep(nowMs) : null;
      if (!fx && this._tf) {
        this._tf = '';
        this.canvas.style.transform = '';
      }
      this.ripples = this.ripples.filter((r) => (nowMs - r.at) / 1000 < RIPPLE_LIFE);
      const hoverR = u * 2.6;
      /** 0..1.4: how much the pointer and any ripple are lifting a key centred at (kx, ky). */
      const touch = (kx, ky) => {
        let f = 0;
        if (fx && hm.a > 0.003) f = hm.a * hoverInfluence(Math.hypot(kx - hm.x, ky - hm.y), hoverR);
        for (const r of this.ripples) {
          const age = (nowMs - r.at) / 1000;
          const diff = Math.hypot(kx - r.x, ky - r.y) - age * u * 11;
          const band = u * 1.8;
          f += Math.exp(-(diff * diff) / (band * band)) * Math.exp(-age / 0.8) * 1.25;
        }
        return Math.min(1.4, f);
      };

      const pressed = (led, now) => {
        const at = this.pressedAt.get(led);
        return at === undefined ? 0 : Math.exp(-(now - at) / 0.55);
      };
      const depress = (led) => {
        const at = this.pressedAt.get(led);
        if (at === undefined) return 0;
        const d = Math.exp(-(nowSec - at) / 0.16);
        if (d < 0.01) {
          this.pressedAt.delete(led);
          return 0;
        }
        return d;
      };
      const eff = { ...s, pressed };

      // Lights going off (or coming back) fade over about half a second. Without animation, or on the first frame, it is instant.
      const dimTarget = s.dim ? 1 : 0;
      if (this._dimAmt === null || !animate) this._dimAmt = dimTarget;
      else {
        const dd = Math.min(0.1, Math.max(0, (nowMs - this._dimMs) / 1000));
        this._dimAmt += (dimTarget - this._dimAmt) * (1 - Math.exp(-dd * 6));
        if (Math.abs(dimTarget - this._dimAmt) < 0.004) this._dimAmt = dimTarget;
      }
      this._dimMs = nowMs;
      const dimAmt = this._dimAmt;

      // Colours first, so the case and the light under it can follow them.
      const colors = new Map();
      const intro = new Map();
      let mr = 0;
      let mg = 0;
      let mb = 0;
      for (const k of L.KEYS) {
        const ia = this._introFactor((k.x + k.w / 2) / L.WIDTH);
        intro.set(k.led, ia);
        const c = scale(keyColor(dimAmt >= 1 ? 0 : s.mode, k, t, eff), level * ia * (1 - dimAmt));
        colors.set(k.led, c);
        mr += c[0];
        mg += c[1];
        mb += c[2];
      }
      const n = L.KEYS.length;
      this.mean = [mr / n, mg / n, mb / n];
      if (this.onFrameColor) this.onFrameColor(this.mean);

      // Colour the pointer effects borrow: the board's own hue, or a cool white when it is dark.
      const hmx = Math.max(this.mean[0], this.mean[1], this.mean[2]);
      const tintRGB = hmx < 24 ? [150, 200, 255] : this.mean.map((v) => Math.min(255, Math.round((v * 255) / hmx)));
      const touched = new Map();
      for (const k of L.KEYS) touched.set(k.led, touch(ox + k.x * u + (k.w * u) / 2, oy + k.y * u + u / 2));

      const skin = S.get(L.skin || L.id);
      const flat = !!this.opts.flat;
      const mixc = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      const rgbStr = (c, a) => (a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);

      // ---- Case: what the keyboard is built into. Shape and colours come from the model's skin (skins.js).
      const pad = u * 0.42;
      const cx0 = ox - pad;
      const cy0 = oy - pad;
      const cw = L.WIDTH * u + pad * 2;
      const ch = L.HEIGHT * u + pad * 2;

      // Light spilling onto the desk under the keyboard
      const mx = Math.max(this.mean[0], this.mean[1], this.mean[2], 1);
      const mlum = (this.mean[0] + this.mean[1] + this.mean[2]) / 765;
      if (mlum > 0.02) {
        const hue = this.mean.map((v) => Math.round((v * 255) / mx));
        ctx.save();
        ctx.translate(cx0 + cw / 2, cy0 + ch * 0.92);
        ctx.scale(1, 0.3);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, cw * 0.6);
        const a = Math.min(0.55, 0.14 + mlum * 1.2);
        rg.addColorStop(0, `rgba(${hue[0]},${hue[1]},${hue[2]},${a})`);
        rg.addColorStop(1, `rgba(${hue[0]},${hue[1]},${hue[2]},0)`);
        ctx.fillStyle = rg;
        ctx.fillRect(-cw * 0.6, -cw * 0.6, cw * 1.2, cw * 1.2);
        ctx.restore();
      }

      // Case, plate, knob, indicator lights and the key slots never move, so they are drawn once into a layer (artwork in
      // boardart.js) and only copied here. Without an offscreen canvas they are drawn directly.
      const geo = { u, ox, oy, W: L.WIDTH, H: L.HEIGHT, w, h, dpr };
      const sl = this._layer(skin, geo);
      if (sl.lay) ctx.drawImage(sl.lay.canvas, 0, 0, w, h);
      else A.drawStatic(ctx, skin, geo, L.KEYS, { knob: L.KNOB, photo: sl.photo });

      const gap = u * A.GAP;

      // The light of each key: soft light on the plate, and the lit walls of its slot.
      ctx.globalCompositeOperation = 'lighter';
      for (const k of L.KEYS) {
        const c = colors.get(k.led);
        const cm = Math.max(c[0], c[1], c[2]);
        const bright = cm / 255;
        const tk = flat ? 0 : touched.get(k.led);
        if (bright < 0.02 && tk < 0.02) continue;
        // The key's own hue at full strength (a touched key that is dark borrows the board's hue); strength is `bright`.
        const hc = cm < 6 ? tintRGB : c.map((v) => Math.min(255, (v * 255) / cm));
        const strength = Math.min(1, cm < 6 ? 0 : bright * 1.15) + tk * 0.35;
        const kx = ox + k.x * u + (k.w * u) / 2;
        const ky = oy + k.y * u + u / 2;
        // soft light on the plate around the cap
        const rad = u * (0.55 + k.w * 0.42) * (1 + tk * 0.35);
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, rad);
        const ga = Math.min(0.7, (flat ? 0.16 : sl.photo ? 0.2 : 0.38) * Math.min(1, strength)); // a rendered case shows the light more, so it gets less
        g.addColorStop(0, rgbStr(hc, ga));
        g.addColorStop(1, rgbStr(hc, 0));
        ctx.fillStyle = g;
        ctx.fillRect(kx - rad, ky - rad, rad * 2, rad * 2);
        roundRect(ctx, ox + k.x * u + gap * 0.4, oy + k.y * u + gap * 0.4, k.w * u - gap * 0.8, u - gap * 0.8, u * 0.14);
        if (sl.photo) {
          // On a real board the light only shows in the narrow gaps round each cap, and brightest along the front. So:
          // a gap-wide line that the caps cover except where they leave a gap, and a faint wide bloom behind it.
          ctx.lineWidth = u * 0.16;
          ctx.strokeStyle = rgbStr(hc, Math.min(0.05, 0.035 * strength));
          ctx.stroke();
          ctx.lineWidth = u * 0.06;
          ctx.strokeStyle = rgbStr(hc, Math.min(0.28, 0.05 + 0.22 * strength));
          ctx.stroke();
        } else {
          // the lit slot wall: a wide faint bloom and a thin bright core
          // (kept fine: a heavy outline round every key hides the caps and their legends)
          ctx.lineWidth = u * 0.09;
          ctx.strokeStyle = rgbStr(hc, Math.min(0.1, 0.05 * strength));
          ctx.stroke();
          ctx.lineWidth = Math.max(1, u * 0.022);
          ctx.strokeStyle = rgbStr(hc, Math.min(0.6, 0.1 + 0.42 * strength));
          ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // ---- Keycaps
      const fontPx = Math.max(10, u * 0.4); // the text-only drawing, used until the rendered caps have loaded
      // Text is the slowest thing in this loop. A legend that grows a little as the pointer nears it used to get a
      // brand-new font size on every frame, which the browser cannot reuse (about 10x slower than a repeated size).
      // So each legend is measured once, the size snaps to 1/8 px (invisible, but a small set of sizes the browser
      // caches), and the font is only set when that size changes.
      let fontNow = -1;
      const setFont = (px) => {
        const q = Math.round(px * 8) / 8;
        if (q !== fontNow) {
          ctx.font = LABEL_FONT(q);
          fontNow = q;
        }
      };
      const textWidth = (text, px) => {
        let w = this._labelW.get(text);
        if (w === undefined) {
          ctx.font = LABEL_FONT(LABEL_REF);
          fontNow = LABEL_REF;
          w = ctx.measureText(text).width;
          this._labelW.set(text, w);
        }
        return (w * px) / LABEL_REF;
      };
      // Every word on the caps (Esc, F1, Tab, CapsLock, Backspace, Delete, PgUp ...) is printed in one size, as on the real
      // board: the biggest at which the longest of them still fits its cap, with its picture where it has one.
      let wordPx = u * 0.2;
      if (sl.photo) {
        const wkey = `${L.id}|${u}`;
        if (this._wordKey !== wkey) {
          let best = u * 0.24;
          for (const k of L.KEYS) {
            const st = S.legendStyle(k.n, k.x);
            if (st.kind === 'letter' || st.kind === 'stack' || st.kind === 'arrow' || st.kind === 'none') continue;
            const extra = st.kind === 'shift' ? 1.45 : st.kind === 'enter' ? 2.1 : st.kind === 'back' ? 1.85 : 0; // the picture beside the word, in font sizes
            const room = k.w * u - gap * 2 - (sl.photo.face.l + sl.photo.face.r) * u - u * 0.16;
            best = Math.min(best, room / (textWidth(S.legendOf(k.n).text, 1) + extra));
          }
          this._wordPx = Math.max(7, best);
          this._wordKey = wkey;
        }
        wordPx = this._wordPx;
      }
      ctx.textBaseline = 'middle';
      const baseFace = [S.rgb(skin.cap.face[0]), S.rgb(skin.cap.face[1])];
      const baseInk = S.rgb(skin.cap.legend);
      for (const k of L.KEYS) {
        const c = colors.get(k.led);
        const ia = intro.get(k.led);
        const dep = animate && !flat ? depress(k.led) : 0;
        const tk = flat ? 0 : touched.get(k.led);
        // A key under the pointer rises toward you; a pressed key still sinks (and wins when both happen).
        const yoff = (1 - ia) * u * 0.14 + dep * u * 0.05 - tk * u * 0.06 * (1 - dep);
        const x = ox + k.x * u + gap;
        const y = oy + k.y * u + gap + yoff;
        const kw = k.w * u - gap * 2;
        const kh = u - gap * 2;
        const cm = Math.max(c[0], c[1], c[2]);
        const bright = cm / 255;
        const lift = Math.min(1, tk);
        const hc = cm < 6 ? tintRGB : c.map((v) => Math.min(255, (v * 255) / cm));
        const acc = S.accentOf(skin, k.n);

        if (tk > 0.03) {
          // Soft shadow on the plate under a raised key.
          ctx.globalAlpha = Math.min(0.5, tk * 0.4) * ia;
          ctx.fillStyle = '#05070a';
          roundRect(ctx, x + kw * 0.03, y + u * 0.1 + tk * u * 0.04, kw * 0.94, kh, u * 0.14);
          ctx.fill();
        }
        ctx.globalAlpha = 0.3 + 0.7 * ia;

        // The cap itself (body, bevel, dished face, grain) is drawn once per size and accent colour and copied here.
        const sp = this._cap(skin, acc, kw, kh, u, dpr, k.w, sl.photo);
        let sx = 0;
        let sy = 0;
        if (sp.lay) {
          // Copied 1:1 and on a whole device pixel. A sprite placed on a fractional position, or stretched by a fraction
          // of a pixel, is smoothed by the browser, and that is what made the caps and their edges look soft.
          sx = Math.round((x - sp.m) * dpr) / dpr;
          sy = Math.round((y - sp.m) * dpr) / dpr;
          ctx.drawImage(sp.lay.canvas, sx, sy, sp.lay.canvas.width / dpr, sp.lay.canvas.height / dpr);
        } else A.drawCap(ctx, skin, acc, x, y, kw, kh, u);

        // On top of it the face takes the key's light. Lighting mode tints it a little and washes its lower part with the
        // colour (the LEDs sit under the front of the cap). The per-key tabs paint it, and dim the keys that are off, so
        // it is obvious at a glance which keys carry a colour.
        const cg = sp.photo ? A.faceGeo(sp.face, kw, kh, u) : A.capGeo(kw, kh, u);
        const fcx = x + cg.fx;
        const fcy = y + cg.fy;
        const fcw = cg.fw;
        const fch = cg.fh;
        let f0 = baseFace[0];
        let f1 = baseFace[1];
        if (acc && acc.face) {
          f0 = S.rgb(acc.face[0]);
          f1 = S.rgb(acc.face[1]);
        }
        const lightFace = S.luma(f0) > 0.6; // a light cap would turn the paint white if its picture were laid over it as a highlight
        const faceRR = () => roundRect(ctx, fcx, fcy, fcw, fch, cg.fr);
        if (flat) {
          const paint = Math.min(1, bright * 3);
          const lit = hc.map((v) => v * (0.55 + 0.45 * Math.min(1, bright * 1.4)));
          if (paint < 1) {
            ctx.fillStyle = `rgba(6,8,12,${0.5 * (1 - paint)})`;
            faceRR();
            ctx.fill();
          }
          if (paint > 0) {
            ctx.fillStyle = rgbStr(lit, paint * 0.84);
            faceRR();
            ctx.fill();
            if (sp.photo && sp.lay) {
              // A painted rendered cap keeps its shading: the cap's own picture is laid over the paint so the dish, the
              // soft highlight and the shadowed edge still show through the colour.
              ctx.save();
              faceRR();
              ctx.clip();
              ctx.globalCompositeOperation = lightFace ? 'multiply' : 'hard-light';
              ctx.globalAlpha *= 0.8 * paint;
              ctx.drawImage(sp.lay.canvas, sx, sy, sp.lay.canvas.width / dpr, sp.lay.canvas.height / dpr);
              ctx.restore();
            }
          }
          f0 = mixc(scale(f0, 0.5), mixc(lit, [255, 255, 255], 0.12), paint * 0.88);
          f1 = mixc(scale(f1, 0.5), lit, paint * 0.88);
        } else {
          const tintAmt = skin.cap.lit * Math.min(1, bright * 1.5);
          if (tintAmt > 0.004) {
            ctx.fillStyle = rgbStr(hc, tintAmt);
            faceRR();
            ctx.fill();
          }
          if (bright > 0.02) {
            const under = ctx.createLinearGradient(0, fcy, 0, fcy + fch);
            under.addColorStop(0.3, rgbStr(hc, 0));
            under.addColorStop(1, rgbStr(hc, Math.min(0.07, 0.06 * Math.min(1, bright * 1.3)))); // a hint of the light, not a wash: the face stays the cap's own colour
            ctx.fillStyle = under;
            faceRR();
            ctx.fill();
          }
          if (dep > 0.05) {
            ctx.fillStyle = `rgba(0,0,0,${0.12 * dep})`;
            faceRR();
            ctx.fill();
          }
          if (lift > 0) {
            ctx.fillStyle = `rgba(255,255,255,${0.09 * lift})`;
            faceRR();
            ctx.fill();
          }
        }

        // Light leaking out under the front of the cap (the LEDs face the user)
        if (bright > 0.02 || tk > 0.02) {
          const edge = Math.min(1, 0.2 + 0.8 * Math.min(1, bright * 1.3) + dep * 0.3 + tk * 0.3);
          if (sp.photo) {
            // the light comes out under the cap and lights the foot of its front wall: a soft ellipse with no hard edge
            const gcx = x + kw / 2;
            const gcy = y + kh - u * 0.04;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.translate(gcx, gcy);
            ctx.scale(kw * 0.5, u * 0.17);
            const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gl.addColorStop(0, rgbStr(hc, 0.42 * edge));
            gl.addColorStop(0.55, rgbStr(hc, 0.15 * edge));
            gl.addColorStop(1, rgbStr(hc, 0));
            ctx.fillStyle = gl;
            ctx.fillRect(-1, -1, 2, 2);
            ctx.restore();
          } else {
            ctx.fillStyle = rgbStr(hc, edge);
            roundRect(ctx, x + kw * 0.1, y + kh - u * 0.115, kw * 0.8, u * 0.06, u * 0.03);
            ctx.fill();
          }
        }

        if (this.opts.labels !== false) {
          // Key assignment shows what each key does instead of what is printed on it (`legends`: led -> { text, mark }).
          const lg = s.legends ? s.legends.get(k.led) : null;
          const custom = !!(lg && lg.text);
          const printed = S.legendOf(k.n);
          const text = custom ? lg.text : printed.text;
          // On a rendered cap the legend is printed the way the real one is: big letters, a shifted symbol above its
          // plain one, one size for every word, little pictures on Tab, Shift, Enter, Backspace and the arrow keys.
          const style = !custom && sl.photo ? S.legendStyle(k.n, k.x) : null;
          if (text) {
            let ink;
            const dark = flat && S.luma(mixc(f0, f1, 0.5)) > 0.6; // a light face (a bright painted colour) needs dark text
            if (flat && lg && lg.mark === 'pending') {
              ink = dark ? '#0b6a38' : '#7cffb0'; // a change that is not on the keyboard yet
            } else if (flat) {
              ink = lg && lg.mark === 'locked' ? (dark ? 'rgba(20,22,28,0.5)' : 'rgba(255,255,255,0.4)') : dark ? 'rgba(20,22,28,0.9)' : 'rgba(255,255,255,0.92)';
            } else {
              // Legends pick up a little of the key's light, as the lit legends on a real board do.
              ink = rgbStr(mixc(acc && acc.legend ? S.rgb(acc.legend) : baseInk, hc, 0.06 * Math.min(1, bright * 1.5)), 1);
            }
            ctx.fillStyle = ink;
            if (style) {
              const grow = 1 + lift * 0.08;
              const lx = fcx + u * 0.08;
              ctx.textAlign = 'left';
              if (style.kind === 'letter') {
                setFont(u * 0.4 * grow);
                ctx.fillText(text, fcx + fcw * 0.2, fcy + fch * 0.46);
              } else if (style.kind === 'stack') {
                // Spaced so that tall glyphs such as ( and @ keep clear of the symbol under them; the tilde is drawn big, as
                // on the real cap, and the marks that sit high in their line (` ' _) are nudged to where the eye expects them.
                const [hi, lo] = printed.stack;
                setFont(Math.max(8, u * (hi === '~' ? 0.42 : 0.27) * grow));
                ctx.fillText(hi, lx, fcy + fch * (hi === '~' ? 0.26 : 0.2) + (hi === '_' ? -u * 0.06 : 0));
                setFont(Math.max(8.5, u * 0.31 * grow));
                ctx.fillText(lo, lx, fcy + fch * 0.78 + (lo === '`' || lo === "'" ? u * 0.07 : 0));
              } else if (style.kind === 'arrow') {
                A.drawLegendIcon(ctx, style.dir, fcx + fcw / 2, fcy + fch * 0.5, u * 0.4 * grow, ink);
              } else if (style.kind !== 'none') {
                const wp = Math.max(7, wordPx * grow);
                setFont(wp);
                const wy = fcy + fch * 0.5;
                let wx = lx;
                if (style.kind === 'tab') {
                  A.drawLegendIcon(ctx, 'tabL', lx, fcy + fch * 0.14, wp, ink);
                  A.drawLegendIcon(ctx, 'tabR', lx, fcy + fch * 0.86, wp, ink);
                } else if (style.kind !== 'word') {
                  wx = lx + A.drawLegendIcon(ctx, style.kind, lx, wy, wp, ink) + wp * (style.kind === 'back' ? 0.35 : 0.4);
                }
                if (style.italic) {
                  ctx.save();
                  ctx.translate(wx, wy);
                  ctx.transform(1, 0, -0.2, 1, 0, 0);
                  ctx.fillText(text, 0, 0);
                  ctx.restore();
                } else ctx.fillText(text, wx, wy);
              }
            } else {
              const centre = custom || printed.align === 'center';
              const room = fcw - u * (centre ? 0.08 : 0.1); // roomy enough that "5 %" and "2 @" keep the same size as "4 $"
              let px = fontPx * (1 + lift * 0.08);
              const tw = textWidth(text, px);
              if (tw > room) px = Math.max(8, (px * room) / tw);
              setFont(px);
              ctx.textAlign = centre ? 'center' : 'left';
              ctx.fillText(text, centre ? fcx + fcw / 2 : fcx + u * 0.05, fcy + fch * 0.5 - u * 0.01);
            }
          }
        }
        ctx.globalAlpha = 1;

        if (s.selection.has(k.led) || this.hover === k) {
          const sel = s.selection.has(k.led);
          ctx.lineWidth = sel ? 2 : 1;
          ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.45)';
          roundRect(ctx, x - 1, y - 1, kw + 2, kh + 2, u * 0.16);
          ctx.stroke();
        }
      }
      ctx.textAlign = 'center';

      // Spotlight under the pointer and the rings of any click ripples
      if (fx && !flat) {
        const sr = u * 4.2;
        if (hm.a > 0.01) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const sg = ctx.createRadialGradient(hm.x, hm.y, 0, hm.x, hm.y, sr);
          sg.addColorStop(0, `rgba(${tintRGB[0]},${tintRGB[1]},${tintRGB[2]},${0.2 * hm.a})`);
          sg.addColorStop(0.45, `rgba(${tintRGB[0]},${tintRGB[1]},${tintRGB[2]},${0.07 * hm.a})`);
          sg.addColorStop(1, `rgba(${tintRGB[0]},${tintRGB[1]},${tintRGB[2]},0)`);
          ctx.fillStyle = sg;
          ctx.fillRect(hm.x - sr, hm.y - sr, sr * 2, sr * 2);
          ctx.restore();
        }
        for (const r of this.ripples) {
          const age = (nowMs - r.at) / 1000;
          ctx.beginPath();
          ctx.arc(r.x, r.y, Math.max(1, age * u * 11), 0, TAU);
          ctx.lineWidth = 2;
          ctx.strokeStyle = `rgba(${tintRGB[0]},${tintRGB[1]},${tintRGB[2]},${0.65 * Math.exp(-age / 0.6)})`;
          ctx.stroke();
        }
      }
    }
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

  return { KeyboardView, keyColor, LEVELS, levelFor, clamp01, stillTime, hoverInfluence };
});
