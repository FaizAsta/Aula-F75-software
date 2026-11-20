'use strict';

/*
 * The AULA F75 HE against what a real one answered. test/fixtures holds the two reports that tools/he-probe.html saved from a
 * real F75 HE (firmware V1.55) on 2026-11-17, one over the USB-C cable and one over the 2.4G dongle. The first group replays
 * every request and reply of those reports through the app's own link and session code, so a request this app builds that the
 * real keyboard was never seen to answer fails here. The second group writes to a simulated keyboard that holds the bytes the
 * real one held, and checks that a write changes only what the app understands and carries the framing bytes AULA's own
 * driver sends (test/he-hub.test.js replays that driver's capture).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/js/he.js');
const { memoryStorage } = require('../src/js/engine.js');

const CABLE = path.join(__dirname, 'fixtures', 'aula-f75he-probe-usb-c-cable-2026-11-17.txt');
const DONGLE = path.join(__dirname, 'fixtures', 'aula-f75he-probe-2-4g-dongle-2026-11-17.txt');

const hexOf = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join(' ');
const bytesOf = (s) => Uint8Array.from(s.trim().split(/\s+/).map((h) => parseInt(h, 16)));

/** Every TX / RX pair of a report, keyed by interface number and request bytes. */
function pairsOf(text) {
  const lines = text.split('\n');
  const map = new Map();
  let tx = null;
  let dev = 0;
  lines.forEach((l, i) => {
    const d = l.match(/^=== Device (\d+) of/);
    if (d) dev = Number(d[1]);
    if (/\bTX\s+id 0x00\s+\d+ bytes/.test(l)) tx = lines[i + 1].trim();
    const rx = l.match(/\bRX\s+id 0x00\s+\d+ bytes\s+([0-9a-f ]+)$/);
    if (rx && tx) {
      map.set(`${dev}|${tx.replace(/\s+/g, ' ')}`, rx[1].trim().replace(/\s+/g, ' '));
      tx = null;
    }
  });
  return map;
}

/** The hex dump under a heading of the report ("lighting block (16 bytes):" and so on) as bytes. */
function dumpOf(text, heading) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(at >= 0, `${heading} is in the report`);
  const out = [];
  for (let i = at + 1; i < lines.length && /^\s+[0-9a-f]{4}\s/.test(lines[i]); i++) out.push(...lines[i].trim().split(/\s+/).slice(1));
  return bytesOf(out.join(' '));
}

/** A HID device that answers exactly what the real keyboard answered in the report, and records what it was never seen to answer. */
class Replay {
  constructor(map, devNo, { vid, pid, name, page, size }) {
    Object.assign(this, { map, devNo, vendorId: vid, productId: pid, productName: name, opened: false, misses: [], _l: new Set() });
    this.collections = [{ usagePage: page, usage: 0x61, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: size }] }] }];
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  addEventListener(e, f) {
    if (e === 'inputreport') this._l.add(f);
  }

  removeEventListener(e, f) {
    this._l.delete(f);
  }

  async sendReport(id, data) {
    const key = `${this.devNo}|${hexOf(Uint8Array.from(data))}`;
    const reply = this.map.get(key);
    if (!reply) {
      this.misses.push(key);
      return;
    }
    const b = bytesOf(reply);
    setTimeout(() => this._l.forEach((f) => f({ reportId: 0, data: new DataView(b.buffer) })), 2);
  }
}

const cableText = fs.readFileSync(CABLE, 'utf8');
const dongleText = fs.readFileSync(DONGLE, 'utf8');
const realCable = () => new Replay(pairsOf(cableText), 2, { vid: 0x38a6, pid: 0x2729, name: 'AULA F75 HE', page: 0xff68, size: 64 });
const realDongle = () => new Replay(pairsOf(dongleText), 1, { vid: 0x0c45, pid: 0xfefe, name: 'AULA F75 HE Dongle', page: 0xff60, size: 32 });
const sessionOf = (dev) => new H.HeSession({ hid: { getDevices: async () => [dev] }, storage: memoryStorage(), waitMs: 200 });

// ------------------------------------------------------------------------------------------------------ reads

