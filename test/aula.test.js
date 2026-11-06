'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const { Transport } = require('../src/js/transport.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const L = require('../src/js/layout.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(15);
  }
  return false;
}

function makeSession(mockOpts = {}, sessionOpts = {}) {
  const mock = new MockKeyboard(mockOpts);
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle' } }],
    ...sessionOpts,
  });
  return { mock, s };
}

// ------------------------------------------------------------------ packets

test('packets carry report ID, framing and a modulo-256 checksum', () => {
  const p = P.buildPacket(0x44, 1, 0, 0);
  assert.equal(p.length, 20);
  assert.equal(p[0], 0x13);
  assert.equal(p[1], 0x44);
  assert.equal(p[19], (0x13 + 0x44 + 1) & 0xff);

  const big = P.buildPacket(0x04, 10, 3, 14, new Uint8Array(14).fill(0xff));
  let sum = 0;
  for (let i = 0; i < 19; i++) sum += big[i];
  assert.equal(big[19], sum & 0xff);
});

test('normalizeInput accepts 19 bytes (WebHID) and 20 bytes (with report ID)', () => {
  const full = P.buildPacket(0x4a, 1, 0, 1, Uint8Array.of(55));
  assert.deepEqual(P.normalizeInput(full), full);
  assert.deepEqual(P.normalizeInput(full.slice(1)), full);
  assert.equal(P.normalizeInput(new Uint8Array(7)), null);
  assert.deepEqual(P.normalizeInput(new DataView(full.slice(1).buffer)), full);
});

test('parseFragment splits flags, count, index and length', () => {
  const f = P.parseFragment(P.buildPacket(0x44, 10, 4, 0x0e, new Uint8Array(14).fill(7)));
  assert.equal(f.cmd, 0x44);
  assert.equal(f.total, 10);
  assert.equal(f.idx, 4);
  assert.equal(f.len, 14);
  assert.equal(f.error, false);
  assert.equal(P.parseFragment(P.buildPacket(0xc4, 1, 0, 0)).error, true);
});

// -------------------------------------------------------------- config maths

test('effect slots follow the firmware table (modes 9, 14, 18 still reserve a slot)', () => {
  assert.equal(P.effectOf(1).slot, 0);
  assert.equal(P.effectOf(10).slot, 9);
  assert.equal(P.effectOf(17).slot, 16);
  assert.equal(P.effectOf(21).slot, 18);
  assert.equal(P.effectOf(9), null);
  assert.equal(P.effectOf(0).off, true);
});

test('speed and colour index share a byte without clobbering each other', () => {
  const led = new Uint8Array(P.LED_SIZE);
  const e = P.effectOf(2);
  P.setColorIndex(led, e, 5);
  P.setSpeed(led, e, 3);
  assert.equal(P.getColorIndex(led, e), 5);
  assert.equal(P.getSpeed(led, e), 3);
  P.setColorIndex(led, e, 7);
  assert.equal(P.getSpeed(led, e), 3);
  P.setSpeed(led, e, 99);
  assert.equal(P.getSpeed(led, e), P.LEVEL_MAX);
  assert.equal(P.getColorIndex(led, e), 7);
});

test('setMode changes only the effect number; the apply flag is cleared when writing', () => {
  const led = new Uint8Array(P.LED_SIZE);
  led[0x7e] = 0x5a;
  led[0x7f] = 0xa5;
  led[P.OFF.APPLY] = 1; // what the firmware leaves behind after applying a config
  led[P.OFF.COLOR_MODE] = 1;
  P.setMode(led, 21);
  assert.equal(led[P.OFF.MODE], 21);
  assert.equal(led[P.OFF.APPLY], 1);
  const out = P.prepareLedForWrite(led, P.effectOf(21));
  assert.equal(out[P.OFF.APPLY], 0);
  assert.equal(out[P.OFF.COLOR_MODE], 1);
  assert.equal(led[P.OFF.APPLY], 1, 'the editable copy is left alone');
  assert.equal(P.sameLed(led, out), true, 'comparison ignores the apply flag');
});

