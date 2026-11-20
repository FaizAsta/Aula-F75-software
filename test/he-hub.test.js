'use strict';

/*
 * The AULA F75 HE against AULA's own web driver. test/fixtures/aula-f75he-hub-effects-capture-2026-11-17.txt is a passive log
 * of hub.aulacn.com talking to a real F75 HE (firmware V1.55, USB-C cable): the page asks who the keyboard is, reads its
 * lighting, its key map and its per-key colours, and then a script clicked each of the 19 lighting effects the page offers,
 * one after the other. Every frame the page sent and every frame the keyboard answered is in the file.
 *
 * These tests hold the app to that capture: the same mode number and name for every effect, the same 16 bytes written for each
 * click, the same requests for the reads, and the per-key table of the size the driver reads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/js/he.js');
const { memoryStorage } = require('../src/js/engine.js');

const TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'aula-f75he-hub-effects-capture-2026-11-17.txt'), 'utf8');
const hexOf = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Every TX / RX line of the capture as { dir, bytes, click } (the log shortens a frame's zero tail to "| +N zero bytes"). */
function frames(text) {
  const out = [];
  let click = null;
  for (const line of text.split('\n')) {
    const c = line.match(/^=== AUTO-CLICK (\d+)\/19: (.+) ===$/);
    if (c) {
      click = { n: Number(c[1]), name: c[2] };
      continue;
    }
    const m = line.match(/^\+\s+(\d+) ms\s+(TX|RX)\s+dev #1\s+id 0x00\s+(\d+) bytes\s+([0-9a-f ]+?)\s*(?:\|\s*\+(\d+) zero bytes)?\s*$/);
    if (!m) continue;
    const bytes = new Uint8Array(Number(m[3]));
    bytes.set(m[4].trim().split(/\s+/).map((h) => parseInt(h, 16)));
    out.push({ at: Number(m[1]), dir: m[2], bytes, click });
  }
  return out;
}
const ALL = frames(TEXT);
const TX = ALL.filter((f) => f.dir === 'TX');
const RX = ALL.filter((f) => f.dir === 'RX');

/** The frame the page sent for each effect it clicked: { name, frame } in click order. */
const CLICKS = (() => {
  const out = [];
  for (let n = 1; n <= 19; n++) {
    const f = TX.find((t) => t.click && t.click.n === n && t.bytes[1] === 0x23);
    out.push({ n, name: f.click.name, frame: f.bytes });
  }
  return out;
})();

/** The reply the keyboard gave to the request `req` (the first RX after the first TX with the same bytes). */
function replyTo(req) {
  const i = ALL.findIndex((f) => f.dir === 'TX' && hexOf(f.bytes) === hexOf(req));
  assert.ok(i >= 0, `the capture holds the request ${hexOf(req.subarray(0, 8))}`);
  const r = ALL.slice(i + 1).find((f) => f.dir === 'RX' && f.bytes[1] === req[1] && f.bytes[3] === req[3] && f.bytes[4] === req[4]);
  assert.ok(r, 'and its answer');
  return r.bytes;
}

/** The lighting block the keyboard held when the page connected (the page's first read of it). */
const LIGHT_BASE = replyTo(TX.find((t) => t.bytes[1] === 0x13).bytes).subarray(8, 24);

// ------------------------------------------------------------------------------------------------------ the capture itself

test('the capture is what it claims to be: 19 clicks, each answered by an echo of the one lighting frame the page wrote', () => {
  assert.equal(CLICKS.length, 19);
  assert.match(TEXT, /device 1: "AULA F75 HE" 38a6:2729 {2}page 0xff68 usage 0x0061/);
  for (const c of CLICKS) {
    assert.equal(c.frame.length, 64);
    assert.equal(hexOf(c.frame.subarray(0, 8)), 'aa 23 10 00 00 00 01 00', `${c.name}: one 16-byte page, offset 0, marked last`);
    const echo = RX.find((r) => r.click && r.click.n === c.n && r.bytes[1] === 0x23);
    assert.ok(echo, `${c.name} was acknowledged`);
    assert.equal(hexOf(echo.bytes.subarray(1)), hexOf(c.frame.subarray(1)), `${c.name}: the keyboard echoes what was written`);
  }
});

test('the page wrote only lighting frames while it clicked: no per-key table, no reset, nothing else', () => {
  const writes = TX.filter((t) => t.click && t.bytes[1] !== 0x14);
  assert.ok(writes.length >= 19);
  assert.ok(writes.every((t) => t.bytes[1] === 0x23), 'only 0x23 went out (reads of the per-key table aside)');
  const cmds = new Set(TX.map((t) => t.bytes[1]));
  assert.deepEqual([...cmds].sort((a, b) => a - b), [0x10, 0x12, 0x13, 0x14, 0x23], 'every command in the whole capture');
  assert.ok([...cmds].every((c) => c === 0x12 || H.SAFE.has(c)), 'all but the key-map read are commands this app is allowed to send');
});

// ------------------------------------------------------------------------------------------------------ effects

test('every effect the page offers has the same mode number and the same name in the app', () => {
  for (const c of CLICKS) {
    const mode = c.frame[8];
    if (c.name === 'Custom') {
      assert.equal(mode, H.CUSTOM, 'Custom is the per-key table');
      continue;
    }
    const e = H.effect(mode);
    assert.ok(e, `${c.name}: the app knows mode ${mode}`);
    assert.equal(e.name, c.name, `mode ${mode}`);
    assert.equal(e.hidden, false, `${c.name} is offered`);
  }
});

test('the effects the app offers are exactly the ones the page offers: no Off and no effect 14 there, and 14 is kept out of the choices', () => {
  const hub = new Set(CLICKS.map((c) => c.frame[8]));
  const offered = H.EFFECTS.filter((e) => !e.hidden).map((e) => e.mode);
  assert.deepEqual(offered.filter((m) => m !== 0), [...hub].filter((m) => m !== H.CUSTOM).sort((a, b) => a - b));
  assert.equal(hub.has(0), false, 'the page has no Off');
  assert.equal(hub.has(14), false, 'the page has no effect 14');
  assert.equal(H.effect(14).hidden, true);
  assert.equal(H.effect(14).name, 'Effect 14', 'still named when a keyboard reports it');
  assert.deepEqual(H.EFFECTS.map((e) => e.mode), Array.from({ length: 20 }, (_, i) => i), 'the table still covers modes 0 to 19');
});

// ------------------------------------------------------------------------------------------------------ the 16 bytes written

/** The lighting state the page was in, read from its own first frame (it never changes between clicks but the mode). */
const HUB_STATE = (() => {
  const p = CLICKS[0].frame.subarray(8, 24);
  return { rgb: [p[1], p[2], p[3]], colorful: p[8] === 1, brightness: p[9], speed: p[10], direction: p[11] };
})();

test('the page keeps everything but the mode the same from click to click', () => {
  for (const c of CLICKS) assert.equal(hexOf(c.frame.subarray(9, 24)), hexOf(CLICKS[0].frame.subarray(9, 24)), c.name);
  assert.deepEqual(HUB_STATE, { rgb: [0x90, 0xee, 0x90], colorful: true, brightness: 3, speed: 3, direction: 0 });
});

test('for every click, the frame the app builds for that effect is the frame the page sent, byte for byte', () => {
  for (const c of CLICKS) {
    const mode = c.frame[8];
    const payload = H.lightingPayload(HUB_STATE, mode);
    const mine = H.frame(H.CMD.SET_LIGHT, { payload, last: true, size: 64 });
    assert.equal(hexOf(mine), hexOf(c.frame), c.name);
  }
});

test('the same holds when the app starts from the block the keyboard reported (zeros in byte 4 and in the last two bytes)', () => {
  const base = LIGHT_BASE;
  assert.equal(hexOf(base), '0e ff ff ff 00 00 00 00 01 03 03 00 00 00 00 00', 'what the keyboard held when the page connected');
  for (const c of CLICKS) {
    const mine = H.frame(H.CMD.SET_LIGHT, { payload: H.lightingPayload(HUB_STATE, c.frame[8], base), last: true, size: 64 });
    assert.equal(hexOf(mine), hexOf(c.frame), c.name);
  }
});

test('a whole Apply through the app, from the keyboard\'s own state, sends the page\'s frame for each effect it offers', async () => {
  for (const c of CLICKS.filter((x) => x.name !== 'Custom')) {
    const sent = [];
    const sim = new H.SimKeyboard({ frame: 64, lightBlock: LIGHT_BASE });
    const real = sim.sendReport.bind(sim);
    sim.sendReport = (id, data) => {
      sent.push(Uint8Array.from(data));
      return real(id, data);
    };
    const s = new H.HeSession({ hid: { getDevices: async () => [sim] }, storage: memoryStorage(), waitMs: 120 });
    await s.scan();
    s.setLighting({ mode: c.frame[8], ...HUB_STATE });
    const r = await s.applyLighting();
    assert.equal(r.ok, true, `${c.name}: ${r.error}`);
    const writes = sent.filter((f) => f[1] === H.CMD.SET_LIGHT);
    assert.equal(writes.length, 1, c.name);
    assert.equal(hexOf(writes[0]), hexOf(c.frame), c.name);
    assert.equal(hexOf(sim.light), hexOf(c.frame.subarray(8, 24)), `${c.name}: and the keyboard holds it`);
    assert.deepEqual(sim.unsafe, []);
  }
});

test('Custom: the per-key page switches the keyboard with the page\'s own Custom frame', async () => {
  const custom = CLICKS.find((c) => c.name === 'Custom');
  const sent = [];
  const sim = new H.SimKeyboard({ frame: 64, lightBlock: LIGHT_BASE });
  const real = sim.sendReport.bind(sim);
  sim.sendReport = (id, data) => {
    sent.push(Uint8Array.from(data));
    return real(id, data);
  };
  const s = new H.HeSession({ hid: { getDevices: async () => [sim] }, storage: memoryStorage(), waitMs: 120 });
  await s.scan();
  s.setLighting(HUB_STATE);
  s.paint([H.KEYS.esc], [255, 0, 0]);
  const r = await s.applyKeyColors();
  assert.equal(r.ok, true, r.error);
  assert.equal(hexOf(sent.find((f) => f[1] === H.CMD.SET_LIGHT)), hexOf(custom.frame));
});

// ------------------------------------------------------------------------------------------------------ reads

test('the requests the app uses to identify the keyboard and read its lighting are the page\'s, byte for byte', () => {
  const mine = [...H.readFrames(H.CMD.INFO, H.INFO_SIZE, 64), ...H.readFrames(H.CMD.GET_LIGHT, H.LIGHT_SIZE, 64)];
  assert.equal(mine.length, 2);
  for (const req of mine) assert.ok(TX.some((t) => hexOf(t.bytes) === hexOf(req)), `the page sent ${hexOf(req.subarray(0, 8))}`);
});

test('the app reads the keyboard the capture describes: an F75 HE V1.55 that was running effect 14, white, brightness 3, speed 3', async () => {
  const answers = new Map(TX.filter((t) => [0x10, 0x13].includes(t.bytes[1])).map((t) => [hexOf(t.bytes), replyTo(t.bytes)]));
  const dev = {
    vendorId: 0x38a6,
    productId: 0x2729,
    productName: 'AULA F75 HE',
    opened: false,
    misses: [],
    _l: new Set(),
    collections: [{ usagePage: 0xff68, usage: 0x61, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 64 }] }] }],
    async open() { this.opened = true; },
    async close() { this.opened = false; },
    addEventListener(e, f) { if (e === 'inputreport') this._l.add(f); },
    removeEventListener(e, f) { this._l.delete(f); },
    async sendReport(id, data) {
      const reply = answers.get(hexOf(Uint8Array.from(data)));
      if (!reply) return void this.misses.push(hexOf(Uint8Array.from(data).subarray(0, 8)));
      setTimeout(() => this._l.forEach((f) => f({ reportId: 0, data: new DataView(reply.slice().buffer) })), 1);
    },
  };
  const s = new H.HeSession({ hid: { getDevices: async () => [dev] }, storage: memoryStorage(), waitMs: 200 });
  assert.equal(await s.scan(), true);
  const r = await s.sync();
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(dev.misses, []);
  assert.equal(s.info.version, 'V1.55');
  assert.equal(H.verdictOf(s.info), 'he');
  assert.deepEqual(s.lighting, { mode: 14, rgb: [255, 255, 255], colorful: true, brightness: 3, speed: 3, direction: 0 });
  assert.equal(H.effect(s.lighting.mode).name, 'Effect 14', 'an effect the page does not offer is still shown, not dropped');
});

