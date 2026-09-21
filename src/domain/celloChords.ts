/** Pure chord data + cello placements. See docs/cello-chords.md for scope/sources. */
import * as Note from '@tonaljs/note';
import * as Interval from '@tonaljs/interval';
import { OPEN_STRING_MIDI, STRING_ORDER } from './cello';
import rawCatalog from './chords/catalog.generated.json';
import { CHORD_FRAMES, findCelloChordShapes } from './chords/shapeSearch';
import type {
  CelloChordCatalog, CelloChordEntry, CelloChordShape, CelloChordStudy, CelloChordType,
  ChordFinger, ChordPlacement, ChordTone, ChordVoicing,
} from './chords/types';
export type * from './chords/types';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// JSON tuples widen to arrays on import. Generator + exhaustive tests validate
// the serialized boundary; readonly types and freezing protect callers.
const catalog = deepFreeze(rawCatalog as unknown as CelloChordCatalog);
export const CELLO_CHORD_TYPES = catalog.types;
export const CELLO_CHORD_LIBRARY: Readonly<Record<string, CelloChordEntry>> = Object.freeze(
  Object.fromEntries(catalog.entries.map((entry) => [entry.id, entry])),
);
export const CELLO_CHORD_ROOTS = Object.freeze(['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);

const typesByAlias = new Map(CELLO_CHORD_TYPES.flatMap((type) =>
  [...new Set([type.id, type.name, ...type.aliases])].map((alias) => [alias, type] as const)));
const pc = (n: number) => ((n % 12) + 12) % 12;

function normalize(text: string): string {
  return text.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/º/g, '°');
}

function pitchClassName(text: string): string {
  const name = normalize(text);
  if (!/^[A-Ga-g][#b]{0,2}$/.test(name)) throw new Error(`Invalid pitch class: ${text}`);
  return name[0]!.toUpperCase() + name.slice(1);
}

/** Normalizes common chart parentheses without treating unknown chords as major. */
function normalizeSuffix(suffix: string): string {
  const plain = suffix.replace(/[()\s]/g, '');
  const aliases: Record<string, string> = {
    m79: 'm9', 'm7/9': 'm9', '79': '9', '7/9': '9',
    '911': '11', '9/11': '11', maj79: 'maj9', M79: 'maj9',
    'ø7': 'm7b5', 'Δ7': 'maj7',
  };
  return aliases[plain] ?? plain;
}

function chordTones(root: string, type: CelloChordType): readonly ChordTone[] {
  const rootPc = Note.chroma(root);
  if (rootPc === undefined) throw new Error(`Invalid root: ${root}`);
  return type.intervals.map((interval, i) => {
    const semitones = type.semitones[i];
    if (semitones === undefined) throw new Error(`Missing interval in ${type.id}`);
    return {
      interval, semitones, pitchClass: pc(rootPc + semitones),
      name: Note.transpose(root, interval), isRoot: pc(semitones) === 0,
    };
  });
}

function placement(
  string: ChordPlacement['string'], stop: number, finger: ChordFinger,
  anchor: number, frame: CelloChordShape['frame'], tone: ChordTone,
): ChordPlacement {
  return {
    string, semitones: stop, midi: OPEN_STRING_MIDI[string] + stop, finger,
    anchor, frame, tone, marker: tone.isRoot ? 'square' : 'circle',
  };
}

function expandShape(shape: CelloChordShape, tones: readonly ChordTone[]): ChordVoicing {
  const notes = STRING_ORDER.flatMap((string, i) => {
    const stop = shape.stops[i];
    const finger = shape.fingers[i];
    if (stop === null || stop === undefined || !finger) return [];
    const tone = tones.find((t) => t.pitchClass === pc(OPEN_STRING_MIDI[string] + stop));
    if (!tone) throw new Error('Shape contains a non-chord tone');
    return [placement(string, stop, finger, shape.anchor, shape.frame, tone)];
  });
  const bass = notes.reduce((a, b) => a.midi < b.midi ? a : b).tone;
  const stopped = notes.filter((note) => note.finger !== '0');
  const flattened = new Set(stopped.map((n) => n.finger)).size < stopped.length;
  const omittedTones = tones.filter((tone) => shape.omittedIntervals.includes(tone.interval));
  return {
    id: shape.stops.map((n) => n === null ? 'x' : n).join('-'), notes,
    unusedStrings: STRING_ORDER.filter((s) => !notes.some((n) => n.string === s)),
    bass, inversion: tones.findIndex((tone) => tone.pitchClass === bass.pitchClass),
    technique: notes.length === 2 ? 'double-stop' : 'rolled-chord',
    completeness: omittedTones.length ? 'reduced' : 'complete', omittedTones,
    difficulty: stopped.length >= 3 || flattened || shape.frame === 'extended' ? 'advanced'
      : shape.anchor > 2 || stopped.length > 1 ? 'intermediate' : 'basic',
    review: 'generated-needs-cellist-review',
  };
}

/** One-note fingering; no claim that successive seats can be held together. */
function arpeggioPlacement(midi: number, tone: ChordTone): ChordPlacement {
  const choices: ChordPlacement[] = [];
  for (const string of STRING_ORDER) {
    const stop = midi - OPEN_STRING_MIDI[string];
    if (stop === 0) choices.push(placement(string, 0, '0', 1, 'closed', tone));
    for (let anchor = 1; anchor <= 7; anchor++) {
      for (const frame of ['closed', 'extended'] as const) {
        CHORD_FRAMES[frame].forEach((offset, i) => {
          if (stop === anchor + offset) choices.push(placement(string, stop, String(i + 1) as ChordFinger, anchor, frame, tone));
        });
      }
    }
  }
  choices.sort((a, b) =>
    (a.semitones + (a.frame === 'extended' ? 4 : 0)) - (b.semitones + (b.frame === 'extended' ? 4 : 0))
    || Math.abs(a.anchor - 2) - Math.abs(b.anchor - 2));
  const choice = choices[0];
  if (!choice) throw new Error(`Arpeggio note ${midi} exceeds this catalogue's neck-position range`);
  return choice;
}

function study(root: string, type: CelloChordType, bassName: string | null, shapes: readonly CelloChordShape[]): CelloChordStudy {
  const tones = chordTones(root, type);
  const rootPc = Note.chroma(root)!;
  const bassPc = bassName === null ? undefined : Note.chroma(bassName);
  const bassTone = bassPc === undefined ? undefined : tones.find((t) => t.pitchClass === bassPc);
  const voicings = shapes.map((shape) => expandShape(shape, tones))
    .filter((v) => bassPc === undefined || v.bass.pitchClass === bassPc);
  let arpeggio = tones.map((tone) => arpeggioPlacement(36 + rootPc + tone.semitones, tone));
  if (bassPc !== undefined) {
    // A slash bass may be outside the chord. Preserve it as a separate tone;
    // never relabel it as the root or silently substitute root-position shapes.
    const bassMidi = 36 + bassPc;
    const slashTone: ChordTone = bassTone ?? {
      interval: Interval.distance(root, bassName!), semitones: pc(bassPc - rootPc),
      pitchClass: bassPc, name: bassName!, isRoot: bassPc === rootPc,
    };
    const ascending = tones.map((tone) => {
      let midi = 36 + rootPc + tone.semitones;
      while (midi < bassMidi) midi += 12;
      return arpeggioPlacement(midi, tone);
    }).sort((a, b) => a.midi - b.midi);
    arpeggio = [arpeggioPlacement(bassMidi, slashTone), ...ascending.filter((n) => n.midi !== bassMidi)];
  }
  return deepFreeze({
    symbol: `${root}${type.id}${bassName ? `/${bassName}` : ''}`, root, type, tones,
    requestedBass: bassName, voicings, arpeggio,
    status: voicings.length ? 'shapes-available' : 'arpeggio-only',
  });
}

/** Lookup by spelled root and dictionary id/alias. Keeps flats and double flats. */
export function getCelloChordByType(rootName: string, typeName: string, bass?: string): CelloChordStudy {
  const root = pitchClassName(rootName);
  const type = typesByAlias.get(typeName);
  if (!type) throw new Error(`Unknown chord type: ${typeName}`);
  const entry = CELLO_CHORD_LIBRARY[`${Note.chroma(root)}:${type.id}`];
  if (!entry) throw new Error(`Missing chord catalogue entry: ${root}${type.id}`);
  return study(root, type, bass === undefined ? null : pitchClassName(bass), entry.shapes);
}

/** Absolute chord symbols. Roman numerals require a key and must be resolved first. */
export function getCelloChord(symbol: string): CelloChordStudy {
  const match = /^([A-Ga-g][#b]{0,2})(.*)$/.exec(normalize(symbol));
  if (!match?.[1] || match[2] === undefined) throw new Error(`Invalid chord symbol: ${symbol}`);
  const root = match[1];
  let suffix = match[2].trim();
  let bass: string | undefined;
  const slash = /\/([A-Ga-g][#b]{0,2})$/.exec(suffix);
  if (slash?.[1]) {
    bass = slash[1];
    suffix = suffix.slice(0, slash.index);
  }
  const type = typesByAlias.get(suffix) ?? typesByAlias.get(normalizeSuffix(suffix));
  if (!type) throw new Error(`Unknown chord type in: ${symbol}`);
  return getCelloChordByType(root, type.id, bass);
}

/** Any root-containing 12-tone chord set; 1P required, intervals up to 13M.
 * No tones are optional in custom formulas. Dense sets get a full arpeggio.
 */
export function createCelloChord(rootName: string, intervals: readonly string[]): CelloChordStudy {
  const root = pitchClassName(rootName);
  if (!intervals.includes('1P') || intervals.length < 2 || intervals.length > 12) {
    throw new Error('Custom chords need 1P and 2–12 distinct pitch classes');
  }
  const parsed = intervals.map((interval) => {
    const value = Interval.get(interval);
    if (value.empty || value.semitones < 0 || value.semitones > 21) {
      throw new Error(`Invalid custom interval: ${interval}`);
    }
    return { interval: value.name, semitones: value.semitones };
  }).sort((a, b) => a.semitones - b.semitones);
  if (new Set(parsed.map((p) => pc(p.semitones))).size !== parsed.length) {
    throw new Error('Custom intervals must have distinct pitch classes');
  }
  const type: CelloChordType = {
    id: `(${parsed.map((p) => p.interval).join(',')})`, name: 'Custom chord', aliases: [],
    intervals: parsed.map((p) => p.interval), semitones: parsed.map((p) => p.semitones), optionalIntervals: [],
  };
  return study(root, type, null, findCelloChordShapes(type, Note.chroma(root)!));
}
