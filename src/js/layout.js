/*
 * Physical layouts in key units (1u = one standard key), with the LED index each key uses in the per-key colour
 * block. Positions are laid out here; the LED indices are hardware facts (the numbering the manufacturer's own
 * driver uses: column * 6 + row on the models listed below).
 *
 * Several models share one protocol and differ only in this table. Adding a model that speaks the same protocol
 * is a matter of adding its layout to LAYOUTS (see "Adding a model" in the README), plus a skin in skins.js so the preview
 * shows that keyboard and not another model's picture (a model without a skin of its own is drawn with the F75 skin).
 *
 * The module exposes the layout currently in use as KEYS / WIDTH / HEIGHT / CODE_TO_LED and switches it with
 * use(id). KEYS is the same array object for the life of the page (its contents are replaced), so holders of a
 * reference keep seeing the current layout; callers that cache anything derived from it (maps, paths) must
 * rebuild it when use() returns true.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaLayout = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ROW_GAP = 1.3; // function row sits slightly apart

  /** rows: [{ y, items }]; items: number = gap in units, [label, led, width?] = key */
  function build(rows, width) {
    const keys = [];
    for (const { y, items } of rows) {
      let x = 0;
      for (const it of items) {
        if (typeof it === 'number') {
          x += it;
          continue;
        }
        const w = it[2] || 1;
        keys.push({ n: it[0], led: it[1], x, y, w, h: 1 });
        x += w;
      }
    }
    const height = Math.max(...rows.map((r) => r.y)) + 1;
    return { keys, width, height };
  }

  // ------------------------------------------------------------------ AULA F75 (75%, 80 keys)
  const F75 = build(
    [
      {
        y: 0,
        items: [
          ['Esc', 0], 1,
          ['F1', 12], ['F2', 18], ['F3', 24], ['F4', 30], 0.25,
          ['F5', 36], ['F6', 42], ['F7', 48], ['F8', 54], 0.25,
          ['F9', 60], ['F10', 66], ['F11', 72], ['F12', 78],
        ],
      },
      {
        y: ROW_GAP,
        items: [
          ['`', 1], ['1', 7], ['2', 13], ['3', 19], ['4', 25], ['5', 31], ['6', 37], ['7', 43], ['8', 49], ['9', 55], ['0', 61],
          ['-', 67], ['=', 73], ['Backspace', 79, 2], ['Del', 85],
        ],
      },
      {
        y: ROW_GAP + 1,
        items: [
          ['Tab', 2, 1.5], ['Q', 8], ['W', 14], ['E', 20], ['R', 26], ['T', 32], ['Y', 38], ['U', 44], ['I', 50], ['O', 56],
          ['P', 62], ['[', 68], [']', 74], ['\\', 80, 1.5], ['PgUp', 86],
        ],
      },
      {
        y: ROW_GAP + 2,
        items: [
          ['Caps', 3, 1.75], ['A', 9], ['S', 15], ['D', 21], ['F', 27], ['G', 33], ['H', 39], ['J', 45], ['K', 51], ['L', 57],
          [';', 63], ["'", 69], ['Enter', 81, 2.25], ['PgDn', 87],
        ],
      },
      {
        y: ROW_GAP + 3,
        items: [
          ['Shift', 4, 2.25], ['Z', 10], ['X', 16], ['C', 22], ['V', 28], ['B', 34], ['N', 40], ['M', 46], [',', 52], ['.', 58],
          ['/', 64], ['Shift', 70, 1.75], ['Up', 82], ['End', 88],
        ],
      },
      {
        y: ROW_GAP + 4,
        items: [
          ['Ctrl', 5, 1.25], ['Win', 11, 1.25], ['Alt', 17, 1.25], ['Space', 35, 6.25], ['Fn', 53, 1.25], ['Ctrl', 59, 1.25], 0.5,
          ['Left', 77], ['Down', 83], ['Right', 89],
        ],
      },
    ],
    16,
  );

  // ------------------------------------------------------------------ AULA F87 / F87 Pro (TKL, 87 keys)
  // LED indices from the manufacturer driver's key table, as documented by the open-source F87 controller
  // (marcoslor/Aula-F87-Controller, docs/PROTOCOL.md). Same protocol as the F75.
  const F87 = build(
    [
      {
        y: 0,
        items: [
          ['Esc', 0], 1,
          ['F1', 12], ['F2', 18], ['F3', 24], ['F4', 30], 0.25,
          ['F5', 36], ['F6', 42], ['F7', 48], ['F8', 54], 0.25,
          ['F9', 60], ['F10', 66], ['F11', 72], ['F12', 78], 0.75,
          ['PrtSc', 84], ['ScrLk', 90], ['Pause', 96],
        ],
      },
      {
        y: ROW_GAP,
        items: [
          ['`', 1], ['1', 7], ['2', 13], ['3', 19], ['4', 25], ['5', 31], ['6', 37], ['7', 43], ['8', 49], ['9', 55], ['0', 61],
          ['-', 67], ['=', 73], ['Backspace', 79, 2], 0.25,
          ['Ins', 85], ['Home', 91], ['PgUp', 97],
        ],
      },
      {
        y: ROW_GAP + 1,
        items: [
          ['Tab', 2, 1.5], ['Q', 8], ['W', 14], ['E', 20], ['R', 26], ['T', 32], ['Y', 38], ['U', 44], ['I', 50], ['O', 56],
          ['P', 62], ['[', 68], [']', 74], ['\\', 80, 1.5], 0.25,
          ['Del', 86], ['End', 92], ['PgDn', 98],
        ],
      },
      {
        y: ROW_GAP + 2,
        items: [
          ['Caps', 3, 1.75], ['A', 9], ['S', 15], ['D', 21], ['F', 27], ['G', 33], ['H', 39], ['J', 45], ['K', 51], ['L', 57],
          [';', 63], ["'", 69], ['Enter', 81, 2.25],
        ],
      },
      {
        y: ROW_GAP + 3,
        items: [
          ['Shift', 4, 2.25], ['Z', 10], ['X', 16], ['C', 22], ['V', 28], ['B', 34], ['N', 40], ['M', 46], [',', 52], ['.', 58],
          ['/', 64], ['Shift', 82, 2.75], 1.25, ['Up', 94],
        ],
      },
      {
        y: ROW_GAP + 4,
        items: [
          ['Ctrl', 5, 1.25], ['Win', 11, 1.25], ['Alt', 17, 1.25], ['Space', 35, 6.25], ['Alt', 53, 1.25], ['Fn', 59, 1.25],
          ['Menu', 65, 1.25], ['Ctrl', 83, 1.25], 0.25,
          ['Left', 89], ['Down', 95], ['Right', 101],
        ],
      },
    ],
    18.25,
  );

  /**
   * Models this app can drive. `match` is tested against the USB product name, which is only a hint: the F75 and
   * F87 report the same USB ids, so the model is also a setting the person can change.
   */
  const MODELS = [
    // The plain F75 must not claim "F75 Pro" names, so its pattern steps aside for a trailing "Pro".
    { id: 'f75', name: 'AULA F75', skin: 'f75', match: /f75(?![\s_-]*pro)/i, knob: true, ...F75 },
    // The F75 Pro is the same 75% board with a knob. No separate LED table is published for it, so it uses the F75 one;
    // the light count check (fits) still catches a keyboard whose colour block is too small for it.
    { id: 'f75pro', name: 'AULA F75 Pro', skin: 'f75pro', match: /f75[\s_-]*pro/i, knob: true, ...F75 },
    { id: 'f87', name: 'AULA F87 / F87 Pro', skin: 'f87', match: /f87/i, knob: false, ...F87 },
  ];
  const BY_ID = new Map(MODELS.map((m) => [m.id, m]));
  const DEFAULT_MODEL = 'f75';

  /** KeyboardEvent.code for each key label; labels that appear twice (Shift, Ctrl, Alt) are left then right. */
  const CODES = {
    Esc: 'Escape', '`': 'Backquote', '-': 'Minus', '=': 'Equal', Backspace: 'Backspace', Del: 'Delete', Tab: 'Tab',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', PgUp: 'PageUp', PgDn: 'PageDown', Caps: 'CapsLock',
    ';': 'Semicolon', "'": 'Quote', Enter: 'Enter', ',': 'Comma', '.': 'Period', '/': 'Slash', Up: 'ArrowUp', End: 'End',
    Left: 'ArrowLeft', Down: 'ArrowDown', Right: 'ArrowRight', Space: 'Space', Win: 'MetaLeft', PrtSc: 'PrintScreen',
    ScrLk: 'ScrollLock', Pause: 'Pause', Ins: 'Insert', Home: 'Home', Menu: 'ContextMenu',
  };
  const SIDED = { Shift: ['ShiftLeft', 'ShiftRight'], Ctrl: ['ControlLeft', 'ControlRight'], Alt: ['AltLeft', 'AltRight'] };

  /** Maps KeyboardEvent.code to the layout key that should light up in the Reactive preview. */
  function codeMap(keys) {
    const m = {};
    const seen = {};
    for (const k of keys) {
      const nth = (seen[k.n] = (seen[k.n] || 0) + 1) - 1;
      let code = CODES[k.n];
      if (SIDED[k.n]) code = SIDED[k.n][nth];
      else if (/^[A-Z]$/.test(k.n)) code = 'Key' + k.n;
      else if (/^[0-9]$/.test(k.n)) code = 'Digit' + k.n;
      else if (/^F([1-9]|1[0-2])$/.test(k.n)) code = k.n;
      if (code && !(code in m)) m[code] = k.led;
    }
    return m;
  }

  const api = { KEYS: [], WIDTH: 0, HEIGHT: 0, KNOB: false, CODE_TO_LED: {}, id: null, skin: null, MODELS, DEFAULT_MODEL };

  /** Switches the layout in use. Returns true when it changed (so cached derivatives must be rebuilt). */
  api.use = function use(id) {
    const m = BY_ID.get(id) || BY_ID.get(DEFAULT_MODEL);
    if (api.id === m.id) return false;
    api.id = m.id;
    api.skin = m.skin || m.id; // which picture of the keyboard to draw (skins.js)
    api.KEYS.length = 0;
    api.KEYS.push(...m.keys);
    api.WIDTH = m.width;
    api.HEIGHT = m.height;
    api.KNOB = !!m.knob;
    api.CODE_TO_LED = codeMap(m.keys);
    return true;
  };

  /** Best guess at the model from a USB product name, or null when the name says nothing. */
  api.guessModel = (name) => {
    const hit = MODELS.find((m) => m.match.test(name || ''));
    return hit ? hit.id : null;
  };
  /** How many entries the per-key colour block must have for every key of the layout in use to be paintable. */
  api.requiredLeds = () => Math.max(...api.KEYS.map((k) => k.led)) + 1;
  /** Whether a colour block with `lights` entries can hold every key of the layout in use. */
  api.fits = (lights) => lights >= api.requiredLeds();
  api.modelName = (id) => (BY_ID.get(id) || BY_ID.get(DEFAULT_MODEL)).name;
  api.hasModel = (id) => BY_ID.has(id);

  api.use(DEFAULT_MODEL);
  return api;
});
