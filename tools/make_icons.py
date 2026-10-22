#!/usr/bin/env python3
"""Draw the PDF app's install icons (app/icons/). Needs Pillow; the PNGs are committed, so only
run this after changing the design.

    python3 tools/make_icons.py

A yellow (#ffd400) ink stroke on the toolbar's near-black, like the "PDF" badge on the start screen.
icon-*.png have rounded corners; maskable-512.png fills the square and keeps the stroke inside
the safe circle, so launchers can crop it to any shape.
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'icons')
BG, INK, PAGE = (17, 17, 17, 255), (255, 212, 0, 255), (255, 255, 255, 255)
SS = 4   # supersampling


def stroke(draw, pts, width, color):
    """A round pen line: discs stamped along the path (smoother than wide-line joints)."""
    r = width / 2
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / (r / 8)))
        for k in range(n + 1):
            x, y = x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n
            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def art(draw, size, scale):
    """The page and squiggle, scaled about the center (scale 1 fills the icon)."""
    c = size / 2
    P = lambda x, y: (c + (x - .5) * size * scale, c + (y - .5) * size * scale)
    # a sheet of paper, slightly tilted
    sheet = [P(.25, .16), P(.75, .16), P(.75, .84), P(.25, .84)]
    ang = math.radians(-6)
    rot = lambda p: (c + (p[0] - c) * math.cos(ang) - (p[1] - c) * math.sin(ang), c + (p[0] - c) * math.sin(ang) + (p[1] - c) * math.cos(ang))
    draw.polygon([rot(p) for p in sheet], fill=PAGE)
    # printed lines
    for y in (.30, .40, .50):
        a, b = rot(P(.33, y)), rot(P(.67, y))
        draw.line([a, b], fill=(190, 190, 190, 255), width=round(size * scale * .03))
    # the yellow ink: a loop-and-underline squiggle across the page
    pts = []
    for i in range(121):
        t = i / 120
        x = .14 + .72 * t
        y = .70 - .09 * math.sin(t * math.pi * 3.0) * (1 - .35 * t)
        pts.append(P(x, y))
    stroke(draw, pts, round(size * scale * .085), INK)


def icon(size, maskable):
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle((0, 0, big, big), fill=BG)
        art(d, big, .78)   # stays inside the 80% safe circle
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * .22, fill=BG)
        art(d, big, .86)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, mask in (('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True)):
        icon(size, mask).save(os.path.join(OUT, name), optimize=True)
        print('wrote app/icons/' + name)


if __name__ == '__main__':
    main()
