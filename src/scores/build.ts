/**
 * Score authoring helper.
 *
 * Hand-writing the full note objects is error-prone — pitch name, MIDI number
 * and frequency all have to agree with the string and the stopping distance,
 * and start times have to add up. Here an event names only the decisions a
 * musician actually makes (which string, how far up it, which finger, how
 * long) and everything else is derived, so a score cannot disagree with the
 * instrument model.
 */

import {
  CelloFinger, CelloPosition, CelloString, midiAt, midiToFrequency, midiToPitchName,
} from '@/domain/cello';
import {
  BowDirection, CelloArticulation, CelloExtension, CelloMeasure, CelloNote,
  CelloSongMetadata, CelloSongScore, measureDurationMs,
} from '@/domain/schema';

export interface Event {
  /** Which string. */
  s: CelloString;
  /** Semitones above the nut. 0 is the open string. */
  n: number;
  /** Finger stopping it. Must be '0' when `n` is 0. */
  f: CelloFinger;
  /** Duration in quarter-note beats. */
  b: number;
  /** Hand position. Defaults to 1st, or Thumb when the note is high enough. */
  pos?: CelloPosition;
  bow?: BowDirection;
  art?: CelloArticulation;
  ext?: CelloExtension;
  tie?: boolean;
}

export interface ScoreInput {
  id: string;
  metadata: CelloSongMetadata;
  timeSignature: [number, number];
  /** Bars, each a list of events that must fill the bar exactly. */
  bars: Event[][];
}

function inferPosition(event: Event): CelloPosition {
  if (event.pos) return event.pos;
  if (event.f === 'T' || event.n >= 12) return 'Thumb';
  return '1st';
}

/**
 * Builds a validated score. Throws on a bar whose durations do not add up —
 * a mistake that is otherwise invisible until the playhead drifts out of sync
 * halfway through a piece.
 */
export function buildScore(input: ScoreInput): CelloSongScore {
  const { id, metadata, timeSignature, bars } = input;
  const bpm = metadata.bpm;
  const quarterMs = 60000 / bpm;
  const barDurationMs = measureDurationMs(timeSignature, bpm);
  const beatsPerBar = timeSignature[0] * (4 / timeSignature[1]);

  const measures: CelloMeasure[] = [];
  const notes: CelloNote[] = [];

  bars.forEach((events, barIndex) => {
    const beats = events.reduce((sum, e) => sum + e.b, 0);
    if (Math.abs(beats - beatsPerBar) > 1e-6) {
      throw new Error(
        `${id}: bar ${barIndex + 1} holds ${beats} beats but ${timeSignature.join('/')} needs ${beatsPerBar}`,
      );
    }

    const startBarTimeMs = barIndex * barDurationMs;
    measures.push({
      index: barIndex,
      startBarTimeMs,
      durationMs: barDurationMs,
      timeSignature,
      tempoBpm: bpm,
    });

    let offset = 0;
    events.forEach((event, i) => {
      if (event.n === 0 && event.f !== '0') {
        throw new Error(`${id}: bar ${barIndex + 1} note ${i + 1} is an open string but names finger ${event.f}`);
      }
      if (event.n > 0 && event.f === '0') {
        throw new Error(`${id}: bar ${barIndex + 1} note ${i + 1} stops the string but names finger 0`);
      }

      const midiNumber = midiAt(event.s, event.n);
      notes.push({
        id: `${id}-${barIndex + 1}-${i + 1}`,
        startTimeMs: startBarTimeMs + offset,
        durationMs: event.b * quarterMs,
        pitchName: midiToPitchName(midiNumber, metadata.preferFlats),
        midiNumber,
        frequency: Math.round(midiToFrequency(midiNumber) * 100) / 100,
        string: event.s,
        finger: event.f,
        position: inferPosition(event),
        extension: event.ext ?? 'none',
        articulation: event.art ?? 'arco',
        tie: event.tie ?? false,
        measureIndex: barIndex,
        bowDirection: event.bow ?? 'unspecified',
      });
      offset += event.b * quarterMs;
    });
  });

  return { schemaVersion: '1.0.0', id, metadata, measures, notes };
}

/** Alternating down/up bows, the default for a détaché passage. */
export function alternateBows(events: Event[], startDown = true): Event[] {
  return events.map((e, i) => ({
    ...e,
    bow: e.bow ?? ((i % 2 === 0) === startDown ? 'down' : 'up'),
  }));
}

/** Repeats a figure, which is how most of the Prélude's bars are written. */
export function twice(events: Event[]): Event[] {
  return [...events, ...events];
}
