'use strict';

/*
 * The red low-battery light: the Breathing effect in red at half brightness while the battery is low, and the person's own
 * lighting written back afterwards. It must never be remembered as the person's settings, must survive a restart of the
 * app, and must give way when the person applies lighting of their own.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const W = require('../src/js/webhid.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage, LOW_LIGHT } = require('../src/js/engine.js');
const { installFakeHid, DONGLE, wait } = require('./fake-hid.js');

const BREATHING = P.effectOf(LOW_LIGHT.mode);

async function withDongle(body, { battery = 15, storage = memoryStorage(), kbOpts = {} } = {}) {
  const [hid, restore] = installFakeHid();
  const kb = new MockKeyboard({ battery, ...kbOpts });
  hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, kb);
  const mk = () => new Session({ storage, transportTimeout: 100, tickMs: 60000, syncMs: 60000, discover: () => W.discover() });
  const s = mk();
  try {
    assert.equal(await s.connectAuto(), true);
    await body(s, kb, { storage, mk });
  } finally {
    s.unwatch();
    s.disconnect();
    await wait(60);
    restore();
  }
}

const palette0 = (kb) => Array.from(P.getPaletteColor(kb.rgb, BREATHING, 0));

test('the light writes Breathing in red at half brightness, and the lighting comes back exactly', async () => {
  await withDongle(async (s, kb) => {
    const led0 = Array.from(kb.led);
    const rgb0 = Array.from(kb.rgb);
    const colors0 = Array.from(kb.colors);
    assert.equal(s.lowLight, false);

    const on = await s.setLowLight(true);
    assert.deepEqual({ state: on.state, changed: on.changed }, { state: 'on', changed: true });
    assert.equal(s.lowLight, true);
    assert.equal(P.getMode(kb.led), BREATHING.mode);
    assert.deepEqual(palette0(kb), [255, 0, 0]);
    assert.equal(P.getColorIndex(kb.led, BREATHING), 0, 'uses the first palette colour, not multicolour');
    assert.equal(P.getBrightness(kb.led, BREATHING), Math.round(s.brightMax / 2), 'half of the levels (level 2 of 4)');
    assert.equal(P.getBrightness(kb.led, BREATHING), 2);

    const off = await s.setLowLight(false);
    assert.deepEqual({ state: off.state, changed: off.changed }, { state: 'off', changed: true });
    assert.equal(s.lowLight, false);
    assert.ok(P.sameLed(kb.led, Uint8Array.from(led0)), 'the lighting block is exactly as it was');
    assert.deepEqual(Array.from(kb.rgb), rgb0, 'the palette is exactly as it was');
    assert.deepEqual(Array.from(kb.colors), colors0);
  });
});

test('half brightness follows how many levels the keyboard has', async () => {
  await withDongle(async (s, kb) => {
    s.setBrightMax(9);
    await s.setLowLight(true);
    assert.equal(P.getBrightness(kb.led, BREATHING), 5);
  });
});

test('asking for the state the keyboard is already in writes nothing', async () => {
  await withDongle(async (s, kb) => {
    const before = kb.saves;
    assert.deepEqual(await s.setLowLight(false), { state: 'off', changed: false });
    assert.equal(kb.saves, before);
    await s.setLowLight(true);
    const mid = kb.saves;
    assert.deepEqual(await s.setLowLight(true), { state: 'on', changed: false });
    assert.equal(kb.saves, mid);
  });
});

test('the red light is never remembered as the person\'s settings', async () => {
  await withDongle(async (s, kb) => {
    s.setKeep(true);
    s.rememberNow();
    const kept = s.keepSnapshot();
    assert.ok(kept, 'the person\'s settings are remembered');
    await s.setLowLight(true);
    const during = s.keepSnapshot();
    assert.deepEqual(Array.from(during.led), Array.from(kept.led), 'still the person\'s lighting, not the red one');
    assert.deepEqual(Array.from(during.rgb), Array.from(kept.rgb));
    // and the restore feature does not write the remembered settings over the red light behind its back
    assert.equal((await s._restoreKept({ force: true })).reason, 'low-battery light');
    assert.equal(P.getMode(kb.led), BREATHING.mode);
  });
});

test('a change made on the keyboard while the light is red is not remembered either', async () => {
  await withDongle(async (s, kb) => {
    s.setKeep(true);
    s.rememberNow();
    const kept = Array.from(s.keepSnapshot().led);
    await s.setLowLight(true);
    P.setBrightness(kb.led, BREATHING, 4); // Fn shortcut on the keyboard
    await s._syncFromKeyboard();
    assert.deepEqual(Array.from(s.keepSnapshot().led), kept);
  });
});

test('lighting the person applies while the light is red ends it, and nothing is put back over their choice', async () => {
  await withDongle(async (s, kb) => {
    await s.setLowLight(true);
    s.setEffect(1); // Static
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.equal(s.lowLight, false);
    assert.equal(P.getMode(kb.led), 1);
    assert.deepEqual(await s.setLowLight(false), { state: 'off', changed: false });
    assert.equal(P.getMode(kb.led), 1, 'their choice stays');
  });
});

test('unsent edits are not overwritten by the light', async () => {
  await withDongle(async (s, kb) => {
    s.setBrightness(1);
    const r = await s.setLowLight(true);
    assert.deepEqual({ state: r.state, changed: r.changed, reason: r.reason }, { state: 'off', changed: false, reason: 'edits' });
    assert.equal(s.cur.led[P.slotByte(P.effectOf(P.getMode(s.cur.led)).slot, 0)], 1, 'the edit is still there');
    assert.notEqual(P.getMode(kb.led), BREATHING.mode);
  });
});

test('nothing is written when the keyboard is not connected', async () => {
  const s = new Session({ storage: memoryStorage(), discover: async () => [] });
  const r = await s.setLowLight(true);
  assert.deepEqual({ state: r.state, changed: r.changed, reason: r.reason }, { state: 'off', changed: false, reason: 'not-connected' });
});

test('a keyboard that ignores the write is left as it was and the light is not reported as on', async () => {
  await withDongle(async (s, kb) => {
    const led0 = Uint8Array.from(kb.led);
    kb.dropWrites = true;
    const r = await s.setLowLight(true);
    assert.equal(r.changed, false);
    assert.equal(r.reason, 'write-failed');
    assert.equal(s.lowLight, false);
    assert.ok(P.sameLed(kb.led, led0));
  });
});

test('a restart of the app while the light is red puts the lighting back afterwards', async () => {
  const storage = memoryStorage();
  let led0;
  let rgb0;
  await withDongle(
    async (s, kb) => {
      led0 = Uint8Array.from(kb.led);
      rgb0 = Array.from(kb.rgb);
      await s.setLowLight(true);
      assert.equal(s.lowLight, true);
      // The app closes here: the keyboard keeps the red light, the storage keeps the lighting to put back.
      s.unwatch();
      s.disconnect();
      await wait(60);

      const s2 = new Session({ storage, transportTimeout: 100, tickMs: 60000, syncMs: 60000, discover: () => W.discover() });
      assert.equal(s2.lowLight, true, 'the new run knows the light is red');
      assert.equal(await s2.connectAuto(), true);
      assert.equal(P.getMode(kb.led), BREATHING.mode, 'connecting writes nothing');
      const off = await s2.setLowLight(false);
      assert.equal(off.changed, true);
      assert.equal(s2.lowLight, false);
      assert.ok(P.sameLed(kb.led, led0));
      assert.deepEqual(Array.from(kb.rgb), rgb0);
      assert.equal(storage.getItem('aula.lowlight.saved'), null, 'nothing is left to put back');
      s2.unwatch();
      s2.disconnect();
    },
    { storage }
  );
});

test('the saved lighting is dropped when it belongs to another keyboard layout', async () => {
  const storage = memoryStorage();
  const stale = { at: Date.now(), led: Array.from(new MockKeyboard().led), rgb: [1, 2, 3], colors: [4, 5, 6] };
  storage.setItem('aula.lowlight.saved', JSON.stringify(stale));
  await withDongle(
    async (s, kb) => {
      assert.equal(s.lowLight, true);
      const led0 = Uint8Array.from(kb.led);
      const r = await s.setLowLight(false);
      assert.deepEqual({ state: r.state, changed: r.changed, reason: r.reason }, { state: 'off', changed: true, reason: 'layout' });
      assert.equal(s.lowLight, false);
      assert.ok(P.sameLed(kb.led, led0), 'nothing was written');
    },
    { storage }
  );
});
