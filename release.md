# Ponticello v1.9.0 — A harmony map, a lighter library, and instruments that sound more like instruments

The chord side of the app is now the **harmony map**: for every chord, where its notes fall on the cello, so a melody can stay inside the harmony while the chords change underneath. Every harmony map is in both editions, nearly all of them now read correctly, and the library no longer loads them all at launch. The synthesised backing parts have a body, a room and an attack, and stop sounding like oscillators.

## Downloads

| File | What's inside | Who it's for |
| --- | --- | --- |
| `Ponticello-v1.9.0-build13-FULL-LIBRARY-333-pieces-315-arranged-songs-2551-harmony-maps-PERSONAL-USE-release.apk` (116 MB) | 333 pieces (public-domain works, original etudes and 315 arranged songs) and 2,551 harmony maps | Personal practice only; do not redistribute |
| `Ponticello-v1.9.0-build13-FREE-LIBRARY-18-public-domain-and-etudes-2551-harmony-maps-SHAREABLE-release.apk` (62 MB) | 18 pieces (public-domain works and original etudes) and 2,551 harmony maps | Free to share — but see below |

Both editions install as the same app (`com.bermeo.ponticello`), so installing one replaces the other. iOS builds run from source (`npx expo run:ios`); see the README.

**Sharing the free build.** The harmony maps are imported chord sheets, lyrics included. Until 1.8 the free edition carried one of them; it now carries all 2,551, so passing the free APK on passes those lyrics on. The arranged songs remain the only thing left out of it.

## Highlights

- **Chords are now the harmony map.** The tab, the library filter, the song rows, the reader and the site call it what it is for. The idea is unchanged from 1.8's *All positions* switch, now front and centre: the cello plays melodies inside the notes of the chord that is sounding, on any string, and the map shows every place those notes are. Routes are unchanged, so saved links still open.
- **Every harmony map is in the free edition too.** 2,551 of them, up from 1 in the free build and 463 in the full one. The two editions now differ only in the arranged songs.
- **Chords that used to have no cello diagram now have one.** Of about 15,500 chords across the maps, 1,104 (7%) could not be read — power chords, `º` and `°` diminished chords, `7(9-)`, `m7(5-)`, `7(4)`, `7M`, `m7M` and the rest of Cifra Club's dialect, whose spelling the chord dictionary did not know. 39 remain (0.25%). The readings are checked against each chart's own keyboard diagram, never guessed: a reading is refused if the diagram plays a note it does not contain, and a chord the dictionary has no shape for (`F#7(11)`) is played as the nearest chord inside the diagram and marked as simplified. `npm run audit:chords` lists what is left.
- **A library that does not read everything to show one thing.** Opening one harmony map used to parse a single 52 MB JSON file holding all of them, and every launch validated all of them first (about a second and 390 MB of memory on a laptop; a phone is slower). Each map, and each arranged song, is now its own minified file behind a small index, read only when it is opened. See *Under the hood*.
- **Backing parts that sound like instruments.** The synthesiser gained what an oscillator lacks:
  - *A body.* Each voice has the resonances of its instrument, applied per half-octave, so a low cello note is woody and a high one is pure instead of every register sharing one spectrum.
  - *A spectrum that moves.* A piano, guitar or pluck starts bright and rings down to a near-sine; a bowed note has a moment of bite as the bow catches; louder still means brighter.
  - *A start that is not quite on pitch.* Bowed and blown notes scoop up into tune over a few tens of milliseconds before the vibrato arrives.
  - *Texture.* The bow's scrape and the rosin or breath under a sustained note are smooth noise rather than a hiss.
  - *A room.* A small damped reverb with the low end kept out, so the parts sound like they share a space. The voices' own levels match 1.8 to within 0.1 dB, so nothing became louder or quieter; the room adds a little on top.
  `npm run audition:voices` renders every voice to `_AUDITION/<voice>.wav` to listen to. The tests check that the voices are stable, finite, the right level and identical however a song is sliced; whether they sound better is for your ears, which is why that script exists.

