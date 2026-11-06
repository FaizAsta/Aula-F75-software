'use strict';

/*
 * Finding the keyboard when the app starts (or when the window is opened later) with the keyboard already in
 * wireless mode, and when the mode or the USB devices change. Runs the real webhid.js and engine.js against a fake
 * navigator.hid (see fake-hid.js), so shared device handles, closes that are still finishing and several interfaces
 * on one dongle behave the way WebHID does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const W = require('../src/js/webhid.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, SilentBackend, DONGLE, CABLE, wait } = require('./fake-hid.js');

async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(20);
  }
  return false;
}

/** Runs body(hid) with a fake navigator.hid installed and always puts the real one back. */
async function withHid(body) {
  const [hid, restore] = installFakeHid();
  const sessions = [];
  const session = (opts = {}) => {
    const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 80, discover: () => W.discover(), ...opts });
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

const vendor = (page) => [{ usagePage: page, usage: 0x02 }];

// ------------------------------------------------------------- starting up

test('keyboard already on the dongle when the app starts: connects and reads settings', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    const s = session();
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready');
    assert.equal(s.mode, 'dongle');
    assert.ok(s.cur);
  });
});

test('searching again while connected keeps a working link (the shared device is not closed under it)', async () => {
  await withHid(async (hid, session) => {
    const dev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'ready');
    await s.connectAuto(); // "Search again", "Try again", "Rescan"
    assert.equal(s.status, 'ready');
    await wait(150); // a close of the old link that is still running in the background would land by now
    assert.equal(dev.opened, true, 'the device was left closed');
    assert.equal(typeof (await s.pollBattery()), 'number', 'the new link cannot talk to the keyboard');
  });
});

test('a device left open from earlier is reopened clean instead of trusted', async () => {
  await withHid(async (hid, session) => {
    const dev = hid.add({ ...DONGLE, collections: vendor(0xff02), stale: true }, new MockKeyboard());
    await dev.open(); // something opened it first and it has gone deaf
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'ready');
    assert.ok(dev.opens >= 2, 'it was used as it was');
  });
});

test('a close that is still finishing does not make the next open fail', async () => {
  await withHid(async (hid) => {
    const dev = hid.add({ ...DONGLE, collections: vendor(0xff02), closeMs: 60 }, new MockKeyboard());
    const [{ io }] = await W.discover();
    await io.open();
    const closing = io.close(); // not awaited, like a background detach
    const [{ io: again }] = await W.discover();
    await again.open(); // would throw InvalidStateError without the retry
    await closing;
    assert.equal(dev.opened, true);
  });
});

test('when Windows refuses to open the keyboard the message says another program has it', async () => {
  await withHid(async (hid, session) => {
    const dev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    dev.open = async () => {
      throw new DOMException('Failed to open the device.', 'NotAllowedError');
    };
    const s = session();
    assert.equal(await s.connectAuto(), false);
    assert.equal(s.status, 'error');
    assert.match(s.statusDetail, /another program/i);
    assert.match(s.exportLog(), /could not be opened \(Failed to open the device\.\)/);
  });
});

// ----------------------------------------------- the dongle's online flag

test('dongle says "asleep" but the keyboard is awake and serves settings: settings are read', async () => {
  await withHid(async (hid, session) => {
    // GET_ONLINE reads 0 here, yet every other command is answered
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard({ cable: true }));
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.ok(s.cur);
  });
});

test('a keyboard that is really asleep behind the dongle is still reported asleep and wakes on the event', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard({ online: false });
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'asleep');
    kb.pushOnlineEvent(true);
    assert.ok(await until(() => s.status === 'ready'), 'did not wake');
  });
});

test('an awake keyboard whose flag lags is picked up while the app sits on "asleep"', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard({ online: false });
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'asleep');
    kb.online = true;
    kb.cable = true; // now awake and answering, but the flag still reads 0
    assert.ok(await until(() => s.status === 'ready'), `stuck on ${s.status}`);
  });
});

test('a wake event that lands while an "is it asleep?" check is still waiting is not lost', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard({ online: false });
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ transportTimeout: 400, tickMs: 60000 }); // no health tick to bail it out
    await s.connectAuto();
    assert.equal(s.status, 'asleep');
    const check = s.checkOnline(); // waits ~400 ms for the keyboard to prove it is awake
    await wait(100);
    kb.pushOnlineEvent(true); // wakes while that check is still waiting
    await check;
    assert.ok(await until(() => s.status === 'ready', 2500), `stuck on ${s.status}`);
  });
});

