'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/js/protocol.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const html = read('index.html');
const app = read('js/app.js');

test('detail.css is loaded, and before lite.css so lite mode can still switch things off', () => {
  const detail = html.indexOf('css/detail.css');
  const lite = html.indexOf('css/lite.css');
  assert.ok(detail > 0, 'detail.css is linked');
  assert.ok(detail < lite, 'detail.css comes before lite.css');
});

test('every element the new detail code looks up exists in the page', () => {
  const ids = ['effDesc', 'effChips', 'meterBright', 'meterSpeed', 'sbModel', 'sbLink', 'sbFx', 'sbColor', 'sbSpeed', 'sbBright', 'stageBar'];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `#${id} is in index.html`);
  assert.equal((html.match(/id="meterBright"[^>]*>(<i><\/i>)+/) || [''])[0].split('<i>').length - 1, 4, 'brightness meter has 4 ticks');
  assert.equal((html.match(/id="meterSpeed"[^>]*>(<i><\/i>)+/) || [''])[0].split('<i>').length - 1, 5, 'speed meter has 5 ticks');
});

test('every effect, and Off, has a description', () => {
  const block = app.slice(app.indexOf('const EFFECT_INFO = {'), app.indexOf('};', app.indexOf('const EFFECT_INFO = {')));
  const keys = [...block.matchAll(/^\s*(\d+):/gm)].map((m) => +m[1]);
  for (const mode of [P.MODE_OFF, ...P.EFFECTS.map((e) => e.mode)]) assert.ok(keys.includes(mode), `mode ${mode} has a description`);
});

test('the status bar never blocks the keyboard underneath it', () => {
  const css = read('css/detail.css');
  assert.match(css, /\.stage-bar\s*\{[^}]*pointer-events:\s*none/);
});

test('detail.css adds no animation or blur of its own', () => {
  const css = read('css/detail.css');
  assert.doesNotMatch(css, /@keyframes|animation\s*:|backdrop-filter|filter\s*:\s*blur/);
});

test('the battery icon in the header is bigger than the standard 18px icons', () => {
  const css = read('css/app.css');
  const m = /\.bat-ico\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/.exec(css);
  assert.ok(m, '.bat-ico has its own size');
  assert.ok(+m[1] > 18 && +m[2] > 18, 'larger than the 18px default');
  assert.ok(html.includes('class="ico bat-ico"'), 'the header battery uses it');
});
