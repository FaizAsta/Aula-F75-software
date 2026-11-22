// Normal glass (Settings > Theme > Liquid glass > Glass type): the default type, a plain blur with a painted light edge, in place of
// Realistic's per-surface bending filters. glass.js needs a browser, so it is run here against a tiny fake page; the stylesheet, the
// page and app.js are checked from their source. The real browser checks (a switch both ways, filters built and torn down) are in
// scripts/ui-glass-type.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function loadGlass(saved) {
  const classes = new Set();
  const vars = new Map();
  const root = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k), getPropertyValue: (k) => vars.get(k) || '' },
  };
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
  return { G: window.AulaGlass, classes, vars };
}

// ---- glass.js

test('glass.js: Normal is the default type, anything unknown is Normal, and only Realistic is another type', () => {
  const { G } = loadGlass({ style: 'glass' });
  assert.strictEqual(G.type(), 'normal');
  assert.strictEqual(G.DEFAULT_TYPE, 'normal');
  assert.deepStrictEqual([...G.TYPES], ['normal', 'realistic']);
  for (const bad of [undefined, null, '', 'glass', 'REALISTIC', 1, {}]) assert.strictEqual(G.cleanType(bad), 'normal');
  assert.strictEqual(G.cleanType('realistic'), 'realistic');
  assert.strictEqual(loadGlass({ style: 'glass', glassType: 'realistic' }).G.type(), 'realistic');
  assert.strictEqual(loadGlass({ style: 'glass', glassType: 'wobbly' }).G.type(), 'normal');
});

test('glass.js: html carries glass-normal only while glass is on and Normal, so Classic and Realistic never see it', () => {
  assert.strictEqual(loadGlass(null).classes.has('glass-normal'), false, 'Classic');
  assert.strictEqual(loadGlass({ style: 'classic', glassType: 'normal' }).classes.has('glass-normal'), false, 'Classic, whatever the type');
  const normal = loadGlass({ style: 'glass' });
  assert.ok(normal.classes.has('glass') && normal.classes.has('glass-normal'));
  const real = loadGlass({ style: 'glass', glassType: 'realistic' });
  assert.ok(real.classes.has('glass') && !real.classes.has('glass-normal'));
});

test('glass.js: setType changes the class, is remembered while glass is off, and set() brings the right one back', () => {
  const { G, classes } = loadGlass({ style: 'classic' });
  G.setType('realistic'); // glass is off: only remembered
  assert.strictEqual(G.type(), 'realistic');
  assert.strictEqual(classes.has('glass-normal'), false);
  G.setType('normal');
  assert.strictEqual(G.type(), 'normal');
  assert.strictEqual(classes.has('glass-normal'), false, 'still Classic: no glass-normal');
  G.set(true);
  assert.ok(classes.has('glass') && classes.has('glass-normal'));
  G.setType('nonsense'); // counts as Normal, which it already is
  assert.ok(classes.has('glass-normal'));
  G.set(false);
  assert.ok(!classes.has('glass') && !classes.has('glass-normal'), 'switching back to Classic removes both');
});

test('glass.js: leaving Realistic for Normal puts the one blur back on html, and Classic leaves none', () => {
  const { G, classes, vars } = loadGlass({ style: 'glass', glassType: 'realistic' });
  assert.ok(!classes.has('glass-normal'));
  assert.strictEqual(vars.has('--ag-filter'), false, 'Realistic gives each surface its own filter, nothing on html');
  G.setType('normal');
  assert.ok(classes.has('glass-normal'));
  assert.strictEqual(vars.get('--ag-filter'), `blur(${G.normalBlur()}px)`);
  G.set(false);
  assert.strictEqual(vars.has('--ag-filter'), false, 'Classic: the blur is gone from html');
});

