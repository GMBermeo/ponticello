import { describe, expect, it } from 'vitest';

import {
  calculateFretboardMaxMm, CELLO_NOTES, centsBetween, defaultStringFor, DISPLAY_STRING_ORDER,
  alternativePlacements, fingerboardExtentMm, frequencyToMidi, getCelloNote, judgeIntonation,
  LANDMARKS, NECK_REACH_SEMITONES, placementsFor,
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

  it('orders display strings from left to right as A-D-G-C', () => {
    expect(DISPLAY_STRING_ORDER).toEqual(['A', 'D', 'G', 'C']);
  });
});

describe('CELLO_NOTES and score notation catalog', () => {
  it('contains valid note info across standard cello range C2 to C6', () => {
    const c2 = CELLO_NOTES[36];
    expect(c2).toBeDefined();
    expect(c2?.pitchName).toBe('C2');
    expect(c2?.staffStep).toBe(-4);
    expect(c2?.ledgerLines).toEqual([-2, -4]);

    const d3 = CELLO_NOTES[50];
    expect(d3).toBeDefined();
    expect(d3?.pitchName).toBe('D3');
    expect(d3?.staffStep).toBe(4);
    expect(d3?.ledgerLines).toEqual([]);

    const c4 = CELLO_NOTES[60];
    expect(c4).toBeDefined();
    expect(c4?.pitchName).toBe('C4');
    expect(c4?.staffStep).toBe(10);
    expect(c4?.ledgerLines).toEqual([10]);
  });

  it('getCelloNote respects flat spellings when requested', () => {
    const dFlat = getCelloNote(49, true);
    expect(dFlat.pitchName).toBe('Db3');
    expect(dFlat.accidental).toBe('♭');

    const cSharp = getCelloNote(49, false);
    expect(cSharp.pitchName).toBe('C#3');
    expect(cSharp.accidental).toBe('♯');
  });
});

describe('calculateFretboardMaxMm', () => {
  it('zooms to ~220 mm when only 1st position / low semitones are used', () => {
    const notes = [
      { string: 'D' as const, midiNumber: 50 }, // open D (0 semitones)
      { string: 'D' as const, midiNumber: 52 }, // E (2 semitones)
      { string: 'D' as const, midiNumber: 55 }, // G (5 semitones)
    ];
    expect(calculateFretboardMaxMm(notes)).toBe(220);
  });

  it('zooms to ~330 mm when up to 4th position is used', () => {
    const notes = [
      { string: 'D' as const, midiNumber: 50 },
      { string: 'D' as const, midiNumber: 57 }, // A (7 semitones - 4th pos)
    ];
    expect(calculateFretboardMaxMm(notes)).toBe(330);
  });

  it('uses full 440 mm when thumb position or high semitones are used', () => {
    const notes = [
      { string: 'A' as const, midiNumber: 69, position: 'Thumb' as const },
    ];
    expect(calculateFretboardMaxMm(notes)).toBe(440);
  });

  it('defaults to 440 mm for empty notes', () => {
    expect(calculateFretboardMaxMm([])).toBe(440);
  });
});

describe('how much fingerboard a panel should draw', () => {
  it('shows what the piece needs when there is no room to spare', () => {
    expect(fingerboardExtentMm(220, 200)).toBe(220);
    expect(fingerboardExtentMm(330, 300)).toBe(330);
  });

  it('widens a first-position piece to fill a tall column', () => {
    // A column this tall would stretch 220 mm over the whole panel, putting
    // neighbouring semitones a hand's width apart on screen.
    expect(fingerboardExtentMm(220, 520)).toBeGreaterThan(220);
  });

  it('never draws less than the piece actually uses', () => {
    for (const height of [0, 120, 400, 900]) {
      expect(fingerboardExtentMm(440, height)).toBeGreaterThanOrEqual(440);
    }
  });

  it('stops at the full board rather than running off the string', () => {
    expect(fingerboardExtentMm(220, 5000)).toBe(440);
  });

  it('snaps to a ladder, so a pixel of layout change cannot rescale it', () => {
    const a = fingerboardExtentMm(220, 480);
    const b = fingerboardExtentMm(220, 483);
    expect(a).toBe(b);
  });

  it('falls back to the piece when the column has not been measured yet', () => {
    expect(fingerboardExtentMm(330, 0)).toBe(330);
    expect(fingerboardExtentMm(330, Number.NaN)).toBe(330);
  });
});

describe('the same note, somewhere else', () => {
  it('finds the reported pair: A2 on the G string and on the C string', () => {
    // A2 is two semitones up the G string, and nine up the C.
    const places = placementsFor(45);
    expect(places).toEqual([
      { string: 'C', semitones: 9 },
      { string: 'G', semitones: 2 },
    ]);
  });

  it('lists the open string as a placement in its own right', () => {
    const places = placementsFor(OPEN_STRING_MIDI.D);
    expect(places).toContainEqual({ string: 'D', semitones: 0 });
    expect(places).toContainEqual({ string: 'G', semitones: 7 });
  });

  it('excludes the place the note is actually being taken', () => {
    const others = alternativePlacements(45, { string: 'G', semitones: 2 });
    expect(others).toEqual([{ string: 'C', semitones: 9 }]);
  });

  it('never suggests a string that cannot reach the pitch', () => {
    // The low C is only ever the open C string — nothing is below it.
    expect(placementsFor(OPEN_STRING_MIDI.C)).toEqual([{ string: 'C', semitones: 0 }]);
    expect(alternativePlacements(OPEN_STRING_MIDI.C, { string: 'C', semitones: 0 })).toEqual([]);
  });

  it('stays inside the neck', () => {
    for (let midi = 36; midi <= 72; midi++) {
      for (const place of placementsFor(midi)) {
        expect(place.semitones).toBeGreaterThanOrEqual(0);
        expect(place.semitones).toBeLessThanOrEqual(NECK_REACH_SEMITONES);
        expect(midiAt(place.string, place.semitones)).toBe(midi);
      }
    }
  });

  it('honours a narrower reach when the panel is drawing less board', () => {
    expect(placementsFor(45, 5)).toEqual([{ string: 'G', semitones: 2 }]);
  });
});
