import { describe, expect, it } from 'vitest';

import { midiToFrequency, midiToPitchName, OPEN_STRING_MIDI } from '../cello';
import { validateScore } from '../schema';
import { LIBRARY_ROWS, SCORES } from '@/scores';

describe('bundled scores', () => {
  it.each(SCORES.map((s) => [s.id, s] as const))('%s passes structural validation', (_id, score) => {
    expect(validateScore(score)).toEqual([]);
  });

  it.each(SCORES.map((s) => [s.id, s] as const))('%s has self-consistent notes', (_id, score) => {
    for (const note of score.notes) {
      const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
      expect(semitones).toBeGreaterThanOrEqual(0);
      expect(note.pitchName).toBe(midiToPitchName(note.midiNumber, score.metadata.preferFlats));
      expect(note.frequency).toBeCloseTo(midiToFrequency(note.midiNumber), 1);
      // An open string must name finger 0, and vice versa.
      expect(semitones === 0).toBe(note.finger === '0');
    }
  });

  it.each(SCORES.map((s) => [s.id, s] as const))('%s stays inside the cello range', (_id, score) => {
    for (const note of score.notes) {
      expect(note.midiNumber).toBeGreaterThanOrEqual(36); // C2
      expect(note.midiNumber).toBeLessThanOrEqual(84);    // C6
    }
  });

  it('ships only original or public-domain material', () => {
    for (const score of SCORES) {
      expect(score.metadata.rights).toMatch(/Original|[Pp]ublic domain/);
    }
  });

  it('opens the Bach on the right notes', () => {
    const bach = SCORES.find((s) => s.id === 'bwv1007-prelude')!;
    expect(bach.notes.slice(0, 8).map((n) => n.pitchName))
      .toEqual(['G2', 'D3', 'B3', 'A3', 'B3', 'D3', 'B3', 'D3']);
    // Bars 1–4 sit entirely in first position, which is the point of the excerpt.
    expect(new Set(bach.notes.map((n) => n.position))).toEqual(new Set(['1st']));
  });

  it('walks all four first-position tapes in the ladder', () => {
    const ladder = SCORES.find((s) => s.id === 'first-position-ladder')!;
    const semitones = new Set(
      ladder.notes.map((n) => n.midiNumber - OPEN_STRING_MIDI[n.string]),
    );
    expect(semitones).toEqual(new Set([0, 2, 3, 4, 5]));
  });

  it('puts the thumb ladder on the octave harmonic and above', () => {
    const ladder = SCORES.find((s) => s.id === 'thumb-position-ladder')!;
    for (const note of ladder.notes) {
      expect(note.midiNumber - OPEN_STRING_MIDI[note.string]).toBeGreaterThanOrEqual(12);
      expect(note.position).toBe('Thumb');
    }
    expect(ladder.notes.some((n) => n.finger === 'T')).toBe(true);
    // The little finger has no business up here.
    expect(ladder.notes.some((n) => n.finger === '4')).toBe(false);
  });

  it('rejects a bar that does not add up', async () => {
    const { buildScore } = await import('@/scores/build');
    expect(() => buildScore({
      id: 'broken',
      timeSignature: [4, 4],
      metadata: SCORES[0].metadata,
      bars: [[{ s: 'A', n: 0, f: '0', b: 3 }]],
    })).toThrow(/holds 3 beats but 4\/4 needs 4/);
  });

  it('rejects an open string that names a finger', async () => {
    const { buildScore } = await import('@/scores/build');
    expect(() => buildScore({
      id: 'broken',
      timeSignature: [4, 4],
      metadata: SCORES[0].metadata,
      bars: [[{ s: 'A', n: 0, f: '2', b: 4 }]],
    })).toThrow(/open string but names finger 2/);
  });
});

describe('library rows', () => {
  it('marks every unbundled row as unplayable with a reason', () => {
    for (const row of LIBRARY_ROWS.filter((r) => !r.playable)) {
      expect(row.note.length).toBeGreaterThan(10);
      expect(row.bars).toBeNull();
    }
  });

  it('has a unique id per row', () => {
    const ids = LIBRARY_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports the Bach range from its actual notes', () => {
    const row = LIBRARY_ROWS.find((r) => r.id === 'bwv1007-prelude')!;
    expect(row.range).toBe('G2 – C4');
    expect(row.bars).toBe(4);
  });
});
