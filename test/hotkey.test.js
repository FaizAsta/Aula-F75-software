'use strict';

/*
 * Settings > Keyboard > Reset keyboard: the note under the button that names the keyboard's own hard reset (a hotkey pressed on
 * the keyboard; the app sends nothing for it). AULA's support pages give Fn + Esc, held for 5 seconds.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../src/js/layout.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every model names Fn + Esc, held for 5 seconds, as its hard reset', () => {
  for (const m of L.MODELS) {
    const hk = L.hardReset(m.id);
    assert.deepEqual([...hk.keys], ['Fn', 'Esc'], `${m.id}: keys`);
    assert.equal(hk.hold, 5, `${m.id}: seconds`);
  }
  assert.deepEqual([...L.HARD_RESET.keys], ['Fn', 'Esc'], 'the F75 Max uses the same hotkey');
  assert.deepEqual([...L.hardReset('nope').keys], ['Fn', 'Esc'], 'an unknown id falls back to the default model');
});

test('the note sits inside the Reset keyboard row, after its button', () => {
  const html = read('src/index.html');
  const row = html.slice(html.indexOf('<b>Reset keyboard</b>'));
  const end = row.indexOf('</section>'); // the Reset keyboard row is the last one of the section
  const part = row.slice(0, end);
  assert.ok(part.indexOf('id="kbReset"') > -1, 'the button is in the row');
  assert.ok(part.indexOf('id="resetHotkey"') > part.indexOf('id="kbReset"'), 'the note comes after the button');
  assert.equal(html.match(/id="resetHotkey"/g).length, 1, 'one note');
});

test('the note is filled for the connected keyboard and follows the F75 Max', () => {
  const js = read('src/js/app.js');
  assert.match(js, /function renderResetHotkey\(max\)/);
  assert.match(js, /renderResetHotkey\(max\);/, 'renderReset calls it, so it follows the connection');
  assert.match(js, /max \? 'AULA F75 Max' : L\.modelName\(prefs\.model\)/, 'names the F75 Max or the selected model');
  assert.match(js, /L\.hardReset\(/, 'the keys come from the layout data');
});

test('the note is styled to sit under the button, right aligned', () => {
  const css = read('src/css/app.css');
  assert.match(css, /\.reset-hotkey \{[^}]*flex: 1 0 100%[^}]*text-align: right/);
  assert.match(css, /\.reset-hotkey kbd \{/);
});
