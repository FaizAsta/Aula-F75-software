#!/usr/bin/env python3
"""
Renders the keyboard pictures the app shows (src/img/board/*).

It is a small height-field renderer: the case, the plate, the key slots, the knob and each keycap are built as a height
map plus material maps, and every pixel of an oblique, slightly top-down view is found by marching a ray through the
height map. Shading has soft shadows, ambient occlusion, reflections of a studio softbox, fine plastic grain and brushed
metal, which is what makes the result read as a photograph of a real board and not a drawing.

Nothing is typed in twice: colours and layouts come from the app (dump-models.js -> models.json).

  node scripts/render-board/dump-models.js > models.json
  python3 scripts/render-board/render.py models.json --out src/img/board --R 128 --ss 2

Only numpy, scipy and Pillow are needed. Output (per skin): <skin>-base.webp (case, plate, slots, knob, desk shadow) and
one cap sprite per (width, accent) pair, plus manifest.json. Sizes in the manifest are pixels at --R pixels per key.
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# ----------------------------------------------------------------------------------------------- camera and geometry
TILT = math.radians(float(os.environ.get("AULA_TILT", "12")))  # how far the camera leans toward the front of the keyboard: small = looking down on the caps, large = seeing their front walls
KAPPA = math.tan(TILT)  # a point z units up appears z * KAPPA units higher on screen
ZMAX = 1.7  # tallest thing in any scene
ZTOP = 0.90  # top of the case rim
ZP = 0.68  # the plate the keys stand on (floor of the well)
GAP = 0.05  # space left between caps, as the app draws it
CAP_H = 0.56  # keycap height above its base
CAP_BASE = ZP + 0.03
KNOB_H = 0.50

# light directions point toward the light, in (x right, y toward the viewer, z up)
def _n(v):
    v = np.array(v, np.float32)
    return v / np.linalg.norm(v)

L_KEY = _n([-0.42, -0.36, 0.84])
L_FILL = _n([0.58, 0.46, 0.67])
L_RIM = _n([0.05, -0.92, 0.38])


def lin(hexstr, power=2.2):
    h = hexstr.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32) ** power


def parse_rgba(s):
    # 'rgba(255,255,255,0.16)' -> ([r,g,b] 0..1, a)
    inside = s[s.index('(') + 1:s.index(')')].split(',')
    return np.array([float(inside[0]), float(inside[1]), float(inside[2])], np.float32) / 255.0, float(inside[3])


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def blur(a, sigma):
    """Gaussian blur that stays fast for big sigmas (blurs a smaller copy)."""
    if sigma <= 0.4:
        return a
    if sigma <= 5:
        return ndi.gaussian_filter(a, sigma, mode='nearest')
    f = int(max(2, min(16, sigma // 2.5)))
    h, w = a.shape
    hh, ww = (h + f - 1) // f * f, (w + f - 1) // f * f
    pad = np.pad(a, ((0, hh - h), (0, ww - w)), mode='edge')
    small = pad.reshape(hh // f, f, ww // f, f).mean(axis=(1, 3))
    small = ndi.gaussian_filter(small, sigma / f, mode='nearest')
    big = ndi.zoom(small, f, order=1)
    return big[:h, :w]


# ----------------------------------------------------------------------------------------------- the scene
class Scene:
    """Height map (ground view) plus the material maps. Screen coordinates are in key units, origin at the key block's
    top-left; ground rows run `extra` rows past the screen because things standing up are seen shifted upward."""

    def __init__(self, x0, y0, w_u, h_u, R):
        self.R, self.x0, self.y0 = R, x0, y0
        self.W = int(round(w_u * R))
        self.Hs = int(round(h_u * R))
        self.extra = int(math.ceil(KAPPA * ZMAX * R)) + 4
        self.Hg = self.Hs + self.extra
        sh = (self.Hg, self.W)
        self.h = np.zeros(sh, np.float32)
        self.alb = np.zeros(sh + (3,), np.float32)
        self.rough = np.full(sh, 0.9, np.float32)
        self.metal = np.zeros(sh, np.float32)
        self.grain = np.zeros(sh, np.float32)  # amplitude of the fine surface grain
        self.mid = np.zeros(sh, np.uint8)  # what is there: 0 desk, 1 cap, 2 case, 3 plate, 4 slot, 5 port, 6 knob ring, 7 knob face
        self.emit = np.zeros(sh + (3,), np.float32)
        self.sparkle = np.zeros(sh, np.float32)  # brushed-metal streak strength

    # coordinates of a window (x/y in key units, ground y) -> slices and grids
    def win(self, gx0, gy0, gx1, gy1):
        R = self.R
        c0 = max(0, int(math.floor((gx0 - self.x0) * R)))
        c1 = min(self.W, int(math.ceil((gx1 - self.x0) * R)))
        r0 = max(0, int(math.floor((gy0 - self.y0) * R)))
        r1 = min(self.Hg, int(math.ceil((gy1 - self.y0) * R)))
        if c1 <= c0 or r1 <= r0:
            return None
        xs = (np.arange(c0, c1, dtype=np.float32) + 0.5) / R + self.x0
        ys = (np.arange(r0, r1, dtype=np.float32) + 0.5) / R + self.y0
        X, Y = np.meshgrid(xs, ys)
        return (slice(r0, r1), slice(c0, c1)), X, Y

    def paint(self, sl, mask, alb=None, rough=None, metal=None, grain=None, mid=None, sparkle=None):
        def put(dst, val):
            if isinstance(val, np.ndarray) and val.shape[:2] == mask.shape:
                dst[sl][mask] = val[mask]
            else:
                dst[sl][mask] = val

        if alb is not None:
            put(self.alb, alb)
        if rough is not None:
            put(self.rough, rough)
        if metal is not None:
            put(self.metal, metal)
        if grain is not None:
            put(self.grain, grain)
        if mid is not None:
            put(self.mid, mid)
        if sparkle is not None:
            put(self.sparkle, sparkle)


def sd_rrect(X, Y, cx, cy, hw, hh, r):
    qx = np.abs(X - cx) - (hw - r)
    qy = np.abs(Y - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


# ----------------------------------------------------------------------------------------------- parts
def add_cap(S, x, y_back_g, w, kh_ground, body_cols, face_cols, accent=False, light_face=False):
    """A keycap whose footprint is x..x+w wide and kh_ground deep (ground units), back edge at y_back_g.
    Sides taper in toward a dished top. Face material in the middle, body material on the sides."""
    D = kh_ground
    zb, zt = CAP_BASE, CAP_BASE + CAP_H
    tx, tb, tf = 0.125, 0.045, 0.17  # how far the top face is inset from the footprint: sides, back, front
    cx = x + w / 2
    win = S.win(x - 0.1, y_back_g - 0.1, x + w + 0.1, y_back_g + D + 0.1)
    if win is None:
        return
    sl, X, Y = win
    hw = w / 2
    phw = hw - tx  # half width of the top face
    py0, py1 = y_back_g + tb, y_back_g + D - tf  # top face, back and front edge (ground)
    ex = np.maximum(np.abs(X - cx) - phw, 0) / tx
    ey = np.where(Y > (py0 + py1) / 2, np.maximum(Y - py1, 0) / tf, np.maximum(py0 - Y, 0) / tb)
    t = np.hypot(ex, ey)  # 0 on the top face, 1 at the foot
    inside = t < 1.0
    # profile: nearly flat on top, a rounded shoulder, then a straight wall
    shoulder = 0.15  # fraction of the wall height used by the rounded top edge
    sh_w = 0.46  # fraction of the wall run the rounded edge takes
    s = np.clip(t, 0, 1)
    rounded = 1 - np.sqrt(np.clip(1 - np.clip(s / sh_w, 0, 1) ** 2, 0, 1))  # quarter circle
    wall = (s - sh_w) / (1 - sh_w)
    hgt = np.where(s < sh_w, rounded * shoulder, shoulder + np.clip(wall, 0, 1) * (1 - shoulder))
    top = zt - hgt * CAP_H
    # dish: shallow cylinder across, and the face drops toward the typist
    u_ = np.clip((X - cx) / max(phw, 1e-3), -1, 1)
    v_ = np.clip((Y - (py0 + py1) / 2) / max((py1 - py0) / 2, 1e-3), -1, 1)
    dish = 0.034 * (1 - u_ ** 2) + 0.026 * (1 - v_ ** 2)  # a scoop across and a scoop front to back, as a sculpted cap has
    slope = -0.075 * v_
    top = top - (np.clip(1 - s * 5, 0, 1)) * dish + (np.clip(1 - s * 5, 0, 1)) * slope
    z = np.where(inside, top, 0).astype(np.float32)
    hsl = S.h[sl]
    np.maximum(hsl, z, out=hsl)
    m = inside
    # materials: the face and the shoulder are the face colour, the walls are the body colour
    fmix = 1 - smoothstep(0.34, 0.62, s)
    ymix = np.clip((Y - y_back_g) / D, 0, 1)
    face = face_cols[0][None, None, :] * (1 - ymix[..., None]) + face_cols[1][None, None, :] * ymix[..., None]
    body = (body_cols[0] * 0.75 + body_cols[1] * 0.25)[None, None, :] * np.ones_like(ymix)[..., None]
    col = face * fmix[..., None] + body * (1 - fmix[..., None])
    # matte PBT: broad soft sheen, a lot of fine grain
    S.paint(sl, m, alb=col, rough=0.66 * fmix + 0.52 * (1 - fmix), metal=0.0, grain=0.42 * fmix + 0.2 * (1 - fmix), mid=1)


def add_knob(S, cx, cy_g, r, top_z, ring, face, knurls=48):
    win = S.win(cx - r - 0.2, cy_g - r - 0.2, cx + r + 0.2, cy_g + r + 0.2)
    if win is None:
        return
    sl, X, Y = win
    dx, dy = X - cx, Y - cy_g
    rho = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    ra = r * (1 + 0.012 * np.cos(knurls * th))  # knurled edge
    inside = rho < ra
    base = ZP
    # ring top flat, a chamfer into the face, a dished face
    face_r = r * 0.74
    ch_r = r * 0.80
    z = np.full(rho.shape, top_z, np.float32)
    ch = smoothstep(ch_r, face_r, rho)  # 0 on the ring, 1 inside the chamfer
    z = z - ch * 0.03
    dish = np.clip(1 - (rho / face_r) ** 2, 0, 1) * 0.03
    z = np.where(rho < face_r, top_z - 0.03 - dish, z)
    # round off the top outer edge
    edge = np.clip((ra - rho) / 0.035, 0, 1)
    z = z - (1 - np.sqrt(1 - (1 - edge) ** 2)) * 0.035
    z = np.where(inside, z, 0).astype(np.float32)
    hsl = S.h[sl]
    np.maximum(hsl, z, out=hsl)
    on_ring = inside & (rho >= ch_r)
    on_face = inside & (rho < ch_r)
    S.paint(sl, on_ring, alb=ring, rough=0.34, metal=1.0, grain=0.0, mid=6, sparkle=1.0)
    S.paint(sl, on_face, alb=face, rough=0.22, metal=0.0, grain=0.05, mid=7)
    # a pale marker dot on the face
    mx, my = cx + math.cos(-1.1) * r * 0.55, cy_g + math.sin(-1.1) * r * 0.55
    dot = np.hypot(X - mx, Y - my) < r * 0.07
    S.paint(sl, dot & on_face, alb=np.array([0.55, 0.57, 0.6], np.float32), mid=7)


def add_screen(S, sc, bez=lin('#050606')):
    """The F75 Max's small colour screen: a black bezel, a glass panel and a lit display with a few lines of text on it.
    `sc` is {x, y, w, h} in key units, measured from the key block's top-left corner."""
    z_b, z_g = ZP + 0.045, ZP + 0.03
    zs = KAPPA * z_b
    win = S.win(sc['x'] - 0.2, sc['y'] + zs - 0.2, sc['x'] + sc['w'] + 0.2, sc['y'] + sc['h'] + zs + 0.2)
    if win is None:
        return
    sl, X, Y = win
    cx, cy = sc['x'] + sc['w'] / 2, sc['y'] + sc['h'] / 2 + zs
    hw, hh = sc['w'] / 2, sc['h'] / 2
    # the bezel: a slightly raised black frame with a rounded edge
    bsd = sd_rrect(X, Y, cx, cy, hw, hh, 0.07)
    bm = bsd < 0
    hs = S.h[sl]
    hs[bm] = z_b - 0.02 * np.clip(1 + bsd[bm] / 0.03, 0, 1)
    S.paint(sl, bm, alb=bez, rough=0.35, metal=0.0, grain=0.05, mid=8)
    # the glass: inset, smooth, with the display lit under it
    m = 0.055
    gsd = sd_rrect(X, Y, cx, cy, hw - m, hh - m, 0.035)
    gm = gsd < 0
    hs[gm] = z_g
    # the display: dark green at the bottom, a soft glow at the top left, and three lines of text
    u = np.clip((X - (cx - hw + m)) / max(2 * (hw - m), 1e-3), 0, 1)
    v = np.clip((Y - (cy - hh + m)) / max(2 * (hh - m), 1e-3), 0, 1)
    glow = np.clip(1 - np.hypot(u * 1.0, v * 1.4) * 1.05, 0, 1) ** 1.6
    em = np.zeros(X.shape + (3,), np.float32)
    base_c = np.array([0.0012, 0.012, 0.006], np.float32)
    glow_c = np.array([0.02, 0.18, 0.085], np.float32)
    em += base_c + glow[..., None] * glow_c
    for (v0, v1, u1, c) in ((0.22, 0.34, 0.34, (0.55, 0.62, 0.58)), (0.45, 0.57, 0.58, (0.10, 0.70, 0.36)), (0.68, 0.80, 0.44, (0.30, 0.34, 0.32))):
        bar = (v > v0) & (v < v1) & (u > 0.10) & (u < 0.10 + u1)
        # soft ends
        em[bar] = np.array(c, np.float32) * 0.55
    S.paint(sl, gm, alb=np.array([0.004, 0.006, 0.005], np.float32), rough=0.1, metal=0.0, grain=0.0, mid=8)
    S.emit[sl][gm] = em[gm]


