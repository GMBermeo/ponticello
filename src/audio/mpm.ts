/**
 * McLeod Pitch Method over the Normalised Square Difference Function.
 *
 * Chosen over plain FFT peak-picking because a bowed cello radiates almost no
 * energy at its own fundamental down at C2 — the body's air and wood
 * resonances sit well above 65 Hz, so the 2nd and 3rd harmonics are louder
 * than the note itself. Anything that picks the loudest spectral peak reports
 * C3. A time-domain difference function keys on the *period*, which survives a
 * missing fundamental intact.
 *
 *     n′(τ) = 2·r(τ) / m(τ)
 *
 * where r is the type-II autocorrelation and m the matching sum of squares.
 * The result is bounded to [−1, 1] and reads directly as a clarity score, so
 * the same number that finds the pitch also tells us whether to trust it.
 */

import { AcfScratch, autocorrelate, createAcfScratch } from './fft';

export interface MpmOptions {
  sampleRate: number;
  windowSize: number;
  minFrequency: number;
  maxFrequency: number;
  /**
   * Fraction of the tallest NSDF peak a candidate must reach to be accepted.
   * Taking the *first* peak that clears this, rather than the tallest, is what
   * stops the detector locking onto a subharmonic an octave down.
   */
  peakThreshold?: number;
  /** Frames below this NSDF value are bow noise, not a note. */
  clarityThreshold?: number;
  /** Frames below this RMS are silence. */
  silenceThreshold?: number;
}

export interface PitchResult {
  /** Detected fundamental in Hz, or 0 when the frame is unvoiced. */
  frequency: number;
  /** NSDF value at the chosen peak, in [0, 1]. */
  clarity: number;
  /** RMS of the analysis window. */
  rms: number;
  voiced: boolean;
}

const UNVOICED: PitchResult = { frequency: 0, clarity: 0, rms: 0, voiced: false };

export class McLeodPitchDetector {
  readonly sampleRate: number;
  readonly windowSize: number;

  private readonly minLag: number;
  private readonly maxLag: number;
  private readonly peakThreshold: number;
  private readonly clarityThreshold: number;
  private readonly silenceThreshold: number;

  private readonly acf: Float32Array;
  private readonly nsdf: Float32Array;
  private readonly scratch: AcfScratch;
  private readonly maxima: Int32Array;

  constructor(options: MpmOptions) {
    const {
      sampleRate, windowSize, minFrequency, maxFrequency,
      peakThreshold = 0.85, clarityThreshold = 0.8, silenceThreshold = 0.004,
    } = options;

    this.sampleRate = sampleRate;
    this.windowSize = windowSize;
    this.peakThreshold = peakThreshold;
    this.clarityThreshold = clarityThreshold;
    this.silenceThreshold = silenceThreshold;

    const requiredLag = Math.ceil(sampleRate / minFrequency);
    if (requiredLag > windowSize - 2) {
      throw new Error(
        `window of ${windowSize} samples at ${sampleRate} Hz cannot resolve ${minFrequency} Hz — ` +
        `one period is ${requiredLag} samples, so the window needs at least ${requiredLag + 2}`,
      );
    }

    this.minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
    this.maxLag = requiredLag;

    if (this.maxLag <= this.minLag) {
      throw new Error(`empty lag range: ${minFrequency}-${maxFrequency} Hz at ${sampleRate} Hz`);
    }

    this.acf = new Float32Array(this.maxLag + 2);
    this.nsdf = new Float32Array(this.maxLag + 2);
    this.scratch = createAcfScratch(windowSize);
    this.maxima = new Int32Array(this.maxLag + 2);
  }

  /** Analyses one window. `frame` must be at least `windowSize` samples. */
  detect(frame: Float32Array): PitchResult {
    const w = this.windowSize;

    let sumSquares = 0;
    for (let i = 0; i < w; i++) sumSquares += frame[i] * frame[i];
    const rms = Math.sqrt(sumSquares / w);
    if (rms < this.silenceThreshold) return UNVOICED;

    this.computeNsdf(frame, sumSquares);
    const chosen = this.choosePeriod(this.collectKeyMaxima());
    if (chosen < 0) return { frequency: 0, clarity: 0, rms, voiced: false };

    const { lag, value } = this.refine(chosen);
    const frequency = this.sampleRate / lag;
    const voiced = value >= this.clarityThreshold
      && frequency >= this.sampleRate / this.maxLag
      && frequency <= this.sampleRate / this.minLag;

    return { frequency: voiced ? frequency : 0, clarity: value, rms, voiced };
  }

