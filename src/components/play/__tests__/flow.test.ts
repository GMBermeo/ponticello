import { describe, expect, it } from 'vitest';

import { flowWindow, laneGeometry, visibleSlice } from '../flow';

/**
 * The two visions used to lay out every note in the piece as a mounted view.
 * On a nine-minute song that is thousands of them for the two seconds actually
 * on screen, and it was a major cause of playback stutter. These are the tests
 * for what replaced it.
 */
describe('windowing the note field', () => {
  const notes = Array.from({ length: 1000 }, (_, i) => ({
    startTimeMs: i * 100, durationMs: 90,
  }));

  it('finds only the notes on screen out of a thousand', () => {
    const { from, to } = visibleSlice(notes, { fromMs: 50_000, toMs: 52_000 });
    expect(to - from).toBeLessThan(30);
    expect(notes[from].startTimeMs).toBeGreaterThanOrEqual(49_000);
    expect(notes[to - 1].startTimeMs).toBeLessThanOrEqual(52_000);
  });

  it('keeps a long note that began before the window and is still sounding', () => {
    const held = [{ startTimeMs: 0, durationMs: 60_000 }, { startTimeMs: 55_000, durationMs: 100 }];
    const { from } = visibleSlice(held, { fromMs: 50_000, toMs: 52_000 });
    expect(from).toBe(0);
  });

  it('drops a long note that has already finished', () => {
    const done = [{ startTimeMs: 0, durationMs: 1000 }, { startTimeMs: 55_000, durationMs: 100 }];
    const { from, to } = visibleSlice(done, { fromMs: 50_000, toMs: 52_000 });
    expect(to - from).toBe(0);
  });

  it('handles an empty score without reaching past the end', () => {
    expect(visibleSlice([], { fromMs: 0, toMs: 1000 })).toEqual({ from: 0, to: 0 });
  });

  it('looks further ahead of the playhead than behind it', () => {
    const w = flowWindow(10_000, 2_000, 0.8);
    expect(w.toMs - 10_000).toBeGreaterThan(10_000 - w.fromMs);
  });
});

describe('lane layout', () => {
  it('puts the low C on the left when time runs downward', () => {
    const lanes = laneGeometry('vertical', 400, 10);
    expect(lanes.laneAt('C')).toBeLessThan(lanes.laneAt('A'));
  });

  it('puts the low C at the bottom when time runs sideways', () => {
    // The invariant a cellist notices instantly if it is wrong: pitch goes up.
    const lanes = laneGeometry('horizontal', 400, 10);
    expect(lanes.laneAt('C')).toBeGreaterThan(lanes.laneAt('A'));
    expect(lanes.laneAt('C')).toBeGreaterThan(lanes.laneAt('G'));
    expect(lanes.laneAt('G')).toBeGreaterThan(lanes.laneAt('D'));
  });

  it('divides the box evenly however it is turned', () => {
    for (const axis of ['vertical', 'horizontal'] as const) {
      const lanes = laneGeometry(axis, 400, 10);
      expect(lanes.laneStep).toBeCloseTo(100, 5);
      expect(lanes.laneSize).toBeCloseTo(90, 5);
    }
  });
});