test('while asleep the link is not closed and reopened over and over when nothing has changed', async () => {
  await withHid(async (hid, session) => {
    const dongle = hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard({ online: false }));
    const s = session({ tickMs: 40 });
    await s.connectAuto();
    await wait(500);
    assert.equal(s.status, 'asleep');
    assert.equal(dongle.opens, 1);
  });
});

test('a charging cable that cannot serve settings does not make a sleeping dongle churn either', async () => {
  await withHid(async (hid, session) => {
    const dongle = hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard({ online: false }));
    hid.add({ ...CABLE, collections: vendor(0xff02) }, new SilentBackend());
    const s = session({ tickMs: 40 });
    await s.connectAuto();
    await wait(900);
    assert.equal(s.status, 'asleep');
    assert.ok(dongle.opens <= 3, `the dongle was reopened ${dongle.opens} times`);
  });
});

// ------------------------------------------------ which interface to use

test('keyboard on the cable while the dongle is still plugged in: the cable is used, not the sleeping dongle', async () => {
  await withHid(async (hid, session) => {
    const dongle = hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard({ online: false }));
    hid.add({ ...CABLE, collections: vendor(0xff02) }, new MockKeyboard({ cable: true }));
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.equal(s.mode, 'wired');
    assert.equal(dongle.opened, false, 'the dongle was left open');
  });
});

test('a dongle interface that is online but never serves settings is skipped for the one that does', async () => {
  await withHid(async (hid, session) => {
    class OnlineOnly extends SilentBackend {
      async send(p) {
        if (p[1] === P.CMD.GET_ONLINE) Promise.resolve().then(() => this.onReport(P.buildPacket(p[1], 1, 0, 1, [1])));
      }
    }
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new OnlineOnly()); // tried first, answers GET_ONLINE only
    const good = hid.add({ ...DONGLE, collections: vendor(0xff01) }, new MockKeyboard());
    const s = session();
    await s.connectAuto();
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.equal(s.io.device, good);
  });
});

test('interfaces are tried in a fixed order: best usage page first, the dongle ahead of the cable', async () => {
  const order = async (flip) => {
    let ids;
    await withHid(async (hid) => {
      const specs = [
        [{ ...CABLE, collections: vendor(0xff02) }, new MockKeyboard({ cable: true })],
        [{ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard()],
        [{ ...DONGLE, collections: vendor(0xff01) }, new MockKeyboard()],
      ];
      for (const [spec, kb] of flip ? specs.slice().reverse() : specs) hid.add(spec, kb);
      ids = (await W.discover()).map((c) => `${c.meta.id}/${c.io.device.collections[0].usagePage.toString(16)}`);
    });
    return ids;
  };
  const a = await order(false);
  const b = await order(true);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ['3554:fa09/ff02', '258a:010c/ff02', '3554:fa09/ff01']);
});

// ----------------------------------------------------- recovering by itself

test('a first open that is deaf recovers on its own once the watcher closes and reopens it', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02), stale: true }, new MockKeyboard());
    const s = session();
    s.watch({ intervalMs: 60, firstMs: 40 });
    assert.ok(await until(() => s.status === 'ready', 6000), `stuck on ${s.status}: ${s.statusDetail}`);
  });
});

test('a link that answers GET_ONLINE but stays silent for settings is closed and restarted, not re-read forever', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard();
    let dev;
    const send = kb.send.bind(kb);
    // The dongle itself answers, the keyboard behind it does not, until the handle has been reopened.
    kb.send = async (p) => (dev.opens < 2 && p[1] !== P.CMD.GET_ONLINE ? undefined : send(p));
    dev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ transportTimeout: 40 });
    await s.connectAuto({ rounds: 1 }); // one round only: the old behaviour, so the background restart is what is tested here
    assert.equal(s.status, 'error');
    assert.ok(await until(() => s.status === 'ready', 8000), `stuck on ${s.status}: ${s.statusDetail}`);
    assert.ok(dev.opens >= 2);
  });
});

