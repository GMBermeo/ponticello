/**
 * Synthetic performance, for when there is no microphone to listen to.
 *
 * Used by the tutorial — where the point is to explain what the display means,
 * not to test the player — and as a fallback anywhere permission is refused.
 * It plays the piece back roughly in tune, drifting by a few cents the way a
 * real hand does, so the feedback layer has something honest-looking to
 * render. Nothing about it is presented as a real reading: every screen that
 * uses it shows a `SIMULATED` chip.
 */

import { midiToFrequency, CelloSongScore } from '@domain';

export interface SimulatedOptions {
  /** Typical intonation error, in cents. A beginner sits around 20. */
  driftCents?: number;
  seed?: number;
}

export class SimulatedPerformer {
  private phase = 0;
  private random: () => number;
  private readonly driftCents: number;

  constructor(
    private readonly score: CelloSongScore,
    private readonly sampleRate = 48000,
    options: SimulatedOptions = {},
  ) {
    this.driftCents = options.driftCents ?? 18;
    let state = (options.seed ?? 20260821) >>> 0;
    this.random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  /**
   * Renders `count` samples of whatever should be sounding at `timeMs`.
   * Harmonics are weighted like a bowed string with a weak fundamental, so the
   * dual-rate engine faces the same problem it would on a real cello.
   */
  render(timeMs: number, count: number, out: Float32Array): void {
    const note = this.noteAt(timeMs);
    if (!note) {
      out.fill(0);
      return;
    }

    const drift = (this.random() - 0.5) * 2 * this.driftCents;
    const frequency = midiToFrequency(note.midiNumber) * Math.pow(2, drift / 1200);
    const step = (2 * Math.PI * frequency) / this.sampleRate;

    // Bow attacks and releases, so the onset gate has something to catch.
    const intoNote = timeMs - note.startTimeMs;
    const attack = Math.min(1, intoNote / 40);
    const release = Math.min(1, (note.durationMs - intoNote) / 60);
    const envelope = 0.4 * attack * Math.max(0, release);

    for (let i = 0; i < count; i++) {
      let sample = 0;
      for (let h = 1; h <= 8; h++) {
        const bodyGain = 1 / (1 + Math.pow(100 / (frequency * h), 4));
        sample += ((((-1) ** (h + 1)) / h) * bodyGain) * Math.sin(this.phase * h);
      }
      out[i] = sample * envelope;
      this.phase += step;
      if (this.phase > 2 * Math.PI * 1024) this.phase -= 2 * Math.PI * 1024;
    }
  }

  private noteAt(timeMs: number) {
    return this.score.notes.find(
      (n) => timeMs >= n.startTimeMs && timeMs < n.startTimeMs + n.durationMs,
    );
  }
}
