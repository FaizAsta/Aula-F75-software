// Settings > Theme > Liquid glass > Glass type (Normal or Realistic), checked in a real browser: Normal is the default and builds no
// SVG filters at all, Realistic builds them, a switch either way tears down what the other made, the Blur slider moves the one blur
// Normal uses, the choice is saved, and the question after Start shows only the sliders that do something for the type.
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node scripts/ui-glass-type.js          CHROMIUM_PATH=/path/to/chrome to use a browser you already have
// Not part of `npm test` (it needs a browser, not just node). Exits with 1 and says what failed.
'use strict';
const assert = require('assert');
const h = require('./_harness');
const { open, tab, settingsPage, wait, chromium, serve, state } = h;

const BG = { 'aula.bgPreset': 'lumine-intertwined.jpg', 'aula.bgOpacity': '0.7' };

// Start -> Demo keyboards -> Demo keyboard -> the main screen (the Start screen opens the list of real devices first).
async function enterDemo(page) {
  await page.click('#hmStart');
  await wait(600);
  await page.click('#hmDemos');
  await page.waitForFunction(() => document.getElementById('hmTitle').textContent === 'Demo keyboards');
  await wait(700);
  await page.locator('#hmList .hm-dev', { hasText: /Demo keyboard/ }).first().click();
  await page.waitForFunction(() => window.aulaApp.session.ready, null, { timeout: 15000 });
  await wait(2200);
}

const read = (page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const surface = document.querySelector('.tabs.ag, .btn.ag, .seg.ag');
    const lit = [...document.querySelectorAll('#segGlassType .seg-btn')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.glassType);
    const prefs = JSON.parse(window.aulaHost.loadMemory()['aula.prefs'] || '{}');
    return {
      type: window.AulaGlass.type(),
      classes: [...root.classList].filter((c) => /^glass/.test(c)).join(' '),
      rootBlur: root.style.getPropertyValue('--ag-filter'),
      svgFilters: document.querySelectorAll('svg defs filter').length,
      surfaces: document.querySelectorAll('.ag, .ag-panel').length,
      inlineFilters: [...document.querySelectorAll('.ag, .ag-panel')].filter((e) => e.style.getPropertyValue('--ag-filter')).length,
      backdrop: surface ? getComputedStyle(surface).backdropFilter : null,
      realRowsHidden: [...document.querySelectorAll('#glassSection [data-glass-real]')].every((e) => e.hidden),
      lit,
      saved: prefs.glassType,
    };
  });

