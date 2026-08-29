---
name: cello-scoring
description: Adapt music for solo cello — reduce a keyboard, orchestral or lead-sheet source to one self-sufficient cello line, choose a resonant key, imply polyphony, voice double-stops, and assign string/position/finger/extension to every note. Also covers this repo's MIDI-to-score pipeline. Use when arranging or transcribing for solo cello, converting a MIDI file, authoring a study, adding a piece to the library, choosing a key for playability, judging whether a fingering or double-stop is idiomatic, or changing the fingering solver and its cost weights.
argument-hint: <path to .mid/.musicxml, or a description of the piece to arrange>
user-invocable: true
---

# Cello scoring

Turning music into something one cellist can actually play, alone. The job is
**not** literal transcription of every vertical pitch — it is idiomatic
translation that exploits what the cello uniquely does: linear voice leading,
implied counterpoint, and open-string resonance.

Three references, one level deep:

| File | Covers |
|---|---|
| [INSTRUMENT.md](INSTRUMENT.md) | Geometry, positions, hand frames, clefs, the double-stop rule |
| [ARRANGING.md](ARRANGING.md) | Key choice, structural reduction, implied polyphony, form |
| [PIPELINE.md](PIPELINE.md) | This repo's code path, MuseScore commands, verification |

## Quick start

Adapting a source into a solo cello score, in order. Each step is expanded in
[ARRANGING.md](ARRANGING.md).

1. **Choose the key before anything else.** Move to C, G, D, A major or their
   relative minors. A♭ major or E♭ minor kills open-string resonance and forces
   a permanently closed hand. This one decision governs playability more than
   every fingering choice combined.
2. **Reduce to two essential voices** — a structural bass and a soprano line.
   Strip dense middle-register harmony; on one instrument it only masks.
3. **Fit the range.** C2–A5 sounding (MIDI 36–81). Octave-displace outliers
   before dropping them.
4. **Imply the polyphony.** Alternate registral bands so the ear fuses them into
   separate voices. Accent structural bass notes so they are mentally sustained.
5. **Add harmony only where it pays** — cadences and phrase ends. Double-stops
   if the interval is comfortable, broken arpeggiation otherwise.
6. **Finger it**, then read the result. See [PIPELINE.md](PIPELINE.md).

## The two rules worth memorising

**Adjacent strings are a perfect fifth apart.** Everything vertical follows
from that. For a double-stop of interval `I` semitones, the upper finger sits
`I − 7` semitones further from the nut than the lower one:

| Offset | Intervals | Verdict |
|---|---|---|
| −2 … +2 | P4, tritone, **P5**, m6, M6 | Comfortable everywhere |
| −3 … −4 | M3, m3 | Wide stretch; strains in low positions |
| −5 | M2 | Needs an open string |
| +3 … +5 | m7, M7, octave | Open string, or thumb position |

A perfect fifth is offset 0 — one finger barring both strings. Sixths and the
tritone are the most comfortable and most resonant double-stops on the
instrument. Octaves are a thumb-position technique, not a neck-position one.

**The bow cannot sustain more than two strings.** The bridge is curved. Every
three- and four-note chord is broken or arpeggiated: bass roots on the lower
pair, breaking upward so the top note is left sustaining the melody.

## Constraint in this repo

The app's score schema is **strictly monophonic** — one `midiNumber` per note,
no double-stops. Worse, `monophonic()` in `src/domain/midi.ts` resolves overlaps
by keeping the **higher** note and discarding the lower, which destroys exactly
the structural bass that implied polyphony depends on.

So for library work: express harmony as **broken arpeggiation in the note
stream**, never as simultaneities, and check what the flattening did to the bass
before trusting the output. See [PIPELINE.md](PIPELINE.md).

## Verify

```bash
npm run typecheck && npm test    # 23 fingering tests, 29 cello-geometry tests
```

Anything in `src/domain` stays pure TypeScript — no React Native (AGENTS.md).

## Traps

- **Standard tuning only — C2 G2 D3 A3.** Never propose scordatura. Every piece
  must play without retuning; transpose or revoice instead. See
  [ARRANGING.md](ARRANGING.md).
- **Never treat position numbers as distance.** Positions are unevenly spaced;
  use millimetres. See [INSTRUMENT.md](INSTRUMENT.md).
- No fourth finger in thumb position. Not a preference — an anatomy.
- The cello hand frame spans a **minor third** across fingers 1–4, not the
  violin's major third.
- An open string is not free on a long note: it cannot be vibrated.
- Honour `preferFlats` from the key signature so B♭ major does not print as A♯.
- Only adapt music there is a right to adapt.
