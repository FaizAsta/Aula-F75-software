'use strict';

/*
 * The F75 HE's Snake. The keyboard's firmware has no Snake, so the app draws it: it puts the keyboard in its per-key lighting mode
 * and keeps writing the per-key table. These tests run the real session and link code against SimKeyboard (the same simulated
 * keyboard the demo uses), so they prove what the app sends and when it stops, not how a real F75 HE reacts to it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../src/js/he.js');
const FXM = require('../src/js/max-fx.js');
const MX = require('../src/js/max.js');
const { memoryStorage } = require('../src/js/engine.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hid = (...devs) => ({ getDevices: async () => devs });
const session = (sim, opts = {}) => new H.HeSession({ hid: hid(sim), storage: memoryStorage(), waitMs: 40, softMs: 1, ...opts });
const lit = (sim) => {
  const out = [];
  for (let i = 0; i < H.LED_COUNT; i++) if (sim.keys[i * 4 + 1] || sim.keys[i * 4 + 2] || sim.keys[i * 4 + 3]) out.push(i);
  return out;
};
const RED = { rgb: [255, 0, 0], colorful: false, speed: 3, direction: 0 };

// ------------------------------------------------------------------------------------------------------ the picture

test('the snake path visits every key once, row by row, every other row backwards', () => {
  const keys = H.keyLayout();
  const p = H.snakePath(keys);
  assert.equal(p.length, keys.length);
  assert.equal(new Set(p).size, keys.length, 'no key twice');
  assert.deepEqual([...p].sort((a, b) => a - b), keys.map((k) => k.led).sort((a, b) => a - b), 'every key of the board');
  const rowOf = new Map(keys.map((k) => [k.led, Math.round(k.y * 10)]));
  const xOf = new Map(keys.map((k) => [k.led, k.x]));
  let prevRow = -1;
  let rowIndex = -1;
  let prevX = null;
  for (const led of p) {
    const r = rowOf.get(led);
    if (r !== prevRow) {
      rowIndex++;
      prevRow = r;
      prevX = null;
    }
    if (prevX !== null) assert.ok(rowIndex % 2 ? xOf.get(led) < prevX : xOf.get(led) > prevX, `row ${rowIndex} runs ${rowIndex % 2 ? 'right to left' : 'left to right'}`);
    prevX = xOf.get(led);
  }
  assert.equal(rowIndex, 5, 'six rows');
});

test('the snake is one bright head with a tail that fades, and it moves along the path', () => {
  const path = H.snakePath();
  const f0 = H.snakeFrame(0, RED, path);
  assert.equal(f0.size, 10, 'the head and nine keys behind it');
  assert.deepEqual(f0.get(path[0]), [255, 0, 0], 'the head is full strength');
  assert.ok(!f0.has(path[1]), 'nothing ahead of the head at the start');
  // one second later at speed 3: the head is (0.35 + 3 * 0.45) * 14 = 23.8, so 23 whole keys along
  const f1 = H.snakeFrame(1, RED, path);
  assert.deepEqual(f1.get(path[23]), [255, 0, 0]);
  assert.ok(f1.get(path[22])[0] < 255 && f1.get(path[22])[0] > f1.get(path[14])[0], 'the tail fades the further back it is');
  assert.ok(!f1.has(path[24]), 'nothing ahead of the head');
});

test('the snake goes round: after the last key the head comes back to the first', () => {
  const path = H.snakePath();
  const n = path.length;
  const pace = (0.35 + 3 * 0.45) * 14;
  const f = H.snakeFrame((n + 2) / pace + 0.001, RED, path);
  assert.deepEqual(f.get(path[2]), [255, 0, 0]);
  assert.ok(f.has(path[n - 1]), 'the tail is still at the end of the path while the head is back at the start');
});

test('Reverse runs the snake the other way, Speed makes it faster, multicolour changes the hue along the tail', () => {
  const path = H.snakePath();
  const fwd = H.snakeFrame(1, RED, path);
  const rev = H.snakeFrame(1, { ...RED, direction: 1 }, path);
  assert.deepEqual(rev.get(path[path.length - 23]), [255, 0, 0], 'the head is 23 keys back from the end');
  assert.notDeepEqual([...fwd.keys()].sort(), [...rev.keys()].sort());
  const slow = H.snakeFrame(1, { ...RED, speed: 1 }, path);
  const fast = H.snakeFrame(1, { ...RED, speed: 5 }, path);
  const headOf = (f) => path.findIndex((led) => f.get(led) && f.get(led)[0] === 255);
  assert.ok(headOf(fast) > headOf(slow));
  const multi = H.snakeFrame(0, { ...RED, colorful: true }, path);
  assert.equal(new Set([...multi.values()].map((c) => c.join())).size, 10, 'every key of the tail has its own colour');
});

test('the card and the keyboard picture draw the same Snake as the keyboard gets, over their own layouts', () => {
  const keys = MX.keyLayout();
  const litMax = keys.filter((k) => FXM.lit(100, k, 1, RED));
  assert.equal(litMax.length, 10);
  const he = H.keyLayout();
  const litHe = he.filter((k) => FXM.lit(100, k, 1, { ...RED, layout: he }));
  assert.equal(litHe.length, 10, 'the picture of the F75 HE shows a snake of ten keys too');
  // the head of the picture's snake is the key the keyboard lights brightest
  const path = H.snakePath(he);
  const headLed = path[23];
  assert.ok(litHe.some((k) => k.led === headLed));
  const reversed = he.filter((k) => FXM.lit(100, k, 1, { ...RED, layout: he, direction: 2 }));
  assert.equal(reversed.length, 10);
  assert.ok(reversed.some((k) => k.led === path[path.length - 23]), 'the drawings’ Left is the keyboard’s Reverse');
});

// ------------------------------------------------------------------------------------------------------ the session

test('Snake is offered next to the firmware effects but is not one of them, and its number is never sent', () => {
  assert.ok(!H.EFFECTS.some((e) => e.mode === H.SNAKE), 'the firmware list is only what AULA’s driver was seen to write');
  assert.equal(H.SOFT_EFFECTS.length, 1);
  const e = H.effect(H.SNAKE);
  assert.equal(e.name, 'Snake');
  assert.ok(e.soft && e.direction && e.color);
  const block = H.lightingPayload({ ...H.DEFAULT_LIGHTING, mode: H.SNAKE }, H.CUSTOM);
  assert.equal(block[0], H.CUSTOM, 'the keyboard is told per-key mode');
  assert.equal(H.lightingPayload({ ...H.DEFAULT_LIGHTING, mode: H.SNAKE })[0], H.CUSTOM, 'and even asked for mode 100 it never goes out as one');
  assert.equal(H.parseLighting(Uint8Array.from([100, 0, 0, 0, 0xff, 0, 0, 0, 0, 4, 3, 0, 0, 0, 0xaa, 0x55])), null, 'the keyboard cannot report it');
});

test('applying Snake puts the keyboard in per-key mode and keeps writing moving pictures until another effect is applied', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session(sim);
  await s.scan();
  s.setLighting({ mode: H.SNAKE, rgb: [255, 0, 0], colorful: false, speed: 5, brightness: 6 });
  const res = await s.applyLighting();
  assert.ok(res.ok, res.error);
  assert.ok(s.animating);
  assert.equal(sim.light[0], H.CUSTOM, 'the keyboard shows its per-key table');
  assert.equal(sim.light[9], 6, 'at the chosen brightness');
  assert.ok(lit(sim).length > 0 && lit(sim).length <= 10);
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    seen.add(lit(sim).join());
    await wait(20);
  }
  assert.ok(seen.size > 3, `the snake moved (${seen.size} different pictures seen)`);
  // another effect stops it, and nothing is written to the table after that
  s.setLighting({ mode: 1 });
  const stop = await s.applyLighting();
  assert.ok(stop.ok);
  assert.ok(!s.animating);
  assert.equal(sim.light[0], 1);
  const writes = sim.log.filter((l) => l[0] === H.CMD.SET_KEYS).length;
  await wait(120);
  assert.equal(sim.log.filter((l) => l[0] === H.CMD.SET_KEYS).length, writes, 'no picture after the snake was stopped');
  assert.deepEqual(sim.unsafe, [], 'nothing outside the five commands was sent');
});

test('the Snake works over the 2.4G dongle too (32-byte reports)', async () => {
  const sim = new H.SimKeyboard({ frame: 32 });
  const s = session(sim);
  await s.scan();
  s.setLighting({ mode: H.SNAKE, speed: 5 });
  const res = await s.applyLighting();
  assert.ok(res.ok, res.error);
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(lit(sim).join());
    await wait(25);
  }
  assert.ok(seen.size > 2, 'the pictures arrive over the dongle');
  await s.disconnect();
  assert.ok(!s.animating);
});

test('a snake in the middle of being applied does not outlive the effect applied after it', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session(sim);
  await s.scan();
  s.setLighting({ mode: H.SNAKE });
  const a = s.applyLighting();
  s.setLighting({ mode: 8 });
  const b = s.applyLighting(); // no wait in between
  await Promise.all([a, b]);
  await wait(80);
  assert.ok(!s.animating);
  assert.equal(sim.light[0], 8, 'the last thing applied is what the keyboard ends up in');
});

test('the Snake stops by itself, and says why, when the keyboard stops answering', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session(sim, { waitMs: 15 });
  await s.scan();
  s.setLighting({ mode: H.SNAKE, speed: 5 });
  assert.ok((await s.applyLighting()).ok);
  let events = 0;
  s.on('animation', () => events++);
  sim.answers = false;
  for (let i = 0; i < 80 && s.animating; i++) await wait(25);
  assert.ok(!s.animating, 'it gave up after a few pictures in a row failed');
  assert.ok(events >= 1);
  assert.equal(s.last.ok, false);
  assert.match(s.last.error, /Snake stopped/);
});

test('the pictures do not announce the session as busy (the screen would redraw for each one)', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session(sim);
  await s.scan();
  s.setLighting({ mode: H.SNAKE, speed: 5 });
  assert.ok((await s.applyLighting()).ok);
  let busy = 0;
  s.on('busy', () => busy++);
  await wait(250);
  assert.equal(busy, 0);
  assert.ok(sim.log.filter((l) => l[0] === H.CMD.SET_KEYS).length > 10, 'and yet it kept writing');
  await s.disconnect();
});

test('reading the keyboard while the Snake runs, or after it, does not turn the painted colours into a frame of the snake', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const store = memoryStorage();
  const s = new H.HeSession({ hid: hid(sim), storage: store, waitMs: 40, softMs: 1 });
  await s.scan();
  s.paint([H.KEYS.a, H.KEYS.s], [10, 200, 30]);
  s.setLighting({ mode: H.SNAKE, speed: 5 });
  assert.ok((await s.applyLighting()).ok);
  const during = await s.sync();
  assert.ok(during.ok);
  assert.match(during.note, /Snake is running/);
  assert.deepEqual([...s.keyColors.keys()].sort(), [H.KEYS.a, H.KEYS.s].sort(), 'the painting is still the painting');
  await s.disconnect();

  // the next time the app starts: the keyboard still holds the last picture, and the app remembers the Snake was its last effect
  const again = new H.HeSession({ hid: hid(sim), storage: store, waitMs: 40, softMs: 1 });
  assert.equal(again.lighting.mode, H.SNAKE, 'the choice is remembered');
  await again.scan();
  const res = await again.sync();
  assert.ok(res.ok);
  assert.match(res.note, /last picture of the Snake/);
  assert.deepEqual([...again.keyColors.keys()].sort(), [H.KEYS.a, H.KEYS.s].sort());
  assert.ok(!again.animating, 'it does not start by itself');
});

test('applying the per-key colours, resetting, or leaving for the demo ends the Snake', async () => {
  for (const act of [(s) => s.applyKeyColors(), (s) => s.factoryReset(), (s) => s.enterDemo(), (s) => s.disconnect()]) {
    const sim = new H.SimKeyboard({ frame: 64 });
    const s = session(sim);
    await s.scan();
    s.setLighting({ mode: H.SNAKE });
    assert.ok((await s.applyLighting()).ok);
    assert.ok(s.animating);
    await act(s);
    assert.ok(!s.animating);
  }
});

test('the demo keyboard runs the Snake too, and the notice is only for a real keyboard', async () => {
  const s = new H.HeSession({ hid: hid(), storage: memoryStorage(), softMs: 1 });
  await s.enterDemo();
  s.setLighting({ mode: H.SNAKE, speed: 5 });
  assert.ok((await s.applyLighting()).ok);
  const sim = s.cable.device;
  await wait(120);
  assert.ok(lit(sim).length > 0);
  assert.equal(s.softAck, false);
  await s.leaveDemo();
  assert.ok(!s.animating);
});

test('what the person said about the notice is remembered', () => {
  const store = memoryStorage();
  const s = new H.HeSession({ hid: hid(), storage: store });
  assert.equal(s.softAck, false);
  s.ackSoft();
  assert.equal(new H.HeSession({ hid: hid(), storage: store }).softAck, true);
});

// ------------------------------------------------------------------------------------------------------ the screen

test('the Lighting page lists Snake after the firmware effects, tells the person before the first real run, and shows it on the picture', () => {
  const ui = read('src/js/max-ui.js');
  assert.match(ui, /\.\.\.\(MX\.SOFT_EFFECTS \|\| \[\]\)/, 'a card for it');
  assert.match(ui, /e\.soft && !max\.demo && !max\.softAck/, 'the notice, for a real keyboard only');
  assert.match(ui, /max\.ackSoft\(\)/);
  assert.match(ui, /layout: LAYOUT/, 'the picture walks its own keys');
  assert.match(ui, /max\.on\('animation', render\)/);
  assert.match(read('src/js/max-fx.js'), /100: snake/);
});
