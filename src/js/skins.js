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
 *   max     white case, white caps with sky-blue print, blue modifiers, purple Esc / Enter / arrows / space, silver knob and a small TFT screen (the colours of the real board)
 *   f75he   black case, white caps with grey modifiers, darker grey F5-F8, black Esc / Enter / arrows / space, round metal knob (the colours of the real board)
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

    // ---------------------------------------------------------------- AULA F75 Max: white case, white caps with sky-blue print, blue modifiers, purple Esc / Enter / arrows / space (the colours of the real board)
    // Pictured from photos of the white / blue / purple F75 Max: a white case, white letter caps printed in sky blue, steel-blue
    // modifiers, navigation column and F5-F8, lilac Esc / Enter / arrows / space (their print is white), a nearly square colour
    // screen right of F12 and a silver knob with a white top beside it. The key names are the ones the preview prints (layout.js: 'Del', 'PgUp', 'Caps', 'Shift' ...).
    max: {
      id: 'max',
      colourway: 'White, blue and purple',
      case: { top: '#f5f4f7', bottom: '#d1d1d9', edge: 'rgba(255,255,255,0.85)', shine: 'rgba(255,255,255,0.35)' },
      plate: { fill: '#111218', edge: 'rgba(255,255,255,0.14)' },
      slot: '#050508',
      cap: { face: ['#f9f7fc', '#eeedf5'], body: ['#e0dfea', '#c2c5d6'], legend: '#4fb6ee', lit: 0.035 },
      accents: {
        // an accent cap is coloured all over; its print is white
        blue: {
          face: ['#a3bee9', '#93afe0'], body: ['#7f9fd5', '#5a7bb3'], legend: '#ffffff',
          keys: ['F5', 'F6', 'F7', 'F8', 'Backspace', 'Del', 'Tab', 'PgUp', 'Caps', 'PgDn', 'Shift', 'End', 'Ctrl', 'Win', 'Alt', 'Fn'],
        },
        purple: { face: ['#ab9fe4', '#9c90d9'], body: ['#8c81c8', '#7165b0'], legend: '#ffffff', keys: ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right', 'Space'] },
      },
      // `faceR`: the white top of the knob, as a fraction of its radius (the silver ring is wide and slopes down to it); `dot`: no marker on it.
      knob: { r: 0.52, ring: ['#f4f5f8', '#aeb3bc', '#6a707a', '#d9dce2'], face: '#e3e3e9', dent: 'rgba(255,255,255,0.12)', x: 15.5, y: 0.5, faceR: 0.6, dish: true, dot: false },
      // The colour screen sits between F12 and the knob. On the real board it is almost square, in a white panel that is level with the case.
      screen: { x: 13.5, y: 0.02, w: 1.0, h: 0.96, ui: { date: '12/02', battery: 91, time: '16:26:21', mode: 'WIN', link: 'BT' } },
      // The case-coloured panel the screen and the knob stand in (the plate does not run under them): from x to the right edge, down to y.
      island: { x: 13.08, y: 1.0 },
      // the caps nearly touch and the dark plate shows only as a thin line round the key block (render.py: capGap, wellPad, wellR); the white of the case does the framing
      capGap: 0.022, wellPad: 0.05, wellR: 0.12,
      // and the white gap in the bottom row, between Fn and the arrow keys (x 12.5 to 13): case material down to the bottom rim, a thin dark line each side
      panels: [{ x: 12.54, y: 5.03, w: 0.42, h: 1.0, r: 0.05, toRim: true }],
      indicators: [{ kind: 'dot', x: -0.26, key: 'Caps' }],
      usb: true,
      usbAt: 4.95, // the real board has a small pale tab on the back edge, left of centre (render.py), not a dark notch in the middle
      usbInk: '#d9d4f2',
      exposure: 0.87, // how bright render.py picks the picture up: a white board matches its photos at this level
    },

    // ---------------------------------------------------------------- AULA F75 HE: black case, white and grey caps, round knob (the colours of the real board)
    // Pictured from photos of the black / white / grey F75 HE: white letter caps with dark print, mid-grey modifiers and
    // navigation column, a darker grey F5-F8 block, near-black Esc / Enter / arrows / space, and a round knob with a metal ring at
    // the right end of the function row. The key names are the ones the preview prints (layout.js: 'Del', 'PgUp', 'Caps', 'Shift' ...).
    f75he: {
      id: 'f75he',
      colourway: 'Black, white and grey',
      case: { top: '#26272b', bottom: '#101113', edge: 'rgba(255,255,255,0.12)', shine: 'rgba(255,255,255,0.04)' },
      plate: { fill: '#0a0a0c', edge: 'rgba(255,255,255,0.08)' },
      slot: '#040405',
      cap: { face: ['#ffffff', '#f1f1f3'], body: ['#d6d7da', '#a4a6ab'], legend: '#16171a', lit: 0.035 },
      accents: {
        // an accent cap is coloured all over; its print is white
        grey: {
          face: ['#8d8e92', '#78797d'], body: ['#6c6d71', '#4b4c50'], legend: '#ffffff',
          keys: ['Tab', 'Caps', 'Shift', 'Ctrl', 'Win', 'Alt', 'Fn', 'Backspace', 'Del', 'PgUp', 'PgDn', 'End'],
        },
        dark: { face: ['#6d6e72', '#58595d'], body: ['#505155', '#37383b'], legend: '#ffffff', keys: ['F5', 'F6', 'F7', 'F8'] },
        black: { face: ['#2b2c2f', '#1b1c1e'], body: ['#202123', '#0c0d0e'], legend: '#ffffff', keys: ['Esc', 'Enter', 'Up', 'Left', 'Down', 'Right', 'Space'] },
      },
      knob: { r: 0.54, ring: ['#eef0f3', '#a3a9b2', '#4e535b', '#cfd3d9'], face: '#0b0b0d', dent: 'rgba(255,255,255,0.07)' },
      indicators: [
        { kind: 'bar', x: 1.5, y: 0.5, len: 0.55 },
        { kind: 'dot', x: -0.26, key: 'Caps' },
      ],
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
