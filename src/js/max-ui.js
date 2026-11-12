/*
 * The F75 Max screen. When an F75 Max is connected this replaces the F75's preview and panels (the Max has its own
 * effects, levels and per-key table, see max.js) with one panel of three sections: Lighting, Per-key and Keyboard.
 *
 * It only ever shows what the app really knows. The keyboard cannot be read back, so the controls show what was last
 * sent, and the status line says whether the keyboard acknowledged the last write or whether it was sent blind (2.4G).
 */
(function () {
  'use strict';

  const MX = window.AulaMax;
  if (!MX) return;

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
  const ink = (rgb) => ((rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150 ? '#10131a' : '#ffffff');

  function hue(h) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  }

  function create(ctx) {
    const { storage, toast = () => {} } = ctx;
    const max = new MX.MaxSession({ storage });
    const root = document.getElementById('maxRoot');
    const shell = document.querySelector('.shell');
    if (!root || !shell) return null;

    let active = false;
    let tab = 'lighting'; // which section of the Max screen is showing: lighting | perkey | keyboard
    let brush = [124, 214, 255];
    let painting = false;
    let missed = 0;
    const refs = {};

    const $ = (sel) => root.querySelector(sel);
    const can = () => !max.busy && max.present;

    // ------------------------------------------------------------------ building

    function seg(id, count, labels, aria, onPick) {
      const box = el('div', { class: 'seg', id, role: 'radiogroup', 'aria-label': aria, style: `--n:${count};grid-template-columns:repeat(${count},1fr)` });
      labels.forEach((label, v) => box.append(el('button', { class: 'seg-btn', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-v': v, text: label, onclick: () => onPick(v) })));
      return box;
    }

    function colourBlock(prefix, getRgb, setRgb) {
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
      return { input, text, sw, node: el('div', {}, el('div', { class: 'color-edit' }, el('label', { class: 'color-pick' }, el('span', { class: 'sr', text: 'Colour' }), input), text), sw) };
    }

    // The picture of the Max. It is the same one on two pages: the Per-key page (keys you can paint) and the top of the
    // Lighting page (just a picture, `interactive` false). The F75 Max has its own look (skins.js): graphite case,
    // green-sided Esc / Enter / arrows, a knob and a small screen.
    // The rendered picture of the Max (src/img/board, made by scripts/render-board/render.py, the same kind of picture
    // the F75, F75 Pro and F87 have): the case, plate, knob and screen are one image behind the keys, and each key
    // wears the sprite of its keycap. Without the pictures (or if one fails to load) the board is drawn with CSS.
    function makeBoard(interactive) {
      const grid = el('div', { class: 'mx-grid', role: interactive ? 'group' : null, 'aria-label': interactive ? 'Keys' : null });
      const box = el('div', { class: 'mx-board' }, grid);
      const keys = new Map();
      const SK = window.AulaSkins;
      const skin = SK ? SK.get('max') : null;
      const man = window.AulaBoardManifest;
      const pics = man && man.skins && man.skins.max && man.skins.max.base ? man.skins.max : null;
      const picUrl = (file) => `url(\"${(man.dir || '') + file}\")`;
      for (const k of MX.keyLayout()) {
        const attrs = { class: 'mx-key', 'data-led': k.led, text: k.label, style: `left:${(k.x / 16) * 100}%;top:${(k.y / 6) * 100}%;width:${(k.w / 16) * 100}%;height:${(1 / 6) * 100}%` };
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
        }
        keys.set(k.led, b);
        grid.append(b);
      }
      if (skin) {
        const pos = (o) => Object.entries(o).map(([key, v]) => `${key}:${v}`).join(';');
        const sc = skin.screen;
        const kn = skin.knob;
        grid.append(
          el('div', { class: 'mx-screen', 'aria-hidden': 'true', style: pos({ left: `${(sc.x / 16) * 100}%`, top: `${(sc.y / 6) * 100}%`, width: `${(sc.w / 16) * 100}%`, height: `${(sc.h / 6) * 100}%` }) }),
          el('div', { class: 'mx-knob', 'aria-hidden': 'true', style: pos({ left: `${(kn.x / 16) * 100}%`, top: `${(kn.y / 6) * 100}%`, width: `${((kn.r * 2) / 16) * 100}%` }) }),
        );
        for (const [name, v] of Object.entries(SK.cssVars(skin))) box.style.setProperty(name, v);
      }
      if (pics) {
        const base = pics.base;
        const bx = (v) => `${(v / base.w) * 100}%`;
        const by = (v) => `${(v / base.h) * 100}%`;
        box.classList.add('mx-photo');
        box.style.backgroundImage = picUrl(base.file);
        box.style.aspectRatio = `${base.w} / ${base.h}`;
        box.style.setProperty('--ar', String(base.w / base.h)); // the stage fits the picture to its height with this
        // the keys' grid sits where the picture has its key block: 16 x 6 key units, `scale` pixels each
        grid.style.cssText = `left:${bx(base.ox)};top:${by(base.oy)};width:${bx(16 * man.scale)};height:${by(6 * man.scale)}`;
        const probe = new Image();
        probe.onerror = () => {
          box.classList.remove('mx-photo');
          box.style.backgroundImage = box.style.aspectRatio = grid.style.cssText = '';
          box.style.removeProperty('--ar');
        };
        probe.src = (man.dir || '') + base.file;
      }
      return { box, grid, keys };
    }

    function build() {
      root.textContent = '';
      // same note row as the F75's experimental Keys page; the title row is gone (the tabs and the picture say where you are)
      refs.exp = el('div', { class: 'ka-exp' },
        el('span', { class: 'exp-badge', text: 'Experimental' }),
        el('p', { class: 'hint', text: 'Support for the F75 Max is experimental. It follows protocol notes confirmed on real keyboards by other projects, and it has not been tried on one by this app’s author. If something does not behave, tell me what you saw.' }));

      // ---- lighting
      refs.effects = el('div', { class: 'effects mx-effects', role: 'radiogroup', 'aria-label': 'Lighting effect' });
      for (const e of MX.EFFECTS) {
        const tags = [e.reactive ? 'on key press' : '', e.direction ? 'direction' : ''].filter(Boolean).join(' · ');
        refs.effects.append(
          el('button', { class: 'effect mx-effect', role: 'radio', 'aria-checked': 'false', type: 'button', 'data-mode': e.mode, onclick: () => max.setLighting({ mode: e.mode }) },
            el('span', { class: 'effect-name' }, el('span', { text: e.name })),
            el('span', { class: 'effect-tag', text: tags || ' ' })),
        );
      }
      refs.bright = seg('mxBright', 5, ['1', '2', '3', '4', '5'], 'Brightness', (v) => max.setLighting({ brightness: v + 1 }));
      refs.speed = seg('mxSpeed', 5, ['1', '2', '3', '4', '5'], 'Speed', (v) => max.setLighting({ speed: v + 1 }));
      refs.dir = seg('mxDir', 4, MX.DIRECTIONS, 'Direction', (v) => max.setLighting({ direction: v }));
      refs.light = colourBlock('mxL', () => max.lighting.rgb, (rgb) => rgb && max.setLighting({ rgb }));
      refs.colourful = el('button', { class: 'switch', id: 'mxColourful', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Rainbow colours', type: 'button', onclick: () => max.setLighting({ colorful: !max.lighting.colorful }) }, el('i'));
      refs.applyL = el('button', { class: 'btn primary', type: 'button', id: 'mxApplyL', onclick: () => run(max.applyLighting()) }, el('span', { class: 'lbl', text: 'Apply to keyboard' }));

      const lighting = el('div', { id: 'mxLighting' },
        el('div', { class: 'split' },
          el('div', { class: 'block' }, el('div', { class: 'block-head' }, el('h2', { text: 'Effect' }), el('span', { class: 'val', id: 'mxEffName' })), refs.effects, el('p', { class: 'note', id: 'mxEffNote' })),
          el('div', { class: 'group' },
            el('div', { class: 'field' }, el('div', { class: 'field-head' }, el('h3', {}, ico('bright'), 'Brightness'), el('span', { class: 'val', id: 'mxValBright' })), refs.bright),
            el('div', { class: 'field', id: 'mxSpeedField' }, el('div', { class: 'field-head' }, el('h3', {}, ico('speed'), 'Speed'), el('span', { class: 'val', id: 'mxValSpeed' })), refs.speed),
            el('div', { class: 'field', id: 'mxDirField' }, el('div', { class: 'field-head' }, el('h3', {}, ico('direction'), 'Direction'), el('span', { class: 'val', id: 'mxValDir' })), refs.dir),
            el('div', { class: 'field', id: 'mxColourField' },
              el('div', { class: 'field-head' }, el('h3', {}, ico('colour'), 'Colour'), el('span', { class: 'fh-right' }, el('span', { class: 'val', id: 'mxValColour' }), refs.colourful)),
              refs.light.node,
              el('p', { class: 'hint', id: 'mxColourHint' })),
            el('div', { class: 'field' }, el('div', { class: 'btn-row first' }, refs.applyL)))));

      // ---- per-key
      // The painting happens on the keyboard picture at the top of the window (the F75 screen does the same), so this page
      // only holds the paint colour and the presets.
      const pk = makeBoard(true);
      refs.board = pk.grid;
      refs.keys = pk.keys;
      refs.stageBox = el('div', { class: 'stage-max', id: 'stageMax' }, pk.box);
      const stageEl = document.querySelector('.stage');
      const canvasWrap = stageEl && stageEl.querySelector('.stage-canvas');
      if (canvasWrap) canvasWrap.after(refs.stageBox);
      const paintAt = (b) => tab === 'perkey' && b && b.dataset && b.dataset.led && max.paint([Number(b.dataset.led)], brush);
      refs.board.addEventListener('pointerdown', (e) => {
        if (tab !== 'perkey') return;
        const b = e.target.closest('.mx-key');
        if (!b) return;
        painting = true;
        paintAt(b);
        e.preventDefault();
      });
      refs.board.addEventListener('pointerover', (e) => painting && paintAt(e.target.closest('.mx-key')));
      window.addEventListener('pointerup', () => (painting = false));
      refs.paintColour = colourBlock('mxP', () => brush, (rgb) => {
        if (!rgb) return;
        brush = rgb;
        syncBrush();
      });
      refs.applyK = el('button', { class: 'btn primary', type: 'button', id: 'mxApplyK', onclick: () => run(max.applyKeyColors()) }, el('span', { class: 'lbl', text: 'Apply to keyboard' }));
      const perkey = el('div', { id: 'mxPerkey' },
        el('div', { class: 'split split-even' },
          el('div', { class: 'group' },
            el('div', { class: 'field' },
              el('div', { class: 'field-head' }, el('h3', { text: 'Paint' }), el('span', { class: 'val', id: 'mxPaintCount' })),
              el('p', { class: 'hint first', text: 'Click or drag over the keys on the picture above to paint them.' })),
            el('div', { class: 'field' }, el('div', { class: 'field-head' }, el('h3', { text: 'Paint colour' })), refs.paintColour.node)),
          el('div', { class: 'group' },
            el('div', { class: 'field' },
              el('div', { class: 'field-head' }, el('h3', { text: 'Presets' })),
              el('div', { class: 'btn-row first' },
                el('button', { class: 'btn', type: 'button', id: 'mxRainbow', text: 'Rainbow', onclick: rainbow }),
                el('button', { class: 'btn', type: 'button', id: 'mxFill', text: 'Fill all keys', onclick: () => max.paint(MX.keyLayout().map((k) => k.led), brush) }),
                el('button', { class: 'btn ghost', type: 'button', id: 'mxClear', text: 'Turn all off', onclick: () => max.clearPaint() })),
              el('p', { class: 'hint', id: 'mxPerkeyHint' })),
            el('div', { class: 'field' }, el('div', { class: 'btn-row first' }, refs.applyK)))));

      // ---- keyboard
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
      const keyboard = el('div', { id: 'mxKeyboard' },
        el('div', { class: 'split split-even' },
          el('div', { class: 'group' },
            el('div', { class: 'field' }, el('div', { class: 'field-head' }, el('h3', { text: 'Key response' }), el('span', { class: 'val', id: 'mxRespVal' })), refs.resp, el('p', { class: 'hint', id: 'mxRespNote' })),
            el('div', { class: 'field' }, el('div', { class: 'row' }, el('label', { class: 'grow fh-label', for: 'mxSleep' }, ico('sleep'), 'Sleep after'), refs.sleep))),
          el('div', { class: 'group' },
            toggle('mxWin', 'Disable the Windows key', 'winLock'),
            toggle('mxAltF4', 'Disable Alt + F4', 'altF4Lock'),
            toggle('mxAltTab', 'Disable Alt + Tab', 'altTabLock'),
            toggle('mxFn', 'Swap F-keys and media keys', 'fnSwitch'),
            el('div', { class: 'field' },
              el('p', { class: 'hint first', text: 'The keyboard cannot be asked what it holds, so Apply writes all of these from what this app last sent. Over 2.4G only response, sleep and the F-key swap are sent; the key locks need the USB-C cable.' }),
              el('div', { class: 'btn-row' }, refs.applyS)))));

      refs.status = el('p', { class: 'hint mx-status', id: 'mxStatus', role: 'status', 'aria-live': 'polite' });
      root.append(refs.exp, lighting, perkey, keyboard, refs.status);
      refs.sections = { lighting, perkey, keyboard };
    }

    function rainbow() {
      const keys = MX.keyLayout();
      for (const k of keys) max.keyColors.set(k.led, hue((k.x / 16) * 330));
      max.paint([], null); // saves and notifies
    }

    async function run(promise) {
      const r = await promise;
      if (r.ok) toast(r.confirmed ? 'Applied to the keyboard.' : 'Sent to the keyboard.', 'ok');
      else toast(r.error, 'bad', 7000);
      render();
    }

    // ------------------------------------------------------------------ drawing

    const setSeg = (box, index) => {
      box.style.setProperty('--i', Math.max(0, index));
      for (const b of box.querySelectorAll('.seg-btn')) b.setAttribute('aria-checked', Number(b.dataset.v) === index ? 'true' : 'false');
    };

    function syncBrush() {
      refs.paintColour.input.value = hexOf(brush);
      refs.paintColour.text.value = hexOf(brush);
      refs.paintColour.text.removeAttribute('aria-invalid');
    }

    // ------------------------------------------------------------------ the keyboard picture (the F75 screen's stage)

    /**
     * What each key shows on the picture, as far as the app really knows (the Max cannot be read back, so nothing is guessed):
     * the painted colours on the Per-key page, the one colour of the Static effect, and nothing for the moving effects.
     */
    function litColours() {
      if (tab === 'perkey') return (led) => max.keyColors.get(led) || null; // painting always shows its colours
      const l = max.lighting;
      if (!max.present) return null; // Picture shows the same colours as Live: a still image of the board as it is now
      if (l.mode === 1 && !l.colorful) return () => l.rgb;
      return null;
    }

    function paintStage() {
      const colourOf = litColours();
      for (const [led, b] of refs.keys) {
        const c = colourOf ? colourOf(led) : null;
        b.style.setProperty('--c', c ? hexOf(c) : '');
        b.style.color = c ? ink(c) : '';
        b.dataset.on = c ? '1' : '';
      }
      refs.stageBox.dataset.paint = tab === 'perkey' ? '1' : '';

      // the chips along the foot of the picture and the Live / Picture switch: the same ones the F75 screen has
      const $$ = (sel) => document.querySelector(sel);
      const l = max.lighting;
      const e = MX.effect(l.mode);
      const perkey = tab === 'perkey';
      const link = max.present ? [max.cable ? 'USB-C' : null, max.dongle ? '2.4G' : null].filter(Boolean).join(' + ') : 'Not found';
      const set = (sel, text) => { const n = $$(`${sel} b`); if (n) n.textContent = text; };
      set('#sbModel', 'AULA F75 Max');
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
        set('#sbBright', `Brightness ${l.brightness}/5`);
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

    function render() {
      if (!active) return;
      const l = max.lighting;
      const e = MX.effect(l.mode);
      for (const [name, node] of Object.entries(refs.sections)) node.hidden = name !== tab;

      // lighting
      for (const b of refs.effects.children) b.setAttribute('aria-checked', Number(b.dataset.mode) === l.mode ? 'true' : 'false');
      $('#mxEffName').textContent = e ? e.name : '';
      $('#mxEffNote').textContent = e && e.reactive ? 'This effect reacts to key presses.' : '';
      setSeg(refs.bright, l.brightness - 1);
      setSeg(refs.speed, l.speed - 1);
      setSeg(refs.dir, l.direction);
      $('#mxValBright').textContent = `Level ${l.brightness} of 5`;
      $('#mxValSpeed').textContent = `Level ${l.speed} of 5`;
      $('#mxValDir').textContent = MX.DIRECTIONS[l.direction] || '';
      $('#mxValColour').textContent = l.colorful ? 'Rainbow' : hexOf(l.rgb).toUpperCase();
      const off = l.mode === 0;
      $('#mxSpeedField').hidden = off || l.mode === 1;
      $('#mxDirField').hidden = !(e && e.direction);
      $('#mxColourField').hidden = !(e && e.color);
      refs.colourful.setAttribute('aria-checked', l.colorful ? 'true' : 'false');
      refs.light.input.value = hexOf(l.rgb);
      refs.light.input.disabled = refs.light.text.disabled = l.colorful;
      if (document.activeElement !== refs.light.text) refs.light.text.value = hexOf(l.rgb);
      $('#mxColourHint').textContent = l.colorful ? 'Rainbow colours are on, so the keyboard uses its own palette.' : 'Switch on rainbow colours to use the keyboard’s own palette instead.';

      // per-key, and the keyboard picture at the top
      paintStage();
      $('#mxPaintCount').textContent = `${max.keyColors.size} of ${refs.keys.size} keys lit`;
      $('#mxPerkeyHint').textContent = max.cable
        ? 'Painting only changes the picture. Apply writes it and switches the keyboard to its user-defined lighting.'
        : max.dongle ? 'Per-key colours need the USB-C cable: the 2.4G dongle only carries 32 bytes at a time.' : '';

      // keyboard
      const s = max.settings;
      setSeg(refs.resp, s.response - 1);
      $('#mxRespVal').textContent = `Level ${s.response}`;
      $('#mxRespNote').textContent = `${MX.RESPONSE_NOTES[s.response]} Raise it if keys double-type.`;
      refs.sleep.value = String(s.sleep);
      for (const k of ['winLock', 'altF4Lock', 'altTabLock', 'fnSwitch']) refs[k].setAttribute('aria-checked', s[k] ? 'true' : 'false');

      // apply buttons and the status line
      const free = can();
      refs.applyL.disabled = refs.applyS.disabled = !free;
      refs.applyK.disabled = !free || !max.cable;
      for (const b of [refs.applyL, refs.applyK, refs.applyS]) b.querySelector('.lbl').textContent = max.busy ? 'Applying…' : 'Apply to keyboard';
      const r = max.last;
      refs.status.dataset.s = r ? (r.ok ? 'ok' : 'bad') : '';
      refs.status.textContent = !max.present
        ? 'Looking for the keyboard. Plug in the USB-C cable or the 2.4G dongle.'
        : r ? (r.ok ? `${r.name[0].toUpperCase()}${r.name.slice(1)}: ${r.note || 'done.'}` : `${r.name[0].toUpperCase()}${r.name.slice(1)} failed: ${r.error}`) : '';
      paintTop();
    }

    // The header is shared with the F75 screen: connection chip and battery chip.
    function paintTop() {
      if (!active) return;
      const $$ = (id) => document.getElementById(id);
      const text = max.present ? `F75 Max, ${max.label}` : 'No keyboard found';
      if ($$('connText')) $$('connText').textContent = text;
      if ($$('connDot')) $$('connDot').dataset.s = max.present ? 'ok' : 'bad';
      const p = max.battery.percent;
      if ($$('batChipText')) $$('batChipText').textContent = max.dongle && p !== null ? `${p}%` : 'No reading';
      if ($$('batChip')) {
        $$('batChip').dataset.chg = '';
        $$('batChip').dataset.unk = '';
        $$('batChip').dataset.wide = p === null ? '1' : '';
        $$('batChip').dataset.s = p === null ? '' : p <= 15 ? 'bad' : p < 40 ? 'warn' : 'ok';
        $$('batChip').title = max.dongle ? 'Battery, read through the 2.4G dongle' : 'The USB-C cable has no battery report. Use the 2.4G dongle to see the level.';
      }
      if ($$('batFill')) $$('batFill').style.width = `${p === null ? 0 : (12.6 * p) / 100}px`;
    }

    // ------------------------------------------------------------------ lifecycle

    async function enter({ confirmed = false } = {}) {
      if (confirmed) await max.confirmModel();
      await max.scan();
      if (!max.present) return false;
      active = true;
      if (ctx.idlePreview) ctx.idlePreview(true);
      shell.dataset.family = 'max';
      shell.dataset.maxView = 'max';
      relabel(true);
      root.hidden = false;
      render();
      max.pollBattery().then(render);
      return true;
    }

    function leave() {
      if (!active) return;
      active = false;
      if (ctx.idlePreview) ctx.idlePreview(false);
      shell.dataset.family = '';
      shell.dataset.maxView = '';
      relabel(false);
      root.hidden = true;
      max.disconnect();
      if (ctx.onLeave) ctx.onLeave();
    }

    // The header's tab bar is shared: while an F75 Max is connected its "Keys" tab is the Max's Keyboard section.
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
    async function tick() {
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
      batteryTimer = setInterval(() => active && max.dongle && max.pollBattery().then(render), 15000);
      tick().catch(() => {});
    }

    max.on('change', render);
    max.on('presence', render);
    max.on('busy', render);
    max.on('battery', render);

    build();
    render();

    return {
      max,
      active: () => active,
      enter,
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

  window.AulaMaxUI = { create };
})();
