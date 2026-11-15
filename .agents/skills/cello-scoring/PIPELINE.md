# The pipeline in this repo

How an arrangement becomes a `CelloSongScore` the app can draw and play.

```
.mid ──parseMidi──▶ MidiNote[] ──monophonic──▶ RawNoteEvent[]
                                                    │
                                          solveFingering (Viterbi)
                                                    │
                                              CelloState[]
                                                    │
                                    ──▶ CelloSongScore ──▶ src/scores/
```

| Step | File |
|---|---|
| Parse MIDI, pick a track, flatten to one line | `src/domain/midi.ts` |
| Choose string/position/finger per note | `src/domain/fingering.ts` |
| Score shape and validation | `src/domain/schema.ts` |
| Hand-authoring helper (derives pitch from string + semitones) | `src/scores/build.ts` |
| CLI end to end | `tools/convert-score.ts` |

```bash
npm run convert -- input.mid --title "Piece" --composer "Someone" \
  --key "G MAJOR" --meter 4/4 --bpm 66 --difficulty Beginner
```

Conversion is deliberately an **offline build step**, not something the app does
at runtime: fingering is an editorial decision that deserves a human read before
anyone practises from it. Always read the output.

## The monophonic constraint

`CelloNote` carries **one** `midiNumber`. The schema cannot represent a
double-stop at all. Articulations available: `arco`, `pizz`, `slur`, `staccato`,
`tenuto`, `accent`, `harmonic`.

`monophonic()` resolves overlaps by keeping the **higher** note and discarding
the lower, truncating the previous note where they overlap. Two consequences:

- **It destroys the structural bass.** Feed it a piano reduction and the bass
  line — the thing implied polyphony depends on — is silently deleted. Reduce
  and voice the arrangement *before* conversion; do not expect the flattener to
  make musical choices.
- Block chords collapse to their top note, and sub-10 ms stubs are dropped.

So express harmony as **broken arpeggiation in the note stream**. An arpeggiated
chord survives flattening intact because its notes do not overlap; a written
chord does not.

Accent structural bass notes with `articulation: 'accent'` — this is how the
implied-polyphony cue from [ARRANGING.md](ARRANGING.md) survives into the app.

## Beginner library conventions

The bundled library is **first position only, MIDI 36–63 (C2–D♯4)**.
`firstPositionState()` in `src/scores/bundledSongs.ts` maps by range: ≤42 → C
string, ≤49 → G, ≤56 → D, else A.

**Known defect:** it clamps anything above MIDI 63 to a forward-extended fourth
finger, which is wrong for genuinely high notes. Transpose into range before
calling it, and prefer fixing the function to reject out-of-range input rather
than producing a plausible-looking wrong answer.

## The solver

`solveFingering` is a **Viterbi shortest path over the whole line**, not a
per-note choice — the sequence is what makes a fingering good or exhausting.
States are ⟨string, position, finger, extension, baseSemitones⟩.

**Emission cost** — comfort of a state alone: first position free, cost climbing
through the neck; forward extension 1.2, backward 0.7; an open string on a note
longer than 300 ms costs 1.4 because it cannot be vibrated; fourth finger in
thumb position costs 6, a prohibition dressed as a number.

**Transition cost** — the move between states:

- String crossing: same 0, neighbour 1, skip one 3.5, C→A 7.
- Shift distance in **millimetres**, scaled by the 1st→4th reference (154 mm).
  Position numbers are not a distance metric — see [INSTRUMENT.md](INSTRUMENT.md).
- Effort grows with the **square** of distance and shrinks with time available
  (`/ deltaTSec^0.8`): the same shift is trivial over a half note and violent
  over a semiquaver.
- Crossing the neck heel (4→5) costs 1.5× its distance.

Tune behaviour through `CostWeights`, never by special-casing notes.

## MuseScore

The `cli-anything-musescore` skill handles the mechanical steps and produces a
ground truth to check converted scores against. Always pass `--json`.

```bash
# Inspect an unknown source first
cli-anything-musescore --json media probe -i source.mscz

# Step 1 of the arranging method — key selection
cli-anything-musescore --json transpose by-key -i source.mscz -o cello.mscz \
  --target-key "G major" --direction closest

# Pull one voice out of a multi-instrument score before reducing
cli-anything-musescore --json parts list -i source.mscz
cli-anything-musescore --json parts extract -i source.mscz -o melody.mscz --part "Violin"

# Round-trip into the converter, or out for engraving
cli-anything-musescore --json export midi -i cello.mscz -o cello.mid
cli-anything-musescore --json export pdf  -i cello.mscz -o cello.pdf
```

Accepts `.mscz`, `.musicxml`, `.xml`, `.mxl`, `.mid`. For a printable songbook
of finished arrangements, the `sheet-music-publisher` skill takes it from here.

## Verify

```bash
npm run typecheck && npm test
```

`src/domain/__tests__/fingering.test.ts` (23 tests) and `cello.test.ts` (29) are
the guard. Anything in `src/domain` must stay pure TypeScript — no React Native
import (AGENTS.md).

Before shipping an arrangement, play it back and check:

- Does the bass line still exist after flattening?
- Are shifts landing on long notes rather than fast ones?
- Does anything sit above MIDI 63 in a first-position library piece?
- Do open strings fall on short notes rather than sustained ones?
