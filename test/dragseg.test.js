'use strict';

/*
 * Hold and drag on the tab bar and the 1-5 selectors (v1.5.2). The module is plain DOM, so it is driven here with small
 * stand-ins for the elements and real pointer-event order: down, move, up. No browser needed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../src/js/dragseg.js');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

// ------------------------------------------------------------------ stand-ins

function button(i, left, width, attrs = {}) {
  const attr = { ...attrs };
  const cls = new Set();
  return {
    i,
    offsetLeft: left,
    offsetWidth: width,
    hidden: false,
    disabled: false,
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
      contains: (c) => cls.has(c),
    },
    getAttribute: (k) => (k in attr ? attr[k] : null),
    setAttribute: (k, v) => {
      attr[k] = v;
    },
    clicks: 0,
    click() {
      this.clicks++;
    },
  };
}

/** A row of `n` buttons, each `w` wide with `gap` between, inside a root that starts at x = 100 on screen. */
function rig(n, { w = 50, gap = 4, selected = 0 } = {}) {
  const buttons = Array.from({ length: n }, (_, i) => button(i, 4 + i * (w + gap), w, { 'aria-checked': i === selected ? 'true' : 'false' }));
  const handlers = {};
  const cls = new Set();
  const vars = {};
  const root = {
    offsetWidth: 8 + n * w + (n - 1) * gap,
    clientLeft: 0,
    getBoundingClientRect: () => ({ left: 100, width: root.offsetWidth }),
    style: { setProperty: (k, v) => (vars[k] = v) },
    classList: {
      add: (...c) => c.forEach((x) => cls.add(x)),
      remove: (...c) => c.forEach((x) => cls.delete(x)),
      contains: (c) => cls.has(c),
    },
    querySelectorAll: () => buttons,
    addEventListener: (type, fn) => (handlers[type] = fn),
    setPointerCapture() {
      root.captured = true;
    },
    releasePointerCapture() {
      root.captured = false;
    },
    captured: false,
  };
  const fire = (type, x, extra = {}) => handlers[type] && handlers[type]({ pointerId: 1, button: 0, isPrimary: true, clientX: x, detail: 1, ...extra, stopPropagation() {}, preventDefault() {} });
  // The centre of button i on screen.
  const cx = (i) => 100 + buttons[i].offsetLeft + w / 2;
  return { root, buttons, handlers, cls, vars, fire, cx };
}

// ------------------------------------------------------------------ geometry

test('position follows the pointer between item centres and stops at the ends', () => {
  const boxes = [0, 1, 2].map((i) => ({ left: 4 + i * 54, width: 50 }));
  assert.equal(D.position(boxes, -20), 0);
  assert.equal(D.position(boxes, 29), 0); // the first centre
  assert.equal(D.position(boxes, 56), 0.5); // halfway between centres 29 and 83
  assert.equal(D.position(boxes, 83), 1);
  assert.equal(D.position(boxes, 500), 2);
});

test('boxAt blends the left edge and width of the two items the highlight is between', () => {
  const boxes = [{ left: 4, width: 40 }, { left: 48, width: 60 }, { left: 112, width: 60 }];
  assert.deepEqual(D.boxAt(boxes, 0), { left: 4, width: 40 });
  assert.deepEqual(D.boxAt(boxes, 0.5), { left: 26, width: 50 });
  assert.deepEqual(D.boxAt(boxes, 2), { left: 112, width: 60 }); // the last item, not past it
});

// ------------------------------------------------------------------ behaviour

test('a press that barely moves is a click: nothing is captured and nothing is swallowed', () => {
  const r = rig(5);
  const picked = [];
  D.attach(r.root, { live: true, pick: (i) => picked.push(i) });
  r.fire('pointerdown', r.cx(0));
  r.fire('pointermove', r.cx(0) + D.THRESHOLD - 1);
  r.fire('pointerup', r.cx(0) + D.THRESHOLD - 1);
  assert.equal(r.root.captured, false);
  assert.equal(r.cls.has('is-dragging'), false);
  assert.deepEqual(picked, []);
});

test('live: the level changes each time the highlight crosses to a new item, and the highlight follows the pointer', () => {
  const r = rig(5, { selected: 0 });
  const picked = [];
  D.attach(r.root, {
    live: true,
    pick: (i) => {
      picked.push(i);
      r.buttons.forEach((b, k) => b.setAttribute('aria-checked', k === i ? 'true' : 'false')); // what the app's render does
    },
  });
  r.fire('pointerdown', r.cx(0));
  r.fire('pointermove', r.cx(0) + 10);
  assert.equal(r.root.captured, true, 'the pointer is captured once the drag starts');
  assert.ok(r.cls.has('is-dragging'));
  assert.deepEqual(picked, [], 'still nearest to item 0: no change yet');
  r.fire('pointermove', r.cx(1));
  r.fire('pointermove', r.cx(2));
  assert.deepEqual(picked, [1, 2], 'crossing 1 then landing on 2 changes the level at each step');
  r.fire('pointermove', r.cx(4));
  assert.deepEqual(picked, [1, 2, 4], 'a quick flick goes straight to where it lands');
  r.fire('pointermove', r.cx(2));
  assert.equal(Number(r.vars['--di']), 2);
  r.fire('pointermove', r.cx(2) - 27); // halfway back toward 1
  assert.equal(Number(r.vars['--di']), 1.5, 'the highlight sits between the two items');
  r.fire('pointerup', r.cx(2) - 27);
  assert.equal(r.cls.has('is-dragging'), false);
  assert.equal(r.root.captured, false);
  assert.ok(!r.buttons.some((b) => b.classList.contains('is-hot')), 'the hot marker is cleared');
});

