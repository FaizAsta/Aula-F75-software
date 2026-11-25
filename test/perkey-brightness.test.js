'use strict';

/*
 * Per-key colours must survive a lighting change made on another page, and the brightness level must dim them.
 *
 * Reported on the F75: paint keys, Apply (they light), then change the brightness on the Lighting page (the Per-key page has no
 * brightness control) and Apply: the whole keyboard went dark and the colours were gone until the keys were painted again.
 * A config sent on its own while Per-key is the effect shows nothing, so the colours now go out with it. The same holds for
 * every model (F75, F75 Pro, F87 share the protocol) on the 2.4G dongle and the USB-C cable, and for a sleep-time change.
 *
 * Reported later: with Per-key as the effect the brightness level had no effect, the keys stayed at full strength at 0, 1 or any
 * level. The firmware ignores the per-key effect's brightness byte, so the app applies the level to the colours it sends: the
 * keyboard holds the colours dimmed, the app keeps (and shows, and remembers) the colours at full strength.
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
const LEVELS = 4; // these tests are about a 4-level setup: the app now starts with nine, so the stored choice is pinned to four
const fourLevels = () => {
  const st = memoryStorage();
  st.setItem('aula.bright.max', '4');
  return st;
};
const dim = (rgb, level) => rgb.map((v) => Math.round((v * level) / LEVELS));

async function withCable(model, kbOpts, body, storage = fourLevels()) {
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
      for (const led of leds) {
        assert.deepEqual(planar(kb.colors, led), dim(RED, 2), `LED ${led} is at half strength on the keyboard`);
        assert.deepEqual(planar(s.cur.colors, led), RED, `LED ${led} is still the painted colour in the app`);
      }
      assert.equal(s.dirty, false);

      // And again, in both directions: every change from the Lighting page keeps them lit, at the level chosen.
      for (const level of [4, 1, 3]) {
        s.setBrightness(level);
        assert.equal((await s.apply()).ok, true);
        assert.equal(kb.perKeyLit, true, `lit at level ${level}`);
        assert.equal(P.getBrightness(kb.led, P.effectOf(P.MODE_CUSTOM)), level);
        for (const led of leds) {
          assert.deepEqual(planar(kb.colors, led), dim(RED, level), `LED ${led} at level ${level}`);
          assert.deepEqual(planar(s.cur.colors, led), RED, 'the app keeps the full colour, so going up again brings it back');
        }
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
    const s = new Session({ storage: fourLevels(), transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
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
      assert.deepEqual(Array.from(kb.colors), Array.from(P.dimColors(painted, 0.5)), 'the colours go out at half strength');
      assert.deepEqual(Array.from(s.cur.colors), Array.from(painted), 'the app keeps them at full strength');
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
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), dim(RED, 2), 'dimmed by the level even though they cannot be read back');
  });
});

test('cable that cannot hand over the colours: after the app is closed and opened again the colours are still sent', async () => {
  const storage = fourLevels();
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
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), dim(RED, 2), 'the remembered full-strength colours, dimmed');
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
  const storage = fourLevels();
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

for (const m of L.MODELS) {
  test(`${m.id}: at brightness 0 the per-key keys go dark, and the colours come back at a higher level`, async () => {
    await withCable(m, {}, async ({ kb, s }) => {
      const leds = ledsOf(m);
      s.paintKeys(leds, RED);
      await s.apply();
      s.setBrightness(0);
      assert.equal((await s.apply()).ok, true);
      assert.equal(kb.colors.every((v) => v === 0), true, 'every key is dark at level 0');
      for (const led of leds) assert.deepEqual(planar(s.cur.colors, led), RED, 'the painted colours are not lost');
      s.setBrightness(4);
      assert.equal((await s.apply()).ok, true);
      for (const led of leds) assert.deepEqual(planar(kb.colors, led), RED, 'full strength again');
    });
  });
}

test('painting keys while the brightness is lowered sends them dimmed, and the app still holds what was painted', async () => {
  await withCable(L.MODELS[0], {}, async ({ kb, s }) => {
    const leds = ledsOf(L.MODELS[0]);
    s.paintKeys(leds, RED);
    await s.apply();
    s.setBrightness(1);
    await s.apply();
    const more = L.MODELS[0].keys.slice(3, 5).map((k) => k.led);
    s.paintKeys(more, [0, 200, 100]);
    const r = await s.apply();
    assert.equal(r.ok, true);
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), dim(RED, 1));
    for (const led of more) {
      assert.deepEqual(planar(kb.colors, led), dim([0, 200, 100], 1));
      assert.deepEqual(planar(s.cur.colors, led), [0, 200, 100]);
    }
    assert.equal(s.dirty, false, 'nothing is left waiting to be applied');
  });
});

test('after the app is opened again the colours show at full strength, not as the dimmed copy the keyboard holds', async () => {
  const storage = fourLevels();
  const model = L.MODELS[0];
  const leds = ledsOf(model);
  let held;
  await withCable(model, {}, async ({ kb, s }) => {
    s.paintKeys(leds, RED);
    await s.apply();
    s.setBrightness(2);
    await s.apply();
    held = kb.colors.slice();
  }, storage);

  await withCable(model, {}, async ({ kb, s }) => {
    kb.colors = held.slice();
    kb.led[P.OFF.MODE] = P.MODE_CUSTOM;
    P.setBrightness(kb.led, P.effectOf(P.MODE_CUSTOM), 2);
    await s.refresh();
    for (const led of leds) assert.deepEqual(planar(s.cur.colors, led), RED, 'the painted colour, not half of it');
    assert.equal(s.dirty, false);
    // Raising the level from here reaches full strength: the dimmed copy has not become the colour.
    s.setBrightness(4);
    assert.equal((await s.apply()).ok, true);
    for (const led of leds) assert.deepEqual(planar(kb.colors, led), RED);
  }, storage);
});

test('colours that something else put on the keyboard are taken as they are', async () => {
  const storage = fourLevels();
  const model = L.MODELS[0];
  const leds = ledsOf(model);
  await withCable(model, {}, async ({ kb, s }) => {
    s.paintKeys(leds, RED);
    await s.apply();
    s.setBrightness(2);
    await s.apply();
    const other = kb.colors.slice();
    for (const led of leds) {
      other[led] = 10;
      other[led + 126] = 20;
      other[led + 252] = 30;
    }
    kb.colors = other;
    await s.refresh();
    for (const led of leds) assert.deepEqual(planar(s.cur.colors, led), [10, 20, 30], 'not replaced by the red the app remembers');
  }, storage);
});

test('a brightness change on the Lighting page for another effect leaves the per-key colours alone', async () => {
  await withCable(L.MODELS[0], {}, async ({ kb, s }) => {
    const leds = ledsOf(L.MODELS[0]);
    s.paintKeys(leds, RED);
    await s.apply();
    s.setBrightness(2);
    await s.apply();
    const held = kb.colors.slice();
    assert.ok(s.setEffect(3));
    s.setBrightness(1);
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.equal(r.colorsResent, false);
    assert.deepEqual(Array.from(kb.colors), Array.from(held), 'the colours on the keyboard are untouched');
    for (const led of leds) assert.deepEqual(planar(s.cur.colors, led), RED, 'and the app still has them at full strength');
  });
});

test('protocol: levelShare and dimColors', () => {
  assert.equal(P.levelShare(0, 4), 0);
  assert.equal(P.levelShare(2, 4), 0.5);
  assert.equal(P.levelShare(4, 4), 1);
  assert.equal(P.levelShare(9, 4), 1, 'never brighter than full');
  assert.equal(P.levelShare(-1, 4), 0);
  assert.equal(P.levelShare(3, 6), 0.5, 'follows the number of levels the keyboard has');
  const src = Uint8Array.from([0, 100, 255]);
  assert.deepEqual(Array.from(P.dimColors(src, 0.5)), [0, 50, 128]);
  assert.deepEqual(Array.from(P.dimColors(src, 0)), [0, 0, 0]);
  const full = P.dimColors(src, 1);
  assert.deepEqual(Array.from(full), Array.from(src));
  assert.notEqual(full, src, 'always a copy');
});
