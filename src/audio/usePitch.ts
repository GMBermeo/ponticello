import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';

import {
  centsBetween, IntonationVerdict, judgeIntonation, midiToFrequency, midiToPitchName,
} from '@/domain/cello';
import { CentsSmoother, PitchEngine } from './PitchEngine';
import { MicSource } from './sources/types';
import { useMicSource } from './sources/useMicSource';

export interface PitchReading {
  frequency: number;
  /** Nearest note name to what is actually sounding, regardless of the target. */
  heard: string | null;
  cents: number;
  verdict: IntonationVerdict | null;
  voiced: boolean;
  band: 'high' | 'low' | 'none';
  clarity: number;
}

const SILENT: PitchReading = {
  frequency: 0, heard: null, cents: 0, verdict: null, voiced: false, band: 'none', clarity: 0,
};

export interface LivePitch {
  /** Smoothed cents from the target, written on every audio frame. */
  cents: SharedValue<number>;
  /** Input level, 0–1, for the meter. */
  level: SharedValue<number>;
  /** 1 while a note is being tracked. Drives the fade on live indicators. */
  tracking: SharedValue<number>;
  /** Throttled snapshot, for anything rendered as text. */
  reading: PitchReading;
  mic: MicSource;
  /** Point the analysis at a note. Pass null to just report what is heard. */
  setTarget: (midi: number | null) => void;
}

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

export function usePitch(enabled: boolean): LivePitch {
  const cents = useSharedValue(0);
  const level = useSharedValue(0);
  const tracking = useSharedValue(0);

  const [heard, setHeard] = useState<PitchReading>(SILENT);

  // Built once and retuned in place. Rebuilding it from a piece of React state
  // whenever the hardware reports a different sample rate would mean setting
  // that state from inside an effect, which cascades a render for something
  // the engine can simply absorb.
  const engine = useMemo(() => new PitchEngine({ sampleRate: 48000 }), []);
  const smoother = useMemo(() => new CentsSmoother(90), []);

  const target = useRef<number | null>(null);
  const lastPublish = useRef(0);
  const lastFrameSample = useRef(0);

  const setTarget = useCallback((midi: number | null) => {
    if (target.current !== midi) {
      target.current = midi;
      smoother.reset();
    }
  }, [smoother]);

  const onSamples = useCallback((samples: Float32Array) => {
    engine.push(samples);
    const frame = engine.read();

    // Elapsed audio time since the last frame, for the smoother's time constant.
    const deltaMs = ((frame.sampleTime - lastFrameSample.current) / engine.sampleRate) * 1000;
    lastFrameSample.current = frame.sampleTime;

    // Level: a log curve, because linear RMS spends most of its range on the
    // loudest tenth and shows nothing at practice volume.
    const db = 20 * Math.log10(Math.max(frame.rms, 1e-5));
    level.set(Math.max(0, Math.min(1, (db + 60) / 54)));
    tracking.set(frame.voiced ? 1 : 0);

    if (frame.voiced && frame.frequency > 0) {
      const targetMidi = target.current;
      const targetHz = targetMidi === null
        ? midiToFrequency(Math.round(69 + 12 * Math.log2(frame.frequency / 440)))
        : midiToFrequency(targetMidi);
      cents.set(smoother.push(centsBetween(frame.frequency, targetHz), Math.max(deltaMs, 1)));
    }

    const now = Date.now();
    if (now - lastPublish.current < READING_INTERVAL_MS) return;
    lastPublish.current = now;

    if (!frame.voiced || frame.frequency <= 0) {
      setHeard((current) => (current.voiced ? SILENT : current));
      return;
    }

    const nearestMidi = Math.round(69 + 12 * Math.log2(frame.frequency / 440));
    const targetHz = target.current === null
      ? midiToFrequency(nearestMidi)
      : midiToFrequency(target.current);
    const deviation = centsBetween(frame.frequency, targetHz);

    setHeard({
      frequency: frame.frequency,
      heard: midiToPitchName(nearestMidi),
      cents: deviation,
      verdict: judgeIntonation(deviation),
      voiced: true,
      band: frame.band,
      clarity: frame.clarity,
    });
  }, [engine, cents, level, tracking, smoother]);

  const mic = useMicSource(onSamples, enabled);

  useEffect(() => {
    engine.reconfigure(mic.sampleRate);
  }, [engine, mic.sampleRate]);

  useEffect(() => {
    if (enabled) return;
    // Shared values are not React state, so clearing them here costs nothing;
    // the text reading is derived below rather than set.
    engine.reset();
    smoother.reset();
    cents.set(0);
    level.set(0);
    tracking.set(0);
  }, [enabled, engine, smoother, cents, level, tracking]);

  // Derived rather than stored: when the microphone is off there is nothing to
  // report, and that is a fact about `enabled`, not a state transition.
  const reading = enabled ? heard : SILENT;

  return { cents, level, tracking, reading, mic, setTarget };
}
