'use strict';

/*
 * Brightness range. Some keyboards' own brightness keys go past level 4, so the app must not stop at 4: it reads the real
 * level, learns how many levels the keyboard has, and offers all of them (and the preview scales any range onto its 0..4 glow).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../src/js/protocol.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const V = require('../src/js/preview.js');

function make(storage = memoryStorage(), prepare = () => {}) {
  const mock = new MockKeyboard();
  prepare(mock);
  const s = new Session({
    storage,
    transportTimeout: 120,
    discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle' } }],
  });
  return { mock, s, storage };
}

const slotOf = (led) => P.slotByte(P.effectOf(P.getMode(led)).slot, 0);

test('protocol: levels above 4 are read and written as they are, up to the cap', () => {
  const led = new Uint8Array(P.LED_SIZE);
  const e = P.effectOf(2);
  P.setBrightness(led, e, 7);
  assert.equal(P.getBrightness(led, e), 7);
  P.setBrightness(led, e, 99);
  assert.equal(P.getBrightness(led, e), P.BRIGHT_CAP);
  P.setBrightness(led, e, -3);
  assert.equal(P.getBrightness(led, e), 0);
  led[P.slotByte(e.slot, 0)] = 0xff; // not a level at all: keeps reading as the old full level
  assert.equal(P.getBrightness(led, e), P.LEVEL_MAX);
});

test('the app starts with 4 levels, never offers more than the setting, and remembers the setting', () => {
  const { s, storage } = make();
  assert.equal(s.brightMax, 4);
  assert.equal(s.setBrightMax(1), 4, 'not below 4');
  assert.equal(s.setBrightMax(50), P.BRIGHT_CAP, 'not above the cap');
  assert.equal(s.setBrightMax(8), 8);
  assert.equal(storage.getItem('aula.bright.max'), '8');
  assert.equal(new Session({ storage }).brightMax, 8, 'a new session starts from the remembered value');
});

test('setBrightness stops at the number of levels the keyboard has', async () => {
  const { s } = make();
  await s.connectAuto();
  s.setEffect(2);
  s.setBrightness(8);
  assert.equal(P.getBrightness(s.cur.led, s.effect()), 4, 'only 4 levels are offered until the keyboard shows it has more');
  s.setBrightMax(8);
  s.setBrightness(8);
  assert.equal(P.getBrightness(s.cur.led, s.effect()), 8);
  s.disconnect();
});

test('a keyboard that is already above level 4 when the app connects is read correctly and its range is learned', async () => {
  const { s } = make(memoryStorage(), (mock) => {
    mock.led[slotOf(mock.led)] = 7;
  });
  await s.connectAuto();
  assert.equal(P.getBrightness(s.cur.led, s.effect()), 7);
  assert.equal(s.brightMax, 7);
  s.disconnect();
});

test('raising the brightness with the keyboard\u2019s own keys while the app is open extends the range', async () => {
  const { mock, s, storage } = make();
  await s.connectAuto();
  assert.equal(s.brightMax, 4);
  mock.led[slotOf(mock.led)] = 6; // what the hotkey does
  await s._syncFromKeyboard();
  assert.equal(P.getBrightness(s.cur.led, s.effect()), 6);
  assert.equal(s.brightMax, 6);
  assert.equal(storage.getItem('aula.bright.max'), '6');
  s.disconnect();
});

test('the preview scales any brightness range onto its 0..4 glow', () => {
  assert.equal(V.levelFor(0), 0);
  assert.equal(V.levelFor(4), 1);
  assert.equal(V.levelFor(2), 0.5);
  assert.equal(V.levelFor(3.5), 0.875);
  assert.equal(V.levelFor((8 * 4) / 8), 1, 'level 8 of 8 is full');
  assert.equal(V.levelFor((4 * 4) / 8), 0.5, 'level 4 of 8 is half');
  assert.equal(V.levelFor(99), 1);
  assert.equal(V.levelFor(NaN), 0);
});

test('Settings has a Brightness levels choice', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(html, /<select class="select" id="brightMaxSel"/);
});

test('Lighting sets brightness with a slider, not numbered buttons', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(html, /<input class="range" id="rngBright" type="range" min="0" max="4" step="1"/);
  assert.ok(!html.includes('segBright'), 'the old button group is gone');
});
