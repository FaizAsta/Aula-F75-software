'use strict';

/*
 * The README's screenshots and the pictures in docs/screenshots must agree.
 *
 * Why this is tested: the pictures are made by `npm run screenshots` (scripts/screenshots.js) from the real UI. A new
 * picture that is never added to the README, or a README line that points at a picture that was renamed or deleted, is
 * easy to miss. (That the pictures are re-made after a UI change cannot be tested; the note at the top of the README
 * says to do it, and this test checks that the note is still there.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const shotsDir = path.join(root, 'docs', 'screenshots');

const used = new Set([...readme.matchAll(/docs\/screenshots\/([\w.-]+\.png)/g)].map((m) => m[1]));
const onDisk = fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png'));

test('every screenshot the README shows exists', () => {
  for (const f of used) assert.ok(fs.existsSync(path.join(shotsDir, f)), `README uses docs/screenshots/${f}, which is missing`);
});

test('every picture in docs/screenshots is shown in the README', () => {
  for (const f of onDisk) assert.ok(used.has(f), `docs/screenshots/${f} is not in the README's Screenshots section`);
});

test('the README keeps its note about updating the screenshots when the UI changes', () => {
  const note = readme.match(/<!--([\s\S]*?)-->/);
  assert.ok(note, 'an HTML comment at the top of the README');
  assert.match(note[1], /screenshots/i);
  assert.match(note[1], /UI changes/i);
  assert.match(note[1], /npm run screenshots/);
});

test('every scene in scripts/screenshots.js writes pictures the README shows', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'screenshots.js'), 'utf8');
  const written = new Set([...src.matchAll(/(?:snap\(\w+|sheet\()\s*,?\s*'([\w-]+)'/g)].map((m) => m[1] + '.png'));
  assert.ok(written.size >= 15, `found ${written.size} pictures in the script`);
  for (const f of written) assert.ok(used.has(f), `scripts/screenshots.js writes ${f}, which the README does not show`);
  for (const f of onDisk) assert.ok(written.has(f), `docs/screenshots/${f} is not made by scripts/screenshots.js, so it cannot be refreshed`);
});

test('package.json has the screenshots script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.screenshots, 'node scripts/screenshots.js');
});
