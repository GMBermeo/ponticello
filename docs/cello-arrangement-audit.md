# Cello arrangement audit

| | |
|---|---|
| Measured | 2026-09-22 00:49 UTC |
| Songs × levels | 333 × 4 = 1332 parts, plus 48 authored studies |
| `src/scores/bundledSongs.json` | md5 `2c373be78933` |
| `src/domain/arranger/pipeline.ts` | md5 `9741a9b05838` |
| `tools/audit-arrangements.ts` | md5 `b3fe9e2db041` |

Reproduce with `npm run audit:arrangements`. **The three md5s above are part of
the result**: the library and the arranger move under this tool, and a failure
count that cannot be pinned to a population is not a measurement.

Checks come in four classes, and the class is printed with every failure:

| Class | What its thresholds are | Failures |
|---|---|---:|
| **doctrine** | measured from published beginner cello material — `.scratch/gauntlet/reference/DOCTRINE.md`, quoting the ABRSM 2024 cello syllabus and the note data of eight published arrangements. Each carries its section. | 872 |
| **game** | this app's own rules. DOCTRINE.md says outright that *"coverage/silence is not addressed by any source here"*, so these are not standards and are not dressed as any. Published data points bracket them where they exist. | 96 |
| **profile** | `ARRANGEMENT_PROFILES[level]` — the configuration the arranger used to build the thing being measured. Self-consistency, not a standard; kept because a bug there is worth catching. | 1 |
| **integrity** | the data must describe itself: schema, ids, open strings fingered open, held notes actually sounded, and a harmony metric that a wrong answer cannot beat. | 180 |

## Doctrine gate — is it written the way published beginner cello parts are written?

Median / worst across the 333 songs. Published bounds, from DOCTRINE.md:
top note ≤ D4 (G4 at Grade 4), bottom ≥ C2, max leap 9 st at "Beginners" and
12–16 with experience, under 4% of intervals over a perfect 5th, 27–40%
open-string pitches (up to ~80% for a drone), 5–6 distinct pitches in a
drone/bass part, 7 pitch classes in one key.

