'use strict';

/*
 * The keyboard's own sleep timer ("Lights turn off after") counts from the last thing that happens to the keyboard. The
 * app used to ask it something every few seconds (battery, lighting block), which can keep it awake. While the computer
 * has been left alone the app now stays quiet, and it picks up again as soon as someone touches the computer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(idle) {
  const mock = new MockKeyboard();
  let asked = 0;
  const send = mock.send.bind(mock);
  mock.send = (p) => {
    if (p[1] === P.CMD.GET_LED || p[1] === P.CMD.GET_STATUS) asked++;
    return send(p);
  };
  const state = { idle };
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    tickMs: 15,
    syncMs: 20,
    pollMs: 20,
    quietAfterSec: 5,
    quietPollMs: 60000,
    idleSeconds: async () => state.idle,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle', id: 'dongle' } }],
  });
  return { mock, s, state, asked: () => asked };
}

test('the app keeps asking the keyboard while someone is at the computer', async () => {
  const { s, asked } = setup(0);
  await s.connectAuto({ quiet: true });
  assert.equal(s.status, 'ready');
  const before = asked();
  await wait(300);
  assert.ok(asked() > before, 'it still reads the battery and the lighting block');
  s.close && s.close();
});

test('it stops asking once the computer has been idle, and picks up again when someone returns', async () => {
  const { s, state, asked } = setup(0);
  await s.connectAuto({ quiet: true });
  state.idle = 30;
  await wait(120); // let a tick that was already running finish
  const quietFrom = asked();
  await wait(400);
  assert.equal(asked(), quietFrom, 'nothing was sent to the keyboard while the computer sat idle');
  state.idle = 0;
  await wait(300);
  assert.ok(asked() > quietFrom, 'it asks again after someone touches the computer');
  s.close && s.close();
});

test('with edits waiting to be applied it never goes quiet', async () => {
  const { s, state, asked } = setup(30);
  await s.connectAuto({ quiet: true });
  s.setSleepValue(2);
  assert.ok(s.dirtyKeys().includes('led'));
  assert.equal(await s._quiet(), false);
  state.idle = 0;
  s.close && s.close();
});

test('without a way to read the idle time, nothing changes', async () => {
  const mock = new MockKeyboard();
  const s = new Session({ storage: memoryStorage(), transportTimeout: 120, discover: async () => [{ io: mock, meta: { mode: 'dongle', id: 'dongle' } }] });
  await s.connectAuto({ quiet: true });
  assert.equal(await s._quiet(), false);
  s.close && s.close();
});

test('choosing 1 minute and pressing Apply writes 60 seconds into the keyboard (raw 2) and reads it back', async () => {
  const { s, mock } = setup(0);
  await s.connectAuto({ quiet: true });
  s.setSleepValue(60 / 30);
  const r = await s.apply();
  assert.equal(r.ok, true);
  assert.equal(P.getSleepValue(s.dev0.led), 2);
  assert.equal(mock.led[P.OFF.SLEEP], 2);
  s.close && s.close();
});

function setupAway(away, awayPollMs) {
  const mock = new MockKeyboard();
  let asked = 0;
  const send = mock.send.bind(mock);
  mock.send = (p) => {
    if (p[1] === P.CMD.GET_LED || p[1] === P.CMD.GET_STATUS) asked++;
    return send(p);
  };
  const state = { away };
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    tickMs: 15,
    syncMs: 20,
    pollMs: 20,
    awayPollMs,
    isAway: () => state.away,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle', id: 'dongle' } }],
  });
  return { s, state, asked: () => asked };
}

test('out of focus: nothing is sent to the keyboard; back in focus it asks again at once', async () => {
  const { s, state, asked } = setupAway(false, 60000);
  await s.connectAuto({ quiet: true });
  state.away = true;
  await wait(120); // let a tick that was already running finish
  const from = asked();
  await wait(400);
  assert.equal(asked(), from, 'no battery or lighting reads while the app is out of focus');
  state.away = false;
  await wait(300);
  assert.ok(asked() > from, 'it reads the keyboard again as soon as the app is focused');
  s.close && s.close();
});

test('out of focus: only the battery is read, every awayPollMs, never the lighting block', async () => {
  const mock = new MockKeyboard();
  const count = { led: 0, status: 0 };
  const send = mock.send.bind(mock);
  mock.send = (p) => {
    if (p[1] === P.CMD.GET_LED) count.led++;
    if (p[1] === P.CMD.GET_STATUS) count.status++;
    return send(p);
  };
  let away = false;
  const s = new Session({
    storage: memoryStorage(),
    transportTimeout: 120,
    tickMs: 15,
    syncMs: 20,
    pollMs: 20,
    awayPollMs: 250,
    isAway: () => away,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle', id: 'dongle' } }],
  });
  await s.connectAuto({ quiet: true });
  away = true;
  await wait(120);
  const led0 = count.led;
  const st0 = count.status;
  await wait(700);
  assert.equal(count.led, led0, 'the lighting block is not read while the app is out of focus');
  const n = count.status - st0;
  assert.ok(n >= 2 && n <= 6, `a few battery reads, not a steady stream (got ${n})`);
  s.close && s.close();
});
