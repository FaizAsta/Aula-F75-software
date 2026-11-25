// Realistic glass that bends keeps its filters quiet when idle: nothing decorative animates for ever on or inside a glass surface
// (css/glass-bend.css), and a filter with Blur 0 has no pointless blur step (js/glass.js). The real browser is not needed: the
// stylesheet, the page and the engine are checked from their source.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('glass-bend.css: loaded after glass-normal.css, and every rule starts with html.glass:not(.glass-normal):not(.glass-gpu)', () => {
  const html = src('index.html');
  assert.ok(html.includes('href="css/glass-bend.css"'));
  assert.ok(html.indexOf('css/glass-normal.css') < html.indexOf('css/glass-bend.css'), 'after glass-normal.css');
  const css = noComments(src('css', 'glass-bend.css'));
  let selectors = 0;
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',')) {
      selectors++;
      assert.ok(/^\s*html\.glass:not\(\.glass-normal\):not\(\.glass-gpu\)\s/.test(sel), `selector outside the bending glass: ${sel.trim()}`);
    }
  }
  assert.ok(selectors >= 5);
});

test('glass-bend.css: the idle decorations stop, and every animation that answers the person keeps running', () => {
  const css = noComments(src('css', 'glass-bend.css'));
  for (const part of ['.stage::before', '.effect[aria-checked="true"]::after', '.live-dot', '.dot[data-s="ok"]::after', '.dot[data-s="warn"]::after', '.bat-bar i::after'])
    assert.ok(css.includes(part), `stops: ${part}`);
  assert.strictEqual((css.match(/animation: none;/g) || []).length, 3, 'three rules, the grouped one covers four');
  // busy states, sending, the spinner and the hover / press effects are not touched here
  for (const keep of ['spin', 'busy', 'tx-', 'is-busy', 'hover', ':active', 'btnShimmer', 'stripes', '.upd-bar', '.rl-'])
    assert.ok(!css.includes(keep), `left alone: ${keep}`);
  // the selected card still has a visible glow without the breathing
  assert.ok(/aria-checked="true"\]::after \{[^}]*box-shadow:/.test(css));
});

test('glass-bend.css: the animations it stops are the ones that run for ever, so each one exists in the stylesheets', () => {
  const app = src('css', 'app.css');
  assert.ok(/\.stage::before \{[^}]*animation: drift 16s ease-in-out infinite alternate/.test(app));
  assert.ok(/\.effect\[aria-checked="true"\]::after \{[^}]*animation: selBreath[^;]*infinite/.test(app));
  assert.ok(/\.effect\[data-live="true"\] \.live-dot \{ animation: livePulse[^}]*infinite/.test(app));
  assert.ok(/\.dot\[data-s="ok"\]::after\s*\{ animation: ping[^}]*infinite/.test(app));
  assert.ok(/\.bat-bar i::after \{[^}]*animation: sheen[^}]*infinite/.test(app));
});

test('glass.js: with Blur 0 a filter has no blur primitive, and the later steps read the picture itself', () => {
  const js = src('js', 'glass.js');
  const make = js.slice(js.indexOf('function makeFilter'), js.indexOf('function rim('));
  assert.ok(/const src = blur > 0 \? 'b' : 'SourceGraphic';/.test(make));
  assert.ok(/const frost = blur > 0 \?/.test(make), 'the blur primitive is only made when there is a blur');
  assert.ok(make.includes('in="${src}"'), 'the shift reads from src');
  assert.ok(/rimPass\(w, h, r, s === 0 \? src : 'o'/.test(make), 'the reflection too');
  const rimPass = js.slice(js.indexOf('function rimPass'), js.indexOf('function makeFilter'));
  assert.ok(!/in="b"/.test(rimPass), 'rimPass no longer hard-codes the blurred picture');
  assert.ok(/in="\$\{base\}"/.test(rimPass), 'it fetches from the picture it was given');
});
