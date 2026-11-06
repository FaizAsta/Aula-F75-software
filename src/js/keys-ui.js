/*
 * The Keys tab: pick a key on the keyboard, choose what it should do, apply. It owns the tab's state and DOM; app.js only
 * hands it the session, the layout and a few callbacks, and asks it for the legends and the selection to draw.
 * All the protocol work is in keyassign.js and keys.js.
 */
(function (root) {
  'use strict';

  function create(ctx) {
    const K = root.AulaKeys;
    const { KeyAssign } = root.AulaKeyAssign;
    const $ = (s) => document.querySelector(s);
    const ka = new KeyAssign({
      transport: () => ctx.session.transport,
      keys: () => ctx.L.KEYS,
      model: () => ctx.L.id,
      storage: ctx.storage,
      onChange: () => ctx.rerender(),
    });

    let layer = 0;
    let selected = null; // led of the picked key
    let group = 'letters';
    let mods = 0; // modifiers chosen for the next key
    let busy = false;
    let lastModel = null;
    const pending = [new Map(), new Map()]; // layer -> Map(led -> four bytes), not on the keyboard yet

    const GROUPS = [...K.GROUPS.map((g) => ({ id: g.id, name: g.name })), { id: 'media', name: 'Media' }];
    const keyByLed = (led) => ctx.L.KEYS.find((k) => k.led === led) || null;
    const fnLed = () => {
      const k = ctx.L.KEYS.find((x) => x.n === 'Fn');
      return k ? k.led : -1;
    };
    const decodeNow = (lay, led) => (pending[lay].has(led) ? K.decode(pending[lay].get(led)) : ka.codeOf(lay, led));

    // ------------------------------------------------------------ for the preview

    /** led -> { text, mark } for every key, or null while the layers are not known. */
    function legends() {
      if (!ka.ready || !ka.layerAvailable(layer)) return null;
      const m = new Map();
      for (const k of ctx.L.KEYS) {
        const d = decodeNow(layer, k.led);
        const locked = k.led === fnLed() || (d && d.protected);
        m.set(k.led, { text: d && d.short ? d.short : '\u2014', mark: pending[layer].has(k.led) ? 'pending' : locked ? 'locked' : '' });
      }
      return m;
    }

    const selection = () => (selected === null ? new Set() : new Set([selected]));

    function pick(k) {
      if (!k) return;
      selected = k.led;
      ctx.rerender();
    }

    // ------------------------------------------------------------ actions

    function addPending(led, code) {
      if (led === fnLed()) return;
      const cur = ka.state.layers[layer] ? K.codeAt(ka.state.layers[layer], led) : null;
      if (cur && K.sameBytes(cur, code)) pending[layer].delete(led); // the same as what is there: no change
      else pending[layer].set(led, code);
      ctx.rerender();
    }

    function assign(spec) {
      if (selected === null || !ka.ready || busy) return;
      try {
        addPending(selected, K.encode(spec));
      } catch (err) {
        ctx.toast(err.message, 'warn');
      }
    }

    async function apply() {
      if (busy || !ka.ready || !pending[layer].size) return;
      busy = true;
      ctx.rerender();
      const edits = new Map(pending[layer]);
      if (ctx.MO) ctx.MO.link('tx', 'Sending keys');
      const r = await ka.apply(layer, edits);
      busy = false;
      for (const led of r.kept) pending[layer].delete(led);
      if (r.ok) {
        if (ctx.MO) ctx.MO.link('ok', 'Keys saved');
        ctx.toast(edits.size === 1 ? 'Key written and checked on the keyboard.' : `${edits.size} keys written and checked on the keyboard.`, 'ok');
      } else if (r.kept.length) {
        if (ctx.MO) ctx.MO.link('warn', 'Partly kept');
        ctx.toast(r.error || 'The keyboard did not keep every change.', 'warn', 7000);
      } else {
        if (ctx.MO) ctx.MO.link('bad');
        ctx.toast(r.error || 'The keys were not written.', 'bad', 7000);
      }
      ctx.rerender();
    }

    function restoreKey() {
      if (selected === null || busy) return;
      const e = ka.restoreEdits(layer, selected);
      if (e.size) for (const [led, code] of e) pending[layer].set(led, code);
      else pending[layer].delete(selected);
      ctx.rerender();
    }

    function restoreLayer() {
      if (busy) return;
      pending[layer].clear();
      for (const [led, code] of ka.restoreEdits(layer)) pending[layer].set(led, code);
      ctx.rerender();
    }

    // ------------------------------------------------------------ loading

    /** Called when the tab is shown and on every render while it is: reads the layers the first time, forgets them when the link goes. */
    function sync() {
      const live = ctx.session.ready;
      if (lastModel !== ctx.L.id) {
        lastModel = ctx.L.id;
        selected = null;
        pending[0].clear();
        pending[1].clear();
        if (ka.state.status !== 'idle') ka.reset();
      }
      if ((!live || (ka.state.bound && !ka.current)) && ka.state.status !== 'idle') {
        pending[0].clear();
        pending[1].clear();
        ka.reset();
        return;
      }
      if (live && ctx.isTab() && ka.state.status === 'idle') ka.load();
    }

    // ------------------------------------------------------------ DOM

    function buildStatic() {
      const g = $('#kaGroups');
      g.textContent = '';
      for (const it of GROUPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ka-chip';
        b.setAttribute('role', 'tab');
        b.dataset.group = it.id;
        b.textContent = it.name;
        g.appendChild(b);
      }
      const m = $('#kaMods');
      m.textContent = '';
      for (const it of K.MODS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ka-chip';
        b.dataset.mod = String(it.bit);
        b.textContent = it.short.replace(/^L/, 'L ').replace(/^R/, 'R ');
        b.title = it.name;
        m.appendChild(b);
      }
    }

    function renderGrid(enabled) {
      const grid = $('#kaGrid');
      const items =
        group === 'media'
          ? K.MEDIA.map((x) => ({ kind: 'media', usage: x.usage, name: x.name, short: x.short, wide: true }))
          : K.GROUPS.find((x) => x.id === group).usages.map((u) => ({ kind: 'key', usage: u, name: K.NAMES.get(u).name, short: K.NAMES.get(u).short }));
      const want = selected !== null ? decodeNow(layer, selected) : null;
      const sig = `${group}|${items.length}`;
      if (grid.dataset.sig !== sig) {
        grid.dataset.sig = sig;
        grid.textContent = '';
        items.forEach((it, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `ka-key${it.wide ? ' wide' : ''}`;
          b.dataset.i = String(i);
          b.textContent = it.short;
          b.title = it.name;
          grid.appendChild(b);
        });
      }
      Array.from(grid.children).forEach((b, i) => {
        const it = items[i];
        b.disabled = !enabled;
        const on = !!want && want.usage === it.usage && (it.kind === 'media' ? want.kind === 'media' : want.kind === 'key' || want.kind === 'combo');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      grid._items = items;
    }

    function render() {
      sync();
      const st = ka.state.status;
      const has = ka.ready;
      busy = busy && has; // a lost link ends the wait
      const layerOk = has && ka.layerAvailable(layer);
      if (has && !ka.layerAvailable(layer)) layer = 0;

      const k = selected === null ? null : keyByLed(selected);
      const isFn = selected !== null && selected === fnLed();
      const cur = k && has ? ka.codeOf(layer, selected) : null;
      const locked = !!cur && (cur.protected || isFn);
      const canEdit = has && layerOk && !!k && !locked && !busy && !ctx.busy();

      $('#kaKey').textContent = k ? `${k.n}${layer ? ' with Fn' : ''}` : 'Pick a key on the keyboard';
      for (const b of document.querySelectorAll('#segLayer .seg-btn')) {
        const l = Number(b.dataset.layer);
        b.setAttribute('aria-checked', l === layer ? 'true' : 'false');
        b.disabled = !has || (l === 1 && !ka.layerAvailable(1)) || busy;
      }
      const seg = $('#segLayer');
      seg.style.setProperty('--i', String(layer));
      $('#kaLayerHint').textContent = has && !ka.layerAvailable(1) ? 'The FN1 layer could not be read from this keyboard, so only the Default layer can be changed.' : K.LAYERS[layer].hint;

      // what the picked key does
      const now = $('#kaNow');
      now.textContent = '';
      const add = (txt, cls) => {
        const s = document.createElement(cls === 'b' ? 'b' : 'span');
        if (cls && cls !== 'b') s.className = cls;
        s.textContent = txt;
        now.appendChild(s);
      };
      if (k && cur) {
        const p = pending[layer].get(selected);
        add('Now: ');
        add(cur.label, 'b');
        if (p) {
          add('  \u2192  ', 'ka-dim');
          add(K.decode(p).label, 'ka-to');
        }
        const orig = ka.originalOf(layer, selected);
        if (orig && orig.label !== cur.label && !p) add(`   (originally ${orig.label})`, 'ka-dim');
        if (locked) add(isFn ? ' The Fn key cannot be changed.' : ' This is a special key of the keyboard and is left alone.', 'ka-dim');
      } else if (!has) add('', '');
      $('#kaWill').textContent = pending[layer].has(selected) ? K.decode(pending[layer].get(selected)).label : '';

      // state line
      const stateEl = $('#kaState');
      if (!ctx.session.ready) stateEl.textContent = 'Connect a keyboard (or turn on the demo keyboard in Settings) to assign keys.';
      else if (st === 'loading' || st === 'idle') stateEl.textContent = 'Reading the keyboard\u2019s key layout\u2026';
      else if (st === 'busy') stateEl.textContent = 'Writing and checking the keys\u2026';
      else if (st === 'error') stateEl.textContent = ka.state.error;
      else stateEl.textContent = '';
      $('#kaRetry').hidden = st !== 'error' || !ctx.session.ready;

      // changes
      const n = pending[layer].size;
      const other = pending[layer ? 0 : 1].size;
      $('#kaCount').textContent = n ? `${n} ${n === 1 ? 'change' : 'changes'}` : other ? `None here, ${other} on ${K.LAYERS[layer ? 0 : 1].name}` : 'None';
      $('#kaApply').disabled = !has || busy || ctx.busy() || n === 0;
      $('#kaApply').classList.toggle('is-busy', busy);
      $('#kaDiscard').disabled = busy || (n === 0 && other === 0);
      const canRestoreKey = has && !!k && !busy && !locked && (ka.restoreEdits(layer, selected).size > 0 || pending[layer].has(selected));
      $('#kaRestoreKey').disabled = !canRestoreKey;
      $('#kaRestoreLayer').disabled = !has || busy || (ka.restoreEdits(layer).size === 0 && n === 0);

      // palette
      for (const b of document.querySelectorAll('#kaGroups .ka-chip')) b.setAttribute('aria-selected', b.dataset.group === group ? 'true' : 'false');
      renderGrid(canEdit);
      for (const b of document.querySelectorAll('#kaMods .ka-chip')) {
        b.setAttribute('aria-pressed', mods & Number(b.dataset.mod) ? 'true' : 'false');
        b.disabled = group === 'media' || !canEdit;
      }
      const ms = K.MODS.filter((x) => mods & x.bit);
      $('#kaModVal').textContent = ms.length ? ms.map((x) => x.name).join(' + ') : 'No modifier';
      $('#kaModOnly').disabled = !canEdit || mods === 0;
      $('#kaNone').disabled = !canEdit;
    }

    function wire() {
      buildStatic();
      $('#kaGroups').addEventListener('click', (e) => {
        const b = e.target.closest('.ka-chip');
        if (!b) return;
        group = b.dataset.group;
        ctx.rerender();
      });
      $('#kaMods').addEventListener('click', (e) => {
        const b = e.target.closest('.ka-chip');
        if (!b || b.disabled) return;
        mods ^= Number(b.dataset.mod);
        ctx.rerender();
      });
      $('#kaGrid').addEventListener('click', (e) => {
        const b = e.target.closest('.ka-key');
        const items = $('#kaGrid')._items;
        if (!b || b.disabled || !items) return;
        const it = items[Number(b.dataset.i)];
        if (it.kind === 'media') assign({ kind: 'media', usage: it.usage });
        else assign(mods ? { kind: 'combo', mods, usage: it.usage } : { kind: 'key', usage: it.usage });
      });
      $('#kaModOnly').addEventListener('click', () => mods && assign({ kind: 'mods', mods }));
      $('#kaNone').addEventListener('click', () => assign({ kind: 'none' }));
      $('#kaApply').addEventListener('click', apply);
      $('#kaDiscard').addEventListener('click', () => {
        pending[0].clear();
        pending[1].clear();
        ctx.rerender();
      });
      $('#kaRestoreKey').addEventListener('click', restoreKey);
      $('#kaRestoreLayer').addEventListener('click', restoreLayer);
      $('#kaRetry').addEventListener('click', () => {
        ka.reset();
        ctx.rerender();
      });
      for (const b of document.querySelectorAll('#segLayer .seg-btn')) {
        b.addEventListener('click', () => {
          if (b.disabled) return;
          layer = Number(b.dataset.layer);
          ctx.rerender();
        });
      }
    }

    return { ka, legends, selection, pick, render, wire, pendingCount: () => pending[0].size + pending[1].size };
  }

  root.AulaKeysUI = { create };
})(typeof self !== 'undefined' ? self : globalThis);
