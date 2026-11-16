// Liquid glass (Settings > Theme > Style): Classic must stay untouched, the page must carry the switch and sliders, and the
// engine's saved settings must be clamped. glass.js needs a browser, so it is run here against a tiny fake page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

test('glass.css: every rule is under html.glass, so Classic is untouched', () => {
  const css = src('css', 'glass.css')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''); // named glass*, only used under html.glass
  const split = (sel) => {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of sel) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  let rules = 0;
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of split(prelude)) {
      rules++;
      assert.ok(/^html\.glass\b/.test(sel), `selector outside html.glass: ${sel}`);
    }
  }
  assert.ok(rules > 10);
});

test('index.html: loads glass.css and glass.js, and has the Style switch and the four sliders', () => {
  const html = src('index.html');
  assert.ok(html.includes('href="css/glass.css"'));
  assert.ok(html.includes('src="js/glass.js"'));
  assert.ok(html.indexOf('css/lite.css') < html.indexOf('css/glass.css'), 'glass.css must come after lite.css');
  for (const v of ['classic', 'glass']) assert.ok(html.includes(`data-style-pref="${v}"`));
  for (const k of ['blur', 'bezel', 'amount', 'chroma']) assert.ok(html.includes(`data-glass="${k}"`));
  assert.ok(html.includes('id="glassReset"'));
});

function loadGlass(saved) {
  const classes = new Set();
  const root = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const window = { aulaHost: null };
  const ctx = {
    window,
    document: { documentElement: root, readyState: 'complete', body: null, addEventListener() {} },
    localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) },
    ResizeObserver: class { observe() {} unobserve() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(src('js', 'glass.js'), ctx);
  return { G: window.AulaGlass, classes };
}

test('glass.js: Classic by default, glass when saved, and the sliders are clamped', () => {
  assert.strictEqual(loadGlass(null).classes.has('glass'), false);
  const { G, classes } = loadGlass({ style: 'glass', glass: { blur: 99, bezel: -5, amount: 'x', chroma: 50 } });
  assert.ok(classes.has('glass'));
  // objects made inside the fake page belong to another realm, so they are copied before comparing
  assert.deepStrictEqual({ ...G.params() }, { blur: G.LIMITS.blur[1], bezel: G.LIMITS.bezel[0], amount: G.DEFAULTS.amount, chroma: 50 });
  assert.deepStrictEqual({ ...G.clean(null) }, { ...G.DEFAULTS });
});

test('glass.css: every control is a pill, including the sliding highlight of a segmented switcher', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const pill = css.match(/html\.glass :is\(([^)]*)\)\s*\{\s*border-radius:\s*999px/);
  assert.ok(pill, 'a pill rule is missing');
  for (const c of ['.seg', '.seg-btn', '.select', '.text-in', '.color-pick', '.win-btn']) assert.ok(pill[1].includes(c), `${c} is not a pill`);
  // a pseudo-element cannot sit inside :is(), so the highlight has its own rule
  assert.ok(/html\.glass \.seg::before\s*\{\s*border-radius:\s*999px/.test(css));
});

test('glass.css and glass.js: the slider thumb is a glass lens that swells while held', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const js = src('js', 'glass.js');
  assert.ok(/html\.glass \.range-lens\s*\{/.test(css));
  assert.ok(/html\.glass \.range-lens\.held\s*\{\s*scale:\s*1/.test(css), 'the held lens must grow to full size');
  assert.ok(/html\.glass \.range::-webkit-slider-thumb/.test(css), 'the native thumb must be hidden, not removed');
  assert.ok(js.includes("'input.range'") && js.includes("classList.toggle('held'"));
  assert.ok(js.includes('unmountRanges()'), 'switching back to Classic must remove the lenses');
});

// ---- Liquid glass on panels, cards and pills ------------------------------------------------------------------------

const surfaces = () => {
  const js = src('js', 'glass.js');
  const list = (name) => {
    const m = js.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]\\.join\\([^)]*\\)|'[^']*');`));
    assert.ok(m, `${name} not found in glass.js`);
    return m[1];
  };
  return { js, targets: list('TARGETS'), panels: list('PANELS') };
};

test('glass.js: cards, chips, pills, inputs and menus refract, and so do the boxes that hold them', () => {
  const { targets, panels } = surfaces();
  for (const c of ['.effect', '.chip', '.sb-chip', '.stage-view', '.select', '.text-in', '.color-pick', '.win-btn', '.day', '.ka-chip', '.ka-key', '.bat-bar', '.hm-dev', '.toast', '.sup-pop', '.upd-card'])
    assert.ok(targets.includes(c), `${c} is not a glass surface`);
  for (const c of ['.group', '.help-body', '.stage']) assert.ok(panels.includes(c), `${c} is not a glass panel`);
  // a box that holds glass controls must not also be a leaf, or the controls inside would lose the picture
  const has = (list, c) => new RegExp(`(^|[\\s,'])${c.replace('.', '\\.')}(?![\\w-])`).test(list); // .stage must not match .stage-view
  for (const c of ['.group', '.help-body', '.stage']) assert.ok(!has(targets, c), `${c} must not carry the backdrop-filter itself`);
});

