'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/js/preview.js');
const L = require('../src/js/layout.js');

const PAL = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
const state = (over = {}) => ({ palette: PAL, colorIndex: 7, speed: 2, colors: null, ...over });
const at = (mode, t, s = state(), key = L.KEYS[0]) => V.keyColor(mode, key, t, s);
const rgb = (c) => c.map(Math.round).join(',');

test('Rainbow shows one palette colour at a time and steps to the next, instead of a gradient', () => {
  // Speed 2 holds each colour for about 1.76 s.
  assert.equal(rgb(at(3, 0.3)), '255,0,0');
  assert.equal(rgb(at(3, 1.0)), '255,0,0');
  assert.equal(rgb(at(3, 2.2)), '0,255,0');
  assert.equal(rgb(at(3, 4.0)), '0,0,255');
  // After the last colour it starts again from the first.
  assert.equal(rgb(at(3, 0.3 + 1.76 * 7)), '255,0,0');
});

test('Rainbow is the same colour on every key at any moment', () => {
  for (const t of [0.3, 2.2, 4.0]) {
    const first = rgb(at(3, t, state(), L.KEYS[0]));
    for (const k of L.KEYS) assert.equal(rgb(at(3, t, state(), k)), first);
  }
});

test('Rainbow speed changes how long each colour is held', () => {
  const slow = at(3, 2.0, state({ speed: 0 }));
  const fast = at(3, 2.0, state({ speed: 4 }));
  assert.equal(rgb(slow), '255,0,0'); // still on the first colour
  assert.notEqual(rgb(fast), '255,0,0'); // already moved on
});

test('Rainbow skips black palette entries and falls back when the palette is empty', () => {
  const pal = [[0, 0, 0], [0, 0, 255]];
  assert.equal(rgb(at(3, 0.3, state({ palette: pal }))), '0,0,255');
  assert.equal(rgb(at(3, 0.3, state({ palette: [] }))), '255,0,0');
});

test('Breathing fades all the way down between breaths', () => {
  const period = Math.PI / (0.35 + 2 * 0.45);
  const peak = at(2, period / 2);
  const trough = at(2, period);
  assert.equal(Math.max(...peak), 255);
  assert.ok(Math.max(...trough) < 20, `trough was ${rgb(trough)}`);
});

test('Multicolour Breathing keeps one colour per breath and changes it at the dark point', () => {
  const period = Math.PI / (0.35 + 2 * 0.45);
  assert.equal(rgb(at(2, period * 0.5)), '255,0,0');
  assert.equal(rgb(at(2, period * 1.5)), '0,255,0');
  assert.equal(rgb(at(2, period * 2.5)), '0,0,255');
  // The hue never drifts inside a breath: green stays pure green while it brightens and fades.
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const c = at(2, period * (1 + f));
    assert.equal(c[0], 0);
    assert.equal(c[2], 0);
  }
});

test('Single-colour Breathing uses the chosen swatch only', () => {
  const period = Math.PI / (0.35 + 2 * 0.45);
  for (const f of [0.2, 0.5, 0.8]) {
    const c = at(2, period * f, state({ colorIndex: 4 }));
    assert.equal(c[1], 0);
    assert.ok(c[0] > 0 && c[0] === c[2], `swatch 5 is magenta, got ${rgb(c)}`);
  }
});

test('a paused preview shows Rainbow and Breathing lit, at any speed', () => {
  for (const speed of [0, 1, 2, 3, 4]) {
    const s = state({ speed });
    for (const mode of [2, 3]) {
      const c = at(mode, V.stillTime(mode, speed), s);
      assert.equal(Math.max(...c), 255, `mode ${mode} speed ${speed} gave ${rgb(c)}`);
    }
  }
});
