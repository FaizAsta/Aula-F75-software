/*
 * Key assignment: what a key does, as the keyboard stores it.
 *
 * Pure functions only: no DOM, no I/O. Works in the renderer (as window.AulaKeys) and in Node (require).
 *
 * The keyboard keeps its key matrix as layers of (normally) 512 bytes, four bytes per key, and the key whose LED index is n lives
 * at bytes 4n..4n+3 of its layer. Some keyboards send a shorter layer; that is accepted as long as it holds every key of the layout (the layout's `led` is that index). Layer 0 is the normal layer, layer 1 is what the
 * keys do while Fn is held. A key's four bytes, as recovered from AULA's own Windows driver (TonyRice/aula-f75-linux,
 * docs/PROTOCOL.md) and from the other public notes the README credits:
 *
 *   keyboard   [0x00, modifiers, 0x00, HID usage]     a key, a modifier on its own (usage 0), or both (a combination)
 *   consumer   [0x02, 0x00, usage hi, usage lo]        media keys (Play/Pause is 02 00 00 cd)
 *   macro      [0x03, mode, count, macro index]        read and shown here, never written
 *   Fn         [0x0d, 0x00, 0x00, 0x00]                the Fn key itself; overwriting it locks the layer, so it is protected
 *
 * Nothing here has been checked against your specific unit. The app writes a layer back only after reading it, changes
 * nothing but the keys you edit, reads it again to see that the keyboard kept it, and keeps the original for Restore.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaKeys = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LAYER_SIZE = 512; // MatrixLen (128) x 4 bytes
  const CODE_LEN = 4;
  const LAYERS = [
    { id: 0, name: 'Default', hint: 'What the key does on its own.' },
    { id: 1, name: 'FN1', hint: 'What the key does while you hold Fn.' },
  ];

  // ------------------------------------------------------------ modifiers
  const MODS = [
    { bit: 0x01, name: 'Left Ctrl', short: 'LCtrl' },
    { bit: 0x02, name: 'Left Shift', short: 'LShift' },
    { bit: 0x04, name: 'Left Alt', short: 'LAlt' },
    { bit: 0x08, name: 'Left Win', short: 'LWin' },
    { bit: 0x10, name: 'Right Ctrl', short: 'RCtrl' },
    { bit: 0x20, name: 'Right Shift', short: 'RShift' },
    { bit: 0x40, name: 'Right Alt', short: 'RAlt' },
    { bit: 0x80, name: 'Right Win', short: 'RWin' },
  ];

  // ------------------------------------------------------------ keyboard usages (HID usage page 0x07)
  const NAMES = new Map(); // usage -> { name, short }
  const def = (usage, name, short) => NAMES.set(usage, { name, short: short || name });

  for (let i = 0; i < 26; i++) def(0x04 + i, String.fromCharCode(65 + i));
  '1234567890'.split('').forEach((c, i) => def(0x1e + i, c));
  def(0x28, 'Enter');
  def(0x29, 'Esc');
  def(0x2a, 'Backspace', 'Bksp');
  def(0x2b, 'Tab');
  def(0x2c, 'Space');
  def(0x2d, '-');
  def(0x2e, '=');
  def(0x2f, '[');
  def(0x30, ']');
  def(0x31, '\\');
  def(0x33, ';');
  def(0x34, "'");
  def(0x35, '`');
  def(0x36, ',');
  def(0x37, '.');
  def(0x38, '/');
  def(0x39, 'Caps Lock', 'Caps');
  for (let i = 0; i < 12; i++) def(0x3a + i, `F${i + 1}`);
  def(0x46, 'Print Screen', 'PrtSc');
  def(0x47, 'Scroll Lock', 'ScrLk');
  def(0x48, 'Pause');
  def(0x49, 'Insert', 'Ins');
  def(0x4a, 'Home');
  def(0x4b, 'Page Up', 'PgUp');
  def(0x4c, 'Delete', 'Del');
  def(0x4d, 'End');
  def(0x4e, 'Page Down', 'PgDn');
  def(0x4f, 'Right Arrow', 'Right');
  def(0x50, 'Left Arrow', 'Left');
  def(0x51, 'Down Arrow', 'Down');
  def(0x52, 'Up Arrow', 'Up');
  def(0x53, 'Num Lock', 'NumLk');
  def(0x54, 'Keypad /', 'Num /');
  def(0x55, 'Keypad *', 'Num *');
  def(0x56, 'Keypad -', 'Num -');
  def(0x57, 'Keypad +', 'Num +');
  def(0x58, 'Keypad Enter', 'Num Ent');
  for (let i = 0; i < 9; i++) def(0x59 + i, `Keypad ${i + 1}`, `Num ${i + 1}`);
  def(0x62, 'Keypad 0', 'Num 0');
  def(0x63, 'Keypad .', 'Num .');
  def(0x64, 'ISO \\', '\\');
  def(0x65, 'Menu');
  for (let i = 0; i < 12; i++) def(0x68 + i, `F${i + 13}`);

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  /** The palette's key groups, in the order the Keys tab shows them. */
  const GROUPS = [
    { id: 'letters', name: 'Letters', usages: range(0x04, 0x1d) },
    { id: 'numbers', name: 'Numbers', usages: range(0x1e, 0x27) },
    { id: 'symbols', name: 'Symbols', usages: [0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38] },
    { id: 'editing', name: 'Editing', usages: [0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x39, 0x49, 0x4c, 0x65] },
    { id: 'nav', name: 'Navigation', usages: [0x4a, 0x4d, 0x4b, 0x4e, 0x52, 0x51, 0x50, 0x4f, 0x46, 0x47, 0x48] },
    { id: 'fkeys', name: 'F1 to F24', usages: [...range(0x3a, 0x45), ...range(0x68, 0x73)] },
    { id: 'keypad', name: 'Keypad', usages: [0x53, 0x54, 0x55, 0x56, 0x57, 0x58, ...range(0x59, 0x63)] },
  ];

  // ------------------------------------------------------------ consumer usages (media keys)
  const MEDIA = [
    { usage: 0x00cd, name: 'Play / Pause', short: 'Play' },
    { usage: 0x00b5, name: 'Next track', short: 'Next' },
    { usage: 0x00b6, name: 'Previous track', short: 'Prev' },
    { usage: 0x00b7, name: 'Stop', short: 'Stop' },
    { usage: 0x00e2, name: 'Mute', short: 'Mute' },
    { usage: 0x00e9, name: 'Volume up', short: 'Vol +' },
    { usage: 0x00ea, name: 'Volume down', short: 'Vol -' },
    { usage: 0x006f, name: 'Brightness up', short: 'Br +' },
    { usage: 0x0070, name: 'Brightness down', short: 'Br -' },
    { usage: 0x0183, name: 'Media player', short: 'Media' },
    { usage: 0x018a, name: 'Email', short: 'Mail' },
    { usage: 0x0192, name: 'Calculator', short: 'Calc' },
    { usage: 0x0194, name: 'My Computer', short: 'PC' },
    { usage: 0x0221, name: 'Web search', short: 'Search' },
    { usage: 0x0223, name: 'Web home', short: 'Web' },
    { usage: 0x0224, name: 'Web back', short: 'Back' },
    { usage: 0x0225, name: 'Web forward', short: 'Fwd' },
    { usage: 0x0227, name: 'Web refresh', short: 'Reload' },
  ];
  const MEDIA_BY = new Map(MEDIA.map((m) => [m.usage, m]));

  // ------------------------------------------------------------ decoding and encoding
  const modNames = (mods) => MODS.filter((m) => mods & m.bit);

  /**
   * What four bytes mean. `protected` is true for anything this app will not overwrite: the Fn key and codes it does
   * not recognise (an unknown code is more likely a firmware function than a key).
   */
  function decode(b) {
    const t = b[0];
    const none = { kind: 'none', label: 'Not set', short: '', protected: false };
    if (t === 0x00) {
      const mods = b[1];
      const usage = b[3];
      if (b[2] !== 0) return unknown(b);
      if (!mods && !usage) return none;
      if (usage && !NAMES.has(usage)) return unknown(b);
      if (!usage) {
        const ms = modNames(mods);
        return { kind: 'mods', mods, label: ms.map((m) => m.name).join(' + '), short: ms.map((m) => m.short).join('+'), protected: false };
      }
      const n = NAMES.get(usage);
      if (!mods) return { kind: 'key', usage, label: n.name, short: n.short, protected: false };
      const ms = modNames(mods);
      return {
        kind: 'combo',
        mods,
        usage,
        label: `${ms.map((m) => m.name).join(' + ')} + ${n.name}`,
        short: `${ms.map((m) => m.short.replace(/^[LR]/, '')).join('+')}+${n.short}`,
        protected: false,
      };
    }
    if (t === 0x02 && b[1] === 0) {
      const usage = (b[2] << 8) | b[3];
      const m = MEDIA_BY.get(usage);
      if (m) return { kind: 'media', usage, label: m.name, short: m.short, protected: false };
      return unknown(b);
    }
    if (t === 0x03) return { kind: 'macro', mode: b[1], count: b[2], index: b[3], label: `Macro ${b[3] + 1}`, short: `M${b[3] + 1}`, protected: false };
    if (t === 0x0d && !b[1] && !b[2] && !b[3]) return { kind: 'fn', label: 'Fn', short: 'Fn', protected: true };
    return unknown(b);
  }

  function unknown(b) {
    const hex = Array.from(b.slice(0, 4), (v) => v.toString(16).padStart(2, '0')).join(' ');
    return { kind: 'unknown', label: `Special key (${hex})`, short: '?', protected: true };
  }

  /** Four bytes for { kind: 'none' | 'key' | 'mods' | 'combo' | 'media', usage?, mods? }. Throws on anything it cannot write. */
  function encode(spec) {
    const k = spec && spec.kind;
    if (k === 'none') return Uint8Array.of(0, 0, 0, 0);
    if (k === 'key') {
      if (!NAMES.has(spec.usage)) throw new RangeError(`unknown key usage 0x${Number(spec.usage).toString(16)}`);
      return Uint8Array.of(0, 0, 0, spec.usage);
    }
    if (k === 'mods') {
      if (!Number.isInteger(spec.mods) || spec.mods <= 0 || spec.mods > 0xff) throw new RangeError('no modifier chosen');
      return Uint8Array.of(0, spec.mods, 0, 0);
    }
    if (k === 'combo') {
      if (!NAMES.has(spec.usage)) throw new RangeError(`unknown key usage 0x${Number(spec.usage).toString(16)}`);
      if (!Number.isInteger(spec.mods) || spec.mods < 0 || spec.mods > 0xff) throw new RangeError('bad modifiers');
      return Uint8Array.of(0, spec.mods, 0, spec.usage);
    }
    if (k === 'media') {
      if (!MEDIA_BY.has(spec.usage)) throw new RangeError(`unknown media usage 0x${Number(spec.usage).toString(16)}`);
      return Uint8Array.of(0x02, 0, spec.usage >> 8, spec.usage & 0xff);
    }
    throw new RangeError(`cannot write a key of kind ${k}`);
  }

  // ------------------------------------------------------------ whole layers
  const offset = (led) => led * CODE_LEN;
  const hasKey = (block, led) => !!block && led >= 0 && offset(led) + CODE_LEN <= block.length;

  function codeAt(block, led) {
    if (!hasKey(block, led)) return Uint8Array.of(0, 0, 0, 0);
    return block.slice(offset(led), offset(led) + CODE_LEN);
  }

  /** A copy of the layer with one key's four bytes replaced. Every other byte, including any trailing flag, is kept. */
  function withCode(block, led, code) {
    if (!hasKey(block, led)) throw new RangeError(`key ${led} is outside the layer`);
    if (!code || code.length !== CODE_LEN) throw new RangeError('a key code is four bytes');
    const out = block.slice();
    out.set(code, offset(led));
    return out;
  }

  const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

  /** The leds whose four bytes differ between two layers. */
  function changedKeys(a, b) {
    const out = [];
    const n = Math.min(a.length, b.length) >> 2;
    for (let led = 0; led < n; led++) if (!sameBytes(codeAt(a, led), codeAt(b, led))) out.push(led);
    return out;
  }

  /**
   * How many bytes a layer needs for every key of the layout to sit inside it. Keyboards do not all send the same
   * length (the vendor's notes say 512, MatrixLen x 4, but not every model or firmware does), so a layer is judged by
   * whether it holds the layout's keys, not by being exactly 512 bytes.
   */
  function neededBytes(keys) {
    const top = keys.reduce((m, k) => Math.max(m, k.led), -1);
    return (top + 1) * CODE_LEN;
  }

  /**
   * The share (0..1) of the layout's keys whose four bytes decode to something this app knows: a key, a modifier, a
   * media key, a macro, Fn or nothing. A layer read at the wrong alignment decodes mostly to codes nobody knows.
   */
  function knownShare(block, keys) {
    if (!keys.length) return 0;
    let known = 0;
    for (const k of keys) if (decode(codeAt(block, k.led)).kind !== 'unknown') known++;
    return known / keys.length;
  }

  /**
   * Does this look like the normal layer of the keyboard the layout describes? It must hold every key of the layout,
   * and Esc reads as Esc, or the Fn key sits where the layout says it does. A layer that fails is never written: the
   * indexing may not be what this app assumes. A layer shorter than the usual 512 bytes has to pass a stricter test
   * too, because there the length itself is unexpected: nearly every key must decode to something known.
   */
  function looksLikeBaseLayer(block, keys) {
    if (!block || block.length < neededBytes(keys)) return false;
    const esc = keys.find((k) => k.n === 'Esc');
    const fn = keys.find((k) => k.n === 'Fn');
    const escOk = !!esc && sameBytes(codeAt(block, esc.led), Uint8Array.of(0, 0, 0, 0x29));
    const fnOk = !!fn && codeAt(block, fn.led)[0] === 0x0d;
    if (!(escOk || fnOk)) return false;
    if (block.length < LAYER_SIZE && knownShare(block, keys) < 0.9) return false;
    return true;
  }

  // ------------------------------------------------------------ factory-like layers, for the demo keyboard and tests
  const LABEL_USAGE = {
    Esc: 0x29, Tab: 0x2b, Caps: 0x39, Space: 0x2c, Enter: 0x28, Backspace: 0x2a, Del: 0x4c, Ins: 0x49, Home: 0x4a, End: 0x4d,
    PgUp: 0x4b, PgDn: 0x4e, Up: 0x52, Down: 0x51, Left: 0x50, Right: 0x4f, PrtSc: 0x46, ScrLk: 0x47, Pause: 0x48, Menu: 0x65,
    '`': 0x35, '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34, ',': 0x36, '.': 0x37, '/': 0x38,
  };
  const MOD_LABEL = { Ctrl: [0x01, 0x10], Shift: [0x02, 0x20], Alt: [0x04, 0x40], Win: [0x08, 0x80] };

  /** A believable layer for `keys` (layout keys): normal keys on layer 0, a few media keys on layer 1. */
  function defaultLayer(layer, keys) {
    const out = new Uint8Array(LAYER_SIZE);
    out.set([0x00, 0x00, 0x5a, 0xa5], LAYER_SIZE - 4);
    const seen = {};
    const byX = [...keys].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const k of byX) {
      let code = Uint8Array.of(0, 0, 0, 0);
      if (layer === 0) {
        if (/^[A-Z]$/.test(k.n)) code = encode({ kind: 'key', usage: 0x04 + k.n.charCodeAt(0) - 65 });
        else if (/^[1-9]$/.test(k.n)) code = encode({ kind: 'key', usage: 0x1e + Number(k.n) - 1 });
        else if (k.n === '0') code = encode({ kind: 'key', usage: 0x27 });
        else if (/^F\d+$/.test(k.n)) code = encode({ kind: 'key', usage: 0x3a + Number(k.n.slice(1)) - 1 });
        else if (LABEL_USAGE[k.n]) code = encode({ kind: 'key', usage: LABEL_USAGE[k.n] });
        else if (MOD_LABEL[k.n]) {
          const i = (seen[k.n] = (seen[k.n] || 0) + 1) - 1; // first of a kind is the left one
          code = encode({ kind: 'mods', mods: MOD_LABEL[k.n][Math.min(i, 1)] });
        } else if (k.n === 'Fn') code = Uint8Array.of(0x0d, 0, 0, 0);
      } else {
        const media = { F1: 0x00e2, F2: 0x00ea, F3: 0x00e9, F4: 0x00cd };
        if (media[k.n]) code = encode({ kind: 'media', usage: media[k.n] });
      }
      out.set(code, offset(k.led));
    }
    return out;
  }

  return {
    LAYER_SIZE, CODE_LEN, LAYERS, MODS, GROUPS, MEDIA, NAMES,
    decode, encode, hasKey, codeAt, withCode, sameBytes, changedKeys, neededBytes, knownShare, looksLikeBaseLayer, defaultLayer,
  };
});
