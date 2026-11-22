'use strict';

/*
 * The Liquid glass motion layer (css/glass-motion.css, js/glass-motion.js): the iOS Liquid Glass behaviours (press swell and
 * light, droplet stretch of the tab pill, tab bar minimize, menu morph, springs) on top of the glass UI.
 *
 * The pure helpers are tested directly. The stylesheet and the script are checked as text, like the other UI tests, because they
 * need a real browser to run (scripts in /scripts drive one). What matters here: Classic is untouched, motion is switched off
 * for reduced motion, and nothing in the page can be left half-done.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = read('index.html');
const css = read('css', 'glass-motion.css');
const js = read('js', 'glass-motion.js');
const M = require('../src/js/glass-motion.js');

// ---------------------------------------------------------------------------------------------------- wiring

test('index.html loads the stylesheet after glass.css and the script after the other page scripts', () => {
  assert.ok(html.includes('<link rel="stylesheet" href="css/glass-motion.css">'));
  assert.ok(html.indexOf('css/glass-motion.css') > html.indexOf('css/glass.css'), 'after glass.css, so it can build on it');
  assert.ok(html.includes('<script src="js/glass-motion.js"></script>'));
  assert.ok(html.indexOf('js/glass-motion.js') > html.indexOf('js/select.js'), 'after the menus it animates');
  assert.ok(html.indexOf('js/glass-motion.js') > html.indexOf('js/support.js'));
  // the keyboard glide (glide.css / glide.js) stays the last stylesheet, so it still wins its ties
  assert.ok(html.indexOf('css/glass-motion.css') < html.indexOf('css/glide.css'), 'glide.css stays last');
});

test('glass-motion.css: every rule is under html.glass, so Classic is untouched', () => {
  const body = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@property[^{]+\{[^{}]*\}/g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  let rules = 0;
  for (const m of body.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@')) continue;
    for (const sel of prelude.split(/,(?![^(]*\))/)) {
      rules++;
      assert.match(sel.trim(), /^html\.glass\b/, `selector outside html.glass: ${sel.trim()}`);
    }
  }
  assert.ok(rules > 25, `only ${rules} rules`);
});

test('the script only runs while html has the glass class, and tags the page with ag-fx while it does', () => {
  assert.match(js, /root\.classList\.contains\('glass'\)/);
  assert.match(js, /root\.classList\.add\('ag-fx'\)/);
  assert.match(js, /root\.classList\.remove\('ag-fx'\)/);
  // the rules that replace the old press look are gated on ag-fx, so a page where the script cannot run keeps them
  assert.match(css, /html\.glass\.ag-fx \.ag:is\(/);
  assert.match(css, /html\.glass\.ag-fx :is\(\.sel-pop, \.sup-pop\)\s*\{\s*animation:\s*none/);
});

// ----------------------------------------------------------------------------------------------- accessibility

test('reduced motion: the script stays off and the stylesheet hides what it adds', () => {
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /!\(motionQuery && motionQuery\.matches\)/);
  assert.match(js, /motionQuery\.addEventListener\('change', sync\)/, 'follows the setting live');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ag-lit[\s\S]*?display:\s*none/);
});

// -------------------------------------------------------------------------------------------------- springs

test('springs are CSS linear() curves with a cubic-bezier fallback', () => {
  for (const name of ['bouncy', 'snappy', 'smooth', 'press', 'wobble']) {
    assert.match(css, new RegExp(`--ag-spring-${name}:\\s*linear\\(`), `--ag-spring-${name}`);
    assert.match(css, new RegExp(`--ag-t-${name}:\\s*[\\d.]+m?s`), `--ag-t-${name}`);
  }
  assert.match(css, /@supports not \(transition-timing-function: linear\(0, ?1\)\)/);
  assert.match(css, /cubic-bezier\(/);
});

test('a spring sample list starts at 0, ends at 1 and overshoots only for the bouncy ones', () => {
  const curve = (name) => {
    const m = css.match(new RegExp(`--ag-spring-${name}:\\s*linear\\(([^)]*)\\)`));
    assert.ok(m, name);
    return m[1].split(',').map((s) => parseFloat(s));
  };
  for (const name of ['bouncy', 'snappy', 'smooth', 'press', 'wobble']) {
    const v = curve(name);
    assert.equal(v[0], 0, `${name} starts at 0`);
    assert.ok(Math.abs(v[v.length - 1] - 1) < 0.01, `${name} ends at 1`);
    assert.ok(v.every((n) => Number.isFinite(n)));
  }
  assert.ok(Math.max(...curve('bouncy')) > 1.02, 'bouncy overshoots');
  assert.ok(Math.max(...curve('smooth')) <= 1.005, 'smooth does not');
});

// ------------------------------------------------------------------------------------------------- helpers

test('swellFor: small controls swell most, wide tiles least, always within 2 % .. 12 %', () => {
  assert.equal(M.swellFor(28, 28), 1.12);
  assert.ok(M.swellFor(93, 32) > 1.06 && M.swellFor(93, 32) < 1.07);
  assert.equal(M.swellFor(560, 78), 1.02);
  assert.ok(M.swellFor(100, 100) > M.swellFor(300, 100));
  assert.ok(M.swellFor(0, 0) <= 1.12, 'a zero size does not blow up');
});

test('translateX reads what Chrome reports for the translate property', () => {
  assert.equal(M.translateX('none', 50), 0);
  assert.equal(M.translateX('', 50), 0);
  assert.equal(M.translateX('4px', 50), 4);
  assert.equal(M.translateX('-12.5px 0px', 50), -12.5);
  assert.equal(M.translateX('100%', 40), 40);
  assert.equal(M.translateX('50% 0px', 80), 40);
  assert.ok(Math.abs(M.translateX('calc(124.987% + 4.99946px)', 100) - 129.98646) < 1e-6);
  assert.ok(Math.abs(M.translateX('calc(100% - 4px)', 50) - 46) < 1e-9);
  assert.equal(M.translateX('calc(20px + 10%) 5px', 100), 30, 'only the x part, even if y is present');
});

test('easePace / stretchOf: the pace follows the highlight, the stretch is limited to -1..1', () => {
  assert.equal(M.easePace(0, 10, 0), 0, 'no time, no change');
  const a = M.easePace(0, 10, 1);
  assert.ok(a > 0 && a < 10);
  assert.ok(M.easePace(a, 10, 1) > a, 'it keeps approaching the real pace');
  assert.ok(Math.abs(M.easePace(0, 10, 50) - 10) < 1e-6);
  assert.equal(M.stretchOf(100, 6), 1);
  assert.equal(M.stretchOf(-100, 6), -1);
  assert.equal(M.stretchOf(3, 6), 0.5);
});

test('scrollIntent: scrolling down folds the tab bar, up (or the top) opens it', () => {
  let s = { min: false, acc: 0 };
  s = M.scrollIntent(s, 10, 10); // still near the top: nothing
  assert.equal(s.min, false);
  s = M.scrollIntent(s, 40, 30); // 30 px down, but not past the first 48 px
  assert.equal(s.min, false);
  s = M.scrollIntent(s, 80, 12);
  assert.equal(s.min, true, 'folded after 24 px of downward travel past 48 px');
  s = M.scrollIntent(s, 78, -2); // a jitter back
  assert.equal(s.min, true, 'small moves up do not open it');
  s = M.scrollIntent(s, 60, -18);
  assert.equal(s.min, false, '14 px up opens it');
  s = M.scrollIntent({ min: true, acc: 40 }, 4, -3);
  assert.deepEqual(s, { min: false, acc: 0 }, 'the very top always opens it');
  // a single big jump (a scroll to the end) counts as one gesture
  assert.equal(M.scrollIntent({ min: false, acc: 0 }, 200, 200).min, true);
  assert.equal(M.scrollIntent({ min: false, acc: 0 }, 60, 0).min, false, 'no movement, no change');
});

test('flip: the transform that makes the final box look like the first one', () => {
  const f = M.flip({ left: 100, top: 50, width: 80, height: 30 }, { left: 20, top: 90, width: 160, height: 120 }, 15, 24);
  assert.equal(f.transform, 'translate(80px, -40px) scale(0.5, 0.25)');
  // corners are written as an ellipse so they look round after the squeeze
  assert.equal(f.radius, '30px / 60px');
  assert.equal(f.toRadius, '24px');
  const same = M.flip({ left: 5, top: 5, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 }, 4, 4);
  assert.equal(same.transform, 'translate(0px, 0px) scale(1, 1)');
  const tiny = M.flip({ left: 0, top: 0, width: 1, height: 1 }, { left: 0, top: 0, width: 1000, height: 1000 }, 8, 8);
  assert.ok(/scale\(0\.05, 0\.05\)/.test(tiny.transform), 'the scale never collapses to nothing');
  const zero = M.flip({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 }, 4, 4);
  assert.ok(!/NaN|Infinity/.test(zero.transform + zero.radius), 'a zero-size target does not give NaN');
});

// ------------------------------------------------------------------------------------------------- safety

test('the script never touches the page when there is no document (the test runner) and exports its helpers', () => {
  for (const name of ['swellFor', 'translateX', 'easePace', 'stretchOf', 'scrollIntent', 'flip', 'clamp']) {
    assert.equal(typeof M[name], 'function', name);
  }
});

test('each part of the script is isolated: one failing does not stop the others, and all of them can be taken away again', () => {
  assert.match(js, /try \{\s*return make\(\);\s*\} catch/);
  for (const part of ['pressModule', 'liquidModule', 'tabsModule', 'menuModule', 'toastModule']) {
    assert.match(js, new RegExp(`function ${part}\\(`), part);
    assert.match(js, new RegExp(`\\b${part}\\b[,\\]]`), `${part} is started`);
  }
  // what is added to the page is removed again when the script stops
  assert.match(js, /\.ag-ghost'\)\.forEach\(\(g\) => g\.remove\(\)\)/);
  assert.match(js, /bar\.classList\.remove\('is-min', 'is-morph'\)/);
});

test('the press never moves the layout: it animates scale only, and gives a static host position: relative just for the press', () => {
  assert.match(js, /\{ scale: from \}, \{ scale: swellFor\(/);
  assert.match(js, /getComputedStyle\(el\)\.position === 'static'/);
  assert.match(js, /if \(st\.fixed && !held\.has\(el\)\) el\.style\.position = ''/);
});

test('nothing in the motion layer sets a rainbow or a hover colour (hover stays neutral)', () => {
  assert.ok(!/conic-gradient|hsl\(|rainbow/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no rainbow in the stylesheet');
});

test('the keyboard glide is the app\'s own devices -> app transition: the motion layer leaves the device box and the glide alone', () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.hm-dev|\.glide-ghost|\.gliding|\.hm-list|\.home\b/.test(body), 'no rule of the motion stylesheet touches the devices screen or the glide');
  const sel = js.match(/const SEL = '([^']+)'/);
  assert.ok(sel, 'the press hosts are listed');
  assert.ok(!/hm-dev/.test(sel[1]), 'the big keyboard box has its own slide and glide; glide.js measures it exactly');
  assert.ok(!/ag-zoom|zoomModule/.test(js + css), 'the zoom sheet is gone: the glide does that job');
});

test('menus: the glass filter is sized to the radius a menu settles at, not to the squeezed corners it opens with', () => {
  const motion = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'glass-motion.js'), 'utf8');
  const glass = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'glass.js'), 'utf8');
  // glass-motion.js writes the resting radius before it starts the animation that squeezes the corners
  const open = motion.slice(motion.indexOf('function onOpen(pop)'), motion.indexOf('function onClose(pop)'));
  const wrote = open.indexOf("pop.style.setProperty('--ag-rest-r'");
  assert.ok(wrote > -1, 'onOpen does not write --ag-rest-r');
  assert.ok(wrote < open.indexOf('pop.animate('), '--ag-rest-r must be written before the opening animation starts');
  // glass.js reads it when it measures a surface, and no longer reads the (animated) computed radius directly there
  assert.ok(/batch\.push\(\[el, w, h, cornerOf\(el\)\]\)/.test(glass), 'flush must measure the radius with cornerOf');
  assert.ok(!/batch\.push\([^)]*borderTopLeftRadius/.test(glass));
  const fn = /function cornerOf\(el\) \{([\s\S]*?)\n  \}/.exec(glass);
  assert.ok(fn && /--ag-rest-r/.test(fn[1]) && /borderTopLeftRadius/.test(fn[1]), 'cornerOf prefers --ag-rest-r and falls back to the computed radius');
});

test('no fade at the top and bottom of a scrolling page: the soft blur strips (.ag-edge) are gone, and the page is simply cut at its edge', () => {
  assert.ok(!/ag-edge|edgeModule|edgesOn/.test(js), 'the script no longer builds or mounts the strips');
  assert.ok(!/ag-edge/.test(css), 'the stylesheet has no rule for them');
  // glass.css already takes the mask off .panels (a mask would hide the picture from every glass surface inside it)
  const glass = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'glass.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/html\.glass \.panels \{\s*-webkit-mask-image: none;\s*mask-image: none;\s*\}/.test(glass));
});
