// iOS 27 Liquid Glass motion, second layer: the behaviour behind css/glass-ios27.css. It only runs while the Liquid glass UI is
// on and the system has not asked for reduced motion. The movements themselves are CSS; this script only knows what CSS cannot.
//
//   pages    The four pages of Settings turn like the tab pages: the page you go to slides in from its own side, judged by its
//            place among the pages (.ag-turn, and --dx, +22 px forward and -22 px back, the same number app.js gives the tabs).
//   dialog   The Software Update dialog grows out of the button that opened it: the script finds that button's centre inside the
//            card (--ag-ox / --ag-oy) and the stylesheet scales the card from there, and back into it when it closes.
//
// Everything is a class or a custom property: no animation is run from here, so a part failing leaves the page as the
// stylesheet alone would. The pure helpers at the top are what the tests exercise.
(() => {
  'use strict';

  // ------------------------------------------------------------------------------------------ pure helpers

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Which way a page turn goes: 1 forward (the new page lies after the old), -1 back, 0 when there is nothing to turn
  // (the same page, or a page that is not one of the pages: index -1).
  function turnDir(from, to) {
    if (from < 0 || to < 0 || from === to) return 0;
    return to > from ? 1 : -1;
  }

  // Where the centre of the button (src) lies inside the card, in px from the card's top left corner. Both are { left, top,
  // width, height }. Limited to a card's size beyond each side, so a button far away cannot fling the card in from nowhere.
  function originOf(src, card) {
    const x = src.left + src.width / 2 - card.left;
    const y = src.top + src.height / 2 - card.top;
    return {
      x: clamp(x, -card.width, card.width * 2),
      y: clamp(y, -card.height, card.height * 2),
    };
  }

  const api = { turnDir, originOf, clamp };
  if (typeof window !== 'undefined') window.AulaGlassIOS27 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------------------------------------- setup

  const doc = document;
  const root = doc.documentElement;
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // --------------------------------------------------------------------------------------------------- pages

  function pagesModule() {
    const pages = Array.from(doc.querySelectorAll('.set-page'));
    if (pages.length < 2) return () => {};
    const shown = () => pages.findIndex((p) => !p.hidden);
    let cur = shown();
    // The turn is over (or was cut short because the whole tab went away): the page stops being "turned to", so it does
    // not move a second time when its tab comes back.
    const over = (e) => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove('ag-turn');
    };
    const mo = new MutationObserver(() => {
      const next = shown();
      const dir = turnDir(cur, next);
      cur = next;
      if (!dir) return;
      const page = pages[next];
      page.style.setProperty('--dx', `${dir * 22}px`);
      page.classList.add('ag-turn');
    });
    for (const p of pages) {
      p.addEventListener('animationend', over);
      p.addEventListener('animationcancel', over);
      mo.observe(p, { attributes: true, attributeFilter: ['hidden'] });
    }
    return () => {
      mo.disconnect();
      for (const p of pages) {
        p.removeEventListener('animationend', over);
        p.removeEventListener('animationcancel', over);
        p.classList.remove('ag-turn');
        p.style.removeProperty('--dx');
      }
    };
  }

  // -------------------------------------------------------------------------------------------------- dialog

  function dialogModule() {
    const box = doc.getElementById('upd');
    const card = box && box.querySelector('.upd-card');
    if (!box || !card) return () => {};
    let src = null; // the button that was pressed last, and when
    let at = 0;
    const onClick = (e) => {
      const b = e.target instanceof Element ? e.target.closest('button') : null;
      if (!b) return;
      src = b;
      at = performance.now();
    };
    const clear = () => {
      box.style.removeProperty('--ag-ox');
      box.style.removeProperty('--ag-oy');
    };
    const mo = new MutationObserver(() => {
      if (box.hidden) return; // closing: the card folds back to where it grew from
      const fresh = src && src.isConnected && !box.contains(src) && performance.now() - at < 600;
      if (!fresh) {
        clear(); // opened by itself (a new version was found): it grows from its own centre
        return;
      }
      // offsetLeft / offsetTop and the sizes do not change with the card's own scale, so they are right while it is still
      // small at the start of its entrance (getBoundingClientRect of the card would not be).
      const b = box.getBoundingClientRect();
      const o = originOf(src.getBoundingClientRect(), {
        left: b.left + card.offsetLeft,
        top: b.top + card.offsetTop,
        width: card.offsetWidth,
        height: card.offsetHeight,
      });
      box.style.setProperty('--ag-ox', `${Math.round(o.x)}px`);
      box.style.setProperty('--ag-oy', `${Math.round(o.y)}px`);
      src = null;
    });
    mo.observe(box, { attributes: true, attributeFilter: ['hidden'] });
    doc.addEventListener('click', onClick, true);
    return () => {
      mo.disconnect();
      doc.removeEventListener('click', onClick, true);
      clear();
    };
  }

  // ------------------------------------------------------------------------------------------- on and off

  let stop = null;

  function sync() {
    const want = root.classList.contains('glass') && !(motionQuery && motionQuery.matches);
    if (want && !stop) {
      const parts = [pagesModule, dialogModule].map((make) => {
        try {
          return make();
        } catch (err) {
          if (window.console) console.warn('glass ios27:', err); // one part failing must not take the others down
          return () => {};
        }
      });
      stop = () => parts.forEach((fn) => {
        try {
          fn();
        } catch (_) {
          /* already gone */
        }
      });
    } else if (!want && stop) {
      stop();
      stop = null;
    }
  }

  api.active = () => !!stop;

  function init() {
    sync();
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
    if (motionQuery) {
      if (motionQuery.addEventListener) motionQuery.addEventListener('change', sync);
      else if (motionQuery.addListener) motionQuery.addListener(sync);
    }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