test('glass.css: a panel refracts on its ::after layer, never on itself, so the controls inside still see the picture', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const layer = rules.filter((r) => /\.ag-panel::after/.test(r.sel) && /backdrop-filter/.test(r.body));
  assert.ok(layer.length >= 1, 'the panel layer has no backdrop-filter');
  for (const r of layer) assert.ok(/!important/.test(r.body), 'beats lite.css, which switches backdrops off');
  for (const r of rules) {
    if (/::after|::before/.test(r.sel)) continue;
    if (/\.ag-panel\b/.test(r.sel) && !/\.ag\b/.test(r.sel)) assert.ok(!/backdrop-filter/.test(r.body), `the panel itself must not have a backdrop-filter: ${r.sel}`);
  }
  // the layer sits behind the content, inside the panel's own stacking context
  const base = rules.find((r) => /^html\.glass \.ag-panel,/.test(r.sel));
  assert.ok(base && /z-index:\s*0/.test(base.body) && /position:\s*relative/.test(base.body));
  const after = rules.find((r) => /^html\.glass \.ag-panel::after$/.test(r.sel));
  assert.ok(after && /z-index:\s*-1/.test(after.body) && /inset:\s*0/.test(after.body));
});

test('glass.css: nothing else paints on the ::after of a glass panel', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'src', 'css'))) {
    if (f === 'glass.css') continue;
    const css = src('css', f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/(?:^|[\s,}])(?:\.group|\.help-body|\.stage)(?:[.:\[][^\s,{]*)?::after/.test(css), `${f} uses ::after on a glass panel`);
  }
});

test('glass.css: states that the glass would hide are kept (selected, focus, error, message kind)', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const s of ['.effect.ag[aria-checked="true"]', '.day.ag[aria-pressed="true"]', '.ka-key.ag[aria-pressed="true"]', '.text-in.ag[aria-invalid="true"]', '.toast.ag[data-k="bad"]'])
    assert.ok(css.includes(s), `no rule keeps ${s}`);
  assert.ok(/\.text-in, \.select\)\.ag:focus/.test(css), 'inputs lose their focus ring');
  assert.ok(/ag-panel::after \{ backdrop-filter: none !important/.test(css), 'reduced transparency must switch the panel layer off too');
});

test('glass.js: maps are drawn at CSS pixels, only along the rim, and filters nobody uses are dropped', () => {
  const { js } = surfaces();
  assert.ok(!/const BIG\b/.test(js), 'big panels must not get a half-size map any more: their rim went soft');
  assert.ok(!/devicePixelRatio[^;]*\bmw\b|\bmw\b[^;]*devicePixelRatio/.test(js), 'the map stays at CSS pixels: at 200% scaling a screen-density map is four times the pixels for the same rim');
  assert.ok(/new Uint32Array\(px\.buffer\)\.fill\(FLAT\[0\]\)/.test(js), 'the flat middle of the map is filled in one go');
  assert.ok(/side \* 2 >= mw/.test(js) && /for \(let x = 0; x < side; x\+\+\) cell\(x, y\)/.test(js), 'rows away from the top and bottom only need the pixels near the two sides');
  assert.ok(js.includes('function drop(el)') && js.includes('--f.refs') || js.includes('f.refs <= 0'), 'filters must be reference counted');
  assert.ok(js.includes("classList.remove('ag', 'ag-panel')"), 'switching back to Classic must clear panels too');
});

test('glass.js: a filter shifts the picture at most twice, once with no colour fringe, and not at all with no bending', () => {
  const { js } = surfaces();
  const fn = js.slice(js.indexOf('function makeFilter'), js.indexOf('// Gives `el` the filter'));
  assert.ok(/if \(s === 0\)/.test(fn) && /body = frost;/.test(fn), 'no bending: the frost alone, with no map');
  assert.ok(/if \(ca === 0\)/.test(fn) && /disp\(1, 'o'\)/.test(fn), 'no fringe: one shift');
  assert.strictEqual((fn.match(/\bdisp\(/g) || []).length, 3, 'one shift without a fringe, two with it (red/blue)');
  assert.ok(/disp\(1 \+ ca, 'dA'\)/.test(fn) && /disp\(1 - ca, 'dB'\)/.test(fn), 'red a little further, blue a little less');
  assert.ok(/keep\(1, 0\.5, 0\)/.test(fn) && /keep\(0, 0\.5, 1\)/.test(fn), 'green is the mean of the two shifts');
  assert.ok(/operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/.test(fn), 'the two halves are added (they use different colours, so nothing is lost)');
});

test('glass.js: a tiny blur after the shift smooths the one-pixel stairs, except under a strong frost blur', () => {
  const { js } = surfaces();
  const m = js.match(/const smoothing = \(blur\) => \(blur >= (\d+) \? 0 : Math\.max\(([\d.]+), ([\d.]+) \/ dpr\(\)\)\);/);
  assert.ok(m, 'smoothing() not found');
  assert.ok(+m[1] >= 3, 'with a frost blur this strong there are no stairs left to hide');
  assert.ok(+m[3] <= 1 && +m[2] > 0, 'under one screen pixel, or the glass goes soft');
  assert.ok(/const key = `[^`]*\$\{dpr\(\)\}`/.test(js), 'the smoothing depends on the pixel density, so filters must not be shared across densities');
  assert.ok(js.includes("window.addEventListener('resize', onResize)") && js.includes("window.removeEventListener('resize', onResize)"), 'zooming or moving to another screen must rebuild the filters, and Classic must not keep the listener');
});

test('glass.js: the big blocks are a lighter glass than the controls (gentler bend, quieter fringe, softer reflection) with a wide edge and some frost', () => {
  const { js } = surfaces();
  const m = js.match(/const PANEL = \{ bezel: ([\d.]+), amount: ([\d.]+), blur: ([\d.]+) \}/);
  assert.ok(m, 'PANEL factors not found');
  assert.ok(+m[1] > 1 && +m[2] < 1 && +m[3] > 0, 'a panel has a wide edge, bends less than a leaf and still blurs a little');
  const f = js.match(/const PANEL_FRINGE = ([\d.]+)/);
  assert.ok(f && +f[1] < 1 && js.includes('if (panel) ca *= PANEL_FRINGE'), 'a panel splits the colours less than a leaf');
  const r = js.match(/const PANEL_RIM = \{ gain: ([\d.]+), lift: ([\d.]+), floor: ([\d.]+), width: (-?[\d.]+) \}/);
  assert.ok(r && +r[1] < 2.2 && +r[4] <= 0, 'the reflection on a panel is softer and thinner than the one on a leaf (RIM.gain 2.2)');
  assert.ok(js.includes("panel ? 'panel' : lens") && js.includes("lens === 'panel' ? PANEL_RIM"), 'a panel filter ends with its own reflection');
  assert.ok(js.includes('params.bezel * (panel ? PANEL.bezel : 1)') && js.includes('params.blur + panelFrost(panel)'), 'the factors are not applied');
  assert.ok(/const key = `[^`]*\$\{blur\}[^`]*\$\{amount\}/.test(js), 'filters with different panel settings must not share a cache key');
});

