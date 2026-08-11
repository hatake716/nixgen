"""Draw the nixgen mark, and print the two forms the pages use.

    python3 tools/mark.py            # both SVGs and the favicon data URI
    python3 tools/mark.py --full     # just the full drawing
    python3 tools/mark.py --flake    # just the plain flake
    python3 tools/mark.py --icon     # the application icon, 64px and up
    python3 tools/mark.py --icon-small   # the same, for 48px and below
    python3 tools/mark.py --logo     # the original mark alone, traced

Generated rather than hand-written, for the same reason `tools/shots.py`
exists: six arms drawn by hand are six slightly different arms, and a mark
that has to be pasted into two pages and a favicon is a mark that will drift
between them. The output is inlined into `build/static/index.html` and
`docs/index.html` — nothing fetches it, so there is no file to keep in step.

Four forms, because one drawing cannot do all of these jobs:

  full   the flake, the arcs it dissolves into, and the shapes coming off
         them. Needs about 80 pixels before the small shapes mean anything,
         so it is used on the homepage hero only.
  flake  six arms and the hexagon core, heavier stroke, cropped tight. This
         is what the headers and the favicon use; the full one at 22px is a
         smudge, which was checked by rendering it.
  logo   the original artwork's mark, traced from `docs/logo.png` into path
         data so it can be drawn at any size. The full drawing above is a
         redrawing of it and not a close one; this is the thing itself.
  icon   the application icon: `logo` on its own white ground, with a small
         flake version for the sizes the artwork cannot survive. Unlike the
         first two it cannot inherit a colour from the page around it, and it
         cannot pick per theme the way the README's logo does with
         `<picture>` — an application menu shows one file. Line art with a
         transparent ground would be invisible on a dark panel, so it carries
         the ground the palette already assumes. `flake.nix` generates both
         at build time rather than keeping copies, so this file stays the
         only place the mark comes from.
"""
import math
import sys
import urllib.parse

CX, CY, R, CORE = 46.0, 60.0, 38.0, 11.5


def f(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def line(x1, y1, x2, y2):
    return f'<path d="M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}"/>'


def hexagon(cx, cy, r, rot=0):
    pts = [f"{f(cx + r * math.cos(math.radians(60 * i + rot)))} "
           f"{f(cy + r * math.sin(math.radians(60 * i + rot)))}" for i in range(6)]
    return '<path d="M' + "L".join(pts) + 'Z"/>'


def circle(cx, cy, r, fill=False):
    return (f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}"'
            + (' fill="currentColor" stroke="none"' if fill else '') + '/>')


def square(cx, cy, r):
    return (f'<rect x="{f(cx - r)}" y="{f(cy - r)}" '
            f'width="{f(2 * r)}" height="{f(2 * r)}"/>')


def arm(bead=True):
    """One arm pointing left: the shaft, a pair of branches, a bead near the
    tip. It starts outside the core hexagon so the middle stays legible."""
    out = [line(CX - CORE, CY, CX - R, CY)]
    bx = CX - CORE - (R - CORE) * 0.5
    for s in (-1, 1):
        a = math.radians(180 - s * 42)
        out.append(line(bx, CY, bx + 10 * math.cos(a), CY + 10 * math.sin(a)))
    if bead:
        out.append(hexagon(CX - R + 4.0, CY, 3.6))
    return out


def core():
    out = [hexagon(CX, CY, CORE), hexagon(CX, CY, CORE * 0.55)]
    # three spokes to alternating vertices: the cube seen corner-on
    for a in (90, 210, 330):
        out.append(line(CX, CY,
                        CX + CORE * 0.55 * math.cos(math.radians(a)),
                        CY + CORE * 0.55 * math.sin(math.radians(a))))
    return out


def flake(beads=True):
    out = []
    for i in range(6):
        # the arm pointing right is where the flake gives way to the field, so
        # in the full drawing it keeps its shaft and loses its bead
        for shape in arm(bead=beads and i != 3):
            out.append(f'<g transform="rotate({60 * i} {f(CX)} {f(CY)})">{shape}</g>')
    return out + core()


