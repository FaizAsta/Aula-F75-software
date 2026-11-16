'use strict';

/*
 * Settings > Keyboard > Reset keyboard. No factory-reset command of these keyboards is known, so the reset is a write of
 * default values through the app's normal, read-back-checked path. These tests run it on every model and every link
 * against the simulated keyboards (F75, F75 Pro, F87 over the 2.4G dongle and the USB-C cable; the F75 Max over its
 * cable and its dongle). Whether a physical keyboard agrees is only settled by plugging one in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../src/js/protocol.js');
const K = require('../src/js/keys.js');
const L = require('../src/js/layout.js');
const W = require('../src/js/webhid.js');
const M = require('../src/js/max.js');
const { KeyAssign } = require('../src/js/keyassign.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, CABLE } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');
const { FakeCable, FakeDongle } = require('./fake-max.js');

const LINKS = ['dongle', 'cable'];
const nonZero = (u) => Array.from(u).map((v, i) => (v ? [i, v] : null)).filter(Boolean);

/** Runs body({ kb, s, storage, layers }) with a connected session on `link` for `model`. */
async function onLink(link, model, kbOpts, body) {
  if (link === 'dongle') {
    const kb = new MockKeyboard({ ledCount: 126, layoutKeys: model.keys, ...kbOpts });
    const storage = memoryStorage();
    const s = new Session({ storage, transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
    try {
      assert.equal(await s.connectAuto(), true, `${model.id}: dongle connects`);
      await body({ kb, s, storage, layers: (i) => kb.matrix[i] });
    } finally {
      s.disconnect();
    }
    return;
  }
  const [hid, restore] = installFakeHid();
  let s;
  try {
    const kb = new CableKeyboard({ layoutKeys: model.keys, ...kbOpts });
    hid.add(CABLE, kb);
    const storage = memoryStorage();
    s = new Session({ storage, transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true, `${model.id}: cable connects`);
    await body({ kb, s, storage, layers: (i) => kb.layers[i] });
  } finally {
    if (s) s.disconnect();
    restore();
  }
}

/** What a known effect's slot must hold after a reset. */
// (The per-key slot's colour nibble means nothing to the keyboard; it is set like the others and not settled.)
const wantColour = (e) => (e.custom || e.colorful || e.multi ? P.MULTICOLOR : 0);

function assertFactoryLed(led, label) {
  assert.equal(P.getMode(led), P.FACTORY.mode, `${label}: running effect`);
  assert.equal(led[P.OFF.SLEEP], P.FACTORY.sleep, `${label}: sleep time`);
  for (const e of P.EFFECTS) {
    assert.equal(P.getBrightness(led, e), P.FACTORY.brightness, `${label}: ${e.name} brightness`);
    assert.equal(P.getSpeed(led, e), P.FACTORY.speed, `${label}: ${e.name} speed`);
    assert.equal(P.getColorIndex(led, e), wantColour(e), `${label}: ${e.name} colour choice`);
  }
}

// ------------------------------------------------------------------ the helpers

test('factoryLed: sets the effect, sleep and every known slot, and leaves every other byte alone', () => {
  const led = new Uint8Array(P.LED_SIZE).fill(0x33);
  led[0x7e] = 0x5a;
  led[0x7f] = 0xa5;
  led[P.OFF.KNOB] = 1;
  led[P.OFF.APPLY] = 1;
  led[P.OFF.COLOR_MODE] = 3;
  const before = led.slice();
  const out = P.factoryLed(led);
  assert.deepEqual([...led], [...before], 'the input is not changed');
  assertFactoryLed(out, 'factoryLed');
  assert.equal(P.isValidLed(out), true);
  assert.equal(out[P.OFF.KNOB], 1, 'the knob function belongs to the keyboard');
  assert.equal(out[P.OFF.APPLY], 1);
  assert.equal(out[P.OFF.COLOR_MODE], 3);
  // Only the bytes of the mode, the sleep time and the known slots may differ.
  const slots = new Set(P.EFFECTS.flatMap((e) => [P.slotByte(e.slot, 0), P.slotByte(e.slot, 1)]));
  for (let i = 0; i < led.length; i++) {
    if (i === P.OFF.MODE || i === P.OFF.SLEEP || slots.has(i)) continue;
    assert.equal(out[i], led[i], `byte ${i} is untouched`);
  }
});

test('factoryRgb: factory colours in every effect slot, the rest of the table (and its length) kept', () => {
  for (const len of [420, 512]) {
    const rgb = new Uint8Array(len).fill(0x77);
    const out = P.factoryRgb(rgb);
    assert.equal(out.length, len);
    for (let slot = 0; slot < 19; slot++) {
      for (let j = 0; j < 7; j++) assert.deepEqual(Array.from(out.slice(P.palOffset(slot, j), P.palOffset(slot, j) + 3)), Array.from(P.defaultRgb().slice(P.palOffset(slot, j), P.palOffset(slot, j) + 3)));
    }
    assert.equal(out[0], 0x77, 'the header is kept');
    if (len === 512) assert.equal(out[511], 0x77, 'bytes past the table are kept');
  }
  assert.doesNotThrow(() => P.factoryRgb(new Uint8Array(30)), 'a short table is not overrun');
});

// ------------------------------------------------------------------ F75, F75 Pro, F87: lighting, palette, per-key colours

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: Reset keyboard puts lighting, palette and per-key colours back, and keeps the knob`, async () => {
      await onLink(link, m, {}, async ({ kb, s }) => {
        // A keyboard that is far from its defaults.
        s.setEffect(10);
        s.setBrightness(2);
        s.setSpeed(4);
        s.setColorIndex(1);
        s.setPaletteColor(0, [1, 2, 3]);
        s.setPaletteColor(5, [9, 8, 7]);
        s.paintKeys(m.keys.map((k) => k.led), [200, 100, 50]);
        s.setSleepValue(P.SLEEP_OPTIONS[8].value);
        assert.equal((await s.apply()).ok, true);
        kb.led[P.OFF.KNOB] = 1; // the person switched the knob to volume on the keyboard
        await s.refresh();
        assert.equal(P.getMode(s.dev0.led), P.MODE_CUSTOM, 'set-up: per-key mode');
        assert.notDeepEqual(nonZero(s.dev0.colors), [], 'set-up: keys are painted');

        // An unsaved edit is dropped by the reset.
        s.setBrightness(1);
        assert.equal(s.dirty, true);

        const r = await s.factoryReset();
        assert.equal(r.ok, true, r.error);
        assert.equal(r.modeOk, true);
        assert.deepEqual(r.skipped, []);
        assert.deepEqual([...r.written].sort(), ['colors', 'led', 'rgb']);
        assert.equal(s.dirty, false);
        assert.equal(s.restoring, false);

        // What the keyboard itself holds.
        assertFactoryLed(kb.led, `${m.id}/${link} keyboard`);
        assert.notEqual(P.getMode(kb.led), P.MODE_CUSTOM, 'the effect is not the per-key one');
        assert.equal(kb.led[P.OFF.KNOB], 1, 'the knob function was not touched');
        const factoryRgb = P.defaultRgb();
        assert.deepEqual(Array.from(kb.rgb.slice(0, factoryRgb.length)), Array.from(factoryRgb), 'factory palette');
        assert.deepEqual(nonZero(kb.colors), [], 'every key light is off');
        // And what the app shows.
        assertFactoryLed(s.cur.led, `${m.id}/${link} app`);
        assert.deepEqual(nonZero(s.cur.colors), []);

        // A second reset has nothing left to write.
        const again = await s.factoryReset();
        assert.equal(again.ok, true);
        assert.deepEqual(again.written, []);
      });
    });
  }
}

test('a link that cannot read the palette or the per-key colours: those are not written with a stand-in, and the reset says so', async () => {
  await onLink('cable', L.MODELS[0], { serves: ['led', 'matrix'] }, async ({ kb, s }) => {
    assert.deepEqual(s.unread.sort(), ['colors', 'rgb']);
    const rgbBefore = kb.rgb.slice();
    s.setEffect(10);
    s.setBrightness(2);
    assert.equal((await s.apply()).ok, true);
    const r = await s.factoryReset();
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.skipped, ['palette', 'per-key colours']);
    assert.deepEqual(r.written, ['led']);
    assertFactoryLed(kb.led, 'cable without palette');
    assert.deepEqual([...kb.rgb], [...rgbBefore], 'the palette on the keyboard was not touched');
    assert.equal(kb.writes.some((w) => w.block === 'rgb' || w.block === 'colors'), false, 'no palette or colour write was sent');
  });
});

test('Reset keyboard drops the red low-battery light and the remembered settings follow the reset', async () => {
  await onLink('dongle', L.MODELS[0], {}, async ({ kb, s }) => {
    s.setKeep(true);
    s.setEffect(5);
    s.setBrightness(2);
    assert.equal((await s.apply()).ok, true);
    assert.equal(P.getMode(s.keepSnapshot().led), 5, 'set-up: the app remembers Raindrops');
    const r = await s.factoryReset();
    assert.equal(r.ok, true, r.error);
    assert.equal(P.getMode(s.keepSnapshot().led), P.FACTORY.mode, 'the remembered settings are the reset ones, so "restore after a reset" does not undo it');
    assert.equal(s.keepDiffers(), false);
    assert.equal(s.lowLight, false);
    assertFactoryLed(kb.led, 'dongle with keep on');
  });
});

test('Reset keyboard: a second reset started while one runs is refused, and a keyboard that ignores writes is reported, not thrown', async () => {
  await onLink('dongle', L.MODELS[0], {}, async ({ s }) => {
    s.setEffect(5);
    assert.equal((await s.apply()).ok, true);
    const [a, b] = await Promise.all([s.factoryReset(), s.factoryReset()]);
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, false);
    assert.equal(b.busy, true);
  });
  await onLink('dongle', L.MODELS[0], { dropWrites: true }, async ({ s }) => {
    s.setEffect(5);
    const r = await s.factoryReset();
    assert.equal(r.ok, false, 'the keyboard kept nothing');
    assert.equal(s.restoring, false, 'the session is free again');
    assert.equal(s.dirty, false, 'the screen shows what the keyboard really holds');
  });
  const idle = new Session({ storage: memoryStorage(), discover: async () => [] });
  const r = await idle.factoryReset();
  assert.equal(r.ok, false);
  assert.match(r.error, /not connected/);
});

// ------------------------------------------------------------------ F75, F75 Pro, F87: keys you reassigned

const keyAssign = (s, storage, model) => new KeyAssign({ transport: () => s.transport, keys: () => model.keys, model: () => model.id, storage });

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: Reset keyboard puts reassigned keys back on both layers and never touches Fn`, async () => {
      await onLink(link, m, {}, async ({ s, storage, layers }) => {
        const ka = keyAssign(s, storage, m);
        await ka.load(); // the first look at this keyboard: its layers are filed as the originals
        const factory = [layers(0).slice(), layers(1).slice()];
        const fnLed = m.keys.find((k) => k.n === 'Fn').led;
        const change = m.keys.filter((k) => k.led !== fnLed && !ka.codeOf(0, k.led).protected).slice(0, 12);
        for (const layer of [0, 1]) {
          const edits = new Map(change.filter((k) => !ka.codeOf(layer, k.led).protected).map((k) => [k.led, K.encode({ kind: 'key', usage: 0x68 })]));
          const r = await ka.apply(layer, edits);
          assert.equal(r.ok, true, r.error);
        }
        assert.notDeepEqual([...layers(0)], [...factory[0]], 'set-up: keys were reassigned');

        const k = await ka.resetToOriginal();
        assert.equal(k.ok, true, k.error);
        assert.equal(k.skipped, false);
        assert.ok(k.changed > 0);
        assert.equal(k.failed, 0);
        assert.deepEqual([...layers(0)], [...factory[0]], 'layer 0 is back');
        assert.deepEqual([...layers(1)], [...factory[1]], 'layer 1 is back');
        assert.equal(ka.codeOf(0, fnLed).kind, 'fn');

        // Nothing to put back the second time, and nothing is written.
        const again = await ka.resetToOriginal();
        assert.deepEqual({ ok: again.ok, changed: again.changed, failed: again.failed }, { ok: true, changed: 0, failed: 0 });
      });
    });
  }
}

