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

const TAPE_GAP_WORDS: Readonly<Record<number, string>> = { 1: 'a semitone above', 2: 'a whole step above' };

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
  id: string;
  name: string;
  /** Where the hand sits when these tapes are in play. */
  blurb: string;
  tapes: Tape[];
}

/**
 * Bumped whenever the shipped default layout changes shape.
 *
 * Stored tapes from an older layout are dropped rather than merged: a set that
 * was four tapes long and is now nine cannot be reconciled field by field, and
 * silently keeping half of each is worse than starting from the new default.
 */
export const TAPE_LAYOUT_VERSION = 2;

/**
 * The default tapes: nine of them, from the whole step above the nut down to
 * the minor seventh, with nothing in half position.
 *
 *     2 blue · 3 green · 4 yellow · 5 red · 6 green · 7 blue · 8 yellow
 *     · 9 green · 10 yellow
 *
 * The first four are the closed first-position hand frame — one semitone per
 * finger, first finger to little finger spanning a minor third. Above them the
 * tapes carry on past the third position and up to the neck heel, which is the
 * seventh (7 semitones): the point where you can feel the body of the cello
 * and find your place without looking.
 *
 * There is deliberately no thumb-position set any more. The thumb frame sits
 * at the octave harmonic, half the string away, and drawing it alongside these
 * made the useful half of every diagram a third of its height.
 */
export const FINGERBOARD_TAPES: TapeSet = {
  id: 'board',
  name: 'My tapes',
  blurb: 'Nine tapes from the first position down to the neck heel. No half position: the first tape is the whole step above the nut, where the first finger lives.',
  tapes: [
    { id: 't2', color: 'blue', semitones: 2, finger: '1', caption: '1st position · 1st finger' },
    { id: 't3', color: 'green', semitones: 3, finger: '2', caption: '1st position · 2nd finger' },
    { id: 't4', color: 'yellow', semitones: 4, finger: '3', caption: '1st position · 3rd finger' },
    { id: 't5', color: 'red', semitones: 5, finger: '4', caption: '1st position · 4th finger' },
    { id: 't6', color: 'green', semitones: 6, finger: '2', caption: '3rd position · 2nd finger' },
    { id: 't7', color: 'blue', semitones: 7, finger: '1', caption: '4th position · 1st finger' },
    { id: 't8', color: 'yellow', semitones: 8, finger: '2', caption: '4th position · 2nd finger' },
    { id: 't9', color: 'green', semitones: 9, finger: '3', caption: '4th position · 3rd finger' },
    { id: 't10', color: 'yellow', semitones: 10, finger: '4', caption: '4th position · 4th finger' },
  ],
};

export const DEFAULT_TAPE_SETS: TapeSet[] = [FINGERBOARD_TAPES];

/**
 * True when a stored set of tapes still matches the shipped layout's shape.
 * Colours and millimetres are the player's to change; the *number* of tapes
 * and the number of sets are what a layout change invalidates.
 */
export function isCurrentTapeLayout(sets: readonly TapeSet[] | undefined): boolean {
  if (!Array.isArray(sets) || sets.length !== DEFAULT_TAPE_SETS.length) return false;
  return sets.every((set, i) => Array.isArray(set?.tapes)
    && set.tapes.length === (DEFAULT_TAPE_SETS[i]?.tapes.length ?? -1));
}

// ─── Derived views ───────────────────────────────────────────────────────────

export interface TapeGeometry extends Tape {
  setId: string;
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

  // Ordinals count within the tape's *own* set. With nine tapes the colours
  // repeat, so "the second green" is the only way to name one out loud — and
  // the string finishes the job of naming the note.
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
  const distance = TAPE_GAP_WORDS[gap] ?? `${gap} semitones above`;
  const finger_ = finger === 'T' ? 'thumb' : `${finger} finger`;
  return `${finger_}, ${distance} ${ordinalOf(near.tape)}`;
}
