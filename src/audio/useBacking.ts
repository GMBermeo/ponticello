import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AccompanimentStyle, BackingPart, BackingTrack, generateAccompaniment, soloPartFromScore,
} from '@/domain/backing';
import { clipToLoop, loopBudget, loopOffsetSeconds, PracticeLoop } from '@/domain/loop';
import { CelloSongScore } from '@/domain/schema';
import { fadeEdges, limit, renderParts } from './synth';
import { ListenMode } from './backing/types';
import { useBackingPlayer } from './backing/useBackingPlayer';

/**
 * Backing accompaniment, rendered and played in step with the practice loop.
 *
 * The audio buffer *is* the loop: it holds exactly the bars being practised at
 * exactly the chosen tempo, and the player repeats it. That removes the whole
 * category of drift and seek problems a scheduler would introduce — the audio
 * cannot fall out of step with the playhead because there is nothing to keep in
 * step, only one buffer that ends where it began.
 *
 * That was always the intent; it only became true here. Parts that arrived with
 * the piece used to bypass the clip and be rendered end to end, so a four-bar
 * loop was accompanied by an eleven-minute recording of the whole movement —
 * megabytes of it, re-synthesised on every change, starting from its own
 * beginning no matter where the playhead was. Both halves of that are fixed by
 * the same thing: one loop module, consulted by everyone, applied to every part.
 */

/**
 * 22.05 kHz. An accompaniment is a reference, not the recording, and halving
 * the rate halves the render time — which matters because a re-render happens
 * every time a stepper moves.
 */
const RENDER_SAMPLE_RATE = 22050;

/** Wait for the steppers to settle before spending anything on a render. */
const DEBOUNCE_MS = 260;

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
  error: string | null;
  /** Parts that would sound in the current mode, for the mixer display. */
  audibleParts: BackingPart[];
  hasSolo: boolean;
  hasAccompaniment: boolean;
  /** Length of the rendered loop, in real milliseconds at the chosen tempo. */
  loopDurationMs: number;
}

export function useBacking(options: UseBackingOptions): BackingState {
  const {
    score, backing, listenMode, accompaniment, loop, playing, volume, scoreTimeMs,
  } = options;

  const enabled = listenMode !== 'off';
  const player = useBackingPlayer(enabled);

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedDurationMs, setRenderedDurationMs] = useState(0);

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

  const budget = useMemo(() => loopBudget(loop), [loop]);

  // Re-render whenever what should be heard changes. Debounced, because the
  // tempo and loop steppers fire on every tap.
  const renderToken = useRef(0);
  useEffect(() => {
    if (!enabled || audibleParts.length === 0) return;

    // Refuse rather than allocate: an hour-long window is not a practice loop,
    // and trying to synthesise one is how the app used to run out of memory.
    // Nothing is *set* here — the refusal is a fact about the current loop, so
    // it is reported by derivation below rather than written into state.
    if (!budget.withinBudget) return;

    const token = ++renderToken.current;

    const handle = setTimeout(() => {
      // "Preparing" is announced only once the debounce has elapsed: flagging
      // it immediately would flicker the label on every tap of a stepper, and
      // most taps are superseded before any work starts.
      setRendering(true);

      // Yield once more so that label actually paints before the synthesis
      // occupies the thread.
      setTimeout(async () => {
        if (renderToken.current !== token) return;
        try {
          // One duration, from the loop. Not re-derived, and no longer
          // different depending on where the parts came from.
          const durationMs = loop.realDurationMs;

          const samples = renderParts(audibleParts, {
            sampleRate: RENDER_SAMPLE_RATE,
            durationMs,
            tempoScale: loop.tempoScale,
          });
          fadeEdges(limit(samples), RENDER_SAMPLE_RATE);

          if (renderToken.current !== token) return;
          await player.load(samples, RENDER_SAMPLE_RATE);
          if (renderToken.current !== token) return;

          setRenderedDurationMs(durationMs);
          setRenderError(null);
        } catch (cause) {
          if (renderToken.current !== token) return;
          setRenderError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (renderToken.current === token) setRendering(false);
        }
      }, 0);
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // `player` is a stable set of callbacks; including it would re-render audio
    // on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, audibleParts, loop, budget]);

  useEffect(() => { player.setVolume(volume); }, [player, volume]);

  /**
   * Starts the accompaniment *where the playhead already is*.
   *
   * Without the offset the buffer always began at its own first sample, so
   * pressing play half way through a phrase put the backing a half-phrase
   * ahead and it stayed there for the rest of the session. The offset is read
   * at this instant rather than tracked, because the two clocks only need
   * introducing once — after that they are the same length and stay together.
   */
  const start = useCallback(() => {
    const now = scoreTimeMs?.() ?? loop.fromMs;
    player.play(loopOffsetSeconds(loop, now));
  }, [player, loop, scoreTimeMs]);

  const halt = useCallback(() => player.stop(), [player]);

  useEffect(() => {
    // `budget.withinBudget` belongs here as well as in the render: refusing to
    // synthesise an over-long loop leaves the *previous* buffer loaded, and
    // playing that would be worse than silence — it is a different passage.
    if (playing && enabled && player.ready && !rendering && budget.withinBudget) start();
    else halt();
  }, [playing, enabled, player.ready, rendering, budget.withinBudget, start, halt]);

  // Derived, not stored: with nothing to sound there is no loop, and that is a
  // fact about the current mode rather than a state transition.
  const wouldSound = enabled && audibleParts.length > 0;
  const loopDurationMs = wouldSound ? renderedDurationMs : 0;

  // An over-long loop is likewise a property of the current window, not an
  // event that happened, so it is derived here instead of being pushed into
  // state from inside the render effect. It outranks a stale render error:
  // it is the reason there is no sound *now*.
  const error = (wouldSound && !budget.withinBudget ? budget.message : null)
    ?? renderError
    ?? player.error;

  return {
    ready: player.ready,
    rendering,
    error,
    audibleParts,
    hasSolo: soloParts.length > 0,
    hasAccompaniment: accompanimentParts.length > 0,
    loopDurationMs,
  };
}
