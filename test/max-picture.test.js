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
    const acc = SK.accentOf(skin, k.name);
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

test('the keys of the Max screen are put on the picture (max-ui.js, max.css)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'max.css'), 'utf8');
  assert.match(js, /AulaBoardManifest/);
  assert.match(js, /mx-photo/);
  assert.match(css, /\.mx-board\.mx-photo\s*\{/);
  assert.match(css, /\.mx-photo \.mx-key::before/);
});

test('the Max uses the F75 screen: its picture sits in the stage at the top, with the same chips and Live / Picture switch', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'max-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'max.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'app.js'), 'utf8');
  // the board is put in the stage next to the F75 canvas, and the stage is no longer hidden while a Max is connected
  assert.match(js, /stage-max/);
  assert.match(js, /canvasWrap\.after\(refs\.stageBox\)/);
  assert.match(css, /\.shell\[data-family="max"\] \.stage-max\s*\{/);
  assert.doesNotMatch(css, /\.shell\[data-family="max"\] \.stage,/);
  // the chips and the Live / Picture switch are the F75's own, filled from what the app knows about the Max
  for (const id of ['#sbModel', '#sbLink', '#sbFx', '#sbColor', '#sbSpeed', '#sbBright', '#stageView']) assert.ok(js.includes(id), id);
  assert.match(app, /getView:\s*\(\)\s*=>\s*prefs\.view/);
  // painting happens on that picture, and the picture only takes the pointer on the Per-key page
  assert.match(js, /tab === 'perkey' && b/);
  assert.match(css, /\.stage-max:not\(\[data-paint="1"\]\) \.mx-key\s*\{\s*pointer-events:\s*none/);
});
