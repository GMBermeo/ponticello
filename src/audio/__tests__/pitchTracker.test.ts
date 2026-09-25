import { describe, expect, it } from 'vitest';

import type { PitchFrame } from '../PitchEngine';
import { PitchTracker, SILENT_READING, type FrameSource } from '../pitchTracker';

const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 128;
const NO_SAMPLES = new Float32Array(0);

const SILENCE: Omit<PitchFrame, 'sampleTime'> = {
  frequency: 0, clarity: 0, rms: 0, voiced: false, band: 'none', held: false,
};

const tone = (frequency: number): Omit<PitchFrame, 'sampleTime'> => ({
  frequency, clarity: 0.95, rms: 0.1, voiced: true, band: 'high', held: false,
});

/** Plays back scripted frames, one per push, advancing the audio clock a block each time. */
class ScriptedFrames implements FrameSource {
  readonly sampleRate = SAMPLE_RATE;
  private queue: Omit<PitchFrame, 'sampleTime'>[] = [];
  private sampleTime = 0;

  script(...frames: Omit<PitchFrame, 'sampleTime'>[]): this {
    this.queue.push(...frames);
    return this;
  }

  push(): void {
    this.sampleTime += FRAME_SAMPLES;
  }

  read(): PitchFrame {
    return { ...(this.queue.shift() ?? SILENCE), sampleTime: this.sampleTime };
  }

  reconfigure(): void {}

  reset(): void {
    this.queue = [];
  }
}

function practiceTracker(...frames: Omit<PitchFrame, 'sampleTime'>[]): PitchTracker {
  return new PitchTracker({ tunerMode: false, source: new ScriptedFrames().script(...frames) });
}

describe('PitchTracker levels', () => {
  it('shows no level for silence', () => {
    expect(practiceTracker(SILENCE).push(NO_SAMPLES, 1000).level).toBe(0);
  });

  it('caps a full-scale signal at 1', () => {
    expect(practiceTracker({ ...tone(440), rms: 1 }).push(NO_SAMPLES, 1000).level).toBe(1);
  });

  it('reports tracking only while voiced', () => {
    const tracker = practiceTracker(tone(440), SILENCE);
    expect([tracker.push(NO_SAMPLES, 1000).tracking, tracker.push(NO_SAMPLES, 2000).tracking]).toEqual([1, 0]);
  });
});

describe('PitchTracker practice readings', () => {
  it('names the note being played', () => {
    expect(practiceTracker(tone(440)).push(NO_SAMPLES, 1000).reading?.heard).toBe('A4');
  });

  it('measures cents against the target rather than the nearest note', () => {
    const tracker = practiceTracker(tone(440));
    tracker.setTarget(70);
    expect(tracker.push(NO_SAMPLES, 1000).reading?.cents).toBeCloseTo(-100, 6);
  });

  it('leaves the needle alone for an unvoiced frame', () => {
    expect(practiceTracker(SILENCE).push(NO_SAMPLES, 1000).cents).toBeNull();
  });

  it('moves the needle for a voiced frame', () => {
    expect(practiceTracker(tone(446)).push(NO_SAMPLES, 1000).cents).toBeGreaterThan(0);
  });
});

describe('PitchTracker publishing', () => {
  it('publishes at most one reading per interval', () => {
    const tracker = practiceTracker(tone(440), tone(440));
    tracker.push(NO_SAMPLES, 1000);
    expect(tracker.push(NO_SAMPLES, 1050).reading).toBeNull();
  });

  it('publishes again once the interval has passed', () => {
    const tracker = practiceTracker(tone(440), tone(440));
    tracker.push(NO_SAMPLES, 1000);
    expect(tracker.push(NO_SAMPLES, 1080).reading?.voiced).toBe(true);
  });

  it('publishes silence once when a note stops', () => {
    const tracker = practiceTracker(tone(440), SILENCE, SILENCE);
    tracker.push(NO_SAMPLES, 1000);
    const readings = [tracker.push(NO_SAMPLES, 2000).reading, tracker.push(NO_SAMPLES, 3000).reading];
    expect(readings).toEqual([SILENT_READING, null]);
  });

  it('never publishes silence before anything was heard', () => {
    expect(practiceTracker(SILENCE).push(NO_SAMPLES, 1000).reading).toBeNull();
  });

  it('forgets the last note after a reset', () => {
    const tracker = practiceTracker(tone(440));
    tracker.push(NO_SAMPLES, 1000);
    tracker.reset();
    expect(tracker.push(NO_SAMPLES, 2000).reading).toBeNull();
  });
});

describe('PitchTracker tuner mode', () => {
  it('leaves the needle alone while nothing sounds', () => {
    const tracker = new PitchTracker({ tunerMode: true, source: new ScriptedFrames().script(SILENCE) });
    expect(tracker.push(NO_SAMPLES, 1000).cents).toBeNull();
  });

  it('settles on the note held', () => {
    const source = new ScriptedFrames().script(...Array.from({ length: 40 }, () => tone(220)));
    const tracker = new PitchTracker({ tunerMode: true, source });
    let heard: string | null | undefined;
    for (let i = 0; i < 40; i++) heard = tracker.push(NO_SAMPLES, 1000 + i * 25).reading?.heard ?? heard;
    expect(heard).toBe('A3');
  });
});
