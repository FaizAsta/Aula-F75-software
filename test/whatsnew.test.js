'use strict';

/*
 * "What's new" after an update: only the bold header of each bullet in RELEASE_NOTES.md is shown, for the versions between
 * the one that last ran and the one that runs now, and only when the app really was updated (not on a first install).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../src/js/whatsnew.js');

const root = path.join(__dirname, '..');
const NOTES = [
  '<!-- note for editors',
  '- **Not a bullet of any version:** this is inside the comment',
  '-->',
  '',
  '## What\'s new in 1.5.0',
  '',
  '## What\'s new in 1.4.6',
  '',
  '- **Faster start:** the long description that must never be shown.',
  '- Plain bullet without a bold title. The rest is a second sentence.',
  '',
  '## What\'s new in 1.4.5',
  '',
  '- **The red light:** more text, with **bold** and `code` and a [link](https://example.com).',
  '',
  '## What\'s new in 1.4.4',
  '',
  '- **Knob stays:** text',
].join('\n');

test('versions compare by number, not by text', () => {
  assert.equal(W.compare('1.4.10', '1.4.9'), 1);
  assert.equal(W.compare('1.4.4', '1.4.4'), 0);
  assert.equal(W.compare('v1.4.4', '1.4.5'), -1);
  assert.equal(W.compare('1.10.0', '1.9.9'), 1);
});

test('a header is the bold title without the colon, never the description', () => {
  assert.equal(W.header('- **The knob stays where you set it:** the app used to write an old copy'), 'The knob stays where you set it');
  assert.equal(W.header('- **Painting keys:** painting one key changes only that key.'), 'Painting keys');
  assert.equal(W.header('- Plain bullet without a bold title. The rest is a second sentence.'), 'Plain bullet without a bold title');
  assert.ok(W.header(`- **${'x'.repeat(200)}:** text`).length <= 90);
});

test('sections lists every version with its headers, and ignores the editors\' comment', () => {
  const s = W.sections(NOTES);
  assert.deepEqual(s.map((x) => x.version), ['1.5.0', '1.4.6', '1.4.5', '1.4.4']);
  assert.deepEqual(s[0].items, [], 'a version with only its header has nothing to list');
  assert.deepEqual(s[1].items, ['Faster start', 'Plain bullet without a bold title']);
  assert.deepEqual(s[2].items, ['The red light']);
  assert.ok(!JSON.stringify(s).includes('inside the comment'));
});

test('collect gives the versions after the old one up to the new one, newest first, without empty ones', () => {
  assert.deepEqual(W.collect(NOTES, '1.4.4', '1.4.6').map((x) => x.version), ['1.4.6', '1.4.5']);
  assert.deepEqual(W.collect(NOTES, '1.4.5', '1.5.0').map((x) => x.version), ['1.4.6'], '1.5.0 has no bullets yet');
  assert.deepEqual(W.collect(NOTES, null, '1.4.5').map((x) => x.version), ['1.4.5'], 'an unknown old version shows only the new one');
  assert.deepEqual(W.collect(NOTES, '1.4.6', '1.4.6'), []);
});

test('the dialog is owed after an update, not on a first install, a restart or a downgrade', () => {
  assert.deepEqual(W.decide('1.4.4', '1.4.5', true), { show: true, from: '1.4.4', record: false });
  assert.deepEqual(W.decide(null, '1.4.5', true), { show: true, from: null, record: false }, 'updated from a version that did not record itself');
  assert.deepEqual(W.decide(null, '1.4.5', false), { show: false, from: null, record: true }, 'first install');
  assert.deepEqual(W.decide('1.4.5', '1.4.5', true), { show: false, from: null, record: false });
  assert.deepEqual(W.decide('1.4.6', '1.4.5', true), { show: false, from: null, record: true });
});

test('the real RELEASE_NOTES.md gives headers only', () => {
  const md = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8');
  const v144 = W.sections(md).find((s) => s.version === '1.4.4');
  assert.ok(v144.items.includes('The knob stays where you set it'));
  assert.ok(v144.items.includes('Painting keys'));
  for (const h of v144.items) assert.ok(h.length <= 90 && !h.includes('**'), h);
});

test('the notes and the page are packed with the app', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('RELEASE_NOTES.md'), 'main.js reads it at run time');
  assert.ok(pkg.build.files.includes('src/**/*'), 'whatsnew.js and the page script live under src');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(html, /id="wn"/);
  assert.match(html, /js\/whatsnew-ui\.js/);
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /host:whats-new'/);
  assert.match(main, /host:whats-new-seen/);
});
