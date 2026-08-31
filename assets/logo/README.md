# The Ponticello mark

![the mark beside the name](ponticello-wordmark.png)

## The idea

The mark is the app's own fingerboard, reduced until only what is unique to it
survives: a tapered dark board carrying the four first-position tapes — **blue,
yellow, yellow, green** — at their true stopping distances, with the nut as a
pale bar at the bottom.

Two things make it specific rather than decorative.

The board **tapers**. A real neck is about 24 mm across at the nut and half as
much again at the heel, and drawing that is what stops the silhouette reading
as a barcode — which is exactly what the first attempt, four coloured rails and
a crossbar, did read as.

The bands **bunch as they climb**, because they sit at
`690 × (1 − 2^(−n/12))` millimetres rather than at even intervals. That
compression is the single most useful thing a beginner internalises about the
instrument and it is the thing this app exists to teach; evenly spaced bands
would be a different, and wrong, picture.

The board is drawn nut-at-the-bottom, matching the player's own view and the
orientation the fingerboard panel uses on the play screen.

## Regenerating

```
python3 tools/make-icons.py
```

Everything is drawn with Pillow at 4× and reduced with LANCZOS — this machine
has no ImageMagick, Inkscape or rsvg. The script asserts what it cannot eyeball:
that the Android adaptive foreground stays inside the centre-66 % safe zone, and
that the themed monochrome icon really is a single colour on transparency.

Set `ICON_PREVIEW_DIR` to also emit 32/48/96 px previews, which is the only test
a launcher icon actually has to pass.

| File | Size | Role |
|---|---|---|
| `assets/images/icon.png` | 1024² | base / iOS icon |
| `assets/images/android-icon-foreground.png` | 1024² | adaptive foreground |
| `assets/images/android-icon-background.png` | 1024² | adaptive background |
| `assets/images/android-icon-monochrome.png` | 1024² | Android 13 themed icon |
| `assets/images/splash-icon.png` | 512² | splash |
| `assets/images/favicon.png` | 48² | web |
| `assets/logo/ponticello-mark.svg` | vector | master geometry |
| `assets/logo/ponticello-wordmark.png` | 1600×400 | README / store listing |

`ponticello-mark.svg` is generated from the same constants, so it cannot drift
from the PNGs. Edit `tools/make-icons.py`, never the SVG.