test('colourful-only effects always run multicolour and Static never does', () => {
  const led = new Uint8Array(P.LED_SIZE);
  for (const mode of [3, 15, 16, 17]) {
    const e = P.effectOf(mode);
    assert.equal(e.colorful, true, e.name);
    P.setColorIndex(led, e, 2);
    assert.equal(P.effectiveColorIndex(led, e), P.MULTICOLOR, e.name);
    P.settleColor(led, e);
    assert.equal(P.getColorIndex(led, e), P.MULTICOLOR, e.name);
  }
  const st = P.effectOf(1);
  assert.equal(st.multi, false);
  P.setColorIndex(led, st, P.MULTICOLOR);
  assert.equal(P.effectiveColorIndex(led, st), 0);
  const br = P.effectOf(2);
  P.setColorIndex(led, br, P.MULTICOLOR);
  assert.equal(P.effectiveColorIndex(led, br), P.MULTICOLOR, 'effects that offer both keep the choice');
});

test('per-key colours are planar and bounds-checked', () => {
  const colors = new Uint8Array(96 * 3);
  assert.ok(P.setKeyColor(colors, 10, [1, 2, 3]));
  assert.equal(colors[10], 1);
  assert.equal(colors[96 + 10], 2);
  assert.equal(colors[192 + 10], 3);
  assert.deepEqual(P.getKeyColor(colors, 10), [1, 2, 3]);
  assert.equal(P.setKeyColor(colors, 96, [1, 2, 3]), false);
});

test('battery parsing rejects values above 100', () => {
  assert.equal(P.parseBattery(Uint8Array.of(64)), 64);
  assert.equal(P.parseBattery(Uint8Array.of(200)), null);
  assert.equal(P.parseBattery(new Uint8Array(0)), null);
});

test('layout has unique LED indices that fit the colour block', () => {
  const leds = L.KEYS.map((k) => k.led);
  assert.equal(new Set(leds).size, leds.length);
  assert.equal(L.KEYS.length, 80);
  assert.ok(Math.max(...leds) < 96);
  for (const k of L.KEYS) assert.ok(k.x + k.w <= L.WIDTH + 1e-9, `${k.n} overflows`);
  assert.ok(Object.keys(L.CODE_TO_LED).length > 70);
});

// ------------------------------------------------------------------ transport

test('transport reassembles a 10-fragment LED block and verifies write acks', async () => {
  const mock = new MockKeyboard();
  const t = new Transport(mock, { timeout: 200 });
  const led = await t.readBlock(P.CMD.GET_LED);
  assert.equal(led.length, 128);
  assert.ok(P.isValidLed(led));

  const next = led.slice();
  P.setMode(next, 7);
  await t.writeBlock(P.CMD.SET_LED, next);
  assert.equal(mock.led[P.OFF.MODE], 7);
  t.close();
});

test('transport throws when the keyboard stays silent and ignores bad checksums', async () => {
  const mock = new MockKeyboard({ online: false });
  const t = new Transport(mock, { timeout: 40 });
  await assert.rejects(() => t.readBlock(P.CMD.GET_LED, 0, 2), /no answer/);
  t.close();
});

// -------------------------------------------------------------------- session

test('session connects, reads settings and records the battery', async () => {
  const { s } = makeSession({ battery: 64 });
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'ready');
  assert.equal(s.mode, 'dongle');
  assert.equal(s.battery.percent, 64);
  assert.equal(s.battery.source, 'dongle');
  assert.equal(s.history.length, 1);
  assert.equal(s.effect().name, 'Rainbow');
  assert.equal(s.dirty, false);
  assert.ok(s.firstBackup());
  s.disconnect();
});

test('editing marks the session dirty and revert restores the keyboard state', async () => {
  const { s } = makeSession();
  await s.connectAuto();
  s.setEffect(2);
  s.setBrightness(1);
  assert.equal(s.dirty, true);
  assert.deepEqual(s.dirtyKeys(), ['led']);
  s.revert();
  assert.equal(s.dirty, false);
  assert.equal(s.effect().name, 'Rainbow');
  s.disconnect();
});

