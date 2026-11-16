#!/usr/bin/env python3
"""
Builds docs/slideshow.gif, the auto-playing picture slideshow in the README's Screenshots section.

GitHub does not run JavaScript in a README, so a slideshow has to be one animated picture. Run this after
`npm run screenshots` (or whenever a screenshot changes) and commit the new docs/slideshow.gif.

Needs: Python 3, Pillow (pip install pillow) and ffmpeg on the PATH.   Usage: npm run slideshow
Each slide is a picture from docs/screenshots with its caption underneath. Edit SLIDES to add, remove or reorder
slides. docs/screenshots/lighting.png is not here on purpose: it is the main picture at the top of the README.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SHOTS = os.path.join(ROOT, 'docs', 'screenshots')
OUT = os.path.join(ROOT, 'docs', 'slideshow.gif')
SECONDS_PER_SLIDE = 3
W, H, BAR = 1000, 667, 46  # picture area and the caption bar under it

SLIDES = [
    ('start', 'Start screen'),
    ('style-picker', 'After Start, once: Which UI do you want to use?'),
    ('devices', 'Connected devices: dongle, USB-C cable, demo keyboard'),
    ('lighting-glass', 'Lighting tab in Liquid glass'),
    ('sending', 'Apply: the transfer animation'),
    ('per-key', 'Per-key: solid colour, gradient or rainbow'),
    ('light-theme', 'The light theme'),
    ('keys', 'Key assignment (experimental)'),
    ('battery', 'Battery level, estimate and history'),
    ('charging', 'Charging, level read over the 2.4G dongle'),
    ('charging-cable', 'Charging over the USB-C cable alone'),
    ('settings', 'Settings: Keyboard'),
    ('settings-app', 'Settings: App'),
    ('settings-theme', 'Settings: Theme'),
    ('settings-debug', 'Settings: Debugging'),
    ('connecting', 'Reading the keyboard (waking it up)'),
    ('asleep', 'The keyboard is asleep: press any key'),
    ('support', 'Support: Discord invite and links'),
    ('update', 'Software update'),
    ('window-controls', 'The window buttons in each state'),
    ('max', 'F75 Max, Lighting: 20 effects'),
    ('max-perkey', 'F75 Max, Per-key colours'),
]


def font(bold, size):
    names = ['DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf', 'arialbd.ttf' if bold else 'arial.ttf']
    dirs = ['/usr/share/fonts/truetype/dejavu', 'C:/Windows/Fonts', '/Library/Fonts', '']
    for d in dirs:
        for n in names:
            try:
                return ImageFont.truetype(os.path.join(d, n), size)
            except OSError:
                pass
    return ImageFont.load_default()


def main():
    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg was not found on the PATH.')
    big, small = font(True, 22), font(False, 18)
    tmp = tempfile.mkdtemp()
    try:
        for i, (name, caption) in enumerate(SLIDES, 1):
            src = os.path.join(SHOTS, name + '.png')
            if not os.path.exists(src):
                sys.exit(f'{src} is missing: remove it from SLIDES or run npm run screenshots.')
            im = Image.open(src).convert('RGB')
            r = min(W / im.width, H / im.height)
            im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
            canvas = Image.new('RGB', (W, H + BAR), (11, 14, 20))
            canvas.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
            d = ImageDraw.Draw(canvas)
            d.rectangle([0, H, W, H + BAR], fill=(8, 10, 15))
            d.text((16, H + 11), caption, font=big, fill=(255, 255, 255))
            counter = f'{i} / {len(SLIDES)}'
            d.text((W - d.textlength(counter, font=small) - 16, H + 13), counter, font=small, fill=(160, 170, 190))
            canvas.save(os.path.join(tmp, f'f{i:02d}.png'))
        subprocess.run([
            'ffmpeg', '-y', '-loglevel', 'error', '-framerate', f'1/{SECONDS_PER_SLIDE}', '-i', os.path.join(tmp, 'f%02d.png'),
            '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=single[p];[b][p]paletteuse=new=1:dither=bayer:bayer_scale=5',
            '-loop', '0', OUT,
        ], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'{OUT}: {len(SLIDES)} slides, {os.path.getsize(OUT) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
