import { describe, expect, it } from 'vitest';

import {
  bestOctaveShift, bestOctaveShiftToRange, chooseMelodyTrack, melodyMetrics, melodyTrackScore,
} from '@/domain/melody';
import { MidiNote, MidiTrack } from '@/domain/midi';

/** A track descriptor with sensible defaults. */
function track(patch: Partial<MidiTrack> & { index: number }): MidiTrack {
  return {
    name: null, program: null, channels: [0], noteCount: 0,
    lowestMidi: 0, highestMidi: 0, isPercussion: false,
    ...patch,
  };
}

/** Notes at 250 ms apart, from a list of pitches. */
function line(index: number, pitches: number[]): MidiNote[] {
  return pitches.map((midiNumber, i) => ({
    midiNumber,
    startTimeMs: i * 250,
    durationMs: 240,
    track: index,
    channel: 0,
    velocity: 90,
  }));
}

const PEDAL = Array.from({ length: 40 }, () => 38);
const ALTERNATING = Array.from({ length: 40 }, (_, i) => (i % 2 ? 55 : 59));
const RIFF = [45, 45, 48, 45, 43, 41, 40, 41, 43, 45, 48, 50, 48, 45, 43, 41, 40, 43, 45, 47];
const SHRED = Array.from({ length: 60 }, (_, i) => 72 + (i * 7) % 30);

describe('bestOctaveShift', () => {
  it('leaves a line already in first position where it is', () => {
    expect(bestOctaveShift([40, 45, 50, 55]).shift).toBe(0);
  });

  it('drops a guitar line two octaves into cello range', () => {
    const { shift, fit } = bestOctaveShift([72, 74, 76, 77]);
    expect(shift).toBe(-24);
    expect(fit).toBe(1);
  });

  it('goes further than two octaves when that is what fits', () => {
    // 84-89 straddles the top of first position at -24; -36 clears it.
    expect(bestOctaveShift([84, 86, 88, 89]).shift).toBe(-36);
  });

  it('lifts a bass line into range', () => {
    expect(bestOctaveShift([24, 26, 28, 29]).shift).toBe(12);
  });

  it('prefers the smaller move when two shifts fit equally', () => {
    // A single pitch fits in several octaves; staying put must win.
    expect(bestOctaveShift([48]).shift).toBe(0);
  });

  it('brings a line down when it fits equally well an octave lower', () => {
    // A vocal line at E4–E5. It fits the solo compass perfectly where it is,
    // and where it is, is thumb position for every note of it. Sixty songs in
    // the library were placed exactly this way, because the old objective
    // counted only how much of the line landed inside the range.
    const vocal = [64, 67, 69, 71, 72, 71, 69, 67, 64];
    const { shift, fit } = bestOctaveShiftToRange(vocal, 36, 81);
    expect(shift).toBe(-12);
    expect(fit).toBe(1);
  });

  it('leaves a bass line at the bottom of the instrument alone', () => {
    // Sitting below the ceiling is free, so nothing is ever lifted *up* out of
    // its register to reach the singing range. Both +12 and +24 fit; the
    // smaller move keeps a bass line a bass line.
    expect(bestOctaveShiftToRange([24, 26, 28, 29], 36, 81).shift).toBe(12);
  });

  it('will not trade away a large amount of fit for register', () => {
    // C4–C6 fits at -12 with a couple of notes over the top, and fully at -24.
    // Coming down two octaves is right here; coming down when it would push
    // half the line off the bottom of the C string is not.
    const wide = [36, 40, 43, 48, 52, 55, 60];
    expect(bestOctaveShiftToRange(wide, 36, 81).shift).toBe(0);
  });
});

describe('melodyMetrics', () => {
  it('reports a pedal as no movement', () => {
    const m = melodyMetrics(line(0, PEDAL), 10_000);
    expect(m.movement).toBe(0);
    expect(m.distinctPitches).toBe(1);
  });

  it('reports a two-note ostinato as full movement but no variety', () => {
    // The trap: alternation looks like a melody to a movement-only metric.
    const m = melodyMetrics(line(0, ALTERNATING), 10_000);
    expect(m.movement).toBe(1);
    expect(m.distinctPitches).toBe(2);
  });

  it('measures span and density', () => {
    const m = melodyMetrics(line(0, RIFF), 5_000);
    expect(m.span).toBe(10);
    expect(m.density).toBeCloseTo(4, 1);
  });
});

