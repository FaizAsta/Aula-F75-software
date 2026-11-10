'use strict';

/*
 * The Live / Picture switch on the keyboard picture, and lights that go off:
 *  - preview.js fades to dark when the state says `dim` (and is instant with animation off), and keeps its hover effects
 *    while dark, which is all the Picture view is;
 *  - the page has the switch, and app.js turns it into `dim` (Picture, or a keyboard that is off) without ever dimming
 *    the per-key and key-assignment boards.
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

test('a dark board still lifts the keys under the pointer (the Picture view)', () => {
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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('the page has a Live and a Picture button, and the style sheet lets [hidden] hide the group', () => {
  const html = read('src', 'index.html');
  assert.match(html, /id="stageView"/);
  assert.match(html, /data-view="live"/);
  assert.match(html, /data-view="picture"/);
  assert.match(read('src', 'css', 'detail.css'), /\.stage-view\[hidden\]\s*\{\s*display:\s*none/);
});

test('app.js dims for Picture and for a keyboard that is off, but never on the per-key and key boards', () => {
  const js = read('src', 'js', 'app.js');
  assert.match(js, /prefs\.view = prefs\.view === 'picture' \? 'picture' : 'live'/, 'an unknown saved value means Live');
  assert.match(js, /dim: pictureOnly\(\) \|\| \(!perKey && keyboardOff\(\)\)/);
  assert.match(js, /const pictureOnly = \(\) => prefs\.view === 'picture' && tab !== 'perkey' && tab !== 'keys'/);
  assert.match(js, /box\.hidden = tab === 'perkey' \|\| tab === 'keys'/, 'the switch is hidden while painting or assigning');
});
