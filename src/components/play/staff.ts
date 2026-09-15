/**
 * Where a spelled pitch sits on the bass stave.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

/** Diatonic index of the bass clef's bottom line, G2. */
const BASS_BOTTOM_LINE = 18;
const LETTER_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * Vertical position of a pitch on the stave, counted in half-spaces above the
 * bottom line. Derived from the note's *spelling*, not its MIDI number: F#3
 * and Gb3 sound the same and sit on different lines.
 */
export function staffStep(pitchName: string): { step: number; accidental: string | null } {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(pitchName);
  if (!match) return { step: 0, accidental: null };
  const [, letter, accidental, octave] = match;
  const diatonic = Number(octave) * 7 + LETTER_STEP[letter];
  return {
    step: diatonic - BASS_BOTTOM_LINE,
    accidental: accidental === '#' ? '♯' : accidental === 'b' ? '♭' : null,
  };
}
