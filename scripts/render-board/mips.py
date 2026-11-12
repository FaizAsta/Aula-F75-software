#!/usr/bin/env python3
"""
Makes the smaller copies ("mip levels") of the rendered keyboard pictures, so the app can show a board at its real size
instead of shrinking the big picture in one rough step.

The keyboard pictures in src/img/board are made at 192 pixels per key. On a normal screen a key is 30 to 60 pixels wide, so
the browser has to shrink them 3 to 6 times in one go, which smears the caps and the legends. Here every picture is shrunk
once, properly (Lanczos filter, with the transparent edges handled correctly) and given a light sharpening, at a few sizes
in between. The app (boardphoto.js) then picks the smallest copy that is still at least as big as it needs, so what it
draws is never stretched and at most about a third smaller.

Nothing is drawn again: every copy comes from the 192 picture, so the look stays exactly the same, only clearer.

  python3 scripts/render-board/mips.py                 (reads and updates src/img/board/manifest.json and manifest.js)
  python3 scripts/render-board/mips.py --levels 144,108,81,61,46,34,26 --sharp 0.4

Run it again after render.py: render.py does not know about these copies. Only numpy, scipy and Pillow are needed.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

DEFAULT_LEVELS = [144, 108, 81, 61, 46, 34, 26]


def shrink(img, w, h, sigma, amount):
    """Lanczos shrink of an RGBA picture, then a light unsharp mask that leaves transparent edges alone."""
    small = img.resize((w, h), Image.LANCZOS)  # Pillow premultiplies RGBA for this, so the soft shadow edges stay clean
    if amount <= 0:
        return small
    a = np.asarray(small, np.float32) / 255.0
    alpha = a[..., 3:4]
    rgb = a[..., :3] * alpha  # work premultiplied: a see-through pixel then has no colour of its own to smear
    blur = np.stack([ndi.gaussian_filter(rgb[..., c], sigma) for c in range(3)], axis=-1)
    sharp = rgb + amount * (rgb - blur)
    sharp = np.clip(sharp, 0.0, alpha)  # never brighter than the pixel's own opacity allows
    out = np.where(alpha > 1e-4, sharp / np.maximum(alpha, 1e-4), 0.0)
    out = np.clip(out, 0.0, 1.0)
    res = np.concatenate([out, alpha], axis=-1)
    return Image.fromarray((res * 255.0 + 0.5).astype(np.uint8), 'RGBA')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'img', 'board'))
    ap.add_argument('--levels', default=','.join(str(x) for x in DEFAULT_LEVELS), help='pixels per key of the extra copies')
    ap.add_argument('--sharp', type=float, default=0.4, help='unsharp amount (0 = none)')
    ap.add_argument('--sigma', type=float, default=0.7, help='unsharp radius in pixels of the copy')
    ap.add_argument('--quality', type=int, default=95)
    args = ap.parse_args()
    d = os.path.normpath(args.dir)
    mpath = os.path.join(d, 'manifest.json')
    man = json.load(open(mpath))
    top = int(man['scale'])
    levels = sorted({int(x) for x in args.levels.split(',') if x} - {top}, reverse=True)
    for old in [f for f in os.listdir(d) if '@' in f]:
        os.remove(os.path.join(d, old))  # a run replaces the copies of the last one
    mips = {}
    total = 0
    for L in levels:
        k = L / top
        mips[str(L)] = {}
        for sid, e in man['skins'].items():
            if not e.get('base'):
                continue
            out = {'caps': {}}
            files = [('base', e['base'])] + [(key, c) for key, c in e['caps'].items()]
            for key, c in files:
                src = Image.open(os.path.join(d, c['file'])).convert('RGBA')
                w = max(1, round(c['w'] * k))
                h = max(1, round(c['h'] * k))
                fn = c['file'].replace('.webp', f'@{L}.webp')
                img = shrink(src, w, h, args.sigma, args.sharp)
                img.save(os.path.join(d, fn), quality=args.quality, method=4, alpha_quality=100)
                total += os.path.getsize(os.path.join(d, fn))
                if key == 'base':
                    out['base'] = {'file': fn, 'w': w, 'h': h, 'ox': e['base']['ox'] * k, 'oy': e['base']['oy'] * k}
                else:
                    out['caps'][key] = {'file': fn, 'w': w, 'h': h}
            mips[str(L)][sid] = out
        print('level', L, 'done', flush=True)
    man['mips'] = mips
    json.dump(man, open(mpath, 'w'), indent=1)
    with open(os.path.join(d, 'manifest.js'), 'w') as f:
        f.write('/* made by scripts/render-board/render.py and mips.py: where the rendered keyboard pictures are */\n')
        f.write('window.AulaBoardManifest = ' + json.dumps(man) + ';\n')
        f.write("window.AulaBoardManifest.dir = (document.currentScript && document.currentScript.src ? document.currentScript.src : '').replace(/[^/]*$/, '');\n")
    print('extra copies: %.1f MB' % (total / 1e6))


if __name__ == '__main__':
    main()
