import { describe, expect, it } from 'vitest';

import {
  buildMeasures, decomposeDuration, detectRepeats, engrave, locateMeasure, quantiseScore,
  SIXTEENTHS_PER_BEAT,
} from '../engrave';
import { CelloNote, CelloSongScore } from '../schema';
import { COMPACT_SCORES, inflateScore, BWV1007_PRELUDE } from '@scores';

/** A 4/4 score at 60 bpm, so one beat is 1000 ms and a sixteenth is 250 ms. */
function scoreOf(notes: { midi: number; startMs: number; durMs: number }[]): CelloSongScore {
  const barMs = 4000;
  const total = notes.reduce((m, n) => Math.max(m, n.startMs + n.durMs), barMs);
  const bars = Math.max(1, Math.ceil(total / barMs));
  return {
    schemaVersion: '1.0.0',
    id: 'test',
    metadata: {
      title: 'T', composer: '', origin: '', keySignature: 'C MAJOR',
      timeSignature: '4/4', bpm: 60, difficulty: 'Beginner', tonic: 'C',
      teaches: '', rights: '',
    },
    measures: Array.from({ length: bars }, (_, index) => ({
      index, startBarTimeMs: index * barMs, durationMs: barMs,
      timeSignature: [4, 4] as [number, number], tempoBpm: 60,
    })),
    notes: notes.map((n, i): CelloNote => ({
      id: `n${i}`, startTimeMs: n.startMs, durationMs: n.durMs,
      pitchName: 'C3', midiNumber: n.midi, frequency: 130.81,
      string: 'G', finger: '1', position: '1st', extension: 'none',
      articulation: 'arco', tie: false, measureIndex: Math.floor(n.startMs / barMs),
    })),
  };
}

describe('decomposeDuration', () => {
  it('writes exact values as one glyph', () => {
    expect(decomposeDuration(16)).toEqual([{ sixteenths: 16, dots: 0 }]);
    expect(decomposeDuration(4)).toEqual([{ sixteenths: 4, dots: 0 }]);
    expect(decomposeDuration(1)).toEqual([{ sixteenths: 1, dots: 0 }]);
  });

  it('uses a dot rather than a tie where a dot will do', () => {
    expect(decomposeDuration(6)).toEqual([{ sixteenths: 6, dots: 1 }]);
    expect(decomposeDuration(3)).toEqual([{ sixteenths: 3, dots: 1 }]);
  });

  it('ties what no single notehead can express', () => {
    // 5 sixteenths: a crotchet tied to a semiquaver.
    expect(decomposeDuration(5)).toEqual([
      { sixteenths: 4, dots: 0 }, { sixteenths: 1, dots: 0 },
    ]);
  });

  it('always yields at least one glyph, and the right total', () => {
    for (let n = 1; n <= 32; n++) {
      const parts = decomposeDuration(n);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.reduce((s, p) => s + p.sixteenths, 0)).toBe(n);
    }
  });
});

describe('quantiseScore', () => {
  it('snaps sloppy timings onto the grid', () => {
    // 250 ms is one sixteenth at 60 bpm. These are all within half a grid unit.
    const q = quantiseScore(scoreOf([
      { midi: 48, startMs: 0, durMs: 260 },
      { midi: 50, startMs: 240, durMs: 255 },
      { midi: 52, startMs: 505, durMs: 245 },
    ]));
    expect(q.map((n) => n.start)).toEqual([0, 1, 2]);
    expect(q.every((n) => n.length >= 1)).toBe(true);
  });

  it('never lets two notes overlap after quantising', () => {
    const q = quantiseScore(scoreOf([
      { midi: 48, startMs: 0, durMs: 3000 },
      { midi: 50, startMs: 500, durMs: 1000 },
    ]));
    for (let i = 1; i < q.length; i++) {
      expect(q[i - 1].start + q[i - 1].length).toBeLessThanOrEqual(q[i].start);
    }
  });

  it('separates two notes that quantise to the same instant', () => {
    // A chord in the source, or two notes a few ms apart. Left overlapping,
    // these overfill the bar they land in.
    const q = quantiseScore(scoreOf([
      { midi: 48, startMs: 0, durMs: 1000 },
      { midi: 52, startMs: 10, durMs: 1000 },
      { midi: 55, startMs: 20, durMs: 1000 },
    ]));
    for (let i = 1; i < q.length; i++) {
      expect(q[i].start).toBeGreaterThanOrEqual(q[i - 1].start + q[i - 1].length);
    }
  });

  it('gives a note that quantises to nothing a single sixteenth', () => {
    const q = quantiseScore(scoreOf([{ midi: 48, startMs: 0, durMs: 5 }]));
    expect(q[0]).toHaveLength(1);
  });
});

