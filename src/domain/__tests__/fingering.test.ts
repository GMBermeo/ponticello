import { describe, expect, it } from 'vitest';

import { OPEN_STRING_MIDI } from '../cello';
import {
  candidateStates, detectShifts, emissionCost, RawNoteEvent, solveFingering, transitionCost,
} from '../fingering';

const at = (midiNumber: number, startTimeMs: number, durationMs = 400): RawNoteEvent =>
  ({ midiNumber, startTimeMs, durationMs });

describe('candidate generation', () => {
  it('offers the open string when the pitch is one', () => {
    const open = candidateStates(OPEN_STRING_MIDI.A).filter((c) => c.finger === '0');
    expect(open).toHaveLength(1);
    expect(open[0].string).toBe('A');
  });

  it('finds the same pitch on more than one string', () => {
    // D4 is reachable on the A string and, higher up, on the D string.
    const strings = new Set(candidateStates(62).map((c) => c.string));
    expect(strings.has('A')).toBe(true);
    expect(strings.has('D')).toBe(true);
  });

  it('offers extensions only where the hand can make them', () => {
    const forward = candidateStates(61).filter((c) => c.extension === 'forward');
    expect(forward.every((c) => ['Half', '1st', '2nd', '3rd', '4th'].includes(c.position))).toBe(true);
  });

  it('offers thumb position only in the upper register', () => {
    // D3 is physically reachable in thumb position on the C string, but no
    // cellist goes there — the neck covers it — so it is not a candidate.
    expect(candidateStates(50).some((c) => c.position === 'Thumb')).toBe(false);
    expect(candidateStates(74).some((c) => c.position === 'Thumb')).toBe(true);
  });

  it('distinguishes thumb placements by where the thumb actually sits', () => {
    const thumbStates = candidateStates(74).filter((c) => c.position === 'Thumb');
    const bases = new Set(thumbStates.map((c) => c.baseSemitones));
    // More than one place to park the thumb, and each is its own state — which
    // is what lets a thumb move count as a shift.
    expect(bases.size).toBeGreaterThan(1);
    expect([...bases].every((b) => b !== undefined && b >= 12)).toBe(true);
  });

  it('returns nothing for a pitch below the C string', () => {
    expect(candidateStates(30)).toHaveLength(0);
  });
});

describe('cost model', () => {
  it('prefers first position to the upper neck', () => {
    const note = at(59, 0);
    const first = emissionCost({ string: 'A', position: '1st', finger: '1', extension: 'none' }, note);
    const sixth = emissionCost({ string: 'D', position: '6th', finger: '1', extension: 'none' }, note);
    expect(first).toBeLessThan(sixth);
  });

  it('charges more for a forward extension than a backward one', () => {
    // Compared within one position, so the position term cancels and only the
    // extension is under test.
    const note = at(61, 0);
    const base = { string: 'A' as const, position: '1st' as const, finger: '2' as const };
    const forward = emissionCost({ ...base, extension: 'forward' }, note);
    const backward = emissionCost({ ...base, extension: 'backward' }, note);
    const none = emissionCost({ ...base, extension: 'none' }, note);
    expect(forward).toBeGreaterThan(backward);
    expect(backward).toBeGreaterThan(none);
  });

  it('prices thumb position out of the low register', () => {
    const low = at(50, 0);
    const thumb = emissionCost({ string: 'C', position: 'Thumb', finger: '1', extension: 'none' }, low);
    const open = emissionCost({ string: 'D', position: '1st', finger: '0', extension: 'none' }, low);
    expect(thumb).toBeGreaterThan(open);
  });

  it('measures a shift by arm travel, not by counting positions', () => {
    const at1st = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 2 };
    const at2nd = { ...at1st, position: '2nd' as const, baseSemitones: 4 };
    const at6th = { ...at1st, position: '6th' as const, baseSemitones: 11 };
    const at7th = { ...at1st, position: '7th' as const, baseSemitones: 12 };

    // First to second is 67 mm of travel; sixth to seventh is 15 mm. Counting
    // positions would call them equal.
    expect(transitionCost(at1st, at2nd, 400)).toBeGreaterThan(transitionCost(at6th, at7th, 400));
  });

  it('treats nudging the thumb as cheaper than a neck shift', () => {
    const thumbLow = { string: 'A' as const, position: 'Thumb' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 12 };
    const thumbHigh = { ...thumbLow, baseSemitones: 14 };
    const first = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 2 };
    const fourth = { ...first, position: '4th' as const, baseSemitones: 7 };

    expect(transitionCost(thumbLow, thumbHigh, 300))
      .toBeLessThan(transitionCost(first, fourth, 300));
    // …but it is still a move, not free.
    expect(transitionCost(thumbLow, thumbHigh, 300)).toBeGreaterThan(0);
  });

  it('tolerates an open string when it is short and resists when it is long', () => {
    const state = { string: 'A' as const, position: '1st' as const, finger: '0' as const, extension: 'none' as const };
    expect(emissionCost(state, at(57, 0, 120))).toBeLessThan(emissionCost(state, at(57, 0, 1200)));
  });

  it('all but forbids the little finger in thumb position', () => {
    const thumb4 = emissionCost({ string: 'A', position: 'Thumb', finger: '4', extension: 'none' }, at(74, 0));
    const thumb3 = emissionCost({ string: 'A', position: 'Thumb', finger: '3', extension: 'none' }, at(74, 0));
    expect(thumb4 - thumb3).toBeGreaterThan(5);
  });

  it('charges nothing to stay put and most to skip three strings', () => {
    const a = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const };
    const c = { ...a, string: 'C' as const };
    expect(transitionCost(a, a, 500)).toBe(0);
    expect(transitionCost(a, c, 500)).toBeGreaterThan(6);
  });

  it('makes the same shift dearer when there is less time', () => {
    const first = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const };
    const fourth = { ...first, position: '4th' as const };
    expect(transitionCost(first, fourth, 60)).toBeGreaterThan(transitionCost(first, fourth, 1000));
  });
});

