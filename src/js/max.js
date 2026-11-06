/*
 * AULA F75 Max: protocol, links and session.
 *
 * The F75 Max is not an F75 with a screen. It is built on different silicon (SONiX), uses other USB ids and speaks a
 * different protocol from the F75, F75 Pro and F87, so it has its own module and the F75 code never touches it.
 *
 * Source: the byte layouts here come from public notes by people who tried them on real F75 Max keyboards
 * (AULA Studio, VitalyArt/Aula-F75-Max-Driver, rexdotsh/aula-f75-max-screen). Nothing in this file has been run against
 * a physical keyboard by this app's author, so the UI calls the support experimental.
 *
 * Two links, both found through WebHID:
 *
 *   USB-C   0c45:800a, usage page 0xff13. 64-byte FEATURE reports (report id 0). A command is `04 <op> ...`; its reply
 *           is read back with a feature GET_REPORT and carries 0x01 at byte 3 once the keyboard accepted it. A write is
 *           begin (04 18), a header that selects a block (04 13 lighting, 04 17 settings, 04 23 per-key colours), the
 *           data packets, apply (04 02) and, for settings kept in flash, save (04 f0). Wait ~35 ms before each report.
 *   2.4G    05ac:024f, usage page 0xff60. 32-byte OUTPUT reports (report id 0) with the low 8 bits of the sum of the
 *           other bytes in byte 31. Carries lighting, response/sleep and the battery query (20 01), whose answer is an
 *           input report 20 01 .. <percent>. It cannot carry the 576-byte per-key table.
 *
 * What the keyboard will not do is tell us its settings: there is no known command to read lighting or settings back, so
 * the app remembers what it last sent and says so, instead of claiming it verified anything beyond the keyboard's
 * acknowledgements.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'));
  else root.AulaMax = factory(root.AulaProtocol);
})(typeof self !== 'undefined' ? self : globalThis, function (P) {
  'use strict';

  const IDS = {
    cable: { vid: 0x0c45, pid: 0x800a, page: 0xff13, label: 'USB-C cable' },
    dongle: { vid: 0x05ac, pid: 0x024f, page: 0xff60, label: '2.4G dongle' },
  };
  const PACKET = 64; // USB-C command size
  const REPORT = 32; // 2.4G report size
  const USER_DEFINED = 0x80; // lighting mode that shows the per-key table
  const KEY_PACKETS = 9; // 9 x 64 = 576 bytes of per-key colours
  const TRAILER = [0xaa, 0x55];
  const WAIT_MS = 1500; // longest the keyboard is given to acknowledge or echo one USB-C step; the first answer that fits ends the wait
  const POLL_MS = 15; // least pause between two looks at a reply that is not there yet

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex = (b, n = 8) => Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, '0')).join(' ');

  class MaxError extends Error {
    constructor(message, detail) {
      super(message);
      this.name = 'MaxError';
      if (detail) this.detail = detail;
    }
  }

  // ------------------------------------------------------------------ what the keyboard offers

  /** The firmware's 20 effects, in its own order (the mode number is the index). `color`: uses the chosen colour. */
  const EFFECTS = [
    { mode: 0, name: 'Off' },
    { mode: 1, name: 'Static' },
    { mode: 2, name: 'Reactive', reactive: true },
    { mode: 3, name: 'Reactive fade', reactive: true },
    { mode: 4, name: 'Glitter' },
    { mode: 5, name: 'Rain', direction: true },
    { mode: 6, name: 'Colourful' },
    { mode: 7, name: 'Breathing' },
    { mode: 8, name: 'Spectrum cycle' },
    { mode: 9, name: 'Outward' },
    { mode: 10, name: 'Wave', direction: true },
    { mode: 11, name: 'Rolling', direction: true },
    { mode: 12, name: 'Rotating' },
    { mode: 13, name: 'Explode', reactive: true },
    { mode: 14, name: 'Launch', reactive: true },
    { mode: 15, name: 'Ripple', reactive: true },
    { mode: 16, name: 'Flowing', direction: true },
    { mode: 17, name: 'Pulse' },
    { mode: 18, name: 'Tilt', direction: true },
    { mode: 19, name: 'Shuttle', direction: true },
  ].map((e) => ({ color: e.mode !== 0 && e.mode !== 8, direction: false, reactive: false, ...e }));

  const effect = (mode) => EFFECTS.find((e) => e.mode === mode) || null;
  const DIRECTIONS = ['Right', 'Down', 'Left', 'Up'];
  const SLEEP = [
    { value: 0, label: 'Never' },
    { value: 1, label: '1 minute' },
    { value: 2, label: '5 minutes' },
    { value: 3, label: '30 minutes' },
  ];
  const RESPONSE_NOTES = {
    1: 'Fastest. Wired 2 to 3 ms, 2.4G 5 to 6 ms.',
    2: 'Wired 5 to 6 ms, 2.4G 7 to 9 ms.',
    3: 'Wired 8 to 9 ms, 2.4G 10 to 12 ms.',
    4: 'Wired 13 to 14 ms, 2.4G 15 to 17 ms.',
    5: 'Most debounce. Wired 17 to 18 ms, 2.4G 19 to 21 ms.',
  };

  const DEFAULT_LIGHTING = { mode: 10, rgb: [0x6e, 0x7b, 0xff], colorful: false, brightness: 4, speed: 3, direction: 0 };
  const DEFAULT_SETTINGS = { response: 2, sleep: 2, winLock: false, altF4Lock: false, altTabLock: false, fnSwitch: false };

  /** Each key's light index, from the vendor driver's layout for the F75 Max (Esc is 1). */
  const KEYS = {
    esc: 1, f1: 2, f2: 3, f3: 4, f4: 5, f5: 6, f6: 7, f7: 8, f8: 9, f9: 10, f10: 11, f11: 12, f12: 13,
    grave: 19, 1: 20, 2: 21, 3: 22, 4: 23, 5: 24, 6: 25, 7: 26, 8: 27, 9: 28, 0: 29, minus: 30, equal: 31, backspace: 103,
    tab: 37, q: 38, w: 39, e: 40, r: 41, t: 42, y: 43, u: 44, i: 45, o: 46, p: 47, bracketleft: 48, bracketright: 49, backslash: 67,
    capslock: 55, a: 56, s: 57, d: 58, f: 59, g: 60, h: 61, j: 62, k: 63, l: 64, semicolon: 65, quote: 66, enter: 85,
    shiftleft: 73, z: 74, x: 75, c: 76, v: 77, b: 78, n: 79, m: 80, comma: 81, period: 82, slash: 83, shiftright: 84,
    ctrlleft: 91, winleft: 92, altleft: 93, space: 94, altright: 95, fn: 96, left: 99, down: 100, up: 101, right: 102,
    pageup: 118, delete: 119, end: 120, pagedown: 121,
  };

  const LABELS = {
    grave: '`', minus: '-', equal: '=', backspace: 'Bksp', bracketleft: '[', bracketright: ']', backslash: '\\', capslock: 'Caps',
    semicolon: ';', quote: "'", enter: 'Enter', shiftleft: 'Shift', shiftright: 'Shift', comma: ',', period: '.', slash: '/',
    ctrlleft: 'Ctrl', winleft: 'Win', altleft: 'Alt', altright: 'Alt', space: 'Space', fn: 'Fn', left: '←', down: '↓', up: '↑',
    right: '→', pageup: 'PgUp', pagedown: 'PgDn', delete: 'Del', end: 'End', tab: 'Tab', esc: 'Esc',
  };
  const labelOf = (name) => LABELS[name] || (/^f\d+$/.test(name) ? name.toUpperCase() : name.length === 1 ? name.toUpperCase() : name);

  /**
   * Where each key sits, in key units on a 16 x 6 board (a 75% layout with a navigation column). Only for drawing the
   * painter: the keyboard cares about the light index alone.
   */
  function keyLayout() {
    const rows = [
      ['esc', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)],
      ['grave', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'minus', 'equal', ['backspace', 2], 'delete'],
      [['tab', 1.5], 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'bracketleft', 'bracketright', ['backslash', 1.5], 'pageup'],
      [['capslock', 1.75], 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'semicolon', 'quote', ['enter', 2.25], 'pagedown'],
      [['shiftleft', 2.25], 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'comma', 'period', 'slash', ['shiftright', 1.75], 'up', 'end'],
      [['ctrlleft', 1.25], ['winleft', 1.25], ['altleft', 1.25], ['space', 6.25], ['altright', 1.25], ['fn', 1.25], ['_', 0.5], 'left', 'down', 'right'],
    ];
    const out = [];
    rows.forEach((row, y) => {
      let x = 0;
      for (const item of row) {
        const [name, w] = Array.isArray(item) ? item : [item, 1];
        if (name !== '_') out.push({ name, led: KEYS[name], label: labelOf(name), x, y, w, h: 1 });
        x += w;
      }
    });
    return out;
  }

  // ------------------------------------------------------------------ USB-C packets (64-byte feature reports)

  function command(code, fields) {
    const p = new Uint8Array(PACKET);
    p[0] = 0x04;
    p[1] = code;
    for (const [i, v] of Object.entries(fields || {})) p[Number(i)] = v;
    return p;
  }

  const step = (name, bytes, kind) => ({ name, bytes, kind });
  const begin = () => step('begin', command(0x18), 'ack');
  // The data of a write is already on the keyboard when apply goes out, and a keyboard can be slow to answer it (it is
  // applying the change). An apply that is not acknowledged in time is reported as "not confirmed", not as a failed write.
  const apply = () => ({ ...step('apply', command(0x02), 'ack'), soft: true });
  const save = () => step('save', command(0xf0), 'send');

  /**
   * A lighting effect. begin, select, the payload (no reply is checked), apply, save.
   * Payload: [0] mode, [1..3] RGB, [8] colourful, [9] brightness 1..5, [10] speed 1..5, [11] direction 0..3, [14..15] aa 55.
   */
  function lightingSteps(s) {
    const mode = clamp(s.mode, 0, 19);
    const p = new Uint8Array(PACKET);
    p[0] = mode;
    if (mode !== 0) {
      p[1] = clamp(s.rgb[0], 0, 255);
      p[2] = clamp(s.rgb[1], 0, 255);
      p[3] = clamp(s.rgb[2], 0, 255);
      p[8] = s.colorful ? 1 : 0;
      p[9] = clamp(s.brightness, 1, 5);
      p[10] = clamp(s.speed, 1, 5);
      p[11] = clamp(s.direction, 0, 3);
    }
    p[14] = TRAILER[0];
    p[15] = TRAILER[1];
    return [begin(), step('select lighting', command(0x13, { 8: 1 }), 'ack'), step('lighting', p, 'send'), apply(), save()];
  }

  /** The same block in the user-defined mode (0x80), which shows the per-key table. Brightness is at byte 9. */
  function userDefinedSteps(brightness) {
    const p = new Uint8Array(PACKET);
    p[0] = USER_DEFINED;
    p[9] = clamp(brightness, 1, 5);
    p[14] = TRAILER[0];
    p[15] = TRAILER[1];
    return [begin(), step('select lighting', command(0x13, { 8: 1 }), 'ack'), step('lighting', p, 'send'), apply(), save()];
  }

  /**
   * The per-key table: 576 bytes, 4 per light at `index * 4` as `index r g b`, aa 55 at bytes 574..575. Lights not in
   * `colors` are left dark. Sent as 9 packets, each of which the keyboard echoes back.
   */
  function keyColorTable(colors) {
    const t = new Uint8Array(KEY_PACKETS * PACKET);
    for (const [led, rgb] of colors) {
      if (!(led >= 1 && led * 4 + 3 < t.length - TRAILER.length)) throw new MaxError(`light ${led} is outside the key table`);
      t.set([led, clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255)], led * 4);
    }
    t[t.length - 2] = TRAILER[0];
    t[t.length - 1] = TRAILER[1];
    return t;
  }

  function keyColorSteps(colors) {
    const table = keyColorTable(colors);
    const steps = [begin(), step('select key colours', command(0x23, { 8: KEY_PACKETS }), 'ack')];
    for (let i = 0; i < KEY_PACKETS; i++) steps.push(step(`key colours ${i + 1}/${KEY_PACKETS}`, table.slice(i * PACKET, (i + 1) * PACKET), 'echo'));
    steps.push(apply(), save());
    return steps;
  }

  /**
   * Response time, sleep and key locks. These are written all at once, and the keyboard cannot be asked what it holds, so
   * every field is sent from what the app remembers.
   * Payload: [1] 01, [2] Win lock, [3] Alt+F4 lock, [4] Alt+Tab lock, [5] Fn switch, [6] sleep 0..3, [8] response 1..5, aa 55 at 62..63.
   */
  function settingsSteps(s) {
    const p = new Uint8Array(PACKET);
    p[1] = 0x01;
    p[2] = s.winLock ? 1 : 0;
    p[3] = s.altF4Lock ? 1 : 0;
    p[4] = s.altTabLock ? 1 : 0;
    p[5] = s.fnSwitch ? 1 : 0;
    p[6] = clamp(s.sleep, 0, 3);
    p[8] = clamp(s.response, 1, 5);
    p[62] = TRAILER[0];
    p[63] = TRAILER[1];
    return [begin(), step('select settings', command(0x17, { 2: 1, 8: 1 }), 'ack'), step('settings', p, 'send'), apply()];
  }

  /** The keyboard accepted a command: it echoes the op and sets byte 3 to 1. */
  const accepted = (sent, reply) => reply.length > 3 && reply[1] === sent[1] && reply[3] === 0x01;

  // ------------------------------------------------------------------ 2.4G packets (32-byte output reports)

  function withChecksum(r) {
    r[REPORT - 1] = 0;
    let sum = 0;
    for (const b of r) sum = (sum + b) & 0xff;
    r[REPORT - 1] = sum;
    return r;
  }

  const rgbCommitReport = () => withChecksum(Uint8Array.of(0x0f, ...new Array(REPORT - 1).fill(0)));

  function rgbReport(s) {
    const r = new Uint8Array(REPORT);
    const mode = clamp(s.mode, 0, 19);
    r[0] = 0x05;
    r[1] = 0x10;
    r[3] = mode;
    if (mode !== 0) {
      r[4] = clamp(s.rgb[0], 0, 255);
      r[5] = clamp(s.rgb[1], 0, 255);
      r[6] = clamp(s.rgb[2], 0, 255);
      r[11] = s.colorful ? 1 : 0;
      r[12] = clamp(s.brightness, 1, 5);
      r[13] = clamp(s.speed, 1, 5);
      r[14] = clamp(s.direction, 0, 3);
    }
    r[17] = TRAILER[0];
    r[18] = TRAILER[1];
    return withChecksum(r);
  }

  /** Response, sleep and Fn switch. Game mode (bytes 12..15) is left off. */
  function responseReport(s) {
    const r = new Uint8Array(REPORT);
    r.set([0x07, 0x10, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01]);
    r[8] = s.fnSwitch ? 1 : 0;
    r[9] = clamp(s.sleep, 0, 3);
    r[11] = clamp(s.response, 1, 5);
    r[17] = TRAILER[0];
    r[18] = TRAILER[1];
    return withChecksum(r);
  }

  const batteryQuery = () => withChecksum(Uint8Array.of(0x20, 0x01, ...new Array(REPORT - 2).fill(0)));

  /** The percentage in a battery answer (input report 20 01 .. <percent>), or null for any other report. */
  function parseBattery(d) {
    return d.length >= 4 && d[0] === 0x20 && d[1] === 0x01 && d[3] >= 1 && d[3] <= 100 ? d[3] : null;
  }

  // ------------------------------------------------------------------ WebHID links

  const toBytes = (v) => {
    const u = v instanceof Uint8Array ? v.slice() : new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
    return u;
  };

  async function openDevice(device, what) {
    if (device.opened) return;
    try {
      await device.open();
    } catch (err) {
      if (err && err.name === 'InvalidStateError') return; // another part of the page already has it open
      throw new MaxError(`Could not open the ${what}. Close the official AULA driver and try again. (${(err && err.message) || err})`);
    }
  }

  /** USB-C: 64-byte feature reports on usage page 0xff13. */
  class CableLink {
    constructor(device, { delayMs = 35, waitMs = WAIT_MS } = {}) {
      this.device = device;
      this.delayMs = delayMs;
      this.waitMs = waitMs;
      this.kind = 'cable';
    }

    async open() {
      await openDevice(this.device, 'USB-C connection');
    }

    async close() {
      try {
        if (this.device.opened) await this.device.close();
      } catch (_) {
        /* already gone */
      }
    }

    /** One look at the keyboard's reply. */
    async _reply() {
      let r = toBytes(await this.device.receiveFeatureReport(0));
      if (r.length === PACKET + 1 && r[0] === 0) r = r.slice(1); // some stacks keep the report id in front
      return r;
    }

    /**
     * Runs the steps in order. `ack` steps must be accepted, `echo` steps must come back unchanged, `send` steps are fire
     * and forget. A reply is looked for again and again, up to `waitMs`, and the first one that fits ends the wait: a
     * keyboard that is slow to answer (it is busy applying the change) is not called a failure for being slow. Resolves
     * { unconfirmed }, the names of `soft` steps (apply) the keyboard never acknowledged although everything before them was.
     */
    async run(steps) {
      await this.open();
      const unconfirmed = [];
      for (const s of steps) {
        await sleep(this.delayMs);
        try {
          if (s.kind === 'send') {
            await this.device.sendFeatureReport(0, s.bytes);
            await sleep(this.delayMs);
            continue;
          }
          const fits = s.kind === 'ack' ? (r) => accepted(s.bytes, r) : (r) => hex(r, PACKET) === hex(s.bytes, PACKET);
          await this.device.sendFeatureReport(0, s.bytes);
          let reply = null;
          let why = '';
          const end = Date.now() + this.waitMs;
          for (let look = 0; ; look++) {
            await sleep(look === 0 ? this.delayMs : Math.max(this.delayMs, POLL_MS));
            try {
              reply = await this._reply();
              why = '';
            } catch (err) {
              // The keyboard can refuse a read for a moment right after a command; ask again until the time is up.
              reply = null;
              why = (err && err.message) || String(err);
            }
            if ((reply && fits(reply)) || Date.now() >= end) break;
          }
          if (reply && fits(reply)) continue;
          if (!reply) throw new MaxError(`The USB-C link failed during “${s.name}”: ${why}`);
          if (s.soft) {
            unconfirmed.push(s.name);
            continue;
          }
          if (s.kind === 'ack') {
            throw new MaxError(`The keyboard did not accept “${s.name}” (it answered ${hex(reply)}).`, { step: s.name, reply: hex(reply, 16) });
          }
          throw new MaxError(`The keyboard did not echo “${s.name}” back (it answered ${hex(reply)}).`, { step: s.name, reply: hex(reply, 16) });
        } catch (err) {
          if (err instanceof MaxError) throw err;
          throw new MaxError(`The USB-C link failed during “${s.name}”: ${(err && err.message) || err}`);
        }
      }
      return { unconfirmed };
    }
  }

  /** 2.4G dongle: 32-byte output reports, and input reports for the battery. */
  class DongleLink {
    constructor(device, { delayMs = 50 } = {}) {
      this.device = device;
      this.delayMs = delayMs;
      this.kind = 'dongle';
      this._waiters = new Set();
      this._handler = (e) => {
        const d = toBytes(e.data);
        for (const w of [...this._waiters]) w(d);
      };
    }

    async open() {
      await openDevice(this.device, '2.4G dongle');
      this.device.removeEventListener('inputreport', this._handler);
      this.device.addEventListener('inputreport', this._handler);
    }

    async close() {
      try {
        this.device.removeEventListener('inputreport', this._handler);
        if (this.device.opened) await this.device.close();
      } catch (_) {
        /* already gone */
      }
    }

    async send(report) {
      await this.open();
      try {
        await this.device.sendReport(0, report);
      } catch (err) {
        throw new MaxError(`The 2.4G link failed: ${(err && err.message) || err}`);
      }
    }

    /** Asks for the battery level and waits for the answer. null when the keyboard does not answer (asleep, out of range). */
    async battery(timeoutMs = 1500) {
      await this.open();
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
          if (done) return;
          done = true;
          this._waiters.delete(waiter);
          clearTimeout(timer);
          resolve(v);
        };
        const waiter = (d) => {
          const p = parseBattery(d);
          if (p !== null) finish(p);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        this._waiters.add(waiter);
        this.send(batteryQuery()).catch(() => finish(null));
      });
    }
  }

  // ------------------------------------------------------------------ session

  const STORE_KEY = 'aula.max.v1';

  /** The outcome of a USB-C write: confirmed when every step was acknowledged, otherwise sent but not confirmed. */
  function cableResult(run, note) {
    const left = (run && run.unconfirmed) || [];
    if (!left.length) return { via: 'cable', confirmed: true, note };
    return { via: 'cable', confirmed: false, note: `Sent over USB-C. The keyboard did not confirm the last step (${left.join(', ')}); if nothing changed, try again.` };
  }

  class MaxSession {
    /**
     * @param opts.hid       navigator.hid (or a test double)
     * @param opts.storage   { getItem, setItem }
     * @param opts.delayMs   pause between USB-C reports (the keyboard wants ~35 ms)
     */
    constructor({ hid, storage, delayMs = 35, waitMs = WAIT_MS } = {}) {
      this.hid = hid || (typeof navigator !== 'undefined' ? navigator.hid : null) || null;
      this.storage = storage || null;
      this.delayMs = delayMs;
      this.waitMs = waitMs;
      this.cable = null;
      this.dongle = null;
      this.battery = { percent: null, at: 0 };
      this.lighting = { ...DEFAULT_LIGHTING, rgb: DEFAULT_LIGHTING.rgb.slice() };
      this.keyColors = new Map();
      this.settings = { ...DEFAULT_SETTINGS };
      this.busy = false;
      this.last = null; // the result of the last apply
      this.confirmed = new Set(); // 'vid:pid' the person said are an F75 Max although the name does not say so
      this.pending = [];
      this.refused = [];
      this._queue = Promise.resolve();
      this._on = {};
      this._load();
    }

    on(ev, fn) {
      (this._on[ev] = this._on[ev] || new Set()).add(fn);
      return () => this._on[ev].delete(fn);
    }

    _emit(ev) {
      for (const fn of [...(this._on[ev] || [])]) {
        try {
          fn(this);
        } catch (_) {
          /* a listener must not break the session */
        }
      }
    }

    get present() {
      return !!(this.cable || this.dongle);
    }

    /** The link used for writes: the cable when it is plugged in (it acknowledges every step), else the dongle. */
    get link() {
      return this.cable ? 'cable' : this.dongle ? 'dongle' : null;
    }

    get label() {
      return this.cable ? IDS.cable.label : this.dongle ? IDS.dongle.label : null;
    }

    /** Looks for permitted F75 Max interfaces and keeps one link per kind. */
    async scan() {
      let list = [];
      try {
        list = this.hid ? await this.hid.getDevices() : [];
      } catch (_) {
        list = [];
      }
      this.pending = []; // interfaces on the F75 Max's ids whose name does not say which model they are
      this.refused = []; // ... and those whose name is another AULA model
      const find = (id) => {
        const hits = list.filter((d) => d.vendorId === id.vid && d.productId === id.pid && ((d.collections || []).length === 0 || d.collections.some((c) => c.usagePage === id.page)));
        for (const d of hits) {
          const model = P.maxModel(d.productName);
          if (model === 'max' || (model === 'unknown' && this.confirmed.has(`${id.vid}:${id.pid}`))) return d;
          (model === 'unknown' ? this.pending : this.refused).push(d);
        }
        return null;
      };
      let changed = false;
      for (const [kind, Link] of [['cable', CableLink], ['dongle', DongleLink]]) {
        const d = find(IDS[kind]);
        const cur = this[kind];
        if (d && (!cur || cur.device !== d)) {
          if (cur) await cur.close();
          this[kind] = new Link(d, kind === 'cable' ? { delayMs: this.delayMs, waitMs: this.waitMs } : { delayMs: Math.max(this.delayMs, 50) });
          changed = true;
        } else if (!d && cur) {
          await cur.close();
          this[kind] = null;
          changed = true;
        }
      }
      if (changed) this._emit('presence');
      return this.present;
    }

    async disconnect() {
      for (const kind of ['cable', 'dongle']) {
        if (this[kind]) await this[kind].close();
        this[kind] = null;
      }
      this._emit('presence');
    }

    /** The person says the unnamed devices on the F75 Max's ids are an F75 Max. Remembered. */
    async confirmModel() {
      await this.scan(); // so the answer applies to what is plugged in now, not to an old list
      for (const d of this.pending) this.confirmed.add(`${d.vendorId}:${d.productId}`);
      this._save();
      return this.scan();
    }

    // ------------------------------------------------------------ what the app remembers

    setLighting(patch) {
      const l = { ...this.lighting, ...patch };
      l.mode = clamp(l.mode, 0, 19);
      l.brightness = clamp(l.brightness, 1, 5);
      l.speed = clamp(l.speed, 1, 5);
      l.direction = clamp(l.direction, 0, 3);
      l.rgb = [0, 1, 2].map((i) => clamp(l.rgb[i], 0, 255));
      l.colorful = !!l.colorful;
      this.lighting = l;
      this._save();
      this._emit('change');
    }

    setSettings(patch) {
      const s = { ...this.settings, ...patch };
      s.response = clamp(s.response, 1, 5);
      s.sleep = clamp(s.sleep, 0, 3);
      for (const k of ['winLock', 'altF4Lock', 'altTabLock', 'fnSwitch']) s[k] = !!s[k];
      this.settings = s;
      this._save();
      this._emit('change');
    }

    /** Paints lights `leds` with `rgb`, or turns them off when rgb is null. */
    paint(leds, rgb) {
      for (const led of leds) {
        if (rgb) this.keyColors.set(led, [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255)]);
        else this.keyColors.delete(led);
      }
      this._save();
      this._emit('change');
    }

    clearPaint() {
      this.keyColors = new Map();
      this._save();
      this._emit('change');
    }

    _load() {
      if (!this.storage) return;
      try {
        const j = JSON.parse(this.storage.getItem(STORE_KEY) || 'null');
        if (!j) return;
        if (j.lighting) this.setLightingQuiet(j.lighting);
        if (j.settings) {
          const s = { ...DEFAULT_SETTINGS, ...j.settings };
          this.settings = { response: clamp(s.response, 1, 5), sleep: clamp(s.sleep, 0, 3), winLock: !!s.winLock, altF4Lock: !!s.altF4Lock, altTabLock: !!s.altTabLock, fnSwitch: !!s.fnSwitch };
        }
        if (Array.isArray(j.confirmed)) for (const id of j.confirmed) if (typeof id === 'string') this.confirmed.add(id);
        if (Array.isArray(j.keys)) {
          for (const [led, rgb] of j.keys) {
            if (Number.isInteger(led) && Array.isArray(rgb) && rgb.length === 3) this.keyColors.set(led, rgb.map((v) => clamp(v, 0, 255)));
          }
        }
      } catch (_) {
        /* unreadable memory: start from the defaults */
      }
    }

    setLightingQuiet(patch) {
      const l = { ...DEFAULT_LIGHTING, ...patch };
      this.lighting = {
        mode: clamp(l.mode, 0, 19),
        rgb: [0, 1, 2].map((i) => clamp((l.rgb || DEFAULT_LIGHTING.rgb)[i], 0, 255)),
        colorful: !!l.colorful,
        brightness: clamp(l.brightness, 1, 5),
        speed: clamp(l.speed, 1, 5),
        direction: clamp(l.direction, 0, 3),
      };
    }

    _save() {
      if (!this.storage) return;
      try {
        this.storage.setItem(STORE_KEY, JSON.stringify({ lighting: this.lighting, settings: this.settings, keys: [...this.keyColors], confirmed: [...this.confirmed] }));
      } catch (_) {
        /* memory full or blocked: the settings simply are not remembered */
      }
    }

    // ------------------------------------------------------------ writing

    /**
     * One thing at a time on the wire. A failure is returned, not thrown. `quiet` jobs (the battery poll) do not replace
     * the result of the last thing the person applied, which is what the status line shows.
     */
    _run(name, fn, quiet = false) {
      const job = this._queue.then(async () => {
        this.busy = true;
        this._emit('busy');
        let result;
        try {
          result = { name, at: Date.now(), ...(await fn()), ok: true };
        } catch (err) {
          result = { name, at: Date.now(), ok: false, error: (err && err.message) || String(err), detail: err && err.detail };
        } finally {
          this.busy = false;
          this._emit('busy');
        }
        if (!quiet) {
          this.last = result;
          this._emit('result');
        }
        return result;
      });
      this._queue = job.then(() => undefined, () => undefined);
      return job;
    }

    applyLighting() {
      return this._run('lighting', async () => {
        const s = this.lighting;
        if (this.cable) {
          return cableResult(await this.cable.run(lightingSteps(s)), 'The keyboard accepted every step.');
        }
        if (this.dongle) {
          await this.dongle.send(rgbCommitReport());
          await sleep(50);
          await this.dongle.send(rgbReport(s));
          return { via: 'dongle', confirmed: false, note: 'Sent over 2.4G. The dongle does not confirm lighting changes.' };
        }
        throw new MaxError('No F75 Max found.');
      });
    }

    applyKeyColors() {
      return this._run('per-key colours', async () => {
        if (!this.cable) {
          throw new MaxError(this.dongle ? 'Per-key colours need the USB-C cable. The 2.4G dongle only carries 32 bytes at a time.' : 'No F75 Max found.');
        }
        return cableResult(await this.cable.run([...userDefinedSteps(this.lighting.brightness), ...keyColorSteps(this.keyColors)]), 'The keyboard accepted and echoed every step.');
      });
    }

    applySettings() {
      return this._run('settings', async () => {
        const s = this.settings;
        if (this.cable) {
          return cableResult(await this.cable.run(settingsSteps(s)), 'The keyboard accepted every step.');
        }
        if (this.dongle) {
          await this.dongle.send(responseReport(s));
          return { via: 'dongle', confirmed: false, note: 'Sent over 2.4G. Key locks need the USB-C cable; response, sleep and Fn were sent.' };
        }
        throw new MaxError('No F75 Max found.');
      });
    }

    /** The battery level through the 2.4G dongle (the USB-C link has no battery report). */
    pollBattery() {
      if (!this.dongle) return Promise.resolve(null);
      let percent = null;
      return this._run('battery', async () => {
        percent = await this.dongle.battery();
        if (percent !== null) {
          this.battery = { percent, at: Date.now() };
          this._emit('battery');
        }
        return { via: 'dongle', confirmed: percent !== null };
      }, true).then(() => percent);
    }
  }

  return {
    IDS, EFFECTS, effect, DIRECTIONS, SLEEP, RESPONSE_NOTES, DEFAULT_LIGHTING, DEFAULT_SETTINGS, KEYS, keyLayout, labelOf,
    PACKET, REPORT, USER_DEFINED, KEY_PACKETS,
    lightingSteps, userDefinedSteps, keyColorTable, keyColorSteps, settingsSteps, accepted,
    rgbCommitReport, rgbReport, responseReport, batteryQuery, parseBattery, withChecksum,
    CableLink, DongleLink, MaxSession, MaxError,
  };
});
