'use strict';

/*
 * Charging and "fully charged": on the dongle the level is read every so often; a level that goes up means the keyboard
 * is charging, and a reading of 100 that follows a lower one is announced once. Over the USB-C cable there is no battery
 * report, so the cable only ever says "charging", never a level and never "full".
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../src/js/webhid.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, DONGLE, CABLE, wait } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');

async function withDongle(battery, body) {
  const [hid, restore] = installFakeHid();
  const kb = new MockKeyboard({ battery });
  hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, kb);
  const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
  try {
    assert.equal(await s.connectAuto(), true);
    await body(s, kb);
  } finally {
    s.unwatch();
    s.disconnect();
    await wait(60);
    restore();
  }
}

test('a level that goes up means charging, and a level that goes down ends it', async () => {
  await withDongle(80, async (s, kb) => {
    await s.pollBattery();
    assert.equal(s.battery.percent, 80);
    assert.equal(s.charging, false, 'one reading says nothing about direction');
    kb.battery = 81;
    await s.pollBattery();
    assert.equal(s.charging, true);
    assert.equal(s.battery.percent, 81);
    kb.battery = 80;
    await s.pollBattery();
    assert.equal(s.charging, false);
  });
});

test('a reading of 100 that comes after a lower one is announced once, and again only after the level has fallen back', async () => {
  await withDongle(97, async (s, kb) => {
    const full = [];
    s.on('full', (b) => full.push(b.percent));
    await s.pollBattery();
    kb.battery = 99;
    await s.pollBattery();
    assert.deepEqual(full, []);
    kb.battery = 100;
    await s.pollBattery();
    assert.deepEqual(full, [100]);
    await s.pollBattery(); // still 100: nothing more
    kb.battery = 99; // trickle at the top of the charge does not start it over
    await s.pollBattery();
    kb.battery = 100;
    await s.pollBattery();
    assert.deepEqual(full, [100]);
    kb.battery = 85; // used for a while
    await s.pollBattery();
    kb.battery = 90;
    await s.pollBattery();
    kb.battery = 100;
    await s.pollBattery();
    assert.deepEqual(full, [100, 100]);
  });
});

test('a first reading of 100 (the app was just opened) is not announced as a charge finishing', async () => {
  await withDongle(100, async (s) => {
    const full = [];
    s.on('full', () => full.push(1));
    await s.pollBattery();
    await s.pollBattery();
    assert.deepEqual(full, []);
    assert.equal(s.charging, false);
  });
});

/*
 * Wireless first, cable second. The keyboard is working through the 2.4G dongle and the USB-C cable is then plugged in.
 * The cable's own interface appears on the bus at once, and that is the live signal: the bolt and the charging look
 * must not wait for the battery level to be seen rising.
 */

async function withDongleAndHid(battery, body) {
  const [hid, restore] = installFakeHid();
  const kb = new MockKeyboard({ battery });
  hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, kb);
  const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
  try {
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'dongle');
    await body(s, kb, hid);
  } finally {
    s.unwatch();
    s.disconnect();
    await wait(60);
    restore();
  }
}

test('plugging the cable in while on the dongle shows charging at once, and unplugging ends it', async () => {
  await withDongleAndHid(60, async (s, kb, hid) => {
    await s.pollBattery();
    assert.equal(s.charging, false);
    const changes = [];
    s.on('change', () => changes.push(s.charging));
    const cable = hid.add(CABLE, new CableKeyboard());
    await s.deviceListChanged();
    assert.equal(s.charging, true, 'no need to wait for the level to rise');
    assert.equal(s.cablePlugged, true);
    assert.equal(s.mode, 'dongle', 'the wireless link is kept: the percentage keeps coming from it');
    assert.equal(s.onCable, false);
    assert.equal(s.battery.percent, 60);
    assert.deepEqual(changes, [true], 'the screen is told once');
    hid.remove(cable);
    await s.deviceListChanged();
    assert.equal(s.charging, false);
    assert.equal(s.cablePlugged, false);
    assert.deepEqual(changes, [true, false]);
  });
});

