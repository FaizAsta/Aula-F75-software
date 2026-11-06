'use strict';

/*
 * Link resilience across the dongle and the cable: a USB change that lands while a search is running, a link that dies
 * without any plug event (Windows sleep and resume), health checks that outlive the link they were started on, the
 * background watcher's load, and devices that are only recognised by name.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../src/js/webhid.js');
const P = require('../src/js/protocol.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, DONGLE, CABLE, wait } = require('./fake-hid.js');

function session(opts = {}) {
  return new Session({ storage: memoryStorage(), discover: () => W.discover(), transportTimeout: 60, tickMs: 100000, retryGapMs: 20, ...opts });
}
async function withHid(fn) {
  const [hid, restore] = installFakeHid();
  const made = [];
  try {
    await fn(hid, (o) => (made.push(session(o)), made[made.length - 1]));
  } finally {
    for (const s of made) {
      s.unwatch();
      s.disconnect();
    }
    await wait(60);
    restore();
  }
}
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(20);
  }
  return fn();
};

test('the cable is unplugged while a search is still reading settings: the link is dropped, not left "ready"', async () => {
  await withHid(async (hid, make) => {
    for (const at of [30, 70, 105]) {
      const dev = hid.add({ ...CABLE }, new MockKeyboard({ cable: true, latency: 15 }));
      const s = make();
      const search = s.connectAuto();
      await wait(at);
      hid.remove(dev);
      const looked = s.deviceListChanged(); // what the app runs shortly after the USB event
      await Promise.all([search, looked]);
      assert.ok(await until(() => !s.connected, 1500), `unplug at ${at} ms: still connected (${s.status})`);
      s.disconnect();
    }
  });
});

test('a health check started on the old link says nothing about the new one', async () => {
  await withHid(async (hid, make) => {
    hid.add({ ...CABLE }, new MockKeyboard({ cable: true, latency: 25 }));
    const s = make();
    await s.connectAuto();
    const check = s.checkOnline(); // in flight on the first link
    await wait(5);
    await s.connectAuto(); // the link is rebuilt underneath it
    await check;
    assert.equal(s._fails, 0, 'a failure on the replaced link was charged to the new one');
    assert.equal(s.status, 'ready');
  });
});

test('after Windows resumes, a dead handle is replaced by a clean open straight away (cable and dongle)', async () => {
  for (const [spec, kbOpts] of [[CABLE, { cable: true }], [DONGLE, {}]]) {
    await withHid(async (hid, make) => {
      const dev = hid.add({ ...spec }, new MockKeyboard(kbOpts));
      const s = make();
      await s.connectAuto();
      assert.equal(s.status, 'ready');
      dev.stale = true; // dead handle, no plug event
      assert.equal(await s.revive(), true);
      assert.equal(s.status, 'ready');
      assert.ok(dev.opens >= 2, 'the device was closed and opened again');
    });
  }
});

test('after Windows resumes, a healthy link is left alone', async () => {
  for (const [spec, kbOpts] of [[CABLE, { cable: true }], [DONGLE, {}]]) {
    await withHid(async (hid, make) => {
      const dev = hid.add({ ...spec }, new MockKeyboard(kbOpts));
      const s = make();
      await s.connectAuto();
      const opens = dev.opens;
      assert.equal(await s.revive(), true);
      assert.equal(dev.opens, opens, 'a working link must not be torn down');
      assert.equal(s.status, 'ready');
    });
  }
});

test('after Windows resumes with nothing plugged in yet, revive() starts a search instead of failing', async () => {
  await withHid(async (hid, make) => {
    const s = make();
    assert.equal(await s.revive(), false);
    assert.equal(s.status, 'idle');
    hid.add({ ...CABLE }, new MockKeyboard({ cable: true }));
    assert.equal(await s.revive(), true);
    assert.equal(s.status, 'ready');
  });
});

test('the background watcher looks with a single round each time, because it repeats by itself', async () => {
  await withHid(async (hid, make) => {
    const s = make();
    const calls = [];
    s.connectAuto = async (o) => (calls.push(o), false);
    s.watch({ intervalMs: 20, maxMs: 20, firstMs: 10 });
    await wait(150);
    s.unwatch();
    assert.ok(calls.length >= 2);
    for (const o of calls) assert.deepEqual({ quiet: o.quiet, rounds: o.rounds }, { quiet: true, rounds: 1 });
  });
});

test('a USB change that arrives while a search is running is not dropped: the running one looks again when done', async () => {
  await withHid(async (hid, make) => {
    hid.add({ ...CABLE }, new MockKeyboard({ cable: true, latency: 10 }));
    const s = make();
    const first = s.connectAuto();
    assert.equal(await s.deviceListChanged(), false, 'a second search cannot run at the same time');
    assert.equal(s._again, true, 'but it is remembered');
    await first;
    assert.ok(await until(() => s._again === false));
    assert.equal(s.status, 'ready');
  });
});

test('a search the person asks for while one is running joins it and gets its result', async () => {
  await withHid(async (hid, make) => {
    hid.add({ ...CABLE }, new MockKeyboard({ cable: true, latency: 10 }));
    const s = make();
    const first = s.connectAuto();
    const joined = s.connectAuto(); // e.g. "Try again" pressed while the search is still going
    assert.equal(await joined, await first, 'the click gets the running search\'s result, not an instant false');
    assert.equal(s.status, 'ready');
  });
});

// ------------------------------------------------------ devices recognised only by their name

const reports = (ids) => ({ inputReports: ids.map((reportId) => ({ reportId, items: [{ reportSize: 8, reportCount: 19 }] })), outputReports: ids.map((reportId) => ({ reportId, items: [{ reportSize: 8, reportCount: 19 }] })), featureReports: [] });

test('an AULA-named device with an unknown id and no 0x13 report is never sent our packets', async () => {
  await withHid(async (hid, make) => {
    const sent = [];
    hid.add(
      { vendorId: 0x1234, productId: 0x5678, productName: 'AULA F108 Pro', collections: [{ usagePage: 0xff00, usage: 1, ...reports([0]) }] },
      { onReport: null, async send(p) { sent.push(p); } },
    );
    const s = make();
    await s.connectAuto();
    assert.equal(s.status, 'unsupported');
    assert.equal(sent.length, 0, 'nothing was sent');
    const [d] = await W.listPermitted();
    assert.equal(d.supported, false);
    assert.match(d.why, /0x13/);
  });
});

test('an unknown-id device that does declare the 0x13 report is still tried (a new variant of a supported model)', async () => {
  await withHid(async (hid, make) => {
    hid.add(
      { vendorId: 0x1234, productId: 0x5678, productName: 'AULA F75 (new revision)', collections: [{ usagePage: 0xff02, usage: 2, ...reports([P.REPORT_ID]) }] },
      new MockKeyboard({ cable: true }),
    );
    const s = make();
    await s.connectAuto();
    assert.equal(s.status, 'ready');
  });
});

test('a device whose descriptor says nothing is not ruled out, and the F87 name is recognised', async () => {
  await withHid(async (hid, make) => {
    hid.add({ vendorId: 0x1234, productId: 0x5678, productName: 'F87 Pro', collections: [{ usagePage: 0xff02, usage: 2 }] }, new MockKeyboard({ cable: true }));
    const s = make();
    await s.connectAuto();
    assert.equal(s.status, 'ready');
    assert.equal(s.productName, 'F87 Pro');
  });
});

test('a known supported id is never ruled out by its descriptor: only recognition by name is held to it', async () => {
  await withHid(async (hid, make) => {
    // Same descriptor shape as the unknown device above, but on the cable's own id.
    hid.add({ ...CABLE, collections: [{ usagePage: 0xff00, usage: 1, ...reports([0]) }] }, new MockKeyboard({ cable: true }));
    const s = make();
    await s.connectAuto();
    assert.equal(s.status, 'ready');
  });
});

// ------------------------------------------------------ WebHID calls that never come back

const never = () => new Promise(() => {});
const within = (ms, p) => Promise.race([p, wait(ms).then(() => { throw new Error(`still waiting after ${ms} ms`); })]);

test('a sendReport that never returns ends the connect with an error instead of freezing it', async () => {
  await withHid(async (hid, make) => {
    class Hangs { constructor() { this.onReport = null; } send() { return never(); } }
    hid.add({ ...CABLE }, new Hangs());
    const s = make({ ioTimeoutMs: 80, connectRounds: 2 });
    assert.equal(await within(5000, s.connectAuto()), false);
    assert.equal(s.status, 'error');
    assert.match(s.error, /USB-C cable/);
  });
});

test('an open() that never returns is reported as the keyboard being held by another program', async () => {
  await withHid(async (hid, make) => {
    const d = hid.add({ ...CABLE }, new MockKeyboard({ cable: true }));
    d.open = never;
    const s = make({ ioTimeoutMs: 80, connectRounds: 2 });
    assert.equal(await within(5000, s.connectAuto()), false);
    assert.equal(s.status, 'error');
    assert.match(s.error, /another program/i);
  });
});

test('a close() that never returns does not hold up what comes next', async () => {
  await withHid(async (hid, make) => {
    const d = hid.add({ ...CABLE }, new MockKeyboard({ cable: true, latency: 5 }));
    const s = make({ ioTimeoutMs: 80 });
    assert.equal(await within(5000, s.connectAuto()), true);
    d.close = never;
    s.disconnect();
    await within(2000, s._closing);
  });
});