def field():
    """The arcs and what comes off them, thinning outwards."""
    out = []
    for r, a0, a1 in ((44, -52, 52), (53, -58, 58), (62, -40, 40),
                      (62, 52, 74), (62, -74, -52)):
        x0 = CX + r * math.cos(math.radians(a0))
        y0 = CY + r * math.sin(math.radians(a0))
        x1 = CX + r * math.cos(math.radians(a1))
        y1 = CY + r * math.sin(math.radians(a1))
        out.append(f'<path d="M{f(x0)} {f(y0)}A{f(r)} {f(r)} 0 0 1 {f(x1)} {f(y1)}"/>')
    draw = {"hex": hexagon, "circle": circle, "square": square,
            "dot": lambda x, y, r: circle(x, y, r, True)}
    for x, y, kind, r in [
            (93, 22, "hex", 4.0), (105, 14, "hex", 2.8), (84, 16, "circle", 3.8),
            (99, 34, "hex", 3.4), (87, 36, "square", 2.4), (110, 44, "circle", 2.0),
            (103, 58, "hex", 3.2), (92, 55, "dot", 1.8), (110, 72, "circle", 2.2),
            (86, 76, "dot", 2.4), (99, 86, "square", 2.6), (91, 99, "hex", 3.4),
            (108, 96, "dot", 1.6)]:
        out.append(draw[kind](x, y, r))
    return out


def svg(body, box="0 0 120 120", stroke=1.9, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" fill="none" '
            f'stroke="currentColor" stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round"{extra}>' + "".join(body) + "</svg>")


def full():
    return svg(flake() + field())


def plain():
    # cropped to the flake and thickened, so it survives a favicon
    return svg(flake(beads=False), box="4 18 84 84", stroke=3.4)


