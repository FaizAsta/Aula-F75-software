/*
 * Battery maths for the Battery tab: how fast the level is rising or falling, the hourly bars for one day, and the
 * stretch since the last charge. Pure functions over the history list ({ t, p, c }: time, percent, charging flag),
 * so they run in the tests without a screen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AulaBattery = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  /** Percent per minute while charging, from the readings of the current charge. null when there is not enough to say. */
  function chargeRate(history, now) {
    const run = chargingRun(history);
    const recent = run.filter((h) => now - h.t <= 20 * MIN);
    if (recent.length < 2) return null;
    const a = recent[0];
    const b = recent[recent.length - 1];
    if (b.p - a.p < 2 || b.t - a.t < MIN) return null;
    return (b.p - a.p) / ((b.t - a.t) / MIN);
  }

  /** Percent per minute while on battery, from the last 7 days of readings that fell or held between two readings. */
  function drainRate(history, now) {
    let drop = 0;
    let span = 0;
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1];
      const b = history[i];
      if (now - b.t > 7 * DAY || a.c || b.c || b.p > a.p || b.t - a.t > 6 * HOUR) continue;
      drop += a.p - b.p;
      span += b.t - a.t;
    }
    if (drop < 2 || span < 30 * MIN) return null;
    return drop / (span / MIN);
  }

  /** The readings of the charge that is still going on: the unbroken run of charging points at the end of the history. */
  function chargingRun(history) {
    let i = history.length;
    while (i > 0 && history[i - 1].c) i--;
    return history.slice(i);
  }

  /** The readings since the last charge (or the current charge, while charging). `known` is false when no charge was ever seen. */
  function sinceCharge(history, charging, now) {
    const recent = history.filter((h) => now - h.t <= 7 * DAY);
    if (charging) return { points: chargingRun(recent), up: true, known: true };
    let last = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].c) {
        last = i;
        break;
      }
    }
    return { points: last < 0 ? recent : recent.slice(last), up: false, known: last >= 0 };
  }

  /** Midnight (local time) of the day `back` days before `now`. */
  function dayStart(now, back) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - back);
    return d.getTime();
  }

  /**
   * 24 hourly bars for the day that starts at `start`. A bar is the last reading of that hour, and is a charging bar when
   * any reading in the hour was taken while charging. An hour with no reading is null: the app was not running then.
   */
  function hourBuckets(history, start) {
    const out = [];
    for (let h = 0; h < 24; h++) {
      const lo = start + h * HOUR;
      const inHour = history.filter((x) => x.t >= lo && x.t < lo + HOUR);
      out.push(inHour.length ? { p: inHour[inHour.length - 1].p, c: inHour.some((x) => x.c) } : null);
    }
    return out;
  }

  /** "3 h 33 m", "42 m", "2 d 4 h". */
  function duration(minutes) {
    const m = Math.max(1, Math.round(minutes));
    if (m < 60) return `${m} m`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} m`;
    return `${Math.floor(m / 1440)} d ${Math.round((m % 1440) / 60)} h`;
  }

  return { chargeRate, drainRate, chargingRun, sinceCharge, dayStart, hourBuckets, duration, MIN, HOUR, DAY };
});
