/*
 * The dropdown menu.
 *
 * Every <select class="select"> stays a real <select>: it holds the value, fires "change", is read and written by app.js and
 * shows the current choice. Only the list that opens from it is not the browser's own grey box. It is one menu of our own,
 * built from the select's options each time it opens, so it can wear the look of the page: frosted in Classic and Liquid glass
 * in Liquid glass (css/select.css, css/glass.css). It opens inside the window (it flips upwards near the bottom edge) and
 * follows the same rules as the Support menu: it floats above the page but below the window buttons.
 *
 * Mouse: a click on the select opens it, a click on a row chooses it, a click anywhere else closes it.
 * Keyboard: Enter, Space, F4 or Alt+Down/Up open it; inside, Up / Down / Home / End / Page Up / Page Down move, Enter or Space
 * chooses, typing jumps to a row, Escape closes and gives the focus back. With the menu closed, the arrow keys still change the
 * value directly, as in any select.
 */
(() => {
  'use strict';

  const shell = document.querySelector('.shell');
  if (!shell) return;

  const SELECTOR = 'select.select';
  const GAP = 6; // px between the select and the menu
  const MARGIN = 10; // px the menu keeps clear of the window's edge
  const MAX_LIST = 360; // px, the tallest the list gets before it scrolls
  const TICK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'; // our own static markup

  const pop = document.createElement('div');
  pop.className = 'sel-pop';
  pop.id = 'selPop';
  pop.hidden = true;
  const list = document.createElement('div');
  list.className = 'sel-list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  pop.append(list);
  shell.append(pop);

  let owner = null; // the <select> the menu is open for
  let rows = []; // { opt, row } for each option, in order
  let active = -1; // the highlighted row (the pointer and the arrow keys share it)
  let typed = '';
  let typedAt = 0;
  let stop = null; // takes the watchers off the open select
  let lastX = -1;
  let lastY = -1;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const enabled = (i) => i >= 0 && i < rows.length && !rows[i].opt.disabled;
  function step(from, dir) {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (enabled(i)) return i;
    return from;
  }

  function build() {
    list.textContent = '';
    rows = [];
    const label = owner.getAttribute('aria-label') || (owner.labels && owner.labels[0] ? owner.labels[0].textContent.trim() : '');
    if (label) list.setAttribute('aria-label', label);
    else list.removeAttribute('aria-label');
    Array.from(owner.options).forEach((opt, i) => {
      const row = document.createElement('div');
      row.className = 'sel-item';
      row.id = `selOpt${i}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === owner.selectedIndex));
      if (opt.disabled) row.setAttribute('aria-disabled', 'true');
      const text = document.createElement('span');
      text.className = 'sel-label';
      text.textContent = opt.textContent;
      const tick = document.createElement('span');
      tick.className = 'sel-tick';
      tick.innerHTML = TICK;
      row.append(text, tick);
      list.append(row);
      rows.push({ opt, row });
    });
  }

  function reveal(row, centre) {
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (centre) list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function setActive(i, scroll = true) {
    if (i === active || !enabled(i)) return;
    if (rows[active]) rows[active].row.classList.remove('is-active');
    active = i;
    rows[i].row.classList.add('is-active');
    list.setAttribute('aria-activedescendant', rows[i].row.id);
    if (scroll) reveal(rows[i].row, false);
  }

  function place() {
    if (!owner || pop.hidden) return;
    const r = owner.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    pop.style.maxHeight = '';
    pop.style.minWidth = `${Math.round(r.width)}px`;
    const natural = pop.offsetHeight;
    const pad = natural - list.offsetHeight; // the menu's own padding, top and bottom
    const below = s.bottom - r.bottom - GAP - MARGIN;
    const above = r.top - s.top - GAP - MARGIN;
    const down = natural <= below || below >= above;
    const room = Math.max(96, Math.min(MAX_LIST + pad, down ? below : above));
    if (natural > room) pop.style.maxHeight = `${Math.floor(room)}px`;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    // A select on the right half of the window opens the menu towards the left of its right edge, one on the left half towards the right.
    const right = r.left + r.width / 2 > s.left + s.width / 2;
    const x = clamp(right ? r.right - s.left - w : r.left - s.left, MARGIN, Math.max(MARGIN, s.width - w - MARGIN));
    const y = down ? r.bottom - s.top + GAP : r.top - s.top - GAP - h;
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
    pop.dataset.side = down ? 'down' : 'up';
    pop.dataset.align = right ? 'right' : 'left';
  }

  // While the menu is open: close it if its select goes away (another tab, a disabled keyboard), follow it if it moves or resizes,
  // and rebuild the rows if the app changes the options.
  function watch(sel) {
    const ro = new ResizeObserver(() => {
      if (!sel.offsetWidth || sel.disabled) close(false);
      else place();
    });
    ro.observe(sel);
    const mo = new MutationObserver(() => {
      if (sel.disabled) return close(false);
      build();
      active = -1;
      setActive(enabled(sel.selectedIndex) ? sel.selectedIndex : step(-1, 1), false);
      place();
    });
    mo.observe(sel, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    stop = () => {
      ro.disconnect();
      mo.disconnect();
    };
  }

  function open(sel) {
    if (!sel || sel.disabled || !sel.options.length) return;
    if (owner && owner !== sel) close(false);
    owner = sel;
    build();
    active = -1;
    pop.hidden = false;
    setActive(enabled(sel.selectedIndex) ? sel.selectedIndex : step(-1, 1), false);
    place();
    if (rows[active]) reveal(rows[active].row, true);
    sel.setAttribute('aria-expanded', 'true');
    sel.setAttribute('aria-controls', pop.id);
    typed = '';
    lastX = lastY = -1;
    watch(sel);
    list.focus({ preventScroll: true });
  }

  function close(returnFocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    const sel = owner;
    owner = null;
    rows = [];
    active = -1;
    if (stop) stop();
    stop = null;
    if (!sel) return;
    sel.setAttribute('aria-expanded', 'false');
    if (returnFocus && sel.isConnected && !sel.disabled) sel.focus({ preventScroll: true });
  }

  function choose(i) {
    if (!owner || !enabled(i)) return;
    const sel = owner;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close(true);
    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true })); // app.js listens for this, exactly as for the browser's own list
    }
  }

  function typeahead(ch) {
    const now = Date.now();
    typed = now - typedAt > 800 ? ch : typed + ch;
    typedAt = now;
    const q = typed.toLowerCase();
    const same = q.split('').every((c) => c === q[0]);
    const needle = same ? q[0] : q; // the same key again goes on to the next match; longer text looks for all of it
    const from = same ? active + 1 : Math.max(active, 0);
    for (let k = 0; k < rows.length; k++) {
      const i = (from + k) % rows.length;
      if (enabled(i) && rows[i].opt.textContent.trim().toLowerCase().startsWith(needle)) return setActive(i);
    }
  }

  // ---- the select itself: no browser list, our menu instead
  document.addEventListener(
    'mousedown',
    (e) => {
      const sel = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
      if (!sel || e.button !== 0 || sel.disabled) return;
      e.preventDefault(); // this is what stops the browser's own list
      sel.focus({ preventScroll: true });
      if (owner === sel) close(true);
      else open(sel);
    },
    true,
  );

  // ---- inside the menu
  pop.addEventListener('mousedown', (e) => e.preventDefault()); // the focus stays on the list
  list.addEventListener('pointermove', (e) => {
    if (e.clientX === lastX && e.clientY === lastY) return; // the page scrolled under a still pointer: keep the keyboard's row
    lastX = e.clientX;
    lastY = e.clientY;
    const row = e.target instanceof Element ? e.target.closest('.sel-item') : null;
    const i = row ? rows.findIndex((r) => r.row === row) : -1;
    if (i >= 0) setActive(i, false);
  });
  list.addEventListener('click', (e) => {
    const row = e.target instanceof Element ? e.target.closest('.sel-item') : null;
    const i = row ? rows.findIndex((r) => r.row === row) : -1;
    if (i >= 0) choose(i);
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (pop.hidden) {
        const sel = e.target instanceof Element ? e.target.closest(SELECTOR) : null;
        if (!sel || sel.disabled || e.ctrlKey || e.metaKey) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
          e.preventDefault();
          open(sel);
        }
        return;
      }
      const k = e.key;
      let used = true;
      if (k === 'Escape') close(true);
      else if (k === 'Tab') {
        close(false); // leaving the menu with Tab just closes it
        used = false;
      } else if ((k === 'ArrowDown' || k === 'ArrowUp') && e.altKey) close(true);
      else if (k === 'ArrowDown') setActive(step(active, 1));
      else if (k === 'ArrowUp') setActive(step(active, -1));
      else if (k === 'Home') setActive(step(-1, 1));
      else if (k === 'End') setActive(step(rows.length, -1));
      else if (k === 'PageDown' || k === 'PageUp') {
        const per = Math.max(1, Math.floor(list.clientHeight / ((rows[0] && rows[0].row.offsetHeight) || 32)) - 1);
        let i = active;
        for (let n = 0; n < per; n++) i = step(i, k === 'PageDown' ? 1 : -1);
        setActive(i);
      } else if (k === 'Enter' || (k === ' ' && Date.now() - typedAt > 800)) choose(active); // Space is a letter while you are typing
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(k);
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // ---- everything that should close it
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (pop.hidden) return;
      if (pop.contains(e.target) || (owner && owner.contains(e.target))) return; // the select's own click toggles it (above)
      close(false);
    },
    true,
  );
  document.addEventListener(
    'scroll',
    (e) => {
      if (!pop.hidden && !pop.contains(e.target)) close(false); // the page moved on under it
    },
    true,
  );
  window.addEventListener('resize', place);
  window.addEventListener('blur', () => close(false));
  new MutationObserver(() => close(false)).observe(shell, { attributes: true, attributeFilter: ['data-screen'] });

  for (const sel of document.querySelectorAll(SELECTOR)) sel.setAttribute('aria-haspopup', 'listbox');

  window.AulaSelect = { open, close, isOpen: () => !pop.hidden };
})();
