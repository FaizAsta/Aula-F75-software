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

// ------------------------------------------------------------------ the lean must not show the canvas's own edge
// The canvas leans toward the pointer, and a lean pulls its far edge in. A canvas exactly as big as the panel therefore
// showed a hard straight edge a little inside the panel's own (the pointer's glow stopped dead there, and the strip
// beside it looked darker), like a sheet of paper lying on the panel. The canvas now reaches past the panel by
// tiltBleed(); the panel clips it, so the panel's edge is the only one you see.

/**
 * Where CSS `perspective(d) translateY(t) rotateX(rx) rotateY(ry)` puts the point (x, y) of an element, by multiplying
 * the matrices out. Written independently of preview.js, which solves the same thing backwards.
 */
function project(x, y, { rx, ry, t }) {
  const mul = (a, b) => a.map((row) => [0, 1, 2, 3].map((j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)));
  const rad = Math.PI / 180;
  const [cx, sx, cy, sy] = [Math.cos(rx * rad), Math.sin(rx * rad), Math.cos(ry * rad), Math.sin(ry * rad)];
  const P = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, -1 / V.TILT_VIEW, 1]];
  const T = [[1, 0, 0, 0], [0, 1, 0, t], [0, 0, 1, 0], [0, 0, 0, 1]];
  const RX = [[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]];
  const RY = [[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]];
  const M = mul(mul(mul(P, T), RX), RY);
  const v = [x, y, 0, 1];
  const o = M.map((row) => row.reduce((sum, a, k) => sum + a * v[k], 0));
  return [o[0] / o[3], o[1] / o[3]];
}
/** Is the point inside the convex quadrilateral `q` (corners in order)? */
function inside(q, [px, py]) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
/** Every way the board can be leaning at its most: fully either way on both axes, at either end of the bob. */
function* extremes() {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const t of [-V.BOB_PX, V.BOB_PX]) yield { rx: sy * V.TILT_DEG.x, ry: sx * V.TILT_DEG.y, t };
}
/** Does a canvas that reaches (bx, by) past a w x h panel still cover the whole panel when leaning like `lean`? */
function covers(w, h, bx, by, lean) {
  const [hw, hh] = [w / 2 + bx, h / 2 + by];
  const quad = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => project(x, y, lean));
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].every((c) => inside(quad, c));
}

test('a canvas as big as the panel does show its edge when it leans (the bug), and tiltBleed is enough to hide it', () => {
  for (const [w, h] of [[300, 120], [756, 204], [1056, 258], [1456, 306], [1876, 340], [2560, 420]]) {
    const bare = [...extremes()].some((lean) => !covers(w, h, 0, 0, lean));
    assert.ok(bare, `${w}x${h}: with no bleed some lean leaves the panel's edge uncovered`);
    const { x, y } = V.tiltBleed(w, h);
    for (const lean of extremes()) assert.ok(covers(w, h, x, y, lean), `${w}x${h} with bleed ${x},${y} under ${JSON.stringify(lean)}`);
  }
});

test('the bleed is a few pixels, grows with the panel, and is not wasteful', () => {
  const small = V.tiltBleed(756, 204);
  const big = V.tiltBleed(1876, 340);
  assert.ok(big.x > small.x, 'a wider panel is pulled in further');
  assert.ok(small.x >= 3 && small.y >= 3, 'never nothing');
  const { x, y } = V.tiltBleed(1056, 258);
  assert.ok(x <= 1056 * 0.06 && y <= 258 * 0.06, `${x},${y} stays under 6% of the panel`);
  // And it is not much more than needed: one pixel less on either side would leave an edge showing somewhere.
  assert.ok([...extremes()].some((lean) => !covers(1056, 258, x - 6, y, lean) || !covers(1056, 258, x, y - 6, lean)), 'tight');
});

test('the canvas is bigger than the panel by the bleed, moved back by it, and drawn from the panel corner', () => {
  const { view, canvas, log } = setup();
  const { x, y } = V.tiltBleed(900, 320);
  assert.deepEqual([view.layout.bx, view.layout.by], [x, y]);
  assert.equal(canvas.style.width, `${900 + x * 2}px`);
  assert.equal(canvas.style.height, `${320 + y * 2}px`);
  assert.equal(canvas.style.margin, `${-y}px 0 0 ${-x}px`);
  assert.equal(canvas.width, 900 + x * 2);
  assert.equal(canvas.height, 320 + y * 2);
  log.length = 0;
  view.draw();
  assert.deepEqual(log.find((c) => c[0] === 'setTransform'), ['setTransform', 1, 0, 0, 1, x, y], 'the origin sits on the panel corner');
  assert.deepEqual(log.find((c) => c[0] === 'clearRect'), ['clearRect', -x, -y, 900 + x * 2, 320 + y * 2], 'the whole canvas is cleared');
});