def build_base(S, skin, model, mb):
    """Case, plate well, key slots, knob and usb port. The key block's top-left is (0, 0) in screen units."""
    W, H = model['width'], model['height']
    pad, pp = 0.42, 0.14
    case_top = lin(skin['case']['top'])
    case_bot = lin(skin['case']['bottom'])
    plate = lin(skin['plate']['fill'])
    slot = lin(skin['slot'])

    # case: a rounded slab; its top rim is at ZTOP
    shift = KAPPA * ZTOP
    ccx, ccy = W / 2, H / 2 + shift
    hw, hh = W / 2 + pad, H / 2 + pad
    win = S.win(ccx - hw - 0.2, ccy - hh - 0.2, ccx + hw + 0.2, ccy + hh + 0.2)
    sl, X, Y = win
    sd = sd_rrect(X, Y, ccx, ccy, hw, hh, 0.5)
    d = -sd
    inside = d > 0
    rf = 0.11
    z = np.where(d >= rf, ZTOP, ZTOP - rf + np.sqrt(np.clip(rf * rf - (rf - d) ** 2, 0, None)))
    crown = 0.10 * (((X - ccx) / hw) ** 2 + ((Y - ccy) / hh) ** 2)
    z = np.where(inside, z - crown * (d >= rf), 0).astype(np.float32)
    S.h[sl] = np.maximum(S.h[sl], z)
    sy = np.clip((Y - shift + pad - 0.0) / (H + 2 * pad), 0, 1)  # top to bottom of the case on screen
    col = case_top[None, None, :] * (1 - sy[..., None]) + case_bot[None, None, :] * sy[..., None]
    S.paint(sl, inside, alb=col, rough=0.42, metal=0.0, grain=0.22, mid=2)

    # usb port: a notch in the back rim
    if skin.get('usb'):
        pwin = S.win(W / 2 - 0.7, -pad + shift - 0.1, W / 2 + 0.7, -pad + shift + 0.4)
        psl, PX, PY = pwin
        psd = sd_rrect(PX, PY, W / 2, -pad + shift + 0.06, 0.52, 0.12, 0.06)
        pm = psd < 0
        hpl = S.h[psl]
        hpl[pm] = ZTOP - 0.16
        S.paint(psl, pm, alb=np.array([0.012, 0.012, 0.014], np.float32), rough=0.5, metal=0.0, grain=0.0, mid=5)

    # plate well, cut into the case with a small chamfer
    wshift = shift
    wcx, wcy = W / 2, H / 2 + wshift
    whw, whh = W / 2 + pp, H / 2 + pp
    win = S.win(wcx - whw - 0.1, wcy - whh - 0.1, wcx + whw + 0.1, wcy + whh + 0.1)
    sl, X, Y = win
    wsd = sd_rrect(X, Y, wcx, wcy, whw, whh, 0.26)
    wd = -wsd
    inw = wd > 0
    ch = 0.035
    zw = ZP + (ZTOP - ZP) * np.clip(1 - wd / ch, 0, 1) ** 1.0
    h_sl = S.h[sl]
    h_sl[inw] = zw[inw]
    S.paint(sl, inw, alb=plate, rough=0.55, metal=0.0, grain=0.4, mid=3)
    # a thin bright chamfer on the well's lip is what the reflections pick up; it is geometry, so nothing to paint

    # key slots: the plate is one flat dark surface (the real board shows no wells between the caps), so nothing is cut
    g = 0.022
    zshift = KAPPA * ZP
    for k in ([] if True else model['keys']):
        kx0, kx1 = k['x'] + g, k['x'] + k['w'] - g
        ky0, ky1 = k['y'] + g + zshift, k['y'] + 1 - g + zshift
        w2 = S.win(kx0 - 0.05, ky0 - 0.05, kx1 + 0.05, ky1 + 0.05)
        if w2 is None:
            continue
        s2, X2, Y2 = w2
        ssd = sd_rrect(X2, Y2, (kx0 + kx1) / 2, (ky0 + ky1) / 2, (kx1 - kx0) / 2, (ky1 - ky0) / 2, 0.1)
        sm = ssd < 0
        hs = S.h[s2]
        hs[sm] = ZP - 0.05 + np.clip(-ssd[sm] * -1, 0, 0)  # flat floor
        S.paint(s2, sm, alb=slot, rough=0.6, metal=0.0, grain=0.2, mid=4)

    # knob
    if model.get('knob') and skin.get('knob'):
        kn = skin['knob']
        kx = (kn['x'] if 'x' in kn else W - 0.5)
        ky = (kn['y'] if 'y' in kn else 0.5)
        top_z = ZP + KNOB_H
        # a hole round the knob, a little darker
        add_knob(S, kx, ky + KAPPA * top_z, kn['r'], top_z,
                 lin(kn['ring'][1]) * 0.45 + 0.55 * lin(kn['ring'][0]), lin(kn['face']))
    # the F75 Max's colour screen
    if skin.get('screen'):
        add_screen(S, skin['screen'])