test('glass.js: Blur 0 is clear glass, also on panels (their extra frost fades out with the slider)', () => {
  const { js } = surfaces();
  const frost = /const panelFrost = \(panel\) => \(panel \? PANEL\.blur \* Math\.min\(1, params\.blur \/ DEFAULTS\.blur\) : 0\);/.exec(js);
  assert.ok(frost, 'the extra panel frost is scaled by the slider');
  // the same formula, run: nothing at 0, growing with the slider, and exactly the old amount from the default setting upwards
  const m = js.match(/const PANEL = \{ bezel: ([\d.]+), amount: ([\d.]+), blur: ([\d.]+) \}/);
  const d = js.match(/const DEFAULTS = \{ blur: ([\d.]+)/);
  const extra = (b) => +m[3] * Math.min(1, b / +d[1]);
  assert.equal(extra(0), 0, 'no extra frost at 0');
  assert.ok(extra(1) > 0 && extra(1) < extra(+d[1]), 'it grows with the slider');
  for (const b of [+d[1], 6, 12]) assert.equal(extra(b), +m[3], `unchanged at ${b}: the default look does not move`);
  // leaves (pills, buttons) never had it, and the slider lens has its own factor
  assert.ok(js.includes('slider ? Math.round(params.blur * SLIDER.blur * 100) / 100 :'));
});

test('glass.css: nothing above a glass surface may be a backdrop root (mask, opacity fade), or the surface would see no picture', () => {
  const css = src('css', 'glass.css');
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // the scroll area that holds every page has a fade mask in app.css; in glass it must be switched off
  assert.ok(/html\.glass \.panels\s*\{[^}]*mask-image:\s*none/.test(clean), '.panels keeps its mask in glass');
  assert.ok(/-webkit-mask-image:\s*none/.test(clean));
  // every entrance animation used in glass moves or recolours, and never fades (opacity below 1 makes a backdrop root)
  const kfs = [...clean.matchAll(/@keyframes (glass\w+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
  assert.ok(kfs.length >= 5, 'glass keyframes missing');
  for (const k of kfs) assert.ok(!/opacity/.test(k[2]), `${k[1]} must not fade`);
  for (const sel of ['.stage', '.split > *', '.settings > *', '.group > .field', '.panel:not([hidden])', '.overlay-card'])
    assert.ok(clean.includes(sel) && /animation-name:\s*glass/.test(clean), `no glass entrance for ${sel}`);
  assert.ok(/\.group > \.field\s*\{\s*animation-name:\s*glassField/.test(clean));
  // motion.css really fades these, so the override is needed
  assert.ok(/@keyframes riseIn[^}]*opacity/.test(src('css', 'app.css')));
  // and the mask really is what app.css puts on .panels, so this rule is needed
  assert.ok(/\.panels\s*\{[^}]*mask-image/.test(src('css', 'app.css')));
});

// ---- Liquid glass scroll bars and the update progress bar -----------------------------------------------------------------

test('glass.js: every scrolling area gets a glass thumb beside it, its native bar is hidden, and Classic gets everything back', () => {
  const { js } = surfaces();
  const m = js.match(/const SCROLLERS = '([^']+)';/);
  assert.ok(m, 'SCROLLERS not found');
  for (const c of ['.panels', '#maxRoot', '.upd-body']) assert.ok(m[1].includes(c), `${c} keeps its flat native scroll bar`);
  // the thumb is a sibling of the area (a child would scroll away with the content) and is a refracting surface of its own
  assert.ok(js.includes('area.after(bar)'), 'the bar must sit beside the scrolling area, not inside it');
  assert.ok(js.includes("area.setAttribute('data-ag-scroll', '')") && js.includes("area.removeAttribute('data-ag-scroll')"), 'the native bar is hidden only while the glass one is there');
  assert.ok(js.includes('live.add(thumb)') && js.includes('ro.observe(thumb)') && js.includes('drop(thumb)'), 'the thumb gets (and gives back) its refraction filter');
  // a scroll event only moves the thumb; sizes are read when the area or its content resizes
  const scroll = js.slice(js.indexOf('const onScroll = () => {'), js.indexOf('const endDrag'));
  assert.ok(scroll.includes('move()') && !scroll.includes('layout()') && !scroll.includes('scrollHeight'), 'scrolling must not cause layout reads');
  assert.ok(js.includes('roScroll.observe(area)') && js.includes('roScroll.observe(c)'), 'the area and what is in it must be watched for size changes');
  // dragging, wheel and track clicks
  assert.ok(js.includes('setPointerCapture') && js.includes('area.scrollTop = drag.top'), 'the thumb can be dragged');
  assert.ok(/addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(js), 'a wheel turned over the strip must scroll the area');
  assert.ok(js.includes('behavior: \'smooth\''), 'a click beside the thumb pages up or down');
  // switching back to Classic removes the bars and gives the native bar back
  assert.ok(js.includes('unmountScrolls()') && js.includes('function unmountScrolls()'), 'switching back to Classic must remove the glass bars');
  assert.ok(js.includes('for (const area of document.querySelectorAll(SCROLLERS)) mountScroll(area)'), 'areas that appear later are picked up by scan()');
});

test('glass.css: the scroll bar thumb is glass (with the picture bending behind it), the native bar is switched off only where one is drawn', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/html\.glass \[data-ag-scroll\]\s*\{\s*scrollbar-width:\s*none/.test(css), 'the native bar stays unless the glass one is mounted');
  const thumb = css.match(/html\.glass \.ag-scroll-thumb\.ag\s*\{([^}]*)\}/);
  assert.ok(thumb && /backdrop-filter:\s*var\(--ag-filter\)[^;]*!important/.test(thumb[1]), 'the thumb refracts, and beats lite.css, which switches backdrops off');
  assert.ok(/\.ag-scroll\s*\{[^}]*z-index:\s*4/.test(css), 'above the page area, below the apply bar (z-index 5)');
  assert.ok(/\.ag-scroll-thumb\s*\{[^}]*translate:\s*0 var\(--ty/.test(css), 'a scroll only changes a translate');
  assert.ok(/\.ag-scroll:hover[^{]*\.ag-scroll-thumb/.test(css) && /\.ag-scroll\.held/.test(css) && /\.ag-scroll\.busy/.test(css), 'hover, drag and scrolling light the thumb up');
  assert.ok(/html\.glass\[data-theme="light"\] \.ag-scroll-thumb\.ag/.test(css), 'the light theme has its own thumb');
  assert.ok(/prefers-reduced-transparency[\s\S]*\.ag-scroll-thumb\.ag[^}]*backdrop-filter:\s*none/.test(css), 'reduced transparency keeps the thumb visible without the see-through glass');
  // one width only: a thumb that changed width on hover would rebuild its filter on every frame of the change
  assert.ok(!/\.ag-scroll-thumb[^{}]*\{[^}]*transition:[^;}]*\bwidth\b/.test(css), 'the thumb is never resized by a transition');
  // the page area's thin native bar is what this replaces
  assert.ok(/\.panels\s*\{[^}]*scrollbar-width:\s*thin/.test(src('css', 'app.css')));
});

test('update progress bar: Classic keeps its flat fill, Liquid glass gets a glass fill that follows --pf, and no knob (it is not a slider)', () => {
  const html = src('index.html');
  assert.ok(/<div class="upd-bar" id="updBar"[^>]*><i id="updFill"><\/i><\/div>/.test(html), 'the bar holds only its fill');
  const upd = src('css', 'update.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.upd-bar i\s*\{[^}]*scaleX\(0\)/.test(upd), 'Classic keeps its scaleX fill');
  const js = src('js', 'update.js');
  assert.ok(js.includes("$('#updFill').style.transform = `scaleX(${f})`"), 'Classic is still driven by scaleX');
  assert.ok(js.includes("$('#updBar').style.setProperty('--pf', String(f))"), 'the glass bar is driven by --pf');
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/html\.glass \.upd-bar i\s*\{[^}]*transform:\s*none\s*!important/.test(css), 'the inline scaleX must not squash the glass fill');
  assert.ok(/html\.glass \.upd-bar i\s*\{[^}]*width:\s*calc\(100% \* var\(--pf/.test(css), 'the fill width follows --pf');
  assert.ok(/html\.glass \.upd-bar i\s*\{[^}]*rgb\(var\(--ctl\)/.test(css), 'the fill uses the controls\' fixed colour, like the slider');
  assert.ok(/html\.glass \.upd-bar i::after\s*\{/.test(css), 'the fill has its streak of light');
  assert.ok(/html\.glass\[data-theme="light"\] \.upd-bar i\s*\{[^}]*--ctl-ink/.test(css), 'the light theme deepens the fill so it reads on a light card');
  // a knob at the head of the bar made it look like a slider; the tube stays the glass surface
  for (const [name, text] of [['index.html', html], ['update.css', upd], ['glass.css', css], ['glass.js', src('js', 'glass.js')]]) {
    assert.ok(!/upd-lens/.test(text), `${name}: the progress bar has no lens or knob`);
  }
  assert.ok(src('js', 'glass.js').match(/const TARGETS = \[[\s\S]*?\.upd-bar/), 'the tube is a glass surface');
});

// ---- Small surfaces: frost only. No bending and no red/blue split (the blue line on pills, chips, knobs and scroll thumbs) ----

test('glass.js: the smallest surfaces are only frosted, and no control splits colours (no blue edge line)', () => {
  const { G } = loadGlass({ style: 'glass' }); // the default settings: amount 30, chroma 30
  // A status chip, the Live/Picture switch, a switch knob and the 12 px scroll thumb: the cases from the bug report.
  for (const [w, h] of [[120, 28], [96, 26], [80, 22], [12, 318], [38, 26], [42, 28], [60, 35]]) {
    assert.deepStrictEqual({ ...G.rim(w, h, false) }, { amount: 0, ca: 0 }, `${w}x${h}: frost only`);
  }
  // Pills, buttons, inputs and the tab bar (36 to 63 px) bend a little but never split into colours, even at 100% fringe.
  const strong = loadGlass({ style: 'glass', glass: { chroma: 100 } }).G;
  for (const [w, h] of [[200, 36], [160, 44], [300, 52], [66, 44], [90, 63]]) {
    for (const g of [G, strong]) {
      const r = g.rim(w, h, false);
      const side = Math.min(w, h);
      assert.ok(r.amount > 0, `${w}x${h}: still bends a little`);
      assert.ok(r.amount <= side * 0.3 + 0.01, `${w}x${h}: the pull stays a small share of the control`);
      assert.strictEqual(r.ca, 0, `${w}x${h}: no colour split on a control`);
    }
  }
  // Cards and panels are big: they keep what the settings say (a panel is a lighter glass: its 0.6 on top, and half the fringe).
  assert.strictEqual(G.rim(300, 110, false).amount, 30);
  assert.strictEqual(G.rim(1200, 300, true).amount, 18);
  assert.ok(G.rim(1200, 300, true).ca < G.rim(300, 110, false).ca, 'a panel splits the colours less than a card');
  assert.ok(G.rim(300, 110, false).ca > 0 && G.rim(300, 110, false).ca <= 0.18);
  assert.ok(strong.rim(300, 110, false).ca >= G.rim(300, 110, false).ca);
  // The settings still rule: no bending, no fringe.
  const none = loadGlass({ style: 'glass', glass: { amount: 0, chroma: 0 } }).G.rim(120, 28, false);
  assert.deepStrictEqual({ ...none }, { amount: 0, ca: 0 });
  const flat = loadGlass({ style: 'glass', glass: { chroma: 0 } }).G.rim(300, 110, false);
  assert.strictEqual(flat.ca, 0);
});

// ---- The rim is a real reflection, not a painted white line --------------------------------------------------------------

test('glass.js: how much the rim reflects depends on the angle of the edge, strongest facing the light, never gone, smooth round corners', () => {
  const { G } = loadGlass({ style: 'glass' });
  const at = (deg) => G.rimLight(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)); // outward normal: 0 = right, 90 = down (y points down)
  const [topLeft, bottomRight, bottomLeft, topRight] = [at(231), at(51), at(129), at(309)];
  assert.ok(topLeft > bottomRight, 'the edge that faces the light reflects most');
  assert.ok(bottomRight > bottomLeft && bottomRight > topRight, 'the far side catches the light bouncing back: more than the sides in between');
  assert.ok(topLeft > at(270) && at(270) > at(180) && at(180) > bottomLeft, 'it falls off steadily as the edge turns away from the light');
  for (let d = 0; d < 360; d += 5) {
    const v = at(d);
    assert.ok(v > 0.1 && v <= 1, `${d} deg: a thread of reflection always stays (${v})`);
    assert.ok(Math.abs(at(d + 5) - v) < 0.2, `${d} deg: no jump between neighbouring angles (a corner has to turn smoothly)`);
  }
});

test('glass.js: the reflection reaches a few pixels in, and a surface too small to bend fetches its colours from well inside it', () => {
  const { G } = loadGlass({ style: 'glass' });
  for (const [w, h] of [[12, 318], [26, 26], [42, 28], [120, 28], [300, 110], [1200, 300]]) {
    const { width, pull } = G.rimSpec(w, h);
    const side = Math.min(w, h);
    assert.ok(width >= 1.5 && width <= 4, `${w}x${h}: the band is a thin edge, not a frame (${width})`);
    assert.ok(width < side / 2, `${w}x${h}: the band stays inside the surface`);
    assert.ok(pull >= 1 && pull <= side * 0.45 + 0.05, `${w}x${h}: colours are never fetched from beyond the middle (${pull})`);
  }
  assert.ok(G.rimSpec(300, 110).width >= G.rimSpec(26, 26).width, 'a big surface gets the wider band');
});

test('glass.js: every filter ends with the reflection: the bent picture at the rim, or on a small surface the frosted picture fetched from inside', () => {
  const js = src('js', 'glass.js');
  const fn = js.slice(js.indexOf('function makeFilter'), js.indexOf('// Gives `el` the filter'));
  assert.ok(/body \+= rimPass\(w, h, r, s === 0 \? 'b' : 'o', s !== 0, lens\)/.test(fn), 'the reflection is added to every filter, bent or not');
  const pass = js.slice(js.indexOf('function rimPass'), js.indexOf('function makeFilter'));
  assert.ok(/in="\$\{bent \? 'o' : 'rr'\}"/.test(pass), 'a surface that bends reflects the bent picture; a small one the picture fetched again');
  assert.ok(/in="b" in2="rm"/.test(pass), 'the small surface fetches from inside along the direction of each edge');
  assert.ok(/operator="in"/.test(pass) && /operator="over"/.test(pass), 'the reflection is cut to the band, then laid over the finished glass');
  assert.ok(/values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"/.test(pass), 'the blue channel of the rim map is the strength of the reflection');
  const code = (pass + js.slice(js.indexOf('function rimBoost'), js.indexOf('function rimPass'))).replace(/\/\/.*$/gm, ''); // the code, without its comments
  assert.ok(!/rgb\(255,? 255,? 255|#fff|white/i.test(code), 'the reflection has no fixed white in it: it is the picture\'s own colours');
  // the map's blue channel really is written per pixel from the angle of the edge
  const map = js.slice(js.indexOf('function rimMapUrl'), js.indexOf('// ---- one SVG filter'));
  assert.ok(/px\[i \+ 2\] = Math\.round\(255 \* fade \* rimLight\(nx, ny, lens\)\)/.test(map), 'strength = how deep in the band x how the edge faces the light');
  assert.ok(/new Uint32Array\(px\.buffer\)\.fill\(FLAT_RIM\[0\]\)/.test(map), 'the middle of the rim map is flat and empty');
});

test('glass.css: nothing paints a fixed white outline on a glass surface any more (the reflection in the filter is the outline)', () => {
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const rim = rules.find((r) => /^html\.glass$/.test(r.sel) && /--ag-rim/.test(r.body));
  assert.ok(rim, '--ag-rim is missing');
  assert.ok(!/inset\s+-?[\d.]+(?:px)?\s+-?[\d.]+(?:px)?\s+[\d.]+(?:px)?\s+-/.test(rim.body), '--ag-rim has no offset highlights: those were the same on every control');
  assert.ok(/inset 0 0 0 1px rgb\(255 255 255 \/ 0\.(0\d?|10?)\)/.test(rim.body), '--ag-rim is only a faint hairline');
  // painted highlights: a white inset shadow with a negative spread or an offset, on anything but the progress bar's own gel fill
  const painted = /inset\s+-?[\d.]+(?:px)?\s+-?[\d.]+(?:px)?\s+[\d.]+(?:px)?\s+-[\d.]+px\s+(?:#fff|rgb\(255 255 255)/;
  for (const r of rules) {
    if (/\.upd-bar i\b/.test(r.sel)) continue; // the gel inside the progress tube, not an outline
    assert.ok(!painted.test(r.body), `${r.sel}: a painted white highlight`);
    assert.ok(!/inset\s+0\s+0\s+0\s+[12](?:\.5)?px\s+(?:#fff|rgb\(255 255 255 \/ 0\.[3-9])/.test(r.body), `${r.sel}: a painted white ring`);
  }
  // the surfaces use the shared hairline and their shadow, so they all stay in step
  for (const sel of ['html.glass .ag', 'html.glass .ag-panel::after', 'html.glass .range-lens.ag', 'html.glass .ag-scroll-thumb.ag']) {
    const r = rules.find((x) => x.sel === sel);
    assert.ok(r && /var\(--ag-rim\)/.test(r.body), `${sel} does not use --ag-rim`);
  }
  // without see-through glass there is no reflection, so a plain edge keeps the shape readable
  assert.ok(/prefers-reduced-transparency[\s\S]*html\.glass \.ag, html\.glass \.ag-panel::after \{ box-shadow: inset 0 0 0 1px/.test(css), 'reduced transparency keeps an edge');
});

test('glass.js: the slider thumb and the sliding tab highlight, which are held and dragged, reflect more than a plain control', () => {
  const js = src('js', 'glass.js');
  const m = js.match(/const LENSES = '([^']+)';/);
  assert.ok(m && m[1].includes('.range-lens') && m[1].includes('.tab-ind'), 'the two lenses are listed');
  assert.ok(js.includes('!panel && el.matches(LENSES)'), 'only leaves can be lenses, and the filter is told');
  assert.ok(/\$\{lens \? 'L' : ''\}/.test(js.slice(js.indexOf('function describe'), js.indexOf('function drop'))), 'a lens never shares a filter with a plain control of the same size');
  const { G } = loadGlass({ style: 'glass' });
  assert.ok(G.rimSpec(66, 44, true).width > G.rimSpec(66, 44, false).width, 'a lens gets a deeper band');
  assert.ok(G.rimLight(0, 1, true) > G.rimLight(0, 1, false), 'and a stronger one, on every edge');
  assert.ok(G.rimLight(0.6, 0.8, true) <= 1);
});

test('the slider lens is a clear drop: it bends harder than a button but never pulls from outside itself, and only ever stretches', () => {
  const { G } = loadGlass({ style: 'glass' });
  const plain = G.rim(66, 44, false);
  const lens = G.rim(66, 44, false, true);
  assert.ok(lens.amount > plain.amount, 'the track runs through the middle of the lens, so the rim has to pull further than a button does');
  assert.ok(lens.amount <= 44 * 0.5 + 0.01, 'a pull longer than the half-height would fetch from outside the lens, which comes back empty');
  assert.equal(G.rim(30, 22, false, true).amount, 0, 'a lens too small to bend anything is only frosted');
  // the held lens is a scale and nothing else: a rotation or skew makes the backdrop filter clip and jump
  const css = src('css', 'glass.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const held = css.match(/html\.glass \.range-lens\.held\s*\{([^}]*)\}/);
  assert.ok(held && /scale:\s*1/.test(held[1]) && !/rotate|skew/.test(held[1]), 'the held lens may only scale');
  // nothing is painted over the real track inside it any more (the old white magnified bar and the glow)
  assert.ok(!/range-lens i/.test(css) && !src('js', 'glass.js').includes("innerHTML = '<i></i>'"), 'the lens must show the real track, not a drawn bar');
});

test('glass.js: a repaint measures every surface before it changes any, so the page is recalculated once and not once per surface', () => {
  const js = src('js', 'glass.js');
  const fn = js.slice(js.indexOf('function flush()'), js.indexOf('function paint('));
  const read = fn.indexOf('batch.push(');
  const write = fn.indexOf('paint(el, w, h, radius)');
  assert.ok(read > 0 && write > read, 'every size and radius is read into a batch before the first surface is painted');
  assert.ok(!/paint\(el\);/.test(js), 'painting a surface must not read its size itself (that is what made each one a new layout)');
  assert.ok(/pending = \[\]/.test(fn) && /defs\.append\(\.\.\.pending\)/.test(fn), 'the new filters go into the page together, not one by one');
});

test('glass.js: changing a glass setting swaps the filters in place and never leaves a frame without them', () => {
  const js = src('js', 'glass.js');
  const fn = js.slice(js.indexOf('function repaintAll()'), js.indexOf('function release()'));
  assert.ok(!/replaceChildren|filters\.clear/.test(fn), 'the filters are not thrown away before the new ones exist: acquire() swaps each surface to the one that fits');
  assert.ok(/queueNow\(el\)/.test(fn));
});

test('glass.js: one canvas draws every map, and only a new or removed element starts a scan (a changing text does not)', () => {
  const js = src('js', 'glass.js');
  assert.ok(js.includes('function scratchCanvas('));
  const maps = js.slice(js.indexOf('function mapUrl'), js.indexOf('// ---- one SVG filter'));
  assert.ok(!/createElement\('canvas'\)/.test(maps), 'a canvas and a 2d context for each map was a large part of the cost of a new size');
  assert.ok((maps.match(/scratchCanvas\(/g) || []).length === 2, 'both maps use the shared canvas');
  assert.ok(/nodeType === 1/.test(js) && /hasElement\(m\.addedNodes\)/.test(js), 'text nodes arrive as mutations too, and must not start a scan');
});

test('glass.js: a page is not slow the first time: the sizes of surfaces are remembered and their maps made while idle at the next start', () => {
  const js = src('js', 'glass.js');
  assert.ok(js.includes("'aula.glassSizes'"), 'only the sizes are stored');
  assert.ok(/host\.setMemory\(SIZES_KEY/.test(js) && /host\.loadMemory\(\) \|\| \{\}\)\[SIZES_KEY\]/.test(js), 'in the desktop app they live in its data file, like everything else it remembers (localStorage may not survive a restart there)');
  assert.ok(!/localStorage\.setItem\([^)]*(maps|data:image)/.test(js), 'never the maps themselves: they would go stale when the way they are drawn changes');
  const warm = js.slice(js.indexOf('function warmUp('), js.indexOf('// ---- sliders'));
  assert.ok(/ensure\(w, h, describe\(/.test(warm), 'it builds the filter (and with it the maps) for the settings a surface would be given, the same way acquire does');
  assert.ok(/timeRemaining\(\)/.test(warm) && /idle\(step\)/.test(warm), 'in idle time, a few at a time');
  assert.ok(!/maps\.clear\(\)/.test(js.slice(js.indexOf('function mapUrl'), js.indexOf('// ---- one SVG filter'))), 'a full cache drops its oldest map, not all of them');
});

test('glass.js: sliders shown together are all measured before any is changed', () => {
  const js = src('js', 'glass.js');
  const ro = js.slice(js.indexOf('const roRange'), js.indexOf('function mountRange'));
  assert.ok(ro.indexOf('rec.measure()') > 0 && ro.indexOf('rec.apply(') > ro.indexOf('rec.measure()'));
  assert.ok(!/rec\.place\(\)/.test(ro), 'one lens at a time made each write force the next measurement to lay the page out again');
});

test('glass.js: filters made ahead of time are swept when the settings change, so they never pile up', () => {
  const js = src('js', 'glass.js');
  assert.ok(/function sweep\(\)/.test(js) && /if \(f\.refs > 0\) continue;/.test(js), 'only filters nobody uses are removed');
  const flush = js.slice(js.indexOf('function flush()'), js.indexOf('function paint('));
  assert.ok(/if \(sweepAfter\) sweep\(\);/.test(flush), 'after every surface has its new filter, not before');
  assert.ok(/sweepAfter = true;/.test(js.slice(js.indexOf('function repaintAll()'), js.indexOf('function sweep()'))));
});

test('glass.js: filters made ahead of time are made again, in idle time, after the settings have stopped changing', () => {
  const js = src('js', 'glass.js');
  const repaint = js.slice(js.indexOf('function repaintAll()'), js.indexOf('// Filters made ahead of time'));
  assert.ok(/warmUp\(\[\.\.\.sizes\.values\(\)\]\.reverse\(\), \d+\)/.test(repaint));
  assert.ok(/clearTimeout\(warmTimer\);\s*warmRun\+\+;/.test(js.slice(js.indexOf('function release()'))), 'turning the glass off cancels it');
  assert.ok(/run !== warmRun/.test(js), 'a newer run replaces one that is in progress');
});

// ---- Liquid glass looks: Clear glass, Blur glass, Frosted glass, and the Customise button --------------------------------

test('glass.js: Clear, Blur and Frosted are ready-made looks, each inside the slider limits, and Blur is the default', () => {
  const { G } = loadGlass(null);
  assert.deepStrictEqual(Object.keys(G.PRESETS), ['clear', 'blur', 'frosted']);
  for (const [name, look] of Object.entries(G.PRESETS)) {
    assert.deepStrictEqual({ ...G.clean(look) }, { ...look }, `${name} is changed by clean(), so a slider could not hold it`);
  }
  assert.deepStrictEqual({ ...G.PRESETS.blur }, { ...G.DEFAULTS }, 'Blur glass is the look people already have by default');
  assert.strictEqual(G.PRESETS.clear.blur, 0, 'Clear glass has no frost at all');
  assert.ok(G.PRESETS.frosted.blur > G.PRESETS.blur.blur, 'Frosted glass is blurrier than Blur glass');
  assert.ok(G.PRESETS.frosted.blur > G.PRESETS.clear.blur);
  assert.strictEqual(G.PRESETS.frosted.chroma, 0, 'Frosted glass has no colour fringe');
  // the three looks differ from each other, or one button would light for two of them
  const keys = Object.values(G.PRESETS).map((l) => JSON.stringify([l.blur, l.bezel, l.amount, l.chroma]));
  assert.strictEqual(new Set(keys).size, 3);
});

test('glass.js: presetOf names the look the four numbers make, and says custom for any other mix', () => {
  const { G } = loadGlass(null);
  for (const name of ['clear', 'blur', 'frosted']) assert.strictEqual(G.presetOf(G.PRESETS[name]), name);
  assert.strictEqual(G.presetOf(null), 'blur', 'nothing saved is the default look, Blur glass');
  assert.strictEqual(G.presetOf(G.DEFAULTS), 'blur');
  assert.strictEqual(G.presetOf({ ...G.PRESETS.clear, blur: 1 }), 'custom');
  assert.strictEqual(G.presetOf({ ...G.PRESETS.frosted, amount: 13 }), 'custom');
  // values the page keeps as text (from a slider) still count, and values past a limit are held to it first
  assert.strictEqual(G.presetOf({ blur: '0', bezel: '16', amount: '40', chroma: '35' }), 'clear');
  assert.strictEqual(G.presetOf({ blur: 99, bezel: 10, amount: 12, chroma: 0 }), 'custom');
  // a look saved by an older version (any four numbers) is kept as it is, not forced onto a preset
  const old = loadGlass({ style: 'glass', glass: { blur: 4, bezel: 20, amount: 45, chroma: 10 } }).G;
  assert.deepStrictEqual({ ...old.params() }, { blur: 4, bezel: 20, amount: 45, chroma: 10 });
  assert.strictEqual(old.presetOf(old.params()), 'custom');
});

test('index.html: the glass section has the three looks, a Customise button, and the sliders hidden behind it', () => {
  const html = src('index.html');
  const sec = html.slice(html.indexOf('id="glassSection"'), html.indexOf('<h2>Background</h2>'));
  for (const v of ['clear', 'blur', 'frosted']) assert.ok(sec.includes(`data-glass-preset="${v}"`), `no button for ${v}`);
  for (const label of ['Clear glass', 'Blur glass', 'Frosted glass']) assert.ok(sec.includes(`>${label}</button>`), `${label} is not a label`);
  assert.ok(/id="segGlass"[^>]*role="radiogroup"/.test(sec));
  assert.ok(/id="glassCustomBtn"[^>]*aria-expanded="false"[^>]*aria-controls="glassCustom"/.test(sec));
  const custom = sec.match(/<div id="glassCustom"[^>]*>/);
  assert.ok(custom && /\bhidden\b/.test(custom[0]), 'the sliders must start hidden');
  const inside = sec.slice(sec.indexOf('id="glassCustom"'));
  for (const k of ['blur', 'bezel', 'amount', 'chroma']) assert.ok(inside.includes(`data-glass="${k}"`), `the ${k} slider is not behind Customise`);
  assert.ok(inside.includes('id="glassReset"'));
  // the looks and the Customise button stay in view when the sliders are hidden
  const before = sec.slice(0, sec.indexOf('id="glassCustom"'));
  assert.ok(before.includes('data-glass-preset="clear"') && before.includes('id="glassCustomBtn"'));
  assert.ok(!before.includes('data-glass="'), 'no slider may sit outside the Customise panel');
});

test('app.js: a look sets the four numbers and saves, Customise only shows or hides the sliders, and moving a slider makes it custom', () => {
  const js = src('js', 'app.js');
  // choosing a look
  const click = js.match(/for \(const b of \$\$\('#segGlass \.seg-btn'\)\) \{[\s\S]*?\n    \}\n/);
  assert.ok(click, 'the look buttons have no click handler');
  assert.ok(/G\.PRESETS\[b\.dataset\.glassPreset\]/.test(click[0]));
  assert.ok(/prefs\.glass = G\.clean\(look\)/.test(click[0]));
  assert.ok(/G\.setParams\(prefs\.glass\)/.test(click[0]) && /savePrefs\(\)/.test(click[0]) && /renderStyle\(\)/.test(click[0]));
  // Customise
  const cust = js.match(/\$\('#glassCustomBtn'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(cust, 'Customise has no click handler');
  assert.ok(/glassCustomOpen = !glassCustomOpen/.test(cust[1]));
  assert.ok(!/prefs\.glass|G\.setParams/.test(cust[1]), 'Customise must not change the glass');
  // the render reads the look from the numbers, so a slider move or Reset updates the lit button by itself
  const render = js.match(/function renderGlassPreset\(\) \{([\s\S]*?)\n  \}\n/);
  assert.ok(render, 'renderGlassPreset is missing');
  assert.ok(/G\.presetOf\(prefs\.glass\)/.test(render[1]));
  assert.ok(/'seg-none', preset === 'custom'/.test(render[1]), 'no button may be lit for a custom mix');
  assert.ok(/\$\('#glassCustom'\)\.hidden = !glassCustomOpen/.test(render[1]));
  assert.ok(/aria-expanded/.test(render[1]));
  const style = js.match(/function renderStyle\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(style && /renderGlassPreset\(\)/.test(style[0]), 'renderStyle must refresh the looks');
  // the hint has a line for every look and for custom
  for (const k of ['clear', 'blur', 'frosted', 'custom']) assert.ok(new RegExp(`\\b${k}: '`).test(js.slice(js.indexOf('GLASS_PRESET_HINT'))), `no hint for ${k}`);
});

test('app.css: the look switcher is wider than the theme one, hides its highlight for a custom mix, and the Customise panel is hidden with the attribute', () => {
  const css = src('css', 'app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.seg-glass \{[^}]*width: 372px/.test(css));
  assert.ok(/\.seg-glass\.seg-none::before \{ opacity: 0; \}/.test(css));
  assert.ok(/\.glass-custom\[hidden\] \{ display: none; \}/.test(css), 'a rule that sets display on the panel must not beat the hidden attribute');
  assert.ok(/\.glass-custom \{ border-top: 1px solid var\(--line\); \}/.test(css));
});
