'use strict';

/*
 * A change that really reaches the keyboard must not be reported as an error.
 *
 * Three ways a working write used to be reported as a failure:
 *  - the keyboard takes a moment to apply a config after the commit, and the single read-back taken straight after it
 *    still showed the old settings;
 *  - the firmware rewrites a byte of its own in the lighting block (a counter, a flag), so the block read back is not
 *    byte for byte the one that was sent, although every byte the app changed is there;
 *  - the keyboard applies a fragment but its acknowledgement never reaches the app.
 * A write the keyboard really ignores must still be reported.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const K = require('../src/js/keys.js');
const L = require('../src/js/layout.js');
const W = require('../src/js/webhid.js');
const { KeyAssign } = require('../src/js/keyassign.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, CABLE } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSession(mock, sessionOpts = {}) {
  return new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle' } }],
    ...sessionOpts,
  });
}

/** A keyboard that only shows a new config `ms` after it was received (a slow wireless link, a busy firmware). */
class SlowApplyKeyboard extends MockKeyboard {
  constructor(ms, opts) {
    super(opts);
    this.applyMs = ms;
  }
  _applyBlock(target, bytes) {
    setTimeout(() => super._applyBlock(target, bytes), this.applyMs);
  }
}

/** A keyboard whose firmware changes a byte of the lighting block by itself every time it takes a config. */
class RewritingKeyboard extends MockKeyboard {
  _applyBlock(target, bytes) {
    if (target === 'led') {
      bytes = bytes.slice();
      bytes[0x30] = (bytes[0x30] + 1) & 0xff; // not a byte the app edits
    }
    super._applyBlock(target, bytes);
  }
}

test('a keyboard that applies a moment after the commit is not reported as failing', async () => {
  const mock = new SlowApplyKeyboard(450);
  const s = makeSession(mock);
  await s.connectAuto();
  s.setEffect(5);
  const r = await s.apply();
  assert.equal(r.ok, true, 'the change did arrive, so it is not an error');
  assert.equal(r.modeOk, true);
  assert.equal(P.getMode(mock.led), 5);
  assert.equal(P.getMode(s.dev0.led), 5, 'the screen shows what the keyboard holds');
  assert.equal(s.dirty, false);
  s.disconnect();
});

test('a slow keyboard is fine for a brightness change too', async () => {
  const mock = new SlowApplyKeyboard(300);
  const s = makeSession(mock);
  await s.connectAuto();
  s.setBrightness(2);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(P.getBrightness(mock.led, s.effect()), 2);
  s.disconnect();
});

test('a byte the firmware rewrites on its own is not a failed write', async () => {
  const mock = new RewritingKeyboard();
  const s = makeSession(mock);
  await s.connectAuto();
  s.setEffect(5);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(r.modeOk, true);
  assert.equal(P.getMode(mock.led), 5);
  s.disconnect();
});

test('a write whose acknowledgement is lost, but which the keyboard applied, is not an error', async () => {
  const mock = new MockKeyboard();
  const realEmit = mock._emit.bind(mock);
  let swallow = false;
  mock._emit = (p) => {
    // The keyboard takes the whole config, but the app never hears the ack of the last fragment (the one that completes it).
    if (swallow && p[1] === P.CMD.SET_LED) {
      const f = P.parseFragment(p);
      if (f.idx + 1 === f.total) return;
    }
    realEmit(p);
  };
  const s = makeSession(mock);
  await s.connectAuto();
  swallow = true;
  s.setEffect(5);
  const r = await s.apply();
  swallow = false;
  assert.equal(r.ok, true);
  assert.equal(P.getMode(mock.led), 5);
  s.disconnect();
});

test('a write that is not acknowledged and not applied is still an error', async () => {
  const mock = new MockKeyboard({ dropWrites: true });
  const realEmit = mock._emit.bind(mock);
  let swallow = false;
  mock._emit = (p) => {
    if (swallow && p[1] === P.CMD.SET_LED) {
      const f = P.parseFragment(p);
      if (f.idx + 1 === f.total) return;
    }
    realEmit(p);
  };
  const s = makeSession(mock);
  await s.connectAuto();
  swallow = true;
  s.setEffect(5);
  await assert.rejects(() => s.apply(), /not acknowledged/);
  swallow = false;
  assert.equal(s.dirty, true, 'the edit is kept so it can be tried again');
  s.disconnect();
});

test('a keyboard that ignores the write is still reported, after giving it a fair moment', async () => {
  const mock = new MockKeyboard({ dropWrites: true });
  const s = makeSession(mock);
  await s.connectAuto();
  s.setEffect(5);
  const r = await s.apply();
  assert.equal(r.ok, false);
  assert.equal(r.modeOk, false);
  s.disconnect();
});

