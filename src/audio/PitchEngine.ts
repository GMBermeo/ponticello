/**
 * Dual-rate pitch engine: the piece that turns a microphone stream into a
 * frequency, a confidence and a cents deviation.
 *
 * A cello spans C2 (65 Hz) to A5 (880 Hz) — nearly four octaves. One analysis
 * window cannot serve both ends: long enough for C2 means a 43 ms lag on
 * everything, and short enough to feel instant up high cannot see a single
 * period down low. So the signal is analysed twice, in parallel, at two rates,
 * and an arbiter decides which branch to believe.
 *
 *   high band   48 kHz · 512-sample window · 180–1000 Hz  → ~25 ms end to end
 *   low  band   12 kHz · 512-sample window ·  55–220 Hz   → ~60 ms end to end
 *
 * The bands overlap between 180 and 220 Hz on purpose, so the handover around
 * the open A string is a preference rather than a cliff.
 */

import { Decimator, RingBuffer } from './decimate';
import { SpectralFluxGate } from './flux';
import { McLeodPitchDetector, PitchResult } from './mpm';

export interface PitchFrame {
  /** Fundamental in Hz; 0 when nothing is sounding. */
  frequency: number;
  clarity: number;
  rms: number;
  voiced: boolean;
  /** Which branch produced this reading. */
  band: 'high' | 'low' | 'none';
  /** True while a bow attack is being ridden out and the value is held over. */
  held: boolean;
  /** Monotonic sample count at the *end* of the analysis window. */
  sampleTime: number;
}

export interface PitchEngineOptions {
  sampleRate?: number;
  /** Highest fundamental the high band will report. */
  maxFrequency?: number;
  /** Lowest fundamental the low band will report. */
  minFrequency?: number;
  /** Clarity a high-band reading needs before the low band is skipped. */
  highBandConfidence?: number;
  /** Set false to skip the attack gate (useful in tests). */
  useOnsetGate?: boolean;
}

const HIGH_WINDOW = 512;
const HIGH_HOP = 128;
const LOW_WINDOW = 512;
const LOW_HOP = 64;
const DECIMATION = 4;

/**
 * Overlap region where either band may win; below it only the low band runs.
 * The low edge is 190 Hz rather than 180 so that the longest lag the high band
 * ever evaluates still fits two full periods inside its 512-sample window —
 * the NSDF's shrinking window makes estimates built from barely one period
 * noticeably noisier.
 */
const CROSSOVER_LOW_HZ = 190;
const CROSSOVER_HIGH_HZ = 220;

/**
 * How long a low-band reading stays usable. The low branch only produces a
 * result every other high hop (128 raw samples in yields 32 decimated, and a
 * low hop is 64), so without this the arbiter would see `null` on alternate
 * hops and publish "nothing sounding" over a perfectly good low note.
 */
const LOW_MAX_AGE_SAMPLES = HIGH_HOP * 4;

export class PitchEngine {
  sampleRate: number;

  private highBuffer: RingBuffer;
  private lowBuffer: RingBuffer;
  private decimator: Decimator;
  private highDetector: McLeodPitchDetector;
  private lowDetector: McLeodPitchDetector;
  private gate: SpectralFluxGate | null;
  private readonly options: Required<Omit<PitchEngineOptions, 'sampleRate'>>;

  private readonly highFrame = new Float32Array(HIGH_WINDOW);
  private readonly lowFrame = new Float32Array(LOW_WINDOW);
  private readonly decimated = new Float32Array(4096);

  private highPending = 0;
  private lowPending = 0;
  private lastLow: { result: PitchResult; sampleTime: number } | null = null;
  private readonly highBandConfidence: number;

  private latest: PitchFrame = {
    frequency: 0, clarity: 0, rms: 0, voiced: false, band: 'none', held: false, sampleTime: 0,
  };

