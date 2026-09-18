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

/** Low → high. Also the musical string order used in solvers and pitch lookups. */
export const STRING_ORDER: readonly CelloString[] = ['C', 'G', 'D', 'A'] as const;

/**
 * Visual display order from left to right: A → D → G → C.
 * Matches the cellist's physical perspective looking down at the fingerboard.
 */
export const DISPLAY_STRING_ORDER: readonly CelloString[] = ['A', 'D', 'G', 'C'] as const;

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

// ─── Cello note catalog & score notation info ────────────────────────────────

export interface CelloNoteInfo {
  midi: number;
  pitchName: string;
  letter: string;
  accidental: '♯' | '♭' | null;
  octave: number;
  /** Diatonic staff step relative to the bass clef bottom line (G2 = 0). */
  staffStep: number;
  /** Ledger line positions in half-steps/steps: -2, -4... or 10, 12... */
  ledgerLines: number[];
  defaultString: CelloString | null;
  semitones: number | null;
}

const BASS_BOTTOM_LINE = 18; // G2 diatonic offset: octave 2 * 7 + G(4) = 18
const LETTER_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const SHARP_LETTERS: { [pc: number]: { letter: string; accidental: '♯' | null } } = {
  0: { letter: 'C', accidental: null },
  1: { letter: 'C', accidental: '♯' },
  2: { letter: 'D', accidental: null },
  3: { letter: 'D', accidental: '♯' },
  4: { letter: 'E', accidental: null },
  5: { letter: 'F', accidental: null },
  6: { letter: 'F', accidental: '♯' },
  7: { letter: 'G', accidental: null },
  8: { letter: 'G', accidental: '♯' },
  9: { letter: 'A', accidental: null },
  10: { letter: 'A', accidental: '♯' },
  11: { letter: 'B', accidental: null },
};

const FLAT_LETTERS: { [pc: number]: { letter: string; accidental: '♭' | null } } = {
  0: { letter: 'C', accidental: null },
  1: { letter: 'D', accidental: '♭' },
  2: { letter: 'D', accidental: null },
  3: { letter: 'E', accidental: '♭' },
  4: { letter: 'E', accidental: null },
  5: { letter: 'F', accidental: null },
  6: { letter: 'G', accidental: '♭' },
  7: { letter: 'G', accidental: null },
  8: { letter: 'A', accidental: '♭' },
  9: { letter: 'A', accidental: null },
  10: { letter: 'B', accidental: '♭' },
  11: { letter: 'B', accidental: null },
};

function createNoteInfo(midi: number, preferFlats = false): CelloNoteInfo {
  const pc = ((midi % 12) + 12) % 12;
  const spec = (preferFlats ? FLAT_LETTERS[pc] : SHARP_LETTERS[pc]) ?? { letter: 'C', accidental: null };
  const octave = Math.floor(midi / 12) - 1;
  const letterOffset = LETTER_STEP[spec.letter] ?? 0;
  const diatonic = octave * 7 + letterOffset;
  const staffStep = diatonic - BASS_BOTTOM_LINE;

  const ledgerLines: number[] = [];
  for (let s = 10; s <= staffStep; s += 2) ledgerLines.push(s);
  for (let s = -2; s >= staffStep; s -= 2) ledgerLines.push(s);

  const defString = defaultStringFor(midi);
  const semitones = defString ? semitonesFor(defString, midi) : null;

  return {
    midi,
    pitchName: midiToPitchName(midi, preferFlats),
    letter: spec.letter,
    accidental: spec.accidental,
    octave,
    staffStep,
    ledgerLines,
    defaultString: defString,
    semitones,
  };
}

function buildCelloNotesCatalog(): Record<number, CelloNoteInfo> {
  const catalog: Record<number, CelloNoteInfo> = {};
  // Standard cello range: C2 (36) to C6 (84)
  for (let midi = 36; midi <= 84; midi++) {
    catalog[midi] = createNoteInfo(midi, false);
  }
  return catalog;
}

/**
 * Constant catalog of all standard notes on the cello (MIDI 36 / C2 through MIDI 84 / C6),
 * indexed by MIDI number for instant lookup.
 */
export const CELLO_NOTES: Record<number, CelloNoteInfo> = buildCelloNotesCatalog();

