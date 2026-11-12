// Liquid glass on every page: renders each screen with Liquid glass on and the preset background picture.
const h = require('./_harness');
const { open, enter, tab, settingsPage, snap, check, wait, state, chromium, serve } = h;
const BG = 'lumine-intertwined.jpg';
const OPACITY = process.env.BG_OPACITY || '0.7';
const mk = (scenario = 'demo', theme = 'dark') => open(scenario, { theme, extra: { style: 'glass' }, memory: { 'aula.bgPreset': BG, 'aula.bgOpacity': OPACITY } });

const SCENES = {
  async start() { const p = await mk(); await wait(600); await snap(p, 'page-01-start'); check(p, 'start'); await p.ctx.close(); },
  async devices() {
    const p = await mk('charging');
    await p.click('#hmStart'); await p.waitForSelector('#hmList .hm-dev');
    await p.waitForFunction(() => document.querySelectorAll('#hmList .hm-dev').length >= 3, null, { timeout: 15000 });
    await wait(1800); await snap(p, 'page-02-devices'); check(p, 'devices'); await p.ctx.close();
  },
  async lighting() { const p = await mk(); await enter(p); await wait(600); await snap(p, 'page-03-lighting'); check(p, 'lighting'); await p.ctx.close(); },
  async perkey() { const p = await mk(); await enter(p); await tab(p, 'perkey', 1400); await snap(p, 'page-04-perkey'); check(p, 'perkey'); await p.ctx.close(); },
  async keys() {
    const p = await mk(); await enter(p); await tab(p, 'keys');
    await p.waitForFunction(() => window.aulaApp.keys.ka.state.status === 'ready', null, { timeout: 10000 });
    await p.evaluate(() => window.aulaApp.keys.pick(window.AulaLayout.KEYS.find((k) => k.n === 'Caps')));
    await wait(300); await p.click('#kaGroups [data-group="fkeys"]'); await wait(200);
    await p.locator('#kaGrid .ka-key').nth(12).click(); await wait(900);
    await snap(p, 'page-05-keys'); check(p, 'keys'); await p.ctx.close();
  },
  async battery() { const p = await mk(); await enter(p); await tab(p, 'battery', 1400); await snap(p, 'page-06-battery'); check(p, 'battery'); await p.ctx.close(); },
  async settings() {
    const p = await mk(); await enter(p); await tab(p, 'settings', 800);
    let i = 7;
    for (const pg of ['keyboard', 'app', 'theme', 'debug']) { await settingsPage(p, pg); await wait(700); await snap(p, `page-0${i++}-settings-${pg}`.replace('page-010', 'page-10')); }
    check(p, 'settings'); await p.ctx.close();
  },
  async support() { const p = await mk(); await enter(p); await p.click('#supBtn'); await p.waitForSelector('#supPop:not([hidden])'); await wait(700); await snap(p, 'page-11-support'); check(p, 'support'); await p.ctx.close(); },
  async asleep() {
    const p = await mk('asleep'); await p.click('#hmStart'); await p.waitForSelector('#hmList .hm-dev'); await wait(600);
    await p.locator('#hmList .hm-dev', { hasText: /dongle/i }).first().click();
    await p.waitForFunction(() => !document.getElementById('overlay').hidden && /asleep/.test(document.getElementById('ovTitle').textContent), null, { timeout: 20000 });
    await wait(1200); await snap(p, 'page-12-asleep'); check(p, 'asleep'); await p.ctx.close();
  },
  async max() {
    const p = await mk('max'); await enter(p, /Max/i); await wait(800); await snap(p, 'page-15-max');
    await tab(p, 'perkey'); await p.click('#mxRainbow'); await wait(700); await snap(p, 'page-16-max-perkey');
    check(p, 'max', /arcTo/); await p.ctx.close();
  },
  async update() {
    const p = await mk(); await enter(p);
    await p.evaluate(() => { const info = { version: '1.4.9', current: '1.4.8', notes: '## 1.4.9\n- Liquid glass on every panel, card and pill\n- Faster, lighter refraction\n- Small fixes', mode: 'installer', size: 86 * 1048576 }; window.__upd.badge(info); window.__upd.available(info); });
    await wait(900); await snap(p, 'page-17-update'); check(p, 'update'); await p.ctx.close();
  },
  async light() { const p = await mk('demo', 'light'); await enter(p); await wait(600); await snap(p, 'page-13-lighting-light'); await tab(p, 'settings', 800); await settingsPage(p, 'keyboard'); await wait(700); await snap(p, 'page-14-settings-light'); check(p, 'light'); await p.ctx.close(); },
};

(async () => {
  require('fs').mkdirSync(h.OUT, { recursive: true });
  const { server, base } = await serve(); state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  const only = process.argv.slice(2);
  for (const [name, fn] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue;
    console.log('==', name);
    try { await fn(); } catch (e) { console.error('  FAILED', name, String(e.message).split('\n')[0]); }
  }
  await state.browser.close(); server.close();
})();