describe('buildMeasures', () => {
  const barSixteenths = 4 * SIXTEENTHS_PER_BEAT;

  it('fills every bar exactly', () => {
    const score = scoreOf([
      { midi: 48, startMs: 0, durMs: 1000 },
      { midi: 50, startMs: 2000, durMs: 1000 },
    ]);
    for (const m of buildMeasures(score, quantiseScore(score))) {
      const total = m.glyphs.reduce((s, g) => s + g.sixteenths, 0);
      expect(total).toBe(barSixteenths);
    }
  });

  it('writes rests into the gaps', () => {
    const score = scoreOf([{ midi: 48, startMs: 0, durMs: 1000 }]);
    const [bar] = buildMeasures(score, quantiseScore(score));
    expect(bar.glyphs.some((g) => g.kind === 'rest')).toBe(true);
  });

  it('ties a note that crosses a barline instead of truncating it', () => {
    // Starts on beat 4 of bar 1 and lasts two beats.
    const score = scoreOf([{ midi: 48, startMs: 3000, durMs: 2000 }]);
    const bars = buildMeasures(score, quantiseScore(score));
    const last = bars[0].glyphs[bars[0].glyphs.length - 1];
    const first = bars[1].glyphs[0];
    expect(last.kind).toBe('note');
    expect(first.kind).toBe('note');
    if (last.kind === 'note' && first.kind === 'note') {
      expect(last.tiedTo).toBe(true);
      expect(first.tiedFrom).toBe(true);
      expect(first.noteIndex).toBe(last.noteIndex);
    }
  });

  it('beams quavers within a beat but never across one', () => {
    // Eight quavers: four beams of two, not one beam of eight.
    const notes = Array.from({ length: 8 }, (_, i) => ({
      midi: 48 + i, startMs: i * 500, durMs: 500,
    }));
    const score = scoreOf(notes);
    const [bar] = buildMeasures(score, quantiseScore(score));
    expect(bar.beams).toHaveLength(4);
    for (const [from, to] of bar.beams) expect(to - from).toBe(1);
  });

  it('keeps every glyph pointing at its source note', () => {
    const score = scoreOf([
      { midi: 48, startMs: 0, durMs: 1000 },
      { midi: 50, startMs: 1000, durMs: 1000 },
    ]);
    const glyphs = buildMeasures(score, quantiseScore(score)).flatMap((m) => m.glyphs);
    for (const g of glyphs) {
      if (g.kind === 'note') expect(score.notes[g.noteIndex]).toBeDefined();
    }
  });
});

describe('detectRepeats', () => {
  const bar = (key: number) => ({
    index: key, sixteenths: 16, beams: [] as [number, number][],
    glyphs: [{ kind: 'rest' as const, sixteenths: 16, dots: 0 as const, offset: 0 }],
  });
  /** Distinguishable bars: rest length stands in for content. */
  const barOf = (len: number, index: number) => ({
    index, sixteenths: 16, beams: [] as [number, number][],
    glyphs: [{ kind: 'rest' as const, sixteenths: len, dots: 0 as const, offset: 0 }],
  });

  it('collapses an immediately repeated two-bar phrase', () => {
    const measures = [barOf(1, 0), barOf(2, 1), barOf(1, 2), barOf(2, 3)];
    const [block] = detectRepeats(measures);
    expect(block.measures).toHaveLength(2);
    expect(block.times).toBe(2);
    expect(block.from).toBe(0);
    expect(block.to).toBe(3);
  });

  it('counts more than two passes', () => {
    const measures = [
      barOf(1, 0), barOf(2, 1), barOf(1, 2), barOf(2, 3), barOf(1, 4), barOf(2, 5),
    ];
    expect(detectRepeats(measures)[0].times).toBe(3);
  });

  it('leaves a single repeated bar alone', () => {
    // One bar repeating is not worth two repeat barlines.
    const blocks = detectRepeats([bar(0), bar(1)]);
    expect(blocks.every((b) => b.times === 1)).toBe(true);
  });

  it('covers every source measure exactly once', () => {
    const measures = Array.from({ length: 9 }, (_, i) => barOf(i % 3, i));
    const blocks = detectRepeats(measures);
    const covered = blocks.reduce((n, b) => n + (b.to - b.from + 1), 0);
    expect(covered).toBe(9);
  });
});

describe('locateMeasure', () => {
  it('maps a source bar onto its written bar and pass', () => {
    const score = scoreOf(
      // Two identical two-bar phrases: bars 0-1 and 2-3.
      [0, 1, 2, 3].flatMap((bar) => [
        { midi: 48, startMs: bar * 4000, durMs: 2000 },
        { midi: 50, startMs: bar * 4000 + 2000, durMs: 2000 },
      ]),
    );
    const e = engrave(score);
    const at0 = locateMeasure(e, 0);
    const at2 = locateMeasure(e, 2);
    expect(at0).not.toBeNull();
    expect(at2).not.toBeNull();
    // Bar 2 is the same written bar as bar 0, on a later pass.
    expect(at2!.block).toBe(at0!.block);
    expect(at2!.measureInBlock).toBe(at0!.measureInBlock);
    expect(at2!.pass).toBeGreaterThan(at0!.pass);
  });

  it('returns null for a bar past the end', () => {
    const e = engrave(scoreOf([{ midi: 48, startMs: 0, durMs: 1000 }]));
    expect(locateMeasure(e, 999)).toBeNull();
  });
});

describe('engrave survives the real library', () => {
  it('engraves the hand-authored Bach into full bars', () => {
    const e = engrave(BWV1007_PRELUDE);
    expect(e.writtenMeasures).toBeGreaterThan(0);
    for (const block of e.blocks) {
      for (const m of block.measures) {
        expect(m.glyphs.reduce((s, g) => s + g.sixteenths, 0)).toBe(e.barSixteenths);
      }
    }
  });

  it('engraves every bundled song without throwing, with every bar full', () => {
    for (const compact of COMPACT_SCORES) {
      const e = engrave(inflateScore(compact));
      expect(e.blocks.length).toBeGreaterThan(0);
      for (const block of e.blocks) {
        for (const m of block.measures) {
          const total = m.glyphs.reduce((s, g) => s + g.sixteenths, 0);
          expect(total, `${compact.id} bar ${m.index}`).toBe(e.barSixteenths);
        }
      }
    }
  }, 60_000);

  it('shortens the page by collapsing repeats', () => {
    // Across the library, written bars should come out below source bars.
    let written = 0;
    let source = 0;
    for (const compact of COMPACT_SCORES.slice(0, 60)) {
      const e = engrave(inflateScore(compact));
      written += e.writtenMeasures;
      source += e.sourceMeasures;
    }
    expect(written).toBeLessThan(source);
  });
});