test('a cable that is already plugged in when the app connects to the dongle counts as charging', async () => {
  const [hid, restore] = installFakeHid();
  hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, new MockKeyboard({ battery: 40 }));
  hid.add(CABLE, new CableKeyboard());
  const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
  try {
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'dongle', 'the dongle is still preferred while it answers');
    assert.equal(s.charging, true);
    await s.pollBattery();
    assert.equal(s.battery.percent, 40);
    assert.equal(s.charging, true);
  } finally {
    s.unwatch();
    s.disconnect();
    await wait(60);
    restore();
  }
});

test('the watchdog finds a cable whose plug event was missed', async () => {
  await withDongleAndHid(70, async (s, kb, hid) => {
    hid.devices.push(Object.assign(hid.add(CABLE, new CableKeyboard()), {})); // appears without anyone calling deviceListChanged
    hid.devices = [...new Set(hid.devices)];
    assert.equal(s.charging, false);
    s._lastCableLook = 0;
    await s._lookForCable();
    assert.equal(s.charging, true);
  });
});

test('the live cable signal leaves the dongle reading alone, and a rising level still works without the cable', async () => {
  await withDongleAndHid(80, async (s, kb, hid) => {
    hid.add(CABLE, new CableKeyboard());
    await s.deviceListChanged();
    assert.equal(s.battery.percent, 80, 'the percentage is still what the keyboard reported');
    assert.equal(s.battery.source, 'dongle');
    assert.equal(s.charging, true);
  });
  await withDongle(80, async (s, kb) => {
    await s.pollBattery();
    kb.battery = 81;
    await s.pollBattery();
    assert.equal(s.cablePlugged, false);
    assert.equal(s.charging, true, 'the old way still works when the cable is not on the bus');
  });
});

test('charging with the cable plugged in and the level reaching 100 still announces the full charge once', async () => {
  await withDongleAndHid(98, async (s, kb, hid) => {
    const full = [];
    s.on('full', (b) => full.push(b.percent));
    hid.add(CABLE, new CableKeyboard());
    await s.deviceListChanged();
    await s.pollBattery();
    kb.battery = 100;
    await s.pollBattery();
    assert.deepEqual(full, [100]);
    assert.equal(s.charging, true);
  });
});

test('a battery event without a level is what the cable plug sends, so the screen can redraw', async () => {
  await withDongleAndHid(55, async (s, kb, hid) => {
    const seen = [];
    s.on('battery', (b) => seen.push(b.percent));
    hid.add(CABLE, new CableKeyboard());
    await s.deviceListChanged();
    assert.equal(seen.length, 1);
  });
});

/*
 * The percentage is read often enough to look live: every few seconds while charging, and still often when it is not,
 * instead of once a minute.
 */

async function countReads(cablePlugged, ms) {
  const [hid, restore] = installFakeHid();
  const kb = new MockKeyboard({ battery: 50 });
  hid.add({ ...DONGLE, collections: [{ usagePage: 0xff02, usage: 0x02 }] }, kb);
  if (cablePlugged) hid.add(CABLE, new CableKeyboard());
  // Slow ordinary polling, fast charging polling: the two cadences cannot be confused.
  const s = new Session({ storage: memoryStorage(), transportTimeout: 100, tickMs: 20, pollMs: 100000, chargePollMs: 40, discover: () => W.discover() });
  try {
    assert.equal(await s.connectAuto(), true);
    assert.equal(s.mode, 'dongle');
    assert.equal(s.charging, cablePlugged);
    await s.pollBattery();
    let reads = 0;
    s.on('battery', () => reads++);
    await wait(ms);
    return reads;
  } finally {
    s.unwatch();
    s.disconnect();
    await wait(60);
    restore();
  }
}

test('while charging with the cable plugged in, the level is read again and again', async () => {
  const reads = await countReads(true, 400);
  assert.ok(reads >= 3, `expected several fresh readings in 400 ms, got ${reads}`);
});

test('while not charging, the level is read at the slower pace', async () => {
  const reads = await countReads(false, 400);
  assert.equal(reads, 0, 'no reading is due yet');
});

test('the default pace is a few seconds while charging and under half a minute otherwise', () => {
  const s = new Session({ storage: memoryStorage() });
  assert.ok(s.chargePollMs <= 10000, 'charging: every ten seconds or faster');
  assert.ok(s.pollMs <= 30000, 'on the battery: every half minute or faster');
  assert.ok(s.chargePollMs <= s.pollMs);
});
