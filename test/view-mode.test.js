'use strict';

/*
 * The Live / Picture switch on the keyboard picture, and lights that go off:
 *  - preview.js fades to dark when the state says `dim` (and is instant with animation off);
 *  - Picture is a still image of the board in its current light colours: with animation and hover effects off, preview.js
 *    draws the same frame every time and the pointer does nothing to it (no rise, lean, bob or ripple);
 *  - the page has the switch, and app.js turns Picture into that still image (loop stopped, effects off, chips and the
 *    link animation hidden) and dims only a keyboard that is off, never the per-key and key-assignment boards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../src/js/preview.js');

function fakeCtx() {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
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
  const canvas = { getContext: () => fakeCtx(), parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  const view = new V.KeyboardView(canvas, { animate: true, flat: false, ...opts });
  view.setState({ mode: 1, brightness: 4, palette: [], selection: new Set(), dim: false });
  return { view, handlers };
}

test('switching the lights off fades over a few frames, and they come back the same way', () => {
  const { view } = setup();
  view.draw();
  assert.equal(view._dimAmt, 0, 'lit');
  view.setState({ dim: true });
  assert.ok(view._dimAmt < 0.5, `the first frame is only part of the way: ${view._dimAmt}`);
  let prev = view._dimAmt;
  for (let i = 0; i < 12; i++) {
    view._dimMs -= 50;
    view.draw();
    assert.ok(view._dimAmt >= prev, 'only ever gets darker');
    prev = view._dimAmt;
  }
  assert.ok(view._dimAmt > 0.9, `nearly dark after about half a second: ${view._dimAmt}`);
  for (let i = 0; i < 40; i++) {
    view._dimMs -= 50;
    view.draw();
  }
  assert.equal(view._dimAmt, 1, 'fully dark');
  view.setState({ dim: false });
  for (let i = 0; i < 40; i++) {
    view._dimMs -= 50;
    view.draw();
  }
  assert.equal(view._dimAmt, 0, 'lit again');
});

test('with animation off the lights go off and on at once', () => {
  const { view } = setup({ animate: false });
  view.draw();
  view.setState({ dim: true });
  assert.equal(view._dimAmt, 1);
  view.setState({ dim: false });
  assert.equal(view._dimAmt, 0);
});

test('a dark board still follows the pointer while the hover effects are on (Live, lights off)', () => {
  const { view, handlers } = setup();
  view.setState({ dim: true });
  for (let i = 0; i < 30; i++) {
    view._dimMs -= 50;
    view.draw();
  }
  assert.equal(view._dimAmt, 1);
  handlers.pointermove({ clientX: 400, clientY: 140, pointerType: 'mouse' });
  for (let i = 0; i < 30; i++) {
    view._lastFrame -= 16;
    view.draw();
  }
  assert.ok(view.hm.a > 0.9, 'the pointer is tracked while dark');
});

test('Picture: with animation and hover effects off the board is one still frame that the pointer cannot change', () => {
  // as app.js does it: the view is built with its pointer listeners, then Picture switches the effects off
  const { view, handlers } = setup();
  view.opts.animate = false;
  view.opts.hoverFx = false;
  view.setState({ mode: 16, brightness: 4, colorIndex: 7, dim: false }); // a moving effect, shown lit
  view.draw();
  const first = view.mean.slice();
  assert.ok(Math.max(...first) > 20, `the board is lit in its colours, not dark: ${first}`);
  assert.equal(view._dimAmt, 0);

  // the same frame later: nothing moves
  view.t0 -= 4000;
  view.draw();
  assert.deepEqual(view.mean, first, 'an effect that moves is a still image in Picture');

  // pointer over it, click on it, press a key: nothing reacts
  handlers.pointermove({ clientX: 400, clientY: 140, pointerType: 'mouse' });
  handlers.pointerdown({ clientX: 400, clientY: 140, pointerType: 'mouse' });
  view.press(1);
  view.playIntro(true);
  for (let i = 0; i < 10; i++) {
    view._lastFrame -= 16;
    view.draw();
  }
  assert.equal(view.hm.a, 0, 'no pointer glow');
  assert.equal(view.ripples.length, 0, 'no click ripple');
  assert.equal(view.pressedAt.size, 0, 'no key press');
  assert.equal(view.introAt, -1, 'no sweep');
  assert.ok(!view.canvas.style.transform, 'no lean and no bob');
  assert.deepEqual(view.mean, first, 'still the same picture');
});

test('Live: with animation on, a moving effect does move (so the Picture test above means something)', () => {
  const { view } = setup();
  view.setState({ mode: 16, brightness: 4, colorIndex: 7, dim: false });
  view.draw();
  const a = view.mean.slice();
  view.t0 -= 1300;
  view.draw();
  assert.notDeepEqual(view.mean, a);
});

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('the page has a Live and a Picture button, and the style sheet lets [hidden] hide the group', () => {
  const html = read('src', 'index.html');
  assert.match(html, /id="stageView"/);
  assert.match(html, /data-view="live"/);
  assert.match(html, /data-view="picture"/);
  assert.match(read('src', 'css', 'detail.css'), /\.stage-view\[hidden\]\s*\{\s*display:\s*none/);
});

test('app.js dims only for a keyboard that is off (Picture shows the current colours), and never on the per-key and key boards', () => {
  const js = read('src', 'js', 'app.js');
  assert.match(js, /prefs\.view = prefs\.view === 'picture' \? 'picture' : 'live'/, 'an unknown saved value means Live');
  assert.match(js, /dim: !pictureOnly\(\) && !perKey && keyboardOff\(\)/);
  assert.match(js, /const pictureOnly = \(\) => prefs\.view === 'picture' && tab !== 'perkey' && tab !== 'keys'/);
  assert.match(js, /box\.hidden = tab === 'perkey' \|\| tab === 'keys'/, 'the switch is hidden while painting or assigning');
});

test('app.js turns Picture into a still image: loop stopped, animation and hover effects off, and back on for Live', () => {
  const js = read('src', 'js', 'app.js');
  const fn = js.slice(js.indexOf('function syncPicture()'), js.indexOf('/**\n   * The real keyboard is off'));
  assert.match(fn, /view\.opts\.animate = pic \? false : prefs\.animate/);
  assert.match(fn, /view\.opts\.hoverFx = !pic/);
  assert.match(fn, /if \(pic\) \{\s*view\.stop\(\)/);
  assert.match(fn, /view\.ripples = \[\]/);
  assert.match(fn, /else if \(prefs\.animate && !\(MXU && MXU\.active\(\)\)\) view\.start\(\)/);
  // it runs before every draw, and before the Live sweep that follows a click on the switch
  assert.match(js, /syncPicture\(\);\s*view\.setState\(previewState\(\)\)/);
  assert.match(js, /syncPicture\(\);[^\n]*\n\s*if \(next === 'live' && prefs\.animate/);
  // nothing else may start the loop while Picture is on
  assert.match(js, /if \(prefs\.animate && prefs\.view !== 'picture'\) view\.start\(\)/);
  assert.match(js, /viewWas && prefs\.animate && !pictureOnly\(\)/);
});

test('Picture hides what lies over the image (status chips, link animation) and takes no pointer; the switch stays', () => {
  const js = read('src', 'js', 'app.js');
  const css = read('src', 'css', 'detail.css');
  assert.match(js, /stage\.dataset\.pic = pictureOnly\(\) \? '1' : ''/);
  assert.match(css, /\.stage\[data-pic="1"\] \.stage-bar,\s*\.stage\[data-pic="1"\] \.stage-tx\s*\{\s*display:\s*none !important/);
  assert.match(css, /\.stage\[data-pic="1"\] \.stage-canvas,\s*\.stage\[data-pic="1"\] \.stage-max\s*\{\s*pointer-events:\s*none/);
  assert.doesNotMatch(css, /\.stage\[data-pic="1"\] \.stage-view/, 'the Live / Picture switch itself is never hidden');
  assert.match(read('src', 'index.html'), /Nothing moves and nothing reacts to the pointer/);
});
