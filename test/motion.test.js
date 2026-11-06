'use strict';

/*
 * The motion layer (v1.3.2): ripples, button task states, the data-transfer animation and the header fixes.
 * Pure text / DOM-stub checks, like the other UI tests: no browser needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const html = read('index.html');
const app = read('js/app.js');
const appCss = read('css/app.css');
const motionCss = read('css/motion.css');
const motionJs = read('js/motion.js');

test('motion.css is loaded last, so it can bring back what lite mode switched off', () => {
  const lite = html.indexOf('css/lite.css');
  const motion = html.indexOf('css/motion.css');
  assert.ok(motion > lite && lite > 0, 'motion.css comes after lite.css');
});

test('motion.js is loaded before app.js, which uses it', () => {
  assert.ok(html.indexOf('js/motion.js') > 0);
  assert.ok(html.indexOf('js/motion.js') < html.indexOf('js/app.js'));
});

test('the motion layer keeps lite mode\'s rules: no blur, no backdrop filter, no filter effects', () => {
  assert.doesNotMatch(motionCss, /backdrop-filter\s*:|filter\s*:\s*(blur|drop-shadow)|\bfilter\s*:\s*(?!none)/);
});

test('every element the transfer animation touches exists in the page', () => {
  for (const id of ['stageTx', 'sbTx', 'progress', 'progressFill', 'txPct', 'applyMsg', 'btnApply', 'connChip']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is in index.html`);
  }
  assert.match(html, /id="btnApply"[^>]*><span class="lbl">/, 'the apply label sits in its own span, so a ripple is not wiped when the text changes');
  assert.equal((html.match(/class="tx-lane"/g) || []).length, 5, 'five streaks');
  assert.equal((html.match(/class="tx-pk/g) || []).length, 3, 'three packets on the apply bar link');
});

test('the apply bar drives all four phases and the three results', () => {
  for (const phase of ['prep', 'send', 'check']) assert.match(app, new RegExp(`${phase}:`));
  for (const kind of ['ok', 'warn', 'bad']) {
    assert.match(app, new RegExp(`holdTx\\('${kind}'\\)|${kind}: '`), `${kind} result is shown`);
    assert.match(motionCss, new RegExp(`data-tx="${kind}"`), `${kind} result is styled`);
  }
  for (const phase of ['prep', 'send', 'check']) assert.match(motionCss, new RegExp(`data-tx="${phase}"`));
  assert.match(app, /session\.apply\(setProgress\)/, 'the real write progress feeds the animation');
});

test('refresh and Read battery now play the transfer animation in reverse (rx)', () => {
  assert.match(app, /MO\.link\('rx', 'Reading'\)/);
  assert.match(app, /MO\.link\('rx', 'Reading battery'\)/);
  assert.match(motionCss, /data-link="rx"/);
});

test('the transfer animation and the ripples respect reduced motion', () => {
  assert.match(motionJs, /prefers-reduced-motion: reduce/);
  assert.match(motionJs, /if \(reduced\(\)\) return;/, 'ripples are skipped');
  // the style sheet's last rule kills every animation, whatever file it is in
  assert.match(appCss, /prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/);
});

test('hovers stay quiet: nothing in the motion layer brings back the rainbow ring on hover', () => {
  assert.doesNotMatch(motionCss, /:hover[^{}]*\{[^}]*(conic-gradient|hmSpin)/);
});

test('the header gives way in order: connection text, wide battery text', () => {
  assert.match(appCss, /@media \(max-width: 1399px\)\s*\{\s*\.conn #connText \{ display: none; \}/);
  assert.match(appCss, /@media \(max-width: 1180px\)\s*\{[^}]*#batChip\[data-wide="1"\] #batChipText \{ display: none; \}/);
  assert.match(app, /\.dataset\.wide = p === null \? '1' : ''/);
});

// ------------------------------------------------------------------ motion.js behaviour, in a DOM stub

function load({ reduce = false } = {}) {
  const listeners = {};
  const classes = () => {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), set };
  };
  const mk = () => ({ classList: classes(), dataset: {}, hidden: false, offsetWidth: 1, querySelector: () => ({ textContent: '' }) });
  const els = { '.stage': mk(), '#connChip': mk(), '#sbTx': mk() };
  const win = {
    matchMedia: () => ({ matches: reduce }),
  };
  const sandbox = {
    window: win,
    document: { addEventListener: (t, fn) => (listeners[t] = fn), querySelector: (s) => els[s] || null },
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    WeakMap,
    Promise,
  };
  vm.runInNewContext(motionJs, sandbox);
  return { M: win.AulaMotion, els };
}

test('link() sets the state on the stage, the header chip and the status chip', () => {
  const { M, els } = load();
  M.link('tx', 'Sending');
  assert.equal(els['.stage'].dataset.link, 'tx');
  assert.equal(els['#connChip'].dataset.link, 'tx');
  assert.equal(els['#sbTx'].hidden, false);
  M.link('');
  assert.equal(els['.stage'].dataset.link, '');
  assert.equal(els['#sbTx'].hidden, true);
});

test('writing(false) only clears a transfer it started, never a result', () => {
  const { M, els } = load();
  M.writing(true);
  assert.equal(els['.stage'].dataset.link, 'tx');
  M.writing(false);
  assert.equal(els['.stage'].dataset.link, '');
  M.link('ok');
  M.writing(false);
  assert.equal(els['.stage'].dataset.link, 'ok', 'an ok result is not wiped by the render that follows');
});

test('task(): true shows done, false or a throw shows failed, anything else ends quietly', async () => {
  const { M } = load();
  const btn = () => {
    const set = new Set();
    return { set, classList: { add: (c) => set.add(c), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c) } };
  };
  let b = btn();
  await M.task(b, async () => true);
  assert.ok(b.set.has('is-ok') && !b.set.has('is-busy'));
  b = btn();
  await M.task(b, async () => false);
  assert.ok(b.set.has('is-bad'));
  b = btn();
  await assert.rejects(M.task(b, async () => { throw new Error('x'); }));
  assert.ok(b.set.has('is-bad') && !b.set.has('is-busy'));
  b = btn();
  await M.task(b, async () => null);
  assert.ok(!b.set.has('is-ok') && !b.set.has('is-bad') && !b.set.has('is-busy'));
});
