'use strict';
// The keyboard picture in the big box of the device screen (src/js/devpic.js, home.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/js/devpic.js');
const L = require('../src/js/layout.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

/** A canvas whose 2d context only remembers what was drawn. */
function fakeCanvas() {
  const calls = [];
  const noop = () => {};
  const ctx = new Proxy(
    { drawImage: (...a) => calls.push(['drawImage', ...a]), fillText: (...a) => calls.push(['fillText', ...a]), measureText: (t) => ({ width: t.length * 50 }), createLinearGradient: () => ({ addColorStop: noop }) },
    { get: (o, k) => (k in o ? o[k] : noop), set: () => true },
  );
  return { calls, canvas: { width: 0, height: 0, style: {}, clientWidth: 600, getContext: () => ctx } };
}
const manifest = (skin) => ({ scale: 100, skins: { [skin]: { base: { w: 1800, h: 700, ox: 100, oy: 100 } } } });
const photoFor = (skin) => ({ skin: (id, U) => (id === skin ? { scale: 100, mc: 0.25, face: { l: 0.075, t: 0.045, r: 0.075, b: 0.289 }, base: { img: 'BASE' }, cap: (w, acc) => ({ img: `cap${w}${acc}` }) } : null) });

test('every picture id knows where its keys are and which skin it wears', () => {
  for (const id of P.IDS) {
    const m = P.modelOf(id);
    assert.ok(m.keys.length >= 60, `${id} has its keys`);
    assert.ok(m.w > 15 && m.h > 5, `${id} has a size`);
    for (const k of m.keys) assert.ok(k.w > 0 && Number.isFinite(k.x) && Number.isFinite(k.y), `${id} ${k.n}`);
  }
  assert.equal(P.modelOf('max').skin, 'max');
  assert.equal(P.modelOf('he').skin, 'f75he');
  assert.equal(P.modelOf('f75pro').skin, 'f75pro');
  assert.equal(P.modelOf('f87').keys.length, L.MODELS.find((m) => m.id === 'f87').keys.length);
  assert.equal(P.modelOf('nothing-like-it').id, L.DEFAULT_MODEL, 'an unknown id falls back to the default model');
  assert.ok(P.knows('max') && !P.knows('nothing-like-it'));
});

test('the Max and HE key names become the names their legends are written for', () => {
  assert.equal(P.legendName('shiftleft'), 'Shift');
  assert.equal(P.legendName('grave'), '`');
  assert.equal(P.legendName('f7'), 'F7');
  assert.equal(P.legendName('q'), 'Q');
  const he = P.modelOf('he').keys.map((k) => k.n);
  assert.ok(he.includes('Esc') && he.includes('Space') && he.includes('Backspace'));
});

test('a cap sprite and a legend face sit where preview.js puts them', () => {
  // 50 px per key unit, the key block starting 1 unit in, sprites reaching 0.25 past the key
  assert.deepEqual(P.spriteRect({ x: 2, y: 1, w: 1.5 }, 1, 1, 50, 0.25), { x: 137.5, y: 87.5, w: 100, h: 75 });
  const f = P.faceRect({ x: 0, y: 0, w: 1 }, 0, 0, 100, { l: 0.1, t: 0.05, r: 0.1, b: 0.3 }, 0.05);
  assert.ok(Math.abs(f.x - 15) < 1e-9 && Math.abs(f.y - 10) < 1e-9 && Math.abs(f.w - 70) < 1e-9 && Math.abs(f.h - 55) < 1e-9);
});

test('nothing is drawn until the rendered pictures are here, then the case and every cap are', () => {
  const m = P.modelOf('f75');
  const waiting = fakeCanvas();
  assert.equal(P.draw(waiting.canvas, 'f75', { manifest: manifest('f75'), photo: { skin: () => null }, width: 600, dpr: 1 }), false, 'still loading');
  assert.equal(waiting.calls.length, 0);
  assert.equal(P.draw(waiting.canvas, 'f75', { manifest: null, photo: photoFor('f75'), width: 600, dpr: 1 }), false, 'no pictures at all');

  const t = fakeCanvas();
  assert.equal(P.draw(t.canvas, 'f75', { manifest: manifest('f75'), photo: photoFor('f75'), width: 600, dpr: 1 }), true);
  assert.equal(t.canvas.width, 600);
  assert.equal(t.canvas.height, Math.round(600 / (1800 / 700)), 'the canvas has the case picture\'s shape');
  const images = t.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(images.length, 1 + m.keys.length, 'the case, then one sprite for each key');
  assert.equal(images[0][1], 'BASE');
  assert.ok(t.calls.some((c) => c[0] === 'fillText' && c[1] === 'Q'), 'the letters are printed');
});

test('a picture that is already drawn at this size is not drawn again, unless forced (the legend font arrived)', () => {
  const t = fakeCanvas();
  const o = { manifest: manifest('f75'), photo: photoFor('f75'), width: 600, dpr: 1 };
  P.draw(t.canvas, 'f75', o);
  const n = t.calls.length;
  assert.equal(P.draw(t.canvas, 'f75', o), true);
  assert.equal(t.calls.length, n, 'the same size: nothing redrawn');
  P.draw(t.canvas, 'f75', { ...o, force: true });
  assert.ok(t.calls.length > n, 'forced: drawn again');
  P.draw(t.canvas, 'f75', { ...o, width: 700 });
  assert.ok(t.calls.length > n * 2 - 1, 'another size: drawn again');
});

test('the big box: arrows and dots start hidden and only home.js shows them, for two keyboards or more', () => {
  const html = read('index.html');
  assert.match(html, /id="hmPrev"[^>]*\bhidden\b/);
  assert.match(html, /id="hmNext"[^>]*\bhidden\b/);
  assert.match(html, /id="hmDots"[^>]*\bhidden\b/);
  const dev = html.indexOf('<script src="js/devpic.js">');
  assert.ok(dev > 0 && dev < html.indexOf('<script src="js/home.js">'), 'devpic.js loads before home.js');
  const home = read('js/home.js');
  assert.match(home, /const many = slides\.length > 1;/);
  assert.match(home, /prevBtn\.hidden = nextBtn\.hidden = dotsEl\.hidden = !many;/);
  const css = read('css/home.css');
  assert.match(css, /\.hm-nav\[hidden\] \{ display: none; \}/, 'the hidden attribute is not undone by the button styles');
});

test('the keyboards that are not showing cannot be clicked or tabbed to', () => {
  const home = read('js/home.js');
  assert.match(home, /sl\.inert = pos !== 'cur'/);
  assert.match(read('css/home.css'), /data-pos="before"\], \.hm-list > \.hm-dev\[data-pos="after"\] \{[^}]*pointer-events: none/);
});

test('the big box is frosted in Classic (see-through tint and blur), and keeps the plain colour without the blur', () => {
  const lite = read('css/lite.css');
  const rule = lite.match(/:root:not\(\.glass\):not\(\.frost\):not\(\.no-blur\) \.hm-dev \{([^}]*)\}/);
  assert.ok(rule, 'a Classic rule for the box');
  assert.match(rule[1], /background: color-mix\(in srgb, rgb\(var\(--tile\)\) calc\(var\(--dev-frost\) \* 100%\), transparent\)/);
  assert.match(rule[1], /backdrop-filter: blur\(var\(--dev-blur\)\) saturate\(1\.5\) !important/);
  assert.match(lite, /:root\.no-blur|:not\(\.no-blur\) \.hm-dev/, 'Blur off in Settings is respected');
  assert.match(lite, /prefers-reduced-transparency: reduce\) \{\s*:root:not\(\.glass\):not\(\.frost\):not\(\.no-blur\) \.hm-dev \{[^}]*backdrop-filter: none/, 'the OS "Reduce transparency" gets no blur');
  assert.match(read('css/home.css'), /\.hm-dev \{[^}]*background: rgb\(var\(--tile\) \/ 0\.78\)/, 'the plain colour stays for the cases without blur');
});
