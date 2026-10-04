import { chroma } from '@tonaljs/note';
import { CELLO_CHORD_TYPES } from './celloChords';
import { toPitchClass } from './cello';

/**
 * Chord charts written in Cifra Club's dialect spell chords in ways the chord
 * dictionary does not: `7M` for a major seventh, `º` for a diminished chord,
 * `7(9-)` for a flat nine, `7(4)` for a suspended fourth. Two independent
 * routes get from that spelling to a dictionary name; the caller accepts a
 * name only when the sheet's own keyboard diagram agrees with it.
 */

const SYMBOL_PARTS = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/;

export interface ChordSymbolParts { root: string; suffix: string; bass: string | null }

export function splitChordSymbol(symbol: string): ChordSymbolParts | null {
  const match = SYMBOL_PARTS.exec(symbol.trim());
  if (!match?.[1]) return null;
  return { root: match[1], suffix: match[2] ?? '', bass: match[3] ?? null };
}

const rebuild = ({ root, bass }: ChordSymbolParts, suffix: string): string =>
  bass ? `${root}${suffix}/${bass}` : `${root}${suffix}`;

type Rewrite = (suffix: string) => string;

const replacing = (pattern: RegExp, replacement: string | ((matched: string) => string)): Rewrite => (suffix) => suffix.replace(pattern, replacement as string);
const alterations: Rewrite = (suffix) => suffix.replace(
  /[/(](5|9|11|13)([-+])\)?/g,
  (_, degree: string, sign: string) => `${sign === '-' ? 'b' : '#'}${degree}`,
);

/** Applied in order; each turns one piece of the dialect into dictionary spelling. */
const SUFFIX_REWRITES: readonly Rewrite[] = [
  replacing(/[º°]/g, 'dim'),
  replacing(/^m7M/, 'mMaj7'),
  replacing(/^m7\+$/, 'mMaj7'),
  replacing(/\(4\)/, 'sus4'),
  alterations,
  replacing(/^m5-$/, 'dim'),
  replacing(/^m5\+$/, 'm#5'),
  replacing(/^5-$/, 'Mb5'),
  replacing(/^5\+$/, 'aug'),
  replacing(/^#5$/, 'aug'),
  replacing(/^m7\(11\)$/, 'm7add11'),
  replacing(/^mb5$/, 'dim'),
  replacing(/^m?6\/9$/, (match) => match.replace('6/9', '69')),
  replacing(/^\/9$/, 'add9'),
  replacing(/^mm$/, 'm'),
  replacing(/^7m$/, 'm7'),
  replacing(/^9m$/, 'm9'),
];

/** The dictionary spellings a dialect suffix may mean, most literal first. */
export function dialectSuffixes(suffix: string): string[] {
  const seen = new Set<string>([suffix]);
  let current = suffix;
  for (const rewrite of SUFFIX_REWRITES) {
    current = rewrite(current);
    seen.add(current);
  }
  // A suffix that opens with an accidental would read as part of the root ("Cb9").
  return [...seen].filter((candidate) => !/^[#b]/.test(candidate));
}

/** Whole-symbol spellings for a chart symbol, most literal first. */
export function dialectSymbols(symbol: string): string[] {
  const parts = splitChordSymbol(symbol);
  if (!parts) return [];
  return dialectSuffixes(parts.suffix).map((suffix) => rebuild(parts, suffix));
}

const semitoneSets = CELLO_CHORD_TYPES.map((type) => ({
  id: type.id,
  pitchClasses: new Set(type.semitones.map(toPitchClass)),
  /** Two names can spell one set of notes (maj7#5, M7b6); the one built on a fifth is the familiar one. */
  hasFifth: type.intervals.some((interval) => /^5/.test(interval)),
}));

const familiarFirst = (a: { hasFifth: boolean; id: string }, b: { hasFifth: boolean; id: string }): number =>
  Number(b.hasFifth) - Number(a.hasFifth) || a.id.length - b.id.length;

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((n) => b.has(n));
}

/** The simplest chord type whose tones, over `root`, are exactly these pitch classes. */
function typeWithPitchClasses(relative: ReadonlySet<number>): string | null {
  const matches = semitoneSets.filter((type) => sameSet(type.pitchClasses, relative));
  const simplest = [...matches].sort(familiarFirst)[0];
  return simplest?.id ?? null;
}

/**
 * Names a chord from the notes of the sheet's keyboard diagram alone, for
 * symbols whose spelling is not in the dictionary. The bass is tried as part
 * of the chord first, then as a note added under it (`D4(6/9)/B`).
 */
export function identifyByKeyboard(symbol: string, keyboardPitchClasses: readonly number[]): string | null {
  const parts = splitChordSymbol(symbol);
  const rootPc = parts ? chroma(parts.root) : undefined;
  if (!parts || rootPc === undefined || keyboardPitchClasses.length < 2) return null;
  const relative = new Set(keyboardPitchClasses.map((pc) => toPitchClass(pc - rootPc)));
  if (!relative.has(0)) return null;
  const bassPc = parts.bass ? chroma(parts.bass) : undefined;
  const withoutBass = new Set(relative);
  if (bassPc !== undefined) withoutBass.delete(toPitchClass(bassPc - rootPc));
  const typeId = typeWithPitchClasses(relative) ?? (withoutBass.has(0) ? typeWithPitchClasses(withoutBass) : null);
  return typeId === null ? null : rebuild(parts, typeId);
}

/** Most tones a simplified reading may leave out of the sheet's diagram. */
const MAX_LEFT_OUT = 2;
const MIN_TONES = 3;

/**
 * The closest dictionary chord that sits inside the sheet's keyboard diagram,
 * for extensions the dictionary has no shape for (`F#7(11)`). It keeps as many
 * of the diagram's notes as it can and needs a full triad at least, so the
 * result is a real chord the cello can play, never a bare interval.
 */
export function simplifyByKeyboard(symbol: string, keyboardPitchClasses: readonly number[]): string | null {
  const parts = splitChordSymbol(symbol);
  const rootPc = parts ? chroma(parts.root) : undefined;
  if (!parts || rootPc === undefined) return null;
  const relative = new Set(keyboardPitchClasses.map((pc) => toPitchClass(pc - rootPc)));
  const fits = semitoneSets
    .filter((type) => type.pitchClasses.size >= MIN_TONES && [...type.pitchClasses].every((pc) => relative.has(pc)))
    .filter((type) => relative.size - type.pitchClasses.size <= MAX_LEFT_OUT);
  const best = fits.sort((a, b) => b.pitchClasses.size - a.pitchClasses.size || familiarFirst(a, b))[0];
  return best ? rebuild(parts, best.id) : null;
}

/** The parts of a symbol inside parentheses, and what is left outside them. */
function splitParentheses(symbol: string): { groups: string[]; outside: string } {
  const groups: string[] = [];
  let outside = '';
  let open = -1;
  for (const [index, char] of [...symbol].entries()) {
    if (char === '(') open = index;
    else if (char === ')' && open >= 0) {
      groups.push(symbol.slice(open + 1, index));
      open = -1;
    } else if (open < 0) outside += char;
  }
  return { groups, outside };
}

/**
 * The chord without its parenthesised extension, `E7(2)` → `E7`; null when there
 * is none, or when the extension changes the fifth — `m7(5-)` is not `m7`.
 */
export function withoutExtension(symbol: string): string | null {
  const { groups, outside } = splitParentheses(symbol);
  if (groups.length === 0 || outside === '') return null;
  return groups.some((group) => /5[-+b#]/.test(group)) ? null : outside;
}
