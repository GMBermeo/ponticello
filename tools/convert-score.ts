/**
 * MIDI → cello score converter.
 *
 *   npm run convert -- <input.mid> --title "Piece" --composer "Someone" [options]
 *
 * Reads a MIDI file, arranges a low cello line for the requested difficulty,
 * assigns first-position strings and fingers, and
 * writes a `CelloSongScore` module ready to drop into `src/scores/`.
 *
 * Deliberately an offline build step rather than something the app does at
 * runtime: fingering is an editorial decision that deserves a human read
 * before anyone practises from it, and the solve is far cheaper to do once.
 *
 * Only convert music you have the right to convert. The bundled library ships
 * original studies and public-domain works for exactly this reason.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  midiToFrequency, midiToPitchName,
} from '../src/domain/cello';
import { arrangeMidi } from '../src/domain/arrangement';
import { detectShifts, RawNoteEvent, seatLine } from '../src/domain/fingering';
import type { DifficultyTier } from '../src/domain/schema';
import {
  CelloMeasure, CelloNote, CelloSongScore, measureDurationMs, validateScore,
} from '../src/domain/schema';
import { parseMidi } from '../src/domain/midi';

interface Options {
  input: string;
  title: string;
  composer: string;
  origin: string;
  key: string;
  difficulty: DifficultyTier;
  bpm: number;
  timeSignature: [number, number];
  teaches: string;
  rights: string;
  track: number | null;
  maxBars: number | null;
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const [input] = argv.filter((a) => !a.startsWith('--'));
  if (!input) {
    console.error('usage: npm run convert -- <input.mid> --title "..." --composer "..."');
    process.exit(1);
  }

  const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const meter = flag('meter', '4/4').split('/').map(Number);

  return {
    input,
    title: flag('title', basename(input).replace(/\.mid$/i, '')),
    composer: flag('composer', 'Unknown'),
    origin: flag('origin', 'CONVERTED'),
    key: flag('key', 'C MAJOR'),
    difficulty: flag('difficulty', 'Intermediate') as Options['difficulty'],
    bpm: Number(flag('bpm', '80')),
    timeSignature: [meter[0] || 4, meter[1] || 4],
    teaches: flag('teaches', 'Converted from MIDI. Check the fingerings before practising them.'),
    rights: flag('rights', 'UNVERIFIED — confirm you have the right to use this before shipping it.'),
    track: argv.includes('--track') ? Number(flag('track', '0')) : null,
    maxBars: argv.includes('--max-bars') ? Number(flag('max-bars', '0')) : null,
    out: argv.includes('--out') ? flag('out', '') : null,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const bytes = new Uint8Array(readFileSync(options.input));
  const parsed = parseMidi(bytes);
  if (parsed.notes.length === 0) throw new Error('no notes found in that MIDI file');

  const timeScale = parsed.bpm > 0 ? parsed.bpm / options.bpm : 1;
  const retimed = {
    ...parsed,
    bpm: options.bpm,
    timeSignature: options.timeSignature,
    durationMs: parsed.durationMs * timeScale,
    notes: parsed.notes.map((note) => ({
      ...note,
      startTimeMs: note.startTimeMs * timeScale,
      durationMs: note.durationMs * timeScale,
    })),
  };
  const arranged = arrangeMidi(retimed, {
    level: options.difficulty,
    sourceTrack: options.track ?? undefined,
  });
  if (arranged.notes.length === 0) {
    throw new Error(options.track === null
      ? 'no melodic/riff track or harmonic root guide could be arranged'
      : `track ${options.track} has no notes`);
  }

  const barDurationMs = measureDurationMs(options.timeSignature, options.bpm);
  const events: RawNoteEvent[] = arranged.notes.map((note) => ({
    midiNumber: note.midiNumber,
    startTimeMs: note.startTimeMs,
    durationMs: note.durationMs,
  }));

  const limitMs = options.maxBars === null ? Infinity : options.maxBars * barDurationMs;
  const kept = events
    .filter((event) => event.startTimeMs < limitMs)
    .map((event) => ({
      ...event,
      durationMs: Math.max(1, Math.min(event.durationMs, limitMs - event.startTimeMs)),
    }));

  console.log(
    `  source ${arranged.sourceKind}${arranged.sourceTrack === null ? '' : ` track ${arranged.sourceTrack}`}: `
      + `${arranged.originalNoteCount} notes, ${kept.length} kept at ${options.difficulty}`,
  );

  if (kept.length === 0) throw new Error('the requested bar window contains no arranged notes');

  const states = seatLine(kept);
  const shifts = detectShifts(kept, states);
  console.log(`  first-position fingering: ${shifts.length} half-position changes`);

  const totalMs = Math.max(...kept.map((e) => e.startTimeMs + e.durationMs));
  const barCount = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barDurationMs,
    durationMs: barDurationMs,
    timeSignature: options.timeSignature,
    tempoBpm: options.bpm,
  }));

  const id = basename(options.input).replace(/\.mid$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const notes: CelloNote[] = kept.map((event, i) => {
    const state = states[i];
    const measureIndex = Math.min(barCount - 1, Math.floor(event.startTimeMs / barDurationMs));
    return {
      id: `${id}-${i + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      // Never let a note spill past the final bar line; the schema rejects it.
      durationMs: Math.max(1, Math.min(event.durationMs, barCount * barDurationMs - event.startTimeMs)),
      pitchName: midiToPitchName(event.midiNumber),
      midiNumber: event.midiNumber,
      frequency: Math.round(midiToFrequency(event.midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: 'arco',
      tie: false,
      measureIndex,
      // Alternating bows are a starting point, not an edition.
      bowDirection: i % 2 === 0 ? 'down' : 'up',
    };
  });

  const score: CelloSongScore = {
    schemaVersion: '1.0.0',
    id,
    metadata: {
      title: options.title,
      composer: options.composer,
      origin: options.origin,
      keySignature: options.key,
      timeSignature: options.timeSignature.join('/'),
      bpm: options.bpm,
      difficulty: options.difficulty,
      tonic: options.key.trim()[0] ?? 'C',
      teaches: options.teaches,
      rights: options.rights,
    },
    measures,
    notes,
  };

  const problems = validateScore(score);
  if (problems.length > 0) {
    console.error('  score failed validation:');
    for (const problem of problems.slice(0, 10)) {
      console.error(`    ${problem.path}: ${problem.message}`);
    }
    process.exit(1);
  }

  const positions = new Set(notes.map((n) => n.position));
  console.log(`  positions used: ${[...positions].join(', ')}`);
  console.log(`  ${barCount} bars, range ${notes[0].pitchName}…`);

  const outPath = options.out ?? `src/scores/${id}.ts`;
  const module = `/**
 * ${options.title} — ${options.composer}
 *
 * Generated by tools/convert-score.ts from ${basename(options.input)}.
 * Uses low first-position fingerings. Read the musical reduction through
 * before practising, and edit freely.
 *
 * Rights: ${options.rights}
 */

import { CelloSongScore } from '@/domain/schema';

export const SCORE: CelloSongScore = ${JSON.stringify(score, null, 2)};
`;

  writeFileSync(outPath, module);
  console.log(`  wrote ${outPath}`);
  console.log(`  add it to the SCORES array in src/scores/index.ts to see it in the library.`);
}

main();