test('a deaf first open is retried inside one connect and the error screen is never shown', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard();
    let dev;
    const send = kb.send.bind(kb);
    // The dongle answers for itself; the keyboard behind it stays silent until the handle has been reopened.
    kb.send = async (p) => (dev.opens < 2 && p[1] !== P.CMD.GET_ONLINE ? undefined : send(p));
    dev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ transportTimeout: 40, retryGapMs: 20 });
    const seen = [];
    s.on('status', (e) => seen.push(e.status));
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.ok(dev.opens >= 2, 'the handle was reopened');
    assert.ok(!seen.includes('error'), `error flashed up: ${seen.join(' > ')}`);
  });
});

test('a first attempt that fails while reading settings is retried before any error is shown', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard();
    let dev;
    const send = kb.send.bind(kb);
    // Settings are served to the probe but the follow-up reads fail until the second open.
    kb.send = async (p) => (dev.opens < 2 && (p[1] === P.CMD.GET_RGBTAB || p[1] === P.CMD.GET_COLORS) ? undefined : send(p));
    dev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ transportTimeout: 40, retryGapMs: 20 });
    const seen = [];
    s.on('status', (e) => seen.push(e.status));
    await s.connectAuto();
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.ok(!seen.includes('error'), `error flashed up: ${seen.join(' > ')}`);
  });
});

test('a keyboard that never answers still ends in an error once every round has failed', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new SilentBackend());
    const s = session({ transportTimeout: 30, retryGapMs: 10, connectRounds: 2 });
    await s.connectAuto();
    assert.equal(s.status, 'error');
  });
});

test('the first answer from an idle wireless link can be slow', async () => {
  await withHid(async (hid, session) => {
    class Idle extends MockKeyboard {
      async send(p) {
        if (p[1] === P.CMD.GET_ONLINE) return super.send(p); // the dongle answers for itself
        this._t0 = this._t0 || Date.now();
        const left = this._t0 + 600 - Date.now(); // nothing comes back until the radio is awake
        if (left > 0) setTimeout(() => super.send(p), left); // the reply is late; sending was instant
        else return super.send(p);
      }
    }
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Idle());
    const s = session({ transportTimeout: 100 });
    await s.connectAuto();
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
  });
});

test('the watcher backs off while no keyboard turns up and starts over when nudged', async () => {
  await withHid(async (hid, session) => {
    const s = session();
    let looks = 0;
    const find = s.connectAuto.bind(s);
    s.connectAuto = (o) => (looks++, find(o));
    s.watch({ intervalMs: 40, firstMs: 40, maxMs: 400 });
    await wait(900);
    assert.ok(looks >= 3 && looks <= 8, `looked ${looks} times`); // a flat 40 ms would be about 20
    const before = looks;
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    s.nudge();
    assert.ok(await until(() => s.status === 'ready'), 'nudge did not find the keyboard');
    assert.ok(looks > before);
  });
});

// --------------------------------------------------------- mode changes

test('flipping from wireless to the cable and back follows the keyboard', async () => {
  await withHid(async (hid, session) => {
    const wireless = new MockKeyboard();
    const dongleDev = hid.add({ ...DONGLE, collections: vendor(0xff02) }, wireless);
    const s = session();
    await s.connectAuto();
    assert.equal(s.mode, 'dongle');
    assert.equal(s.status, 'ready');

    // switch to cable: the dongle loses the keyboard, the cable interface appears
    wireless.pushOnlineEvent(false);
    const cableDev = hid.add({ ...CABLE, collections: vendor(0xff02) }, new MockKeyboard({ cable: true }));
    await s.deviceListChanged();
    assert.ok(await until(() => s.status === 'ready' && s.mode === 'wired'), `on ${s.mode} / ${s.status}`);

    // and back: the cable goes away, the keyboard rejoins the dongle
    hid.remove(cableDev);
    wireless.pushOnlineEvent(true);
    await s.deviceListChanged();
    assert.ok(await until(() => s.status === 'ready' && s.mode === 'dongle'), `on ${s.mode} / ${s.status}`);
    assert.equal(dongleDev.opened, true);
  });
});

test('a USB change that lands in the middle of a search is not lost', async () => {
  await withHid(async (hid, session) => {
    const wireless = new MockKeyboard({ online: false }); // dongle plugged in, keyboard on the cable
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, wireless);
    const s = session({ transportTimeout: 120 });
    const searching = s.connectAuto();
    await wait(30);
    hid.add({ ...CABLE, collections: vendor(0xff02) }, new MockKeyboard({ cable: true }));
    await s.deviceListChanged(); // arrives while connectAuto is still probing
    await searching;
    assert.ok(await until(() => s.status === 'ready' && s.mode === 'wired'), `on ${s.mode} / ${s.status}`);
  });
});