test('key reset: a keyboard whose key layers cannot be read is left alone and the reason is returned', async () => {
  await onLink('dongle', L.MODELS[0], { matrix: false }, async ({ s, storage, layers }) => {
    const ka = keyAssign(s, storage, L.MODELS[0]);
    const before = layers(0).slice();
    const k = await ka.resetToOriginal();
    assert.equal(k.ok, false);
    assert.equal(k.skipped, true);
    assert.ok(k.error);
    assert.deepEqual([...layers(0)], [...before]);
  });
  const none = new KeyAssign({ transport: () => null, keys: () => L.MODELS[0].keys, model: () => 'f75', storage: memoryStorage() });
  const r = await none.resetToOriginal();
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
});

// ------------------------------------------------------------------ F75 Max

async function maxSession(devices) {
  const s = new M.MaxSession({ hid: { getDevices: async () => devices.slice() }, storage: memoryStorage(), delayMs: 0 });
  await s.scan();
  return s;
}

test('F75 Max over USB-C: Reset keyboard clears the per-key table, then writes the default lighting and settings', async () => {
  const cable = new FakeCable();
  const s = await maxSession([cable]);
  s.setLighting({ mode: 7, rgb: [10, 20, 30], brightness: 2, speed: 5, direction: 1, colorful: true });
  s.setSettings({ response: 4, sleep: 3, winLock: true, altF4Lock: true, altTabLock: true, fnSwitch: true });
  s.paint([M.KEYS.esc, M.KEYS.space], [200, 100, 50]);

  const r = await s.factoryReset();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, true);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.via, 'cable');
  assert.deepEqual(cable.ops(), [
    '18', '13', 'data', '02', 'f0', // the user-defined mode, so the table below is taken
    '18', '23', ...new Array(9).fill('data'), '02', 'f0', // an empty per-key table
    '18', '13', 'data', '02', 'f0', // the default lighting, which also leaves the user-defined mode
    '18', '17', 'data', '02', // the default settings
  ]);
  const sent = cable.sent;
  // Table packets (after begin, select) carry only the trailer.
  const table = Buffer.concat(sent.slice(7, 16).map((b) => Buffer.from(b)));
  assert.deepEqual(nonZero(table), [[574, 0xaa], [575, 0x55]], 'no key is lit');
  // Lighting payload: Wave, 6E7BFF, brightness 4, speed 3, direction Right, one colour.
  assert.deepEqual(nonZero(sent[20]), [[0, 10], [1, 0x6e], [2, 0x7b], [3, 0xff], [9, 4], [10, 3], [14, 0xaa], [15, 0x55]]);
  // Settings payload: response 2, sleep 2, every switch off.
  assert.deepEqual(nonZero(sent[sent.length - 2]), [[1, 1], [6, 2], [8, 2], [62, 0xaa], [63, 0x55]]);
  // What the app remembers is now the default.
  assert.deepEqual(s.lighting, { ...M.DEFAULT_LIGHTING });
  assert.deepEqual(s.settings, { ...M.DEFAULT_SETTINGS });
  assert.equal(s.keyColors.size, 0);
  assert.equal(s.last.name, 'reset');
  assert.equal(s.busy, false);
});

