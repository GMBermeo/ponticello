import { describe, expect, it } from 'vitest';

import { BackingPart } from '@/domain/backing';
import { practiceLoop } from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { buildProgram, estimatePeak, programOffsetSeconds } from '../backing/program';

function score(bars: number, bpm = 120): CelloSongScore {
  const barMs = (60000 / bpm) * 4;
  return {
    schemaVersion: '1.0.0',
    id: 'test',
    metadata: {
      title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
      bpm, difficulty: 'Beginner', tonic: 'C', teaches: '', rights: '',
    },
    measures: Array.from({ length: bars }, (_, index) => ({
      index, startBarTimeMs: index * barMs, durationMs: barMs,
      timeSignature: [4, 4] as [number, number], tempoBpm: bpm,
    })),
    notes: [],
  };
}

function part(notes: [number, number, number][], gain = 1): BackingPart {
  return {
    id: 'p', name: 'p', instrument: 'piano', role: 'accompaniment', gain, muted: false,
    notes: notes.map(([midiNumber, startTimeMs, durationMs]) =>
      ({ midiNumber, startTimeMs, durationMs, velocity: 1 })),
  };
}

const loop4 = practiceLoop(score(4), { loopFromBar: 1, loopToBar: 4, tempoPercent: 100 });

describe('resolving parts into a program', () => {
  it('converts score time to real seconds through the tempo', () => {
    const half = practiceLoop(score(4), { loopFromBar: 1, loopToBar: 4, tempoPercent: 50 });
    const p = buildProgram({ id: 'x', parts: [part([[60, 1000, 500]])], loop: half });
    // Half speed: a note written at 1 s sounds at 2 s and lasts twice as long.
    expect(p.notes[0].atSec).toBeCloseTo(2, 5);
    expect(p.notes[0].holdSec).toBeCloseTo(1, 5);
    expect(p.durationSec).toBeCloseTo(loop4.realDurationMs / 500, 5);
  });

  it('sorts notes by time, because the schedulers walk them in order', () => {
    const p = buildProgram({
      id: 'x',
      parts: [part([[60, 900, 100], [62, 100, 100], [64, 500, 100]])],
      loop: loop4,
    });
    const times = p.notes.map((n) => n.atSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('trims a dense mix so the limiter has somewhere to go', () => {
    // Sixteen voices striking together is what the fifteen-track imported
    // songs do, and untrimmed it peaked at forty.
    const stack = Array.from({ length: 16 }, (_, i) => part([[48 + i, 0, 2000]]));
    const p = buildProgram({ id: 'x', parts: stack, loop: loop4 });
    expect(estimatePeak(p.notes)).toBeLessThanOrEqual(0.73);
  });

  it('leaves a quiet mix alone rather than pumping it up', () => {
    const p = buildProgram({ id: 'x', parts: [part([[60, 0, 500]], 0.2)], loop: loop4 });
    expect(p.notes[0].amplitude).toBeCloseTo(0.2, 5);
  });

  it('gives equivalent music the same key, so a redundant reload is skipped', () => {
    const a = buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: loop4 });
    const b = buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: loop4 });
    expect(a.key).toBe(b.key);
  });

  it('changes key when the music does', () => {
    const a = buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: loop4 });
    const b = buildProgram({ id: 'x', parts: [part([[60, 0, 500], [64, 500, 500]])], loop: loop4 });
    expect(a.key).not.toBe(b.key);
  });

  it('returns an empty program for a loop over nothing', () => {
    const none = practiceLoop(score(0), { loopFromBar: 1, loopToBar: 1, tempoPercent: 100 });
    expect(buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: none }).notes).toHaveLength(0);
  });

  it('wraps a playhead time past the end back into the loop', () => {
    const p = buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: loop4 });
    const oneLoop = loop4.scoreDurationMs;
    expect(programOffsetSeconds(p, loop4, oneLoop + 500)).toBeCloseTo(0.5, 5);
    expect(programOffsetSeconds(p, loop4, -500)).toBeCloseTo((oneLoop - 500) / 1000, 5);
  });
});
