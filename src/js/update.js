/*
 * Software update dialog and the update rows in Settings. The page cannot reach the network (its security policy only
 * allows itself), so everything here goes through the app's main process: it asks GitHub, downloads and starts the
 * installer, and reports progress back.
 */
(() => {
  'use strict';

  const api = window.aulaHost && window.aulaHost.update;
  if (!api) return; // a plain browser tab: nothing to update

  const $ = (s) => document.querySelector(s);
  const box = $('#upd');
  let info = null; // the update on offer: { version, current, notes, mode, size }
  let phase = 'closed'; // closed | offer | downloading | ready | installing | error

  // The update icons (header, and the start and device screens): visible whenever a newer version is known.
  const badges = document.querySelectorAll('.upd-badge');
  let latest = null;
  function badge(next) {
    latest = next || null;
    for (const b of badges) {
      b.hidden = !latest;
      if (!latest) continue;
      b.title = `Update available: version ${latest.version}`;
      b.setAttribute('aria-label', `Update available: version ${latest.version}. Click to see it.`);
    }
  }
  for (const b of badges) b.addEventListener('click', () => latest && show(latest));

  const mb = (n) => `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB`;

  // A small, safe subset of Markdown for the release notes: headings, bullets, **bold**, paragraphs. Built with
  // textContent only, so nothing in a release description can inject markup. Images and links are reduced to their text.
  function inline(parent, text) {
    const clean = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '');
    clean.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement('b');
        b.textContent = part.slice(2, -2);
        parent.append(b);
      } else parent.append(part);
    });
  }

  function renderNotes(target, md) {
    target.textContent = '';
    let list = null;
    for (const raw of String(md || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        list = null;
        continue;
      }
      const bullet = /^[-*+]\s+(.*)$/.exec(line);
      const head = /^#{1,6}\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) target.append((list = document.createElement('ul')));
        const li = document.createElement('li');
        inline(li, bullet[1]);
        list.append(li);
      } else {
        list = null;
        const n = document.createElement(head ? 'h4' : 'p');
        inline(n, head ? head[1] : line);
        target.append(n);
      }
    }
    if (!target.firstChild) {
      const p = document.createElement('p');
      p.className = 'none';
      p.textContent = 'No release notes were written for this version.';
      target.append(p);
    }
  }

  function actions(list) {
    const row = $('#updActions');
    row.textContent = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.main ? 'upd-act upd-main' : 'upd-act'; // not "main": that class is the page area and is hidden on the start screen
      b.textContent = a.label;
      b.addEventListener('click', a.run);
      row.append(b);
    }
    return row.querySelector('.upd-main') || row.firstElementChild;
  }

  function bar(fraction) {
    $('#updBar').hidden = fraction === null;
    if (fraction !== null) $('#updFill').style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  }

  function close(dismiss) {
    if (dismiss) api.dismiss();
    phase = 'closed';
    box.hidden = true;
  }

  function offer() {
    phase = 'offer';
    const page = info.mode === 'page';
    $('#updSub').textContent = `Aula Control ${info.version} is available. You have ${info.current}.${page ? ' Open the download page to get it.' : ''}`;
    $('#updMeta').textContent = !page && info.size ? `Download size: ${mb(info.size)}` : '';
    $('#updBody').hidden = false;
    bar(null);
    const focus = actions([
      { label: 'Later', run: () => close(true) },
      { label: page ? 'Open download page' : 'Update now', main: true, run: start },
    ]);
    if (focus) focus.focus();
  }

  // The download is finished. Nothing is installed until the person presses Install now.
  function ready() {
    phase = 'ready';
    $('#updSub').textContent = `Aula Control ${info.version} has been downloaded. Install it now? Aula Control closes and opens again when it is done.`;
    $('#updMeta').textContent = '';
    $('#updBody').hidden = false;
    bar(null);
    const focus = actions([
      { label: 'Later', run: () => close(true) },
      { label: 'Install now', main: true, run: install },
    ]);
    if (focus) focus.focus();
  }

  async function install() {
    const r = await api.install().catch(() => ({ ok: false, message: 'Could not start the installer.' }));
    if (!r.ok) fail(r.message);
  }

  async function start() {
    const r = await api.start().catch(() => ({ ok: false, message: 'Could not start the update.' }));
    if (!r.ok) return fail(r.message);
    if (r.opened) return close(true); // the release page is open in the browser
    if (r.ready) return ready(); // downloaded earlier: go straight to the question
    phase = 'downloading';
    $('#updSub').textContent = `Downloading Aula Control ${info.version}…`;
    $('#updMeta').textContent = '';
    bar(0);
    actions([{ label: 'Cancel', run: () => api.cancel() }]);
  }

  function fail(message) {
    phase = 'error';
    $('#updSub').textContent = message || 'The update did not work.';
    $('#updMeta').textContent = '';
    $('#updBody').hidden = false;
    bar(null);
    actions([
      { label: 'Close', run: () => close(true) },
      { label: 'Try again', main: true, run: start },
    ]);
  }

  function show(next) {
    if (phase !== 'closed' || !next) return; // never replace a dialog that is already open
    info = next;
    renderNotes($('#updNotes'), info.notes);
    $('#updBody').scrollTop = 0;
    box.hidden = false;
    offer();
  }

  api.onAvailable(show);
  api.onBadge(badge);
  api.latest().then(badge).catch(() => {}); // found before the page finished loading
  api.onProgress((p) => {
    if (phase !== 'downloading') return;
    bar(p.total ? p.received / p.total : 0);
    $('#updMeta').textContent = p.total ? `${mb(p.received)} of ${mb(p.total)}` : mb(p.received);
  });
  api.onState((s) => {
    if (s.state === 'ready') ready();
    else if (s.state === 'installing') {
      phase = 'installing';
      $('#updSub').textContent = 'Starting the installer. Aula Control closes and opens again when it is done.';
      $('#updMeta').textContent = '';
      bar(1);
      actions([]);
    } else if (s.state === 'cancelled') close(true);
    else if (s.state === 'error') fail(s.message);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || phase === 'closed' || phase === 'installing') return;
    if (phase === 'downloading') api.cancel();
    else close(true);
  });

  // ---------------------------------------------------------------- Settings
  api.info().then((i) => {
    if (!i.enabled) return; // no GitHub repository is set in package.json: the rows stay hidden
    $('#updAutoRow').hidden = false;
    $('#updRow').hidden = false;
    $('#updStatus').textContent = `You have version ${i.current}.`;
    const btn = $('#updCheck');
    // The result goes in two places: the line under "Software update" and a toast, so it is seen wherever you are looking.
    const say = (text, kind) => {
      const line = $('#updStatus');
      line.textContent = text;
      line.dataset.k = kind;
      const toast = window.aulaApp && window.aulaApp.toast;
      if (toast) toast(text, kind);
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      $('#updStatus').textContent = 'Checking…';
      $('#updStatus').dataset.k = '';
      const r = await api.check().catch(() => ({ status: 'error', message: 'The check did not work.' }));
      btn.disabled = false;
      if (r.status === 'available') {
        badge(r.info);
        say(`Version ${r.info.version} is available. You have ${i.current}.`, 'warn');
        show(r.info);
      } else if (r.status === 'current') {
        badge(null);
        say(`You have the latest version (${r.current || i.current}).`, 'ok');
      } else say(r.message || 'The check did not work.', 'bad');
    });
  });

  // An update found before the page finished loading.
  api.pending().then(show).catch(() => {});
})();
