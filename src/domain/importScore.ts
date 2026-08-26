/**
 * Turning an imported MIDI file into something playable.
 *
 * The offline converter in `tools/` does this at build time for scores that
 * ship with the app. The same thing has to happen on the device when a player
 * imports their own file, and it is the same code: reduce the chosen track to
 * a single line, solve the fingering, and build a score. Everything else in
 * the file becomes the backing track.
 *
 * The result is a piece you can read in all three visions *and* play along to,
 * from a file the app never had to ship.
 */

import { BackingTrack, backingFromMidi, soloTrackScore } from './backing';
import { midiToFrequency, midiToPitchName, OPEN_STRING_MIDI } from './cello';
import { detectShifts, RawNoteEvent, solveFingering } from './fingering';
import { monophonic, ParsedMidi } from './midi';
import { CelloMeasure, CelloNote, CelloSongScore, measureDurationMs } from './schema';

/** Highest note we will try to place on a cello. C6. */
const HIGHEST_PLAYABLE = 84;

export interface ImportedPiece {
  score: CelloSongScore;
  backing: BackingTrack;
  /** Notes dropped because no cello can play them. */
  skippedNotes: number;
  shiftCount: number;
}

export interface ImportScoreOptions {
  id: string;
  title: string;
  composer: string;
  /** Which MIDI track carries the cello line. */
  soloTrack: number;
  /** Override the file's own tempo. */
  bpm?: number;
  /** Cap the import, so a ten-minute file does not become a ten-minute score. */
  maxBars?: number;
}

/** Best guess at which track is the cello, for pre-selecting one in the UI. */
export function suggestSoloTrack(parsed: ParsedMidi): number | null {
  let best: { index: number; score: number } | null = null;
  for (const track of parsed.tracks) {
    const score = soloTrackScore(track);
    if (score < 0) continue;
    if (!best || score > best.score) best = { index: track.index, score };
  }
  return best?.index ?? null;
}

export function importScore(parsed: ParsedMidi, options: ImportScoreOptions): ImportedPiece {
  const { id, title, composer, soloTrack } = options;
  const bpm = options.bpm ?? parsed.bpm;
  const timeSignature = parsed.timeSignature;
  const barDurationMs = measureDurationMs(timeSignature, bpm);

  const soloNotes = monophonic(parsed.notes.filter((n) => n.track === soloTrack));
  if (soloNotes.length === 0) {
    throw new Error('That track has no notes in it — pick a different one.');
  }

  const origin = soloNotes[0].startTimeMs;
  const limitMs = options.maxBars === undefined ? Infinity : options.maxBars * barDurationMs;

  const events: RawNoteEvent[] = [];
  let skippedNotes = 0;
  for (const note of soloNotes) {
    const startTimeMs = note.startTimeMs - origin;
    if (startTimeMs >= limitMs) break;
    // Transpose octaves rather than dropping notes: a part written for violin
    // or voice is often perfectly playable an octave or two down, and silently
    // losing the melody is worse than moving it.
    let midiNumber = note.midiNumber;
    while (midiNumber > HIGHEST_PLAYABLE) midiNumber -= 12;
    while (midiNumber < OPEN_STRING_MIDI.C) midiNumber += 12;
    if (midiNumber > HIGHEST_PLAYABLE || midiNumber < OPEN_STRING_MIDI.C) {
      skippedNotes++;
      continue;
    }
    events.push({ startTimeMs, durationMs: note.durationMs, midiNumber });
  }

  if (events.length === 0) throw new Error('Nothing in that track lands in the cello range.');

  const { states } = solveFingering(events);
  const shifts = detectShifts(events, states);

  const totalMs = events.reduce((max, e) => Math.max(max, e.startTimeMs + e.durationMs), 0);
  const barCount = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barDurationMs,
    durationMs: barDurationMs,
    timeSignature,
    tempoBpm: bpm,
  }));

  const notes: CelloNote[] = events.map((event, i) => {
    const state = states[i];
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
      measureIndex: Math.min(barCount - 1, Math.floor(event.startTimeMs / barDurationMs)),
      bowDirection: i % 2 === 0 ? 'down' : 'up',
    };
  });

  const score: CelloSongScore = {
    schemaVersion: '1.0.0',
    id,
    metadata: {
      title,
      composer,
      origin: 'IMPORTED · MIDI',
      keySignature: 'IMPORTED',
      timeSignature: timeSignature.join('/'),
      bpm,
      difficulty: 'Intermediate',
      tonic: 'C',
      teaches: 'Imported from a MIDI file. The fingerings come from the solver and are a starting point — read them through before trusting them.',
      rights: 'Imported by you. Nothing about this file is distributed with the app.',
    },
    measures,
    notes,
  };

  const backing = backingFromMidi(id, parsed, { name: title, soloTrack });

  return { score, backing, skippedNotes, shiftCount: shifts.length };
}
