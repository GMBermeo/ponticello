#!/usr/bin/env python3
"""
Ponticello's mark, and every asset derived from it.

    python3 tools/make-icons.py

## The idea

The mark is the app's own fingerboard, reduced until only what is unique to it
survives: a tapered dark board with the four first-position tapes across it —
BLUE, YELLOW, YELLOW, GREEN — at their true stopping distances.

Two things make it specific rather than decorative. The board **tapers**, wide
at the bridge end and narrow at the nut, which is what a neck actually does and
what stops the shape reading as a barcode. And the bands **bunch as they
climb**, because they sit at `690 * (1 - 2^(-n/12))` millimetres rather than at
even intervals — that compression is the single most useful thing a beginner
internalises about the instrument, and it is the thing this app exists to
teach. Evenly spaced bands would be a different, wrong picture.

The board is drawn nut-at-the-bottom, matching the player's own view and the
orientation the fingerboard panel now uses on the play screen.

## Why Pillow, and why supersampled

This machine has no ImageMagick, Inkscape or rsvg, so the PNGs are drawn
directly. Everything is rendered at 4x and reduced with LANCZOS, which is what
gives the rounded caps and the wordmark clean edges; drawing at final size
gives visibly ragged ones. `assets/logo/ponticello-mark.svg` is the same
geometry kept as vector, for anyone who needs to scale it further.
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "assets", "images")
LOGO = os.path.join(ROOT, "assets", "logo")
IOS_ICON = os.path.join(ROOT, "assets", "expo.icon")

# ── Palette, lifted from src/theme/tokens.ts ────────────────────────────────
# The brand blues for the ground, the Neon chrome's ink for the board, and the
# tape colours as they read on a dark board (TAPE_COLOR_ON_DARK).
GROUND_TOP = (10, 132, 255, 255)      # BLUE.cobalt
GROUND_BOTTOM = (0, 72, 168, 255)     # a step past BLUE.ocean, for depth
NAVY = (11, 18, 32, 255)              # BLUE.navy — splash ground
INK = (15, 23, 42, 255)               # INK — the board
STRING = (203, 213, 225, 150)         # slate-300, translucent
NUT = (231, 226, 216, 255)            # bone
SHADOW = (0, 20, 60, 110)

SS = 4  # supersample factor

# ── Geometry, in a 0..1 art box ─────────────────────────────────────────────
# Nut at the bottom, bridge end at the top — the player's own view.
# The board stops short of the box on both edges: the mark has to sit inside a
# launcher's mask without touching it.
BOARD_TOP, BOARD_BOTTOM = 0.04, 0.90
# A real neck widens towards the body, but only slightly — 24 mm at the nut
# against about 50 mm at the heel over 600 mm of board. Exaggerating it turns
# the silhouette into a plant pot, which is what the first attempt looked like.
HALF_W_TOP, HALF_W_BOTTOM = 0.285, 0.205

STRING_LENGTH_MM = 690.0
# How far up the string the drawing reaches. Chosen so the four first-position
# tapes fill the board without crowding its top edge.
SHOWN_MM = 200.0
# FIRST_POSITION_TAPES from src/domain/tapes.ts: fingers 1-4, one semitone each.
TAPES = [
    (2, (100, 210, 255, 255)),   # blue   — 1st finger (lifted to cyan so it reads on the blue ground)
    (3, (255, 214, 10, 255)),    # yellow — 2nd finger
    (4, (255, 214, 10, 255)),    # yellow — 3rd finger
    (5, (48, 209, 88, 255)),     # green  — 4th finger
]
# Tape stops short of the board's edges, as it does on a real neck; it also
# keeps the blue tape from bleeding into the blue ground.
TAPE_INSET = 0.022
# The bridge end of a fingerboard is rounded; this is how far the arc rises.
TOP_ARC = 0.035
STRING_W = 0.007
BAND_H = 0.058
# Enough of a nut to read as one, and to stop the board floating.
NUT_H = 0.055


def stop_fraction(semitones: int) -> float:
    """Where a stopped note sits, as a fraction of the drawn board."""
    mm = STRING_LENGTH_MM * (1 - 2 ** (-semitones / 12))
    return mm / SHOWN_MM


def tape_y(semitones: int) -> float:
    """...and where that lands in the art box, nut at the bottom."""
    return BOARD_BOTTOM - stop_fraction(semitones) * (BOARD_BOTTOM - BOARD_TOP)


def _half_w(y: float) -> float:
    """Half-width of the board at a vertical position, 0 top to 1 bottom."""
    t = (y - BOARD_TOP) / (BOARD_BOTTOM - BOARD_TOP)
    return HALF_W_TOP + (HALF_W_BOTTOM - HALF_W_TOP) * t


def _board(d, px, fill) -> None:
    """The tapered board, with its rounded bridge end."""
    top = BOARD_TOP + TOP_ARC
    d.polygon(
        [
            ((0.5 - _half_w(top)) * px, top * px),
            ((0.5 + _half_w(top)) * px, top * px),
            ((0.5 + _half_w(BOARD_BOTTOM)) * px, BOARD_BOTTOM * px),
            ((0.5 - _half_w(BOARD_BOTTOM)) * px, BOARD_BOTTOM * px),
        ],
        fill=fill,
    )
    w = _half_w(top)
    d.ellipse(
        [(0.5 - w) * px, BOARD_TOP * px, (0.5 + w) * px, (top + TOP_ARC) * px],
        fill=fill,
    )


def _strings(d, px) -> None:
    """Four strings, C to A, converging towards the nut like the real ones."""
    for i in range(4):
        lane = (i + 0.5) / 4 * 2 - 1  # -0.75 .. 0.75
        x_top = 0.5 + lane * _half_w(BOARD_TOP) * 0.78
        x_bottom = 0.5 + lane * _half_w(BOARD_BOTTOM) * 0.78
        d.line(
            [(x_top * px, (BOARD_TOP + TOP_ARC) * px), (x_bottom * px, BOARD_BOTTOM * px)],
            fill=STRING, width=max(1, int(STRING_W * px)),
        )


def draw_mark(size: int, mono: bool = False) -> Image.Image:
    """The mark alone, on a transparent ground, filling `size` x `size`."""
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))

    if mono:
        # A themed launcher icon is one colour, so the tapes have to be holes
        # punched through the board rather than bands laid over it — otherwise
        # the mark is a featureless trapezoid.
        d = ImageDraw.Draw(img)
        _board(d, px, (255, 255, 255, 255))
        for semitones, _ in TAPES:
            _band(d, px, tape_y(semitones), (0, 0, 0, 0))
        return img.resize((size, size), Image.LANCZOS)

    # A soft shadow under the board lifts it off the ground.
    shadow = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    _board(ImageDraw.Draw(shadow), px, SHADOW)
    shadow = shadow.transform(shadow.size, Image.AFFINE, (1, 0, 0, 0, 1, -int(px * 0.018)))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(px * 0.025)))

    d = ImageDraw.Draw(img)
    _board(d, px, INK)
    for semitones, colour in TAPES:
        _band(d, px, tape_y(semitones), colour, inset=TAPE_INSET)
    _strings(d, px)
    # The nut: a pale bar across the bottom edge, which is what tells you which
    # end you are looking at.
    _band(d, px, BOARD_BOTTOM - NUT_H / 2, NUT, height=NUT_H)
    return img.resize((size, size), Image.LANCZOS)


def _band(d, px, y, fill, height: float = BAND_H, inset: float = 0.0):
    """One tape, cut to the board's taper at that height."""
    top, bottom = y - height / 2, y + height / 2
    d.polygon(
        [
            ((0.5 - _half_w(top) + inset) * px, top * px),
            ((0.5 + _half_w(top) - inset) * px, top * px),
            ((0.5 + _half_w(bottom) - inset) * px, bottom * px),
            ((0.5 - _half_w(bottom) + inset) * px, bottom * px),
        ],
        fill=fill,
    )


