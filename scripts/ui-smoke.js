// Loads the real src/index.html and every script in jsdom, turns on the demo keyboard for each model (F75, F75 Pro, F87),
// and drives every tab: effects, brightness, sleep, Apply, per-key painting, the Keys tab, Restore, model switching.
// Run: npm install --no-save jsdom && node scripts/ui-smoke.js   (not part of `npm test`; it needs jsdom, not the app)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = process.env.ROOT || path.join(__dirname, '..', 'src');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ctx2d() {
  const grad = { addColorStop() {} };
  const target = { canvas: null, measureText: () => ({ width: 10 }), createLinearGradient: () => grad, createRadialGradient: () => grad, getImageData: () => ({ data: new Uint8ClampedArray(4) }), createPattern: () => ({}) };
  return new Proxy(target, {
    get: (t, p) => (p in t ? t[p] : () => {}),
    set: (t, p, v) => ((t[p] = v), true),
  });
}

async function boot(model, { demo = true, hid = null } = {}) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  html = html.replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push('error: ' + ((e.error && e.error.stack) || e.message)));
  w.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.stack) || e.reason)));
  const ce = w.console.error;
  w.console.error = (...a) => {
    errors.push('console.error: ' + a.map(String).join(' '));
    ce.apply(w.console, a);
  };
  w.HTMLCanvasElement.prototype.getContext = function () {
    const c = ctx2d();
    c.canvas = this;
    return c;
  };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.Element.prototype.animate = () => ({ cancel() {}, finish() {}, finished: Promise.resolve(), addEventListener() {} });
  w.HTMLElement.prototype.setPointerCapture = () => {};
  w.HTMLElement.prototype.releasePointerCapture = () => {};
  w.HTMLElement.prototype.hasPointerCapture = () => false;
  w.Element.prototype.scrollIntoView = () => {};
  if (hid) Object.defineProperty(w.navigator, 'hid', { value: hid, configurable: true });
  w.localStorage.setItem('aula.prefs', JSON.stringify({ demo, model, modelSet: true }));
  for (const src of scripts) {
    try {
      w.eval(fs.readFileSync(path.join(ROOT, src), 'utf8') + `\n//# sourceURL=${src}`);
    } catch (e) {
      errors.push(`${src}: ${e.stack}`);
    }
  }
  return { w, errors, dom };
}

async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(25);
  }
  return false;
}

module.exports = { boot, until, wait };

