import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccompanimentStyle, BackingPart, BackingTrack } from '@/domain/backing';
import { loopBudget, loopOffsetSeconds, PracticeLoop } from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { resolveAudibleProgram } from './backing/program';
import { backingTransportDecision } from './backing/transport';
import { ListenMode } from './backing/types';
import { useBackingPlayer } from './backing/useBackingPlayer';

/**
 * Backing accompaniment, resolved and played in step with the practice loop.
 *
 * The loop is still the unit: it holds exactly the bars being practised at
 * exactly the chosen tempo, and the player repeats it. That removes the whole
 * category of drift and seek problems, because the audio cannot fall out of
 * step with the playhead — there is only one cycle and it ends where it began.
 *
 * What changed is what gets handed over. This used to synthesise the loop into
 * a `Float32Array` and give the player samples. For the library this app ships
 * that was fatal: the median bundled song is three and a half minutes, the
 * longest is nine, and the render cost 47 MB and a second of blocked JS thread
 * — so there was a ninety-second ceiling, and 229 of the 258 songs fell outside
 * it and played in silence. Now the parts are resolved into a `BackingProgram`
 * — notes in real seconds, gain-staged once — and each platform does the
 * cheapest thing it can with it. There is no length ceiling left to trip over.
 */

/** Wait for the steppers to settle before spending anything on a load. */
const DEBOUNCE_MS = 220;

export interface UseBackingOptions {
  score: CelloSongScore | null;
  /** An imported MIDI backing, if this piece has one. */
  backing: BackingTrack | null;
  listenMode: ListenMode;
  accompaniment: AccompanimentStyle;
  /**
   * The loop being practised. The transport is driven from this same object,
   * which is the whole point: there is no second derivation to disagree with.
   */
  loop: PracticeLoop;
  playing: boolean;
  /** Monotonic restart token from the visual transport owner. */
  transportRevision?: number;
  /** 0–1. */
  volume: number;
  /**
   * The playhead's current score time, read at the instant playback starts.
   *
   * A function rather than a value: the playhead advances on the UI thread
   * every frame and putting that in a dependency array would re-render the
   * audio sixty times a second. This is only ever *called*, and only when the
   * transport starts.
   */
  scoreTimeMs?: () => number;
  /** Pause/freeze the visual clock before an asynchronous platform start. */
  onPlaybackWillStart?: () => void;
  /** Start/resume the visual clock at the adapter's reported boundary. */
  onPlaybackStarted?: (delaySeconds?: number) => void;
}

export interface BackingState {
  ready: boolean;
  rendering: boolean;
  /** 0–1 while a program is being prepared. Native only; web is always 1. */
  progress: number;
  error: string | null;
  /** Parts that would sound in the current mode, for the mixer display. */
  audibleParts: BackingPart[];
  hasSolo: boolean;
  hasAccompaniment: boolean;
  /** Length of the loop, in real milliseconds at the chosen tempo. */
  loopDurationMs: number;
  /** How many notes will actually sound. Zero here means silence, and why. */
  noteCount: number;
  /**
   * Where the audio is, in *score* milliseconds, or null when nothing is
   * sounding. The visual clock is locked to this.
   */
  audioScoreTimeMs: () => number | null;
}

