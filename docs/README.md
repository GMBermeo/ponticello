# Ponticello product site

A static page — `index.html`, `styles.css` and `assets/` — with no build step.

## Publish on Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `docs` and **Framework Preset** to *Other*.
3. Leave the build command empty; Vercel serves the folder as-is.

Or from the command line: `cd docs && npx vercel --prod`.

## Preview locally

```
npx serve docs
```

## Refreshing the screenshots

Since 1.8 every image in `assets/screenshots/` is a capture of the **iPhone
Duo simulator** (iOS 27, inner display 1398 × 2034 px) running a Release
build of the free edition — public-domain works and original etudes only.

1. `npx expo run:ios --device "iPhone Duo" --configuration Release`
2. Capture with `xcrun simctl io booted screenshot <name>.png`; drive the app
   with deep links (`xcrun simctl openurl booted ponticello://song/bwv1007-prelude`)
   and, for taps, [AXe](https://github.com/cameroncooke/AXe)
   (`axe tap --label "Start practice" --udid <udid>`).
3. Save as WebP at 720 × 1048. The page frames them in a CSS iPhone Duo
   (`.device` in `styles.css`), so capture the bare screen, not a mock-up.

`assets/video/tour.mp4` is `xcrun simctl io booted recordVideo`, re-encoded
with `ffmpeg -vf scale=720:-2 -c:v libx264 -crf 26 -an -movflags +faststart`.

The brand files in `assets/brand/` come from `python3 tools/make-icons.py` —
edit that script, not the images. `og-image.png` is composed from the
screenshots and the icon.