test('apply writes the change, reads it back and confirms it', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  s.setEffect(2);
  s.setSpeed(3);
  s.setColorIndex(4);
  s.setBrightness(2);
  s.setPaletteColor(4, [10, 20, 30]);
  s.setSleepValue(20);
  const progress = [];
  const r = await s.apply((p) => progress.push(p));
  assert.equal(r.ok, true);
  assert.deepEqual(r.written, ['led', 'rgb']);
  assert.equal(r.modeOk, true);
  assert.equal(r.committed, true);
  assert.equal(progress[progress.length - 1], 1);

  const e = P.effectOf(2);
  assert.equal(mock.led[P.OFF.MODE], 2);
  assert.equal(P.getSpeed(mock.led, e), 3);
  assert.equal(P.getColorIndex(mock.led, e), 4);
  assert.equal(P.getBrightness(mock.led, e), 2);
  assert.equal(mock.led[P.OFF.SLEEP], 20);
  assert.deepEqual(P.getPaletteColor(mock.rgb, e, 4), [10, 20, 30]);
  assert.equal(s.dirty, false);
  s.disconnect();
});

test('painting keys switches to per-key mode and writes planar colours', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  s.paintKeys([0, 7, 35], [255, 0, 128]);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.deepEqual(r.written, ['led', 'rgb', 'colors']);
  assert.equal(mock.led[P.OFF.MODE], P.MODE_CUSTOM);
  assert.deepEqual(P.getKeyColor(mock.colors, 35), [255, 0, 128]);
  assert.deepEqual(P.getKeyColor(mock.colors, 1), [0, 0, 0]);
  s.disconnect();
});

test('a keyboard that ignores writes is reported, not trusted', async () => {
  const { s } = makeSession({ dropWrites: true });
  await s.connectAuto();
  s.setEffect(5);
  const r = await s.apply();
  assert.equal(r.ok, false);
  assert.equal(s.effect().name, 'Rainbow'); // adopts what the keyboard really holds
  s.disconnect();
});

test('asleep keyboard is detected and recovers on the wake event', async () => {
  const { mock, s } = makeSession({ online: false });
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'asleep');
  assert.equal(s.cur, null);
  mock.pushOnlineEvent(true);
  assert.ok(await until(() => s.status === 'ready'), 'did not wake');
  assert.ok(s.cur);
  s.disconnect();
});

// Over the USB-C cable the keyboard answers GET_ONLINE with 0 (that flag describes the wireless link) yet is
// awake and serves its settings. The app used to read that 0 as "asleep" and never loaded anything.
const cableSession = (mockOpts = {}, mode = 'wired') => {
  const mock = new MockKeyboard({ cable: true, ...mockOpts });
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    discover: async () => [{ io: mock, meta: { id: '258a:010c', mode, label: 'USB-C cable' } }],
  });
  return { mock, s };
};

test('a USB-C keyboard that reports "not online" is still read, not called asleep', async () => {
  const { s } = cableSession();
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'ready');
  assert.ok(s.cur, 'settings were not read');
  assert.equal(s.mode, 'wired');
  s.disconnect();
});

test('a USB-C keyboard stays ready through health checks even though GET_ONLINE says 0', async () => {
  const { s } = cableSession();
  await s.connectAuto();
  await s.checkOnline();
  await s.checkOnline();
  assert.equal(s.status, 'ready');
  s.disconnect();
});

test('an unrecognised interface that serves settings is also treated as awake', async () => {
  const { s } = cableSession({}, 'unknown');
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'ready');
  s.disconnect();
});

test('an unrecognised interface that is really a sleeping keyboard is still reported asleep', async () => {
  const mock = new MockKeyboard({ online: false });
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 60,
    discover: async () => [{ io: mock, meta: { mode: 'unknown', label: 'Keyboard' } }],
  });
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'asleep');
  s.disconnect();
});

test('a USB-C interface that answers GET_ONLINE but never serves settings is skipped, not trusted', async () => {
  const onlyOnline = { onReport: null, async send(p) { if (p[1] === P.CMD.GET_ONLINE) this.onReport(P.buildPacket(P.CMD.GET_ONLINE, 1, 0, 1, [0])); } };
  const good = new MockKeyboard({ cable: true });
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 40,
    discover: async () => [
      { io: onlyOnline, meta: { id: 'a', mode: 'wired', label: 'USB-C cable' } },
      { io: good, meta: { id: 'b', mode: 'wired', label: 'USB-C cable' } },
    ],
  });
  assert.equal(await s.connectAuto(), true);
  assert.equal(s.status, 'ready');
  assert.equal(s.ifaceId, 'b');
  s.disconnect();
});

