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

The images in `assets/screenshots/` are headless-Chrome captures of the web
build (desktop 1280×820 and phone 412×870), taken with public-domain and
original content only. Run `npm run web`, capture the routes listed in
`assets/screenshots/`, and save them as WebP at 1600 px (desktop) or 620 px
(phone) wide. The brand files in `assets/brand/` come from
`python3 tools/make-icons.py` — edit that script, not the images.
