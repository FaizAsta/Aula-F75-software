// Liquid glass scroll bars and the update progress bar, checked in a real browser (the glass needs layout and backdrop filters,
// which a fake page cannot give). Drives the real src/index.html with the same stand-in for Electron as `npm run screenshots`.
//   npm install --no-save playwright && npx playwright install chromium     (once)
//   node scripts/ui-glass-scroll.js          CHROMIUM_PATH=/path/to/chrome to use a browser you already have
// Not part of `npm test` (it needs a browser, not just node). Exits with 1 and says what failed.
'use strict';
const assert = require('assert');
const h = require('./_harness');
const { open, enter, tab, settingsPage, wait, state, chromium, serve } = h;

// Both types of glass are checked: Normal (the default, a plain blur) and Realistic (each surface bends the picture through its own SVG filter).
const glass = (theme = 'dark', glassType = 'normal') => open('demo', { theme, extra: { style: 'glass', glassType }, memory: { 'aula.bgPreset': 'lumine-intertwined.jpg', 'aula.bgOpacity': '0.7' } });

// Software-rendered headless Chromium can take half a second per frame (the whole glass UI is backdrop filters), and a busy
// machine stalls longer, so a fixed sleep after a move is a coin toss, and so is "it stopped changing" (a stalled page does not
// change either). Wait until the expected result is there (until), then until it has stopped changing for a few reads in a row.
async function settled(read, { until = () => true, every = 150, same = 3, limit = 12000 } = {}) {
  const t0 = Date.now();
  let last = null;
  let n = 0;
  for (;;) {
    const raw = await read();
    const v = JSON.stringify(raw);
    n = until(raw) && v === last ? n + 1 : 0;
    last = v;
    if (n >= same || Date.now() - t0 > limit) return JSON.parse(v);
    await wait(every);
  }
}

// the page area, the strip beside it and its thumb, as numbers
const probe = (page) =>
  page.evaluate(() => {
    const area = document.querySelector('.panels');
    const bar = area.nextElementSibling;
    const thumb = bar && bar.querySelector('.ag-scroll-thumb');
    const box = (el) => el && el.getBoundingClientRect().toJSON();
    return {
      top: area.scrollTop,
      max: area.scrollHeight - area.clientHeight,
      hidden: bar && bar.hidden,
      cls: bar ? bar.className : '',
      nativeBar: getComputedStyle(area).scrollbarWidth,
      marked: area.hasAttribute('data-ag-scroll'),
      thumb: box(thumb),
      bar: box(bar),
      glass: !!thumb && thumb.classList.contains('ag') ? getComputedStyle(thumb).backdropFilter : '',
      bars: document.querySelectorAll('.ag-scroll').length,
    };
  });

