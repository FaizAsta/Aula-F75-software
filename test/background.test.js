'use strict';

/*
 * Custom background (Settings > Theme): a picture the person picks, shown behind the app at 50% opacity.
 * The picture is shrunk before it is kept, only pictures this module made are ever painted, and the layer's opacity in
 * the CSS is the one the module says.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BG = require('../src/js/background.js');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

test('the background starts at 50% opacity, and the CSS and the module agree on it', () => {
  assert.equal(BG.OPACITY, 0.5);
  const css = read('css', 'app.css');
  const m = css.match(/(?:^|\n)\.app-bg\s*\{([^}]*)\}/);
  assert.ok(m, '.app-bg has a rule');
  assert.match(m[1], /opacity:\s*var\(--bg-opacity,\s*0?\.5\)\s*;/, '.app-bg uses --bg-opacity, falling back to 0.5');
  assert.match(m[1], /z-index:\s*-1\s*;/, 'it sits behind the content');
  assert.match(m[1], /pointer-events:\s*none/, 'it never takes a click');
});

test('clampOpacity() keeps a saved opacity between 10% and 100% in steps of 5%, and falls back to 50%', () => {
  assert.equal(BG.MIN_OPACITY, 0.1);
  assert.equal(BG.MAX_OPACITY, 1);
  assert.equal(BG.clampOpacity(0.75), 0.75);
  assert.equal(BG.clampOpacity('0.35'), 0.35);
  assert.equal(BG.clampOpacity(0.73), 0.75, 'rounds to the nearest 5%');
  assert.equal(BG.clampOpacity(0), 0.1, 'never fully invisible');
  assert.equal(BG.clampOpacity(-3), 0.1);
  assert.equal(BG.clampOpacity(7), 1);
  for (const bad of [undefined, null, '', '  ', 'abc', NaN, Infinity, {}, []]) assert.equal(BG.clampOpacity(bad), 0.5, `${String(bad)} gives 50%`);
});

test('the Theme page has an opacity slider that matches the module, and app.js saves it under its own key', () => {
  const html = read('index.html');
  const theme = html.indexOf('id="setpage-theme"');
  const debug = html.indexOf('id="setpage-debug"');
  const i = html.indexOf('id="bgOpacity"');
  assert.ok(i > theme && i < debug, 'the slider is on the Theme page');
  const tag = html.slice(html.lastIndexOf('<input', i), html.indexOf('>', i) + 1);
  assert.match(tag, /type="range"/);
  assert.match(tag, /min="10"/);
  assert.match(tag, /max="100"/);
  assert.match(tag, /step="5"/);
  assert.match(tag, /value="50"/);
  assert.match(tag, /\bdisabled\b/, 'off until a picture is set');
  assert.ok(html.indexOf('id="bgOpacityVal"') > i, 'the value is shown next to it');
  const app = read('js', 'app.js');
  assert.match(app, /BG_OPACITY_KEY = 'aula\.bgOpacity'/);
  assert.match(app, /\$\('#bgOpacity'\)\.addEventListener\('input'/, 'the picture follows the thumb');
  assert.match(app, /\$\('#bgOpacity'\)\.addEventListener\('change'/, 'saved when the thumb is let go');
  assert.match(app, /\$\('#bgOpacity'\)\.disabled = !on/);
});

test('fit() shrinks a big picture so its longest side is the limit, keeps the shape, and never enlarges', () => {
  assert.deepEqual(BG.fit(4000, 2000, 1920), { w: 1920, h: 960 });
  assert.deepEqual(BG.fit(2000, 4000, 1920), { w: 960, h: 1920 });
  assert.deepEqual(BG.fit(800, 600, 1920), { w: 800, h: 600 });
  assert.deepEqual(BG.fit(1, 5000, 1920), { w: 1, h: 1920 }, 'a thin picture keeps at least one pixel');
  assert.equal(BG.fit(0, 100), null);
  assert.equal(BG.fit(100, NaN), null);
});

test('only pictures saved by this module are painted', () => {
  const ok = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  assert.ok(BG.isDataImage(ok));
  assert.ok(BG.isDataImage('data:image/jpeg;base64,/9j/4AAQSkZJRg=='));
  for (const bad of [null, undefined, 42, '', 'https://example.com/a.png', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,abc") ; background: url(x', 'url(x)']) {
    assert.equal(BG.isDataImage(bad), false, `${String(bad).slice(0, 30)} is refused`);
    assert.equal(BG.cssUrl(bad), '', 'and nothing is painted for it');
  }
  assert.equal(BG.cssUrl(ok), `url("${ok}")`);
});

test('the Theme page has the picker, and background.js loads before app.js', () => {
  const html = read('index.html');
  const theme = html.indexOf('id="setpage-theme"');
  const debug = html.indexOf('id="setpage-debug"');
  for (const id of ['bgPick', 'bgClear', 'bgFile', 'bgThumb']) {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i > theme && i < debug, `${id} is on the Theme page`);
  }
  assert.match(html, /<input type="file" id="bgFile" accept="image\/png,image\/jpeg,image\/webp" hidden>/);
  const shell = html.indexOf('<div class="shell"');
  const layer = html.indexOf('id="appBg"');
  assert.ok(layer > shell && layer < html.indexOf('<header class="top">'), 'the layer is the first thing inside the shell');
  assert.ok(html.indexOf('js/background.js') > 0 && html.indexOf('js/background.js') < html.indexOf('js/app.js'), 'loaded before app.js');
});

test('preset names: only plain picture files, no repeats, sorted A to Z with numbers as numbers', () => {
  assert.deepEqual(
    BG.presetNames(['b 10.png', 'b 2.png', '.hidden.png', 'a.PNG', 'a.PNG', 'notes.txt', 'logo.svg', '../x.png', 'd/e.png', 'd\\e.png', 'README.txt', 'z.webp', 'y.jpeg', 42, null]),
    ['a.PNG', 'b 2.png', 'b 10.png', 'y.jpeg', 'z.webp']
  );
  assert.deepEqual(BG.presetNames(undefined), []);
  assert.deepEqual(BG.presetNames('a.png'), []);
  for (const bad of ['', '.png', 'a.gif', 'a.png.exe', 'a/b.png', 'a\\b.png', 'a:b.png', 'a\"b.png', 'x'.repeat(130) + '.png']) assert.equal(BG.isPresetName(bad), false, `${bad.slice(0, 20)} is refused`);
});

test('a preset is painted from its own folder, with the name encoded, and a bad name paints nothing', () => {
  assert.equal(BG.PRESET_DIR, 'img/backgrounds');
  assert.equal(BG.presetUrl('dark forest.webp'), 'img/backgrounds/dark%20forest.webp');
  assert.equal(BG.presetCss('a.png'), 'url("img/backgrounds/a.png")');
  for (const bad of ['../secret.png', 'https://x.test/a.png', 'a.png") ; background: url(x', null]) {
    assert.equal(BG.presetUrl(bad), '');
    assert.equal(BG.presetCss(bad), '');
  }
  assert.equal(BG.presetLabel('dark-forest_01.webp'), 'Dark forest 01');
  assert.equal(BG.presetLabel('.png'), 'Picture');
});

test('the presets folder exists, is packed into the build, and has no default picture', () => {
  const dir = path.join(__dirname, '..', 'src', 'img', 'backgrounds');
  assert.ok(fs.statSync(dir).isDirectory(), 'src/img/backgrounds exists');
  assert.ok(fs.existsSync(path.join(dir, 'README.txt')), 'the folder is kept in git and in the zip by its README');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/**/*'), 'electron-builder packs everything under src, so dropped-in pictures ship');
  // nothing is chosen on a fresh install: no default is written anywhere
  assert.doesNotMatch(read('js', 'app.js'), /setItem\(BG_PRESET_KEY, ?['"`]/, 'no preset is stored by default');
  assert.match(read('js', 'app.js'), /let bgPresets = \[\]/);
});

test('main.js lists the folder, the page can ask for it, and the Theme page has the preset grid', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('host:list-backgrounds'/);
  assert.match(main, /bgLib\.presetNames\(fs\.readdirSync\(path\.join\(__dirname, 'src', 'img', 'backgrounds'\)\)\)/);
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(pre, /listBackgrounds: \(\) => ipcRenderer\.invoke\('host:list-backgrounds'\)/);
  const html = read('index.html');
  const theme = html.indexOf('id="setpage-theme"');
  const debug = html.indexOf('id="setpage-debug"');
  for (const id of ['bgPresetSet', 'bgPresets']) {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i > theme && i < debug, `${id} is on the Theme page`);
  }
  assert.match(html, /<section class="set" id="bgPresetSet" hidden>/, 'hidden until the folder has pictures');
});

test('the README version badge shows the version in package.json', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const badge = fs.readFileSync(path.join(root, 'README.md'), 'utf8').match(/badge\/version-(\d+\.\d+\.\d+)-blue/);
  assert.ok(badge, 'the README has a version badge');
  assert.equal(badge[1], pkg.version);
});

test('every picture shipped in the presets folder is a name the app accepts', () => {
  const dir = path.join(__dirname, '..', 'src', 'img', 'backgrounds');
  const pics = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  assert.deepEqual(BG.presetNames(pics), [...pics].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })));
  for (const f of pics) assert.ok(fs.statSync(path.join(dir, f)).size <= 10 * 1024 * 1024, `${f} is under 10 MB (about 3 MB is plenty; the app keeps 1920 px)`);
});
