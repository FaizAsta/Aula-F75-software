/*
 * AULA F75 vendor protocol.
 *
 * Pure functions only: no DOM, no I/O. Works in the renderer (as window.AulaProtocol)
 * and in Node (require), which is how the tests run.
 *
 * Wire format (HID report ID 0x13, 20 bytes including the report ID):
 *   [0]      0x13
 *   [1]      command
 *   [2]      total fragments in this message
 *   [3]      fragment index
 *   [4]      (sub << 4) | payload length (max 14)
 *   [5..18]  payload
 *   [19]     sum of bytes 0..18, modulo 256
 *
 * Derived from public reverse-engineering of the AULA F75 2.4G receiver
 * (USB 3554:FA09, vendor usage page 0xFF02). Offsets inside the config
 * blocks are as documented there; nothing here has been verified against
 * your specific unit, which is why the app reads the block back after every write.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaProtocol = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const REPORT_ID = 0x13;
  const PACKET_LEN = 20;
  const CHUNK = 14;
  const LED_SIZE = 128;

  const CMD = {
    SET_MATRIX: 0x01,
    SET_COLORS: 0x02,
    SET_LED: 0x04,
    SET_RGBTAB: 0x09,
    GET_ONLINE: 0x07,
    GET_MATRIX: 0x41,
    GET_COLORS: 0x42,
    GET_LED: 0x44,
    GET_RGBTAB: 0x49,
    GET_STATUS: 0x4a,
    EVENT: 0x0a,
    SAVE: 0x0a, // host -> keyboard commit; the keyboard's own notifications use the same id
    REALTIME: 0x88,
  };

  /**
   * The USB-C cable does not speak the 20-byte protocol above. It exposes one vendor interface whose only report is a
   * 519-byte FEATURE report with id 0x06 (520 bytes with the id), and nothing is ever pushed to the host. Layout:
   *   [0]    0x06
   *   [1]    command; bit 7 set means "read"
   *   [2..5] address, always 00 00 01 00
   *   [6..7] length of the data that follows, little endian
   *   [8..]  data
   * A read is a SET_FEATURE with the read command, then a GET_FEATURE on the same report id: a GET on its own returns
   * nothing. The three blocks the app works with are the same bytes as over the dongle, only framed differently:
   *   led     128 bytes, ends in 5A A5 (identical to the dongle's lighting block, same offsets)
   *   rgb     the palette table (7 colours per effect)
   *   colors  per-key colours, planar: 126 reds, 126 greens, 126 blues
   * Source: two independent open-source projects that reverse engineered the F75/F87 on this cable
   * (RustamSheoran/aula-f75 and veysiemrah/aula-rgb-controller). The "read" command of `colors` (0x86) is the write
   * command with the read bit set and has not been seen documented; the app treats a failed read of `rgb` or `colors`
   * as "not available over the cable" and carries on with the lighting block alone.
   */
  const FEATURE_ID = 0x06;
  const FEATURE_LEN = 520; // with the report id
  const FEATURE_HEAD = 8;
  const WIRE = {
    led: { read: 0x84, write: 0x04, size: 0x80 },
    rgb: { read: 0x8a, write: 0x0a, size: 0x200 },
    colors: { read: 0x86, write: 0x06, size: 0x17a },
    matrix: { read: 0x83, write: 0x03, size: 0x200, min: 0x80 }, // the key layers (byte 2 of the header is the layer); `size` is the most one holds, `min` the least that is taken for a real layer
  };

  /** Builds one 520-byte feature report. `cmd` is the command byte (read bit included), `size` the length field. */
  function buildFeature(cmd, size, data, sub = 0) {
    const p = new Uint8Array(FEATURE_LEN);
    p[0] = FEATURE_ID;
    p[1] = cmd;
    p[2] = sub; // the layer, for the key matrix; zero for the other blocks
    p[4] = 0x01; // address 00 00 01 00
    p[6] = size & 0xff;
    p[7] = (size >> 8) & 0xff;
    if (data) {
      const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
      if (d.length > FEATURE_LEN - FEATURE_HEAD) throw new RangeError('too much data for one feature report');
      p.set(d, FEATURE_HEAD);
    }
    return p;
  }

  /**
   * Reads what a GET_FEATURE returned. WebHID hands over the report without its id, the Linux tools with it, so both are
   * accepted. Resolves { cmd, size, data } when the header echoes the command that was asked for, otherwise null (what came
   * back is stale, or empty: a GET with no request before it).
   */
  function parseFeature(raw, cmd) {
    if (!raw || raw.length < FEATURE_HEAD - 1) return null;
    let b = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
    if (b.length >= FEATURE_HEAD && b[0] === FEATURE_ID && b[1] === cmd) b = b.subarray(1);
    if (b[0] !== cmd) return null;
    const size = b[5] | (b[6] << 8);
    const have = b.length - (FEATURE_HEAD - 1);
    const n = size > 0 && size <= have ? size : have;
    return { cmd: b[0], size, data: b.slice(FEATURE_HEAD - 1, FEATURE_HEAD - 1 + n) };
  }

  /** The colours a keyboard starts with, used where the cable cannot report the real palette. */
  const DEFAULT_PALETTE = [
    [255, 0, 0],
    [255, 122, 0],
    [255, 212, 0],
    [0, 210, 106],
    [0, 200, 255],
    [60, 60, 255],
    [190, 80, 255],
  ];

  /** Offsets inside the 128-byte LED config block. */
  const OFF = {
    APPLY: 0x09, // set to 1 by the firmware once it has applied a config; a write that still carries 1 is ignored
    CUSTOM: 0x09, // old name for the same byte
    MODE: 0x0a,
    KNOB: 0x0b, // what the knob does (0 = lighting, 1 = volume). Set by holding the knob, so it belongs to the keyboard, not to the app
    COLOR_MODE: 0x0c, // 1 = use the palette / multicolour the config selects, 3 = firmware defaults
    SLEEP: 0x18,
    SLOTS: 0x3a,
  };
  const MODE_CUSTOM = 21;
  const MODE_OFF = 0;
  const LEVEL_MAX = 4; // speed runs 0..4, and brightness did in every version before 1.4.2
  // The keyboard's own brightness keys can go higher than 4 on some units, so the app reads and writes brightness up to
  // this many levels. How many levels a given keyboard really has is learned from it (see Session.brightMax).
  const BRIGHT_CAP = 9;
  const PALETTE_SLOTS = 7; // colour indices 0..6 are palette entries, 7 means multicolour
  const MULTICOLOR = 7;

  /**
   * Known USB identifiers. The first two speak the protocol this file implements (the F75, F75 Pro and F87 share both
   * ids). The other two belong to a different family, built on other silicon, whose protocol lives in max.js: the F75 Max
   * uses them, but so do other AULA keyboards (S98 Pro, L99, F108 Pro ...) whose commands may differ, so a device on
   * these ids is only treated as an F75 Max after its USB product name says so (see maxModel).
   */
  const DEVICES = [
    { id: 'dongle', vid: 0x3554, pid: 0xfa09, label: '2.4G dongle', link: 'dongle', family: 'f75', supported: true },
    { id: 'wired', vid: 0x258a, pid: 0x010c, label: 'USB-C cable', link: 'wired', family: 'f75', supported: true },
    { id: 'max-wired', vid: 0x0c45, pid: 0x800a, label: 'AULA F75 Max, USB-C (0c45:800a)', link: 'wired', family: 'max', supported: true },
    { id: 'max-dongle', vid: 0x05ac, pid: 0x024f, label: 'AULA F75 Max, 2.4G dongle (05ac:024f)', link: 'dongle', family: 'max', supported: true },
  ];

  const MAX_NAME = /f75\s*-?\s*max/i;
  const OTHER_NAME = /s98|l99|f108|f99|f2088|sc620|s75|h108/i;

  /**
   * What a device on the F75 Max's ids says it is: 'max' (its product name is the F75 Max), 'other' (the name of another
   * AULA model that shares these ids and is not driven by this app) or 'unknown' (a name that says neither way: the app
   * asks the person before writing anything).
   */
  const maxModel = (name) => {
    const n = String(name || '');
    return MAX_NAME.test(n) ? 'max' : OTHER_NAME.test(n) ? 'other' : 'unknown';
  };

  const deviceFor = (vid, pid) => DEVICES.find((d) => d.vid === vid && d.pid === pid) || null;

  /**
   * Firmware effects on the F75. `slot` is the position in the per-effect table
   * (modes 9, 14 and 18 exist in the table but are not present on this keyboard).
   */
  const EFFECTS = [
    { mode: 1, name: 'Static', speed: false, color: true, multi: false },
    { mode: 2, name: 'Breathing', speed: true, color: true, multi: true },
    { mode: 3, name: 'Rainbow', speed: true, color: false, multi: false },
    { mode: 4, name: 'Flash away', speed: true, color: true, multi: true },
    { mode: 5, name: 'Raindrops', speed: true, color: true, multi: true },
    { mode: 6, name: 'Rainbow wheel', speed: true, color: true, multi: true },
    { mode: 7, name: 'Ripples', speed: true, color: true, multi: true },
    { mode: 8, name: 'Twinkling stars', speed: true, color: true, multi: true },
    { mode: 10, name: 'Snake', speed: true, color: true, multi: true },
    { mode: 11, name: 'Neon stream', speed: true, color: true, multi: true },
    { mode: 12, name: 'Reactive', speed: true, color: true, multi: true },
    { mode: 13, name: 'Sine wave', speed: true, color: true, multi: true },
    { mode: 15, name: 'Windmill', speed: true, color: false, multi: false },
    { mode: 16, name: 'Color waterfall', speed: true, color: false, multi: false },
    { mode: 17, name: 'Blossom', speed: true, color: false, multi: false },
    { mode: 21, name: 'Per-key', speed: false, color: false, multi: false, custom: true },
  ].map((e) => ({
    ...e,
    slot: e.mode === MODE_CUSTOM ? 18 : e.mode - 1,
    // These effects always run multicolour; the firmware has no single-colour version of them.
    colorful: !e.custom && !e.color && e.multi === false,
  }));

  const EFFECT_OFF = { mode: MODE_OFF, name: 'Off', speed: false, color: false, multi: false, slot: -1, off: true };

  const effectOf = (mode) => (mode === MODE_OFF ? EFFECT_OFF : EFFECTS.find((e) => e.mode === mode) || null);

  /** Sleep timeout choices as [seconds, raw value]; the raw value is seconds / 30. */
  const SLEEP_OPTIONS = [60, 90, 120, 180, 240, 300, 600, 900, 1200].map((s) => ({ seconds: s, value: s / 30 }));

  // ---------------------------------------------------------------- packets

  function checksum(p) {
    let s = 0;
    for (let i = 0; i < 19; i++) s += p[i];
    return s & 0xff;
  }

  function buildPacket(cmd, total, idx, subLen, data) {
    const p = new Uint8Array(PACKET_LEN);
    p[0] = REPORT_ID;
    p[1] = cmd;
    p[2] = total;
    p[3] = idx;
    p[4] = subLen;
    if (data) {
      const d = data instanceof Uint8Array ? data : Uint8Array.from(data);
      p.set(d.subarray(0, CHUNK), 5);
    }
    p[19] = checksum(p);
    return p;
  }

  /** Turns whatever the HID layer hands over into a 20-byte packet with the report ID in front. */
  function normalizeInput(raw) {
    let b;
    if (raw instanceof Uint8Array) b = raw;
    else if (raw && raw.buffer instanceof ArrayBuffer && typeof raw.byteLength === 'number') {
      b = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength);
    } else if (raw instanceof ArrayBuffer) b = new Uint8Array(raw);
    else if (Array.isArray(raw)) b = Uint8Array.from(raw);
    else return null;

    const out = new Uint8Array(PACKET_LEN);
    if (b.length === PACKET_LEN && b[0] === REPORT_ID) out.set(b);
    else if (b.length === PACKET_LEN - 1) {
      out[0] = REPORT_ID;
      out.set(b, 1);
    } else return null;
    return out;
  }

  function parseFragment(r) {
    const len = Math.min(r[4] & 0x0f, CHUNK);
    return {
      cmd: r[1] & 0x7f,
      error: !!((r[1] & 0x80) || (r[2] & 0x80)),
      total: r[2] & 0x7f,
      idx: r[3],
      sub: r[4] >> 4,
      len,
      data: r.slice(5, 5 + len),
    };
  }

  function splitChunks(data) {
    const out = [];
    for (let i = 0; i < data.length; i += CHUNK) out.push(data.subarray(i, i + CHUNK));
    return out;
  }

  function joinParts(parts, total) {
    let n = 0;
    for (let k = 0; k < total; k++) n += parts.get(k).length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let k = 0; k < total; k++) {
      out.set(parts.get(k), o);
      o += parts.get(k).length;
    }
    return out;
  }

  // ------------------------------------------------------------ LED config

  const isValidLed = (led) => !!led && led.length >= LED_SIZE && led[0x7e] === 0x5a && led[0x7f] === 0xa5;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const slotByte = (slot, i) => OFF.SLOTS + 2 * slot + i;

  const getMode = (led) => led[OFF.MODE];

  /** Changes only the effect number. The apply flag is handled when writing (see prepareLedForWrite). */
  function setMode(led, mode) {
    led[OFF.MODE] = mode;
  }

  /** The brightness level stored for the effect: 0..BRIGHT_CAP. A byte that is not a level at all reads as the old full level. */
  function getBrightness(led, effect) {
    if (!effect || effect.slot < 0) return 0;
    const v = led[slotByte(effect.slot, 0)];
    return v <= BRIGHT_CAP ? v : LEVEL_MAX;
  }

  function setBrightness(led, effect, v) {
    if (effect && effect.slot >= 0) led[slotByte(effect.slot, 0)] = clamp(Math.round(v), 0, BRIGHT_CAP);
  }

  function getSpeed(led, effect) {
    return effect && effect.slot >= 0 ? clamp(led[slotByte(effect.slot, 1)] >> 4, 0, LEVEL_MAX) : 0;
  }

  function setSpeed(led, effect, v) {
    if (!effect || effect.slot < 0) return;
    const o = slotByte(effect.slot, 1);
    led[o] = (clamp(Math.round(v), 0, LEVEL_MAX) << 4) | (led[o] & 0x0f);
  }

  /** 0..6 selects a palette entry, 7 means multicolour. */
  function getColorIndex(led, effect) {
    return effect && effect.slot >= 0 ? led[slotByte(effect.slot, 1)] & 0x0f : 0;
  }

  function setColorIndex(led, effect, idx) {
    if (!effect || effect.slot < 0) return;
    const o = slotByte(effect.slot, 1);
    led[o] = (led[o] & 0xf0) | clamp(Math.round(idx), 0, MULTICOLOR);
  }

  /**
   * The colour index the keyboard will really use for this effect. Effects that only exist in
   * multicolour always run it, and single-colour-only effects cannot run multicolour, whatever
   * stale value is sitting in their slot.
   */
  function effectiveColorIndex(led, effect) {
    if (!effect || effect.slot < 0) return 0;
    if (effect.colorful) return MULTICOLOR;
    const i = getColorIndex(led, effect);
    return !effect.multi && i === MULTICOLOR ? 0 : i;
  }

  /** Writes effectiveColorIndex back into the slot so the keyboard and the preview agree. */
  function settleColor(led, effect) {
    if (!effect || effect.slot < 0 || effect.custom) return;
    setColorIndex(led, effect, effectiveColorIndex(led, effect));
  }

  /**
   * Copy of a config block ready to send. Taken from the OEM driver's captured sequence:
   * the apply flag must be 0 (the keyboard ignores a config that still says "applied"), and the
   * colour-mode byte must be 1 so the palette and multicolour choices are honoured.
   */
  function prepareLedForWrite(led, effect, opts = {}) {
    const out = led.slice();
    out[OFF.APPLY] = 0;
    // The colour-mode byte and the colour slot are only touched when the edit is about colour or the effect. A change of
    // brightness, speed or sleep time leaves them exactly as the keyboard has them.
    if (opts.colour !== false) {
      out[OFF.COLOR_MODE] = 1;
      settleColor(out, effect);
    }
    return out;
  }

  /** True when the edit from `before` to `after` changes the effect or a colour choice (not just brightness, speed or sleep). */
  function editsColour(before, after) {
    if (!before || !after || before.length !== after.length) return true;
    if (before[OFF.MODE] !== after[OFF.MODE]) return true;
    for (let i = OFF.SLOTS + 1; i < OFF.SLOTS + 2 * 19; i += 2) if ((before[i] ^ after[i]) & 0x0f) return true;
    return false;
  }

  /**
   * A remembered copy of the lighting block with the bytes that belong to the keyboard taken from the keyboard's own
   * block instead. The knob function is chosen on the keyboard (hold the knob), so an older copy must never put it back.
   */
  function keepLedFor(remembered, live) {
    const out = remembered.slice();
    if (live && live.length === out.length) out[OFF.KNOB] = live[OFF.KNOB];
    return out;
  }

  /** Compares two config blocks while ignoring the apply flag, which the firmware sets itself. */
  function sameLed(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (i !== OFF.APPLY && a[i] !== b[i]) return false;
    return true;
  }

  /** The commit packet the OEM driver sends after the config and palette writes. */
  const buildSave = () => buildPacket(CMD.SAVE, 1, 0, 4, [0x07]);

  const getSleepValue = (led) => led[OFF.SLEEP];
  const setSleepValue = (led, v) => {
    led[OFF.SLEEP] = clamp(Math.round(v), 0, 255);
  };

  // --------------------------------------------------------------- palette

  /** The palette table holds 7 RGB entries (21 bytes) per effect slot, after a 21-byte header. */
  const palOffset = (slot, j) => (slot + 1) * 21 + j * 3;

  function getPaletteColor(rgb, effect, j) {
    const o = palOffset(effect.slot, j);
    if (!rgb || o + 2 >= rgb.length) return [0, 0, 0];
    return [rgb[o], rgb[o + 1], rgb[o + 2]];
  }

  function setPaletteColor(rgb, effect, j, c) {
    const o = palOffset(effect.slot, j);
    if (!rgb || o + 2 >= rgb.length) return false;
    rgb[o] = clamp(c[0] | 0, 0, 255);
    rgb[o + 1] = clamp(c[1] | 0, 0, 255);
    rgb[o + 2] = clamp(c[2] | 0, 0, 255);
    return true;
  }

  // ----------------------------------------------------------- per-key RGB

  /**
   * Per-key colours are planar: N reds, then N greens, then N blues. AULA's driver lays them out as three planes of 126
   * lights, and the dongle's block is those 378 bytes padded to MatrixLen x 3 = 384. Reading the 384 as 128 planes would
   * shift green two keys and blue four, so any block from 378 to 384 bytes has planes of 126; other sizes (the cable's
   * 378, a simulated keyboard's own) are simply length / 3.
   */
  const COLOR_LIGHTS = 126;
  const ledCount = (colors) => (colors.length >= COLOR_LIGHTS * 3 && colors.length <= 128 * 3 ? COLOR_LIGHTS : Math.floor(colors.length / 3));

  function getKeyColor(colors, led) {
    const n = ledCount(colors);
    if (led < 0 || led >= n) return [0, 0, 0];
    return [colors[led], colors[n + led], colors[2 * n + led]];
  }

  function setKeyColor(colors, led, c) {
    const n = ledCount(colors);
    if (led < 0 || led >= n) return false;
    colors[led] = clamp(c[0] | 0, 0, 255);
    colors[n + led] = clamp(c[1] | 0, 0, 255);
    colors[2 * n + led] = clamp(c[2] | 0, 0, 255);
    return true;
  }

  // --------------------------------------------------------------- battery

  /** GET_STATUS answers with the battery percentage in the first byte. */
  function parseBattery(data) {
    if (!data || !data.length) return null;
    return data[0] <= 100 ? data[0] : null;
  }

  // ----------------------------------------------------------------- misc

  const same = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  const rgbToHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

  /** h in 0..1 (wraps), s and v in 0..1. Returns [r,g,b] in 0..255. */
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const [r, g, b] = [
      [v, t, p],
      [q, v, p],
      [p, v, t],
      [p, q, v],
      [t, p, v],
      [v, p, q],
    ][i % 6];
    return [r * 255, g * 255, b * 255];
  }

  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  /**
   * The palette the F75 ships with, as read from one over the dongle: red, green, blue, yellow, magenta, cyan, white.
   * Used as the stand-in where the cable does not hand over the real table; it is only ever shown, never written back
   * unless the user asks for a palette change.
   */
  const FACTORY_PALETTE = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];

  /** A palette table with the factory colours in every effect slot (20 slots of 21 bytes). */
  function defaultRgb() {
    const t = new Uint8Array(21 * 20);
    for (let slot = 0; slot < 19; slot++) FACTORY_PALETTE.forEach((c, j) => t.set(c, palOffset(slot, j)));
    return t;
  }

  /** All keys off, for `n` lights (the cable's per-key table holds 126). */
  const defaultColors = (n = 126) => new Uint8Array(n * 3);

  return {
    FEATURE_ID, FEATURE_LEN, FEATURE_HEAD, WIRE, buildFeature, parseFeature, DEFAULT_PALETTE, defaultRgb, defaultColors,
    REPORT_ID, PACKET_LEN, CHUNK, LED_SIZE, CMD, OFF, MODE_CUSTOM, MODE_OFF, LEVEL_MAX, BRIGHT_CAP, PALETTE_SLOTS, MULTICOLOR,
    DEVICES, deviceFor, maxModel, EFFECTS, EFFECT_OFF, effectOf, SLEEP_OPTIONS,
    checksum, buildPacket, normalizeInput, parseFragment, splitChunks, joinParts,
    isValidLed, slotByte, getMode, setMode, getBrightness, setBrightness, getSpeed, setSpeed,
    getColorIndex, setColorIndex, effectiveColorIndex, settleColor, prepareLedForWrite, editsColour, keepLedFor, sameLed, buildSave,
    getSleepValue, setSleepValue,
    palOffset, getPaletteColor, setPaletteColor, ledCount, getKeyColor, setKeyColor,
    parseBattery, same, hexToRgb, rgbToHex, hsv, mix, clamp,
  };
});
