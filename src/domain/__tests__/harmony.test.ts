import { describe, expect, it } from 'vitest';

import { toPitchClass } from '../cello';
import {
  bestTriad, likeliestRoot, overlapMs, triadFit, triadTones, weighPitchClasses, weightAt, type TimedPitch,
} from '../harmony';

const C = 60;
const E = 64;
const G = 67;
const A = 69;
const note = (midiNumber: number, startTimeMs: number, durationMs: number): TimedPitch => ({ midiNumber, startTimeMs, durationMs });
const chord = (pitches: number[], durationMs = 1000) => pitches.map((pitch) => note(pitch, 0, durationMs));

describe('toPitchClass', () => {
  it('maps any octave of C to 0', () => {
    expect([0, 12, 60, 120].map(toPitchClass)).toEqual([0, 0, 0, 0]);
  });

  it('wraps negative numbers into 0–11', () => {
    expect([-1, -12, -13].map(toPitchClass)).toEqual([11, 0, 11]);
  });
});

describe('overlapMs', () => {
  it('measures the part of a note inside the window', () => {
    expect(overlapMs(note(C, 500, 1000), { fromMs: 0, toMs: 1000 })).toBe(500);
  });

  it('is zero when the note ends exactly where the window starts', () => {
    expect(overlapMs(note(C, 0, 1000), { fromMs: 1000, toMs: 2000 })).toBe(0);
  });

  it('is negative when the note misses the window', () => {
    expect(overlapMs(note(C, 3000, 100), { fromMs: 0, toMs: 1000 })).toBeLessThan(0);
  });
});

describe('weighPitchClasses', () => {
  it('weighs whole notes by duration without a window', () => {
    const { weights, total } = weighPitchClasses([note(C, 0, 300), note(C + 12, 0, 200), note(G, 0, 100)]);
    expect([weights[0], weights[7], total]).toEqual([500, 100, 600]);
  });

  it('counts only the overlap inside a window', () => {
    const { total } = weighPitchClasses([note(C, 0, 1000)], { window: { fromMs: 250, toMs: 500 } });
    expect(total).toBe(250);
  });

  it('skips notes outside the window', () => {
    const { total } = weighPitchClasses([note(C, 5000, 100)], { window: { fromMs: 0, toMs: 1000 } });
    expect(total).toBe(0);
  });

  it('applies a custom weight', () => {
    const { weights } = weighPitchClasses([note(C, 0, 100)], { weightOf: (_note, ms) => ms * 3 });
    expect(weights[0]).toBe(300);
  });

  it('returns twelve zeros for no notes', () => {
    expect(weighPitchClasses([])).toEqual({ weights: new Array(12).fill(0), total: 0 });
  });
});

describe('triads', () => {
  it('spells C major as C, E, G', () => {
    expect(triadTones(0, false)).toEqual([0, 4, 7]);
  });

  it('spells A minor as A, C, E', () => {
    expect(triadTones(9, true)).toEqual([9, 0, 4]);
  });

  it('reads weights at any integer pitch class', () => {
    const { weights } = weighPitchClasses(chord([C]));
    expect(weightAt(weights, 12)).toBe(weightAt(weights, 0));
  });

  it('scores a sounding triad above an absent one', () => {
    const { weights } = weighPitchClasses(chord([C, E, G]));
    expect(triadFit(weights, 0, false)).toBeGreaterThan(triadFit(weights, 2, false));
  });
});

describe('bestTriad', () => {
  it('finds C major in C–E–G', () => {
    expect(bestTriad(weighPitchClasses(chord([C, E, G])))).toMatchObject({ root: 0, minor: false });
  });

  it('finds A minor in A–C–E', () => {
    expect(bestTriad(weighPitchClasses(chord([A, C + 12, E + 12])))).toMatchObject({ root: 9, minor: true });
  });

  it('lets a trusted bass turn C–E–G into E minor', () => {
    const cMajor = weighPitchClasses(chord([C, E, G]));
    const withoutBass = bestTriad(cMajor);
    const withBass = bestTriad(cMajor, { bassPc: 4, bassBonus: 0.5 });
    expect([withoutBass.root, withBass.root]).toEqual([0, 4]);
  });

  it('keeps the fallback when no triad beats its score', () => {
    const fallback = { root: 7, minor: true, score: Infinity };
    expect(bestTriad(weighPitchClasses(chord([C, E, G])), { fallback })).toBe(fallback);
  });

  it('picks the first triad, C major, when nothing sounds', () => {
    expect(bestTriad({ weights: new Array(12).fill(0), total: 0 })).toMatchObject({ root: 0, minor: false, score: 0 });
  });
});

describe('likeliestRoot', () => {
  const noKey = new Set<number>();

  it('is null when nothing sounds', () => {
    expect(likeliestRoot({ weights: new Array(12).fill(0), total: 0 }, { bass: null, scale: noKey })).toBeNull();
  });

  it('finds the root of a plain triad', () => {
    expect(likeliestRoot(weighPitchClasses(chord([G, G + 4, G + 7])), { bass: null, scale: noKey })).toBe(7);
  });

  it('never picks a root that is not sounding', () => {
    const root = likeliestRoot(weighPitchClasses(chord([E, G])), { bass: null, scale: noKey });
    expect([4, 7]).toContain(root);
  });
});
