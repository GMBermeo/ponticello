import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { activeNoteIndex, CelloSongScore, measureAt } from '@/domain/schema';

export interface PlayheadOptions {
  score: CelloSongScore;
  /** 1-based, inclusive. */
  loopFromBar: number;
  loopToBar: number;
  /** Percentage of the written tempo. */
  tempoPercent: number;
}

export interface Playhead {
  /** Score time in milliseconds, advanced on the UI thread every frame. */
  timeMs: SharedTime;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  /** Index of the note currently sounding. Updated a few times a second. */
  activeIndex: number;
  measureIndex: number;
  loopStartMs: number;
  loopEndMs: number;
}

type SharedTime = ReturnType<typeof useSharedValue<number>>;

/** How often the React-visible note index catches up with the clock. */
const INDEX_POLL_MS = 60;

/**
 * The transport.
 *
 * Time advances inside a Reanimated frame callback, so the scroll is driven
 * from the UI thread and does not stutter when JS is busy — which it will be,
 * because the pitch engine is running there. React only ever learns which note
 * is active, and only a dozen times a second: everything that has to be smooth
 * reads the shared value directly.
 */
export function usePlayhead({
  score, loopFromBar, loopToBar, tempoPercent,
}: PlayheadOptions): Playhead {
  const timeMs = useSharedValue(0);
  const rate = useSharedValue(tempoPercent / 100);
  const loopStart = useSharedValue(0);
  const loopEnd = useSharedValue(0);
  const running = useSharedValue(0);

  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [measureIndex, setMeasureIndex] = useState(0);

  const { loopStartMs, loopEndMs } = useMemo(() => {
    const first = score.measures[Math.max(0, loopFromBar - 1)] ?? score.measures[0];
    const last = score.measures[Math.min(score.measures.length - 1, loopToBar - 1)]
      ?? score.measures[score.measures.length - 1];
    return {
      loopStartMs: first?.startBarTimeMs ?? 0,
      loopEndMs: (last?.startBarTimeMs ?? 0) + (last?.durationMs ?? 0),
    };
  }, [score, loopFromBar, loopToBar]);

  useEffect(() => {
    loopStart.set(loopStartMs);
    loopEnd.set(loopEndMs);
    // Dropping the playhead outside the new loop would leave it stranded.
    if (timeMs.get() < loopStartMs || timeMs.get() > loopEndMs) timeMs.set(loopStartMs);
  }, [loopStartMs, loopEndMs, loopStart, loopEnd, timeMs]);

  useEffect(() => { rate.set(tempoPercent / 100); }, [tempoPercent, rate]);

  useFrameCallback((frame) => {
    'worklet';
    if (running.get() === 0) return;
    const deltaMs = frame.timeSincePreviousFrame ?? 16.67;
    const next = timeMs.get() + deltaMs * rate.get();
    timeMs.set(next >= loopEnd.get() ? loopStart.get() : next);
  }, true);

  // Poll the clock for the discrete state React needs. Reading a shared value
  // from JS is cheap; re-rendering 60 times a second would not be.
  const scoreRef = useRef(score);
  // Assigned in an effect rather than during render: React Compiler treats a
  // ref written mid-render as a correctness error, and it is right to — the
  // render may be thrown away.
  useEffect(() => { scoreRef.current = score; }, [score]);

  useEffect(() => {
    if (!playing) return;
    const handle = setInterval(() => {
      const t = timeMs.get();
      const current = scoreRef.current;
      setActiveIndex(activeNoteIndex(current, t));
      setMeasureIndex(measureAt(current, t)?.index ?? 0);
    }, INDEX_POLL_MS);
    return () => clearInterval(handle);
  }, [playing, timeMs]);

  // Shared values are writable straight from the JS thread; hopping through
  // runOnUI to flip a flag buys nothing and adds a scheduling round-trip.
  const play = useCallback(() => {
    running.set(1);
    setPlaying(true);
  }, [running]);

  const pause = useCallback(() => {
    running.set(0);
    setPlaying(false);
  }, [running]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const restart = useCallback(() => {
    timeMs.set(loopStartMs);
    setActiveIndex(activeNoteIndex(score, loopStartMs));
    setMeasureIndex(measureAt(score, loopStartMs)?.index ?? 0);
  }, [loopStartMs, score, timeMs]);

  return {
    timeMs, playing, play, pause, toggle, restart,
    activeIndex, measureIndex, loopStartMs, loopEndMs,
  };
}
