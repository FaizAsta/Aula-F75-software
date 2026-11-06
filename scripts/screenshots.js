#!/usr/bin/env node
/*
 * Regenerates every picture in docs/screenshots from the REAL app UI (src/index.html and every script), so the README
 * always shows what the app looks like now.
 *
 *   npm install --no-save playwright sharp    (once; sharp is optional and makes the files about 4x smaller)
 *   npx playwright install chromium           (once; the browser)
 *   npm run screenshots                       (all pictures, about two minutes)
 *   npm run screenshots -- lighting battery   (only the ones named; see the SHOTS list below)
 *   npm run screenshots -- --list             (the names)
 *
 * WHEN TO RUN IT: whenever the UI changes (layout, colours, text, a new tab, setting, dialog or screen), run it and
 * commit the new pictures with the change. If you add a screen, add a scene for it below and a line for it in README.md.
 *
 * How it works: the page is served from a tiny local web server and opened in headless Chromium at the app's default
 * window size (1200 x 800). Inside the desktop app the page talks to Electron through `window.aulaHost`; here a stand-in
 * for it is installed before the page starts (settings, window buttons, updates). Keyboards are simulated:
 *   - the built-in Demo keyboard,
 *   - the 2.4G dongle, the USB-C cable and a sleeping keyboard, built from the same fakes the tests use (test/fake-*.js),
 *   - an F75 Max (fake-max.js).
 * No keyboard, no Electron and no Windows are needed. The pictures show a simulated keyboard, never real hardware.
 *
 * Environment: CHROMIUM_PATH = a Chromium / Chrome executable to use instead of Playwright's own browser.
 *              SHOT_SCALE    = device pixel ratio (default 2, so the text stays sharp on high-resolution screens).
 *              SHOT_NO_OPTIMIZE = 1 keeps the pictures exactly as the browser made them (needs no sharp, files are bigger).
 *              SHOT_NO_PRESET   = 1 leaves the preset background picture out of the Settings > Theme picture.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
let sharp = null; // optional: shrinks the pictures (see finish())
try {
  sharp = require('sharp');
} catch (_) {
  /* the pictures are then saved as the browser made them: bigger files, same look */
}
for (const name of ['playwright', 'playwright-core']) {
  try {
    ({ chromium } = require(name));
    break;
  } catch (_) {
    /* try the next one */
  }
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PKG = require(path.join(ROOT, 'package.json'));
const W = 1200; // the app's default window size (main.js)
const H = 800;
const SCALE = Number(process.env.SHOT_SCALE) || 2;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------ local web server

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/src/index.html` })));
}

// ----------------------------------------------------------------------------------- the stand-in for the Electron side

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const FAKES = { 'fake-hid': read('test', 'fake-hid.js'), 'fake-cable': read('test', 'fake-cable.js'), 'fake-max': read('test', 'fake-max.js') };
const BACKGROUNDS = fs.existsSync(path.join(ROOT, 'src', 'img', 'backgrounds')) ? fs.readdirSync(path.join(ROOT, 'src', 'img', 'backgrounds')).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];

// The first section of RELEASE_NOTES.md plays the part of "the update on offer" in the Software Update picture.
function latestNotes() {
  const text = read('RELEASE_NOTES.md').replace(/<!--[\s\S]*?-->/g, '').trim(); // the note at the top is not a section
  const parts = text.split(/^## /m).filter(Boolean);
  return '## ' + (parts[0] || '').trim();
}
const previousVersion = (v) => {
  const [a, b, c] = v.split('.').map(Number);
  return c > 0 ? `${a}.${b}.${c - 1}` : b > 0 ? `${a}.${b - 1}.0` : `${a}.0.0`;
};

/**
 * Runs inside the page before any of its own scripts (it must not use anything from this file except its two arguments).
 * `fakes` holds the test doubles as functions: the page's security policy forbids building code from text at run time.
 */
function pageSetup(cfg, fakes) {
  const memory = { 'aula.prefs': JSON.stringify(cfg.prefs) };
  const winCbs = [];
  const upd = {};
  window.__upd = upd;
  window.__setMaximized = (m) => winCbs.forEach((cb) => cb({ maximized: !!m }));
  const keep = { closeToTray: true, openAtLogin: false, startMinimized: false, autoUpdate: true };
  const none = () => {};
  window.aulaHost = {
    getSettings: async () => ({ ...keep }),
    setSettings: async (patch) => Object.assign(keep, patch),
    version: async () => cfg.version,
    listBackgrounds: async () => cfg.backgrounds,
    loadMemory: () => memory,
    setMemory: (k, v) => {
      memory[k] = v;
    },
    removeMemory: (k) => {
      delete memory[k];
    },
    winControl: none,
    setTheme: none,
    winState: async () => ({ maximized: false }),
    onWinState: (cb) => {
      winCbs.push(cb);
      return none;
    },
    frost: { supported: false, set: none },
    onPower: () => none,
    bluetoothBattery: async () => null,
    setTray: none,
    notify: none,
    saveFile: async () => true,
    openFile: async () => null,
    update: {
      info: async () => ({ enabled: true, current: cfg.version }),
      pending: async () => null,
      latest: async () => null,
      check: async () => ({ status: 'current', current: cfg.version }),
      start: async () => ({ ok: true }),
      install: async () => ({ ok: true }),
      cancel: none,
      dismiss: none,
      onBadge: (cb) => (upd.badge = cb),
      onAvailable: (cb) => (upd.available = cb),
      onProgress: (cb) => (upd.progress = cb),
      onState: (cb) => (upd.state = cb),
    },
  };
  window.confirm = () => true;

  // Simulated keyboards. They are built on first use, which is after protocol.js, layout.js and mock.js have loaded.
  if (!cfg.scenario || cfg.scenario === 'demo') {
    Object.defineProperty(navigator, 'hid', { value: undefined, configurable: true });
    return;
  }
  let hid = null;
  const mods = {};
  const assert = { equal: (a, b, m) => { if (a !== b) throw new Error(m || `${a} !== ${b}`); } };
  const req = (p) => {
    const f = p.split('/').pop().replace(/\.js$/, '');
    if (f === 'protocol') return window.AulaProtocol;
    if (f === 'keys') return window.AulaKeys;
    if (f === 'layout') return window.AulaLayout;
    if (f === 'strict') return assert;
    return load(f);
  };
  const load = (name) => {
    if (!mods[name]) {
      mods[name] = { exports: {} };
      fakes[name](mods[name], mods[name].exports, req);
    }
    return mods[name].exports;
  };
  const build = () => {
    const L = window.AulaLayout;
    const mock = (opts) => new window.AulaMock.MockKeyboard({ latency: 14, battery: 78, ledCount: L.requiredLeds() > 96 ? 126 : 96, layoutKeys: L.KEYS.slice(), ...opts });
    if (cfg.scenario === 'max') {
      const { FakeCable, FakeDongle } = load('fake-max');
      const list = [new FakeCable(), new FakeDongle({ percent: 77 })];
      return { getDevices: async () => list.slice(), addEventListener() {}, removeEventListener() {}, requestDevice: async () => [] };
    }
    const { FakeHid, SilentBackend, DONGLE, CABLE } = load('fake-hid');
    const { CableKeyboard } = load('fake-cable');
    const h = new FakeHid();
    if (cfg.scenario === 'charging') {
      h.add(DONGLE, mock({}));
      h.add(CABLE, new CableKeyboard({ layoutKeys: L.KEYS.slice() }));
    } else if (cfg.scenario === 'cable') {
      h.add(CABLE, new CableKeyboard({ layoutKeys: L.KEYS.slice() }));
    } else if (cfg.scenario === 'asleep') {
      h.add(DONGLE, mock({ online: false })); // answers "not online": the keyboard is asleep
    } else if (cfg.scenario === 'silent') {
      h.add(DONGLE, new SilentBackend()); // never answers: the app keeps trying to wake it
    }
    return h;
  };
  const get = () => hid || (hid = build());
  Object.defineProperty(navigator, 'hid', {
    configurable: true,
    value: {
      getDevices: () => get().getDevices(),
      requestDevice: () => get().requestDevice(),
      addEventListener: (t, fn) => get().addEventListener(t, fn),
      removeEventListener: (t, fn) => get().removeEventListener(t, fn),
    },
  });
}

// ----------------------------------------------------------------------------------------------------- page helpers

// Segoe UI is what Windows uses; where it is missing (Linux, macOS) Inter is the closest. Windows corners are 8 px.
const LOOK = `
  :root { --font: "Segoe UI Variable Text", "Segoe UI", "Inter", system-ui, sans-serif; --font-display: "Segoe UI Variable Display", "Segoe UI", "Inter Display", "Inter", system-ui, sans-serif; }
  html, body { background: transparent !important; }
  .shell { border-radius: 8px; overflow: hidden; }
  * { caret-color: transparent !important; }
`;

// pageSetup plus the fake keyboards, as one script for addInitScript (which is not held to the page's security policy).
function initScript(cfg) {
  const fakes = Object.entries(FAKES)
    .map(([name, src]) => `${JSON.stringify(name)}: function (module, exports, require) {\n${src}\n}`)
    .join(',\n');
  return `(${pageSetup.toString()})(${JSON.stringify(cfg)}, {\n${fakes}\n});`;
}

/** Shrinks a finished picture to a 256-colour PNG (transparent corners kept) when sharp is installed. */
async function finish(file) {
  if (!sharp || process.env.SHOT_NO_OPTIMIZE) return;
  const buf = await sharp(file).png({ palette: true, quality: 90, effort: 8, dither: 1, compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(file, buf);
}

const state = { browser: null, base: '' };

async function open(scenario = 'demo', { theme = 'dark', model = 'f75', demo } = {}) {
  const ctx = await state.browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, reducedMotion: 'no-preference', colorScheme: theme === 'light' ? 'light' : 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
  const prefs = { demo: demo !== undefined ? demo : scenario === 'demo', model, modelSet: true, theme };
  await page.addInitScript({ content: initScript({ prefs, scenario, version: PKG.version, backgrounds: BACKGROUNDS }) });
  await page.goto(state.base);
  await page.waitForFunction(() => window.aulaApp && document.querySelector('#hmStart'));
  await page.addStyleTag({ content: LOOK });
  page.errors = errors;
  page.ctx = ctx;
  await wait(900); // the start screen's entrance
  return page;
}

/** Start -> device list -> pick the card whose text matches -> the main screen. */
async function enter(page, card = /Demo keyboard/, { ready = true } = {}) {
  await page.click('#hmStart');
  await page.waitForSelector('#hmList .hm-dev');
  await wait(500);
  await page.locator('#hmList .hm-dev', { hasText: card }).first().click();
  await page.waitForFunction(() => document.querySelector('.shell').dataset.screen === 'app');
  if (ready) await page.waitForFunction(() => window.aulaApp.session.ready || (window.aulaApp.max && window.aulaApp.max.active()), null, { timeout: 15000 });
  await wait(2200); // the keyboard's intro animation and the screen's fade
}

const tab = async (page, name, ms = 500) => {
  await page.evaluate((n) => window.aulaApp.setTab(n), name);
  await wait(ms);
};

const settingsPage = async (page, name) => {
  await page.click(`#segSetPage [data-set-page="${name}"]`);
  await wait(400);
};