**Which bound applies to which level, and why.** DOCTRINE.md §6 is headed *"for
a Beginner line"*, so the bounds it measured from published arrangements —
open-string share, distinct pitches, accidentals, pitch classes, the >P5 share,
extensions and the sustain ceiling — are **gated at Beginner only** and merely
reported above it. The bounds ABRSM publishes *per grade* are gated per level on
this stated mapping: Beginner = Grade 1, Intermediate = Grade 2, Advanced =
Grade 3, Expert = Grade 4. That is range (`G–d′`, `C–d′`, `C–d′`, `C–g′`), the
note-value floor (paired quavers to Grade 2, semiquavers from Grade 3) and the
leap ceiling (9 st at "Beginners", 12–16 at "Beginners with some playing
experience"). Attack the mapping if you disagree with it — it is stated here so
it can be attacked, rather than left implicit in a threshold.

| ArrangementLevel | Parts | Top note | Bottom note | Max leap | > P5 % | Open string % | Below open G % | Stopped below G | Distinct pitches | Pitch classes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Beginner | 333 | G3 / D4 | G#2 / C2 | 9 / 9 | 1.2 / 60.3 | 26 / 0 | 0 / 99 | 0 / 276 | 6 / 11 | 6 / 6 |
| Intermediate | 333 | C4 / D4 | C#2 / C2 | 9 / 9 | 3.8 / 50.0 | 17 / 0 | 16 / 100 | 32 / 434 | 11 / 24 | 8 / 12 |
| Advanced | 333 | B3 / D4 | D2 / C2 | 12 / 12 | 9.5 / 71.2 | 18 / 0 | 16 / 83 | 37 / 679 | 13 / 27 | 8 / 12 |
| Expert | 333 | B3 / D4 | D2 / C2 | 12 / 12 | 8.5 / 69.6 | 18 / 0 | 17 / 86 | 52 / 1132 | 13 / 27 | 9 / 12 |

## Game gate — is there anything to play?

No syllabus covers coverage. Entry, tail and gap are in **quarter-beats**, not
bars: 41 songs store a bar shorter than four beats (seven of them the
degenerate `1/4` the build emits when meter detection fails), so a
bar-denominated budget silently converts a meter-detection bug into a musical
verdict. `meter` and `barBeats` stay in the CSV for reference.

| ArrangementLevel | Entry (beats) | Tail (beats) | Live gap (beats) | Fill % | Attacks / 4 beats | Longest note (beats) | Repeated pitch % | Root+5th % | Root % | Doubles the bass % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Beginner | 0.0 / 12.0 | 0.0 / 16.0 | 4.0 / 42.7 | 63 / 29 | 2.91 / 0.96 | 1.5 / 3.5 | 71 / 25 | 87 / 15 | 83 / 7 | 92 / 100 |
| Intermediate | 0.0 / 0.1 | 0.0 / 268.0 | 1.7 / 260.0 | 82 / 26 | 2.57 / 0.13 | 6.5 / 137.1 | 35 / 0 | 84 / 28 | 80 / 19 | 95 / 100 |
| Advanced | 0.0 / 201.3 | 0.3 / 242.6 | 11.5 / 399.0 | 52 / 2 | 2.92 / 0.27 | 4.0 / 155.6 | 27 / 0 | 74 / 12 | 57 / 1 | 47 / 100 |
| Expert | 0.0 / 201.3 | 0.3 / 242.6 | 10.8 / 398.6 | 70 / 6 | 4.51 / 0.37 | 4.0 / 155.6 | 25 / 0 | 72 / 17 | 56 / 2 | 45 / 100 |

For scale: the published beginner drone part measured in DOCTRINE.md §3 plays
**5 attacks per bar of 4/4**, holds **nothing longer than a crotchet**, and
repeats the same pitch on **~50%** of adjacent pairs.

## Failures by check

| Check | Class | Threshold and source | Beginner | Intermediate | Advanced | Expert | Total |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| first position | doctrine | §1/#3 1st position through Grade 3 | 53 | 37 | 150 | 152 | 392 |
| root validity | integrity | the real line must outscore +1/+5/+7 transpositions | 180 | 0 | 0 | 0 | 180 |
| open-string share | doctrine | §2/#7 27–40% measured in published parts | 174 | 0 | 0 | 0 | 174 |
| accidentals | doctrine | §1/#4 zero accidentals vs the score's own key | 173 | 0 | 0 | 0 | 173 |
| wide leaps | doctrine | §4/#11 <4% of intervals over a P5 | 83 | 0 | 0 | 0 | 83 |
| live gap | game | ≤ 16 beats; published part rests 4 bars | 18 | 39 | 0 | 0 | 57 |
| root agreement | game | ≥ 70% from the brief; doctrine silent | 35 | 0 | 0 | 0 | 35 |
| note values | doctrine | §1/#6 quaver floor to Grade 2; semiquavers Grade 3 | 1 | 30 | 2 | 0 | 33 |
| drone pitches | doctrine | §3/#8 5–6 distinct pitches in the whole part | 13 | 0 | 0 | 0 | 13 |
| longest note | doctrine | §1/#6 dotted minim at Grade 2 | 4 | 0 | 0 | 0 | 4 |
| tail silence | game | symmetry with the entry; no published bar | 0 | 4 | 0 | 0 | 4 |
| difficulty | profile | measured tier ≤ selected level | 1 | 0 | 0 | 0 | 1 |

| Class | Failures |
| --- | ---: |
| doctrine | 872 |
| game | 96 |
| profile | 1 |
| integrity | 180 |

## Worst 20 songs (Beginner numbers)

| Song | Failed | Entry beats | Tail beats | Live gap beats | Fill % | Open % | Pitches | PCs | Accidentals | Root+5th % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rage-against-the-machine-take-the-power-back | 10 | 0.0 | 2.5 | 20.0 | 65 | 0 | 6 | 6 | 4 | 68 |
| metallica-unforgiven-new | 10 | 0.0 | 0.0 | 8.2 | 55 | 0 | 9 | 6 | 17 | 85 |
| metallica-blitzkreig | 9 | 0.0 | 0.0 | 42.7 | 48 | 6 | 6 | 6 | 23 | 87 |
| nirvana-come-as-you-are-2 | 9 | 0.0 | 0.0 | 31.9 | 58 | 0 | 5 | 5 | 0 | 60 |
| deftones-minerva | 9 | 0.0 | -0.5 | 16.0 | 55 | 0 | 6 | 5 | 16 | 70 |
| system-of-a-down-b-y-o-b | 8 | 0.0 | -0.0 | 34.0 | 47 | 4 | 5 | 5 | 0 | 82 |
| nirvana-all-apologies | 8 | 0.0 | 0.0 | 30.3 | 60 | 0 | 3 | 3 | 32 | 86 |
| queen-made-in-heaven | 8 | 6.0 | 0.0 | 8.0 | 61 | 13 | 6 | 6 | 44 | 83 |
| metallica-fuel | 8 | 0.0 | 0.0 | 10.0 | 50 | 0 | 5 | 5 | 6 | 73 |
| pantera-mouth-for-war | 8 | 0.3 | 0.0 | 2.1 | 64 | 3 | 6 | 6 | 9 | 91 |
| slipknot-before-i-forget | 8 | 0.0 | 0.0 | 2.0 | 62 | 6 | 9 | 6 | 34 | 87 |
| kittie-brackish | 7 | 0.0 | 0.0 | 32.0 | 53 | 0 | 4 | 4 | 0 | 97 |
| queen-the-miracle | 7 | 0.0 | 4.0 | 22.0 | 49 | 17 | 6 | 6 | 0 | 68 |
| john-williams-star-wars-medley | 7 | 10.0 | 0.0 | 15.7 | 43 | 17 | 6 | 6 | 22 | 75 |
| pantera-domination | 7 | 0.0 | 0.0 | 16.0 | 51 | 11 | 6 | 6 | 26 | 86 |
| 30-seconds-to-mars-kings-and-queens | 7 | 0.0 | 0.0 | 16.0 | 60 | 3 | 6 | 6 | 12 | 92 |
| linkin-park-papercut | 7 | 0.0 | 0.0 | 16.0 | 56 | 3 | 7 | 5 | 0 | 97 |
| queen-good-old-fashioned-lover-boy | 7 | 0.0 | 0.0 | 12.0 | 66 | 8 | 6 | 6 | 0 | 92 |
| metallica-master-of-puppets-sextet | 7 | 1.0 | -0.1 | 8.3 | 51 | 7 | 6 | 6 | 42 | 85 |
| slipknot-vermilion | 7 | 4.0 | 0.0 | 4.7 | 50 | 6 | 9 | 6 | 0 | 74 |

## What this gate does not claim

- **Key.** Every in-key number is measured against the key the score itself
  claims (`metadata.keySignature`), because that is the label the app parses —
  `generateAccompaniment` drones on it and the fingerboard overlay draws its
  scale. It is *also* `detectKey` output, and the detector is not confident:
  median confidence 0.13 across the 333 songs, 239 of them below the
  0.2 floor at which this report will call a key determined, and 3 songs where
  the key detected from the whole texture disagrees with the stored label. So the
  `accidentals` check is a **self-consistency** test — the line against its own
  declared key — not a musicological verdict, and `accidentalsEitherMode`
  reports how much of it survives a major/minor flip. The detected-key share
  (`inKeyDetectedPct`) is reported next to `keyConfidence` and **is not gated**.
- **Root agreement** is a triad fit over the sounding backing with **no
  lowest-note bonus** — that bonus made "the chord root" mean "the bass note",
  and since the accompaniment levels are derived from the source bass, the
  check then confirmed itself. `bassDoublingPct` reports how much of the
  agreement is plain bass doubling. Because "root or fifth" is invariant under
  transposing a line by a fifth, every Beginner line is also scored at +1, +5
  and +7 semitones; 180 songs fail `root validity` because a wrong line
  scores as well as the right one (134 of them are beaten outright, the rest
  matched), and their percentage means nothing. `rootNullBestPct` records the
  best score a wrong line reached, so the guard is auditable from the CSV.
- **Silence** has no published bar at all. The entry budget is bracketed by
  published opening rests of 0, 12, 24 and 40 quarter-beats; the 12-second cap
  is an app-UX rule and is labelled as one. The tail budget has no published
  datum whatsoever and only mirrors the entry.
- **`difficultyMislabelled` is empty for all 333 songs and that proves
  nothing yet**: `tools/build-library.ts` writes the `difficulty` field *from*
  `difficultyOf()`, so the comparison is tautological until someone hand-edits
  a tier or changes the weights. 70 songs currently disagree.
- **Doctrine's own gaps**, quoted: no first-hand Suzuki or Mooney notation, no
  Trinity data, and no published rule for coverage. Where §6 #2 sets a G2 floor
  for a Grade-1 melody, §3's measured published *bass* part runs D2–B2 with
  stopped notes across the C string — two published sources, opposite answers.
  So the hard floor is gated at the instrument (C2), `stopped below open G` is
  gated only for a Beginner line in a *melody* role, and both shares are
  reported per level rather than failed. The beginner engine is coding to the
  stricter reading (no stopped note below the open G, open C allowed); this gate
  will not claim a source says so for a bass part, because §3 says otherwise.
- These are automated source, geometry, timing and harmony checks. Nobody has
  played every piece.

Every song/level's numbers are in [the CSV](cello-arrangement-audit.csv).

Audit failures: 1149.

- [integrity/root validity] bach-minuet-in-g-bwv-anh114/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [integrity/root validity] bach-prelude-bwv1007-bars1-4/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/note values] bach-prelude-bwv1007-bars1-4/Intermediate: attacks 0.47 beats apart, under 0.5
- [doctrine/first position] debussy-clair-de-lune/Beginner: left first position
- [doctrine/wide leaps] debussy-clair-de-lune/Beginner: 8.3% of intervals exceed a perfect 5th
- [doctrine/open-string share] debussy-clair-de-lune/Beginner: 0.0% open-string pitches, under the published 27–40% band
- [game/live gap] debussy-clair-de-lune/Beginner: rests 26.3 beats while the backing plays
- [doctrine/first position] debussy-clair-de-lune/Advanced: left first position
- [doctrine/first position] debussy-clair-de-lune/Expert: left first position
- [integrity/root validity] dies-irae/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [integrity/root validity] fur-elise-opening/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/wide leaps] gymnopedie-no-1/Beginner: 5.3% of intervals exceed a perfect 5th
- [doctrine/first position] gymnopedie-no-1/Advanced: left first position
- [doctrine/first position] gymnopedie-no-1/Expert: left first position
- [doctrine/wide leaps] moonlight-sonata-mvt1-opening/Beginner: 10.5% of intervals exceed a perfect 5th
- [doctrine/open-string share] moonlight-sonata-mvt1-opening/Beginner: 0.0% open-string pitches, under the published 27–40% band
- [integrity/root validity] moonlight-sonata-mvt1-opening/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [game/root agreement] ode-to-joy/Beginner: 53.1% on the root or fifth of the sounding chord (100.0% simply double the bass)
- [integrity/root validity] ode-to-joy/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [integrity/root validity] pachelbel-canon-ground-bass/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/open-string share] scheherazade-1st-movement/Beginner: 12.5% open-string pitches, under the published 27–40% band
- [doctrine/accidentals] scheherazade-1st-movement/Beginner: 89/542 notes outside E major (0 outside both parallel modes)
- [game/live gap] scheherazade-1st-movement/Beginner: rests 17.2 beats while the backing plays
- [game/root agreement] scheherazade-1st-movement/Beginner: 46.9% on the root or fifth of the sounding chord (51.2% simply double the bass)
- [integrity/root validity] scheherazade-1st-movement/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/first position] scheherazade-1st-movement/Expert: left first position
- [doctrine/accidentals] scheherazade-2nd-movement-part-1/Beginner: 136/1281 notes outside B minor (136 outside both parallel modes)
- [game/live gap] scheherazade-2nd-movement-part-1/Beginner: rests 26.8 beats while the backing plays
- [game/root agreement] scheherazade-2nd-movement-part-1/Beginner: 45.3% on the root or fifth of the sounding chord (41.2% simply double the bass)
- [integrity/root validity] scheherazade-2nd-movement-part-1/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/first position] scheherazade-2nd-movement-part-1/Advanced: left first position
- [doctrine/first position] scheherazade-2nd-movement-part-1/Expert: left first position
- [doctrine/first position] scheherazade-3rd-movement/Beginner: left first position
- [doctrine/accidentals] scheherazade-3rd-movement/Beginner: 139/702 notes outside G major (0 outside both parallel modes)
- [game/root agreement] scheherazade-3rd-movement/Beginner: 42.6% on the root or fifth of the sounding chord (49.7% simply double the bass)
- [integrity/root validity] scheherazade-3rd-movement/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
- [doctrine/first position] scheherazade-3rd-movement/Advanced: left first position
- [doctrine/first position] scheherazade-3rd-movement/Expert: left first position
- [game/root agreement] atmosphere-study-drone/Beginner: 50.0% on the root or fifth of the sounding chord (100.0% simply double the bass)
- [integrity/root validity] atmosphere-study-drone/Beginner: a +1/+5/+7 transposition of this line scores as well as the line itself
