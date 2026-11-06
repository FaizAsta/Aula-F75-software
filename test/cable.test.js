'use strict';

/*
 * The USB-C cable. Its vendor interface has no 20-byte output report: everything goes through one 519-byte feature
 * report (id 0x06), a read being a request followed by a GET. These tests run the real webhid.js, transport.js and
 * engine.js against a fake cable (fake-cable.js) that follows what is documented for it. They show the app does what
 * that description says. They cannot show that a real keyboard agrees: that is only settled by plugging one in.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const W = require('../src/js/webhid.js');
const T = require('../src/js/transport.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, SilentBackend, DONGLE, CABLE, wait } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');

async function withHid(body) {
  const [hid, restore] = installFakeHid();
  const sessions = [];
  const session = (opts = {}) => {
    const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 60, discover: () => W.discover(), ...opts });
    sessions.push(s);
    return s;
  };
  try {
    await body(hid, session);
  } finally {
    for (const s of sessions) {
      s.unwatch();
      s.disconnect();
    }
    await wait(60);
    restore();
  }
}

// ------------------------------------------------------------------ framing

test('a feature report is 520 bytes with the id, carries the command, the size and the data, and parses back', () => {
  const data = Uint8Array.from({ length: 128 }, (_, i) => i);
  const p = P.buildFeature(0x04, 128, data);
  assert.equal(p.length, 520);
  assert.deepEqual([...p.subarray(0, 8)], [0x06, 0x04, 0, 0, 1, 0, 0x80, 0x00]);
  assert.deepEqual([...p.subarray(8, 8 + 128)], [...data]);

  const asRead = P.buildFeature(0x84, 128);
  assert.deepEqual([...asRead.subarray(0, 8)], [0x06, 0x84, 0, 0, 1, 0, 0x80, 0x00]);

  // WebHID returns the report without its id, other stacks with it: both parse.
  const answer = new Uint8Array(519);
  answer.set([0x84, 0, 0, 1, 0, 0x80, 0x00]);
  answer.set(data, 7);
  const a = P.parseFeature(answer, 0x84);
  assert.equal(a.cmd, 0x84);
  assert.deepEqual([...a.data], [...data]);
  const withId = Uint8Array.of(0x06, ...answer);
  assert.deepEqual([...P.parseFeature(withId, 0x84).data], [...data]);
});

test('an answer to another command, or an empty one, is not taken for the answer', () => {
  const answer = new Uint8Array(519);
  answer.set([0x84, 0, 0, 1, 0, 0x80, 0x00]);
  assert.equal(P.parseFeature(answer, 0x8a), null);
  assert.equal(P.parseFeature(new Uint8Array(519), 0x84), null);
  assert.equal(P.parseFeature(null, 0x84), null);
});

// -------------------------------------------------------------- discovery

test('the cable interface is recognised by the feature report its descriptor declares, and gets the feature link', async () => {
  await withHid(async (hid) => {
    hid.add(CABLE, new CableKeyboard());
    const list = await W.discover();
    assert.equal(list.length, 1);
    assert.equal(list[0].meta.mode, 'wired');
    assert.equal(list[0].meta.feature, true);
    assert.equal(list[0].meta.link, 'feature');
    assert.ok(list[0].io instanceof W.WebHidFeatureIO);
  });
});

test('a cable whose descriptor says nothing about reports keeps the 20-byte link, as before', async () => {
  await withHid(async (hid) => {
    hid.add({ ...CABLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard({ cable: true }));
    const list = await W.discover();
    assert.equal(list[0].meta.feature, null);
    assert.equal(list[0].meta.link, 'output');
    assert.ok(!(list[0].io instanceof W.WebHidFeatureIO));
  });
});

// ---------------------------------------------------------------- connecting

test('over the cable the app never sends the dongle\'s 20-byte packets, and reads all three blocks', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    const dev = hid.add(CABLE, kb);
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready');
    assert.equal(s.mode, 'wired');
    assert.equal(s.link, 'feature');
    assert.equal(dev.outputAttempts, 0);
    assert.ok(P.isValidLed(s.cur.led));
    assert.deepEqual(s.unread, []);
    assert.deepEqual([...s.cur.rgb.subarray(0, 420)], [...kb.rgb.subarray(0, 420)]);
    assert.equal(s.cur.colors.length, 378);
    // The reads it sent are the documented ones.
    const cmds = kb.sets.map((b) => b[0]);
    assert.deepEqual([...new Set(cmds)].sort(), [0x84, 0x86, 0x8a]);
    assert.equal(kb.sets[0].length, 519);
  });
});

test('a cable that only serves the lighting block still connects; the palette and per-key colours are stand-ins', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard({ serves: ['led'] });
    hid.add(CABLE, kb);
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready');
    assert.deepEqual(s.unread, ['rgb', 'colors']);
    assert.deepEqual([...s.cur.rgb], [...P.defaultRgb()]);
    assert.equal(s.dirtyKeys().length, 0);
    // No first backup is made of stand-ins.
    assert.equal(s.firstBackup(), null);
    // The log says what happened, for a compatibility report.
    assert.match(s.exportLog(), /did not hand over its palette/);
    assert.match(s.exportLog(), /\(wired, feature report\): answers/);
  });
});

test('GET errors right after a request are waited out', async () => {
  await withHid(async (hid, session) => {
    hid.add(CABLE, new CableKeyboard({ getFails: 3 }));
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready');
  });
});

test('a cable that answers nothing ends in an error that says what was tried, not in a freeze', async () => {
  await withHid(async (hid, session) => {
    hid.add(CABLE, new CableKeyboard({ silent: true }));
    const s = session({ connectRounds: 1, giveUpMs: 0 });
    assert.equal(await s.connectAuto(), false);
    assert.equal(s.status, 'error');
    const log = s.exportLog();
    assert.match(log, /\(wired, feature report\): no answer \(no answer to command 0x44\)/);
    assert.match(log, /tx 06 84 00 00 01 00 80 00/);
  });
});

test('keyboard on the cable with the dongle plugged in but silent: the cable wins and the dongle is let go', async () => {
  await withHid(async (hid, session) => {
    const dongle = hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new SilentBackend());
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'wired');
    assert.equal(s.status, 'ready');
    await wait(80);
    assert.equal(dongle.opened, false);
  });
});

test('keyboard awake on the dongle with the cable only charging: the dongle is still used', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard());
    hid.add(CABLE, new CableKeyboard({ silent: true }));
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'dongle');
    assert.equal(s.link, 'output');
  });
});

// ------------------------------------------------------------------- writing

test('changing the effect over the cable writes the lighting block, verifies it, and sends nothing else', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session();
    await s.connectAuto();
    const rgbBefore = kb.rgb.slice();
    assert.ok(s.setEffect(1));
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.equal(r.modeOk, true);
    assert.deepEqual(r.unverified, []);
    assert.equal(P.getMode(kb.led), 1);
    // One report, at the documented size, and the palette (not being changed) is left alone.
    assert.deepEqual(kb.writes.map((w) => [w.block, w.cmd, w.size]), [['led', 0x04, 128]]);
    assert.deepEqual([...kb.rgb], [...rgbBefore]);
    assert.equal(s.dirtyKeys().length, 0);
  });
});

test('with a palette that could not be read, a config change does not send a stand-in palette', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard({ serves: ['led'] });
    hid.add(CABLE, kb);
    const s = session();
    await s.connectAuto();
    const rgbBefore = kb.rgb.slice();
    assert.ok(s.setEffect(1));
    assert.ok(s.setBrightness(2));
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.deepEqual(r.written, ['led']);
    assert.deepEqual(kb.writes.map((w) => w.block), ['led']);
    assert.deepEqual([...kb.rgb], [...rgbBefore]);
    assert.equal(P.getMode(kb.led), 1);
  });
});

test('editing a palette colour is refused when the palette was not read, and allowed when it was', async () => {
  const slotted = () => {
    for (let m = 0; m < 40; m++) {
      const e = P.effectOf(m);
      if (e && e.slot >= 0) return m;
    }
    throw new Error('no effect with a palette slot');
  };
  await withHid(async (hid, session) => {
    hid.add(CABLE, new CableKeyboard({ serves: ['led'] }));
    const s = session();
    await s.connectAuto();
    s.setEffect(slotted());
    assert.equal(s.setPaletteColor(0, [1, 2, 3]), false);
  });
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session();
    await s.connectAuto();
    s.setEffect(slotted());
    const e = s.effect();
    assert.equal(s.setPaletteColor(0, [1, 2, 3]), true);
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.deepEqual([...P.getPaletteColor(kb.rgb, e, 0)], [1, 2, 3]);
  });
});

test('painting keys over a cable that cannot report them sends the whole block, switches to per-key mode, and says it could not verify', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard({ serves: ['led'] });
    hid.add(CABLE, kb);
    const s = session();
    await s.connectAuto();
    s.paintKeys([0, 1, 2], [255, 0, 0]);
    const r = await s.apply();
    assert.equal(r.ok, true);
    assert.deepEqual(r.written, ['led', 'colors']);
    assert.deepEqual(r.unverified, ['colors']);
    assert.equal(P.getMode(kb.led), P.MODE_CUSTOM);
    const w = kb.writes.find((x) => x.block === 'colors');
    assert.equal(w.cmd, 0x06);
    assert.equal(w.size, 378);
    assert.deepEqual([...kb.colors.subarray(0, 3)], [255, 255, 255]); // planar: reds first
    assert.equal(kb.colors[126], 0);
    assert.equal(s.dirtyKeys().length, 0);
  });
});

test('a write the keyboard ignores is reported as not kept', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session();
    await s.connectAuto();
    kb.set = function (body) {
      if (!(body[0] & 0x80)) return; // swallows every write
      return CableKeyboard.prototype.set.call(this, body);
    };
    s.setEffect(1);
    const r = await s.apply();
    assert.equal(r.ok, false);
  });
});

// ------------------------------------------------------------ the link in use

test('no battery query is ever sent over the cable, and the battery chip stays empty', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session({ pollMs: 20 });
    await s.connectAuto();
    assert.equal(await s.pollBattery(), null);
    await wait(250);
    assert.equal(s.battery.percent, null);
    assert.equal(s.status, 'ready');
    // Only the three documented reads (and later health checks of the lighting block) were sent.
    for (const b of kb.sets) assert.ok([0x84, 0x86, 0x8a].includes(b[0]), `unexpected command 0x${b[0].toString(16)}`);
  });
});

test('the session reports charging while the keyboard is on the cable, not on the dongle, and not once it is unplugged', async () => {
  await withHid(async (hid, session) => {
    const cableSession = session();
    assert.equal(cableSession.charging, false);
    hid.add(CABLE, new CableKeyboard());
    assert.equal(await cableSession.connectAuto(), true);
    assert.equal(cableSession.mode, 'wired');
    assert.equal(cableSession.charging, true);
    assert.equal(cableSession.battery.percent, null); // charging is known from the link; no level is invented
    cableSession.disconnect();
    assert.equal(cableSession.charging, false);
  });
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard());
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'dongle');
    assert.equal(s.charging, false);
  });
});

test('a cable that goes quiet is noticed by the health check', { timeout: 20000 }, async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session({ syncMs: 400, connectRounds: 1 });
    await s.connectAuto();
    assert.equal(s.status, 'ready');
    kb.getFails = Infinity; // the device stops answering GETs, as an unplugged or hung one does
    assert.ok(await (async () => {
      const end = Date.now() + 12000;
      while (Date.now() < end) {
        if (s.status !== 'ready') return true;
        await wait(30);
      }
      return false;
    })());
  });
});

test('changes made on the keyboard itself (Fn keys) are followed over the cable', async () => {
  await withHid(async (hid, session) => {
    const kb = new CableKeyboard();
    hid.add(CABLE, kb);
    const s = session({ syncMs: 40 });
    await s.connectAuto();
    const was = P.getMode(s.cur.led);
    const next = was === 1 ? 2 : 1;
    P.setMode(kb.led, next);
    const end = Date.now() + 3000;
    while (Date.now() < end && P.getMode(s.cur.led) !== next) await wait(30);
    assert.equal(P.getMode(s.cur.led), next);
  });
});

// ------------------------------------------------------- remembered settings

test('what the dongle remembered is not replaced by stand-ins when the cable could not read the rest', async () => {
  await withHid(async (hid, session) => {
    const storage = memoryStorage();
    storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
    const dongle = hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard({ ledCount: 126 }));
    const s1 = session({ storage });
    await s1.connectAuto();
    s1.setEffect(2);
    await s1.apply();
    const snap = s1.keepSnapshot();
    assert.ok(snap);
    s1.disconnect();
    await wait(60);
    hid.remove(dongle);

    const kb = new CableKeyboard({ serves: ['led'] });
    P.setMode(kb.led, 2);
    hid.add(CABLE, kb);
    const s2 = session({ storage });
    await s2.connectAuto();
    assert.equal(s2.mode, 'wired');
    s2.setBrightness(1);
    await s2.apply();
    const after = s2.keepSnapshot();
    assert.deepEqual([...after.rgb], [...snap.rgb]);
    assert.deepEqual([...after.colors], [...snap.colors]);
    // The remembered lighting block follows the change made over the cable.
    assert.equal(P.getBrightness(after.led, s2.effect()), P.getBrightness(s2.dev0.led, s2.effect()));
  });
});

test('no spurious "restore" is written to the cable because stand-ins differ from what the dongle remembered', async () => {
  await withHid(async (hid, session) => {
    const storage = memoryStorage();
    storage.setItem('aula.keep.optin', '1'); // the remembered-settings feature is opt-in
    const dongle = hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard({ ledCount: 126 }));
    const s1 = session({ storage });
    await s1.connectAuto();
    s1.setEffect(2);
    await s1.apply();
    const led = s1.keepSnapshot().led.slice();
    s1.disconnect();
    await wait(60);
    hid.remove(dongle);

    const kb = new CableKeyboard({ serves: ['led'] });
    kb.led = led.slice();
    hid.add(CABLE, kb);
    const s2 = session({ storage });
    await s2.connectAuto();
    await wait(150);
    assert.deepEqual(kb.writes, []);
    assert.equal(s2.keepDiffers(), false);
  });
});

// ---------------------------------------------------------------- backups

test('a backup made over a cable that could not read everything says so, and loading it leaves those blocks alone', async () => {
  await withHid(async (hid, session) => {
    hid.add(CABLE, new CableKeyboard({ serves: ['led'] }));
    const s = session();
    await s.connectAuto();
    const b = s.exportBackup();
    assert.deepEqual(b.unread, ['rgb', 'colors']);
    const rgb = s.cur.rgb.slice();
    const other = JSON.parse(JSON.stringify(b));
    other.rgb = other.rgb.map((v) => (v + 1) & 0xff);
    const r = s.importBackup(other);
    assert.equal(r.ok, true);
    assert.deepEqual([...s.cur.rgb], [...rgb]);
  });
});

// -------------------------------------------------------- transport details

test('FeatureTransport refuses the dongle-only commands by name instead of waiting for silence', async () => {
  const io = { sendFeature: async () => {}, getFeature: async () => new Uint8Array(519) };
  const t = new T.FeatureTransport(io, { timeout: 50 });
  await assert.rejects(t.readBlock(P.CMD.GET_STATUS), /not available over the USB-C cable/);
  await assert.rejects(t.readBlock(P.CMD.GET_ONLINE), /not available over the USB-C cable/);
  await assert.rejects(t.writeBlock(0x55, new Uint8Array(4)), /not available over the USB-C cable/);
  assert.equal(t.noBattery, true);
});

test('WebHidFeatureIO pads a request to the size the descriptor declares and refuses one that would lose data', async () => {
  const sent = [];
  const dev = {
    collections: [{ usagePage: 0xff13, usage: 1, featureReports: [{ reportId: 6, items: [{ reportSize: 8, reportCount: 100 }] }] }],
    sendFeatureReport: async (id, data) => sent.push([id, data.length]),
  };
  const io = new W.WebHidFeatureIO(dev);
  assert.equal(io.size, 100);
  await io.sendFeature(P.buildFeature(0x84, 128)); // all zero past the header: can be trimmed
  assert.deepEqual(sent[0], [6, 100]);
  await assert.rejects(io.sendFeature(P.buildFeature(0x04, 128, new Uint8Array(128).fill(7))), /less than this request needs/);
});
