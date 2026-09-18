import { describe, expect, it } from 'vitest';

import { stopDistanceMm } from '../cello';
import {
  DEFAULT_TAPE_SETS, FINGERBOARD_TAPES, isCurrentTapeLayout, nearestTapeBelow, notesUnderTape,
  Tape, tapeForSemitones, tapeGeometry, tapeHint,
} from '../tapes';

describe('the default tapes — nine of them, no half position', () => {
  it('runs blue · green · yellow · red · green · blue · yellow · green · yellow', () => {
    expect(FINGERBOARD_TAPES.tapes.map((t) => t.color)).toEqual([
      'blue', 'green', 'yellow', 'red', 'green', 'blue', 'yellow', 'green', 'yellow',
    ]);
  });

  it('starts a whole step above the nut and climbs one semitone at a time', () => {
    expect(FINGERBOARD_TAPES.tapes.map((t) => t.semitones))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('has nothing in half position', () => {
    expect(FINGERBOARD_TAPES.tapes.some((t) => t.semitones <= 1)).toBe(false);
  });

  it('never asks for the thumb, and ships no thumb-position set', () => {
    expect(FINGERBOARD_TAPES.tapes.some((t) => t.finger === 'T')).toBe(false);
    expect(DEFAULT_TAPE_SETS).toHaveLength(1);
  });

  it('opens with the closed first-position hand frame', () => {
    const frame = FINGERBOARD_TAPES.tapes.slice(0, 4);
    expect(frame.map((t) => t.finger)).toEqual(['1', '2', '3', '4']);
    // First finger to little finger spans a minor third.
    expect(frame[3].semitones - frame[0].semitones).toBe(3);
  });

  it('puts a tape on the neck heel, where the hand can feel the body', () => {
    const heel = FINGERBOARD_TAPES.tapes.find((t) => t.semitones === 7);
    expect(heel?.color).toBe('blue');
  });

  it('gives the notes a beginner actually reads off the first four', () => {
    const names = (t: Tape) =>
      Object.fromEntries(notesUnderTape(t).map((n) => [n.string, n.name]));
    const [blue, green, yellow, red] = FINGERBOARD_TAPES.tapes;

    expect(names(blue)).toEqual({ C: 'D2', G: 'A2', D: 'E3', A: 'B3' });
    expect(names(green)).toEqual({ C: 'D#2', G: 'A#2', D: 'F3', A: 'C4' });
    expect(names(yellow)).toEqual({ C: 'E2', G: 'B2', D: 'F#3', A: 'C#4' });
    expect(names(red)).toEqual({ C: 'F2', G: 'C3', D: 'G3', A: 'D4' });
  });

  it('puts blue a whole step up and red a fourth up', () => {
    expect(stopDistanceMm(2)).toBeCloseTo(75.3, 1);
    expect(stopDistanceMm(5)).toBeCloseTo(173.1, 1);
  });
});

describe('stored layouts', () => {
  it('accepts the shipped set', () => {
    expect(isCurrentTapeLayout(DEFAULT_TAPE_SETS)).toBe(true);
  });

  it('rejects the old two-set, four-tape layout', () => {
    const old = [
      { ...FINGERBOARD_TAPES, tapes: FINGERBOARD_TAPES.tapes.slice(0, 4) },
      { ...FINGERBOARD_TAPES, id: 'thumb', tapes: FINGERBOARD_TAPES.tapes.slice(0, 4) },
    ];
    expect(isCurrentTapeLayout(old)).toBe(false);
  });

  it('rejects nonsense', () => {
    expect(isCurrentTapeLayout(undefined)).toBe(false);
    expect(isCurrentTapeLayout([])).toBe(false);
  });
});

describe('tape geometry and hints', () => {
  it('orders every tape from the nut down the string', () => {
    const mm = tapeGeometry(DEFAULT_TAPE_SETS).map((t) => t.mm);
    expect([...mm].sort((a, b) => a - b)).toEqual(mm);
    expect(mm).toHaveLength(9);
  });

  it('finds the tape under an exact stopping point', () => {
    expect(tapeForSemitones(DEFAULT_TAPE_SETS, 4)?.color).toBe('yellow');
    expect(tapeForSemitones(DEFAULT_TAPE_SETS, 1)).toBeUndefined();
    expect(tapeForSemitones(DEFAULT_TAPE_SETS, 12)).toBeUndefined();
  });

  it('falls back to the nearest tape below', () => {
    const near = nearestTapeBelow(DEFAULT_TAPE_SETS, 12);
    expect(near?.tape.semitones).toBe(10);
    expect(near?.semitonesAbove).toBe(2);
  });

  it('disambiguates repeated colours by ordinal within the set', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 3, '2')).toBe('2 finger on the first green tape');
    expect(tapeHint(DEFAULT_TAPE_SETS, 6, '2')).toBe('2 finger on the second green tape');
    expect(tapeHint(DEFAULT_TAPE_SETS, 9, '3')).toBe('3 finger on the third green tape');
  });

  it('names a colour used once without an ordinal', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 5, '4')).toBe('4 finger on the red tape');
  });

  it('describes a note between tapes as an offset from one', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 11, '4'))
      .toBe('4 finger, a semitone above the third yellow tape');
  });

  it('says nothing about the left hand for an open string', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 0, '0')).toMatch(/open string/);
  });

  it('has nothing to say below the first tape', () => {
    expect(tapeHint(DEFAULT_TAPE_SETS, 1, '1')).toMatch(/below every tape/);
  });
});
