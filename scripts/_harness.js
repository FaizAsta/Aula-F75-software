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
const OUT = process.env.OUT_DIR || path.join(ROOT, 'docs', 'screenshots');
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
  const memory = { 'aula.prefs': JSON.stringify(cfg.prefs), ...(cfg.memory || {}) };
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
    openSupport: async () => true, // the Support menu: the real app opens the link in the browser
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

async function open(scenario = 'demo', { theme = 'dark', model = 'f75', demo, extra = {}, memory = {} } = {}) {
  const ctx = await state.browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, reducedMotion: 'no-preference', colorScheme: theme === 'light' ? 'light' : 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
  const prefs = { demo: demo !== undefined ? demo : scenario === 'demo', model, modelSet: true, theme, ...extra };
  await page.addInitScript({ content: initScript({ prefs, scenario, version: PKG.version, backgrounds: BACKGROUNDS, memory }) });
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



module.exports = { open, enter, tab, settingsPage, snap, check, wait, serve, state, chromium, fs, path, OUT, W, H, SCALE, ROOT };