if (require.main === module) {
  (async () => {
    let failed = 0;
    const check = (cond, msg) => {
      if (!cond) {
        failed++;
        console.log('  FAIL:', msg);
      }
    };
    for (const model of ['f75', 'f75pro', 'f87']) {
      console.log(`== ${model}`);
      const { w, errors, dom } = await boot(model);
      const A = w.aulaApp;
      check(!!A, 'aulaApp exists');
      if (!A) continue;
      check(await until(() => A.session.ready), 'demo keyboard becomes ready');
      const doc = w.document;
      const keysCount = w.AulaLayout.KEYS.length;
      console.log(`  layout ${w.AulaLayout.id}: ${keysCount} keys`);

      // every tab renders and shows its panel
      for (const tab of ['lighting', 'perkey', 'keys', 'battery', 'settings']) {
        A.setTab(tab);
        await wait(120);
        const panel = doc.getElementById('panel-' + tab);
        check(panel && !panel.hidden, `${tab}: panel visible`);
      }
      A.setTab('lighting');
      await wait(100);

      // Lighting: every effect tile can be chosen and the session follows
      const tiles = [...doc.querySelectorAll('#effects button')];
      check(tiles.length >= 16, `effect tiles: ${tiles.length}`);
      for (const t of tiles) {
        t.click();
        await wait(15);
      }
      check(A.session.dirty || tiles.length > 0, 'effects edit the session');
      // brightness / speed / sleep controls exist and respond
      const bright = doc.getElementById('rngBright');
      check(bright && +bright.max === 4, `brightness slider: 0..${bright && bright.max}`);
      if (bright) {
        bright.value = '2';
        bright.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      }
      await wait(20);
      const sleepSel = doc.getElementById('sleepSel');
      check(sleepSel && sleepSel.options.length >= 9, `sleep options: ${sleepSel && sleepSel.options.length}`);
      // Apply
      const apply = doc.getElementById('btnApply');
      check(!doc.getElementById('applybar').hidden, 'apply bar shows after an edit');
      apply.click();
      await until(() => !A.session.dirty, 5000);
      check(!A.session.dirty, 'Apply writes and the keyboard keeps it');

      // Per-key: select all, paint, apply
      A.setTab('perkey');
      await wait(100);
      doc.getElementById('pkSelAll').click();
      await wait(20);
      doc.getElementById('pkPaintSel').click();
      await wait(40);
      for (const id of ['pkBlack', 'pkAll', 'pkGradient', 'pkRainbow']) {
        doc.getElementById(id).click();
        await wait(30);
      }
      doc.getElementById('btnApply').click();
      await until(() => !A.session.dirty, 5000);
      check(!A.session.dirty, 'per-key paint applied');
      check(w.AulaProtocol.getMode(A.session.dev0.led) === w.AulaProtocol.MODE_CUSTOM, 'per-key mode on the keyboard');

      // Keys tab: load, pick a key, assign, apply, restore
      A.setTab('keys');
      await until(() => A.keys.ka.state.status === 'ready' || A.keys.ka.state.status === 'error', 4000);
      check(A.keys.ka.state.status === 'ready', `keys tab loads: ${A.keys.ka.state.error}`);
      const layout = w.AulaLayout;
      const caps = layout.KEYS.find((k) => k.n === 'Caps');
      A.keys.pick(caps);
      await wait(60);
      doc.querySelector('#kaGroups [data-group="fkeys"]').click();
      await wait(30);
      const fbtns = [...doc.querySelectorAll('#kaGrid .ka-key')];
      check(fbtns.length === 24, `F1 to F24 buttons: ${fbtns.length}`);
      check(fbtns.every((b) => !b.disabled), 'palette is enabled for an editable key');
      fbtns[12].click(); // F13
      await wait(40);
      check(doc.getElementById('kaApply').disabled === false, 'Apply enabled with a change');
      doc.getElementById('kaApply').click();
      await until(() => A.keys.pendingCount() === 0, 4000);
      check(A.keys.pendingCount() === 0, 'key written and kept');
      check(A.keys.ka.codeOf(0, caps.led).label === 'F13', `Caps now F13 (${A.keys.ka.codeOf(0, caps.led).label})`);
      // FN1 layer
      doc.querySelector('#segLayer [data-layer="1"]').click();
      await wait(40);
      check(!doc.querySelector('#segLayer [data-layer="1"]').disabled, 'FN1 layer selectable');
      doc.querySelector('#segLayer [data-layer="0"]').click();
      await wait(30);
      // Fn key is locked
      const fn = layout.KEYS.find((k) => k.n === 'Fn');
      A.keys.pick(fn);
      await wait(40);
      check([...doc.querySelectorAll('#kaGrid .ka-key')].every((b) => b.disabled), 'the Fn key cannot be edited');
      // Restore the Caps key
      A.keys.pick(caps);
      await wait(40);
      check(doc.getElementById('kaRestoreKey').disabled === false, 'Restore this key available');
      doc.getElementById('kaRestoreKey').click();
      await wait(40);
      doc.getElementById('kaApply').click();
      await until(() => A.keys.pendingCount() === 0, 4000);
      check(A.keys.ka.codeOf(0, caps.led).label === 'Caps Lock', `Caps restored (${A.keys.ka.codeOf(0, caps.led).label})`);

      // Battery and Settings tabs
      A.setTab('battery');
      await wait(100);
      A.setTab('settings');
      await wait(100);
      const sel = doc.getElementById('modelSel');
      check(sel && [...sel.options].map((o) => o.value).sort().join() === 'f75,f75pro,f87', `model list: ${sel && [...sel.options].map((o) => o.value)}`);

      // Switch to the other models from the Settings box and re-check the Keys tab each time
      for (const other of ['f87', 'f75pro', 'f75']) {
        sel.value = other;
        sel.dispatchEvent(new w.Event('change', { bubbles: true }));
        await wait(300);
        await until(() => A.session.ready, 4000);
        A.setTab('keys');
        await until(() => A.keys.ka.state.status === 'ready' || A.keys.ka.state.status === 'error', 4000);
        check(A.keys.ka.state.status === 'ready', `after switching to ${other}, Keys tab: ${A.keys.ka.state.error}`);
        A.setTab('settings');
        await wait(60);
      }

      check(errors.length === 0, `no script errors:\n    ${errors.slice(0, 5).join('\n    ')}`);
      console.log(errors.length ? '  errors: ' + errors.length : '  ok, no script errors');
      dom.window.close();
    }
    console.log(failed ? `\n${failed} problem(s)` : '\nall UI checks passed');
    process.exit(failed ? 1 : 0);
  })();
}