export function useBacking(options: UseBackingOptions): BackingState {
  const {
    score, backing, listenMode, accompaniment, loop, playing, transportRevision = 0,
    volume, scoreTimeMs, onPlaybackWillStart, onPlaybackStarted,
  } = options;

  const enabled = listenMode !== 'off';
  const {
    load: loadPlayer,
    play: playPlayer,
    stop: stopPlayer,
    setVolume: setPlayerVolume,
    positionSeconds,
    ready: playerReady,
    progress: playerProgress,
    error: playerError,
  } = useBackingPlayer(enabled);

  const [preparing, setPreparing] = useState(false);

  const { soloParts, accompanimentParts, audibleParts, program } = useMemo(
    () => resolveAudibleProgram({ score, backing, loop, listenMode, accompaniment }),
    [score, backing, loop, listenMode, accompaniment],
  );

  const budget = useMemo(() => loopBudget(loop), [loop]);

  // Hand the program over whenever it changes. The outgoing program is stopped
  // immediately so a silent/new selection can never keep old music sounding.
  // Non-empty programs remain debounced because tempo and loop steppers often
  // supersede one another; clearing an empty program is cheap and immediate.
  const loadToken = useRef(0);
  const [loadedProgramKey, setLoadedProgramKey] = useState<string | null>(null);
  useEffect(() => {
    const token = ++loadToken.current;
    stopPlayer();

    if (!enabled || !budget.withinBudget) {
      const handle = setTimeout(() => {
        if (loadToken.current === token) setPreparing(false);
      }, 0);
      return () => clearTimeout(handle);
    }

    const load = () => {
      setPreparing(true);
      loadPlayer(program)
        .then(() => {
          if (loadToken.current === token) setLoadedProgramKey(program.key);
        })
        .finally(() => {
          if (loadToken.current === token) setPreparing(false);
        });
    };

    const handle = setTimeout(load, program.notes.length === 0 ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [enabled, program, budget.withinBudget, loadPlayer, stopPlayer]);

  useEffect(() => { setPlayerVolume(volume); }, [setPlayerVolume, volume]);

  // Derived, not stored: with nothing to sound there is no loop, and that is a
  // fact about the current mode rather than a state transition.
  const wouldSound = enabled && program.notes.length > 0;
  const currentProgramReady = enabled && budget.withinBudget
    && loadedProgramKey === program.key && playerReady;

  /**
   * Starts the accompaniment *where the paused playhead already is*.
   *
   * Native must finish its seek and web must reach its scheduled audio-clock
   * boundary before `onPlaybackStarted` resumes the visual clock. Freezing
   * first also makes changing listen mode while already playing phase-safe.
   */
  const start = useCallback(() => {
    onPlaybackWillStart?.();
    const now = scoreTimeMs?.() ?? loop.fromMs;
    playPlayer(loopOffsetSeconds(loop, now), onPlaybackStarted);
  }, [loop, onPlaybackStarted, onPlaybackWillStart, playPlayer, scoreTimeMs]);

  const halt = useCallback(() => stopPlayer(), [stopPlayer]);

  const transportDecision = backingTransportDecision({
    requested: playing,
    wouldSound,
    withinBudget: budget.withinBudget,
    loadedProgramKey,
    programKey: program.key,
    playerReady,
    playerError,
  });

  useEffect(() => {
    switch (transportDecision) {
      case 'halt':
        halt();
        return;
      case 'visual-only':
        halt();
        onPlaybackStarted?.();
        return;
      case 'start':
        start();
        return;
      case 'wait':
        // A requested sounding program is still loading. Keep the visual clock
        // frozen rather than letting it get ahead before the adapter is ready.
        onPlaybackWillStart?.();
        halt();
    }
  }, [
    transportDecision, transportRevision, start, halt,
    onPlaybackStarted, onPlaybackWillStart,
  ]);

  // An over-long loop is likewise a property of the current window, so it is
  // derived here instead of being pushed into state from inside an effect. It
  // outranks a stale player error: it is the reason there is no sound *now*.
  const error = (wouldSound && !budget.withinBudget ? budget.message : null)
    ?? playerError;

  // Real seconds into the loop, back to the score clock the notes are written
  // against: the same conversion `loopOffsetSeconds` makes in the other direction.
  const { fromMs: loopFromMs, tempoScale } = loop;
  const audioScoreTimeMs = useCallback((): number | null => {
    if (!currentProgramReady) return null;
    const seconds = positionSeconds();
    return seconds === null ? null : loopFromMs + seconds * 1000 * tempoScale;
  }, [currentProgramReady, loopFromMs, positionSeconds, tempoScale]);

  return {
    ready: currentProgramReady,
    rendering: preparing || playerProgress < 1,
    progress: playerProgress,
    error,
    audibleParts,
    hasSolo: soloParts.length > 0,
    hasAccompaniment: accompanimentParts.length > 0,
    loopDurationMs: wouldSound ? loop.realDurationMs : 0,
    noteCount: program.notes.length,
    audioScoreTimeMs,
  };
}