# The original artwork, as numbers. `docs/logo.png` is the drawing this
# project was given, and a raster cannot be shrunk — at 48px it is grey mush,
# which is why the headers have always used the plain flake instead. Traced
# once from that file so the same lines can be drawn at any size:
#
#   magick docs/logo.png -crop 470x527+0+0 +repage -background white \
#     -alpha remove -alpha off -trim +repage -colorspace gray \
#     -threshold 60% mark.pbm
#   potrace -s -o traced.svg --alphamax 1.0 --opttolerance 1.0 -u 1 mark.pbm
#
# The wordmark is cropped off: this is the mark alone. potrace fills outlines
# rather than stroking them, so the shape is in the winding of the subpaths and
# `LOGO_PATH` must keep them in order — it is one `d` because the subpaths came
# out of one drawing, and splitting them would change which regions are holes.
# Regenerate it only from `docs/logo.png`; there is no other source.
LOGO_BOX = (448.0, 525.0)
LOGO_PATH = (
    "M426 523 c-3 -2 -4 -5 -3 -10 0 -5 10 -6 14 -2 7 7 -4 18 -11 12z m6 -6 c0 "
    "-1 0 -2 -1 -2 -1 -1 -3 1 -2 2 0 1 3 1 3 0z M375 513 c-4 -3 -5 -3 -5 -9 "
    "l0 -7 5 -2 c6 -4 8 -4 13 0 7 5 6 15 -3 19 -4 3 -6 2 -10 -1z m11 -9 c0 -4 "
    "-4 -7 -8 -5 -3 3 -3 7 0 9 3 3 8 0 8 -4z M323 497 c-9 -4 -9 -17 1 -22 10 "
    "-4 20 6 15 16 -3 7 -9 9 -16 6z m11 -11 c0 -4 -3 -6 -7 -5 -5 1 -5 10 0 11 "
    "4 1 7 -1 7 -6z M375 475 c-14 -6 -15 -26 -1 -33 12 -5 25 1 27 14 2 14 -13 "
    "25 -26 19z m15 -7 c8 -5 5 -19 -5 -22 -15 -3 -20 19 -5 24 2 1 7 0 10 -2z "
    "M424 462 l-4 -2 0 -7 0 -6 4 -2 c6 -4 7 -4 13 0 l4 2 0 7 0 6 -5 2 c-6 4 "
    "-6 4 -12 0z m9 -5 c3 -2 3 -6 -1 -7 -3 -2 -5 0 -6 3 0 4 3 6 7 4z M324 454 "
    "c-10 -6 -10 -7 -10 -18 0 -11 0 -10 11 -16 l8 -4 5 2 c2 1 6 4 9 5 l4 3 0 "
    "11 0 11 -8 5 c-11 6 -10 6 -19 1z m14 -5 l4 -3 -2 -1 c-6 -4 -7 -4 -12 -2 "
    "-5 3 -5 3 0 6 4 2 5 2 10 0z m-8 -14 c0 -1 0 -4 0 -6 l0 -5 -5 3 c-5 3 -7 "
    "9 -4 12 0 1 8 -3 9 -4z m15 0 c0 -6 -4 -10 -8 -10 -3 0 -1 11 3 13 5 3 5 3 "
    "5 -3z M207 427 l-8 -4 0 -9 c0 -10 0 -10 8 -14 5 -3 5 -3 5 -7 0 -5 0 -5 "
    "-19 7 -17 11 -17 11 -19 8 -1 -2 1 -3 19 -15 10 -7 19 -14 18 -14 0 0 -4 "
    "-3 -8 -6 l-8 -5 -1 -12 0 -12 9 -5 9 -5 0 -9 c0 -11 1 -11 -15 0 -15 9 -15 "
    "9 -18 0 -11 -28 -10 -27 -17 -13 l-5 9 10 25 c10 26 11 28 7 28 -3 0 -24 "
    "-12 -24 -13 0 -5 2 -5 9 -1 4 2 8 4 8 4 0 0 -2 -8 -6 -18 -4 -10 -8 -18 -8 "
    "-18 -1 0 -4 6 -8 13 l-7 12 9 24 c6 18 8 23 7 24 -4 2 -5 1 -12 -19 -4 -12 "
    "-8 -21 -8 -21 -1 0 -3 5 -6 10 l-5 10 2 2 c9 12 -7 29 -20 21 -12 -8 -7 "
    "-25 8 -27 4 0 4 -1 10 -10 3 -5 5 -10 5 -10 -1 0 -10 2 -21 4 -11 2 -20 4 "
    "-21 3 -1 0 -1 -5 0 -5 2 0 46 -9 47 -10 1 -1 13 -21 14 -24 0 -1 1 -1 -22 "
    "3 -17 3 -17 3 -10 6 8 4 8 5 7 8 -1 3 -1 3 -14 -4 -18 -10 -17 -11 19 -17 "
    "l25 -4 5 -10 6 -10 -3 0 c-12 2 -31 5 -32 5 0 -1 0 -8 1 -16 1 -19 2 -17 "
    "-8 -12 l-7 4 -1 10 c0 11 0 11 -10 17 -11 5 -10 5 -20 -1 -10 -5 -10 -6 "
    "-11 20 l-1 23 -3 0 -3 0 0 -20 c1 -12 1 -21 1 -21 -5 0 -7 3 -7 10 l0 8 -7 "
    "4 c-8 5 -8 5 -17 0 l-7 -4 0 -9 c0 -10 0 -10 11 -15 l5 -3 6 3 7 4 3 -2 3 "
    "-2 -14 -8 c-7 -4 -15 -8 -17 -9 -4 -1 -5 -5 -2 -7 0 0 9 4 20 10 23 12 22 "
    "12 22 -1 0 -11 -1 -10 12 -17 10 -6 8 -6 17 0 5 2 9 4 10 4 1 0 15 -8 15 "
    "-9 1 0 -6 -4 -14 -8 -8 -4 -14 -8 -14 -8 0 0 5 -6 10 -13 12 -16 12 -15 0 "
    "-15 -13 0 -10 -3 -30 24 -20 25 -21 25 -21 3 l0 -13 3 0 3 0 0 8 c0 4 0 8 "
    "1 8 1 0 21 -25 23 -29 1 -1 -2 -1 -13 -1 l-14 0 -15 18 c-8 9 -15 18 -16 "
    "19 -2 2 -2 2 -4 1 -3 -3 -4 -1 14 -23 5 -6 10 -12 11 -13 1 -2 1 -2 -10 -2 "
    "l-12 0 -1 3 c-6 14 -27 9 -27 -6 0 -15 20 -20 27 -7 l1 4 12 0 11 0 -2 -2 "
    "c-1 -1 -7 -8 -12 -15 -6 -8 -12 -14 -13 -15 -1 -2 -1 -2 0 -4 3 -3 2 -4 19 "
    "17 l16 19 15 0 c14 0 14 0 13 -2 -3 -4 -22 -28 -23 -28 0 0 -1 11 -1 16 0 "
    "1 -1 1 -3 1 l-2 0 -1 -14 c0 -13 1 -17 4 -16 1 0 9 10 18 22 l17 21 12 0 "
    "11 0 -3 -4 c-1 -2 -6 -8 -10 -13 -10 -12 -10 -10 6 -18 16 -9 16 -8 6 -14 "
    "l-7 -4 -5 2 c-2 2 -6 4 -9 5 l-4 2 -9 -4 c-11 -6 -11 -6 -11 -17 -1 -6 -1 "
    "-11 -2 -11 0 0 -9 4 -21 10 -19 9 -20 10 -21 8 -2 -3 -1 -4 16 -13 20 -10 "
    "19 -9 16 -11 -3 -2 -6 -2 -11 1 -6 4 -7 4 -15 -1 l-7 -4 0 -9 0 -9 4 -2 c2 "
    "-2 5 -4 8 -5 l4 -2 6 3 c9 5 9 5 9 13 0 5 0 6 3 8 3 2 5 3 5 0 -1 -1 -1 "
    "-10 -2 -20 l0 -18 3 0 3 0 1 22 c1 26 1 25 8 22 2 -2 6 -4 9 -5 l4 -2 7 3 "
    "c4 3 9 5 11 7 l3 2 0 10 0 10 8 4 c9 5 8 6 7 -12 -1 -9 -1 -16 -1 -17 1 0 "
    "8 1 17 2 20 4 19 4 13 -6 -7 -11 -4 -10 -33 -15 -33 -5 -33 -6 -15 -16 11 "
    "-7 12 -7 13 -5 2 3 1 3 -6 7 -5 4 -6 4 -4 5 2 1 34 7 35 7 1 -2 -15 -26 "
    "-17 -27 -43 -8 -48 -9 -45 -13 1 -1 4 -1 22 3 11 2 21 4 21 3 0 0 -2 -4 -5 "
    "-9 l-6 -9 -5 -1 c-19 -2 -19 -29 0 -29 12 0 20 15 13 23 -1 1 -2 2 -2 3 1 "
    "2 10 19 11 19 0 0 4 -9 7 -21 7 -20 8 -21 12 -19 1 1 0 5 -6 24 -5 12 -8 "
    "23 -8 24 0 1 10 19 13 23 1 2 2 0 8 -16 4 -10 7 -18 7 -19 0 0 -3 2 -7 4 "
    "-8 5 -8 5 -10 2 -1 -3 -1 -3 6 -7 24 -14 24 -14 10 21 l-9 25 5 10 c5 8 6 "
    "9 7 7 3 -9 12 -30 13 -31 0 -1 7 3 14 8 16 11 15 11 15 0 l0 -9 -7 -5 c-12 "
    "-7 -11 -6 -11 -18 l0 -11 3 -2 c2 -2 6 -4 9 -6 7 -4 8 -2 -13 -17 -10 -7 "
    "-19 -13 -19 -13 -1 0 0 -2 1 -3 l2 -2 16 11 c9 6 17 11 18 11 1 1 1 0 1 -3 "
    "0 -4 0 -5 -6 -8 l-6 -4 -1 -10 0 -9 6 -4 c9 -6 10 -6 18 -1 l8 5 0 9 0 9 "
    "-5 3 c-3 2 -6 4 -6 5 -2 0 -2 2 -2 5 l1 4 17 -12 c19 -12 18 -12 20 -9 1 3 "
    "-9 11 -34 26 -5 3 -5 3 2 7 3 2 7 4 9 6 l3 2 0 11 0 11 -3 2 c-2 2 -6 4 -9 "
    "6 l-6 3 0 10 c0 7 0 9 1 8 1 0 7 -4 14 -9 18 -12 24 -15 38 -14 5 0 6 1 6 "
    "3 l0 3 -10 0 c-11 1 -17 3 -36 17 l-12 9 -1 10 c0 8 0 10 1 10 56 -25 116 "
    "-4 151 53 7 9 7 10 4 12 -2 1 -3 1 -3 0 -26 -42 -57 -65 -96 -69 -16 -2 "
    "-38 2 -50 8 l-3 2 10 6 c24 14 38 22 44 26 33 20 51 61 47 102 -2 17 -3 21 "
    "-6 21 -3 0 -3 -1 -2 -9 8 -39 -5 -79 -33 -101 l-6 -6 -1 30 c0 20 0 31 -1 "
    "32 -1 0 -7 4 -13 8 -7 4 -12 7 -12 7 0 1 6 11 13 23 7 12 13 22 12 22 -2 4 "
    "-4 3 -8 -4 -2 -3 -4 -6 -4 -6 -1 0 -5 12 -11 27 -3 6 -2 7 -18 -4 l-14 -9 "
    "-1 10 c0 5 0 10 1 10 0 0 4 2 9 5 l8 5 0 11 0 12 -9 5 c-9 6 -10 7 -7 9 6 "
    "3 36 23 36 24 0 6 -2 6 -20 -6 l-17 -12 -1 4 c0 5 0 6 5 8 8 4 8 4 8 14 0 "
    "9 0 9 -10 14 l-7 4 -7 -5z m17 -13 l0 -7 -5 -2 -5 -2 -4 3 -5 2 0 6 c0 5 1 "
    "5 5 8 l5 3 4 -3 5 -2 0 -6z m-105 -16 c3 -4 3 -8 -1 -12 -5 -5 -11 -3 -13 "
    "3 -3 9 8 15 14 9z m102 -28 c9 -5 9 -5 9 -14 l0 -8 -7 -4 c-8 -5 -8 -5 -16 "
    "0 l-6 4 -1 8 0 9 7 4 c9 5 7 5 14 1z m-172 -47 c3 -2 4 -3 4 -8 l0 -6 -5 "
    "-2 -4 -3 -4 2 c-8 4 -9 12 -2 16 5 4 6 4 11 1z m200 -7 c2 -5 3 -9 3 -9 0 "
    "-1 -32 -19 -33 -19 -1 0 -1 4 -1 10 l0 10 13 8 c8 5 14 8 14 8 1 0 2 -4 4 "
    "-8z m-49 -1 l12 -7 0 -10 c0 -6 0 -10 -1 -10 0 0 -33 18 -33 19 0 0 6 15 7 "
    "16 0 2 2 1 15 -8z m-93 -29 l0 -8 -7 -4 -8 -4 -7 4 -7 5 0 7 1 8 7 5 7 4 7 "
    "-4 7 -4 0 -9z m79 9 c4 -3 12 -7 15 -9 4 -2 7 -4 7 -4 0 -1 -21 -12 -22 "
    "-11 -1 1 -13 22 -13 23 0 7 2 7 13 1z m70 1 c1 -3 -11 -27 -13 -26 -2 1 "
    "-21 11 -21 12 0 1 30 18 32 18 0 0 1 -2 2 -4z m-112 -2 c4 -1 8 -2 8 -2 1 "
    "-1 2 -37 1 -37 0 0 -4 3 -9 5 l-8 5 0 9 c-1 5 -1 12 -2 15 0 3 0 6 1 6 0 0 "
    "4 -1 9 -1z m21 -4 c2 0 14 -19 15 -23 1 -1 -16 -12 -19 -12 -1 0 -1 2 -1 5 "
    "0 3 0 11 -1 18 0 14 0 14 6 12z m47 -24 c0 -11 1 -10 -15 -20 -16 -9 -14 "
    "-9 -24 -3 -5 3 -9 6 -8 6 1 1 46 27 46 27 1 0 1 -4 1 -10z m12 7 c4 -2 9 "
    "-5 31 -18 6 -3 11 -6 11 -7 -2 -1 -18 -10 -19 -10 0 0 -7 4 -15 9 l-14 8 0 "
    "11 c0 5 0 10 1 10 0 0 2 -1 5 -3z m-82 -19 c10 -5 10 -5 -4 -12 -6 -4 -13 "
    "-8 -16 -9 -2 -1 -4 -2 -4 -2 0 0 -3 4 -6 7 -3 4 -5 7 -5 7 1 1 26 14 27 14 "
    "0 0 4 -2 8 -5z m89 -13 l14 -9 0 -16 0 -17 -15 -8 -15 -9 -7 4 c-4 2 -11 6 "
    "-15 9 l-8 4 0 17 1 16 13 9 c17 10 15 10 32 0z m-77 -1 c0 -2 0 -7 0 -12 "
    "l0 -9 -13 0 -13 0 -3 3 -3 4 15 8 c18 10 17 10 17 6z m20 -5 l5 -3 0 -16 0 "
    "-17 -7 -4 c-3 -2 -8 -4 -9 -5 l-2 -1 0 27 0 27 4 -2 c2 -1 6 -4 9 -6z m95 "
    "-32 l0 -14 -9 5 -9 5 0 17 0 17 9 5 9 5 0 -14 c0 -7 0 -19 0 -26z m-249 19 "
    "c3 -3 3 -9 -1 -12 -8 -6 -18 4 -11 12 3 3 9 3 12 0z m134 -14 c0 -2 0 -8 0 "
    "-12 l0 -7 -4 2 c-3 2 -10 6 -16 9 -12 7 -12 7 -9 11 2 2 3 2 16 2 l14 0 -1 "
    "-5z m-19 -15 c9 -5 16 -10 15 -10 0 0 -4 -3 -8 -5 l-8 -5 -13 7 c-7 3 -13 "
    "6 -13 7 -1 1 10 15 11 15 0 -1 8 -5 16 -9z m123 -5 c4 -2 7 -5 7 -5 0 0 "
    "-23 -14 -43 -26 l-4 -2 0 11 0 11 6 3 c3 2 10 5 15 8 10 6 8 6 19 0z m-60 "
    "-3 l14 -9 0 -10 c0 -6 0 -11 0 -11 -2 0 -47 27 -47 28 0 1 15 10 17 10 1 0 "
    "8 -4 16 -8z m-44 -15 c0 -4 0 -13 -1 -19 l0 -11 -9 -1 c-5 -1 -9 -2 -9 -1 "
    "0 0 0 12 1 22 l1 7 8 5 c10 6 9 6 9 -2z m16 2 c5 -3 9 -5 10 -6 3 -2 -12 "
    "-23 -16 -24 -3 0 -4 0 -4 1 0 4 0 30 1 32 0 3 0 3 9 -3z m-69 -14 c7 -3 7 "
    "-4 6 -14 l0 -7 -6 -3 c-8 -5 -8 -5 -16 0 l-6 3 0 9 0 9 6 3 c8 5 8 5 16 0z "
    "m97 -2 c7 -5 10 -7 9 -7 -10 -6 -31 -17 -31 -16 -3 3 6 29 11 29 0 0 5 -3 "
    "11 -6z m14 -22 l0 -10 -9 -6 c-5 -3 -10 -7 -13 -8 -2 -2 -4 -3 -4 -3 -1 1 "
    "-7 17 -7 18 0 1 6 5 14 9 7 4 14 8 15 9 4 2 4 1 4 -9z m-163 -9 c6 -3 6 "
    "-12 0 -15 l-5 -3 -4 2 c-8 4 -9 13 -1 17 5 3 5 3 10 -1z m173 -37 c7 -4 8 "
    "-6 8 -16 l0 -5 -8 -4 -7 -5 -7 4 c-3 2 -7 4 -7 5 0 0 -1 15 0 16 0 1 13 9 "
    "14 9 0 0 3 -2 7 -4z m-103 -41 c4 -3 4 -8 0 -11 -7 -7 -17 0 -13 10 1 4 10 "
    "5 13 1z m102 -21 c11 -7 0 -23 -12 -16 -6 3 -6 12 0 16 6 4 6 4 12 0z M256 "
    "430 c-2 -3 -1 -4 8 -6 48 -17 86 -59 96 -110 1 -8 2 -10 4 -10 3 0 4 2 2 "
    "12 -11 53 -50 96 -100 113 -9 3 -10 3 -10 1z M370 422 c-15 -9 -13 -6 -13 "
    "-22 l1 -13 10 -7 c14 -7 12 -7 25 1 l11 6 0 14 0 14 -11 6 c-13 7 -12 7 "
    "-23 1z m23 -9 c1 -1 1 -1 -3 -3 -9 -6 -9 -6 -16 -2 -8 4 -8 4 0 9 l7 4 5 "
    "-3 c3 -2 6 -4 7 -5z m5 -14 l0 -9 -7 -4 c-7 -4 -7 -4 -7 2 -1 10 -1 11 7 "
    "15 3 2 7 4 7 4 0 0 0 -4 0 -8z m-27 4 c3 -2 6 -4 6 -4 0 0 0 -15 0 -16 -1 "
    "0 -4 2 -7 4 l-7 4 0 7 c0 9 0 9 8 5z M424 417 l-7 -4 0 -10 0 -9 7 -4 c4 "
    "-2 8 -4 9 -4 0 0 4 2 8 4 l7 4 0 9 0 10 -7 4 c-9 5 -9 5 -17 0z m14 -6 c4 "
    "-2 4 -2 4 -8 0 -5 0 -5 -9 -10 0 -1 -3 0 -5 2 -7 4 -7 12 -1 16 5 4 5 4 11 "
    "0z M275 401 c-1 -3 0 -3 8 -9 66 -45 77 -140 23 -196 -11 -12 -12 -13 -10 "
    "-14 4 -6 27 20 38 42 30 61 6 143 -52 176 -6 4 -5 4 -7 1z M251 384 c-1 -3 "
    "-1 -3 1 -4 1 -1 6 -4 11 -7 4 -2 12 -8 18 -13 l9 -8 2 2 c2 2 2 2 0 4 -6 7 "
    "-24 21 -34 25 -6 4 -5 4 -7 1z M406 370 c-7 -2 -11 -13 -6 -19 6 -6 14 -6 "
    "20 0 7 9 -2 22 -14 19z m8 -8 c2 -2 3 -5 0 -7 -3 -4 -10 -1 -10 3 0 5 6 8 "
    "10 4z M378 359 c0 0 0 -20 0 -44 l-1 -44 4 0 3 0 0 44 0 45 -3 0 c-2 0 -3 "
    "0 -3 -1z M251 353 c-1 -3 -2 -2 6 -8 36 -26 49 -72 33 -113 -4 -8 -4 -10 1 "
    "-10 2 0 6 10 9 21 10 39 -7 85 -41 108 -7 5 -6 5 -8 2z M300 336 c-1 0 -1 "
    "-3 -1 -10 l1 -8 9 -1 10 0 0 9 c0 8 0 10 -2 10 -2 1 -15 1 -17 0z m13 -9 "
    "c0 -3 -1 -4 -4 -4 -3 0 -3 0 -3 4 0 4 0 4 3 4 3 -1 4 -1 4 -4z M398 327 "
    "c-3 -2 -6 -5 -6 -6 0 -1 0 -3 0 -5 -1 -12 9 -19 20 -13 8 4 8 5 8 12 0 8 0 "
    "8 -8 12 -8 5 -6 5 -14 0z m11 -4 c2 -3 -2 -5 -6 -3 -2 1 -2 1 -1 3 2 1 5 1 "
    "7 0z m-8 -9 c4 -2 3 -7 -2 -5 -1 1 -2 2 -2 4 0 3 1 4 4 1z m10 -5 c-2 -2 "
    "-3 -1 -3 2 0 4 4 6 5 2 0 -1 0 -3 -2 -4z M361 292 c-1 -1 -2 -3 -2 -4 0 -1 "
    "1 -3 2 -4 1 -1 3 -2 4 -2 1 0 3 1 4 2 1 1 2 3 2 4 0 1 -1 3 -2 4 -1 1 -3 2 "
    "-4 2 -1 0 -3 -1 -4 -2z M408 282 c-6 -7 -2 -18 7 -18 10 0 14 15 5 19 -5 3 "
    "-8 2 -12 -1z m10 -4 c1 -2 1 -6 -1 -7 -2 -2 -6 0 -6 3 0 4 4 6 7 4z M390 "
    "271 c-1 -5 -2 -12 -2 -15 -2 -7 -2 -7 1 -8 3 -2 5 4 7 24 l0 8 -3 0 -3 0 0 "
    "-9z M363 268 c-1 -1 -1 -6 -2 -11 -1 -11 -7 -27 -13 -40 -5 -10 -5 -13 -1 "
    "-13 3 0 17 33 19 48 3 15 3 17 1 17 -4 1 -4 1 -4 -1z M411 250 c-5 -35 -23 "
    "-70 -49 -94 -8 -8 -9 -10 -5 -12 5 -2 33 32 43 52 11 21 20 56 16 58 -3 2 "
    "-5 1 -5 -4z M380 238 c-9 -3 -10 -13 -3 -18 5 -3 7 -3 12 0 l4 3 -1 6 c0 8 "
    "-6 12 -12 9z M422 207 c-7 -82 -60 -152 -135 -180 -11 -5 -14 -7 -10 -10 1 "
    "-1 17 5 29 11 69 33 114 98 122 175 2 16 2 16 -2 16 l-3 0 -1 -12z M331 "
    "200 c-1 -1 -3 -3 -4 -4 -4 -8 7 -16 14 -10 6 7 -1 18 -10 14z m6 -7 c0 -2 "
    "-3 -4 -4 -2 -2 1 0 4 2 4 1 0 2 -1 2 -2z M314 178 c-15 -12 -33 -18 -53 "
    "-20 -7 0 -7 -1 -7 -3 0 -7 28 -2 47 8 9 4 23 14 23 16 0 4 -4 4 -10 -1z "
    "M393 159 c-14 -20 -37 -39 -60 -49 -9 -4 -10 -6 -8 -9 1 -1 2 -1 7 1 25 11 "
    "49 30 64 50 7 9 7 9 4 11 -3 1 -2 2 -7 -4z M335 141 c-3 -3 -3 -4 -3 -7 2 "
    "-9 13 -10 16 -2 3 9 -7 16 -13 9z M314 126 c-22 -8 -51 -8 -73 -1 -4 2 -4 "
    "2 -5 -1 -2 -4 6 -7 25 -10 25 -3 65 5 63 13 0 3 -2 2 -10 -1z M297 107 c-1 "
    "-1 -1 -5 0 -10 l0 -9 10 0 9 0 0 10 0 10 -10 0 c-5 0 -9 0 -9 -1z m13 -9 "
    "l0 -4 -4 0 c-4 1 -6 5 -3 7 3 2 6 1 7 -3z M352 102 c-3 -2 -3 -9 1 -12 4 "
    "-4 10 -2 12 3 3 8 -6 14 -13 9z m8 -5 c0 -2 -1 -3 -2 -3 -2 0 -3 3 -2 4 1 "
    "2 4 1 4 -1z M338 84 c-2 -3 -16 -12 -24 -16 -4 -2 -6 -4 -6 -5 1 0 1 -2 1 "
    "-2 0 -3 9 1 22 10 13 8 14 9 12 12 -2 4 -2 4 -5 1z M250 81 c-1 -4 5 -6 22 "
    "-6 14 0 15 0 15 4 l0 3 -13 0 c-8 0 -16 0 -19 0 -4 1 -5 1 -5 -1z M276 65 "
    "c-6 -3 -8 -5 -8 -8 l0 -3 -10 0 -10 0 0 -3 0 -2 10 -1 c9 0 10 0 11 -2 3 "
    "-7 13 -9 21 -4 l5 3 0 8 0 8 -7 3 -7 4 -5 -3z m8 -4 c4 -2 4 -2 0 -4 -4 -2 "
    "-10 2 -6 4 3 1 3 1 6 0z m-7 -9 c2 -1 3 -7 1 -7 -2 0 -4 3 -5 6 0 3 0 4 4 "
    "1z m13 -1 c0 -3 -1 -4 -3 -5 l-3 -2 0 4 c0 3 1 4 2 5 4 1 4 1 4 -2z")


