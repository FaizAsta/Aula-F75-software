// The "Unsaved changes" bar (Revert / Apply to keyboard) is liquid glass like the cards and menus around it. It floats over the page and holds two glass
// buttons, so it is a panel (its glass is the ::after layer and the buttons look through it) that the GPU leaves to the SVG filters (the GPU canvas sits
// below the page's cards, so a floating bar drawn on it would be covered by them). The picture itself is checked in the real window (scripts/); here the
// lists and the sheets are checked from source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const list = (js, name) => {
  const m = js.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]\\.join\\([^)]*\\)|'[^']*');`));
  assert.ok(m, `${name} not found in glass.js`);
  return m[1];
};
const has = (l, c) => new RegExp(`(^|[\\s,'])${c.replace('.', '\\.')}(?![\\w-])`).test(l);

test('glass.js: the apply bar is a glass panel, not a leaf, and the GPU does not take it', () => {
  const js = src('js', 'glass.js');
  assert.ok(has(list(js, 'PANELS'), '.applybar'), '.applybar is a panel');
  assert.ok(!has(list(js, 'TARGETS'), '.applybar'), 'it is not also a leaf: the buttons inside would lose the picture');
  const gpuNot = js.match(/const GPU_NOT = '([^']+)'/);
  assert.ok(gpuNot && has(gpuNot[1], '.applybar'), 'the bar floats over cards, so the GPU canvas below them cannot draw it');
});

test('glass.css: the bar keeps its own place and has no blur of its own', () => {
  const css = noComments(src('css', 'glass.css'));
  const place = /html\.glass \.applybar\.ag-panel,\s*html\.glass \.applybar\.ag-panel:hover\s*\{([^}]*)\}/.exec(css);
  assert.ok(place, 'a rule that overrides the panel position');
  assert.ok(/position:\s*absolute/.test(place[1]), 'a panel is position: relative, the bar sits at the foot of the page');
  assert.ok(/z-index:\s*5/.test(place[1]), 'and in front of the page');
  const noBlur = /html\.glass \.applybar\s*\{([^}]*)\}/.exec(css);
  assert.ok(noBlur && /backdrop-filter:\s*none\s*!important/.test(noBlur[1]), 'a blur on the bar itself would hide the picture from its ::after layer');
  assert.ok(/html\.glass \.applybar\.ag-panel::after/.test(css), 'the glass is the ::after layer, with its own tint');
  assert.ok(/html\.glass \.applybar:not\(\.ag-panel\)\s*\{[^}]*background:/.test(css), 'until it is measured it already wears a see-through tint');
});

test('glass.css: the bar rises without fading (a fading box is a backdrop root), and still fades away', () => {
  const css = noComments(src('css', 'glass.css'));
  const kf = /@keyframes glassBar\s*\{([^}]*\{[^}]*\})\s*\}/.exec(css);
  assert.ok(kf, 'glassBar keyframes');
  assert.ok(/transform:/.test(kf[1]) && !/opacity/.test(kf[1]), 'it moves only');
  assert.ok(/html\.glass \.applybar:not\(\.leaving\)\s*\{\s*animation-name:\s*glassBar/.test(css), 'the way in uses it, not the way out');
  const motion = noComments(src('css', 'motion.css'));
  assert.ok(/\.applybar\.leaving\s*\{\s*animation:\s*barOut/.test(motion), 'Classic and the way out are untouched');
});

test('Classic keeps its frosted bar (lite.css)', () => {
  const lite = noComments(src('css', 'lite.css'));
  assert.ok(/:root:not\(\.glass\) \.applybar\s*\{\s*background:\s*rgb\(var\(--pop\) \/ var\(--frost\)\)/.test(lite));
});
