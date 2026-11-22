/*
 * AULA F75 HE (Hall effect): protocol, links and session.
 *
 * The F75 HE is not an F75 with magnetic switches. It belongs to AULA's "HFD" family of Hall-effect boards (the MINI 60 HE
 * Pro, MINI 68 HE and others), uses its own USB ids and speaks a different protocol from the F75, F75 Pro and F87, so it has
 * its own module and the F75 code never touches it.
 *
 * Source: the byte layouts here come from the public reverse-engineering of AULA's own web driver and of captures of that
 * driver talking to a MINI 60 HE PRO, by the Aether-HE project (docs/context/issue-6-mini60-pro-raw/HFD_SDK_DECODE.md and
 * protocol_mini60.py). That project lists the F75 HE (USB-C 38a6:2729, receiver 0c45:fefe) as a member of the same family,
 * read from the vendor driver's device table.
 *
 * Checked against a real F75 HE (firmware V1.55): two read-only probes (test/fixtures, one per link) and a capture of AULA's
 * own web driver (hub.aulacn.com) driving that keyboard over the USB-C cable and clicking every lighting effect it offers
 * (test/fixtures/aula-f75he-hub-effects-capture-2026-11-17.txt). The capture fixes the mode number and the name AULA gives
 * each effect, and the exact 16 bytes the driver writes for it (see lightingPayload). It did not include a per-key write, a
 * Hall-effect setting or anything on the 2.4G dongle.
 *
 * What it sends, and only this (everything else is refused before it reaches a link, see SAFE):
 *
 *   0x10  read the device info (ids, firmware, battery and charging state)
 *   0x13  read the lighting block        0x23  write it (16 bytes)
 *   0x14  read the per-key colour table  0x24  write it (126 records of 4 bytes: key, r, g, b)
 *
 * It never sends the commands that can wipe or brick a board: 0x0f (factory reset), 0x4f (firmware flash), 0x64 / 0x65
 * (calibration), 0x66 / 0x67, 0x30 / 0x31. The Hall-effect settings (actuation point, Rapid Trigger, SOCD, dead zones) are
 * not touched at all: they live in tables that need a read-modify-write and have not been checked on this model.
 *
 * Framing (the same on both links, only the size differs):
 *
 *   USB-C   usage page 0xff68, usage 0x61, 64-byte reports, report id 0.
 *   2.4G    usage page 0xff60, usage 0x61, 32-byte reports, report id 0. The receiver is shared with other HFD boards, so the
 *           keyboard's own answer to 0x10 (which names its USB ids) decides whether it really is an F75 HE.
 *
 *   request  AA <cmd> <len> <offset lo> <offset hi> 00 <last> 00 <payload...>
 *   reply    55 <cmd> <len> <offset lo> <offset hi> ... <data from byte 8>
 *
 * A table is paged: each frame carries (frame size - 8) bytes, 56 on the cable and 24 on the dongle, at its byte offset, and
 * the last page has byte 6 set. Every page is acknowledged (a write is echoed, a read is answered) before the next one goes.
 *
 * Unlike the F75 Max, this keyboard can be read back, so the screen shows what the keyboard holds.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'));
  else root.AulaHe = factory(root.AulaProtocol);
})(typeof self !== 'undefined' ? self : globalThis, function (P) {
  'use strict';

  // The vendor driver opens the first of these usage pages it finds; the F75 HE is expected on 0xff68 like its siblings.
  const VENDOR_PAGES = [0xff68, 0xff80, 0xff60, 0xff00, 0xff01, 0xff5b];
  const IDS = {
    cable: { vid: 0x38a6, pid: 0x2729, pages: VENDOR_PAGES, usage: 0x61, frame: 64, label: 'USB-C cable' },
    dongle: { vid: 0x0c45, pid: 0xfefe, pages: [0xff60], usage: 0x61, frame: 32, label: '2.4G dongle' },
  };
  // What the keyboard names as its own USB ids in its first reply. The ids of the other HFD boards it must not be mistaken for.
  const IDENTITY = { vid: 0x38a6, pid: 0x2729 };
  const OTHER_HFD = [
    [0x0c45, 0x80a2], [0x0c45, 0x80b2], [0x0c45, 0x80a1], // MINI 60 HE Pro (two revisions), MINI 60 HE Max
    [0x38a6, 0x2722], [0x38a6, 0x2723], [0x38a6, 0x2724], // MINI 68 HE, HE Pro, HE Max
  ];

  const MAGIC = 0xaa;
  const REPLY = 0x55;
  const HEAD = 8; // the payload starts at byte 8 of a frame
  const CMD = { INFO: 0x10, GET_LIGHT: 0x13, GET_KEYS: 0x14, SET_LIGHT: 0x23, SET_KEYS: 0x24 };
  /** The only commands this module will ever build a frame for. */
  const SAFE = new Set(Object.values(CMD));
  const INFO_SIZE = 0x38;
  const LIGHT_SIZE = 0x10;
  // One slot per firmware key index. AULA's own driver reads the table as 128 records (0x200 bytes, the last page 8 bytes
  // long) and the keyboard answers all of them, so that is the size written. The app reads back only the first 126 records:
  // that is what was checked on both links, and the last two records are not keys.
  const LED_COUNT = 128;
  const KEYS_SIZE = LED_COUNT * 4;
  const KEYS_READ = 126 * 4;
  const CUSTOM = 20; // lighting mode that shows the per-key table
  const WAIT_MS = 600; // longest the keyboard is given to answer one frame
  const TRIES = 3; // the vendor driver asks up to three times per frame
  // The Snake (drawn by this app): the shortest time between two pictures, by link, and how many pictures in a row may fail before it
  // stops. 16 ms is 60 pictures a second. Each frame is acknowledged before the next goes (about 5 ms on the cable in AULA's own capture),
  // so the real pace is set by how many frames a picture needs: a whole table is 10 on the cable and 22 on the dongle (about 10 pictures
  // a second at best), which is why a picture sends only the pages that changed, see patchFrames.
  const SOFT_MIN_MS = { cable: 16, dongle: 16 };
  const SOFT_FAILS = 3;
  const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
  // A keyboard that is unplugged can leave an open, a send or a close waiting for ever. One call stuck like that would hold the
  // whole session (its queue and its search for the keyboard) until the app is restarted, so every call to the device has a limit.
  const OPEN_MS = 5000;
  const SEND_MS = 3000;
  const CLOSE_MS = 1500;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** The result of `p`, or an HeError when it has not finished after `ms`. */
  const bounded = (p, ms, what) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HeError(`${what} did not finish in ${ms / 1000} seconds.`)), ms);
      Promise.resolve(p).then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  const hex = (b, n = 8) => Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, '0')).join(' ');
  const hex4 = (n) => n.toString(16).padStart(4, '0');

  class HeError extends Error {
    constructor(message, detail) {
      super(message);
      this.name = 'HeError';
      if (detail) this.detail = detail;
    }
  }

  // ------------------------------------------------------------------ what the keyboard offers

  /**
   * The firmware's lighting effects, by the mode byte (0 is Off, 1 to 19 are the effects, 20 is the per-key table).
   *
   * Modes 1 to 13 and 15 to 19 and their names are AULA's own: the capture of its web driver clicking each effect of an
   * F75 HE lists exactly these, in this order, with these mode bytes. The driver offers no Off and no effect 14. Off is this
   * app's own: it is never written as mode 0 (no capture shows that mode working) but as Static in black, see OFF below. A
   * real F75 HE was found running mode 14 all the same, so the firmware has it, and it is `hidden` (never offered as a
   * choice, still named when the keyboard reports it). `color` is false for effects that always run multicolour, `direction` for those with
   * a direction, `reactive` for those that answer key presses; those three, and the one-line texts, are this app's reading of
   * the names, because the capture shows which effects exist but not what each one looks like or which controls it enables.
   */
  const FX = (mode, name, info, flags = {}) => ({ mode, name, info, color: true, direction: false, reactive: false, hidden: false, ...flags });
  const EFFECTS = [
    FX(0, 'Off', 'All lighting is switched off. AULA’s own app has no Off, so this app sends Static in black.', { color: false }),
    FX(1, 'Static', 'Every key stays one colour.'),
    FX(2, 'Single Point On', 'The key you press lights up.', { reactive: true }),
    FX(3, 'Single Point Off', 'The key you press lights up, then goes out.', { reactive: true }),
    FX(4, 'Starry Sky', 'Keys twinkle like stars.'),
    FX(5, 'Snowfall', 'Points of light fall across the board.'),
    FX(6, 'Blooming', 'Every key has its own colour.', { color: false }),
    FX(7, 'Dynamic Breathing', 'The whole board brightens and dims.'),
    FX(8, 'Spectrum Cycle', 'The whole board steps through every colour.', { color: false }),
    FX(9, 'Colorful Spring', 'Colour wells up and spreads across the board.'),
    FX(10, 'Colorful Cross', 'Crossing bands of colour.', { direction: true }),
    FX(11, 'Drifting', 'Colour drifts across the board.', { direction: true }),
    FX(12, 'Peak Return', 'Colour rises to a peak and comes back.', { direction: true }),
    FX(13, 'Instant Trigger', 'Pressing a key sends light across the board.', { reactive: true }),
    FX(14, 'Effect 14', 'A firmware effect that AULA’s own app does not offer for this keyboard.', { hidden: true }),
    FX(15, 'Ripple Spread', 'A key press sends a ripple out from the key.', { color: false, reactive: true }),
    FX(16, 'Flowing Stream', 'Colour flows across the board.', { direction: true }),
    FX(17, 'Mountain Layers', 'Layers of colour rise and fall like mountains.', { color: false }),
    FX(18, 'Gentle Rain', 'Soft drops of colour fall across the board.', { color: false, direction: true }),
    FX(19, 'Shuttle', 'A bar of light sweeps back and forth.', { color: false }),
  ];
  // ------------------------------------------------------------------ effects drawn by this app
  //
  // The keyboard's firmware has 19 effects and Snake is not one of them (the F75 has it, the F75 HE has not). So Snake here is
  // drawn by this app: it works out the colour of every key many times a second and writes it to the per-key table (the same
  // write the Per-key page makes), with the keyboard in its per-key lighting mode. It therefore only runs while the app is open
  // and the keyboard is reachable. Its mode number (100) is the app's own and is never sent to the keyboard.
  const SNAKE = 100;
  const SOFT_EFFECTS = [
    FX(SNAKE, 'Snake', 'A snake of light winds through the keys, row by row. Drawn by this app, so it runs only while the app is open.', { direction: true, soft: true }),
  ];
  const isSoft = (mode) => SOFT_EFFECTS.some((e) => e.mode === mode);
  const effect = (mode) => EFFECTS.find((e) => e.mode === mode) || SOFT_EFFECTS.find((e) => e.mode === mode) || null;
  const DIRECTIONS = ['Forward', 'Reverse'];
  // How this app switches the lights off. AULA's own driver has no Off effect and mode 0 has never been seen to work on a real
  // F75 HE, so Off is Static (a mode the driver writes) in black with the one-colour flag: no key gets any light. A keyboard
  // that holds exactly that is read back as Off.
  const OFF = { mode: 1 };

  // Brightness runs 1..BRIGHT_LEVELS, the same nine steps the F75 offers (the keyboard has no Off level: Off is an effect). Speed stays 1..5.
  const BRIGHT_LEVELS = 9;

  const DEFAULT_LIGHTING = { mode: 8, rgb: [0x6e, 0x7b, 0xff], colorful: false, brightness: 4, speed: 3, direction: 0 };

  /**
   * Each key's firmware key index. One index per physical key, the same in every table of the keyboard (keys, lighting,
   * actuation): it follows a full-size matrix with 16 slots per row, as published for the HFD family. The F75 HE's own layout
   * table has not been published, so the key order below is the F75 family's and is provisional: if a key lights the wrong
   * cap on a real keyboard, this table is the place to fix it. The caps themselves follow photos of the real board: Fn then Ctrl
   * (not Alt) to the right of the space bar, so those two indices (84 and 85) are named for the caps seen there, in matrix order.
   */
  const KEYS = {
    esc: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8, f9: 9, f10: 10, f11: 11, f12: 12,
    grave: 16, 1: 17, 2: 18, 3: 19, 4: 20, 5: 21, 6: 22, 7: 23, 8: 24, 9: 25, 0: 26, minus: 27, equal: 28, backspace: 92,
    tab: 32, q: 33, w: 34, e: 35, r: 36, t: 37, y: 38, u: 39, i: 40, o: 41, p: 42, bracketleft: 43, bracketright: 44, backslash: 60,
    capslock: 48, a: 49, s: 50, d: 51, f: 52, g: 53, h: 54, j: 55, k: 56, l: 57, semicolon: 58, quote: 59, enter: 76,
    shiftleft: 64, z: 65, x: 66, c: 67, v: 68, b: 69, n: 70, m: 71, comma: 72, period: 73, slash: 74, shiftright: 75,
    ctrlleft: 80, winleft: 81, altleft: 82, space: 83, fn: 84, ctrlright: 85, left: 88, down: 89, up: 90, right: 91,
    pageup: 105, delete: 106, end: 107, pagedown: 108,
  };

  const LABELS = {
    grave: '`', minus: '-', equal: '=', backspace: 'Bksp', bracketleft: '[', bracketright: ']', backslash: '\\', capslock: 'Caps',
    semicolon: ';', quote: "'", enter: 'Enter', shiftleft: 'Shift', shiftright: 'Shift', comma: ',', period: '.', slash: '/',
    ctrlleft: 'Ctrl', winleft: 'Win', altleft: 'Alt', ctrlright: 'Ctrl', space: 'Space', fn: 'Fn', left: '←', down: '↓', up: '↑',
    right: '→', pageup: 'PgUp', pagedown: 'PgDn', delete: 'Del', end: 'End', tab: 'Tab', esc: 'Esc',
  };
  const labelOf = (name) => LABELS[name] || (/^f\d+$/.test(name) ? name.toUpperCase() : name.length === 1 ? name.toUpperCase() : name);

  /**
   * The board is 16 key units wide. The function row sits slightly apart (ROW_GAP), with a gap after Esc and a small one between
   * the F-key groups, as photos of the real F75 HE show (the same spacing as the F75). The knob sits at the right end of that row.
   */
  const ROW_GAP = 1.3;
  const GRID = { w: 16, h: ROW_GAP + 5 };

  /** Where each key sits, in key units on the GRID (a 75% layout with a navigation column). `led` is the key index. */
  function keyLayout() {
    const rows = [
      ['esc', ['_', 1], 'f1', 'f2', 'f3', 'f4', ['_', 0.25], 'f5', 'f6', 'f7', 'f8', ['_', 0.25], 'f9', 'f10', 'f11', 'f12'],
      ['grave', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'minus', 'equal', ['backspace', 2], 'delete'],
      [['tab', 1.5], 'q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'bracketleft', 'bracketright', ['backslash', 1.5], 'pageup'],
      [['capslock', 1.75], 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'semicolon', 'quote', ['enter', 2.25], 'pagedown'],
      [['shiftleft', 2.25], 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'comma', 'period', 'slash', ['shiftright', 1.75], 'up', 'end'],
      [['ctrlleft', 1.25], ['winleft', 1.25], ['altleft', 1.25], ['space', 6.25], ['fn', 1.25], ['ctrlright', 1.25], ['_', 0.5], 'left', 'down', 'right'],
    ];
    const out = [];
    rows.forEach((row, r) => {
      const y = r === 0 ? 0 : r - 1 + ROW_GAP; // whole rows first, so 1.3, 2.3 ... come out exact
      let x = 0;
      for (const item of row) {
        const [name, w] = Array.isArray(item) ? item : [item, 1];
        if (name !== '_') out.push({ name, led: KEYS[name], label: labelOf(name), x, y, w, h: 1 });
        x += w;
      }
    });
    return out;
  }

  // ------------------------------------------------------------------ the Snake, drawn by this app

  /** The path the snake follows: the keys row by row from the top, every other row run backwards. The key indexes, in order. */
  function snakePath(keys = keyLayout()) {
    const rows = new Map();
    for (const k of keys) {
      const r = Math.round(k.y * 10);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(k);
    }
    return [...rows.keys()]
      .sort((a, b) => a - b)
      .flatMap((r, i) => {
        const row = rows.get(r).sort((a, b) => a.x - b.x);
        return i % 2 ? row.reverse() : row;
      })
      .map((k) => k.led);
  }

  const SNAKE_TAIL = 10; // keys behind the head that still glow
  /** How many keys the head moves in a second at a speed level (1..5): the same pace as the F75's own Snake. */
  const snakeRate = (speed) => (0.35 + clamp(speed, 1, 5) * 0.45) * 14;

  function hsv(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  /**
   * The colour of every lit key of the Snake `t` seconds after it started, as a Map of key index to [r, g, b] at full strength (the
   * keyboard's brightness level dims it). The head is the brightest key and the tail fades over SNAKE_TAIL keys; with multicolour on,
   * the hue changes along the tail, as the F75's Snake does. `l` is the lighting state: rgb, colorful, speed, direction (1 = reverse).
   *
   * By default the head jumps a whole key at a time, like the F75's own Snake (the card and the keyboard picture on screen draw it
   * so). With `glide` the head moves continuously between keys: the key it is leaving fades by a tenth, the key it is reaching lights
   * up in proportion to how far the head has come, so every picture is a little different from the one before and the motion is smooth
   * at any number of pictures a second. The pace, the length of the tail and the hues are the same.
   */
  function snakeFrame(t, l, path = snakePath(), glide = false) {
    const n = path.length;
    const out = new Map();
    if (!n) return out;
    const rate = snakeRate(l.speed);
    const reverse = l.direction === 1;
    const at = Math.max(0, t) * rate;
    const mod = (v) => ((v % n) + n) % n;
    const colour = (f, behind) => (l.colorful ? hsv(((behind / 12) * 360) % 360, 1, f) : l.rgb.map((v) => Math.round(clamp(v, 0, 255) * f)));
    if (!glide) {
      const head = mod(reverse ? -Math.floor(at) : Math.floor(at));
      for (let i = 0; i < n; i++) {
        const behind = reverse ? (i - head + n) % n : (head - i + n) % n;
        const f = 1 - behind / SNAKE_TAIL;
        if (f <= 0) continue;
        out.set(path[i], colour(f, behind));
      }
      return out;
    }
    const head = mod(reverse ? -at : at); // a position between two keys
    for (let i = 0; i < n; i++) {
      const behind = mod(reverse ? i - head : head - i); // how far behind the head this key is, in keys (a fraction)
      let f;
      let hue = behind;
      if (behind < SNAKE_TAIL) f = 1 - behind / SNAKE_TAIL;
      else if (n - behind < 1) {
        f = behind - (n - 1); // the key the head is about to reach: it fades in over the last key before it
        hue = 0;
      } else continue;
      if (f <= 0) continue;
      out.set(path[i], colour(f, hue));
    }
    return out;
  }

  // ------------------------------------------------------------------ frames

  /**
   * One request frame. Refuses any command that is not on the SAFE list, and any chunk that does not fit the frame: sending
   * an over-long frame is what truncates silently and makes a keyboard look like it speaks a different protocol.
   */
  function frame(cmd, { len, offset = 0, last = false, payload = null, size = 64 } = {}) {
    if (!SAFE.has(cmd)) throw new HeError(`Refusing to send command 0x${cmd.toString(16)}: it is not one this app uses.`);
    if (!Number.isInteger(size) || size <= HEAD) throw new HeError(`A ${size}-byte report leaves no room for data.`);
    const n = payload ? payload.length : len;
    if (!Number.isInteger(n) || n < 0 || n > size - HEAD) throw new HeError(`A chunk of ${n} bytes does not fit a ${size}-byte frame.`);
    if (offset < 0 || offset > 0xffff) throw new HeError('The table offset does not fit the frame.');
    const f = new Uint8Array(size);
    f[0] = MAGIC;
    f[1] = cmd;
    f[2] = n;
    f[3] = offset & 0xff;
    f[4] = (offset >> 8) & 0xff;
    f[6] = last ? 1 : 0;
    if (payload) f.set(payload, HEAD);
    return f;
  }

  /** The request frames that read `total` bytes of a table, one per page. */
  function readFrames(cmd, total, size) {
    const page = size - HEAD;
    const out = [];
    for (let off = 0; off < total; off += page) out.push(frame(cmd, { len: Math.min(page, total - off), offset: off, last: off + page >= total, size }));
    return out;
  }

  /** The frames that write `data` as a table, one per page, the last marked. */
  function writeFrames(cmd, data, size) {
    const page = size - HEAD;
    const out = [];
    for (let off = 0; off < data.length; off += page) out.push(frame(cmd, { payload: data.subarray(off, off + page), offset: off, last: off + page >= data.length, size }));
    return out;
  }

  /**
   * The frames that bring a keyboard that holds the table `prev` to the table `data`: the pages that differ, and always the table's
   * last page, which carries the "last" mark. Every frame is one the full write of the table sends too (same page, same offset, same
   * length), only the pages that did not change are left out, so the Snake can send two or three frames a picture instead of 10
   * on the cable and 22 on the dongle. The last page (8 bytes) is sent every time so that each picture still ends the way a whole
   * table does.
   */
  function patchFrames(cmd, data, prev, size) {
    const page = size - HEAD;
    const out = [];
    const lastOff = Math.floor((data.length - 1) / page) * page;
    for (let off = 0; off < data.length; off += page) {
      const end = Math.min(off + page, data.length);
      const last = off === lastOff;
      if (!last && prev && prev.length === data.length && sameBytes(prev.subarray(off, end), data.subarray(off, end))) continue;
      out.push(frame(cmd, { payload: data.subarray(off, end), offset: off, last, size }));
    }
    return out;
  }

  /** True when `back` (a table read from the keyboard) holds, in every page that the frames `sent` wrote, what `data` says. */
  function pagesHeld(back, data, sent, size) {
    if (!back) return false;
    for (const req of sent) {
      const off = req[3] | (req[4] << 8);
      const end = Math.min(off + req[2], back.length); // the keyboard is read back only as far as KEYS_READ
      if (end > off && !sameBytes(back.subarray(off, end), data.subarray(off, end))) return false;
    }
    return true;
  }

  /**
   * The 16-byte lighting block for a lighting state. `mode` overrides the state's own (the per-key page sends mode 20).
   *
   * The layout is the one AULA's own driver writes (checked byte for byte against its capture, all 19 effects):
   *
   *    0 mode   1-3 colour r g b   4 = ff   5-7 = 00   8 colour flag (1 = random colours)   9 brightness   10 speed
   *   11 direction   12-13 = 00   14-15 = aa 55
   *
   * Byte 4 and the last two bytes are not stored: a read of a real F75 HE gives 00 there, also straight after the driver has
   * written ff and aa 55. They are part of what the driver sends, so they are sent, because the driver's write is the only one
   * seen to take effect.
   *
   * `base` is the block the keyboard itself holds (read just before). When it is given, the bytes this app does not
   * understand (5 to 7 and 12 to 13, always 00 so far) stay as the keyboard has them.
   */
  function lightingPayload(l, mode = l.mode, base = null) {
    const off = mode === 0;
    if (off) mode = OFF.mode; // Off goes out as Static in black: the same frame the driver writes for Static, with no light in it
    const e = effect(mode);
    const known = base && base.length >= LIGHT_SIZE && !base.subarray(0, LIGHT_SIZE).every((v) => v === 0);
    const p = new Uint8Array(LIGHT_SIZE);
    if (known) p.set(base.subarray(0, LIGHT_SIZE));
    p[0] = clamp(mode, 0, CUSTOM);
    p[1] = off ? 0 : clamp(l.rgb[0], 0, 255);
    p[2] = off ? 0 : clamp(l.rgb[1], 0, 255);
    p[3] = off ? 0 : clamp(l.rgb[2], 0, 255);
    p[4] = 0xff;
    // 1 = random colours, 0 = the colour above. Effects that always run multicolour, and the per-key table, send 1. Off sends 0:
    // black is the colour above, a random colour would light the keys.
    p[8] = !off && (!e || !e.color || l.colorful) ? 1 : 0;
    p[9] = clamp(l.brightness, 0, BRIGHT_LEVELS);
    p[10] = clamp(l.speed, 0, 5);
    p[11] = e && e.direction ? clamp(l.direction, 0, 1) : 0;
    p[14] = 0xaa;
    p[15] = 0x55;
    return p;
  }

  /** The lighting state in a 16-byte lighting block, or null when it is not a lighting block. */
  function parseLighting(p) {
    if (!p || p.length < LIGHT_SIZE || p.subarray(0, LIGHT_SIZE).every((v) => v === 0)) return null; // an all-zero block is no answer
    let mode = p[0];
    if (mode === 21) mode = 0; // some boards report "off" as 21
    if (mode > CUSTOM) return null;
    if (mode === OFF.mode && p[1] === 0 && p[2] === 0 && p[3] === 0 && p[8] === 0) mode = 0; // Static in black is this app's Off
    const e = effect(mode);
    return {
      mode,
      rgb: [p[1], p[2], p[3]],
      colorful: !!(e && e.color && p[8] === 1), // the flag only means something for an effect that can run in one colour
      brightness: clamp(p[9], 0, BRIGHT_LEVELS),
      speed: clamp(p[10], 0, 5),
      direction: clamp(p[11], 0, 1),
    };
  }

  /** The per-key table: record `key` is [key, r, g, b] at byte key * 4. `colors` maps key index to [r, g, b]; the rest is off. */
  function keyTable(colors) {
    const t = new Uint8Array(KEYS_SIZE);
    for (let i = 0; i < LED_COUNT; i++) {
      t[i * 4] = i;
      const c = colors instanceof Map ? colors.get(i) : colors && colors[i];
      if (c) t.set([clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255)], i * 4 + 1);
    }
    return t;
  }

  /** The colours in a per-key table, as a Map of the lit keys (a record whose colour is black is off). */
  function parseKeyTable(t) {
    const out = new Map();
    if (!t || t.length < KEYS_READ) return out;
    for (let i = 0; i < LED_COUNT && i * 4 + 3 < t.length; i++) {
      const r = t[i * 4 + 1];
      const g = t[i * 4 + 2];
      const b = t[i * 4 + 3];
      if (r || g || b) out.set(i, [r, g, b]);
    }
    return out;
  }

  /** What the 56-byte info block says. Offsets are into the payload, which starts at byte 8 of the reply. */
  function parseInfo(p) {
    if (!p || p.length < 20) return null;
    const v = (p[8] & 0x0f) + (p[8] >> 4) * 10 + p[9] * 100;
    return {
      vid: p[4] | (p[5] << 8),
      pid: p[6] | (p[7] << 8),
      version: v ? `V${(v / 100).toFixed(2)}` : '',
      percent: p[17] >= 1 && p[17] <= 100 ? p[17] : null,
      charging: p[18] === 1 || p[18] === 2,
    };
  }

  /** 'he' when the info names the F75 HE's own ids, 'other' when it names another HFD board, 'unknown' when it says neither. */
  function verdictOf(info) {
    if (!info) return 'unknown';
    if (info.vid === IDENTITY.vid && info.pid === IDENTITY.pid) return 'he';
    return OTHER_HFD.some(([v, p]) => v === info.vid && p === info.pid) ? 'other' : 'unknown';
  }

  // ------------------------------------------------------------------ the keyboard, simulated

  /**
   * A simulated F75 HE at the level of the HID device: it takes the same reports a real one does, answers like the firmware
   * the protocol notes describe, and keeps its lighting block and per-key table in memory. The demo keyboard is one of these,
   * and so is the test double, so both go through exactly the code a real keyboard does. Anything outside SAFE that reaches
   * it is recorded in `unsafe`.
   */
  class SimKeyboard {
    constructor({ frame: size = 64, percent = 78, charging = false, identity = IDENTITY, name = 'AULA F75 HE', answers = true, latencyMs = 0, lighting = DEFAULT_LIGHTING, dropFirst = 0, lightBlock = null, infoBlock = null, keyBlock = null } = {}) {
      this.vendorId = size === 64 ? IDS.cable.vid : IDS.dongle.vid;
      this.productId = size === 64 ? IDS.cable.pid : IDS.dongle.pid;
      this.productName = name;
      this.size = size;
      this.collections = [{ usagePage: size === 64 ? 0xff68 : 0xff60, usage: 0x61, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: size }] }] }];
      this.opened = false;
      this.answers = answers;
      this.latencyMs = latencyMs;
      this.dropNext = dropFirst; // the first frames to leave unanswered, like a keyboard that is still busy
      this.log = []; // [cmd, offset] of every request
      this.unsafe = [];
      this.info = new Uint8Array(INFO_SIZE);
      this.info.set([0x00, 0x00, 0x00, 0x92, identity.vid & 0xff, identity.vid >> 8, identity.pid & 0xff, identity.pid >> 8, 0x53, 0x01, 0, 0, 0x66, 0x01, 0x0c, 0x11, 0x0a]);
      this.setBattery(percent, charging);
      if (infoBlock) this.info.set(infoBlock.subarray(0, INFO_SIZE));
      this.light = lightBlock ? Uint8Array.from(lightBlock) : lightingPayload({ ...lighting, rgb: lighting.rgb.slice() });
      this.keys = keyTable(new Map()); // the keyboard's table is 128 records long; a shorter block (the app reads back 126) fills the start
      if (keyBlock) this.keys.set(keyBlock.subarray(0, KEYS_SIZE));
      this._l = new Set();
    }

    setBattery(percent, charging = false) {
      this.info[17] = percent;
      this.info[18] = charging ? 1 : 0;
    }

    async open() {
      this.opened = true;
    }

    async close() {
      this.opened = false;
    }

    addEventListener(ev, fn) {
      if (ev === 'inputreport') this._l.add(fn);
    }

    removeEventListener(ev, fn) {
      this._l.delete(fn);
    }

    async sendReport(id, data) {
      if (id !== 0) throw new Error('report id 0 only');
      const b = Uint8Array.from(data);
      if (b.length !== this.size) throw new Error(`a report is ${this.size} bytes, not ${b.length}`);
      if (b[0] !== MAGIC) return;
      const cmd = b[1];
      const len = b[2];
      const off = b[3] | (b[4] << 8);
      this.log.push([cmd, off]);
      const table = { [CMD.INFO]: this.info, [CMD.GET_LIGHT]: this.light, [CMD.SET_LIGHT]: this.light, [CMD.GET_KEYS]: this.keys, [CMD.SET_KEYS]: this.keys }[cmd];
      if (!table) {
        this.unsafe.push(cmd);
        return;
      }
      if (this.dropNext > 0) {
        this.dropNext--;
        return;
      }
      if (!this.answers) return;
      const reply = b.slice();
      reply[0] = REPLY;
      if (cmd === CMD.SET_LIGHT || cmd === CMD.SET_KEYS) table.set(b.subarray(HEAD, HEAD + len), off);
      else reply.set(table.subarray(off, off + len), HEAD);
      setTimeout(() => this._l.forEach((fn) => fn({ reportId: 0, data: new DataView(reply.buffer) })), this.latencyMs);
    }
  }

  // ------------------------------------------------------------------ WebHID link

  const toBytes = (v) => (v instanceof Uint8Array ? v.slice() : new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());

  /** The report size the descriptor declares for the vendor collection, or `fallback` where it says nothing. */
  function frameSizeOf(device, fallback) {
    for (const c of device.collections || []) {
      for (const r of c.outputReports || []) {
        const bits = (r.items || []).reduce((n, i) => n + (i.reportSize || 0) * (i.reportCount || 0), 0);
        const bytes = bits / 8;
        if ((r.reportId || 0) === 0 && Number.isInteger(bytes) && bytes > HEAD && bytes <= 64) return bytes;
      }
    }
    return fallback;
  }

  /** One HID interface of the keyboard, talked to one frame at a time. */
  class Link {
    constructor(device, kind, { waitMs = WAIT_MS, tries = TRIES, openMs = OPEN_MS, sendMs = SEND_MS, closeMs = CLOSE_MS } = {}) {
      this.device = device;
      this.kind = kind;
      this.openMs = openMs;
      this.sendMs = sendMs;
      this.closeMs = closeMs;
      this.size = frameSizeOf(device, IDS[kind].frame);
      this.waitMs = waitMs;
      this.tries = tries;
      this.verdict = null; // set by the session once the keyboard has said which one it is
      this.info = null;
      this._inbox = [];
      this._waiters = new Set();
      this._handler = (e) => {
        let d = toBytes(e.data);
        if (d.length === this.size + 1 && d[0] === 0 && d[1] === REPLY) d = d.slice(1); // some stacks keep the report id in front
        this._inbox.push(d);
        if (this._inbox.length > 32) this._inbox.shift(); // notices the keyboard sends on its own must not pile up
        for (const w of [...this._waiters]) w();
      };
    }

    async open() {
      if (!this.device.opened) {
        try {
          await bounded(this.device.open(), this.openMs, `Opening the ${IDS[this.kind].label}`);
        } catch (err) {
          if (!(err && err.name === 'InvalidStateError')) throw new HeError(`Could not open the ${IDS[this.kind].label}. Close the official AULA driver and try again. (${(err && err.message) || err})`);
        }
      }
      this.device.removeEventListener('inputreport', this._handler);
      this.device.addEventListener('inputreport', this._handler);
    }

    async close() {
      try {
        this.device.removeEventListener('inputreport', this._handler);
        if (this.device.opened) await bounded(this.device.close(), this.closeMs, 'Closing the keyboard');
      } catch (_) {
        /* already gone */
      }
    }

    /** Takes the first waiting report that answers `req` (same command and offset), dropping the others (stale echoes, notices). */
    _take(req) {
      const off = req[3] | (req[4] << 8);
      for (let i = 0; i < this._inbox.length; i++) {
        const r = this._inbox[i];
        if (r[0] === REPLY && r[1] === req[1] && (r[3] | (r[4] << 8)) === off) {
          this._inbox.splice(0, i + 1);
          return r;
        }
      }
      return null;
    }

    /** Sends one frame and returns the frame the keyboard answers it with. */
    async transact(req, tries = this.tries) {
      await this.open();
      let last = '';
      for (let attempt = 0; attempt < tries; attempt++) {
        this._inbox.length = 0; // whatever is waiting now is stale
        try {
          await bounded(this.device.sendReport(0, req), this.sendMs, 'Sending to the keyboard');
        } catch (err) {
          throw new HeError(`The ${IDS[this.kind].label} failed: ${(err && err.message) || err}`);
        }
        const reply = await new Promise((resolve) => {
          let done = false;
          const finish = (v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            this._waiters.delete(check);
            resolve(v);
          };
          const check = () => {
            const r = this._take(req);
            if (r) finish(r);
          };
          const timer = setTimeout(() => finish(null), this.waitMs);
          this._waiters.add(check);
          check();
        });
        if (reply) return reply;
        last = `no answer to command 0x${req[1].toString(16)}`;
      }
      throw new HeError(`The keyboard did not answer (${last}). If it is on 2.4G, press a key to wake it; close the official AULA driver if it is open.`, { cmd: req[1] });
    }

    /** Reads `total` bytes of a table. All or nothing: a missing page is an error, never a half-read table. */
    async read(cmd, total, tries = this.tries) {
      const out = new Uint8Array(total);
      for (const req of readFrames(cmd, total, this.size)) {
        const reply = await this.transact(req, tries);
        const off = req[3] | (req[4] << 8);
        out.set(reply.subarray(HEAD, HEAD + req[2]), off);
      }
      return out;
    }

    /** Writes a table page by page, each page acknowledged before the next. */
    async write(cmd, data) {
      for (const req of writeFrames(cmd, data, this.size)) await this.transact(req);
    }

    /** Writes only the pages of `data` that differ from `prev` (what the keyboard holds), see patchFrames. Returns the frames sent. */
    async patch(cmd, data, prev) {
      const reqs = patchFrames(cmd, data, prev, this.size);
      for (const req of reqs) await this.transact(req);
      return reqs;
    }
  }

  // ------------------------------------------------------------------ session

  const STORE_KEY = 'aula.he.v1';

  class HeSession {
    /**
     * @param opts.hid       navigator.hid (or a test double)
     * @param opts.storage   { getItem, setItem }
     * @param opts.waitMs    how long the keyboard is given to answer one frame
     */
    constructor({ hid, storage, waitMs = WAIT_MS, softMs = null, softPartial = true } = {}) {
      this.hid = hid || (typeof navigator !== 'undefined' ? navigator.hid : null) || null;
      this.storage = storage || null;
      this.waitMs = waitMs;
      this.softMs = softMs; // overrides the shortest time between two Snake pictures (the tests use it)
      this.softPartial = softPartial; // false: every Snake picture writes the whole table (the slow way, kept for a keyboard that refuses pages)
      this.softAck = false; // the person has read what the Snake does to the keyboard and said go on
      this._soft = null; // the Snake that is running: { light, t0, minMs, frames, fails, prev, via }
      this.cable = null;
      this.dongle = null;
      this.battery = { percent: null, charging: false, at: 0 };
      this.lighting = { ...DEFAULT_LIGHTING, rgb: DEFAULT_LIGHTING.rgb.slice() };
      this.keyColors = new Map();
      this.settings = {}; // the Hall-effect settings are not driven: nothing to remember
      this.info = null; // what the keyboard said about itself last: { vid, pid, version, ... }
      this.fromKeyboard = false; // true once the lighting shown was read back from the keyboard
      this.busy = false;
      this.last = null; // the result of the last apply
      this.confirmed = new Set(); // 'vid:pid' the person said are an F75 HE although the name does not say so
      this.pending = [];
      this.refused = [];
      this.demo = false;
      this._real = null;
      this._other = new WeakSet(); // interfaces the keyboard itself said are another HE model
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

    /** The link used for writes: the cable when it is plugged in (the receiver has nothing behind it then), else the dongle. */
    get link() {
      return this.cable ? 'cable' : this.dongle ? 'dongle' : null;
    }

    get label() {
      if (this.demo) return 'Demo keyboard';
      return this.cable ? IDS.cable.label : this.dongle ? IDS.dongle.label : null;
    }

    /** Looks for permitted F75 HE interfaces and keeps one link per kind. */
    async scan() {
      if (this.demo) return this.present;
      let list = [];
      try {
        list = this.hid ? await this.hid.getDevices() : [];
      } catch (_) {
        list = [];
      }
      this.pending = []; // receiver interfaces whose name does not say which model they are
      this.refused = []; // ... those whose name is another HE model, or whose own answer was
      const find = (kind) => {
        const id = IDS[kind];
        const hits = list.filter((d) => {
          if (d.vendorId !== id.vid || d.productId !== id.pid) return false;
          const cols = d.collections || [];
          return cols.length === 0 || cols.some((c) => id.pages.includes(c.usagePage) && (c.usage === id.usage || c.usage === undefined));
        });
        for (const d of hits) {
          if (this._other.has(d)) {
            this.refused.push(d); // the keyboard itself said it is another model: refused for as long as it is plugged in
            continue;
          }
          if (kind === 'cable') return d; // the USB-C ids are the F75 HE's own
          const model = P.heModel(d.productName);
          if (model === 'he' || (model === 'unknown' && this.confirmed.has(`${d.vendorId}:${d.productId}`))) return d;
          (model === 'unknown' ? this.pending : this.refused).push(d);
        }
        return null;
      };
      let changed = false;
      for (const kind of ['cable', 'dongle']) {
        const d = find(kind);
        const cur = this[kind];
        // The old link is dropped first and closed in the background: a keyboard that was just unplugged may never finish
        // closing, and the search for it must not wait for that.
        if (d && (!cur || cur.device !== d)) {
          this[kind] = new Link(d, kind, { waitMs: this.waitMs });
          if (cur) cur.close().catch(() => {});
          this.info = null;
          changed = true;
        } else if (!d && cur) {
          this[kind] = null;
          cur.close().catch(() => {});
          changed = true;
        }
      }
      if (changed) this._emit('presence');
      return this.present;
    }

    async disconnect() {
      this._stopSoft();
      if (this.demo) return this.leaveDemo();
      for (const kind of ['cable', 'dongle']) {
        const link = this[kind];
        this[kind] = null;
        if (link) await link.close();
      }
      this.info = null;
      this.fromKeyboard = false;
      this._emit('presence');
    }

    /**
     * Switches to the simulated F75 HE: a USB-C cable and a 2.4G dongle behind the same link code a real keyboard gets. The
     * demo starts from the defaults and keeps its state in memory only; what the app remembers about a real keyboard is not
     * read, changed or overwritten, and is back when the demo ends.
     */
    async enterDemo() {
      if (this.demo) return true;
      this._stopSoft();
      for (const kind of ['cable', 'dongle']) {
        if (this[kind]) await this[kind].close();
        this[kind] = null;
      }
      this._real = { storage: this.storage, lighting: this.lighting, keyColors: this.keyColors, battery: this.battery, last: this.last, info: this.info, fromKeyboard: this.fromKeyboard, confirmed: this.confirmed, pending: this.pending, refused: this.refused };
      this.storage = null;
      this.lighting = { ...DEFAULT_LIGHTING, rgb: DEFAULT_LIGHTING.rgb.slice() };
      this.keyColors = new Map();
      this.battery = { percent: null, charging: false, at: 0 };
      this.last = null;
      this.info = null;
      this.fromKeyboard = false;
      this.pending = [];
      this.refused = [];
      this.demo = true;
      this.cable = new Link(new SimKeyboard({ frame: 64, name: 'AULA F75 HE (demo)' }), 'cable', { waitMs: 400 });
      this.dongle = new Link(new SimKeyboard({ frame: 32, name: 'AULA F75 HE Dongle (demo)', percent: 78 }), 'dongle', { waitMs: 400 });
      this._emit('presence');
      return true;
    }

    async leaveDemo() {
      if (!this.demo) return;
      this._stopSoft();
      const real = this._real;
      for (const kind of ['cable', 'dongle']) if (this[kind]) await this[kind].close();
      this.demo = false;
      this.cable = null;
      this.dongle = null;
      this._real = null;
      if (real) Object.assign(this, real);
      this._emit('presence');
    }

    /** The person says the unnamed devices on the shared receiver ids are an F75 HE. Remembered. */
    async confirmModel() {
      await this.scan();
      for (const d of this.pending) this.confirmed.add(`${d.vendorId}:${d.productId}`);
      this._save();
      return this.scan();
    }

    // ------------------------------------------------------------ what the app remembers

    _clean(patch) {
      const l = { ...this.lighting, ...patch };
      return {
        mode: isSoft(l.mode) ? l.mode : clamp(l.mode, 0, 19),
        rgb: [0, 1, 2].map((i) => clamp(l.rgb[i], 0, 255)),
        colorful: !!l.colorful,
        brightness: clamp(l.brightness, 1, BRIGHT_LEVELS),
        speed: clamp(l.speed, 1, 5),
        direction: clamp(l.direction, 0, 1),
      };
    }

    setLighting(patch) {
      this.lighting = this._clean(patch);
      this._save();
      this._emit('change');
    }

    setSettings() {
      /* the Hall-effect settings are not driven by this app */
    }

    paint(leds, rgb) {
      for (const led of leds) {
        if (rgb) this.keyColors.set(led, [clamp(rgb[0], 0, 255), clamp(rgb[1], 0, 255), clamp(rgb[2], 0, 255)]);
        else this.keyColors.delete(led);
      }
      this._save();
      this._emit('change');
    }

    paintWith(leds, colourOf) {
      for (const led of leds) {
        const rgb = colourOf(led);
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
        if (j.lighting) this.lighting = this._clean({ ...DEFAULT_LIGHTING, ...j.lighting });
        if (Array.isArray(j.confirmed)) for (const id of j.confirmed) if (typeof id === 'string') this.confirmed.add(id);
        this.softAck = j.softAck === true;
        if (Array.isArray(j.keys)) {
          for (const [led, rgb] of j.keys) {
            if (Number.isInteger(led) && led >= 0 && led < LED_COUNT && Array.isArray(rgb) && rgb.length === 3) this.keyColors.set(led, rgb.map((v) => clamp(v, 0, 255)));
          }
        }
      } catch (_) {
        /* unreadable memory: start from the defaults */
      }
    }

    _save() {
      if (!this.storage) return;
      try {
        this.storage.setItem(STORE_KEY, JSON.stringify({ lighting: this.lighting, keys: [...this.keyColors], confirmed: [...this.confirmed], softAck: this.softAck }));
      } catch (_) {
        /* memory full or blocked: the settings simply are not remembered */
      }
    }

    // ------------------------------------------------------------ talking to the keyboard

    /**
     * One thing at a time on the wire. A failure is returned, not thrown. `quiet` jobs do not replace the last result. `silent` jobs
     * (the Snake's pictures, dozens a second) do not announce that the session is busy either: the screen would redraw for each one.
     */
    _run(name, fn, quiet = false, silent = false) {
      const job = this._queue.then(async () => {
        if (!silent) {
          this.busy = true;
          this._emit('busy');
        }
        let result;
        try {
          result = { name, at: Date.now(), ...(await fn()), ok: true };
        } catch (err) {
          result = { name, at: Date.now(), ok: false, error: (err && err.message) || String(err), detail: err && err.detail };
        } finally {
          if (!silent) {
            this.busy = false;
            this._emit('busy');
          }
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

    /**
     * Asks a link what keyboard it is (a read: nothing changes) and keeps the answer. An interface that turns out to be
     * another HFD board (the 2.4G receiver is shared) is let go, so nothing is ever written to it.
     */
    async _identify(link) {
      if (link.verdict && link.info) return link.info;
      return this._readInfo(link);
    }

    /** Reads the info block again (the battery and charging state are in it) and applies the same check. */
    async _readInfo(link, tries) {
      const info = parseInfo(await link.read(CMD.INFO, INFO_SIZE, tries));
      if (!info) throw new HeError('The keyboard answered, but not with a device description this app understands.');
      link.info = info;
      link.verdict = verdictOf(info);
      if (link.verdict === 'other') {
        this._other.add(link.device);
        this.refused.push(link.device);
        const kind = link.kind;
        await link.close();
        if (this[kind] === link) this[kind] = null;
        this._emit('presence');
        throw new HeError(`This is not an F75 HE: it names itself ${hex4(info.vid)}:${hex4(info.pid)}, another AULA Hall-effect model. Nothing was sent to it.`);
      }
      this.info = info;
      return info;
    }

    /** The link a write goes over, once the keyboard has said it is an F75 HE. */
    async _writer() {
      const link = this.cable || this.dongle;
      if (!link) throw new HeError('No F75 HE found.');
      await this._identify(link);
      if (!this[link.kind]) throw new HeError('No F75 HE found.');
      return link;
    }

    /**
     * Reads what the keyboard holds: who it is, its lighting and, when it is showing its per-key table, those colours. What
     * is read replaces what the app remembered. The battery comes from the dongle's own answer.
     */
    sync() {
      return this._run('read', async () => {
        const link = await this._writer();
        // While the Snake runs the keyboard shows per-key colours that this app is writing: reading them back would only replace
        // the colours the person painted with a frame of the snake.
        if (this._soft) return { via: link.kind, confirmed: true, note: 'The Snake is running, so the keyboard was not read.' };
        const light = parseLighting(await link.read(CMD.GET_LIGHT, LIGHT_SIZE));
        let note = `The keyboard answered over ${link.kind === 'cable' ? 'USB-C' : '2.4G'}.`;
        if (light) {
          if (light.mode === CUSTOM && isSoft(this.lighting.mode)) {
            // The app's Snake was the last thing it drew: the keyboard holds the last picture of it, not the person's painting.
            this.lighting = this._clean({ ...this.lighting, brightness: Math.max(1, light.brightness) });
            note += ' It is holding the last picture of the Snake, which this app draws; press Apply to run it again.';
          } else if (light.mode === CUSTOM) {
            this.keyColors = parseKeyTable(await link.read(CMD.GET_KEYS, KEYS_READ));
            this.lighting = this._clean({ ...this.lighting, rgb: light.rgb, colorful: light.colorful, brightness: Math.max(1, light.brightness), speed: Math.max(1, light.speed) });
            note += ' It is showing its per-key colours.';
          } else if (light.mode === 0 && !light.rgb.some(Boolean)) {
            // Off reads back as black; the colour the person had chosen stays, so Static comes back in it
            this.lighting = this._clean({ ...light, rgb: this.lighting.rgb, colorful: this.lighting.colorful, brightness: Math.max(1, light.brightness), speed: Math.max(1, light.speed) });
          } else this.lighting = this._clean({ ...light, brightness: Math.max(1, light.brightness), speed: Math.max(1, light.speed) });
          this.fromKeyboard = true;
          this._save();
          this._emit('change');
        }
        if (link.kind === 'dongle' && this.info && this.info.percent !== null) this._setBattery(this.info);
        return { via: link.kind, confirmed: !!light, note };
      });
    }

    _setBattery(info) {
      this.battery = { percent: info.percent, charging: info.charging, at: Date.now() };
      this._emit('battery');
    }

    /**
     * The lighting block the keyboard holds right now, or null when it cannot be read (the write then falls back to the
     * default layout). A write starts from this block so that the bytes this app does not understand are sent back unchanged.
     */
    async _lightBase(link) {
      try {
        const block = await link.read(CMD.GET_LIGHT, LIGHT_SIZE);
        return parseLighting(block) ? block : null;
      } catch (_) {
        return null;
      }
    }

    applyLighting() {
      if (isSoft(this.lighting.mode)) return this._startSoft();
      this._stopSoft(); // the keyboard is about to be given one of its own effects: this app stops drawing
      return this._run('lighting', async () => {
        const link = await this._writer();
        const base = await this._lightBase(link);
        await link.write(CMD.SET_LIGHT, lightingPayload(this.lighting, this.lighting.mode, base));
        return { via: link.kind, confirmed: true, note: 'The keyboard acknowledged the lighting.' };
      });
    }

    applyKeyColors() {
      this._stopSoft();
      return this._run('per-key colours', async () => {
        const link = await this._writer();
        const base = await this._lightBase(link);
        await link.write(CMD.SET_LIGHT, lightingPayload(this.lighting, CUSTOM, base));
        await link.write(CMD.SET_KEYS, keyTable(this.keyColors));
        return { via: link.kind, confirmed: true, note: link.kind === 'dongle' ? 'The keyboard acknowledged every piece (over 2.4G the table goes in 21 small ones).' : 'The keyboard acknowledged every piece.' };
      });
    }

    applySettings() {
      return this._run('settings', async () => {
        throw new HeError('The F75 HE has no settings in this app yet.');
      });
    }

    /**
     * Reset keyboard: lighting back to the defaults and the per-key colours cleared. No reset command of this keyboard is used
     * (the one the family has wipes everything and is never sent), so this is the same writes as Apply, in one queued job.
     * What the app remembers changes only when the keyboard took the reset.
     */
    factoryReset() {
      this._stopSoft();
      const before = { lighting: this.lighting, keyColors: this.keyColors };
      const lighting = { ...DEFAULT_LIGHTING, rgb: DEFAULT_LIGHTING.rgb.slice() };
      const job = this._run('reset', async () => {
        const link = await this._writer();
        const base = await this._lightBase(link);
        await link.write(CMD.SET_LIGHT, lightingPayload(lighting, CUSTOM, base));
        await link.write(CMD.SET_KEYS, keyTable(new Map()));
        await link.write(CMD.SET_LIGHT, lightingPayload(lighting, lighting.mode, base));
        return { via: link.kind, confirmed: true, note: 'The keyboard acknowledged every step.', skipped: [] };
      });
      this.lighting = lighting;
      this.keyColors = new Map();
      this._save();
      this._emit('change');
      return job.then((res) => {
        if (!res.ok) {
          Object.assign(this, before);
          this._save();
          this._emit('change');
        }
        return res;
      });
    }

    // ------------------------------------------------------------ the Snake (drawn by this app)

    /** True while this app is drawing an effect on the keyboard. */
    get animating() {
      return !!this._soft;
    }

    /** The person has read what the Snake does to the keyboard and said go on. Remembered. */
    ackSoft() {
      this.softAck = true;
      this._save();
    }

    /** Ends the running Snake after the picture being written. Nothing is sent to the keyboard by this: whatever is applied next is. */
    _stopSoft() {
      if (!this._soft) return;
      this._soft = null;
      this._emit('animation');
    }

    /**
     * Puts the keyboard in its per-key lighting mode with the chosen brightness and draws the Snake's first picture, then keeps
     * drawing it. The colour, speed and direction are the ones chosen when Apply was pressed; press Apply again to change them.
     * It stops when another effect is applied, the keyboard goes away, the app closes, or the keyboard stops answering.
     */
    _startSoft() {
      this._stopSoft();
      const soft = { light: { ...this.lighting, rgb: this.lighting.rgb.slice() }, t0: 0, minMs: 0, frames: 0, fails: 0, prev: null, path: snakePath(), partial: this.softPartial, checked: false };
      this._soft = soft;
      this._emit('animation');
      const first = this._run('animation', async () => {
        if (this._soft !== soft) return { via: this.link, confirmed: false, note: 'Stopped before it started.' };
        const link = await this._writer();
        soft.minMs = this.softMs !== null ? this.softMs : SOFT_MIN_MS[link.kind];
        const base = await this._lightBase(link);
        await link.write(CMD.SET_LIGHT, lightingPayload(soft.light, CUSTOM, base));
        soft.t0 = Date.now();
        const table = keyTable(snakeFrame(0, soft.light, soft.path, true));
        await link.write(CMD.SET_KEYS, table);
        soft.prev = table;
        soft.frames = 1;
        return { via: link.kind, confirmed: true, note: 'The Snake is running. It is drawn by this app: it stops when the app closes or another effect is applied.' };
      });
      first.then((res) => {
        if (this._soft !== soft) return;
        if (res.ok) this._softLoop(soft);
        else this._stopSoft();
      });
      return first;
    }

    /** A Snake that could not go on: the person is told why through the last result. */
    _failSoft(soft, error) {
      if (this._soft !== soft) return;
      this._soft = null;
      this.last = { name: 'animation', at: Date.now(), ok: false, error: `The Snake stopped: ${error} The keyboard keeps the last picture it was given.` };
      this._emit('animation');
      this._emit('result');
    }

    /**
     * One picture after another, each only after the keyboard has acknowledged the one before (so nothing piles up on the link when
     * the keyboard is slow, the pace follows its answers). A picture that equals the last one is not sent again. The head moves with
     * the clock, not with the number of pictures, so a slow link makes the snake choppier, never slower.
     *
     * A picture sends only the pages of the table that changed (Link.patch), which is what makes 60 pictures a second possible. The
     * first time, the pages are read back to make sure this keyboard really took them; if it did not, the whole table is sent for
     * the rest of the run. A picture that fails sends the whole table the next time, so no page can stay behind.
     */
    async _softLoop(soft) {
      while (this._soft === soft) {
        const started = Date.now();
        const table = keyTable(snakeFrame((started - soft.t0) / 1000, soft.light, soft.path, true));
        let wait = soft.minMs;
        if (!sameBytes(table, soft.prev)) {
          const prev = soft.prev;
          const res = await this._run('animation', async () => {
            if (this._soft !== soft) return { skipped: true }; // another job was queued behind this one: it goes first
            const link = await this._writer();
            if (soft.partial && prev) {
              const sent = await link.patch(CMD.SET_KEYS, table, prev);
              if (!soft.checked) {
                soft.checked = true;
                if (!pagesHeld(await link.read(CMD.GET_KEYS, KEYS_READ), table, sent, link.size)) {
                  soft.partial = false; // this keyboard did not keep the pages: whole tables from here on
                  await link.write(CMD.SET_KEYS, table);
                }
              }
            } else await link.write(CMD.SET_KEYS, table);
            return { via: link.kind, confirmed: true };
          }, true, true);
          if (this._soft !== soft) return;
          if (res.ok) {
            soft.fails = 0;
            if (!res.skipped) {
              soft.prev = table;
              soft.frames++;
            }
          } else {
            soft.prev = null; // what the keyboard holds is not known any more: the next picture is a whole table
            if (++soft.fails >= SOFT_FAILS) {
              this._failSoft(soft, res.error || 'the keyboard did not answer.');
              return;
            }
            wait = Math.max(wait, 250);
          }
        }
        const left = wait - (Date.now() - started);
        if (left > 0) await sleep(left);
      }
    }

    /** The battery level through the 2.4G dongle (the USB-C link has no battery report). */
    pollBattery() {
      // With the cable plugged in the keyboard runs wired and the receiver has nothing behind it: there is nothing to ask.
      // (The demo's receiver is simulated, so it always answers.)
      if (!this.dongle || (this.cable && !this.demo)) return Promise.resolve(null);
      let percent = null;
      return this._run('battery', async () => {
        const link = this.dongle;
        if (!link) return { via: 'dongle', confirmed: false };
        // The answer comes from the keyboard itself, so it also settles which model is behind the shared receiver.
        const info = await this._readInfo(link, 1);
        if (info.percent !== null) {
          percent = info.percent;
          this._setBattery(info);
        }
        return { via: 'dongle', confirmed: percent !== null };
      }, true).then(() => percent);
    }
  }

  return {
    IDS, IDENTITY, SAFE, CMD, EFFECTS, SOFT_EFFECTS, SNAKE, isSoft, snakePath, snakeFrame, effect, DIRECTIONS, BRIGHT_LEVELS, DEFAULT_LIGHTING, KEYS, GRID, keyLayout, labelOf,
    INFO_SIZE, LIGHT_SIZE, LED_COUNT, KEYS_SIZE, KEYS_READ, CUSTOM,
    frame, readFrames, writeFrames, patchFrames, lightingPayload, parseLighting, keyTable, parseKeyTable, parseInfo, verdictOf, frameSizeOf,
    Link, SimKeyboard, HeSession, HeError,
  };
});
