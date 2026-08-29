# Arranging for solo cello

The method, in the order the decisions actually have to be made. Earlier
choices constrain later ones, so do not reorder.

## 1. Key selection

Do this first. It governs playability more than every fingering decision
combined.

**Target keys:** C major, G major, D major, A major, and their relative minors
(A, E, B, F♯ minor) — plus D minor. In these, tonics and dominants fall on open
strings, giving free resonance, sympathetic vibration, and an audible reference
for intonation.

**Keys to leave:** A♭ major, E♭ minor, D♭ major and neighbours. They suppress
open-string resonance, force a permanently closed hand, cost projection, and
fatigue the left hand quickly.

Transposing a lead sheet from a B♭ or E♭ instrument? Put the melody in the
cello's cantabile register (roughly G3–G4) rather than transposing literally.

Transposition is mechanical — let MuseScore do it, see [PIPELINE.md](PIPELINE.md).

## 2. Structural reduction

One instrument cannot carry a full texture, and attempting it produces
frequency masking rather than richness. Reduce to **two essential voices**:

- **Structural bass** — harmonic direction and groove. Roots and functional
  motion, not every bass note in the source.
- **Soprano** — the principal thematic material.

Everything in the middle is discarded by default and reinstated only where it
earns its place (step 5). This is the Schenkerian reading: the unaccompanied
Bach reduces to a three-part network of bass, inner voice and soprano, and the
surface figuration is an elaboration of it, not the substance.

## 3. Range fitting

Sounding compass is C2–A5. In priority order:

1. **Octave-displace** until the median pitch sits near D3–A3.
2. **Change key** to something friendlier (step 1 may need revisiting).
3. **Fold outliers** inward by an octave — unless the fold breaks the contour.
4. **Drop** only as a last resort.

## 4. Implied polyphony

Also called compound melody. A single line is split into distinct registral
bands; the ear's stream-segregation machinery tracks each band as a continuous
voice, so one bow produces two or three perceived parts.

| Technique | Mechanism | Function |
|---|---|---|
| Registral leaps | Wide intervals between low and high strings | Isolates bass from treble |
| Broken arpeggiation | Chord tones sounded in sequence across strings | Full harmony without multi-stops |
| Pedal-point ostinato | A repeated stationary pitch, often an open string | Grounding and simulated accompaniment |
| Compound voice leading | Stepwise motion alternating high and low beats | Implies strict two- or three-part counterpoint |

To make the illusion hold:

- Each band must have its **own coherent line**. High notes resolve stepwise to
  the next high note; low notes spell a logical thorough-bass.
- **Separate the bands by register** far enough that the ear will not fuse them.
- **Accent the structural bass** — an articulation or accent on the low note
  makes the listener mentally sustain it while the bow moves away.
- Keep the bands rhythmically distinguishable; a bass that moves at the same
  rate as the melody stops sounding like a separate voice.

## 5. Harmony where it pays

Reinstate middle-register tones only at cadences and phrase ends.

- Interval comfortable (offset −2…+2)? A double-stop. See
  [INSTRUMENT.md](INSTRUMENT.md).
- Otherwise, broken arpeggiation.
- Three and four notes are **always** broken — the curved bridge means the bow
  cannot sustain more than two strings. Voice bass roots on the lower pair and
  break upward, so the top note is left sustaining the melody.

## 6. Form, transitions and pacing

A solo performance has no accompaniment to cover the seams, so transitions have
to be composed rather than assumed.

- Build energy deliberately toward climaxes across verse–chorus–bridge or dance
  movements.
- Use written crescendi, scalar risers and fallers to carry the listener across
  structural boundaries.
- **Use silence.** Rests let the instrument's natural decay clear before a new
  harmonic region, and create tension nothing else will.
- Change something every eight bars or so — register, dynamic, bow articulation,
  polyphonic density — while keeping motivic unity. Textural monotony is the
  characteristic failure of solo arrangements.

## Standard tuning only

**C2 G2 D3 A3, always.** Every arrangement must be playable without retuning a
string. Scordatura is out of scope for this project and must not be introduced:
`OPEN_STRING_MIDI` is a fixed constant, and the fingering solver, the tape
overlays and the tuner all assume it, so a retuned piece would read and sound
wrong throughout the app.

Consequences to design around rather than work around:

- The compass is **C2 upward**. There is no B1. A piece that wants one gets
  transposed, not retuned.
- Chords needing an altered open string are unavailable. Revoice them, or imply
  the harmony through arpeggiation instead.
- The works that use scordatura — Bach's Suite No. 5 (A3 to G3) and Kodály's
  Op. 8 — cannot be reproduced faithfully here. Adapt them to standard tuning
  with revoiced chords, or leave them out. Bach's Suite No. 6 is for a
  five-string instrument and is excluded for the same reason.

## Extended techniques

Reach for these when simulating an ensemble, not for decoration.

- **Left-hand pizzicato** — pluck an open or stopped string while bowing a
  melody on another. Genuine two-voice texture.
- **Sul ponticello / sul tasto** — bow near the bridge or over the fingerboard
  to shift overtone content. A timbral change without changing instrument, and
  the practical tool for keeping a melody clear of its own accompaniment.
- **Artificial harmonics**, often with glissando, for fluid high transitions.
- **Percussive bow-slaps** for groove in popular and jazz adaptations.

Bow mechanics underlying all of it: lower strings want more bow mass and slower
speed; higher registers need precise contact-point control to avoid masking the
melody with its own overtones.

## Models worth studying

All in standard tuning, so everything in them transfers directly.

| Work | Why |
|---|---|
| Bach, Suites Nos. 1–4 | The archetype of implied polyphony and broken thorough-bass counterpoint |
| Cassadó, Suite | Virtuosic thumb-position double-stops, rhythmic strumming, folk idiom |

Suites Nos. 5 and 6 are deliberately absent — No. 5 is scordatura, No. 6 is for
a five-string instrument.
