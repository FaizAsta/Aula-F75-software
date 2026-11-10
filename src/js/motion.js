// Motion helpers (v1.3.2). Pure DOM, no knowledge of the keyboard: app.js and home.js call into it.
//   - ripples on every button press (also for Enter / Space)
//   - one-shot "flip" and "burst" classes for switches, effect tiles and the theme button
//   - task(): a button that shows busy -> done / failed while something runs
//   - link(): the data-transfer animation on the preview ("tx" while settings are sent to the keyboard, "rx" while they are
//     read back, then a short ok / warn / bad flash)
// Everything here is skipped when the system asks for reduced motion, and none of it uses blur or filters.
(() => {
  'use strict';

  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(mq && mq.matches);
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------------ ripples

  // Round swatches and the brand are left out on purpose: they already pop / scale, and a ripple would only add noise.
  const RIPPLE = '.btn, .pill-btn, .icon-btn, .tab-btn, .seg-btn, .effect, .hm-dev, .start-btn, .win-btn';

  function ripple(host, x, y) {
    if (reduced()) return;
    const r = host.getBoundingClientRect();
    const px = x - r.left;
    const py = y - r.top;
    // Big enough to reach the farthest corner from the press point.
    const d = 2 * Math.hypot(Math.max(px, r.width - px), Math.max(py, r.height - py));
    const wrap = document.createElement('span');
    wrap.className = 'rip';
    wrap.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('i');
    dot.style.cssText = `left:${px.toFixed(1)}px;top:${py.toFixed(1)}px;width:${d.toFixed(1)}px;height:${d.toFixed(1)}px`;
    wrap.append(dot);
    host.append(wrap);
    const gone = () => wrap.remove();
    dot.addEventListener('animationend', gone);
    setTimeout(gone, 1000); // safety net if the animation never ends (hidden tab)
    const all = host.querySelectorAll(':scope > .rip');
    if (all.length > 3) all[0].remove();
  }

  const usable = (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';

  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const host = e.target.closest && e.target.closest(RIPPLE);
      if (usable(host)) ripple(host, e.clientX, e.clientY);
    },
    true,
  );
  // Enter or Space on a focused button fires click with no pointer: ripple from the middle.
  document.addEventListener(
    'click',
    (e) => {
      if (e.detail !== 0) return;
      const host = e.target.closest && e.target.closest(RIPPLE);
      if (!usable(host)) return;
      const r = host.getBoundingClientRect();
      ripple(host, r.left + r.width / 2, r.top + r.height / 2);
    },
    true,
  );

  // ----------------------------------------------------------- one-shot classes

  const timers = new WeakMap();
  /** Adds `cls` for `ms`, restarting the animation if it is already running. */
  function flash(el, cls, ms) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const t = timers.get(el) || {};
    clearTimeout(t[cls]);
    t[cls] = setTimeout(() => el.classList.remove(cls), ms);
    timers.set(el, t);
  }

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target.closest && e.target.closest('.switch, .effect, .seg-btn');
      if (!usable(t)) return;
      if (t.classList.contains('switch')) flash(t, 'flip', 560);
      else if (t.classList.contains('effect')) flash(t, 'burst', 700);
      else if (t.classList.contains('seg-btn')) flash(t, 'flip', 400);
      else flash(t, 'flip', 650);
    },
    true,
  );

  // ------------------------------------------------------------- button tasks

  /**
   * Runs `fn` while `btn` shows a busy state, then a short done or failed state. Busy lasts at least 450 ms so that an
   * instant answer is still seen. `fn` returning true shows "done", returning false (or throwing) shows "failed", and
   * anything else (nothing found, nothing to do) ends quietly. A thrown error is re-thrown.
   */
  async function task(btn, fn) {
    if (!btn || btn.classList.contains('is-busy')) return undefined;
    btn.classList.remove('is-ok', 'is-bad');
    btn.classList.add('is-busy');
    const t0 = performance.now();
    let res;
    let err = null;
    try {
      res = await fn();
    } catch (e) {
      err = e;
    }
    const left = 450 - (performance.now() - t0);
    if (left > 0) await sleep(left);
    btn.classList.remove('is-busy');
    const cls = err || res === false ? 'is-bad' : res === true ? 'is-ok' : '';
    if (cls && !reduced()) {
      btn.classList.add(cls);
      setTimeout(() => btn.classList.remove(cls), 1100);
    }
    if (err) throw err;
    return res;
  }

  // ----------------------------------------------------------------- data link

  const LABEL = { tx: 'Sending', rx: 'Reading', ok: 'Done', warn: 'Check result', bad: 'Failed' };
  let mode = '';
  let clearTimer = 0;

  function paint(next, text) {
    mode = next;
    const stage = $('.stage');
    const chip = $('#connChip');
    const sb = $('#sbTx');
    if (stage) stage.dataset.link = next;
    if (chip) chip.dataset.link = next;
    if (sb) {
      sb.hidden = !next;
      sb.dataset.k = next;
      if (next) sb.querySelector('b').textContent = text || LABEL[next] || '';
    }
  }

  /**
   * Sets the link state: 'tx', 'rx' (stay until changed), 'ok', 'warn', 'bad' (clear themselves after a moment), or
   * '' / null for off. `text` is the label on the status bar chip.
   */
  function link(next, text) {
    clearTimeout(clearTimer);
    next = next || '';
    // With reduced motion the stage animation is switched off by the style sheet; the status chip still says what is happening.
    paint(next, text);
    if (next === 'ok' || next === 'warn' || next === 'bad') {
      clearTimer = setTimeout(() => {
        if (mode === next) paint('');
      }, next === 'ok' ? 1300 : 1900);
    }
  }

  /** Changes the status chip's label (for example the percentage) without restarting anything. */
  function label(text) {
    const sb = $('#sbTx');
    if (sb && mode) sb.querySelector('b').textContent = text;
  }

  /** The engine is writing (apply or restore): keep the link in "tx". It only ever clears a "tx" it set itself. */
  function writing(on) {
    if (on && mode !== 'tx') link('tx', 'Sending');
    else if (!on && mode === 'tx') link('');
  }

  window.AulaMotion = { ripple, flash, task, link, label, writing, reduced, mode: () => mode };
})();
