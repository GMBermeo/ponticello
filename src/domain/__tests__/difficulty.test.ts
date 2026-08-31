import { describe, expect, it } from 'vitest';

import { stopDistanceMm } from '../cello';
import {
  difficultyBlurb, difficultyOf, measure, tierFor,
} from '../difficulty';
import {
  firstPositionFingering, handSemitones, MINIMAL_TRAVEL_WEIGHTS, RawNoteEvent, solveFingering,
} from '../fingering';
import { COMPACT_SCORES } from '@/scores/bundledSongs';

/** A line of quarter notes at 120 bpm. */
function line(midis: number[], stepMs = 500, durationMs = 450): RawNoteEvent[] {
  return midis.map((midiNumber, i) => ({
    midiNumber, startTimeMs: i * stepMs, durationMs,
  }));
}

function solved(notes: RawNoteEvent[]) {
  return solveFingering(notes, MINIMAL_TRAVEL_WEIGHTS).states;
}

/** Total millimetres the hand travels under a given set of placements. */
function travelMm(states: { finger: string }[] | ReturnType<typeof solved>): number {
  let mm = 0;
  for (let i = 1; i < states.length; i++) {
    const a = states[i - 1] as never;
    const b = states[i] as never;
    if ((a as { finger: string }).finger === '0') continue;
    if ((b as { finger: string }).finger === '0') continue;
    mm += Math.abs(stopDistanceMm(handSemitones(b)) - stopDistanceMm(handSemitones(a)));
  }
  return mm;
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
    // The open C and the open A: three strings apart, so the crossing cannot
    // be avoided by choosing a different placement.
    const notes = line([36, 57, 36, 57]);
    const f = measure(notes, solved(notes));
    expect(f.wideCrossingsPerSec).toBeGreaterThan(0);
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
    expect(tierFor(25)).toBe('Intermediate');
    expect(tierFor(40)).toBe('Advanced');
    expect(tierFor(90)).toBe('Expert');
  });
});

describe('the solver keeps the hand still', () => {
  /**
   * The claim the library rests on: solving the whole line beats fingering it
   * one note at a time. `firstPositionFingering` answers "where would a
   * beginner put this note" with no idea what comes next, so a line that dips
   * and returns sends the hand down and back for a single note.
   */
  it('travels less than the note-at-a-time mapping across the whole library', () => {
    let solvedTotal = 0;
    let naiveTotal = 0;
    let worse = 0;

    for (const raw of COMPACT_SCORES) {
      const notes: RawNoteEvent[] = raw.notes.map(
        ([midiNumber, startTimeMs, durationMs]) => ({ midiNumber, startTimeMs, durationMs }),
      );
      const a = travelMm(solveFingering(notes, MINIMAL_TRAVEL_WEIGHTS).states);
      const b = travelMm(notes.map((n) => firstPositionFingering(n.midiNumber)));
      solvedTotal += a;
      naiveTotal += b;
      if (a > b + 1e-6) worse++;
    }

    console.log(
      `hand travel across 258 songs: solved ${Math.round(solvedTotal / 1000)} m,`,
      `note-at-a-time ${Math.round(naiveTotal / 1000)} m,`,
      `saved ${Math.round((1 - solvedTotal / naiveTotal) * 100)}%,`,
      `songs made worse: ${worse}`,
    );

    // Not marginally less — an order of magnitude less. The note-at-a-time
    // mapping rocks between half and first position for the length of every
    // piece; the solver anchors the hand and leaves it there.
    expect(solvedTotal).toBeLessThan(naiveTotal * 0.2);
    expect(worse).toBeLessThan(COMPACT_SCORES.length * 0.05);
  });

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
