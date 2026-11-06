'use strict';

/*
 * Keyboard pictures: every model has its own skin (so the F75 picture is never shown on another keyboard), the skins are
 * well formed, and the canvas preview really draws with the skin of the model in use.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../src/js/skins.js');
const L = require('../src/js/layout.js');
const V = require('../src/js/preview.js');

test.afterEach(() => L.use('f75'));

const HEX = /^#[0-9a-f]{6}$/i;

function hexesOf(skin) {
  const out = [skin.case.top, skin.case.bottom, skin.plate.fill, skin.slot, ...skin.cap.face, ...skin.cap.body, skin.cap.legend];
  for (const a of Object.values(skin.accents)) out.push(...a.body);
  if (skin.knob) out.push(skin.knob.face, ...skin.knob.ring);
  return out;
}

test('every model in the layout registry has its own skin, and no two models share a picture', () => {
  const seen = new Set();
  for (const m of L.MODELS) {
    L.use(m.id);
    assert.equal(L.skin, m.skin, `${m.id}: layout reports its skin`);
    assert.ok(S.SKINS[m.skin], `${m.id}: skin "${m.skin}" exists`);
    const sig = JSON.stringify(S.get(L.skin));
    assert.ok(!seen.has(sig), `${m.id}: has the same picture as another model`);
    seen.add(sig);
  }
  assert.ok(S.SKINS.max, 'the F75 Max has a skin too');
  assert.ok(!seen.has(JSON.stringify(S.SKINS.max)), 'the F75 Max does not reuse another model\'s picture');
});

test('skins differ where it shows: case colour, cap colour and accent colour are not shared between models', () => {
  const ids = Object.keys(S.SKINS);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = S.SKINS[ids[i]];
      const b = S.SKINS[ids[j]];
      assert.notEqual(a.case.top, b.case.top, `${ids[i]} / ${ids[j]}: same case`);
      assert.notEqual(a.cap.face[0], b.cap.face[0], `${ids[i]} / ${ids[j]}: same caps`);
      const accA = Object.values(a.accents)[0].body[0];
      const accB = Object.values(b.accents)[0].body[0];
      assert.notEqual(accA, accB, `${ids[i]} / ${ids[j]}: same accent`);
    }
  }
});

test('skin colours are all #rrggbb, and unknown ids fall back to the F75 skin', () => {
  for (const skin of Object.values(S.SKINS)) for (const hex of hexesOf(skin)) assert.match(hex, HEX, `${skin.id}: ${hex}`);
  assert.equal(S.get('nope').id, 'f75');
  assert.equal(S.get(undefined).id, 'f75');
  assert.deepEqual(S.rgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(S.rgb('garbage'), [128, 128, 128]);
});

test('knob and screen: the F75, F75 Pro and F75 Max have a knob, the F87 has none, only the Max has a screen', () => {
  assert.ok(S.SKINS.f75.knob && S.SKINS.f75pro.knob && S.SKINS.max.knob);
  assert.equal(S.SKINS.f87.knob, null);
  assert.ok(S.SKINS.max.screen && S.SKINS.max.screen.w > 0 && S.SKINS.max.screen.h > 0);
  assert.equal(S.SKINS.f75.screen, undefined);
  // Models whose layout says there is a knob must have a skin that can draw it.
  for (const m of L.MODELS) assert.equal(!!S.SKINS[m.skin].knob, m.knob, `${m.id}: layout knob and skin knob agree`);
});

test('accent keys: gold Esc / Enter / arrows on the F75 (as in the vendor picture), case-insensitive, none on letters', () => {
  const f75 = S.SKINS.f75;
  for (const n of ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right', 'Space']) assert.equal(S.accentOf(f75, n), f75.accents.gold, n);
  for (const n of ['Backspace', 'Del', 'Tab', 'PgUp', 'Caps', 'PgDn', 'Shift', 'End', 'Ctrl', 'Win', 'Alt', 'Fn']) assert.equal(S.accentOf(f75, n), f75.accents.black, n);
  assert.equal(S.accentOf(f75, 'esc'), f75.accents.gold);
  assert.equal(S.accentOf(f75, 'Q'), null);
  assert.ok(S.accentOf(S.SKINS.max, 'enter'), 'the Max layout names keys in lower case');
});

test('legends: digits and punctuation carry both symbols, arrows are glyphs, Space is blank', () => {
  assert.deepEqual(S.legendOf('1'), { text: '1 !', align: 'left', stack: ['!', '1'] }); // the shifted symbol sits above, as printed
  assert.deepEqual(S.legendOf('['), { text: '[ {', align: 'left', stack: ['{', '['] });
  assert.equal(S.legendOf('Esc').text, 'Esc'); // as printed on the real cap
  assert.equal(S.legendOf('Caps').text, 'CapsLock');
  assert.equal(S.legendOf('Up').text, '↑');
  assert.equal(S.legendOf('Up').align, 'center');
  assert.equal(S.legendOf('Space').text, '');
  assert.equal(S.legendOf('Q').text, 'Q');
  // every key of every layout has a legend entry (an empty one only for Space)
  for (const m of L.MODELS) for (const k of m.keys) assert.ok(typeof S.legendOf(k.n).text === 'string');
});

test('cssVars gives the HTML board (the F75 Max screen) the same colours the canvas uses', () => {
  const v = S.cssVars(S.SKINS.max);
  assert.equal(v['--sk-case-top'], S.SKINS.max.case.top);
  assert.equal(v['--sk-face-a'], S.SKINS.max.cap.face[0]);
  assert.match(v['--sk-knob-ring'], /^linear-gradient/);
});

// ----------------------------------------------------------------------------------------------- drawing

function recorder() {
  const colours = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: (_, c) => colours.push(c) });
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      if (k === 'fillStyle' && typeof v === 'string') colours.push(v);
      return true;
    },
  });
  return { ctx, colours };
}

function viewFor(ctx, opts = {}) {
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }) };
  const canvas = { getContext: () => ctx, parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  return new V.KeyboardView(canvas, { animate: false, ...opts });
}

const PAL = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
const lit = { mode: 1, brightness: 4, speed: 2, colorIndex: 0, palette: PAL, colors: null, selection: new Set(), legends: null, dim: false };

test('the preview draws each model with that model\'s own case and cap colours', () => {
  for (const m of L.MODELS) {
    L.use(m.id);
    const skin = S.get(L.skin);
    const { ctx, colours } = recorder();
    const view = viewFor(ctx);
    view.setState(lit);
    view.draw();
    assert.ok(colours.includes(skin.case.top), `${m.id}: case colour ${skin.case.top} was drawn`);
    assert.ok(colours.includes(skin.cap.face[0]) || colours.some((c) => /^rgb\(/.test(c)), `${m.id}: caps were drawn`);
    for (const other of L.MODELS) {
      if (other.skin !== m.skin) assert.ok(!colours.includes(S.get(other.skin).case.top), `${m.id}: must not use the ${other.id} case colour`);
    }
  }
});

test('switching the model switches the picture on the same canvas', () => {
  const { ctx, colours } = recorder();
  const view = viewFor(ctx);
  view.setState(lit);
  L.use('f75');
  view.draw();
  assert.ok(colours.includes(S.SKINS.f75.case.top));
  colours.length = 0;
  L.use('f87');
  view.resize();
  assert.ok(colours.includes(S.SKINS.f87.case.top), 'F87 case drawn after switching');
  assert.ok(!colours.includes(S.SKINS.f75.case.top), 'and nothing of the F75 picture is left');
});

test('every drawing state works on every model: lit, dark, per-key (flat), key assignment legends, selection, intro', () => {
  for (const m of L.MODELS) {
    L.use(m.id);
    const legends = new Map(L.KEYS.map((k, i) => [k.led, { text: `Key ${i}`, mark: i % 3 === 0 ? 'pending' : i % 5 === 0 ? 'locked' : '' }]));
    const states = [
      [{}, {}],
      [{ dim: true, mode: 0 }, {}],
      [{ mode: 21, colors: null, selection: new Set([L.KEYS[2].led]) }, { flat: true }],
      [{ mode: 21, legends }, { flat: true }],
      [{ mode: 12 }, {}],
    ];
    for (const [patch, opts] of states) {
      const { ctx } = recorder();
      const view = viewFor(ctx, opts);
      view.hover = L.KEYS[1];
      view.press(L.KEYS[0].led);
      view.setState({ ...lit, ...patch });
      assert.doesNotThrow(() => view.draw(), `${m.id}: ${JSON.stringify(Object.keys(patch))}`);
    }
  }
});

test('legendStyle: how each kind of key is printed on a rendered cap, as on the real board', () => {
  assert.equal(S.legendOf('Del').text, 'Delete');
  assert.deepEqual(S.legendStyle('Q', 1.5), { kind: 'letter' });
  assert.deepEqual(S.legendStyle('1', 1), { kind: 'stack' });
  assert.deepEqual(S.legendStyle('Up', 14), { kind: 'arrow', dir: 'up' });
  assert.deepEqual(S.legendStyle('Space', 3.75), { kind: 'none' });
  for (const [name, kind] of [['Tab', 'tab'], ['Shift', 'shift'], ['Enter', 'enter'], ['Backspace', 'back'], ['PgUp', 'word'], ['F10', 'word'], ['Esc', 'word']]) {
    assert.equal(S.legendStyle(name, 0).kind, kind, name);
  }
  assert.equal(S.legendStyle('Ctrl', 0).italic, true, 'the left Ctrl is printed slanted');
  assert.equal(S.legendStyle('Ctrl', 11.25).italic, false, 'the right one is not');
  // every key of every layout has a style
  for (const m of L.MODELS) for (const k of m.keys) assert.ok(S.legendStyle(k.n, k.x).kind, `${m.id} ${k.n}`);
});
