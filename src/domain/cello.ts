/**
 * Physical and musical model of the acoustic cello.
 *
 * Everything downstream — the fingerboard panel, the highway tape rules, the
 * tuner and the fingering solver — reads its geometry from this file, so the
 * app never disagrees with itself about where a note lives on the string.
 */

// ─── Tuning ──────────────────────────────────────────────────────────────────

/** Concert pitch. Kept as a constant so a future settings screen can move it. */
export const A4_HZ = 440;

export type CelloString = 'C' | 'G' | 'D' | 'A';

/** Low → high. Also the left-to-right lane order on the highway. */
export const STRING_ORDER: readonly CelloString[] = ['C', 'G', 'D', 'A'] as const;

/** Open-string MIDI numbers (middle C = C4 = 60). */
export const OPEN_STRING_MIDI: Record<CelloString, number> = {
  C: 36, // C2 — 65.41 Hz
  G: 43, // G2 — 98.00 Hz
  D: 50, // D3 — 146.83 Hz
  A: 57, // A3 — 220.00 Hz
};

/** Roman numerals as written in cello parts: A is the I string, C is the IV. */
export const STRING_NUMERAL: Record<CelloString, string> = { A: 'I', D: 'II', G: 'III', C: 'IV' };

// ─── Pitch conversions ───────────────────────────────────────────────────────

export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / A4_HZ);
}

/**
 * Logarithmic distance from a detected pitch to its target, in cents.
 * Positive = sharp. This is the number the whole feedback layer is built on.
 */
export function centsBetween(detectedHz: number, targetHz: number): number {
  return 1200 * Math.log2(detectedHz / targetHz);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
/** Spelling used when the key signature has flats. */
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export function midiToPitchName(midi: number, preferFlats = false): string {
  const names = preferFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// ─── Intonation tolerance ────────────────────────────────────────────────────

/** Inside this the note reads as in tune and the notehead turns green. */
export const CENTS_PERFECT = 15;
/** Between perfect and this, an amber "nudge it" cue. Beyond it, a miss. */
export const CENTS_ACCEPTABLE = 30;

export type IntonationVerdict = 'perfect' | 'flat' | 'sharp' | 'miss';

export function judgeIntonation(cents: number): IntonationVerdict {
  const d = Math.abs(cents);
  if (d <= CENTS_PERFECT) return 'perfect';
  if (d <= CENTS_ACCEPTABLE) return cents < 0 ? 'flat' : 'sharp';
  return 'miss';
}

// ─── Fingerboard geometry ────────────────────────────────────────────────────

/**
 * Vibrating string length, nut to bridge, on a full-size (4/4) cello.
 * A 3/4 instrument is ~655 mm; changing this rescales every tape and landmark
 * consistently, which is why nothing else hard-codes a millimetre value.
 */
export const STRING_LENGTH_MM = 690;

/**
 * Distance from the nut to the stopping point that raises the open string by
 * `semitones`, from the standing-wave relation f ∝ 1/L:
 *
 *     d(n) = L · (1 − 2^(−n/12))
 *
 * This is the only place the fretless fingerboard is turned into millimetres.
 */
export function stopDistanceMm(semitones: number, lengthMm = STRING_LENGTH_MM): number {
  return lengthMm * (1 - Math.pow(2, -semitones / 12));
}

/** Inverse of {@link stopDistanceMm} — millimetres back to semitones. */
export function semitonesAtMm(mm: number, lengthMm = STRING_LENGTH_MM): number {
  return -12 * Math.log2(1 - mm / lengthMm);
}

// ─── Left-hand positions ─────────────────────────────────────────────────────

export type CelloPosition =
  | 'Half' | '1st' | '2nd' | '3rd' | '4th' | '5th' | '6th' | '7th' | 'Thumb';

/** Semitones above the nut at which the *first finger* sits in each position. */
export const POSITION_BASE_SEMITONES: Record<CelloPosition, number> = {
  Half: 1, '1st': 2, '2nd': 4, '3rd': 5, '4th': 7, '5th': 9, '6th': 11, '7th': 12, Thumb: 12,
};

/** Ordering used by the shift-cost model; Thumb sits beyond the neck positions. */
export const POSITION_ORDER: Record<CelloPosition, number> = {
  Half: 0.5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, Thumb: 8,
};

export type CelloFinger = '0' | '1' | '2' | '3' | '4' | 'T';

/** How a cellist says it out loud, for the tutorial and the position brackets. */
export const FINGER_NAME: Record<CelloFinger, string> = {
  '0': 'open string',
  '1': 'index',
  '2': 'middle',
  '3': 'ring',
  '4': 'little finger',
  T: 'thumb',
};

/**
 * Fixed landmarks drawn behind every vision. These are features of the
 * instrument, not of the player's tapes — the neck heel and the octave
 * harmonic are there whether or not anything is stuck to the fingerboard.
 */
export interface Landmark {
  id: string;
  label: string;
  semitones: number;
  mm: number;
  /** `major` landmarks get a heavier rule and a permanent label. */
  weight: 'major' | 'minor';
  hint: string;
}

function landmark(
  id: string, label: string, semitones: number, weight: Landmark['weight'], hint: string,
): Landmark {
  return { id, label, semitones, mm: stopDistanceMm(semitones), weight, hint };
}

export const LANDMARKS: readonly Landmark[] = [
  landmark('nut', 'NUT', 0, 'major', 'Where the string leaves the pegbox. All distances start here.'),
  landmark('half', '½ POS', 1, 'minor', 'One semitone up. First finger sits here in half position.'),
  landmark('first', '1ST POS', 2, 'major', 'One whole step up. The home position — first finger lives here.'),
  landmark('second', '2ND POS', 4, 'minor', 'First finger a major third above the nut.'),
  landmark('third', '3RD POS', 5, 'minor', 'First finger a perfect fourth above the nut.'),
  landmark('fourth', '4TH POS', 7, 'major', 'The neck heel. You can feel the body of the cello here — a landmark you can find with your eyes shut.'),
  landmark('octave', '8VA · T', 12, 'major', 'Exactly half the string. Touch it lightly for the octave harmonic; this is where the thumb parks.'),
] as const;

// ─── Notes on the fingerboard ────────────────────────────────────────────────

/** MIDI number produced by stopping `string` at `semitones` above the nut. */
export function midiAt(string: CelloString, semitones: number): number {
  return OPEN_STRING_MIDI[string] + semitones;
}

/** Semitones above the nut needed on `string` to produce `midi`, or null if off the string. */
export function semitonesFor(string: CelloString, midi: number): number | null {
  const n = midi - OPEN_STRING_MIDI[string];
  return n >= 0 && n <= 26 ? n : null;
}

/**
 * Which string a pitch most naturally sits on when you just want *a* place to
 * put it — the highest string that can reach it without leaving the neck.
 * The Viterbi solver in `fingering.ts` makes the real decision; this is for
 * quick displays like the tuner and the tape reference table.
 */
export function defaultStringFor(midi: number): CelloString | null {
  for (const s of [...STRING_ORDER].reverse()) {
    const n = semitonesFor(s, midi);
    if (n !== null && n <= 19) return s;
  }
  return null;
}
