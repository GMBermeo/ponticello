# The instrument

Physical constraints, as numbers. `src/domain/cello.ts` is the source of truth
in this repo; every figure below is derived from it.

## Tuning and compass

Open strings are **C2 G2 D3 A3 — MIDI 36, 43, 50, 57**, a perfect fifth apart.
The UI lane order is C G D A, low to high, left to right.

- Nothing below MIDI 36 exists in standard tuning. Transpose up or drop.
- Practical ceiling is around MIDI 81 (A5); the solver caps one string at
  `MAX_SEMITONES_ON_STRING = 26`, giving MIDI 83 on the A string.
- The tuning in fifths is why C major and G major ring: their tonics and
  dominants are open strings, and stopped notes in those keys excite sympathetic
  vibration in the strings not being played.

## Registers and clefs

| Register | Clef | Range | Role |
|---|---|---|---|
| Bass | Bass (F) | C2–D4 | Roots, pedal points, dark themes |
| Tenor | Tenor (C on 4th line) | G3–G4 | The cantabile voice; middle counterpoint |
| Soprano | Treble (G) | C4 upward | Lead lines, thumb position, high double-stops |

Switch clef to avoid ledger lines, not to mark a musical event. A line that
crosses G3–G4 repeatedly belongs in tenor clef throughout.

## Fingerboard geometry

The board is **fretless**. Stopping distance from the nut, for `n` semitones
above the open string, on a 690 mm (4/4) string:

```
d(n) = 690 · (1 − 2^(−n/12))      ← stopDistanceMm()
```

Because this is logarithmic, **positions are not evenly spaced**:

| From → to | Distance |
|---|---|
| 1st → 2nd | 67 mm |
| 1st → 4th (the reference shift) | 154 mm |
| 6th → 7th | 21 mm |

Counting position *numbers* as a distance metric punishes low shifts and waves
through high ones. Always measure in millimetres.

The octave harmonic sits at exactly half the string, 345 mm — 12 semitones.

## The three ergonomic regions

**Neck (half–4th).** Four-finger frame, maximum stability, warmest fundamentals.
The thumb sits behind the neck opposite the second finger.

**Intermediate (5th–7th).** The hand passes the neck-body junction and contours
to the sloping upper bout; the frame narrows toward three fingers.

**Thumb (above 7th).** The side of the thumb lies across one or two strings as a
movable nut. Stops are close together, so octaves, fast scales and dense
voicings become available up here and only up here.

## Hand frames

`POSITION_BASE_SEMITONES` gives where the **first finger** sits above the open
string: Half 1, 1st 2, 2nd 4, 3rd 5, 4th 7, 5th 9, 6th 11, 7th 12, Thumb 12.

| Frame | Fingers | Rule |
|---|---|---|
| Closed | 1 2 3 4 | One semitone each — a **minor third** total span |
| Forward extension | 1 (2) 3 4 | 1 stays; 2/3/4 reach one semitone further. Half–4th only |
| Backward extension | 1 | Reaches one semitone below the base. 1st–4th only |
| Thumb | T 1 2 3 | A tetrachord above the thumb. **No fourth finger** |

The minor-third span is the single most common error for arrangers coming from
violin or guitar. Fingers 1 and 4 are three semitones apart, not four or five.

Thumb position is not one place — the thumb parks anywhere from the octave
harmonic upward, which is why `CelloState.baseSemitones` tracks where. Without
it every thumb placement looks identical to the shift model and the solver parks
the hand up there for notes no cellist would take there. Offered only above
`THUMB_FLOOR_MIDI = 62` (D4).

## Double-stops

Adjacent strings are a fifth apart, so for an interval of `I` semitones the
upper finger sits `I − 7` semitones further from the nut than the lower:

```
offset = I − 7        positive = further from the nut
```

| I | Interval | Offset | Playability |
|---|---|---|---|
| 2 | M2 | −5 | Needs an open string |
| 3 | m3 | −4 | Wide; strains in low positions |
| 4 | M3 | −3 | Wide; strains in low positions |
| 5 | P4 | −2 | Comfortable |
| 6 | Tritone | −1 | Comfortable, very resonant |
| 7 | **P5** | **0** | One finger barring both strings |
| 8 | m6 | +1 | Comfortable |
| 9 | M6 | +2 | Comfortable, very resonant |
| 10–12 | m7, M7, 8ve | +3…+5 | Open string, or thumb position |

Hand span narrows as the hand climbs, so wide offsets get easier high up and
small ones stay awkward low down.

**Open strings expand reach.** Pairing an open lower string with a stopped upper
note reaches intervals like tenths that no closed hand can. It also relaxes the
left hand and maximises resonance — at the cost of timbral contrast, since an
open string cannot be vibrated and will sound brighter than its neighbours.

**Broken double-stops**: the left hand holds both stops while the bow articulates
them in sequence. Relax pressure on the silent string to avoid fatigue.

## Intonation tolerance

The app judges against ±15 ¢ in tune, ±30 ¢ a nudge, beyond that a miss
(`CENTS_PERFECT`, `CENTS_ACCEPTABLE`). Against a drone, a note four cents out
starts to beat audibly — which is why drone practice beats tuner practice.

## The tape system

Coloured tapes mark stopping points for a learner. `src/domain/tapes.ts`; the
app colours noteheads by which tape they land on.

- **First position** — blue / yellow / yellow / green at 2, 3, 4, 5 semitones
  (75, 110, 142, 173 mm from the nut).
- **Thumb position** — blue / green / green / yellow from the octave harmonic
  (12 semitones, 345 mm).

Tapes crowd together as they climb because the string halves at the octave.
That is the instrument, not a drawing error.
