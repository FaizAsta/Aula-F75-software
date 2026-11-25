'use strict';

/*
 * The F75 Max and the F75 HE are drawn by the same window as the F75 / F75 Pro / F87: the same keyboard picture (hover, lean, ripples, intro
 * sweep, key presses, Live / Picture) and the same data-link animation. They only bring their own key table (layout.js define()), say what
 * each key shows (state.paint) and keep their own settings. These tests hold the seams that make that possible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../src/js/layout.js');
const V = require('../src/js/preview.js');
const M = require('../src/js/max.js');
const H = require('../src/js/he.js');
const { memoryStorage } = require('../src/js/engine.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const noHid = { getDevices: async () => [] };

// ------------------------------------------------------------------------------------------------------------- layout.js

test('define() adds a layout that use() can switch to, and the F75 table comes back with use(model)', () => {
  const spec = { name: 'Test board', skin: 'max', width: 3, height: 1, keys: [{ n: 'Esc', led: 0, x: 0, y: 0 }, { n: 'A', led: 1, x: 1, y: 0 }, { n: 'Space', led: 2, x: 2, y: 0, w: 2 }] };
  L.use('f75');
  const keys = L.KEYS;
  const f75Count = keys.length;
  L.define('test-board', spec);
  assert.equal(L.KEYS.length, f75Count, 'defining alone does not switch the picture');
  assert.equal(L.use('test-board'), true);
  assert.equal(L.id, 'test-board');
  assert.equal(L.KEYS, keys, 'KEYS stays the same array object, so holders of a reference keep seeing the current table');
  assert.equal(L.KEYS.length, 3);
  assert.equal(L.skin, 'max');
  assert.equal(L.WIDTH, 3);
  assert.deepEqual(L.KEYS.map((k) => k.h), [1, 1, 1], 'the height defaults to one unit');
  assert.equal(L.KEYS[2].w, 2);
  assert.equal(L.CODE_TO_LED.KeyA, 1, 'the Reactive key map is built from the labels');
  assert.equal(L.modelName('test-board'), 'Test board');
  assert.equal(L.use('test-board'), false, 'asking for the one in use changes nothing');
  assert.equal(L.use('f75'), true);
  assert.equal(L.KEYS.length, f75Count);
  assert.ok(!L.MODELS.some((m) => m.id === 'test-board'), 'it is not one of the models a person picks from');
});

test('an unknown id falls back to the default model, as before', () => {
  L.use('f75');
  L.use('no-such-board');
  assert.equal(L.id, L.DEFAULT_MODEL);
});

test('defining the id that is in use again switches to the new table', () => {
  L.define('swap-board', { width: 1, height: 1, keys: [{ n: 'A', led: 0, x: 0, y: 0 }] });
  L.use('swap-board');
  assert.equal(L.KEYS.length, 1);
  L.define('swap-board', { width: 2, height: 1, keys: [{ n: 'A', led: 0, x: 0, y: 0 }, { n: 'B', led: 1, x: 1, y: 0 }] });
  assert.equal(L.KEYS.length, 2);
  L.use('f75');
});

test('the Max and the HE register their keys under the F75 labels, with unique LEDs', () => {
  for (const [name, mod] of [['max', M], ['he', H]]) {
    const keys = mod.keyLayout();
    assert.ok(keys.length > 70, `${name}: ${keys.length} keys`);
    assert.equal(new Set(keys.map((k) => k.led)).size, keys.length, `${name}: one LED per key`);
    for (const k of keys) assert.ok(k.legend && typeof k.legend === 'string', `${name}: key ${k.led} has the label the picture prints`);
  }
});

// ------------------------------------------------------------------------------------------------------------ preview.js

function fakeCtx(calls) {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...a) => void (calls && calls.push([k, ...a]));
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

function view(opts = {}) {
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }) };
  const canvas = { getContext: () => fakeCtx(), parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  const v = new V.KeyboardView(canvas, { animate: false, flat: true, ...opts });
  return v;
}

test('state.paint decides each key\'s colour; a key it has no colour for is dark', () => {
  L.use('f75');
  const v = view();
  const seen = [];
  v.setState({ mode: 1, brightness: 4, palette: [], selection: new Set(), paint: (k, t, eff) => (seen.push([k.led, typeof t, typeof eff.animating]), k.led % 2 ? [255, 0, 0] : null) });
  v.draw();
  assert.ok(seen.length >= L.KEYS.length, 'asked for every key');
  assert.ok(seen.every(([led, t, a]) => Number.isInteger(led) && t === 'number' && a === 'boolean'), 'with the key, the time and the effect info');
});

test('a dimmed (off) keyboard does not ask the painter at all', () => {
  const v = view();
  let asked = 0;
  v.setState({ mode: 1, brightness: 4, dim: 1, palette: [], selection: new Set(), paint: () => (asked++, [1, 2, 3]) });
  for (let i = 0; i < 3; i++) v.draw();
  assert.equal(asked, 0);
});

test('without a painter the picture uses the F75 effects as before', () => {
  const v = view();
  v.setState({ mode: 1, brightness: 4, palette: [], selection: new Set(), paint: null });
  v.draw();
  assert.equal(v.state.paint, null);
});

test('fitFor() places a keyboard of another size in the same panel', () => {
  L.use('f75');
  const v = view();
  v.resize();
  const a = v.fitFor(L.WIDTH, L.HEIGHT);
  const b = v.fitFor(L.WIDTH * 2, L.HEIGHT * 2);
  for (const f of [a, b]) for (const k of ['u', 'ox', 'oy']) assert.ok(Number.isFinite(f[k]), `${k} is a number`);
  assert.ok(b.u < a.u, 'a bigger keyboard gets smaller keys');
  assert.ok(a.ox >= 0 && a.oy >= 0);
});

// ---------------------------------------------------------------------------------------- the sessions and the link animation

for (const [name, mod, cls] of [['Max', M, 'MaxSession'], ['HE', H, 'HeSession']]) {
  test(`${name}: the session says what is on the wire (a send for what was applied, a quiet read for the battery)`, async () => {
    const Session = mod[cls];
    assert.ok(Session, `${cls} exists`);
    const s = new Session({ hid: noHid, storage: memoryStorage(), delayMs: 0 });
    await s.enterDemo();
    const log = [];
    s.on('busy', () => log.push(s.busy ? { ...s.job } : null));
    s.setLighting({ mode: 6, brightness: 3 });
    const r = await s.applyLighting();
    assert.equal(r.ok, true);
    assert.deepEqual(log, [{ name: 'lighting', quiet: false }, null], 'busy with the job, then free');
    assert.equal(s.job, null);
    log.length = 0;
    await s.pollBattery();
    assert.deepEqual(log, [{ name: 'battery', quiet: true }, null], 'the battery poll is a quiet read');
  });
}

// ------------------------------------------------------------------------------------------------------------- the wiring

test('the Max screen is wired to the window\'s picture and animation, and has no board of its own', () => {
  const ui = read('src/js/max-ui.js');
  const app = read('src/js/app.js');
  const html = read('src/index.html');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'js', 'max-motion.js')), 'the Max has no motion code of its own');
  assert.ok(!/max-motion/.test(html), 'and the page does not load it');
  assert.ok(!/mx-board|class: 'mx-key'|mxBoard/.test(ui), 'no second keyboard drawn from DOM keys');
  assert.match(ui, /L\.define\(LAYOUT_ID/, 'it registers its key table with the shared layout');
  assert.match(ui, /ctx\.link/, 'it reports what is on the wire to the window\'s data-link animation');
  assert.match(app, /link: \(kind, text\) => MO && MO\.link\(kind, text\)/, 'which is the F75\'s own');
  assert.match(app, /onPick: \(k, e, phase\) => \(MXU && MXU\.active\(\) \? MXU\.pick\(k, e, phase\) : handlePick\(k, e, phase\)\)/, 'a click or drag on the picture goes to the screen that is up');
});
