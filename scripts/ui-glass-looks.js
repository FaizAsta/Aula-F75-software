// Settings > Theme > Liquid glass: the four looks (Clear, Blur, Frosted, Default) and the Customise button, checked in a real browser.
// A look sets the four numbers and is saved, the sliders stay hidden until Customise is pressed, a slider that is moved makes
// the look "custom" (no button lit), and Reset goes back to Blur glass.
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node scripts/ui-glass-looks.js          CHROMIUM_PATH=/path/to/chrome to use a browser you already have
//   GLASS_SHOT=/some/dir node scripts/ui-glass-looks.js     also writes a picture of each step there
// Not part of `npm test` (it needs a browser, not just node). Exits with 1 and says what failed.
'use strict';
const assert = require('assert');
const h = require('./_harness');
const { open, enter, tab, settingsPage, wait, check, chromium, serve, state } = h;

const BG = { 'aula.bgPreset': 'lumine-intertwined.jpg', 'aula.bgOpacity': '0.7' };

const read = (page) =>
  page.evaluate(() => {
    const vis = (e) => !!e && !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const seg = document.querySelector('#segGlass');
    const lit = [...seg.querySelectorAll('.seg-btn')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.glassPreset);
    const sliders = {};
    for (const r of document.querySelectorAll('#glassSection input[data-glass]')) sliders[r.dataset.glass] = +r.value;
    const btn = document.querySelector('#glassCustomBtn');
    return {
      lit,
      none: seg.classList.contains('seg-none'),
      hint: document.querySelector('#glassPresetHint').textContent,
      params: { ...window.AulaGlass.params() },
      sliders,
      panelShown: vis(document.querySelector('#glassCustom')),
      slidersShown: vis(document.querySelector('#gBlur')),
      lookButtonsShown: [...seg.querySelectorAll('.seg-btn')].every(vis),
      customBtn: { text: btn.textContent, expanded: btn.getAttribute('aria-expanded'), shown: vis(btn) },
      saved: (() => {
        try {
          const raw = (window.aulaHost && window.aulaHost.loadMemory && window.aulaHost.loadMemory()['aula.prefs']) ?? localStorage.getItem('aula.prefs');
          return JSON.parse(raw || '{}').glass || null;
        } catch (_) {
          return null;
        }
      })(),
    };
  });

