import { describe, expect, it } from 'vitest';

import { BackingPart } from '@/domain/backing';
import {
  clipToLoop, loopBudget, loopOffsetSeconds, MAX_RENDER_SECONDS, practiceLoop,
} from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { inflateBacking, inflateScore } from '@/scores/bundledSongs';
import { COMPACT_SCORES } from '@/scores';

/** A score of `bars` four-beat bars at 60 bpm, so every bar is 4000 ms. */
function scoreOf(bars: number): CelloSongScore {
  return {
    schemaVersion: '1.0.0',
    id: 'test',
    metadata: {
      title: 'Test', composer: '', origin: '', keySignature: 'C MAJOR',
      timeSignature: '4/4', bpm: 60, difficulty: 'Beginner', tonic: 'C',
      teaches: '', rights: '',
    },
    measures: Array.from({ length: bars }, (_, index) => ({
      index,
      startBarTimeMs: index * 4000,
      durationMs: 4000,
      timeSignature: [4, 4] as [number, number],
      tempoBpm: 60,
    })),
    notes: [],
  };
}

function partOf(notes: [number, number, number][]): BackingPart {
  return {
    id: 'p', name: 'p', instrument: 'piano', role: 'accompaniment',
    gain: 1, muted: false,
    notes: notes.map(([midiNumber, startTimeMs, durationMs]) => ({
      midiNumber, startTimeMs, durationMs, velocity: 0.7,
    })),
  };
}

describe('practiceLoop', () => {
  it('resolves a bar range to a score-time window', () => {
    const loop = practiceLoop(scoreOf(8), { loopFromBar: 2, loopToBar: 4, tempoPercent: 100 });
    expect(loop.fromMs).toBe(4000);
    expect(loop.toMs).toBe(16000);
    expect(loop.scoreDurationMs).toBe(12000);
  });

  it('stretches the real duration by the tempo, so 50 % takes twice as long', () => {
    const loop = practiceLoop(scoreOf(8), { loopFromBar: 1, loopToBar: 2, tempoPercent: 50 });
    expect(loop.scoreDurationMs).toBe(8000);
    expect(loop.tempoScale).toBe(0.5);
    expect(loop.realDurationMs).toBe(16000);
  });

  it('clamps bars outside the score rather than producing an empty window', () => {
    const loop = practiceLoop(scoreOf(4), { loopFromBar: 0, loopToBar: 99, tempoPercent: 100 });
    expect(loop.fromBar).toBe(1);
    expect(loop.toBar).toBe(4);
    expect(loop.scoreDurationMs).toBe(16000);
  });

  it('puts a reversed range back the right way round', () => {
    const loop = practiceLoop(scoreOf(8), { loopFromBar: 6, loopToBar: 3, tempoPercent: 100 });
    expect(loop.fromBar).toBe(3);
    expect(loop.toBar).toBe(6);
    expect(loop.scoreDurationMs).toBeGreaterThan(0);
  });

  it('floors the tempo so a stepper held at zero cannot ask for infinite audio', () => {
    const loop = practiceLoop(scoreOf(2), { loopFromBar: 1, loopToBar: 2, tempoPercent: 0 });
    expect(loop.tempoScale).toBe(0.1);
    expect(Number.isFinite(loop.realDurationMs)).toBe(true);
  });

  it('survives a null or empty score', () => {
    expect(practiceLoop(null, { loopFromBar: 1, loopToBar: 4, tempoPercent: 80 }).scoreDurationMs).toBe(0);
    expect(practiceLoop(scoreOf(0), { loopFromBar: 1, loopToBar: 4, tempoPercent: 80 }).realDurationMs).toBe(0);
  });
});

describe('clipToLoop', () => {
  const loop = practiceLoop(scoreOf(8), { loopFromBar: 3, loopToBar: 4, tempoPercent: 100 });
  // Bars 3–4 → 8000 ms to 16000 ms.

  it('drops notes outside the window and rebases the rest to zero', () => {
    const [part] = clipToLoop([partOf([
      [60, 0, 1000],       // bar 1 — gone
      [62, 8000, 1000],    // start of the window
      [64, 12000, 1000],   // middle
      [65, 20000, 1000],   // past the end — gone
    ])], loop);

    expect(part.notes.map((n) => [n.midiNumber, n.startTimeMs])).toEqual([
      [62, 0], [64, 4000],
    ]);
  });

  it('keeps a note struck before the window that is still sounding inside it', () => {
    const [part] = clipToLoop([partOf([[36, 4000, 8000]])], loop);
    expect(part.notes).toHaveLength(1);
    // Struck in bar 2, audible from the loop start, and truncated at the end.
    expect(part.notes[0].startTimeMs).toBe(0);
    expect(part.notes[0].durationMs).toBe(4000);
  });

  it('truncates a note at the loop point so it cannot bleed over the repeat', () => {
    const [part] = clipToLoop([partOf([[60, 14000, 30000]])], loop);
    expect(part.notes[0].startTimeMs).toBe(6000);
    expect(part.notes[0].durationMs).toBe(2000);
  });

  it('discards sub-10 ms remnants, which are clicks rather than notes', () => {
    // A note dying 5 ms after the window opens, and one struck 3 ms before it
    // closes. Both are inaudible as pitch and audible as a click on the repeat.
    const [part] = clipToLoop([partOf([[60, 7995, 10], [62, 15997, 1000]])], loop);
    expect(part.notes).toHaveLength(0);
  });

  it('never returns a note that runs past the window', () => {
    const [part] = clipToLoop([partOf([
      [60, 0, 60000], [62, 9000, 60000], [64, 15999, 60000],
    ])], loop);
    for (const note of part.notes) {
      expect(note.startTimeMs).toBeGreaterThanOrEqual(0);
      expect(note.startTimeMs + note.durationMs).toBeLessThanOrEqual(loop.scoreDurationMs);
    }
  });
});