  constructor(options: PitchEngineOptions = {}) {
    const {
      sampleRate = 48000, maxFrequency = 1000, minFrequency = 55,
      highBandConfidence = 0.88, useOnsetGate = true,
    } = options;

    this.highBandConfidence = highBandConfidence;
    this.options = { maxFrequency, minFrequency, highBandConfidence, useOnsetGate };
    this.sampleRate = sampleRate;

    this.highBuffer = new RingBuffer(HIGH_WINDOW * 4);
    this.lowBuffer = new RingBuffer(LOW_WINDOW * 4);
    this.decimator = new Decimator(sampleRate, DECIMATION);
    this.highDetector = this.buildHighDetector(sampleRate);
    this.lowDetector = this.buildLowDetector();
    this.gate = useOnsetGate ? new SpectralFluxGate(sampleRate, { fftSize: HIGH_WINDOW }) : null;
  }

  private buildHighDetector(sampleRate: number): McLeodPitchDetector {
    return new McLeodPitchDetector({
      sampleRate,
      windowSize: HIGH_WINDOW,
      minFrequency: CROSSOVER_LOW_HZ,
      maxFrequency: this.options.maxFrequency,
      clarityThreshold: 0.8,
    });
  }

  private buildLowDetector(): McLeodPitchDetector {
    return new McLeodPitchDetector({
      sampleRate: this.decimator.outputSampleRate,
      windowSize: LOW_WINDOW,
      minFrequency: this.options.minFrequency,
      maxFrequency: CROSSOVER_HIGH_HZ,
      // The low band is where octave errors live, so it is held to a stricter
      // peak threshold: a subharmonic must be *much* taller to win.
      peakThreshold: 0.9,
      clarityThreshold: 0.78,
    });
  }

  /**
   * Retunes the engine when the hardware turns out to be running at a rate
   * other than the one we asked for — which it often does.
   *
   * Done in place rather than by constructing a new engine so that the React
   * layer does not need a piece of state whose only job is to trigger that
   * construction. Cheap, and a no-op when the rate is unchanged.
   */
  reconfigure(sampleRate: number): void {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return;
    if (sampleRate === this.sampleRate) return;

    this.sampleRate = sampleRate;
    this.decimator = new Decimator(sampleRate, DECIMATION);
    this.highDetector = this.buildHighDetector(sampleRate);
    this.lowDetector = this.buildLowDetector();
    this.gate = this.options.useOnsetGate
      ? new SpectralFluxGate(sampleRate, { fftSize: HIGH_WINDOW })
      : null;
    this.reset();
  }

  /** Feeds a block of mono float samples. Safe to call from an audio callback. */
  push(samples: Float32Array, count = samples.length): void {
    this.highBuffer.write(samples, count);
    this.highPending += count;

    const produced = this.decimator.process(samples, count, this.decimated);
    if (produced > 0) {
      this.lowBuffer.write(this.decimated, produced);
      this.lowPending += produced;
    }

    this.drain();
  }

  /** Most recent published frame. Cheap; call it once per render frame. */
  read(): PitchFrame {
    return this.latest;
  }

  reset(): void {
    this.highBuffer.reset();
    this.lowBuffer.reset();
    this.decimator.reset();
    this.gate?.reset();
    this.highPending = 0;
    this.lowPending = 0;
    this.lastLow = null;
    this.latest = {
      frequency: 0, clarity: 0, rms: 0, voiced: false, band: 'none', held: false, sampleTime: 0,
    };
  }

