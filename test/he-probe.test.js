'use strict';

/*
 * tools/he-probe.html is a one-file, read-only probe a person with an F75 HE runs to save what the keyboard answers.
 * Its logic sits between the "probe-core" markers; these tests load exactly that text and run it against the simulated
 * keyboards, so the page and the app cannot drift apart, and so the page is shown never to send anything but reads.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const He = require('../src/js/he.js');
const P = require('../src/js/protocol.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'he-probe.html'), 'utf8');
const core = html.slice(html.indexOf('// <probe-core>'), html.indexOf('// </probe-core>'));
const Probe = new Function(`${core}\nreturn { runProbe, hfdFrames, f75StatusPacket, f75FeaturePacket, parseInfo, describeCollections, HFD_PAGES };`)();

const FAST = { waitMs: 25, tries: 3, idleMs: 0 };
const run = (devs, extra = {}) => Probe.runProbe(devs, { ...FAST, ua: 'test-browser', platform: 'test', label: 'USB-C cable', ...extra });
const READS = new Set([0x10, 0x13, 0x14]);

/** A device that records every report it is sent and answers like `reply(kind, id, data, emit)` says. */
function fake({ vid = 0x1234, pid = 0x5678, name = 'Fake', collections, openError = null, reply = null } = {}) {
  const listeners = new Set();
  const d = {
    vendorId: vid, productId: pid, productName: name, collections, opened: false, sent: [], features: [],
    async open() { if (openError) throw new Error(openError); d.opened = true; },
    async close() { d.opened = false; },
    addEventListener(t, f) { if (t === 'inputreport') listeners.add(f); },
    removeEventListener(t, f) { listeners.delete(f); },
    emit(reportId, bytes) { for (const f of [...listeners]) f({ reportId, data: new DataView(Uint8Array.from(bytes).buffer) }); },
    async sendReport(id, data) { d.sent.push([id, Uint8Array.from(data)]); if (reply) reply('out', id, Uint8Array.from(data), d); },
    async sendFeatureReport(id, data) { d.features.push([id, Uint8Array.from(data)]); if (reply) reply('feature', id, Uint8Array.from(data), d); },
    async receiveFeatureReport(id) { return new DataView((d.featureAnswer || new Uint8Array(519)).buffer); },
  };
  return d;
}
const vendorCol = (page, out = [], feature = []) => ({ usagePage: page, usage: 0x61, inputReports: [], outputReports: out, featureReports: feature });
const rep = (reportId, bytes) => ({ reportId, items: [{ reportSize: 8, reportCount: bytes }] });

test('probe frames are byte for byte the ones the app sends', () => {
  const total = { 0x10: He.INFO_SIZE, 0x13: He.LIGHT_SIZE, 0x14: He.KEYS_READ };
  for (const size of [64, 32]) {
    for (const cmd of [0x10, 0x13, 0x14]) {
      const mine = Probe.hfdFrames(cmd, size).map((f) => Array.from(f.frame));
      const theirs = He.readFrames(cmd, total[cmd], size).map((f) => Array.from(f));
      assert.deepEqual(mine, theirs, `cmd ${cmd} size ${size}`);
    }
  }
});

test('the F75-family requests are byte for byte the ones the app sends', () => {
  assert.deepEqual(Array.from(Probe.f75StatusPacket()), Array.from(P.buildPacket(P.CMD.GET_STATUS, 1, 0, 0)));
  assert.deepEqual(Array.from(Probe.f75FeaturePacket()), Array.from(P.buildFeature(P.WIRE.led.read, P.WIRE.led.size, null)));
});

test('the probe cannot build a frame for any command but the three reads', () => {
  for (const cmd of [0x23, 0x24, 0x0f, 0x4f, 0x64, 0x65, 0x66, 0x67, 0x30, 0x31, 0x00, 0xff]) {
    assert.throws(() => Probe.hfdFrames(cmd, 64), /only reads/, `0x${cmd.toString(16)}`);
  }
});