describe('loopOffsetSeconds', () => {
  const loop = practiceLoop(scoreOf(8), { loopFromBar: 3, loopToBar: 4, tempoPercent: 50 });

  it('is zero at the loop start', () => {
    expect(loopOffsetSeconds(loop, 8000)).toBe(0);
  });

  it('converts score time into real seconds at the chosen tempo', () => {
    // 2000 ms of score time into the window, played at half speed → 4 s.
    expect(loopOffsetSeconds(loop, 10000)).toBe(4);
  });

  it('wraps, because the playhead is a cycle', () => {
    expect(loopOffsetSeconds(loop, 16000)).toBe(0);
    expect(loopOffsetSeconds(loop, 18000)).toBe(4);
    expect(loopOffsetSeconds(loop, 6000)).toBe(12);
  });

  it('is zero for an empty loop rather than NaN', () => {
    expect(loopOffsetSeconds(practiceLoop(null, { loopFromBar: 1, loopToBar: 1, tempoPercent: 100 }), 500)).toBe(0);
  });
});

describe('loopBudget', () => {
  it('passes an ordinary practice loop', () => {
    const loop = practiceLoop(scoreOf(8), { loopFromBar: 1, loopToBar: 4, tempoPercent: 80 });
    expect(loopBudget(loop).withinBudget).toBe(true);
  });

  it('refuses a window too long to synthesise, and says why', () => {
    const loop = practiceLoop(scoreOf(200), { loopFromBar: 1, loopToBar: 200, tempoPercent: 40 });
    const budget = loopBudget(loop);
    expect(budget.withinBudget).toBe(false);
    expect(budget.seconds).toBeGreaterThan(MAX_RENDER_SECONDS);
    expect(budget.message).toContain('too long');
  });
});

/**
 * The bug this module exists for.
 *
 * Every bundled piece ships with `source: 'imported'` backing parts covering
 * the whole piece. Those parts used to bypass clipping entirely, so a four-bar
 * loop was accompanied by the entire movement: minutes of audio against
 * seconds of playhead, desynchronised from the first beat and large enough to
 * exhaust memory on the way there.
 */
describe('imported backings are clipped like everything else', () => {
  const longest = COMPACT_SCORES.reduce((worst, candidate) => {
    const end = (c: typeof candidate) => c.notes.reduce((m, n) => Math.max(m, n[1] + n[2]), 0);
    return end(candidate) > end(worst) ? candidate : worst;
  });

  it('clips the longest bundled piece down to its four-bar loop', () => {
    const score = inflateScore(longest);
    const backing = inflateBacking(longest);
    const loop = practiceLoop(score, { loopFromBar: 1, loopToBar: 4, tempoPercent: 80 });

    const clipped = clipToLoop(backing.parts, loop);
    const soundingMs = clipped.reduce(
      (max, part) => part.notes.reduce((m, n) => Math.max(m, n.startTimeMs + n.durationMs), max),
      0,
    );

    // The piece itself is minutes long; the loop is a handful of seconds.
    expect(backing.durationMs).toBeGreaterThan(60_000);
    expect(soundingMs).toBeLessThanOrEqual(loop.scoreDurationMs);
    expect(loopBudget(loop).withinBudget).toBe(true);
  });

  it('renders a loop-sized buffer for every bundled piece at the slowest tempo', () => {
    for (const compact of COMPACT_SCORES) {
      const score = inflateScore(compact);
      const loop = practiceLoop(score, { loopFromBar: 1, loopToBar: 4, tempoPercent: 40 });
      // Four bars at 40 % is the worst ordinary case, and it must stay well
      // inside the budget for every piece that ships.
      expect(loopBudget(loop).withinBudget).toBe(true);
    }
  }, 60_000);
});
