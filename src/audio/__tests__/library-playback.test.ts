import { describe, expect, it } from 'vitest';

import { BackingPart } from '@/domain/backing';
import { clipToLoop, loopBudget, practiceLoop } from '@/domain/loop';
import { COMPACT_SCORES, inflateBacking, inflateScore } from '@/scores/bundledSongs';
import { buildProgram, estimatePeak } from '../backing/program';
import { renderProgramInto } from '../synth';

/**
 * Every song, one by one.
 *
 * The user's report was "the majority is not playing the back". They were right,
 * and the reason was a ninety-second ceiling on the loop the accompaniment
 * could be rendered from: 219 of these 258 songs are longer than that, so the
 * renderer declined and the app said nothing. It was a single constant, and
 * nothing in the suite would have caught it, because every existing test used a
 * four-bar fixture.
 *
 * So this file is deliberately exhaustive rather than representative. It walks
 * the whole shipped library at the settings a player actually gets — the full
 * song, at 100 % — and asserts that each one resolves to a program with notes
 * in it, inside budget, at a sane level, and that synthesising it produces
 * audible samples. A regression that silences one song fails one case and names
 * it; a regression that silences the library fails 258.
 */

const SAMPLE_RATE = 22050;

interface Outcome {
  id: string;
  seconds: number;
  noteCount: number;
  withinBudget: boolean;
  peak: number;
  /** Fraction of a rendered probe slice that is above the noise floor. */
  audible: number;
}

/** Resolves a song exactly as `useBacking` does in `listenMode: 'both'`. */
function resolve(index: number): Outcome {
  const raw = COMPACT_SCORES[index];
  const score = inflateScore(raw);
  const backing = inflateBacking(raw);

  // What the player gets on opening a song: the whole piece, written tempo.
  const loop = practiceLoop(score, {
    loopFromBar: 1,
    loopToBar: score.measures.length,
    tempoPercent: 100,
  });

  const parts: BackingPart[] = clipToLoop(backing.parts, loop);
  const program = buildProgram({ id: `${raw.id}:both`, parts, loop });
  const budget = loopBudget(loop);

  // Probe a slice from a third of the way in rather than from the top: an
  // arrangement whose first bar happens to be a rest would otherwise look silent.
  const probeSamples = Math.min(
    Math.ceil(program.durationSec * SAMPLE_RATE),
    SAMPLE_RATE * 2,
  );
  let audible = 0;
  if (probeSamples > 0 && program.notes.length > 0) {
    const from = Math.floor(program.durationSec * SAMPLE_RATE / 3);
    const out = new Float32Array(probeSamples);
    renderProgramInto(out, program, from, SAMPLE_RATE);
    let loud = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 1e-4) loud++;
    audible = loud / out.length;
  }

  return {
    id: raw.id,
    seconds: loop.realDurationMs / 1000,
    noteCount: program.notes.length,
    withinBudget: budget.withinBudget,
    peak: estimatePeak(program.notes),
    audible,
  };
}

describe('every bundled song plays its backing', () => {
  const outcomes = COMPACT_SCORES.map((_, index) => resolve(index));

  it('ships the songs this suite claims to cover', () => {
    expect(outcomes.length).toBe(258);
  });

  it.each(outcomes.map((o) => [o.id, o] as const))(
    '%s',
    (_id, outcome) => {
      // The whole song, at written tempo, must be accompaniable. This is the
      // assertion the old 90 s ceiling failed for 219 of these.
      expect(outcome.withinBudget, `${outcome.seconds.toFixed(0)}s exceeds the loop budget`)
        .toBe(true);

      expect(outcome.noteCount, 'resolved to no sounding notes').toBeGreaterThan(0);

      // Gain staging has to leave the mix under the limiter's knee. Before the
      // program layer existed the densest imported songs peaked at forty.
      expect(outcome.peak).toBeGreaterThan(0);
      expect(outcome.peak, 'mix is hot enough to distort').toBeLessThanOrEqual(0.75);

      // And it has to actually make sound. A program full of notes that all
      // render to zero would pass every check above.
      expect(outcome.audible, 'rendered probe slice is silent').toBeGreaterThan(0.05);
    },
  );

  it('reports the shape of the library', () => {
    const seconds = outcomes.map((o) => o.seconds).sort((a, b) => a - b);
    const overOldCeiling = outcomes.filter((o) => o.seconds > 90).length;
    const peaks = outcomes.map((o) => o.peak);

    // Not an assertion so much as the evidence, printed once per run.
    console.log(
      `songs=${outcomes.length}`,
      `median=${Math.round(seconds[seconds.length >> 1])}s`,
      `longest=${Math.round(seconds[seconds.length - 1])}s`,
      `over-old-90s-ceiling=${overOldCeiling}`,
      `peak: min=${Math.min(...peaks).toFixed(2)} max=${Math.max(...peaks).toFixed(2)}`,
    );

    // The regression this whole file exists for: most of the library is longer
    // than the ceiling that used to silence it.
    expect(overOldCeiling).toBeGreaterThan(200);
  });
});
