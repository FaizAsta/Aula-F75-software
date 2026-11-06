/*
 * The artwork of the keyboard picture: the case, the plate the keys sit in, the knob, and a single keycap. preview.js
 * adds everything that moves (the lighting, the pointer, key presses) on top.
 *
 * Everything here is drawn the way a photo reads: light comes from the top left, so top-left edges catch it and
 * bottom-right edges fall into shadow. The case has thickness and throws a soft shadow; the plate is a dark well with
 * an inner shadow; each keycap has a body, a bevel (chamfer), a dished top that is lighter at the top and darker at
 * the bottom, a soft highlight and a fine grain like PBT plastic.
 *
 * None of it depends on the lighting, so preview.js draws the case layer once and each keycap once (as a small
 * sprite per size and accent colour) and only blits them every frame. Both draw functions take any 2D context, so
 * the same code draws directly when an offscreen canvas can not be made (the tests run without one).
 *
 * Sizes are in pixels with u = the size of one key.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./skins.js'));
  else root.AulaBoardArt = factory(root.AulaSkins);
})(typeof self !== 'undefined' ? self : globalThis, function (S) {
  'use strict';

  const TAU = Math.PI * 2;
  const GAP = 0.05; // fraction of a key left between caps (the slot the light shows through)

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  const scale = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  const css = (c, a) => (a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);

  /** A canvas and its context, or null where none can be made (tests, or a context that refuses). */
  function offscreen(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx } : null;
    } catch (_) {
      return null;
    }
  }

  // A small tile of fine grain, made once. It is what gives the caps and the case a surface instead of a flat fill.
  let grain;
  function grainTile() {
    if (grain !== undefined) return grain;
    grain = null;
    const lay = offscreen(64, 64);
    if (lay && typeof lay.ctx.createImageData === 'function') {
      const id = lay.ctx.createImageData(64, 64);
      if (id && id.data) {
        let seed = 20241022;
        const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
        for (let i = 0; i < 64 * 64; i++) {
          const v = rnd() < 0.5 ? 0 : 255;
          id.data[i * 4] = v;
          id.data[i * 4 + 1] = v;
          id.data[i * 4 + 2] = v;
          id.data[i * 4 + 3] = Math.floor(rnd() * 30);
        }
        lay.ctx.putImageData(id, 0, 0);
        grain = lay.canvas;
      }
    }
    return grain;
  }
  /** Fills the current path with grain at `alpha` (clips to it). No-op without a grain tile. */
  function grainFill(ctx, x, y, w, h, alpha) {
    const tile = grainTile();
    const pat = tile && ctx.createPattern ? ctx.createPattern(tile, 'repeat') : null;
    if (!pat) return;
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------------------------- keycap

  /** Where the parts of one cap sit, relative to its top-left corner: the whole cap, and the face on top of it. */
  function capGeo(kw, kh, u) {
    const fl = u * 0.1;
    const ft = u * 0.06;
    const fb = u * 0.2;
    return { fl, ft, fb, fx: fl, fy: ft, fw: kw - fl * 2, fh: kh - ft - fb, r: u * 0.13, fr: u * 0.09 };
  }

  /**
   * One keycap at (x, y), kw x kh: soft contact shadow, body (the sides and the front lip, in the accent colour if the
   * key has one), a bevel, and the dished face.
   */
  function drawCap(ctx, skin, acc, x, y, kw, kh, u) {
    const g = capGeo(kw, kh, u);
    const bodyCols = acc ? acc.body : skin.cap.body;
    const faceCols = acc && acc.face ? acc.face : skin.cap.face; // an accent cap can be coloured on its face too
    const f0 = S.rgb(faceCols[0]);
    const f1 = S.rgb(faceCols[1]);
    const light = S.luma(f0) > 0.6; // a light cap shows shading as grey, a dark one as white

    // contact shadow on the slot floor: three soft layers, heavier below (light is from above)
    ctx.fillStyle = '#000';
    for (const [grow, a] of [[0.09, 0.1], [0.06, 0.14], [0.03, 0.18]]) {
      ctx.globalAlpha = a;
      roundRect(ctx, x - u * grow * 0.5, y + u * 0.03, kw + u * grow, kh + u * grow * 0.7, g.r + u * grow * 0.4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // body
    const body = ctx.createLinearGradient(0, y, 0, y + kh);
    body.addColorStop(0, bodyCols[0]);
    body.addColorStop(1, bodyCols[1]);
    ctx.fillStyle = body;
    roundRect(ctx, x, y, kw, kh, g.r);
    ctx.fill();
    // the sides: lit on the left, in shade on the right
    const sides = ctx.createLinearGradient(x, 0, x + kw, 0);
    sides.addColorStop(0, 'rgba(255,255,255,0.2)');
    sides.addColorStop(0.18, 'rgba(255,255,255,0)');
    sides.addColorStop(0.82, 'rgba(0,0,0,0)');
    sides.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = sides;
    roundRect(ctx, x, y, kw, kh, g.r);
    ctx.fill();
    // the front lip falls away into shade under the face
    const lip = ctx.createLinearGradient(0, y + g.fy + g.fh * 0.7, 0, y + kh);
    lip.addColorStop(0, 'rgba(0,0,0,0.38)');
    lip.addColorStop(0.6, 'rgba(0,0,0,0.1)');
    lip.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = lip;
    roundRect(ctx, x, y, kw, kh, g.r);
    ctx.fill();
    // a hairline round the edge: bright at the top left, dark at the bottom right
    const rim = ctx.createLinearGradient(x, y, x + kw, y + kh);
    rim.addColorStop(0, 'rgba(255,255,255,0.4)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    rim.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1;
    roundRect(ctx, x + 0.5, y + 0.5, kw - 1, kh - 1, g.r);
    ctx.stroke();

    // bevel: a slightly larger ring round the face, bright above and dark below
    const fx = x + g.fx;
    const fy = y + g.fy;
    const bv = u * 0.03;
    const bevel = ctx.createLinearGradient(0, fy - bv, 0, fy + g.fh + bv);
    bevel.addColorStop(0, light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)');
    bevel.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    bevel.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = bevel;
    roundRect(ctx, fx - bv, fy - bv, g.fw + bv * 2, g.fh + bv * 2, g.fr + bv);
    ctx.fill();

    // face
    const face = ctx.createLinearGradient(0, fy, 0, fy + g.fh);
    face.addColorStop(0, css(f0));
    face.addColorStop(1, css(f1));
    ctx.fillStyle = face;
    roundRect(ctx, fx, fy, g.fw, g.fh, g.fr);
    ctx.fill();
    ctx.save();
    roundRect(ctx, fx, fy, g.fw, g.fh, g.fr);
    ctx.clip();
    // dish: the top of the face catches the light, the bottom sinks into shade
    const dish = ctx.createLinearGradient(0, fy, 0, fy + g.fh);
    dish.addColorStop(0, 'rgba(255,255,255,0.2)');
    dish.addColorStop(0.35, 'rgba(255,255,255,0)');
    dish.addColorStop(1, light ? 'rgba(40,46,60,0.2)' : 'rgba(0,0,0,0.26)');
    ctx.fillStyle = dish;
    ctx.fillRect(fx, fy, g.fw, g.fh);
    // and the left is a touch brighter than the right
    const across = ctx.createLinearGradient(fx, 0, fx + g.fw, 0);
    across.addColorStop(0, 'rgba(255,255,255,0.08)');
    across.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = across;
    ctx.fillRect(fx, fy, g.fw, g.fh);
    // soft highlight, upper left
    const rad = Math.max(g.fw, g.fh) * 0.62;
    const spec = ctx.createRadialGradient(fx + g.fw * 0.28, fy + g.fh * 0.2, 0, fx + g.fw * 0.28, fy + g.fh * 0.2, rad);
    spec.addColorStop(0, 'rgba(255,255,255,0.22)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fillRect(fx, fy, g.fw, g.fh);
    ctx.restore();
    // grain on the face
    roundRect(ctx, fx, fy, g.fw, g.fh, g.fr);
    grainFill(ctx, fx, fy, g.fw, g.fh, light ? 0.25 : 0.32); // light enough not to speckle the legend on top
    // light catching the top edge, and a dark line where the face meets the front lip
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(ctx, fx + u * 0.05, fy + 0.5, Math.max(1, g.fw - u * 0.1), Math.max(1, u * 0.032), u * 0.02);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, fx + u * 0.04, fy + g.fh - 0.5, Math.max(1, g.fw - u * 0.08), Math.max(1, u * 0.03), u * 0.02);
    ctx.fill();
  }

  // ------------------------------------------------------------------------------------------------- knob

  function drawKnob(ctx, skin, kx, ky, u) {
    const kn = skin.knob;
    const r = u * kn.r;
    // the hole it sits in, shadowed at the top
    const well = ctx.createLinearGradient(0, ky - r - u * 0.12, 0, ky + r + u * 0.12);
    well.addColorStop(0, '#000');
    well.addColorStop(1, skin.slot);
    ctx.beginPath();
    ctx.arc(kx, ky, r + u * 0.1, 0, TAU);
    ctx.fillStyle = well;
    ctx.fill();
    // the metal ring: brushed (a conic sweep of light and dark) where the browser can draw one
    const cg = typeof ctx.createConicGradient === 'function' ? ctx.createConicGradient(-0.9, kx, ky) : null;
    ctx.beginPath();
    ctx.arc(kx, ky, r, 0, TAU);
    if (cg && cg.addColorStop) {
      const [a, b, c, d] = kn.ring;
      const seq = [a, c, b, d, a, c, b, d, a];
      seq.forEach((col, i) => cg.addColorStop(i / (seq.length - 1), col));
      ctx.fillStyle = cg;
    } else {
      const lin = ctx.createLinearGradient(kx - r, ky - r, kx + r, ky + r);
      kn.ring.forEach((col, i) => lin.addColorStop(i / (kn.ring.length - 1), col));
      ctx.fillStyle = lin;
    }
    ctx.fill();
    // knurling round the rim
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(0.6, u * 0.012);
    const ticks = 56;
    ctx.beginPath();
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * TAU;
      ctx.moveTo(kx + Math.cos(a) * r * 0.9, ky + Math.sin(a) * r * 0.9);
      ctx.lineTo(kx + Math.cos(a) * r, ky + Math.sin(a) * r);
    }
    ctx.stroke();
    // chamfer between the ring and the top disk
    const ch = ctx.createLinearGradient(kx - r, ky - r, kx + r, ky + r);
    ch.addColorStop(0, 'rgba(0,0,0,0.5)');
    ch.addColorStop(1, 'rgba(255,255,255,0.45)');
    ctx.beginPath();
    ctx.arc(kx, ky, r * 0.8, 0, TAU);
    ctx.strokeStyle = ch;
    ctx.lineWidth = Math.max(1, u * 0.045);
    ctx.stroke();
    // top disk with a soft highlight and fine machining rings
    const disk = ctx.createRadialGradient(kx - r * 0.3, ky - r * 0.35, 0, kx, ky, r * 0.78);
    disk.addColorStop(0, skin.knob.dent);
    disk.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(kx, ky, r * 0.76, 0, TAU);
    ctx.fillStyle = skin.knob.face;
    ctx.fill();
    ctx.fillStyle = disk;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (const f of [0.6, 0.45, 0.3]) {
      ctx.beginPath();
      ctx.arc(kx, ky, r * f, 0, TAU);
      ctx.stroke();
    }
    // gloss arc and a small marker dot
    ctx.beginPath();
    ctx.arc(kx, ky, r * 0.7, Math.PI * 1.1, Math.PI * 1.55);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, u * 0.03);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(kx + Math.cos(-1.1) * r * 0.6, ky + Math.sin(-1.1) * r * 0.6, Math.max(1, u * 0.025), 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
  }

  /** The little blue lights (a bar by the function row, a dot by Caps). Not part of the rendered pictures: they glow. */
  function drawIndicators(ctx, skin, geo, keys) {
    const { u, ox, oy } = geo;
    for (const ind of skin.indicators || []) {
      const ix = ox + ind.x * u;
      let iy = oy + (ind.y || 0) * u;
      if (ind.key) {
        const ik = keys.find((k) => k.n === ind.key);
        if (!ik) continue;
        iy = oy + (ik.y + 0.5) * u;
      }
      const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, u * 0.3);
      const bar = ind.kind === 'bar'; // the bar by the function row is a white light, the dot by Caps is blue
      glow.addColorStop(0, bar ? 'rgba(200,230,255,0.55)' : 'rgba(92,200,255,0.5)');
      glow.addColorStop(1, bar ? 'rgba(200,230,255,0)' : 'rgba(92,200,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(ix - u * 0.3, iy - u * 0.3, u * 0.6, u * 0.6);
      ctx.fillStyle = bar ? 'rgba(244,250,255,0.99)' : 'rgba(150,226,255,0.98)';
      if (ind.kind === 'bar') roundRect(ctx, ix - u * 0.035, iy - (ind.len * u) / 2, u * 0.07, ind.len * u, u * 0.035);
      else {
        ctx.beginPath();
        ctx.arc(ix, iy, u * 0.06, 0, TAU);
      }
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------------------------------------- the static layer

  /**
   * Everything that never moves: shadow, case, plate, key slots, knob and indicator lights.
   * geo: { u, ox, oy, W, H } where (ox, oy) is the top-left of the key block and W x H its size in key units.
   */
  /** Where the flat top of a rendered cap sprite is, from the manifest's `face` numbers (key units), for a cap kw x kh px. */
  function faceGeo(face, kw, kh, u) {
    const fx = face.l * u;
    const fy = face.t * u;
    return { fx, fy, fw: kw - (face.l + face.r) * u, fh: kh - (face.t + face.b) * u, fr: u * 0.075 };
  }

  /**
   * The static layer from a rendered picture: the case, plate, slots, knob and the desk shadow are all in the image, and
   * only the indicator lights are added here. `photo` is boardphoto.skin(id).
   */
  function drawPhotoStatic(ctx, skin, geo, keys, photo) {
    const k = geo.u / photo.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.base.img, geo.ox - photo.base.ox * k, geo.oy - photo.base.oy * k, photo.base.w * k, photo.base.h * k);
    ctx.restore();
    drawIndicators(ctx, skin, geo, keys);
  }

  function drawStatic(ctx, skin, geo, keys, opts = {}) {
    if (opts.photo) return drawPhotoStatic(ctx, skin, geo, keys, opts.photo);
    const { u, ox, oy, W, H } = geo;
    const pad = u * 0.42;
    const cx0 = ox - pad;
    const cy0 = oy - pad;
    const cw = W * u + pad * 2;
    const ch = H * u + pad * 2;
    const R = u * 0.5;
    const thick = u * 0.11; // how much of the front of the case shows below the top surface
    const cb = S.rgb(skin.case.bottom);
    const ct = S.rgb(skin.case.top);

    // USB-C socket in the back edge
    if (skin.usb) {
      ctx.fillStyle = css(scale(cb, 0.7));
      roundRect(ctx, cx0 + cw / 2 - u * 0.5, cy0 - u * 0.09, u, u * 0.2, u * 0.06);
      ctx.fill();
    }

    // the front of the case, with the soft shadow it throws on the desk
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = u * 0.75;
    ctx.shadowOffsetY = u * 0.32;
    roundRect(ctx, cx0, cy0 + thick, cw, ch, R);
    ctx.fillStyle = css(scale(cb, 0.55));
    ctx.fill();
    ctx.restore();
    const front = ctx.createLinearGradient(0, cy0 + ch * 0.55, 0, cy0 + ch + thick);
    front.addColorStop(0, 'rgba(255,255,255,0)');
    front.addColorStop(0.8, 'rgba(255,255,255,0.08)');
    front.addColorStop(1, skin.case.edge);
    roundRect(ctx, cx0 + 0.5, cy0 + thick + 0.5, cw - 1, ch - 1, R);
    ctx.strokeStyle = front;
    ctx.lineWidth = 1;
    ctx.stroke();

    // the top surface
    const top = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
    top.addColorStop(0, skin.case.top);
    top.addColorStop(1, skin.case.bottom);
    roundRect(ctx, cx0, cy0, cw, ch, R);
    ctx.fillStyle = top;
    ctx.fill();
    // a broad soft reflection sweeping across it, and a little grain
    const sheen = ctx.createLinearGradient(cx0, cy0, cx0 + cw * 0.9, cy0 + ch * 1.6);
    sheen.addColorStop(0, 'rgba(255,255,255,0.1)');
    sheen.addColorStop(0.25, 'rgba(255,255,255,0.03)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = sheen;
    ctx.fill();
    roundRect(ctx, cx0, cy0, cw, ch, R);
    grainFill(ctx, cx0, cy0, cw, ch, 0.3);
    // chamfered edge: a bright line along the top left, a dark one at the bottom right, and a second fainter line inside
    const edge = ctx.createLinearGradient(cx0, cy0, cx0 + cw * 0.4, cy0 + ch);
    edge.addColorStop(0, skin.case.edge);
    edge.addColorStop(0.5, skin.case.shine);
    edge.addColorStop(1, 'rgba(0,0,0,0.45)');
    roundRect(ctx, cx0 + 0.5, cy0 + 0.5, cw - 1, ch - 1, R);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    roundRect(ctx, cx0 + u * 0.06, cy0 + u * 0.06, cw - u * 0.12, ch - u * 0.12, R - u * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // the plate: a dark well cut into the case. Light falls into it from above, so its top edge is in shadow
    const pp = u * 0.14;
    const px = ox - pp;
    const py = oy - pp;
    const pw = W * u + pp * 2;
    const ph = H * u + pp * 2;
    const pr = u * 0.26;
    const well = ctx.createLinearGradient(0, py, 0, py + ph);
    well.addColorStop(0, '#000');
    well.addColorStop(0.12, skin.plate.fill);
    well.addColorStop(1, skin.plate.fill);
    roundRect(ctx, px, py, pw, ph, pr);
    ctx.fillStyle = well;
    ctx.fill();
    ctx.save();
    roundRect(ctx, px, py, pw, ph, pr);
    ctx.clip();
    const inner = ctx.createLinearGradient(0, py, 0, py + u * 0.3);
    inner.addColorStop(0, 'rgba(0,0,0,0.7)');
    inner.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    ctx.fillRect(px, py, pw, u * 0.3);
    const innerL = ctx.createLinearGradient(px, 0, px + u * 0.22, 0);
    innerL.addColorStop(0, 'rgba(0,0,0,0.45)');
    innerL.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = innerL;
    ctx.fillRect(px, py, u * 0.22, ph);
    ctx.restore();
    // the lower lip of the well catches the light
    const lipLine = ctx.createLinearGradient(0, py, 0, py + ph);
    lipLine.addColorStop(0, 'rgba(0,0,0,0)');
    lipLine.addColorStop(0.6, 'rgba(255,255,255,0)');
    lipLine.addColorStop(1, skin.plate.edge);
    roundRect(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, pr);
    ctx.strokeStyle = lipLine;
    ctx.lineWidth = 1;
    ctx.stroke();

    // knob and indicator lights
    if (opts.knob && skin.knob) {
      const kn = skin.knob;
      drawKnob(ctx, skin, ox + (kn.x !== undefined ? kn.x : W - 0.5) * u, oy + (kn.y !== undefined ? kn.y : 0.5) * u, u);
    }
    drawIndicators(ctx, skin, geo, keys);

    // each key's slot
    const gap = u * GAP;
    ctx.fillStyle = skin.slot;
    for (const k of keys) {
      roundRect(ctx, ox + k.x * u + gap * 0.4, oy + k.y * u + gap * 0.4, k.w * u - gap * 0.8, u - gap * 0.8, u * 0.14);
      ctx.fill();
    }
  }

  /**
   * The little pictures printed on some caps. (x, y) is the icon's left end and vertical centre, `h` its size (the legend's
   * font size) and `color` its ink. Returns the icon's width. The four arrow kinds are centred on (x, y) instead and are
   * the thin arrows of the arrow keys.
   *   'back'   arrow pointing left (Backspace)         'tabL' / 'tabR'  arrow against a bar (Tab)
   *   'shift'  hollow up arrow (Shift)                 'enter'  return arrow (Enter)
   *   'left' | 'right' | 'up' | 'down'                 the arrow keys
   */
  function drawLegendIcon(ctx, kind, x, y, h, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let lw = Math.max(1.2, h * 0.13);
    let width = 0;
    // An arrow whose tip is at one end: dir -1 points left, 1 points right; `x0` is its left end.
    const arrow = (x0, yc, dir, len, head, hw) => {
      const tip = dir < 0 ? x0 : x0 + len;
      const tail = dir < 0 ? x0 + len : x0;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(tail, yc);
      ctx.lineTo(tip - dir * head * 0.5, yc);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip, yc);
      ctx.lineTo(tip - dir * head, yc - hw);
      ctx.lineTo(tip - dir * head, yc + hw);
      ctx.closePath();
      ctx.fill();
    };
    if (kind === 'back') {
      width = h * 1.5;
      arrow(x, y, -1, width, h * 0.55, h * 0.36);
    } else if (kind === 'tabL' || kind === 'tabR') {
      width = h * 1.5;
      const left = kind === 'tabL';
      const bar = left ? x + lw / 2 : x + width - lw / 2;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(bar, y - h * 0.42);
      ctx.lineTo(bar, y + h * 0.42);
      ctx.stroke();
      arrow(left ? x + lw * 1.3 : x, y, left ? -1 : 1, width - lw * 1.3, h * 0.55, h * 0.36);
    } else if (kind === 'shift') {
      width = h * 1.05;
      const hh = h * 1.15;
      const px = (fx) => x + fx * width;
      const py = (fy) => y - hh / 2 + fy * hh;
      ctx.lineWidth = Math.max(1.2, h * 0.12);
      ctx.beginPath();
      ctx.moveTo(px(0.5), py(0));
      ctx.lineTo(px(1), py(0.5));
      ctx.lineTo(px(0.72), py(0.5));
      ctx.lineTo(px(0.72), py(1));
      ctx.lineTo(px(0.28), py(1));
      ctx.lineTo(px(0.28), py(0.5));
      ctx.lineTo(px(0), py(0.5));
      ctx.closePath();
      ctx.stroke();
    } else if (kind === 'enter') {
      width = h * 1.7;
      const yy = y + h * 0.12;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x + width, y - h * 0.5);
      ctx.lineTo(x + width, yy);
      ctx.lineTo(x + h * 0.4, yy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + h * 0.5, yy - h * 0.3);
      ctx.lineTo(x + h * 0.5, yy + h * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'left' || kind === 'right' || kind === 'up' || kind === 'down') {
      lw = Math.max(1.4, h * 0.11);
      width = h * 1.05;
      ctx.translate(x, y);
      ctx.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[kind]);
      arrow(-width / 2, 0, 1, width, h * 0.36, h * 0.21);
    }
    ctx.restore();
    return width;
  }

  return { GAP, roundRect, offscreen, capGeo, faceGeo, drawCap, drawKnob, drawIndicators, drawStatic, drawLegendIcon };
});