test('unsaved edits survive searching again', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    const s = session();
    await s.connectAuto();
    s.setEffect(2);
    assert.equal(s.dirty, true);
    await s.connectAuto();
    assert.equal(s.status, 'ready');
    assert.equal(P.getMode(s.cur.led), 2, 'the edit was thrown away');
    assert.equal(s.dirty, true);
  });
});

test('what each interface said is written to the log for troubleshooting', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard({ online: false }));
    const s = session();
    await s.connectAuto();
    assert.match(s.exportLog(), /3554:fa09 \(dongle\): answers, online=false/);
  });
});

// ------------------------------------------------- "Try again" while a connect is already running

/** The dongle answers for itself; the keyboard behind it stays silent until `wakeMs` have passed (light sleep). */
class Sleepy extends MockKeyboard {
  constructor(wakeMs, opts) {
    super(opts);
    this.wakeAt = Date.now() + wakeMs;
  }
  async send(p) {
    if (p[1] !== P.CMD.GET_ONLINE && Date.now() < this.wakeAt) return;
    return super.send(p);
  }
}

test('"Try again" pressed while a connect is running joins it and gets its result instead of being ignored', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Sleepy(700));
    const s = session({ transportTimeout: 60, retryGapMs: 30, connectRounds: 8 });
    const first = s.connectAuto();
    await wait(20);
    let settled = false;
    const click = s.connectAuto().then((r) => {
      settled = true;
      return r;
    });
    await wait(60);
    assert.equal(settled, false, 'the click was answered at once, without doing anything');
    assert.equal(await click, await first);
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
  });
});

test('a click during a quiet background connect makes it visible, with the hint to press a key', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Sleepy(600));
    const s = session({ transportTimeout: 60, retryGapMs: 30, connectRounds: 8 });
    const seen = [];
    s.on('status', (e) => seen.push(e.status));
    const background = s.connectAuto({ quiet: true });
    await wait(30);
    assert.deepEqual(seen, [], 'a quiet connect changed the status');
    const click = s.connectAuto();
    assert.equal(s.status, 'connecting');
    assert.match(s.statusDetail, /press any key/i);
    assert.equal(await click, await background);
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
  });
});

test('background looks do not pile up behind a running connect', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Sleepy(300));
    const s = session({ transportTimeout: 60, retryGapMs: 30, connectRounds: 6 });
    const first = s.connectAuto();
    assert.equal(await s.connectAuto({ quiet: true }), false);
    assert.equal(s.connecting, true);
    await first;
    assert.equal(s.connecting, false);
  });
});

test('"busy" is announced around a quiet connect so the error screen can say it is still trying', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    const s = session();
    const seen = [];
    s.on('busy', (b) => seen.push(b));
    await s.connectAuto({ quiet: true });
    assert.deepEqual(seen, [true, false]);
  });
});

test('a keyboard that wakes late is found by the same connect, with no error screen on the way', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Sleepy(900));
    const s = session({ transportTimeout: 60, retryGapMs: 30, connectRounds: 12 });
    const seen = [];
    s.on('status', (e) => seen.push(e.status));
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.ok(!seen.includes('error'), `error flashed up: ${seen.join(' > ')}`);
  });
});

// ------------------------------------------------------- connecting as fast as the keyboard allows

/** Ignores every settings request for the first `ms` after it was made (a request lost while the device settles). */
class DropsAtFirst extends MockKeyboard {
  constructor(ms, opts) {
    super(opts);
    this.until = Date.now() + ms;
  }
  async send(p) {
    if (p[1] !== P.CMD.GET_ONLINE && Date.now() < this.until) return;
    return super.send(p);
  }
}

test('a request lost while the device settles is asked again after a fraction of a second, not after seconds', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new DropsAtFirst(450));
    const s = session({ transportTimeout: 1000, tickMs: 4000 });
    const t0 = Date.now();
    assert.equal(await s.connectAuto(), true);
    const took = Date.now() - t0;
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    // The old cadence (two tries 2 s apart) needed 2.1 s or more for this.
    assert.ok(took < 1400, `took ${took} ms`);
  });
});