test('real F75 HE over the USB-C cable: the app reads who it is and its lighting with requests the keyboard was seen to answer', async () => {
  const dev = realCable();
  const s = sessionOf(dev);
  assert.equal(await s.scan(), true);
  assert.equal(s.link, 'cable');
  const r = await s.sync();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(dev.misses, [], 'every request the app built is one the real keyboard answered');
  assert.equal(s.info.vid, 0x38a6);
  assert.equal(s.info.pid, 0x2729);
  assert.equal(s.info.version, 'V1.55');
  assert.equal(H.verdictOf(s.info), 'he');
  assert.deepEqual(s.lighting, { mode: 19, rgb: [255, 255, 255], colorful: false, brightness: 5, speed: 4, direction: 0 });
  assert.equal(s.fromKeyboard, true);
});

test('real F75 HE over the cable: no battery is shown, because the byte read as a battery there is not one', async () => {
  // The same offset gave 16 on the cable and 100 on the dongle for one keyboard minutes apart, and the bytes next to it on the
  // cable (16 0a 22 10) look like a date, not a level. The app keeps reading the battery only from the dongle.
  const s = sessionOf(realCable());
  await s.scan();
  await s.sync();
  assert.equal(await s.pollBattery(), null);
  assert.equal(s.battery.percent, null);
});

test('real F75 HE over the 2.4G dongle: 32-byte frames, 3 info pages and 21 key pages all answered, battery read', async () => {
  const dev = realDongle();
  const s = sessionOf(dev);
  assert.equal(await s.scan(), true);
  assert.equal(s.link, 'dongle');
  const r = await s.sync();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(dev.misses, []);
  assert.equal(s.info.version, 'V1.55');
  assert.deepEqual(s.lighting, { mode: 19, rgb: [255, 255, 255], colorful: false, brightness: 5, speed: 4, direction: 0 });
  assert.equal(await s.pollBattery(), 100);
  assert.equal(s.battery.percent, 100);
});

test('the real per-key table is read page by page on both links and is the same table', async () => {
  for (const [dev, pages] of [[realCable(), 9], [realDongle(), 21]]) {
    const s = sessionOf(dev);
    await s.scan();
    const link = s.cable || s.dongle;
    const table = await link.read(H.CMD.GET_KEYS, H.KEYS_READ);
    assert.equal(H.readFrames(H.CMD.GET_KEYS, H.KEYS_READ, link.size).length, pages);
    assert.deepEqual(dev.misses, []);
    assert.deepEqual([...H.parseKeyTable(table)], [[0x20, [0x59, 0x18, 0xe3]]], 'one key is lit, the same one on both links');
    for (let i = 0; i < H.KEYS_READ / 4; i++) assert.equal(table[i * 4], i, `record ${i} carries its own key number`);
  }
});

test('the first answer of the sleeping dongle (about half a second) is inside the time the app waits', () => {
  const tx = dongleText.match(/\+ (\d+) ms\s+TX\s+id 0x00\s+32 bytes\s+INFO page 1\/3/);
  const rx = dongleText.match(/\+ (\d+) ms\s+RX\s+id 0x00\s+32 bytes\s+55 10 18 00/);
  const took = Number(rx[1]) - Number(tx[1]);
  assert.ok(took > 100 && took < 600, `the first reply took ${took} ms`);
});

// ------------------------------------------------------------------------------------------------------ writes

/** A simulated keyboard that holds the bytes the real one held in the report. */
function holding(text, size) {
  return new H.SimKeyboard({
    frame: size,
    name: size === 64 ? 'AULA F75 HE' : 'AULA F75 HE Dongle',
    infoBlock: dumpOf(text, 'info block'),
    lightBlock: dumpOf(text, 'lighting block'),
    keyBlock: dumpOf(text, 'per-key colour table'),
  });
}
const sessionFor = (sim) => new H.HeSession({ hid: { getDevices: async () => [sim] }, storage: memoryStorage(), waitMs: 120 });

test('the simulated keyboard holds the real bytes: 00 in byte 4 and in the last two bytes of the lighting block', () => {
  for (const [text, size] of [[cableText, 64], [dongleText, 32]]) {
    const sim = holding(text, size);
    assert.equal(hexOf(sim.light), '13 ff ff ff 00 00 00 00 01 05 04 00 00 00 00 00');
    assert.equal(sim.keys.length, 512, 'the keyboard\'s table is 128 records; the report holds the first 126');
    assert.equal(hexOf(sim.keys.subarray(0x20 * 4, 0x20 * 4 + 4)), '20 59 18 e3');
  }
});

