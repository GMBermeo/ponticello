import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  AccompanimentStyle, BackingPart, BackingTrack, generateAccompaniment, soloPartFromScore,
  trackDurationMs,
} from '@/domain/backing';
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
 * cannot fall out of step with the playhead because there is nothing to keep
 * in step, only one buffer that ends where it began.
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
  loopFromBar: number;
  loopToBar: number;
  tempoPercent: number;
  playing: boolean;
  /** 0–1. */
  volume: number;
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

/** Keeps notes overlapping a window and rebases them so the window starts at zero. */
function sliceParts(parts: readonly BackingPart[], fromMs: number, toMs: number): BackingPart[] {
  return parts.map((part) => ({
    ...part,
    notes: part.notes
      .filter((n) => n.startTimeMs < toMs && n.startTimeMs + n.durationMs > fromMs)
      .map((n) => {
        const start = Math.max(n.startTimeMs, fromMs);
        return {
          ...n,
          startTimeMs: start - fromMs,
          // Truncate a note that runs past the loop rather than letting it
          // bleed over the loop point on repeat.
          durationMs: Math.min(n.startTimeMs + n.durationMs, toMs) - start,
        };
      })
      .filter((n) => n.durationMs > 10),
  }));
}

export function useBacking(options: UseBackingOptions): BackingState {
  const {
    score, backing, listenMode, accompaniment, loopFromBar, loopToBar,
    tempoPercent, playing, volume,
  } = options;

  const enabled = listenMode !== 'off';
  const player = useBackingPlayer(enabled);

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedDurationMs, setRenderedDurationMs] = useState(0);

  /** Loop window in score time. */
  const window = useMemo(() => {
    if (!score || score.measures.length === 0) return { fromMs: 0, toMs: 0 };
    const first = score.measures[Math.max(0, Math.min(score.measures.length - 1, loopFromBar - 1))];
    const last = score.measures[Math.max(0, Math.min(score.measures.length - 1, loopToBar - 1))];
    return { fromMs: first.startBarTimeMs, toMs: last.startBarTimeMs + last.durationMs };
  }, [score, loopFromBar, loopToBar]);

  const soloParts = useMemo<BackingPart[]>(() => {
    const imported = (backing?.parts ?? []).filter((p) => p.role === 'solo');
    if (imported.length > 0) return imported;
    if (!score) return [];
    return sliceParts([soloPartFromScore(score)], window.fromMs, window.toMs);
  }, [backing, score, window.fromMs, window.toMs]);

  const accompanimentParts = useMemo<BackingPart[]>(() => {
    const imported = (backing?.parts ?? []).filter((p) => p.role === 'accompaniment');
    if (imported.length > 0) return imported;
    if (!score) return [];
    return generateAccompaniment(score, {
      style: accompaniment,
      fromBar: loopFromBar,
      toBar: loopToBar,
    });
  }, [backing, score, accompaniment, loopFromBar, loopToBar]);

  const audibleParts = useMemo(() => {
    switch (listenMode) {
      case 'solo': return soloParts;
      case 'backing': return accompanimentParts;
      case 'both': return [...accompanimentParts, ...soloParts];
      default: return [];
    }
  }, [listenMode, soloParts, accompanimentParts]);

  // Re-render whenever what should be heard changes. Debounced, because the
  // tempo and loop steppers fire on every tap.
  const renderToken = useRef(0);
  useEffect(() => {
    if (!enabled || audibleParts.length === 0) return;

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
          const tempoScale = Math.max(0.1, tempoPercent / 100);
          const scoreDuration = backing
            ? trackDurationMs(audibleParts)
            : (window.toMs - window.fromMs) || trackDurationMs(audibleParts);
          const durationMs = scoreDuration / tempoScale;

          const samples = renderParts(audibleParts, {
            sampleRate: RENDER_SAMPLE_RATE,
            durationMs,
            tempoScale,
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
  }, [enabled, audibleParts, tempoPercent, window.fromMs, window.toMs, backing]);

  useEffect(() => { player.setVolume(volume); }, [player, volume]);

  const start = useCallback(() => player.play(), [player]);
  const halt = useCallback(() => player.stop(), [player]);

  useEffect(() => {
    if (playing && enabled && player.ready && !rendering) start();
    else halt();
  }, [playing, enabled, player.ready, rendering, start, halt]);

  // Derived, not stored: with nothing to sound there is no loop, and that is a
  // fact about the current mode rather than a state transition.
  const loopDurationMs = enabled && audibleParts.length > 0 ? renderedDurationMs : 0;

  return {
    ready: player.ready,
    rendering,
    error: renderError ?? player.error,
    audibleParts,
    hasSolo: soloParts.length > 0,
    hasAccompaniment: accompanimentParts.length > 0,
    loopDurationMs,
  };
}