## Fixes

- Chord names written as `Bº`, `Cdim` and `D°` with a four-note diagram are read as diminished sevenths instead of failing the check against their own diagram.
- A power chord charted with a third on top (`G5` drawn as G–B–D) is read as the power chord instead of being refused.
- The slow whole-library playback test is one test per song, so a busy machine no longer trips the test runner's own timeout.

## Under the hood

- **One file per item.** `src/scores/chords/<id>.json` and `src/scores/songs/<id>.json`, each listed by a generated catalogue (`chordCatalog.generated.ts`, `songCatalog.generated.ts`) of small summaries plus a `require` per file. Metro evaluates a module only when it is required. `hasChordSheet` / `hasCompactScore` answer "is there one?" from the index; `getChordSheet` / `getCompactScore` read one; `allCompactScores()` is for tests and tools. The charts went from 52 MB pretty-printed to 25 MB minified; the Hermes bundle for the free edition, all 2,551 maps included, is 20 MB. The importers no longer write `chordSheets.generated.json` — run `npm run build:library` after importing.
- **Charts are re-read on every build.** `tools/chordBundle.ts` runs each chord through the current dictionary, so an improvement to the reader reaches charts imported long ago. A test fails if a bundled chart disagrees with the dictionary.
- `src/domain/chordDialect.ts`: the dialect rewrites, the keyboard-diagram identification and the simplification, all tested against real chart symbols.
- `src/audio/voices.ts` holds the body, morph, scoop and grain models both platforms share; `src/audio/room.ts` is the room (a feedback network carried through the native player's slices, an equivalent impulse response on the web). Native render time is up to about 1.7× 1.8's, room included, and only while a song is being prepared.
- `tools/lazyBundle.ts` is the one writer behind both bundles; `check:shareable` is unchanged.
- The site's copy says *harmony map*; its screenshots are from 1.8 and still show the old tab label until they are retaken.
- Version 1.9.0, build 13. Tests: 1,195 passing on the free edition, 2,013 on the full edition.

---

# Ponticello v1.8.0 — Redesigned for the iPhone Duo

A redesign from the ground up. Ponticello was laid out for a Galaxy Z Fold; 1.8 moves it onto the iPhone Duo and makes it look and behave like part of the phone — Liquid Glass where things float, the system's own type at native sizes, a real tab bar, and a new mark. Nothing about how the app plays has changed: every arrangement, fingering, chord shape and pitch reading is the same engine as 1.7.1.

## Downloads

| File | What's inside | Who it's for |
| --- | --- | --- |
| `Ponticello-v1.8.0-build12-FULL-LIBRARY-333-pieces-315-arranged-songs-PERSONAL-USE-release.apk` | 333 pieces (public-domain works, original etudes and 315 arranged songs) and 463 chord charts | Personal practice only; do not redistribute |
| `Ponticello-v1.8.0-build12-FREE-LIBRARY-18-public-domain-and-etudes-SHAREABLE-release.apk` | 18 pieces (public-domain works and original etudes) and 1 chord chart | Free to share |

Both editions install as the same app (`com.bermeo.ponticello`), so installing one replaces the other. iOS builds run from source (`npx expo run:ios`); see the README.

## Highlights

- **A new mark.** *Ponticello* is Italian for "little bridge", and the icon now is one: a cello bridge seen from the player's side — crown, waist, feet and heart — with the four strings running down behind it, thick enough to read at launcher size, in the colours the app draws them in: C green, G red, D blue, A yellow. Soft drop shadows set the bridge in front of the strings and both off the indigo ground. On iOS it is a layered Icon Composer icon, so the bridge and strings pick up Liquid Glass on the home screen. It replaces the tapered fingerboard, which read as a smudge at launcher size.
- **Built for the iPhone Duo.** Native iOS type sizes (SF Pro, with SF Pro Rounded for numbers), grouped cards on a soft grey or near-black ground, capsule buttons, an iOS segmented control and switch, SF Symbols throughout, and continuous corners.
- **A tab bar.** Library, Practice, Tuner and Chords are tabs — the Duo's glass side rail on iOS, a Material bar on Android. Everything a tab opens, including the play screen, is pushed over it.
- **Liquid Glass where things float.** The back button, the library's theme and import buttons, the Start practice bar, the play transport, the tuner over the score and the chord-progression transport are system glass (an opaque card on Android and the web).
- **A library you can scan by key.** Each piece leads with a tile showing its tonic in that note's colour — the same colour it has on the fingerboard chart — with the level as a capsule under the title. The reference pages (reading guide, fingerboard, scales, tapes) are a row of chips under the search.
- **An accent of its own.** Actions and selection are indigo, in all three themes. Blue is a note colour here — the D string — and a blue accent made "selected" look like "D".
- **Chords as a map for improvising.** A new **All positions** switch — on chord charts, in the progression builder and in the chord atlas — marks every place on the board where the chord's notes fall, up to the octave, each labelled with its name (roots square), not just the one shape to hold. With **Preview next fingering** on, the next chord's positions appear too as dashed grey rings, and a note both chords share is ringed: the places a melody can stay put across the change. Add **Preview key** and the rest of the scale fills in as small dots.
- **Light, Dark and Neon, redrawn.** Light is iOS grey and white; Dark is near-black with lifted indigo; Neon keeps its cyan on true black. The native tab bar and glass follow the theme you pick, not the phone's.

## Fixes

- **The app launches on iOS 27.** iOS 27 refuses to start an app without the UIScene life cycle; a small config plugin (`plugins/withSceneLifecycle.js`) adopts it using Expo's new scene delegate, so `expo prebuild --clean` stays reproducible.
- **The microphone is asked for only by the tuner.** On iOS merely creating the audio stream prompts for the mic, and a tab bar mounts its screens early — so the tuner's live part now renders only while its tab is focused, and leaving the tab releases the mic.
- **No double safe-area insets.** A screen nested in another no longer adds the insets again, which on the Duo (whose tab rail is a right-hand inset) was costing nested pages that width twice.
- The iOS app icon renders at full size; the 1.7 icon's SVG layer was drawn as a speck in the middle of the tile.

## Under the hood

- `src/theme`: new `BRAND` palette, `fill` and `onAccent` chrome tokens, a `RADIUS` scale and `theme.corners()` for continuous corners, and `faces.ts` — SF on iOS, Archivo elsewhere — replacing `FONT`. `MIN_SCALE` is now 1.0: a design unit is never smaller than a point, and small screens reflow instead of shrinking.
- `src/components/ui`: `Glass`, `GlassIconButton`, `Icon` (SF Symbols with glyph fallbacks), `Card`, `SectionHeader` and `TabHeader`; `Button` takes an `icon`.
- Routes: `src/app/(tabs)/` holds the four tabs under `expo-router`'s native tabs; URLs are unchanged.
- Expo 57.0.25 and React Native 0.86.3 (patch updates within SDK 57).
- The mark has a hand-drawn master, `assets/logo/ponticello-icon.svg`, and `tools/make-icons.py` now derives every icon, splash, wordmark and iOS glass layer from it without ever writing it, rendering through resvg (`tools/rasterize-svg.mjs`, a new dev dependency) so filters and shadows come out as drawn. It checks the master still has its ground, four strings and bridge, that the bridge survives a circular Android mask, that the themed icon is one colour, and that the bridge's heart stays open at 48 px.
- The product site is rebuilt around the new identity, with every screen captured on the iPhone Duo simulator and a screen recording in the hero.
- Contrast is tested, not asserted: the theme tests check accent, secondary text and on-accent text against their grounds at 4.5:1 or better in every theme.
- **Continuous integration.** `.github/workflows/ci.yml` runs on every push and pull request: the shareability guard (free library only, no personal sources or binaries), type-checks, lint, the full test suite, Metro bundles for web, iOS and Android with every route rendered, `expo prebuild` from scratch with a check that the iOS 27 scene fix, icon and permissions still apply, and a re-derivation of every brand asset from the master icon. `npm run verify` runs the fast half locally.
- Version 1.8.0, build 12. Tests: 1,116 passing on the free edition.

---

# Ponticello v1.7.1 — A cleaner codebase, a new mark, and a home page

A maintenance release. Nothing about how the app plays has changed — every arrangement, fingering, chord diagram and audit result is identical, checked against the previous build on 151 real MIDI files and the whole bundled library. What changed is the ground it is built on: the code is reorganised, the icon is redrawn on the brand blue, and there is now a product site and a contributing guide.

## Downloads

| File | What's inside | Who it's for |
| --- | --- | --- |
| `Ponticello-v1.7.1-build11-FULL-LIBRARY-333-pieces-315-arranged-songs-PERSONAL-USE-release.apk` | 333 pieces (public-domain works, original etudes and 315 arranged songs) and 463 chord charts | Personal practice only; do not redistribute |
| `Ponticello-v1.7.1-build11-FREE-LIBRARY-18-public-domain-and-etudes-SHAREABLE-release.apk` | 18 pieces (public-domain works and original etudes) and 1 chord chart | Free to share |

Both editions install as the same app (`com.bermeo.ponticello`), so installing one replaces the other. The library screen shows which edition you have, and now also shows who made the app and where the source lives. Both APKs are signed with the development keystore, for sideloading rather than store distribution.

## Highlights

- **A new mark.** The icon is the same idea — the tapered fingerboard with the four first-position tapes at their true stopping distances — redrawn on the brand blue, with the strings over the board, a bone nut and a little depth. The iOS icon is finally Ponticello's own rather than the Expo placeholder, and the splash screen is navy to match.
- **Credits in the app.** The foot of the library now says who wrote it, with links to [gm.bermeo.dev](https://gm.bermeo.dev) and to the source.
- **A product site.** `docs/` is a static page presenting the app — what it does, with screenshots of every screen — ready to publish on Vercel by pointing the root directory at `docs`.
- **A contributing guide.** The README explains how to build your own library from your own MIDI files and chord sheets, and what a good first contribution looks like.

## Under the hood

- **The codebase is reorganised, Next.js style.** Routes in `src/app` are composition only; each screen's pieces live in a feature folder under `src/components` (`library/`, `practice-setup/`, `play/`, `chords/`, `progression/`, `tuner/`). The library screen went from 666 lines to 80, the progression builder from 1,052 to about 170.
- **Every folder has a barrel.** `@audio`, `@components`, `@domain`, `@scores`, `@state` and `@theme` replace deep relative paths: `import { Button, Screen } from '@components'`.
- **One harmony module.** `domain/harmony` now answers every "what chord is sounding here?" question — the generated accompaniment, the harmonic guide, the Ollama features and the arrangement audit — each with its own documented policy. Four near-copies of that maths are gone.
- **A testable pitch tracker.** The frame-to-reading policy (tuner versus practice mode, smoothing, the publish throttle) moved out of `usePitch` into a plain `PitchTracker` class, and is now unit-tested with scripted frames instead of a microphone.
- **Settings read through narrow hooks only.** The whole-object `useSettings()` is gone, so a component re-renders only when a setting it draws changes.
- **Zero lint findings.** ESLint now runs Expo's config plus SonarJS over the whole repo and reports nothing; the 316 findings it started with — 121 nested ternaries, 59 over-complex functions — are fixed rather than silenced.
- Version 1.7.1, build 11. Tests: 1,606 passing on the full edition, 1,103 on the free edition (which skips the library-size checks).

---

# Ponticello v1.7.0 — Chords for your cello, chord charts that scroll, and a lighter, brighter look

Ponticello has been about reading a melody. This release adds the other half of playing: chords. There is now an atlas of chord shapes worked out for the cello's own tuning, chord charts that roll along under you while you play, a builder for your own progressions, and a refreshed look with a light and two dark themes.

## Downloads

| File | What's inside | Who it's for |
| --- | --- | --- |
| `Ponticello-v1.7.0-build10-FULL-LIBRARY-333-pieces-315-arranged-songs-PERSONAL-USE-release.apk` | 333 pieces (public-domain works, original etudes and 315 arranged songs) and 463 chord charts | Personal practice only; do not redistribute |
| `Ponticello-v1.7.0-build10-FREE-LIBRARY-18-public-domain-and-etudes-SHAREABLE-release.apk` | 18 pieces (public-domain works and original etudes) and 1 chord chart | Free to share |

Both editions install as the same app (`com.bermeo.ponticello`), so installing one replaces the other. The library screen shows which edition you have. Both APKs are signed with the development keystore, for sideloading rather than store distribution.

## Highlights

- **Chord atlas.** A new **Chords** screen lists chords for a chosen tonic and scale (major, natural, harmonic and melodic minor, dorian, mixolydian, lydian, or all twelve roots), filtered to triads, sevenths or extensions. Tap a chord to see its shapes and inversions drawn on the cello's fingerboard, or as an arpeggio when there is no comfortable grip. The shapes come from a generated catalogue of 106 chord types and 1,272 voicings for the cello's C–G–D–A tuning.
- **Tape colours on chord shapes.** Chord fingerings can be drawn in the colours of your own tapes, so a shape reads the same way your fingerboard does. It can be switched off.
- **Chord charts that scroll.** Songs can now come as a chord chart: lyrics with the chords above them, shown either as chord names or as cello shapes. The chart scrolls with the song, showing the current and the next chord and previewing the fingering of what is coming, with an adjustable auto-roll speed and a link out to the song on Spotify.
- **Your own progressions.** **Create chord progression**, on the library screen, starts from a preset (such as the pop axis, I – V – vi – IV) or from nothing. Choose a key and a scale, arrange chords in labelled phrases, drag them between rows, set the tempo and beats per chord, save the result, and share it. The working draft saves itself.
- **A new home screen.** The library screen is rebuilt, with a **Chords** category alongside All, Studies, Songs and Imported, and Practice, Tuner, Chords and Import together at the top.
- **Light and dark themes.** The app is no longer paper-only. Choose light, the deep-navy Quiet theme, or the darker Neon theme from the library screen; the status bar follows. The whole palette moves to a brighter blue, and the seven note colours are retuned to match, in light and dark versions of the same hues.
- **Roomier on the web.** In a desktop browser the app now runs full screen and reflows to fit. A floating button (or the `f` key) switches to the Fold 5 preview frame to see the layout as it lands on the device.

## Under the hood

- New pure-TypeScript chord layer: `celloChords`, `chordScales`, `chordSheet` (timeline, scroll position and line layout), `chordPro` parsing and `customProgression`. Nothing in it touches React Native.
- New tooling: `npm run build:chords` regenerates the shape catalogue, `npm run import:chords` imports chord charts from a personal `_CHORDS/` folder, and `npm run study:chords` opens a browser page for comparing shapes.
- **Chord charts follow the library edition.** `build:library` writes `chordSheets.generated.json` from the bundled base charts (1) in the free edition, and adds any charts from `_CHORDS/` (463) in the full edition. `_CHORDS/` is git-ignored.
- `parseScaleKey` turns key names such as `Dm`, `F#m` and `Eb minor` into a tonic, mode and scale.
- The arranger's Ollama host and model are now configurable (`OLLAMA_HOST`, `OLLAMA_MODEL`) rather than hard-coded.
- Version 1.7.0, build 10. Tests: 1,533 passing on the full edition, 1,030 on the free edition (which skips the library-size checks).
