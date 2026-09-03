import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { PracticeLoop } from '@/domain/loop';
import { activeNoteIndex, CelloSongScore, measureAt } from '@/domain/schema';

export interface PlayheadOptions {
  score: CelloSongScore;
  /**
   * The loop being practised — the same object the accompaniment is rendered
   * from. Passing it in rather than re-deriving it from bar numbers is what
   * makes "the audio and the playhead disagree" unrepresentable.
   */
  loop: PracticeLoop;
}

export interface Playhead {
  /** Score time in milliseconds, advanced on the UI thread every frame. */
  timeMs: SharedTime;
  playing: boolean;
  /** Start now, or after an adapter-reported delay counted on the UI thread. */
  play: (delayMs?: number) => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  /** Increments on every restart so dependent transports can seek too. */
  revision: number;
  /**
   * Reads the clock from JS. The accompaniment calls this once, when it
   * starts, to work out where in the loop to begin.
   */
  scoreTimeMs: () => number;
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
export function usePlayhead({ score, loop }: PlayheadOptions): Playhead {
  const timeMs = useSharedValue(0);
  const rate = useSharedValue(loop.tempoScale);
  const loopStart = useSharedValue(0);
  const loopEnd = useSharedValue(0);
  const running = useSharedValue(0);
  const startDelayMs = useSharedValue(0);

  const [playing, setPlaying] = useState(false);
  const [revision, setRevision] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [measureIndex, setMeasureIndex] = useState(0);

  const { fromMs: loopStartMs, toMs: loopEndMs } = loop;

  useEffect(() => {
    loopStart.set(loopStartMs);
    loopEnd.set(loopEndMs);
    // Dropping the playhead outside the new loop would leave it stranded.
    if (timeMs.get() < loopStartMs || timeMs.get() > loopEndMs) timeMs.set(loopStartMs);
  }, [loopStartMs, loopEndMs, loopStart, loopEnd, timeMs]);

  useEffect(() => { rate.set(loop.tempoScale); }, [loop.tempoScale, rate]);

  useFrameCallback((frame) => {
    'worklet';
    let deltaMs = frame.timeSincePreviousFrame ?? 16.67;

    if (running.get() === 0) {
      const pending = startDelayMs.get();
      if (pending <= 0) return;
      const remaining = pending - deltaMs;
      if (remaining > 0) {
        startDelayMs.set(remaining);
        return;
      }
      // The audio boundary landed inside this frame. Start at that boundary
      // and retain only the overshoot, rather than advancing a whole frame.
      startDelayMs.set(0);
      running.set(1);
      deltaMs = Math.max(0, -remaining);
    }

    const start = loopStart.get();
    const end = loopEnd.get();
    const span = end - start;
    const next = timeMs.get() + deltaMs * rate.get();

    if (span <= 0) {
      timeMs.set(start);
      return;
    }
    // Carry the overshoot across the loop point instead of snapping to the
    // start. A frame lands wherever it lands — up to about 16 ms past the end —
    // and throwing that remainder away shortened every repeat by a fraction of
    // a frame, so after a few minutes the playhead was visibly ahead of the
    // accompaniment even though both were running at the right speed.
    timeMs.set(next >= end ? start + ((next - start) % span) : next);
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
  const play = useCallback((delayMs = 0) => {
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    startDelayMs.set(delay);
    running.set(delay === 0 ? 1 : 0);
    setPlaying(true);
  }, [running, startDelayMs]);

  const pause = useCallback(() => {
    startDelayMs.set(0);
    running.set(0);
    setPlaying(false);
  }, [running, startDelayMs]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const restart = useCallback(() => {
    timeMs.set(loopStartMs);
    setActiveIndex(activeNoteIndex(score, loopStartMs));
    setMeasureIndex(measureAt(score, loopStartMs)?.index ?? 0);
    setRevision((current) => current + 1);
  }, [loopStartMs, score, timeMs]);

  const scoreTimeMs = useCallback(() => timeMs.get(), [timeMs]);

  return {
    timeMs, playing, play, pause, toggle, restart, revision, scoreTimeMs,
    activeIndex, measureIndex, loopStartMs, loopEndMs,
  };
}
