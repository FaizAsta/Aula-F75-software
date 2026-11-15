'use strict';

/*
 * "Which UI do you want to use?": the question asked once, after Start, to everybody who has not answered yet (a first install,
 * or an update from a build that had no such question). The answer is applied, saved with styleAsked: true, and Start goes
 * straight to the devices from then on.
 *
 * The rules are pure (src/js/stylepick.js) and tested here directly. The screen itself is wired in index.html, home.js, app.js
 * and the style sheets; those are checked in the source, in the same way as the other screens' tests, because the page needs a
 * browser to run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SP = require('../src/js/stylepick.js');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const html = read('src', 'index.html');
const home = read('src', 'js', 'home.js');
const app = read('src', 'js', 'app.js');
const homeCss = read('src', 'css', 'home.css');
const glassJs = read('src', 'js', 'glass.js');
const glassCss = read('src', 'css', 'glass.css');

// ------------------------------------------------------------------------------------------------ the rules

test('everybody who has not answered is asked: a first install, and an update from a build without the question', () => {
  assert.equal(SP.owed(undefined), true, 'no saved settings at all: a first install');
  assert.equal(SP.owed({}), true);
  assert.equal(SP.owed({ style: 'classic', theme: 'dark' }), true, 'saved settings from an older version have no answer');
  assert.equal(SP.owed({ style: 'glass' }), true, 'even somebody who already switched Liquid glass on in Settings is asked once');
  assert.equal(SP.owed({ styleAsked: false }), true);
  assert.equal(SP.owed({ styleAsked: 'true' }), true, 'only a real true counts as an answer');
});

test('once answered, it is never asked again', () => {
  assert.equal(SP.owed({ styleAsked: true }), false);
  assert.equal(SP.owed({ style: 'glass', styleAsked: true }), false);
  const saved = { ...{ style: 'classic' }, ...SP.answer('classic') };
  assert.equal(SP.owed(saved), false);
});

test('the question opens on the style already in use, otherwise on Classic', () => {
  assert.equal(SP.initial(undefined), 'classic');
  assert.equal(SP.initial({}), 'classic');
  assert.equal(SP.initial({ style: 'classic' }), 'classic');
  assert.equal(SP.initial({ style: 'glass' }), 'glass', 'an updating Liquid glass user keeps it highlighted');
  assert.equal(SP.initial({ style: 'nonsense' }), 'classic');
});

test('an answer is a known style plus the "asked" mark; anything else counts as Classic', () => {
  assert.deepEqual(SP.answer('glass'), { style: 'glass', styleAsked: true });
  assert.deepEqual(SP.answer('classic'), { style: 'classic', styleAsked: true });
  assert.deepEqual(SP.answer('rainbow'), { style: 'classic', styleAsked: true });
  assert.deepEqual(SP.answer(undefined), { style: 'classic', styleAsked: true });
});

test('the arrow keys move between the two choices and wrap round', () => {
  assert.equal(SP.step('classic', 1), 'glass');
  assert.equal(SP.step('glass', 1), 'classic');
  assert.equal(SP.step('classic', -1), 'glass');
  assert.equal(SP.step('glass', -1), 'classic');
  assert.equal(SP.step('unknown', 1), 'glass');
  assert.deepEqual(SP.STYLES, ['classic', 'glass'], 'the same two values Settings > Theme > UI uses');
});

// ------------------------------------------------------------------------------------------------ the page

test('the page has the question, with one card for each UI, as a radio group', () => {
  assert.match(html, /Which UI do you want to use\?/);
  assert.match(html, /class="scr scr-style"/);
  const group = html.match(/<div class="sp-cards"[^>]*>/)[0];
  assert.match(group, /role="radiogroup"/);
  for (const v of ['classic', 'glass']) assert.ok(html.includes(`data-style-choice="${v}"`), `a card for ${v}`);
  assert.equal((html.match(/class="sp-card"[^>]*role="radio"/g) || []).length, 2);
  assert.match(html, /data-style-choice="classic"/);
  assert.match(html, /id="spGo"/, 'a Continue button');
  assert.match(html, /Experimental/, 'Liquid glass is labelled experimental, as it is in Settings');
});

test('the question sits between the start screen and the device list', () => {
  const start = html.indexOf('class="scr scr-start"');
  const style = html.indexOf('class="scr scr-style"');
  const devices = html.indexOf('class="scr scr-devices"');
  assert.ok(start > 0 && style > start && devices > style);
});

test('both card pictures exist, are real images, and ship inside the app', () => {
  for (const f of ['classic', 'glass']) {
    const file = path.join(root, 'src', 'img', 'ui', `${f}.webp`);
    assert.ok(fs.existsSync(file), `src/img/ui/${f}.webp is missing (npm run screenshots -- ui-previews)`);
    const b = fs.readFileSync(file);
    assert.equal(b.subarray(0, 4).toString('latin1'), 'RIFF');
    assert.equal(b.subarray(8, 12).toString('latin1'), 'WEBP');
    assert.ok(b.length > 5000 && b.length < 400 * 1024, `${f}.webp is ${b.length} bytes`);
    assert.ok(html.includes(`src="img/ui/${f}.webp"`), `index.html shows ${f}.webp`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('src/**/*'), 'src/img/ui is packed with the app');
});

