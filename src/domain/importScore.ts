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

import { arrangeMidi, bassLine, harmonicGuide, rebaseLine } from './arranger';
import { BackingTrack, backingFromMidi, soloPartFromScore } from './backing';
import { midiToFrequency, midiToPitchName } from './cello';
import { difficultyOf } from './difficulty';
import { detectKey, keyName } from './key';
import { detectShifts, RawNoteEvent, seatLine } from './fingering';
import { ParsedMidi } from './midi';
import { CelloMeasure, CelloNote, CelloSongScore, measureDurationMs } from './schema';

export interface ImportedPiece {
  score: CelloSongScore;
  backing: BackingTrack;
  /**
   * Held harmonic roots for the Beginner level, on the same timeline as
   * `score`. Built here rather than stored, like everything else about an
   * imported piece — the file is what is kept.
   */
  guide: RawNoteEvent[];
  bass: RawNoteEvent[];
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
  return arrangeMidi(parsed, { level: 'Expert' }).sourceTrack;
}

export function importScore(parsed: ParsedMidi, options: ImportScoreOptions): ImportedPiece {
  const { id, title, composer, soloTrack } = options;
  const bpm = options.bpm ?? parsed.bpm;
  const timeSignature = parsed.timeSignature;
  const barDurationMs = measureDurationMs(timeSignature, bpm);

  const arranged = arrangeMidi(parsed, { level: 'Expert', sourceTrack: soloTrack });
  if (arranged.notes.length === 0) {
    throw new Error('That track has no notes in it — pick a different one.');
  }

  const timeScale = parsed.bpm > 0 ? parsed.bpm / bpm : 1;
  const limitMs = options.maxBars === undefined ? Infinity : options.maxBars * barDurationMs;
  const events: RawNoteEvent[] = arranged.notes
    .map((note) => ({
      startTimeMs: note.startTimeMs * timeScale,
      durationMs: note.durationMs * timeScale,
      midiNumber: note.midiNumber,
    }))
    .filter((note) => note.startTimeMs < limitMs)
    .map((note) => ({
      ...note,
      durationMs: Math.max(1, Math.min(note.durationMs, limitMs - note.startTimeMs)),
    }));
  const skippedNotes = 0;

  if (events.length === 0) throw new Error('Nothing in that track lands in the requested score window.');

  // A real key, not the word "IMPORTED": `generateAccompaniment` parses this
  // string for the tonic of the drone, and "IMPORTED" has always come back as
  // C whatever the file was in.
  const detected = detectKey(events);
  const key = keyName(detected.tonic, detected.mode);

  const states = seatLine(events);
  const shifts = detectShifts(events, states);
  const difficulty = difficultyOf(events, states);

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
    if (!state) {
      // Every arranged event must have a first-position fingering.
      throw new Error(`No fingering was found for note ${i + 1}.`);
    }
    return {
      id: `${id}-${i + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      // Never let a note spill past the final bar line; the schema rejects it.
      durationMs: Math.max(1, Math.min(event.durationMs, barCount * barDurationMs - event.startTimeMs)),
      pitchName: midiToPitchName(event.midiNumber, key.includes('\u266d')),
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
      keySignature: key,
      timeSignature: timeSignature.join('/'),
      bpm,
      difficulty: difficulty.tier,
      tonic: key.split(' ')[0] ?? 'C',
      preferFlats: key.includes('\u266d'),
      teaches: `Imported ${arranged.sourceKind} line, fitted to low first position with octave displacement. Choose an easier arrangement level on the practice sheet if needed.`,
      rights: 'Imported by you. Nothing about this file is distributed with the app.',
    },
    measures,
    notes,
  };

  const sourceWindowEndMs = Number.isFinite(limitMs)
    ? arranged.originMs + limitMs / timeScale
    : arranged.sourceEndMs;
  const backing = backingFromMidi(id, parsed, {
    name: title,
    soloTrack,
    originMs: arranged.originMs,
    endMs: Math.min(arranged.sourceEndMs, sourceWindowEndMs),
    timeScale,
    soloNotes: soloPartFromScore(score).notes,
  });

  // Same rebase and time scale as the melody above, so switching level does
  // not move the bars under the player.
  const windowEnd = Math.min(arranged.sourceEndMs, sourceWindowEndMs);
  const guide = rebaseLine(harmonicGuide(parsed, arranged.sourceEndMs), arranged.originMs, windowEnd, timeScale);
  const bass = rebaseLine(bassLine(parsed, arranged.sourceEndMs), arranged.originMs, windowEnd, timeScale);

  return { score, backing, guide, bass, skippedNotes, shiftCount: shifts.length };
}
