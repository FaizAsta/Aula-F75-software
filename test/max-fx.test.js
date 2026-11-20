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

test('the board\'s average light (what the window is tinted with): dark for Off, the colour itself for Static, moving for Spectrum Cycle', () => {
  const peak = (c) => Math.max(c[0], c[1], c[2]);
  assert.deepStrictEqual(FX.mean(0, 1, {}), [0, 0, 0], 'Off is dark, not the dim grey of the drawing');
  const st = FX.mean(1, 1, { rgb: [170, 70, 255], colorful: false });
  assert.ok(st[0] > 0 && Math.abs(st[0] / peak(st) - 170 / 255) < 0.01 && Math.abs(st[1] / peak(st) - 70 / 255) < 0.01, 'Static keeps its hue');
  for (const e of MX.EFFECTS) for (const t of [undefined, 0.4, 2.2]) assert.ok(FX.mean(e.mode, t, {}).every((v) => Number.isFinite(v) && v >= 0 && v <= 255), `${e.name} gives a valid average`);
  const hues = new Set([0, 1, 2, 3, 4, 5].map((t) => FX.mean(8, t, { speed: 3 }).map(Math.round).join(',')));
  assert.ok(hues.size > 3, 'Spectrum Cycle walks through the colours');
});

test('the F75 Max / F75 HE screen tints the window with the keyboard\'s light, through the same --glow the F75 screen uses', () => {
  const ui = read('js/max-ui.js');
  const app = read('js/app.js');
  assert.match(app, /const setGlow = \(mean, force = false\) =>/, 'one function sets the tint');
  assert.match(app, /view\.onFrameColor = \(mean\) => setGlow\(mean\)/, 'the F75 preview uses it');
  assert.match(app, /glow: \(mean, force\) => setGlow\(mean, force\)/, 'and so does the Max / HE screen');
  assert.match(ui, /function lightMean\(now\)/);
  assert.match(ui, /FX\.mean\(m,/, 'a moving effect follows its own drawing');
  assert.match(ui, /updateGlow\(\); \/\/ the window's tint follows/, 'what is painted or chosen tints the window at once');
  assert.match(ui, /ctx\.glow\(\[0, 0, 0\], true\)/, 'leaving the screen puts the default tint back');
});

test('lit() gives the colour of a key or null for a dark key, so the keyboard picture can show an effect unlit where it is dark', () => {
  const keys = MX.keyLayout();
  const st = { rgb: [255, 60, 170], colorful: false, direction: 0, speed: 3 };
  const lights = (mode, t) => keys.filter((k) => FX.lit(mode, k, t, st) !== null).length;
  assert.strictEqual(lights(0, 1), 0, 'Off lights nothing');
  assert.strictEqual(lights(8, 1), keys.length, 'Spectrum Cycle lights the whole board');
  assert.ok(lights(19, 1.1) > 0 && lights(19, 1.1) < keys.length, 'Shuttle lights a band of keys, not all of them');
  for (const e of MX.EFFECTS) for (const k of keys) {
    const c = FX.lit(e.mode, k, 0.6, st);
    assert.ok(c === null || isRgb(c), `${e.name} ${k.name}`);
    assert.deepStrictEqual(FX.keyColor(e.mode, k, 0.6, st), c || [34, 38, 48], `${e.name}: the card's drawing and the picture agree`);
  }
  assert.deepStrictEqual(FX.lit(10, keys[5], undefined, st), FX.lit(10, keys[5], FX.stillTime(10), st), 'no time means the effect\'s still moment');
});

test('the F75 Max / F75 HE keyboard picture plays the moving effects, as the F75 screen\'s picture does, and stops when it should', () => {
  const ui = read('js/max-ui.js');
  const css = read('css/max.css');
  assert.match(ui, /FX\.lit\(m, k, t, st\)/, 'the picture takes its colours from the effect\'s drawing');
  assert.match(ui, /function paintKeys\(now = null\)/);
  assert.match(ui, /const lightMoves = \(\) => !!FX && canAnimate\(\) && !stillPicture\(\) && tab !== 'perkey'/, 'Picture, animations off and the Per-key page keep the picture still');
  assert.match(ui, /function playLoop\(now\)/);
  assert.match(ui, /if \(b\._sig === sig\) continue;/, 'only a key whose light changed is touched');
  assert.match(ui, /refs\.stageBox\.dataset\.play = lightMoves\(\)/);
  assert.match(css, /\.stage-max\[data-play="1"\] \.mx-key::after/, 'the fades are dropped while an effect plays, so the frame rate holds');
  assert.doesNotMatch(ui, /and nothing for the moving effects/, 'the old "nothing for the moving effects" rule is gone');
});