test('an F75 HE on the cable: answered, identity matches, and only reads were sent', async () => {
  const sim = new He.SimKeyboard({ frame: 64, percent: 78 });
  const before = { light: sim.light.slice(), keys: sim.keys.slice() };
  const res = await run([sim]);
  assert.equal(res.overall, 'he');
  assert.deepEqual(sim.unsafe, []);
  assert.ok(sim.log.length > 0 && sim.log.every(([cmd]) => READS.has(cmd)), 'only read commands reached the keyboard');
  assert.deepEqual(Array.from(sim.light), Array.from(before.light), 'the lighting block is untouched');
  assert.deepEqual(Array.from(sim.keys), Array.from(before.keys), 'the key table is untouched');
  assert.match(res.text, /names itself 38a6:2729/);
  assert.match(res.text, /battery 78%/);
  assert.match(res.text, /126 of 126 records carry their own key number/);
  assert.match(res.text, /SUMMARY \(the keyboard answered the F75 HE requests and names the expected ids\)/);
  assert.equal(sim.opened, false, 'the device is closed again');
});

test('an F75 HE on the 2.4G dongle: 32-byte frames, three pages for the info block', async () => {
  const sim = new He.SimKeyboard({ frame: 32, percent: 55 });
  const res = await run([sim]);
  assert.equal(res.overall, 'he');
  assert.ok(sim.log.every(([cmd]) => READS.has(cmd)));
  assert.deepEqual(sim.log.filter(([cmd]) => cmd === 0x10).map(([, off]) => off), [0, 24, 48]);
  assert.match(res.text, /32-byte frames/);
});

test('a silent keyboard gives a report, not an exception, and asks only three times', async () => {
  const sim = new He.SimKeyboard({ frame: 64, answers: false });
  const res = await run([sim]);
  assert.equal(res.overall, 'silent');
  assert.equal(sim.log.length, 3);
  assert.match(res.text, /no answer in 25 ms/);
  assert.ok(res.findings.some((f) => f.level === 'bad'));
  assert.match(res.text, /DETAILS/);
});

test('a keyboard that names another AULA board is reported as another model', async () => {
  const other = new He.SimKeyboard({ frame: 64, identity: { vid: 0x0c45, pid: 0x80a2 } });
  const res = await run([other]);
  assert.equal(res.overall, 'answered');
  assert.match(res.text, /another AULA Hall-effect model/);
  assert.ok(res.findings.some((f) => f.kind === 'hfd-other'));
});

test('a keyboard with ids nobody has listed is reported with those ids', async () => {
  const odd = new He.SimKeyboard({ frame: 64, identity: { vid: 0x38a6, pid: 0x2731 } });
  const res = await run([odd]);
  assert.equal(res.overall, 'answered');
  assert.match(res.text, /names itself 38a6:2731/);
  assert.match(res.text, /NOT one of the ids the app knows/);
});

test('a plain keyboard interface gets nothing sent to it', async () => {
  const d = fake({ collections: [{ usagePage: 1, usage: 6, inputReports: [rep(0, 8)], outputReports: [rep(0, 1)], featureReports: [] }] });
  const res = await run([d]);
  assert.equal(d.sent.length + d.features.length, 0);
  assert.equal(d.opened, false);
  assert.match(res.text, /nothing was sent/);
});

test('a vendor interface on an unexpected usage page gets nothing sent to it', async () => {
  const d = fake({ collections: [vendorCol(0xff99, [rep(0, 64)])] });
  const res = await run([d]);
  assert.equal(d.sent.length, 0);
  assert.ok(res.findings.some((f) => f.kind === 'skipped'));
  assert.match(res.text, /were not sent/);
});

test('a device that cannot be opened is explained and nothing is sent', async () => {
  const d = fake({ collections: [vendorCol(0xff68, [rep(0, 64)])], openError: 'Failed to open the device.' });
  const res = await run([d]);
  assert.equal(d.sent.length, 0);
  assert.match(res.text, /Could not open this interface: Failed to open the device/);
  assert.ok(res.findings.some((f) => f.level === 'warn' && /Close the official AULA driver/.test(f.text)));
});