async function snap(page, name, opts = {}) {
  await page.mouse.move(W - 3, H - 3); // park the pointer where it hovers nothing
  await wait(250);
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, omitBackground: true, ...opts });
  await finish(file);
  console.log('  wrote', path.relative(ROOT, file));
  return file;
}

const check = (page, what, ignore) => {
  const errs = page.errors.filter((e) => !(ignore && ignore.test(e)));
  if (errs.length) throw new Error(`${what}: the page reported errors:\n  ${errs.slice(0, 3).join('\n  ')}`);
};

// A page of HTML made here (for the sheets that put several pictures together), photographed the same way.
async function sheet(name, html, width) {
  const ctx = await state.browser.newContext({ viewport: { width, height: 100 }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${SHEET_CSS}</style>${html}`);
  await wait(300);
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: true, omitBackground: true });
  await finish(file);
  console.log('  wrote', path.relative(ROOT, file));
  await ctx.close();
}

const SHEET_CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0e15; color: #e8ecf5; font: 15px/1.45 "Segoe UI", "Inter", system-ui, sans-serif; }
  .wrap { padding: 28px 32px 32px; }
  h1 { margin: 0 0 4px; font-size: 24px; font-weight: 650; }
  p.sub { margin: 0 0 22px; color: #98a2b8; }
  .grid { display: grid; gap: 22px 18px; }
  .cell { text-align: center; }
  .cell img { max-width: 100%; display: block; margin: 0 auto 8px; }
  .cell b { font-weight: 600; font-size: 14px; }
  .stack { display: grid; gap: 10px; justify-items: center; }
  .stack img { display: block; max-width: 100%; }
  figure { margin: 0; text-align: center; } figcaption { margin: 8px 0 6px; color: #98a2b8; font-size: 14px; }
`;

// ------------------------------------------------------------------------------------------------------------ scenes
// Each scene opens a fresh page, drives the real UI into the state worth showing and saves one or more pictures.

const SHOTS = {
  async start() {
    const page = await open();
    await wait(900);
    await snap(page, 'start');
    check(page, 'start');
    await page.ctx.close();
  },

  async devices() {
    const page = await open('charging');
    await page.click('#hmStart');
    await page.waitForSelector('#hmList .hm-dev');
    await page.waitForFunction(() => document.querySelectorAll('#hmList .hm-dev').length >= 3, null, { timeout: 15000 });
    await wait(1800);
    await snap(page, 'devices');
    check(page, 'devices');
    await page.ctx.close();
  },

  async lighting() {
    const page = await open();
    await enter(page);
    await snap(page, 'lighting');
    check(page, 'lighting');
    await page.ctx.close();
  },

  async 'light-theme'() {
    const page = await open('demo', { theme: 'light' });
    await enter(page);
    await snap(page, 'light-theme');
    check(page, 'light-theme');
    await page.ctx.close();
  },

  async sending() {
    const page = await open();
    await enter(page);
    // Slow the simulated keyboard down so the transfer can be caught in the middle.
    await page.evaluate(() => {
      const M = window.AulaMock.MockKeyboard.prototype;
      const send = M.send;
      M.send = async function (p) {
        await new Promise((r) => setTimeout(r, 90));
        return send.call(this, p);
      };
    });
    await page.locator('#effects button').nth(5).click(); // Rainbow wheel
    await wait(400);
    await page.click('#btnApply');
    await page.waitForFunction(() => !document.getElementById('progress').hidden, null, { timeout: 5000 });
    await wait(700);
    await snap(page, 'sending');
    await page.waitForFunction(() => !window.aulaApp.session.dirty, null, { timeout: 30000 });
    check(page, 'sending');
    await page.ctx.close();
  },

  async 'per-key'() {
    const page = await open();
    await enter(page);
    await tab(page, 'perkey');
    await page.click('#pkSelAll');
    await page.click('#pkPaintSel');
    await wait(150);
    await page.click('#pkRainbow');
    await wait(900);
    await snap(page, 'per-key');
    check(page, 'per-key');
    await page.ctx.close();
  },

  async keys() {
    const page = await open();
    await enter(page);
    await tab(page, 'keys');
    await page.waitForFunction(() => window.aulaApp.keys.ka.state.status === 'ready', null, { timeout: 10000 });
    await page.evaluate(() => window.aulaApp.keys.pick(window.AulaLayout.KEYS.find((k) => k.n === 'Caps')));
    await wait(300);
    await page.click('#kaGroups [data-group="fkeys"]');
    await wait(200);
    await page.locator('#kaGrid .ka-key').nth(12).click(); // F13 on Caps, not applied yet
    await wait(900);
    await snap(page, 'keys');
    check(page, 'keys');
    await page.ctx.close();
  },

  async battery() {
    const page = await open();
    await enter(page);
    await tab(page, 'battery', 1200);
    await snap(page, 'battery');
    check(page, 'battery');
    await page.ctx.close();
  },

  async charging() {
    const page = await open('charging');
    await enter(page, /dongle/i);
    await tab(page, 'battery', 1200);
    await snap(page, 'charging');
    check(page, 'charging');
    await page.ctx.close();
  },

  async 'charging-cable'() {
    const page = await open('cable');
    await enter(page, /AULA F75/i);
    await tab(page, 'battery', 1200);
    await snap(page, 'charging-cable');
    check(page, 'charging-cable');
    await page.ctx.close();
  },

  // The app is still talking to a keyboard that has not answered yet ("Waking the keyboard, attempt 2 of 3").
  async connecting() {
    const page = await open('silent');
    await page.click('#hmStart');
    await page.waitForSelector('#hmList .hm-dev');
    await wait(600);
    await page.locator('#hmList .hm-dev', { hasText: /dongle/i }).first().click();
    await page.waitForFunction(() => !document.getElementById('overlay').hidden && /attempt 2/.test(document.getElementById('ovBody').textContent), null, { timeout: 40000 });
    await wait(400);
    await snap(page, 'connecting');
    check(page, 'connecting');
    await page.ctx.close();
  },

  // The keyboard answered that it is asleep.
  async asleep() {
    const page = await open('asleep');
    await page.click('#hmStart');
    await page.waitForSelector('#hmList .hm-dev');
    await wait(600);
    await page.locator('#hmList .hm-dev', { hasText: /dongle/i }).first().click();
    await page.waitForFunction(() => !document.getElementById('overlay').hidden && /asleep/.test(document.getElementById('ovTitle').textContent), null, { timeout: 20000 });
    await wait(1200);
    await snap(page, 'asleep');
    check(page, 'asleep');
    await page.ctx.close();
  },

  async settings() {
    const page = await open();
    await enter(page);
    await tab(page, 'settings');
    await snap(page, 'settings');
    await settingsPage(page, 'app');
    await snap(page, 'settings-app');
    await settingsPage(page, 'debug');
    await snap(page, 'settings-debug');
    check(page, 'settings');
    await page.ctx.close();
  },

  async 'settings-theme'() {
    const page = await open();
    await enter(page);
    await tab(page, 'settings');
    await settingsPage(page, 'theme');
    const tile = page.locator('#bgPresets .bg-tile[data-preset]').first();
    // SHOT_NO_PRESET=1 leaves the picture off (the pictures in src/img/backgrounds are shown behind the app otherwise).
    if (!process.env.SHOT_NO_PRESET && (await tile.count())) {
      await tile.click();
      await wait(5200); // the "Background set." note fades out by itself
    }
    await page.evaluate(() => {
      const box = document.getElementById('bgPresetSet');
      if (box && !box.hidden) box.scrollIntoView({ block: 'end' }); // the preset pictures, at the bottom of the Theme page
    });
    await wait(500);
    await snap(page, 'settings-theme');
    check(page, 'settings-theme');
    await page.ctx.close();
  },

  async update() {
    const page = await open();
    await enter(page);
    const notes = latestNotes();
    await page.evaluate(
      ({ info }) => {
        window.__upd.badge(info);
        window.__upd.available(info);
      },
      { info: { version: PKG.version, current: previousVersion(PKG.version), notes, mode: 'installer', size: 86 * 1048576 } },
    );
    await wait(900);
    await snap(page, 'update');
    check(page, 'update');
    await page.ctx.close();
  },

  async max() {
    const page = await open('max');
    await enter(page, /Max/i);
    await wait(800);
    await snap(page, 'max');
    await tab(page, 'perkey');
    await page.click('#mxRainbow');
    await wait(700);
    await snap(page, 'max-perkey');
    // Known and harmless: while the Max screen is up, the hidden F75 preview is resized to nothing and boardart.js's
    // roundRect() is given a negative radius (arcTo throws). Nothing on screen is affected.
    check(page, 'max', /arcTo/);
    await page.ctx.close();
  },

  // A sheet with the keyboard picture of every model, stacked.
  async keyboards() {
    const parts = [];
    const page = await open();
    await enter(page);
    for (const id of ['f75', 'f75pro', 'f87']) {
      await tab(page, 'settings');
      await settingsPage(page, 'keyboard');
      await page.selectOption('#modelSel', id);
      await wait(1500);
      await page.waitForFunction(() => window.aulaApp.session.ready, null, { timeout: 10000 });
      await tab(page, 'lighting', 1800);
      await page.mouse.move(W - 3, H - 3);
      parts.push((await page.locator('.stage-canvas').screenshot({ omitBackground: true })).toString('base64'));
    }
    check(page, 'keyboards');
    await page.ctx.close();
    const mx = await open('max');
    await enter(mx, /Max/i);
    await tab(mx, 'perkey');
    await mx.click('#mxRainbow');
    await wait(700);
    await mx.mouse.move(W - 3, H - 3);
    parts.push((await mx.locator('.mx-board').screenshot({ omitBackground: true })).toString('base64'));
    await mx.ctx.close();
    const names = ['AULA F75', 'AULA F75 Pro', 'AULA F87', 'AULA F75 Max'];
    await sheet(
      'keyboards',
      `<div class="wrap"><div class="stack">${parts.map((b, i) => `<figure><img alt="${names[i]}" src="data:image/png;base64,${b}" style="width:${i === 3 ? 940 : 1100}px;border-radius:20px"><figcaption>${names[i]}${i === 3 ? ' (its per-key screen)' : ''}</figcaption></figure>`).join('')}</div></div>`,
      1180,
    );
  },

  // The flat window buttons in each of their states, photographed from the real page.
  async 'window-controls'() {
    const page = await open();
    await enter(page);
    const box = await page.locator('#winBtns').boundingBox();
    const pad = 10;
    const clip = { x: box.x - 3, y: box.y - pad, width: box.width + pad + 3, height: box.height + pad * 2 }; // keeps clear of the battery pill on the left
    const grab = async () => (await page.screenshot({ clip, omitBackground: false })).toString('base64');
    const shots = [];
    await page.mouse.move(W - 3, H - 3);
    await wait(250);
    shots.push(['Idle', await grab()]);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); // the maximize button
    await wait(300);
    shots.push(['Hover', await grab()]);
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2); // close
    await wait(300);
    shots.push(['Close hover', await grab()]);
    await page.mouse.move(W - 3, H - 3);
    await page.evaluate(() => window.__setMaximized(true));
    await wait(300);
    shots.push(['Maximized', await grab()]);
    await page.evaluate(() => window.__setMaximized(false));
    await wait(200);
    const header = (await page.screenshot({ clip: { x: 0, y: 0, width: W, height: 56 } })).toString('base64');
    check(page, 'window-controls');
    await page.ctx.close();
    await sheet(
      'window-controls',
      `<div class="wrap" style="padding-bottom:20px"><h1>Window controls</h1><p class="sub">Three flat buttons, top right, above every screen. A soft square lights up under the pointer, red for close.</p>
       <img alt="In the app header" src="data:image/png;base64,${header}" style="width:100%;border-radius:10px;display:block;margin-bottom:6px">
       <p class="sub" style="margin:6px 0 20px">In place, in the app header.</p>
       <div class="grid" style="grid-template-columns:repeat(4,1fr)">${shots.map(([n, b]) => `<div class="cell"><img alt="${n}" src="data:image/png;base64,${b}" style="width:${(box.width + pad + 3) * 2.2}px;border-radius:12px"><b>${n}</b></div>`).join('')}</div></div>`,
      1000,
    );
  },
};

// ------------------------------------------------------------------------------------------------------------- main

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(Object.keys(SHOTS).join('\n'));
    return;
  }
  if (!chromium) {
    console.error('Playwright is not installed. Run:  npm install --no-save playwright  and  npx playwright install chromium');
    process.exit(1);
  }
  const wanted = args.filter((a) => !a.startsWith('-'));
  const unknown = wanted.filter((n) => !SHOTS[n]);
  if (unknown.length) {
    console.error(`Unknown: ${unknown.join(', ')}. Known: ${Object.keys(SHOTS).join(', ')}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve();
  state.base = base;
  state.browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'] });
  let failed = 0;
  for (const name of wanted.length ? wanted : Object.keys(SHOTS)) {
    console.log(`== ${name}`);
    try {
      await SHOTS[name]();
    } catch (e) {
      failed++;
      console.error(`  FAILED: ${e.message.split('\n')[0]}`);
      if (process.env.DEBUG) console.error(e.stack);
    }
  }
  await state.browser.close();
  server.close();
  console.log(failed ? `\n${failed} scene(s) failed` : '\nall screenshots written to docs/screenshots');
  process.exit(failed ? 1 : 0);
})();