test('F75 Max over the 2.4G dongle: lighting and response/sleep are reset; the per-key table and key locks need the cable and are kept', async () => {
  const dongle = new FakeDongle();
  const s = await maxSession([dongle]);
  s.setLighting({ mode: 7, brightness: 2 });
  s.setSettings({ response: 4, sleep: 3, winLock: true, fnSwitch: true });
  s.paint([M.KEYS.esc], [1, 2, 3]);

  const r = await s.factoryReset();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.via, 'dongle');
  assert.equal(r.confirmed, false, 'the dongle does not confirm');
  assert.deepEqual(r.skipped, ['per-key colours', 'key locks']);
  assert.deepEqual(dongle.sent.map((b) => Array.from(b)), [M.rgbCommitReport(), M.rgbReport(M.DEFAULT_LIGHTING), M.responseReport(M.DEFAULT_SETTINGS)].map((b) => Array.from(b)));
  assert.deepEqual(s.lighting, { ...M.DEFAULT_LIGHTING });
  assert.equal(s.settings.response, M.DEFAULT_SETTINGS.response);
  assert.equal(s.settings.sleep, M.DEFAULT_SETTINGS.sleep);
  assert.equal(s.settings.fnSwitch, false, 'the Fn switch is sent over the dongle too');
  assert.equal(s.settings.winLock, true, 'the key locks were not written, so they are not remembered as reset');
  assert.equal(s.keyColors.size, 1, 'the painted key is still remembered: it was not cleared on the keyboard');
});

