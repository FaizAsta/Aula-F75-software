'use strict';
// The F75 Max has a rendered picture like the other models (src/img/board, made by scripts/render-board/render.py).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MX = require('../src/js/max.js');
const SK = require('../src/js/skins.js');
const dir = path.join(__dirname, '..', 'src', 'img', 'board');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test('the manifest has a picture of the Max case and a cap for every key of its layout', () => {
  const e = man.skins.max;
  assert.ok(e && e.base, 'max skin and base');
  assert.ok(fs.existsSync(path.join(dir, e.base.file)), 'base file exists');
  const skin = SK.get('max');
  for (const k of MX.keyLayout()) {
    const acc = SK.accentOf(skin, k.legend); // by the label the F75 window prints on the key
    const cap = e.caps[`${k.w}|${acc ? acc.name : '-'}`];
    assert.ok(cap, `a cap for ${k.name} (${k.w}u, ${acc ? acc.name : 'plain'})`);
    assert.ok(fs.existsSync(path.join(dir, cap.file)), `${cap.file} exists`);
  }
});

test('the Max picture uses the same scale as the other models, so one manifest serves them all', () => {
  const e = man.skins.max.base;
  assert.equal(e.w, Math.round((16 + 2) * man.scale), 'the picture is the 16 key block plus a unit of case each side');
  assert.equal(e.ox, man.scale);
  assert.equal(e.oy, man.scale);
});

test('the Max is drawn by the F75 window\'s own keyboard picture: it registers its layout and says what each key shows, and no board of its own is built', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'max.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(js, /L\.define\(LAYOUT_ID, \{ name: FAM\.name, skin: FAM\.skin/, 'its keys go to layout.js under the F75\'s labels');
  assert.match(js, /ctx\.canvasView/, 'the picture is the app\'s canvas');
  assert.doesNotMatch(js, /mx-key|mx-board|stage-max|stageMax|makeBoard/, 'no second board');
  assert.doesNotMatch(css, /\.mx-board|\.mx-key|\.stage-max/, 'no styles for one');
  assert.ok(!html.includes('max-motion.js'), 'and no second copy of the pointer motion');
  assert.match(app, /stage: \(id\) => useLayout\(id\)/, 'the app switches the picture to the keyboard\'s layout and back');
  assert.match(app, /canvasView: \(\) => view/);
  assert.match(app, /onPick: \(k, e, phase\) => \(MXU && MXU\.active\(\) \? MXU\.pick\(k, e, phase\) : handlePick\(k, e, phase\)\)/, 'the picture\'s pointer paints the Max\'s keys');
  assert.match(app, /enabled: \(\) => \(MXU && MXU\.active\(\) \? MXU\.picking\(\)/);
});

test('the Max shows the F75 screen\'s chips and Live / Picture switch over that picture', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
  for (const id of ['#sbModel', '#sbLink', '#sbFx', '#sbColor', '#sbSpeed', '#sbBright', '#stageView']) assert.ok(js.includes(id), id);
  assert.match(app, /getView:\s*\(\)\s*=>\s*prefs\.view/);
  assert.match(app, /pictureOnly: \(\) => pictureOnly\(\)/, 'Picture is decided in one place, the app\'s, for every keyboard');
  assert.match(js, /view\.opts\.flat = tab === 'perkey'/, 'the Per-key page draws the board flat, as it is painted');
  assert.match(js, /selection: perkey \? sel : NO_KEYS/, 'picked keys are outlined by the preview, as on the F75');
});