def logo(colour="#1b2027"):
    """The original mark on its own, at the traced drawing's own size."""
    w, h = LOGO_BOX
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {f(w)} {f(h)}" fill="{colour}" stroke="none">'
            f'<g transform="translate(0 {f(h)}) scale(1 -1)">'
            f'<path d="{LOGO_PATH}"/></g></svg>')


def icon(colour="#1b2027", ground="#ffffff"):
    """The application icon: the original mark on a rounded white ground.

    An application menu shows one file and cannot pick per theme the way the
    README's logo does with `<picture>`, and line art on a transparent ground
    is invisible on a dark panel — so the ground is part of the icon.

    **This one only works with room.** Rendered at 32 and 48 the arcs and the
    small shapes collapse into noise, which is the same limit `docs/logo.png`
    has and the reason `icon_small` exists; `flake.nix` renders this at 64 and
    up and that one below. Check both ends after changing either.
    """
    side, pad = 100.0, 9.0
    w, h = LOGO_BOX
    scale = (side - 2 * pad) / max(w, h)
    tx, ty = (side - w * scale) / 2, (side - h * scale) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(side)} '
            f'{f(side)}" fill="{colour}" stroke="none">'
            f'<rect x="0" y="0" width="{f(side)}" height="{f(side)}" rx="18" '
            f'fill="{ground}"/>'
            f'<g transform="translate({f(tx)} {f(ty)}) scale({scale:.5f}) '
            f'translate(0 {f(h)}) scale(1 -1)"><path d="{LOGO_PATH}"/></g></svg>')


