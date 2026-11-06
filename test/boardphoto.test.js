'use strict';

/*
 * The rendered keyboard pictures (boardphoto.js) and how preview.js uses them: nothing is used until every picture of a
 * skin has loaded, anything missing falls back to the drawing, and once they are there the case and the caps come from
 * the pictures.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BP = require('../src/js/boardphoto.js');
const A = require('../src/js/boardart.js');
const S = require('../src/js/skins.js');
const L = require('../src/js/layout.js');
const V = require('../src/js/preview.js');

/** A 2D context that accepts every call and records it. */
function fakeCtx(log = []) {
  return new Proxy(
    {},
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return () => ({ width: 10 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
        return (...a) => void log.push([k, ...a]);
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
}

const MAN = {
  scale: 128,
  mc: 0.25,
  dir: 'img/board/',
  face: { l: 0.057, t: 0.03, r: 0.057, b: 0.265 },
  skins: {
    f75: {
      base: { file: 'f75-base.webp', w: 2304, h: 1062, ox: 128, oy: 128 },
      caps: {
        '1|-': { file: 'cap-1.webp', w: 192, h: 192 },
        '1|gold': { file: 'cap-1-gold.webp', w: 192, h: 192 },
      },
    },
  },
};

/** An Image that loads when told to, so the tests decide the order the pictures arrive in. */
function fakeImages() {
  const made = [];
  globalThis.Image = class {
    constructor() {
      made.push(this);
    }
  };
  return made;
}

test.afterEach(() => {
  BP.setManifest(null);
  delete globalThis.Image;
  delete globalThis.document;
  L.use('f75');
});

test('without a manifest or a browser there is nothing to show, and nothing throws', () => {
  BP.setManifest(null);
  assert.equal(BP.skin('f75'), null);
  assert.doesNotThrow(() => BP.preload('f75'));
  assert.equal(typeof BP.version(), 'number');
});

test('a skin is only handed out once every one of its pictures has loaded', () => {
  const made = fakeImages();
  BP.setManifest(MAN);
  const seen = [];
  const off = BP.subscribe((f) => seen.push(f));
  assert.equal(BP.skin('f75'), null, 'nothing has loaded yet');
  assert.equal(made.length, 3, 'all three pictures were requested');
  assert.ok(made.every((m) => m.src.startsWith('img/board/')), 'from the folder the manifest names');
  made[0].onload();
  assert.equal(BP.skin('f75'), null, 'the case alone is not enough');
  made[1].onload();
  assert.equal(BP.skin('f75'), null, 'still waiting for a cap');
  made[2].onload();
  const sk = BP.skin('f75');
  assert.ok(sk, 'now it is complete');
  assert.equal(sk.base.w, 2304);
  assert.equal(seen.length, 3, 'a listener hears about every picture');
  off();
  assert.equal(BP.skin('nope'), null, 'a skin with no pictures gets none');
});

test('a cap falls back to the plain one when its accent has no picture, and to nothing for an unknown width', () => {
  const made = fakeImages();
  BP.setManifest(MAN);
  BP.skin('f75');
  made.forEach((m) => m.onload());
  const sk = BP.skin('f75');
  assert.equal(sk.cap(1, 'gold').file, 'cap-1-gold.webp');
  assert.equal(sk.cap(1, 'blue').file, 'cap-1.webp', 'no blue cap rendered: the plain one');
  assert.equal(sk.cap(1, '-').file, 'cap-1.webp');
  assert.equal(sk.cap(7, '-'), null);
});

test('a picture that fails to load leaves the drawing in charge', () => {
  const made = fakeImages();
  BP.setManifest(MAN);
  BP.skin('f75');
  made[0].onload();
  made[1].onerror();
  made[2].onload();
  assert.equal(BP.skin('f75'), null);
});

test('the photo layer is the picture plus the indicator lights, and nothing of the drawn case', () => {
  const log = [];
  const ctx = fakeCtx(log);
  const img = { tag: 'base' };
  const photo = { scale: 128, base: { img, w: 2304, h: 1062, ox: 128, oy: 128 } };
  L.use('f75');
  A.drawStatic(ctx, S.get('f75'), { u: 64, ox: 100, oy: 80, W: L.WIDTH, H: L.HEIGHT }, L.KEYS, { knob: true, photo });
  const di = log.filter((e) => e[0] === 'drawImage');
  assert.equal(di.length, 1);
  assert.equal(di[0][1], img);
  // 64 px per key from a 128 px per key picture: half size, and its key-block corner lands on (ox, oy)
  assert.equal(di[0][4], 2304 / 2);
  assert.equal(di[0][2], 100 - 64);
  assert.equal(di[0][3], 80 - 64);
  assert.equal(log.filter((e) => e[0] === 'arc').length, 1, 'only the Caps dot (an arc); no drawn knob or plate');
});

test('faceGeo puts the face where the manifest says', () => {
  const g = A.faceGeo({ l: 0.05, t: 0.03, r: 0.05, b: 0.26 }, 40, 36, 40);
  assert.equal(g.fx, 2);
  assert.ok(Math.abs(g.fw - 36) < 1e-9);
  assert.ok(g.fy > 0 && g.fy + g.fh < 36 - 0.26 * 40 + 1e-9);
});

test('preview uses the pictures for the case and the caps once they are loaded, and the drawing before that', () => {
  let canvases = 0;
  globalThis.document = {
    createElement() {
      canvases++;
      const ctx = fakeCtx();
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
  const made = fakeImages();
  const man = JSON.parse(JSON.stringify(MAN));
  // every width in the F75 layout, with and without accents, so the skin is complete
  L.use('f75');
  const skin = S.get('f75');
  man.skins.f75.caps = {};
  for (const k of L.KEYS) {
    const acc = S.accentOf(skin, k.n);
    man.skins.f75.caps[`${k.w}|${acc ? acc.name : '-'}`] = { file: `c-${k.w}-${acc ? acc.name : '-'}.webp`, w: 100 * k.w, h: 192 };
  }
  BP.setManifest(man);

  const drawn = [];
  const mainCtx = fakeCtx(drawn);
  const host = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 320 }) };
  const canvas = { getContext: () => mainCtx, parentElement: host, style: {}, addEventListener() {}, width: 0, height: 0 };
  const view = new V.KeyboardView(canvas, { animate: false });
  view.setState({ mode: 1, brightness: 4, speed: 2, colorIndex: 0, palette: [[255, 0, 0]], colors: null, selection: new Set(), legends: null, dim: false });
  view.draw();
  assert.equal(view._sl.photo, null, 'before the pictures arrive the drawn case is used');
  assert.ok(made.length > 0, 'and the pictures were asked for');
  made.forEach((m) => m.onload());
  view.draw();
  assert.ok(view._sl.photo, 'once they are in, the case comes from the picture');
  const sprite = [...view._caps.values()][0];
  assert.equal(sprite.photo, true, 'and so do the caps');
  assert.ok(sprite.m > 0);
  view.destroy();
  assert.ok(canvases > 1);
});

test('the rendered pictures that ship with the app match what the layouts need', () => {
  const dir = path.join(__dirname, '..', 'src', 'img', 'board');
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return; // the pictures are optional: the drawing is the fallback
  const man = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.ok(man.scale > 0 && man.mc > 0 && man.face);
  for (const m of L.MODELS) {
    const skin = S.get(m.skin || m.id);
    const e = man.skins[skin.id];
    if (!e) continue;
    assert.ok(fs.existsSync(path.join(dir, e.base.file)), `${skin.id}: the case picture exists`);
    for (const k of m.keys) {
      const acc = S.accentOf(skin, k.n);
      const c = e.caps[`${k.w}|${acc ? acc.name : '-'}`];
      assert.ok(c, `${skin.id}: a cap picture for ${k.n} (${k.w}u, ${acc ? acc.name : 'plain'})`);
      assert.ok(fs.existsSync(path.join(dir, c.file)), `${skin.id}: ${c.file} exists`);
    }
  }
  assert.ok(fs.existsSync(path.join(dir, 'manifest.js')), 'the script the page loads is there');
});
