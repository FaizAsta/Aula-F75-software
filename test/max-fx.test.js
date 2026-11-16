'use strict';
// The F75 Max's effect cards (max-fx.js, max-ui.js): every one of the keyboard's 20 effects has a little keyboard that draws,
// and the Max Lighting page uses the F75 screen's own card, slider and swatch classes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const MX = require('../src/js/max.js');
const FX = require('../src/js/max-fx.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

test('every Max effect gives every key a valid colour, with and without rainbow colours', () => {
  const keys = MX.keyLayout();
  for (const e of MX.EFFECTS) {
    for (const colorful of [false, true]) {
      for (const t of [undefined, 0.3, 1.7, 9.1]) {
        for (const k of keys) assert.ok(isRgb(FX.keyColor(e.mode, k, t === undefined ? FX.stillTime(e.mode) : t, { colorful })), `${e.name} ${k.name}`);
      }
    }
  }
});

test('Off is dark, Static is one colour, and the moving effects change over time', () => {
  const keys = MX.keyLayout();
  const frame = (mode, t, st) => keys.map((k) => FX.keyColor(mode, k, t, st).join(',')).join('|');
  assert.strictEqual(new Set(keys.map((k) => FX.keyColor(0, k, 1, {}).join(','))).size, 1);
  assert.strictEqual(new Set(keys.map((k) => FX.keyColor(1, k, 1, { rgb: [10, 20, 30] }).join(','))).size, 1);
  for (const e of MX.EFFECTS.filter((x) => x.mode > 1 && x.mode !== 6)) {
    const frames = new Set([0.2, 0.9, 1.6, 2.3, 3.1].map((t) => frame(e.mode, t, {})));
    assert.ok(frames.size > 1, `${e.name} never changes`);
  }
});

test('the direction changes what a directional effect draws', () => {
  const keys = MX.keyLayout();
  const frame = (dir) => keys.map((k) => FX.keyColor(10, k, 0.7, { direction: dir }).join(',')).join('|');
  assert.notStrictEqual(frame(0), frame(2));
  assert.notStrictEqual(frame(0), frame(1));
});

test('the Max Lighting page has a card with a picture for each effect and the F75 screen\'s slider, swatches and chips', () => {
  const js = read('js/max-ui.js');
  assert.match(js, /el\('canvas', \{ width: 224, height: 76/);
  assert.match(js, /class: 'range', id: 'mxBright'/);
  assert.match(js, /class: 'eff-chips', id: 'mxEffChips'/);
  assert.match(js, /class: 'swatch rainbow'/);
  const html = read('index.html');
  assert.ok(html.indexOf('js/max-fx.js') > -1 && html.indexOf('js/max-fx.js') < html.indexOf('js/max-ui.js'), 'max-fx.js is loaded before max-ui.js');
});
