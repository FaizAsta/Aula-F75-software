'use strict';

/*
 * The F75 HE / F75 Max picture moves like the F75's preview (max-motion.js): it leans toward the pointer and drifts, keys rise near
 * the pointer, a click sends a ripple, a key you press sinks, and the lights sweep on. The pure parts are checked against the F75
 * preview's own (so the two cannot drift apart), and the engine is run against a fake page with a clock the test controls.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/js/max-motion.js');
const V = require('../src/js/preview.js');
const HE = require('../src/js/he.js');
const MX = require('../src/js/max.js');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// ------------------------------------------------------------------ the same numbers as the F75 preview

test('the lean, drift and pointer reach are the F75 preview\'s own', () => {
  assert.deepEqual(M.TILT_DEG, V.TILT_DEG);
  assert.equal(M.TILT_VIEW, V.TILT_VIEW);
  assert.equal(M.BOB_PX, V.BOB_PX);
  for (const [d, r] of [[0, 100], [30, 100], [60, 100], [100, 100], [250, 100]]) assert.equal(M.influence(d, r), V.hoverInfluence(d, r));
  assert.match(read('src', 'js', 'preview.js'), new RegExp(`RIPPLE_LIFE = ${M.RIPPLE_LIFE};`), 'a ripple lasts as long as on the F75');
});

test('the lights-on sweep follows the F75 preview\'s timing, slow and quick', () => {
  // The F75 preview reads the clock itself, and a fresh test process has run for only a moment (its "started a second ago" would be before 0).
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Object.defineProperty(globalThis, 'performance', { value: { now: () => 100000 }, configurable: true, writable: true });
  try {
    for (const fast of [false, true]) {
      for (const e of [0, 0.2, 0.5, 0.9, 1.15, 1.3, 2.3, 2.5]) {
        for (const nx of [0, 0.3, 0.7, 1]) {
          const fake = { introAt: 100000 - e * 1000, introFast: fast, opts: { animate: true } };
          const theirs = V.KeyboardView.prototype._introFactor.call(fake, nx);
          assert.ok(Math.abs(M.introFactor(e, nx, fast) - theirs) < 0.002, `fast ${fast}, ${e}s, ${nx}: ${M.introFactor(e, nx, fast)} vs ${theirs}`);
        }
      }
    }
  } finally {
    Object.defineProperty(globalThis, 'performance', real);
  }
  assert.equal(M.introFactor(0, 0.5, false), 0, 'the slow sweep starts dark');
  assert.equal(M.introFactor(0, 0.5, true), 0.35, 'the quick one keeps a floor, so an effect change never blanks the board');
  assert.equal(M.introFactor(3, 0.5, false), 1);
});

// ------------------------------------------------------------------ the pure parts

test('the board drifts gently and settles when the pointer is on it', () => {
  let hi = -9;
  let lo = 9;
  for (let ms = 0; ms < 20000; ms += 50) {
    hi = Math.max(hi, M.bobOf(ms));
    lo = Math.min(lo, M.bobOf(ms));
  }
  assert.ok(hi > 1.5 && hi <= M.BOB_PX && lo < -1.5 && lo >= -M.BOB_PX, `${lo}..${hi}`);
  for (const ms of [1000, 3000, 5000]) assert.ok(Math.abs(M.bobOf(ms, 1)) < Math.abs(M.bobOf(ms, 0)) + 1e-9);
});

test('the lean is toward the pointer: right of centre turns the right edge away, below centre tips the bottom edge away', () => {
  const r = M.leanOf(1, 0, 1);
  assert.ok(r.ry > 0 && Math.abs(r.rx) < 1e-9);
  const d = M.leanOf(0, 1, 1);
  assert.ok(d.rx < 0);
  assert.deepEqual(M.leanOf(1, 1, 0), { rx: -0, ry: 0 }, 'no pointer, no lean');
});

test('a key is lifted most under the pointer and not at all far from it; a ripple lifts the keys its ring passes', () => {
  const u = 40;
  const hm = { x: 100, y: 100, a: 1 };
  assert.equal(M.touchOf(100, 100, hm, u, [], 0), 1);
  assert.ok(M.touchOf(150, 100, hm, u, [], 0) < 1);
  assert.equal(M.touchOf(100 + u * 3, 100, hm, u, [], 0), 0);
  assert.equal(M.touchOf(100, 100, { ...hm, a: 0 }, u, [], 0), 0, 'no pointer, no lift');
  const r = [{ x: 0, y: 0, at: 0 }];
  const ring = u * 11 * 0.2; // where the ring is 0.2 s after the click
  assert.ok(M.touchOf(ring, 0, null, u, r, 200) > 0.5, 'on the ring');
  assert.ok(M.touchOf(ring + u * 6, 0, null, u, r, 200) < 0.01, 'well past the ring');
  assert.ok(M.touchOf(0, 0, { x: 0, y: 0, a: 1 }, u, [r[0], r[0], r[0]], 100) <= 1.4, 'never more than 1.4');
});

test('a pressed key sinks quickly and its light fades more slowly', () => {
  assert.equal(M.pressDepth(0), 1);
  assert.ok(M.pressDepth(0.16) < 0.4 && M.pressDepth(1) < 0.01);
  assert.ok(M.pressGlow(0.16) > M.pressDepth(0.16), 'the glow outlasts the dip');
});

test('your own keys map to the keys of both boards', () => {
  const he = new Set(HE.keyLayout().map((k) => k.name));
  const mx = new Set(MX.keyLayout().map((k) => k.name));
  const codes = ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F12', 'Escape', 'Backquote', 'Minus', 'Equal', 'Backspace', 'Tab', 'CapsLock', 'Enter', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'MetaLeft', 'AltLeft', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'PageUp', 'PageDown', 'End', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash'];
  for (const c of codes) {
    const n = M.codeToName(c);
    assert.ok(n, `${c} has a name`);
    assert.ok(he.has(n) && mx.has(n), `${c} -> ${n} is a key of both boards`);
  }
  assert.equal(M.codeToName('ControlRight'), 'ctrlright');
  assert.ok(mx.has(M.codeToName('AltRight')), 'the Max has a right Alt');
  assert.equal(M.codeToName('F13'), null);
  assert.equal(M.codeToName('NumpadEnter'), null);
  assert.equal(M.codeToName(undefined), null);
});

// ------------------------------------------------------------------ the engine, on a fake page

function setup({ enabled = true, pointerFx = true, typing = true } = {}) {
  const real = { perf: Object.getOwnPropertyDescriptor(globalThis, 'performance'), raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, doc: globalThis.document };
  let now = 5000;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
  const queue = [];
  let ids = 0;
  globalThis.requestAnimationFrame = (cb) => {
    queue.push([++ids, cb]);
    return ids;
  };
  globalThis.cancelAnimationFrame = (id) => {
    const i = queue.findIndex((q) => q[0] === id);
    if (i >= 0) queue.splice(i, 1);
  };
  globalThis.document = { hidden: false };

  const flags = { enabled, pointerFx, typing };
  const repaints = [];
  const winL = {};
  const win = { devicePixelRatio: 1, addEventListener: (t, f) => (winL[t] = f), removeEventListener: (t) => delete winL[t] };
  const cvs = [];
  const doc = {
    defaultView: win,
    createElement: () => {
      const c = { style: {}, className: '', width: 0, height: 0, removed: false, setAttribute() {}, getContext: () => null, remove() { c.removed = true; } };
      cvs.push(c);
      return c;
    },
  };
  const hostL = {};
  const host = { ownerDocument: doc, dataset: {}, addEventListener: (t, f) => (hostL[t] = f), removeEventListener: (t) => delete hostL[t], getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const board = { style: {}, offsetLeft: 0, offsetTop: 0, offsetWidth: 640, offsetHeight: 256 };
  const grid = { ownerDocument: doc, clientWidth: 640, clientHeight: 256, offsetLeft: 0, offsetTop: 0, children: [], append(c) { this.children.push(c); } };
  // 16 key units across, 40 px each
  const layout = [
    { name: 'esc', led: 0, x: 0, y: 0, w: 1 },
    { name: 'g', led: 53, x: 5, y: 3, w: 1 },
    { name: 'space', led: 83, x: 4, y: 5, w: 6 },
    { name: 'p', led: 42, x: 15, y: 0, w: 1 },
  ];
  const keys = new Map(layout.map((k) => [k.led, { style: {}, dataset: {} }]));
  const fx = M.create({
    host, board, grid, keys, layout, gridW: 16,
    enabled: () => flags.enabled,
    pointerFx: () => flags.pointerFx,
    typing: () => flags.typing,
    tint: () => [255, 0, 0],
    repaint: () => repaints.push(now),
  });
  const run = (ms) => {
    for (let t = 0; t < ms; t += 16) {
      now += 16;
      for (const [, cb] of queue.splice(0)) cb(now);
    }
  };
  const done = () => {
    fx.destroy();
    if (real.perf) Object.defineProperty(globalThis, 'performance', real.perf);
    globalThis.requestAnimationFrame = real.raf;
    globalThis.cancelAnimationFrame = real.caf;
    if (real.doc === undefined) delete globalThis.document;
    else globalThis.document = real.doc;
  };
  const ptr = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerType: 'mouse', ...extra });
  const key = (code, extra = {}) => winL.keydown({ code, target: { tagName: 'BODY' }, ...extra });
  return { fx, host, board, keys, hostL, winL, run, done, ptr, key, flags, repaints, cvs, grid, layout, now: () => now };
}
const ty = (el) => {
  const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform || '');
  return m ? parseFloat(m[1]) : 0;
};

test('hovering leans the board toward the pointer and lifts the keys near it, not the ones far away', () => {
  const t = setup();
  try {
    t.hostL.pointermove(t.ptr(220, 140)); // the middle of the G key
    t.run(700);
    assert.equal(t.host.dataset.fx, '1', 'the stage says its motion is running');
    assert.match(t.board.style.transform, /perspective\(1000px\) translateY\(-?[\d.]+px\) rotateX\(-?[\d.]+deg\) rotateY\(-?[\d.]+deg\)/);
    const g = t.keys.get(53);
    assert.ok(ty(g) < -1.5, `G rises: ${g.style.transform}`);
    assert.match(g.style.transform, /scale\(1\.0\d+\)/, 'and grows a little');
    assert.equal(t.keys.get(42).style.transform || '', '', 'P, a long way off, stays down');
    assert.equal(t.keys.get(0).style.transform || '', '', 'so does Esc');
    const y1 = parseFloat(/rotateY\((-?[\d.]+)deg\)/.exec(t.board.style.transform)[1]);
    t.hostL.pointermove(t.ptr(600, 140));
    t.run(700);
    const y2 = parseFloat(/rotateY\((-?[\d.]+)deg\)/.exec(t.board.style.transform)[1]);
    assert.ok(y2 > y1, `the lean follows the pointer to the right: ${y1} -> ${y2}`);
  } finally {
    t.done();
  }
});

test('leaving puts the keys back and squares the board', () => {
  const t = setup();
  try {
    t.hostL.pointermove(t.ptr(220, 140));
    t.run(700);
    assert.ok(t.keys.get(53).style.transform);
    t.hostL.pointerleave();
    t.run(2500);
    assert.equal(t.keys.get(53).style.transform || '', '', 'G is back down exactly (no leftover offset)');
    assert.ok(!/rotate|perspective/.test(t.board.style.transform), `no lean left: ${t.board.style.transform}`);
  } finally {
    t.done();
  }
});

test('with nothing touching it the board only drifts, in whole pixels', () => {
  const t = setup();
  try {
    const seen = new Set();
    t.fx.sync();
    for (let i = 0; i < 400; i++) {
      t.run(48);
      seen.add(t.board.style.transform || '');
    }
    assert.ok(seen.size >= 2, 'it moves');
    for (const tf of seen) assert.ok(tf === '' || /^translateY\(-?\d+(\.\d+)?px\)$/.test(tf), `only a drift: ${tf}`);
    for (const tf of seen) {
      const v = ty({ style: { transform: tf } });
      assert.ok(Math.abs(v) <= Math.ceil(M.BOB_PX), `${v}: no further than the F75's drift, rounded to a whole pixel`);
    }
  } finally {
    t.done();
  }
});

test('on the Per-key page (pointer effects off) the board stays square and nothing lifts or ripples', () => {
  const t = setup({ pointerFx: false });
  try {
    t.hostL.pointermove(t.ptr(220, 140));
    t.hostL.pointerdown(t.ptr(220, 140));
    t.run(700);
    assert.ok(!/rotate|perspective/.test(t.board.style.transform || ''), `square: ${t.board.style.transform}`);
    assert.equal(t.board.style.transform || '', '', 'not even the drift: a click lands where it appears to');
    assert.equal(t.keys.get(53).style.transform || '', '');
    assert.equal(t.fx.state().ripples, 0);
  } finally {
    t.done();
  }
});

test('a touch screen does nothing, and neither does a window that may not animate', () => {
  const t = setup();
  try {
    t.hostL.pointermove(t.ptr(220, 140, { pointerType: 'touch' }));
    t.hostL.pointerdown(t.ptr(220, 140, { pointerType: 'touch' }));
    assert.equal(t.fx.state().hm.ta, 0);
    assert.equal(t.fx.state().ripples, 0);
  } finally {
    t.done();
  }
  const off = setup({ enabled: false });
  try {
    off.hostL.pointermove(off.ptr(220, 140));
    off.hostL.pointerdown(off.ptr(220, 140));
    off.key('KeyG');
    off.fx.intro(true);
    off.run(500);
    assert.equal(off.fx.state().on, false);
    assert.equal(off.fx.state().ripples, 0);
    assert.equal(off.fx.state().presses, 0);
    assert.equal(off.fx.lightFactor(53), 1, 'no sweep');
    assert.equal(off.board.style.transform || '', '');
    assert.equal(off.host.dataset.fx, undefined);
  } finally {
    off.done();
  }
});

test('when animation stops (Picture, animations off) everything goes back to rest at once', () => {
  const t = setup();
  try {
    t.hostL.pointermove(t.ptr(220, 140));
    t.hostL.pointerdown(t.ptr(220, 140));
    t.key('KeyG');
    t.run(300);
    assert.ok(t.board.style.transform && t.keys.get(53).style.transform);
    t.flags.enabled = false;
    t.fx.sync();
    assert.equal(t.board.style.transform, '');
    for (const k of t.keys.values()) assert.equal(k.style.transform || '', '');
    assert.equal(t.host.dataset.fx, undefined);
    assert.equal(t.fx.state().ripples, 0);
    assert.ok(t.repaints.length > 0, 'the light is repainted at full strength');
    t.run(500);
    assert.equal(t.board.style.transform, '', 'and stays there');
  } finally {
    t.done();
  }
});

test('a click sends a ripple that lifts keys as it passes and dies out by itself', () => {
  const t = setup();
  try {
    t.hostL.pointerdown(t.ptr(220, 140));
    assert.equal(t.fx.state().ripples, 1);
    t.run(200);
    t.run(600);
    assert.ok(t.fx.state().ripples === 1);
    t.run(1500);
    assert.equal(t.fx.state().ripples, 0, 'gone after 1.5 s');
    for (let i = 0; i < 9; i++) t.hostL.pointerdown(t.ptr(100 + i * 10, 100));
    assert.ok(t.fx.state().ripples <= 6, 'at most six at once');
  } finally {
    t.done();
  }
});

test('a key you press sinks, springs back, and lights for the Reactive effects', () => {
  const t = setup();
  try {
    t.key('KeyG');
    assert.equal(t.fx.state().presses, 1);
    assert.ok(t.fx.glow(53) > 0.9, 'lit at the press');
    t.run(48);
    const g = t.keys.get(53);
    assert.ok(ty(g) > 0.5, `G sinks: ${g.style.transform}`);
    assert.match(g.style.transform, /scale\(0\.9\d+\)/, 'and shrinks a little');
    assert.equal(t.keys.get(83).style.transform || '', '', 'space did not move');
    t.run(1000);
    assert.equal(g.style.transform || '', '', 'sprung back');
    assert.ok(t.fx.glow(53) > 0.05 && t.fx.glow(53) < 0.3, `the glow is still fading: ${t.fx.glow(53)}`);
    t.run(1500);
    assert.equal(t.fx.glow(53), 0, 'and is gone');
    assert.equal(t.fx.state().presses, 0);
  } finally {
    t.done();
  }
});

test('typing in a box, a shortcut, a key the board lacks, or a page that is not Lighting moves nothing', () => {
  const t = setup();
  try {
    t.key('KeyG', { target: { tagName: 'INPUT' } });
    t.key('KeyG', { target: { tagName: 'TEXTAREA' } });
    t.key('KeyG', { ctrlKey: true });
    t.key('KeyG', { metaKey: true });
    t.key('F13');
    t.key('Numpad5');
    assert.equal(t.fx.state().presses, 0);
    t.flags.typing = false;
    t.key('KeyG');
    assert.equal(t.fx.state().presses, 0, 'only the Lighting page shows a pressed key');
    t.flags.typing = true;
    t.key('KeyG');
    assert.equal(t.fx.state().presses, 1);
  } finally {
    t.done();
  }
});

test('the lights sweep on: dark and low at the start, whole again at the end, with every key put back exactly', () => {
  const t = setup();
  try {
    t.fx.intro(false);
    assert.equal(t.fx.lightFactor(53), 0, 'already dark before the first frame, not one frame of full light');
    t.run(32);
    assert.equal(t.keys.get(53).style.opacity, '0.3', 'the key is faint too');
    assert.ok(ty(t.keys.get(53)) > 4, 'and sits low, ready to rise');
    let last = -1;
    for (let i = 0; i < 80; i++) {
      t.run(32);
      const f = t.fx.lightFactor(0);
      assert.ok(f >= last - 1e-9, 'the sweep only ever brightens a key');
      last = f;
    }
    assert.ok(t.fx.lightFactor(0) === 1 && t.fx.lightFactor(15) === 1);
    assert.equal(t.fx.state().sweeping, false);
    for (const k of t.keys.values()) {
      assert.equal(k.style.opacity || '', '', 'no faintness left');
      assert.equal(k.style.transform || '', '', 'no offset left');
    }
    const painted = t.repaints.length;
    assert.ok(painted > 5, `the keys' light is repainted as the sweep runs: ${painted}`);
    // the quick one (an effect change) never goes darker than its floor
    t.fx.intro(true);
    assert.ok(t.fx.lightFactor(53) >= 0.35);
    t.run(1400);
    assert.equal(t.fx.lightFactor(53), 1);
    assert.equal(t.keys.get(53).style.opacity || '', '');
  } finally {
    t.done();
  }
});

test('the left of the board lights before the right', () => {
  const t = setup();
  try {
    t.fx.intro(false);
    t.run(700);
    assert.ok(t.fx.lightFactor(0) >= t.fx.lightFactor(53) && t.fx.lightFactor(53) > t.fx.lightFactor(42), `${t.fx.lightFactor(0)} >= ${t.fx.lightFactor(53)} > ${t.fx.lightFactor(42)}`);
    assert.ok(t.fx.lightFactor(0) > t.fx.lightFactor(42) + 0.5, 'the far right is well behind the far left');
  } finally {
    t.done();
  }
});

test('destroy() unhooks everything and removes what it added', () => {
  const t = setup();
  t.hostL.pointermove(t.ptr(220, 140));
  t.run(300);
  assert.ok(t.board.style.transform);
  assert.equal(t.cvs.length, 1, 'one canvas, for the spotlight and the rings');
  assert.equal(t.grid.children.length, 1);
  t.fx.destroy();
  assert.equal(t.board.style.transform, '');
  assert.equal(t.cvs[0].removed, true);
  assert.deepEqual(Object.keys(t.hostL), [], 'no pointer listeners left');
  assert.deepEqual(Object.keys(t.winL), [], 'no key listener left');
  t.done();
});

// ------------------------------------------------------------------ wired into the screen

test('the screen loads the motion, paints the sweep, and shows the cues the F75 screen has', () => {
  const html = read('src', 'index.html');
  assert.ok(html.indexOf('js/max-motion.js') > -1 && html.indexOf('js/max-motion.js') < html.indexOf('js/max-ui.js'), 'max-motion.js is loaded before max-ui.js');
  const ui = read('src', 'js', 'max-ui.js');
  assert.match(ui, /MM\.create\(\{/, 'the board gets the motion');
  assert.match(ui, /refs\.motion\.lightFactor\(led\)/, 'the sweep scales the light of each key');
  assert.match(ui, /function motionCue\(l\)/);
  assert.match(ui, /if \(lastMode === null\) m\.intro\(false\)/, 'a slow sweep when the keyboard is first shown');
  assert.match(ui, /l\.mode !== lastMode && tab === 'lighting'\) \|\| \(lastPic && !pic\)\) m\.intro\(true\)/, 'a quick one when the effect changes, or Live comes back');
  assert.match(ui, /pointerFx: \(\) => tab !== 'perkey'/, 'the Per-key page stays square');
  assert.match(ui, /typing: \(\) => tab === 'lighting'/);
  assert.match(ui, /refs\.motion\.destroy\(\)/, 'it is let go with the screen');
  assert.match(ui, /\(MX\.effect\(l\.mode\) \|\| \{\}\)\.reactive \? refs\.motion : null/, 'a pressed key lights the Reactive effects');
  const css = read('src', 'css', 'max.css');
  assert.match(css, /\.mx-fx \{[^}]*pointer-events: none/);
  assert.match(css, /\.stage-max\[data-fx="1"\]:not\(\[data-paint="1"\]\) \.mx-key \{ transition: filter/, 'the keys have no transform transition while the script moves them');
});
