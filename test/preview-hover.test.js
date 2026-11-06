'use strict';

/*
 * Pointer effects on the keyboard canvas: spotlight, key lift, lean, click ripples. Runs the real preview.js
 * against a fake canvas whose 2D context accepts every call, and a fake parent that records its listeners.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/js/preview.js');

function fakeCtx(log) {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...a) => void log.push([k, ...a]);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

function setup(opts = {}) {
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const handlers = {};
  const host = {
    addEventListener: (t, fn) => (handlers[t] = fn),
    removeEventListener: (t) => delete handlers[t],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }),
  };
  const log = [];
  const canvas = { getContext: () => fakeCtx(log), parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  const view = new V.KeyboardView(canvas, { animate: true, flat: false, ...opts });
  view.setState({ mode: 1, brightness: 4, palette: [], selection: new Set() });
  return { view, canvas, handlers, log };
}
const ptr = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerType: 'mouse', ...extra });
const frames = (view, n, ms = 16) => {
  for (let i = 0; i < n; i++) {
    view._lastFrame -= ms; // pretend ms passed between frames
    view.draw();
  }
};

test('hoverInfluence is 1 under the pointer, 0 at the radius and beyond, and falls off smoothly', () => {
  assert.equal(V.hoverInfluence(0, 100), 1);
  assert.equal(V.hoverInfluence(100, 100), 0);
  assert.equal(V.hoverInfluence(250, 100), 0);
  const a = V.hoverInfluence(30, 100);
  const b = V.hoverInfluence(60, 100);
  assert.ok(a > b && b > 0 && a < 1);
  assert.equal(V.hoverInfluence(5, 0), 0);
});

test('moving the pointer over the board fades the hover state in and leans the canvas', () => {
  const { view, canvas, handlers } = setup();
  view.draw();
  assert.equal(view.hm.a, 0);
  handlers.pointermove(ptr(700, 60));
  frames(view, 40);
  assert.ok(view.hm.a > 0.9, `presence ${view.hm.a}`);
  assert.match(canvas.style.transform, /rotateY\(-?\d/);
  assert.ok(Math.abs(view.hm.x - 700) < 20, 'smoothed pointer caught up');
  const rotY = parseFloat(/rotateY\((-?[\d.]+)deg\)/.exec(canvas.style.transform)[1]);
  assert.ok(rotY > 0, 'pointer on the right leans the right edge away');
});

test('leaving the board fades the effect out again', () => {
  const { view, handlers } = setup();
  handlers.pointermove(ptr(300, 150));
  frames(view, 40);
  assert.ok(view.hm.a > 0.9);
  handlers.pointerleave();
  frames(view, 120);
  assert.equal(view.hm.a, 0);
});

test('a click starts a ripple that dies out by itself', () => {
  const { view, handlers } = setup();
  handlers.pointerdown(ptr(400, 150));
  assert.equal(view.ripples.length, 1);
  view.ripples[0].at -= 2000; // two seconds ago
  view.draw();
  assert.equal(view.ripples.length, 0);
});

test('no ripples while keys are being edited, and none from a touch screen', () => {
  const { view, handlers } = setup({ interactive: false, enabled: () => true });
  handlers.pointerdown(ptr(400, 150));
  assert.equal(view.ripples.length, 0);
  const t = setup();
  t.handlers.pointerdown(ptr(400, 150, { pointerType: 'touch' }));
  t.handlers.pointermove(ptr(400, 150, { pointerType: 'touch' }));
  assert.equal(t.view.ripples.length, 0);
  assert.equal(t.view.hm.ta, 0);
});

test('key editing (flat) never tilts the canvas, so clicks land where they appear to', () => {
  const { view, canvas, handlers } = setup({ flat: true });
  handlers.pointermove(ptr(800, 40));
  frames(view, 40);
  assert.match(canvas.style.transform, /translateY\(0\.00px\) rotateX\(0\.000deg\) rotateY\(0\.000deg\)/);
});

test('with animation off (reduced motion) there is no tilt, no hover state and no ripple drawing', () => {
  const { view, canvas, handlers } = setup({ animate: false });
  handlers.pointermove(ptr(500, 100));
  handlers.pointerdown(ptr(500, 100));
  frames(view, 10);
  assert.equal(canvas.style.transform || '', '');
  assert.equal(view.ripples.length, 0);
});

test('hoverFx: false skips all of it', () => {
  const { handlers, canvas } = setup({ hoverFx: false });
  assert.equal(handlers.pointermove, undefined);
  assert.equal(canvas.style.transform || '', '');
});

test('destroy() unhooks the listeners and clears the lean', () => {
  const { view, canvas, handlers } = setup();
  handlers.pointermove(ptr(500, 100));
  frames(view, 10);
  assert.ok(canvas.style.transform);
  view.destroy();
  assert.equal(canvas.style.transform, '');
  assert.equal(handlers.pointermove, undefined);
});

// ------------------------------------------------------------------ smoothness
// The click ripple and the pointer glide used to step: the loop was fixed at ~30 fps, and every frame re-measured and
// re-fonted every key legend (about a third of all the work). These keep it smooth.

test('key legends are measured once, not on every frame', () => {
  const L = require('../src/js/layout.js');
  const { view } = setup();
  view._labelW.clear(); // setup() has already drawn once
  let measured = 0;
  view.ctx.measureText = () => {
    measured++;
    return { width: 10 };
  };
  for (let i = 0; i < 5; i++) view.draw();
  const afterFive = measured;
  const S = require('../src/js/skins.js');
  const printed = new Set(L.KEYS.map((k) => S.legendOf(k.n).text).filter(Boolean)); // what is on the caps (Space has no legend)
  assert.equal(afterFive, printed.size, 'one measurement per distinct legend');
  for (let i = 0; i < 20; i++) view.draw();
  assert.equal(measured, afterFive, 'no measuring on later frames');
});

test('legend sizes snap to 1/8 px so the browser can reuse its shaped text while a key grows under the pointer', () => {
  const { view, handlers } = setup();
  const sizes = new Set();
  Object.defineProperty(view.ctx, 'font', {
    set(v) {
      const m = /^(?:\d+ )?([\d.]+)px /.exec(v); // the legend font is semi-bold, so it starts with its weight
      if (m) sizes.add(Number(m[1]));
    },
    get: () => '',
  });
  handlers.pointermove(ptr(450, 150));
  frames(view, 60);
  assert.ok(sizes.size > 1, 'more than one size was used');
  for (const px of sizes) assert.equal(px * 8, Math.round(px * 8), `${px}px is a multiple of 1/8`);
  assert.ok(sizes.size < 40, `a small set of sizes (${sizes.size}), not one per frame`);
});

test('a click, or the pointer catching up, counts as gliding; a resting board does not', () => {
  const { view, handlers } = setup();
  assert.equal(view._gliding(), false, 'at rest');
  handlers.pointerdown(ptr(400, 150));
  assert.equal(view._gliding(), true, 'ripple running');
  view.ripples[0].at -= 2000;
  view.draw();
  assert.equal(view._gliding(), false, 'ripple gone');
  handlers.pointermove(ptr(500, 120));
  assert.equal(view._gliding(), true, 'pointer effect fading in');
  frames(view, 200);
  assert.equal(view._gliding(), false, 'pointer resting on the board');
  handlers.pointerleave();
  assert.equal(view._gliding(), true, 'pointer effect fading out');
  frames(view, 200);
  assert.equal(view._gliding(), false);
  assert.equal(setup({ animate: false }).view._gliding(), false, 'paused preview never glides');
  assert.equal(setup({ flat: true }).view._gliding(), false, 'key editing draws no pointer effects');
});

test('the loop draws every display frame while gliding, and ~30 fps otherwise', () => {
  const { view, handlers } = setup();
  const queue = [];
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => queue.push(fn);
  try {
    let draws = 0;
    view.draw = () => void draws++;
    const run = (frames60, t0) => {
      draws = 0;
      for (let i = 1; i <= frames60; i++) {
        const fns = queue.splice(0);
        for (const fn of fns) fn(t0 + i * (1000 / 60));
      }
      return draws;
    };
    view.start();
    const idle = run(60, 1000);
    assert.ok(idle >= 28 && idle <= 31, `resting: ${idle} draws in one second`);
    handlers.pointerdown(ptr(400, 150)); // ripple stays in view.ripples because draw() is stubbed
    const gliding = run(60, 3000);
    assert.ok(gliding >= 59, `gliding: ${gliding} draws in one second`);
    view.stop();
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});