test('pointing still lands on the right key with the canvas reaching past the panel', () => {
  const L = require('../src/js/layout.js');
  const handlers = {};
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 22, top: 58, width: 900, height: 320 }) };
  const bleed = V.tiltBleed(900, 320);
  const canvas = {
    getContext: () => fakeCtx([]),
    parentElement: host,
    style: {},
    width: 0,
    height: 0,
    addEventListener: (t, fn) => (handlers[t] = fn),
    setPointerCapture() {},
    // The canvas starts `bleed` before the panel's corner, which is at (22, 58) on the page.
    getBoundingClientRect: () => ({ left: 22 - bleed.x, top: 58 - bleed.y, width: 900 + bleed.x * 2, height: 320 + bleed.y * 2 }),
  };
  const picked = [];
  const view = new V.KeyboardView(canvas, { animate: false, flat: true, interactive: true, onPick: (k, e, phase) => phase === 'down' && picked.push(k) });
  const { u, ox, oy } = view.layout;
  for (const k of [L.KEYS[0], L.KEYS[20], L.KEYS[L.KEYS.length - 1]]) {
    picked.length = 0;
    handlers.pointerdown({ clientX: 22 + ox + (k.x + k.w / 2) * u, clientY: 58 + oy + (k.y + 0.5) * u, pointerId: 1 });
    assert.equal(picked.length, 1, `a key under the pointer for ${k.n}`);
    assert.equal(picked[0].led, k.led, `the key that was pointed at (${k.n})`);
  }
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

// ------------------------------------------------------------------------------------------------------------------
// The loop is stopped (window hidden / minimized and a late "shown" message, a Max on screen...) but the board is
// clicked: the ripple used to be drawn once and then stay frozen on the board, one more ring for every click.

function fakeRaf() {
  const queue = [];
  const real = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, now: performance.now };
  let clock = real.now.call(performance);
  performance.now = () => clock; // draw() judges a ripple's age by this, so the test must own it (a slow machine must not matter)
  let next = 1;
  const live = new Map();
  globalThis.requestAnimationFrame = (fn) => {
    const id = next++;
    live.set(id, fn);
    queue.push(id);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => void live.delete(id);
  return {
    pending: () => live.size,
    /** The clock now, and a way to move it. */
    now: () => clock,
    /** One display refresh, `ms` after the last one. */
    tick(ms = 1000 / 60) {
      clock += ms;
      const ts = clock;
      const ids = queue.splice(0);
      for (const id of ids) {
        const fn = live.get(id);
        live.delete(id);
        if (fn) fn(ts);
      }
    },
    restore() {
      performance.now = real.now;
      globalThis.requestAnimationFrame = real.raf;
      globalThis.cancelAnimationFrame = real.caf || (() => {});
    },
  };
}

test('a click on a board whose loop is stopped still animates the ripple, and the frames end by themselves', () => {
  const { view, handlers } = setup();
  const raf = fakeRaf();
  try {
    assert.equal(view.running, false, 'the loop is stopped');
    let draws = 0;
    const realDraw = view.draw.bind(view);
    view.draw = () => {
      draws++;
      realDraw();
    };
    handlers.pointerdown(ptr(400, 150));
    assert.ok(draws >= 1, 'answers the click at once');
    assert.equal(view.ripples.length, 1);

    // One second of display frames at 60 Hz: the ripple is still travelling, and every refresh draws it.
    draws = 0;
    for (let i = 0; i < 60; i++) raf.tick();
    assert.ok(draws >= 59, `the ripple kept being drawn while it travelled (${draws} draws)`);
    assert.equal(view.ripples.length, 1, 'still in flight after a second');

    // Past the ripple's life (1.5 s): it is dropped, and nothing keeps drawing.
    for (let i = 0; i < 60; i++) raf.tick();
    assert.equal(view.ripples.length, 0, 'the faded ripple is gone, not stuck');
    assert.equal(raf.pending(), 0, 'the frames stop once nothing moves');
    assert.equal(view.running, false, 'it never pretends to be the main loop');
  } finally {
    raf.restore();
  }
});

test('clicking again and again while stopped does not stack up loops', () => {
  const { view, handlers } = setup();
  const raf = fakeRaf();
  try {
    for (let i = 0; i < 10; i++) handlers.pointerdown(ptr(100 + i * 50, 150));
    assert.equal(raf.pending(), 1, 'one kick loop, however many clicks');
    assert.ok(view.ripples.length <= 6, 'ripples stay capped');
  } finally {
    view.stop();
    raf.restore();
  }
});

test('the kick loop steps aside when the real loop starts, and stop() cancels it', () => {
  const { view, handlers } = setup();
  const raf = fakeRaf();
  try {
    handlers.pointerdown(ptr(400, 150));
    assert.equal(raf.pending(), 1);
    view.start(); // the page restarts the loop (window shown again)
    raf.tick(); // kick frame notices the real loop and ends; the main loop's frame runs
    raf.tick();
    assert.equal(view.running, true);
    assert.equal(raf.pending(), 1, 'only the main loop is left');
    view.stop();
    assert.equal(raf.pending(), 0, 'stop() leaves no frame behind');

    handlers.pointerdown(ptr(300, 150)); // a kick, then a stop
    view.stop();
    assert.equal(raf.pending(), 0);
  } finally {
    raf.restore();
  }
});

test('no kick loop when animation is off or hover effects are off (Picture, reduced motion)', () => {
  for (const patch of [{ animate: false }, { hoverFx: false }]) {
    const { view, handlers } = setup(patch);
    const raf = fakeRaf();
    try {
      // handlers may not even be bound with hoverFx false; call the kick directly as well
      if (handlers.pointerdown) handlers.pointerdown(ptr(400, 150));
      view._kick();
      assert.equal(raf.pending(), 0, JSON.stringify(patch));
      assert.equal(view.ripples.length, 0);
    } finally {
      raf.restore();
    }
  }
});
