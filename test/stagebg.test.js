'use strict';

/*
 * Keyboard background: the card behind the keyboard picture, and the Settings > Theme switch that hides or shows it.
 * Pure text checks, like the other UI tests: no browser needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = read('index.html');
const js = read('js/app.js');
const lite = read('css/lite.css');
const glass = read('css/glass.css');

test('Settings > Theme > Appearance has a Keyboard background switch, on by default', () => {
  assert.match(html, /<div class="srow" id="stageBgRow">[\s\S]*?<button class="switch" id="swStageBg" role="switch" aria-checked="true"[^>]*>/);
  // it sits in the Theme page, in the Appearance group with Blur and Frosted window
  const theme = html.slice(html.indexOf('id="setpage-theme"'), html.indexOf('id="glassSection"'));
  assert.ok(theme.includes('id="swStageBg"'), 'the switch is on the Theme page');
  assert.ok(theme.includes('id="swBlur"'), 'next to the other appearance switches');
});

test('the choice is saved as prefs.stageBg (on unless turned off) and put on <html> as "no-stage-bg"', () => {
  assert.match(js, /prefs\.stageBg = prefs\.stageBg !== false;/);
  // at start, and on every click
  assert.equal((js.match(/classList\.toggle\('no-stage-bg', !prefs\.stageBg\)/g) || []).length, 2);
  assert.match(js, /\$\('#swStageBg'\)\.addEventListener\('click'/);
  assert.match(js, /\$\('#swStageBg'\)\.setAttribute\('aria-checked', prefs\.stageBg \? 'true' : 'false'\)/);
  // the switch is brought in step with the saved choice when the app starts
  assert.match(js, /renderStyle\(\);\s*renderStageBg\(\);/);
  // and the click saves it
  const click = /\$\('#swStageBg'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n    \}\);/.exec(js);
  assert.ok(click, 'the click handler is there');
  assert.match(click[1], /savePrefs\(\)/);
});

test('the card is a real element, first in the stage, so glass.css keeps the stage ::after to itself', () => {
  assert.match(html, /<section class="stage" aria-label="Keyboard preview">\s*(?:<!--[\s\S]*?-->\s*)?<div class="stage-card" aria-hidden="true"><\/div>\s*<div class="stage-canvas">/);
  assert.ok(!/\.stage::after/.test(lite.replace(/\/\*[\s\S]*?\*\//g, '')), 'lite.css never uses .stage::after');
});

test('Classic: the stage gets the card of the .group boxes, in each of their three states, unless "no-stage-bg"', () => {
  // hidden everywhere except Classic with the switch on
  assert.match(lite, /\n\.stage-card \{ display: none; \}/);
  // every rule that shows or styles the card is scoped to Classic and to the switch being on
  const rules = lite.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.stage-card\s*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 5, 'hidden, base, picture, frost and blur rules');
  for (const r of rules) {
    if (/^\s*\.stage-card\s*\{/.test(r)) continue; // the plain "display: none"
    assert.match(r, /:not\(\.glass\)/, 'Classic only: ' + r.trim().slice(0, 70));
    assert.match(r, /:not\(\.no-stage-bg\)/, 'off with the switch: ' + r.trim().slice(0, 70));
  }
  const base = /:root:not\(\.glass\):not\(\.no-stage-bg\) \.stage-card \{([^}]*)\}/.exec(lite);
  assert.ok(base, 'the card layer');
  assert.match(base[1], /display:\s*block/);
  assert.match(base[1], /z-index:\s*-1/, 'behind the picture, so the animated drawing is never under the blur');
  assert.match(base[1], /border-radius:\s*inherit/);
  assert.match(base[1], /pointer-events:\s*none/, 'the card never takes a click');
  assert.match(base[1], /calc\(var\(--frost\) \* 100%\)/, 'the same tint as the other frosted cards when no picture is chosen');
  assert.match(base[1], /inset 0 0 0 1px var\(--line\)/, 'the same edge as the other cards');
  // the stage is its own stacking context, or the layer would fall behind the page
  assert.match(lite, /:root:not\(\.glass\):not\(\.no-stage-bg\) \.stage \{[^}]*z-index:\s*0/);
  // over a picture it is see-through like the cards, and on Windows' frosted window it is the plain card colour
  assert.match(lite, /:root\.has-picture:not\(\.glass\):not\(\.no-stage-bg\) \.stage-card \{ background: color-mix\(in srgb, var\(--surface\) var\(--glass\), transparent\); \}/);
  assert.match(lite, /:root\.frost:not\(\.glass\):not\(\.no-stage-bg\) \.stage-card \{ background: rgb\(var\(--card\) \/ 0\.84\); \}/);
  // it is frosted like them, except with Blur off, Windows' own frost, or the OS asking for less transparency
  const blur = /:root:not\(\.glass\):not\(\.frost\):not\(\.no-blur\):not\(\.no-stage-bg\) \.stage-card \{([^}]*)\}/.exec(lite);
  assert.ok(blur, 'the blur rule');
  assert.match(blur[1], /backdrop-filter:\s*blur\(var\(--frost-blur\)\) saturate\(1\.45\) !important/);
  assert.match(lite, /@media \(prefers-reduced-transparency: reduce\) \{\s*:root:not\(\.glass\):not\(\.frost\):not\(\.no-blur\):not\(\.no-stage-bg\) \.stage-card \{[^}]*backdrop-filter: none !important/);
  // it comes after the rule that switches every backdrop filter off, and is more specific, so it wins
  assert.ok(lite.indexOf(blur[0]) > lite.indexOf('*, *::before, *::after { backdrop-filter: none !important; }'));
});

test('Classic with the switch off: the stage is left exactly as it was (no card, no stacking context)', () => {
  // the stage z-index and the card are only ever set under "not no-stage-bg", so turning the switch off removes all of it
  const css = lite.replace(/\/\*[\s\S]*?\*\//g, '');
  const outside = css.replace(/[^{}]*:not\(\.no-stage-bg\)[^{}]*\{[^}]*\}/g, '');
  assert.ok(!/\.stage\b[^{]*\{[^}]*z-index/.test(outside), 'no stage z-index without the class check');
  assert.ok(!/\.stage-card\s*\{[^}]*(display:\s*block|background)/.test(outside), 'the card is never shown without the class check');
  // nothing else in the app styles the card
  for (const f of ['app.css', 'home.css', 'detail.css', 'motion.css', 'max.css', 'glass.css']) assert.ok(!/\.stage-card/.test(read('css', f)), `${f} leaves the card alone`);
});

test('Liquid glass: the same switch hides the glass behind the keyboard picture', () => {
  assert.match(glass, /html\.glass\.no-stage-bg \.stage\.ag-panel::after \{ display: none; \}/);
  assert.match(glass, /html\.glass\.no-stage-bg \.stage\.ag-panel \{ box-shadow: none; \}/);
  // the glass still shows by default: the rule that paints it is unchanged and not conditional on the class
  assert.match(glass, /html\.glass \.stage\.ag-panel::after \{/);
});
