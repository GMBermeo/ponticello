/**
 * Half-wave-rectified spectral flux, used as a bow-attack gate.
 *
 * At the start of a stroke the string has not yet settled into Helmholtz
 * stick–slip motion. For the first 15–40 ms the microphone hears broadband
 * scratch and torsional noise, and a pitch detector pointed at it returns
 * confident nonsense. Flux spikes on exactly that broadband change, so a
 * spike is the cue to hold the previous reading rather than publish a new one.
 *
 *     SF(t) = Σ_k max(0, |X(t,k)| − |X(t−1,k)|)
 */

import { FFT } from './fft';

export interface FluxOptions {
  fftSize?: number;
  /** Flux above (median × this) counts as an onset. */
  thresholdRatio?: number;
  /** How long to hold the previous pitch after an onset. */
  holdMs?: number;
}

export class SpectralFluxGate {
  private readonly fft: FFT;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly window: Float32Array;
  private readonly previousMagnitude: Float32Array;
  private readonly history: Float32Array;
  private historyIndex = 0;
  private historyFilled = 0;
  private primed = false;

  readonly holdMs: number;
  private readonly thresholdRatio: number;

  /** Milliseconds remaining on the current hold. Zero means "publish freely". */
  holdRemainingMs = 0;
  /** Flux of the most recent frame, for the debug overlay. */
  lastFlux = 0;

  constructor(private readonly sampleRate: number, options: FluxOptions = {}) {
    const { fftSize = 512, thresholdRatio = 2.4, holdMs = 35 } = options;
    this.fft = new FFT(fftSize);
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
    this.previousMagnitude = new Float32Array(fftSize / 2);
    this.history = new Float32Array(43); // ~0.5 s of flux at a 128-sample hop
    this.thresholdRatio = thresholdRatio;
    this.holdMs = holdMs;

    this.window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
    }
  }

  /**
   * Feeds one hop. Returns true when the frame sits inside an attack and the
   * caller should keep showing the previous pitch.
   */
  push(frame: Float32Array, hopSizeSamples: number): boolean {
    const n = this.fft.size;
    for (let i = 0; i < n; i++) {
      this.re[i] = frame[i] * this.window[i];
      this.im[i] = 0;
    }
    this.fft.forward(this.re, this.im);

    let flux = 0;
    for (let k = 0; k < n / 2; k++) {
      const magnitude = Math.hypot(this.re[k], this.im[k]);
      const delta = magnitude - this.previousMagnitude[k];
      if (delta > 0) flux += delta;
      this.previousMagnitude[k] = magnitude;
    }
    this.lastFlux = flux;

    const elapsedMs = (hopSizeSamples / this.sampleRate) * 1000;
    this.holdRemainingMs = Math.max(0, this.holdRemainingMs - elapsedMs);

    // The first frame has nothing to compare against and would always spike.
    if (!this.primed) {
      this.primed = true;
      this.record(flux);
      return false;
    }

    // An adaptive floor beats a fixed one: a quiet practice room and a loud
    // one produce very different absolute flux for the same bow stroke.
    const threshold = this.median() * this.thresholdRatio;
    this.record(flux);

    if (this.historyFilled > 8 && flux > threshold && threshold > 0) {
      this.holdRemainingMs = this.holdMs;
      return true;
    }
    return this.holdRemainingMs > 0;
  }

  private record(flux: number): void {
    this.history[this.historyIndex] = flux;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    this.historyFilled = Math.min(this.historyFilled + 1, this.history.length);
  }

  private median(): number {
    if (this.historyFilled === 0) return 0;
    const slice = Array.from(this.history.subarray(0, this.historyFilled)).sort((a, b) => a - b);
    return slice[slice.length >> 1];
  }

  reset(): void {
    this.previousMagnitude.fill(0);
    this.history.fill(0);
    this.historyIndex = 0;
    this.historyFilled = 0;
    this.holdRemainingMs = 0;
    this.primed = false;
  }
}
