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

// ------------------------------------------------------------------------------------------------------ smooth at 60 pictures a second

test('glide: the head moves continuously between keys, so no key jumps from one picture to the next', () => {
  const path = H.snakePath();
  const n = path.length;
  // the same pictures as the stepped Snake whenever the head sits exactly on a key
  const pace = (0.35 + 3 * 0.45) * 14;
  assert.deepEqual([...H.snakeFrame(0, RED, path, true)], [...H.snakeFrame(0, RED, path)], 'at the start');
  const onKey = 5 / pace;
  assert.deepEqual([...H.snakeFrame(onKey, RED, path, true)], [...H.snakeFrame(onKey, RED, path)], 'head exactly on a key: the same picture');
  // half way between two keys: the key behind is a little under the head, the key ahead is half lit
  const half = H.snakeFrame(5.5 / pace, RED, path, true);
  assert.equal(half.get(path[5])[0], Math.round(255 * 0.95));
  assert.equal(half.get(path[6])[0], Math.round(255 * 0.5));
  assert.ok(!half.has(path[7]), 'nothing two keys ahead');
  // the biggest change of any key in a thousandth of a second, over more than a whole lap (the pace is the fastest one)
  const jump = (l, glide) => {
    let worst = 0;
    let prev = H.snakeFrame(0, l, path, glide);
    for (let ms = 1; ms <= 5000; ms++) {
      const f = H.snakeFrame(ms / 1000, l, path, glide);
      for (const led of path) {
        const a = prev.get(led) || [0, 0, 0];
        const b = f.get(led) || [0, 0, 0];
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[c] - b[c]));
      }
      prev = f;
    }
    return worst;
  };
  for (const l of [{ ...RED, speed: 5 }, { ...RED, speed: 5, direction: 1 }, { ...RED, speed: 5, colorful: true }]) {
    assert.ok(jump(l, true) <= 12, `gliding: no key changes by more than a few levels in a millisecond (${JSON.stringify(l)})`);
  }
  assert.ok(jump({ ...RED, speed: 5 }, false) > 200, 'the stepped snake jumps a whole key');
  assert.ok(H.snakeFrame(1.234, RED, path, true).size <= 11, 'the tail is ten keys, plus the key the head is reaching');
  assert.ok(n > 60);
});

test('a picture sends only the pages that changed, and always the last page marked last', () => {
  const cols = (n) => H.keyTable(new Map([[n, [200, 10, 10]]]));
  const a = cols(3);
  const b = cols(70); // record 70 is at byte 280: page 5 of the cable's 56-byte pages
  const sent = H.patchFrames(H.CMD.SET_KEYS, b, a, 64);
  const offs = sent.map((f) => f[3] | (f[4] << 8));
  assert.deepEqual(offs, [0, 280 - (280 % 56), 504], 'page 0 (record 3 went out), the page of record 70, and the last page');
  assert.deepEqual(sent.map((f) => f[6]), [0, 0, 1], 'only the last frame is marked last');
  const full = H.writeFrames(H.CMD.SET_KEYS, b, 64);
  for (const f of sent) assert.ok(full.some((g) => g.every((v, i) => v === f[i])), 'every frame is one the whole-table write sends too');
  assert.equal(H.patchFrames(H.CMD.SET_KEYS, b, b, 64).length, 1, 'nothing changed: only the last page');
  assert.equal(H.patchFrames(H.CMD.SET_KEYS, b, null, 64).length, full.length, 'no earlier table: all of it');
  const dongle = H.patchFrames(H.CMD.SET_KEYS, b, a, 32);
  assert.deepEqual(dongle.map((f) => f[3] | (f[4] << 8)), [0, 264, 504], 'the dongle pages are 24 bytes');
  assert.ok(dongle.every((f) => f.length === 32 && f[2] <= 24));
});

const frames = (sim) => sim.log.filter((l) => l[0] === H.CMD.SET_KEYS).length;
const pictures = async (opts, ms, frame = 64, latencyMs = 5) => {
  const sim = new H.SimKeyboard({ frame, latencyMs });
  const s = new H.HeSession({ hid: hid(sim), storage: memoryStorage(), waitMs: 100, ...opts });
  try {
    await s.scan();
    s.setLighting({ mode: H.SNAKE, rgb: [255, 0, 0], colorful: false, speed: 5, brightness: 6 });
    assert.ok((await s.applyLighting()).ok);
    const soft = s._soft;
    const before = soft.frames;
    const f0 = frames(sim);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) await wait(15);
    const secs = (Date.now() - t0) / 1000;
    // another effect is queued behind the picture being written, so the table is whole when it is looked at
    s.setLighting({ mode: 1 });
    assert.ok((await s.applyLighting()).ok);
    await wait(30);
    return { pics: soft.frames - before, sent: frames(sim) - f0, secs, left: lit(sim).length, partial: soft.partial, sim, soft };
  } finally {
    await s.disconnect();
  }
};

