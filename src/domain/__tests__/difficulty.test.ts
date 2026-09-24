import { describe, expect, it } from 'vitest';

import {
  difficultyBlurb, difficultyOf, measure, tierFor,
} from '../difficulty';
import {
  ARRANGEMENT_WEIGHTS, CelloState, RawNoteEvent, solveFingering,
} from '../fingering';
import { COMPACT_SCORES, LIBRARY_EDITION } from '@scores';

/** Size thresholds describe the full library; the free edition ships a dozen pieces. */
const FULL_LIBRARY = LIBRARY_EDITION.id === 'full';

/** A line of quarter notes at 120 bpm. */
function line(midis: number[], stepMs = 500, durationMs = 450): RawNoteEvent[] {
  return midis.map((midiNumber, i) => ({
    midiNumber, startTimeMs: i * stepMs, durationMs,
  }));
}

function solved(notes: RawNoteEvent[]) {
  return solveFingering(notes, ARRANGEMENT_WEIGHTS).states;
}

describe('measuring what the hand does', () => {
  it('finds no travel in a line that never leaves a position', () => {
    // D3 E3 F#3 G3 — the whole first-position frame on the D string.
    const notes = line([50, 52, 54, 55]);
    const f = measure(notes, solved(notes));
    expect(f.travelMmPerSec).toBe(0);
    expect(f.shiftsPerSec).toBe(0);
  });

  it('counts open strings as no movement at all', () => {
    // Nothing here stops the string, so the hand has not moved even though the
    // pitch has travelled two octaves.
    const notes = line([36, 43, 50, 57]);
    const f = measure(notes, solved(notes));
    expect(f.travelMmPerSec).toBe(0);
  });

  it('measures shifts in millimetres, not in position numbers', () => {
    // First position to somewhere well up the A string and back.
    const notes = line([50, 52, 74, 76, 50], 400, 350);
    const f = measure(notes, solved(notes));
    expect(f.travelMmPerSec).toBeGreaterThan(0);
    expect(f.maxShiftMm).toBeGreaterThan(20);
  });

  it('notices when the shifts are hurried', () => {
    // Both pitches have to be *stopped* for this to be a shift at all: an open
    // string is not a hand position, so a line that alternates with one would
    // register no shifts however fast it went.
    const line53to72 = (stepMs: number, durationMs: number) =>
      line([53, 72, 53, 72], stepMs, durationMs);
    const slow = line53to72(1400, 1300);
    const fast = line53to72(120, 100);

    expect(measure(slow, solved(slow)).shiftsPerSec).toBeGreaterThan(0);
    expect(measure(fast, solved(fast)).hurriedShiftShare)
      .toBeGreaterThan(measure(slow, solved(slow)).hurriedShiftShare);
  });

  it('counts a skipped string as a wide crossing', () => {
    // States are given rather than solved. The subject here is `measure`, and
    // a solved line cannot be relied on to contain a wide crossing — avoiding
    // them is exactly what the solver is for, and given open C against A3 it
    // now takes the A on the D string to keep the bow closer.
    const notes = line([36, 57, 36, 57]);
    const open = (string: 'C' | 'A'): CelloState => ({
      string, position: '1st', finger: '0', extension: 'none', baseSemitones: 2,
    });
    const states = [open('C'), open('A'), open('C'), open('A')];
    expect(measure(notes, states).wideCrossingsPerSec).toBeGreaterThan(0);
  });

  it('reports nothing for an empty line rather than dividing by zero', () => {
    const f = measure([], []);
    expect(f.travelMmPerSec).toBe(0);
    expect(Number.isFinite(f.notesPerSec)).toBe(true);
  });
});

describe('scoring and tiers', () => {
  it('puts a slow open-string study at the bottom', () => {
    const notes = line([36, 43, 50, 57], 2000, 1900);
    const report = difficultyOf(notes, solved(notes));
    expect(report.tier).toBe('Beginner');
    expect(report.score).toBeLessThan(20);
  });

  it('puts a fast two-octave line with constant shifting at the top', () => {
    const midis: number[] = [];
    for (let i = 0; i < 120; i++) midis.push(i % 2 === 0 ? 38 + (i % 12) : 72 - (i % 14));
    const notes = line(midis, 110, 95);
    const report = difficultyOf(notes, solved(notes));
    expect(report.tier).toBe('Expert');
  });

  it('scores the same notes harder when they are played faster', () => {
    const midis = [38, 45, 52, 59, 48, 41, 55, 62, 44, 51];
    const slow = line(midis, 900, 850);
    const fast = line(midis, 150, 130);
    expect(difficultyOf(fast, solved(fast)).score)
      .toBeGreaterThan(difficultyOf(slow, solved(slow)).score);
  });

  it('names what makes a piece hard, so the tier can explain itself', () => {
    const notes = line(Array.from({ length: 60 }, (_, i) => 38 + ((i * 7) % 26)), 130, 110);
    const report = difficultyOf(notes, solved(notes));
    expect(report.drivers.length).toBeGreaterThan(0);
    expect(difficultyBlurb(report)).not.toBe('');
  });

  it('maps scores onto the four tiers in order', () => {
    expect(tierFor(0)).toBe('Beginner');
    expect(tierFor(15)).toBe('Intermediate');
    expect(tierFor(40)).toBe('Advanced');
    expect(tierFor(90)).toBe('Expert');
  });
});

describe('the solver keeps full catalogue lines playable', () => {
  it('finds one valid standard-tuning state for every note in all 258 songs', () => {
    let noteCount = 0;
    for (const raw of COMPACT_SCORES) {
      const notes: RawNoteEvent[] = raw.notes.map(
        ([midiNumber, startTimeMs, durationMs]) => ({ midiNumber, startTimeMs, durationMs }),
      );
      const states = solveFingering(notes).states;
      expect(states.length, raw.id).toBe(notes.length);
      expect(states.every(Boolean), raw.id).toBe(true);
      expect(notes.every((note) => note.midiNumber >= 36 && note.midiNumber <= 81), raw.id).toBe(true);
      noteCount += notes.length;
    }
    expect(noteCount).toBeGreaterThan(FULL_LIBRARY ? 10_000 : 0);
  }, 60_000);

  it('prefers a string crossing to a shift when the shift is the longer move', () => {
    // A3 (57, open) then E3 (52). E3 is a fourth-position stretch on the A
    // string and an open-hand note on the D — the solver should cross.
    const notes = line([57, 52, 57, 52]);
    const states = solved(notes);
    expect(states[1].string).toBe('D');
    expect(states[1].position).toBe('1st');
  });

  it('never puts the little finger in thumb position', () => {
    const notes = line([69, 72, 74, 76, 79], 260, 220);
    for (const state of solved(notes)) {
      expect(state.position === 'Thumb' && state.finger === '4').toBe(false);
    }
  });
});
