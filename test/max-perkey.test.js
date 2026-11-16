'use strict';
// The F75 Max's Per-key page (max-ui.js) is the F75 screen's own card: Select / Brush, Solid / Gradient / Rainbow, a direction
// and gradient presets. The session half of it, paintWith (one colour per key, saved and announced once), is checked here too.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const MX = require('../src/js/max.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('paintWith gives each key its own colour, clamps it, turns a key off on null, and saves and announces once', () => {
  const saved = [];
  const storage = { getItem: () => null, setItem: (k, v) => saved.push(v) };
  const s = new MX.MaxSession({ storage, delayMs: 0 });
  let changes = 0;
  s.on('change', () => changes++);
  s.keyColors.set(9, [1, 2, 3]);
  const before = saved.length;
  s.paintWith([1, 2, 9], (led) => (led === 1 ? [10, 20, 30] : led === 2 ? [300, -5, 7] : null));
  assert.deepStrictEqual(s.keyColors.get(1), [10, 20, 30]);
  assert.deepStrictEqual(s.keyColors.get(2), [255, 0, 7]);
  assert.strictEqual(s.keyColors.has(9), false);
  assert.strictEqual(saved.length - before, 1, 'saved once');
  assert.strictEqual(changes, 1, 'announced once');
});

test('the Max Per-key page has the F75 card: tool, paint modes, stops, direction, presets and the actions', () => {
  const js = read('js/max-ui.js');
  for (const id of ['mxTool', 'mxPaintWith', 'mxPkDir', 'mxPkCard', 'mxPaintSel', 'mxFillAll', 'mxSelAll', 'mxSelNone', 'mxPkOff', 'mxApplyK']) assert.ok(js.includes(`'${id}'`), id);
  for (const cls of ['pk-card', 'pk-col-tool', 'pk-col-colour', 'pk-col-do', 'pk-stops', 'pk-presets', 'pk-act', 'pk-foot']) assert.ok(js.includes(cls), cls);
  assert.match(js, /GRADIENTS = \[/);
});

test('the shared per-key styles hang on classes, so the Max card looks like the F75 one', () => {
  const css = read('css/keys.css');
  assert.ok(!/#pkSwap|#pkEditing|#pkStopB/.test(css), 'no id selectors left');
  assert.match(css, /\.pk-swap \{/);
  assert.match(css, /\.pk-stop\[data-stop="b"\]/);
  const html = read('index.html');
  assert.match(html, /class="btn ghost pk-swap" id="pkSwap"/);
  assert.match(html, /class="val pk-editing" id="pkEditing"/);
});
