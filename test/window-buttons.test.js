'use strict';

/*
 * The window buttons (minimize, maximize, close) must stay clickable on every screen, including the start screen and
 * the device list.
 *
 * Why this is tested: Electron turns -webkit-app-region into one list of drag / no-drag rectangles in DOCUMENT order
 * (not z-order). A drag region that comes later in the page than a no-drag button and overlaps it wins, and Windows
 * then treats that spot as title bar and swallows the click. The start and device screens have a full-width drag
 * strip (.hm-drag), which hid the buttons' clicks in v1.2.0. This checks the two things that keep that from happening.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = read('index.html');
const homeCss = read('css', 'home.css');
const appCss = read('css', 'app.css');

test('the window buttons come after every drag strip in the page', () => {
  const pill = html.indexOf('class="win-btns"');
  const strip = html.indexOf('class="hm-drag"');
  assert.ok(pill > 0, 'window button pill is in index.html');
  assert.ok(strip > 0, 'start screen drag strip is in index.html');
  assert.ok(pill > strip, 'the pill must come after .hm-drag so its no-drag area is applied last');
});

test('the start screen drag strip stops before the window buttons', () => {
  const rule = homeCss.match(/\.hm-drag\s*\{([^}]*)\}/);
  assert.ok(rule, '.hm-drag rule exists');
  const right = rule[1].match(/right:\s*([^;]+);/);
  assert.ok(right, '.hm-drag sets its right edge');
  assert.notEqual(right[1].trim(), '0', 'a drag strip that runs to the right edge covers the buttons');
  assert.match(right[1], /var\(--win-pill\)/, 'it keeps clear of the pill width');
  assert.match(right[1], /var\(--win-edge\)/, 'and of the gap between the pill and the window edge');
});

test('the pill and its buttons are marked no-drag', () => {
  assert.match(appCss, /\.win-btns\s*\{[^}]*-webkit-app-region:\s*no-drag/);
  assert.match(appCss, /\.win-btn\s*\{[^}]*-webkit-app-region:\s*no-drag/);
});

test('the pill is above the start screens, so nothing is drawn over the buttons', () => {
  const z = (css, sel) => Number((css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{[^}]*z-index:\\s*(\\d+)')) || [])[1]);
  assert.ok(z(appCss, '.win-btns') > z(homeCss, '.home'), '.win-btns z-index is above .home');
});

test('the window has no native frame and is not transparent, so Windows keeps its own corners and the page draws no big ones', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /frame:\s*false/, 'no native title bar, logo or caption buttons');
  assert.doesNotMatch(main, /transparent:\s*true/, 'a transparent window would need the page to round its own corners');
  assert.doesNotMatch(appCss, /\.frameless \.shell\s*\{[^}]*border-radius/, 'the page does not round the window itself');
  assert.match(html, /<script src="js\/boot\.js"><\/script>/, 'boot.js adds .frameless so the buttons show');
});
