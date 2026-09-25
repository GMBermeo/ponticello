import { chroma, transpose } from '@tonaljs/note';
import { CELLO_CHORD_LIBRARY, CELLO_CHORD_ROOTS, CELLO_CHORD_TYPES } from './celloChords';
import type { CelloChordType } from './chords';

export const CHORD_SCALES = [
  { id: 'all', label: 'All scales', intervals: [] },
  { id: 'major', label: 'Major', intervals: ['1P', '2M', '3M', '4P', '5P', '6M', '7M'] },
  { id: 'minor', label: 'Natural minor', intervals: ['1P', '2M', '3m', '4P', '5P', '6m', '7m'] },
  { id: 'harmonic', label: 'Harmonic minor', intervals: ['1P', '2M', '3m', '4P', '5P', '6m', '7M'] },
  { id: 'melodic', label: 'Melodic minor ↑', intervals: ['1P', '2M', '3m', '4P', '5P', '6M', '7M'] },
  { id: 'dorian', label: 'Dorian', intervals: ['1P', '2M', '3m', '4P', '5P', '6M', '7m'] },
  { id: 'mixolydian', label: 'Mixolydian', intervals: ['1P', '2M', '3M', '4P', '5P', '6M', '7m'] },
  { id: 'lydian', label: 'Lydian', intervals: ['1P', '2M', '3M', '4A', '5P', '6M', '7M'] },
] as const;
export type ChordScaleId = typeof CHORD_SCALES[number]['id'];
export type ChordFamily = 'all' | 'triads' | 'sevenths' | 'extensions';
export interface ScaleChord { id: string; root: string; type: CelloChordType; degree: number; romanDegree: string | null; shapes: number }

/** Degree relative to the selected mode; case conveys third quality. */
function romanDegree(type: CelloChordType, degree: number): string {
  const numeral = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][degree]!;
  const minor = type.intervals.includes('3m') && !type.intervals.includes('3M');
  let suffix = type.id;
  if (suffix === 'm7b5') suffix = 'ø7';
  else if (suffix.startsWith('dim')) suffix = suffix.replace('dim', '°');
  else if (suffix.startsWith('o')) suffix = suffix.replace(/^o/, '°');
  else if (suffix === 'aug') suffix = '+';
  else if (minor) suffix = suffix.replace(/^m/, '').replace(/^\/ma/, 'maj');
  suffix = suffix.replace(/Maj/g, 'maj').replace(/M(?=7|9|13)/g, 'maj').replace(/^M/, '').replace(/^maj(?=[#b])/, '');
  return `${minor ? numeral.toLowerCase() : numeral}${suffix}`;
}

export function scaleNotes(root: string, scale: ChordScaleId): string[] {
  const definition = CHORD_SCALES.find((s) => s.id === scale);
  if (!definition || chroma(root) === undefined) throw new Error('Invalid scale');
  return definition.intervals.map((interval) => transpose(root, interval));
}

/** Full chord membership, including extensions; never use a reduced grip to filter. */
export function chordsInScale(root: string, scale: ChordScaleId, family: ChordFamily = 'all', sort: 'basic' | 'degree' = 'basic', gripsOnly = false): ScaleChord[] {
  const notes = scaleNotes(root, scale);
  const pitches = notes.map((note) => chroma(note)!);
  const types = new Map(CELLO_CHORD_TYPES.map((type) => [type.id, type]));
  const rank = (type: CelloChordType) => {
    const basics = ['', 'm', 'dim', 'aug', 'sus2', 'sus4', '5'];
    const basic = basics.indexOf(type.id);
    if (basic >= 0) return basic;
    const common = ['1P 3M 5P 7M', '1P 3M 5P 7m', '1P 3m 5P 7m',
      '1P 3m 5d 7m', '1P 3m 5d 7d', '1P 3M 5P 6M', '1P 3m 5P 6M',
      '1P 3M 5P 9M', '1P 3m 5P 9M'];
    const commonIndex = common.indexOf(type.intervals.join(' '));
    return commonIndex >= 0 ? 10 + commonIndex : 30 + type.semitones.length;
  };
  return Object.values(CELLO_CHORD_LIBRARY).flatMap((entry) => {
    const type = types.get(entry.typeId);
    if (!type) return [];
    const pcs = type.semitones.map((n) => (entry.rootPitchClass + n) % 12);
    if (scale !== 'all' && !pcs.every((n) => pitches.includes(n))) return [];
    if (gripsOnly && !entry.shapes.length) return [];
    if (family === 'triads' && type.intervals.length !== 3) return [];
    if (family === 'sevenths' && !(type.intervals.length === 4 && type.intervals.some((i) => i.startsWith('7')))) return [];
    if (family === 'extensions' && !type.semitones.some((n) => n > 12)) return [];
    const degree = scale === 'all' ? entry.rootPitchClass : pitches.indexOf(entry.rootPitchClass);
    return [{ id: entry.id, root: notes[degree] ?? CELLO_CHORD_ROOTS[entry.rootPitchClass]!, type, degree,
      romanDegree: scale === 'all' ? null : romanDegree(type, degree), shapes: entry.shapes.length }];
  }).sort((a, b) => (sort === 'basic' ? rank(a.type) - rank(b.type) || a.degree - b.degree
    : a.degree - b.degree || rank(a.type) - rank(b.type)) || a.type.id.localeCompare(b.type.id));
}
