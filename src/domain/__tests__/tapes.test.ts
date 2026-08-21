import { describe, expect, it } from 'vitest';

import { midiToPitchName, stopDistanceMm } from '../cello';
import {
  DEFAULT_TAPE_SETS, FIRST_POSITION_TAPES, nearestTapeBelow, notesUnderTape,
  tapeForSemitones, tapeGeometry, tapeHint, THUMB_POSITION_TAPES,
} from '../tapes';

describe('first position tapes — blue, yellow, yellow, green', () => {
  it('runs blue · yellow · yellow · green from the nut outwards', () => {
    expect(FIRST_POSITION_TAPES.tapes.map((t) => t.color))
      .toEqual(['blue', 'yellow', 'yellow', 'green']);
  });

  it('is one closed hand frame — a semitone between neighbours', () => {
    const semitones = FIRST_POSITION_TAPES.tapes.map((t) => t.semitones);
    expect(semitones).toEqual([2, 3, 4, 5]);
    // Fingers 1 to 4 span a minor third, which is the first-position frame.
    expect(semitones[3] - semitones[0]).toBe(3);
  });

  it('assigns one finger per tape, in order', () => {
    expect(FIRST_POSITION_TAPES.tapes.map((t) => t.finger)).toEqual(['1', '2', '3', '4']);
  });

  it('gives the notes a beginner actually reads off them', () => {
    const [blue, yellow1, yellow2, green] = FIRST_POSITION_TAPES.tapes;
    const names = (t: typeof blue) =>
      Object.fromEntries(notesUnderTape(t).map((n) => [n.string, n.name]));

    expect(names(blue)).toEqual({ C: 'D2', G: 'A2', D: 'E3', A: 'B3' });
    expect(names(yellow1)).toEqual({ C: 'D#2', G: 'A#2', D: 'F3', A: 'C4' });
    expect(names(yellow2)).toEqual({ C: 'E2', G: 'B2', D: 'F#3', A: 'C#4' });
    expect(names(green)).toEqual({ C: 'F2', G: 'C3', D: 'G3', A: 'D4' });
  });

  it('puts blue a whole step up and green a fourth up', () => {
    expect(stopDistanceMm(2)).toBeCloseTo(75.3, 1);
    expect(stopDistanceMm(5)).toBeCloseTo(173.1, 1);
  });
});

describe('thumb position tapes — blue, green, green, yellow', () => {
  it('runs blue · green · green · yellow from the nut outwards', () => {
    expect(THUMB_POSITION_TAPES.tapes.map((t) => t.color))
      .toEqual(['blue', 'green', 'green', 'yellow']);
  });

  it('parks the thumb on the octave harmonic at half the string', () => {
    const [thumb] = THUMB_POSITION_TAPES.tapes;
    expect(thumb.finger).toBe('T');
    expect(thumb.semitones).toBe(12);
    expect(stopDistanceMm(thumb.semitones)).toBeCloseTo(345, 6);
  });

  it('climbs a major tetrachord above the thumb', () => {
    const gaps = THUMB_POSITION_TAPES.tapes
      .map((t) => t.semitones)
      .map((n, i, all) => (i === 0 ? 0 : n - all[i - 1]));
    expect(gaps).toEqual([0, 2, 2, 1]); // whole, whole, half
  });

  it('spells D major on the A string', () => {
    const names = THUMB_POSITION_TAPES.tapes.map(
      (t) => midiToPitchName(57 + t.semitones),
    );
    expect(names).toEqual(['A4', 'B4', 'C#5', 'D5']);
  });

  it('never asks for the little finger', () => {
    expect(THUMB_POSITION_TAPES.tapes.some((t) => t.finger === '4')).toBe(false);
  });
});

describe('tape geometry and hints', () => {
  it('orders every tape from the nut down the string', () => {
    const mm = tapeGeometry(DEFAULT_TAPE_SETS).map((t) => t.mm);
    expect([...mm].sort((a, b) => a - b)).toEqual(mm);
    expect(mm).toHaveLength(8);
  });

  it('finds the tape under an exact stopping point', () => {
    expect(tapeForSemitones(DEFAULT_TAPE_SETS, 4)?.color).toBe('yellow');
    expect(tapeForSemitones(DEFAULT_TAPE_SETS, 6)).toBeUndefined();
  });

  it('falls back to the nearest tape below', () => {
    const near = nearestTapeBelow(DEFAULT_TAPE_SETS, 7);
    expect(near?.tape.color).toBe('green');
    expect(near?.semitonesAbove).toBe(2);
  });

  it('disambiguates the two yellows by ordinal within their own set', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 3, '2')).toBe('2 finger on the first yellow tape');
    expect(tapeHint(DEFAULT_TAPE_SETS, 4, '3')).toBe('3 finger on the second yellow tape');
  });

  it('describes a note between tapes as an offset from one', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 7, '4'))
      .toBe('4 finger, a whole step above the green tape');
  });

  it('says nothing about the left hand for an open string', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 0, '0')).toMatch(/open string/);
  });

  it('names the thumb rather than a finger number', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 12, 'T')).toMatch(/^thumb on/);
  });
});
