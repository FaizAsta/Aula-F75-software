'use strict';

/*
 * The AULA F75 HE (Hall effect), driven by src/js/he.js. It is experimental: the byte layouts come from another project's
 * decode of AULA's own web driver, checked there on a different model (MINI 60 HE PRO), so these tests prove what this app
 * sends and refuses, not that a real F75 HE accepts it. They run the real session and link code against SimKeyboard, a
 * simulated keyboard at the level of the HID device (the same one the demo uses).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/js/he.js');
const P = require('../src/js/protocol.js');
const W = require('../src/js/webhid.js');
const SK = require('../src/js/skins.js');
const { memoryStorage } = require('../src/js/engine.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const hid = (...devs) => ({ getDevices: async () => devs });
const session = (devs, opts = {}) => new H.HeSession({ hid: hid(...devs), storage: memoryStorage(), waitMs: 120, ...opts });
const sentCmds = (sim) => [...new Set(sim.log.map((l) => l[0]))];

// ------------------------------------------------------------------------------------------------------ frames

test('a request frame is AA, command, length, offset, 00, last, 00, then the payload', () => {
  const f = H.frame(H.CMD.SET_LIGHT, { payload: Uint8Array.from([1, 2, 3]), offset: 0x0102, last: true });
  assert.equal(f.length, 64);
  assert.deepEqual([...f.slice(0, 11)], [0xaa, 0x23, 3, 0x02, 0x01, 0, 1, 0, 1, 2, 3]);
  assert.equal(H.frame(H.CMD.GET_LIGHT, { len: 16, size: 32 }).length, 32, 'the 2.4G receiver takes 32-byte reports');
});

test('only the five commands this app uses can be built into a frame', () => {
  assert.deepEqual([...H.SAFE].sort((a, b) => a - b), [0x10, 0x13, 0x14, 0x23, 0x24]);
  // factory reset, firmware flash, calibration, the 0x66 / 0x67 pair, the 0x30 / 0x31 pair, and arbitrary others
  for (const cmd of [0x0f, 0x4f, 0x64, 0x65, 0x66, 0x67, 0x30, 0x31, 0x00, 0x11, 0xff]) {
    assert.throws(() => H.frame(cmd, { len: 0 }), /not one this app uses/, `0x${cmd.toString(16)} is refused`);
  }
});

test('a chunk that does not fit its frame is refused, never truncated', () => {
  assert.throws(() => H.frame(H.CMD.SET_KEYS, { payload: new Uint8Array(57), size: 64 }), /does not fit/);
  assert.throws(() => H.frame(H.CMD.SET_KEYS, { payload: new Uint8Array(25), size: 32 }), /does not fit/);
  assert.doesNotThrow(() => H.frame(H.CMD.SET_KEYS, { payload: new Uint8Array(56), size: 64 }));
  assert.doesNotThrow(() => H.frame(H.CMD.SET_KEYS, { payload: new Uint8Array(24), size: 32 }));
  assert.throws(() => H.frame(H.CMD.GET_LIGHT, { len: 4, size: 8 }), /no room/);
});

test('a table is paged by the frame size: the per-key table goes in as 10 frames on the cable and 22 on the dongle, the last one marked, and is read back as 9 and 21', () => {
  const table = H.keyTable(new Map());
  assert.equal(table.length, 512, 'the whole table of the keyboard, 128 records, as AULA\'s own driver reads it');
  for (const [size, write, read] of [[64, 10, 9], [32, 22, 21]]) {
    const frames = H.writeFrames(H.CMD.SET_KEYS, table, size);
    assert.equal(frames.length, write);
    assert.deepEqual(frames.map((f) => f[6]), frames.map((_, i) => (i === write - 1 ? 1 : 0)), 'only the last frame is marked last');
    assert.deepEqual(frames.map((f) => f[3] | (f[4] << 8)), frames.map((_, i) => i * (size - 8)), 'offsets advance by one chunk');
    assert.equal(frames[write - 1][2], 8, 'the last piece is the 8 bytes of records 126 and 127');
    assert.equal(H.readFrames(H.CMD.GET_KEYS, H.KEYS_READ, size).length, read, 'the app reads back the 126 records it has checked');
  }
});

// -------------------------------------------------------------------------------------------- the lighting block

test('the lighting block: mode, colour, brightness, speed, direction and the AA 55 trailer', () => {
  const p = H.lightingPayload({ mode: 10, rgb: [1, 2, 3], colorful: false, brightness: 3, speed: 2, direction: 1 });
  assert.equal(p.length, 16);
  assert.deepEqual([...p], [10, 1, 2, 3, 0xff, 0, 0, 0, 0, 3, 2, 1, 0, 0, 0xaa, 0x55]);
});

test('colour handling: effects that always run multicolour, and the per-key table, send the random-colour flag; direction only goes to effects with one', () => {
  const base = { rgb: [9, 9, 9], colorful: false, brightness: 4, speed: 3, direction: 1 };
  assert.equal(H.lightingPayload({ ...base, mode: 1 })[8], 0, 'Static keeps the chosen colour');
  assert.equal(H.lightingPayload({ ...base, mode: 1, colorful: true })[8], 1);
  assert.equal(H.lightingPayload({ ...base, mode: 8 })[8], 1, 'Spectrum Cycle is always multicolour');
  assert.equal(H.lightingPayload({ ...base, mode: 1 }, H.CUSTOM)[0], 20, 'the per-key page sends mode 20');
  assert.equal(H.lightingPayload({ ...base, mode: 1 })[11], 0, 'Static has no direction');
  assert.equal(H.lightingPayload({ ...base, mode: 10 })[11], 1, 'Colorful Cross does');
});

test('every effect survives a trip through the block, and the effect table matches the firmware modes 0 to 19', () => {
  assert.deepEqual(H.EFFECTS.map((e) => e.mode), Array.from({ length: 20 }, (_, i) => i));
  for (const e of H.EFFECTS) {
    const l = { mode: e.mode, rgb: [10, 20, 30], colorful: false, brightness: 4, speed: 5, direction: e.direction ? 1 : 0 };
    const back = H.parseLighting(H.lightingPayload(l));
    assert.equal(back.mode, e.mode, e.name);
    assert.deepEqual(back.rgb, e.mode === 0 ? [0, 0, 0] : [10, 20, 30], e.name); // Off is sent as Static in black
    assert.equal(back.brightness, 4, e.name);
    assert.equal(back.speed, 5, e.name);
    assert.equal(back.direction, l.direction, e.name);
    assert.ok(e.info && e.info.length > 8, `${e.name} has a description`);
  }
  assert.equal(H.parseLighting(H.lightingPayload({ mode: 1, rgb: [1, 1, 1], colorful: true, brightness: 4, speed: 3, direction: 0 })).colorful, true);
  assert.equal(H.parseLighting(H.lightingPayload({ mode: 8, rgb: [1, 1, 1], colorful: true, brightness: 4, speed: 3, direction: 0 })).colorful, false, 'the flag means nothing for an effect that is always multicolour');
});

test('what the keyboard says back: 21 means off, all zeros is no answer, anything past the per-key mode is not a lighting block', () => {
  const block = (mode) => Uint8Array.from([mode, 1, 2, 3, 0xff, 0, 0, 0, 0, 4, 3, 0, 0, 0, 0xaa, 0x55]);
  assert.equal(H.parseLighting(block(21)).mode, 0);
  assert.equal(H.parseLighting(block(20)).mode, 20);
  assert.equal(H.parseLighting(block(22)), null);
  assert.equal(H.parseLighting(new Uint8Array(16)), null);
  assert.equal(H.parseLighting(new Uint8Array(4)), null);
});

// ---------------------------------------------------------------------------------------------- the per-key table

test('the per-key table is 128 records of [key, r, g, b]; black means off', () => {
  const t = H.keyTable(new Map([[0, [255, 0, 0]], [90, [1, 2, 3]], [5, [300, -4, 7]]]));
  assert.equal(t.length, 128 * 4);
  assert.deepEqual([...t.slice(0, 4)], [0, 255, 0, 0]);
  assert.deepEqual([...t.slice(90 * 4, 90 * 4 + 4)], [90, 1, 2, 3]);
  assert.deepEqual([...t.slice(5 * 4, 5 * 4 + 4)], [5, 255, 0, 7], 'out-of-range channels are clamped');
  assert.deepEqual([...t.slice(125 * 4, 125 * 4 + 4)], [125, 0, 0, 0]);
  assert.deepEqual([...t.slice(127 * 4, 127 * 4 + 4)], [127, 0, 0, 0]);
  const back = H.parseKeyTable(t);
  assert.equal(H.parseKeyTable(t.slice(0, H.KEYS_READ)).size, 3, 'the 126 records the app reads back are enough');
  assert.equal(back.size, 3);
  assert.deepEqual(back.get(90), [1, 2, 3]);
  assert.equal(H.parseKeyTable(new Uint8Array(10)).size, 0, 'a short table is not read');
});

// ------------------------------------------------------------------------------------------------ who it says it is

test('the info block gives the ids, firmware, battery and charging state; a level outside 1 to 100 is no reading', () => {
  const sim = new H.SimKeyboard({ frame: 32, percent: 64, charging: true });
  const info = H.parseInfo(sim.info);
  assert.equal(info.vid, 0x38a6);
  assert.equal(info.pid, 0x2729);
  assert.equal(info.percent, 64);
  assert.equal(info.charging, true);
  assert.match(info.version, /^V\d+\.\d\d$/);
  for (const bad of [0, 101, 255]) {
    sim.setBattery(bad);
    assert.equal(H.parseInfo(sim.info).percent, null, `${bad}%`);
  }
  assert.equal(H.parseInfo(new Uint8Array(4)), null);
});

test('the keyboard\'s own ids decide: the F75 HE\'s are accepted, the other Hall-effect boards\' are refused, anything else is unknown', () => {
  assert.equal(H.verdictOf({ vid: 0x38a6, pid: 0x2729 }), 'he');
  assert.equal(H.verdictOf({ vid: 0x0c45, pid: 0x80a2 }), 'other', 'MINI 60 HE PRO');
  assert.equal(H.verdictOf({ vid: 0x38a6, pid: 0x2722 }), 'other', 'MINI 68 HE');
  assert.equal(H.verdictOf({ vid: 0x1234, pid: 0x5678 }), 'unknown');
  assert.equal(H.verdictOf(null), 'unknown');
});

test('the product name sorts the shared receiver: F75 HE yes, other Hall-effect boards no, a bare receiver name asks', () => {
  assert.equal(P.heModel('AULA F75 HE'), 'he');
  assert.equal(P.heModel('F75-HE Dongle'), 'he');
  for (const n of ['AULA MINI 60 HE PRO', 'MINI68 HE', 'AULA WIN 60 HE', 'HERO 68 HE', 'AULA 84 HE']) assert.equal(P.heModel(n), 'other', n);
  for (const n of ['2.4G Wireless Receiver', '', undefined]) assert.equal(P.heModel(n), 'unknown', String(n));
});

// -------------------------------------------------------------------------------------------------------- layout

test('the layout is 80 keys on the board\'s grid (16 wide, function row apart) with their own firmware indices, none overlapping', () => {
  const keys = H.keyLayout();
  assert.equal(keys.length, 80);
  assert.equal(new Set(keys.map((k) => k.led)).size, 80, 'one index per key');
  assert.equal(new Set(keys.map((k) => k.name)).size, 80);
  assert.deepEqual(H.GRID, { w: 16, h: 6.3 });
  for (const k of keys) {
    assert.ok(Number.isInteger(k.led) && k.led >= 0 && k.led < H.LED_COUNT, `${k.name} has an index inside the table`);
    assert.ok(k.x >= 0 && k.x + k.w <= H.GRID.w + 1e-9 && k.y >= 0 && k.y + k.h <= H.GRID.h + 1e-9, `${k.name} is on the board`);
  }
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      const overlap = a.y === b.y && a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9;
      assert.ok(!overlap, `${a.name} and ${b.name} overlap`);
    }
  }
});

test('the keys sit where the photos of the real F75 HE put them: Esc apart, F-keys in threes of four, the row below set down, Fn and Ctrl after the space bar', () => {
  const at = Object.fromEntries(H.keyLayout().map((k) => [k.name, k]));
  assert.equal(at.esc.x, 0);
  assert.equal(at.f1.x, 2, 'a one-key gap after Esc');
  assert.equal(at.f5.x, at.f4.x + 1.25, 'a small gap between F4 and F5');
  assert.equal(at.f9.x, at.f8.x + 1.25, 'a small gap between F8 and F9');
  assert.equal(at.f12.x + 1, 14.5, 'the F-keys stop short of the knob');
  for (const n of ['esc', 'f1', 'f12']) assert.equal(at[n].y, 0);
  assert.equal(at.grave.y, 1.3, 'the function row sits slightly apart, as on the F75');
  assert.equal(at.ctrlleft.y, 5.3);
  assert.ok(at.fn.x === at.space.x + at.space.w && at.ctrlright.x === at.fn.x + at.fn.w, 'Space, then Fn, then Ctrl');
  assert.equal(at.right.x + at.right.w, 16, 'the arrows end at the right edge, under the navigation column');
  assert.deepEqual([at.fn.label, at.ctrlright.label], ['Fn', 'Ctrl']);
  assert.equal(at.altright, undefined, 'there is no right Alt on the real board');
});

// ----------------------------------------------------------------------------- a session against the simulated board

for (const [size, kind, link] of [[64, 'cable', 'USB-C'], [32, 'dongle', '2.4G']]) {
  test(`over ${link} (${size}-byte reports): who it is, read, apply lighting, apply per-key colours, read it back, and nothing unsafe is ever sent`, async () => {
    const sim = new H.SimKeyboard({ frame: size, percent: 71 });
    const s = session([sim]);
    assert.equal(await s.scan(), true);
    assert.equal(s.link, kind);
    assert.equal(s[kind].size, size, 'the frame size follows the descriptor');

    let r = await s.sync();
    assert.equal(r.ok, true, r.error);
    assert.equal(s.fromKeyboard, true);
    assert.equal(s.info.pid, 0x2729);
    assert.deepEqual(s.lighting.rgb, H.DEFAULT_LIGHTING.rgb);

    s.setLighting({ mode: 10, brightness: 2, speed: 5, direction: 1, rgb: [255, 0, 0] });
    r = await s.applyLighting();
    assert.equal(r.ok, true, r.error);
    assert.equal(r.confirmed, true);
    assert.deepEqual([...sim.light.slice(0, 4)], [10, 255, 0, 0]);
    assert.equal(sim.light[9], 2);
    assert.equal(sim.light[10], 5);
    assert.equal(sim.light[11], 1);

    s.paint([0, 90], [10, 20, 30]);
    r = await s.applyKeyColors();
    assert.equal(r.ok, true, r.error);
    assert.equal(sim.light[0], H.CUSTOM, 'the keyboard is switched to its per-key table');
    assert.deepEqual([...sim.keys.slice(90 * 4, 90 * 4 + 4)], [90, 10, 20, 30]);
    assert.equal(sim.log.filter((l) => l[0] === H.CMD.SET_KEYS).length, size === 64 ? 10 : 22, 'the table goes in as many pieces as the frame needs');

    const again = session([sim]);
    await again.scan();
    r = await again.sync();
    assert.equal(r.ok, true, r.error);
    assert.equal(again.lighting.mode === H.CUSTOM || again.keyColors.size === 2, true);
    assert.deepEqual(again.keyColors.get(90), [10, 20, 30], 'the colours come back as the keyboard holds them');

    assert.deepEqual(sim.unsafe, [], 'no command outside the allow-list reached the keyboard');
    assert.ok(sentCmds(sim).every((c) => H.SAFE.has(c)));
  });
}

test('a keyboard that names another Hall-effect board is refused before anything is written, and stays refused while it is plugged in', async () => {
  const sim = new H.SimKeyboard({ frame: 32, name: 'AULA F75 HE Dongle', identity: { vid: 0x0c45, pid: 0x80a2 } }); // a MINI 60 HE PRO behind a receiver named like ours
  const s = session([sim]);
  assert.equal(await s.scan(), true, 'the name looked right, so it was opened to ask');
  const r = await s.applyLighting();
  assert.equal(r.ok, false);
  assert.match(r.error, /not an F75 HE/);
  assert.equal(s.present, false, 'it is let go');
  assert.equal(s.refused.length, 1);
  assert.equal(await s.scan(), false, 'and not picked up again on the next scan');
  assert.ok(sim.log.every(([cmd]) => cmd === H.CMD.INFO), 'only the read of its description was sent');
});

test('a receiver whose name does not say which model it is waits for a yes, and the keyboard is still asked who it is', async () => {
  const sim = new H.SimKeyboard({ frame: 32, name: '2.4G Wireless Receiver' });
  const s = session([sim]);
  assert.equal(await s.scan(), false);
  assert.equal(s.pending.length, 1);
  assert.equal(sim.log.length, 0, 'nothing was sent to it');
  await s.confirmModel();
  assert.equal(await s.scan(), true);
  const r = await s.sync();
  assert.equal(r.ok, true, r.error);
});

test('a receiver named for another Hall-effect model is never opened as an F75 HE', async () => {
  const sim = new H.SimKeyboard({ frame: 32, name: 'AULA MINI 60 HE PRO' });
  const s = session([sim]);
  assert.equal(await s.scan(), false);
  assert.equal(s.refused.length, 1);
  assert.equal(sim.log.length, 0);
});

test('a keyboard that does not answer is an error that says so, and the session is free again afterwards', async () => {
  const sim = new H.SimKeyboard({ frame: 64, answers: false });
  const s = session([sim], { waitMs: 20 });
  await s.scan();
  const r = await s.applyLighting();
  assert.equal(r.ok, false);
  assert.match(r.error, /did not answer/);
  assert.equal(s.busy, false);
  assert.equal(s.last.ok, false);
});

test('with the cable in, writes go over the cable and the dongle is not asked for the battery; with the dongle alone, the battery is read', async () => {
  const cable = new H.SimKeyboard({ frame: 64 });
  const dongle = new H.SimKeyboard({ frame: 32, percent: 55, charging: true });
  const both = session([cable, dongle]);
  await both.scan();
  assert.equal(both.link, 'cable');
  assert.equal(await both.pollBattery(), null);
  assert.equal(dongle.log.length, 0, 'the receiver has nothing behind it while the keyboard runs wired');

  const alone = session([dongle]);
  await alone.scan();
  assert.equal(await alone.pollBattery(), 55);
  assert.equal(alone.battery.charging, true);
  assert.equal(await session([cable]).pollBattery(), null, 'the cable has no battery report');
});

test('Reset keyboard writes the default lighting and clears the per-key colours with the same safe commands, and puts nothing back if the keyboard did not take it', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session([sim]);
  await s.scan();
  s.setLighting({ mode: 3, brightness: 1 });
  s.paint([5], [9, 9, 9]);
  await s.applyKeyColors();
  const r = await s.factoryReset();
  assert.equal(r.ok, true, r.error);
  assert.equal(sim.light[0], H.DEFAULT_LIGHTING.mode);
  assert.equal(H.parseKeyTable(sim.keys).size, 0);
  assert.equal(s.keyColors.size, 0);
  assert.deepEqual(sim.unsafe, []);
  assert.ok(!sim.log.some(([cmd]) => cmd === 0x0f), 'the keyboard\'s own factory reset command is never used');

  const mute = new H.SimKeyboard({ frame: 64, answers: false });
  const m = session([mute], { waitMs: 20 });
  await m.scan();
  m.setLighting({ mode: 3 });
  m.paint([5], [9, 9, 9]);
  const failed = await m.factoryReset();
  assert.equal(failed.ok, false);
  assert.equal(m.lighting.mode, 3, 'what the app shows is what it still believes the keyboard holds');
  assert.equal(m.keyColors.size, 1);
});

test('the demo is a simulated cable and dongle behind the same code, keeps its state to itself and gives the session back', async () => {
  const store = memoryStorage();
  const s = new H.HeSession({ hid: hid(), storage: store, waitMs: 200 });
  s.setLighting({ mode: 4 });
  assert.equal(await s.enterDemo(), true);
  assert.equal(s.demo, true);
  assert.equal(s.link, 'cable');
  assert.ok(s.dongle, 'and a dongle for the battery');
  assert.equal(s.label, 'Demo keyboard');
  assert.equal(await s.scan(), true, 'a scan does not drop the demo');
  assert.equal(await s.pollBattery(), 78);
  s.setLighting({ mode: 9 });
  assert.equal((await s.applyLighting()).ok, true);
  assert.equal(s.cable.device.light[0], 9);
  await s.disconnect();
  assert.equal(s.demo, false);
  assert.equal(s.lighting.mode, 4, 'what the session held before the demo is back');
});

// -------------------------------------------------------------------------------- how the app tells it from the rest

test('the F75 HE has its own USB ids and family, and main.js lets the app open them', () => {
  const wired = P.deviceFor(0x38a6, 0x2729);
  const dongle = P.deviceFor(0x0c45, 0xfefe);
  assert.equal(wired.family, 'he');
  assert.equal(wired.link, 'wired');
  assert.equal(dongle.family, 'he');
  assert.equal(dongle.link, 'dongle');
  assert.ok(wired.supported && dongle.supported);
  const main = read('main.js');
  assert.match(main, /\[0x38a6, 0x2729\]/);
  assert.match(main, /\[0x0c45, 0xfefe\]/);
});

test('webhid lists an F75 HE as its own family, names the shared receiver by its product name, and never offers it the F75 protocol', async () => {
  const cable = W.describe({ vendorId: 0x38a6, productId: 0x2729, productName: 'AULA F75 HE', collections: [{ usagePage: 0xff68, usage: 0x61 }] });
  assert.equal(cable.family, 'he');
  assert.equal(cable.supported, true);
  const dongle = W.describe({ vendorId: 0x0c45, productId: 0xfefe, productName: 'AULA F75 HE Dongle', collections: [{ usagePage: 0xff60, usage: 0x61 }] });
  assert.equal(dongle.supported, true);
  assert.equal(dongle.confirm, false);
  const bare = W.describe({ vendorId: 0x0c45, productId: 0xfefe, productName: '2.4G Wireless Receiver', collections: [{ usagePage: 0xff60, usage: 0x61 }] });
  assert.equal(bare.confirm, true, 'a name that does not say which model it is waits for a yes');
  const mini = W.describe({ vendorId: 0x0c45, productId: 0xfefe, productName: 'AULA MINI 60 HE PRO', collections: [{ usagePage: 0xff60, usage: 0x61 }] });
  assert.equal(mini.supported, false, 'another Hall-effect model behind the same receiver');
  const newer = W.describe({ vendorId: 0x38a6, productId: 0x9999, productName: 'AULA F75 HE', collections: [{ usagePage: 0xff68, usage: 0x61 }] });
  assert.equal(newer.supported, false, 'an F75 HE with ids this app does not know is not guessed at');
  assert.match(newer.why, /F75 HE/);

  const found = await W.discover({ getDevices: async () => [new H.SimKeyboard({ frame: 64 }), new H.SimKeyboard({ frame: 32 })] });
  assert.deepEqual(found, [], 'the F75 protocol never tries an F75 HE');
});

// --------------------------------------------------------------------------------------------------- the picture

test('the F75 HE has a skin of its own that no other model shares, and a rendered picture with a cap for every key', () => {
  const skin = SK.get('f75he');
  assert.equal(skin.id, 'f75he');
  for (const other of ['f75', 'f75pro', 'f87', 'max']) {
    const o = SK.get(other);
    assert.notEqual(skin.case.top, o.case.top, `case differs from ${other}`);
    assert.notEqual(skin.cap.face[0], o.cap.face[0], `caps differ from ${other}`);
  }
  assert.ok(skin.knob && skin.knob.r > 0.4, 'the F75 HE has a knob, at the right end of the function row');
  assert.ok(!('x' in skin.knob) && !('y' in skin.knob), 'the knob takes the default place: the top right corner of the key block');
  const dir = path.join(root, 'src', 'img', 'board');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const e = man.skins.f75he;
  assert.ok(e && e.base, 'f75he base in the manifest');
  assert.ok(fs.existsSync(path.join(dir, e.base.file)));
  assert.equal(e.base.w, Math.round((H.GRID.w + 2) * man.scale), 'the same scale as the other models');
  assert.equal(e.base.h, Math.round((H.GRID.h + 2 + 0.35) * man.scale), 'the picture was rendered for the board\'s own grid (function row apart)');
  for (const k of H.keyLayout()) {
    const acc = SK.accentOf(skin, k.legend); // the picture is the F75 window's: it names every key by the label the F75 prints
    const cap = e.caps[`${k.w}|${acc ? acc.name : '-'}`];
    assert.ok(cap, `a cap for ${k.name} (${k.w}u)`);
    assert.ok(fs.existsSync(path.join(dir, cap.file)), `${cap.file} exists`);
  }
  for (const level of Object.keys(man.mips)) assert.ok(man.mips[level].f75he, `a ${level}px copy of the F75 HE picture`);
  assert.match(read('src/img/board/manifest.js'), /"f75he"/, 'the script copy of the manifest has it too');
});

test('the F75 HE is pictured as the real black, white and grey board: white letters with dark print, grey modifiers, darker F5-F8, black Esc / Enter / arrows / space', () => {
  const skin = SK.get('f75he');
  const legendOf = (name) => H.keyLayout().find((k) => k.name === name).legend;
  const accent = (n) => (SK.accentOf(skin, legendOf(n)) ? SK.accentOf(skin, legendOf(n)).name : '-');
  for (const n of ['q', 'a', 'z', '1', 'f1', 'f4', 'f9', 'f12', 'backslash', 'grave']) assert.equal(accent(n), '-', `${n} is a plain white cap`);
  for (const n of ['tab', 'capslock', 'shiftleft', 'shiftright', 'ctrlleft', 'winleft', 'altleft', 'fn', 'ctrlright', 'backspace', 'delete', 'pageup', 'pagedown', 'end']) assert.equal(accent(n), 'grey', n);
  for (const n of ['f5', 'f6', 'f7', 'f8']) assert.equal(accent(n), 'dark', n);
  for (const n of ['esc', 'enter', 'up', 'down', 'left', 'right', 'space']) assert.equal(accent(n), 'black', n);
  // print: dark on the white caps, white on every coloured cap, so every legend can be read
  assert.ok(SK.luma(skin.cap.face[0]) > 0.85 && SK.luma(skin.cap.legend) < 0.2, 'dark print on white caps');
  for (const a of Object.values(skin.accents)) assert.ok(SK.luma(a.legend) > 0.9 && SK.luma(a.face[0]) < 0.6, `${a.name}: white print on a darker cap`);
  assert.ok(SK.luma(skin.case.top) < 0.2, 'a black case');
});

test('a colour painted on a white cap is laid on with multiply, so it stays true (hard-light would turn orange yellow); the F75 preview decides by the cap\'s own brightness', () => {
  const pv = read('src/js/preview.js');
  assert.match(pv, /const lightFace = S\.luma\(f0\) > 0\.6;/, 'a light face is told from a dark one by its brightness');
  assert.match(pv, /ctx\.globalCompositeOperation = lightFace \? 'multiply' : 'hard-light';/, 'a light cap gets multiply, a dark one hard-light');
  for (const id of ['f75', 'f75pro', 'f87', 'max', 'f75he']) {
    assert.equal(SK.get(id).cap.blend, undefined, `${id}: the skin does not say how paint lies on it, the picture works that out`);
  }
});

test('the F75 HE and the white F75 Max are lit by the F75 preview, which glows from under and round the caps; the Max screen draws no board of its own', () => {
  for (const id of ['f75he', 'max']) assert.equal(SK.get(id).underlight, undefined, `${id} has no separate under-light flag: every rendered picture is lit that way`);
  const pv = read('src/js/preview.js');
  assert.match(pv, /light only shows in the narrow gaps round each cap/, 'the rendered boards show their light in the gaps and at the foot of each cap');
  const ui = read('src/js/max-ui.js');
  assert.doesNotMatch(ui, /mx-key|mx-lamp|mx-board|makeBoard|AulaMaxMotion/, 'no second board or second motion code in the Max screen');
  assert.ok(!fs.existsSync(path.join(root, 'src', 'js', 'max-motion.js')), 'max-motion.js is gone');
  assert.doesNotMatch(read('src/css/max.css'), /\.mx-board|\.mx-key|\.stage-max/, 'and so are its styles');
});

test('the screen serves both families, loads after both protocol modules, and the F75 HE\'s own page has no settings to apply', () => {
  const html = read('src/index.html');
  const at = (f) => html.indexOf(`js/${f}`);
  assert.ok(at('max.js') > -1 && at('he.js') > at('max.js') && at('max-ui.js') > at('he.js'), 'he.js is loaded before max-ui.js');
  const ui = read('src/js/max-ui.js');
  assert.match(ui, /skin: 'f75he'/);
  assert.match(ui, /session: 'HeSession'/);
  assert.match(ui, /hasSettings: false/);
  assert.match(ui, /run\(max\.sync\(\)\)/, 'the Keyboard page has a Read from keyboard button');
});

// -------------------------------------------------------------------------------------------- nine brightness levels, as on the F75

test('the F75 HE has nine brightness levels, like the F75: the block carries 1 to 9 and reads them back', () => {
  assert.equal(H.BRIGHT_LEVELS, 9);
  for (let b = 1; b <= 9; b++) {
    const p = H.lightingPayload({ mode: 8, rgb: [1, 2, 3], colorful: false, brightness: b, speed: 3, direction: 0 });
    assert.equal(p[9], b, `level ${b} is written as it is`);
    assert.equal(H.parseLighting(p).brightness, b, `level ${b} is read back as it is`);
  }
  assert.equal(H.lightingPayload({ mode: 8, rgb: [1, 2, 3], colorful: false, brightness: 12, speed: 3, direction: 0 })[9], 9, 'above the top level is held at 9');
});

test('the session keeps brightness between 1 and 9 and leaves speed at 1 to 5', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session([sim]);
  await s.scan();
  s.setLighting({ mode: 3, brightness: 9, speed: 9 });
  assert.equal(s.lighting.brightness, 9);
  assert.equal(s.lighting.speed, 5);
  s.setLighting({ brightness: 0 });
  assert.equal(s.lighting.brightness, 1, 'there is no Off level: Off is an effect');
  s.setLighting({ brightness: 7 });
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(sim.light[9], 7, 'the keyboard is sent level 7');
});

test('the F75 HE screen offers nine brightness steps, and the keyboard picture follows the level', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  assert.match(ui, /brightLevels: \(window\.AulaHe && window\.AulaHe\.BRIGHT_LEVELS\) \|\| 9/, 'the HE family has nine levels');
  assert.match(ui, /brightLevels: 5/, 'the Max keeps its five');
  assert.match(ui, /max: BL/, 'the slider runs to the family\'s top level');
  assert.match(ui, /meter\('mxMeterBright', BL\)/, 'the meter has one tick per level');
  assert.ok(!/l\.brightness\}( of |\/)5/.test(ui), 'no brightness text says "of 5" any more (speed and response really are 1 to 5)');
  assert.match(ui, /brightness: brightShare\(\) \* 4/, 'the picture is dimmed by the brightness level, on the preview\'s 0 to 4 scale');
});

// -------------------------------------------------------------------------------------------- the effect cards are colourful on the F75 HE

test('the F75 HE\'s effect cards are drawn in colour, the Max\'s are not touched', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  assert.equal((ui.match(/colourCards: true/g) || []).length, 1, 'one family asks for it');
  const he = ui.slice(ui.indexOf('    he: {'));
  assert.match(he.slice(0, he.indexOf('\n    },')), /colourCards: true/, 'and it is the F75 HE');
  assert.match(ui, /FX\.draw\(entry\.c, FAM\.fxMode\(entry\.e\.mode\), t, cardState\(entry\)\)/, 'a card is drawn with its own state');

  // the real cardState, run against the real list of the HE's effects
  const start = ui.indexOf('const cardState = (entry) => {');
  const end = ui.indexOf('\n    };', start) + '\n    };'.length;
  const make = new Function('FAM', 'fxState', 'max', `${ui.slice(start, end)}\n return cardState;`);
  const st = { rgb: [0x6e, 0x7b, 0xff], colorful: false, direction: 0, speed: 3 };
  const heCards = make({ colourCards: true }, () => ({ ...st }), { lighting: { mode: 8 } });
  const plain = make({}, () => ({ ...st }), { lighting: { mode: 8 } });
  const byMode = (m) => ({ e: H.EFFECTS.find((e) => e.mode === m) });
  const multi = H.EFFECTS.filter((e) => e.mode > 1 && e.color === false);
  const either = H.EFFECTS.filter((e) => e.mode > 1 && e.color !== false && e.mode !== 8);
  assert.ok(multi.length > 0 && either.length > 0, 'the HE has both kinds of effect');

  assert.equal(heCards(byMode(0)).colorful, false, 'Off stays dark');
  assert.equal(heCards(byMode(1)).colorful, false, 'Static\'s card is the colour you chose');
  for (const e of multi) assert.equal(heCards({ e }).colorful, true, `${e.name} always runs in several colours, so its card does`);
  for (const e of either) assert.equal(heCards({ e }).colorful, true, `${e.name} can run in either: its card shows it in colour`);
  const running = either[0];
  const onNow = make({ colourCards: true }, () => ({ ...st }), { lighting: { mode: running.mode } });
  assert.equal(onNow({ e: running }).colorful, false, 'the running effect\'s card shows the real light, in the chosen colour');
  const rainbow = make({ colourCards: true }, () => ({ ...st, colorful: true }), { lighting: { mode: running.mode } });
  assert.equal(rainbow({ e: running }).colorful, true, 'and in colour when multicolour is what is chosen');
  assert.deepEqual(heCards({ e: either[0] }).rgb, st.rgb, 'the chosen colour is kept');
  for (const m of [0, 1, either[0].mode, multi[0].mode]) assert.equal(plain(byMode(m)).colorful, false, 'a family without it is drawn as before');
});