# ----------------------------------------------------------------------------------------------- shading
class Env:
    """Studio lighting seen in reflections: a big softbox up-left, a smaller one right, a long strip above."""

    lobes = [  # direction toward the lobe, intensity, size (bigger = softer)
        (_n([-0.50, -0.42, 0.76]), 2.6, 0.045),
        (_n([0.62, 0.30, 0.72]), 0.9, 0.05),
        (_n([0.0, -0.26, 0.97]), 0.75, 0.16),
        (_n([-0.1, 0.8, 0.59]), 0.35, 0.12),
    ]

    @staticmethod
    def sample(r, rough):
        """Radiance seen along r (N,3) for a surface of the given roughness (N,)."""
        out = 0.10 + 0.10 * np.clip(r[..., 2], 0, 1)
        sp = rough * rough
        for c, inten, size in Env.lobes:
            cd = r[..., 0] * c[0] + r[..., 1] * c[1] + r[..., 2] * c[2]
            width = size + sp * 0.9
            out = out + inten * (size / width) * np.exp((cd - 1) / width)
        return out


def compute_ao(Hs, R):
    ao = np.ones_like(Hs)
    for rad_u, wgt in ((0.035, 0.55), (0.10, 0.5), (0.28, 0.45), (0.8, 0.35)):
        sg = rad_u * R
        occ = np.clip((blur(Hs, sg) - Hs) / (rad_u * 1.6), 0, 1)
        ao = ao * (1 - wgt * occ)
    return ao


