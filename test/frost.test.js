'use strict';

/*
 * The frosted window: the desktop shows through the app (blurred) only on the default background. Any picture, preset or
 * the person's own, makes the window solid again. js/frost.js decides; app.js tells it when the background changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const frostSrc = read('src', 'js', 'frost.js');

/** Runs frost.js against a fake page. `host` is what the preload would expose (or null for a plain browser tab). */
function load(host) {
  const classes = new Set();
  const calls = [];
  const window = {};
  if (host) {
    window.aulaHost = {
      loadMemory: () => host.memory || {},
      frost: { supported: !!host.supported, set: (on) => calls.push(on) },
    };
  }
  const document = {
    documentElement: {
      classList: {
        toggle: (c, force) => {
          const want = force === undefined ? !classes.has(c) : !!force;
          if (want) classes.add(c);
          else classes.delete(c);
          return want;
        },
        contains: (c) => classes.has(c),
      },
    },
  };
  vm.runInNewContext(frostSrc, { window, document });
  return { api: window.AulaFrost, classes, calls };
}

test('default background: frosted from the first paint', () => {
  const { classes, api } = load({ supported: true, memory: {} });
  assert.ok(classes.has('frost'));
  assert.equal(api.isOn(), true);
});

test('a saved preset or custom picture keeps the window solid from the first paint', () => {
  assert.ok(!load({ supported: true, memory: { 'aula.bgPreset': 'lumine-intertwined.jpg' } }).classes.has('frost'));
  assert.ok(!load({ supported: true, memory: { 'aula.bg': 'data:image/webp;base64,AAAA' } }).classes.has('frost'));
});

test('choosing and removing a picture switches the frost off and on, and tells the desktop app once per change', () => {
  const { api, classes, calls } = load({ supported: true, memory: {} });
  api.set(false); // a picture was picked
  assert.ok(!classes.has('frost'));
  api.set(false); // same again: nothing more to say
  api.set(true); // picture removed
  assert.ok(classes.has('frost'));
  assert.deepEqual(calls, [false, true]);
});

test('where frosting is not available the page never goes see-through', () => {
  const unsupported = load({ supported: false, memory: {} });
  unsupported.api.set(true);
  assert.ok(!unsupported.classes.has('frost'));
  assert.deepEqual(unsupported.calls, []);
  const browser = load(null); // plain browser tab: no desktop host at all
  browser.api.set(true);
  assert.ok(!browser.classes.has('frost'));
  assert.equal(browser.api.supported, false);
});

test('the "Frosted window" switch in Settings > Theme turns it off, from the first paint and while running', () => {
  const off = { 'aula.prefs': JSON.stringify({ theme: 'dark', frost: false }) };
  assert.ok(!load({ supported: true, memory: off }).classes.has('frost'), 'saved as off: solid from the first paint');
  const on = { 'aula.prefs': JSON.stringify({ theme: 'dark', frost: true }) };
  assert.ok(load({ supported: true, memory: on }).classes.has('frost'));
  assert.ok(load({ supported: true, memory: { 'aula.prefs': JSON.stringify({ theme: 'light' }) } }).classes.has('frost'), 'older saved settings have no frost entry: on');
  assert.ok(load({ supported: true, memory: { 'aula.prefs': '{not json' } }).classes.has('frost'), 'damaged settings fall back to on');

  const { api, classes, calls } = load({ supported: true, memory: {} });
  api.set(false); // switch turned off
  assert.ok(!classes.has('frost'));
  api.set(true); // and on again
  assert.ok(classes.has('frost'));
  assert.deepEqual(calls, [false, true]);
});

test('the switch is on the Theme page, hidden unless frosting works, and saved with the other preferences', () => {
  const html = read('src', 'index.html');
  const theme = html.indexOf('id="setpage-theme"');
  const debug = html.indexOf('id="setpage-debug"');
  const row = html.indexOf('id="frostRow"');
  const sw = html.indexOf('id="swFrost"');
  assert.ok(row > theme && row < debug && sw > row && sw < debug, 'the row and its switch are on the Theme page');
  assert.match(html, /<div class="srow" id="frostRow" hidden>/, 'hidden until app.js knows frosting is available');
  assert.match(html, /id="swFrost" role="switch" aria-checked="true" aria-label="Frosted window"/);
  const app = read('src', 'js', 'app.js');
  assert.match(app, /theme: 'dark', frost: true \}/, 'on by default');
  assert.match(app, /prefs\.frost = prefs\.frost !== false/, 'anything but an explicit off means on');
  assert.match(app, /prefs\.frost = !prefs\.frost;\s*savePrefs\(\);/, 'the switch toggles and saves it');
  assert.match(app, /F\.set\(prefs\.frost && !picture\)/, 'a picture overrides the switch');
  assert.match(read('main.js'), /JSON\.parse\(mem\['aula\.prefs'\] \|\| '\{\}'\)\.frost !== false/, 'the desktop app reads the same saved switch at start');
});

test('the page is wired to it', () => {
  const html = read('src', 'index.html');
  assert.ok(html.indexOf('js/theme.js') > 0 && html.indexOf('js/frost.js') > html.indexOf('js/theme.js'), 'frost.js loads in <head> after theme.js');
  assert.ok(html.indexOf('js/frost.js') < html.indexOf('</head>'), 'and before the page draws');
  assert.match(read('src', 'js', 'app.js'), /renderFrost\(on\);/, 'renderBackground reports whether a picture is shown');
});

test('only .frost makes the page see-through, and the light theme keeps its own tint', () => {
  const css = read('src', 'css', 'app.css');
  assert.match(css, /html\.frost,\s*html\.frost body\s*\{\s*background:\s*transparent/);
  assert.match(css, /:root\.frost\[data-theme="light"\]\s*\{[^}]*--frost-tint/);
  assert.match(css, /\.frost \.shell::before\s*\{[^}]*rgb\(var\(--frost-tint\)\)/);
});

test('the desktop app asks for acrylic only where Windows 11 22H2+ supports it, and can switch it off', () => {
  const main = read('main.js');
  assert.match(main, /FROST_OK\s*=\s*process\.platform === 'win32'[^;]*22621/);
  assert.match(main, /backgroundMaterial:\s*'acrylic'/);
  assert.match(main, /setBackgroundMaterial\(on \? 'acrylic' : 'none'\)/);
  assert.match(read('preload.js'), /frost:\s*\{\s*supported:\s*frostSupported/);
});

test('Electron is new enough to keep the frost and the rounded corners through maximize and restore', () => {
  // Electron 33 did a real Windows maximize on a window with a background material: the acrylic and the rounded corners were
  // lost and only closing the app brought them back. Electron 34.2 fixed the maximize, and later releases fixed changing the
  // material on an open window, so anything older than 38 is too old.
  const pkg = JSON.parse(read('package.json'));
  const major = Number(String(pkg.devDependencies.electron).match(/(\d+)\./)[1]);
  assert.ok(major >= 38, `package.json asks for Electron ${pkg.devDependencies.electron}; use 38 or newer`);
});
