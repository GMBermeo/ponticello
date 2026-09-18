/**
 * One colour per note name — the constant the whole app colours by.
 *
 * Printed fingerboard charts colour-code the letter, not the string: every C
 * is the same colour wherever it is played, so a beginner reading a chart, a
 * score and their own fingerboard sees one system rather than three. This file
 * *is* that system, and everything visual that wants "the colour of a note"
 * asks here rather than inventing one.
 *
 * Four of the seven are fixed by the instrument, because the open strings are
 * the notes a cellist learns first and they carry their colour onto the string
 * rails: C green, G red, D blue, A yellow. The remaining three — B, E, F — were
 * chosen to sit in the widest gaps left in the hue circle by those four, so
 * that no two letters that are *next to each other* in the alphabet are next
 * to each other in hue:
 *
 *     C green · D blue · E orange · F cyan · G red · A yellow · B purple
 *
 * Sharps and flats take both neighbours, drawn as a split disc exactly as the
 * printed charts do: C♯/D♭ is half green, half blue. That is not decoration —
 * it is the reason a beginner can read an accidental off a chart at all.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { CelloString } from './cello';

export type NoteLetter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export type NoteColorName =
  | 'green' | 'blue' | 'orange' | 'cyan' | 'red' | 'yellow' | 'purple';

/** Letters in scale order, which is the order every legend prints them in. */
export const NOTE_LETTERS: readonly NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** The constant. Everything colour-coded by note reads this map. */
export const NOTE_COLOR: Record<NoteLetter, NoteColorName> = {
  C: 'green',
  D: 'blue',
  E: 'orange',
  F: 'cyan',
  G: 'red',
  A: 'yellow',
  B: 'purple',
};

/** Human-readable names, for legends and accessibility labels. */
export const NOTE_COLOR_LABEL: Record<NoteColorName, string> = {
  green: 'Green',
  blue: 'Blue',
  orange: 'Orange',
  cyan: 'Cyan',
  red: 'Red',
  yellow: 'Yellow',
  purple: 'Purple',
};

/** Pitch class of each natural. */
export const LETTER_PITCH_CLASS: Record<NoteLetter, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * The letter, or the two letters, a pitch class belongs to.
 *
 * A natural gives one; a black key gives the pair it sits between, low letter
 * first — which is also sharp-spelling first, flat-spelling second.
 */
const PITCH_CLASS_LETTERS: Record<number, readonly NoteLetter[]> = {
  0: ['C'],
  1: ['C', 'D'],
  2: ['D'],
  3: ['D', 'E'],
  4: ['E'],
  5: ['F'],
  6: ['F', 'G'],
  7: ['G'],
  8: ['G', 'A'],
  9: ['A'],
  10: ['A', 'B'],
  11: ['B'],
};

export function lettersForPitchClass(pitchClass: number): readonly NoteLetter[] {
  return PITCH_CLASS_LETTERS[((pitchClass % 12) + 12) % 12] ?? ['C'];
}

/**
 * Colour names for a pitch class: one for a natural, two for an accidental.
 * Callers that can only draw one colour take the first.
 */
export function noteColorNames(pitchClass: number): NoteColorName[] {
  return lettersForPitchClass(pitchClass).map((letter) => NOTE_COLOR[letter]);
}

/** True when the pitch class is a black key, i.e. wants a split disc. */
export function isAccidental(pitchClass: number): boolean {
  return lettersForPitchClass(pitchClass).length === 2;
}

/**
 * The colour of a string, which is simply the colour of its open note.
 * C green, G red, D blue, A yellow — the string rails and the note dots agree
 * because they are reading the same constant.
 */
export const STRING_NOTE_COLOR: Record<CelloString, NoteColorName> = {
  C: NOTE_COLOR.C,
  G: NOTE_COLOR.G,
  D: NOTE_COLOR.D,
  A: NOTE_COLOR.A,
};

/** Resolves a palette entry for a MIDI note; the first colour when it splits. */
export function noteColorName(midiNumber: number): NoteColorName {
  const [primary] = noteColorNames(midiNumber);
  return primary ?? NOTE_COLOR.C;
}
