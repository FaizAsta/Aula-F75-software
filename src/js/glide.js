/*
 * Devices -> app and app -> devices: the glide.
 *
 * Pressing the keyboard on the "Connected devices" screen used to fade the whole screen away (it grew and blurred) while the
 * app faded in underneath: two separate scenes. Now it is one movement. The keyboard picture lifts out of its box, travels up
 * and shrinks into the preview at the top of the Lighting page, and lands exactly on the live keyboard, which takes over from it.
 * While it travels, the rest of the device screen goes (the title, the arrows, the dots, the buttons and the box itself) and the
 * rest of the app arrives (the header drops in, the preview opens, the effect cards rise one after another).
 *
 *   const flight = AulaGlide.begin(slide);   // BEFORE the screen changes: measures, copies the picture, hides the original
 *   ... change the screen ...
 *   if (flight) flight.play();                // AFTER: starts every movement
 *   AulaGlide.end();                          // puts everything back (it also does this by itself when the glide is over)
 *
 * begin() returns null when there is nothing to glide (reduced motion, the picture is not drawn yet, no preview to land on);
 * the caller then uses the old fade. Everything here is the Web Animations API on top of the page's own styles, so no
 * state of the page is changed: when an animation ends it is cancelled and the element is back to what its CSS says.
 * css/glide.css holds the few rules that stop the old fade from fighting this one (they all hang on .shell.gliding).
 *
 * App -> devices: the same glide the other way round (pressing the Aula logo in the app). The picture lifts out of the preview,
 * travels down and grows back into the box of the device screen, while the app goes and the device screen arrives piece by piece.
 *
 *   const back = AulaGlide.beginBack();       // BEFORE the screen changes (holds the old fade off); null when there is nothing to glide
 *   ... change the screen, build the device list and draw its pictures ...
 *   if (back) back.play(slide);               // AFTER: measures both ends and starts every movement (false: it could not, old fade)
 */
