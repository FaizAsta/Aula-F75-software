'use strict';

/*
 * The chips under the effect name (Static, Fixed speed, Mode 1 ...) must not be rebuilt on every render. Moving the brightness
 * slider renders the Lighting page many times a second; a chip made anew shows without its Liquid glass for a moment, so all of
 * them blinked. They are rebuilt only when what they say changes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
const start = app.indexOf("const chips = $('#effChips');");
const block = app.slice(start, app.indexOf('// Switching effect sweeps the new look', start));

test('renderLighting keeps the effect chips unless their content changed', () => {
  assert.ok(start > 0 && block.length > 0);
  assert.match(block, /const chipSig = JSON\.stringify\(chipList\)/);
  // the wipe sits inside the "changed" branch, never before it
  const wipe = block.indexOf("chips.textContent = ''");
  const guard = block.indexOf('chips.dataset.sig !== chipSig');
  assert.ok(guard > 0 && wipe > guard, 'chips are only cleared after the signature check');
});

test('the signature changes with the chips that are shown (effect, speed, own brightness, mode)', () => {
  assert.match(block, /'Adjustable speed' : 'Fixed speed'/);
  assert.match(block, /'Own brightness'/);
  assert.match(block, /`Mode \$\{e\.mode\}`/);
});
