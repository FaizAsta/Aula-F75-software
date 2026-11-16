// Hold and drag for the pill controls (v1.5.2): the top tab bar and the 1-5 level selectors (Speed).
//
// Press anywhere on the control, keep the button down and move sideways: the highlight follows the pointer and, when the
// button is let go, settles on the nearest item. A press that barely moves is left alone, so clicking an item, the
// keyboard arrows and screen readers all work exactly as before.
//
//   AulaDragSeg.attach(root, {
//     items()    -> the buttons, left to right (default: the visible .seg-btn / .tab-btn inside root)
//     getIndex() -> the index that is committed now, -1 for none (default: the item with aria-checked / aria-selected)
//     paint(f, box, items)  puts the highlight at fractional index f; box is { left, width } in the root's own pixels
//                           (default: sets --di on root, which .seg::before reads while root has .is-dragging)
//     pick(i, items)        commits item i (default: items[i].click())
//     live       true: commit every time the highlight crosses to a new item (cheap, in-memory edits only);
//                false (default): commit once, when the button is let go
//     end()      called after a drag so the caller can put its highlight back on the committed item
//   })
//
// Everything is plain DOM and pointer events; nothing here knows about the keyboard.
(() => {
  'use strict';

  const THRESHOLD = 4; // px the pointer must travel before a press counts as a drag; less than that is a normal click
  const GRAB_MS = 140; // how long the highlight glides to the pointer when a drag starts, instead of jumping

  const usable = (b) => !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  const shown = (b) => !b.hidden && b.offsetWidth > 0;

  /** Fractional index for a pointer at x (root pixels): the highlight's centre follows the pointer, clamped to the ends. */
  function position(boxes, x) {
    const c = boxes.map((b) => b.left + b.width / 2);
    const last = c.length - 1;
    if (!(x > c[0])) return 0;
    if (x >= c[last]) return last;
    let i = 0;
    while (i < last - 1 && x >= c[i + 1]) i++;
    return i + (x - c[i]) / (c[i + 1] - c[i]);
  }

  /** Where the highlight sits at fractional index f: its left edge and width, blended between the two items it is over. */
  function boxAt(boxes, f) {
    const i = Math.max(0, Math.min(boxes.length - 2, Math.floor(f)));
    const t = f - i;
    const a = boxes[i];
    const b = boxes[i + 1];
    return { left: a.left + (b.left - a.left) * t, width: a.width + (b.width - a.width) * t };
  }

  function attach(root, o = {}) {
    if (!root || !root.addEventListener) return null;
    const items = o.items || (() => Array.from(root.querySelectorAll('.seg-btn, .tab-btn')).filter(shown));
    const getIndex =
      o.getIndex ||
      (() => items().findIndex((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true'));
    const paint = o.paint || ((f) => root.style.setProperty('--di', String(f)));
    const pick = o.pick || ((i, list) => list[i].click());
    const live = !!o.live;

    let st = null; // the press in progress: { id, x0, drag, start, last, grab }
    let swallow = false; // the click that ends a drag must not also press a button

    function geometry() {
      const list = items();
      return { list, boxes: list.map((b) => ({ left: b.offsetLeft, width: b.offsetWidth })) };
    }

    function begin(e) {
      st.drag = true;
      try {
        root.setPointerCapture(e.pointerId);
      } catch (_) {
        /* a pointer that is already gone: the drag simply follows move events on the root */
      }
      root.classList.add('is-dragging', 'is-grab');
      clearTimeout(st.grab);
      st.grab = setTimeout(() => root.classList.remove('is-grab'), GRAB_MS);
      swallow = true;
    }

    function move(e) {
      const rect = root.getBoundingClientRect();
      const scale = root.offsetWidth ? rect.width / root.offsetWidth : 1;
      const x = (e.clientX - rect.left) / (scale || 1) - (root.clientLeft || 0);
      const g = geometry();
      if (g.list.length < 2) return;
      const f = position(g.boxes, x);
      paint(f, boxAt(g.boxes, f), g.list);
      const near = Math.round(f);
      if (near === st.last) return;
      st.last = near;
      g.list.forEach((b, k) => b.classList.toggle('is-hot', k === near));
      if (live && usable(g.list[near]) && near !== getIndex()) pick(near, g.list);
    }

    function finish(e, cancelled) {
      if (!st || (e && e.pointerId !== st.id)) return;
      const s = st;
      st = null;
      if (!s.drag) return;
      clearTimeout(s.grab);
      try {
        root.releasePointerCapture(s.id);
      } catch (_) {
        /* already released */
      }
      const list = items();
      for (const b of list) b.classList.remove('is-hot');
      root.classList.remove('is-dragging', 'is-grab');
      if (cancelled) {
        if (live && s.start >= 0 && getIndex() !== s.start && usable(list[s.start])) pick(s.start, list);
      } else if (!live && s.last >= 0 && s.last !== s.start && usable(list[s.last])) {
        pick(s.last, list);
      }
      if (o.end) o.end();
      // The click that follows the button coming up is the end of this drag, not a press: let it pass unseen.
      setTimeout(() => {
        swallow = false;
      }, 60);
    }

    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const list = items();
      if (list.length < 2 || !list.some(usable)) return;
      st = { id: e.pointerId, x0: e.clientX, drag: false, start: getIndex(), last: -1, grab: 0 };
    });

    root.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      if (!st.drag) {
        if (Math.abs(e.clientX - st.x0) < THRESHOLD) return;
        begin(e);
      }
      move(e);
    });

    root.addEventListener('pointerup', (e) => finish(e, false));
    root.addEventListener('pointercancel', (e) => finish(e, true));
    root.addEventListener('lostpointercapture', (e) => finish(e, true));

    root.addEventListener(
      'click',
      (e) => {
        if (!swallow || e.detail === 0) return; // Enter / Space on a focused button is never a drag
        swallow = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );

    return root;
  }

  const api = { attach, position, boxAt, THRESHOLD };
  if (typeof window !== 'undefined') window.AulaDragSeg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