test('glass.js: in Normal the Blur setting is the whole look: 0 is clear, the default and Frosted are visibly blurred, and it follows the slider', () => {
  const { G, classes, vars } = loadGlass({ style: 'glass', glass: G0() });
  assert.ok(classes.has('glass-normal'));
  const blur = (b) => {
    G.setParams({ blur: b });
    return G.normalBlur();
  };
  assert.strictEqual(blur(0), 0, 'Clear glass is not blurred at all');
  const dflt = blur(G.PRESETS.blur.blur);
  const frosted = blur(G.PRESETS.frosted.blur);
  assert.ok(dflt >= 8 && dflt <= 16, `the default look is a soft blur (${dflt}px)`);
  assert.ok(frosted > dflt * 2, `Frosted is much heavier than the default (${frosted}px)`);
  assert.ok(blur(G.LIMITS.blur[1]) > frosted, 'the slider keeps going up to its end');
  assert.strictEqual(blur(G.LIMITS.blur[1] + 50), blur(G.LIMITS.blur[1]), 'and is held to its limit');
  G.setParams({ blur: 6 });
  // glass.js only repaints when glass is on and has a page, so the variable was set by setParams -> repaintAll
  assert.strictEqual(vars.get('--ag-filter'), `blur(${G.normalBlur()}px)`);
});
function G0() {
  return { blur: 2.5, bezel: 14, amount: 30, chroma: 30 };
}

test('glass.js: light glass (Normal, or Realistic with no bending) builds nothing per surface: its flush only marks, before any filter, map or defs are made', () => {
  const js = src('js', 'glass.js');
  const flush = js.slice(js.indexOf('function flush()'), js.indexOf('function paint('));
  const normalBranch = flush.indexOf('isLight()');
  assert.ok(normalBranch > 0, 'flush has a Normal branch');
  assert.ok(normalBranch < flush.indexOf('ensureDefs()'), 'the Normal branch comes before the filters are made');
  assert.ok(/markNormal\(el\)/.test(flush.slice(normalBranch, flush.indexOf('ensureDefs()'))));
  // start(): Normal does not build the SVG holder or warm up maps
  const start = js.slice(js.indexOf('function start()'), js.indexOf('function leaveRealistic'));
  assert.ok(/isLight\(\)\) applyNormal\(\);\s*else ensureDefs\(\)/.test(start));
  assert.ok(/!isLight\(\)\) warm\(\)/.test(start), 'only the filters remember surface sizes and draw maps ahead of time');
  // a change of pixel density only matters to Realistic's smoothing blur
  assert.ok(/on && !isLight\(\)\) repaintAll\(\)/.test(js));
});

test('glass.js: switching type drops every Realistic filter and inline filter, and brings them back, without rebuilding the surfaces', () => {
  const js = src('js', 'glass.js');
  const leave = js.slice(js.indexOf('function leaveRealistic'), js.indexOf('function enterRealistic'));
  for (const part of ['drop(el)', "removeProperty('--ag-filter')", 'filters.clear()', 'maps.clear()', 'applyNormal()', 'warmRun++'])
    assert.ok(leave.includes(part), `leaving Realistic: ${part}`);
  const enter = js.slice(js.indexOf('function enterRealistic'), js.indexOf('window.AulaGlass'));
  for (const part of ['ensureDefs()', 'ro.observe(el)', 'repaintAll()', 'rootBlurStale = true'])
    assert.ok(enter.includes(part), `entering Realistic: ${part}`);
  // the blur on html stays until each surface has its own filter, so a switch never shows a frame without glass
  assert.ok(/if \(rootBlurStale\) \{[\s\S]*?clearNormal\(\)/.test(js.slice(js.indexOf('function flush()'))));
  // the Realistic code is all still there
  for (const part of ['function makeFilter', 'function mapUrl', 'function rimMapUrl', 'function rimPass']) assert.ok(js.includes(part), part);
});

test('glass.js: the public settings of Realistic are untouched (the four numbers, the four looks, the Blur glass default)', () => {
  const { G } = loadGlass({ style: 'glass' });
  assert.deepStrictEqual({ ...G.DEFAULTS }, { blur: 2.5, bezel: 14, amount: 30, chroma: 30 });
  assert.strictEqual(G.presetOf(G.DEFAULTS), 'blur');
  assert.deepStrictEqual(Object.keys(G.PRESETS), ['clear', 'blur', 'frosted', 'default']);
});

// ---- glass-normal.css

test('glass-normal.css: every rule starts with html.glass.glass-normal, so Classic and Realistic are untouched', () => {
  const css = noComments(src('css', 'glass-normal.css'));
  let rules = 0;
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of prelude.split(',').map((x) => x.trim())) {
      rules++;
      assert.ok(/^html\.glass\.glass-normal\b/.test(sel), `selector outside html.glass.glass-normal: ${sel}`);
    }
  }
  assert.ok(rules >= 3);
});