test('a link that answers every packet twice still reads and writes cleanly', async () => {
  const { mock, s } = cableSession({ duplicateReplies: true });
  await s.connectAuto();
  assert.equal(s.status, 'ready');
  const before = mock.sent.length;
  s.setEffect(2);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(r.modeOk, true);
  // Every fragment should be sent once. Without ignoring stale duplicate acks each one was re-sent.
  const writes = mock.sent.slice(before).filter((p) => [P.CMD.SET_LED, P.CMD.SET_RGBTAB, P.CMD.SET_COLORS].includes(p[1]));
  const keys = writes.map((p) => `${p[1]}:${p[3]}`);
  assert.equal(new Set(keys).size, keys.length, 'a fragment was written more than once');
  s.disconnect();
});

test('unsupported hardware is reported instead of poked at', async () => {
  const s = new Session({
    storage: memoryStorage(),
    discover: async () => [{ io: {}, meta: { mode: 'unknown', label: 'F75 Max over USB-C', supported: false } }],
  });
  assert.equal(await s.connectAuto(), false);
  assert.equal(s.status, 'unsupported');
});

test('a device that never answers ends in an error, not a hang', async () => {
  const dead = { send: async () => {}, onReport: null };
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 30,
    discover: async () => [{ io: dead, meta: { mode: 'dongle', label: 'dead' } }],
  });
  assert.equal(await s.connectAuto(), false);
  assert.equal(s.status, 'error');
});

test('backups round-trip and reject mismatched layouts', async () => {
  const { s } = makeSession();
  await s.connectAuto();
  const backup = s.exportBackup();
  s.setEffect(8);
  assert.equal(s.importBackup(backup).ok, true);
  assert.equal(s.effect().name, 'Rainbow');
  assert.equal(s.importBackup({ ...backup, colors: backup.colors.slice(3) }).ok, false);
  assert.equal(s.importBackup({ app: 'other' }).ok, false);
  const broken = { ...backup, led: backup.led.slice(0, 100).concat(new Array(28).fill(0)) };
  assert.equal(s.importBackup(broken).ok, false);
  s.disconnect();
});

test('battery history keeps changes and skips duplicates', async () => {
  const { mock, s } = makeSession({ battery: 80 });
  await s.connectAuto();
  await s.pollBattery();
  assert.equal(s.history.length, 1);
  mock.battery = 79;
  await s.pollBattery();
  assert.equal(s.history.length, 2);
  s.disconnect();
});

// ------------------------------------------------------------------ preview

test('every simulated effect yields finite colours inside 0..255 for all keys over time', () => {
  const V = require('../src/js/preview.js');
  const palette = require('../src/js/mock.js').DEFAULT_PALETTE;
  const colors = new Uint8Array(96 * 3).fill(200);
  const modes = [0, ...P.EFFECTS.map((e) => e.mode)];
  for (const mode of modes) {
    for (const colorIndex of [0, 3, 7]) {
      for (const speed of [0, 4]) {
        for (let t = 0; t < 12; t += 0.37) {
          for (const k of L.KEYS) {
            const c = V.keyColor(mode, k, t, { palette, colorIndex, speed, colors, pressed: () => 0.5 });
            for (const v of c) {
              assert.ok(Number.isFinite(v) && v >= -1e-9 && v <= 255.0001, `mode ${mode} key ${k.n} t ${t}: ${c}`);
            }
          }
        }
      }
    }
  }
});

test('webhid module loads in Node without a browser and describes devices', () => {
  const W = require('../src/js/webhid.js');
  assert.equal(W.hasHid(), false);
  const d = W.describe({ vendorId: 0x3554, productId: 0xfa09, productName: '2.4G Wireless Receiver', collections: [{ usagePage: 0xff02, usage: 2 }] });
  assert.equal(d.mode, 'dongle');
  assert.equal(d.supported, true);
  assert.equal(d.id, '3554:fa09');
  // The F75 Max is driven by max.js, not by this protocol: it is listed as supported and belongs to its own family.
  const max = W.describe({ vendorId: 0x0c45, productId: 0x800a, productName: 'F75 Max', collections: [{ usagePage: 0xff13, usage: 1 }] });
  assert.equal(max.supported, true);
  assert.equal(max.family, 'max');
  // Other AULA models share its ids and are still not supported.
  const s98 = W.describe({ vendorId: 0x0c45, productId: 0x800a, productName: 'AULA-S98Pro', collections: [{ usagePage: 0xff13, usage: 1 }] });
  assert.equal(s98.supported, false);
});

