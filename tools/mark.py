"""Draw the nixgen mark, and print the two forms the pages use.

    python3 tools/mark.py            # both SVGs and the favicon data URI
    python3 tools/mark.py --full     # just the full drawing
    python3 tools/mark.py --flake    # just the plain flake
    python3 tools/mark.py --icon     # the application icon, as its own file

Generated rather than hand-written, for the same reason `tools/shots.py`
exists: six arms drawn by hand are six slightly different arms, and a mark
that has to be pasted into two pages and a favicon is a mark that will drift
between them. The output is inlined into `build/static/index.html` and
`docs/index.html` — nothing fetches it, so there is no file to keep in step.

Three forms, because one drawing cannot do all three jobs:

  full   the flake, the arcs it dissolves into, and the shapes coming off
         them. Needs about 80 pixels before the small shapes mean anything,
         so it is used on the homepage hero only.
  flake  six arms and the hexagon core, heavier stroke, cropped tight. This
         is what the headers and the favicon use; the full one at 22px is a
         smudge, which was checked by rendering it.
  icon   the flake on its own white ground, as a standalone file. The desktop
         entry points at it. Unlike the other two it cannot inherit a colour
         from the page around it, and it cannot pick per theme the way the
         README's logo does with `<picture>` — an application menu shows one
         file. Line art with a transparent ground would be invisible on a
         dark panel, so it carries the ground the palette already assumes.
         `flake.nix` generates it at build time rather than keeping a copy,
         so this file stays the only place the mark is drawn.
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


def icon(colour="#1b2027", ground="#ffffff"):
    """The application icon: the plain flake, loosened for a margin, on a
    rounded white ground. The stroke is heavier than the header's because the
    ground eats into the drawing. Both numbers were settled by rendering four
    of them at 32, 48 and 64 and comparing: below 4.6 the arms go thin at
    32px, above it the core hexagon fills in and the middle turns to a blob.
    The crop is looser than the header's so the ground reads as a tile rather
    than as a box drawn around the mark."""
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
    else:
        print("full drawing (homepage hero):\n" + full() + "\n")
        print("plain flake (headers):\n" + plain() + "\n")
        print("favicon:\n" + favicon())
