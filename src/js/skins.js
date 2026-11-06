/*
 * How each keyboard model is pictured. One skin per model: the case, the keycaps, which keys wear an accent colour on
 * their sides, the knob (and on the F75 Max, the little screen), and the legends printed on the caps.
 *
 * These are drawings made for this app in the style of the manufacturer's own picture, not photos of the products. Each
 * model has its own colourway so the preview is never "the F75 picture" on a keyboard that is not an F75:
 *
 *   f75     black case, navy caps with black modifiers, yellow Esc / Enter / arrows / space, orange legends, round metal knob
 *   f75pro  silver case, light caps, blue-sided Esc / Enter / arrows, larger metal knob
 *   f87     blue-black case, graphite caps, orange-sided Esc / Enter / Backspace / arrows, no knob (TKL)
 *   max     graphite case, grey caps, green-sided Esc / Enter / arrows, metal knob and a small TFT screen
 *
 * Positions are in key units (1u = one key) measured from the top-left corner of the key block, the same space layout.js
 * uses, so a skin follows whatever layout it is drawn on.
 *
 * Colours are plain hex strings. rgb() turns one into [r, g, b] (cached), so the canvas drawing can mix them with the
 * lighting colours without parsing a string on every frame.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AulaSkins = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const rgbCache = new Map();
  /** '#rrggbb' -> [r, g, b]; anything else gives mid grey rather than throwing. */
  function rgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      v = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [128, 128, 128];
      rgbCache.set(hex, v);
    }
    return v;
  }

  /** Perceived brightness 0..1 of a colour (hex string or [r, g, b]). */
  const luma = (c) => {
    const v = Array.isArray(c) ? c : rgb(c);
    return (v[0] * 299 + v[1] * 587 + v[2] * 114) / 255000;
  };

  const SKINS = {
    // ---------------------------------------------------------------- AULA F75: black case, navy and black caps, yellow accents (the colours of the real board)
    f75: {
      id: 'f75',
      colourway: 'Navy, black and yellow',
      case: { top: '#2a2c31', bottom: '#141518', edge: 'rgba(255,255,255,0.12)', shine: 'rgba(255,255,255,0.04)' },
      plate: { fill: '#07080a', edge: 'rgba(255,255,255,0.08)' },
      slot: '#030304',
      cap: { face: ['#323d5a', '#262f49'], body: ['#222a40', '#12172a'], legend: '#f2b32b', lit: 0.02 },
      accents: {
        // an accent cap is coloured all over, and its legend is dark on the yellow
        gold: { face: ['#f2bb30', '#dc9a1a'], body: ['#e6aa26', '#a8770c'], legend: '#4a3208', keys: ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right', 'Space'] },
        black: { face: ['#303137', '#232428'], body: ['#202125', '#0f1013'], legend: '#f2b32b', keys: ['Backspace', 'Del', 'Tab', 'PgUp', 'Caps', 'PgDn', 'Shift', 'End', 'Ctrl', 'Win', 'Alt', 'Fn'] },
      },
      knob: { r: 0.56, ring: ['#eef1f4', '#a1a9b3', '#4f565f', '#cdd2d9'], face: '#0b0c0f', dent: 'rgba(255,255,255,0.07)' },
      indicators: [
        { kind: 'bar', x: 1.5, y: 0.5, len: 0.55 },
        { kind: 'dot', x: -0.26, key: 'Caps' },
      ],
      usb: true,
    },

    // ---------------------------------------------------------------- AULA F75 Pro: silver / white / blue, bigger knob
    f75pro: {
      id: 'f75pro',
      colourway: 'Silver and blue',
      case: { top: '#eceef2', bottom: '#b4bbc7', edge: 'rgba(255,255,255,0.85)', shine: 'rgba(255,255,255,0.35)' },
      plate: { fill: '#12141a', edge: 'rgba(255,255,255,0.18)' },
      slot: '#06070a',
      cap: { face: ['#f7f8fa', '#d5d9e0'], body: ['#a3abb8', '#7d8594'], legend: '#14171e', lit: 0.035 },
      accents: {
        blue: { body: ['#5b95ff', '#2c5fc4'], keys: ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right'] },
      },
      knob: { r: 0.52, ring: ['#ffffff', '#b8bec8', '#6d7480', '#e2e5ea'], face: '#1a1d25', dent: 'rgba(255,255,255,0.12)' },
      indicators: [{ kind: 'dot', x: -0.26, key: 'Caps' }],
      usb: true,
    },

    // ---------------------------------------------------------------- AULA F87 / F87 Pro: graphite / orange, full TKL, no knob
    f87: {
      id: 'f87',
      colourway: 'Carbon and orange',
      case: { top: '#222735', bottom: '#0f121a', edge: 'rgba(160,185,255,0.18)', shine: 'rgba(160,185,255,0.05)' },
      plate: { fill: '#07080c', edge: 'rgba(160,185,255,0.10)' },
      slot: '#030407',
      cap: { face: ['#565a66', '#3e414b'], body: ['#14161c', '#08090c'], legend: '#ffffff', lit: 0.055 },
      accents: {
        orange: { body: ['#ff9a3d', '#c85a0a'], keys: ['Esc', 'Enter', 'Backspace', 'Up', 'Left', 'Down', 'Right'] },
      },
      knob: null,
      indicators: [
        { kind: 'bar', x: 1.5, y: 0.5, len: 0.55 },
        { kind: 'dot', x: -0.26, key: 'Caps' },
      ],
      usb: true,
    },

    // ---------------------------------------------------------------- AULA F75 Max: graphite / green, knob and TFT screen
    max: {
      id: 'max',
      colourway: 'Graphite and green',
      case: { top: '#2b302d', bottom: '#131715', edge: 'rgba(140,255,190,0.16)', shine: 'rgba(140,255,190,0.05)' },
      plate: { fill: '#070908', edge: 'rgba(140,255,190,0.10)' },
      slot: '#030504',
      cap: { face: ['#7f8389', '#63676d'], body: ['#191c1b', '#0a0c0b'], legend: '#ffffff', lit: 0.045 },
      accents: {
        green: { body: ['#46e08c', '#1c9658'], keys: ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right'] },
      },
      knob: { r: 0.36, ring: ['#f1f3f6', '#9399a2', '#4b4f57', '#c3c7ce'], face: '#0d0e12', dent: 'rgba(255,255,255,0.08)', x: 15.45, y: 0.5 },
      // The small colour screen sits beside the knob, in the corner right of the function row.
      screen: { x: 13.3, y: 0.1, w: 1.7, h: 0.8 },
      indicators: [{ kind: 'dot', x: -0.26, key: 'Caps' }],
      usb: true,
    },
  };

  for (const sk of Object.values(SKINS)) for (const [name, a] of Object.entries(sk.accents || {})) a.name = name; // so a cap can say which accent it wears

  const DEFAULT_SKIN = 'f75';
  const get = (id) => SKINS[id] || SKINS[DEFAULT_SKIN];

  /** The accent (with its `body` gradient) a key wears, or null. `name` is the layout's label for the key. */
  function accentOf(skin, name) {
    const n = String(name).toLowerCase();
    for (const a of Object.values(skin.accents || {})) if (a.keys.some((key) => key.toLowerCase() === n)) return a;
    return null;
  }

  /** The skin's colours as CSS custom properties, for the parts of the app that draw a board with HTML instead of canvas. */
  function cssVars(skin) {
    const ring = skin.knob ? skin.knob.ring : ['#ddd', '#999', '#555', '#bbb'];
    return {
      '--sk-case-top': skin.case.top,
      '--sk-case-bottom': skin.case.bottom,
      '--sk-case-edge': skin.case.edge,
      '--sk-plate': skin.plate.fill,
      '--sk-plate-edge': skin.plate.edge,
      '--sk-slot': skin.slot,
      '--sk-face-a': skin.cap.face[0],
      '--sk-face-b': skin.cap.face[1],
      '--sk-body-a': skin.cap.body[0],
      '--sk-body-b': skin.cap.body[1],
      '--sk-ink': skin.cap.legend,
      '--sk-knob-ring': `linear-gradient(135deg, ${ring.join(', ')})`,
      '--sk-knob-face': skin.knob ? skin.knob.face : '#111',
    };
  }

  // ---------------------------------------------------------------- legends printed on the caps
  const SHIFTED = {
    '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
    '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
  };
  const ARROWS = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
  // The words are the ones printed on the real caps; they all share one size (preview.js), chosen so the longest still fits.
  const WORDS = { Esc: 'Esc', Caps: 'CapsLock', Del: 'Delete', Space: '' };
  // Caps whose text is centred instead of sitting up in the left corner.
  const CENTRED = new Set(['Up', 'Down', 'Left', 'Right']);

  /** What is printed on a key: { text, align }. Digits and punctuation carry both symbols, as on the real caps. */
  function legendOf(name) {
    if (ARROWS[name]) return { text: ARROWS[name], align: 'center' };
    if (SHIFTED[name]) return { text: `${name} ${SHIFTED[name]}`, align: 'left', stack: [SHIFTED[name], name] }; // `stack`: the symbol above, the key below, as printed on a real cap
    const text = name in WORDS ? WORDS[name] : name;
    return { text, align: CENTRED.has(name) ? 'center' : 'left' };
  }

  // Caps that carry a small picture beside (or around) their word, as the real ones do.
  const ICON_WORDS = { Tab: 'tab', Shift: 'shift', Enter: 'enter', Backspace: 'back' };
  // Words printed slanted on the real caps (the left Ctrl is, the right one is not).
  const SLANTED = new Set(['Caps', 'Shift', 'Tab', 'Win', 'Alt']);

  /**
   * How a key's legend is drawn on a rendered cap: { kind, italic? }.
   *   letter   one big letter                 stack   shifted symbol above the plain one (digits, punctuation)
   *   arrow    a drawn arrow (kind 'arrow', dir 'up' | 'down' | 'left' | 'right')
   *   word     a short word, all of them in one size
   *   tab / shift / enter / back   a word with its picture (two arrows, hollow arrow, return arrow, left arrow)
   *   none     nothing printed (Space)
   * `x` is the key's position in key units (it tells the left Ctrl from the right one).
   */
  function legendStyle(name, x) {
    if (ARROWS[name]) return { kind: 'arrow', dir: String(name).toLowerCase() };
    if (SHIFTED[name]) return { kind: 'stack' };
    if (name === 'Space') return { kind: 'none' };
    if (/^[A-Za-z]$/.test(name)) return { kind: 'letter' };
    return { kind: ICON_WORDS[name] || 'word', italic: SLANTED.has(name) || (name === 'Ctrl' && x < 5) };
  }

  return { SKINS, DEFAULT_SKIN, get, accentOf, cssVars, legendOf, legendStyle, rgb, luma };
});