def soft_shadow(Hs, R, gx0, gy0, px, py, pz, light, maxlen, steps=28, softness=0.22, kappa_row=0.0):
    """Visibility toward `light` from ground points (px, py) at height pz. px/py in ground pixels."""
    vis = np.ones(px.shape, np.float32)
    lx, ly, lz = float(light[0]), float(light[1]), float(light[2])
    Hh, Ww = Hs.shape
    flat = Hs.ravel()
    s = 0.012
    ratio = (maxlen / s) ** (1.0 / steps)
    for _ in range(steps):
        qx = np.clip((px + lx * s * R).astype(np.int32), 0, Ww - 1)
        qy = np.clip((py + ly * s * R).astype(np.int32), 0, Hh - 1)
        hh = flat[qy * Ww + qx]
        zr = pz + lz * s
        v = np.clip((zr - hh) / (softness * s + 1e-4), 0, 1)
        np.minimum(vis, v, out=vis)
        s *= ratio
    return vis


def render(S, probe=False, block=384, light_scale=1.0, verbose=False):
    """Returns (rgb linear (Hs,W,3), alpha (Hs,W), id (Hs,W))."""
    R = S.R
    t0 = time.time()
    Hs = blur(S.h, 0.55 * R / 128 + 0.45)
    gy, gx = np.gradient(Hs, 1.0 / R)
    gy = gy.astype(np.float32)
    gx = gx.astype(np.float32)
    ao_map = compute_ao(Hs, R)
    # fine grain: a noise height field whose slope perturbs the normals
    rng = np.random.default_rng(7)
    nz = rng.standard_normal(Hs.shape).astype(np.float32)
    gs = max(0.7, 0.0048 * R)
    nz = ndi.gaussian_filter(nz, gs)
    nz /= nz.std() + 1e-6
    ngy, ngx = np.gradient(nz)
    ngx = (ngx * gs).astype(np.float32)
    ngy = (ngy * gs).astype(np.float32)
    if verbose:
        print(f'  maps {time.time() - t0:.1f}s', flush=True)

    out = np.zeros((S.Hs, S.W, 3), np.float32)
    alpha = np.zeros((S.Hs, S.W), np.float32)
    idm = np.zeros((S.Hs, S.W), np.uint8)
    Hflat = Hs.ravel()
    nzflat = nz.ravel()
    Wn = S.W
    dz = 0.012
    nsteps = int(ZMAX / dz) + 1
    cols = np.arange(Wn, dtype=np.int32)
    for r0 in range(0, S.Hs, block):
        r1 = min(S.Hs, r0 + block)
        nr = r1 - r0
        rr = np.repeat(np.arange(r0, r1, dtype=np.int32)[:, None], Wn, axis=1).ravel()
        cc = np.tile(cols, nr)
        n_all = rr.size
        hit_z = np.zeros(n_all, np.float32)
        active = np.arange(n_all)
        z = ZMAX
        for _ in range(nsteps):
            if active.size == 0:
                break
            row = rr[active] + np.round(KAPPA * z * R).astype(np.int32)
            row = np.minimum(row, S.Hg - 1)
            h = Hflat[row * Wn + cc[active]]
            got = h >= z
            if got.any():
                hit_z[active[got]] = z
                active = active[~got]
            z -= dz
        # bisection between the hit level and the level above
        lo = hit_z.copy()  # inside
        hi = hit_z + dz  # outside
        for _ in range(5):
            mid = 0.5 * (lo + hi)
            row = np.minimum(rr + np.round(KAPPA * mid * R).astype(np.int32), S.Hg - 1)
            h = Hflat[row * Wn + cc]
            inside = h >= mid
            lo = np.where(inside, mid, lo)
            hi = np.where(inside, hi, mid)
        zh = lo
        grow = np.minimum(rr + np.round(KAPPA * zh * R).astype(np.int32), S.Hg - 1)
        gi = grow * Wn + cc
        # normal
        nx = -gx.ravel()[gi]
        ny = -gy.ravel()[gi]
        amp = S.grain.ravel()[gi]
        nx = nx + amp * 0.11 * ngx.ravel()[gi]
        ny = ny + amp * 0.11 * ngy.ravel()[gi]
        nzv = np.ones_like(nx)
        inv = 1.0 / np.sqrt(nx * nx + ny * ny + nzv * nzv)
        nx, ny, nzv = nx * inv, ny * inv, nzv * inv
        # view vector, with a little perspective so flat surfaces show a gradient across them
        xs = (cc.astype(np.float32) + 0.5) / R + S.x0
        ys_ = (rr.astype(np.float32) + 0.5) / R + S.y0
        D = 15.0
        vx = (xs - (S.x0 + S.W / (2 * R))) / D
        vy = KAPPA + (ys_ - (S.y0 + S.Hs / (2 * R))) / D
        vz = np.ones_like(vx)
        vi = 1.0 / np.sqrt(vx * vx + vy * vy + vz * vz)
        vx, vy, vz = vx * vi, vy * vi, vz * vi
        # material
        alb = S.alb.reshape(-1, 3)[gi]
        rough = S.rough.ravel()[gi]
        metal = S.metal.ravel()[gi]
        mid_ = S.mid.ravel()[gi]
        spark = S.sparkle.ravel()[gi]
        ao = ao_map.ravel()[gi]
        if probe:
            alb = np.full_like(alb, 0.5)
            rough = np.full_like(rough, 0.8)
            metal = np.zeros_like(metal)
        # light
        pxg = cc.astype(np.float32) + 0.5
        pyg = grow.astype(np.float32) + 0.5
        vis_k = soft_shadow(Hs, R, 0, 0, pxg, pyg, zh + 0.004, L_KEY, 2.2, steps=30, softness=0.6)
        vis_r = soft_shadow(Hs, R, 0, 0, pxg, pyg, zh + 0.004, L_RIM, 1.0, steps=14, softness=0.35)
        ndl = lambda L: np.clip(nx * L[0] + ny * L[1] + nzv * L[2], 0, 1)
        sky = 0.34 + 0.12 * nzv
        diffuse = (1.0 * light_scale) * (0.78 * ndl(L_KEY) * (0.15 + 0.85 * vis_k) + 0.32 * ndl(L_FILL) + 0.20 * ndl(L_RIM) * vis_r) + sky * ao
        ndv = np.clip(nx * vx + ny * vy + nzv * vz, 0.001, 1)
        rx, ry, rz = 2 * ndv * nx - vx, 2 * ndv * ny - vy, 2 * ndv * nzv - vz
        env = Env.sample(np.stack([rx, ry, rz], axis=-1), rough)
        # the softbox reflection is cut by shadows and occlusion like the direct light
        env = env * (0.35 + 0.65 * vis_k) * (0.4 + 0.6 * ao)
        # how much reflection each material has: the plate is nearly black, the case and the PBT caps are matte
        env = env * np.select([mid_ == 3, mid_ == 4, mid_ == 2, mid_ == 1], [0.16, 0.16, 0.55, 0.6], 1.0).astype(np.float32)
        f0 = 0.04 * (1 - metal)[:, None] + alb * metal[:, None]
        fres = f0 + (1 - f0) * ((1 - ndv) ** 5)[:, None]
        # brushed metal: streaks across the reflection
        if spark.any():
            th = np.arctan2(ys_ - 0, xs - 0)
            streak = 0.75 + 0.25 * np.sin(th * 90 + rng.random() * 6) * np.sin(th * 37 + 1.3)
            env = env * np.where(spark > 0, streak, 1.0)
        speck = 1 + amp * 0.05 * nzflat[gi]
        col = alb * (1 - metal)[:, None] * (diffuse * speck)[:, None] + fres * (env * (1 + 0.2 * amp * nzflat[gi]))[:, None]
        if not probe:
            col = col + S.emit.reshape(-1, 3)[gi]  # a lit screen
        # desk: shadow only
        desk = mid_ == 0
        col = col.astype(np.float32)
        a = np.ones(n_all, np.float32)
        if desk.any():
            shade = (0.35 + 0.65 * vis_k) * ao
            shadow = np.clip(1 - shade, 0, 1) * 0.8
            a = np.where(desk, np.clip(shadow, 0, 0.9), 1.0)
            col = np.where(desk[:, None], 0.0, col)
        out[r0:r1] = col.reshape(nr, Wn, 3)
        alpha[r0:r1] = a.reshape(nr, Wn)
        idm[r0:r1] = mid_.reshape(nr, Wn)
        if verbose:
            print(f'  rows {r1}/{S.Hs}  {time.time() - t0:.1f}s', flush=True)
    return out, alpha, idm


