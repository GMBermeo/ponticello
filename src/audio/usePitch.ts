import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';

import { PitchTracker, SILENT_READING, type PitchReading } from './pitchTracker';
import { MicSource, TARGET_SAMPLE_RATE, useMicSource } from './sources';

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
  /** Subscribes to throttled text reading updates without causing parent re-renders. */
  subscribeReading: (listener: (reading: PitchReading) => void) => () => void;
}

export function usePitchReading(pitch: LivePitch): PitchReading {
  const [reading, setReading] = useState<PitchReading>(pitch.reading);
  useEffect(() => pitch.subscribeReading(setReading), [pitch]);
  return reading;
}

export interface UsePitchOptions {
  /** When true, applies 1s rolling median filtering and hold time for digital tuner display. */
  tunerMode?: boolean;
}

export function usePitch(enabled: boolean, options?: UsePitchOptions): LivePitch {
  const tunerMode = !!options?.tunerMode;
  const cents = useSharedValue(0);
  const level = useSharedValue(0);
  const tracking = useSharedValue(0);

  const readingRef = useRef<PitchReading>(SILENT_READING);
  const listenersRef = useRef(new Set<(reading: PitchReading) => void>());

  const publishReading = useCallback((next: PitchReading) => {
    readingRef.current = next;
    listenersRef.current.forEach((listener) => listener(next));
  }, []);

  const subscribeReading = useCallback((listener: (reading: PitchReading) => void) => {
    listenersRef.current.add(listener);
    listener(enabled ? readingRef.current : SILENT_READING);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, [enabled]);

  // Built once and retuned in place. Rebuilding it from a piece of React state
  // whenever the hardware reports a different sample rate would mean setting
  // that state from inside an effect, which cascades a render for something
  // the tracker can simply absorb.
  const tracker = useMemo(() => new PitchTracker({ tunerMode, sampleRate: TARGET_SAMPLE_RATE }), [tunerMode]);

  const setTarget = useCallback((midi: number | null) => tracker.setTarget(midi), [tracker]);

  const onSamples = useCallback((samples: Float32Array) => {
    const update = tracker.push(samples, Date.now());
    level.set(update.level);
    tracking.set(update.tracking);
    if (update.cents !== null) cents.set(update.cents);
    if (update.reading) publishReading(update.reading);
  }, [tracker, cents, level, tracking, publishReading]);

  const mic = useMicSource(onSamples, enabled);

  useEffect(() => {
    tracker.reconfigure(mic.sampleRate);
  }, [tracker, mic.sampleRate]);

  useEffect(() => {
    if (enabled) return;
    tracker.reset();
    cents.set(0);
    level.set(0);
    tracking.set(0);
    publishReading(SILENT_READING);
  }, [enabled, tracker, cents, level, tracking, publishReading]);

  return {
    cents,
    level,
    tracking,
    get reading() {
      return enabled ? readingRef.current : SILENT_READING;
    },
    mic,
    setTarget,
    subscribeReading,
  };
}
