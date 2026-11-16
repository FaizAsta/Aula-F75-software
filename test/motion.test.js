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

test('Classic frosts the apply bar, the Support menu and the toasts: a see-through tint over a blur, only outside Liquid glass', () => {
  const lite = read('css/lite.css');
  const rule = /:root:not\(\.glass\) :is\(\.applybar, \.toast, \.sup-pop\) \{([^}]*)\}/.exec(lite);
  assert.ok(rule, 'one rule frosts all three');
  assert.match(rule[1], /backdrop-filter:\s*blur\(var\(--frost-blur\)\)[^;]*!important/, 'beats the blanket "backdrop-filter: none !important" above it');
  assert.ok(lite.indexOf(rule[0]) > lite.indexOf('*, *::before, *::after { backdrop-filter: none !important; }'), 'and comes after it');
  // the tint is a variable below full strength (the old 0.97-0.985 looked solid), set per surface from its own colour
  assert.match(lite, /--frost:\s*0\.\d+/);
  for (const [sel, tok] of [['applybar', 'pop'], ['toast', 'pop-2'], ['sup-pop', 'pop']]) {
    assert.match(lite, new RegExp(`:root:not\\(\\.glass\\) \\.${sel}\\s*\\{ background: rgb\\(var\\(--${tok}\\) / var\\(--frost\\)\\); \\}`), `.${sel} gets the translucent tint`);
  }
  // reduce transparency: solid again, no blur
  assert.match(lite, /prefers-reduced-transparency: reduce\)\s*\{[^@]*--frost:\s*0\.98[^@]*backdrop-filter:\s*none !important/);
  // nothing here may leak into Liquid glass, which paints these surfaces itself
  const block = lite.slice(lite.indexOf('4b.'), lite.indexOf('/* ---- 5.'));
  for (const line of block.split('\n').filter((l) => /^\s*:root/.test(l) || /^\s*:root\[/.test(l))) assert.match(line, /:not\(\.glass\)/, `Classic-only: ${line.trim()}`);
});

test('Classic frosts the tab bar, the cards and the effect tiles too, and clears what would hide the picture from the blur', () => {
  const lite = read('css/lite.css');
  const block = lite.slice(lite.indexOf('/* ---- 4c.'), lite.indexOf('/* ---- 5.'));
  assert.ok(block.length > 200, 'section 4c is there');
  // the blur, on the boxes, with the same strength as the Support menu, and it beats the blanket "none !important"
  const rule = /:root:not\(\.glass\):not\(\.frost\) :is\(\.tabs, \.set-nav, \.group, \.effect, \.eff-top\) \{([^}]*)\}/.exec(block);
  assert.ok(rule, 'one rule frosts the tab bar, the cards, the tiles and the Effect heading card');
  assert.match(rule[1], /backdrop-filter:\s*blur\(var\(--frost-blur\)\)\s*saturate\(1\.45\)\s*!important/);
  assert.ok(lite.indexOf(rule[0]) > lite.indexOf('*, *::before, *::after { backdrop-filter: none !important; }'), 'and comes after it');
  // a blur sees nothing through a mask: the fade on the scrolling area is off in Classic (glass.css does the same for Liquid glass)
  assert.match(block, /:root:not\(\.glass\):not\(\.frost\) \.panels \{[^}]*mask-image:\s*none/);
  // ... and nothing that holds a box may fade (opacity below 1 is a backdrop root too): the entrances only move
  for (const name of ['frostPanel', 'frostRise', 'frostDrop']) {
    const kf = new RegExp(`@keyframes ${name}\\s*\\{([^@]*)\\}\\s*(?=@|:|\\n)`).exec(block);
    assert.ok(kf, `${name} exists`);
    assert.ok(!/opacity/.test(kf[1]) && /transform/.test(kf[1]), `${name} moves and does not fade`);
  }
  assert.match(block, /\.panel:not\(\[hidden\]\) \{ animation-name: frostPanel; \}/);
  assert.match(block, /:is\(\.split > \*, \.settings > \*, \.entering \.main\) \{ animation-name: frostRise; \}/);
  assert.match(block, /\.entering \.top \{ animation-name: frostDrop; \}/);
  // the tint (only where there is no picture and no Windows frost, and with zero specificity), from the box's own colour;
  // the cards keep the soft highlight along their top edge (detail.css)
  assert.match(block, /:where\(:root:not\(\.glass\):not\(\.has-picture\):not\(\.frost\)\) :is\(\.effect, \.eff-top\) \{ background: color-mix\(in srgb, var\(--surface\) calc\(var\(--frost\) \* 100%\), transparent\); \}/);
  assert.match(block, /:where\(:root:not\(\.glass\):not\(\.has-picture\):not\(\.frost\)\) \.group \{ background: linear-gradient\(180deg, var\(--lift\), transparent 140px\), color-mix/);
  // reduce transparency: solid again, no blur
  assert.match(lite, /prefers-reduced-transparency: reduce\)\s*\{[^@]*:is\(\.tabs, \.set-nav, \.group, \.effect, \.eff-top\) \{[^}]*backdrop-filter:\s*none !important/);
  // Classic-only
  for (const line of block.split('\n').filter((l) => /^\s*:root/.test(l))) assert.match(line, /:not\(\.glass\)/, `Classic-only: ${line.trim()}`);
});

