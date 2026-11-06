'use strict';

/*
 * Light / dark / system theme.
 *
 * theme.js runs in <head> and only applies a theme (data-theme on <html>); app.js owns the saved choice; the CSS has
 * one palette per theme. These tests check each of those three pieces, plus the desktop-app plumbing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const html = read('src', 'index.html');
const themeSrc = read('src', 'js', 'theme.js');
const appCss = read('src', 'css', 'app.css');
const allCss = ['app.css', 'home.css', 'detail.css', 'lite.css'].map((f) => read('src', 'css', f)).join('\n');

// Run theme.js in a bare sandbox, the way the page does, and hand back what it did.
function load({ ls = null, mem = null, system = 'dark', withHost = false } = {}) {
  const dataset = {};
  const calls = [];
  const mq = { matches: system === 'light', handlers: [], addEventListener(_t, fn) { this.handlers.push(fn); } };
  const host = withHost ? { loadMemory: () => mem || {}, setTheme: (p) => calls.push(p) } : undefined;
  const win = { aulaHost: host, matchMedia: () => mq };
  const sandbox = {
    window: win,
    document: { documentElement: { dataset } },
    localStorage: { getItem: (k) => (k === 'aula.prefs' ? ls : null) },
  };
  vm.runInNewContext(themeSrc, sandbox);
  return {
    T: win.AulaTheme,
    dataset,
    calls,
    setSystem(v) {
      mq.matches = v === 'light';
      for (const fn of mq.handlers) fn();
    },
  };
}
const prefsJson = (theme) => JSON.stringify({ demo: false, theme });

// ------------------------------------------------------------------ theme.js

test('with nothing saved the app stays dark, as it always was', () => {
  const { T, dataset } = load();
  assert.equal(T.pref(), 'dark');
  assert.equal(T.resolved(), 'dark');
  assert.equal(dataset.theme, 'dark');
});

test('a saved choice is applied immediately, before the page paints', () => {
  assert.equal(load({ ls: prefsJson('light') }).dataset.theme, 'light');
  assert.equal(load({ ls: prefsJson('dark') }).dataset.theme, 'dark');
});

test('the desktop app\'s data file wins over localStorage', () => {
  const r = load({ withHost: true, mem: { 'aula.prefs': prefsJson('light') }, ls: prefsJson('dark') });
  assert.equal(r.dataset.theme, 'light');
});

test('unknown or damaged values fall back to dark', () => {
  for (const ls of [prefsJson('neon'), '{not json', '', JSON.stringify({ theme: 7 })]) {
    assert.equal(load({ ls }).dataset.theme, 'dark', `for ${ls}`);
  }
});

test('"system" follows the operating system, live', () => {
  const r = load({ ls: prefsJson('system'), system: 'light' });
  assert.equal(r.dataset.theme, 'light');
  assert.equal(r.dataset.themePref, 'system');
  const seen = [];
  r.T.onChange((resolved, pref) => seen.push([resolved, pref]));
  r.setSystem('dark');
  assert.equal(r.dataset.theme, 'dark');
  assert.deepEqual(seen, [['dark', 'system']]);
});

test('the system setting is ignored while a fixed theme is chosen', () => {
  const r = load({ ls: prefsJson('dark'), system: 'dark' });
  let fired = 0;
  r.T.onChange(() => fired++);
  r.setSystem('light');
  assert.equal(r.dataset.theme, 'dark');
  assert.equal(fired, 0);
});

test('set() switches the page, tells listeners and tells the desktop app', () => {
  const r = load({ withHost: true });
  const seen = [];
  r.T.onChange((resolved, pref) => seen.push(`${resolved}/${pref}`));
  r.T.set('light');
  assert.equal(r.dataset.theme, 'light');
  assert.deepEqual(seen, ['light/light']);
  assert.equal(r.calls.at(-1), 'light');
  r.T.set('system');
  assert.equal(r.calls.at(-1), 'system');
});

test('set() ignores values that are not a theme', () => {
  const r = load({ ls: prefsJson('light') });
  r.T.set('purple');
  r.T.set(undefined);
  assert.equal(r.T.pref(), 'light');
  assert.equal(r.dataset.theme, 'light');
});

test('toggle() flips what is showing, even from "system"', () => {
  const r = load({ ls: prefsJson('system'), system: 'light' });
  r.T.toggle();
  assert.equal(r.T.pref(), 'dark');
  r.T.toggle();
  assert.equal(r.T.pref(), 'light');
});

test('the page keeps working when the desktop bridge throws', () => {
  const dataset = {};
  const win = {
    aulaHost: { loadMemory: () => { throw new Error('ipc down'); }, setTheme: () => { throw new Error('ipc down'); } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
  };
  vm.runInNewContext(themeSrc, { window: win, document: { documentElement: { dataset } }, localStorage: { getItem: () => null } });
  assert.equal(dataset.theme, 'dark');
  win.AulaTheme.set('light');
  assert.equal(dataset.theme, 'light');
});

// ----------------------------------------------------- readable accent colour

// WCAG contrast of an "r g b" colour on white.
const lum = (c) => {
  const f = (v) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const onWhite = (c) => 1.05 / (lum(c) + 0.05);

// A few awkward colours plus a sweep of the whole hue circle at full brightness (what the keyboard reports).
function brightColours() {
  const out = [[255, 255, 255], [255, 212, 0], [120, 255, 80], [0, 255, 255], [124, 214, 255], [255, 0, 0], [47, 91, 255]];
  for (let h = 0; h < 360; h += 7) {
    const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); };
    out.push([f(5), f(3), f(1)]);
  }
  return out;
}

test('on the light theme the accent colour is darkened until it can be read on white', () => {
  const { T } = load();
  for (const c of brightColours()) {
    const ink = T.inkFor(c, 'light');
    assert.ok(onWhite(ink) >= 4.5, `${c} -> ${ink.map(Math.round)} has only ${onWhite(ink).toFixed(2)}:1`);
  }
});

test('darkening keeps the hue: channels stay in the same order', () => {
  const { T } = load();
  const [r, g, b] = T.inkFor([255, 212, 0], 'light');
  assert.ok(r > g && g > b, 'yellow stays yellow');
});

test('the dark theme and colours that are already dark are left exactly as they are', () => {
  const { T } = load();
  for (const c of brightColours()) assert.deepEqual(T.inkFor(c, 'dark'), c);
  assert.deepEqual(T.inkFor([20, 30, 90], 'light'), [20, 30, 90]);
});

// ------------------------------------------------------------------- the page

test('theme.js is loaded in <head>, before any stylesheet-dependent paint and before app.js', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('src="js/theme.js"'), 'theme.js is in the head');
  assert.ok(html.indexOf('js/theme.js') < html.indexOf('js/app.js'), 'it runs before the app');
});

test('the theme is chosen in Settings > Theme (dark, light or system); the header has no theme button', () => {
  assert.ok(!html.includes('id="themeBtn"'));
  assert.ok(html.includes('id="segTheme"'));
  for (const v of ['dark', 'light', 'system']) assert.ok(html.includes(`data-theme-pref="${v}"`), `${v} option`);
});

// --------------------------------------------------------------------- the CSS

// The custom properties declared in the first block that starts with the given selector.
function tokens(css, selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, `${selector} block exists`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return new Set([...body.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
}

test('the light palette replaces every colour the dark palette defines', () => {
  const dark = tokens(appCss, ':root');
  const light = tokens(appCss, ':root[data-theme="light"]');
  // Things that are not colours, or that the keyboard itself sets, are shared by both themes.
  const shared = new Set(['--glow', '--accent', '--r-group', '--r-tile', '--r-ctl', '--top', '--ease', '--spring', '--font', '--font-display', '--mono']);
  const missing = [...dark].filter((t) => !shared.has(t) && !light.has(t));
  assert.deepEqual(missing, [], 'tokens the light theme forgot');
});

test('dark is the default scheme; only the light block switches it', () => {
  assert.match(appCss, /:root\s*\{\s*color-scheme:\s*dark;/);
  const light = appCss.slice(appCss.indexOf(':root[data-theme="light"] {'));
  assert.match(light.slice(0, 80), /color-scheme:\s*light/);
  assert.equal((appCss.match(/color-scheme:\s*light/g) || []).length, 1);
});

test('selected controls take their text colour from --hi, so they stay readable in both themes', () => {
  assert.doesNotMatch(allCss, /\[aria-(?:selected|checked)="true"\][^{}]*\{[^}]*[^-]color:\s*#fff/);
});

test('accent text and rings use the readable --glow-ink, not the raw keyboard colour', () => {
  // raw --glow stays for tints, fills and glows; text colour and outlines must go through --glow-ink
  assert.doesNotMatch(allCss, /[^-]color:\s*rgb\(var\(--glow\)\)/, 'no text coloured with the raw glow');
  assert.match(appCss, /--accent:\s*rgb\(var\(--glow-ink\)\)/);
});

test('light-theme refinements stay above the reduced-motion rule, which must remain last', () => {
  assert.ok(appCss.lastIndexOf('[data-theme="light"]') < appCss.lastIndexOf('prefers-reduced-motion'));
});

// ----------------------------------------------------------- app.js and the host

test('app.js saves the choice with the other preferences and hands it to theme.js', () => {
  const app = read('src', 'js', 'app.js');
  assert.match(app, /theme:\s*'dark'/, 'default is dark');
  assert.match(app, /function setTheme\(pref\)[\s\S]*?prefs\.theme = pref;[\s\S]*?savePrefs\(\);[\s\S]*?T\.set\(pref\)/);
  assert.match(app, /T\.inkFor\(glowNow\)/, 'accent ink follows the live keyboard colour');
});

test('the desktop app accepts only the three valid theme values', () => {
  const preload = read('preload.js');
  const main = read('main.js');
  assert.match(preload, /setTheme:\s*\(pref\)\s*=>\s*ipcRenderer\.send\('host:theme',\s*pref\)/);
  assert.match(main, /ipcMain\.on\('host:theme'/);
  assert.match(main, /pref === 'dark' \|\| pref === 'light' \|\| pref === 'system'/);
  assert.match(main, /nativeTheme\.themeSource = pref/);
});