test('on the cable a picture is two or three frames, not ten, so the Snake gets several times the pictures a second', async () => {
  const fast = await pictures({}, 800);
  const slow = await pictures({ softPartial: false }, 800);
  assert.ok(fast.partial, 'the simulated keyboard keeps pages, so it stays on pages');
  assert.ok(fast.sent / fast.pics <= 5, `frames per picture: ${(fast.sent / fast.pics).toFixed(1)}`);
  assert.ok(slow.sent / slow.pics >= 9.5, 'the whole table is 10 frames on the cable');
  assert.ok(fast.pics > slow.pics * 2, `${fast.pics} pictures against ${slow.pics} with whole tables`);
  assert.ok(fast.pics / fast.secs > 30, `${(fast.pics / fast.secs).toFixed(0)} pictures a second with a 5 ms keyboard`);
  assert.ok(fast.left <= 11, `no page was left behind: ${fast.left} keys lit when the snake is the only thing that should be`);
});

test('on the dongle too: fewer frames a picture, and no page left behind', async () => {
  const fast = await pictures({}, 800, 32);
  const slow = await pictures({ softPartial: false }, 800, 32);
  assert.ok(fast.sent / fast.pics < 8, `frames per picture: ${(fast.sent / fast.pics).toFixed(1)} against 22 for a whole table`);
  assert.ok(slow.sent / slow.pics >= 21.5);
  assert.ok(fast.pics > slow.pics * 2, `${fast.pics} pictures against ${slow.pics}`);
  assert.ok(fast.left <= 11, `${fast.left} keys left lit`);
});

// A keyboard that only keeps a table that arrives whole (every page, in order): it still acknowledges a partial write.
class WholeTableKeyboard extends H.SimKeyboard {
  async sendReport(id, data) {
    const b = Uint8Array.from(data);
    if (b[0] === 0xaa && b[1] === H.CMD.SET_KEYS) {
      this.log.push([b[1], b[3] | (b[4] << 8)]);
      const off = b[3] | (b[4] << 8);
      if (off === 0) this._stage = { got: 0, bytes: new Uint8Array(this.keys.length) };
      if (this._stage) {
        this._stage.bytes.set(b.subarray(8, 8 + b[2]), off);
        this._stage.got += b[2];
        if (b[6] === 1) {
          if (this._stage.got === this.keys.length) this.keys.set(this._stage.bytes);
          this._stage = null;
        }
      }
      const reply = b.slice();
      reply[0] = 0x55;
      setTimeout(() => this._l.forEach((fn) => fn({ reportId: 0, data: new DataView(reply.buffer) })), this.latencyMs);
      return;
    }
    return super.sendReport(id, data);
  }
}

test('a keyboard that does not keep single pages is noticed on the first picture, and gets whole tables from then on', async () => {
  const sim = new WholeTableKeyboard({ frame: 64 });
  const s = session(sim);
  try {
    await s.scan();
    s.setLighting({ mode: H.SNAKE, rgb: [255, 0, 0], speed: 5 });
    assert.ok((await s.applyLighting()).ok);
    const soft = s._soft;
    for (let i = 0; i < 100 && soft.partial; i++) await wait(10);
    assert.equal(soft.partial, false, 'it went back to whole tables');
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      seen.add(lit(sim).join());
      await wait(15);
    }
    assert.ok(seen.size > 3, `and the snake still moves on that keyboard (${seen.size} pictures seen)`);
    s.setLighting({ mode: 1 });
    assert.ok((await s.applyLighting()).ok);
    assert.ok(lit(sim).length <= 11, 'with nothing left behind');
  } finally {
    await s.disconnect();
  }
});

test('a picture that failed is followed by a whole table, so a page that did land cannot stay behind', async () => {
  const sim = new H.SimKeyboard({ frame: 64 });
  const s = session(sim, { waitMs: 10 });
  try {
    await s.scan();
    s.setLighting({ mode: H.SNAKE, rgb: [255, 0, 0], speed: 5 });
    assert.ok((await s.applyLighting()).ok);
    const soft = s._soft;
    for (let i = 0; i < 100 && soft.frames < 6; i++) await wait(5);
    assert.ok(soft.partial && soft.prev, 'pictures are going out as pages');
    const mark = sim.log.length;
    sim.dropNext = 3; // the next frame goes unanswered three times: the picture fails (the link tries three times)
    for (let i = 0; i < 200 && soft.prev; i++) await wait(5);
    assert.equal(soft.prev, null, 'what the keyboard holds is no longer known');
    assert.ok(s.animating, 'one failed picture does not stop the Snake');
    for (let i = 0; i < 200 && !soft.prev; i++) await wait(5); // the next picture
    // another effect is queued behind the picture being written, so the table is whole when it is looked at
    s.setLighting({ mode: 1 });
    assert.ok((await s.applyLighting()).ok);
    const offs = sim.log.slice(mark).filter((l) => l[0] === H.CMD.SET_KEYS).map((l) => l[1]);
    const whole = H.writeFrames(H.CMD.SET_KEYS, new Uint8Array(H.KEYS_SIZE), 64).map((f) => f[3] | (f[4] << 8));
    const at = offs.findIndex((_, i) => whole.every((o, k) => offs[i + k] === o));
    assert.ok(at >= 0, `a whole table (every page in order) followed the failed picture: ${offs.join(' ')}`);
    assert.ok(lit(sim).length <= 11, 'and nothing was left behind');
  } finally {
    await s.disconnect();
  }
});
