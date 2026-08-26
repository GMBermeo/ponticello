# Ponticello

*Practice, not points.*

Offline intonation practice for acoustic cello. Listens to the instrument
through the device microphone, shows what you are supposed to play three
different ways, and tells you how far off the note you are — in cents, in real
time. No accounts, no scores, no streaks, no network.

Laid out for the **Galaxy Z Fold 5 inner display (2176 × 1812)**, and scales
from there to the cover screen, a phone, or a browser window.

```
npm install
npm run web        # browser — real microphone
npm run android    # device or emulator
npm run ios
npm test           # 136 unit tests, no native runtime needed
npm run typecheck
```

---

## What is here

| Screen | What it does |
| --- | --- |
| **Library** | 17 rows. Six carry note data; the rest are placeholders — see [Rights](#rights). |
| **Tutorial** | Static. Explains the nut, the finger numbers, your own tape colours, and how to read each vision. |
| **Practice sheet** | A/B loop by bar, tempo 40–120 %, fingering blackout, tape overlay, cue density. |
| **Play** | Three visions — Tab, Score, Highway — over a fixed fingerboard panel and cents rail, with the backing sounding underneath. |
| **Import** | Bring your own MIDI; the app fingers the cello line and makes a backing from the rest. |
| **Tuner** | Open strings, off the same pitch engine the play screens use. |
| **My tapes** | The tape colours and positions on *your* fingerboard. Everything else follows them. |

---

## The tapes

The app is built around one player's fingerboard tapes and says so everywhere:

| Set | Colours, nut outwards | Fingers | Semitones | Millimetres from the nut |
| --- | --- | --- | --- | --- |
| First position | blue · yellow · yellow · green | 1 2 3 4 | 2 3 4 5 | 75 · 110 · 142 · 173 |
| Thumb position | blue · green · green · yellow | T 1 2 3 | 12 14 16 17 | 345 · 383 · 416 · 432 |

Two assumptions are baked into those defaults, both editable in **Settings →
My tapes**:

- **First position** is read as the closed hand frame — four fingers a semitone
  apart, first finger to little finger spanning a minor third. The two yellows
  are the middle fingers, which is what makes them distinguishable in practice:
  the tape narrows the note to a semitone and the string finishes the job.
- **Thumb position** is read as the thumb on the octave harmonic at exactly
  half the string, with fingers 1–3 climbing a major tetrachord above it
  (whole, whole, half — A B C♯ D on the A string). If your teacher set the
  frame differently, change the semitone values and every diagram, note name
  and colour in the app follows.

Distances come from `stopDistanceMm(n) = L · (1 − 2^(−n/12))` with L = 690 mm,
so every fingerboard drawing is a true scale drawing rather than an evenly
spaced diagram. The tapes crowd together as they climb because the string does.

---

## Resolution model

Everything is written in **design units**, where the canvas is 829 × 690 —
2176 × 1812 physical pixels at the Fold 5's native density of 2.625.

```
src/theme/scale.ts    CANVAS = FOLD5_PX / FOLD5_DENSITY
                      scale  = min(window.width / 829, window.height / 690)
```

On the unfolded inner display that scale is exactly 1.0 and the layout lands
pixel-exact. Everywhere else the same canvas scales to fit, so there is only
ever one layout to reason about. `useTheme()` exposes `s(units)` for sizes,
`font(units)` with a legibility floor, and `rule(units)` clamped to the device
hairline. Tap targets never scale below 44 dp.

Running `npm run web` in a browser wider than 900 px frames the app in the Fold
5's aspect ratio (`src/components/DeviceCanvas.tsx`), so what you see in the
browser is what lands on the device.

---

## Audio pipeline

```
microphone ─┬─ high band  48 kHz · 512-window · 190–1000 Hz ─┐
            │                                                ├─ arbiter ─→ cents
            └─ ÷4 → 12 kHz · 512-window ·  55–220 Hz ────────┘
```

A cello spans C2 (65 Hz) to A5 (880 Hz). One analysis window cannot serve both
ends — long enough to see a C2 period means 43 ms of lag on everything, and
short enough to feel instant up high cannot see a single period down low. So
the signal is analysed twice in parallel at two rates and an arbiter decides
which branch to believe. The bands overlap between 190 and 220 Hz on purpose,
so the handover around the open A is a preference rather than a cliff.

**Pitch detection is the McLeod method over the Normalised Square Difference
Function** (`src/audio/mpm.ts`). Not FFT peak-picking: a bowed cello radiates
almost no energy at its own fundamental down at C2, because the body's air and
wood resonances sit well above 65 Hz, so the second and third harmonics are
louder than the note itself. Anything that picks the loudest spectral peak
reports C3. A time-domain difference function keys on the *period*, which
survives a missing fundamental intact — there is a test for exactly this case.

Other pieces worth knowing about:

- **`fft.ts`** — radix-2 FFT with cached twiddles. The NSDF's autocorrelation
  goes through Wiener–Khinchin rather than an O(W²) sum, and the same transform
  serves the onset gate.
- **`decimate.ts`** — 4th-order Butterworth at 1 kHz before the ÷4 drop.
  Deliberately not the ~300 Hz the low band's range suggests: at 220 Hz a
  300 Hz corner would leave nothing but the fundamental, which is the partial
  the instrument under-radiates.
- **`flux.ts`** — half-wave-rectified spectral flux. During the first 15–40 ms
  of a bow stroke the string has not settled into Helmholtz motion and the
  detector returns confident nonsense, so flux spikes freeze the display
  instead.
- **`PitchEngine.ts`** — ring buffers, the arbiter, and a cents smoother. The
  arbiter's most important rule: if the low band hears half what the high band
  hears, the high band has locked onto the second harmonic; trust the low one.

### Capture

| Platform | Source | Status |
| --- | --- | --- |
| iOS / Android | `expo-audio`'s `AudioStream` — real PCM from AVAudioEngine / AAudio | working |
| Web | `AudioWorklet` posting 256-sample blocks (`useMicSource.web.ts`) | working |
| anything else | reports "no microphone", app still runs | fallback |

Web capture sets `echoCancellation`, `noiseSuppression` and `autoGainControl`
all to false. They are tuned for speech and actively destroy a bowed cello: AGC
pumps between strokes and noise suppression treats a sustained low C as
stationary noise.

The original architecture called for a C++ JSI TurboModule with SIMD. That is
not here and is not currently needed — `AudioStream` delivers float PCM from
the platform audio unit, and the analysis window (10–43 ms) dwarfs the bridge
hop. Revisit it if profiling ever says otherwise.

---

## Rendering

Plain React Native views and `react-native-svg`, driven by Reanimated. Not
Skia: this design is flat rectangles, hard rules and text, with one curve in
it (the intonation ribbon). Skia would have added a CanvasKit WASM payload on
web and a config plugin on native to draw shapes `<View>` already draws.

Each vision lays out its whole note field once at fixed offsets and moves it
with a **single transform** per frame, so scrolling costs one animated style no
matter how many notes are on screen. The transport (`usePlayhead.ts`) advances
score time inside a Reanimated frame callback on the UI thread; React only
learns which note is active, and only about fifteen times a second.

### One deliberate departure from the design mock

The mock drew fingerboard position rules across the Highway. Here the
Highway's vertical axis is **time and nothing else** — a highway whose vertical
axis means distance-from-nut in the background and seconds-until-you-play-it in
the foreground cannot be read at speed. The tape a note lands on travels *with
the note*, as a coloured bar on the edge of its capsule, and the fingerboard
panel beside the highway keeps the distance axis where it belongs.

---

## Scores

`src/domain/schema.ts` defines `CelloSongScore` v1.0.0. Authored scores go
through `src/scores/build.ts`, which derives pitch name, MIDI number, frequency
and start time from the decisions a musician actually makes — which string, how
far up it, which finger, how long — and throws on a bar whose durations do not
add up.

### Adding a piece

```
npm run convert -- path/to/piece.mid --title "Piece" --composer "Someone" --bpm 84
```

`tools/convert-score.ts` reduces the file to a single line, runs an ergonomic
Viterbi solver over it (`src/domain/fingering.ts`) to choose a string, position
and finger for every note, and writes a module into `src/scores/`. Add it to
the `SCORES` array in `src/scores/index.ts` and it appears in the library.

The solver models shifts in **millimetres of arm travel**, not in position
numbers — positions are not evenly spaced, and counting them punishes low
shifts while waving through high ones. Thumb position tracks where the thumb
actually sits, so sliding it counts as a shift; without that the solver
discovers it can play a two-octave scale "without moving" and parks the hand
somewhere no cellist would go.

Fingerings from the solver are a starting point, not an edition. Read them
before practising them.

### Rights

Only original studies and public-domain works ship with note data. The game,
film and television themes from the original brief appear as library rows with
no notes and a reason: the app will not ship a transcription of someone else's
melody. Convert your own licensed copy to fill one in.

| Bundled | |
| --- | --- |
| Four Open Strings, First Position Ladder, D Major / C Major Two Strings, Thumb Position Ladder | original, written for this app |
| Prélude, Cello Suite No. 1 (BWV 1007), bars 1–4 | public domain; hand-entered, check against an edition |

The four studies are built around the tape sets above — the First Position
Ladder walks blue · yellow · yellow · green on all four strings, and the Thumb
Position Ladder walks blue · green · green · yellow.

---

## Building an APK

```
npm run apk
```

Produces `android/app/build/outputs/apk/release/app-release.apk`, signed with
the debug keystore Expo generates. That is fine for sideloading onto your own
phone and not fine for the Play Store — for a store build, generate a real
keystore and point `signingConfigs.release` at it.

Install it by copying the file to the phone and opening it (Android will ask
you to allow installs from that app once), or over USB with
`adb install -r app-release.apk`.

`android/` is generated by `npx expo prebuild` and is gitignored. Delete it and
re-run at any time; nothing is hand-edited in there except the proxy lines the
build script re-adds.

### Toolchain on this machine

Installed under Homebrew rather than in the usual places, so no admin password
is needed:

```
brew install openjdk@17
brew install --cask android-commandlinetools
```

Then, with `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`:

```
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

`tools/build-apk.sh` sets `JAVA_HOME` and `ANDROID_HOME` itself, so a plain
`npm run apk` works from a clean shell. The first build also pulls the NDK and
CMake automatically (about 3 GB) and compiles the Reanimated and Worklets C++
runtimes from source, which takes the best part of an hour. Later builds reuse
all of it and take minutes.

**Building for one architecture is much faster.** The Fold 5 — and every phone
made in the last decade — is `arm64-v8a`, but the default builds four ABIs and
compiles that C++ four times. Setting

```
reactNativeArchitectures=arm64-v8a
```

in `android/gradle.properties` cuts both the build time and the APK size by
roughly three quarters. Keep all four only if you need the APK to run on an
x86 emulator.

### The proxy

This machine firewalls outbound TCP from the JVM — every `connect()` from a
Java process times out, while Node and curl are unaffected. Gradle, the Gradle
wrapper and `sdkmanager` are all JVM processes, so none of them can fetch their
own dependencies.

`tools/dev-proxy.mjs` is a small Node forward proxy with CONNECT tunnelling.
Node can reach the network and the JVM can reach loopback, so pointing Gradle
at `127.0.0.1:8899` bridges the gap. TLS stays end to end — CONNECT tunnels
bytes without terminating it. The build script starts the proxy if it is not
already running; `npm run proxy` runs it on its own.

None of this is required by the app. If `java` regains network access, drop the
`systemProp.*.proxy*` lines from `android/gradle.properties` and the script's
`GRADLE_OPTS`, and it builds normally.

### Cloud builds

`eas build --platform android --profile preview` builds on Expo's
infrastructure and hands back a download link, which avoids the toolchain
entirely. It needs an Expo account (`eas login`) and `eas.json`.

---

## Backing tracks

Every piece can sound underneath you while you play. Four listen modes, chosen
because they are the four things you actually want at different stages:

| Mode | What sounds |
| --- | --- |
| **Off** | Nothing. You are the only thing making sound. |
| **Backing** | Everything except the cello line — play the solo over the top. |
| **Cello** | The written cello part alone, so you can hear what you are aiming at. |
| **Both** | The whole thing. Good for learning a piece, less so for testing yourself. |

### Where the accompaniment comes from

Bundled pieces have no accompaniment file, so one is **generated from the score
itself** — which means it works for every piece in the library, including
anything you import later, and involves nobody else's material:

- **Drone** — a sustained tonic and fifth, and deliberately no third. The
  oldest intonation tool there is: against a fixed drone a note four cents out
  starts to beat, and you hear it long before a tuner shows it.
- **Chords** — one triad per bar, inferred from the notes in that bar. The
  inference weights the root and third heavily and adds a large bonus when a
  candidate root matches the **lowest sounding note**, which is why the opening
  of the Bach reads as G major rather than B minor: B and D each sound six
  times against a G that sounds twice, but that G is the bass.
- **Pulse** — the same chords re-struck on every beat, beat one accented.

Imported files skip all of that and use their own tracks.

### How it plays

There is no MIDI playback on either platform, so the accompaniment is
synthesised to PCM up front and played as audio. **The buffer is the loop** —
it holds exactly the bars being practised at exactly the chosen tempo, and the
player repeats it. That removes the whole category of drift and seek problems a
scheduler would introduce: the audio cannot fall out of step with the playhead
because there is nothing to keep in step, only one buffer that ends where it
began. Changing the loop or the tempo re-renders it, debounced.

`src/audio/synth.ts` is additive, reading from wavetables built one per octave
band. Summing harmonics per sample would mean tens of millions of `Math.sin`
calls for a few bars; a table per band turns each sample into two array reads
and a lerp, and band-limiting stops a high note's upper partials folding back
down the spectrum and ringing out of tune.

Web plays the sample buffer directly through an `AudioBufferSourceNode` with
`loop = true`, which repeats gaplessly. Native has no such API, so the buffer is
encoded as a WAV, written to the cache and played by `expo-audio`.

---

## Importing your own music

**Library → Import a MIDI file.** Pick a file, say which track is the cello, and
the app runs the same ergonomic solver the offline converter uses to finger that
line — then turns every other track into the backing. You get a piece readable
in all three visions *and* playable along to, from a file the app never shipped.

The original MIDI is kept (a few tens of kilobytes, capped at 512 KB) and the
score is rebuilt from it on demand rather than stored, so a later improvement to
the fingering solver applies to everything already imported.

Notes above the cello's range are moved down an octave rather than dropped —
silently losing the melody is worse than moving it.

### Rights

**The app ships no third party's music, and that includes MIDI transcriptions.**
A MIDI file of a song is a copy of the composition; where it was downloaded from
does not change that. So the game, film, television and band material that would
be obvious candidates here are not bundled, and will not be.

What is bundled is original studies written for this app and public-domain
classical work. What you import is your own business — the app is built to make
that easy, and nothing you add ever leaves the device.

For public-domain classical repertoire with MIDI alongside the scores, the
[Mutopia Project](https://www.mutopiaproject.org/) is the best starting point;
it carries all six Bach cello suites among about a hundred cello works.

---

## Layout

```
src/
  app/            expo-router screens
  audio/          FFT, MPM, decimation, onset gate, engine, mic sources
  components/     Fingerboard, play visions, UI primitives
  domain/         cello geometry, tapes, score schema, fingering solver
  scores/         authored scores and the catalogue
  state/          persisted settings, per-session practice setup
  theme/          tokens, the Fold 5 scale model, ThemeProvider
tools/            MIDI reader and the offline score converter
```

## Tests

`npm test` — 136 tests across the DSP, the cello model, the tape model, the
fingering solver, the bundled scores and the MIDI reader. All pure TypeScript;
nothing imports React Native, so they run in plain Node with no Metro or native
runtime in the way.

The DSP tests synthesise a bowed cello with a body response that under-radiates
below 100 Hz, then assert the engine tracks C2 through A5 within five cents and
never reports C3 for a C2.
