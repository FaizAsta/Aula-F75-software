// The dropdown menu (js/select.js, css/select.css, css/glass.css section 10), checked in a real browser in Classic and in
// Liquid glass: it opens from the select, stays inside the window, is chosen with the mouse and with the keyboard, fires
// "change" like the browser's own list, closes the right way, and wears the right look for each style.
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node scripts/ui-select.js          CHROMIUM_PATH=/path/to/chrome to use a browser you already have
// Not part of `npm test` (it needs a browser, not just node). Exits with 1 and says what failed.
'use strict';
const assert = require('assert');
const h = require('./_harness');
const { open, enter, tab, wait, check, state, chromium, serve } = h;

const BG = { 'aula.bgPreset': 'lumine-intertwined.jpg', 'aula.bgOpacity': '0.7' };
const STYLES = [
  { name: 'classic', extra: { style: 'classic' } },
  { name: 'glass', extra: { style: 'glass' } }, // Normal glass, the default type: a plain blur
  { name: 'glass-realistic', extra: { style: 'glass', glassType: 'realistic' } }, // Realistic glass: its own SVG filter
];

const isOpen = (page) => page.evaluate(() => window.AulaSelect.isOpen());
const value = (page, id = '#sleepSel') => page.$eval(id, (s) => s.value);
const label = (page, id = '#sleepSel') => page.$eval(id, (s) => s.options[s.selectedIndex].textContent);
const active = (page) => page.$eval('.sel-item.is-active .sel-label', (e) => e.textContent);
const settle = async (page, what, fn, limit = 8000) => {
  try {
    await page.waitForFunction(fn, null, { timeout: limit });
  } catch (_) {
    throw new Error(`timed out waiting for: ${what}`);
  }
};