test('a silent USB-C interface ends in an error that remembers it was the cable', async () => {
  const dead = { send: async () => {}, onReport: null };
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 30,
    discover: async () => [{ io: dead, meta: { id: '258a:010c', mode: 'wired', label: 'USB-C cable' } }],
  });
  assert.equal(await s.connectAuto(), false);
  assert.equal(s.status, 'error');
  assert.ok(s.candidates.some((c) => c.mode === 'wired'));
});

test('three failed health checks drop the link and announce it', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  let lost = false;
  s.on('lost', () => (lost = true));
  mock.send = async () => {
    throw new Error('device unplugged');
  };
  for (let i = 0; i < 3; i++) await s.checkOnline();
  assert.equal(lost, true);
  assert.equal(s.status, 'idle');
  assert.equal(s.connected, false);
});

test('quiet reconnects do not flash through the searching state', async () => {
  const s = new Session({ storage: memoryStorage(), discover: async () => [] });
  const seen = [];
  s.on('status', (e) => seen.push(e.status));
  await s.connectAuto();
  assert.deepEqual(seen, ['searching', 'idle']);
  seen.length = 0;
  await s.connectAuto({ quiet: true });
  assert.ok(!seen.includes('searching'), seen.join());
});

test('a config that still carries the apply flag would be ignored, so edits after the first apply must still land', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  s.setEffect(2);
  assert.equal((await s.apply()).ok, true);
  assert.equal(mock.led[P.OFF.APPLY], 1, 'the firmware marks the config as applied');
  // The editable copy now carries apply flag 1. A plain brightness change must not be swallowed.
  s.setBrightness(1);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(P.getBrightness(mock.led, P.effectOf(2)), 1);
  s.setEffect(15);
  assert.equal((await s.apply()).ok, true);
  assert.equal(mock.led[P.OFF.MODE], 15);
  s.disconnect();
});

test('apply sends the commit packet and reads back what the keyboard made live', async () => {
  const { mock, s } = makeSession({ requireSave: true });
  await s.connectAuto();
  s.setEffect(7);
  const r = await s.apply();
  assert.equal(mock.saves, 1);
  assert.equal(r.ok, true);
  assert.equal(r.modeOk, true);
  assert.equal(r.mode, 7);
  assert.equal(mock.led[P.OFF.MODE], 7);
  const sent = mock.sent.map((p) => p[1]);
  const lastWrite = sent.lastIndexOf(P.CMD.SET_RGBTAB);
  assert.ok(sent.indexOf(P.CMD.SAVE, lastWrite) > lastWrite, 'commit follows the palette write');
  s.disconnect();
});

test('choosing a colourful-only effect writes multicolour and the written colour mode byte', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  const e = P.effectOf(16);
  P.setColorIndex(s.cur.led, e, 3); // a stale single-colour value in the slot
  s.dev0.led = s.cur.led.slice();
  s.setEffect(16);
  assert.equal(P.getColorIndex(s.cur.led, e), P.MULTICOLOR);
  await s.apply();
  assert.equal(P.getColorIndex(mock.led, e), P.MULTICOLOR);
  assert.equal(mock.led[P.OFF.COLOR_MODE], 1);
  s.disconnect();
});

test('modeOk is false when the keyboard keeps a different effect than the one requested', async () => {
  const { s } = makeSession({ dropWrites: true });
  await s.connectAuto();
  s.setEffect(5);
  const r = await s.apply();
  assert.equal(r.ok, false);
  assert.equal(r.modeOk, false);
  s.disconnect();
});

// ------------------------------------------------- remembered settings