def gradient(size: int) -> Image.Image:
    """The brand ground: cobalt at the top deepening to ocean at the bottom."""
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        colour = tuple(int(a + (b - a) * t) for a, b in zip(GROUND_TOP, GROUND_BOTTOM))
        d.line([(0, y), (size, y)], fill=colour)
    return img


def compose(size: int, ground, art_fraction: float, **kw) -> Image.Image:
    """The mark centred inside a ground (a colour, or an image), occupying `art_fraction` of the box."""
    img = ground.copy() if isinstance(ground, Image.Image) else Image.new("RGBA", (size, size), ground)
    art = int(size * art_fraction)
    mark = draw_mark(art, **kw)
    off = (size - art) // 2
    img.alpha_composite(mark, (off, off))
    return img


def transparent(size: int, art_fraction: float, **kw) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    art = int(size * art_fraction)
    mark = draw_mark(art, **kw)
    off = (size - art) // 2
    img.alpha_composite(mark, (off, off))
    return img


def archivo(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """The same family the interface is set in — see src/theme/tokens.ts."""
    path = os.path.join(
        ROOT, "node_modules", "@expo-google-fonts", "archivo", weight,
        f"Archivo_{weight}.ttf",
    )
    return ImageFont.truetype(path, size)


def wordmark(width: int, height: int, ink=INK) -> Image.Image:
    """The mark beside the name, for the library header."""
    px_w, px_h = width * SS, height * SS
    img = Image.new("RGBA", (px_w, px_h), (0, 0, 0, 0))

    art = int(px_h * 0.78)
    mark = draw_mark(art)
    img.alpha_composite(mark, (int(px_h * 0.11), int(px_h * 0.11)))

    d = ImageDraw.Draw(img)
    font = archivo("800ExtraBold", int(px_h * 0.46))
    text = "Ponticello"
    box = d.textbbox((0, 0), text, font=font)
    d.text(
        (art + int(px_h * 0.34), (px_h - (box[3] - box[1])) // 2 - box[1]),
        text,
        font=font,
        fill=ink,
    )
    return img.resize((width, height), Image.LANCZOS)


def alpha_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    return img.getchannel("A").getbbox()


def _rgba(colour) -> str:
    r, g, b, a = colour
    return f"rgba({r},{g},{b},{a / 255:.2f})"


def mark_svg() -> str:
    """The same mark as vector, on a transparent ground: for the web, the README and the iOS icon."""
    def pt(x, y):
        return f"{x * 100:.3f},{y * 100:.3f}"

    top = BOARD_TOP + TOP_ARC
    board = (
        f'<path d="M{pt(0.5 - _half_w(top), top)} '
        f'A{_half_w(top) * 100:.3f},{TOP_ARC * 100:.3f} 0 0 1 {pt(0.5 + _half_w(top), top)} '
        f'L{pt(0.5 + _half_w(BOARD_BOTTOM), BOARD_BOTTOM)} L{pt(0.5 - _half_w(BOARD_BOTTOM), BOARD_BOTTOM)} Z" '
        f'fill="{_rgba(INK)}"/>'
    )

    def band(y, colour, height=BAND_H, inset=0.0):
        t, b = y - height / 2, y + height / 2
        pts = " ".join(pt(x, yy) for x, yy in [
            (0.5 - _half_w(t) + inset, t), (0.5 + _half_w(t) - inset, t),
            (0.5 + _half_w(b) - inset, b), (0.5 - _half_w(b) + inset, b),
        ])
        return f'<polygon points="{pts}" fill="{_rgba(colour)}"/>'

    strings = []
    for i in range(4):
        lane = (i + 0.5) / 4 * 2 - 1
        x1 = 0.5 + lane * _half_w(BOARD_TOP) * 0.78
        x2 = 0.5 + lane * _half_w(BOARD_BOTTOM) * 0.78
        strings.append(
            f'<line x1="{x1 * 100:.3f}" y1="{top * 100:.3f}" x2="{x2 * 100:.3f}" y2="{BOARD_BOTTOM * 100:.3f}" '
            f'stroke="{_rgba(STRING)}" stroke-width="{STRING_W * 100:.2f}"/>'
        )
    parts = [board, *(band(tape_y(n), c, inset=TAPE_INSET) for n, c in TAPES), *strings,
             band(BOARD_BOTTOM - NUT_H / 2, NUT, NUT_H)]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
        "  <!-- Ponticello: the fingerboard, tapered nut-at-the-bottom, with the\n"
        "       four first-position tapes at their true stopping distances.\n"
        "       Generated by tools/make-icons.py — edit that. -->\n  "
        + "\n  ".join(parts) + "\n</svg>\n"
    )


def main() -> None:
    os.makedirs(LOGO, exist_ok=True)
    written = []

    def save(img: Image.Image, path: str) -> None:
        img.save(path)
        written.append((os.path.relpath(path, ROOT), img.size, img.mode))

    # Base icon: mark on the app's own paper ground, generous margin.
    save(compose(1024, gradient(1024), 0.80), os.path.join(IMAGES, "icon.png"))

    # Android adaptive. The foreground is masked hard, so the art stays well
    # inside the centre 66% — checked below rather than assumed.
    save(transparent(1024, 0.52), os.path.join(IMAGES, "android-icon-foreground.png"))
    save(
        gradient(1024),
        os.path.join(IMAGES, "android-icon-background.png"),
    )
    save(
        transparent(1024, 0.52, mono=True),
        os.path.join(IMAGES, "android-icon-monochrome.png"),
    )

    # Splash: the mark alone, on app.json's navy splash ground.
    save(transparent(512, 0.92), os.path.join(IMAGES, "splash-icon.png"))
    save(compose(48, gradient(48), 0.80), os.path.join(IMAGES, "favicon.png"))
    save(compose(512, gradient(512), 0.80), os.path.join(LOGO, "ponticello-icon-512.png"))
    # The wordmark lives under assets/logo/, not assets/images/: it is a brand
    # asset for the README and a store listing, not something the app bundles.
    save(wordmark(1600, 400), os.path.join(LOGO, "ponticello-wordmark.png"))
    save(wordmark(1600, 400, ink=(248, 250, 252, 255)), os.path.join(LOGO, "ponticello-wordmark-light.png"))

    # ── Checks, rather than hope ────────────────────────────────────────────
    fg = Image.open(os.path.join(IMAGES, "android-icon-foreground.png"))
    x0, y0, x1, y1 = alpha_bounds(fg)
    safe_lo, safe_hi = 1024 * 0.17, 1024 * 0.83
    assert x0 >= safe_lo and y0 >= safe_lo and x1 <= safe_hi and y1 <= safe_hi, (
        f"adaptive foreground art {(x0, y0, x1, y1)} leaves the centre-66% safe zone"
    )

    mono = Image.open(os.path.join(IMAGES, "android-icon-monochrome.png"))
    hues = {p[:3] for p in mono.convert("RGBA").getdata() if p[3] > 200}
    assert hues <= {(255, 255, 255)}, f"monochrome icon is not one colour: {hues}"

    # Small-size previews, so the mark can be judged where it actually lives.
    icon = Image.open(os.path.join(IMAGES, "icon.png"))
    preview = os.environ.get("ICON_PREVIEW_DIR")
    if preview:
        os.makedirs(preview, exist_ok=True)
        for s in (32, 48, 96):
            icon.resize((s, s), Image.LANCZOS).save(
                os.path.join(preview, f"icon-{s}.png")
            )

    svg = mark_svg()
    for path in (os.path.join(LOGO, "ponticello-mark.svg"), os.path.join(IOS_ICON, "Assets", "ponticello-mark.svg")):
        with open(path, "w") as f:
            f.write(svg)
        written.append((os.path.relpath(path, ROOT), "vector", "svg"))

    for path, size, mode in written:
        print(f"  {path:44} {str(size):12} {mode}")


if __name__ == "__main__":
    main()