describe('solveFingering', () => {
  it('keeps a first-position D major scale in first position', () => {
    const scale = [50, 52, 54, 55, 57, 59, 61, 62].map((m, i) => at(m, i * 400));
    const { states } = solveFingering(scale);

    expect(states).toHaveLength(8);
    for (const state of states) {
      expect(['Half', '1st']).toContain(state.position);
    }
    // Open D and open A should be taken as open strings.
    expect(states[0].finger).toBe('0');
    expect(states[4].finger).toBe('0');
  });

  it('does not shift for a single note it could reach without moving', () => {
    const line = [57, 59, 60, 59, 57].map((m, i) => at(m, i * 300));
    const positions = new Set(solveFingering(line).states.map((s) => s.position));
    expect(positions.size).toBeLessThanOrEqual(2);
  });

  it('goes to thumb position for a high passage rather than crawling up the neck', () => {
    const high = [69, 71, 73, 74, 73, 71].map((m, i) => at(m, i * 350));
    const states = solveFingering(high).states;
    expect(states.some((s) => s.position === 'Thumb')).toBe(true);
    expect(states.every((s) => s.finger !== '4' || s.position !== 'Thumb')).toBe(true);
  });

  it('returns one state per note', () => {
    const line = Array.from({ length: 40 }, (_, i) => at(50 + (i % 13), i * 200));
    expect(solveFingering(line).states).toHaveLength(40);
  });

  it('handles an empty line', () => {
    expect(solveFingering([])).toEqual({ states: [], totalCost: 0 });
  });

  it('refuses a pitch no cello can play', () => {
    expect(() => solveFingering([at(24, 0)])).toThrow(/not playable on a cello/);
  });
});

describe('detectShifts', () => {
  it('reports the move and how much warning it gets', () => {
    const notes = [at(59, 0), at(76, 500)];
    const states = [
      { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const },
      { string: 'A' as const, position: 'Thumb' as const, finger: '2' as const, extension: 'none' as const },
    ];
    const [shift] = detectShifts(notes, states);

    expect(shift.from).toBe('1st');
    expect(shift.to).toBe('Thumb');
    expect(shift.direction).toBe('up');
    expect(shift.preparationMs).toBe(500);
  });

  it('does not call an open string a shift', () => {
    const notes = [at(57, 0), at(50, 300)];
    const states = [
      { string: 'A' as const, position: '4th' as const, finger: '1' as const, extension: 'none' as const },
      { string: 'D' as const, position: '1st' as const, finger: '0' as const, extension: 'none' as const },
    ];
    expect(detectShifts(notes, states)).toHaveLength(0);
  });
});
