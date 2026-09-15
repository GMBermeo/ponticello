import { describe, expect, it } from 'vitest';

import {
  DriftEstimator, loopDistance, scoreTimeAt, wrapIntoLoop,
} from '../transportClock';

/** Deterministic jitter, so a failure reproduces. */
function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('wrapIntoLoop', () => {
  it('keeps the overshoot across the loop point', () => {
    expect(wrapIntoLoop(8_010, 0, 8_000)).toBe(10);
    expect(wrapIntoLoop(2_000 + 3 * 4_000 + 7, 2_000, 6_000)).toBe(2_007);
  });

  it('wraps times before the loop into the loop', () => {
    expect(wrapIntoLoop(-10, 0, 1_000)).toBe(990);
  });

  it('collapses an empty loop to its start', () => {
    expect(wrapIntoLoop(123, 500, 500)).toBe(500);
  });
});

describe('loopDistance', () => {
  it('measures lag across the loop point the short way round', () => {
    expect(loopDistance(7_980, 20, 0, 8_000)).toBe(40);
    expect(loopDistance(20, 7_980, 0, 8_000)).toBe(-40);
  });
});

describe('the anchored clock does not care about frame rate', () => {
  /**
   * The reported bug: at 120 Hz with occasional hitches the notes slowly fell
   * behind the audio. An anchored clock evaluated at whatever instant a frame
   * happens to arrive has no memory of earlier frames to lose.
   */
  it('lands exactly on the ideal time after ten minutes of jittery 120 Hz frames', () => {
    const random = lcg(7);
    const rate = 0.85;
    const loop = { start: 4_000, end: 36_000 };
    const anchorAt = 1_000_000.25;

    let now = anchorAt;
    let worst = 0;
    const tenMinutes = 10 * 60 * 1000;
    while (now - anchorAt < tenMinutes) {
      // 8.33 ms nominal, ±1.5 ms jitter, and one frame in forty dropped outright.
      now += 1000 / 120 + (random() - 0.5) * 3;
      if (random() < 1 / 40) now += 1000 / 120;
      const drawn = scoreTimeAt(anchorAt, loop.start, rate, now, loop.start, loop.end);
      const ideal = wrapIntoLoop(loop.start + (now - anchorAt) * rate, loop.start, loop.end);
      worst = Math.max(worst, Math.abs(loopDistance(ideal, drawn, loop.start, loop.end)));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('holds the anchor position through a scheduled start lead', () => {
    expect(scoreTimeAt(1_060, 2_500, 1, 1_020, 0, 10_000)).toBe(2_500);
    expect(scoreTimeAt(1_060, 2_500, 1, 1_070, 0, 10_000)).toBe(2_510);
  });
});

describe('DriftEstimator', () => {
  it('ignores measurement noise inside the deadband', () => {
    const random = lcg(3);
    const estimator = new DriftEstimator();
    for (let i = 0; i < 200; i++) {
      const noise = (random() - 0.5) * 16; // one stale 120 Hz frame either way
      expect(estimator.push(1_000, 1_000 + noise, 0, 60_000)).toBe(0);
    }
  });

  it('jumps straight to the audio after a stall', () => {
    const estimator = new DriftEstimator();
    expect(estimator.push(1_000, 2_500, 0, 60_000)).toBe(1_500);
  });

  /**
   * Found in a hidden browser tab: no frames were drawn, so the picture never
   * moved, and every sample saw the same huge error and corrected for it
   * again — the anchor ran minutes ahead in seconds.
   */
  it('never applies a correction twice to a picture that has not redrawn', () => {
    const estimator = new DriftEstimator();
    const frozenVisual = 0;
    let applied = 0;
    for (let sample = 0; sample < 400; sample++) {
      // Audio keeps playing a quarter-second per sample; the frame counter is stuck.
      applied += estimator.push(frozenVisual, 1_000 + sample * 250, 0, 600_000, 12);
    }
    expect(applied).toBe(1_000);
  });

  it('corrects again once corrected frames have been drawn', () => {
    const estimator = new DriftEstimator();
    let anchor = 0;
    let frame = 0;
    // The picture is 2 s behind; after the snap it tracks the audio exactly.
    const audioAt = (step: number) => 2_000 + step * 250;
    for (let step = 0; step < 20; step++) {
      frame += 30;
      const visual = step * 250 + anchor;
      anchor += estimator.push(visual, audioAt(step), 0, 600_000, frame);
    }
    expect(anchor).toBe(2_000);
  });

  /**
   * Two clocks that disagree: the display runs 0.2 % fast against the sound
   * card — far worse than real hardware — and the native file adds a 30 ms gap
   * at every repeat of an 8-second loop. Sampling four times a second and
   * applying the corrections to the anchor must keep the picture on the audio
   * for a whole twenty-minute session.
   */
  it('keeps the picture locked to drifting, gapped audio for twenty minutes', () => {
    const loop = { start: 0, end: 8_000 };
    const rate = 1;
    const displayFast = 1.002;
    const loopGapMs = 30;
    const estimator = new DriftEstimator();

    let anchorScore = 0;
    let worstAfterSettling = 0;
    for (let tMs = 0; tMs <= 20 * 60 * 1000; tMs += 250) {
      // Audio: real time minus the gaps accumulated at every completed repeat.
      const repeats = Math.floor(tMs / (loop.end + loopGapMs));
      const intoRepeat = tMs - repeats * (loop.end + loopGapMs);
      const audio = Math.min(loop.end, intoRepeat) % loop.end;

      const visual = scoreTimeAt(0, anchorScore, rate, tMs * displayFast, loop.start, loop.end);
      anchorScore += estimator.push(visual, audio, loop.start, loop.end);

      const corrected = scoreTimeAt(0, anchorScore, rate, tMs * displayFast, loop.start, loop.end);
      if (tMs > 5_000) {
        worstAfterSettling = Math.max(
          worstAfterSettling,
          Math.abs(loopDistance(audio, corrected, loop.start, loop.end)),
        );
      }
    }
    // Gaps land as a single 30 ms step each repeat and are removed within a
    // couple of seconds; nothing is allowed to accumulate.
    expect(worstAfterSettling).toBeLessThan(45);
  });
});