test('stylepick.js is loaded before app.js and home.js, and the style sheet before lite.css and glass.css', () => {
  const script = (f) => html.indexOf(`<script src="js/${f}"></script>`);
  const sheet = (f) => html.indexOf(`<link rel="stylesheet" href="css/${f}">`);
  assert.ok(script('stylepick.js') > 0);
  assert.ok(script('stylepick.js') < script('app.js'));
  assert.ok(script('app.js') < script('home.js'));
  assert.ok(sheet('stylepick.css') > 0);
  assert.ok(sheet('stylepick.css') < sheet('lite.css'), 'lite.css must still come after');
  assert.ok(sheet('stylepick.css') < sheet('glass.css'), 'glass.css must still be last');
  assert.ok(sheet('glass.css') > sheet('lite.css'));
});

// ------------------------------------------------------------------------------------------------ the flow

test('Start opens the question when it is owed, and the devices when it is not', () => {
  assert.match(home, /go\(A\.styleOwed && A\.styleOwed\(\) \? 'style' : 'devices'\)/);
  assert.match(home, /if \(name === 'style'\) openStyle\(\)/);
});

test('Continue applies and saves the answer first, then goes to the devices', () => {
  const fn = home.slice(home.indexOf('function confirmStyle()'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /A\.chooseStyle\(spPick\)/);
  assert.ok(body.indexOf('A.chooseStyle') < body.indexOf("go('devices')"));
  assert.match(body, /spDone/, 'a double click cannot answer twice');
  assert.match(home, /getElementById\('spGo'\)|\$\('#spGo'\)\.addEventListener\('click', confirmStyle\)/);
});

test('picking a card changes nothing until Continue', () => {
  const click = home.match(/c\.addEventListener\('click', \(\) => \{?[^\n]*\n?/)[0];
  assert.match(click, /markStyle\(/);
  assert.doesNotMatch(click, /chooseStyle|setStyle/);
  const mark = home.slice(home.indexOf('function markStyle'), home.indexOf('function openStyle'));
  assert.doesNotMatch(mark, /chooseStyle|setStyle|savePrefs/);
});

test('Escape goes back to Start and is not an answer; the arrows and Enter work from the question only', () => {
  const k = home.slice(home.indexOf("screen === 'style' && !document.querySelector"));
  assert.match(k, /e\.key === 'Escape'\)\s*\{\s*go\('home'\)/);
  assert.match(k, /markStyle\(SP\.step\(spPick/);
  assert.match(k, /e\.key === 'Enter'/);
  assert.match(k, /closest\('\.scr-style'\)/, 'Enter on Back, Support or Update does not answer');
  assert.match(k, /\.upd:not\(\[hidden\]\)/, 'nothing happens behind an open dialog');
});

test('app.js keeps the answer in the saved settings and exposes the three calls home.js needs', () => {
  assert.match(app, /prefs\.styleAsked = prefs\.styleAsked === true/);
  assert.match(app, /const styleOwed = \(\) => !!\(G && SP && SP\.owed\(prefs\)\)/, 'no question when there is no glass.js to choose with');
  const fn = app.slice(app.indexOf('function chooseStyle'), app.indexOf('function renderTheme'));
  assert.match(fn, /SP\.answer\(/);
  assert.match(fn, /setStyle\(a\.style\)/);
  assert.match(fn, /prefs\.styleAsked = a\.styleAsked/);
  assert.match(fn, /savePrefs\(\)/);
  assert.match(app, /window\.aulaApp = \{[^}]*styleOwed, styleStart, chooseStyle/);
});

// ------------------------------------------------------------------------------------------------ the look

test('the style sheets know the new screen and keep the Back button on it', () => {
  assert.match(homeCss, /\.home:not\(\[data-screen="style"\]\) \.scr-style/);
  assert.match(homeCss, /\.home:not\(\[data-screen="devices"\]\):not\(\[data-screen="style"\]\) \.hm-back/, 'Back is shown on the question too');
  assert.match(homeCss, /\.home:not\(\[data-screen="style"\]\) \.scr-style \*/, 'its animations pause while it is not on screen');
});

test('Liquid glass paints the two cards, and a press ripples on them', () => {
  assert.match(glassJs, /TARGETS = \[[\s\S]*?\.sp-card/);
  assert.match(glassCss, /html\.glass \.sp-card\.ag/);
  assert.match(read('src', 'js', 'motion.js'), /const RIPPLE = '[^']*\.sp-card/);
});

test('the selected card is marked by more than colour (a tick), and the cards are keyboard focusable', () => {
  const css = read('src', 'css', 'stylepick.css');
  assert.match(css, /\.sp-card\[aria-checked="true"\] \.sp-tick \{ opacity: 1/);
  assert.match(css, /\.sp-card:focus-visible/);
  assert.match(html, /aria-checked="true" tabindex="0" data-style-choice="classic"/);
  assert.match(html, /aria-checked="false" tabindex="-1" data-style-choice="glass"/, 'one tab stop for the group');
});

// ------------------------------------------------------------------------------------------------ the screenshot tools

test('the screenshot tools skip the question by default and have scenes for it', () => {
  for (const f of ['screenshots.js', '_harness.js']) {
    const src = read('scripts', f);
    assert.match(src, /styleAsked: true, \.\.\.extra/, `${f}: Start goes straight to the devices unless a scene asks for the question`);
  }
  const shots = read('scripts', 'screenshots.js');
  assert.match(shots, /'style-picker'\(\)/);
  assert.match(shots, /styleAsked: false/);
  assert.match(shots, /snap\(page, 'style-picker'\)/);
  assert.match(shots, /'ui-previews'\(\)/);
  assert.match(shots, /src', 'img', 'ui'/);
});
