// Realistic glass (Settings > Theme > Liquid glass > Glass type > Realistic): one WebGL shader per surface, drawn below the page, in place of
// a per-surface SVG filter. WebGL needs a real browser, so the picture itself is checked by scripts/ and by hand; here glass.js
// is run against a tiny fake page and a fake renderer (type choice, fallback, switching), and the sheets and page are checked from source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function loadGlass(saved, gpuFactory) {
  const classes = new Set();
  const vars = new Map();
  const root = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k), getPropertyValue: (k) => vars.get(k) || '' },
  };
  const window = { aulaHost: null };
  if (gpuFactory) window.AulaGpuGlass = { create: gpuFactory };
  const ctx = {
    window,
    document: {
      documentElement: root,
      readyState: 'complete',
      body: { append() {} },
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        set innerHTML(_) {
          this.firstChild = { firstChild: { isConnected: true, append() {}, replaceChildren() {} } };
        },
      }),
    },
    localStorage: { getItem: () => (saved ? JSON.stringify(saved) : null) },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
  };
  vm.runInNewContext(src('js', 'glass.js'), ctx);
  return { G: window.AulaGlass, classes };
}

const fakeRenderer = () => {
  const r = { destroyed: 0 };
  r.api = { set() {}, remove() {}, kick() {}, invalidate() {}, ready: () => true, stats: () => ({}), destroy: () => { r.destroyed++; } };
  return r;
};

test('glass.js: there is no GPU type: Realistic is the one the graphics card draws, and a saved gpu is Realistic', () => {
  assert.deepStrictEqual([...loadGlass({ style: 'glass' }).G.TYPES], ['normal', 'realistic']);
  assert.strictEqual(loadGlass({ style: 'glass', glassType: 'realistic' }).G.type(), 'realistic');
  assert.strictEqual(loadGlass({ style: 'glass', glassType: 'gpu' }).G.type(), 'realistic', 'an older saved choice is kept as Realistic');
  assert.strictEqual(loadGlass({ style: 'glass', glassType: 'GPU' }).G.type(), 'normal');
  assert.strictEqual(loadGlass({ style: 'glass' }).G.type(), 'normal', 'and it is chosen only when asked for');
});

test('glass.js: Realistic starts the renderer and marks <html>; leaving it stops the renderer', () => {
  const r = fakeRenderer();
  const { G, classes } = loadGlass({ style: 'glass', glassType: 'realistic' }, () => r.api);
  assert.strictEqual(G.gpuActive(), true);
  assert.strictEqual(classes.has('glass-gpu'), true);
  G.setType('normal');
  assert.strictEqual(G.gpuActive(), false);
  assert.strictEqual(classes.has('glass-gpu'), false);
  assert.strictEqual(r.destroyed, 1, 'the renderer was destroyed');
});

test('glass.js: no renderer (no WebGL) means Realistic is drawn with SVG filters, not a broken page', () => {
  const { G, classes } = loadGlass({ style: 'glass', glassType: 'realistic' }, () => null);
  assert.strictEqual(G.type(), 'realistic', 'the choice is kept');
  assert.strictEqual(G.gpuActive(), false);
  assert.strictEqual(G.gpuFailed(), true);
  assert.strictEqual(classes.has('glass-gpu'), false);
  const none = loadGlass({ style: 'glass', glassType: 'realistic' }); // glass-gpu.js not loaded at all
  assert.strictEqual(none.G.gpuActive(), false);
});

test('glass.js: Normal glass and Refraction 0 never start the renderer', () => {
  let made = 0;
  const factory = () => { made++; return fakeRenderer().api; };
  loadGlass({ style: 'glass', glassType: 'normal' }, factory);
  loadGlass({ style: 'classic', glassType: 'realistic' }, factory);
  assert.strictEqual(made, 0);
});

test('glass.js: surfaces that bend HTML stay on SVG filters', () => {
  const js = src('js', 'glass.js');
  const m = js.match(/const GPU_NOT = '([^']+)'/);
  assert.ok(m, 'GPU_NOT is declared');
  for (const sel of ['.toast', '.sel-pop', '.range-lens', '.tab-ind', '.ag-scroll-thumb']) assert.ok(m[1].includes(sel), sel);
  assert.ok(/if \(gpuTakes\(el\)\) return paintGpu\(/.test(js), 'paint() hands a surface to the GPU first');
});

test('glass-gpu.css: the canvas sits below the controls, and a GPU surface has no CSS backdrop', () => {
  const css = noComments(src('css', 'glass-gpu.css'));
  assert.ok(/\.glass-gpu-canvas\s*\{[^}]*z-index:\s*-1/.test(css));
  assert.ok(/pointer-events:\s*none/.test(css));
  assert.ok(/\.ag-gpu[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/.test(css));
  const html = src('index.html');
  assert.ok(html.indexOf('css/glass-gpu.css') > html.indexOf('css/glass-bend.css'), 'after glass-bend.css');
  assert.ok(html.indexOf('js/glass-gpu.js') < html.indexOf('js/glass.js'), 'before glass.js');
});

test('glass-gpu.js: asks for WebGL2, tells glass.js when it cannot go on, and has a way to stop', () => {
  const js = src('js', 'glass-gpu.js');
  assert.ok(/getContext\('webgl2'/.test(js));
  assert.ok(/onFail/.test(js) && /webglcontextlost/.test(js));
  assert.ok(/window\.AulaGpuGlass = \{ create \}/.test(js));
  assert.ok(/destroy/.test(js));
  // an unreadable picture must lead to a fallback, never a black page
  assert.ok(/SecurityError|texImage2D/.test(js));
});
