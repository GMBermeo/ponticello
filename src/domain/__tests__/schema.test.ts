import { describe, expect, it } from 'vitest';

import { activeNoteIndex, CelloMeasure, CelloSongScore, measureAt } from '../schema';

/** A score that is nothing but a bar grid — enough for the lookups. */
function grid(barCount: number, barMs = 2000): CelloSongScore {
  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barMs,
    durationMs: barMs,
    timeSignature: [4, 4] as [number, number],
    tempoBpm: 120,
  }));
  return {
    schemaVersion: '1.0.0',
    id: 'grid',
    metadata: {
      title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
      bpm: 120, difficulty: 'Beginner', tonic: 'C', teaches: '', rights: '',
    },
    measures,
    notes: [],
  };
}

describe('measureAt', () => {
  const score = grid(236);

  it('finds the bar a time falls inside', () => {
    expect(measureAt(score, 0)?.index).toBe(0);
    expect(measureAt(score, 1999)?.index).toBe(0);
    expect(measureAt(score, 2000)?.index).toBe(1);
    expect(measureAt(score, 235 * 2000 + 1)?.index).toBe(235);
  });

  it('agrees with a linear scan at every boundary and midpoint', () => {
    const scan = (t: number) => score.measures.find(
      (m) => t >= m.startBarTimeMs && t < m.startBarTimeMs + m.durationMs,
    ) ?? score.measures[score.measures.length - 1];

    for (let bar = 0; bar < score.measures.length; bar++) {
      for (const t of [bar * 2000, bar * 2000 + 1, bar * 2000 + 999, bar * 2000 + 1999]) {
        expect(measureAt(score, t)).toBe(scan(t));
      }
    }
  });

  it('holds on the last bar once the music has run out', () => {
    expect(measureAt(score, 236 * 2000)?.index).toBe(235);
    expect(measureAt(score, 1e9)?.index).toBe(235);
  });

  it('clamps a time before the first bar to the first bar', () => {
    // Negative score time is not reachable from the transport, but the lookup
    // must still answer rather than return undefined.
    expect(measureAt(score, -1)?.index).toBe(235);
  });

  it('returns undefined only for a score with no bars', () => {
    expect(measureAt(grid(0), 0)).toBeUndefined();
  });
});

describe('activeNoteIndex', () => {
  const score: CelloSongScore = {
    ...grid(4),
    notes: [0, 500, 1000, 1500, 3000].map((startTimeMs, i) => ({
      id: `n${i}`,
      midiNumber: 50,
      pitchName: 'D3',
      frequency: 146.83,
      startTimeMs,
      durationMs: 400,
      measureIndex: Math.floor(startTimeMs / 2000),
      string: 'D' as const,
      finger: '0' as const,
      position: '1st' as const,
      bowDirection: 'down' as const,
      articulation: 'arco' as const,
      extension: 'none' as const,
      tie: false,
    })),
  };

  it('returns the note sounding now, or the one just begun', () => {
    expect(activeNoteIndex(score, 0)).toBe(0);
    expect(activeNoteIndex(score, 499)).toBe(0);
    expect(activeNoteIndex(score, 500)).toBe(1);
    expect(activeNoteIndex(score, 2999)).toBe(3);
    expect(activeNoteIndex(score, 99999)).toBe(4);
  });

  it('holds the first note before the music starts', () => {
    expect(activeNoteIndex(score, -100)).toBe(0);
  });
});