for (const [name, text, size] of [['USB-C cable', cableText, 64], ['2.4G dongle', dongleText, 32]]) {
  test(`Apply on a real F75 HE (${name}) changes only the bytes the app understands`, async () => {
    const sim = holding(text, size);
    const s = sessionFor(sim);
    await s.scan();
    s.setLighting({ mode: 7, rgb: [10, 20, 30], colorful: false, brightness: 3, speed: 2, direction: 0 });
    const r = await s.applyLighting();
    assert.equal(r.ok, true, r.error);
    // mode 7, colour, flag 0, brightness 3, speed 2, direction 0, and the ff and aa 55 AULA's own driver sends; bytes 5 to 7 and 12 to 13 as the keyboard had them
    assert.equal(hexOf(sim.light), '07 0a 14 1e ff 00 00 00 00 03 02 00 00 00 aa 55');
    assert.deepEqual(sim.unsafe, []);
  });

  test(`Per-key Apply on a real F75 HE (${name}) switches to mode 20 and writes the whole 128-record table`, async () => {
    const sim = holding(text, size);
    const s = sessionFor(sim);
    await s.scan();
    s.paint([H.KEYS.esc], [255, 0, 0]);
    const r = await s.applyKeyColors();
    assert.equal(r.ok, true, r.error);
    assert.equal(sim.light[0], 20);
    assert.equal(sim.light[4], 0xff);
    assert.equal(sim.light[14], 0xaa);
    assert.equal(sim.light[15], 0x55);
    assert.deepEqual([...H.parseKeyTable(sim.keys)], [[0, [255, 0, 0]]], 'the colour that was already in the table is replaced by the app\'s own');
    assert.equal(hexOf(sim.keys.subarray(127 * 4)), '7f 00 00 00', 'the last record of the table was written too');
  });

  test(`Reset on a real F75 HE (${name}) ends on the default effect with the driver's framing bytes`, async () => {
    const sim = holding(text, size);
    const s = sessionFor(sim);
    await s.scan();
    const r = await s.factoryReset();
    assert.equal(r.ok, true, r.error);
    assert.equal(sim.light[0], H.DEFAULT_LIGHTING.mode);
    assert.equal(sim.light[4], 0xff);
    assert.equal(sim.light[14], 0xaa);
    assert.equal(sim.light[15], 0x55);
    assert.equal(H.parseKeyTable(sim.keys).size, 0);
    assert.deepEqual(sim.unsafe, []);
  });
}

test('when the keyboard holds no readable lighting block, the write falls back to the layout the app started from', async () => {
  const sim = new H.SimKeyboard({ frame: 64, lightBlock: new Uint8Array(16) });
  const s = sessionFor(sim);
  await s.scan();
  s.setLighting({ mode: 1, rgb: [1, 2, 3], colorful: false, brightness: 4, speed: 3, direction: 0 });
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  assert.equal(hexOf(sim.light), '01 01 02 03 ff 00 00 00 00 04 03 00 00 00 aa 55');
});

test('lightingPayload with no keyboard block is what it always was, and with one it keeps only the keyboard\'s bytes 5 to 7 and 12 to 13', () => {
  const l = { mode: 10, rgb: [1, 2, 3], colorful: false, brightness: 3, speed: 2, direction: 1 };
  assert.deepEqual([...H.lightingPayload(l)], [10, 1, 2, 3, 0xff, 0, 0, 0, 0, 3, 2, 1, 0, 0, 0xaa, 0x55]);
  const base = Uint8Array.from([19, 255, 255, 255, 0, 9, 8, 7, 1, 5, 4, 0, 6, 5, 4, 3]);
  assert.deepEqual([...H.lightingPayload(l, l.mode, base)], [10, 1, 2, 3, 0xff, 9, 8, 7, 0, 3, 2, 1, 6, 5, 0xaa, 0x55]);
  assert.deepEqual([...base], [19, 255, 255, 255, 0, 9, 8, 7, 1, 5, 4, 0, 6, 5, 4, 3], 'the block that was passed in is not changed');
});
