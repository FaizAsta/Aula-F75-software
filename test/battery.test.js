const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/js/battery.js');

const NOW = new Date(2026, 9, 19, 10, 47).getTime();
const min = (n) => NOW - n * B.MIN;

test('charge rate comes from the unbroken run of charging readings', () => {
  const h = [
    { t: min(90), p: 40, c: 0 },
    { t: min(30), p: 50, c: 1 },
    { t: min(20), p: 54, c: 1 },
    { t: min(10), p: 58, c: 1 },
    { t: min(0), p: 62, c: 1 },
  ];
  const r = B.chargeRate(h, NOW);
  assert.ok(Math.abs(r - 0.4) < 1e-9, `0.4 %/min, got ${r}`); // 12% in 30 min
  assert.equal(B.chargeRate([{ t: min(5), p: 50, c: 1 }], NOW), null, 'one reading says nothing');
  assert.equal(B.chargeRate([{ t: min(5), p: 50, c: 1 }, { t: min(0), p: 51, c: 1 }], NOW), null, 'too little change to trust');
});

test('drain rate ignores charging, rises and long gaps', () => {
  const h = [
    { t: min(600), p: 90, c: 0 },
    { t: min(480), p: 88, c: 0 },
    { t: min(360), p: 85, c: 0 },
    { t: min(240), p: 30, c: 1 }, // a charging point: its pairs are skipped
    { t: min(120), p: 80, c: 0 },
    { t: min(0), p: 77, c: 0 },
  ];
  const r = B.drainRate(h, NOW);
  assert.ok(Math.abs(r - 8 / 360) < 1e-9, `8% over 360 min, got ${r}`);
  assert.equal(B.drainRate([{ t: min(60), p: 80, c: 0 }, { t: min(0), p: 79, c: 0 }], NOW), null, 'not enough yet');
});

test('hourly buckets: last reading of the hour, charging if any reading charged, empty hours are null', () => {
  const start = B.dayStart(NOW, 0);
  const at = (h, m) => start + h * B.HOUR + m * B.MIN;
  const hist = [
    { t: at(9, 5), p: 70, c: 0 },
    { t: at(9, 50), p: 68, c: 0 },
    { t: at(10, 10), p: 60, c: 0 },
    { t: at(10, 40), p: 66, c: 1 },
  ];
  const b = B.hourBuckets(hist, start);
  assert.equal(b.length, 24);
  assert.deepEqual(b[9], { p: 68, c: false });
  assert.deepEqual(b[10], { p: 66, c: true });
  assert.equal(b[8], null);
  assert.equal(b[11], null);
});

test('since the last charge starts at the last charging reading', () => {
  const h = [
    { t: min(300), p: 60, c: 1 },
    { t: min(200), p: 100, c: 1 },
    { t: min(100), p: 95, c: 0 },
    { t: min(0), p: 90, c: 0 },
  ];
  const a = B.sinceCharge(h, false, NOW);
  assert.equal(a.known, true);
  assert.deepEqual(a.points.map((x) => x.p), [100, 95, 90]);
  const c = B.sinceCharge(h.slice(0, 2), true, NOW);
  assert.deepEqual(c.points.map((x) => x.p), [60, 100]);
  assert.equal(c.up, true);
  const none = B.sinceCharge([{ t: min(10), p: 80, c: 0 }], false, NOW);
  assert.equal(none.known, false);
});

test('durations read like the phone: 42 m, 3 h 33 m, 3 d 10 h', () => {
  assert.equal(B.duration(42), '42 m');
  assert.equal(B.duration(213), '3 h 33 m');
  assert.equal(B.duration(66), '1 h 6 m');
  assert.equal(B.duration(82 * 60), '3 d 10 h');
});
