// Liquid glass, GPU type (Settings > Theme > Liquid glass > Glass type > GPU). Loaded in <head>, before glass.js, which owns it.
//
// The Realistic type gives every glass surface its own SVG filter (a blur, a displacement map, a second shift for the colour fringe,
// a rim map and a reflection: 9 to 13 steps per surface), and the browser runs every one of them again whenever anything behind a
// surface changes. That is why it lags. This file draws the same glass in ONE pass per surface on the graphics card:
//
//   - One <canvas> sits inside .shell, above the background and below every control. A surface is a rounded box; the shader works out,
//     for each pixel of it, how far it is from the rim, which way the rim faces and how far the picture is bent there. It uses the same
//     numbers as the SVG version (the displacement profile, the red/blue shift, the rim reflection, its light direction), but computes
//     them instead of reading a map, so nothing is drawn, encoded or decoded when a setting changes.
//   - What the glass bends is the app's own backdrop: the page colour with the keyboard's glow, and the background picture or video.
//     The picture is drawn once at screen size and blurred once per blur radius (a small separable Gaussian on the card); a surface only
//     reads it. A still picture is never redrawn; a video redraws it once per video frame.
//   - The controls, their text and their tints stay normal HTML above the canvas. Only the backdrop-filter is switched off (glass-gpu.css).
//   - Nothing is drawn while nothing moves. A frame is drawn when a surface moved or changed size, the backdrop changed, or a setting did.
//
// What it does not do (so glass.js keeps these on the SVG filters, which need HTML to bend): the slider lens, the tab highlight, the scroll
// thumb, and the floating menus, messages, dialogs and the apply bar. They bend the controls and text under them, and a canvas below the page cannot.
//
// If the picture cannot be read by the graphics card (a file: picture the browser treats as another origin) or WebGL is missing or lost,
// create() returns null or calls onFail, and glass.js falls back to the SVG filters (Realistic), so the glass never disappears.
(() => {
  'use strict';

  const LIGHT = (() => {
    const l = Math.hypot(-0.62, -0.78);
    return [-0.62 / l, -0.78 / l];
  })();

  const VS_QUAD = `#version 300 es
uniform vec4 uQuad;
uniform vec2 uScreen;
out vec2 vPos;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vPos = uQuad.xy + c * uQuad.zw;
  vec2 ndc = vPos / uScreen * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}`;
  const VS_FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vUv = c;
  gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0);
}`;
  // The picture, scaled to cover the screen like background-size: cover (and object-fit: cover), into the screen-sized texture.
  const FS_COVER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPic;
uniform vec2 uImg;
uniform vec2 uScr;
void main() {
  float s = max(uScr.x / uImg.x, uScr.y / uImg.y);
  vec2 px = (vUv * uScr - 0.5 * uScr) / s + 0.5 * uImg;
  o = vec4(texture(uPic, px / uImg).rgb, 1.0);
}`;
  // One direction of a Gaussian. Reads a mip level of the source (the first pass shrinks as it goes), so a big blur is cheap.
  const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform float uSigma;
uniform float uLod;
void main() {
  float R = ceil(uSigma * 2.5);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -14; i <= 14; i++) {
    float fi = float(i);
    if (abs(fi) > R) continue;
    float w = exp(-fi * fi / (2.0 * uSigma * uSigma));
    sum += textureLod(uSrc, vUv + uDir * fi, uLod).rgb * w;
    wsum += w;
  }
  o = vec4(sum / wsum, 1.0);
}`;
  // The glass of one surface (see the header). The maths follows js/glass.js: mapUrl (the bend), rimMapUrl and rimPass (the reflection).
  const FS_GLASS = `#version 300 es
precision highp float;
in vec2 vPos;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uScreen;
uniform vec4 uRect;      // the surface: x, y, width, height (CSS px)
uniform float uRadius;
uniform float uBezel;    // how deep the bend reaches
uniform float uAmount;   // how far the rim pulls (px)
uniform float uCa;       // the colour fringe, as a share of the pull
uniform float uBent;     // 1 when the surface bends the picture, 0 when it is only frosted
uniform float uPull;     // a surface too small to bend fetches its reflection from this far in
uniform float uRimW;
uniform float uRimGain;
uniform float uRimLift;
uniform float uRimFloor;
uniform float uRimSat;
uniform vec2 uAdj;       // saturate, brightness (the CSS backdrop-filter that followed the SVG one)
uniform float uOpacity;
uniform float uDpr;
uniform vec3 uBg;
uniform vec3 uGlow;
uniform float uGlowOn;
uniform float uPic;      // how much of the picture shows over the page colour
uniform vec2 uLight;
uniform float uUnder;    // 1 for a surface that sits inside a panel: what it looks through is the panel's glass (its saturate and brightness, then its tint)
uniform vec4 uUnderTint;
uniform vec2 uUnderAdj;
uniform float uSoft;     // the smoothing blur Realistic runs over the finished glass (CSS px), 0 when the frost blur already hides the stairs
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

