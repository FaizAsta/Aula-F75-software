'use strict';

/*
 * The second Liquid glass motion layer (css/glass-ios27.css, js/glass-ios27.js): app launch zoom, page change direction, the
 * update dialog growing out of its button, the Customise box opening by height (there is no scroll edge effect).
 *
 * The pure helpers are tested directly. The stylesheet and the script are checked as text, like the other UI tests, because
 * they need a real browser to run. What matters here: Classic is untouched, reduced motion gets none of it, nothing that
 * holds glass is faded (that would flash its glass clear), and the script cannot leave the page half-done.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = read('index.html');
const css = read('css', 'glass-ios27.css');
const js = read('js', 'glass-ios27.js');
const M = require('../src/js/glass-ios27.js');

// ---------------------------------------------------------------------------------------------------- wiring

test('index.html loads the stylesheet after glass-motion.css (it uses its springs) and before glide.css', () => {
  assert.ok(html.includes('<link rel="stylesheet" href="css/glass-ios27.css">'));
  assert.ok(html.indexOf('css/glass-ios27.css') > html.indexOf('css/glass-motion.css'));
  assert.ok(html.indexOf('css/glass-ios27.css') < html.indexOf('css/glide.css'), 'glide.css stays last');
  assert.ok(html.includes('<script src="js/glass-ios27.js"></script>'));
  assert.ok(html.indexOf('js/glass-ios27.js') > html.indexOf('js/glass-motion.js'));
});

test('glass-ios27.css: every rule is under html.glass, so Classic is untouched', () => {
  const body = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  let rules = 0;
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of prelude.split(/,(?![^(]*\))/)) {
      rules++;
      assert.match(sel.trim(), /^html\.glass\b/, `selector outside html.glass: ${sel.trim()}`);
    }
  }
  assert.ok(rules >= 10, `only ${rules} rules`);
});

test('the script only runs while html has the glass class', () => {
  assert.match(js, /root\.classList\.contains\('glass'\)/);
  assert.match(js, /new MutationObserver\(sync\)\.observe\(root/);
});

// ----------------------------------------------------------------------------------------------- accessibility

test('reduced motion: every movement is inside no-preference, and the script stays off', () => {
  // the movements: the launch, the page turn, the dialog, the height; they all sit in the no-preference block
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  for (const needle of ['@keyframes agLaunch', '@keyframes agPage', 'html.glass .upd-card', 'html.glass .glass-custom']) {
    assert.ok(css.indexOf(needle) > css.indexOf('@media (prefers-reduced-motion: no-preference)'), `${needle} is inside`);
    assert.ok(block.includes(needle));
  }
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /!\(motionQuery && motionQuery\.matches\)/);
  assert.match(js, /motionQuery\.addEventListener\('change', sync\)/, 'follows the setting live');
});

// ------------------------------------------------------------------------------------- glass is never faded

test('nothing that holds glass is faded: the keyframes move only, and no opacity is put on a panel, card or box', () => {
  for (const name of ['agLaunch', 'agPage']) {
    const m = css.match(new RegExp(`@keyframes ${name}\\s*\\{([^}]*\\{[^}]*\\}[^}]*)\\}`));
    assert.ok(m, name);
    assert.doesNotMatch(m[1], /opacity|filter|clip-path|mask/, `${name} must only move`);
  }
  // the dialog: its dimming fades by colour, its card by scale and translate
  assert.match(css, /html\.glass \.upd\[hidden\]\s*\{\s*background-color:\s*transparent/);
  const card = css.match(/html\.glass \.upd\[hidden\] \.upd-card\s*\{([^}]*)\}/);
  assert.ok(card);
  assert.doesNotMatch(card[1], /opacity/);
  // no layer is laid over the content while it scrolls (no dark scroll fade)
  assert.doesNotMatch(css, /\.panels::before|\.panels::after|ag-edge/);
  assert.doesNotMatch(js, /ag-edge/);
  assert.doesNotMatch(css, /html\.glass \.panel\b[^{]*\{[^}]*opacity/);
});

// ------------------------------------------------------------------------------------------------ page change

test('page change: tab pages and turned-to Settings pages use the spring; Settings pages move only when turned to', () => {
  assert.match(css, /html\.glass \.panel:not\(\[hidden\]\),\s*html\.glass \.set-page\.ag-turn:not\(\[hidden\]\)\s*\{\s*animation:\s*agPage var\(--ag-t-smooth\) var\(--ag-spring-smooth\)/);
  assert.match(css, /translateX\(calc\(var\(--dx, 0px\) \* 2\.2\)\)/, 'it reads the direction app.js already sets');
  assert.doesNotMatch(css, /html\.glass \.set-page:not\(\[hidden\]\)/, 'a Settings page must not move again when its tab arrives');
});

test('the springs are the ones glass-motion.css defines', () => {
  const gm = read('css', 'glass-motion.css');
  for (const name of ['bouncy', 'smooth']) {
    assert.match(gm, new RegExp(`--ag-spring-${name}:`));
    assert.match(gm, new RegExp(`--ag-t-${name}:`));
  }
  for (const m of css.matchAll(/var\(--ag-(?:spring|t)-([a-z]+)\)/g)) assert.ok(['bouncy', 'smooth'].includes(m[1]), m[0]);
});

// -------------------------------------------------------------------------------------------------- dialogs

test('the update dialog goes in and out by transition on the hidden attribute', () => {
  assert.match(css, /html\.glass \.upd\s*\{[^}]*animation:\s*none[^}]*transition:\s*display [\d.]+s allow-discrete/);
  assert.match(css, /@starting-style\s*\{[\s\S]*?html\.glass \.upd:not\(\[hidden\]\) \.upd-card\s*\{\s*translate:[^;]+;\s*scale:/);
  assert.match(css, /transform-origin:\s*var\(--ag-ox, 50%\) var\(--ag-oy, 50%\)/);
  assert.match(css, /html\.glass \.upd\[hidden\] \.upd-card[^}]*transition-duration/, 'out is quicker than in');
});

test('the Customise box opens by height, from and to auto', () => {
  assert.match(css, /html\.glass \.glass-custom\[hidden\]\s*\{\s*height:\s*0/);
  assert.match(css, /html\.glass \.glass-custom\s*\{[^}]*overflow:\s*clip/);
  assert.match(read('css', 'glass-motion.css'), /interpolate-size:\s*allow-keywords/);
});

// ------------------------------------------------------------------------------------------------- helpers

test('turnDir: forward when the new page lies after the old one, back when before, nothing otherwise', () => {
  assert.equal(M.turnDir(0, 2), 1);
  assert.equal(M.turnDir(3, 1), -1);
  assert.equal(M.turnDir(1, 1), 0);
  assert.equal(M.turnDir(-1, 2), 0, 'no page was showing');
  assert.equal(M.turnDir(2, -1), 0, 'no page is showing');
});

test('originOf: the centre of the button, in px from the top left corner of the card', () => {
  const card = { left: 100, top: 80, width: 400, height: 300 };
  // a 40 x 40 button at the top right of the window, above and right of the card
  const o = M.originOf({ left: 520, top: 10, width: 40, height: 40 }, card);
  assert.deepEqual(o, { x: 440, y: -50 });
  // a button inside the card's own box
  assert.deepEqual(M.originOf({ left: 280, top: 200, width: 40, height: 40 }, card), { x: 200, y: 140 });
});

test('originOf: a button far away cannot fling the card in from nowhere', () => {
  const card = { left: 100, top: 80, width: 400, height: 300 };
  const o = M.originOf({ left: 5000, top: -5000, width: 10, height: 10 }, card);
  assert.equal(o.x, 800, 'at most two card widths from the left edge');
  assert.equal(o.y, -300, 'at most one card height above');
});

test('clamp', () => {
  assert.equal(M.clamp(5, 0, 3), 3);
  assert.equal(M.clamp(-5, 0, 3), 0);
  assert.equal(M.clamp(2, 0, 3), 2);
});