async function run(style) {
  const page = await open('demo', { theme: 'dark', extra: style.extra, memory: BG });
  const tag = (m) => `[${style.name}] ${m}`;
  await enter(page);
  await tab(page, 'lighting', 900);
  // count the "change" events the app would see
  await page.evaluate(() => {
    window.__changes = 0;
    document.querySelectorAll('select.select').forEach((s) => s.addEventListener('change', () => window.__changes++));
  });

  // 1. a click opens our menu, and the browser's own list is stopped (the mousedown is cancelled)
  const cancelled = await page.$eval('#sleepSel', (s) => !s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })));
  assert.ok(cancelled, tag('mousedown on a select must be cancelled so the browser list never opens'));
  await settle(page, 'the menu opens', () => window.AulaSelect.isOpen());
  const shape = await page.evaluate(() => {
    const sel = document.getElementById('sleepSel');
    const pop = document.getElementById('selPop');
    const shell = document.querySelector('.shell').getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    return {
      rows: pop.querySelectorAll('.sel-item').length,
      options: sel.options.length,
      selected: pop.querySelector('.sel-item[aria-selected="true"] .sel-label').textContent,
      expanded: sel.getAttribute('aria-expanded'),
      inside: r.left >= shell.left && r.right <= shell.right && r.top >= shell.top && r.bottom <= shell.bottom,
      side: pop.dataset.side,
    };
  });
  assert.equal(shape.rows, shape.options, tag('one row per option'));
  assert.equal(shape.selected, await label(page), tag('the current choice is marked'));
  assert.equal(shape.expanded, 'true');
  assert.ok(shape.inside, tag('the menu stays inside the window'));

  // 2. the look: Classic is frosted (a plain blur), Normal glass is a plain blur too (class ag), Realistic glass refracts (its own SVG filter, class ag)
  if (style.name.startsWith('glass')) {
    await settle(page, 'glass.js has measured the menu', () => document.getElementById('selPop').classList.contains('ag'));
    const look = await page.$eval('#selPop', (e) => ({ f: getComputedStyle(e).backdropFilter, v: getComputedStyle(e).visibility, r: parseFloat(getComputedStyle(e).borderTopLeftRadius) }));
    if (style.name === 'glass-realistic') assert.match(look.f, /url\(/, tag('the Realistic glass menu refracts through an SVG filter'));
    else {
      assert.match(look.f, /^blur\(/, tag('the Normal glass menu is a blur'));
      assert.ok(!/url\(/.test(look.f), tag('and does not bend the picture'));
    }
    assert.equal(look.v, 'visible');
    assert.ok(look.r >= 20, tag('the glass menu has soft, round corners'));
    const row = await page.$eval('.sel-item', (e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
    assert.ok(row >= 16, tag('the glass rows are capsules'));
  } else {
    const look = await page.$eval('#selPop', (e) => getComputedStyle(e).backdropFilter);
    assert.match(look, /blur\(/, tag('the Classic menu is frosted'));
    assert.ok(!(await page.$eval('#selPop', (e) => e.classList.contains('ag'))), tag('Classic has no glass layer'));
  }

  // 3. the pointer moves the highlight, a click chooses, and the app hears a "change"
  const from = await value(page);
  const rows = page.locator('.sel-item');
  const target = (await rows.count()) - 1; // the last row
  await rows.nth(target).hover();
  assert.equal(await active(page), await rows.nth(target).locator('.sel-label').textContent(), tag('hover highlights the row'));
  await rows.nth(target).click();
  await settle(page, 'the menu closes after a click', () => !window.AulaSelect.isOpen());
  assert.notEqual(await value(page), from, tag('the click chose the row'));
  assert.equal(await page.evaluate(() => window.__changes), 1, tag('exactly one change event'));

  // 4. keyboard: Enter opens, arrows move, Enter chooses, the focus comes back to the select
  await page.focus('#sleepSel');
  await page.keyboard.press('Enter');
  await settle(page, 'Enter opens the menu', () => window.AulaSelect.isOpen());
  assert.equal(await active(page), await label(page), tag('the menu starts on the current choice'));
  await page.keyboard.press('Home');
  const first = await active(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await active(page), first, tag('arrows move the highlight'));
  const picked = await active(page);
  await page.keyboard.press('Enter');
  await settle(page, 'Enter chooses', () => !window.AulaSelect.isOpen());
  assert.equal(await label(page), picked, tag('Enter chose the highlighted row'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'sleepSel', tag('the focus is back on the select'));
  assert.equal(await page.evaluate(() => window.__changes), 2);

  // 5. typing jumps to a row ("9" is 90 seconds), Escape closes without changing anything
  await page.keyboard.press('Space');
  await settle(page, 'Space opens the menu', () => window.AulaSelect.isOpen());
  await page.keyboard.type('9');
  assert.equal(await active(page), '90 seconds', tag('typing jumps to a matching row'));
  const before = await value(page);
  await page.keyboard.press('Escape');
  await settle(page, 'Escape closes', () => !window.AulaSelect.isOpen());
  assert.equal(await value(page), before, tag('Escape changes nothing'));
  assert.equal(await page.evaluate(() => window.__changes), 2);

  // 6. a click elsewhere closes it, a second click on the select closes it, and the other pages' selects open it too
  await page.click('#sleepSel');
  await settle(page, 'opens again', () => window.AulaSelect.isOpen());
  await page.click('#sleepSel');
  await settle(page, 'a second click on the select closes it', () => !window.AulaSelect.isOpen());
  await page.click('#sleepSel');
  await settle(page, 'opens a third time', () => window.AulaSelect.isOpen());
  await page.mouse.click(40, 400);
  await settle(page, 'a click elsewhere closes it', () => !window.AulaSelect.isOpen());
  assert.equal(await value(page), before);

  // 7. leaving the page closes it
  await page.click('#sleepSel');
  await settle(page, 'opens a fourth time', () => window.AulaSelect.isOpen());
  await tab(page, 'settings', 500);
  await settle(page, 'switching page closes the menu', () => !window.AulaSelect.isOpen());

  // 8. the other selects (Battery: low battery alert; Settings: brightness levels) use the same menu
  for (const [id, where] of [['#lowSel', 'battery'], ['#brightMaxSel', 'settings']]) {
    await tab(page, where, 600);
    if (where === 'settings') {
      for (const pg of ['keyboard', 'app', 'theme', 'debug']) {
        if (await page.isVisible(id)) break;
        await h.settingsPage(page, pg);
      }
    }
    await page.click(id);
    await settle(page, `${id} opens`, () => window.AulaSelect.isOpen());
    const n = await page.evaluate((i) => [document.querySelectorAll('#selPop .sel-item').length, document.querySelector(i).options.length], id);
    assert.equal(n[0], n[1], tag(`${id}: one row per option`));
    await page.keyboard.press('Escape');
    await settle(page, `${id} closes`, () => !window.AulaSelect.isOpen());
  }

  check(page, style.name);
  await page.ctx.close();
  console.log('  ok', style.name);
}

(async () => {
  const { server, base } = await serve();
  state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  let failed = false;
  for (const s of STYLES) {
    try {
      await run(s);
    } catch (e) {
      failed = true;
      console.error('  FAILED', s.name, String(e.message || e).split('\n').slice(0, 4).join('\n    '));
    }
  }
  await state.browser.close();
  server.close();
  if (failed) process.exit(1);
  console.log('dropdown menu: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
