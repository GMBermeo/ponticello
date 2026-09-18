import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { PracticeLoop } from '@/domain/loop';
import { activeNoteIndex, CelloSongScore, measureAt } from '@/domain/schema';
import { DriftEstimator, scoreTimeAt } from '@/domain/transportClock';

export interface PlayheadOptions {
  score: CelloSongScore;
  /**
   * The loop being practised — the same object the accompaniment is rendered
   * from. Passing it in rather than re-deriving it from bar numbers is what
   * makes "the audio and the playhead disagree" unrepresentable.
   */
  loop: PracticeLoop;
}

/** The discrete reading React renders from: which note, which bar. */
export interface PlayheadPosition {
  activeIndex: number;
  measureIndex: number;
  /**
   * Score time floored to `WINDOW_QUANTUM_MS`, for choosing which notes to lay
   * out.
   *
   * The visions used to anchor their window on the active note's start. That
   * moved the window on every single note — a mount and an unmount per note,
   * which at 120 Hz is exactly the hitch you see "when the notes appear" — and
   * it stood still through a long rest, because the active note does not
   * change during one. A quantised clock moves the window twice a second,
   * whatever the music is doing.
   */
  windowMs: number;
}

/** Step of `PlayheadPosition.windowMs`. Visions keep more margin than this. */
export const WINDOW_QUANTUM_MS = 500;

/**
 * Whether the transport is running, and how many times it has been restarted.
 *
 * Subscribed to rather than returned on the `Playhead` object, because the
 * object's *identity* is what every `memo()` below it compares. When `playing`
 * lived on the object, pressing play replaced it, and the fingerboard panel,
 * all three visions and the top bar re-rendered in full at exactly the moment
 * the frame budget matters most. Now only the two leaves that actually read
 * this state re-render, and the object is created once per session.
 */
export interface PlayheadTransport {
  playing: boolean;
  /** Increments on every restart so dependent transports can seek too. */
  revision: number;
}

export interface Playhead {
  /** Score time in milliseconds, recomputed on the UI thread every frame. */
  timeMs: SharedValue<number>;
  /** Start now, or after an adapter-reported delay counted on the UI thread. */
  play: (delayMs?: number) => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  /** Snapshot of `playing`/`revision`. Stable until one of them changes. */
  getTransport: () => PlayheadTransport;
  subscribeTransport: (listener: () => void) => () => void;
  /**
   * Reads the clock from JS. The accompaniment calls this once, when it
   * starts, to work out where in the loop to begin.
   */
  scoreTimeMs: () => number;
  /**
   * Reports where the *audio* is, in score milliseconds.
   *
   * The audio is the reference: its position is sampled a few times a second
   * and the picture's anchor is eased onto it, so display-clock drift and
   * native loop gaps can never accumulate into notes arriving late.
   */
  syncToAudio: (audioScoreMs: number) => void;
  /** Snapshot of the discrete position. Stable until it changes. */
  getPosition: () => PlayheadPosition;
  /** Subscribe to position changes without re-rendering whoever owns the playhead. */
  subscribePosition: (listener: () => void) => () => void;
}

/** How often the React-visible note index catches up with the clock. */
const POSITION_POLL_MS = 33;

const START: PlayheadPosition = { activeIndex: 0, measureIndex: 0, windowMs: 0 };
const IDLE: PlayheadTransport = { playing: false, revision: 0 };

/**
 * The transport.
 *
 * Time is *anchored*, not accumulated — see `domain/transportClock.ts` for why
 * the old per-frame sum drifted at 120 Hz. The frame callback evaluates the
 * anchor at each frame's own timestamp on the UI thread, so the scroll neither
 * stutters when JS is busy nor loses time when a frame is late.
 *
 * React learns only which note and bar are current, through
 * `usePlayheadPosition`. That subscription is deliberately *not* state on the
 * hook's owner: when it was, every note change re-rendered the entire play
 * screen — header, fingerboard, visions and all — sixteen times a second.
 */