def tonemap(rgb, exposure=1.0):
    x = rgb * exposure
    x = x / (1 + 0.12 * x)  # gentle shoulder
    x = np.clip(x, 0, None)
    return np.clip(x, 0, 1) ** (1 / 2.2)


def to_image(rgb, alpha, ss, exposure=1.0):
    """Supersample down by `ss` (premultiplied) and return a PIL RGBA image."""
    if ss > 1:
        h, w = alpha.shape
        h2, w2 = h // ss * ss, w // ss * ss
        pm = rgb[:h2, :w2] * alpha[:h2, :w2, None]
        # filter in display space for the colour so bright edges do not bleed, weighted by alpha
        disp = tonemap(rgb[:h2, :w2], exposure) * alpha[:h2, :w2, None]
        disp = disp.reshape(h2 // ss, ss, w2 // ss, ss, 3).mean(axis=(1, 3))
        a = alpha[:h2, :w2].reshape(h2 // ss, ss, w2 // ss, ss).mean(axis=(1, 3))
        col = disp / np.maximum(a[..., None], 1e-4)
    else:
        col = tonemap(rgb, exposure)
        a = alpha
    img = np.dstack([np.clip(col, 0, 1), np.clip(a, 0, 1)])
    return Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA')


# ----------------------------------------------------------------------------------------------- jobs
def exposure_for(skin):
    """A light-coloured case or cap would clip to white under the same light, so those skins are exposed a little lower."""
    return 0.74 if lin(skin['cap']['face'][0]).mean() > 0.5 else 1.0


def render_base(skin_id, d, R, ss, mb=1.0, verbose=True):
    skin = d['skin']
    W, H = d['width'], d['height']
    Rr = R * ss
    x0, y0 = -mb, -mb
    S = Scene(x0, y0, W + 2 * mb, H + 2 * mb + 0.35, Rr)
    build_base(S, skin, d, mb)
    rgb, alpha, idm = render(S, verbose=verbose)
    # the shadow on the desk fades out before the edge of the picture, so no straight cut shows
    hh_, ww_ = alpha.shape
    ramp = 0.75 * Rr
    fy = np.minimum(np.arange(hh_), np.arange(hh_)[::-1]) / ramp
    fx = np.minimum(np.arange(ww_), np.arange(ww_)[::-1]) / ramp
    fade = smoothstep(0.0, 1.0, np.minimum(fy[:, None], fx[None, :]))
    alpha = np.where(idm == 0, alpha * fade, alpha).astype(np.float32)
    img = to_image(rgb, alpha, ss, exposure_for(skin))
    return img, {'ox': mb * R, 'oy': mb * R}


MC = 0.25  # margin kept round a cap sprite for its shadow, in key units


def render_cap(skin, w, accent, R, ss, mc=MC, verbose=False):
    """One cap sprite: cell is w x 1 key units with a margin of mc round it. Returns the RGBA image."""
    Rr = R * ss
    Ws, Hs_ = w + 2 * mc, 1 + 2 * mc
    cap_cols = skin['cap']
    body_cols = [lin(c) for c in (skin['accents'][accent]['body'] if accent != '-' else cap_cols['body'])]
    acc_face = skin['accents'][accent].get('face') if accent != '-' else None
    face_cols = [lin(c) for c in (acc_face or cap_cols['face'])]
    z_t = CAP_BASE + CAP_H
    gap = GAP
    tb = 0.045
    # ground depth so that the silhouette on screen is (1 - 2 gap) tall
    D = (1 - 2 * gap) + tb - KAPPA * CAP_H
    y_front_g = (1 - gap) + KAPPA * CAP_BASE
    y_back_g = y_front_g - D

    def scene(with_cap):
        S = Scene(-mc, -mc, Ws, Hs_, Rr)
        # plate floor
        S.h[:] = ZP
        S.alb[:] = lin(skin['plate']['fill'])
        S.rough[:] = 0.55
        S.mid[:] = 3
        if with_cap:
            add_cap(S, gap, y_back_g, w - 2 * gap, D, body_cols, face_cols)
        return S

    S1 = scene(True)
    rgb1, alpha1, id1 = render(S1)
    S0 = scene(False)
    rgb0, alpha0, id0 = render(S0, probe=True)
    rgb1p, _, _ = render(S1, probe=True)
    lum = lambda c: c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11
    shadow = np.clip(1 - lum(rgb1p) / np.maximum(lum(rgb0), 1e-4), 0, 0.95)
    capm = (id1 == 1)
    shadow = np.where(capm, 0, shadow)
    shadow = np.clip(blur(shadow, 0.012 * Rr) * 0.8, 0, 0.8)
    # fade the shadow out before the edge of the sprite so no rectangle shows
    hh_, ww_ = shadow.shape
    fy = np.minimum(np.arange(hh_), np.arange(hh_)[::-1]) / (mc * Rr * 0.9)
    fx = np.minimum(np.arange(ww_), np.arange(ww_)[::-1]) / (mc * Rr * 0.9)
    shadow = shadow * smoothstep(0.0, 1.0, np.minimum(fy[:, None], fx[None, :]))
    alpha = np.where(capm, 1.0, shadow).astype(np.float32)
    rgb = np.where(capm[..., None], rgb1, 0.0).astype(np.float32)
    return to_image(rgb, alpha, ss, exposure_for(skin))


def cap_face():
    """Where the flat face of a cap sprite is, in key units from the cap's top-left corner (the cell plus the gap)."""
    tx, tf = 0.125, 0.17
    return {'l': round(tx * 0.6, 4), 't': 0.045, 'r': round(tx * 0.6, 4), 'b': round(tf + KAPPA * CAP_H, 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('models')
    ap.add_argument('--out', default='src/img/board')
    ap.add_argument('--R', type=int, default=96, help='pixels per key in the output')
    ap.add_argument('--ss', type=int, default=2, help='supersampling')
    ap.add_argument('--only', default='', help='comma list of skin ids')
    ap.add_argument('--caps', default='1', help="'all' or a comma list of widths, e.g. 1,2.25")
    ap.add_argument('--no-base', action='store_true')
    ap.add_argument('--fmt', default='webp')
    ap.add_argument('--cap-ss', type=int, default=0, help='supersampling for the keycaps (0 = same as --ss); caps are small, so a higher value is cheap and gives cleaner edges')
    ap.add_argument('--quality', type=int, default=94, help='webp quality')
    ap.add_argument('--method', type=int, default=4, help='webp effort, 0 (fast) to 6 (smallest file for the quality)')
    args = ap.parse_args()
    data = json.load(open(args.models))
    os.makedirs(args.out, exist_ok=True)
    only = [s for s in args.only.split(',') if s]
    manifest = {'scale': args.R, 'tilt': math.degrees(TILT), 'skins': {}}
    face = cap_face()
    mpath = os.path.join(args.out, 'manifest.json')
    if os.path.exists(mpath):
        try:
            manifest = json.load(open(mpath))
            manifest['scale'] = args.R
        except Exception:
            pass
    manifest['mc'] = MC
    manifest['face'] = face
    save = dict(quality=args.quality, method=args.method) if args.fmt == 'webp' else {}
    cap_ss = args.cap_ss or args.ss
    for sid, d in data.items():
        if only and sid not in only:
            continue
        t0 = time.time()
        entry = manifest['skins'].setdefault(sid, {'caps': {}})
        if args.caps == 'all' and not args.no_base:
            # a full render replaces the skin's pictures, so a cap that no longer exists (an accent that was renamed) is not left behind
            for old in [f for f in os.listdir(args.out) if f.startswith(f'cap-{sid}-')]:
                os.remove(os.path.join(args.out, old))
            entry['caps'] = {}
        if not args.no_base:
            img, meta = render_base(sid, d, args.R, args.ss)
            fn = f'{sid}-base.{args.fmt}'
            img.save(os.path.join(args.out, fn), **save)
            entry['base'] = {'file': fn, 'w': img.width, 'h': img.height, **meta}
            print(sid, 'base', img.size, f'{time.time() - t0:.0f}s', flush=True)
        want = d['caps']
        if args.caps != 'all':
            ws = {float(x) for x in args.caps.split(',') if x}
            want = [c for c in want if c['w'] in ws]
        for c in want:
            img = render_cap(d['skin'], c['w'], c['accent'], args.R, cap_ss)
            fn = f"cap-{sid}-{c['w']}-{c['accent']}.{args.fmt}"
            img.save(os.path.join(args.out, fn), **save)
            entry['caps'][f"{c['w']}|{c['accent']}"] = {'file': fn, 'w': img.width, 'h': img.height}
            print(sid, 'cap', c, img.size, flush=True)
    json.dump(manifest, open(mpath, 'w'), indent=1)
    # the same data as a script, so the app can load it from file:// with no fetch
    with open(os.path.join(args.out, 'manifest.js'), 'w') as f:
        f.write('/* made by scripts/render-board/render.py: where the rendered keyboard pictures are */\n')
        f.write('window.AulaBoardManifest = ' + json.dumps(manifest) + ';\n')
        f.write("window.AulaBoardManifest.dir = (document.currentScript && document.currentScript.src ? document.currentScript.src : '').replace(/[^/]*$/, '');\n")


if __name__ == '__main__':
    main()