test('Classic: the Effect heading is a card of its own, and the header has no dark strip behind it', () => {
  const lite = read('css/lite.css');
  // one wrapper in the page, holding the title, the line under it and the chips (it has no style of its own, so Liquid glass is unchanged)
  assert.match(html, /<div class="eff-top">\s*<div class="block-head"><h2>Effect<\/h2><span class="val" id="effName"><\/span><\/div>\s*<p class="eff-desc" id="effDesc"><\/p>\s*<div class="eff-chips" id="effChips"><\/div>\s*<\/div>/);
  const base = /:root:not\(\.glass\) \.eff-top \{([^}]*)\}/.exec(lite);
  assert.ok(base && /border-radius:\s*var\(--r-group\)/.test(base[1]) && !/background/.test(base[1]), 'a rounded card whose colour comes from the tint rules (so they can win)');
  assert.match(lite, /:root\.has-picture:not\(\.glass\) \.eff-top \{ background: color-mix\(in srgb, var\(--surface\) var\(--glass\), transparent\); \}/);
  assert.match(lite, /:root\.frost:not\(\.glass\) \.eff-top \{ background: var\(--surface\); \}/);
  // the header has no frosted strip, with or without a picture: the picture shows through it
  assert.ok(!/\.top::before/.test(lite), 'no strip behind the header');
  assert.ok(!/:root[^{]*\.top \{[^}]*backdrop-filter/.test(lite), 'no blur on the header itself');
  // ... so over a picture the header's controls get the card colour of the theme (not a faint white veil), Classic only
  const box = /:root\.has-picture:not\(\.glass\) :is\(\.tabs, \.top-right > :is\(\.pill-btn, \.icon-btn\), \.win-btn\) \{([^}]*)\}/.exec(lite);
  assert.ok(box, 'the tabs, the battery, Support and the window buttons get a box over a picture');
  assert.match(box[1], /background:\s*color-mix\(in srgb, var\(--surface\) var\(--glass\), transparent\)/);
  assert.match(lite, /:root\.has-picture:not\(\.glass\) \.win-btns \.win-close:hover \{ background: rgb\(229 72 77/, 'close still turns red on hover');
});

test('Classic: the battery pill, Support, the update badge and the window buttons are frosted over a picture, like the tab bar', () => {
  const lite = read('css/lite.css');
  const sel = ':root\\.has-picture:not\\(\\.glass\\):not\\(\\.frost\\):not\\(\\.no-blur\\) :is\\(\\.top-right > :is\\(\\.pill-btn, \\.icon-btn\\), \\.win-btn\\)';
  const on = new RegExp(sel + ' \\{([^}]*)\\}').exec(lite);
  assert.ok(on, 'one rule blurs the header buttons over a picture');
  assert.match(on[1], /backdrop-filter:\s*blur\(var\(--frost-blur\)\) saturate\(1\.45\) !important/);
  // the same blur as the tab bar and the cards
  assert.match(lite, /:root:not\(\.glass\):not\(\.frost\) :is\(\.tabs, \.set-nav, \.group, \.effect, \.eff-top\) \{[^}]*blur\(var\(--frost-blur\)\) saturate\(1\.45\)/);
  // Blur off, Windows' own frost and Liquid glass are excluded by the selector itself; "Reduce transparency" turns it off again
  const off = new RegExp('@media \\(prefers-reduced-transparency: reduce\\) \\{\\s*' + sel + ' \\{[^}]*backdrop-filter:\\s*none !important').exec(lite);
  assert.ok(off, 'no blur with Reduce transparency');
  // it comes after the rule that switches every backdrop off, and the tint rule above it is unchanged
  assert.ok(lite.indexOf(on[0]) > lite.indexOf('*, *::before, *::after { backdrop-filter: none !important; }'));
  assert.match(lite, /:root\.has-picture:not\(\.glass\) :is\(\.tabs, \.top-right > :is\(\.pill-btn, \.icon-btn\), \.win-btn\) \{/);
});

test('Classic: a Blur switch in Settings > Theme turns the frosted blur off, and Liquid glass does not show it', () => {
  const lite = read('css/lite.css');
  const js = read('js/app.js');
  // the row and its switch are in the Appearance group, on by default
  assert.match(html, /<div class="srow" id="blurRow">[\s\S]*?<button class="switch" id="swBlur" role="switch" aria-checked="true"[^>]*>/);
  // saved as prefs.blur (on unless the person turned it off), and put on <html> as class "no-blur" at start and on every click
  assert.match(js, /prefs\.blur = prefs\.blur !== false;/);
  assert.match(js, /classList\.toggle\('no-blur', !prefs\.blur\)/);
  assert.match(js, /\$\('#swBlur'\)\.addEventListener\('click'/);
  // Classic only: Liquid glass has its own Blur slider, so the row is hidden there
  assert.match(js, /\$\('#blurRow'\)\.hidden = glass;/);
  // the CSS: every frosted surface loses its blur, the floating ones turn nearly solid, and none of it reaches Liquid glass
  const off = /:root\.no-blur:not\(\.glass\) :is\(([^)]*)\) \{([^}]*)\}/.exec(lite);
  assert.ok(off, 'one rule switches the blur off');
  for (const name of ['.applybar', '.toast', '.sup-pop', '.tabs', '.set-nav', '.group', '.effect', '.eff-top']) assert.ok(off[1].includes(name), `${name} loses its blur`);
  assert.match(off[2], /backdrop-filter:\s*none !important/);
  assert.match(lite, /:root\.no-blur:not\(\.glass\) \{ --frost: 0\.985; \}/);
  assert.ok(lite.indexOf(off[0]) > lite.indexOf('--frost-blur)) saturate(1.45) !important'), 'and comes after the rules that turn it on');
});

test('Classic: the Settings page switcher is a frosted box over a picture, like the tab bar', () => {
  const lite = read('css/lite.css');
  assert.match(html, /<div class="seg seg-4 set-nav" id="segSetPage"/);
  assert.match(lite, /:root\.has-picture:not\(\.glass\) \.set-nav \{ background: color-mix\(in srgb, var\(--surface\) var\(--glass\), transparent\); \}/);
  const blur = [...lite.matchAll(/:root:not\(\.glass\):not\(\.frost\) :is\(([^)]*)\) \{([^}]*)\}/g)].find((m) => /backdrop-filter/.test(m[2]));
  assert.ok(blur && blur[1].includes('.set-nav'), 'it gets the same blur as the tabs');
});
