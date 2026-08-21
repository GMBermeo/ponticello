import { describe, expect, it } from 'vitest';

import {
  centsBetween, defaultStringFor, frequencyToMidi, judgeIntonation, LANDMARKS,
  midiAt, midiToFrequency, midiToPitchName, OPEN_STRING_MIDI, semitonesAtMm,
  semitonesFor, stopDistanceMm, STRING_LENGTH_MM,
} from '../cello';

describe('pitch conversions', () => {
  it.each([
    ['C2 — open IV', 36, 65.41],
    ['G2 — open III', 43, 98.0],
    ['D3 — open II', 50, 146.83],
    ['A3 — open I', 57, 220.0],
    ['A4 — thumb harmonic', 69, 440.0],
    ['A5', 81, 880.0],
  ])('%s is %d -> %f Hz', (_label, midi, hz) => {
    expect(midiToFrequency(midi)).toBeCloseTo(hz, 1);
    expect(frequencyToMidi(hz)).toBeCloseTo(midi, 1);
  });

  it('names notes in scientific pitch', () => {
    expect(midiToPitchName(36)).toBe('C2');
    expect(midiToPitchName(60)).toBe('C4');
    expect(midiToPitchName(54)).toBe('F#3');
    expect(midiToPitchName(54, true)).toBe('Gb3');
  });

  it('measures cents symmetrically about the target', () => {
    expect(centsBetween(440, 440)).toBe(0);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 6);
    expect(centsBetween(220, 440)).toBeCloseTo(-1200, 6);
    // A semitone is 100 cents by construction.
    expect(centsBetween(midiToFrequency(61), midiToFrequency(60))).toBeCloseTo(100, 6);
  });

  it.each([
    [0, 'perfect'], [15, 'perfect'], [-15, 'perfect'],
    [16, 'sharp'], [-16, 'flat'], [30, 'sharp'],
    [31, 'miss'], [-45, 'miss'],
  ])('judges %d cents as %s', (cents, verdict) => {
    expect(judgeIntonation(cents)).toBe(verdict);
  });
});

describe('fingerboard geometry', () => {
  it('places the octave at exactly half the string', () => {
    expect(stopDistanceMm(12)).toBeCloseTo(STRING_LENGTH_MM / 2, 6);
  });

  it.each([
    ['half position', 1, 38.7],
    ['first position', 2, 75.3],
    ['second finger', 3, 109.8],
    ['third finger', 4, 142.3],
    ['fourth finger', 5, 173.1],
    ['neck heel — fourth position', 7, 229.5],
  ])('puts %s at %fmm from the nut', (_label, semitones, mm) => {
    expect(stopDistanceMm(semitones)).toBeCloseTo(mm, 1);
  });

  it('round-trips millimetres back to semitones', () => {
    for (const n of [1, 2, 5, 7, 12, 17]) {
      expect(semitonesAtMm(stopDistanceMm(n))).toBeCloseTo(n, 6);
    }
  });

  it('rescales consistently for a smaller instrument', () => {
    // A 3/4 cello: every landmark moves, but the octave stays at the halfway point.
    expect(stopDistanceMm(12, 655)).toBeCloseTo(327.5, 6);
  });

  it('spaces landmarks monotonically from the nut', () => {
    const mm = LANDMARKS.map((l) => l.mm);
    expect([...mm].sort((a, b) => a - b)).toEqual(mm);
    expect(LANDMARKS[0].mm).toBe(0);
  });
});

describe('notes on the fingerboard', () => {
  it('raises each string by the semitones stopped', () => {
    expect(midiAt('A', 0)).toBe(OPEN_STRING_MIDI.A);
    expect(midiToPitchName(midiAt('A', 2))).toBe('B3');   // blue tape, A string
    expect(midiToPitchName(midiAt('D', 2))).toBe('E3');   // blue tape, D string
    expect(midiToPitchName(midiAt('A', 12))).toBe('A4');  // octave harmonic
  });

  it('reports when a pitch is below a string', () => {
    expect(semitonesFor('A', 50)).toBeNull();
    expect(semitonesFor('D', 50)).toBe(0);
  });

  it('prefers the highest string that can reach a note in the neck', () => {
    expect(defaultStringFor(59)).toBe('A');  // B3
    expect(defaultStringFor(43)).toBe('G');  // G2
    expect(defaultStringFor(36)).toBe('C');  // C2
  });
});