(() => {
  'use strict';

  const FLY = 820; // ms the picture takes to travel
  const LAND = 640; // ms into the glide when the live keyboard starts to show through the picture
  const END = 1250; // ms until everything is put back
  const GLIDE = 'cubic-bezier(0.45, 0.05, 0.2, 1)'; // lifts off softly, travels, and settles for a long time
  const SOFT = 'cubic-bezier(0.2, 0.7, 0.2, 1)'; // the app's own --ease
  const LEAVE = 'cubic-bezier(0.4, 0, 0.6, 1)'; // things that go

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let live = null; // the glide that is under way (there is only ever one)

  /**
   * The two kinds of movement a glide is made of, recording every animation in `anims` so end() can cancel them all.
   * `enter` animates from the given look to whatever the page's styles say (one keyframe at offset 0: the other end is the element
   * as it is; without the offset a lone keyframe is taken as the END of the animation, which would run it backwards),
   * `leave` animates to the given look and stays there until the glide is over.
   */
  function movers(anims) {
    return {
      enter(el, look, delay, duration, easing = SOFT) {
        if (el) anims.push(el.animate([{ ...look, offset: 0 }], { delay, duration, easing, fill: 'backwards' }));
      },
      leave(el, look, delay, duration) {
        if (el && !el.hidden) anims.push(el.animate([{ opacity: 1 }, look], { delay, duration, easing: LEAVE, fill: 'forwards' }));
      },
    };
  }

  /** The picture of the box as a loose canvas (a copy: the original stays where it is), or null when it cannot be copied. */
  function copyOf(src) {
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    try {
      cv.getContext('2d').drawImage(src, 0, 0);
    } catch (_) {
      return null;
    }
    return cv;
  }

  /**
   * Where the keyboard picture has to land: the rectangle the preview draws the case in, in window pixels. For the F75 family
   * that is worked out from the preview's own layout (the same numbers preview.js draws with), so the picture lands exactly on
   * the live one. The F75 Max and F75 HE are drawn by that same preview, but it is still showing the F75 layout when the glide
   * starts, so their size comes from the layout they are about to switch to (view.fitFor).
   */
  function target(slide, aspect, stage) {
    const sr = stage.getBoundingClientRect();
    if (sr.width < 160 || sr.height < 90) return null;
    const A = window.aulaApp;
    const DP = window.AulaDevPic;
    const man = window.AulaBoardManifest;
    const host = $('.stage-canvas', stage);
    const id = slide.dataset.pic;
    const view = A && A.view;
    if (view && view.layout && view.layout.u > 0 && DP && man && host) {
      const model = DP.modelOf(id);
      const fr = DP.frameOf(man, model.skin);
      if (fr) {
        const hr = host.getBoundingClientRect();
        const { u, ox, oy } = id === 'max' || id === 'he' ? view.fitFor(model.w, model.h) : view.layout;
        const w = fr.across * u;
        const h = w / fr.aspect;
        if (w > 60 && w <= sr.width * 1.1 && h <= sr.height * 1.1) {
          return { left: hr.left + ox - fr.ox * u, top: hr.top + oy - fr.oy * u, width: w, height: h };
        }
      }
    }
    // No live picture to land on (too small, or no pictures): centred in the stage, clear of the chips along its foot.
    const aw = sr.width - 32;
    const ah = sr.height - 50;
    const w = Math.min(aw, ah * aspect);
    const h = w / aspect;
    return { left: sr.left + 16 + (aw - w) / 2, top: sr.top + 12 + (ah - h) / 2, width: w, height: h };
  }

  /**
   * Starts a glide for the keyboard `slide` (a .hm-dev of the big box). Call it before the screen changes.
   * Returns { play, end, landAt } or null when the old fade should be used instead.
   */
  function begin(slide) {
    end();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !slide || typeof Element.prototype.animate !== 'function') return null;
    const shell = $('.shell');
    const home = $('#home');
    const stage = $('.stage');
    const src = $('.hm-pic', slide);
    const wrap = src && src.parentElement;
    if (!shell || !home || !stage || !src || !wrap || wrap.dataset.ready !== '1') return null; // the picture has to be on screen already
    const from = src.getBoundingClientRect();
    if (from.width < 80 || from.height < 40) return null;
    const to = target(slide, from.width / from.height, stage);
    if (!to) return null;

    // The ghost: a copy of the picture, laid exactly over the original, which then steps out of the way.
    const ghost = document.createElement('div');
    ghost.className = 'glide-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const cv = copyOf(src);
    if (!cv) return null;
    ghost.append(cv);
    const sh = shell.getBoundingClientRect();
    ghost.style.left = `${from.left - sh.left}px`;
    ghost.style.top = `${from.top - sh.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    shell.append(ghost);
    src.style.visibility = 'hidden';
    shell.classList.add('gliding');

    const f = { forward: true, shell, home, slide, src, ghost, from, to, anims: [], timer: 0, landAt: LAND + 60, play: null, end };
    f.play = () => play(f);
    live = f;
    f.timer = setTimeout(end, END);
    return f;
  }

  function play(f) {
    if (f !== live) return;
    const { home, slide, ghost, from, to, anims } = f;
    const { enter, leave } = movers(anims);

    // ---- the picture: from its box to the preview
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    anims.push(
      ghost.animate(
        [{ transform: 'translate(0px, 0px) scale(1, 1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})` }],
        { duration: FLY, easing: GLIDE, fill: 'forwards' },
      ),
    );
    // It melts into the live keyboard: the live one comes up a little sooner than the copy goes, so the picture never dips.
    anims.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { delay: LAND + 70, duration: 300, easing: 'linear', fill: 'forwards' }));
    enter($('.stage-canvas'), { opacity: 0 }, LAND, 260, 'linear');

    // ---- the device screen goes
    leave($('.hd-head', home), { opacity: 0, translate: '0 -14px' }, 0, 300);
    leave($('.hm-prev', home), { opacity: 0, translate: '-18px 0' }, 0, 260);
    leave($('.hm-next', home), { opacity: 0, translate: '18px 0' }, 0, 260);
    leave($('.hm-dots', home), { opacity: 0 }, 0, 220);
    leave($('.hm-actions', home), { opacity: 0, translate: '0 16px' }, 0, 280);
    leave($('.hm-back', home), { opacity: 0, translate: '-8px 0' }, 0, 220);
    leave($('.hm-radar', home), { opacity: 0 }, 0, 220);
    leave(slide, { opacity: 0, scale: '0.985' }, 40, 360); // the box (its picture is already hidden: the ghost has it)
    leave($('.hm-dev-foot', slide), { opacity: 0, translate: '0 8px' }, 0, 240);

    // ---- the app arrives
    $$('.top > *').forEach((el, i) => enter(el, { opacity: 0, translate: '0 -12px' }, 140 + i * 70, 520));
    enter($('.stage'), { opacity: 0, translate: '0 16px', scale: '0.985' }, 90, 620);
    $$('.stage-bar, .stage-view').forEach((el) => enter(el, { opacity: 0, translate: '0 6px' }, LAND - 120, 440));
    // the page below the preview: its blocks rise one after another, then the effect cards ripple in
    let blocks = $$('.panel:not([hidden]) .split > *');
    if (!blocks.length) blocks = $$('.panel:not([hidden]) > *').slice(0, 6);
    blocks.forEach((el, i) => enter(el, { opacity: 0, translate: '0 26px' }, 300 + i * 90, 560));
    $$('.panel:not([hidden]) .effect')
      .slice(0, 40)
      .forEach((el, i) => enter(el, { opacity: 0, translate: '0 12px', scale: '0.94' }, 420 + Math.min(i, 14) * 28, 480));
  }

  /**
   * Starts the glide back, app -> devices. Call it BEFORE the screen changes: it only switches on the rules that hold the old
   * fade off (css/glide.css, .shell.gliding.back). Nothing can be measured yet, because the device list is built when the screen
   * opens, so the flight itself starts in play(slide). Returns { play } or null when the old fade should be used instead.
   */
  function beginBack() {
    end();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shell = $('.shell');
    const home = $('#home');
    const stage = $('.stage');
    if (reduce || typeof Element.prototype.animate !== 'function' || !shell || !home || !stage) return null;
    const sr = stage.getBoundingClientRect();
    if (sr.width < 160 || sr.height < 90) return null; // this page of the app has no keyboard picture to fly from
    const f = { shell, home, stage, src: null, ghost: null, anims: [], timer: 0, landAt: LAND + 60, play: null, end };
    f.play = (slide) => playBack(f, slide);
    live = f;
    f.timer = setTimeout(end, END);
    shell.classList.add('gliding', 'back');
    return f;
  }

  /**
   * The flight back. `slide` is the keyboard of the box that the picture lands in (already built and drawn). The picture is a copy
   * of the box's own picture, laid over the live keyboard of the preview; it takes over from it, travels to the box, and the box's
   * own picture takes over from the copy. Returns false (after putting the old fade's look back) when it cannot fly.
   */
  function playBack(f, slide) {
    if (f !== live) return false;
    const { shell, home, stage, anims } = f;
    const fail = () => {
      end();
      // what the plain fade would have done: the layer and the screen come up where they stand
      const sc = $('.scr-devices', home);
      if (sc) sc.animate([{ opacity: 0, transform: 'translateY(26px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: SOFT });
      home.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: SOFT });
      return false;
    };
    const src = slide && $('.hm-pic', slide);
    const wrap = src && src.parentElement;
    if (!src || !wrap || wrap.dataset.ready !== '1') return fail(); // the picture of the box has to be drawn already
    const to = src.getBoundingClientRect(); // where it lands: its place in the box
    if (to.width < 80 || to.height < 40) return fail();
    const from = target(slide, to.width / to.height, stage); // where it starts: the live keyboard of the preview
    if (!from || from.top + from.height < 40 || from.top > window.innerHeight - 40) return fail(); // scrolled out of sight
    const cv = copyOf(src);
    if (!cv) return fail();

    const ghost = document.createElement('div');
    ghost.className = 'glide-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.append(cv);
    const sh = shell.getBoundingClientRect();
    ghost.style.left = `${from.left - sh.left}px`;
    ghost.style.top = `${from.top - sh.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    shell.append(ghost);
    f.ghost = ghost;
    f.src = src;

    const { enter, leave } = movers(anims);

    // ---- the picture: from the preview to its box
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    anims.push(
      ghost.animate(
        [{ transform: 'translate(0px, 0px) scale(1, 1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${to.width / from.width}, ${to.height / from.height})` }],
        { duration: FLY, easing: GLIDE, fill: 'forwards' },
      ),
    );
    // It melts in over the live keyboard a little before that one goes, so the picture never dips...
    anims.push(ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear', fill: 'both' }));
    leave($('.stage-canvas'), { opacity: 0 }, 110, 200);
    // ...and at the other end the box's own picture comes up under the copy, which then goes.
    enter(src, { opacity: 0 }, LAND, 260, 'linear');
    anims.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { delay: LAND + 70, duration: 300, easing: 'linear', fill: 'forwards' }));

    // ---- the app goes
    $$('.top > *').forEach((el, i) => leave(el, { opacity: 0, translate: '0 -12px' }, i * 35, 260));
    leave(stage, { opacity: 0, translate: '0 14px', scale: '0.985' }, 90, 340);
    let blocks = $$('.panel:not([hidden]) .split > *');
    if (!blocks.length) blocks = $$('.panel:not([hidden]) > *').slice(0, 6);
    blocks.forEach((el, i) => leave(el, { opacity: 0, translate: '0 22px' }, 30 + i * 45, 300));

    // ---- the device screen arrives
    enter(home, { opacity: 0 }, 0, 420, SOFT);
    enter($('.hm-back', home), { opacity: 0, translate: '-8px 0' }, 360, 340);
    enter($('.hd-head', home), { opacity: 0, translate: '0 -14px' }, 280, 440);
    enter($('.hm-radar', home), { opacity: 0 }, 300, 340);
    enter(slide, { opacity: 0, scale: '0.985' }, 150, 480); // the box (its picture comes later: the copy has it)
    enter($('.hm-dev-foot', slide), { opacity: 0, translate: '0 8px' }, 520, 380);
    enter($('.hm-prev', home), { opacity: 0, translate: '-18px 0' }, 420, 380);
    enter($('.hm-next', home), { opacity: 0, translate: '18px 0' }, 420, 380);
    enter($('.hm-dots', home), { opacity: 0 }, 500, 320);
    enter($('.hm-actions', home), { opacity: 0, translate: '0 16px' }, 460, 420);
    return true;
  }

  /** Puts everything back as the page's own styles have it. Safe to call at any time, also when no glide is running. */
  function end() {
    const f = live;
    if (!f) return;
    live = null;
    clearTimeout(f.timer);
    for (const a of f.anims) {
      try {
        a.cancel();
      } catch (_) {
        /* already gone */
      }
    }
    if (f.ghost) f.ghost.remove();
    if (f.src && f.forward) f.src.style.visibility = '';
    f.shell.classList.remove('gliding', 'back');
  }

  window.AulaGlide = { begin, beginBack, end, active: () => !!live };
})();
