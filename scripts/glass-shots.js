// The Lighting tab in Liquid glass over the preset background picture, once per look (the four Liquid glass sliders vary).
//   CHROMIUM_PATH=/path/to/chrome OUT_DIR=./out BG_OPACITY=0.7 node scripts/glass-shots.js [look-id ...]
const h = require('./_harness');
const { open, enter, tab, snap, check, wait, state, chromium, serve } = h;
const BG = 'lumine-intertwined.jpg';
const VARIANTS = [
  { id: '1-default',  label: 'Default',        theme: 'dark',  glass: { blur: 2.5, bezel: 14, amount: 30, chroma: 30 } },
  { id: '2-clear',    label: 'Crystal clear',  theme: 'dark',  glass: { blur: 0,   bezel: 10, amount: 24, chroma: 0 } },
  { id: '3-frosted',  label: 'Frosted',        theme: 'dark',  glass: { blur: 8,   bezel: 18, amount: 20, chroma: 10 } },
  { id: '4-deep',     label: 'Deep lens',      theme: 'dark',  glass: { blur: 2.5, bezel: 28, amount: 60, chroma: 30 } },
  { id: '5-prism',    label: 'Prism fringe',   theme: 'dark',  glass: { blur: 1,   bezel: 14, amount: 40, chroma: 100 } },
  { id: '6-light',    label: 'Default, light', theme: 'light', glass: { blur: 2.5, bezel: 14, amount: 30, chroma: 30 } },
];
const OPACITY = process.env.BG_OPACITY || '0.9';

(async () => {
  require('fs').mkdirSync(h.OUT, { recursive: true });
  const { server, base } = await serve();
  state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  const only = process.argv.slice(2);
  for (const v of VARIANTS) {
    if (only.length && !only.includes(v.id)) continue;
    console.log('==', v.id);
    const page = await open('demo', { theme: v.theme, extra: { style: 'glass', glass: v.glass }, memory: { 'aula.bgPreset': BG, 'aula.bgOpacity': OPACITY } });
    await enter(page);
    await tab(page, 'lighting', 1200);
    await wait(800);
    await snap(page, 'lighting-glass-' + v.id);
    check(page, v.id);
    await page.ctx.close();
  }
  await state.browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
