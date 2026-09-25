#!/usr/bin/env python3
"""
Every brand asset, derived from one hand-drawn master.

    python3 tools/make-icons.py

## The master

`assets/logo/ponticello-icon.svg` is drawn by hand in a vector editor and is
the only file a designer edits. It is a 100 × 100 tile made of three parts:

- the **ground** — a rounded square filled with the indigo gradient;
- the **strings** — a group of four string paths, C G D A, in the colours the
  app gives those strings (green, red, blue, yellow), running off the top edge
  and passing *behind* the bridge;
- the **bridge** — a group holding one even-odd path: crown, waist, feet and
  the round heart, in bleached maple.

Each group carries its own drop shadow. This script never writes the master; it
reads it, checks it still has those three parts, and derives everything else:
iOS glass layers, Android adaptive and themed icons, the splash, favicons, the
512 px tile, the wordmarks, the link preview and the product site's copies.

## Why a real SVG renderer

The master uses filters and free-form paths that Pillow cannot draw, so SVGs
are rasterised by `tools/rasterize-svg.mjs` (resvg, a dev dependency) and only
composed here with Pillow. What ships is what the editor showed.
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "assets", "images")
LOGO = os.path.join(ROOT, "assets", "logo")
IOS_ICON = os.path.join(ROOT, "assets", "expo.icon")
DOCS_BRAND = os.path.join(ROOT, "docs", "assets", "brand")
DOCS_SHOTS = os.path.join(ROOT, "docs", "assets", "screenshots")
MASTER = os.path.join(LOGO, "ponticello-icon.svg")
RASTERIZE = os.path.join(ROOT, "tools", "rasterize-svg.mjs")

SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def q(tag: str) -> str:
    return f"{{{SVG_NS}}}{tag}"


# ── Palette, lifted from src/theme/tokens.ts ────────────────────────────────
GROUND_TOP = (122, 108, 255)          # BRAND.glow
GROUND_BOTTOM = (42, 28, 158)         # BRAND.deep
INK = (17, 17, 20, 255)               # INK — wordmark on light
PAPER_INK = (245, 245, 247, 255)      # Dark chrome ink — wordmark on dark

# Android adaptive icons: a 108 dp canvas of which the launcher shows the
# centre 72 dp, masked to a circle on some launchers. The tile is fitted a
# little inside the 72 dp so the bridge's feet survive a circular mask, and the
# strings, unclipped, run off the top of the mask as they run off the tile.
ADAPTIVE_VISIBLE = 72 / 108
ADAPTIVE_FIT = 0.94


# ── Reading the master ──────────────────────────────────────────────────────

class Master:
    """The master SVG, split into the three parts every variant is made of."""

    def __init__(self, path: str):
        self.path = path
        tree = ET.parse(path)
        self.parts = self._parts(tree.getroot())
        container, ground, strings, bridge = self.parts
        problems = [name for name, part in (("a gradient-filled ground path", ground),
                                            ("a bridge group (with an even-odd path)", bridge),
                                            ("a strings group", strings)) if part is None]
        assert not problems, f"{path} is missing {', '.join(problems)} — see the docstring for the contract"
        kids = list(container)
        assert kids.index(strings) < kids.index(bridge), "the strings must be drawn before (behind) the bridge"
        count = len(list(strings.iter(q("path"))))
        assert count == 4, f"expected four string paths, found {count}"

    @staticmethod
    def _parts(root: ET.Element):
        container = next((g for g in root.findall(q("g")) if g.get("clip-path")), root)
        kids = list(container)
        ground = next((el for el in kids if el.tag == q("path") and "url(" in (el.get("fill") or "")), None)
        groups = [el for el in kids if el.tag == q("g")]
        bridge = next((g for g in groups if any(p.get("fill-rule") == "evenodd" for p in g.iter(q("path")))), None)
        strings = next((g for g in groups if g is not bridge), None)
        return container, ground, strings, bridge

    def variant(self, *, ground=True, strings=True, bridge=True, shadows=True, clip=True,
                mono: str | None = None, view_box: str | None = None, size: int | None = None) -> str:
        """A fresh copy of the master with parts removed or restyled, as SVG text."""
        root = ET.parse(self.path).getroot()
        container, ground_el, strings_el, bridge_el = self._parts(root)
        for keep, el in ((ground, ground_el), (strings, strings_el), (bridge, bridge_el)):
            if not keep:
                container.remove(el)
        if not shadows:
            strings_el.attrib.pop("filter", None)
            bridge_el.attrib.pop("filter", None)
        if not clip and container is not root:
            container.attrib.pop("clip-path", None)
        if mono:
            for el in root.iter():
                for attr in ("fill", "stroke"):
                    value = el.get(attr)
                    if value and value != "none" and not value.startswith("url("):
                        el.set(attr, mono)
        if view_box:
            root.set("viewBox", view_box)
        if size:
            root.set("width", str(size))
            root.set("height", str(size))
        return ET.tostring(root, encoding="unicode")


def rasterize(svg: str, width: int) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        src, out = os.path.join(tmp, "in.svg"), os.path.join(tmp, "out.png")
        with open(src, "w") as f:
            f.write(svg)
        subprocess.run(["node", RASTERIZE, src, out, str(width)], check=True, cwd=ROOT)
        return Image.open(out).convert("RGBA").copy()


def pixels(img: Image.Image):
    return img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata()


# ── Compositions ────────────────────────────────────────────────────────────

def gradient(width: int, height: int | None = None) -> Image.Image:
    height = height or width
    img = Image.new("RGBA", (width, height))
    d = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height - 1)
        d.line([(0, y), (width, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(GROUND_TOP, GROUND_BOTTOM)) + (255,))
    return img


def square_icon(master: Master, size: int) -> Image.Image:
    """Full-bleed square: the gradient to the corners, for an OS that masks its own shape."""
    img = gradient(size)
    img.alpha_composite(rasterize(master.variant(ground=False), size))
    return img


def adaptive_view_box() -> str:
    """The master's tile placed inside Android's 108 dp canvas, in master units."""
    span = 100 / (ADAPTIVE_VISIBLE * ADAPTIVE_FIT)
    offset = (span - 100) / 2
    return f"{-offset:.3f} {-offset:.3f} {span:.3f} {span:.3f}"


def archivo(weight: str, size: int) -> ImageFont.FreeTypeFont:
    path = os.path.join(ROOT, "node_modules", "@expo-google-fonts", "archivo", weight, f"Archivo_{weight}.ttf")
    return ImageFont.truetype(path, size)


def wordmark(tile: Image.Image, width: int, height: int, ink) -> Image.Image:
    """The icon beside the name, for the README, the site and a store listing."""
    ss = 4
    img = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
    side = int(height * ss * 0.80)
    img.alpha_composite(tile.resize((side, side), Image.LANCZOS), (int(height * ss * 0.10), int(height * ss * 0.10)))
    d = ImageDraw.Draw(img)
    font = archivo("800ExtraBold", int(height * ss * 0.44))
    box = d.textbbox((0, 0), "Ponticello", font=font)
    d.text((side + int(height * ss * 0.36), (height * ss - (box[3] - box[1])) // 2 - box[1]), "Ponticello", font=font, fill=ink)
    return img.resize((width, height), Image.LANCZOS)


def ios_icon_json() -> dict:
    """Icon Composer document: the bridge in front, the strings behind, as glass layers at full bleed."""
    def srgb(c):
        return "extended-srgb:" + ",".join(f"{v / 255:.5f}" for v in c) + ",1.00000"

    def layer(name):
        return {"image-name": f"ponticello-{name}.svg", "name": name,
                "position": {"scale": 1.0, "translation-in-points": [0, 0]}}

    return {
        "fill": {"linear-gradient": [srgb(GROUND_TOP), srgb(GROUND_BOTTOM)],
                 "orientation": {"start": {"x": 0.5, "y": 0}, "stop": {"x": 0.5, "y": 1}}},
        # Icon Composer lists groups front to back. Its own shadows stand in
        # for the master's drop shadows, which the layer SVGs leave out.
        "groups": [
            {"layers": [layer("bridge")], "shadow": {"kind": "neutral", "opacity": 0.5},
             "translucency": {"enabled": True, "value": 0.12}},
            {"layers": [layer("strings")], "shadow": {"kind": "layer-color", "opacity": 0.45},
             "translucency": {"enabled": False, "value": 0}},
        ],
        "supported-platforms": {"circles": ["watchOS"], "squares": "shared"},
    }


def device_frame(path: str, width: int) -> Image.Image:
    screen = Image.open(path).convert("RGBA")
    height = int(width * screen.height / screen.width)
    screen = screen.resize((width, height), Image.LANCZOS)
    pad = int(width * 0.03)
    fw, fh = width + 2 * pad, height + 2 * pad
    frame = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    mask = Image.new("L", (fw, fh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, fw - 1, fh - 1], radius=int(fw * 0.09), fill=255)
    frame.paste(Image.new("RGBA", (fw, fh), (27, 26, 34, 255)), (0, 0), mask)
    inner = Image.new("L", (width, height), 0)
    ImageDraw.Draw(inner).rounded_rectangle([0, 0, width - 1, height - 1], radius=int(width * 0.072), fill=255)
    frame.paste(screen, (pad, pad), inner)
    return frame


def og_image(tile: Image.Image) -> Image.Image | None:
    """The link preview: icon, headline and three captured screens. Needs the site's screenshots."""
    shots = {name: os.path.join(DOCS_SHOTS, f"{name}.webp") for name in ("library", "play-highway", "library-dark")}
    if not all(os.path.exists(p) for p in shots.values()):
        return None
    img = gradient(1200, 630)
    img.alpha_composite(tile.resize((92, 92), Image.LANCZOS), (64, 70))
    d = ImageDraw.Draw(img)
    d.text((174, 86), "Ponticello", font=archivo("800ExtraBold", 50), fill="white")
    d.text((64, 210), "Practise the cello,", font=archivo("800ExtraBold", 58), fill="white")
    d.text((64, 280), "not points.", font=archivo("800ExtraBold", 58), fill=(210, 205, 255))
    d.text((64, 380), "Redesigned for iPhone Duo.", font=archivo("600SemiBold", 28), fill="white")
    d.text((64, 420), "Your tapes on screen, three ways to read,", font=archivo("400Regular", 24), fill=(230, 228, 255))
    d.text((64, 452), "a tuner and chords for the cello.", font=archivo("400Regular", 24), fill=(230, 228, 255))
    d.text((64, 540), "Free and open source", font=archivo("600SemiBold", 22), fill=(210, 205, 255))
    for name, width, (x, y) in (("library", 230, (700, 150)), ("library-dark", 230, (1000, 250)),
                                ("play-highway", 250, (880, 80))):
        frame = device_frame(shots[name], width)
        shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
        shadow.paste(Image.new("RGBA", frame.size, (10, 0, 60, 140)), (x + 10, y + 24), frame.split()[3])
        img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))
        img.alpha_composite(frame, (x, y))
    return img.convert("RGB")