  /**
   * The normalised square difference function, into `this.nsdf`.
   *
   * m(τ) falls out of a running subtraction rather than a second O(W²) pass:
   * widening the lag by one drops exactly one sample from each end.
   */
  private computeNsdf(frame: Float32Array, sumSquares: number): void {
    const w = this.windowSize;
    autocorrelate(frame, w, this.acf, this.maxLag + 1, this.scratch);
    let m = 2 * sumSquares;
    this.nsdf[0] = 1;
    for (let tau = 1; tau <= this.maxLag + 1; tau++) {
      m -= frame[w - tau] * frame[w - tau] + frame[tau - 1] * frame[tau - 1];
      this.nsdf[tau] = m > 0 ? (2 * this.acf[tau]) / m : 0;
    }
  }

  /**
   * The first key maximum within `peakThreshold` of the tallest, or −1.
   *
   * Only lags inside the configured band are candidates. The lobe walk
   * deliberately starts at τ=0 — starting it at minLag would step *into* the
   * first period's lobe on a high note and skip the true peak, reporting an
   * octave down.
   */
  private choosePeriod(count: number): number {
    let highest = 0;
    for (let i = 0; i < count; i++) {
      const tau = this.maxima[i];
      if (tau >= this.minLag && this.nsdf[tau] > highest) highest = this.nsdf[tau];
    }
    if (highest <= 0) return -1;

    const threshold = this.peakThreshold * highest;
    for (let i = 0; i < count; i++) {
      const tau = this.maxima[i];
      if (tau >= this.minLag && this.nsdf[tau] >= threshold) return tau;
    }
    return -1;
  }

  /** First lag past the τ=0 lobe, which is always 1 and always tallest, and the gap after it. */
  private firstLagAfterPrimaryLobe(): number {
    const nsdf = this.nsdf;
    let pos = 1;
    while (pos < this.maxLag && nsdf[pos] > 0) pos++;
    return this.skipNonPositive(pos);
  }

  private skipNonPositive(from: number): number {
    let pos = from;
    while (pos < this.maxLag && this.nsdf[pos] <= 0) pos++;
    return pos;
  }

  private isLocalPeak(pos: number): boolean {
    const nsdf = this.nsdf;
    return nsdf[pos] > nsdf[pos - 1] && nsdf[pos] >= nsdf[pos + 1];
  }

  /**
   * The highest point of each positive lobe of the NSDF. Working lobe by lobe
   * — rather than taking every local maximum — keeps ripple on the flanks of a
   * genuine peak from being mistaken for a candidate period.
   */
  private collectKeyMaxima(): number {
    const nsdf = this.nsdf;
    const end = this.maxLag;
    let count = 0;
    let lobeMax = 0;
    let pos = this.firstLagAfterPrimaryLobe();
    while (pos < end) {
      if (this.isLocalPeak(pos) && (lobeMax === 0 || nsdf[pos] > nsdf[lobeMax])) lobeMax = pos;
      pos++;
      const lobeEnded = pos < end && nsdf[pos] <= 0;
      if (lobeEnded && lobeMax > 0) {
        this.maxima[count++] = lobeMax;
        lobeMax = 0;
      }
      if (lobeEnded) pos = this.skipNonPositive(pos);
    }
    if (lobeMax > 0) this.maxima[count++] = lobeMax;

    return count;
  }

  /**
   * Sub-sample peak location by fitting a parabola through the chosen bin and
   * its neighbours. Without it the detector quantises to whole samples, which
   * at A3 on the high band is a 4-cent staircase — visible as a twitching
   * needle on a perfectly steady note.
   */
  private refine(tau: number): { lag: number; value: number } {
    const y0 = this.nsdf[tau - 1];
    const y1 = this.nsdf[tau];
    const y2 = this.nsdf[tau + 1];
    const denominator = 2 * (y0 - 2 * y1 + y2);
    if (denominator === 0) return { lag: tau, value: y1 };

    const delta = (y0 - y2) / denominator;
    if (!Number.isFinite(delta) || Math.abs(delta) > 1) return { lag: tau, value: y1 };

    return { lag: tau + delta, value: y1 - 0.25 * (y0 - y2) * delta };
  }
}
