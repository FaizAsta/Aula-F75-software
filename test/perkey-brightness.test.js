'use strict';

/*
 * Per-key colours must survive a lighting change made on another page.
 *
 * Reported on the F75: paint keys, Apply (they light), then change the brightness on the Lighting page (the Per-key page has no
 * brightness control) and Apply: the whole keyboard went dark and the colours were gone until the keys were painted again.
 * A config sent on its own while Per-key is the effect shows nothing, so the colours now go out with it. The same holds for
 * every model (F75, F75 Pro, F87 share the protocol) on the 2.4G dongle and the USB-C cable, and for a sleep-time change.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const L = require('../src/js/layout.js');
const W = require('../src/js/webhid.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, CABLE } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');

const RED = [255, 0, 0];
const ledsOf = (model) => model.keys.slice(0, 3).map((k) => k.led);
const planar = (colors, led) => [colors[led], colors[led + 126], colors[led + 252]];

async function withCable(model, kbOpts, body, storage = memoryStorage()) {
  const [hid, restore] = installFakeHid();
  let s;
  try {
    const kb = new CableKeyboard({ layoutKeys: model.keys, ...kbOpts });
    hid.add(CABLE, kb);
    s = new Session({ storage, transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true, `${model.id}: cable connects`);
    await body({ kb, s, storage, hid });
  } finally {
    if (s) s.disconnect();
    restore();
  }
}

for (const m of L.MODELS) {
  test(`${m.id} on the cable: brightness changed on the Lighting page keeps the per-key colours lit`, async () => {
    await withCable(m, {}, async ({ kb, s }) => {
      const leds = ledsOf(m);
      s.paintKeys(leds, RED);
      assert.equal((await s.apply()).ok, true);
      assert.equal(kb.perKeyLit, true, 'lit after painting');

      kb.writes.length = 0;
      assert.ok(s.setBrightness(2));
      const r = await s.apply();
      assert.equal(r.ok, true);
      assert.equal(r.colorsResent, true);
      assert.deepEqual(kb.writes.map((w) => w.block), ['colors', 'led'], 'colours first, the config last');
      assert.equal(P.getMode(kb.led), P.MODE_CUSTOM);
      assert.equal(P.getBrightness(kb.led, P.effectOf(P.MODE_CUSTOM)), 2);
      assert.equal(kb.perKeyLit, true, 'still lit after the brightness change');
      for (const led of leds) assert.deepEqual(planar(kb.colors, led), RED, `LED ${led} keeps its colour`);
      assert.equal(s.dirty, false);

      // And again, in both directions: every change from the Lighting page keeps them.
      for (const level of [4, 1, 3]) {
        s.setBrightness(level);
        assert.equal((await s.apply()).ok, true);
        assert.equal(kb.perKeyLit, true, `lit at level ${level}`);
        assert.equal(P.getBrightness(kb.led, P.effectOf(P.MODE_CUSTOM)), level);
      }
    });
  });

  test(`${m.id} on the cable: a sleep-time change in per-key mode keeps the colours lit`, async () => {
    await withCable(m, {}, async ({ kb, s }) => {
      s.paintKeys(ledsOf(m), RED);
      await s.apply();
      s.setSleepValue(P.SLEEP_OPTIONS[1].value);
      const r = await s.apply();
      assert.equal(r.ok, true);
      assert.equal(kb.perKeyLit, true);
      assert.equal(kb.led[P.OFF.SLEEP], P.SLEEP_OPTIONS[1].value);
    });
  });

  test(`${m.id} on the dongle: the per-key colours are written again with a brightness change`, async () => {
    const kb = new MockKeyboard({ ledCount: 126, layoutKeys: m.keys });
    const s = new Session({ storage: memoryStorage(), transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
    try {
      assert.equal(await s.connectAuto(), true);
      const leds = ledsOf(m);
      s.paintKeys(leds, RED);
      assert.equal((await s.apply()).ok, true);
      const painted = kb.colors.slice();

      kb.sent.length = 0;
      s.setBrightness(2);
      const r = await s.apply();
      assert.equal(r.ok, true);
      assert.equal(r.colorsResent, true);
      assert.ok(kb.sent.some((p) => p[1] === P.CMD.SET_COLORS), 'the colour block is sent with the config');
      assert.deepEqual(Array.from(kb.colors), Array.from(painted), 'the colours are unchanged');
      assert.equal(P.getMode(kb.led), P.MODE_CUSTOM);
      assert.equal(P.getBrightness(kb.led, P.effectOf(P.MODE_CUSTOM)), 2);
    } finally {
      s.disconnect();
    }
  });
}

test('a brightness change on a built-in effect does not send the per-key colours', async () => {
  await withCable(L.MODELS[0], {}, async ({ kb, s }) => {
    assert.ok(s.setEffect(3));
    s.setBrightness(2);
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.equal(r.colorsResent, false);
    assert.deepEqual(kb.writes.map((w) => w.block), ['led']);
  });
});

test('painting and a brightness change in one apply writes the colours once', async () => {
  await withCable(L.MODELS[0], {}, async ({ kb, s }) => {
    s.paintKeys(ledsOf(L.MODELS[0]), RED);
    s.setBrightness(3);
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.equal(r.colorsResent, false, 'they were edited, not repeated');
    assert.deepEqual(kb.writes.map((w) => w.block), ['colors', 'led']);
    assert.equal(kb.perKeyLit, true);
  });
});

test('cable that cannot hand over the colours: the ones this app wrote are sent again', async () => {
  await withCable(L.MODELS[0], { serves: ['led'] }, async ({ kb, s }) => {
    assert.equal(s.readable.colors, false, 'the colours cannot be read');
    const leds = ledsOf(L.MODELS[0]);
    s.paintKeys(leds, RED);
    await s.apply();

    kb.writes.length = 0;
    s.setBrightness(2);
    const r = await s.apply();
    assert.equal(r.colorsResent, true);
    assert.equal(r.colorsMissing, false);
    assert.equal(kb.perKeyLit, true);
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), RED);
  });
});

test('cable that cannot hand over the colours: after the app is closed and opened again the colours are still sent', async () => {
  const storage = memoryStorage();
  const model = L.MODELS[0];
  const leds = ledsOf(model);
  await withCable(model, { serves: ['led'] }, async ({ s }) => {
    s.paintKeys(leds, RED);
    await s.apply();
  }, storage);

  await withCable(model, { serves: ['led'] }, async ({ kb, s }) => {
    // The keyboard is still in per-key mode; this is a fresh session that knows nothing but what is on this computer.
    kb.led[P.OFF.MODE] = P.MODE_CUSTOM;
    await s.refresh();
    s.setBrightness(2);
    const r = await s.apply();
    assert.equal(r.colorsResent, true);
    assert.equal(kb.perKeyLit, true);
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), RED);
  }, storage);
});

test('cable that cannot hand over the colours and nothing painted yet: the result says the colours could not be sent', async () => {
  await withCable(L.MODELS[0], { serves: ['led'] }, async ({ kb, s }) => {
    kb.led[P.OFF.MODE] = P.MODE_CUSTOM;
    await s.refresh();
    s.setBrightness(2);
    const r = await s.apply();
    assert.equal(r.colorsMissing, true);
    assert.equal(r.colorsResent, false);
    assert.deepEqual(kb.writes.map((w) => w.block), ['led'], 'a stand-in block is never written');
  });
});

test('the demo keyboard never stores per-key colours for the real keyboard', async () => {
  const storage = memoryStorage();
  const kb = new MockKeyboard({ ledCount: 126, layoutKeys: L.MODELS[0].keys });
  const s = new Session({ storage, transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'demo', label: 'Demo keyboard' } }] });
  try {
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'demo');
    s.paintKeys(ledsOf(L.MODELS[0]), RED);
    assert.equal((await s.apply()).ok, true);
    s.setBrightness(2);
    const r = await s.apply();
    assert.equal(r.colorsResent, true, 'the demo keyboard behaves like the real one');
    assert.equal(storage.getItem('aula.perkey.last'), null);
  } finally {
    s.disconnect();
  }
});
