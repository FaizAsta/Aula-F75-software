/*
 * The "What's new" window after an update. The main process decides whether it is owed (see prepareWhatsNew in main.js) and
 * hands over the headers; this only draws them, with textContent so nothing in the notes can inject markup.
 */
(() => {
  'use strict';

  const host = window.aulaHost;
  const box = document.querySelector('#wn');
  if (!host || !host.whatsNew || !box) return; // a plain browser tab: nothing was updated

  const list = document.querySelector('#wnList');
  const ok = document.querySelector('#wnOk');

  function close() {
    if (box.hidden) return;
    box.hidden = true;
    host.whatsNewSeen();
  }

  function draw(info) {
    document.querySelector('#wnSub').textContent = `Now on version ${info.version}.`;
    list.textContent = '';
    for (const s of info.sections) {
      const h = document.createElement('h4');
      h.textContent = `What’s new in ${s.version}`;
      const ul = document.createElement('ul');
      for (const item of s.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.append(li);
      }
      list.append(h, ul);
    }
  }

  ok.addEventListener('click', close);
  box.addEventListener('click', (e) => {
    if (e.target === box) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!box.hidden && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault();
      close();
    }
  });

  host
    .whatsNew()
    .then((info) => {
      if (!info || !Array.isArray(info.sections) || !info.sections.length) return;
      draw(info);
      box.hidden = false;
      ok.focus();
    })
    .catch(() => {});
})();
