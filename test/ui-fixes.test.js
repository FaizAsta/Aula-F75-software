'use strict';

/*
 * Two layout bugs, pinned down so they cannot come back:
 *  1. Buttons that do not clear `border` keep the browser's raised 3D border. The Keys tab's category chips and key
 *     buttons did, so they showed a thick light frame that no other button in the app has.
 *  2. With five tabs the centred tab bar is wide enough that, near the minimum window width, the connection dot to its
 *     right touched or overlapped it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'css', f), 'utf8');

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(text, sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} has a rule`);
  return m[1];
}

test('Keys tab buttons clear the browser border, like every other button', () => {
  const keys = css('keys.css');
  for (const sel of ['.ka-chip', '.ka-key']) {
    assert.match(rule(keys, sel), /(^|[;\s])border:\s*0\b/, `${sel} sets border: 0`);
  }
});

test('narrow windows slim the tab buttons so the header keeps a gap on both sides of the tab bar', () => {
  const app = css('app.css');
  const m = app.match(/@media \(max-width: (\d+)px\)\s*\{[^}]*\.tab-btn\s*\{\s*padding:\s*0 (\d+)px;/);
  assert.ok(m, 'a max-width rule slims .tab-btn');
  assert.ok(Number(m[1]) >= 1060, 'it starts before the theme button is hidden');
  assert.ok(Number(m[2]) < 16, 'the padding is smaller than the default 16px');
});

test('Settings: four pages, Keyboard first and Debugging last, each with its own controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const at = (s) => {
    const i = html.indexOf(s);
    assert.ok(i > 0, `${s} is in the settings panel`);
    return i;
  };
  // the page switcher lists Keyboard, App, Debugging in that order
  const nav = html.match(/id="segSetPage"[\s\S]*?<\/div>/)[0];
  const order = [...nav.matchAll(/data-set-page="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['keyboard', 'app', 'theme', 'debug'], 'Keyboard, App, Theme, then Debugging last');

  const kb = at('id="setpage-keyboard"');
  const app = at('id="setpage-app"');
  const theme = at('id="setpage-theme"');
  const dbg = at('id="setpage-debug"');
  const foot = at('<p class="foot">');
  assert.ok(kb < app && app < theme && theme < dbg && dbg < foot, 'the pages follow the switcher in the same order');
  const within = (id, from, to) => {
    const i = at(id);
    assert.ok(i > from && i < to, `${id} sits on the right page`);
  };

  // Keyboard page: connection, model, brightness levels, restore, demo keyboard, backup
  for (const id of ['id="devConnect"', 'id="modelSel"', 'id="brightMaxSel"', 'id="swKeep"', 'id="swDemo"', '<h2>Backup</h2>']) within(id, kb, app);
  // App page: tray, start with Windows, updates (the light / dark chooser is on the Theme page, not here)
  for (const id of ['id="cardApp"', 'id="swTray"', 'id="swLogin"', 'id="updRow"']) within(id, app, theme);
  assert.ok(!html.slice(app, theme).includes('id="segTheme"'), 'the light / dark chooser is no longer on the App page');
  // Theme page: the light / dark chooser first, then the background (custom picture, opacity, presets)
  for (const id of ['id="segTheme"', 'id="themeHint"', 'id="bgPick"', 'id="bgClear"', 'id="bgFile"', 'id="bgOpacity"', 'id="bgPresets"']) within(id, theme, dbg);
  assert.ok(at('id="segTheme"') < at('id="bgPick"'), 'the light / dark chooser comes before the background');
  // Debugging page: log, compatibility report, detected interfaces, connection help
  for (const id of ['id="devLog"', 'id="devReport"', 'id="devList"', 'id="ifaces"', '<h2>Connection help</h2>']) within(id, dbg, foot);
});
