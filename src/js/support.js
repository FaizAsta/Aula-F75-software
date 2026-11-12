/*
 * The Support button (in the header, and on the start screen) and the small menu it opens: Discord, GitHub and any other
 * link in support-links.js. One menu serves every button that has the attribute data-support.
 *
 * The page cannot open addresses itself (its window is not allowed to navigate), so a click sends only the link's id
 * to the main process, which looks the address up and opens it in the browser or the mail app.
 */
(() => {
  'use strict';

  const Links = window.AulaSupportLinks;
  const triggers = Array.from(document.querySelectorAll('[data-support]'));
  const shell = document.querySelector('.shell');
  if (!Links || !triggers.length || !shell) return;

  const links = Links.list();
  if (!links.length) {
    for (const t of triggers) t.hidden = true; // nothing to show
    return;
  }

  const svg = (inner, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    discord: svg(
      '<path d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.25a18.3 18.3 0 0 0-5.49 0c-.17-.4-.41-.87-.62-1.25a.08.08 0 0 0-.08-.04A19.7 19.7 0 0 0 3.6 4.4a.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.23 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42z"/>',
      'sup-fill',
    ),
    github: svg('<circle cx="6" cy="5.5" r="2.3"/><circle cx="6" cy="18.5" r="2.3"/><circle cx="18" cy="8.5" r="2.3"/><path d="M6 7.8v8.4M18 10.8c0 3.4-2.4 4.6-5.2 4.9l-4.6.5"/>'),
    instagram: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.9"/><path d="M17 7h.01"/>'),
    email: svg('<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="m4 8 8 5.5L20 8"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>'),
  };
  const ARROW = svg('<path d="M8 16 16 8M9.5 8H16v6.5"/>', 'sup-go');

  // ---- the menu, built once and moved under whichever button opened it
  const pop = document.createElement('div');
  pop.className = 'sup-pop';
  pop.id = 'supPop';
  pop.hidden = true;
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Support');

  const head = document.createElement('p');
  head.className = 'sup-head';
  head.textContent = 'Need help or have an idea?';
  pop.append(head);

  for (const l of links) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sup-item';
    b.dataset.id = l.id;
    b.setAttribute('role', 'menuitem');
    const ico = document.createElement('span');
    ico.className = 'sup-ico';
    ico.dataset.k = ICONS[l.id] ? l.id : 'link';
    ico.innerHTML = ICONS[l.id] || ICONS.link; // our own static markup, never text from the list
    const txt = document.createElement('span');
    txt.className = 'sup-txt';
    const name = document.createElement('b');
    name.textContent = l.label;
    txt.append(name);
    if (l.hint) {
      const hint = document.createElement('small');
      hint.textContent = l.hint;
      txt.append(hint);
    }
    const go = document.createElement('span');
    go.className = 'sup-arrow';
    go.innerHTML = ARROW;
    b.append(ico, txt, go);
    b.addEventListener('click', () => choose(l.id));
    pop.append(b);
  }
  shell.append(pop);

  const items = () => Array.from(pop.querySelectorAll('.sup-item'));
  let owner = null; // the button that opened the menu

  function place() {
    if (!owner) return;
    const r = owner.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    const w = pop.offsetWidth;
    const margin = 12;
    // A button on the left half of the window opens the menu to the right of its left edge, one on the right half to the left of its right edge.
    const leftHalf = r.left + r.width / 2 < s.left + s.width / 2;
    let x = leftHalf ? r.left - s.left : r.right - s.left - w;
    x = Math.max(margin, Math.min(x, s.width - w - margin));
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(r.bottom - s.top + 8)}px`;
    pop.dataset.side = leftHalf ? 'left' : 'right';
  }

  function open(from) {
    owner = from;
    pop.hidden = false;
    place();
    for (const t of triggers) t.setAttribute('aria-expanded', String(t === owner));
    const first = items()[0];
    if (first) first.focus({ preventScroll: true });
  }

  function close(returnFocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    for (const t of triggers) t.setAttribute('aria-expanded', 'false');
    if (returnFocus && owner && !owner.hidden) owner.focus({ preventScroll: true });
    owner = null;
  }

  async function choose(id) {
    close(true);
    const host = window.aulaHost;
    let ok = false;
    if (host && typeof host.openSupport === 'function') {
      try {
        ok = await host.openSupport(id);
      } catch (_) {
        ok = false;
      }
    } else {
      // A plain browser tab (no desktop app around the page): let the browser open it.
      const l = Links.find(id);
      if (l) ok = !!window.open(l.url, '_blank', 'noopener');
    }
    if (!ok) {
      const toast = window.aulaApp && window.aulaApp.toast;
      if (toast) toast('Could not open that link. Check that a browser or mail app is set up on this computer.', 'warn');
    }
  }

  for (const t of triggers) {
    t.addEventListener('click', () => {
      if (!pop.hidden && owner === t) close(true);
      else open(t);
    });
  }

  // Click anywhere else, Escape, a resize or a change of screen closes the menu.
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (pop.hidden) return;
      if (pop.contains(e.target) || triggers.some((t) => t.contains(e.target))) return;
      close(false);
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      list[next].focus({ preventScroll: true });
    } else if (e.key === 'Tab') {
      close(false); // the menu is short: leaving it with Tab just closes it
    }
  }, true);
  window.addEventListener('resize', place);
  window.addEventListener('blur', () => close(false));
  new MutationObserver(() => close(false)).observe(shell, { attributes: true, attributeFilter: ['data-screen'] });
})();