describe('melodyTrackScore rejects what cannot be the tune', () => {
  it('rejects percussion outright', () => {
    expect(melodyTrackScore(track({ index: 0, isPercussion: true }), line(0, RIFF), 5_000))
      .toBeLessThan(0);
  });

  it('rejects a track with too few notes to judge', () => {
    expect(melodyTrackScore(track({ index: 0 }), line(0, [40, 42, 44]), 5_000))
      .toBeLessThan(0);
  });

  it('rejects a track the file itself says to ignore', () => {
    expect(melodyTrackScore(track({ index: 0, name: 'Just ignore this track' }), line(0, RIFF), 5_000))
      .toBeLessThan(0);
  });

  it('scores a pedal below a riff', () => {
    const pedal = melodyTrackScore(track({ index: 0 }), line(0, PEDAL), 10_000);
    const riff = melodyTrackScore(track({ index: 1 }), line(1, RIFF), 5_000);
    expect(riff).toBeGreaterThan(pedal);
  });

  it('scores a two-note ostinato below a riff', () => {
    const ostinato = melodyTrackScore(track({ index: 0 }), line(0, ALTERNATING), 10_000);
    const riff = melodyTrackScore(track({ index: 1 }), line(1, RIFF), 5_000);
    expect(riff).toBeGreaterThan(ostinato);
  });

  it('scores a wide fast high shred below a riff', () => {
    const shred = melodyTrackScore(track({ index: 0 }), line(0, SHRED), 1_500);
    const riff = melodyTrackScore(track({ index: 1 }), line(1, RIFF), 5_000);
    expect(riff).toBeGreaterThan(shred);
  });
});

/**
 * The two regressions this module exists for. Both were real: the old scorer
 * matched `/cello|solo/` anywhere in a track name and awarded +100.
 */
describe('names no longer override the notes', () => {
  it('does not read "Chancellor" as a cello', () => {
    // Tool's bassist. His pedal must still lose to the guitar's riff.
    const bass = melodyTrackScore(
      track({ index: 1, name: 'Justin Chancellor', program: 34 }), line(1, PEDAL), 10_000,
    );
    const guitar = melodyTrackScore(
      track({ index: 0, name: 'Adam Jones', program: 30 }), line(0, RIFF), 5_000,
    );
    expect(guitar).toBeGreaterThan(bass);
  });

  it('treats "Solo Guitar" as a reason to look elsewhere', () => {
    const solo = melodyTrackScore(
      track({ index: 1, name: 'Solo Guitar (Jack White)' }), line(1, SHRED), 1_500,
    );
    const riff = melodyTrackScore(
      track({ index: 0, name: 'Guitar 1' }), line(0, RIFF), 5_000,
    );
    expect(riff).toBeGreaterThan(solo);
  });

  it('still lets a genuine cello track win a close call', () => {
    const cello = melodyTrackScore(
      track({ index: 0, name: 'Cello', program: 42 }), line(0, RIFF), 5_000,
    );
    const other = melodyTrackScore(track({ index: 1, name: 'Keys' }), line(1, RIFF), 5_000);
    expect(cello).toBeGreaterThan(other);
  });
});

describe('chooseMelodyTrack', () => {
  const parsed = {
    durationMs: 10_000,
    tracks: [
      track({ index: 0, name: 'Adam Jones', program: 30, noteCount: RIFF.length }),
      track({ index: 1, name: 'Justin Chancellor', program: 34, noteCount: PEDAL.length }),
      track({ index: 2, name: 'Drumkit', isPercussion: true, noteCount: 40 }),
    ],
    notes: [...line(0, RIFF), ...line(1, PEDAL), ...line(2, PEDAL)],
  };

  it('picks the riff, not the pedal or the drums', () => {
    expect(chooseMelodyTrack(parsed)?.track).toBe(0);
  });

  it('reports the octave shift to bring it into range', () => {
    const high = {
      durationMs: 5_000,
      tracks: [track({ index: 0, name: 'Lead', noteCount: RIFF.length })],
      notes: line(0, RIFF.map((p) => p + 24)),
    };
    // -12 and -24 both land it inside first position, so the smaller move wins
    // and the line stays in the singing register rather than on the C string.
    expect(chooseMelodyTrack(high)?.octaveShift).toBe(-12);
  });

  it('returns null when nothing in the file could be a cello line', () => {
    const drumsOnly = {
      durationMs: 5_000,
      tracks: [track({ index: 0, name: 'Drumkit', isPercussion: true, noteCount: 40 })],
      notes: line(0, PEDAL),
    };
    expect(chooseMelodyTrack(drumsOnly)).toBeNull();
  });
});
