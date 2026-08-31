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
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "assets", "images")
LOGO = os.path.join(ROOT, "assets", "logo")

# ── Palette, lifted from src/theme/tokens.ts ────────────────────────────────
# The muted set, because the icon sits on a light ground like the menus do.
PAPER = (243, 242, 242, 255)      # matches app.json's backgroundColor
INK = (32, 30, 29, 255)
ACCENT = (236, 48, 19, 255)
STRINGS = [
    (186, 43, 46, 255),   # C
    (157, 100, 0, 255),   # G
    (0, 121, 61, 255),    # D
    (98, 80, 178, 255),   # A
]

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
    (2, (54, 137, 221, 255)),    # blue   — 1st finger
    (3, (229, 194, 38, 255)),    # yellow — 2nd finger
    (4, (229, 194, 38, 255)),    # yellow — 3rd finger
    (5, (59, 179, 96, 255)),     # green  — 4th finger
]
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


def draw_mark(size: int, mono: bool = False) -> Image.Image:
    """The mark alone, on a transparent ground, filling `size` x `size`."""
    px = size * SS
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def half_w(y: float) -> float:
        """Half-width of the board at a vertical position, 0 top to 1 bottom."""
        t = (y - BOARD_TOP) / (BOARD_BOTTOM - BOARD_TOP)
        return HALF_W_TOP + (HALF_W_BOTTOM - HALF_W_TOP) * t

    def poly(points, fill):
        d.polygon([(x * px, y * px) for x, y in points], fill=fill)

    board = (255, 255, 255, 255) if mono else INK
    poly(
        [
            (0.5 - half_w(BOARD_TOP), BOARD_TOP),
            (0.5 + half_w(BOARD_TOP), BOARD_TOP),
            (0.5 + half_w(BOARD_BOTTOM), BOARD_BOTTOM),
            (0.5 - half_w(BOARD_BOTTOM), BOARD_BOTTOM),
        ],
        board,
    )

    if mono:
        # A themed launcher icon is one colour, so the tapes have to be holes
        # punched through the board rather than bands laid over it — otherwise
        # the mark is a featureless trapezoid.
        for semitones, _ in TAPES:
            _band(d, px, half_w, tape_y(semitones), (0, 0, 0, 0))
        return img.resize((size, size), Image.LANCZOS)

    for semitones, colour in TAPES:
        _band(d, px, half_w, tape_y(semitones), colour)

    # The nut: a pale bar across the bottom edge, which is what tells you which
    # end you are looking at.
    _band(d, px, half_w, BOARD_BOTTOM - NUT_H / 2, (216, 213, 210, 255), height=NUT_H)

    return img.resize((size, size), Image.LANCZOS)


def _band(d, px, half_w, y, fill, height: float = BAND_H):
    """One tape, cut to the board's taper at that height."""
    top, bottom = y - height / 2, y + height / 2
    d.polygon(
        [
            ((0.5 - half_w(top)) * px, top * px),
            ((0.5 + half_w(top)) * px, top * px),
            ((0.5 + half_w(bottom)) * px, bottom * px),
            ((0.5 - half_w(bottom)) * px, bottom * px),
        ],
        fill=fill,
    )


def compose(size: int, ground, art_fraction: float, **kw) -> Image.Image:
    """The mark centred inside a ground, occupying `art_fraction` of the box."""
    img = Image.new("RGBA", (size, size), ground)
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


def wordmark(width: int, height: int) -> Image.Image:
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
        fill=INK,
    )
    return img.resize((width, height), Image.LANCZOS)


def alpha_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    return img.getchannel("A").getbbox()


def main() -> None:
    os.makedirs(LOGO, exist_ok=True)
    written = []

    def save(img: Image.Image, path: str) -> None:
        img.save(path)
        written.append((os.path.relpath(path, ROOT), img.size, img.mode))

    # Base icon: mark on the app's own paper ground, generous margin.
    save(compose(1024, PAPER, 0.80), os.path.join(IMAGES, "icon.png"))

    # Android adaptive. The foreground is masked hard, so the art stays well
    # inside the centre 66% — checked below rather than assumed.
    save(transparent(1024, 0.52), os.path.join(IMAGES, "android-icon-foreground.png"))
    save(
        Image.new("RGBA", (1024, 1024), PAPER),
        os.path.join(IMAGES, "android-icon-background.png"),
    )
    save(
        transparent(1024, 0.52, mono=True),
        os.path.join(IMAGES, "android-icon-monochrome.png"),
    )

    # Splash: the mark alone at 76pt on #f3f2f2, per app.json.
    save(transparent(512, 0.92), os.path.join(IMAGES, "splash-icon.png"))
    save(compose(48, PAPER, 0.72), os.path.join(IMAGES, "favicon.png"))
    # The wordmark lives under assets/logo/, not assets/images/: it is a brand
    # asset for the README and a store listing, not something the app bundles.
    save(wordmark(1600, 400), os.path.join(LOGO, "ponticello-wordmark.png"))

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

    with open(os.path.join(LOGO, "ponticello-mark.svg"), "w") as f:
        def hw(y):
            t = (y - BOARD_TOP) / (BOARD_BOTTOM - BOARD_TOP)
            return HALF_W_TOP + (HALF_W_BOTTOM - HALF_W_TOP) * t

        def band_svg(y, colour, height=BAND_H):
            t, b = y - height / 2, y + height / 2
            pts = " ".join(
                f"{x * 100:.3f},{yy * 100:.3f}"
                for x, yy in [
                    (0.5 - hw(t), t), (0.5 + hw(t), t),
                    (0.5 + hw(b), b), (0.5 - hw(b), b),
                ]
            )
            return f'  <polygon points="{pts}" fill="rgb{colour[:3]}"/>'

        board = " ".join(
            f"{x * 100:.3f},{y * 100:.3f}"
            for x, y in [
                (0.5 - hw(BOARD_TOP), BOARD_TOP), (0.5 + hw(BOARD_TOP), BOARD_TOP),
                (0.5 + hw(BOARD_BOTTOM), BOARD_BOTTOM),
                (0.5 - hw(BOARD_BOTTOM), BOARD_BOTTOM),
            ]
        )
        bands = "\n".join(
            band_svg(tape_y(n), c) for n, c in TAPES
        )
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
            "  <!-- Ponticello: the fingerboard, tapered nut-at-the-bottom, with\n"
            "       the four first-position tapes at their true stopping\n"
            "       distances. Generated by tools/make-icons.py — edit that. -->\n"
            f'  <polygon points="{board}" fill="rgb{INK[:3]}"/>\n'
            f"{bands}\n"
            f"{band_svg(BOARD_BOTTOM - NUT_H / 2, (216, 213, 210, 255), NUT_H)}\n"
            "</svg>\n"
        )
        written.append((os.path.relpath(f.name, ROOT), "vector", "svg"))

    for path, size, mode in written:
        print(f"  {path:44} {str(size):12} {mode}")


if __name__ == "__main__":
    main()
