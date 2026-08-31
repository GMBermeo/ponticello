import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AccompanimentStyle, BackingPart, BackingTrack, generateAccompaniment, soloPartFromScore,
} from '@/domain/backing';
import { clipToLoop, loopBudget, PracticeLoop } from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { buildProgram, programOffsetSeconds } from './backing/program';
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
 * — so there was a ninety-second ceiling, and 219 of the 258 songs fell outside
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
}

export function useBacking(options: UseBackingOptions): BackingState {
  const {
    score, backing, listenMode, accompaniment, loop, playing, volume, scoreTimeMs,
  } = options;

  const enabled = listenMode !== 'off';
  const player = useBackingPlayer(enabled);

  const [preparing, setPreparing] = useState(false);

  const soloParts = useMemo<BackingPart[]>(() => {
    // Imported parts are in score time and have to be clipped like anything
    // else. Skipping this is what made an imported backing unusable.
    const imported = (backing?.parts ?? []).filter((p) => p.role === 'solo');
    if (imported.length > 0) return clipToLoop(imported, loop);
    if (!score) return [];
    return clipToLoop([soloPartFromScore(score)], loop);
  }, [backing, score, loop]);

  const accompanimentParts = useMemo<BackingPart[]>(() => {
    const imported = (backing?.parts ?? []).filter((p) => p.role === 'accompaniment');
    if (imported.length > 0) return clipToLoop(imported, loop);
    if (!score) return [];
    // The generator is handed the window and returns notes already rebased to
    // it, so it is clipped by construction — running it through `clipToLoop`
    // again would measure loop-relative times against score-relative bounds.
    return generateAccompaniment(score, {
      style: accompaniment,
      fromBar: loop.fromBar,
      toBar: loop.toBar,
    });
  }, [backing, score, accompaniment, loop]);

  const audibleParts = useMemo(() => {
    switch (listenMode) {
      case 'solo': return soloParts;
      case 'backing': return accompanimentParts;
      case 'both': return [...accompanimentParts, ...soloParts];
      default: return [];
    }
  }, [listenMode, soloParts, accompanimentParts]);

  /**
   * The program. Derived, not stored: it is a pure function of the music, the
   * window and the tempo, so there is nothing here for a stale piece of state
   * to disagree with.
   */
  const program = useMemo(
    () => buildProgram({
      id: `${score?.id ?? 'none'}:${listenMode}:${accompaniment}`,
      parts: audibleParts,
      loop,
    }),
    [score?.id, listenMode, accompaniment, audibleParts, loop],
  );

  const budget = useMemo(() => loopBudget(loop), [loop]);

  // Hand the program over whenever it changes. Debounced, because the tempo and
  // loop steppers fire on every tap and most taps are superseded.
  const loadToken = useRef(0);
  useEffect(() => {
    if (!enabled || program.notes.length === 0 || !budget.withinBudget) return;

    const token = ++loadToken.current;
    const handle = setTimeout(() => {
      setPreparing(true);
      player.load(program).finally(() => {
        if (loadToken.current === token) setPreparing(false);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // `player` is a stable set of callbacks; including it would reload the
    // audio on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, program, budget.withinBudget]);

  useEffect(() => { player.setVolume(volume); }, [player, volume]);

  /**
   * Starts the accompaniment *where the playhead already is*.
   *
   * Without the offset the loop always began at its own first note, so pressing
   * play half way through a phrase put the backing a half-phrase ahead and it
   * stayed there for the rest of the session. The offset is read at this
   * instant rather than tracked, because the two clocks only need introducing
   * once — after that they are the same length and stay together.
   */
  const start = useCallback(() => {
    const now = scoreTimeMs?.() ?? loop.fromMs;
    player.play(programOffsetSeconds(program, loop, now));
  }, [player, program, loop, scoreTimeMs]);

  const halt = useCallback(() => player.stop(), [player]);

  useEffect(() => {
    // `budget.withinBudget` belongs here as well as in the load: refusing to
    // prepare an over-long loop leaves the *previous* program loaded, and
    // playing that would be worse than silence — it is a different passage.
    if (playing && enabled && player.ready && budget.withinBudget) start();
    else halt();
  }, [playing, enabled, player.ready, budget.withinBudget, start, halt]);

  // Derived, not stored: with nothing to sound there is no loop, and that is a
  // fact about the current mode rather than a state transition.
  const wouldSound = enabled && program.notes.length > 0;

  // An over-long loop is likewise a property of the current window, so it is
  // derived here instead of being pushed into state from inside an effect. It
  // outranks a stale player error: it is the reason there is no sound *now*.
  const error = (wouldSound && !budget.withinBudget ? budget.message : null)
    ?? player.error;

  return {
    ready: player.ready,
    rendering: preparing || player.progress < 1,
    progress: player.progress,
    error,
    audibleParts,
    hasSolo: soloParts.length > 0,
    hasAccompaniment: accompanimentParts.length > 0,
    loopDurationMs: wouldSound ? loop.realDurationMs : 0,
    noteCount: program.notes.length,
  };
}
