/**
 * What the player sees of their pitch, decided frame by frame: the needle's
 * cents, the level meter, and a throttled reading for text.
 *
 * Pure policy — no React, no microphone. `usePitch` is the adapter that feeds
 * it samples and writes its updates into shared values; tests feed it frames.
 */

import {
  centsBetween, frequencyToMidi, IntonationVerdict, judgeIntonation, midiToFrequency, midiToPitchName,
} from '@domain';
import {
  CentsSmoother, PitchEngine, TunerPitchSmoother, type PitchFrame, type TunerSmoothedReading,
} from './PitchEngine';

export interface PitchReading {
  frequency: number;
  /** Nearest note name to what is actually sounding, regardless of the target. */
  heard: string | null;
  cents: number;
  verdict: IntonationVerdict | null;
  voiced: boolean;
  band: 'high' | 'low' | 'none';
  clarity: number;
  stability?: number;
}


export const SILENT_READING: PitchReading = {
  frequency: 0, heard: null, cents: 0, verdict: null, voiced: false, band: 'none', clarity: 0, stability: 0,
};

/**
 * How often the React-visible reading updates.
 *
 * The engine publishes ~375 frames a second. Re-rendering at that rate would
 * be pointless — nobody can read a note name changing 375 times a second — and
 * would keep the JS thread permanently busy. The continuous parts of the
 * display (the needle, the level meter) ride Reanimated shared values instead
 * and update every audio frame without touching React at all.
 */
const READING_INTERVAL_MS = 80;
const TUNER_READING_INTERVAL_MS = 100;

/** Level as a log curve: linear RMS spends most of its range on the loudest tenth and shows nothing at practice volume. */
function levelFromRms(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-5));
  return Math.max(0, Math.min(1, (db + 60) / 54));
}

function hasPitch(frame: PitchFrame): boolean {
  return frame.voiced && frame.frequency > 0;
}

/** The target's frequency, or with no target the nearest semitone to what is sounding. */
function referenceHz(frequency: number, targetMidi: number | null): number {
  return midiToFrequency(targetMidi ?? Math.round(frequencyToMidi(frequency)));
}

function tunerReading(smoothed: TunerSmoothedReading, frame: PitchFrame): PitchReading | null {
  if (!smoothed.voiced || smoothed.frequency <= 0) return null;
  return {
    frequency: smoothed.frequency,
    heard: midiToPitchName(smoothed.nearestMidi),
    cents: smoothed.cents,
    verdict: judgeIntonation(smoothed.cents),
    voiced: true,
    band: frame.band,
    clarity: frame.clarity,
    stability: smoothed.stability,
  };
}

function practiceReading(frame: PitchFrame, targetMidi: number | null): PitchReading | null {
  if (!hasPitch(frame)) return null;
  const deviation = centsBetween(frame.frequency, referenceHz(frame.frequency, targetMidi));
  return {
    frequency: frame.frequency,
    heard: midiToPitchName(Math.round(frequencyToMidi(frame.frequency))),
    cents: deviation,
    verdict: judgeIntonation(deviation),
    voiced: true,
    band: frame.band,
    clarity: frame.clarity,
  };
}

/** Where frames come from: the real `PitchEngine`, or a scripted source in tests. */
export interface FrameSource {
  readonly sampleRate: number;
  push(samples: Float32Array): void;
  read(): PitchFrame;
  reconfigure(sampleRate: number): void;
  reset(): void;
}

/** What one block of samples changes. */
export interface PitchUpdate {
  /** Input level, 0–1. */
  level: number;
  /** 1 while a note is being tracked. */
  tracking: 0 | 1;
  /** New needle position in cents, or null to leave it where it is. */
  cents: number | null;
  /** A reading to publish, or null when nothing should be published this frame. */
  reading: PitchReading | null;
}

export interface PitchTrackerOptions {
  /** 1 s rolling median and hold time, for a tuner's steady display. */
  tunerMode: boolean;
  source?: FrameSource;
  sampleRate?: number;
}

export class PitchTracker {
  private readonly source: FrameSource;
  private readonly tunerMode: boolean;
  private readonly smoother = new CentsSmoother(90);
  private readonly tunerSmoother = new TunerPitchSmoother(1000, 450);
  private target: number | null = null;
  private lastPublishMs = 0;
  private lastFrameSample = 0;
  private publishedVoiced = false;

  constructor(options: PitchTrackerOptions) {
    this.tunerMode = options.tunerMode;
    this.source = options.source ?? new PitchEngine({ sampleRate: options.sampleRate ?? 48000 });
  }

  /** Point the analysis at a note. Null reports the nearest semitone to whatever is heard. */
  setTarget(midi: number | null): void {
    if (this.target === midi) return;
    this.target = midi;
    this.smoother.reset();
    this.tunerSmoother.reset();
  }

  reconfigure(sampleRate: number): void {
    this.source.reconfigure(sampleRate);
  }

  /** Forget everything heard; the next published reading starts from silence. */
  reset(): void {
    this.source.reset();
    this.smoother.reset();
    this.tunerSmoother.reset();
    this.publishedVoiced = false;
  }

  push(samples: Float32Array, nowMs: number): PitchUpdate {
    this.source.push(samples);
    const frame = this.source.read();
    // Elapsed audio time since the last frame, for the smoother's time constant.
    const deltaMs = ((frame.sampleTime - this.lastFrameSample) / this.source.sampleRate) * 1000;
    this.lastFrameSample = frame.sampleTime;
    const update = this.tunerMode ? this.tunerUpdate(frame, nowMs) : this.practiceUpdate(frame, nowMs, deltaMs);
    return { level: levelFromRms(frame.rms), tracking: frame.voiced ? 1 : 0, ...update };
  }

  private tunerUpdate(frame: PitchFrame, nowMs: number): Pick<PitchUpdate, 'cents' | 'reading'> {
    const rawDeviation = hasPitch(frame) ? centsBetween(frame.frequency, referenceHz(frame.frequency, this.target)) : 0;
    const smoothed = this.tunerSmoother.push(frame.voiced ? frame.frequency : 0, rawDeviation, nowMs);
    return {
      cents: smoothed.voiced ? smoothed.cents : null,
      reading: this.throttled(nowMs, TUNER_READING_INTERVAL_MS, tunerReading(smoothed, frame)),
    };
  }

  private practiceUpdate(frame: PitchFrame, nowMs: number, deltaMs: number): Pick<PitchUpdate, 'cents' | 'reading'> {
    let cents: number | null = null;
    if (hasPitch(frame)) {
      const deviation = centsBetween(frame.frequency, referenceHz(frame.frequency, this.target));
      cents = this.smoother.push(deviation, Math.max(deltaMs, 1));
    }
    return { cents, reading: this.throttled(nowMs, READING_INTERVAL_MS, practiceReading(frame, this.target)) };
  }

  /** At most one reading per interval; silence is published once, when a note stops. */
  private throttled(nowMs: number, intervalMs: number, next: PitchReading | null): PitchReading | null {
    if (nowMs - this.lastPublishMs < intervalMs) return null;
    this.lastPublishMs = nowMs;
    if (next) {
      this.publishedVoiced = true;
      return next;
    }
    if (!this.publishedVoiced) return null;
    this.publishedVoiced = false;
    return SILENT_READING;
  }
}