test('settings applied once are written back when the keyboard comes back with factory lighting', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.setEffect(5); // Raindrops
  a.s.setBrightness(2);
  a.s.setSpeed(3);
  a.s.setPaletteColor(0, [10, 200, 30]);
  const r = await a.s.apply();
  assert.ok(r.ok && r.modeOk);
  a.s.disconnect();

  // "Restart": a different keyboard object with factory settings, same computer storage.
  const b = makeSession({}, { storage });
  assert.equal(P.getMode(b.mock.led), 3);
  let restored = null;
  b.s.on('restored', (x) => (restored = x));
  await b.s.connectAuto();
  assert.equal(b.s.status, 'ready');
  assert.ok(restored && restored.ok, 'a restore ran and was verified');
  assert.equal(P.getMode(b.mock.led), 5);
  const eff = P.effectOf(5);
  assert.equal(P.getBrightness(b.mock.led, eff), 2);
  assert.equal(P.getSpeed(b.mock.led, eff), 3);
  assert.deepEqual(P.getPaletteColor(b.mock.rgb, eff, 0), [10, 200, 30]);
  assert.equal(b.s.dirty, false, 'the editable copy matches the keyboard afterwards');
});

test('nothing is written on connect when the keyboard already has the remembered settings', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.setEffect(7);
  await a.s.apply();
  const savesAfterApply = a.mock.saves;
  a.s.disconnect();
  await a.s.connectAuto(); // same keyboard, nothing was reset
  assert.equal(a.mock.saves, savesAfterApply);
});

test('the first connection only remembers the keyboard as it is and writes nothing', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const { mock, s } = makeSession({}, { storage });
  await s.connectAuto();
  assert.equal(mock.saves, 0);
  assert.ok(s.keepSnapshot(), 'a copy of the current settings is kept');
  assert.equal(P.getMode(s.keepSnapshot().led), 3);
});

test('switching the feature off stops restoring, and the manual Refresh never restores', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.setEffect(8);
  await a.s.apply();
  a.s.disconnect();

  const off = makeSession({}, { storage });
  off.s.setKeep(false);
  await off.s.connectAuto();
  assert.equal(P.getMode(off.mock.led), 3, 'left as the keyboard had it');
  off.s.disconnect();

  const on = makeSession({}, { storage });
  on.s.setKeep(true);
  await on.s.connectAuto();
  assert.equal(P.getMode(on.mock.led), 8, 'restored when switched back on and reconnected');

  const again = makeSession({}, { storage });
  await again.s.connectAuto();
  P.setMode(again.mock.led, 3); // reset behind our back
  const savesBefore = again.mock.saves;
  await again.s.refresh(); // manual refresh: shows the keyboard, writes nothing
  assert.equal(P.getMode(again.s.cur.led), 3);
  assert.equal(again.mock.saves, savesBefore, 'nothing was written');
});

test('the demo keyboard neither reads nor overwrites the remembered settings', async () => {
  const storage = memoryStorage();
  const real = makeSession({}, { storage });
  await real.s.connectAuto();
  real.s.setEffect(10);
  await real.s.apply();
  const before = storage.getItem('aula.keep.settings');
  real.s.disconnect();

  const mock = new MockKeyboard();
  const demo = new Session({ storage, transportTimeout: 120, discover: async () => [{ io: mock, meta: { mode: 'demo', label: 'Demo' } }] });
  await demo.connectAuto();
  assert.equal(P.getMode(mock.led), 3, 'no restore into the demo');
  demo.setEffect(13);
  await demo.apply();
  assert.equal(storage.getItem('aula.keep.settings'), before, 'the real keyboard\'s copy is untouched');
});

test('a restore writes the remembered mode as it was and does not force per-key mode', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.paintKeys([0, 1, 2], [255, 0, 0]);
  await a.s.apply(); // per-key colours, mode 21
  a.s.setEffect(11); // then a normal effect, colours stay stored
  await a.s.apply();
  assert.equal(P.getMode(a.mock.led), 11);
  a.s.disconnect();

  const b = makeSession({}, { storage });
  await b.s.connectAuto();
  assert.equal(P.getMode(b.mock.led), 11, 'still the effect, not Per-key');
  assert.deepEqual(P.getKeyColor(b.mock.colors, 1), [255, 0, 0]);
});

test('an out-of-date copy does not overwrite bytes the keyboard changed on its own', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  s.setEffect(4);
  mock.led[0x0b] = 0x42; // something the app does not model, changed on the keyboard after our read (e.g. the knob)
  const r = await s.apply();
  assert.ok(r.ok);
  assert.equal(mock.led[0x0b], 0x42, 'the unknown byte kept the keyboard\'s value');
  assert.equal(P.getMode(mock.led), 4, 'and the edit still landed');
});