export function getCelloNote(midi: number, preferFlats = false): CelloNoteInfo {
  const cached = CELLO_NOTES[midi];
  if (!preferFlats && cached) {
    return cached;
  }
  return createNoteInfo(midi, preferFlats);
}

/**
 * Calculates the ideal fingerboard drawing extent (maxMm) based on the positions and semitones
 * actually used in the piece:
 * - 1st position only (<= 6 semitones): ~220 mm (zooms in, visually separating notes)
 * - Up to 4th position (<= 10 semitones): ~330 mm (omits 8va/thumb position)
 * - Upper / thumb positions: 440 mm (full board)
 */
export function calculateFretboardMaxMm(
  notes: readonly { string: CelloString; midiNumber: number; position?: CelloPosition }[],
): number {
  if (!notes || notes.length === 0) return 440;

  let maxSemitones = 0;
  let hasThumbOrHigh = false;

  for (const n of notes) {
    const semitones = n.midiNumber - OPEN_STRING_MIDI[n.string];
    if (semitones > maxSemitones) maxSemitones = semitones;
    if (n.position === 'Thumb' || n.position === '5th' || n.position === '6th' || n.position === '7th') {
      hasThumbOrHigh = true;
    }
  }

  if (hasThumbOrHigh || maxSemitones > 10) return 440;
  if (maxSemitones <= 6) return 220;
  return 330;
}

/**
 * How far down the string a *panel* should draw, given the room it has.
 *
 * `calculateFretboardMaxMm` answers "what does this piece need"; this answers
 * "what should we actually show", and they are different questions. A piece
 * that never leaves first position needs 220 mm, and on a tall column that
 * 220 mm gets stretched over the whole panel: two neighbouring semitones end
 * up a finger's width apart on screen and a hand's width apart on the cello,
 * which teaches the opposite of the truth. It also wastes the space — the
 * player is shown four tapes when nine are stuck to their instrument.
 *
 * So the extent grows with the room until the drawing is no more stretched
 * than `MAX_UNITS_PER_MM`, snapped to a short ladder so that a few pixels of
 * layout change cannot make the whole picture rescale.
 */
const MAX_UNITS_PER_MM = 1.35;
/** Past this there is nothing left worth drawing: the bridge is at 690 mm. */
const FULL_BOARD_MM = 440;
const EXTENT_LADDER = [220, 275, 330, 385, FULL_BOARD_MM] as const;

export function fingerboardExtentMm(songMinMm: number, heightUnits: number): number {
  if (!Number.isFinite(heightUnits) || heightUnits <= 0) return songMinMm;
  const wanted = Math.max(songMinMm, heightUnits / MAX_UNITS_PER_MM);
  return EXTENT_LADDER.find((mm) => mm >= wanted) ?? Math.max(songMinMm, FULL_BOARD_MM);
}

// ─── The same note, somewhere else ───────────────────────────────────────────

/**
 * How far up a string the neck reaches: fourth position anchors at 7 semitones
 * and the little finger stretches to four above it.
 */
export const NECK_REACH_SEMITONES = 11;

export interface Placement {
  string: CelloString;
  /** Semitones above the nut. 0 is the open string. */
  semitones: number;
}

/**
 * Every place a pitch can be stopped within the neck.
 *
 * A cello has no one-to-one map from note to place. A2 is the second semitone
 * of the G string and the ninth of the C string, and which one is *right*
 * depends entirely on what the hand is doing either side of it — which is the
 * whole reason `seatLine` reads a passage rather than a note.
 *
 * The solver picks one. This lists the rest, so the player can see the choice
 * that was made on their behalf and disagree with it: a run that has been
 * seated across a string crossing may be far easier taken up one string, and
 * nothing on screen could previously say so.
 */
export function placementsFor(
  midiNumber: number, maxSemitones = NECK_REACH_SEMITONES,
): Placement[] {
  const out: Placement[] = [];
  for (const string of STRING_ORDER) {
    const semitones = midiNumber - OPEN_STRING_MIDI[string];
    if (semitones >= 0 && semitones <= maxSemitones) out.push({ string, semitones });
  }
  return out;
}

/** The other places a pitch could be taken, given where it is being taken now. */
export function alternativePlacements(
  midiNumber: number, played: Placement, maxSemitones = NECK_REACH_SEMITONES,
): Placement[] {
  return placementsFor(midiNumber, maxSemitones)
    .filter((p) => p.string !== played.string || p.semitones !== played.semitones);
}
