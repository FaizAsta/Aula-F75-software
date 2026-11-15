'use strict';

/*
 * The dropdown menu (js/select.js, css/select.css, css/glass.css section 10): that the pieces are wired together, in both styles.
 *
 * Why this is tested: the menu replaces the browser's own list, which cannot be styled. If a stylesheet or script stops being
 * loaded, or the glass layer forgets the menu, the dropdowns silently fall back to a grey box (Classic) or an unstyled flat
 * menu (Liquid glass). What it does when used (opening, choosing, keys, closing) needs a real browser: scripts/ui-select.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, 'src', ...p), 'utf8');
const html = read('index.html');
const js = read('js', 'select.js');
const css = read('css', 'select.css');
const glassCss = read('css', 'glass.css');

test('index.html loads the menu: select.css before lite.css and glass.css, select.js with the other scripts', () => {
  assert.ok(html.includes('href="css/select.css"'));
  assert.ok(html.includes('src="js/select.js"'));
  assert.ok(html.indexOf('css/select.css') < html.indexOf('css/lite.css'), 'select.css comes before lite.css');
  assert.ok(html.indexOf('css/lite.css') < html.indexOf('css/glass.css'));
});

test('every <select> in the page is a .select, so every dropdown gets the menu', () => {
  const tags = html.match(/<select\b[^>]*>/g) || [];
  assert.ok(tags.length >= 4, `found ${tags.length} selects`);
  for (const t of tags) assert.match(t, /class="[^"]*\bselect\b/, `${t} is not a .select`);
});

test('the menu replaces the browser list but keeps the select real: it cancels the mousedown and fires input and change', () => {
  assert.match(js, /addEventListener\(\s*'mousedown'/);
  assert.match(js, /e\.preventDefault\(\);\s*\/\/ this is what stops the browser's own list/);
  assert.match(js, /new Event\('input', \{ bubbles: true \}\)/);
  assert.match(js, /new Event\('change', \{ bubbles: true \}\)/);
  assert.match(js, /querySelector\('\.shell'\)/, 'it lives inside the window, like the Support menu');
});

test('option text goes in as text, never as markup', () => {
  const uses = js.match(/\.innerHTML\s*=/g) || [];
  assert.equal(uses.length, 1, 'the only innerHTML is the tick icon');
  assert.match(js, /tick\.innerHTML = TICK/);
  assert.match(js, /text\.textContent = opt\.textContent/);
});

test('Classic: a frosted menu in the family of the Support menu, with no-blur and reduced-transparency handled', () => {
  assert.match(css, /:root:not\(\.glass\) \.sel-pop \{[^}]*backdrop-filter: blur\(/);
  assert.match(css, /:root\.no-blur:not\(\.glass\) \.sel-pop \{[^}]*backdrop-filter: none/);
  assert.match(css, /prefers-reduced-transparency: reduce\) \{[^}]*\.sel-pop/);
  assert.match(css, /z-index: 55/, 'above the Support menu (50), below the window buttons (60)');
});

test('Liquid glass: the menu is a refracting surface, hidden until measured, with capsule rows', () => {
  assert.match(read('js', 'glass.js'), /const TARGETS = \[[\s\S]*?\.sel-pop[\s\S]*?\.upd-bar/);
  assert.match(glassCss, /html\.glass \.sel-pop:not\(\.ag\) \{ visibility: hidden; \}/);
  assert.match(glassCss, /html\.glass \.sel-item \{[^}]*border-radius: 999px/);
  assert.match(glassCss, /html\.glass \.sel-pop\.ag \{ background:/);
  assert.match(glassCss, /prefers-reduced-transparency: reduce\) \{\s*html\.glass \.sel-pop\.ag/);
});

test('the glass menu only moves when it appears (a fade would hide the picture from the glass), and honours reduced motion', () => {
  const frames = glassCss.match(/@keyframes glassSelIn(Up)? \{[^}]*\}[^}]*\}/g) || [];
  assert.equal(frames.length, 2);
  for (const f of frames) assert.ok(!/opacity/.test(f), 'no opacity in a glass entrance');
  assert.match(glassCss, /prefers-reduced-motion: reduce\) \{\s*html\.glass \.sel-pop \{ animation: none/);
});

test('both styles mark the current choice and the open select', () => {
  assert.match(css, /\.sel-item\[aria-selected="true"\]/);
  assert.match(css, /\.select\[aria-expanded="true"\]/);
  assert.match(glassCss, /html\.glass \.sel-item\[aria-selected="true"\]/);
  assert.match(glassCss, /html\.glass \.select\.ag\[aria-expanded="true"\]/);
});