# ── Checks, rather than hope ────────────────────────────────────────────────

def check(master: Master, view_box: str) -> None:
    # The bridge must survive a circular launcher mask.
    bridge = rasterize(master.variant(ground=False, strings=False, clip=False, view_box=view_box), 1024)
    alpha = bridge.getchannel("A")
    radius = 1024 * ADAPTIVE_VISIBLE / 2
    outside = [(x, y) for y in range(0, 1024, 4) for x in range(0, 1024, 4)
               if alpha.getpixel((x, y)) > 128 and (x - 512) ** 2 + (y - 512) ** 2 > radius ** 2]
    assert not outside, f"the bridge leaves the adaptive icon's circular mask at {outside[:3]}"

    mono = Image.open(os.path.join(IMAGES, "android-icon-monochrome.png")).convert("RGBA")
    hues = {p[:3] for p in pixels(mono) if p[3] > 200}
    assert hues <= {(255, 255, 255)}, f"the themed icon is not one colour: {sorted(hues)[:4]}"

    # The heart — the hole in the bridge — must stay open at launcher size.
    heart = rasterize(master.variant(ground=False, strings=False, shadows=False), 48)
    assert heart.getpixel((24, 28))[3] < 128, "the bridge's heart has closed up at 48 px"


def main() -> None:
    master = Master(MASTER)
    with open(MASTER, "rb") as f:
        untouched = f.read()
    os.makedirs(DOCS_BRAND, exist_ok=True)
    written: list[tuple[str, object]] = []

    def save(img: Image.Image, *paths: str) -> None:
        for path in paths:
            img.save(path, optimize=True)
            written.append((os.path.relpath(path, ROOT), img.size))

    def write(text: str | bytes, *paths: str) -> None:
        for path in paths:
            assert os.path.abspath(path) != os.path.abspath(MASTER), "never write the master"
            with open(path, "wb" if isinstance(text, bytes) else "w") as f:
                f.write(text)
            written.append((os.path.relpath(path, ROOT), "svg"))

    tile_1024 = rasterize(master.variant(), 1024)

    # The rounded tile as drawn: base icon, README, in-app brand line, the site.
    save(tile_1024, os.path.join(IMAGES, "icon.png"))
    save(tile_1024.resize((512, 512), Image.LANCZOS),
         os.path.join(LOGO, "ponticello-icon-512.png"), os.path.join(DOCS_BRAND, "ponticello-icon-512.png"))
    save(rasterize(master.variant(), 48), os.path.join(IMAGES, "favicon.png"), os.path.join(DOCS_BRAND, "favicon.png"))
    # iOS rounds a touch icon itself, so it gets the full-bleed square.
    save(square_icon(master, 180), os.path.join(DOCS_BRAND, "apple-touch-icon.png"))
    # Splash: the tile, on app.json's midnight ground.
    save(rasterize(master.variant(), 512), os.path.join(IMAGES, "splash-icon.png"))

    # Android adaptive: the gradient behind, the unclipped mark in front, and a
    # one-colour silhouette for the themed icon.
    view_box = adaptive_view_box()
    save(gradient(1024), os.path.join(IMAGES, "android-icon-background.png"))
    save(rasterize(master.variant(ground=False, clip=False, view_box=view_box), 1024),
         os.path.join(IMAGES, "android-icon-foreground.png"))
    save(rasterize(master.variant(ground=False, clip=False, shadows=False, mono="#FFFFFF", view_box=view_box), 1024),
         os.path.join(IMAGES, "android-icon-monochrome.png"))

    save(wordmark(tile_1024, 1600, 400, INK),
         os.path.join(LOGO, "ponticello-wordmark.png"), os.path.join(DOCS_BRAND, "ponticello-wordmark.png"))
    save(wordmark(tile_1024, 1600, 400, PAPER_INK),
         os.path.join(LOGO, "ponticello-wordmark-light.png"), os.path.join(DOCS_BRAND, "ponticello-wordmark-light.png"))

    # Vector: the master copied for the site, the mark without its tile, and
    # the iOS glass layers. Icon Composer reads a layer's width and height as
    # points on its 1024 pt canvas — a bare 100-unit viewBox renders as a speck.
    write(untouched, os.path.join(DOCS_BRAND, "ponticello-icon.svg"))
    write(master.variant(ground=False), os.path.join(LOGO, "ponticello-mark.svg"), os.path.join(DOCS_BRAND, "ponticello-mark.svg"))
    assets = os.path.join(IOS_ICON, "Assets")
    os.makedirs(assets, exist_ok=True)
    for stale in os.listdir(assets):
        os.remove(os.path.join(assets, stale))
    write(master.variant(ground=False, strings=False, shadows=False, size=1024), os.path.join(assets, "ponticello-bridge.svg"))
    write(master.variant(ground=False, bridge=False, shadows=False, size=1024), os.path.join(assets, "ponticello-strings.svg"))
    write(json.dumps(ios_icon_json(), indent=2) + "\n", os.path.join(IOS_ICON, "icon.json"))

    og = og_image(tile_1024)
    if og is not None:
        save(og, os.path.join(DOCS_BRAND, "og-image.png"))

    check(master, view_box)
    with open(MASTER, "rb") as f:
        assert f.read() == untouched, "the master changed while deriving assets"

    preview = os.environ.get("ICON_PREVIEW_DIR")
    if preview:
        os.makedirs(preview, exist_ok=True)
        for s in (32, 48, 96, 180):
            rasterize(master.variant(), s).save(os.path.join(preview, f"icon-{s}.png"))

    for path, size in written:
        print(f"  {path:52} {size}")


if __name__ == "__main__":
    main()