test('changes made on the keyboard are picked up while connected and remembered for the next reset', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.mock.led[0x0b] = 0x01; // knob switched to volume on the keyboard
  P.setMode(a.mock.led, 6); // and an effect chosen with Fn keys
  await a.s._syncFromKeyboard();
  assert.equal(a.s.cur.led[0x0b], 0x01);
  assert.equal(P.getMode(a.s.cur.led), 6);
  assert.equal(a.s.dirty, false);
  assert.ok(a.s.logLines.some((l) => l.dir === 'note' && /0x0b: 00 -> 01/.test(l.hex)), 'the packet log says which byte changed');
  a.s.disconnect();

  const b = makeSession({}, { storage });
  await b.s.connectAuto();
  assert.equal(P.getMode(b.mock.led), 6, 'the lighting is put back after a reset');
  assert.equal(b.mock.led[0x0b], 0x00, 'but the knob is left as the keyboard has it: it is chosen by holding the knob, never by the app');
  assert.ok(b.s.logLines.some((l) => l.dir === 'note' && /knob/i.test(l.hex)), 'and the log says the knob was left alone');
});

test('reconnecting never flips the knob back: it was set on the keyboard while the app was closed', async () => {
  const storage = memoryStorage();
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  assert.equal(a.mock.led[0x0b], 0x00, 'the remembered copy was taken with the knob on lighting');
  a.s.disconnect();

  // The app is closed (or being updated). The knob is switched to volume on the keyboard, and the lighting is reset.
  a.mock.led[0x0b] = 0x01;
  P.setMode(a.mock.led, 3);

  const b = makeSession({}, { storage });
  b.mock.led.set(a.mock.led);
  await b.s.connectAuto();
  assert.equal(b.mock.led[0x0b], 0x01, 'the knob is still on volume after the app connected and restored the lighting');
  assert.equal(b.s.cur.led[0x0b], 0x01);
});

test('a difference in the knob alone makes the app write nothing to the keyboard', async () => {
  const storage = memoryStorage();
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.disconnect();
  a.mock.led[0x0b] = 0x01; // knob switched to volume while the app was closed; nothing else changed

  const b = makeSession({}, { storage });
  b.mock.led.set(a.mock.led);
  const before = b.mock.led.slice();
  await b.s.connectAuto();
  assert.deepEqual(Array.from(b.mock.led), Array.from(before), 'the lighting block is exactly as the keyboard had it');
  assert.equal(b.s.keepDiffers(), false);
});

test('connecting writes nothing, even after a reinstall or update that left an older remembered copy behind', async () => {
  const storage = memoryStorage();
  // What an older version left in the app's storage: remembered settings that differ from the keyboard, and its old
  // "restore" switch left on.
  const old = new MockKeyboard();
  P.setMode(old.led, 8);
  storage.setItem('aula.keep.settings', JSON.stringify({ at: Date.now(), led: Array.from(old.led), rgb: Array.from(old.rgb), colors: Array.from(old.colors) }));
  storage.setItem('aula.keep.enabled', '1');

  const { mock, s } = makeSession({}, { storage });
  mock.led[0x0b] = 0x01; // knob on volume
  mock.led[P.OFF.COLOR_MODE] = 3;
  mock.led[0x0d] = 0x55; // a byte the app knows nothing about
  const before = { led: mock.led.slice(), rgb: mock.rgb.slice(), colors: mock.colors.slice() };
  await s.connectAuto();
  await s._syncFromKeyboard();
  await s.refresh({ restore: true }); // what a wake-up does
  assert.equal(mock.saves, 0, 'no commit was sent');
  assert.deepEqual(Array.from(mock.led), Array.from(before.led), 'the lighting block is exactly as the keyboard had it');
  assert.deepEqual(Array.from(mock.rgb), Array.from(before.rgb));
  assert.deepEqual(Array.from(mock.colors), Array.from(before.colors));
});

