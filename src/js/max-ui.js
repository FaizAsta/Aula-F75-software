/*
 * The F75 Max screen, which also serves the F75 HE. When one of them is connected this replaces the F75's preview and panels
 * (these boards have their own effects, levels and per-key tables, see max.js and he.js) with one panel of three sections:
 * Lighting, Per-key and Keyboard.
 *
 * It only ever shows what the app really knows. The Max cannot be read back, so its controls show what was last sent, and the
 * status line says whether the keyboard acknowledged the last write or whether it was sent blind (2.4G). The F75 HE can be
 * read (lighting, per-key colours, who it is), so its screen starts from what the keyboard says and has a "Read from keyboard"
 * button; its Keyboard section has no settings, because the Hall-effect settings are not driven (he.js).
 *
 * One instance of the screen per keyboard family (FAMILIES below); the object `create` returns lets the app treat them as one.
 */
(function () {
  'use strict';

  if (!window.AulaMax && !window.AulaHe) return;

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid !== undefined && kid !== null) n.append(kid);
    return n;
  };

  // the small icons the F75 screen puts in front of its settings (same paths as index.html)
  const ICON = {
    bright: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    speed: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/>',
    colour: '<path d="M12 3.5s6 6.2 6 10.3a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5z"/>',
    direction: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  };
  const ico = (name) => {
    const w = document.createElement('span');
    w.innerHTML = `<svg class="fh-ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
    return w.firstChild;
  };

  const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rgbOf = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const QUICK = ['#ff2d2d', '#ff7a00', '#ffd400', '#00d26a', '#00c8ff', '#2f5bff', '#8a2be2', '#ff2fa0', '#ffffff'];

  // The little animated keyboard on each effect card (max-fx.js). The F75 screen has the same on its cards.
  const FX = window.AulaMaxFx || null;
  // The pointer and key motion of the picture (max-motion.js): the F75 preview's lean, spotlight, rising keys, ripples, key presses and lights-on sweep.
  const MM = window.AulaMaxMotion || null;

  /** One line on what each of the F75 Max's 20 effects does (the hover text and the line under "Effect"). */
  const EFFECT_INFO_MAX = {
    0: 'All lighting is switched off.',
    1: 'Every key stays one colour.',
    2: 'Keys light up when you press them.',
    3: 'Pressed keys light up, then fade away slowly.',
    4: 'Keys twinkle at random.',
    5: 'Drops of light fall across the board.',
    6: 'Every key has its own colour.',
    7: 'The whole board brightens and dims.',
    8: 'The whole board steps through every colour.',
    9: 'Light spreads outward from the middle.',
    10: 'A wave of light sweeps across the board.',
    11: 'Bands of colour roll across the board.',
    12: 'Light sweeps around the middle of the board.',
    13: 'A key press sends a burst of light across the board.',
    14: 'A key press shoots light up its column.',
    15: 'A key press sends a ripple out from the key.',
    16: 'Soft bands of colour flow across the board.',
    17: 'Pulses of light spread out from the middle.',
    18: 'A slanted stripe of light sweeps across.',
    19: 'A bar of light sweeps back and forth.',
  };

  /**
   * What differs between the keyboards this screen serves. `api` is the protocol module, `skin` the picture (skins.js), `fxMode`
   * and `fxDir` say which of the Max's drawn effects (max-fx.js) to show on a card (the F75 HE has none of its own: its
   * pictures are the Max's, so they are called approximate).
   */
  const FAMILIES = {
    max: {
      id: 'max',
      name: 'F75 Max',
      model: 'AULA F75 Max',
      api: window.AulaMax || null,
      session: 'MaxSession',
      skin: 'max',
      effectInfo: EFFECT_INFO_MAX,
      note: 'Support for the F75 Max is experimental. It follows protocol notes confirmed on real keyboards by other projects, and it has not been tried on one by this app’s author. If something does not behave, tell me what you saw.',
      fxNote: 'The small pictures and the keyboard picture only show roughly what each effect does; the keyboard’s own look may differ a little.',
      fxMode: (m) => m,
      fxDir: (d) => d,
      readBack: false,
      perkeyOverDongle: false,
      hasSettings: true,
      brightLevels: 5, // brightness runs 1..5
    },
    he: {
      id: 'he',
      name: 'F75 HE',
      model: 'AULA F75 HE',
      api: window.AulaHe || null,
      session: 'HeSession',
      skin: 'f75he',
      effectInfo: Object.fromEntries([...((window.AulaHe && window.AulaHe.EFFECTS) || []), ...((window.AulaHe && window.AulaHe.SOFT_EFFECTS) || [])].map((e) => [e.mode, e.info])), // said no more than the vendor's names say
      note: 'Support for the F75 HE is experimental. Reading from the keyboard (who it is, its lighting, its per-key colours) has been checked against a real F75 HE, firmware V1.55, over USB-C and over 2.4G. The effects and the lighting bytes written for each are the ones AULA’s own driver was seen to write to a real F75 HE. The app’s own writes have not been confirmed on a real F75 HE yet. The picture follows photos of the real board; which key number belongs to which cap is still provisional. If something does not behave, tell me what you saw.',
      fxNote: 'The small pictures and the keyboard picture are the F75 Max’s drawings and only roughly show what each effect does; the keyboard’s own look will differ.',
      fxMode: (m) => m,
      fxDir: (d) => (d === 1 ? 2 : 0), // Forward / Reverse -> the drawings' Right / Left
      colourCards: true, // the small pictures show each effect in colour, as the F75 screen's do (see cardState)
      readBack: true,
      perkeyOverDongle: true,
      hasSettings: false,
      brightLevels: (window.AulaHe && window.AulaHe.BRIGHT_LEVELS) || 9, // brightness runs 1..9, as on the F75
    },
  };

  /** Short label for how an effect treats colour, used on the cards and as a chip (same wording as the F75 cards). */
  function effectTag(e) {
    if (e.mode === 0) return 'Lights off';
    if (e.soft) return 'Drawn by this app';
    if (e.reactive) return 'Reacts to typing';
    if (!e.color) return 'Multicolour';
    return e.mode === 1 ? 'Single colour' : 'Colour or multi';
  }
  const ink = (rgb) => ((rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150 ? '#10131a' : '#ffffff');

  function hue(h) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }

  function createFamily(ctx, FAM) {
    const { storage, toast = () => {} } = ctx;
    const MX = FAM.api;
    const EFFECT_INFO = FAM.effectInfo;
    const max = new MX[FAM.session]({ storage });
    const root = document.getElementById('maxRoot');
    const shell = document.querySelector('.shell');
    if (!root || !shell) return null;

    let active = false;
    let tab = 'lighting'; // which section of the Max screen is showing: lighting | perkey | keyboard
    const sel = new Set(); // the keys picked with the Select tool on the Per-key page (lights, as on the F75 screen)
    let missed = 0;
    let drag = null; // 'add' | 'del' | 'brush' while the pointer is down on the picture
    window.addEventListener('pointerup', () => (drag = null));
    const refs = {};

    const $ = (sel) => root.querySelector(sel);
    const can = () => !max.busy && max.present;

    // ------------------------------------------------------------------ per-key paint (the F75 screen's Per-key controls)
    // What Brush, Paint selected and Fill all keys paint with: one colour, a gradient from a start to an end colour, or a rainbow,
    // running left to right, top to bottom or diagonally. Only the picture changes; Apply writes it to the keyboard.

    const PK_STORE = `aula.${FAM.id}.paint`;
    const PAINTS = ['solid', 'gradient', 'rainbow'];
    const DIRS = ['x', 'y', 'xy'];
    const HEX6 = /^#[0-9a-f]{6}$/i;
    const GRADIENTS = [
      { name: 'Sunset', a: '#ffb300', b: '#ff2fa0' },
      { name: 'Fire', a: '#ffd400', b: '#ff2d2d' },
      { name: 'Ocean', a: '#00e5ff', b: '#2f5bff' },
      { name: 'Aurora', a: '#00d26a', b: '#8a2be2' },
      { name: 'Candy', a: '#ff2fa0', b: '#7cd6ff' },
      { name: 'Ice', a: '#ffffff', b: '#00b4ff' },
    ];
    const saved = (() => {
      try {
        return JSON.parse((storage && storage.getItem(PK_STORE)) || 'null') || {};
      } catch (e) {
        return {};
      }
    })();
    const pk = {
      tool: saved.tool === 'brush' ? 'brush' : 'select',
      paint: PAINTS.includes(saved.paint) ? saved.paint : 'solid',
      a: HEX6.test(saved.a) ? saved.a.toLowerCase() : '#7cd6ff',
      b: HEX6.test(saved.b) ? saved.b.toLowerCase() : '#ff2fa0',
      dir: DIRS.includes(saved.dir) ? saved.dir : 'x',
      stop: 'a',
    };
    const savePk = () => {
      try {
        if (storage) storage.setItem(PK_STORE, JSON.stringify({ tool: pk.tool, paint: pk.paint, a: pk.a, b: pk.b, dir: pk.dir }));
      } catch (e) {
        /* not saved: the choice only lasts until the window closes */
      }
    };
    const LAYOUT = MX.keyLayout();
    const BYLED = new Map(LAYOUT.map((k) => [k.led, k]));

    function pkColourAt(t) {
      const a = rgbOf(pk.a) || [255, 255, 255];
      if (pk.paint === 'rainbow') return hue(t * 306);
      if (pk.paint === 'gradient') {
        const b = rgbOf(pk.b) || [255, 255, 255];
        return a.map((v, i) => Math.round(v + (b[i] - v) * t));
      }
      return a;
    }
    /** The span (of key centres) a gradient or rainbow runs across. */
    function pkSpan(keys) {
      const sp = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      for (const k of keys) {
        const cx = k.x + k.w / 2;
        const cy = k.y + k.h / 2;
        sp.x0 = Math.min(sp.x0, cx);
        sp.x1 = Math.max(sp.x1, cx);
        sp.y0 = Math.min(sp.y0, cy);
        sp.y1 = Math.max(sp.y1, cy);
      }
      return sp;
    }
    function pkT(k, sp) {
      const nx = sp.x1 > sp.x0 ? (k.x + k.w / 2 - sp.x0) / (sp.x1 - sp.x0) : 0;
      const ny = sp.y1 > sp.y0 ? (k.y + k.h / 2 - sp.y0) / (sp.y1 - sp.y0) : 0;
      return pk.dir === 'y' ? ny : pk.dir === 'xy' ? (nx + ny) / 2 : nx;
    }
    /** Paints the given lights. fit = true runs a gradient or rainbow across just these keys (Paint selected); otherwise across the whole board. */
    function paintLeds(leds, fit = false) {
      const sp = pkSpan(fit ? leds.map((l) => BYLED.get(l)).filter(Boolean) : LAYOUT);
      max.paintWith(leds, (led) => {
        const k = BYLED.get(led);
        return pkColourAt(k ? pkT(k, sp) : 0);
      });
    }
    function setPkColour(hex, { keepHex = false } = {}) {
      const rgb = rgbOf(hex);
      if (!rgb) return;
      pk[pk.paint === 'gradient' ? pk.stop : 'a'] = hexOf(rgb);
      savePk();
      syncPaint({ keepHex });
      renderPerkey();
    }

    // ------------------------------------------------------------------ building

    function seg(id, count, labels, aria, onPick) {
      const box = el('div', { class: 'seg', id, role: 'radiogroup', 'aria-label': aria, style: `--n:${count};grid-template-columns:repeat(${count},1fr)` });
      labels.forEach((label, v) => box.append(el('button', { class: 'seg-btn', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-v': v, text: label, onclick: () => onPick(v) })));
      // Hold and drag, like the F75's selectors; here the keyboard is written to, so the level is set once, when the button is let go.
      if (window.AulaDragSeg) window.AulaDragSeg.attach(box, { pick: (v) => onPick(v) });
      return box;
    }

    function colourBlock(prefix, getRgb, setRgb, { swatches = true } = {}) {
      const input = el('input', { type: 'color', id: `${prefix}Pick`, value: hexOf(getRgb()) });
      const text = el('input', { class: 'text-in mono', id: `${prefix}Hex`, type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex colour', placeholder: '#RRGGBB', value: hexOf(getRgb()) });
      input.addEventListener('input', () => setRgb(rgbOf(input.value)));
      text.addEventListener('change', () => {
        const rgb = rgbOf(text.value.startsWith('#') ? text.value : `#${text.value}`);
        if (rgb) setRgb(rgb);
        else text.setAttribute('aria-invalid', 'true');
      });
      const sw = el('div', { class: 'swatches small', 'aria-label': 'Quick colours' });
      for (const q of QUICK) sw.append(el('button', { class: 'swatch', type: 'button', title: q, 'aria-label': `Use ${q}`, style: `background:${q}`, onclick: () => setRgb(rgbOf(q)) }));
      return { input, text, sw, node: el('div', {}, el('div', { class: 'color-edit' }, el('label', { class: 'color-pick' }, el('span', { class: 'sr', text: 'Colour' }), input), text), swatches ? sw : null) };
    }

    // The picture of the board. It is the same one on two pages: the Per-key page (keys you can paint) and the top of the
    // Lighting page (just a picture, `interactive` false). Each family has its own look (skins.js): the F75 Max a graphite
    // case with green-sided Esc / Enter / arrows, a knob and a small screen; the F75 HE a black case with white and grey caps and a knob.
    // The rendered picture (src/img/board, made by scripts/render-board/render.py, the same kind of picture the F75, F75 Pro
    // and F87 have): the case, plate, knob and screen are one image behind the keys, and each key wears the sprite of its
    // keycap. Without the pictures (or if one fails to load) the board is drawn with CSS.
    function makeBoard(interactive) {
      const GRID = MX.GRID || { w: 16, h: 6 }; // the key block, in key units (the F75 HE's function row sits apart, so it is taller than 6)
      const gridAspect = `${GRID.w} / ${GRID.h}`;
      const grid = el('div', { class: 'mx-grid', role: interactive ? 'group' : null, 'aria-label': interactive ? 'Keys' : null, style: `aspect-ratio:${gridAspect}` });
      const box = el('div', { class: 'mx-board' }, grid);
      const keys = new Map();
      const lamps = new Map(); // the under-key lights (skins with `underlight`), by key index
      // All the lamps are in one layer that comes first in the grid, so every key paints over it (plain document order: no z-index
      // to depend on, which would put them behind the picture if the grid were not a stacking context).
      const lampLayer = window.AulaSkins && window.AulaSkins.get(FAM.skin) && window.AulaSkins.get(FAM.skin).underlight ? el('div', { class: 'mx-lamps', 'aria-hidden': 'true' }) : null;
      if (lampLayer) grid.append(lampLayer);
      const SK = window.AulaSkins;
      const skin = SK ? SK.get(FAM.skin) : null;
      const man = window.AulaBoardManifest;
      const pics = man && man.skins && man.skins[FAM.skin] && man.skins[FAM.skin].base ? man.skins[FAM.skin] : null;
      const picUrl = (file) => `url(\"${(man.dir || '') + file}\")`;
      for (const k of MX.keyLayout()) {
        const attrs = { class: 'mx-key', 'data-led': k.led, text: k.label, style: `left:${(k.x / GRID.w) * 100}%;top:${(k.y / GRID.h) * 100}%;width:${(k.w / GRID.w) * 100}%;height:${(1 / GRID.h) * 100}%` };
        if (interactive) Object.assign(attrs, { type: 'button', title: k.name });
        const b = el(interactive ? 'button' : 'div', attrs);
        const acc = skin && SK.accentOf(skin, k.name);
        if (pics) {
          const cap = pics.caps[`${k.w}|${acc ? acc.name : '-'}`] || pics.caps[`${k.w}|-`];
          if (cap) b.style.setProperty('--cap', picUrl(cap.file));
          b.style.setProperty('--kw', String(k.w));
          if (k.w < 1.3 && String(k.label).length > 2) b.dataset.long = '1'; // PgUp, End, Del: a smaller print so they fit a 1u cap
        }
        if (acc) {
          b.style.setProperty('--body-a', acc.body[0]);
          b.style.setProperty('--body-b', acc.body[1]);
          if (acc.legend) b.style.setProperty('--sk-ink', acc.legend); // a cap of another colour prints its legend in its own ink
        }
        const blend = acc ? acc.blend : skin && skin.cap.blend; // how a painted colour lies on this cap (white caps need multiply)
        if (blend) b.style.setProperty('--blend', blend);
        if (skin && skin.underlight) {
          // The light of the key, as on the F75. A glow at the foot of the cap's front wall goes in the key, over its cap. The glow on
          // the plate and the thin line of light in the gaps round the cap (the lamp) must sit under every cap, and each key is its own
          // stacking context (isolation), so the lamp goes in the lamp layer beneath all the keys, with the key's size and place.
          b.append(el('i', { class: 'mx-foot', 'aria-hidden': 'true' }));
          const lamp = el('i', { class: 'mx-lamp', 'aria-hidden': 'true', style: attrs.style });
          lamps.set(k.led, lamp);
          lampLayer.append(lamp);
        }
        keys.set(k.led, b);
        grid.append(b);
      }
      if (skin) {
        const pos = (o) => Object.entries(o).map(([key, v]) => `${key}:${v}`).join(';');
        const sc = skin.screen;
        const kn = skin.knob;
        if (sc) grid.append(el('div', { class: 'mx-screen', 'aria-hidden': 'true', style: pos({ left: `${(sc.x / GRID.w) * 100}%`, top: `${(sc.y / GRID.h) * 100}%`, width: `${(sc.w / GRID.w) * 100}%`, height: `${(sc.h / GRID.h) * 100}%` }) }));
        if (kn) grid.append(el('div', { class: 'mx-knob', 'aria-hidden': 'true', style: pos({ left: `${(('x' in kn ? kn.x : GRID.w - 0.5) / GRID.w) * 100}%`, top: `${(('y' in kn ? kn.y : 0.5) / GRID.h) * 100}%`, width: `${((kn.r * 2) / GRID.w) * 100}%` }) }));
        for (const [name, v] of Object.entries(SK.cssVars(skin))) box.style.setProperty(name, v);
      }
      if (pics) {
        const base = pics.base;
        const bx = (v) => `${(v / base.w) * 100}%`;
        const by = (v) => `${(v / base.h) * 100}%`;
        box.classList.add('mx-photo');
        if (skin && skin.underlight) box.classList.add('mx-under');
        box.style.backgroundImage = picUrl(base.file);
        box.style.aspectRatio = `${base.w} / ${base.h}`;
        box.style.setProperty('--ar', String(base.w / base.h)); // the stage fits the picture to its height with this
        // the keys' grid sits where the picture has its key block: GRID key units, `scale` pixels each
        grid.style.cssText = `left:${bx(base.ox)};top:${by(base.oy)};width:${bx(GRID.w * man.scale)};height:${by(GRID.h * man.scale)}`;
        const probe = new Image();
        probe.onerror = () => {
          box.classList.remove('mx-photo');
          box.style.backgroundImage = box.style.aspectRatio = grid.style.cssText = '';
          grid.style.aspectRatio = gridAspect;
          box.style.removeProperty('--ar');
        };
        probe.src = (man.dir || '') + base.file;
      }
      return { box, grid, keys, lamps, under: !!(pics && skin && skin.underlight) };
    }

    /** The F75 Max's Keyboard page: key response, sleep and the key locks (what the app last sent: the Max cannot be read back). */
    function buildSettingsPage() {
      refs.resp = seg('mxResp', 5, ['1', '2', '3', '4', '5'], 'Key response', (v) => max.setSettings({ response: v + 1 }));
      refs.sleep = el('select', { class: 'select', id: 'mxSleep', 'aria-label': 'Lights and keyboard go to sleep after' });
      for (const o of MX.SLEEP) refs.sleep.append(el('option', { value: o.value, text: o.label }));
      refs.sleep.addEventListener('change', () => max.setSettings({ sleep: Number(refs.sleep.value) }));
      const toggle = (id, label, key, hint) => {
        const b = el('button', { class: 'switch', id, role: 'switch', 'aria-checked': 'false', 'aria-label': label, type: 'button', onclick: () => max.setSettings({ [key]: !max.settings[key] }) }, el('i'));
        refs[key] = b;
        return el('div', { class: 'field' }, el('div', { class: 'row' }, el('span', { class: 'grow fh-label', text: label }), b), hint ? el('p', { class: 'hint', text: hint }) : null);
      };
      refs.applyS = el('button', { class: 'btn primary', type: 'button', id: 'mxApplyS', onclick: () => run(max.applySettings()) }, el('span', { class: 'lbl', text: 'Apply to keyboard' }));
      return el('div', { id: 'mxKeyboard' },
        el('div', { class: 'split split-even' },
          el('div', { class: 'group' },
            el('div', { class: 'field' }, el('div', { class: 'field-head' }, el('h3', {}, ico('speed'), 'Key response'), el('span', { class: 'fh-right' }, el('span', { class: 'meter', id: 'mxMeterResp', 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => el('i'))), el('span', { class: 'val', id: 'mxRespVal' }))), refs.resp, el('p', { class: 'hint', id: 'mxRespNote' })),
            el('div', { class: 'field' }, el('div', { class: 'row' }, el('label', { class: 'grow fh-label', for: 'mxSleep' }, ico('sleep'), 'Sleep after'), refs.sleep))),
          el('div', { class: 'group' },
            toggle('mxWin', 'Disable the Windows key', 'winLock'),
            toggle('mxAltF4', 'Disable Alt + F4', 'altF4Lock'),
            toggle('mxAltTab', 'Disable Alt + Tab', 'altTabLock'),
            toggle('mxFn', 'Swap F-keys and media keys', 'fnSwitch'),
            el('div', { class: 'field' },
              el('p', { class: 'hint first', text: 'The keyboard cannot be asked what it holds, so Apply writes all of these from what this app last sent. Over 2.4G only response, sleep and the F-key swap are sent; the key locks need the USB-C cable.' }),
              el('div', { class: 'btn-row' }, refs.applyS)))));
    }

    /**
     * The F75 HE's Keyboard page: what the keyboard said about itself, and the button that reads it again. There are no settings
     * to change: the Hall-effect ones (actuation point, Rapid Trigger, SOCD) are not driven by this app (he.js).
     */
    function buildInfoPage() {
      refs.readBtn = el('button', { class: 'btn primary', type: 'button', id: 'mxRead', onclick: () => run(max.sync()) }, el('span', { class: 'lbl', text: 'Read from keyboard' }));
      const row = (id, label) => el('div', { class: 'field' }, el('div', { class: 'row' }, el('span', { class: 'grow fh-label', text: label }), el('span', { class: 'val', id })));
      return el('div', { id: 'mxKeyboard' },
        el('div', { class: 'split split-even' },
          el('div', { class: 'group' },
            row('mxInfoModel', 'Keyboard'),
            row('mxInfoLink', 'Connected over'),
            row('mxInfoIds', 'USB ids'),
            row('mxInfoFw', 'Firmware'),
            row('mxInfoBat', 'Battery'),
            row('mxInfoSrc', 'Lighting shown')),
          el('div', { class: 'group' },
            el('div', { class: 'field' },
              el('p', { class: 'hint first', text: 'Reading asks the keyboard who it is, how its lights are set and, if it is showing per-key colours, which ones. It changes nothing on the keyboard.' }),
              el('div', { class: 'btn-row' }, refs.readBtn)),
            el('div', { class: 'field' },
              el('div', { class: 'field-head' }, el('h3', { text: 'Hall-effect settings' })),
              el('p', { class: 'hint', text: 'Actuation point, Rapid Trigger and the other Hall-effect settings are not part of this app yet. It never reads or changes them, so what you set in AULA’s own driver stays as it is.' })))));
    }

    function build() {
      root.textContent = '';
      // same note row as the F75's experimental Keys page; the title row is gone (the tabs and the picture say where you are)
      refs.exp = el('div', { class: 'ka-exp' },
        el('span', { class: 'exp-badge', text: 'Experimental' }),
        el('p', { class: 'hint', text: FAM.note }));

      // ---- lighting
      refs.effects = el('div', { class: 'effects', role: 'radiogroup', 'aria-label': 'Lighting effect' });
      refs.fx = new Map();
      let n = 0;
      for (const e of [...MX.EFFECTS, ...(MX.SOFT_EFFECTS || [])].filter((x) => !x.hidden)) { // an effect the keyboard has but its maker's own app does not offer (the F75 HE's 14) is not offered here either
        const c = el('canvas', { width: 224, height: 76, 'aria-hidden': 'true' });
        const b = el('button', { class: 'effect', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-mode': e.mode, style: `--n:${n++}`, title: EFFECT_INFO[e.mode] || '', onclick: () => max.setLighting({ mode: e.mode }) },
          c,
          el('span', { class: 'effect-name' }, el('span', { text: e.name })),
          el('span', { class: 'effect-tag', text: effectTag(e) }));
        refs.effects.append(b);
        const entry = { b, c, e, hot: false, raf: 0, t0: 0 };
        refs.fx.set(e.mode, entry);
        bindFxHover(entry);
      }
      // Brightness is a slider like the F75's (1 to FAM.brightLevels, the keyboard has no Off level: Off is an effect).
      const BL = FAM.brightLevels;
      refs.bright = el('input', { class: 'range', id: 'mxBright', type: 'range', min: 1, max: BL, step: 1, value: Math.min(4, BL), 'aria-label': 'Brightness' });
      refs.bright.addEventListener('input', () => max.setLighting({ brightness: Number(refs.bright.value) }));
      const meter = (id, count) => el('span', { class: 'meter', id, 'aria-hidden': 'true' }, ...Array.from({ length: count }, () => el('i')));
      refs.speed = seg('mxSpeed', 5, ['1', '2', '3', '4', '5'], 'Speed', (v) => max.setLighting({ speed: v + 1 }));
      refs.dir = seg('mxDir', MX.DIRECTIONS.length, MX.DIRECTIONS, 'Direction', (v) => max.setLighting({ direction: v }));
      refs.light = colourBlock('mxL', () => max.lighting.rgb, (rgb) => rgb && max.setLighting({ rgb, colorful: false }), { swatches: false });
      refs.swatches = el('div', { class: 'swatches', id: 'mxSwatches', role: 'radiogroup', 'aria-label': 'Colour' });
      for (const q of QUICK) {
        refs.swatches.append(el('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-hex': q, title: q, 'aria-label': `Colour ${q}`, style: `background:${q}`, onclick: () => max.setLighting({ rgb: rgbOf(q), colorful: false }) }));
      }
      refs.swatches.append(el('button', { class: 'swatch rainbow', type: 'button', role: 'radio', 'aria-checked': 'false', 'data-hex': 'rainbow', title: 'Multicolour', 'aria-label': 'Multicolour', onclick: () => max.setLighting({ colorful: true }) }));
      refs.applyL = el('button', { class: 'btn primary', type: 'button', id: 'mxApplyL', onclick: () => applyLighting() }, el('span', { class: 'lbl', text: 'Apply to keyboard' }));

      const lighting = el('div', { id: 'mxLighting' },
        el('div', { class: 'split' },
          el('div', { class: 'block' },
            el('div', { class: 'eff-top' },
              el('div', { class: 'block-head' }, el('h2', { text: 'Effect' }), el('span', { class: 'val', id: 'mxEffName' })),
              el('p', { class: 'eff-desc', id: 'mxEffDesc' }),
              el('div', { class: 'eff-chips', id: 'mxEffChips' })),
            refs.effects,
            el('p', { class: 'note', id: 'mxEffNote' })),
          el('div', { class: 'group' },
            el('div', { class: 'field', id: 'mxBrightField' },
              el('div', { class: 'field-head' }, el('h3', {}, ico('bright'), 'Brightness'), el('span', { class: 'fh-right' }, meter('mxMeterBright', BL), el('span', { class: 'val', id: 'mxValBright' }))),
              el('div', { class: 'range-wrap' }, refs.bright, el('div', { class: 'range-ends', 'aria-hidden': 'true' }, el('span', { text: 'Min' }), el('span', { text: 'Max' })))),
            el('div', { class: 'field', id: 'mxSpeedField' },
              el('div', { class: 'field-head' }, el('h3', {}, ico('speed'), 'Speed'), el('span', { class: 'fh-right' }, meter('mxMeterSpeed', 5), el('span', { class: 'val', id: 'mxValSpeed' }))),
              refs.speed),
            el('div', { class: 'field', id: 'mxDirField' }, el('div', { class: 'field-head' }, el('h3', {}, ico('direction'), 'Direction'), el('span', { class: 'val', id: 'mxValDir' })), refs.dir),
            el('div', { class: 'field', id: 'mxColourField' },
              el('div', { class: 'field-head' }, el('h3', {}, ico('colour'), 'Colour'), el('span', { class: 'val', id: 'mxValColour' })),
              refs.swatches,
              refs.light.node,
              el('p', { class: 'hint', id: 'mxColourHint' })),
            el('div', { class: 'field' }, el('div', { class: 'btn-row first' }, refs.applyL)))));

      // ---- per-key
      // The painting happens on the keyboard picture at the top of the window (the F75 screen does the same), so this page
      // only holds the paint colour and the presets.
      const pkBoard = makeBoard(true);
      refs.board = pkBoard.grid;
      refs.boardBox = pkBoard.box;
      refs.keys = pkBoard.keys;
      refs.lamps = pkBoard.lamps;
      refs.stageBox = el('div', { class: 'stage-max', id: 'stageMax' }, pkBoard.box);
      const stageEl = document.querySelector('.stage');
      const canvasWrap = stageEl && stageEl.querySelector('.stage-canvas');
      for (const old of document.querySelectorAll('#stageMax')) old.remove();
      if (canvasWrap) canvasWrap.after(refs.stageBox);

      // The picture moves like the F75's (max-motion.js). It may move while animations are on and the view is Live; the pointer effects
      // stay off on the Per-key page, so the board is square under the brush; and your own key presses only sink a cap on the Lighting page.
      refs.motion = MM
        ? MM.create({
            host: refs.stageBox,
            board: refs.boardBox,
            grid: refs.board,
            keys: refs.keys,
            layout: LAYOUT,
            gridW: (MX.GRID || { w: 16 }).w,
            enabled: () => active && canAnimate() && !stillPicture() && (!ctx.shown || ctx.shown()),
            pointerFx: () => tab !== 'perkey',
            typing: () => tab === 'lighting',
            tint: () => lightMean(lightMoves() ? performance.now() : null),
            repaint: () => {
              if (!lightMoves()) paintKeys(null); // a moving effect repaints itself every frame
            },
          })
        : null;

      // Click or drag on the picture: Select adds (or, starting on a picked key, removes) keys; Brush paints them.
      const ledOf = (e) => {
        const b = e.target.closest && e.target.closest('.mx-key');
        return b && b.dataset.led ? Number(b.dataset.led) : null;
      };
      const touch = (led) => {
        if (led === null) return;
        if (drag === 'brush') paintLeds([led]);
        else {
          if (drag === 'add') sel.add(led);
          else sel.delete(led);
          refreshPerkey();
        }
      };
      refs.board.addEventListener('pointerdown', (e) => {
        if (tab !== 'perkey') return;
        const led = ledOf(e);
        if (led === null) {
          if (pk.tool === 'select' && sel.size) {
            sel.clear();
            refreshPerkey();
          }
          return;
        }
        drag = pk.tool === 'brush' ? 'brush' : sel.has(led) ? 'del' : 'add';
        touch(led);
        e.preventDefault();
      });
      refs.board.addEventListener('pointerover', (e) => drag && touch(ledOf(e)));

      // The card: the same one the F75's Per-key page has (keys.css), in three columns: Tool and Selection, Colour, then Direction,
      // Presets and the two actions.
      const pseg = (id, count, aria, items, attr, onPick) => {
        const box = el('div', { class: `seg seg-${count}`, id, style: `--n:${count}`, role: 'radiogroup', 'aria-label': aria });
        for (const it of items) {
          const btn = el('button', { class: 'seg-btn', role: 'radio', 'aria-checked': 'false', type: 'button', [`data-${attr}`]: it.v, title: it.title, 'aria-label': it.title, onclick: () => onPick(it.v) });
          if (it.svg) btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${it.svg}</svg>`;
          else btn.textContent = it.label;
          box.append(btn);
        }
        return box;
      };
      refs.tool = pseg('mxTool', 2, 'Tool', [{ v: 'select', label: 'Select' }, { v: 'brush', label: 'Brush' }], 'tool', (v) => {
        pk.tool = v;
        savePk();
        refreshPerkey();
      });
      refs.paintSeg = pseg('mxPaintWith', 3, 'Paint with', [{ v: 'solid', label: 'Solid' }, { v: 'gradient', label: 'Gradient' }, { v: 'rainbow', label: 'Rainbow' }], 'paint', (v) => {
        pk.paint = v;
        savePk();
        syncPaint();
        refreshPerkey();
      });
      refs.dirSeg = pseg('mxPkDir', 3, 'Direction', [
        { v: 'x', title: 'Left to right', svg: '<path d="M5 12h14M13 6l6 6-6 6"/>' },
        { v: 'y', title: 'Top to bottom', svg: '<path d="M12 5v14M6 13l6 6 6-6"/>' },
        { v: 'xy', title: 'Diagonal', svg: '<path d="M6 6l12 12M18 9v9H9"/>' },
      ], 'dir', (v) => {
        pk.dir = v;
        savePk();
        syncPaint();
      });
      refs.dirSeg.classList.add('seg-sm');
      const stop = (which, label) => {
        const btn = el('button', { class: 'pk-stop', type: 'button', 'data-stop': which, 'aria-pressed': which === 'a' ? 'true' : 'false', 'aria-label': `${label} colour`, onclick: () => { pk.stop = which; syncPaint(); renderPerkey(); } },
          el('span', { class: 'pk-dot' }), el('span', { class: 'pk-lbl', text: label }));
        return btn;
      };
      refs.stopA = stop('a', 'Start');
      refs.stopB = stop('b', 'End');
      refs.pkBar = el('div', { class: 'pk-bar', 'aria-hidden': 'true' });
      refs.pkInput = el('input', { type: 'color', id: 'mxPkInput', value: pk.a });
      refs.pkHex = el('input', { class: 'text-in mono', id: 'mxPkHex', type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex paint colour', value: pk.a });
      refs.pkInput.addEventListener('input', () => setPkColour(refs.pkInput.value));
      refs.pkHex.addEventListener('input', () => {
        const v = refs.pkHex.value.startsWith('#') ? refs.pkHex.value : `#${refs.pkHex.value}`;
        const rgb = rgbOf(v);
        refs.pkHex.setAttribute('aria-invalid', rgb ? 'false' : 'true');
        if (rgb) setPkColour(hexOf(rgb), { keepHex: true });
      });
      refs.swap = el('button', { class: 'btn ghost pk-swap', type: 'button', title: 'Swap the start and end colours', onclick: () => {
        [pk.a, pk.b] = [pk.b, pk.a];
        savePk();
        syncPaint();
      } });
      refs.swap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/></svg>Swap';
      refs.pkSwatches = el('div', { class: 'swatches small', 'aria-label': 'Quick colours' });
      for (const q of QUICK) refs.pkSwatches.append(el('button', { class: 'swatch', type: 'button', 'aria-label': `Use ${q}`, title: q, style: `background:${q}`, onclick: () => setPkColour(q) }));
      refs.presets = el('div', { class: 'pk-presets', role: 'group', 'aria-label': 'Gradient presets' });
      for (const g of GRADIENTS) {
        refs.presets.append(el('button', { class: 'pk-preset', type: 'button', 'aria-pressed': 'false', 'aria-label': `${g.name} gradient`, title: g.name, 'data-a': g.a, 'data-b': g.b, style: `background:linear-gradient(90deg, ${g.a}, ${g.b})`, onclick: () => {
          pk.a = g.a;
          pk.b = g.b;
          pk.stop = 'a';
          pk.paint = 'gradient';
          savePk();
          syncPaint();
          renderPerkey();
        } }));
      }
      const act = (id, text, cls, onclick) => el('button', { class: cls, type: 'button', id, text, onclick });
      refs.selAll = act('mxSelAll', 'Select all', 'btn ghost', () => {
        for (const k of LAYOUT) sel.add(k.led);
        refreshPerkey();
      });
      refs.selNone = act('mxSelNone', 'Clear selection', 'btn ghost', () => {
        sel.clear();
        refreshPerkey();
      });
      refs.pkOff = act('mxPkOff', 'Turn all off', 'btn ghost', () => max.clearPaint());
      refs.paintSel = act('mxPaintSel', 'Paint selected', 'btn', () => paintLeds([...sel], true));
      refs.fillAll = act('mxFillAll', 'Fill all keys', 'btn', () => paintLeds(LAYOUT.map((k) => k.led)));
      refs.applyK = el('button', { class: 'btn primary', type: 'button', id: 'mxApplyK', onclick: () => run(max.applyKeyColors()) }, el('span', { class: 'lbl', text: 'Apply to keyboard' }));
      const perkey = el('div', { id: 'mxPerkey' },
        el('div', { class: 'split split-one' },
          el('div', { class: 'group pk-card', id: 'mxPkCard', 'data-paint': pk.paint },
            el('div', { class: 'field pk-col pk-col-tool' },
              el('div', { class: 'field-head' }, el('h3', { text: 'Tool' }), el('span', { class: 'val', id: 'mxSelCount' })),
              refs.tool,
              el('div', { class: 'pk-selection' },
                el('div', { class: 'field-head' }, el('h3', { text: 'Selection' })),
                el('div', { class: 'btn-row first' }, refs.selAll, refs.selNone, refs.pkOff))),
            el('div', { class: 'field pk-col pk-col-colour' },
              el('div', { class: 'field-head' }, el('h3', { text: 'Colour' }), el('span', { class: 'val pk-editing', id: 'mxPkEditing' })),
              refs.paintSeg,
              el('div', { class: 'pk-stops' }, refs.stopA, refs.pkBar, refs.stopB),
              el('div', { class: 'pk-edit' },
                el('div', { class: 'color-edit pk-color' }, el('label', { class: 'color-pick' }, el('span', { class: 'sr', text: 'Paint colour' }), refs.pkInput), refs.pkHex),
                refs.swap),
              refs.pkSwatches),
            el('div', { class: 'field pk-col pk-col-do' },
              el('div', { class: 'pk-opts' },
                el('div', { class: 'pk-opt pk-opt-dir' }, el('h3', { text: 'Direction' }), refs.dirSeg),
                el('div', { class: 'pk-opt pk-opt-presets' }, el('h3', { text: 'Presets' }), refs.presets)),
              el('div', { class: 'pk-act' }, refs.paintSel, refs.fillAll))),
          el('div', { class: 'pk-foot' },
            el('div', { class: 'btn-row first' }, refs.applyK),
            el('p', { class: 'hint pk-hint', id: 'mxToolHint' }),
            el('p', { class: 'hint', id: 'mxPkHint' }))));

      // ---- keyboard
      const keyboard = FAM.hasSettings ? buildSettingsPage() : buildInfoPage();

      refs.status = el('p', { class: 'hint mx-status', id: 'mxStatus', role: 'status', 'aria-live': 'polite' });
      root.append(refs.exp, lighting, perkey, keyboard, refs.status);
      refs.sections = { lighting, perkey, keyboard };
    }

    /**
     * Apply on the Lighting page. An effect this app draws (the F75 HE's Snake) keeps writing colours to the keyboard while it runs, which no
     * firmware effect does and which has not been tried on a real F75 HE, so the first time on a real keyboard the person is told and says go on.
     */
    function applyLighting() {
      const e = MX.effect(max.lighting.mode);
      if (e && e.soft && !max.demo && !max.softAck) {
        const ok = window.confirm(`${e.name} is drawn by this app, not by the keyboard. While it runs, the app sends the keyboard a new set of key colours many times a second, and it stops when the app is closed or the keyboard is unplugged.\n\nThis has not been tried on a real ${FAM.name} yet, and it is not known whether the keyboard keeps every update in its permanent memory. Start it?`);
        if (!ok) return;
        max.ackSoft();
      }
      return run(max.applyLighting());
    }

    async function run(promise) {
      const r = await promise;
      if (r.ok) toast(r.confirmed ? 'Applied to the keyboard.' : 'Sent to the keyboard.', 'ok');
      else toast(r.error, 'bad', 7000);
      render();
    }

    // ------------------------------------------------------------------ the effect cards' little keyboards

    const canAnimate = () => (ctx.animate ? !!ctx.animate() : !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    const fxState = () => {
      const l = max.lighting;
      return { rgb: l.rgb, colorful: l.colorful, direction: FAM.fxDir(l.direction), speed: l.speed };
    };
    // What a card's little keyboard is drawn with. The F75 HE's cards are colourful like the F75 screen's: an effect that always runs in
    // several colours is drawn that way whatever single colour was last chosen, and one that can run in either is drawn in multicolour
    // unless it is the running effect (that card shows the real light), Static (its card is the chosen colour) or Off (dark).
    const cardState = (entry) => {
      const st = fxState();
      if (!FAM.colourCards) return st;
      const e = entry.e;
      if (e.mode === 0 || e.mode === 1) return st;
      if (e.color === false) return { ...st, colorful: true };
      return e.mode === max.lighting.mode ? st : { ...st, colorful: true };
    };
    const drawFx = (entry, t) => FX && FX.draw(entry.c, FAM.fxMode(entry.e.mode), t, cardState(entry));

    // Hovering a card plays its effect in its picture, as on the F75 screen.
    function bindFxHover(entry) {
      const run = (now) => {
        if (!entry.t0) entry.t0 = now;
        drawFx(entry, FX.stillTime(FAM.fxMode(entry.e.mode)) + (now - entry.t0) / 1000);
        entry.raf = requestAnimationFrame(run);
      };
      const stop = () => {
        if (!entry.hot) return;
        cancelAnimationFrame(entry.raf);
        entry.hot = false;
        drawFx(entry);
      };
      entry.b.addEventListener('pointerenter', () => {
        if (!FX || !canAnimate() || entry.e.mode === 0) return;
        entry.hot = true;
        entry.t0 = 0;
        entry.raf = requestAnimationFrame(run);
      });
      entry.b.addEventListener('pointerleave', stop);
      entry.b.addEventListener('blur', stop);
    }

    // The chosen effect keeps playing in its own card (the loop ends when the page is left or hidden; render() starts it again).
    let fxRaf = 0;
    let fxLast = 0;
    function fxLoop(now) {
      fxRaf = 0;
      if (!active || tab !== 'lighting' || (ctx.shown && !ctx.shown())) return;
      fxRaf = requestAnimationFrame(fxLoop);
      if (document.hidden || !canAnimate() || now - fxLast < 48) return;
      const entry = refs.fx.get(max.lighting.mode);
      if (!entry || entry.hot || entry.e.mode < 2) return;
      fxLast = now;
      drawFx(entry, FX.stillTime(FAM.fxMode(entry.e.mode)) + now / 1000);
    }
    function kickFx() {
      if (FX && !fxRaf && active && tab === 'lighting') fxRaf = requestAnimationFrame(fxLoop);
    }

    // ------------------------------------------------------------------ the window's tint
    // The whole window takes the colour of the keyboard's light, as on the F75 screen (app.js setGlow, the CSS --glow and
    // --glow-ink): the board's average light, measured the same way. Static is its one colour, Per-key is the painted keys, and a
    // moving effect follows its own drawing at the same moment its card shows, so Spectrum Cycle walks the window through the colours.

    const stillPicture = () => (ctx.getView ? ctx.getView() : 'live') === 'picture'; // Picture: a still image, nothing moves
    /** True while a moving effect is playing on the picture: Live, animations on, an effect that moves, and not the Per-key page. */
    const lightMoves = () => !!FX && canAnimate() && !stillPicture() && tab !== 'perkey' && max.present && max.lighting.mode >= 2;

    /** The board's average light as [r, g, b]. [0, 0, 0] when it is dark: the window then keeps its default light blue. */
    function lightMean(now) {
      if (tab === 'perkey') {
        let r = 0;
        let g = 0;
        let b = 0;
        for (const k of LAYOUT) {
          const c = max.keyColors.get(k.led);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
          }
        }
        return [r / LAYOUT.length, g / LAYOUT.length, b / LAYOUT.length];
      }
      if (!max.present) return [0, 0, 0];
      const l = max.lighting;
      if (l.mode === 0) return [0, 0, 0];
      if (l.mode === 1 && !l.colorful) return l.rgb;
      if (!FX) return l.colorful ? [128, 128, 128] : l.rgb;
      const m = FAM.fxMode(l.mode);
      return FX.mean(m, now === null ? undefined : FX.stillTime(m) + now / 1000, fxState());
    }

    function updateGlow(now = performance.now(), force = true) {
      if (active && ctx.glow) ctx.glow(lightMean(lightMoves() ? now : null), force);
    }

    // A moving effect plays on the picture's keys and tints the window as it goes (about 25 frames a second; the loop ends when the
    // page is left, hidden or still, and render() starts it again).
    let playRaf = 0;
    let playLast = 0;
    let glowLast = 0;
    function playLoop(now) {
      playRaf = 0;
      if (!active || (ctx.shown && !ctx.shown())) return;
      if (!lightMoves()) {
        refs.stageBox.dataset.play = '';
        paintKeys(null); // the effect was stopped (Picture, a new effect that stands still, animations off): the keys settle on its still moment
        return;
      }
      playRaf = requestAnimationFrame(playLoop);
      if (document.hidden || now - playLast < 40) return;
      playLast = now;
      paintKeys(now);
      if (now - glowLast >= 120) {
        glowLast = now;
        updateGlow(now, false);
      }
    }
    function kickPlay() {
      if (!playRaf && active && (!ctx.shown || ctx.shown()) && lightMoves()) playRaf = requestAnimationFrame(playLoop);
    }

    // ------------------------------------------------------------------ drawing

    const setSeg = (box, index) => {
      box.style.setProperty('--i', Math.max(0, index));
      for (const b of box.querySelectorAll('.seg-btn')) b.setAttribute('aria-checked', Number(b.dataset.v) === index ? 'true' : 'false');
    };

    /** Redraws the Colour section of the Per-key card from the paint state. keepHex leaves the hex box alone (so typing is not rewritten). */
    function syncPaint({ keepHex = false } = {}) {
      if (pk.paint !== 'gradient') pk.stop = 'a';
      $('#mxPkCard').dataset.paint = pk.paint;
      refs.paintSeg.style.setProperty('--i', PAINTS.indexOf(pk.paint));
      for (const b of refs.paintSeg.children) b.setAttribute('aria-checked', b.dataset.paint === pk.paint ? 'true' : 'false');
      for (const [which, btn] of [['a', refs.stopA], ['b', refs.stopB]]) {
        btn.style.setProperty('--pk-c', pk[which]);
        btn.setAttribute('aria-pressed', pk.stop === which ? 'true' : 'false');
      }
      const cols = [];
      if (pk.paint === 'rainbow') for (let i = 0; i <= 10; i++) cols.push(hexOf(hue((i / 10) * 306)));
      else cols.push(pk.a, pk.b);
      refs.pkBar.style.background = `linear-gradient(90deg, ${cols.join(', ')})`;
      refs.dirSeg.style.setProperty('--i', DIRS.indexOf(pk.dir));
      for (const b of refs.dirSeg.children) b.setAttribute('aria-checked', b.dataset.dir === pk.dir ? 'true' : 'false');
      for (const b of refs.presets.children) b.setAttribute('aria-pressed', pk.paint === 'gradient' && b.dataset.a === pk.a && b.dataset.b === pk.b ? 'true' : 'false');
      $('#mxPkEditing').textContent = pk.paint === 'gradient' ? `Editing the ${pk.stop === 'a' ? 'start' : 'end'} colour` : '';
      const cur = pk[pk.stop];
      refs.pkInput.value = cur;
      if (!keepHex) {
        refs.pkHex.value = cur;
        refs.pkHex.removeAttribute('aria-invalid');
      }
    }

    /** The Tool column, the hints and which buttons can be pressed. */
    function renderPerkey() {
      $('#mxSelCount').textContent = `${sel.size} ${sel.size === 1 ? 'key' : 'keys'} selected`;
      refs.tool.style.setProperty('--i', pk.tool === 'brush' ? 1 : 0);
      for (const b of refs.tool.children) b.setAttribute('aria-checked', b.dataset.tool === pk.tool ? 'true' : 'false');
      const withWhat = pk.paint === 'gradient' ? 'the gradient below (each key gets the colour for its place)' : pk.paint === 'rainbow' ? 'the rainbow below (each key gets the colour for its place)' : 'the colour below';
      $('#mxToolHint').textContent = pk.tool === 'brush'
        ? `Click or drag across the keys above to paint them with ${withWhat}.`
        : `Click or drag across the keys above to select them, then press Paint selected${pk.paint === 'solid' ? '' : ` (the ${pk.paint} fits those keys)`}.`;
      const note = max.cable
        ? 'Painting only changes the picture. Press Apply to keyboard to write it and switch the keyboard to its user-defined lighting.'
        : max.dongle
          ? FAM.perkeyOverDongle
            ? 'Painting only changes the picture. Over 2.4G the colours go in 21 small pieces, which is the least tried way: the USB-C cable is the safer one.'
            : 'Per-key colours need the USB-C cable: the 2.4G dongle only carries 32 bytes at a time.'
          : '';
      $('#mxPkHint').textContent = `${max.keyColors.size} of ${refs.keys.size} keys lit. ${note}`.trim();
      refs.paintSel.disabled = sel.size === 0;
      refs.selNone.disabled = sel.size === 0;
    }
    function refreshPerkey() {
      paintStage();
      renderPerkey();
    }

    // ------------------------------------------------------------------ the keyboard picture (the F75 screen's stage)

    /**
     * What each key shows on the picture: the painted colours on the Per-key page, the one colour of the Static effect, and, for
     * the moving effects, the same drawing the effect's card plays (max-fx.js), as the F75 screen's picture plays its effects. The
     * keyboard keeps these effects to itself and the app cannot read them back, so this is the app's picture of what the effect
     * does, not a capture of the real thing (the note under the effects says so). `now` is the time of the frame (ms); null draws
     * the effect's still moment, which is what Picture and a window with animations off show.
     */
    function litColours(now = null) {
      if (tab === 'perkey') return (led) => max.keyColors.get(led) || null; // painting always shows its colours
      const l = max.lighting;
      if (!max.present || l.mode === 0) return null;
      if (l.mode === 1 && !l.colorful) return () => l.rgb;
      if (!FX) return null;
      const m = FAM.fxMode(l.mode);
      const t = now === null ? undefined : FX.stillTime(m) + now / 1000;
      const st = { ...fxState(), layout: LAYOUT }; // the effects that follow a path through the keys (the Snake) walk this picture's own keys
      // A key you press on your own keyboard lights on the picture too, with the effects that answer key presses (as on the F75 screen).
      const mo = now !== null && (MX.effect(l.mode) || {}).reactive ? refs.motion : null;
      return (led) => {
        const k = BYLED.get(led);
        const c = k ? FX.lit(m, k, t, st) : null;
        const g = mo ? mo.glow(led) : 0;
        if (g < 0.03) return c;
        const real = st.colorful ? hue((led * 53) % 360).map((v) => Math.round(v * g)) : st.rgb.map((v) => Math.round(v * g));
        return !c || real[0] + real[1] + real[2] > c[0] + c[1] + c[2] ? real : c;
      };
    }

    /** How much of full strength the picture's light is drawn at: the brightness level as a share of the keyboard's levels (1 / levels .. 1). */
    function brightShare() {
      const n = Math.max(1, FAM.brightLevels);
      const v = Number(max.lighting.brightness);
      return Number.isFinite(v) ? Math.min(1, Math.max(1 / n, v / n)) : 1;
    }

    /** Lights the keys (and the under-key lamps) of the picture. Only a key whose light has changed is touched, so a moving effect costs little. */
    function paintKeys(now = null) {
      const colourOf = litColours(now);
      const underlit = refs.boardBox.classList.contains('mx-under') && refs.boardBox.classList.contains('mx-photo');
      const perkey = tab === 'perkey';
      // The brightness level dims everything the picture shows, the way the keyboard does: level 1 is the faintest light, the top level full strength.
      const share = brightShare();
      for (const [led, b] of refs.keys) {
        const c = colourOf ? colourOf(led) : null; // the key's colour at full strength (also what the legend's ink is chosen against)
        const selected = perkey && sel.has(led);
        const sh = refs.motion ? share * refs.motion.lightFactor(led) : share; // while the lights sweep on, each key is part way lit
        const sig = `${c ? c.join() : ''}|${sh.toFixed(3)}|${perkey ? 1 : 0}${selected ? 1 : 0}${underlit ? 1 : 0}`;
        if (b._sig === sig) continue;
        b._sig = sig;
        const cd = c ? c.map((v) => Math.round(v * sh)) : null; // the colour as the keyboard shows it at this brightness
        b.style.setProperty('--c', cd ? hexOf(cd) : '');
        // The key's light as hue and strength (as the F75's preview takes it): the hue at full strength, and how bright the key is.
        const peak = cd ? Math.max(cd[0], cd[1], cd[2]) : 0;
        const strength = peak ? (peak / 255).toFixed(3) : '0';
        const full = peak ? hexOf(c.map((v) => Math.round((v * 255) / Math.max(1, Math.max(c[0], c[1], c[2]))))) : '';
        for (const t of [b, refs.lamps.get(led)]) {
          if (!t) continue;
          t.style.setProperty('--b', strength);
          t.style.setProperty('--hue', full);
          t.dataset.on = c ? '1' : '';
        }
        // Painting (the Per-key page) prints the legend to suit the painted cap; lighting leaves the cap and its print as they are
        // and the style sheet lets the legend take a little of the light.
        b.style.color = c && !(underlit && tab !== 'perkey') ? ink(c) : '';
        b.dataset.on = c ? '1' : '';
        b.dataset.sel = selected ? '1' : '';
      }
    }

    function paintStage() {
      paintKeys(lightMoves() ? performance.now() : null);
      refs.stageBox.dataset.paint = tab === 'perkey' ? '1' : '';
      refs.stageBox.dataset.play = lightMoves() ? '1' : ''; // a moving effect is playing on the picture (the style sheet drops the key fades then)
      updateGlow(); // the window's tint follows what was just painted or chosen

      // the chips along the foot of the picture and the Live / Picture switch: the same ones the F75 screen has
      const $$ = (sel) => document.querySelector(sel);
      const l = max.lighting;
      const e = MX.effect(l.mode);
      const perkey = tab === 'perkey';
      const link = max.present ? [max.cable ? 'USB-C' : null, max.dongle ? '2.4G' : null].filter(Boolean).join(' + ') : 'Not found';
      const set = (sel, text) => { const n = $$(`${sel} b`); if (n) n.textContent = text; };
      set('#sbModel', FAM.model);
      set('#sbLink', link);
      if ($$('#sbLink')) $$('#sbLink').dataset.s = max.present ? 'ok' : 'bad';
      if ($$('#sbTx')) $$('#sbTx').hidden = true;
      const fx = $$('#sbFx');
      if (fx) {
        fx.hidden = !perkey && !e;
        set('#sbFx', perkey ? 'Per-key' : e ? e.name : '');
      }
      const sw = $$('#sbColor');
      if (sw) {
        const showColour = !perkey && !!e && e.color;
        sw.hidden = !showColour;
        if (showColour) {
          sw.querySelector('.sb-sw').style.background = l.colorful ? 'conic-gradient(#f33, #fa0, #ee0, #3d6, #0cf, #55f, #b4f, #f3a, #f33)' : hexOf(l.rgb);
          sw.querySelector('b').textContent = l.colorful ? 'Multicolour' : hexOf(l.rgb).toUpperCase();
        }
      }
      const sp = $$('#sbSpeed');
      if (sp) {
        sp.hidden = perkey || !e || l.mode === 0 || l.mode === 1;
        set('#sbSpeed', `Speed ${l.speed}/5`);
      }
      const br = $$('#sbBright');
      if (br) {
        br.hidden = !perkey && l.mode === 0;
        set('#sbBright', `Brightness ${l.brightness}/${FAM.brightLevels}`);
      }
      const sv = $$('#stageView');
      if (sv) {
        const picture = (ctx.getView ? ctx.getView() : 'live') === 'picture';
        sv.hidden = perkey || tab === 'keyboard'; // painting and the keyboard page always show the board, as on the F75
        for (const b of sv.querySelectorAll('.sv-btn')) b.setAttribute('aria-pressed', String((b.dataset.view === 'picture') === picture));
        sv.dataset.live = picture ? 'pic' : !max.present || l.mode === 0 ? 'off' : 'on';
        const stage = sv.closest('.stage');
        if (stage) stage.dataset.pic = picture && !sv.hidden ? '1' : ''; // Picture: only the image, as on the F75 screen
      }
    }

    /** The F75 HE's Keyboard page: what the keyboard said about itself (nothing is invented: unread things say so). */
    function renderInfo() {
      const i = max.info;
      const set = (id, text) => {
        const n = $(id);
        if (n) n.textContent = text;
      };
      const hex4 = (v) => v.toString(16).padStart(4, '0');
      set('#mxInfoModel', max.present ? `${FAM.model}${max.demo ? ' (demo)' : ''}` : 'Not found');
      set('#mxInfoLink', max.present ? [max.cable ? 'USB-C' : null, max.dongle ? '2.4G dongle' : null].filter(Boolean).join(' + ') : 'Not found');
      set('#mxInfoIds', i ? `${hex4(i.vid)}:${hex4(i.pid)}` : 'Not read yet');
      set('#mxInfoFw', i ? i.version || 'Not reported' : 'Not read yet');
      const p = batteryPercent();
      set('#mxInfoBat', p !== null ? `${p}%${max.battery.charging ? ', charging' : ''}` : max.dongle && max.cable ? 'Not shown while the cable is plugged in' : max.dongle ? 'No reading' : 'Needs the 2.4G dongle');
      set('#mxInfoSrc', max.fromKeyboard ? 'Read from the keyboard' : max.present ? 'What this app last sent (not read yet)' : '—');
    }

    // What the lights-on sweep needs to remember to know when to play: the effect that was showing and whether the view was Picture.
    let lastMode = null;
    let lastPic = null;
    /**
     * The picture's lights sweep on from left to right when the keyboard is first shown (slowly), and again, quickly, when the effect
     * changes on the Lighting page or Live comes back after Picture: the cues the F75 screen has. Called before the keys are painted, so
     * the sweep's first moment is what gets painted.
     */
    function motionCue(l) {
      const m = refs.motion;
      if (!m) return;
      const pic = stillPicture();
      if (lastMode === null) m.intro(false);
      else if ((l.mode !== lastMode && tab === 'lighting') || (lastPic && !pic)) m.intro(true);
      lastMode = l.mode;
      lastPic = pic;
      m.sync(); // starts or stops the motion to match animations on / off and Live / Picture
    }

    function render() {
      if (!active) return;
      const l = max.lighting;
      const e = MX.effect(l.mode);
      for (const [name, node] of Object.entries(refs.sections)) node.hidden = name !== tab;
      motionCue(l);

      // lighting
      const animating = canAnimate();
      for (const [mode, entry] of refs.fx) {
        const on = mode === l.mode;
        entry.b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (!entry.hot && !(on && animating && mode > 1)) drawFx(entry);
      }
      kickFx();
      $('#mxEffName').textContent = e ? e.name : '';
      $('#mxEffDesc').textContent = e ? EFFECT_INFO[e.mode] || '' : '';
      const chips = $('#mxEffChips');
      chips.textContent = '';
      if (e && e.mode !== 0) {
        chips.append(el('span', { class: 'chip accent', text: effectTag(e) }));
        chips.append(el('span', { class: 'chip', text: e.mode === 1 ? 'Fixed speed' : 'Adjustable speed' }));
        if (e.direction) chips.append(el('span', { class: 'chip', text: 'Adjustable direction' }));
        chips.append(e.soft ? el('span', { class: 'chip', text: 'Runs while the app is open' }) : el('span', { class: 'chip mono', text: `Mode ${e.mode}` }));
      }
      $('#mxEffNote').textContent = e && e.mode === 0
        ? 'All lighting is switched off.'
        : e && e.soft
          ? (max.animating
              ? `${e.name} is running. To stop it, choose another effect and press Apply to keyboard. Changes to speed, colour or direction take effect when you press Apply again.`
              : `${e.name} is drawn by this app, not by the keyboard: it runs only while the app is open. Press Apply to keyboard to start it. It takes over the keyboard’s per-key colours while it runs; Apply on the Per-key page puts yours back.`)
          : FAM.fxNote;
      refs.bright.value = String(l.brightness);
      refs.bright.style.setProperty('--pf', (l.brightness - 1) / Math.max(1, FAM.brightLevels - 1));
      refs.bright.setAttribute('aria-valuetext', `Level ${l.brightness} of ${FAM.brightLevels}`);
      setSeg(refs.speed, l.speed - 1);
      setSeg(refs.dir, l.direction);
      $('#mxValBright').textContent = `Level ${l.brightness} of ${FAM.brightLevels}`;
      $('#mxValSpeed').textContent = `Level ${l.speed} of 5`;
      for (const [id, n] of [['#mxMeterBright', l.brightness], ['#mxMeterSpeed', l.speed]]) [...$(id).children].forEach((tick, i) => tick.classList.toggle('on', i < n));
      $('#mxValDir').textContent = MX.DIRECTIONS[l.direction] || '';
      $('#mxValColour').textContent = l.colorful ? 'Multicolour' : hexOf(l.rgb).toUpperCase();
      const off = l.mode === 0;
      $('#mxBrightField').hidden = off;
      $('#mxSpeedField').hidden = off || l.mode === 1;
      $('#mxDirField').hidden = !(e && e.direction);
      $('#mxColourField').hidden = !(e && e.color);
      for (const sw of refs.swatches.children) {
        const hit = sw.dataset.hex === 'rainbow' ? l.colorful : !l.colorful && sw.dataset.hex === hexOf(l.rgb).toLowerCase();
        sw.setAttribute('aria-checked', hit ? 'true' : 'false');
      }
      refs.light.input.value = hexOf(l.rgb);
      if (document.activeElement !== refs.light.text) refs.light.text.value = hexOf(l.rgb);
      refs.light.input.closest('.color-edit').hidden = l.colorful;
      const hint = $('#mxColourHint');
      hint.hidden = !l.colorful;
      hint.textContent = l.colorful ? 'Multicolour is on, so the keyboard uses its own palette.' : '';

      // per-key, and the keyboard picture at the top
      paintStage();
      kickPlay(); // a moving effect keeps playing on the picture and tinting the window (the loop ends when the page is left or hidden; this starts it again)
      syncPaint({ keepHex: document.activeElement === refs.pkHex });
      renderPerkey();

      // keyboard
      if (FAM.hasSettings) {
        const s = max.settings;
        setSeg(refs.resp, s.response - 1);
        $('#mxRespVal').textContent = `Level ${s.response} of 5`;
        [...$('#mxMeterResp').children].forEach((tick, i) => tick.classList.toggle('on', i < s.response));
        $('#mxRespNote').textContent = `${MX.RESPONSE_NOTES[s.response]} Raise it if keys double-type.`;
        refs.sleep.value = String(s.sleep);
        for (const k of ['winLock', 'altF4Lock', 'altTabLock', 'fnSwitch']) refs[k].setAttribute('aria-checked', s[k] ? 'true' : 'false');
      } else renderInfo();

      // apply buttons and the status line
      const free = can();
      refs.applyL.disabled = !free;
      if (refs.applyS) refs.applyS.disabled = !free;
      if (refs.readBtn) refs.readBtn.disabled = !free;
      refs.applyK.disabled = !free || (!max.cable && !FAM.perkeyOverDongle);
      for (const b of [refs.applyL, refs.applyK, refs.applyS]) if (b) b.querySelector('.lbl').textContent = max.busy ? 'Applying…' : 'Apply to keyboard';
      if (refs.readBtn) refs.readBtn.querySelector('.lbl').textContent = max.busy ? 'Reading…' : 'Read from keyboard';
      const r = max.last;
      refs.status.dataset.s = r ? (r.ok ? 'ok' : 'bad') : '';
      refs.status.textContent = !max.present
        ? 'Looking for the keyboard. Plug in the USB-C cable or the 2.4G dongle.'
        : r ? (r.ok ? `${r.name[0].toUpperCase()}${r.name.slice(1)}: ${r.note || 'done.'}` : `${r.name[0].toUpperCase()}${r.name.slice(1)} failed: ${r.error}`) : '';
      paintTop();
    }

    /**
     * The battery level worth showing, or null. It is read through the 2.4G dongle. On the F75 HE the dongle has nothing behind it
     * while the cable is plugged in (the keyboard runs wired), so a level kept from before is not shown then.
     */
    function batteryPercent() {
      const p = max.battery.percent;
      if (p === null || !max.dongle) return null;
      if (FAM.readBack && max.cable && !max.demo) return null;
      return p;
    }

    // The header is shared with the F75 screen: connection chip and battery chip.
    function paintTop() {
      if (!active) return;
      const $$ = (id) => document.getElementById(id);
      const text = max.present ? `${FAM.name}, ${max.label}` : 'No keyboard found';
      if ($$('connText')) $$('connText').textContent = text;
      if ($$('connDot')) $$('connDot').dataset.s = max.present ? 'ok' : 'bad';
      const p = batteryPercent();
      if ($$('batChipText')) $$('batChipText').textContent = p !== null ? `${p}%` : 'No reading';
      if ($$('batChip')) {
        $$('batChip').dataset.chg = FAM.readBack && p !== null && max.battery.charging ? '1' : '';
        $$('batChip').dataset.unk = '';
        $$('batChip').dataset.wide = p === null ? '1' : '';
        $$('batChip').dataset.s = p === null ? '' : p <= 15 ? 'bad' : p < 40 ? 'warn' : 'ok';
        $$('batChip').title = max.demo ? 'Battery of the demo keyboard (simulated)' : max.dongle ? 'Battery, read through the 2.4G dongle' : 'The USB-C cable has no battery report. Use the 2.4G dongle to see the level.';
      }
      if ($$('batFill')) $$('batFill').style.width = `${p === null ? 0 : (12.6 * p) / 100}px`;
    }

    // ------------------------------------------------------------------ lifecycle

    async function enter({ confirmed = false } = {}) {
      if (confirmed) await max.confirmModel();
      await max.scan();
      if (!max.present) return false;
      if (!active) build(); // built when it takes the window: the other keyboard's screen shares the same panel
      active = true;
      if (ctx.idlePreview) ctx.idlePreview(true);
      shell.dataset.family = 'max'; // the F75 HE uses the Max's screen layout, so the same styles apply
      shell.dataset.kb = FAM.id;
      shell.dataset.maxView = 'max';
      root.setAttribute('aria-label', FAM.model);
      relabel(true);
      root.hidden = false;
      render();
      // The F75 HE can be read: start from what the keyboard holds rather than from what the app last sent.
      if (FAM.readBack) max.sync().then(() => max.pollBattery()).then(render).catch(() => {});
      else max.pollBattery().then(render);
      return true;
    }

    /** The simulated keyboard (Start screen, "Demo F75 Max" / "Demo F75 HE"): every page works, nothing reaches real hardware. */
    async function enterDemo() {
      if (active && max.demo) return true;
      if (active) leave(); // a real keyboard on screen is let go first
      await max.enterDemo();
      return enter();
    }

    /** Takes this screen's pieces out of the shared panel and the picture (the next keyboard builds its own). */
    function unbuild() {
      if (refs.motion) refs.motion.destroy();
      for (const old of document.querySelectorAll('#stageMax')) old.remove();
      root.textContent = '';
      for (const k of Object.keys(refs)) delete refs[k];
    }

    function leave() {
      if (!active) return;
      active = false;
      lastMode = lastPic = null; // the next keyboard's first picture sweeps on again
      if (ctx.glow) ctx.glow([0, 0, 0], true); // back to the default light blue until the F75 preview (or the next keyboard) sets its own
      if (ctx.idlePreview) ctx.idlePreview(false);
      shell.dataset.family = '';
      shell.dataset.kb = '';
      shell.dataset.maxView = '';
      relabel(false);
      root.hidden = true;
      unbuild();
      max.disconnect();
      if (ctx.onLeave) ctx.onLeave();
    }

    // The header's tab bar is shared: while an F75 Max or F75 HE is connected its "Keys" tab is that keyboard's Keyboard section.
    // The tabs are icons now, so the relabel changes the tab's name (tooltip and screen-reader label), not its text.
    let savedKeysLabel = null;
    function relabel(on) {
      const k = document.getElementById('tab-keys');
      if (!k) return;
      if (on) {
        if (savedKeysLabel === null) savedKeysLabel = { label: k.getAttribute('aria-label'), title: k.title };
        k.setAttribute('aria-label', 'Keyboard');
        k.title = 'Keyboard';
      } else if (savedKeysLabel !== null) {
        if (savedKeysLabel.label !== null) k.setAttribute('aria-label', savedKeysLabel.label);
        k.title = savedKeysLabel.title;
        savedKeysLabel = null;
      }
    }

    /** The app's tab → the Max section it stands for, or null for the app's own panels (Settings). */
    const SECTION = { lighting: 'lighting', perkey: 'perkey', keys: 'keyboard' };
    function show(appTab) {
      const sec = SECTION[appTab] || null;
      if (sec) tab = sec;
      shell.dataset.maxView = sec ? 'max' : 'app';
      render();
    }

    /** Looks for the keyboard now and then (the page has no plug events for interfaces it has not opened). */
    let timer = 0;
    let batteryTimer = 0;
    // Out of focus (a game in front, or hidden in the tray): nothing is sent to the keyboard, apart from a battery read
    // every AWAY_MS. Coming back to the window looks again within a tick.
    const AWAY_MS = 10 * 60 * 1000;
    let awaySince = 0;
    let lastAway = 0;
    const offFocus = () => {
      try {
        return !!ctx.isAway && !!ctx.isAway();
      } catch (_) {
        return false;
      }
    };
    /** 0 = not away, 1 = away, ask nothing, 2 = away and the slow battery read is due. */
    function away() {
      if (!offFocus()) {
        awaySince = 0;
        return 0;
      }
      const now = Date.now();
      if (!awaySince) {
        awaySince = now;
        lastAway = now;
        return 1;
      }
      if (now - lastAway >= AWAY_MS) {
        lastAway = now;
        return 2;
      }
      return 1;
    }
    async function tick() {
      const a = away();
      if (a) {
        if (a === 2 && active && max.dongle) max.pollBattery().then(render).catch(() => {});
        return;
      }
      const had = max.present;
      const found = await max.scan();
      if (active) {
        missed = found ? 0 : missed + 1;
        if (missed >= 2) leave();
        else render();
      } else if (found && !ctx.busyElsewhere()) {
        await enter();
      } else if (had !== found) {
        ctx.onPresence && ctx.onPresence();
      }
    }

    function watch(ms = 2500) {
      if (timer) return;
      timer = setInterval(() => tick().catch(() => {}), ms);
      batteryTimer = setInterval(() => active && max.dongle && !offFocus() && max.pollBattery().then(render), 15000);
      tick().catch(() => {});
    }

    max.on('change', render);
    max.on('presence', render);
    max.on('busy', render);
    if (max.animating !== undefined) max.on('animation', render); // the F75 HE's Snake starting or stopping
    max.on('battery', render);

    return {
      family: FAM.id,
      max,
      active: () => active,
      enter,
      enterDemo,
      leave,
      watch,
      render,
      paintTop,
      show,
      refresh: async () => {
        await max.scan();
        if (max.dongle) await max.pollBattery();
        render();
      },
      stop: () => {
        clearInterval(timer);
        clearInterval(batteryTimer);
        timer = batteryTimer = 0;
      },
    };
  }

  /**
   * The screen for every keyboard family here, as one thing for the app: at most one of them is on screen, and the others
   * are not started while it is. `max` is the session of the keyboard on screen (or the F75 Max's, when none is).
   */
  function create(ctx) {
    const inst = [];
    const others = (me) => inst.some((u) => u !== me && u.active());
    for (const fam of Object.values(FAMILIES)) {
      if (!fam.api) continue;
      let me = null;
      me = createFamily({ ...ctx, busyElsewhere: () => ctx.busyElsewhere() || others(me) }, fam);
      if (me) inst.push(me);
    }
    if (!inst.length) return null;
    const current = () => inst.find((u) => u.active()) || null;
    const by = (id) => inst.find((u) => u.family === id) || null;
    return {
      get max() {
        return (current() || inst[0]).max;
      },
      sessions: inst.map((u) => u.max),
      families: inst.map((u) => u.family),
      session: (id) => (by(id) ? by(id).max : null),
      family: () => (current() ? current().family : null),
      active: () => !!current(),
      async enter({ family = 'max', confirmed = false } = {}) {
        const u = by(family);
        if (!u) return false;
        for (const o of inst) if (o !== u) o.leave();
        return u.enter({ confirmed });
      },
      async enterDemo(family = 'max') {
        const u = by(family);
        if (!u) return false;
        for (const o of inst) if (o !== u) o.leave();
        return u.enterDemo();
      },
      leave: () => inst.forEach((u) => u.leave()),
      watch: (ms) => inst.forEach((u) => u.watch(ms)),
      stop: () => inst.forEach((u) => u.stop()),
      render: () => current() && current().render(),
      paintTop: () => current() && current().paintTop(),
      show: (appTab) => current() && current().show(appTab),
      refresh: () => (current() ? current().refresh() : Promise.resolve()),
    };
  }

  window.AulaMaxUI = { create, FAMILIES };
})();