async function scrollBars(browserPage) {
  const p = browserPage;
  await enter(p);
  await tab(p, 'settings', 800);
  await settingsPage(p, 'theme'); // a long page
  await wait(900);

  let i = await probe(p);
  assert.ok(!i.hidden, 'a long page has a scroll bar');
  assert.ok(i.marked && i.nativeBar === 'none', 'the native bar is hidden while the glass one is drawn');
  const type = await p.evaluate(() => window.AulaGlass.type());
  if (type === 'realistic') assert.match(i.glass, /url\(/, 'the thumb refracts (it has a filter of its own)');
  else {
    assert.match(i.glass, /^blur\(/, 'the thumb blurs the picture behind it (Normal glass)');
    assert.ok(!/url\(/.test(i.glass), 'and does not bend it');
  }

  // drag: the page moves in proportion to the thumb
  const cx = i.thumb.x + i.thumb.width / 2;
  const cy = i.thumb.y + i.thumb.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx, cy + 60, { steps: 6 });
  let j = await settled(() => probe(p), { until: (r) => r.top > i.top });
  assert.ok(/held/.test(j.cls), 'the thumb lights up while it is dragged');
  const want = i.top + 60 * (i.max / (i.bar.height - i.thumb.height));
  assert.ok(Math.abs(j.top - want) < 3, `dragging 60 px moved the page to ${j.top}, expected ${want.toFixed(1)}`);
  await p.mouse.up();
  await wait(150);
  j = await probe(p);
  assert.ok(!/held/.test(j.cls) && j.thumb.y > i.thumb.y, 'released, and the thumb followed the page');

  // a wheel turned over the strip scrolls the page
  const before = j.top;
  await p.mouse.move(j.bar.x + 9, j.bar.y + 20);
  await p.mouse.wheel(0, 200);
  j = await settled(() => probe(p), { until: (r) => r.top > before });
  assert.ok(j.top > before, 'wheel over the strip scrolls');

  // a click beside the thumb pages down, then up
  const b2 = j.top;
  await p.mouse.click(j.bar.x + 9, j.bar.y + j.bar.height - 4);
  j = await settled(() => probe(p), { until: (r) => r.top > b2 + 200 });
  assert.ok(j.top > b2 + 200, 'click below the thumb: one page down');
  const b3 = j.top;
  await p.mouse.click(j.bar.x + 9, j.bar.y + 4);
  j = await settled(() => probe(p), { until: (r) => r.top < b3 - 200 });
  assert.ok(j.top < b3 - 200, 'click above the thumb: one page up');

  // the end of the page: the thumb stays inside its track
  await p.evaluate(() => (document.querySelector('.panels').scrollTop = 1e6));
  j = await settled(() => probe(p), { until: (r) => r.top >= r.max - 1 });
  assert.ok(j.thumb.y >= j.bar.y - 1 && j.thumb.y + j.thumb.height <= j.bar.y + j.bar.height + 1, 'the thumb stays inside the track at the end');

  // a page that fits has no bar
  await tab(p, 'perkey', 700);
  assert.ok((await probe(p)).hidden, 'a page that fits shows no bar');
  await tab(p, 'settings', 600);
  await settingsPage(p, 'theme');
  await wait(400);

  // a smaller window: the track follows
  await p.setViewportSize({ width: 1000, height: 640 });
  await wait(700);
  j = await probe(p);
  assert.ok(!j.hidden && j.bar.height > 100, 'the bar follows the window size');
  await p.setViewportSize({ width: h.W, height: h.H });
  await wait(500);

  // Classic gives everything back, glass again builds it again
  await p.evaluate(() => window.AulaGlass.set(false));
  await wait(400);
  let c = await probe(p);
  assert.ok(c.bars === 0 && !c.marked && c.nativeBar === 'thin', 'Classic: no glass bars, the native bar is back');
  await p.evaluate(() => window.AulaGlass.set(true));
  await wait(800);
  c = await probe(p);
  assert.ok(c.bars >= 1 && c.marked && c.glass, 'Liquid glass again: the bars are back');
}

async function progressBar(browserPage) {
  const p = browserPage;
  await enter(p);
  await p.evaluate(() => {
    const info = { version: '1.5.0', current: '1.4.9', mode: 'installer', size: 120 * 1048576 };
    window.__upd.badge(info);
    window.__upd.available(info);
  });
  await wait(500);
  await p.click('.upd-main'); // Update now: the download starts
  await wait(300);
  const read = () =>
    p.evaluate(() => {
      const barEl = document.getElementById('updBar');
      const bar = barEl.getBoundingClientRect();
      const fill = document.getElementById('updFill').getBoundingClientRect();
      return { shown: !barEl.hidden, bar: bar.toJSON(), fill: fill.toJSON(), pf: barEl.style.getPropertyValue('--pf'), knob: !!barEl.querySelector('span'), glass: barEl.classList.contains('ag') };
    });
  for (const f of [0, 0.32, 0.93, 1]) {
    await p.evaluate((f) => window.__upd.progress({ received: f * 120 * 1048576, total: 120 * 1048576 }), f);
    const r = await settled(read, { until: (x) => Math.abs(x.fill.width - x.bar.width * f) < 1.5 }); // the fill moves over 0.25 s, plus however long a frame takes
    assert.ok(r.shown && r.glass, `at ${f}: the bar is a glass tube`);
    assert.ok(!r.knob, `at ${f}: no knob on the bar (it is not a slider)`);
    assert.strictEqual(Number(r.pf), f);
    assert.ok(Math.abs(r.fill.width - r.bar.width * f) < 1.5, `at ${f}: the fill is ${f * 100}% of the bar (${r.fill.width.toFixed(1)} of ${r.bar.width.toFixed(1)} px)`);
    assert.ok(r.fill.x >= r.bar.x - 0.5 && r.fill.right <= r.bar.right + 0.5, `at ${f}: the fill stays inside the bar`);
  }
  await p.evaluate(() => window.__upd.state({ state: 'installing' }));
  const r = await settled(read, { until: (x) => Number(x.pf) === 1 && Math.abs(x.fill.right - x.bar.right) < 1.5 });
  assert.ok(r.shown && Number(r.pf) === 1 && Math.abs(r.fill.right - r.bar.right) < 1.5, 'installing: the bar is full');
  // Classic still has its flat bar
  await p.evaluate(() => window.AulaGlass.set(false));
  await wait(300);
  const classic = await p.evaluate(() => document.getElementById('updFill').style.transform);
  assert.strictEqual(classic, 'scaleX(1)');
}

(async () => {
  const { server, base } = await serve();
  state.base = base;
  // headless Chromium hides scroll bars by default; the point of this check is how they look and work
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--force-color-profile=srgb'] });
  let failed = false;
  for (const [name, fn] of [['scroll bars', scrollBars], ['update progress bar', progressBar]]) {
    for (const glassType of ['normal', 'realistic']) {
      for (const theme of ['dark', 'light']) {
        const page = await glass(theme, glassType);
        try {
          await fn(page);
          assert.strictEqual(page.errors.length, 0, `the page reported errors:\n  ${page.errors.slice(0, 3).join('\n  ')}`);
          console.log(`ok   ${name} (${glassType}, ${theme})`);
        } catch (e) {
          failed = true;
          console.log(`FAIL ${name} (${glassType}, ${theme}): ${e.message}`);
        }
        await page.ctx.close();
      }
    }
  }
  await state.browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
