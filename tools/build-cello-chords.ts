import { all } from '@tonaljs/chord-type';
import { semitones } from '@tonaljs/interval';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OPEN_STRING_MIDI, STRING_ORDER, findCelloChordShapes, MAX_CHORD_ANCHOR, type CelloChordCatalog,
  type CelloChordType, type FourStrings,
} from '@domain';

const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Tonal's default 11/13 definitions omit common voicing tones. Store complete
// tertian formulas here; only a particular shape may omit a tone, explicitly.
const completeExtensions: Record<string, readonly string[]> = {
  '11': ['1P', '3M', '5P', '7m', '9M', '11P'],
  '13': ['1P', '3M', '5P', '7m', '9M', '11P', '13M'],
  maj13: ['1P', '3M', '5P', '7M', '9M', '11P', '13M'],
  m13: ['1P', '3m', '5P', '7m', '9M', '11P', '13M'],
};
/** Aliases to prefer when a type has them: the bare major triad, and the unambiguous 7b9sus4. */
const PREFERRED_ALIASES = ['', '7b9sus4'];

const types: CelloChordType[] = all().map((type) => {
  // A type starting with b is ambiguous when concatenated with a root: Cb9sus
  // means C-flat 9sus, not C with a flat ninth. Prefer an unambiguous alias.
  const id = PREFERRED_ALIASES.find((alias) => type.aliases.includes(alias)) ?? type.aliases[0]!;
  const intervals = completeExtensions[id] ?? type.intervals;
  const steps = intervals.map((interval) => {
    const n = semitones(interval);
    if (n === undefined) throw new Error(`Invalid interval: ${interval}`);
    return n;
  });
  // A stated reduction policy, not a claim that there is one canonical jazz voicing.
  // Keep root, thirds/suspensions, sevenths, alterations and highest extension.
  const highest = Math.max(...steps);
  const optionalIntervals = intervals.filter((interval, i) =>
    intervals.length > 4 && (interval === '5P'
      || (['9M', '11P', '13M'].includes(interval) && steps[i]! < highest)));
  return {
    id, name: type.name || id, aliases: type.aliases,
    intervals, semitones: steps, optionalIntervals,
  };
});

const catalog: CelloChordCatalog = {
  version: 1,
  tuning: STRING_ORDER.map((s) => OPEN_STRING_MIDI[s]) as unknown as FourStrings<number>,
  maxAnchor: MAX_CHORD_ANCHOR,
  types,
  entries: types.flatMap((type) => roots.map((root, rootPitchClass) => ({
    id: `${rootPitchClass}:${type.id}`, typeId: type.id, rootPitchClass,
    symbol: `${root}${type.id}`, shapes: findCelloChordShapes(type, rootPitchClass),
  }))),
};

const output = resolve('src/domain/chords/catalog.generated.json');
// One entry per line: compact on disk, still reviewable in git.
const { entries, ...metadata } = catalog;
const json = `${JSON.stringify(metadata).slice(0, -1)},"entries":[\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== json) throw new Error('Chord catalogue is stale. Run npm run build:chords.');
} else writeFileSync(output, json);
console.log(`Cello chords: ${types.length} types, ${entries.length} entries, ${entries.reduce((n, e) => n + e.shapes.length, 0)} shapes; ${entries.filter((e) => e.shapes.length === 0).length} arpeggio-only. ${json.length} bytes.`);