async function run() {
  const page = await open('demo', { theme: 'dark', extra: { style: 'glass' }, memory: BG });
  const highlight = async (want) => {
    try {
      await page.waitForFunction((w) => +getComputedStyle(document.querySelector('#segGlass'), '::before').opacity === w, want, { timeout: 8000 });
    } catch (_) {
      const now = await page.$eval('#segGlass', (e) => getComputedStyle(e, '::before').opacity);
      throw new Error(`the highlight of the looks should be at opacity ${want}, it is ${now}`);
    }
  };
  const shot = async (name) => {
    if (!process.env.GLASS_SHOT) return;
    await wait(300);
    const sec = page.locator('#glassSection');
    await sec.scrollIntoViewIfNeeded();
    await sec.screenshot({ path: require('path').join(process.env.GLASS_SHOT, `glass-looks-${name}.png`) });
  };
  await enter(page);
  await tab(page, 'settings');
  await settingsPage(page, 'theme');
  await page.locator('#glassSection').scrollIntoViewIfNeeded();
  await wait(400);

  const P = await page.evaluate(() => JSON.parse(JSON.stringify(window.AulaGlass.PRESETS)));

  // 1. what is there at the start: the looks and the Customise button show, the sliders do not; the default is Blur glass
  let s = await read(page);
  assert.ok(s.lookButtonsShown, 'the four looks must be visible');
  assert.ok(s.customBtn.shown, 'the Customise button must be visible');
  assert.deepEqual([s.customBtn.text, s.customBtn.expanded], ['Customise', 'false']);
  assert.equal(s.panelShown, false, 'the sliders start hidden');
  assert.equal(s.slidersShown, false);
  assert.deepEqual(s.lit, ['blur'], 'the default look is Blur glass');
  assert.deepEqual(s.params, P.blur);
  await shot('1-start');

  // 2. Clear glass: the four numbers become the Clear look, one button is lit, it is saved
  await page.click('#segGlass [data-glass-preset="clear"]');
  await wait(500);
  s = await read(page);
  assert.deepEqual(s.lit, ['clear']);
  assert.deepEqual(s.params, P.clear);
  assert.deepEqual(s.saved, P.clear, 'the look is saved');
  assert.equal(s.params.blur, 0);
  assert.match(s.hint, /^Clear glass/);
  assert.equal(s.panelShown, false, 'picking a look does not open the sliders');
  await shot('2-clear');

  // 3. Frosted glass
  await page.click('#segGlass [data-glass-preset="frosted"]');
  await wait(500);
  s = await read(page);
  assert.deepEqual(s.lit, ['frosted']);
  assert.deepEqual(s.params, P.frosted);
  assert.deepEqual(s.saved, P.frosted);
  assert.match(s.hint, /^Frosted glass/);
  await shot('3-frosted');

  // 3b. Default: Blur 2.5 px, Edge width 14 px, Refraction 60 px, Colour fringe 0%
  await page.click('#segGlass [data-glass-preset="default"]');
  await wait(500);
  s = await read(page);
  assert.deepEqual(s.lit, ['default']);
  assert.deepEqual(s.params, { blur: 2.5, bezel: 14, amount: 60, chroma: 0 });
  assert.deepEqual(s.saved, P.default);
  assert.match(s.hint, /^Default/);
  await shot('3b-default');

  // 4. the page really repaints: a glass control's backdrop-filter follows the look (Clear has no frost, Frosted has a lot)
  const blurOf = () =>
    page.evaluate(() => {
      const b = document.querySelector('#segGlass');
      const f = getComputedStyle(b).backdropFilter || getComputedStyle(b).webkitBackdropFilter || '';
      const id = (f.match(/url\(["']?#([^"')]+)/) || [])[1];
      const node = id && document.getElementById(id);
      const dev = node && node.querySelector('feGaussianBlur');
      return dev ? dev.getAttribute('stdDeviation') : null;
    });
  const frostedBlur = await blurOf();
  await page.click('#segGlass [data-glass-preset="clear"]');
  await wait(500);
  const clearBlur = await blurOf();
  if (frostedBlur != null && clearBlur != null) {
    const first = (v) => parseFloat(String(v).split(/[ ,]+/)[0]);
    assert.ok(first(frostedBlur) > first(clearBlur), `Frosted must blur more than Clear (frosted ${frostedBlur}, clear ${clearBlur})`);
  }

  // 5. Customise shows the sliders, starting from the look that is on; the button turns into Hide
  await page.click('#glassCustomBtn');
  await wait(300);
  s = await read(page);
  assert.equal(s.panelShown, true);
  assert.equal(s.slidersShown, true);
  assert.deepEqual([s.customBtn.text, s.customBtn.expanded], ['Hide', 'true']);
  assert.deepEqual(s.sliders, P.clear, 'the sliders start from the look that is on');
  assert.deepEqual(s.lit, ['clear'], 'opening Customise changes nothing');
  assert.ok(s.lookButtonsShown, 'the looks stay in view while the sliders are open');
  await shot('4-customise-open');

  // 6. a look picked while the sliders are open moves the sliders with it
  await page.click('#segGlass [data-glass-preset="frosted"]');
  await wait(400);
  s = await read(page);
  assert.deepEqual(s.sliders, P.frosted);
  assert.equal(s.panelShown, true, 'the sliders stay open');

  // 7. moving a slider by hand makes the look custom: no button lit, the highlight is hidden, the change is saved
  await page.$eval('#gBlur', (r) => {
    r.value = '5';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await wait(400);
  s = await read(page);
  assert.deepEqual(s.lit, [], 'a mix of your own lights no look');
  assert.equal(s.none, true);
  assert.equal(s.params.blur, 5);
  assert.deepEqual(s.saved, { ...P.frosted, blur: 5 });
  assert.match(s.hint, /^Custom/);
  await highlight(0); // it fades out (0.2 s; a slow repaint of the glass can hold the frames back, so wait for it)
  await shot('5-custom');

  // 8. Hide closes the sliders and keeps the custom look
  await page.click('#glassCustomBtn');
  await wait(300);
  s = await read(page);
  assert.equal(s.panelShown, false);
  assert.equal(s.slidersShown, false);
  assert.deepEqual([s.customBtn.text, s.customBtn.expanded], ['Customise', 'false']);
  assert.equal(s.params.blur, 5, 'hiding the sliders keeps the custom look');
  assert.deepEqual(s.lit, []);

  // 9. a ready-made look gets the highlight back
  await page.click('#segGlass [data-glass-preset="blur"]');
  await wait(500);
  s = await read(page);
  assert.deepEqual(s.lit, ['blur']);
  assert.equal(s.none, false);
  await highlight(1);

  // 10. Reset (inside Customise) goes back to Blur glass, the default
  await page.click('#segGlass [data-glass-preset="clear"]');
  await page.click('#glassCustomBtn');
  await wait(300);
  await page.click('#glassReset');
  await wait(400);
  s = await read(page);
  assert.deepEqual(s.lit, ['blur']);
  assert.deepEqual(s.params, P.blur);

  // 11. the keyboard-friendly bits: the looks are a radio group and the Customise button says what it controls
  const a11y = await page.evaluate(() => ({
    role: document.querySelector('#segGlass').getAttribute('role'),
    radios: [...document.querySelectorAll('#segGlass .seg-btn')].map((b) => b.getAttribute('role')),
    controls: document.querySelector('#glassCustomBtn').getAttribute('aria-controls'),
    exists: !!document.getElementById('glassCustom'),
  }));
  assert.deepEqual(a11y, { role: 'radiogroup', radios: ['radio', 'radio', 'radio', 'radio'], controls: 'glassCustom', exists: true });

  check(page, 'glass looks');
  await page.ctx.close();
  console.log('  ok');
}

// the choice survives a restart: a saved look comes back lit, and the sliders are closed again
async function restart() {
  const page = await open('demo', { theme: 'dark', extra: { style: 'glass', glass: { blur: 0, bezel: 16, amount: 40, chroma: 35 } }, memory: BG });
  await enter(page);
  await tab(page, 'settings');
  await settingsPage(page, 'theme');
  const s = await read(page);
  assert.deepEqual(s.lit, ['clear'], 'a saved look is lit again after a restart');
  assert.equal(s.panelShown, false, 'the sliders are closed after a restart');
  // an older save that matches no look is kept as it is and shown as custom
  await page.ctx.close();
  const old = await open('demo', { theme: 'dark', extra: { style: 'glass', glass: { blur: 4, bezel: 20, amount: 45, chroma: 10 } }, memory: BG });
  await enter(old);
  await tab(old, 'settings');
  await settingsPage(old, 'theme');
  const t = await read(old);
  assert.deepEqual(t.lit, []);
  assert.deepEqual(t.params, { blur: 4, bezel: 20, amount: 45, chroma: 10 });
  await old.ctx.close();
  console.log('  ok (restart)');
}

(async () => {
  const { server, base } = await serve();
  state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  let failed = false;
  for (const [name, fn] of [['looks and Customise', run], ['restart', restart]]) {
    try {
      await fn();
    } catch (e) {
      failed = true;
      console.error('  FAILED', name, String(e.message || e).split('\n').slice(0, 5).join('\n    '));
    }
  }
  await state.browser.close();
  server.close();
  if (failed) process.exit(1);
  console.log('glass looks: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