test('changing one setting changes only that setting on the keyboard', async () => {
  const { mock, s } = makeSession();
  P.setMode(mock.led, 1); // Static
  const eff = P.effectOf(1);
  mock.led[0x0b] = 0x01; // knob on volume
  mock.led[P.OFF.COLOR_MODE] = 3; // the keyboard's own colour mode
  mock.led[0x0d] = 0x55; // a byte the app knows nothing about
  mock.led[P.slotByte(eff.slot, 1)] = (2 << 4) | 7; // a colour choice Static cannot use: the app must not tidy it up
  await s.connectAuto();
  const before = { led: mock.led.slice(), rgb: mock.rgb.slice(), colors: mock.colors.slice() };

  s.setBrightness(2);
  const r = await s.apply();
  assert.ok(r.ok);
  const changed = [];
  for (let i = 0; i < mock.led.length; i++) if (mock.led[i] !== before.led[i] && i !== P.OFF.APPLY) changed.push(i);
  assert.deepEqual(changed, [P.slotByte(eff.slot, 0)], 'only the brightness byte changed (the keyboard\'s own "applied" flag aside)');
  assert.deepEqual(Array.from(mock.rgb), Array.from(before.rgb), 'the palette is as it was');
  assert.deepEqual(Array.from(mock.colors), Array.from(before.colors), 'the per-key colours are as they were');
});

test('painting one key changes only that key (and switches to Per-key); every other key and setting stays', async () => {
  const { mock, s } = makeSession();
  mock.led[0x0b] = 0x01; // knob on volume
  mock.led[0x0d] = 0x55; // a byte the app knows nothing about
  P.setKeyColor(mock.colors, 5, [9, 8, 7]); // a colour already on another key
  await s.connectAuto();
  const before = { led: mock.led.slice(), colors: mock.colors.slice(), rgb: mock.rgb.slice() };

  s.paintKeys([0], [255, 0, 0]);
  const r = await s.apply();
  assert.ok(r.ok);
  assert.deepEqual(P.getKeyColor(mock.colors, 0), [255, 0, 0]);
  assert.deepEqual(P.getKeyColor(mock.colors, 5), [9, 8, 7], 'another key keeps its colour');
  for (let i = 1; i < mock.colors.length / 3; i++) {
    assert.deepEqual(P.getKeyColor(mock.colors, i), P.getKeyColor(before.colors, i), `key ${i} is as it was`);
  }
  const changed = [];
  for (let i = 0; i < mock.led.length; i++) if (mock.led[i] !== before.led[i] && i !== P.OFF.APPLY) changed.push(i);
  assert.deepEqual(changed, [P.OFF.MODE, P.OFF.COLOR_MODE], 'only the effect (Per-key) and the colour mode changed in the lighting block');
  assert.equal(P.getMode(mock.led), P.MODE_CUSTOM);
  assert.deepEqual(Array.from(mock.rgb), Array.from(before.rgb), 'the palette is as it was');
});

test('a colour or effect edit still sets the colour mode so the keyboard honours it', async () => {
  const { mock, s } = makeSession();
  mock.led[P.OFF.COLOR_MODE] = 3;
  await s.connectAuto();
  s.setEffect(1);
  s.setPaletteColor(0, [1, 2, 3]);
  const r = await s.apply();
  assert.ok(r.ok);
  assert.equal(mock.led[P.OFF.COLOR_MODE], 1);
});

test('unsaved edits are never replaced by a keyboard-side change or a restore', async () => {
  const { mock, s } = makeSession();
  await s.connectAuto();
  s.setEffect(7);
  P.setMode(mock.led, 9); // keyboard changes while the user has pending edits
  await s._syncFromKeyboard();
  assert.equal(P.getMode(s.cur.led), 7, 'the edit stays');
  assert.equal(s.dirty, true);
});

test('Restore now rewrites the remembered settings on request', async () => {
  const storage = memoryStorage();
  storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
  const a = makeSession({}, { storage });
  await a.s.connectAuto();
  a.s.setEffect(12);
  await a.s.apply();
  P.setMode(a.mock.led, 3); // something reset it while connected
  await a.s.refresh();
  assert.equal(P.getMode(a.s.cur.led), 3);
  const r = await a.s.restoreNow();
  assert.ok(r.restored && r.ok);
  assert.equal(P.getMode(a.mock.led), 12);
});