export function usePlayhead({ score, loop }: PlayheadOptions): Playhead {
  const timeMs = useSharedValue(0);
  const rate = useSharedValue(loop.tempoScale);
  const loopStart = useSharedValue(0);
  const loopEnd = useSharedValue(0);
  const running = useSharedValue(0);
  /** Frame time at which `anchorScore` is true. */
  const anchorAt = useSharedValue(0);
  const anchorScore = useSharedValue(0);
  /** Set from JS; consumed by the next frame, which anchors there. */
  const pendingStart = useSharedValue(0);
  const startDelayMs = useSharedValue(0);
  /** NaN when idle; otherwise a score time the next frame re-anchors to. */
  const reanchorTo = useSharedValue(Number.NaN);
  /** Advanced by every drawn frame, so the audio lock knows `timeMs` is fresh. */
  const frameCount = useSharedValue(0);

  const [playing, setPlaying] = useState(false);

  // Published outside React state for the same reason the position is: the
  // owner re-renders on a transport change either way, but its children must
  // not, and they only escape that if the `Playhead` object never changes.
  const transportRef = useRef<PlayheadTransport>(IDLE);
  const transportListeners = useRef(new Set<() => void>());
  const publishTransport = useCallback((patch: Partial<PlayheadTransport>) => {
    const next = { ...transportRef.current, ...patch };
    if (next.playing === transportRef.current.playing
      && next.revision === transportRef.current.revision) return;
    transportRef.current = next;
    for (const listener of transportListeners.current) listener();
  }, []);
  const getTransport = useCallback(() => transportRef.current, []);
  const subscribeTransport = useCallback((listener: () => void) => {
    transportListeners.current.add(listener);
    return () => { transportListeners.current.delete(listener); };
  }, []);

  const { fromMs: loopStartMs, toMs: loopEndMs, tempoScale } = loop;

  const estimator = useMemo(() => new DriftEstimator(), []);

  // ── Discrete position, published outside React state ─────────────────────
  const positionRef = useRef<PlayheadPosition>(START);
  const listenersRef = useRef(new Set<() => void>());
  const scoreRef = useRef(score);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const publish = useCallback((t: number) => {
    const current = scoreRef.current;
    const activeIndex = activeNoteIndex(current, t);
    const measureIndex = measureAt(current, t)?.index ?? 0;
    const windowMs = Math.floor(t / WINDOW_QUANTUM_MS) * WINDOW_QUANTUM_MS;
    const previous = positionRef.current;
    if (previous.activeIndex === activeIndex
      && previous.measureIndex === measureIndex
      && previous.windowMs === windowMs) return;
    positionRef.current = { activeIndex, measureIndex, windowMs };
    for (const listener of listenersRef.current) listener();
  }, []);

  const getPosition = useCallback(() => positionRef.current, []);
  const subscribePosition = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  /** Moves the clock to `t`, whether or not the frame callback is running. */
  const moveTo = useCallback((t: number) => {
    timeMs.set(t);
    if (running.get() === 1) reanchorTo.set(t);
    estimator.reset();
    publish(t);
  }, [estimator, publish, reanchorTo, running, timeMs]);

  useEffect(() => {
    loopStart.set(loopStartMs);
    loopEnd.set(loopEndMs);
    // Dropping the playhead outside the new loop would leave it stranded.
    const t = timeMs.get();
    if (t < loopStartMs || t > loopEndMs) moveTo(loopStartMs);
    else publish(t);
  }, [loopStartMs, loopEndMs, loopStart, loopEnd, timeMs, moveTo, publish, score]);

  useEffect(() => {
    if (rate.get() === tempoScale) return;
    rate.set(tempoScale);
    // Keep the position; only the speed from here on changes.
    if (running.get() === 1) reanchorTo.set(timeMs.get());
    estimator.reset();
  }, [tempoScale, rate, running, reanchorTo, timeMs, estimator]);

  useFrameCallback((frame) => {
    'worklet';
    const now = frame.timestamp;

    if (pendingStart.get() === 1) {
      pendingStart.set(0);
      // The audio boundary is `startDelayMs` away; the anchor sits on it, and
      // `scoreTimeAt` holds the position until the frame clock reaches it.
      anchorAt.set(now + startDelayMs.get());
      anchorScore.set(timeMs.get());
      running.set(1);
    }
    if (running.get() === 0) return;
    frameCount.set(frameCount.get() + 1);

    const target = reanchorTo.get();
    if (!Number.isNaN(target)) {
      reanchorTo.set(Number.NaN);
      anchorScore.set(target);
      // A re-anchor inside the start lead keeps the lead.
      anchorAt.set(Math.max(now, anchorAt.get()));
    }

    timeMs.set(scoreTimeAt(
      anchorAt.get(), anchorScore.get(), rate.get(), now, loopStart.get(), loopEnd.get(),
    ));
  }, true);

  useEffect(() => {
    if (!playing) return;
    const handle = setInterval(() => publish(timeMs.get()), POSITION_POLL_MS);
    return () => clearInterval(handle);
  }, [playing, publish, timeMs]);

  // Shared values are writable straight from the JS thread; hopping through
  // runOnUI to flip a flag buys nothing and adds a scheduling round-trip.
  const play = useCallback((delayMs = 0) => {
    const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    startDelayMs.set(delay);
    reanchorTo.set(Number.NaN);
    pendingStart.set(1);
    estimator.reset();
    setPlaying(true);
    publishTransport({ playing: true });
  }, [estimator, pendingStart, publishTransport, reanchorTo, startDelayMs]);

  const pause = useCallback(() => {
    pendingStart.set(0);
    running.set(0);
    estimator.reset();
    publish(timeMs.get());
    setPlaying(false);
    publishTransport({ playing: false });
  }, [estimator, pendingStart, publish, publishTransport, running, timeMs]);

  // Reads the published snapshot rather than the state variable, so `toggle`
  // — and with it the whole `Playhead` object — stays identity-stable.
  const toggle = useCallback(() => {
    if (transportRef.current.playing) pause();
    else play();
  }, [play, pause]);

  const restart = useCallback(() => {
    moveTo(loopStartMs);
    publishTransport({ revision: transportRef.current.revision + 1 });
  }, [loopStartMs, moveTo, publishTransport]);

  const scoreTimeMs = useCallback(() => timeMs.get(), [timeMs]);

  const syncToAudio = useCallback((audioScoreMs: number) => {
    // Not while paused, and not inside the start lead, where the picture is
    // deliberately holding still for audio that has not begun.
    if (running.get() === 0 || pendingStart.get() === 1 || !Number.isFinite(audioScoreMs)) return;
    const correction = estimator.push(
      timeMs.get(), audioScoreMs, loopStart.get(), loopEnd.get(), frameCount.get(),
    );
    if (correction !== 0) anchorScore.set(anchorScore.get() + correction);
  }, [anchorScore, estimator, frameCount, loopEnd, loopStart, pendingStart, running, timeMs]);

  return useMemo(() => ({
    timeMs, play, pause, toggle, restart, scoreTimeMs, syncToAudio,
    getPosition, subscribePosition, getTransport, subscribeTransport,
  }), [
    timeMs, play, pause, toggle, restart, scoreTimeMs, syncToAudio,
    getPosition, subscribePosition, getTransport, subscribeTransport,
  ]);
}

/**
 * Whether the transport is running. Re-renders only the caller, only on change.
 * Read this instead of a `playing` prop threaded down from the play screen.
 */
export function usePlayheadTransport(
  playhead: Pick<Playhead, 'getTransport' | 'subscribeTransport'>,
): PlayheadTransport {
  return useSyncExternalStore(
    playhead.subscribeTransport, playhead.getTransport, playhead.getTransport,
  );
}

/** Which note and bar are current. Re-renders only the caller, only on change. */
export function usePlayheadPosition(playhead: Pick<Playhead, 'getPosition' | 'subscribePosition'>): PlayheadPosition {
  return useSyncExternalStore(playhead.subscribePosition, playhead.getPosition, playhead.getPosition);
}