// ------------------------------------------------------------------------------------------------------ the per-key table

/** The 512 bytes of the per-key table as the page read them (ten pages), and the pages' own offsets and lengths. */
const PAGES = TX.filter((t) => t.bytes[1] === 0x14 && t.click == null).map((t) => ({ req: t.bytes, rep: replyTo(t.bytes) }));

test('the page reads the per-key table as 0x200 bytes: nine pages of 56 and one of 8, the last marked', () => {
  assert.equal(PAGES.length, 10);
  assert.deepEqual(PAGES.map((p) => p.req[2]), [56, 56, 56, 56, 56, 56, 56, 56, 56, 8]);
  assert.deepEqual(PAGES.map((p) => p.req[3] | (p.req[4] << 8)), [0, 56, 112, 168, 224, 280, 336, 392, 448, 504]);
  assert.deepEqual(PAGES.map((p) => p.req[6]), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test('the table it read has 128 records that each carry their own key number, with one key lit', () => {
  const table = new Uint8Array(512);
  for (const p of PAGES) table.set(p.rep.subarray(8, 8 + p.req[2]), p.req[3] | (p.req[4] << 8));
  assert.equal(H.LED_COUNT, 128);
  assert.equal(H.KEYS_SIZE, 512);
  for (let i = 0; i < 128; i++) assert.equal(table[i * 4], i, `record ${i}`);
  assert.deepEqual([...H.parseKeyTable(table)], [[0x20, [0x59, 0x18, 0xe3]]]);
  assert.equal(hexOf(table.subarray(504)), '7e 00 00 00 7f 00 00 00', 'records 126 and 127 exist and are off');
});

test('the app writes the per-key table in the same pages the page reads it in', () => {
  const mine = H.writeFrames(H.CMD.SET_KEYS, H.keyTable(new Map()), 64);
  assert.equal(mine.length, PAGES.length);
  mine.forEach((f, i) => {
    assert.equal(f[1], H.CMD.SET_KEYS);
    assert.equal(f[2], PAGES[i].req[2], `page ${i + 1}: length`);
    assert.equal(f[3] | (f[4] << 8), PAGES[i].req[3] | (PAGES[i].req[4] << 8), `page ${i + 1}: offset`);
    assert.equal(f[6], PAGES[i].req[6], `page ${i + 1}: last flag`);
  });
});

// ------------------------------------------------------------------------------------------------------ Off (the app's own)

test('Off is the page\'s own Static frame with no light in it: mode 1, colour 000000, one-colour flag 0, and never mode 0', () => {
  const stat = CLICKS.find((c) => c.name === 'Static').frame;
  const off = H.frame(H.CMD.SET_LIGHT, { payload: H.lightingPayload({ ...HUB_STATE, mode: 0 }), last: true, size: 64 });
  const expected = stat.slice();
  expected.set([0, 0, 0], 9); // colour
  expected[16] = 0; // the one-colour flag
  assert.equal(hexOf(off), hexOf(expected));
  assert.equal(off[8], 1, 'mode 1, never 0');
  assert.equal(H.parseLighting(off.subarray(8, 24)).mode, 0, 'a keyboard that holds it is shown as Off');
});

test('Static in black with the random-colour flag on is not Off, and Static in a colour is not Off', () => {
  const block = (rgb, flag) => Uint8Array.from([1, ...rgb, 0xff, 0, 0, 0, flag, 3, 3, 0, 0, 0, 0xaa, 0x55]);
  assert.equal(H.parseLighting(block([0, 0, 0], 0)).mode, 0);
  assert.equal(H.parseLighting(block([0, 0, 0], 1)).mode, 1);
  assert.equal(H.parseLighting(block([0, 0, 1], 0)).mode, 1);
  assert.equal(H.parseLighting(block([144, 238, 144], 0)).mode, 1);
});

test('Apply with Off sends that frame, the keyboard holds it, and the colour the person had chosen comes back with Static', async () => {
  const sent = [];
  const sim = new H.SimKeyboard({ frame: 64, lightBlock: LIGHT_BASE });
  const real = sim.sendReport.bind(sim);
  sim.sendReport = (id, data) => {
    sent.push(Uint8Array.from(data));
    return real(id, data);
  };
  const s = new H.HeSession({ hid: { getDevices: async () => [sim] }, storage: memoryStorage(), waitMs: 120 });
  await s.scan();
  s.setLighting({ mode: 8, rgb: [10, 20, 30], colorful: false, brightness: 4, speed: 2, direction: 0 });
  s.setLighting({ mode: 0 });
  const r = await s.applyLighting();
  assert.equal(r.ok, true, r.error);
  const writes = sent.filter((f) => f[1] === H.CMD.SET_LIGHT);
  assert.equal(writes.length, 1);
  assert.equal(hexOf(writes[0].subarray(8, 24)), '01 00 00 00 ff 00 00 00 00 04 02 00 00 00 aa 55');
  assert.deepEqual(sent.filter((f) => f[1] === H.CMD.SET_LIGHT).map((f) => f[8]), [1], 'mode 0 never reached the keyboard');

  const again = new H.HeSession({ hid: { getDevices: async () => [sim] }, storage: memoryStorage(), waitMs: 120 });
  await again.scan();
  again.setLighting({ rgb: [10, 20, 30] });
  const rr = await again.sync();
  assert.equal(rr.ok, true, rr.error);
  assert.equal(again.lighting.mode, 0, 'read back as Off');
  assert.deepEqual(again.lighting.rgb, [10, 20, 30], 'the colour the app remembered is kept, not the black the keyboard holds');
  again.setLighting({ mode: 1 });
  assert.deepEqual(H.lightingPayload(again.lighting).subarray(0, 4), Uint8Array.from([1, 10, 20, 30]));
});