test('the apply flag alone differing is not a failure (the firmware sets it)', async () => {
  const mock = new MockKeyboard();
  const s = makeSession(mock);
  await s.connectAuto();
  s.setSpeed(3);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(mock.led[P.OFF.APPLY], 1);
  await wait(10);
  s.disconnect();
});


// ------------------------------------------------------------------ every model, on both links

/** A USB-C keyboard that only shows a write `ms` after it was received. Reads are answered at once. */
class SlowCable extends CableKeyboard {
  constructor(ms, opts) {
    super(opts);
    this.applyMs = ms;
  }
  set(body) {
    if (body[0] & 0x80) return super.set(body);
    const copy = Uint8Array.from(body);
    setTimeout(() => super.set(copy), this.applyMs);
  }
}

const LINKS = ['dongle', 'cable'];

/** body({ kb, s, ka, layers }) on a connected session of `model` over `link`, with a keyboard that applies after `ms`. */
async function slowOn(link, model, ms, body) {
  if (link === 'dongle') {
    const kb = new SlowApplyKeyboard(ms, { ledCount: 126, layoutKeys: model.keys });
    const s = new Session({ storage: memoryStorage(), transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
    try {
      assert.equal(await s.connectAuto(), true);
      await body({ kb, s, layers: (i) => kb.matrix[i], led: () => kb.led });
    } finally {
      s.disconnect();
    }
    return;
  }
  const [hid, restore] = installFakeHid();
  let s;
  try {
    const kb = new SlowCable(ms, { layoutKeys: model.keys });
    hid.add(CABLE, kb);
    s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true);
    await body({ kb, s, layers: (i) => kb.layers[i], led: () => kb.led });
  } finally {
    if (s) s.disconnect();
    restore();
  }
}

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: a lighting change on a keyboard that is slow to apply is not reported as an error`, async () => {
      await slowOn(link, m, 450, async ({ s, led }) => {
        s.setEffect(5);
        s.setBrightness(2);
        const r = await s.apply();
        assert.equal(r.ok, true);
        assert.equal(r.modeOk, true);
        assert.equal(P.getMode(led()), 5);
        assert.equal(P.getMode(s.dev0.led), 5, 'what is shown is what the keyboard holds');
        assert.equal(s.dirty, false);
      });
    });

    test(`${m.id} on the ${link}: a key change on a keyboard that is slow to apply is not reported as an error`, async () => {
      await slowOn(link, m, 450, async ({ s, layers }) => {
        const ka = new KeyAssign({ transport: () => s.transport, keys: () => m.keys, model: () => m.id, storage: memoryStorage() });
        await ka.load();
        assert.equal(ka.ready, true);
        const q = m.keys.find((k) => k.n === 'Q').led;
        const r = await ka.apply(0, new Map([[q, K.encode({ kind: 'key', usage: 0x04 })]]));
        assert.equal(r.ok, true, r.error);
        assert.deepEqual(r.wrong, []);
        assert.deepEqual([...K.codeAt(layers(0), q)], [0, 0, 0, 0x04]);
        assert.deepEqual([...K.codeAt(ka.state.layers[0], q)], [0, 0, 0, 0x04], 'the screen shows what the keyboard holds');
      });
    });
  }
}

test('key assignment: a keyboard that really ignores the write is still reported', async () => {
  const kb = new MockKeyboard({ ledCount: 126, dropWrites: true });
  const s = makeSession(kb);
  await s.connectAuto();
  const ka = new KeyAssign({ transport: () => s.transport, keys: () => L.MODELS[0].keys, model: () => 'f75', storage: memoryStorage(), verifyDelays: [0, 40] });
  await ka.load();
  const q = L.MODELS[0].keys.find((k) => k.n === 'Q').led;
  const r = await ka.apply(0, new Map([[q, K.encode({ kind: 'key', usage: 0x04 })]]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [q]);
  s.disconnect();
});

test('key assignment: a layer written but never acknowledged, and applied, is not an error', async () => {
  const kb = new MockKeyboard({ ledCount: 126 });
  const realEmit = kb._emit.bind(kb);
  let swallow = false;
  kb._emit = (p) => {
    if (swallow && p[1] === P.CMD.SET_MATRIX) {
      const f = P.parseFragment(p);
      if (f.idx + 1 === f.total) return;
    }
    realEmit(p);
  };
  const s = makeSession(kb);
  await s.connectAuto();
  const ka = new KeyAssign({ transport: () => s.transport, keys: () => L.MODELS[0].keys, model: () => 'f75', storage: memoryStorage() });
  await ka.load();
  const q = L.MODELS[0].keys.find((k) => k.n === 'Q').led;
  swallow = true;
  const r = await ka.apply(0, new Map([[q, K.encode({ kind: 'key', usage: 0x04 })]]));
  swallow = false;
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([...K.codeAt(kb.matrix[0], q)], [0, 0, 0, 0x04]);
  s.disconnect();
});
