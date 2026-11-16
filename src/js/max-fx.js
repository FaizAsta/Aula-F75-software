/*
 * AULA F75 Max: the little animated keyboard on each lighting-effect card (the F75 screen has the same on its cards).
 *
 * The Max's 20 effects live in the keyboard's firmware (max.js, EFFECTS) and the app cannot read them back, so these are
 * drawings of what each effect is called and does, not captures of the real thing: the keyboard may differ in the details
 * (timing, how far a ripple spreads). They only ever show a card; nothing here is sent to the keyboard.
 *
 * `keyColor(mode, key, t, st)` is the colour of one key at time `t` (seconds); `draw(canvas, mode, t, st)` paints the whole
 * mini keyboard. `st` is { rgb, colorful, direction (0 Right, 1 Down, 2 Left, 3 Up), speed (1..5) }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./max.js'));
  else root.AulaMaxFx = factory(root.AulaMax);
})(typeof self !== 'undefined' ? self : globalThis, function (MX) {
  'use strict';

  const OFF = [34, 38, 48];
  const TAU = Math.PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const frac = (v) => v - Math.floor(v);
  /** A repeatable "random" number in 0..1 from two integers (so a card looks the same every time it is drawn). */
  const rnd = (a, b = 0) => frac(Math.sin(a * 127.1 + b * 311.7 + 7.13) * 43758.5453);

  function hsv(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }
  const scale = (c, f) => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];

  // The board's size in key units, and what a key's neighbourhood looks like, from the Max's own layout.
  const KEYS = MX.keyLayout();
  const W = Math.max(...KEYS.map((k) => k.x + k.w));
  const H = Math.max(...KEYS.map((k) => k.y + k.h));

  /** Where a key sits across the board in the direction the effect runs (0 at the start, 1 at the end). */
  function along(k, dir) {
    const nx = (k.x + k.w / 2) / W;
    const ny = (k.y + 0.5) / H;
    return dir === 1 ? ny : dir === 2 ? 1 - nx : dir === 3 ? 1 - ny : nx;
  }
  /** The other way: across the direction of travel. */
  function across(k, dir) {
    const nx = (k.x + k.w / 2) / W;
    const ny = (k.y + 0.5) / H;
    return dir === 1 || dir === 3 ? nx : ny;
  }
  const centre = (k) => ({ x: k.x + k.w / 2, y: k.y + 0.5 });

  /** Pretend key presses for the reactive effects: `streams` typists, each hitting a new key every `period` seconds. */
  function presses(t, period, life, streams) {
    const out = [];
    for (let s = 0; s < streams; s++) {
      const n = Math.floor(t / period + s * 0.37);
      for (let back = 0; back < 3; back++) {
        const i = n - back;
        const age = t - (i - s * 0.37) * period;
        if (age < 0 || age > life) continue;
        const key = KEYS[Math.floor(rnd(i, s + 1) * KEYS.length)];
        out.push({ key, age, id: i * 7 + s });
      }
    }
    return out;
  }

  /** Light of one colour at strength `v` (0..1); with rainbow colours on, the hue is `hue` degrees. */
  function paint(st, v, hue) {
    if (v <= 0) return null;
    return st.colorful ? hsv(((hue % 360) + 360) % 360, 1, clamp01(v)) : scale(st.rgb, clamp01(v));
  }

  /** The firmware effects, by mode number. Each returns [r, g, b] or null (key dark). */
  const FX = {
    0: () => null,
    1: (k, t, st) => paint(st, 1, (k.x / W) * 300),
    2: (k, t, st) => reactive(k, t, st, 0.5, 0.9, 2),
    3: (k, t, st) => reactive(k, t, st, 0.4, 1.7, 3),
    4: (k, t, st) => {
      const i = k.led;
      const v = Math.pow(Math.max(0, Math.sin(t * (1.4 + st.speed * 0.45) + rnd(i, 3) * TAU)), 7);
      return paint(st, v, rnd(i, 9) * 360);
    },
    5: (k, t, st) => {
      const lane = st.direction % 2 === 0 ? k.y : Math.floor(k.x);
      const head = frac(t * (0.12 + st.speed * 0.08) + rnd(lane, 5)) * 1.6 - 0.25;
      const d = head - along(k, st.direction);
      return d >= 0 && d < 0.38 ? paint(st, 1 - d / 0.38, 200 + lane * 17) : null;
    },
    6: (k, t, st) => hueKey(k, t),
    7: (k, t, st) => paint(st, 0.08 + 0.92 * (0.5 + 0.5 * Math.sin(t * (0.9 + st.speed * 0.5) - 1.6)), t * 30),
    8: (k, t, st) => hsv((t * (14 + st.speed * 12)) % 360, 1, 1),
    9: (k, t, st) => {
      const c = centre(k);
      const d = Math.hypot((c.x - W / 2) / 1.6, c.y - H / 2);
      return paint(st, 0.5 + 0.5 * Math.sin(d * 2.3 - t * (1.2 + st.speed * 0.7)), d * 40 + t * 30);
    },
    10: (k, t, st) => {
      const ph = along(k, st.direction) * 7 + across(k, st.direction) * 1.2 - t * (0.9 + st.speed * 0.5);
      return paint(st, 0.12 + 0.88 * (0.5 + 0.5 * Math.sin(ph)), ph * 40);
    },
    11: (k, t, st) => {
      const h = along(k, st.direction) * 360 - t * (30 + st.speed * 30);
      if (st.colorful) return hsv(((h % 360) + 360) % 360, 1, 1);
      return paint(st, 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((h * TAU) / 360)), 0);
    },
    12: (k, t, st) => {
      const c = centre(k);
      const a = Math.atan2((c.y - H / 2) * 1.8, c.x - W / 2) / TAU + 0.5;
      const d = frac(a - t * (0.12 + st.speed * 0.07));
      return paint(st, d < 0.4 ? 1 - d / 0.4 : 0, a * 360);
    },
    13: (k, t, st) => ring(k, t, st, 0.5, 1.2, 4 + st.speed * 1.6, 1.3),
    14: (k, t, st) => {
      let best = null;
      for (const p of presses(t, 0.55, 1.1, 3)) {
        const kc = centre(p.key);
        const c = centre(k);
        if (Math.abs(c.x - kc.x) > 0.7) continue;
        const head = kc.y - p.age * (4 + st.speed * 2.2);
        const d = c.y - head; // the trail behind the head, below it
        if (d >= -0.5 && d < 2.6 && c.y <= kc.y + 0.1) {
          const col = paint(st, (1 - d / 2.8) * (1 - p.age / 1.4), p.id * 53);
          if (col) best = brighter(best, col);
        }
      }
      return best;
    },
    15: (k, t, st) => ring(k, t, st, 0.8, 1.9, 2.6 + st.speed * 0.9, 0.85),
    16: (k, t, st) => {
      const a = along(k, st.direction);
      const ph = a * 9 - t * (1 + st.speed * 0.55) + Math.sin(across(k, st.direction) * 4 + t * 0.7) * 1.3;
      return paint(st, 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(ph)), ph * 35 + 180);
    },
    17: (k, t, st) => {
      const c = centre(k);
      const d = Math.hypot((c.x - W / 2) / 1.8, c.y - H / 2);
      const v = Math.pow(Math.max(0, Math.sin(t * (1.3 + st.speed * 0.6) - d * 0.9)), 3);
      return paint(st, v, t * 60 + d * 20);
    },
    18: (k, t, st) => {
      const s = along(k, st.direction) + (across(k, st.direction) - 0.5) * 0.5;
      const d = frac(s - t * (0.1 + st.speed * 0.07));
      return paint(st, d < 0.22 ? 1 - d / 0.22 : 0, s * 300);
    },
    19: (k, t, st) => {
      const pos = 0.5 + 0.5 * Math.sin(t * (0.5 + st.speed * 0.35));
      const d = Math.abs(along(k, st.direction) - pos);
      return paint(st, d < 0.16 ? 1 - d / 0.16 : 0, pos * 300);
    },
  };

  const brighter = (a, b) => (!a || b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a);

  function hueKey(k, t) {
    return hsv((k.x * 22 + k.y * 47 + t * 20) % 360, 1, 1);
  }

  /** Reactive and Reactive fade: only the keys that were just pressed are lit, and they fade away. */
  function reactive(k, t, st, period, life, streams) {
    for (const p of presses(t, period, life, streams)) {
      if (p.key.led !== k.led) continue;
      const v = Math.pow(1 - p.age / life, 1.4);
      return paint(st, v, p.id * 53);
    }
    return null;
  }

  /** Explode and Ripple: a press sends a ring of light out across the board. */
  function ring(k, t, st, period, life, speed, width) {
    let best = null;
    const c = centre(k);
    for (const p of presses(t, period, life, 2)) {
      const kc = centre(p.key);
      const d = Math.hypot((c.x - kc.x) / 1.15, c.y - kc.y);
      const edge = Math.abs(d - p.age * speed);
      if (edge < width) {
        const col = paint(st, (1 - edge / width) * (1 - p.age / life), p.id * 53 + d * 15);
        if (col) best = brighter(best, col);
      }
    }
    return best;
  }

  /** A moment in each effect that shows what it does, for a card that is not playing. */
  const STILL = { 2: 0.18, 3: 0.2, 4: 0.9, 5: 0.5, 9: 0.5, 10: 0.7, 12: 0.9, 13: 0.55, 14: 0.4, 15: 0.5, 17: 0.9, 18: 0.6, 19: 1.1 };
  const stillTime = (mode) => (STILL[mode] !== undefined ? STILL[mode] : 0.8);

  const DEFAULT_ST = { rgb: [0x6e, 0x7b, 0xff], colorful: false, direction: 0, speed: 3 };
  const withDefaults = (st) => ({ ...DEFAULT_ST, ...(st || {}) });

  /** The colour of one key at time t (seconds). Always an [r, g, b]; a key the effect leaves dark is a dim grey. */
  function keyColor(mode, key, t, st) {
    const fx = FX[mode];
    const c = fx ? fx(key, t, withDefaults(st)) : null;
    return c || OFF;
  }

  function draw(canvas, mode, t, st) {
    const tt = t === undefined ? stillTime(mode) : t;
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const pad = 7;
    const sx = (w - pad * 2) / W;
    const sy = (h - pad * 2) / H;
    const s = withDefaults(st);
    for (const k of KEYS) {
      const col = keyColor(mode, k, tt, s);
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.fillRect(pad + k.x * sx + 0.8, pad + k.y * sy + 0.8, k.w * sx - 1.6, sy - 1.6);
    }
  }

  return { keyColor, draw, stillTime, WIDTH: W, HEIGHT: H };
});