def icon_small(colour="#1b2027", ground="#ffffff"):
    """The icon at the sizes the artwork cannot survive: the plain flake,
    loosened for a margin, on the same ground. The stroke is heavier than the
    header's because the ground eats into the drawing. Both numbers were
    settled by rendering four of them at 32, 48 and 64 and comparing: below
    4.6 the arms go thin at 32px, above it the core hexagon fills in and the
    middle turns to a blob. The crop is looser than the header's so the ground
    reads as a tile rather than as a box drawn around the mark."""
    x, y, side = 0.0, 14.0, 92.0
    ground_rect = (f'<rect x="{f(x)}" y="{f(y)}" width="{f(side)}" '
                   f'height="{f(side)}" rx="20" fill="{ground}" stroke="none"/>')
    body = svg([ground_rect] + flake(beads=False),
               box=f"{f(x)} {f(y)} {f(side)} {f(side)}", stroke=4.6)
    return body.replace("currentColor", colour)


def favicon(colour="#1b2027"):
    return "data:image/svg+xml," + urllib.parse.quote(
        plain().replace("currentColor", colour), safe="")


if __name__ == "__main__":
    if "--full" in sys.argv:
        print(full())
    elif "--flake" in sys.argv:
        print(plain())
    elif "--icon" in sys.argv:
        print(icon())
    elif "--icon-small" in sys.argv:
        print(icon_small())
    elif "--logo" in sys.argv:
        print(logo())
    else:
        print("full drawing (homepage hero):\n" + full() + "\n")
        print("plain flake (headers):\n" + plain() + "\n")
        print("favicon:\n" + favicon())