test('glass-normal.css: the edge is painted (a hairline, a lit crescent top left, a bounce bottom right), in both themes', () => {
  const css = noComments(src('css', 'glass-normal.css'));
  const rule = (sel) => {
    const m = css.match(new RegExp(`${sel.replace(/[.[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `${sel} not found`);
    return m[1];
  };
  for (const sel of ['html.glass.glass-normal', 'html.glass.glass-normal[data-theme="light"]']) {
    const rim = rule(sel).match(/--ag-rim:([^;]*);/);
    assert.ok(rim, `${sel} sets --ag-rim`);
    const layers = rim[1].split(/,(?![^(]*\))/).map((x) => x.trim());
    assert.ok(layers.every((l) => l.startsWith('inset')), 'all of it is inside the edge, so the shape never grows');
    assert.ok(layers.some((l) => /^inset 0 0 0 1px/.test(l)), 'a hairline all round');
    assert.ok(layers.some((l) => /^inset 1px 1px 0/.test(l)), 'the lit edge, top left');
    assert.ok(layers.some((l) => /^inset -1px -1px 0/.test(l)), 'the bounce, bottom right');
  }
  // the default blur is there for the first paint, before glass.js has set the real one
  assert.ok(/--ag-filter:\s*blur\(\d+(\.\d+)?px\)/.test(rule('html.glass.glass-normal')));
  // the held slider lens stays sharp enough to see the bar through
  assert.ok(/\.range-lens\.ag\.held\s*\{\s*--ag-filter:\s*blur\(0?\.?\d+px\)/.test(css));
});

test('glass-normal.css: nothing in it bends or splits the picture (no url(#filter), no displacement)', () => {
  const css = noComments(src('css', 'glass-normal.css'));
  assert.ok(!/url\(/.test(css));
  assert.ok(!/displace|feImage|hue-rotate/i.test(css));
});

test('index.html: glass-normal.css comes right after glass.css (and after lite.css), and the page has the Glass type switch', () => {
  const html = src('index.html');
  const sheet = (f) => html.indexOf(`<link rel="stylesheet" href="css/${f}">`);
  assert.ok(sheet('glass-normal.css') > sheet('glass.css') && sheet('glass.css') > sheet('lite.css'));
  const seg = html.match(/<div class="seg seg-2" id="segGlassType"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(seg, 'the Glass type switch is missing');
  assert.ok(seg[0].includes('data-glass-type="normal"') && seg[0].includes('data-glass-type="realistic"'));
  assert.ok(html.includes('id="glassTypeHint"') && html.includes('id="glassCustomHint"'));
  // Normal is listed first, it is the default
  assert.ok(seg[0].indexOf('data-glass-type="normal"') < seg[0].indexOf('data-glass-type="realistic"'));
});

test('index.html: edge width, refraction and colour fringe (which only Realistic uses) are tagged, in Settings and in the first-run question, and Blur is not', () => {
  const html = src('index.html');
  const rows = [...html.matchAll(/<(div class="srow"|label class="sp-rng") data-glass-real>[\s\S]*?(?=<(?:div class="srow"|label class="sp-rng")|<\/section>)/g)].map((m) => m[0]);
  const keys = rows.map((r) => (r.match(/data-glass="(\w+)"/) || [])[1]).sort();
  assert.deepStrictEqual(keys, ['amount', 'amount', 'bezel', 'bezel', 'chroma', 'chroma'], 'three rows in Settings, three in the question');
  // the Blur sliders are never tagged: they are the whole look in Normal
  for (const id of ['gBlur', 'spGBlur']) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0);
    const tagStart = Math.max(html.lastIndexOf('<div class="srow"', at), html.lastIndexOf('<label class="sp-rng"', at));
    assert.ok(!/data-glass-real/.test(html.slice(tagStart, tagStart + 40)), `${id} is not Realistic-only`);
  }
});

// ---- app.js and the first-run question

test('app.js: the type is a saved setting, cleaned on load, applied with the style, and changed from Settings', () => {
  const app = src('js', 'app.js');
  assert.ok(/prefs\.glassType = G \? G\.cleanType\(prefs\.glassType\) : 'normal'/.test(app));
  assert.ok(/function setGlassType\(type\)[\s\S]*?prefs\.glassType = G\.cleanType\(type\);\s*savePrefs\(\);\s*G\.setType\(prefs\.glassType\);\s*renderStyle\(\)/.test(app));
  assert.ok(/#segGlassType \.seg-btn'\)\) b\.addEventListener\('click', \(\) => setGlassType\(b\.dataset\.glassType\)\)/.test(app));
  // the start-up and Classic <-> glass paths keep glass.js in step
  assert.ok(/G\.setType\(prefs\.glassType\);\s*G\.set\(prefs\.style === 'glass'\)/.test(app));
  assert.ok(/G\.setType\(prefs\.glassType\);\s*G\.set\(style === 'glass'\)/.test(app));
  // Settings shows the three bending-only rows only for Realistic, and the words follow the type
  assert.ok(/\[data-glass-real\]'\)\) row\.hidden = !realistic/.test(app));
  assert.ok(/GLASS_PRESET_HINT\[prefs\.glassType\]\[preset\]/.test(app));
  for (const t of ['normal', 'realistic']) {
    assert.ok(new RegExp(`${t}: \\{\\s*clear:`).test(app), `${t} has its own look hints`);
  }
});

test('app.js and the question: the type goes to the live pictures, and the question shows only the sliders that do something', () => {
  const app = src('js', 'app.js');
  assert.ok(/glass: \{ \.\.\.prefs\.glass \}, glassType: prefs\.glassType \}\);/.test(app), 'styleOptions carries the type');
  assert.ok(/o\.glassType[\s\S]*?G\.setType\(prefs\.glassType\)/.test(app), 'applyStyleOptions applies it');
  assert.ok(/glass: PV\.glass, glassType: PV\.glassType/.test(app), 'the preview starts from it');
  const ui = src('js', 'stylepick-ui.js');
  assert.ok(/glassType: draftState\.glassType,\s*bg:/.test(ui), 'the live picture opens with it');
  assert.ok(/glass: draftState\.glass, glassType: draftState\.glassType \}/.test(ui), 'and is told when a slider moves');
  assert.ok(/\[data-glass-real\]'\)\) row\.hidden = draftState\.glassType !== 'realistic'/.test(ui));
  // answering the question applies the sliders only, never changes the type the person set in Settings
  assert.ok(!/glassType/.test(ui.slice(ui.indexOf('function draft()'), ui.indexOf('// ----', ui.indexOf('function draft()')))));
});


// ---- Realistic with Refraction 0: nothing bends, so it is painted like Normal (no SVG filter on any surface)

// Like loadGlass, but with just enough page for glass to build its SVG holder (a Realistic that bends), and timers that do not keep
// the test alive.
function loadGlassDom(saved) {
  const classes = new Set();
  const vars = new Map();
  const root = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k), getPropertyValue: (k) => vars.get(k) || '' },
  };
  const window = { aulaHost: null };
  const ctx = {
    window,
    document: {
      documentElement: root,
      readyState: 'complete',
      body: { append() {} },
      addEventListener() {},
      querySelectorAll: () => [],
      createElement: () => ({
        set innerHTML(_) {
          this.firstChild = { firstChild: { isConnected: true, append() {}, replaceChildren() {} } };
        },
      }),
    },
    localStorage: { getItem: () => null },
    ResizeObserver: class { observe() {} unobserve() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
    setTimeout: (f, ms) => {
      const t = setTimeout(f, ms);
      if (t && t.unref) t.unref();
      return t;
    },
    clearTimeout,
  };
  ctx.localStorage.getItem = () => (saved ? JSON.stringify(saved) : null);
  vm.runInNewContext(src('js', 'glass.js'), ctx);
  return { G: window.AulaGlass, classes, vars };
}

test('glass.js: Realistic with Refraction 0 is light glass: it carries glass-normal and one plain blur on html, at Realistic\'s own blur scale', () => {
  const { G, classes, vars } = loadGlass({ style: 'glass', glassType: 'realistic', glass: { blur: 2.5, bezel: 14, amount: 0, chroma: 30 } });
  assert.strictEqual(G.isLight(), true);
  assert.ok(classes.has('glass') && classes.has('glass-normal'), 'painted like Normal');
  G.setParams({ blur: 4 });
  assert.strictEqual(vars.get('--ag-filter'), 'blur(4px)', 'a point of the slider is a pixel, as it was inside the filters');
  assert.notStrictEqual(vars.get('--ag-filter'), `blur(${G.normalBlur()}px)`, 'not Normal\'s scale, which is more than four times heavier');
  G.setType('normal');
  assert.strictEqual(vars.get('--ag-filter'), `blur(${G.normalBlur()}px)`, 'Normal keeps its own scale');
  G.setType('realistic');
  assert.strictEqual(vars.get('--ag-filter'), 'blur(4px)');
});

test('glass.js: a Realistic that bends (any Refraction above 0) is not light, so no glass-normal and no blur on html', () => {
  const { G, classes, vars } = loadGlass({ style: 'glass', glassType: 'realistic', glass: { blur: 2.5, bezel: 14, amount: 1, chroma: 0 } });
  assert.strictEqual(G.isLight(), false);
  assert.ok(classes.has('glass') && !classes.has('glass-normal'));
  assert.strictEqual(vars.has('--ag-filter'), false);
  // Normal is light whatever the sliders say
  assert.strictEqual(loadGlass({ style: 'glass', glass: { amount: 40 } }).G.isLight(), true);
});

test('glass.js: dragging Refraction to 0 drops every filter for the plain blur, and off 0 brings the filters back', () => {
  const { G, classes, vars } = loadGlassDom({ style: 'glass', glassType: 'realistic' });
  assert.strictEqual(G.isLight(), false);
  assert.ok(!classes.has('glass-normal'));
  G.setParams({ amount: 0 }); // filters -> plain blur
  assert.strictEqual(G.isLight(), true);
  assert.ok(classes.has('glass-normal'));
  assert.strictEqual(vars.get('--ag-filter'), 'blur(2.5px)');
  G.setParams({ amount: 12 }); // plain blur -> filters
  assert.strictEqual(G.isLight(), false);
  assert.ok(!classes.has('glass-normal'), 'the painted edge of light glass goes, the reflection in the filters takes over');
  G.setParams({ amount: 0 });
  assert.ok(classes.has('glass-normal'));
  G.set(false);
  assert.ok(!classes.has('glass') && !classes.has('glass-normal'), 'Classic: neither class');
  assert.strictEqual(vars.has('--ag-filter'), false);
});

test('glass.js: the path is chosen in one place (isLight), and Realistic boxes keep their extra frost without the bending', () => {
  const js = src('js', 'glass.js');
  assert.ok(/const isLight = \(\) => type === 'normal' \|\| params\.amount === 0;/.test(js));
  // nothing that decides how a surface is painted asks for the type any more, except the blur scale and the boxes' extra frost
  const asks = js.split('\n').filter((l) => /type === '(normal|realistic)'/.test(l) && !l.trim().startsWith('//'));
  assert.strictEqual(asks.length, 3, `only isLight, lightBlur and markNormal ask for the type:\n${asks.join('\n')}`);
  const mark = js.slice(js.indexOf('function markNormal'), js.indexOf('// ---- displacement map'));
  assert.ok(mark.includes('panelFrost(true)'), 'a box of Realistic keeps its extra frost');
  const move = js.slice(js.indexOf('function moveTo'), js.indexOf('window.AulaGlass'));
  assert.ok(move.includes('leaveRealistic()') && move.includes('enterRealistic()') && move.includes('repaintAll()'));
  // glass-normal.css and the Customise hint say it
  assert.ok(/Refraction is 0/.test(src('css', 'glass-normal.css')));
  assert.ok(/Refraction at 0/.test(src('js', 'app.js')));
});
