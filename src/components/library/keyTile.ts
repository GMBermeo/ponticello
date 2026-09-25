import type { NoteLetter } from '@domain';

export type KeyTile = {
  /** The tonic's letter, which picks the tile's note colour. */
  letter: NoteLetter;
  /** What the tile says: the tonic with its accidental, lower case for minor. */
  label: string;
};

const LETTERS = new Set<string>(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
const ACCIDENTAL: Record<string, string> = { '♯': '♯', '#': '♯', '♭': '♭', b: '♭' };

/**
 * The leading tile on a library row: a piece's tonic, coloured as that note is
 * coloured everywhere else in the app. `null` for rows with no single key —
 * the progression builder is "Any key".
 */
export function keyTile(keySignature: string): KeyTile | null {
  // A tonic is a capital letter and an optional accidental, then the mode or
  // nothing — so "Any key" is not read as A.
  const match = /^\s*([A-G])([♯#♭b]?)(m\b|\s+\S+|\s*$)/.exec(keySignature);
  if (!match) return null;
  const letter = match[1];
  if (!LETTERS.has(letter)) return null;
  const accidental = match[2] ? ACCIDENTAL[match[2]] : '';
  const minor = /^(minor|min|m)$/i.test(match[3].trim());
  const tonic = `${letter}${accidental}`;
  return { letter: letter as NoteLetter, label: minor ? tonic.toLowerCase() : tonic };
}
