'use strict';

/*
 * "Which UI do you want to use?": the options under the selected card and the live picture on it (js/stylepick-ui.js).
 * The page is plain scripts with no DOM here, so these read the source for the wiring that must not drift, the same way
 * stylepick.test.js and stagebg.test.js do.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const html = read('src', 'index.html');
const ui = read('src', 'js', 'stylepick-ui.js');
const app = read('src', 'js', 'app.js');
const home = read('src', 'js', 'home.js');
const boot = read('src', 'js', 'boot.js');
const theme = read('src', 'js', 'theme.js');
const css = read('src', 'css', 'stylepick.css');

const section = html.slice(html.indexOf('id="spScreen"'), html.indexOf('class="scr scr-devices"'));

test('each card sits in its own column with its options panel beside it, never inside the button', () => {
  assert.equal((section.match(/<div class="sp-col">/g) || []).length, 2);
  for (const style of ['classic', 'glass']) {
    const i = section.indexOf(`data-style-choice="${style}"`);
    const end = section.indexOf('</button>', i);
    const after = section.slice(end, end + 400);
    assert.match(after, /<div class="sp-opts"[^>]*data-opts="/, `${style}: the options come right after the card`);
    assert.ok(!/class="sp-opts"/.test(section.slice(i, end)), `${style}: nothing interactive inside the radio button`);
  }
  assert.match(section, /id="spOptsClassic" data-opts="classic"[^>]*hidden/);
  assert.match(section, /id="spOptsGlass" data-opts="glass"[^>]*hidden/);
});

test('Classic shows Blur and Keyboard background; Liquid glass shows the same four sliders as Settings', () => {
  assert.match(section, /id="spBlur" role="switch" aria-checked="true"/, 'Blur is on by default');
  assert.match(section, /id="spStageBg" role="switch" aria-checked="false"/, 'Keyboard background is off by default');
  for (const [id, key] of [['spGBlur', 'blur'], ['spGBezel', 'bezel'], ['spGAmount', 'amount'], ['spGChroma', 'chroma']]) {
    const here = new RegExp(`<input class="range" id="${id}" data-glass="${key}" type="range" min="([^"]+)" max="([^"]+)" step="([^"]+)"`).exec(section);
    const there = new RegExp(`data-glass="${key}" type="range" min="([^"]+)" max="([^"]+)" step="([^"]+)"`).exec(html.slice(html.indexOf('id="glassSection"')));
    assert.ok(here && there, `${key}: slider in both places`);
    assert.deepEqual(here.slice(1), there.slice(1), `${key}: the same range as the one in Settings`);
  }
  assert.match(section, /id="spGlassReset"/);
});

test('the script loads before app.js and home.js, which call it', () => {
  const at = (f) => html.indexOf(`<script src="js/${f}"></script>`);
  assert.ok(at('stylepick-ui.js') > at('stylepick.js'));
  assert.ok(at('stylepick-ui.js') < at('app.js'));
  assert.ok(at('stylepick-ui.js') < at('home.js'));
});

test('home.js opens, selects, closes and reads the draft; the keys under the card are left alone', () => {
  assert.match(home, /SPUI = window\.AulaStylePickUI/);
  assert.match(home, /SPUI\.open\(spPick\)/);
  assert.match(home, /if \(SPUI && screen === 'style'\) SPUI\.select\(style\)/);
  assert.match(home, /left === 'style' && name !== 'style' && SPUI\) SPUI\.close\(\)/, 'leaving the question stops the live picture');
  assert.match(home, /!t\.closest\('\.sp-opts'\)/, 'arrows and Enter on a slider or switch do not move the card or continue');
  assert.match(home, /if \(window\.AULA_PREVIEW\) go\('app'\)/, 'the live picture goes straight to the app');
});

test('the options are a draft: only Continue applies them, and only the selected style\'s', () => {
  assert.doesNotMatch(ui, /prefs|savePrefs|chooseStyle|setStyle/, 'the picker script never touches the real settings');
  const fn = ui.slice(ui.indexOf('function draft()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /pick === 'glass'\) return \{ glass:/);
  assert.match(body, /return \{ blur: draftState\.blur, stageBgOn: draftState\.stageBgOn \}/);
  // app.js applies the options before the style, then saves everything once
  const choose = app.slice(app.indexOf('function chooseStyle('));
  const cbody = choose.slice(0, choose.indexOf('\n  }\n'));
  assert.ok(cbody.indexOf('applyStyleOptions(opts)') > -1 && cbody.indexOf('applyStyleOptions(opts)') < cbody.indexOf('setStyle(a.style)'));
  assert.match(cbody, /savePrefs\(\)/);
});

test('the live picture is this page in an iframe that nobody can reach, shown once it says it is ready', () => {
  assert.match(ui, /frame\.src = `index\.html\?preview=1&cfg=/);
  assert.match(ui, /setAttribute\('inert', ''\)/);
  assert.match(ui, /setAttribute\('aria-hidden', 'true'\)/);
  assert.match(ui, /d\.aulaPreview !== 'ready'/);
  assert.match(ui, /entry\.frame\.contentWindow !== e\.source/, 'only its own frame can say it is ready');
  assert.match(ui, /classList\.add\('live'\)/);
  // one extra copy at a time: choosing the other card drops this one
  assert.match(ui, /for \(const s of Array\.from\(frames\.keys\(\)\)\) if \(s !== style\) dropFrame\(s\)/);
  assert.match(css, /\.sp-shot\.live \.sp-live \{ opacity: 1; \}/);
  assert.match(css, /\.sp-live \{[^}]*width: 1200px;[^}]*height: 800px;[^}]*pointer-events: none/);
});

test('preview mode never reads or writes the real settings, and only obeys the page around it', () => {
  // boot.js: only inside another page, and the desktop bridge is switched off
  assert.match(boot, /window\.parent !== window && \/\[\?&\]preview=1\(&\|\$\)\/\.test\(location\.search\)/);
  assert.match(boot, /window\.aulaHost = undefined/);
  assert.match(boot, /classList\.add\('preview'\)/);
  // app.js: settings live in memory, seeded from the look it was given
  assert.match(app, /const PV = window\.AULA_PREVIEW \|\| null;/);
  assert.match(app, /if \(PV\) \{\s*const m = E\.memoryStorage\(\);/);
  assert.match(app, /e\.source !== window\.parent/, 'messages only from the page around it');
  assert.match(app, /d\.aulaPreview !== 'set'/);
  // it shows the colours of the page around it
  assert.match(theme, /window\.AULA_PREVIEW && CHOICES\.includes\(window\.AULA_PREVIEW\.theme\)/);
  // and it is only a picture: no start screens, buttons or pop-ups, and nothing answers the pointer
  assert.match(css, /html\.preview \.home,[\s\S]*?display: none !important/);
  assert.match(css, /html\.preview \*[^{]*\{ pointer-events: none !important/);
});
