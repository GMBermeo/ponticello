import { describe, expect, it } from 'vitest';

import {
  arrangeMidi, arrangeScoreForLevel, ARRANGEMENT_LEVELS, FULL_CELLO_RANGE, midiContentEndMs,
} from '../arrangement';
import { MidiNote, MidiTrack } from '../midi';
import { CelloSongScore } from '../schema';

function track(index: number, name: string, program: number, notes: MidiNote[]): MidiTrack {
  return {
    index, name, program, channels: [0], noteCount: notes.length,
    lowestMidi: Math.min(...notes.map((n) => n.midiNumber)),
    highestMidi: Math.max(...notes.map((n) => n.midiNumber)),
    isPercussion: false,
  };
}

function line(index: number, pitches: number[], stepMs = 125, velocity = 90): MidiNote[] {
  return pitches.map((midiNumber, i) => ({
    midiNumber, startTimeMs: i * stepMs, durationMs: Math.max(40, stepMs - 10),
    track: index, channel: 0, velocity,
  }));
}

function parsed(tracks: MidiTrack[], notes: MidiNote[]) {
  return {
    tracks, notes, bpm: 120, timeSignature: [4, 4] as [number, number],
    durationMs: notes.reduce((max, n) => Math.max(max, n.startTimeMs + n.durationMs), 0),
  };
}

function scoreFrom(pitches: number[], stepMs = 100): CelloSongScore {
  const durationMs = Math.max(2000, pitches.length * stepMs);
  return {
    schemaVersion: '1.0.0', id: 'dense-riff',
    metadata: {
      title: 'Dense riff', composer: '', origin: '', keySignature: 'E MINOR',
      timeSignature: '4/4', bpm: 120, difficulty: 'Expert', tonic: 'E', teaches: '', rights: '',
    },
    measures: Array.from({ length: Math.ceil(durationMs / 2000) }, (_, index) => ({
      index, startBarTimeMs: index * 2000, durationMs: 2000,
      timeSignature: [4, 4] as [number, number], tempoBpm: 120,
    })),
    notes: pitches.map((midiNumber, i) => ({
      id: `n${i}`, midiNumber, pitchName: 'C4', frequency: 261.63,
      startTimeMs: i * stepMs, durationMs: stepMs - 10, measureIndex: Math.floor(i * stepMs / 2000),
      string: 'A' as const, finger: '1' as const, position: '1st' as const,
      extension: 'none' as const, articulation: 'arco' as const, tie: false, bowDirection: 'down' as const,
    })),
  };
}

describe('riff-first MIDI arrangement', () => {
  it('chooses a recurring guitar/bass riff over a wide fast solo', () => {
    const riffPattern = [40, 40, 43, 45, 43, 40, 47, 45];
    const riff = line(0, Array.from({ length: 6 }, () => riffPattern).flat(), 250);
    const solo = line(1, Array.from({ length: 80 }, (_, i) => 72 + ((i * 7) % 29)), 75);
    const source = parsed(
      [track(0, 'Bass riff', 34, riff), track(1, 'Solo Guitar', 29, solo)],
      [...riff, ...solo],
    );

    const arranged = arrangeMidi(source, { level: 'Expert' });
    expect(arranged.sourceTrack).toBe(0);
    expect(arranged.sourceKind).toBe('riff');
  });

  it('falls back to a root guide when no track is a viable melodic line', () => {
    const chordNotes = [
      ...line(0, [36, 40, 43, 38, 41, 45], 500),
      ...line(1, [60, 64, 67, 62, 65, 69], 500),
    ];
    const source = parsed(
      [track(0, 'Low harmony', 0, chordNotes.filter((n) => n.track === 0)), track(1, 'High harmony', 0, chordNotes.filter((n) => n.track === 1))],
      chordNotes,
    );

    const arranged = arrangeMidi(source, { level: 'Beginner' });
    expect(arranged.sourceKind).toBe('roots');
    expect(arranged.notes.length).toBeGreaterThan(0);
    expect(arranged.notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 63)).toBe(true);
  });

  it('rejects an isolated remote trailing event when the other tracks agree on the ending', () => {
    const theme = line(0, Array.from({ length: 40 }, (_, index) => 48 + (index % 8)), 250);
    theme.push({
      midiNumber: 60, startTimeMs: 3_600_000, durationMs: 100,
      track: 0, channel: 0, velocity: 90,
    });
    const harmony = line(1, Array.from({ length: 20 }, (_, index) => 52 + (index % 4)), 500);
    const bass = line(2, Array.from({ length: 20 }, (_, index) => 36 + (index % 3)), 500);
    const source = parsed(
      [track(0, 'Theme riff', 27, theme), track(1, 'Harmony', 48, harmony), track(2, 'Bass', 34, bass)],
      [...theme, ...harmony, ...bass],
    );
    source.durationMs = 3_600_100;

    expect(midiContentEndMs(source)).toBeLessThan(11_000);
    const arranged = arrangeMidi(source, { level: 'Expert', sourceTrack: 0 });
    expect(arranged.notes.at(-1)?.startTimeMs).toBeLessThan(11_000);
  });

  it('fits a high guitar line into the full cello compass as one coherent octave move', () => {
    const high = line(0, [84, 86, 88, 89, 88, 86, 84, 81, 79, 81, 84, 86], 300);
    const arranged = arrangeMidi(parsed([track(0, 'Theme', 27, high)], high), { level: 'Expert' });
    expect(arranged.notes.every((n) => n.midiNumber >= FULL_CELLO_RANGE.low && n.midiNumber <= FULL_CELLO_RANGE.high)).toBe(true);
    expect(Math.abs(arranged.octaveShift % 12)).toBe(0);
    expect(arranged.foldedNotes).toBe(0);
  });
});

describe('adaptive score difficulty', () => {
  it('offers all four levels with monotonically increasing detail and range', () => {
    const motif = [72, 74, 76, 77, 76, 74, 69, 71];
    const full = scoreFrom(Array.from({ length: 12 }, () => motif).flat(), 90);
    const versions = ARRANGEMENT_LEVELS.map((level) => arrangeScoreForLevel(full, level));
    const counts = versions.map((version) => version.notes.length);

    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[2]).toBeLessThanOrEqual(counts[3]);
    expect(versions[0].notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 63)).toBe(true);
    expect(versions[3].notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 81)).toBe(true);
  });

  it('does not delete detail from an already sparse beginner line', () => {
    const sparse = scoreFrom([48, 50, 52, 53, 55, 53, 52, 50], 600);
    const beginner = arrangeScoreForLevel(sparse, 'Beginner');
    expect(beginner.notes).toHaveLength(sparse.notes.length);
  });
});
