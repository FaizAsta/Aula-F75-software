"""Generates the app logo assets from exact geometry. Needs Pillow only.

  assets/icon.png   512x512  app icon (white "A" on a brand-blue tile)
  assets/icon.ico            Windows icon (16-256 px) used for the .exe, installer, uninstaller and window
  assets/tray.png   32x32    system tray icon
  assets/logo.svg            the same icon as a scalable vector

The "A" mark is built from five circles joined by straight tangent lines (the construction
circles of the original logo), so it stays perfectly sharp at any size.
Run: npm run icon
"""
import io
import math
import os
import struct
from PIL import Image, ImageDraw

BLUE = (0, 83, 241)
WHITE = (255, 255, 255)

# Construction circles (x, y, r) in logo units, listed clockwise on screen (y points down).
# sign +1 = convex corner of the white shape, -1 = concave (the counter inside the "A").
CIRCLES = [
    ("top",     123.99,  37.47, 26.88, +1),
    ("right",   205.86, 187.91, 29.86, +1),
    ("counter",  98.10, 118.63, 29.09, -1),
    ("foot",     69.89, 188.60, 29.16, +1),
    ("tip",      19.47, 208.66,  9.11, +1),
]


def _tangent(c1, c2):
    """Directed tangent line between two circles with the white shape on the left-hand normal."""
    (_, x1, y1, r1, s1), (_, x2, y2, r2, s2) = c1, c2
    dx, dy = x2 - x1, y2 - y1
    phi = math.atan2(dy, dx) - math.asin((s2 * r2 - s1 * r1) / math.hypot(dx, dy))
    lx, ly = -math.sin(phi), math.cos(phi)
    return phi, (x1 - s1 * r1 * lx, y1 - s1 * r1 * ly), (x2 - s2 * r2 * lx, y2 - s2 * r2 * ly)


def _outline():
    """Returns the outline as a list of ('arc', ...) and ('line', ...) pieces, in logo units."""
    n = len(CIRCLES)
    lines = [_tangent(CIRCLES[i], CIRCLES[(i + 1) % n]) for i in range(n)]
    pieces = []
    for i, (_, cx, cy, r, s) in enumerate(CIRCLES):
        phi_in, phi_out = lines[i - 1][0], lines[i][0]
        p_in, p_out = lines[i - 1][2], lines[i][1]
        turn = phi_out - phi_in
        turn = turn % (2 * math.pi) if s > 0 else -((-turn) % (2 * math.pi))
        pieces.append(("arc", (cx, cy), r, p_in, p_out, turn))
        pieces.append(("line", lines[i][1], lines[i][2]))
    return pieces


def _bounds_and_centroid(step=0.25):
    pts = _polygon(1.0, 0.0, 0.0, step)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    area = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        a = x0 * y1 - x1 * y0
        area += a
        cx += (x0 + x1) * a
        cy += (y0 + y1) * a
    area /= 2
    return (min(xs), min(ys), max(xs), max(ys)), (cx / (6 * area), cy / (6 * area))


def _polygon(scale, ox, oy, step):
    pts = []
    for piece in _outline():
        if piece[0] != "arc":
            continue
        _, (cx, cy), r, p_in, _, turn = piece
        a0 = math.atan2(p_in[1] - cy, p_in[0] - cx)
        k = max(8, int(abs(turn) * r * scale / step))
        for j in range(k + 1):
            a = a0 + turn * j / k
            pts.append((ox + scale * (cx + r * math.cos(a)), oy + scale * (cy + r * math.sin(a))))
    return pts


def _placement(size, margin, mark_frac):
    """Scale and offset that centre the mark optically (halfway between its box and its centre of mass)."""
    (x0, y0, x1, y1), (gx, gy) = _bounds_and_centroid()
    scale = (size - 2 * margin) * mark_frac / (x1 - x0)
    mx, my = ((x0 + x1) / 2 + gx) / 2, ((y0 + y1) / 2 + gy) / 2
    return scale, size / 2 - scale * mx, size / 2 - scale * my


def render(size, margin, radius, mark_frac, ss=8):
    big = size * ss
    tile = Image.new("L", (big, big), 0)
    ImageDraw.Draw(tile).rounded_rectangle(
        (margin * ss, margin * ss, big - margin * ss - 1, big - margin * ss - 1), radius=radius * ss, fill=255)
    mark = Image.new("L", (big, big), 0)
    scale, ox, oy = _placement(size, margin, mark_frac)
    ImageDraw.Draw(mark).polygon(_polygon(scale * ss, ox * ss, oy * ss, 0.5), fill=255)
    tile = tile.resize((size, size), Image.LANCZOS)
    mark = mark.resize((size, size), Image.LANCZOS)
    img = Image.new("RGBA", (size, size), BLUE + (0,))
    img.putalpha(tile)
    img.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (size, size), WHITE).split(), mark)))
    img.putalpha(tile)  # keep the rounded tile as the outer shape
    return img


def svg(size=512, margin=16, radius=112, mark_frac=0.62):
    scale, ox, oy = _placement(size, margin, mark_frac)
    d = []
    for piece in _outline():
        if piece[0] == "arc":
            _, _, r, p_in, p_out, turn = piece
            f = lambda p: "%.2f %.2f" % (ox + scale * p[0], oy + scale * p[1])
            d.append(("M " if not d else "L ") + f(p_in))
            d.append("A %.2f %.2f 0 %d %d %s" % (r * scale, r * scale, abs(turn) > math.pi, turn > 0, f(p_out)))
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">\n'
        '  <rect x="%d" y="%d" width="%d" height="%d" rx="%d" fill="#%02x%02x%02x"/>\n'
        '  <path d="%s Z" fill="#ffffff"/>\n</svg>\n'
        % (size, size, size, size, margin, margin, size - 2 * margin, size - 2 * margin, radius, *BLUE, " ".join(d))
    )


ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def _icon_for(size):
    """Small sizes get a tighter tile and a bigger mark so the A stays readable."""
    if size <= 32:
        return render(size, 0 if size <= 16 else 1, size * 0.22, 0.70, ss=16)
    return render(size, round(size * 16 / 512), size * 112 / 512, 0.62, ss=16 if size <= 64 else 8)


def _dib(img):
    """A 32-bit icon image in the classic BMP layout (bottom-up BGRA plus an empty AND mask)."""
    w, h = img.size
    px = img.convert("RGBA").tobytes("raw", "BGRA")
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)][::-1]
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    return header + b"".join(rows) + bytes(((w + 31) // 32 * 4) * h)


def write_ico(path):
    """Windows icon: BMP entries for the small sizes, PNG for 256 (what Windows itself does)."""
    blobs = []
    for size in ICO_SIZES:
        img = _icon_for(size)
        if size >= 256:
            buf = io.BytesIO()
            img.save(buf, "PNG")
            blobs.append((size, buf.getvalue()))
        else:
            blobs.append((size, _dib(img)))
    out = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    for size, data in blobs:
        out += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(out + b"".join(d for _, d in blobs))


if __name__ == "__main__":
    assets = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
    os.makedirs(assets, exist_ok=True)
    render(512, 16, 112, 0.62).save(os.path.join(assets, "icon.png"))
    print("wrote assets/icon.png")
    write_ico(os.path.join(assets, "icon.ico"))
    print("wrote assets/icon.ico")
    render(32, 1, 7, 0.70, ss=16).save(os.path.join(assets, "tray.png"))
    print("wrote assets/tray.png")
    with open(os.path.join(assets, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg())
    print("wrote assets/logo.svg")
