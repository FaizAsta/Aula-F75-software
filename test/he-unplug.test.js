'use strict';

/*
 * Unplugging the F75 HE while the app is open. A keyboard that has just been unplugged can leave a close, a send or an open
 * waiting for ever. Before, the search for the keyboard waited for the close, so one dead keyboard stopped the app from ever
 * seeing the next one until it was restarted. Now every call to the device is limited, and the search does not wait for a close.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/js/he.js');
const { memoryStorage } = require('../src/js/engine.js');

const never = () => new Promise(() => {});
const within = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`still waiting after ${ms} ms`)), ms))]);

/** A simulated F75 HE that dies on unplug: writes fail and a close never finishes. */
function mortal(opts = {}) {
  const sim = new H.SimKeyboard({ frame: 64, ...opts });
  const send = sim.sendReport.bind(sim);
  const close = sim.close.bind(sim);
  sim.dead = false;
  sim.sendReport = async (id, data) => {
    if (sim.dead) throw new DOMException('The device was disconnected.', 'NetworkError');
    return send(id, data);
  };
  sim.close = () => (sim.dead ? never() : close());
  return sim;
}

test('unplugging a keyboard whose close never finishes: the search lets it go at once and finds the next one', async () => {
  const list = [];
  const s = new H.HeSession({ hid: { getDevices: async () => list.slice() }, storage: memoryStorage(), waitMs: 120 });
  const first = mortal();
  list.push(first);
  assert.equal(await s.scan(), true);
  assert.equal((await s.sync()).ok, true, 'it was working');

  first.dead = true;
  list.length = 0; // unplugged
  assert.equal(await within(500, s.scan()), false, 'the scan does not wait for the dead keyboard to close');
  assert.equal(s.present, false);
  assert.equal(s.link, null);

  list.push(mortal()); // plugged back in: a new device object
  assert.equal(await within(500, s.scan()), true, 'and sees the keyboard again');
  const r = await s.sync();
  assert.equal(r.ok, true, r.error);
});

test('the same, over the 2.4G dongle, and when the keyboard is swapped for a new device object without a gap', async () => {
  const list = [];
  const s = new H.HeSession({ hid: { getDevices: async () => list.slice() }, storage: memoryStorage(), waitMs: 120 });
  const first = mortal({ frame: 32 });
  list.push(first);
  await s.scan();
  await s.sync();
  first.dead = true;
  list[0] = mortal({ frame: 32 });
  assert.equal(await within(500, s.scan()), true);
  assert.notEqual(s.dongle.device, first, 'the session holds the new device');
  assert.equal((await s.sync()).ok, true);
});

test('disconnect() on a keyboard that never finishes closing still ends, and leaves nothing connected', async () => {
  const list = [];
  const s = new H.HeSession({ hid: { getDevices: async () => list.slice() }, storage: memoryStorage(), waitMs: 120 });
  const dev = mortal();
  list.push(dev);
  await s.scan();
  await s.sync();
  dev.dead = true;
  const done = s.disconnect();
  assert.equal(s.present, false, 'it lets go of the link first');
  await within(3000, done);
});

test('a send that never finishes ends with an error, a close that never finishes is given up on, an open too', async () => {
  const dev = new H.SimKeyboard({ frame: 64 });
  const link = new H.Link(dev, 'cable', { waitMs: 50, tries: 1, sendMs: 50, closeMs: 50, openMs: 50 });
  await link.open();
  dev.sendReport = never;
  await assert.rejects(within(1000, link.transact(H.frame(H.CMD.GET_LIGHT, { len: 16 }))), /did not finish/);
  dev.close = never;
  await within(1000, link.close()); // resolves although the device never says it is closed

  const slow = new H.SimKeyboard({ frame: 64 });
  slow.open = never;
  const l2 = new H.Link(slow, 'cable', { openMs: 50 });
  await assert.rejects(within(1000, l2.open()), /Could not open the USB-C cable/);
});

test('a write job that fails on a dead keyboard ends, and the next job still runs (the queue is not stuck)', async () => {
  const list = [];
  const s = new H.HeSession({ hid: { getDevices: async () => list.slice() }, storage: memoryStorage(), waitMs: 60 });
  const dev = mortal();
  list.push(dev);
  await s.scan();
  await s.sync();
  dev.dead = true;
  const failed = await within(5000, s.applyLighting());
  assert.equal(failed.ok, false);
  list.length = 0;
  list.push(mortal());
  await s.scan();
  const again = await within(5000, s.sync());
  assert.equal(again.ok, true, again.error);
});