test('F75 Max: a keyboard that refuses a step is reported, and what the app remembers is put back', async () => {
  const cable = new FakeCable({ rejectOp: 0x13 });
  const s = await maxSession([cable]);
  s.setLighting({ mode: 7, brightness: 2 });
  s.paint([M.KEYS.esc], [1, 2, 3]);
  const r = await s.factoryReset();
  assert.equal(r.ok, false);
  assert.match(r.error, /did not accept/);
  assert.equal(s.lighting.mode, 7, 'the memory still matches the keyboard');
  assert.equal(s.keyColors.size, 1);
  assert.equal(s.busy, false);
});

test('F75 Max with both links: the reset goes over the cable, which acknowledges every step', async () => {
  const cable = new FakeCable();
  const dongle = new FakeDongle();
  const s = await maxSession([cable, dongle]);
  const r = await s.factoryReset();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.via, 'cable');
  assert.equal(dongle.sent.length, 0);
});

test('F75 Max: nothing plugged in gives a clear error, not a crash', async () => {
  const s = await maxSession([]);
  const r = await s.factoryReset();
  assert.equal(r.ok, false);
  assert.match(r.error, /No F75 Max/);
});

// ------------------------------------------------------------------ the button

test('the button sits in Settings > Keyboard, is wired, and asks for a second click', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const page = html.slice(html.indexOf('id="setpage-keyboard"'), html.indexOf('id="setpage-app"'));
  assert.match(page, /id="kbReset"/, 'in the Keyboard page of Settings');
  assert.match(page, /Reset keyboard/);
  const app = fs.readFileSync(path.join(__dirname, '../src/js/app.js'), 'utf8');
  assert.match(app, /getElementById|\$\('#kbReset'\)\.addEventListener\('click'/);
  assert.match(app, /Click again to reset/);
  assert.match(app, /session\.factoryReset\(/);
  assert.match(app, /MXU\.max;[\s\S]*max\.factoryReset\(\)/, 'the F75 Max has its own reset');
  assert.match(app, /resetToOriginal\(\)/);
});