test('not live: the highlight moves while dragging but the item is committed once, on release', () => {
  const r = rig(4, { selected: 0 });
  const picked = [];
  D.attach(r.root, { pick: (i) => picked.push(i) });
  r.fire('pointerdown', r.cx(0));
  r.fire('pointermove', r.cx(1));
  r.fire('pointermove', r.cx(3));
  assert.deepEqual(picked, [], 'nothing is committed while the button is down');
  assert.ok(r.buttons[3].classList.contains('is-hot'));
  r.fire('pointerup', r.cx(3));
  assert.deepEqual(picked, [3]);
});

test('not live: dropping it back on the selected item commits nothing', () => {
  const r = rig(4, { selected: 1 });
  const picked = [];
  let ended = 0;
  D.attach(r.root, { pick: (i) => picked.push(i), end: () => ended++ });
  r.fire('pointerdown', r.cx(1));
  r.fire('pointermove', r.cx(3));
  r.fire('pointermove', r.cx(1));
  r.fire('pointerup', r.cx(1));
  assert.deepEqual(picked, []);
  assert.equal(ended, 1, 'the caller is told so it can put its highlight back');
});

test('live: a cancelled drag puts the level back where it started', () => {
  const r = rig(5, { selected: 1 });
  const picked = [];
  D.attach(r.root, {
    live: true,
    pick: (i) => {
      picked.push(i);
      r.buttons.forEach((b, k) => b.setAttribute('aria-checked', k === i ? 'true' : 'false'));
    },
  });
  r.fire('pointerdown', r.cx(1));
  r.fire('pointermove', r.cx(4));
  r.fire('pointercancel', r.cx(4));
  assert.deepEqual(picked, [4, 1]);
});

test('the click that ends a drag is swallowed, a later keyboard click is not', () => {
  const r = rig(5);
  D.attach(r.root, { live: true, pick() {} });
  r.fire('pointerdown', r.cx(0));
  r.fire('pointermove', r.cx(3));
  r.fire('pointerup', r.cx(3));
  let stopped = 0;
  r.handlers.click({ detail: 1, stopPropagation: () => stopped++, preventDefault() {} });
  assert.equal(stopped, 1, 'the mouse click after a drag is stopped');
  stopped = 0;
  r.handlers.click({ detail: 1, stopPropagation: () => stopped++, preventDefault() {} });
  assert.equal(stopped, 0, 'only one click is swallowed');
});

test('only the primary button starts a drag, and a disabled control does not', () => {
  const r = rig(5);
  D.attach(r.root, { live: true, pick() {} });
  r.fire('pointerdown', r.cx(0), { button: 2 });
  r.fire('pointermove', r.cx(3));
  assert.equal(r.root.captured, false, 'right button: no drag');

  const d = rig(5);
  d.buttons.forEach((b) => (b.disabled = true));
  D.attach(d.root, { live: true, pick() {} });
  d.fire('pointerdown', d.cx(0));
  d.fire('pointermove', d.cx(3));
  assert.equal(d.root.captured, false, 'every item disabled (keyboard not ready): no drag');
});

test('hidden items are left out, so the highlight only travels over what is on screen', () => {
  const r = rig(5);
  const hidden = r.buttons[2];
  hidden.hidden = true;
  const picked = [];
  D.attach(r.root, { pick: (i, list) => picked.push(list[i].i) });
  r.fire('pointerdown', r.cx(0));
  r.fire('pointermove', r.cx(4));
  r.fire('pointerup', r.cx(4));
  assert.deepEqual(picked, [4], 'the index it commits points at the visible item');
});

// ------------------------------------------------------------------ wiring

test('dragseg.js is loaded before the scripts that use it', () => {
  const html = read('index.html');
  const d = html.indexOf('js/dragseg.js');
  assert.ok(d > 0, 'dragseg.js is in index.html');
  assert.ok(d < html.indexOf('js/max-ui.js'), 'before max-ui.js');
  assert.ok(d < html.indexOf('js/app.js'), 'before app.js');
});

test('app.js attaches it to the speed selector (live) and the tab bar (on release)', () => {
  const app = read('js/app.js');
  assert.match(app, /DS\.attach\(speed, \{ live: true, pick: \(v\) => session\.setSpeed\(v\) \}\)/);
  assert.match(app, /DS\.attach\(\$\('\.tabs'\), \{/);
  assert.match(app, /end: placeTabInd/, 'the tab highlight is put back on the selected tab after a drag');
});

test('the Max selectors attach it too', () => {
  assert.match(read('js/max-ui.js'), /AulaDragSeg\.attach\(box, \{ pick: \(v\) => onPick\(v\) \}\)/);
});

test('the stylesheet lets the highlight follow the pointer and keeps the reduced-motion block last', () => {
  const css = read('css/app.css');
  assert.match(css, /\.seg\.is-dragging::before \{[^}]*var\(--di, var\(--i\)\)[^}]*transition: none/);
  assert.match(css, /\.tabs\.is-dragging \.tab-ind \{ transition: none; \}/);
  assert.match(css, /\.seg, \.tabs \{ touch-action: none; \}/);
  assert.ok(css.indexOf('hold and drag (v1.5.2)') < css.indexOf('reduced motion: must stay last'), 'the drag rules come before the reduced-motion block');
});
