/**
 * The coloured tapes stuck to *this* player's fingerboard.
 *
 * A beginner does not read millimetres — they read "second yellow, D string".
 * Every vision in the app therefore draws the tapes described here rather than
 * a generic set of landmarks, so what is on screen matches what is under the
 * hand. Edit them in Settings → My tapes if the physical tapes move.
 */

import {
  CelloFinger, CelloString, STRING_ORDER, midiAt, midiToPitchName, stopDistanceMm,
} from './cello';

export type TapeColor = 'blue' | 'yellow' | 'green' | 'red' | 'orange' | 'white';

export interface Tape {
  id: string;
  color: TapeColor;
  /** Semitones above the nut. Drives the millimetre position and every note name. */
  semitones: number;
  /** Which finger this tape is for. `T` is the thumb in thumb position. */
  finger: CelloFinger;
  /** Short caption under the tape, e.g. "1st finger". */
  caption: string;
}

export interface TapeSet {
  id: 'first' | 'thumb';
  name: string;
  /** Where the hand sits when these tapes are in play. */
  blurb: string;
  tapes: Tape[];
}

/**
 * Default first-position tapes: BLUE · YELLOW · YELLOW · GREEN.
 *
 * These are the four fingers of the closed first-position hand frame, one
 * semitone apart, spanning a minor third from first finger to little finger.
 * Blue anchors the hand, the two yellows are the middle fingers, green is the
 * far edge of the frame.
 */
export const FIRST_POSITION_TAPES: TapeSet = {
  id: 'first',
  name: 'First position',
  blurb: 'Thumb behind the neck, opposite the second finger. Fingers 1–4 span a minor third — one semitone per tape.',
  tapes: [
    { id: 'f1', color: 'blue', semitones: 2, finger: '1', caption: '1st finger' },
    { id: 'f2', color: 'yellow', semitones: 3, finger: '2', caption: '2nd finger' },
    { id: 'f3', color: 'yellow', semitones: 4, finger: '3', caption: '3rd finger' },
    { id: 'f4', color: 'green', semitones: 5, finger: '4', caption: '4th finger' },
  ],
};

/**
 * Default thumb-position tapes: BLUE · GREEN · GREEN · YELLOW.
 *
 * Blue sits on the octave harmonic at exactly half the string, where the side
 * of the thumb lies flat across two strings like a movable nut. Fingers 1, 2
 * and 3 then climb a major tetrachord above it (whole, whole, half); the
 * little finger is not used up here.
 */
export const THUMB_POSITION_TAPES: TapeSet = {
  id: 'thumb',
  name: 'Thumb position',
  blurb: 'The side of the thumb lies flat across two strings on the octave harmonic. Fingers 1–3 climb above it; the little finger sits out.',
  tapes: [
    { id: 't0', color: 'blue', semitones: 12, finger: 'T', caption: 'thumb · 8va harmonic' },
    { id: 't1', color: 'green', semitones: 14, finger: '1', caption: '1st finger' },
    { id: 't2', color: 'green', semitones: 16, finger: '2', caption: '2nd finger' },
    { id: 't3', color: 'yellow', semitones: 17, finger: '3', caption: '3rd finger' },
  ],
};

export const DEFAULT_TAPE_SETS: TapeSet[] = [FIRST_POSITION_TAPES, THUMB_POSITION_TAPES];

// ─── Derived views ───────────────────────────────────────────────────────────

export interface TapeGeometry extends Tape {
  setId: TapeSet['id'];
  mm: number;
}

/** Flattens the sets into one nut-to-bridge ordered list with millimetres attached. */
export function tapeGeometry(sets: readonly TapeSet[]): TapeGeometry[] {
  return sets
    .flatMap((set) => set.tapes.map((t) => ({ ...t, setId: set.id, mm: stopDistanceMm(t.semitones) })))
    .sort((a, b) => a.mm - b.mm);
}

export interface TapeNote {
  string: CelloString;
  midi: number;
  name: string;
}

/**
 * What a tape gives you on each of the four strings — the table the tutorial
 * prints, and the reason two identical yellows are not ambiguous in practice:
 * the string tells you which one you are on.
 */
export function notesUnderTape(tape: Tape, preferFlats = false): TapeNote[] {
  return STRING_ORDER.map((string) => {
    const midi = midiAt(string, tape.semitones);
    return { string, midi, name: midiToPitchName(midi, preferFlats) };
  });
}

/** The tape a given stopped note lands on, if the player has one there. */
export function tapeForSemitones(
  sets: readonly TapeSet[], semitones: number,
): TapeGeometry | undefined {
  return tapeGeometry(sets).find((t) => t.semitones === semitones);
}

/**
 * Nearest tape below a stopped note, with the gap expressed in semitones.
 * This is what turns "no tape here" into a usable instruction: *a whole step
 * above the second green* is something a beginner can act on.
 */
export function nearestTapeBelow(
  sets: readonly TapeSet[], semitones: number,
): { tape: TapeGeometry; semitonesAbove: number } | undefined {
  const below = tapeGeometry(sets).filter((t) => t.semitones <= semitones);
  const tape = below[below.length - 1];
  return tape ? { tape, semitonesAbove: semitones - tape.semitones } : undefined;
}

/**
 * Plain-language placement instruction for a stopped note, e.g.
 * "3rd finger on the second yellow tape" or "1st finger, a semitone above the green tape".
 */
export function tapeHint(
  sets: readonly TapeSet[], semitones: number, finger: CelloFinger,
): string {
  if (semitones === 0) return 'open string — no left hand at all';

  const geo = tapeGeometry(sets);
  const exact = geo.find((t) => t.semitones === semitones);

  // Ordinals count within the tape's *own* set, not across both. Blue, yellow,
  // yellow, green is a hand shape the player learns as a unit; calling the
  // thumb-position blue "the second blue" would be technically true and
  // useless at the point of playing.
  const ordinalOf = (t: TapeGeometry) => {
    const set = sets.find((s) => s.id === t.setId);
    const sameColor = (set?.tapes ?? []).filter((g) => g.color === t.color);
    if (sameColor.length < 2) return `the ${t.color} tape`;
    const nth = sameColor.findIndex((g) => g.id === t.id) + 1;
    const word = ['first', 'second', 'third', 'fourth'][nth - 1] ?? `${nth}th`;
    return `the ${word} ${t.color} tape`;
  };

  if (exact) {
    const finger_ = finger === 'T' ? 'thumb' : `${finger} finger`;
    return `${finger_} on ${ordinalOf(exact)}`;
  }

  const near = nearestTapeBelow(sets, semitones);
  if (!near) return `${semitones} semitones above the nut — below every tape`;
  const gap = near.semitonesAbove;
  const distance = gap === 1 ? 'a semitone above' : gap === 2 ? 'a whole step above' : `${gap} semitones above`;
  const finger_ = finger === 'T' ? 'thumb' : `${finger} finger`;
  return `${finger_}, ${distance} ${ordinalOf(near.tape)}`;
}
