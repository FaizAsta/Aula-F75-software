'use strict';

/*
 * The keyboard artwork (boardart.js) and how preview.js uses it: the case layer and each keycap are drawn once and
 * copied after that, and the artwork draws on every skin without needing anything the browser might not have.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../src/js/boardart.js');
const S = require('../src/js/skins.js');
const L = require('../src/js/layout.js');
const V = require('../src/js/preview.js');

test.afterEach(() => {
  L.use('f75');
  delete globalThis.document;
});

function fakeCtx(log = []) {
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

test('capGeo puts the face inside the cap, leaving a lip at the front', () => {
  const g = A.capGeo(40, 40, 42);
  assert.ok(g.fx > 0 && g.fy > 0, 'inset from the left and top');
  assert.ok(g.fx + g.fw < 40, 'inside the right edge');
  assert.ok(g.fy + g.fh < 40 - 4, 'a front lip below the face');
  assert.ok(g.fw > 0 && g.fh > 0);
  const wide = A.capGeo(100, 40, 42);
  assert.ok(wide.fw > g.fw, 'a wider key has a wider face');
});

test('every skin draws its case layer and its caps on a plain 2D context, with and without an accent', () => {
  for (const id of Object.keys(S.SKINS)) {
    const skin = S.SKINS[id];
    const log = [];
    const ctx = fakeCtx(log);
    L.use(L.MODELS[0].id);
    const geo = { u: 40, ox: 30, oy: 30, W: L.WIDTH, H: L.HEIGHT };
    assert.doesNotThrow(() => A.drawStatic(ctx, skin, geo, L.KEYS, { knob: true }), `${id}: static layer`);
    const accent = Object.values(skin.accents)[0];
    assert.doesNotThrow(() => A.drawCap(ctx, skin, accent, 5, 5, 38, 38, 40), `${id}: accent cap`);
    assert.doesNotThrow(() => A.drawCap(ctx, skin, null, 5, 5, 80, 38, 40), `${id}: plain wide cap`);
    assert.ok(log.length > 40, `${id}: it actually drew something`);
  }
});

test('the knob is only drawn where the layout has one', () => {
  const drawn = (knob) => {
    const log = [];
    L.use('f75');
    A.drawStatic(fakeCtx(log), S.SKINS.f75, { u: 40, ox: 30, oy: 30, W: L.WIDTH, H: L.HEIGHT }, L.KEYS, { knob });
    return log.filter((e) => e[0] === 'arc').length;
  };
  assert.ok(drawn(true) > drawn(false) + 5, 'the knob adds its circles');
});

test('with offscreen canvases, the case layer and each cap are drawn once and then only copied', () => {
  let made = 0;
  const copies = [];
  globalThis.document = {
    createElement() {
      made++;
      const ctx = fakeCtx();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const mainCtx = fakeCtx(copies);
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }) };
  const canvas = { getContext: () => mainCtx, parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  L.use('f75');
  const view = new V.KeyboardView(canvas, { animate: false });
  view.setState({ mode: 1, brightness: 4, speed: 2, colorIndex: 0, palette: [[255, 0, 0]], colors: null, selection: new Set(), legends: null, dim: false });
  view.draw();
  const afterFirst = made;
  assert.ok(afterFirst > 1, `layers were made (${afterFirst})`);
  assert.ok(copies.filter((e) => e[0] === 'drawImage').length >= L.KEYS.length + 1, 'the layer and every key were copied');
  for (let i = 0; i < 10; i++) view.draw();
  assert.equal(made, afterFirst, 'nothing is rebuilt on later frames');
  // a different model needs its own picture: new layer and new caps
  L.use('f87');
  view.draw();
  assert.ok(made > afterFirst, 'a model switch rebuilds the case layer and the caps');
  const afterSwitch = made;
  for (let i = 0; i < 5; i++) view.draw();
  assert.equal(made, afterSwitch, 'and then is stable again');
});

test('caps with the same size and accent share one sprite', () => {
  let made = 0;
  globalThis.document = {
    createElement() {
      made++;
      const ctx = fakeCtx();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }) };
  const canvas = { getContext: () => fakeCtx(), parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  L.use('f75');
  const view = new V.KeyboardView(canvas, { animate: false });
  view.setState({ mode: 1, brightness: 4, speed: 2, colorIndex: 0, palette: [[255, 0, 0]], colors: null, selection: new Set(), legends: null, dim: false });
  view.draw();
  // distinct sprites = distinct (key width, accent colour) pairs, plus the case layer and the grain tile
  const skin = S.get(L.skin);
  const kinds = new Set(L.KEYS.map((k) => `${k.w}|${(S.accentOf(skin, k.n) || { body: [''] }).body[0]}`));
  assert.ok(made <= kinds.size + 3, `${made} canvases for ${kinds.size} kinds of key`);
});
