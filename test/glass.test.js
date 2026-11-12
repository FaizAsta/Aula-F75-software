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

test('glass.js: panels get a wider, stronger rim and a little more frost than pills do', () => {
  const { js } = surfaces();
  const m = js.match(/const PANEL = \{ bezel: ([\d.]+), amount: ([\d.]+), blur: ([\d.]+) \}/);
  assert.ok(m, 'PANEL factors not found');
  assert.ok(+m[1] > 1 && +m[2] > 1 && +m[3] > 0, 'a panel must bend more and blur more than a leaf');
  assert.ok(js.includes('params.bezel * (panel ? PANEL.bezel : 1)') && js.includes('params.blur + (panel ? PANEL.blur : 0)'), 'the factors are not applied');
  assert.ok(/const key = `[^`]*\$\{blur\}[^`]*\$\{amount\}/.test(js), 'filters with different panel settings must not share a cache key');
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
