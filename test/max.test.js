'use strict';

/*
 * The F75 Max module against the byte layouts published by people who tried them on real keyboards, and against fake
 * devices that behave like the documented firmware (every command acknowledged, data packets echoed, battery answered).
 * Whether a real keyboard agrees is only settled by plugging one in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/js/max.js');
const { memoryStorage } = require('../src/js/engine.js');

const bytes = (u) => Array.from(u);
const nonZero = (u) => bytes(u).map((v, i) => (v ? [i, v] : null)).filter(Boolean);

const { FakeCable, FakeDongle } = require('./fake-max.js');

async function session(devices, storage) {
  const s = new M.MaxSession({ hid: { getDevices: async () => devices.slice() }, storage, delayMs: 0 });
  await s.scan();
  return s;
}

// ------------------------------------------------------------------ golden bytes: USB-C

test('lighting: Wave, 6E7BFF, brightness 4, speed 3, direction Right, one colour', () => {
  const steps = M.lightingSteps(M.DEFAULT_LIGHTING);
  assert.deepEqual(steps.map((s) => s.name), ['begin', 'select lighting', 'lighting', 'apply', 'save']);
  assert.deepEqual(steps.map((s) => s.kind), ['ack', 'ack', 'send', 'ack', 'send']);
  assert.deepEqual(nonZero(steps[0].bytes), [[0, 4], [1, 0x18]]);
  assert.deepEqual(nonZero(steps[1].bytes), [[0, 4], [1, 0x13], [8, 1]]);
  // [0] mode, [1..3] RGB, [8] colourful, [9] brightness, [10] speed, [11] direction, [14..15] aa 55
  assert.deepEqual(nonZero(steps[2].bytes), [[0, 10], [1, 0x6e], [2, 0x7b], [3, 0xff], [9, 4], [10, 3], [14, 0xaa], [15, 0x55]]);
  assert.deepEqual(nonZero(steps[3].bytes), [[0, 4], [1, 0x02]]);
  assert.deepEqual(nonZero(steps[4].bytes), [[0, 4], [1, 0xf0]]);
  for (const s of steps) assert.equal(s.bytes.length, 64);
});

test('lighting: colourful, direction and the limits of every field', () => {
  const p = M.lightingSteps({ mode: 19, rgb: [255, 0, 128], colorful: true, brightness: 5, speed: 1, direction: 3 })[2].bytes;
  assert.deepEqual(nonZero(p), [[0, 19], [1, 255], [3, 128], [8, 1], [9, 5], [10, 1], [11, 3], [14, 0xaa], [15, 0x55]]);
  // Out-of-range values are clamped, never sent as they are.
  const q = M.lightingSteps({ mode: 99, rgb: [300, -5, 0.4], colorful: false, brightness: 0, speed: 9, direction: -2 })[2].bytes;
  assert.deepEqual([q[0], q[1], q[2], q[3], q[9], q[10], q[11]], [19, 255, 0, 0, 1, 5, 0]);
});

test('lighting: Off sends only the mode and the trailer', () => {
  const p = M.lightingSteps({ ...M.DEFAULT_LIGHTING, mode: 0 })[2].bytes;
  assert.deepEqual(nonZero(p), [[14, 0xaa], [15, 0x55]]);
});

test('per-key: the user-defined mode (0x80) carries only the brightness', () => {
  const steps = M.userDefinedSteps(5);
  assert.deepEqual(nonZero(steps[2].bytes), [[0, 0x80], [9, 5], [14, 0xaa], [15, 0x55]]);
  assert.deepEqual(nonZero(M.userDefinedSteps(0)[2].bytes), [[0, 0x80], [9, 1], [14, 0xaa], [15, 0x55]], 'brightness 0 would turn every key off, so it is never sent');
});

test('per-key: a 576-byte table, `index r g b` at index * 4, aa 55 at the end, in 9 echoed packets', () => {
  const colors = new Map([[M.KEYS.esc, [255, 0, 0]], [M.KEYS.w, [0, 255, 0]], [M.KEYS.pagedown, [1, 2, 3]]]);
  const table = M.keyColorTable(colors);
  assert.equal(table.length, 576);
  assert.deepEqual(bytes(table.slice(4, 8)), [1, 255, 0, 0], 'Esc is light 1');
  assert.deepEqual(bytes(table.slice(39 * 4, 39 * 4 + 4)), [39, 0, 255, 0]);
  assert.deepEqual(bytes(table.slice(121 * 4, 121 * 4 + 4)), [121, 1, 2, 3]);
  assert.deepEqual(bytes(table.slice(574)), [0xaa, 0x55]);
  // Non-zero bytes: Esc 1 + 255, W 39 + 255, Page Down 121 + 1 + 2 + 3, and the trailer's two.
  assert.equal(nonZero(table).length, 2 + 2 + 4 + 2, 'only the three lights and the trailer');
  const steps = M.keyColorSteps(colors);
  assert.deepEqual(steps.map((s) => s.kind), ['ack', 'ack', ...new Array(9).fill('echo'), 'ack', 'send']);
  assert.deepEqual(nonZero(steps[1].bytes), [[0, 4], [1, 0x23], [8, 9]]);
  assert.deepEqual(M.keyColorTable(new Map()).slice(0, 574).every((v) => v === 0), true, 'lights not painted stay dark');
  assert.throws(() => M.keyColorTable(new Map([[999, [1, 2, 3]]])), /outside the key table/);
  assert.throws(() => M.keyColorTable(new Map([[0, [1, 2, 3]]])), /outside the key table/);
});

test('settings: response, sleep and the four switches, with aa 55 at 62..63', () => {
  const steps = M.settingsSteps({ response: 3, sleep: 1, winLock: true, altF4Lock: false, altTabLock: true, fnSwitch: true });
  assert.deepEqual(steps.map((s) => s.name), ['begin', 'select settings', 'settings', 'apply']);
  assert.deepEqual(nonZero(steps[1].bytes), [[0, 4], [1, 0x17], [2, 1], [8, 1]]);
  assert.deepEqual(nonZero(steps[2].bytes), [[1, 1], [2, 1], [4, 1], [5, 1], [6, 1], [8, 3], [62, 0xaa], [63, 0x55]]);
  const d = M.settingsSteps(M.DEFAULT_SETTINGS)[2].bytes; // the firmware's own defaults
  assert.deepEqual(nonZero(d), [[1, 1], [6, 2], [8, 2], [62, 0xaa], [63, 0x55]]);
});

test('accepted: the keyboard echoes the op and sets byte 3 to 1', () => {
  const sent = Uint8Array.of(4, 0x02, 0, 0);
  assert.equal(M.accepted(sent, Uint8Array.of(4, 0x02, 0, 1, 7, 2)), true);
  assert.equal(M.accepted(sent, Uint8Array.of(4, 0x02, 0, 0)), false, 'an echo alone is not an acknowledgement');
  assert.equal(M.accepted(sent, Uint8Array.of(4, 0x13, 0, 1)), false);
  assert.equal(M.accepted(sent, Uint8Array.of(4, 0x02)), false);
});

// ------------------------------------------------------------------ golden bytes: 2.4G

test('2.4G: reports are 32 bytes and byte 31 is the low 8 bits of the sum of the others', () => {
  for (const r of [M.rgbCommitReport(), M.rgbReport(M.DEFAULT_LIGHTING), M.responseReport(M.DEFAULT_SETTINGS), M.batteryQuery()]) {
    assert.equal(r.length, 32);
    assert.equal(r[31], r.slice(0, 31).reduce((a, b) => (a + b) & 0xff, 0));
  }
  assert.deepEqual(nonZero(M.rgbCommitReport()), [[0, 0x0f], [31, 0x0f]]);
  assert.deepEqual(nonZero(M.batteryQuery()), [[0, 0x20], [1, 0x01], [31, 0x21]]);
});

test('2.4G: the RGB report has the mode at 3, colour at 4..6 and colourful, brightness, speed, direction at 11..14', () => {
  const r = M.rgbReport({ mode: 10, rgb: [0x6e, 0x7b, 0xff], colorful: true, brightness: 4, speed: 3, direction: 2 });
  assert.deepEqual(nonZero(r).filter(([i]) => i !== 31), [[0, 5], [1, 0x10], [3, 10], [4, 0x6e], [5, 0x7b], [6, 0xff], [11, 1], [12, 4], [13, 3], [14, 2], [17, 0xaa], [18, 0x55]]);
  assert.deepEqual(nonZero(M.rgbReport({ ...M.DEFAULT_LIGHTING, mode: 0 })).filter(([i]) => i !== 31), [[0, 5], [1, 0x10], [17, 0xaa], [18, 0x55]], 'Off carries no colour');
});

test('2.4G: the response report has Fn at 8, sleep at 9 and the response level at 11', () => {
  const r = M.responseReport({ response: 4, sleep: 3, fnSwitch: true });
  assert.deepEqual(nonZero(r).filter(([i]) => i !== 31), [[0, 7], [1, 0x10], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 3], [11, 4], [17, 0xaa], [18, 0x55]]);
});

test('2.4G: a battery answer is 20 01 .. <percent>; anything else is not one', () => {
  assert.equal(M.parseBattery(Uint8Array.of(0x20, 0x01, 0, 94)), 94);
  assert.equal(M.parseBattery(Uint8Array.of(0x20, 0x01, 0, 0)), null);
  assert.equal(M.parseBattery(Uint8Array.of(0x20, 0x01, 0, 101)), null);
  assert.equal(M.parseBattery(Uint8Array.of(0x21, 0x01, 0, 50)), null);
  assert.equal(M.parseBattery(Uint8Array.of(0x20, 0x01)), null);
});

// ------------------------------------------------------------------ the layout

test('layout: every key of the F75 Max table is drawn once, inside the 16 x 6 board, without overlap', () => {
  const keys = M.keyLayout();
  assert.equal(keys.length, Object.keys(M.KEYS).length);
  assert.equal(new Set(keys.map((k) => k.led)).size, keys.length);
  for (const k of keys) {
    assert.ok(k.x >= 0 && k.x + k.w <= 16.0001 && k.y >= 0 && k.y + k.h <= 6, `${k.name} inside the board`);
    assert.ok(k.led >= 1 && k.led <= 121);
  }
  for (const a of keys) {
    for (const b of keys) {
      if (a === b || a.y !== b.y) continue;
      assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9, `${a.name} and ${b.name} do not overlap`);
    }
  }
  assert.equal(keys.find((k) => k.name === 'esc').led, 1);
  assert.equal(M.EFFECTS.length, 20);
  assert.deepEqual(M.EFFECTS.map((e) => e.mode), [...Array(20).keys()]);
});

// ------------------------------------------------------------------ session over USB-C

test('cable: a lighting apply runs begin, select, payload, apply, save in that order and is confirmed', async () => {
  const cable = new FakeCable();
  const s = await session([cable]);
  assert.equal(s.link, 'cable');
  assert.equal(s.label, 'USB-C cable');
  s.setLighting({ mode: 7, rgb: [10, 20, 30], brightness: 2, speed: 5, direction: 1, colorful: true });
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, true);
  assert.equal(r.via, 'cable');
  assert.deepEqual(cable.ops(), ['18', '13', 'data', '02', 'f0']);
  assert.deepEqual(nonZero(cable.sent[2]), [[0, 7], [1, 10], [2, 20], [3, 30], [8, 1], [9, 2], [10, 5], [11, 1], [14, 0xaa], [15, 0x55]]);
});

test('cable: a command the keyboard does not accept is reported with the step, and nothing after it is sent', async () => {
  const cable = new FakeCable({ rejectOp: 0x13 });
  const s = await session([cable]);
  const r = await s.applyLighting();
  assert.equal(r.ok, false);
  assert.match(r.error, /did not accept “select lighting”/);
  assert.deepEqual(cable.ops(), ['18', '13'], 'it stops at the first refusal');
  assert.equal(s.busy, false, 'the session is free again');
});

test('cable: per-key colours switch to the user-defined mode, then write the table, and are echo-checked', async () => {
  const cable = new FakeCable();
  const s = await session([cable]);
  s.paint([M.KEYS.esc, M.KEYS.space], [200, 100, 50]);
  s.setLighting({ brightness: 3 });
  const r = await s.applyKeyColors();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(cable.ops(), ['18', '13', 'data', '02', 'f0', '18', '23', ...new Array(9).fill('data'), '02', 'f0']);
  assert.deepEqual(nonZero(cable.sent[2]), [[0, 0x80], [9, 3], [14, 0xaa], [15, 0x55]]);
  assert.deepEqual(bytes(cable.sent[7].slice(4, 8)), [1, 200, 100, 50], 'Esc in the first table packet');
  // A keyboard that garbles a data packet is caught.
  const bad = new FakeCable({ badEcho: true });
  const s2 = await session([bad]);
  s2.paint([1], [1, 2, 3]);
  const r2 = await s2.applyKeyColors();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /did not echo/);
});

test('cable: settings are written all at once from what the app remembers', async () => {
  const cable = new FakeCable();
  const s = await session([cable]);
  s.setSettings({ response: 4, sleep: 3, winLock: true });
  const r = await s.applySettings();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(cable.ops(), ['18', '17', 'data', '02']);
  assert.deepEqual(nonZero(cable.sent[2]), [[1, 1], [2, 1], [6, 3], [8, 4], [62, 0xaa], [63, 0x55]]);
});

test('cable: two applies started together do not interleave on the wire', async () => {
  const cable = new FakeCable();
  const s = await session([cable]);
  const a = s.applyLighting();
  const b = s.applySettings();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.ok && rb.ok, true);
  assert.deepEqual(cable.ops(), ['18', '13', 'data', '02', 'f0', '18', '17', 'data', '02']);
});

// ------------------------------------------------------------------ session over 2.4G

test('dongle: lighting sends the RGB commit and then the RGB report, and says it is not confirmed', async () => {
  const dongle = new FakeDongle();
  const s = await session([dongle]);
  assert.equal(s.link, 'dongle');
  s.setLighting({ mode: 15, rgb: [1, 2, 3], brightness: 5, speed: 2, direction: 0, colorful: false });
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, false);
  assert.match(r.note, /does not confirm/);
  assert.equal(dongle.sent.length, 2);
  assert.deepEqual(bytes(dongle.sent[0]), bytes(M.rgbCommitReport()));
  assert.deepEqual(bytes(dongle.sent[1]), bytes(M.rgbReport(s.lighting)));
});

test('dongle: per-key colours are refused with the reason, and nothing is sent', async () => {
  const dongle = new FakeDongle();
  const s = await session([dongle]);
  s.paint([1], [1, 2, 3]);
  const r = await s.applyKeyColors();
  assert.equal(r.ok, false);
  assert.match(r.error, /need the USB-C cable/);
  assert.equal(dongle.sent.length, 0);
});

test('dongle: settings go as the response report', async () => {
  const dongle = new FakeDongle();
  const s = await session([dongle]);
  s.setSettings({ response: 5, sleep: 0, fnSwitch: true });
  const r = await s.applySettings();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(bytes(dongle.sent[0]), bytes(M.responseReport(s.settings)));
});

test('dongle: the battery is asked for and read from the answer, and a silent keyboard gives null', async () => {
  const dongle = new FakeDongle({ percent: 64 });
  const s = await session([dongle]);
  let events = 0;
  s.on('battery', () => events++);
  assert.equal(await s.pollBattery(), 64);
  assert.equal(s.battery.percent, 64);
  assert.equal(events, 1);
  assert.deepEqual(bytes(dongle.sent[0]), bytes(M.batteryQuery()));
  dongle.answers = false;
  const quiet = new M.MaxSession({ hid: { getDevices: async () => [dongle] }, delayMs: 0 });
  await quiet.scan();
  quiet.dongle.battery = (t) => M.DongleLink.prototype.battery.call(quiet.dongle, 30);
  assert.equal(await quiet.pollBattery(), null);
  assert.equal(quiet.battery.percent, null);
  assert.equal(quiet.last, null, 'a battery poll is silent: it never becomes the status the person sees');
});

test('both links: writes use the cable, the battery comes from the dongle', async () => {
  const cable = new FakeCable();
  const dongle = new FakeDongle({ percent: 41 });
  const s = await session([cable, dongle]);
  assert.equal(s.link, 'cable');
  assert.equal((await s.applyLighting()).via, 'cable');
  assert.equal(dongle.sent.length, 0);
  assert.equal(await s.pollBattery(), 41);
  assert.equal(cable.sent.filter((b) => b[1] === 0x20).length, 0);
});

// ------------------------------------------------------------------ discovery and memory

test('scan: finds the vendor interfaces by usage page, ignores the others, and notices unplugging', async () => {
  const keyboard = { vendorId: 0x0c45, productId: 0x800a, collections: [{ usagePage: 0x01, usage: 0x06 }] };
  const display = { vendorId: 0x0c45, productId: 0x800a, collections: [{ usagePage: 0xff68, usage: 0x61 }] };
  const f75 = { vendorId: 0x258a, productId: 0x010c, collections: [{ usagePage: 0xff00, usage: 0x01 }] };
  const cable = new FakeCable();
  const list = [keyboard, display, f75];
  const s = new M.MaxSession({ hid: { getDevices: async () => list.slice() }, delayMs: 0 });
  assert.equal(await s.scan(), false, 'an F75 and the Max keyboard and display interfaces are not a command channel');
  let presence = 0;
  s.on('presence', () => presence++);
  list.push(cable);
  assert.equal(await s.scan(), true);
  assert.equal(presence, 1);
  list.pop();
  assert.equal(await s.scan(), false);
  assert.equal(presence, 2);
  assert.equal(s.link, null);
  assert.equal((await s.applyLighting()).ok, false);
});

test('memory: lighting, per-key colours and settings are remembered, and bad memory is ignored', async () => {
  const storage = memoryStorage();
  const a = new M.MaxSession({ storage, delayMs: 0 });
  a.setLighting({ mode: 12, rgb: [9, 8, 7], speed: 1, direction: 2, colorful: true, brightness: 5 });
  a.setSettings({ response: 5, sleep: 3, fnSwitch: true });
  a.paint([1, 2, 3], [4, 5, 6]);
  a.paint([2], null);
  const b = new M.MaxSession({ storage, delayMs: 0 });
  assert.deepEqual(b.lighting, a.lighting);
  assert.deepEqual(b.settings, a.settings);
  assert.deepEqual([...b.keyColors], [[1, [4, 5, 6]], [3, [4, 5, 6]]]);
  storage.setItem('aula.max.v1', '{not json');
  const c = new M.MaxSession({ storage, delayMs: 0 });
  assert.deepEqual(c.lighting, M.DEFAULT_LIGHTING);
  storage.setItem('aula.max.v1', JSON.stringify({ lighting: { mode: 400, brightness: -3, rgb: [1] }, settings: { response: 99 }, keys: [[1, [1, 2]], ['x', [1, 2, 3]], [5, [999, 0, 0]]] }));
  const d = new M.MaxSession({ storage, delayMs: 0 });
  assert.equal(d.lighting.mode, 19);
  assert.equal(d.lighting.brightness, 1);
  assert.equal(d.settings.response, 5);
  assert.deepEqual([...d.keyColors], [[5, [255, 0, 0]]]);
});

// ------------------------------------------------------------------ other AULA models share these ids

test('gate: only a device whose name says F75 Max is driven; other AULA models on the same ids are left alone', async () => {
  const s98 = new FakeCable({ name: 'AULA-S98Pro' });
  const f108 = new FakeDongle({ name: 'F108Pro Dongle' });
  const s = await session([s98, f108]);
  assert.equal(s.present, false);
  assert.equal(s.refused.length, 2);
  assert.equal(s.pending.length, 0);
  assert.equal((await s.applyLighting()).ok, false);
  assert.equal(s98.sent.length + f108.sent.length, 0, 'not one byte was sent to a keyboard that is not an F75 Max');
  assert.equal(M.IDS.cable.vid, require('../src/js/protocol.js').deviceFor(0x0c45, 0x800a).vid);
});

test('gate: a name that says neither way waits for the person, and the answer is remembered', async () => {
  const storage = memoryStorage();
  const cable = new FakeCable({ name: 'USB Device' });
  const dongle = new FakeDongle({ name: '' });
  const s = await session([cable, dongle], storage);
  assert.equal(s.present, false);
  assert.equal(s.pending.length, 2, 'both interfaces are waiting to be confirmed');
  assert.equal(cable.sent.length + dongle.sent.length, 0);
  assert.equal(await s.confirmModel(), true);
  assert.equal(s.link, 'cable');
  assert.equal((await s.applyLighting()).ok, true);
  const again = await session([cable, dongle], storage);
  assert.equal(again.present, true, 'remembered across restarts');
  assert.equal(again.pending.length, 0);
});

test('describe: the home screen lists an F75 Max as supported, another model as not, and an unnamed one as needing a confirmation', () => {
  const W = require('../src/js/webhid.js');
  const d = (productName, vendorId = 0x0c45, productId = 0x800a) => W.describe({ vendorId, productId, productName, collections: [] });
  assert.deepEqual([d('AULA F75Max').supported, d('AULA F75Max').family, d('AULA F75Max').confirm, d('AULA F75Max').mode], [true, 'max', false, 'wired']);
  assert.deepEqual([d('F75Max Dongle', 0x05ac, 0x024f).supported, d('F75Max Dongle', 0x05ac, 0x024f).mode], [true, 'dongle']);
  const other = d('AULA-S98Pro');
  assert.deepEqual([other.supported, other.confirm], [false, false]);
  assert.match(other.why, /another AULA model/);
  assert.equal(d('').supported && d('').confirm, true);
  assert.equal(W.describe({ vendorId: 0x258a, productId: 0x010c, productName: 'AULA F75', collections: [] }).family, 'f75');
});

test('the F75 session never sees an F75 Max, so F75 packets are never sent to one', async () => {
  const W = require('../src/js/webhid.js');
  const vendor = (vid, pid, name) => ({ vendorId: vid, productId: pid, productName: name, opened: false, collections: [{ usagePage: 0xff02, usage: 0x02 }] });
  const saved = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { hid: { getDevices: async () => [vendor(0x0c45, 0x800a, 'AULA F75Max'), vendor(0x05ac, 0x024f, 'F75Max Dongle'), vendor(0x258a, 0x010c, 'AULA F75')] } } });
  try {
    const found = await W.discover();
    assert.deepEqual(found.map((c) => c.meta.id), ['258a:010c']);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved });
  }
});

test('the status line keeps the last apply: a battery poll afterwards does not replace it', async () => {
  const s = await session([new FakeCable(), new FakeDongle({ percent: 50 })]);
  const r = await s.applyLighting();
  assert.equal(r.ok, true);
  await s.pollBattery();
  assert.equal(s.last.name, 'lighting');
  assert.equal(s.last, r);
});

test('cable: a reply read too early (only an echo) is read again before the command is called refused', async () => {
  const slow = new FakeCable({ slowAck: true });
  const s = await session([slow]);
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(slow.ops(), ['18', '13', 'data', '02', 'f0']);
  // A command that is never acknowledged is still refused, after the extra looks.
  const never = new FakeCable({ rejectOp: 0x18 });
  const s2 = await session([never]);
  const r2 = await s2.applyLighting();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /did not accept “begin”/);
  assert.deepEqual(never.ops(), ['18']);
});


// ------------------------------------------------------------------ a slow keyboard is not a failed write

test('cable: a keyboard that takes a few hundred ms to acknowledge a step is waited for, not refused', async () => {
  const cable = new FakeCable({ ackDelayMs: 400 });
  const s = await session([cable]);
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, true);
  assert.deepEqual(cable.ops(), ['18', '13', 'data', '02', 'f0']);
});

test('cable: an apply the keyboard never acknowledges is reported as sent, not as a failed write, and save still goes out', async () => {
  const cable = new FakeCable({ rejectOp: 0x02 });
  const s = new M.MaxSession({ hid: { getDevices: async () => [cable] }, delayMs: 0, waitMs: 200 });
  await s.scan();
  const r = await s.applyLighting();
  assert.equal(r.ok, true, 'the data was already on the keyboard; the change is not an error');
  assert.equal(r.confirmed, false);
  assert.match(r.note, /did not confirm the last step \(apply\)/);
  assert.deepEqual(cable.ops(), ['18', '13', 'data', '02', 'f0']);
  // The first steps are still hard: nothing is written to a keyboard that did not accept begin.
  const never = new FakeCable({ rejectOp: 0x18 });
  const s2 = new M.MaxSession({ hid: { getDevices: async () => [never] }, delayMs: 0, waitMs: 200 });
  await s2.scan();
  const r2 = await s2.applyLighting();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /did not accept “begin”/);
  assert.deepEqual(never.ops(), ['18']);
});

test('cable: settings and per-key colours also report an unconfirmed apply as sent', async () => {
  const cable = new FakeCable({ rejectOp: 0x02 });
  const s = new M.MaxSession({ hid: { getDevices: async () => [cable] }, delayMs: 0, waitMs: 120 });
  await s.scan();
  s.setSettings({ response: 3 });
  const a = await s.applySettings();
  assert.equal(a.ok, true, a.error);
  assert.equal(a.confirmed, false);
  s.paint([1], [9, 9, 9]);
  const b = await s.applyKeyColors();
  assert.equal(b.ok, true, b.error);
  assert.equal(b.confirmed, false);
});

test('cable: a data packet that is echoed late is waited for', async () => {
  const cable = new FakeCable({ echoDelayMs: 150 });
  const s = await session([cable]);
  s.paint([M.KEYS.esc], [200, 100, 50]);
  const r = await s.applyKeyColors();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, true);
});

test('cable: a read that fails for a moment right after a command is asked again', async () => {
  const cable = new FakeCable({ getFails: 4 });
  const s = await session([cable]);
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(r.confirmed, true);
  // A link that never answers a read is still a failure, and says so.
  const dead = new FakeCable({ getFails: 1e9 });
  const s2 = new M.MaxSession({ hid: { getDevices: async () => [dead] }, delayMs: 0, waitMs: 120 });
  await s2.scan();
  const r2 = await s2.applyLighting();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /USB-C link failed during “begin”/);
});