test('poke() ends the wait at once: a keyboard that wakes is found the moment it is touched, not at the next retry', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new DropsAtFirst(300));
    // Tries are 2 s apart here, so without a poke the first look after the wake would only come at about 2.1 s.
    const s = session({ transportTimeout: 5000, tickMs: 4000 });
    const t0 = Date.now();
    setTimeout(() => s.poke(), 400);
    assert.equal(await s.connectAuto(), true);
    const took = Date.now() - t0;
    assert.equal(s.status, 'ready', `${s.status} ${s.statusDetail}`);
    assert.ok(took < 1200, `took ${took} ms`);
  });
});

test('the dongle announcing that the keyboard is online ends the wait too', async () => {
  await withHid(async (hid, session) => {
    const kb = new DropsAtFirst(300);
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ transportTimeout: 5000, tickMs: 4000 });
    const t0 = Date.now();
    setTimeout(() => kb.pushOnlineEvent(true), 400);
    assert.equal(await s.connectAuto(), true);
    assert.ok(Date.now() - t0 < 1200, `took ${Date.now() - t0} ms`);
  });
});

test('poke() is harmless with no link, while connected, and when called over and over', async () => {
  await withHid(async (hid, session) => {
    const s = session();
    s.poke(); // nothing plugged in
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new MockKeyboard());
    assert.equal(await s.connectAuto(), true);
    for (let i = 0; i < 20; i++) s.poke(); // ready: nothing to do
    assert.equal(s.status, 'ready');
  });
});

// ------------------------------------------- "connecting" instead of an error while the app is still trying

test('an error is held back as "settling" while the app keeps trying, then shown once the time is up', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new SilentBackend());
    const s = session({ giveUpMs: 3500, connectRounds: 2, tickMs: 60000 }); // one failing pass takes about 2 s here
    const seen = [];
    s.on('status', (e) => seen.push({ status: e.status, settling: s.settling }));
    await s.connectAuto();
    assert.equal(s.status, 'error', `${s.status} ${s.statusDetail}`);
    // The last failed round has ended, but the app has not been at it for long: the screen still says "connecting".
    assert.equal(s.settling, true, 'the error would be shown straight away');
    assert.ok(await until(() => !s.settling, 6000), 'never gave up');
    // And the screen is told when the time runs out, so it can switch to the error.
    const last = () => seen[seen.length - 1];
    assert.ok(await until(() => last().status === 'error' && last().settling === false, 2000), `last event: ${JSON.stringify(last())}`);
  });
});

test('once the keyboard answers, nothing is left over from the trying: no error, no pending timer', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new Sleepy(500));
    const s = session({ transportTimeout: 60, retryGapMs: 30, connectRounds: 8, giveUpMs: 20000 });
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.status, 'ready');
    assert.equal(s.settling, false);
    assert.equal(s._graceTimer, null);
    assert.equal(s._tryingSince, 0);
  });
});

test('an error that has nothing to do with connecting (a failed manual refresh) is not held back', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard();
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ giveUpMs: 20000 });
    assert.equal(await s.connectAuto(), true);
    s._setStatus('error', 'something else');
    assert.equal(s.settling, false);
  });
});

test('a keyboard that wakes after a long silence still counts as trying, so a slow first read shows no error', async () => {
  await withHid(async (hid, session) => {
    const kb = new MockKeyboard({ online: false });
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, kb);
    const s = session({ giveUpMs: 20000, tickMs: 60000 });
    await s.connectAuto();
    assert.equal(s.status, 'asleep');
    assert.equal(s.settling, false);
    kb.pushOnlineEvent(true);
    assert.ok(await until(() => s.status === 'ready', 3000), `stuck on ${s.status}`);
    assert.equal(s._tryingSince, 0);
  });
});

test('a USB change gives the trying a fresh start', async () => {
  await withHid(async (hid, session) => {
    hid.add({ ...DONGLE, collections: vendor(0xff02) }, new SilentBackend());
    const s = session({ giveUpMs: 700, connectRounds: 1, tickMs: 60000 });
    await s.connectAuto();
    assert.ok(await until(() => !s.settling, 3000), 'never gave up');
    s.restartGrace();
    assert.equal(s.settling, true);
  });
});
