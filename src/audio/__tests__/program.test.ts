import { describe, expect, it } from 'vitest';

import { BackingPart } from '@/domain/backing';
import { loopOffsetSeconds, practiceLoop } from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { buildProgram, estimatePeak, notesActiveAtOffset, resolveAudibleProgram } from '../backing/program';
import { renderProgramInto } from '../synth';

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

  it('changes key for pitch, timing, hold, instrument, or amplitude changes', () => {
    const base = buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: loop4 });
    const variants = [
      part([[61, 0, 500]]),
      part([[60, 10, 500]]),
      part([[60, 0, 510]]),
      { ...part([[60, 0, 500]]), instrument: 'strings' as const },
      part([[60, 0, 500]], 0.9),
    ];
    for (const variant of variants) {
      expect(buildProgram({ id: 'x', parts: [variant], loop: loop4 }).key).not.toBe(base.key);
    }
  });

  it('canonicalises part and simultaneous-note order in the key', () => {
    const one = part([[60, 0, 500], [64, 0, 500]]);
    const two = { ...part([[67, 500, 500]]), id: 'q' };
    const a = buildProgram({ id: 'x', parts: [one, two], loop: loop4 });
    const b = buildProgram({
      id: 'x',
      parts: [two, { ...one, notes: [...one.notes].reverse() }],
      loop: loop4,
    });
    expect(a.key).toBe(b.key);
  });

  it('bounds a coherent sixteen-voice native render before WAV encoding', () => {
    const stack = Array.from({ length: 16 }, () => part([[60, 0, 1500]]));
    const program = buildProgram({ id: 'dense', parts: stack, loop: loop4 });
    const out = new Float32Array(22_050 * 2);
    renderProgramInto(out, program, 0, 22_050);
    const peak = out.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(peak).toBeLessThan(0.9);
  });

  it('renders adjacent native slices identically to one continuous buffer', () => {
    const program = buildProgram({
      id: 'slices',
      parts: [part([[60, 900, 1500], [64, 1800, 900], [67, 2400, 700]])],
      loop: loop4,
    });
    const sampleRate = 22_050;
    const split = Math.floor(sampleRate * 1.37);
    const length = sampleRate * 4;
    const whole = new Float32Array(length);
    const first = new Float32Array(split);
    const second = new Float32Array(length - split);

    renderProgramInto(whole, program, 0, sampleRate);
    renderProgramInto(first, program, 0, sampleRate);
    renderProgramInto(second, program, split, sampleRate);

    let maxDifference = 0;
    for (let index = 0; index < length; index++) {
      const sliced = index < split ? first[index] : second[index - split];
      maxDifference = Math.max(maxDifference, Math.abs((whole[index] ?? 0) - (sliced ?? 0)));
    }
    expect(maxDifference).toBeLessThan(1e-7);
  });

  /**
   * The bowed voices are the ones that can break this. A cello note carries
   * vibrato, bow noise and a per-note detune, all of which have to be pure
   * functions of the note's own sample index — if any of them accumulated,
   * a note split across a slice boundary would not rejoin, and the join is
   * audible as a click.
   */
  it('renders a bowed note split mid-vibrato identically to one pass', () => {
    const cello = {
      ...part([[48, 0, 3500], [55, 200, 3000]]),
      instrument: 'cello' as const,
    };
    const program = buildProgram({ id: 'bowed', parts: [cello], loop: loop4 });
    const sampleRate = 22_050;
    // Well past the 260 ms vibrato onset, and not on a vibrato-block boundary.
    const split = Math.floor(sampleRate * 1.617) + 7;
    const length = sampleRate * 4;
    const whole = new Float32Array(length);
    const first = new Float32Array(split);
    const second = new Float32Array(length - split);

    renderProgramInto(whole, program, 0, sampleRate);
    renderProgramInto(first, program, 0, sampleRate);
    renderProgramInto(second, program, split, sampleRate);

    let maxDifference = 0;
    for (let index = 0; index < length; index++) {
      const sliced = index < split ? first[index] : second[index - split];
      maxDifference = Math.max(maxDifference, Math.abs((whole[index] ?? 0) - (sliced ?? 0)));
    }
    expect(maxDifference).toBeLessThan(1e-7);
  });

  it('gives two identical written notes different sound', () => {
    // Same pitch, same length, same velocity, a bar apart. On a real cello
    // these are not the same note, and after humanisation they are not here.
    const cello = {
      ...part([[50, 0, 900], [50, 2000, 900]]),
      instrument: 'cello' as const,
    };
    const program = buildProgram({ id: 'twice', parts: [cello], loop: loop4 });
    const sampleRate = 22_050;
    const out = new Float32Array(sampleRate * 4);
    renderProgramInto(out, program, 0, sampleRate);

    const windowLength = Math.floor(sampleRate * 0.8);
    let difference = 0;
    for (let i = 0; i < windowLength; i++) {
      difference += Math.abs(out[i]! - out[Math.floor(sampleRate * 2) + i]!);
    }
    expect(difference / windowLength).toBeGreaterThan(1e-4);
  });

  it('restores a loop-length drone when playback resumes after its onset', () => {
    const drone = { ...part([[48, 0, 8000]]), instrument: 'drone' as const };
    const program = buildProgram({ id: 'drone', parts: [drone], loop: loop4 });

    const active = notesActiveAtOffset(program, 3);
    expect(active).toHaveLength(1);
    expect(active[0]?.note.midiNumber).toBe(48);
    expect(active[0]?.elapsedSec).toBeCloseTo(3, 6);
    expect(notesActiveAtOffset(program, 0)).toEqual([]);
    expect(notesActiveAtOffset(program, 11)[0]?.elapsedSec).toBeCloseTo(3, 6);
  });

  it('restores a note during release but not after release ends', () => {
    const program = buildProgram({
      id: 'release',
      parts: [part([[60, 1000, 1000]])],
      loop: loop4,
    });

    expect(notesActiveAtOffset(program, 2.1)[0]?.elapsedSec).toBeCloseTo(1.1, 6);
    expect(notesActiveAtOffset(program, 2.3)).toEqual([]);
    // An onset exactly at the offset belongs to the normal future-onset cursor.
    expect(notesActiveAtOffset(program, 1)).toEqual([]);
  });

  it('returns an empty program for a loop over nothing', () => {
    const none = practiceLoop(score(0), { loopFromBar: 1, loopToBar: 1, tempoPercent: 100 });
    expect(buildProgram({ id: 'x', parts: [part([[60, 0, 500]])], loop: none }).notes).toHaveLength(0);
  });

  it('wraps a playhead time past the end back into the loop', () => {
    const oneLoop = loop4.scoreDurationMs;
    expect(loopOffsetSeconds(loop4, oneLoop + 500)).toBeCloseTo(0.5, 5);
    expect(loopOffsetSeconds(loop4, -500)).toBeCloseTo((oneLoop - 500) / 1000, 5);
  });

  describe('resolveAudibleProgram', () => {
    it('resolves parts and builds program in a single step', () => {
      const s = score(4);
      s.notes = [{
        id: 'n1',
        midiNumber: 43,
        pitchName: 'G2',
        frequency: 98,
        startTimeMs: 0,
        durationMs: 500,
        string: 'G',
        finger: '0',
        position: '1st',
        extension: 'none',
        articulation: 'arco',
        tie: false,
        measureIndex: 0,
      }];
      const res = resolveAudibleProgram({
        score: s,
        backing: null,
        loop: loop4,
        listenMode: 'solo',
        accompaniment: 'none',
      });
      expect(res.soloParts).toHaveLength(1);
      expect(res.audibleParts).toHaveLength(1);
      expect(res.program.notes.length).toBeGreaterThan(0);
      expect(res.program.durationSec).toBeCloseTo(loop4.realDurationMs / 1000, 3);
    });
  });
});