vec3 underPanel(vec3 c) {
  c = mix(vec3(dot(c, LUM)), c, uUnderAdj.x) * uUnderAdj.y;
  return mix(c, uUnderTint.rgb, uUnderTint.a);
}

vec3 backdrop0(vec2 p) {
  vec3 base = uBg;
  if (uGlowOn > 0.5) {
    vec2 e = (p - vec2(0.5 * uScreen.x, 0.14 * uScreen.y)) / (vec2(0.6, 0.5) * uScreen);
    base = mix(base, uGlow, 0.15 * clamp(1.0 - length(e) / 0.72, 0.0, 1.0));
  }
  if (uPic <= 0.0) return base;
  return mix(base, texture(uTex, clamp(p / uScreen, 0.0, 1.0)).rgb, uPic);
}

vec3 backdrop(vec2 p) {
  vec3 c = backdrop0(p);
  return uUnder > 0.5 ? underPanel(c) : c;
}

// The glass at one spot: the bent, blurred picture, with the rim reflection over it (everything before the final CSS saturate/brightness).
vec3 shade(vec2 p, float depth, vec2 n) {
  vec3 o;
  if (uBent > 0.5) {
    float t = max(depth, 0.0) / uBezel;
    float mag = t < 1.0 ? (1.0 - t) * (1.0 - t) : 0.0;  // strongest on the rim, eases to nothing
    vec2 d = -uAmount * mag * n;                         // look from further in: the rim bends the picture inwards
    if (uCa <= 0.0) {
      o = backdrop(p + d);
    } else {
      vec3 a = backdrop(p + d * (1.0 + uCa));            // red is pulled a little further ...
      vec3 b = backdrop(p + d * (1.0 - uCa));            // ... and blue a little less; green is the mean of both
      o = vec3(a.r, 0.5 * (a.g + b.g), b.b);
    }
  } else {
    o = backdrop(p);
  }
  // the rim reflection: the picture's own colours along the edge, richer and brighter, strongest where the edge faces the light
  float tt = clamp(1.0 - (max(depth, 0.0) - 0.5) / uRimW, 0.0, 1.0);
  float fade = tt * tt * (3.0 - 2.0 * tt);
  float dl = dot(n, uLight);
  float lit = pow(max(dl, 0.0), 1.3);
  float back = 0.7 * pow(max(-dl, 0.0), 1.3);
  float mask = fade * min(1.0, uRimFloor + lit + back);
  if (mask > 0.0) {
    vec3 src = uBent > 0.5 ? o : backdrop(p - n * uPull);
    vec3 rc = clamp(mix(vec3(dot(src, LUM)), src, uRimSat) * uRimGain + uRimLift, 0.0, 1.0); // a filter step ends at 0..1, so the reflection tops out at white before it is blended in
    o = mix(o, rc, mask);
  }
  return o;
}

