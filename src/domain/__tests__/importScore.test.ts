import { describe, expect, it } from 'vitest';

import { soloPartFromScore } from '../backing';
import { arrangeMidi } from '../arrangement';
import { importScore, suggestSoloTrack } from '../importScore';
import { MidiNote, MidiTrack, ParsedMidi } from '../midi';

function makeTrack(index: number, name: string, program: number, notes: MidiNote[]): MidiTrack {
  return {
    index, name, program, channels: [0], noteCount: notes.length,
    lowestMidi: Math.min(...notes.map((note) => note.midiNumber)),
    highestMidi: Math.max(...notes.map((note) => note.midiNumber)),
    isPercussion: false,
  };
}

function parsedFixture(): ParsedMidi {
  const lead = Array.from({ length: 16 }, (_, index): MidiNote => ({
    midiNumber: [84, 86, 88, 86][index % 4] ?? 84,
    startTimeMs: 1000 + index * 250,
    durationMs: 220,
    track: 0,
    channel: 0,
    velocity: 100,
  }));
  const accompaniment = Array.from({ length: 12 }, (_, index): MidiNote => ({
    midiNumber: 48 + (index % 3) * 4,
    startTimeMs: 500 + index * 500,
    durationMs: 460,
    track: 1,
    channel: 0,
    velocity: 80,
  }));
  const notes = [...lead, ...accompaniment];
  return {
    notes,
    tracks: [
      makeTrack(0, 'Recurring theme', 27, lead),
      makeTrack(1, 'Piano', 0, accompaniment),
    ],
    bpm: 120,
    timeSignature: [4, 4],
    durationMs: 6500,
  };
}

describe('runtime MIDI import arrangement', () => {
  it('uses the same source selector as the central arranger', () => {
    const parsed = parsedFixture();
    expect(suggestSoloTrack(parsed)).toBe(arrangeMidi(parsed, { level: 'Expert' }).sourceTrack);
  });

  it('fits MIDI 84+ safely and keeps displayed Cello audio exactly authoritative', () => {
    const parsed = parsedFixture();
    const piece = importScore(parsed, {
      id: 'imported', title: 'Imported', composer: 'Test', soloTrack: 0,
    });

    expect(piece.score.notes.every((note) => note.midiNumber >= 36 && note.midiNumber <= 81)).toBe(true);
    expect(piece.score.notes[0]?.startTimeMs).toBe(0);
    const soundingSolo = piece.backing.parts.find((part) => part.role === 'solo');
    expect(soundingSolo?.notes).toEqual(soloPartFromScore(piece.score).notes);
    const accompaniment = piece.backing.parts.find((part) => part.role === 'accompaniment');
    expect(accompaniment?.notes.some((note) => note.startTimeMs === 0)).toBe(true);
  });

  it('actually retimes score and backing when BPM is overridden', () => {
    const piece = importScore(parsedFixture(), {
      id: 'slow', title: 'Slow', composer: 'Test', soloTrack: 0, bpm: 60,
    });
    expect(piece.score.notes[1]?.startTimeMs).toBe(500);
    const accompaniment = piece.backing.parts.find((part) => part.role === 'accompaniment');
    // Source accompaniment onset 1500 minus solo origin 1000, doubled at 60 BPM.
    expect(accompaniment?.notes.some((note) => note.startTimeMs === 1000)).toBe(true);
  });

  it('clips crossing score and backing notes at maxBars', () => {
    const solo: MidiNote[] = [{
      midiNumber: 72, startTimeMs: 1000, durationMs: 5000,
      track: 0, channel: 0, velocity: 100,
    }];
    const accompaniment: MidiNote[] = [{
      midiNumber: 48, startTimeMs: 1000, durationMs: 5000,
      track: 1, channel: 0, velocity: 80,
    }];
    const parsed: ParsedMidi = {
      notes: [...solo, ...accompaniment],
      tracks: [
        makeTrack(0, 'Solo', 42, solo),
        makeTrack(1, 'Piano', 0, accompaniment),
      ],
      bpm: 120,
      timeSignature: [4, 4],
      durationMs: 6000,
    };

    const piece = importScore(parsed, {
      id: 'capped', title: 'Capped', composer: 'Test', soloTrack: 0, maxBars: 1,
    });

    expect(piece.score.measures).toHaveLength(1);
    expect(piece.score.notes).toHaveLength(1);
    expect(piece.score.notes[0]!.startTimeMs + piece.score.notes[0]!.durationMs).toBe(2000);
    expect(piece.backing.durationMs).toBe(2000);
    expect(piece.backing.parts.every((part) => part.notes.every(
      (note) => note.startTimeMs + note.durationMs <= 2000,
    ))).toBe(true);
  });
});
