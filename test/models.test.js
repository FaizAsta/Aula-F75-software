'use strict';

/*
 * Keyboard models: the layout registry (F75 and F87 share one protocol and differ only in their key tables), the
 * model hint taken from the USB product name, the Snake effect on a bigger layout, and the report sizes read from
 * the device descriptor for the compatibility report.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../src/js/layout.js');
const P = require('../src/js/protocol.js');
const W = require('../src/js/webhid.js');
const { installFakeHid, DONGLE, CABLE, wait } = require('./fake-hid.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');

const LED_COUNT = 126; // size of the per-key colour block the keyboards report

test.afterEach(() => L.use('f75'));

test('every model has unique LED indices inside the colour block, keys that do not overlap, and fits its width', () => {
  for (const m of L.MODELS) {
    L.use(m.id);
    const leds = L.KEYS.map((k) => k.led);
    assert.equal(new Set(leds).size, leds.length, `${m.id}: duplicate LED index`);
    assert.ok(Math.max(...leds) < LED_COUNT, `${m.id}: LED index outside the colour block`);
    for (const k of L.KEYS) assert.ok(k.x + k.w <= L.WIDTH + 1e-9, `${m.id}: ${k.n} runs past the width`);
    for (let i = 0; i < L.KEYS.length; i++) {
      for (let j = i + 1; j < L.KEYS.length; j++) {
        const a = L.KEYS[i];
        const b = L.KEYS[j];
        const overlap = a.y === b.y && a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9;
        assert.ok(!overlap, `${m.id}: ${a.n} overlaps ${b.n}`);
      }
    }
  }
});

test('key counts: F75 and F75 Pro have 80 keys, F87 has 87', () => {
  L.use('f75');
  assert.equal(L.KEYS.length, 80);
  L.use('f75pro');
  assert.equal(L.KEYS.length, 80);
  L.use('f87');
  assert.equal(L.KEYS.length, 87);
});

test('F87 LED table matches the manufacturer table for the keys it adds', () => {
  L.use('f87');
  const led = (n, nth = 0) => L.KEYS.filter((k) => k.n === n)[nth].led;
  const want = { Esc: 0, F1: 12, F12: 78, PrtSc: 84, ScrLk: 90, Pause: 96, Ins: 85, Home: 91, PgUp: 97, Del: 86, End: 92, PgDn: 98, Up: 94, Menu: 65, Left: 89, Down: 95, Right: 101, Space: 35, Enter: 81 };
  for (const [n, v] of Object.entries(want)) assert.equal(led(n), v, n);
  assert.equal(led('Shift', 1), 82, 'right shift');
  assert.equal(led('Alt', 1), 53, 'right alt');
  assert.equal(led('Ctrl', 1), 83, 'right ctrl');
  assert.equal(led('Fn'), 59);
});

test('use(): reports whether anything changed, keeps the same KEYS array, and falls back to the F75 for unknown ids', () => {
  L.use('f75');
  const keys = L.KEYS;
  assert.equal(L.use('f75'), false);
  assert.equal(L.use('f87'), true);
  assert.equal(L.KEYS, keys, 'same array object, new contents');
  assert.equal(L.KEYS.length, 87);
  assert.equal(L.use('no-such-model'), true);
  assert.equal(L.id, 'f75');
  assert.equal(L.KEYS.length, 80);
  assert.equal(L.hasModel('f87'), true);
  assert.equal(L.hasModel('nope'), false);
});

test('guessModel() reads the USB product name and says nothing when the name says nothing', () => {
  assert.equal(L.guessModel('AULA F87 Pro'), 'f87');
  assert.equal(L.guessModel('AULA F75'), 'f75');
  assert.equal(L.guessModel('AULA F75 Pro'), 'f75pro');
  assert.equal(L.guessModel('2.4G Wireless Receiver'), null);
  assert.equal(L.guessModel(''), null);
  assert.equal(L.guessModel(undefined), null);
});

test('key codes for the Reactive preview follow the layout: right-hand keys exist only where the keyboard has them', () => {
  L.use('f75');
  assert.equal(L.CODE_TO_LED.AltRight, undefined);
  assert.equal(L.CODE_TO_LED.PrintScreen, undefined);
  L.use('f87');
  assert.equal(L.CODE_TO_LED.AltRight, 53);
  assert.equal(L.CODE_TO_LED.PrintScreen, 84);
  assert.equal(L.CODE_TO_LED.ContextMenu, 65);
  assert.equal(L.CODE_TO_LED.ShiftRight, 82);
  assert.equal(L.CODE_TO_LED.KeyA, 9);
});

test('the Snake effect covers every key of a bigger layout after switching to it', () => {
  const V = require('../src/js/preview.js');
  const state = { mode: 10, brightness: 4, speed: 2, color: 7, palette: [], selection: new Set() };
  const colour = (k, t) => V.keyColor(10, k, t, { ...state, perkey: null });
  L.use('f75');
  for (const k of L.KEYS) colour(k, 1); // builds the F75 path first, the stale case
  L.use('f87');
  for (const k of L.KEYS) {
    const c = colour(k, 1.3);
    assert.ok(c.every(Number.isFinite), `Snake colour for ${k.n} (led ${k.led}) is not a number: ${c}`);
  }
});

test('requiredLeds() is the highest LED index of the layout plus one', () => {
  L.use('f75');
  assert.equal(L.requiredLeds(), 90);
  L.use('f87');
  assert.equal(L.requiredLeds(), 102);
});

test('fits(): a 96-light F75 block cannot hold the F87 layout, but a 126-light block holds both', () => {
  L.use('f75');
  assert.equal(L.fits(96), true);
  assert.equal(L.fits(89), false);
  L.use('f87');
  assert.equal(L.fits(96), false, 'F87 layout on an F75-sized keyboard: the wrong model');
  assert.equal(L.fits(126), true);
});

test('the F75 and F75 Pro have a knob (one key width in from the right edge); the F87 has none', () => {
  L.use('f75');
  assert.equal(L.KNOB, true);
  assert.equal(L.WIDTH - 0.5, 15.5, 'same place as before the layouts were split');
  L.use('f75pro');
  assert.equal(L.KNOB, true);
  assert.equal(L.WIDTH - 0.5, 15.5);
  L.use('f87');
  assert.equal(L.KNOB, false);
});

test('the families this app cannot drive are not named after a model it knows', () => {
  for (const d of P.DEVICES.filter((x) => !x.supported)) {
    assert.ok(!/F75 Max/i.test(d.label), d.label);
    assert.match(d.label, /[0-9a-f]{4}:[0-9a-f]{4}/);
  }
});

test('describe() lists report ids and sizes taken from the descriptor, without sending anything', () => {
  const dev = {
    vendorId: 0x258a,
    productId: 0x010c,
    productName: 'AULA F87',
    opened: false,
    collections: [
      { usagePage: 0xff02, usage: 0x02, inputReports: [{ reportId: 0x13, items: [{ reportSize: 8, reportCount: 19 }] }], outputReports: [{ reportId: 0x13, items: [{ reportSize: 8, reportCount: 19 }] }], featureReports: [] },
      { usagePage: 0x0001, usage: 0x06, inputReports: [], outputReports: [], featureReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 519 }] }] },
    ],
  };
  const d = W.describe(dev);
  assert.equal(d.collections[0].reports, 'in 0x13:19B  out 0x13:19B');
  assert.equal(d.collections[1].reports, 'feature 0x00:519B');
  assert.equal(d.supported, true);
});

test('a connected session remembers the USB product name of the interface (the hint for the model)', async () => {
  const [hid, restore] = installFakeHid();
  try {
    hid.add({ ...CABLE, productName: 'AULA F87 Pro', collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard());
    const s = new Session({ storage: memoryStorage(), transportTimeout: 100, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.productName, 'AULA F87 Pro');
    assert.equal(L.guessModel(s.productName), 'f87');
    s.disconnect();
    assert.equal(s.productName, '');
    await wait(50);
  } finally {
    restore();
  }
});

test('F75 Pro: product names are told apart from the plain F75, in any spelling of "Pro"', () => {
  for (const name of ['AULA F75 Pro', 'AULA F75Pro', 'aula f75 PRO', 'F75-Pro', 'F75_Pro', 'USB Receiver F75 Pro']) {
    assert.equal(L.guessModel(name), 'f75pro', name);
  }
  for (const name of ['AULA F75', 'F75', 'AULA F75 keyboard']) assert.equal(L.guessModel(name), 'f75', name);
  assert.equal(L.guessModel('AULA F87 Pro'), 'f87', 'a Pro suffix alone does not make it an F75 Pro');
  assert.equal(L.modelName('f75pro'), 'AULA F75 Pro');
  assert.equal(L.hasModel('f75pro'), true);
});

test('F75 Pro: same LED table as the F75, so painting and the light-count check behave the same', () => {
  L.use('f75');
  const f75 = L.KEYS.map((k) => `${k.n}:${k.led}:${k.x}:${k.y}:${k.w}`);
  const f75Need = L.requiredLeds();
  L.use('f75pro');
  assert.deepEqual(L.KEYS.map((k) => `${k.n}:${k.led}:${k.x}:${k.y}:${k.w}`), f75);
  assert.equal(L.requiredLeds(), f75Need);
  assert.equal(L.fits(96), true);
  assert.equal(L.fits(89), false);
  assert.equal(L.id, 'f75pro');
});

test('F75 Pro: switching between F75 and F75 Pro reports a change (so the page rebuilds what it cached)', () => {
  L.use('f75');
  assert.equal(L.use('f75pro'), true);
  assert.equal(L.use('f75pro'), false);
  assert.equal(L.use('f75'), true);
});

test('F75 Pro: it connects on the 2.4G dongle and on the cable, and the name selects its model', async () => {
  for (const base of [DONGLE, CABLE]) {
    const [hid, restore] = installFakeHid();
    try {
      hid.add({ ...base, productName: 'AULA F75 Pro', collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard());
      const s = new Session({ storage: memoryStorage(), transportTimeout: 100, discover: () => W.discover() });
      assert.equal(await s.connectAuto(), true, `${base.vendorId.toString(16)}:${base.productId.toString(16)}`);
      assert.equal(s.productName, 'AULA F75 Pro');
      assert.equal(L.guessModel(s.productName), 'f75pro');
      s.disconnect();
      await wait(50);
    } finally {
      restore();
    }
  }
});

test('F75 Pro: a device named F75 Pro with ids this app does not list is still tried, because its name and descriptor say so', async () => {
  const [hid, restore] = installFakeHid();
  try {
    hid.add({ vendorId: 0x1234, productId: 0x5678, productName: 'AULA F75 Pro', collections: [{ usagePage: 0xff02, usage: 2 }] }, new MockKeyboard());
    const s = new Session({ storage: memoryStorage(), transportTimeout: 100, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true);
    assert.equal(L.guessModel(s.productName), 'f75pro');
    s.disconnect();
    await wait(50);
  } finally {
    restore();
  }
});