  private drain(): void {
    while (this.highPending >= HIGH_HOP) {
      this.highPending -= HIGH_HOP;
      if (!this.highBuffer.readLatest(this.highFrame, HIGH_WINDOW)) continue;

      const attacking = this.gate ? this.gate.push(this.highFrame, HIGH_HOP) : false;
      const high = this.highDetector.detect(this.highFrame);

      const needLowBand = !high.voiced
        || high.clarity < this.highBandConfidence
        || high.frequency < CROSSOVER_HIGH_HZ;

      if (needLowBand && this.lowPending >= LOW_HOP) {
        this.lowPending %= LOW_HOP;
        if (this.lowBuffer.readLatest(this.lowFrame, LOW_WINDOW)) {
          this.lastLow = {
            result: this.lowDetector.detect(this.lowFrame),
            sampleTime: this.highBuffer.written,
          };
        }
      }

      const fresh = this.lastLow
        && this.highBuffer.written - this.lastLow.sampleTime <= LOW_MAX_AGE_SAMPLES;

      this.publish(high, fresh ? this.lastLow!.result : null, attacking);
    }

    // Keep the low branch's pending count from running away when the high
    // branch never asks for it.
    if (this.lowPending > LOW_HOP * 4) this.lowPending = LOW_HOP;
  }

  private publish(high: PitchResult, low: PitchResult | null, attacking: boolean): void {
    const sampleTime = this.highBuffer.written;

    // Mid-attack the detector is looking at scratch, not a note. Freeze rather
    // than flicker — a needle that jumps on every bow change is worse than one
    // that waits 35 ms for the string to speak.
    if (attacking && this.latest.voiced) {
      this.latest = { ...this.latest, held: true, sampleTime };
      return;
    }

    const chosen = this.arbitrate(high, low);
    if (!chosen) {
      this.latest = {
        frequency: 0, clarity: Math.max(high.clarity, low?.clarity ?? 0),
        rms: high.rms, voiced: false, band: 'none', held: false, sampleTime,
      };
      return;
    }

    this.latest = {
      frequency: chosen.result.frequency,
      clarity: chosen.result.clarity,
      rms: high.rms,
      voiced: true,
      band: chosen.band,
      held: false,
      sampleTime,
    };
  }

  private arbitrate(
    high: PitchResult, low: PitchResult | null,
  ): { result: PitchResult; band: 'high' | 'low' } | null {
    const highOk = high.voiced && high.frequency >= CROSSOVER_LOW_HZ;
    const lowOk = !!low?.voiced;

    if (highOk && lowOk) {
      // Both spoke. If the low band heard half of what the high band heard,
      // the high band has locked onto the second harmonic — which is precisely
      // the failure mode a cello's weak fundamental provokes. Trust the low
      // band, whose whole job is being right about octaves.
      const ratio = high.frequency / low!.frequency;
      if (ratio > 1.9 && ratio < 2.1) return { result: low!, band: 'low' };
      if (high.frequency >= CROSSOVER_HIGH_HZ && high.clarity >= this.highBandConfidence) {
        return { result: high, band: 'high' };
      }
      return low!.clarity >= high.clarity
        ? { result: low!, band: 'low' }
        : { result: high, band: 'high' };
    }

    if (highOk) return { result: high, band: 'high' };
    if (lowOk) return { result: low!, band: 'low' };
    return null;
  }
}

/**
 * Exponential smoother for the cents display.
 *
 * The engine's raw output is honest but restless — real intonation wobbles,
 * and at 375 frames a second the eye reads the wobble as instrument error. A
 * short time constant damps it without lying about the trend. Deliberately
 * *not* applied to the underlying judgement, only to what is drawn.
 */
export class CentsSmoother {
  private value = 0;
  private initialised = false;

  constructor(private readonly timeConstantMs = 90) {}

  push(cents: number, deltaMs: number): number {
    if (!this.initialised) {
      this.value = cents;
      this.initialised = true;
      return cents;
    }
    // A jump of more than a semitone is a new note, not drift — snap to it.
    if (Math.abs(cents - this.value) > 100) {
      this.value = cents;
      return cents;
    }
    const alpha = 1 - Math.exp(-deltaMs / this.timeConstantMs);
    this.value += alpha * (cents - this.value);
    return this.value;
  }

  reset(): void {
    this.initialised = false;
    this.value = 0;
  }
}