test('a descriptor that lists no reports: 64 bytes is tried, then 32', async () => {
  const sim = new He.SimKeyboard({ frame: 32 });
  sim.collections = [{ usagePage: 0xff60, usage: 0x61 }]; // nothing declared
  const res = await run([sim]);
  assert.equal(res.overall, 'he');
  assert.match(res.text, /64-byte frames/);
  assert.match(res.text, /32-byte frames/);
  assert.ok(sim.log.every(([cmd]) => READS.has(cmd)));
});

test('the F75 dongle protocol is recognised when the keyboard answers it, and the HE requests are not sent to it', async () => {
  const d = fake({
    collections: [vendorCol(0xff02, [rep(0x13, 19)])],
    reply: (kind, id, data, dev) => { if (kind === 'out' && id === 0x13 && data[0] === 0x4a) dev.emit(0x13, [0x4a, 1, 0, 1, 77, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); },
  });
  const res = await run([d]);
  assert.ok(res.findings.some((f) => f.kind === 'f75-dongle'));
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0][0], 0x13);
  assert.match(res.text, /battery byte 77/);
});

test('the F75 cable protocol is recognised and sends exactly the app\'s read request', async () => {
  const d = fake({ collections: [vendorCol(0xff02, [], [rep(6, 519)])] });
  d.featureAnswer = Uint8Array.from({ length: 519 }, (_, i) => (i === 0 ? 0x84 : i % 7));
  const res = await run([d]);
  assert.ok(res.findings.some((f) => f.kind === 'f75-cable'));
  assert.equal(d.features.length, 1);
  assert.deepEqual(Array.from(d.features[0][1]), Array.from(P.buildFeature(0x84, 0x80, null).subarray(1)));
  assert.equal(d.sent.length, 0);
});

test('a small feature report 6 (the F75 dongle has a 7-byte one) is never sent the cable request', async () => {
  // what a real F75 2.4G dongle (3554:fa09) publishes, from a person's scan
  const d = fake({
    vid: 0x3554, pid: 0xfa09, name: '2.4G Wireless Receiver',
    collections: [vendorCol(0xff04, [], [rep(6, 7)]), vendorCol(0xff02, [rep(0x13, 19)]), { usagePage: 0x0c, usage: 1, inputReports: [rep(5, 2)] }],
    reply: (kind, id, data, dev) => { if (kind === 'out' && id === 0x13 && data[0] === 0x4a) dev.emit(0x13, [0x4a, 1, 0, 2, 0x5f, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); },
  });
  const res = await run([d]);
  assert.equal(d.features.length, 0, 'nothing is sent to the 7-byte feature report');
  assert.deepEqual(d.sent.map(([id]) => id), [0x13], 'only the F75 battery read goes out');
  assert.ok(!res.findings.some((f) => f.kind === 'f75-cable'), 'no false \"cable protocol\" finding');
  assert.ok(res.findings.some((f) => f.kind === 'f75-dongle'));
  assert.equal(res.overall, 'f75');
  assert.match(res.text, /only 7 bytes/);
  assert.match(res.text, /answered like an F75, F75 Pro or F87, not like an F75 HE/);
});

test('several devices in one scan are all reported, in order, with the person\'s notes', async () => {
  const a = new He.SimKeyboard({ frame: 64, name: 'AULA F75 HE' });
  const b = fake({ name: 'Mouse', collections: [{ usagePage: 1, usage: 2 }] });
  const res = await run([a, b], { notes: 'black   edition,\nfw 1.0' });
  assert.match(res.text, /=== Device 1 of 2: "AULA F75 HE"/);
  assert.match(res.text, /=== Device 2 of 2: "Mouse"/);
  assert.match(res.text, /notes from the person: black edition, fw 1\.0/);
  assert.match(res.text, /connection said by the person: USB-C cable/);
});

test('the page offers no write, reset, calibration or firmware command anywhere in its code', () => {
  for (const cmd of ['0x23', '0x24', '0x0f', '0x4f', '0x64', '0x65']) {
    assert.ok(!new RegExp(`CMD[^\\n]*${cmd}|READ[^\\n]*${cmd}`, 'i').test(core), cmd);
  }
  assert.ok(!/sendReport\([^)]*0x2[34]/.test(core));
});
