'use strict';

/*
 * The smaller copies of the keyboard pictures (scripts/render-board/mips.py). A key is 30 to 60 pixels wide on a normal
 * screen and the big picture has 192 per key, so the app picks the copy that fits instead of squeezing the big one down
 * in one rough step. These tests check that the copies exist and agree with the manifest, and that boardphoto.js picks
 * the right one and never leaves a board half one size, half another.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BP = require('../src/js/boardphoto.js');

const dir = path.join(__dirname, '..', 'src', 'img', 'board');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

test.afterEach(() => {
  BP.setManifest(null);
  delete globalThis.Image;
});

test('the manifest lists smaller copies, and every file it names is there', () => {
  assert.ok(man.mips && Object.keys(man.mips).length >= 4, 'several smaller sizes');
  for (const [level, skins] of Object.entries(man.mips)) {
    assert.ok(Number(level) < man.scale, `${level} is smaller than the full size`);
    for (const id of Object.keys(man.skins)) {
      const m = skins[id];
      assert.ok(m && m.base, `${id} has a case picture at ${level}`);
      assert.ok(fs.existsSync(path.join(dir, m.base.file)), m.base.file);
      assert.deepEqual(Object.keys(m.caps).sort(), Object.keys(man.skins[id].caps).sort(), `${id} at ${level} has every cap the full size has`);
      for (const c of Object.values(m.caps)) assert.ok(fs.existsSync(path.join(dir, c.file)), c.file);
    }
  }
});

test('each copy is the full-size picture scaled by its level, and the key block stays where it was', () => {
  const k = (level) => Number(level) / man.scale;
  for (const [level, skins] of Object.entries(man.mips)) {
    for (const [id, m] of Object.entries(skins)) {
      const top = man.skins[id];
      assert.ok(Math.abs(m.base.w - top.base.w * k(level)) <= 1, `${id} case width at ${level}`);
      assert.ok(Math.abs(m.base.h - top.base.h * k(level)) <= 1, `${id} case height at ${level}`);
      assert.ok(Math.abs(m.base.ox - top.base.ox * k(level)) < 0.01, `${id} case x offset at ${level}`);
      assert.ok(Math.abs(m.base.oy - top.base.oy * k(level)) < 0.01, `${id} case y offset at ${level}`);
      for (const [key, c] of Object.entries(m.caps)) {
        assert.ok(Math.abs(c.w - top.caps[key].w * k(level)) <= 1, `${id} cap ${key} width at ${level}`);
        assert.ok(Math.abs(c.h - top.caps[key].h * k(level)) <= 1, `${id} cap ${key} height at ${level}`);
      }
    }
  }
});

/** An Image that loads when told to. */
function fakeImages() {
  const made = [];
  globalThis.Image = class {
    constructor() {
      made.push(this);
    }
  };
  return made;
}

const SMALL = {
  scale: 192,
  mc: 0.25,
  dir: 'img/board/',
  mips: {
    96: { f75: { base: { file: 'b@96.webp', w: 1728, h: 800, ox: 96, oy: 96 }, caps: { '1|-': { file: 'c@96.webp', w: 144, h: 144 } } } },
    48: { f75: { base: { file: 'b@48.webp', w: 864, h: 400, ox: 48, oy: 48 }, caps: { '1|-': { file: 'c@48.webp', w: 72, h: 72 } } } },
  },
  skins: { f75: { base: { file: 'b.webp', w: 3456, h: 1600, ox: 192, oy: 192 }, caps: { '1|-': { file: 'c.webp', w: 288, h: 288 } } } },
};

const loadAll = (made, only) => made.filter((m) => !only || only(m)).forEach((m) => m.onload());

test('the copy that is at least as big as the key will be on screen is the one used', () => {
  const made = fakeImages();
  BP.setManifest(SMALL);
  BP.skin('f75', 40);
  assert.deepEqual(made.map((m) => m.src.split('/').pop()).sort(), ['b@48.webp', 'c@48.webp'].sort(), 'only the copy that fits is asked for');
  loadAll(made);
  const sk = BP.skin('f75', 40);
  assert.equal(sk.scale, 48);
  assert.equal(sk.base.w, 864);
  // a little bigger than 48 needs the next copy up (never a stretched one), and bigger than every copy needs the full size
  let n = made.length;
  BP.skin('f75', 49);
  assert.deepEqual(made.slice(n).map((m) => m.src.split('/').pop()).sort(), ['b@96.webp', 'c@96.webp']);
  loadAll(made.slice(n));
  assert.equal(BP.skin('f75', 49).scale, 96);
  n = made.length;
  BP.skin('f75', 5000);
  assert.deepEqual(made.slice(n).map((m) => m.src.split('/').pop()).sort(), ['b.webp', 'c.webp']);
  loadAll(made.slice(n));
  assert.equal(BP.skin('f75', 5000).scale, 192);
});

test('without a size, or without smaller copies, it is the full-size picture as before', () => {
  const made = fakeImages();
  BP.setManifest(SMALL);
  BP.skin('f75');
  assert.deepEqual(made.map((m) => m.src.split('/').pop()).sort(), ['b.webp', 'c.webp']);
  loadAll(made);
  assert.equal(BP.skin('f75').scale, 192);
  BP.setManifest({ ...SMALL, mips: undefined });
  const again = fakeImages();
  BP.skin('f75', 40);
  loadAll(again);
  assert.equal(BP.skin('f75', 40).scale, 192);
});

test('while the copy that fits is loading, one that is already here stands in, and the board is never mixed', () => {
  const made = fakeImages();
  BP.setManifest(SMALL);
  BP.skin('f75'); // the full size loads first (as the first frame asked for it)
  loadAll(made);
  const more = made.length;
  const sk = BP.skin('f75', 40); // wants 48, which has not loaded
  assert.equal(sk.scale, 192, 'the full size stands in');
  assert.equal(made.length - more, 2, 'the better copy was requested');
  made[more].onload(); // only its case picture arrives
  assert.equal(BP.skin('f75', 40).scale, 192, 'half of a copy is not used');
  made[more + 1].onload();
  assert.equal(BP.skin('f75', 40).scale, 48, 'now the whole copy is here');
});