async function settingsRun() {
  const page = await open('demo', { theme: 'dark', extra: { style: 'glass' }, memory: BG });
  await enterDemo(page);
  await tab(page, 'settings');
  await settingsPage(page, 'theme');
  await page.locator('#glassSection').scrollIntoViewIfNeeded();
  await wait(900);

  // 1. the default: Normal, one blur on <html>, no SVG filter anywhere, every surface marked
  let s = await read(page);
  assert.equal(s.type, 'normal');
  assert.equal(s.classes, 'glass glass-normal');
  assert.match(s.rootBlur, /^blur\(\d+(\.\d+)?px\)$/);
  assert.equal(s.svgFilters, 0, 'Normal builds no SVG filter');
  assert.equal(s.inlineFilters, 0, 'and no surface carries a filter of its own');
  assert.ok(s.surfaces > 20, `the surfaces are marked (${s.surfaces})`);
  assert.match(s.backdrop, /^blur\(/, 'the surfaces blur their backdrop');
  assert.ok(!/url\(/.test(s.backdrop), 'and do not bend it');
  assert.ok(s.realRowsHidden, 'edge width, refraction and colour fringe are hidden');
  assert.deepEqual(s.lit, ['normal']);
  console.log('  ok (default is Normal)');

  // 2. the Blur slider moves the one blur
  await page.click('#glassCustomBtn');
  await wait(300);
  const blurAt = async (v) => {
    await page.evaluate((x) => {
      const r = document.querySelector('#gBlur');
      r.value = x;
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    await wait(250);
    return (await read(page)).rootBlur;
  };
  assert.equal(await blurAt(0), 'blur(0px)');
  const a = parseFloat((await blurAt(4)).slice(5));
  const b = parseFloat((await blurAt(9)).slice(5));
  assert.ok(a > 0 && b > a, `more Blur setting, more blur (${a}px, ${b}px)`);
  await page.click('#glassReset');
  await wait(300);
  console.log('  ok (Blur slider)');

  // 3. Realistic: its filters are built, each surface has its own, the blur on <html> is gone, the three sliders show, it is saved
  await page.click('#segGlassType [data-glass-type="realistic"]');
  await wait(1800);
  s = await read(page);
  assert.equal(s.type, 'realistic');
  assert.equal(s.classes, 'glass');
  assert.equal(s.rootBlur, '', 'no blur left on <html>');
  assert.ok(s.svgFilters > 5, `Realistic builds its filters (${s.svgFilters})`);
  assert.ok(s.inlineFilters > 5);
  assert.match(s.backdrop, /^url\(/, 'the surfaces bend their backdrop through a filter');
  assert.equal(s.realRowsHidden, false, 'the three Realistic sliders show');
  assert.deepEqual(s.lit, ['realistic']);
  assert.equal(s.saved, 'realistic');
  console.log('  ok (switch to Realistic)');

  // 4. and back: every filter is gone again, nothing left on the surfaces
  await page.click('#segGlassType [data-glass-type="normal"]');
  await wait(1500);
  s = await read(page);
  assert.equal(s.type, 'normal');
  assert.equal(s.classes, 'glass glass-normal');
  assert.equal(s.svgFilters, 0, 'the Realistic filters are removed');
  assert.equal(s.inlineFilters, 0);
  assert.match(s.rootBlur, /^blur\(/);
  assert.ok(s.realRowsHidden);
  assert.equal(s.saved, 'normal');
  console.log('  ok (back to Normal)');

  // 5. Classic leaves nothing behind
  await page.click('#segStyle [data-style-pref="classic"]');
  await wait(600);
  const c = await page.evaluate(() => ({ classes: [...document.documentElement.classList].filter((x) => /^glass/.test(x)), blur: document.documentElement.style.getPropertyValue('--ag-filter'), marked: document.querySelectorAll('.ag, .ag-panel').length }));
  assert.deepEqual(c, { classes: [], blur: '', marked: 0 });
  console.log('  ok (Classic is untouched)');
  assert.deepEqual(page.errors, [], 'no page errors');
  await page.ctx.close();
}

// A start that already has Realistic saved (an older choice) comes up Realistic, and a saved glass setting with no type is Normal.
async function restartRun() {
  const real = await open('demo', { theme: 'dark', extra: { style: 'glass', glassType: 'realistic' }, memory: BG });
  await wait(800);
  let s = await real.evaluate(() => ({ type: window.AulaGlass.type(), classes: [...document.documentElement.classList].filter((c) => /^glass/.test(c)).join(' ') }));
  assert.deepEqual(s, { type: 'realistic', classes: 'glass' });
  await real.ctx.close();
  const old = await open('demo', { theme: 'dark', extra: { style: 'glass', glass: { blur: 4, bezel: 20, amount: 45, chroma: 10 } }, memory: BG });
  await wait(800);
  s = await old.evaluate(() => ({ type: window.AulaGlass.type(), classes: [...document.documentElement.classList].filter((c) => /^glass/.test(c)).join(' '), pref: window.aulaApp.prefs.glassType }));
  assert.deepEqual(s, { type: 'normal', classes: 'glass glass-normal', pref: 'normal' }, 'a glass setting saved before the types existed is Normal');
  await old.ctx.close();
  console.log('  ok (restart)');
}

// The question after Start: Normal shows only Blur, and the live picture is told the type.
async function questionRun() {
  const page = await open('demo', { theme: 'dark', extra: { styleAsked: false }, memory: BG });
  await page.evaluate(() => { const p = JSON.parse(window.aulaHost.loadMemory()['aula.prefs']); p.styleAsked = false; window.aulaHost.setMemory('aula.prefs', JSON.stringify(p)); });
  await page.reload();
  await page.waitForFunction(() => window.aulaApp && document.querySelector('#hmStart'));
  await wait(900);
  await page.click('#hmStart');
  await page.waitForSelector('#spScreen .sp-card[data-style-choice="glass"]', { state: 'visible', timeout: 10000 });
  await page.click('.sp-card[data-style-choice="glass"]');
  await wait(900);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#spOptsGlass input[data-glass]')].filter((r) => r.closest('[data-glass-real]') ? !r.closest('[data-glass-real]').hidden : true).map((r) => r.dataset.glass));
  assert.deepEqual(shown, ['blur'], 'the question shows only Blur for Normal glass');
  assert.equal(await page.evaluate(() => window.aulaApp.styleOptions().glassType), 'normal');
  console.log('  ok (the question)');
  await page.ctx.close();
}

(async () => {
  const { server, base } = await serve();
  state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  let failed = false;
  for (const [name, fn] of [['Settings: the type switch', settingsRun], ['restart', restartRun], ['the question', questionRun]]) {
    try {
      await fn();
    } catch (e) {
      failed = true;
      console.error('  FAILED', name, String(e.message || e).split('\n').slice(0, 6).join('\n    '));
    }
  }
  await state.browser.close();
  server.close();
  if (failed) process.exit(1);
  console.log('glass type: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
