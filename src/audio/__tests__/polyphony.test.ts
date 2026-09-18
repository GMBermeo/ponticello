import { describe, expect, it } from 'vitest';

import { practiceLoop } from '@/domain/loop';
import { BackingPart } from '@/domain/backing';
import { VOICES } from '../voices';
import { buildProgram, limitPolyphony, MAX_POLYPHONY, ScheduledNote } from '../backing/program';

function note(atSec: number, holdSec: number, amplitude: number, midiNumber = 60): ScheduledNote {
  return { atSec, holdSec, amplitude, midiNumber, instrument: 'piano', velocity: amplitude };
}

/** Most voices sounding at any onset, counting hold and release. */
function maxOverlap(notes: readonly ScheduledNote[]): number {
  let worst = 0;
  for (const probe of notes) {
    const sounding = notes.filter((other) => other.atSec <= probe.atSec
      && other.atSec + other.holdSec + VOICES[other.instrument].releaseMs / 1000 > probe.atSec);
    worst = Math.max(worst, sounding.length);
  }
  return worst;
}

describe('limitPolyphony', () => {
  it('leaves music under the ceiling untouched', () => {
    const notes = [note(0, 1, 0.5), note(0.5, 1, 0.4), note(1, 1, 0.3)];
    expect(limitPolyphony(notes, 8)).toEqual(notes);
  });

  it('keeps the loudest voices of an impossible chord', () => {
    const chord = Array.from({ length: 40 }, (_, i) => note(0, 2, (i + 1) / 40, 40 + i));
    const kept = limitPolyphony(chord, 32);
    expect(kept).toHaveLength(32);
    expect(Math.min(...kept.map((n) => n.amplitude))).toBeCloseTo(9 / 40, 10);
  });

  it('cuts a stolen voice short so its release ends at the onset that stole it', () => {
    const held = note(0, 4, 0.1);
    const kept = limitPolyphony([held, note(1, 1, 0.9)], 1);
    expect(kept).toHaveLength(2);
    const releaseSec = VOICES.piano.releaseMs / 1000;
    expect(kept[0].holdSec + releaseSec).toBeLessThanOrEqual(1);
    expect(kept[0].holdSec + releaseSec).toBeGreaterThan(0.99);
    expect(held.holdSec).toBe(4); // input not mutated
  });

  it('never exceeds the ceiling on a dense fifteen-part texture', () => {
    // Fifteen parts of eighth-note chords at 140 BPM, like the busiest file
    // in the library, three minutes long.
    const loop = practiceLoop(
      {
        schemaVersion: '1.0.0', id: 'dense',
        metadata: {
          title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
          bpm: 140, difficulty: 'Beginner', tonic: 'C', teaches: '', rights: '',
        },
        measures: Array.from({ length: 105 }, (_, index) => ({
          index, startBarTimeMs: index * 1714.2857, durationMs: 1714.2857,
          timeSignature: [4, 4] as [number, number], tempoBpm: 140,
        })),
        notes: [],
      },
      { loopFromBar: 1, loopToBar: 105, tempoPercent: 100 },
    );
    const parts: BackingPart[] = Array.from({ length: 15 }, (_, p) => ({
      id: `p${p}`, name: `Part ${p}`, instrument: p % 2 ? 'strings' : 'piano',
      role: 'accompaniment', gain: 0.5, muted: false,
      notes: Array.from({ length: 840 }, (_, i) => ({
        midiNumber: 40 + ((p * 5 + i) % 36),
        startTimeMs: i * 214.2857,
        durationMs: 600,
        velocity: 0.3 + ((i * 7 + p) % 10) / 20,
      })),
    }));

    const program = buildProgram({ id: 'dense', parts, loop });
    expect(maxOverlap(program.notes)).toBeLessThanOrEqual(MAX_POLYPHONY);
    // Stealing thins the texture; it must not hollow it out.
    expect(program.notes.length).toBeGreaterThan(parts.length * 840 * 0.3);
    // Twelve thousand notes through the sweep takes a few seconds, and more
    // when the suite runs it beside everything else; the default 5 s timeout
    // makes an otherwise deterministic test flaky.
  }, 30_000);
});
