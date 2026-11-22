// Liquid glass motion: the behaviour behind css/glass-motion.css. It only runs while the Liquid glass UI is on and the
// system has not asked for reduced motion; it puts class "ag-fx" on <html> for as long as it is running.
//
//   press       A glass button, pill or tile swells under the pointer, a light follows the pointer across it, and on
//               release it rebounds on a spring (.glassEffect(.interactive()), .buttonStyle(.glass)).
//   liquid      The tab pill and the highlight of a segmented control stretch along the way and squash across while they
//               travel (the droplet of GlassEffectContainer / glassEffectID): the script measures how fast the
//               highlight is really moving and hands CSS that pace as --lv.
//   tabs        Scrolling down folds the tab bar to the active tab, scrolling up (or pointing at it) opens it again
//               (.tabBarMinimizeBehavior(.onScrollDown)).
//   menus       The dropdown and the Support menu grow out of their button, position, size and corner radius together,
//               and fold back into it (.glassEffectID + matchedGeometryEffect).
//   toasts      The toast stack flows into the room a toast leaves.
//
// Everything is made of transform-like properties (translate, scale) and opacity, never layout, except the folding tab
// bar, which has to change width. The pure helpers at the top are what the tests exercise.
(() => {
  'use strict';

  // ------------------------------------------------------------------------------------------ pure helpers

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // How far a control swells under a finger. The growth is about 6 px along the long side, so a small button swells
  // visibly (up to 12 %) and a wide tile barely (at least 2 %).
  function swellFor(w, h) {
    return clamp(1 + 6 / Math.max(w, h, 1), 1.02, 1.12);
  }

  // A computed `translate` along x as pixels. Chrome keeps percentages in it ("calc(124.9% + 5px)", "50%"), so they are
  // resolved against the width of the box. "none" is 0.
  function translateX(value, basis) {
    if (!value || value === 'none') return 0;
    const s = String(value).trim();
    let x = s;
    if (s.startsWith('calc(')) {
      let depth = 0;
      let i = 0;
      for (; i < s.length; i++) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')' && --depth === 0) {
          i++;
          break;
        }
      }
      x = s.slice(0, i);
    } else {
      x = s.split(/\s+/)[0];
    }
    const re = /([+-]?)\s*(\d*\.?\d+(?:e[-+]?\d+)?)(%|px)/gi;
    let sum = 0;
    let m;
    while ((m = re.exec(x))) {
      const n = parseFloat(m[2]) * (m[1] === '-' ? -1 : 1);
      sum += m[3] === '%' ? (n * basis) / 100 : n;
    }
    return sum;
  }

  // One frame of the highlight's pace (px per 60 Hz frame), smoothed so a single odd frame does not twitch the stretch.
  const easePace = (prev, raw, frames) => prev + (raw - prev) * (1 - Math.pow(0.6, frames));
  // The pace as -1..1, what CSS reads as --lv (the stretch uses its size, so direction does not matter there).
  const stretchOf = (pace, norm) => clamp(pace / norm, -1, 1);

  // The tab bar's reaction to a scroll. state { min, acc } -> next state. acc is the distance travelled in the current
  // direction: 24 px down (and past the first 48) folds the bar, 14 px up or the very top opens it.
  function scrollIntent(state, top, delta) {
    let min = !!state.min;
    let acc = state.acc || 0;
    if (top <= 8) return { min: false, acc: 0 };
    if (delta > 0) {
      acc = acc > 0 ? acc + delta : delta;
      if (!min && top > 48 && acc >= 24) min = true;
    } else if (delta < 0) {
      acc = acc < 0 ? acc + delta : delta;
      if (min && acc <= -14) min = false;
    }
    return { min, acc };
  }

  // What it takes to make a box at `to` look like the box `from` (both { left, top, width, height }): a transform, and a
  // corner radius written as an ellipse so that the corners still look round once the box is squeezed.
  function flip(from, to, fromRadius, toRadius) {
    const sx = clamp(from.width / (to.width || 1), 0.05, 1.5);
    const sy = clamp(from.height / (to.height || 1), 0.05, 1.5);
    const rx = Math.min(fromRadius / sx, to.width / 2);
    const ry = Math.min(fromRadius / sy, to.height / 2);
    return {
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`,
      radius: `${rx}px / ${ry}px`,
      toRadius: `${toRadius}px`,
    };
  }

  const api = { swellFor, translateX, easePace, stretchOf, scrollIntent, flip, clamp };
  if (typeof window !== 'undefined') window.AulaGlassMotion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------------------------------------- setup

  const doc = document;
  const root = doc.documentElement;
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const SCROLLERS = '.panels, #maxRoot';

  // The spring curves live in the stylesheet (--ag-spring-*, --ag-t-*); the script reads them from there so that there
  // is one set of numbers.
  const FALLBACK_EASE = {
    bouncy: 'cubic-bezier(0.3, 1.4, 0.5, 1)',
    snappy: 'cubic-bezier(0.3, 1.2, 0.5, 1)',
    smooth: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    press: 'cubic-bezier(0.2, 0.9, 0.3, 1.1)',
    wobble: 'cubic-bezier(0.3, 1.6, 0.5, 1)',
  };
  const FALLBACK_MS = { bouncy: 650, snappy: 560, smooth: 600, press: 200, wobble: 750 };
  const easeCache = {};
  const msCache = {};

  function ease(name) {
    if (easeCache[name]) return easeCache[name];
    let v = '';
    try {
      v = getComputedStyle(root).getPropertyValue(`--ag-spring-${name}`).trim();
    } catch (_) {
      /* fall back below */
    }
    if (!v || !(window.CSS && CSS.supports && CSS.supports('animation-timing-function', v))) v = FALLBACK_EASE[name];
    return (easeCache[name] = v);
  }

  function ms(name) {
    if (msCache[name]) return msCache[name];
    let v = 0;
    try {
      const t = getComputedStyle(root).getPropertyValue(`--ag-t-${name}`).trim();
      v = t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000;
    } catch (_) {
      /* fall back below */
    }
    return (msCache[name] = v > 0 ? v : FALLBACK_MS[name]);
  }

  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  // --------------------------------------------------------------------------------------------------- press

  function pressModule() {
    const SEL = '.btn, .pill-btn, .win-btn, .day, .ka-chip, .ka-key, .sp-card, .effect';
    const held = new Map(); // element -> { anim, lit, fixed }
    const rebound = new Map(); // element -> the rebound animation that is still playing

    const scaleOf = (el) => {
      const s = getComputedStyle(el).scale;
      return s === 'none' ? 1 : parseFloat(s) || 1;
    };

    const hostOf = (target) => {
      const el = target instanceof Element ? target.closest(SEL) : null;
      if (!el || !el.classList.contains('ag') || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
      return el.offsetWidth > 0 ? el : null;
    };

    function makeLit(el, x, y) {
      if (el.tagName === 'SELECT') return null;
      const lit = doc.createElement('i');
      lit.className = 'ag-lit';
      lit.setAttribute('aria-hidden', 'true');
      lit.style.setProperty('--lx', `${x.toFixed(1)}px`);
      lit.style.setProperty('--ly', `${y.toFixed(1)}px`);
      lit.style.setProperty('--lr', `${clamp(Math.max(el.offsetWidth, el.offsetHeight) * 0.85, 46, 150).toFixed(0)}px`);
      el.append(lit);
      lit.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
      return lit;
    }

    function down(el, clientX, clientY) {
      if (held.has(el)) return;
      const prev = rebound.get(el);
      const from = scaleOf(el);
      if (prev) {
        prev.cancel();
        rebound.delete(el);
      }
      // the light needs a positioned host; most are, the odd one that is not gets position: relative for the press
      let fixed = false;
      if (getComputedStyle(el).position === 'static') {
        el.style.position = 'relative';
        fixed = true;
      }
      const rect = el.getBoundingClientRect();
      const k = el.offsetWidth ? rect.width / el.offsetWidth : 1;
      const lit = makeLit(el, (clientX - rect.left) / (k || 1), (clientY - rect.top) / (k || 1));
      const anim = el.animate([{ scale: from }, { scale: swellFor(el.offsetWidth, el.offsetHeight) }], {
        duration: ms('press'),
        easing: ease('press'),
        fill: 'forwards',
      });
      held.set(el, { anim, lit, fixed, k: k || 1 });
    }

    function up(el) {
      const st = held.get(el);
      if (!st) return;
      held.delete(el);
      const from = scaleOf(el);
      st.anim.cancel();
      const back = el.animate([{ scale: from }, { scale: 1 }], { duration: ms('wobble'), easing: ease('wobble') });
      rebound.set(el, back);
      const done = () => {
        if (rebound.get(el) === back) rebound.delete(el);
        if (st.fixed && !held.has(el)) el.style.position = '';
      };
      back.onfinish = done;
      back.oncancel = done;
      if (st.lit) {
        const lit = st.lit;
        const fade = lit.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-out', fill: 'forwards' });
        fade.onfinish = () => lit.remove();
        fade.oncancel = () => lit.remove();
        setTimeout(() => lit.remove(), 1200); // in case the page is not painting (a hidden window) and the fade never ends
      }
    }

    const onDown = (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      const el = hostOf(e.target);
      if (el) down(el, e.clientX, e.clientY);
    };
    const onMove = (e) => {
      for (const [el, st] of held) {
        if (!st.lit) continue;
        const rect = el.getBoundingClientRect();
        st.lit.style.setProperty('--lx', `${((e.clientX - rect.left) / st.k).toFixed(1)}px`);
        st.lit.style.setProperty('--ly', `${((e.clientY - rect.top) / st.k).toFixed(1)}px`);
      }
    };
    const releaseAll = () => {
      for (const el of Array.from(held.keys())) up(el);
    };
    const onKeyDown = (e) => {
      if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
      const el = hostOf(e.target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      down(el, r.left + r.width / 2, r.top + r.height / 2);
    };
    const onKeyUp = (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const el = e.target instanceof Element ? e.target.closest(SEL) : null;
      if (el) up(el);
    };

    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', releaseAll, true);
    window.addEventListener('pointercancel', releaseAll, true);
    window.addEventListener('blur', releaseAll);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('keyup', onKeyUp, true);

    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', releaseAll, true);
      window.removeEventListener('pointercancel', releaseAll, true);
      window.removeEventListener('blur', releaseAll);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('keyup', onKeyUp, true);
      for (const [el, st] of held) {
        st.anim.cancel();
        if (st.lit) st.lit.remove();
        if (st.fixed) el.style.position = '';
      }
      held.clear();
      for (const a of rebound.values()) a.cancel();
      rebound.clear();
    };
  }

  // -------------------------------------------------------------------------------------------------- liquid

  function liquidModule() {
    const NORM = 6; // px per frame that counts as full speed
    const live = new Map(); // element -> tracker

    function readX(el, pseudo) {
      const cs = getComputedStyle(el, pseudo);
      return translateX(cs.translate, parseFloat(cs.width) || el.offsetWidth || 0);
    }

    function track(el, pseudo) {
      if (!el || live.has(el)) return;
      const now0 = performance.now();
      const st = { x: readX(el, pseudo), pace: 0, t: now0, begun: now0, idle: 0, raf: 0 };
      live.set(el, st);
      const tick = (now) => {
        if (!el.isConnected) {
          live.delete(el);
          return;
        }
        const frames = clamp((now - st.t) / 16.7, 0.25, 6);
        const x = readX(el, pseudo);
        const raw = (x - st.x) / frames;
        st.pace = easePace(st.pace, raw, frames);
        st.x = x;
        st.t = now;
        el.style.setProperty('--lv', stretchOf(st.pace, NORM).toFixed(3));
        st.idle = Math.abs(st.pace) < 0.05 && Math.abs(raw) < 0.05 ? st.idle + 1 : 0;
        if (st.idle >= 4 && now - st.begun > 120) {
          el.style.removeProperty('--lv');
          live.delete(el);
          return;
        }
        st.raf = requestAnimationFrame(tick);
      };
      st.raf = requestAnimationFrame(tick);
    }

    // A transition of the highlight starts (a click, a key, the code moving the selection).
    const onRun = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || e.propertyName !== 'translate') return;
      if (!e.pseudoElement && t.matches('.tab-ind')) track(t, null);
      else if (e.pseudoElement === '::before' && t.matches('.seg')) track(t, '::before');
    };
    // The highlight follows a finger with no transition at all; the moves tell that it is travelling.
    const onMove = (e) => {
      const host = e.target instanceof Element ? e.target.closest('.tabs.is-dragging, .seg.is-dragging') : null;
      if (!host) return;
      if (host.classList.contains('tabs')) track(doc.getElementById('tabInd'), null);
      else track(host, '::before');
    };
    doc.addEventListener('transitionrun', onRun, true);
    doc.addEventListener('pointermove', onMove, true);

    return () => {
      doc.removeEventListener('transitionrun', onRun, true);
      doc.removeEventListener('pointermove', onMove, true);
      for (const [el, st] of live) {
        cancelAnimationFrame(st.raf);
        el.style.removeProperty('--lv');
      }
      live.clear();
    };
  }

  // ---------------------------------------------------------------------------------------------------- tabs

  function tabsModule() {
    const bar = doc.querySelector('.tabs');
    const ind = doc.getElementById('tabInd');
    if (!bar || !ind) return () => {};
    let state = { min: false, acc: 0 };
    let near = false; // the pointer or the keyboard focus is on the bar
    let syncRaf = 0;
    const lastTop = new WeakMap();

    const selected = () => bar.querySelector('.tab-btn[aria-selected="true"]');

    // While the bar changes width the lens is placed on the active tab frame by frame (its own slide is off).
    function follow(duration) {
      cancelAnimationFrame(syncRaf);
      bar.classList.add('is-morph');
      const end = performance.now() + duration;
      const loop = (t) => {
        const b = selected();
        if (b) {
          ind.style.setProperty('--x', `${b.offsetLeft}px`);
          ind.style.setProperty('--w', `${b.offsetWidth}px`);
        }
        if (t < end) syncRaf = requestAnimationFrame(loop);
        else bar.classList.remove('is-morph');
      };
      syncRaf = requestAnimationFrame(loop);
    }

    function apply(min) {
      if (min && !selected()) min = false; // no tab is active (Battery screen): nothing to fold into
      if (bar.classList.contains('is-min') === min) return;
      bar.classList.toggle('is-min', min);
      follow(ms('snappy') + 160);
    }

    const onScroll = (e) => {
      const area = e.target;
      if (near || !(area instanceof Element) || !area.matches(SCROLLERS)) return;
      const top = area.scrollTop;
      const before = lastTop.has(area) ? lastTop.get(area) : 0; // a page starts at its top
      lastTop.set(area, top);
      state = scrollIntent(state, top, top - before);
      apply(state.min);
    };
    const open = () => {
      near = true;
      state = { min: false, acc: 0 };
      apply(false);
    };
    const onLeave = () => {
      near = bar.matches(':focus-within');
    };
    // The selection moved while the bar is folded: the other tab takes the place of the first.
    const mo = new MutationObserver(() => {
      if (bar.classList.contains('is-min')) follow(ms('snappy') + 160);
    });
    mo.observe(bar, { attributes: true, attributeFilter: ['aria-selected'], subtree: true });

    doc.addEventListener('scroll', onScroll, true);
    bar.addEventListener('pointerenter', open);
    bar.addEventListener('focusin', open);
    bar.addEventListener('pointerleave', onLeave);
    bar.addEventListener('focusout', () => setTimeout(onLeave, 0));

    return () => {
      doc.removeEventListener('scroll', onScroll, true);
      bar.removeEventListener('pointerenter', open);
      bar.removeEventListener('focusin', open);
      bar.removeEventListener('pointerleave', onLeave);
      mo.disconnect();
      cancelAnimationFrame(syncRaf);
      bar.classList.remove('is-min', 'is-morph');
    };
  }

  // ---------------------------------------------------------------------------------------------------- menus

  function menuModule() {
    const pops = ['selPop', 'supPop'].map((id) => doc.getElementById(id)).filter(Boolean);
    if (!pops.length) return () => {};
    const open = new Map(); // menu -> { trigger, rect, radius } while it is open

    const triggerOf = (pop) =>
      pop.id === 'selPop'
        ? doc.querySelector('[aria-controls="selPop"][aria-expanded="true"]')
        : doc.querySelector('[data-support][aria-expanded="true"]');
    const radiusOf = (el, fallback, max) => {
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return Math.min(Number.isFinite(r) ? r : fallback, max);
    };
    const plain = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });

    function onOpen(pop) {
      const trigger = triggerOf(pop);
      let i = 0;
      for (const row of pop.querySelectorAll('.sel-item, .sup-head, .sup-item')) row.style.setProperty('--i', String(i++));
      if (!trigger) return;
      const to = plain(pop.getBoundingClientRect());
      const from = plain(trigger.getBoundingClientRect());
      if (!to.width || !to.height) return;
      const toRadius = radiusOf(pop, 20, 1e4);
      // The animation below squeezes the corners into the button's. js/glass.js builds the menu's glass filter a frame later, while
      // they are still squeezed, and would size the filter's corners to that (a 14px menu got 52px corners, and kept them): so it is
      // told here which radius the menu settles at, and reads that one (cornerOf in glass.js).
      pop.style.setProperty('--ag-rest-r', `${toRadius}px`);
      open.set(pop, { trigger, rect: to, radius: toRadius });
      const f = flip(from, to, radiusOf(trigger, 12, from.height / 2), toRadius);
      pop.animate(
        [
          { transformOrigin: '0 0', transform: f.transform, borderRadius: f.radius },
          { transformOrigin: '0 0', transform: 'none', borderRadius: f.toRadius },
        ],
        { duration: ms('bouncy'), easing: ease('bouncy') },
      );
    }

    // The menu is hidden the moment it closes, so a copy of it folds back into the button.
    function onClose(pop) {
      const st = open.get(pop);
      if (!st || !pop.parentNode) return;
      open.delete(pop);
      const from = plain(st.trigger.getBoundingClientRect());
      if (!from.width) return;
      const ghost = pop.cloneNode(true);
      ghost.hidden = false;
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.classList.add('ag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      pop.parentNode.append(ghost);
      const f = flip(from, st.rect, radiusOf(st.trigger, 12, from.height / 2), st.radius);
      const gone = () => ghost.remove();
      const a = ghost.animate(
        [
          { transformOrigin: '0 0', transform: 'none', borderRadius: f.toRadius, opacity: 1 },
          { transformOrigin: '0 0', transform: 'none', borderRadius: f.toRadius, opacity: 1, offset: 0.35 },
          { transformOrigin: '0 0', transform: f.transform, borderRadius: f.radius, opacity: 0 },
        ],
        { duration: 300, easing: ease('smooth'), fill: 'forwards' },
      );
      for (const c of Array.from(ghost.children)) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
      a.onfinish = gone;
      a.oncancel = gone;
      setTimeout(gone, 700);
    }

    const mo = new MutationObserver((list) => {
      for (const pop of new Set(list.map((r) => r.target))) (pop.hidden ? onClose : onOpen)(pop);
    });
    for (const pop of pops) mo.observe(pop, { attributes: true, attributeFilter: ['hidden'] });
    return () => {
      mo.disconnect();
      open.clear();
      doc.querySelectorAll('.ag-ghost').forEach((g) => g.remove());
    };
  }

  // --------------------------------------------------------------------------------------------------- toasts

  function toastModule() {
    const box = doc.getElementById('toasts');
    if (!box) return () => {};
    let tops = new Map(); // toast -> where it sat, in the box
    const snap = () => {
      tops = new Map(Array.from(box.children).map((c) => [c, c.offsetTop]));
    };
    snap();
    const mo = new MutationObserver(() => {
      for (const c of Array.from(box.children)) {
        if (!tops.has(c)) continue; // a new toast comes in with its own entrance
        const dy = tops.get(c) - c.offsetTop;
        if (Math.abs(dy) < 1) continue;
        c.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: ms('bouncy'), easing: ease('bouncy') });
      }
      snap();
    });
    mo.observe(box, { childList: true });
    return () => mo.disconnect();
  }

  // ------------------------------------------------------------------------------------------- on and off

  let stop = null;

  function sync() {
    const want = root.classList.contains('glass') && canAnimate && !(motionQuery && motionQuery.matches);
    if (want && !stop) {
      root.classList.add('ag-fx');
      const parts = [pressModule, liquidModule, tabsModule, menuModule, toastModule].map((make) => {
        try {
          return make();
        } catch (err) {
          if (window.console) console.warn('glass motion:', err); // one part failing must not take the others down
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
      root.classList.remove('ag-fx');
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