void main() {
  vec2 c = vPos - (uRect.xy + 0.5 * uRect.zw);
  vec2 hs = 0.5 * uRect.zw;
  float r = min(uRadius, min(hs.x, hs.y));
  vec2 q = abs(c) - (hs - r);
  float outside = length(max(q, 0.0));
  float sdf = outside + min(max(q.x, q.y), 0.0) - r;   // above 0 outside the surface
  float cov = clamp(0.5 - sdf * uDpr, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float depth = -sdf;                                    // how far inside the rim this pixel is

  vec2 sg = vec2(c.x < 0.0 ? -1.0 : 1.0, c.y < 0.0 ? -1.0 : 1.0);
  vec2 n;                                                // the way the nearest edge faces (outward)
  if (q.x > 0.0 && q.y > 0.0) n = sg * q / length(q);
  else if (q.x > q.y) n = vec2(sg.x, 0.0);
  else n = vec2(0.0, sg.y);

  // The SVG version blurs the finished glass a little (uSoft). Doing the same along the way the edge faces (five taps of a Gaussian, each one
  // shading the glass as it would look a little further in) spreads the thin rim line exactly like that blur does.
  vec3 o = vec3(0.0);
  float wsum = 0.0;
  // Deeper in than the bend and the reflection reach (plus the spread of the final blur) nothing bends and nothing reflects: the glass is
  // just the blurred picture there, which is most of every big surface. One lookup, no rim maths.
  float reach = max(uBent > 0.5 ? uBezel : 0.0, uRimW + 0.5) + 2.5 * uSoft + 0.5;
  if (depth > reach) {
    o = backdrop(vPos);
    wsum = 1.0;
  } else if (uSoft <= 0.0) {
    o = shade(vPos, depth, n);
    wsum = 1.0;
  } else for (int i = 0; i < 5; i++) {
    float k = float(i - 2);
    float wgt = i == 2 ? 0.403 : (i == 1 || i == 3 ? 0.244 : 0.054);
    float off = k * uSoft;
    o += wgt * shade(vPos - n * off, depth + off, n);
    wsum += wgt;
  }
  o /= wsum;

  o = clamp(o, 0.0, 1.0);
  o = mix(vec3(dot(o, LUM)), o, uAdj.x) * uAdj.y;
  float a = cov * uOpacity;
  outColor = vec4(clamp(o, 0.0, 1.0) * a, a);
}`;

  function create(opts) {
    const shell = (opts && opts.shell) || document.querySelector('.shell');
    const onFail = (opts && opts.onFail) || (() => {});
    if (!shell || window.AULA_PREVIEW) return null;

    const canvas = document.createElement('canvas');
    canvas.className = 'glass-gpu-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    let gl = null;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    } catch (_) {
      gl = null;
    }
    if (!gl) return null;

    let dead = false;
    let failed = false;
    const fail = (why) => {
      if (failed || dead) return;
      failed = true;
      try {
        onFail(why);
      } catch (_) {}
    };

    // ---- programs
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const program = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      const locs = {};
      return { p, u: (name) => (name in locs ? locs[name] : (locs[name] = gl.getUniformLocation(p, name))) };
    };
    let progGlass;
    let progCover;
    let progBlur;
    try {
      progGlass = program(VS_QUAD, FS_GLASS);
      progCover = program(VS_FULL, FS_COVER);
      progBlur = program(VS_FULL, FS_BLUR);
    } catch (e) {
      return null;
    }

    // ---- textures and framebuffers
    const fbo = gl.createFramebuffer();
    const texture = (w, h, mips) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { t, w, h };
    };
    const target = (tex) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
      gl.viewport(0, 0, tex.w, tex.h);
    };
    const free = (tex) => tex && gl.deleteTexture(tex.t);

    // ---- sizes
    let W = 0; // CSS px
    let H = 0;
    let dpr = 1;
    function measureShell() {
      const b = shell.getBoundingClientRect();
      const w = Math.max(1, Math.round(b.width));
      const h = Math.max(1, Math.round(b.height));
      let d = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      while (w * h * d * d > 3840 * 2160 && d > 1) d = Math.max(1, d - 0.25); // a huge window is not worth the fill
      return { w, h, d, ox: b.left, oy: b.top };
    }

    // ---- the backdrop picture
    // pic: what the page shows behind everything: a still picture (S is drawn once) or a video (S is drawn for every frame), or nothing.
    const pic = { key: '', el: null, kind: '', tex: null, w: 0, h: 0, ok: false, opacityEl: null, loading: 0 };
    let screenTex = null; // the picture at screen size, mipmapped (texel row 0 is the top of the screen)
    let bakeVer = 0; // changes whenever the screen-sized picture does; the blurred copies compare against it
    const blurs = new Map(); // sigma (CSS px, as text) -> { w, h, a, b, ver }
    let sigmaLive = new Set();
    let picDirty = true;
    let videoCb = 0;

    const appBg = document.getElementById('appBg');
    const appVid = document.getElementById('appBgVideo');
    const urlOf = (css) => {
      const m = /url\((["']?)(.*?)\1\)/.exec(css || '');
      return m ? m[2] : '';
    };
    function currentSource() {
      if (appVid && !appVid.hidden && appVid.getAttribute('src') && appVid.readyState >= 2 && appVid.videoWidth) return { kind: 'video', el: appVid, key: 'v:' + appVid.currentSrc };
      if (appBg && !appBg.hidden) {
        const u = urlOf(getComputedStyle(appBg).backgroundImage);
        if (u) return { kind: 'image', el: appBg, key: 'i:' + u, url: u };
      }
      return null;
    }
    function dropPicture() {
      free(pic.tex);
      pic.tex = null;
      pic.ok = false;
      pic.key = '';
      pic.el = null;
      pic.kind = '';
      pic.opacityEl = null;
      if (videoCb && appVid && appVid.cancelVideoFrameCallback) appVid.cancelVideoFrameCallback(videoCb);
      videoCb = 0;
    }
    function uploadToPic(source, w, h) {
      // This is where a picture the browser treats as another origin is refused (SecurityError): the caller falls back.
      if (!pic.tex || pic.w !== w || pic.h !== h) {
        free(pic.tex);
        pic.tex = texture(w, h, true);
        pic.w = w;
        pic.h = h;
      }
      gl.bindTexture(gl.TEXTURE_2D, pic.tex.t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    async function loadImage(src) {
      const im = new Image();
      im.decoding = 'async';
      im.src = src.url;
      await im.decode();
      return im;
    }
    async function takePicture(src) {
      const my = ++pic.loading;
      try {
        if (src.kind === 'video') {
          uploadToPic(src.el, src.el.videoWidth, src.el.videoHeight);
          pic.kind = 'video';
          pic.el = src.el;
          pic.opacityEl = src.el;
          pic.key = src.key;
          pic.ok = true;
          watchVideo();
        } else {
          let im = await loadImage(src);
          if (my !== pic.loading || dead) return;
          try {
            uploadToPic(im, im.naturalWidth, im.naturalHeight);
          } catch (e) {
            // a file: picture is another origin to the browser. The desktop app can hand a preset over as a data: address.
            const host = window.aulaHost;
            const name = decodeURIComponent(src.url.split('?')[0].split('/').pop() || '');
            if (!(e && e.name === 'SecurityError') || !host || typeof host.bgImageData !== 'function') throw e;
            const data = await host.bgImageData(name);
            if (my !== pic.loading || dead || !data) throw e;
            im = await loadImage({ url: data });
            uploadToPic(im, im.naturalWidth, im.naturalHeight);
          }
          if (my !== pic.loading || dead) return;
          pic.kind = 'image';
          pic.el = src.el;
          pic.opacityEl = src.el;
          pic.key = src.key;
          pic.ok = true;
        }
        bakeScreen();
        dirty = true;
        kick();
      } catch (e) {
        if (my !== pic.loading || dead) return;
        pic.ok = false;
        fail('picture: ' + (e && e.name ? e.name : e));
      }
    }
    function watchVideo() {
      if (!appVid || !appVid.requestVideoFrameCallback || videoCb) return;
      const step = () => {
        videoCb = 0;
        if (dead || pic.kind !== 'video' || !pic.ok) return;
        try {
          uploadToPic(appVid, appVid.videoWidth, appVid.videoHeight);
          bakeScreen();
          dirty = true;
          kick(60);
        } catch (e) {
          fail('video: ' + (e && e.name ? e.name : e));
          return;
        }
        videoCb = appVid.requestVideoFrameCallback(step);
      };
      videoCb = appVid.requestVideoFrameCallback(step);
    }
    function syncPicture() {
      picDirty = false;
      const src = currentSource();
      if (!src) {
        if (pic.key) dropPicture();
        return;
      }
      if (src.key === pic.key) return;
      dropPicture();
      takePicture(src);
    }

    // The picture at screen size. For a still picture this runs once (and again after a resize); for a video, for every frame.
    function bakeScreen() {
      if (!pic.ok || !pic.tex || !W) return;
      const sw = Math.max(1, Math.round(W * dpr));
      const sh = Math.max(1, Math.round(H * dpr));
      if (!screenTex || screenTex.w !== sw || screenTex.h !== sh) {
        free(screenTex);
        screenTex = texture(sw, sh, true);
        for (const b of blurs.values()) {
          free(b.a);
          free(b.b);
        }
        blurs.clear();
      }
      target(screenTex);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(progCover.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, pic.tex.t);
      gl.uniform1i(progCover.u('uPic'), 0);
      gl.uniform2f(progCover.u('uImg'), pic.w, pic.h);
      gl.uniform2f(progCover.u('uScr'), sw, sh);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, screenTex.t);
      gl.generateMipmap(gl.TEXTURE_2D);
      bakeVer++;
      timing.bakes++;
    }
    // The screen-sized picture blurred by `sigma` CSS px (made when first asked for, and again after the picture changed).
    function blurTexture(sigma) {
      if (!screenTex) return null;
      const dev = sigma * dpr;
      if (dev < 0.35) return screenTex;
      const key = String(Math.round(sigma * 100));
      sigmaLive.add(key);
      let b = blurs.get(key);
      if (b && b.ver === bakeVer) return b.b;
      // shrink first when the blur is wide: the blur then needs few taps, and the mip chain filters what is dropped
      const lod = Math.max(0, Math.ceil(Math.log2(Math.max(1, dev / 3.5))));
      const ds = Math.pow(2, lod);
      const bw = Math.max(1, Math.round(screenTex.w / ds));
      const bh = Math.max(1, Math.round(screenTex.h / ds));
      if (!b || b.w !== bw || b.h !== bh) {
        if (b) {
          free(b.a);
          free(b.b);
        }
        b = { w: bw, h: bh, a: texture(bw, bh, false), b: texture(bw, bh, false), ver: -1 };
        blurs.set(key, b);
      }
      const s = dev / ds;
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(progBlur.p);
      gl.uniform1i(progBlur.u('uSrc'), 0);
      gl.uniform1f(progBlur.u('uSigma'), s);
      gl.activeTexture(gl.TEXTURE0);
      target(b.a);
      gl.bindTexture(gl.TEXTURE_2D, screenTex.t);
      gl.uniform2f(progBlur.u('uDir'), 1 / bw, 0);
      gl.uniform1f(progBlur.u('uLod'), lod);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      target(b.b);
      gl.bindTexture(gl.TEXTURE_2D, b.a.t);
      gl.uniform2f(progBlur.u('uDir'), 0, 1 / bh);
      gl.uniform1f(progBlur.u('uLod'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      b.ver = bakeVer;
      timing.blurs++;
      return b.b;
    }

    // ---- surfaces
    const surf = new Map(); // element -> { el, d, clipEls, last }
    let order = [];
    let orderDirty = true;
    const isClip = (cs) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
    function clipAncestors(el) {
      const out = [];
      for (let a = el.parentElement; a && a !== shell; a = a.parentElement) if (isClip(getComputedStyle(a))) out.push(a);
      return out;
    }
    function set(el, d) {
      let s = surf.get(el);
      if (!s) {
        s = { el, d, clipEls: [], last: null };
        surf.set(el, s);
        orderDirty = true;
      }
      s.d = d;
      s.clipEls = clipAncestors(el);
      s.last = null;
      dirty = true;
      kick();
    }
    function remove(el) {
      if (surf.delete(el)) {
        orderDirty = true;
        dirty = true;
        kick();
      }
    }
    function sortOrder() {
      orderDirty = false;
      order = [...surf.values()].sort((x, y) => (x.el.compareDocumentPosition(y.el) & 4 ? -1 : 1));
    }

    // ---- the page colour behind the picture (css/app.css: .shell::before is the page colour and a soft glow of the keyboard's colour)
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.canvas.width = probe.canvas.height = 1;
    const parseColor = (text, fallback) => {
      try {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = '#000';
        probe.fillStyle = text;
        probe.fillRect(0, 0, 1, 1);
        const d = probe.getImageData(0, 0, 1, 1).data;
        return [d[0] / 255, d[1] / 255, d[2] / 255];
      } catch (_) {
        return fallback;
      }
    };
    // 'rgb(1 2 3 / .5)', 'rgba(1,2,3,.5)' or 'color(srgb .1 .2 .3 / .16)' (what color-mix computes to) -> [r, g, b, a] in 0..1
    const parseRGBA = (text) => {
      const m = String(text || '').match(/-?\d*\.?\d+(?:e-?\d+)?%?/g);
      if (!m || m.length < 3) return null;
      const num = (v, scale) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / scale);
      const srgb = /^\s*color\(/.test(text);
      const sc = srgb ? 1 : 255;
      const a = m.length > 3 ? num(m[3], 1) : 1;
      return [num(m[0], sc), num(m[1], sc), num(m[2], sc), a];
    };
    const env = { bg: [0.06, 0.07, 0.08], glow: [0.49, 0.84, 1], light: false, pic: 0, sig: '' };
    function readEnv() {
      const cs = getComputedStyle(shell);
      const bgText = cs.getPropertyValue('--bg').trim();
      const glowText = cs.getPropertyValue('--glow').trim();
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      let op = 0;
      if (pic.ok && pic.opacityEl) {
        op = parseFloat(getComputedStyle(pic.opacityEl).opacity);
        if (!(op >= 0)) op = 0;
      }
      const sig = `${bgText}|${glowText}|${light}|${op.toFixed(3)}`;
      if (sig === env.sig) return false;
      env.sig = sig;
      if (bgText) env.bg = parseColor(bgText, env.bg);
      const g = glowText.split(/\s+/).map(Number);
      if (g.length === 3 && g.every(Number.isFinite)) env.glow = g.map((v) => v / 255);
      env.light = light;
      env.pic = op;
      return true;
    }

    // ---- measuring the surfaces, and drawing them
    let dirty = true;
    let raf = 0;
    let activeUntil = 0;
    let frames = 0;
    let lastDraw = 0;
    const timing = { measure: 0, env: 0, draw: 0, gl: 0, n: 0, bakes: 0, blurs: 0 };
    const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-transparency: reduce)') : null;
    const rectOf = (m, el) => {
      let r = m.get(el);
      if (!r) {
        const b = el.getBoundingClientRect();
        r = { l: b.left, t: b.top, r: b.right, b: b.bottom };
        m.set(el, r);
      }
      return r;
    };
    // opacity of an element and everything above it: a surface that is fading in (a page, a toast) fades its glass with it
    function opacityOf(m, el) {
      if (el === shell.parentElement || !el) return 1;
      let v = m.get(el);
      if (v === undefined) {
        const cs = getComputedStyle(el);
        const own = cs.visibility === 'hidden' ? 0 : parseFloat(cs.opacity);
        v = (Number.isFinite(own) ? own : 1) * (el === shell ? 1 : opacityOf(m, el.parentElement));
        m.set(el, v);
      }
      return v;
    }
    function measure() {
      let changed = false;
      const sb = shell.getBoundingClientRect();
      const rects = new Map();
      const ops = new Map();
      for (const s of order) {
        const el = s.el;
        let cur = null;
        if (el.isConnected) {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) {
            const op = opacityOf(ops, el);
            if (op > 0.003) {
              let l = Math.max(b.left, sb.left);
              let t = Math.max(b.top, sb.top);
              let r = Math.min(b.right, sb.right);
              let bt = Math.min(b.bottom, sb.bottom);
              for (const a of s.clipEls) {
                const c = rectOf(rects, a);
                l = Math.max(l, c.l);
                t = Math.max(t, c.t);
                r = Math.min(r, c.r);
                bt = Math.min(bt, c.b);
              }
              // the browser snaps a surface to whole device pixels (and so does its filter): so does the glass, or its edge lands half a pixel off
              const sx = Math.round((b.left - sb.left) * dpr) / dpr;
              const sy = Math.round((b.top - sb.top) * dpr) / dpr;
              const sw = Math.max(1 / dpr, Math.round((b.right - sb.left) * dpr) / dpr - sx);
              const sh = Math.max(1 / dpr, Math.round((b.bottom - sb.top) * dpr) / dpr - sy);
              if (r > l && bt > t) cur = { x: sx, y: sy, w: sw, h: sh, op, cl: l - sb.left, ct: t - sb.top, cr: r - sb.left, cb: bt - sb.top };
            }
          }
        }
        const p = s.last;
        if (!(!cur && !p) && !(cur && p && cur.x === p.x && cur.y === p.y && cur.w === p.w && cur.h === p.h && cur.op === p.op && cur.cl === p.cl && cur.ct === p.ct && cur.cr === p.cr && cur.cb === p.cb)) changed = true;
        s.last = cur;
      }
      return changed;
    }
    function sizeCanvas() {
      const m = measureShell();
      if (m.w === W && m.h === H && m.d === dpr) return false;
      W = m.w;
      H = m.h;
      dpr = m.d;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (pic.ok) bakeScreen();
      return true;
    }
    // What a surface inside a panel looks through: the panel's own glass layer (css/glass.css: .ag-panel::after), its saturate and brightness and its tint.
    const tints = new Map(); // panel element -> [r, g, b, a], rebuilt when the theme or the colours change
    let tintSig = '';
    function panelOf(s) {
      const par = s.el.parentElement;
      return par ? par.closest('.ag-panel') : null;
    }
    function underTint(panel) {
      let t = tints.get(panel);
      if (!t) {
        t = parseRGBA(getComputedStyle(panel, '::after').backgroundColor) || [0, 0, 0, 0];
        tints.set(panel, t);
      }
      return t;
    }
    const adjust = (panel, light) => (panel ? [1.3, light ? 1.03 : 0.99] : [1.5, light ? 1.06 : 0.9]);
    function draw() {
      if (dead || failed) return;
      lastDraw = performance.now();
      frames++;
      if (tintSig !== env.sig) {
        tintSig = env.sig;
        tints.clear();
      }
      const hidden = reduce && reduce.matches;
      canvas.style.visibility = hidden ? 'hidden' : '';
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (hidden) return;
      sigmaLive = new Set();
      // the blurred copies first (making one binds its own framebuffer and textures), then every surface in one go
      const texFor = new Map();
      if (pic.ok && screenTex && env.pic > 0) {
        for (const s of order) if (s.last && !texFor.has(s.d.blur)) texFor.set(s.d.blur, blurTexture(s.d.blur));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.SCISSOR_TEST);
      gl.useProgram(progGlass.p);
      const U = progGlass.u;
      gl.uniform2f(U('uScreen'), W, H);
      gl.uniform1f(U('uDpr'), dpr);
      gl.uniform3f(U('uBg'), env.bg[0], env.bg[1], env.bg[2]);
      gl.uniform3f(U('uGlow'), env.glow[0], env.glow[1], env.glow[2]);
      gl.uniform1f(U('uGlowOn'), 1);
      gl.uniform1f(U('uPic'), pic.ok && screenTex ? env.pic : 0);
      gl.uniform2f(U('uLight'), LIGHT[0], LIGHT[1]);
      const softPx = Math.max(0.3, 0.75 / Math.min(3, Math.max(1, window.devicePixelRatio || 1)));
      gl.uniform1i(U('uTex'), 0);
      gl.activeTexture(gl.TEXTURE0);
      let bound = null;
      for (const s of order) {
        const p = s.last;
        if (!p) continue;
        const d = s.d;
        const tex = texFor.get(d.blur);
        if (tex && tex.t !== bound) {
          gl.bindTexture(gl.TEXTURE_2D, tex.t);
          bound = tex.t;
        }
        const x0 = Math.floor(p.cl * dpr);
        const y0 = Math.floor((H - p.cb) * dpr);
        gl.scissor(x0, y0, Math.ceil(p.cr * dpr) - x0, Math.ceil((H - p.ct) * dpr) - y0);
        const k = d.w ? p.w / d.w : 1; // a surface that is scaled (a pressed button) keeps its look in proportion
        const adj = adjust(d.panel, env.light);
        const pan = d.panel ? null : panelOf(s);
        const ut = pan ? underTint(pan) : null;
        gl.uniform1f(U('uUnder'), ut ? 1 : 0);
        if (ut) {
          gl.uniform4f(U('uUnderTint'), ut[0], ut[1], ut[2], ut[3]);
          const pa = adjust(true, env.light);
          gl.uniform2f(U('uUnderAdj'), pa[0], pa[1]);
        }
        gl.uniform4f(U('uQuad'), p.x - 1, p.y - 1, p.w + 2, p.h + 2);
        gl.uniform4f(U('uRect'), p.x, p.y, p.w, p.h);
        gl.uniform1f(U('uRadius'), d.r * k);
        gl.uniform1f(U('uBezel'), Math.max(1, d.bezel * k));
        gl.uniform1f(U('uAmount'), d.amount);
        gl.uniform1f(U('uCa'), d.ca);
        gl.uniform1f(U('uBent'), d.amount > 0 ? 1 : 0);
        gl.uniform1f(U('uPull'), d.pull);
        gl.uniform1f(U('uRimW'), Math.max(0.5, d.rimW));
        gl.uniform1f(U('uRimGain'), d.rimGain);
        gl.uniform1f(U('uRimLift'), d.rimLift);
        gl.uniform1f(U('uRimFloor'), d.rimFloor);
        gl.uniform1f(U('uRimSat'), d.rimSat);
        gl.uniform2f(U('uAdj'), adj[0], adj[1]);
        gl.uniform1f(U('uOpacity'), p.op);
        gl.uniform1f(U('uSoft'), d.blur >= 4 ? 0 : softPx);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // blurred copies nobody asked for in this frame (an old setting) are let go
      for (const [key, b] of blurs) {
        if (sigmaLive.has(key)) continue;
        free(b.a);
        free(b.b);
        blurs.delete(key);
      }
    }

    // ---- when to draw
    function tick() {
      raf = 0;
      if (dead || failed) return;
      if (orderDirty) {
        sortOrder();
        dirty = true;
      }
      if (picDirty) syncPicture();
      if (sizeCanvas()) dirty = true;
      if (readEnv()) dirty = true;
      const t0 = performance.now();
      const moved = measure();
      timing.measure += performance.now() - t0;
      if (moved || dirty) {
        dirty = false;
        try {
          const t1 = performance.now();
          draw();
          const t2 = performance.now();
          timing.draw += t2 - t1;
          if (window.AULA_GPU_DEBUG) {
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // waits for the card to finish (debug only)
            timing.gl += performance.now() - t2;
          }
          timing.n++;
        } catch (e) {
          fail('draw: ' + (e && e.message ? e.message : e));
          return;
        }
        activeUntil = Math.max(activeUntil, performance.now() + 200); // it moved: look again next frame
      }
      if (performance.now() < activeUntil && !document.hidden) raf = requestAnimationFrame(tick);
    }
    function kick(ms = 350) {
      if (dead || failed) return;
      activeUntil = Math.max(activeUntil, performance.now() + ms);
      if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
    }
    const markPic = () => {
      picDirty = true;
      kick();
    };
    const evs = ['scroll', 'wheel', 'pointermove', 'pointerdown', 'pointerup', 'keydown', 'input', 'change', 'focusin', 'transitionrun', 'transitionstart', 'transitionend', 'animationstart', 'animationend', 'click'];
    const onEvent = () => kick();
    for (const e of evs) document.addEventListener(e, onEvent, { capture: true, passive: true });
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.target === appBg || m.target === appVid) picDirty = true;
      }
      kick();
    });
    mo.observe(document.body, { attributes: true, subtree: true, childList: true, attributeFilter: ['style', 'class', 'hidden', 'aria-checked', 'aria-expanded', 'aria-pressed', 'aria-selected', 'data-screen', 'data-tab', 'src'] });
    const moRoot = new MutationObserver(() => kick());
    moRoot.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    const ro = new ResizeObserver(() => kick());
    ro.observe(shell);
    const onVis = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener('visibilitychange', onVis);
    if (appVid) for (const e of ['loadeddata', 'emptied', 'error']) appVid.addEventListener(e, markPic);
    // the keyboard's glow colour and the theme change without any of the above: a slow look keeps the backdrop right while idle
    const idle = setInterval(() => kick(0), 250);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      fail('context lost');
    });
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', () => (dirty = true) && kick());

    shell.insertBefore(canvas, appVid ? appVid.nextSibling : shell.firstChild);
    sizeCanvas();
    readEnv();
    kick();

    return {
      set,
      remove,
      kick,
      invalidate() {
        dirty = true;
        kick();
      },
      ready: () => !dead && !failed,
      stats: () => ({ frames, px: order.reduce((n, q) => n + (q.last ? Math.max(0, (q.last.cr - q.last.cl) * (q.last.cb - q.last.ct)) : 0), 0) * dpr * dpr, surfaces: surf.size, picture: pic.ok ? pic.kind : '', w: canvas.width, h: canvas.height, lastDraw, blurs: blurs.size, timing: { ...timing } }),
      destroy() {
        if (dead) return;
        dead = true;
        cancelAnimationFrame(raf);
        clearInterval(idle);
        for (const e of evs) document.removeEventListener(e, onEvent, { capture: true });
        document.removeEventListener('visibilitychange', onVis);
        mo.disconnect();
        moRoot.disconnect();
        ro.disconnect();
        if (appVid) for (const e of ['loadeddata', 'emptied', 'error']) appVid.removeEventListener(e, markPic);
        if (videoCb && appVid && appVid.cancelVideoFrameCallback) appVid.cancelVideoFrameCallback(videoCb);
        surf.clear();
        order = [];
        try {
          const lose = gl.getExtension('WEBGL_lose_context');
          if (lose) lose.loseContext();
        } catch (_) {}
        canvas.remove();
      },
    };
  }

  window.AulaGpuGlass = { create };
})();
