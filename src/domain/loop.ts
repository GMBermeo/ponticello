/**
 * The practice loop.
 *
 * A loop is one fact — *these bars, at this tempo* — and until now it had no
 * module. The transport worked it out from `score.measures` to drive the
 * playhead; the accompaniment worked it out again, differently, to decide how
 * much audio to synthesise. They disagreed in exactly the case that matters:
 * a piece that arrived with its own backing got the *whole file* rendered
 * while the playhead cycled four bars, so the two ran independently from the
 * first beat and the accompaniment was never the thing under your bow.
 *
 * So the loop lives here, once, and both sides read it. The window, the tempo,
 * the real-time duration and the clipping rule are the same numbers for
 * everybody by construction rather than by agreement.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { BackingPart } from './backing';
import { CelloSongScore } from './schema';

export interface PracticeLoop {
  /** 1-based, inclusive, clamped to the score. */
  fromBar: number;
  toBar: number;
  /** The window in *score* time — the clock the notes are written against. */
  fromMs: number;
  toMs: number;
  /** `toMs - fromMs`. Zero for a score with no measures. */
  scoreDurationMs: number;
  /** Fraction of the written tempo. 0.8 means "at 80 %", so slower. */
  tempoScale: number;
  /**
   * How long one time round the loop actually takes, in real milliseconds.
   * This is the length the rendered audio must be, and the length the playhead
   * takes to travel the window — they are the same number and always were;
   * the bug was that only one side computed it.
   */
  realDurationMs: number;
}

export interface LoopRequest {
  /** 1-based, inclusive. Out-of-range values are clamped, not rejected. */
  loopFromBar: number;
  loopToBar: number;
  /** Percentage of the written tempo, e.g. 80. */
  tempoPercent: number;
}

/**
 * Slowest playable tempo, as a fraction.
 *
 * A floor rather than a validation error: a stepper that has been held down
 * should bottom out, not put the renderer in a position where it is asked for
 * an hour of audio because someone reached 0 %.
 */
const MIN_TEMPO_SCALE = 0.1;

/** A loop over nothing, at a given tempo. */
function emptyLoop(tempoScale: number): PracticeLoop {
  return {
    fromBar: 1, toBar: 1, fromMs: 0, toMs: 0,
    scoreDurationMs: 0, tempoScale, realDurationMs: 0,
  };
}

/** Clamp to a valid 1-based bar number for this score. */
function clampBar(score: CelloSongScore, bar: number): number {
  const count = score.measures.length;
  if (count === 0) return 1;
  return Math.max(1, Math.min(count, Math.round(bar) || 1));
}

/**
 * Resolves a request against a score.
 *
 * A reversed range is put back the right way round rather than producing a
 * negative window: dragging the "loop from" stepper past "loop to" is a normal
 * thing to do with two steppers and should not silently produce no audio.
 */
export function practiceLoop(
  score: CelloSongScore | null, request: LoopRequest,
): PracticeLoop {
  const tempoScale = Math.max(MIN_TEMPO_SCALE, request.tempoPercent / 100);

  if (!score || score.measures.length === 0) return emptyLoop(tempoScale);

  const a = clampBar(score, request.loopFromBar);
  const b = clampBar(score, request.loopToBar);
  const fromBar = Math.min(a, b);
  const toBar = Math.max(a, b);

  const first = score.measures[fromBar - 1];
  const last = score.measures[toBar - 1];
  // `clampBar` has already bounded both indices, so this cannot fire. It is
  // here because the compiler cannot see that, and an empty loop is the honest
  // answer if the invariant is ever broken.
  if (!first || !last) return emptyLoop(tempoScale);

  const fromMs = first.startBarTimeMs;
  const toMs = last.startBarTimeMs + last.durationMs;
  const scoreDurationMs = Math.max(0, toMs - fromMs);

  return {
    fromBar,
    toBar,
    fromMs,
    toMs,
    scoreDurationMs,
    tempoScale,
    realDurationMs: scoreDurationMs / tempoScale,
  };
}

/**
 * Where a score time sits inside the loop, as real seconds from its start.
 *
 * This is the number that phase-locks the accompaniment to the playhead: press
 * play three bars in and the audio has to begin three bars in too, or the two
 * are wrong by exactly the amount you skipped.
 *
 * Times outside the window wrap, because the playhead is a cycle — a note that
 * has fallen off the end of the loop is the note at the start of the next one.
 */
export function loopOffsetSeconds(loop: PracticeLoop, scoreTimeMs: number): number {
  if (loop.scoreDurationMs <= 0) return 0;
  const into = (scoreTimeMs - loop.fromMs) % loop.scoreDurationMs;
  const wrapped = into < 0 ? into + loop.scoreDurationMs : into;
  return wrapped / loop.tempoScale / 1000;
}

/**
 * Keeps only what sounds inside the loop, rebased so the window starts at zero.
 *
 * Every part goes through this — generated *and* imported. The old code clipped
 * only the parts it had generated itself and passed an imported file straight
 * through, which is why importing a MIDI file produced a backing track that had
 * nothing to do with the bars on screen.
 *
 * A note that starts before the window and is still sounding inside it keeps
 * sounding: a held bass note under bar 9 is part of bar 9 even though it was
 * struck in bar 8.
 */
export function clipToLoop(
  parts: readonly BackingPart[], loop: PracticeLoop,
): BackingPart[] {
  const { fromMs, toMs } = loop;
  if (loop.scoreDurationMs <= 0) return [];

  return parts.map((part) => ({
    ...part,
    notes: part.notes
      .filter((n) => n.startTimeMs < toMs && n.startTimeMs + n.durationMs > fromMs)
      .map((n) => {
        const start = Math.max(n.startTimeMs, fromMs);
        return {
          ...n,
          startTimeMs: start - fromMs,
          // Truncate at the loop point rather than letting a long note bleed
          // over the repeat and collide with the start of the next pass.
          durationMs: Math.min(n.startTimeMs + n.durationMs, toMs) - start,
        };
      })
      // Sub-10 ms remnants are clicks, not notes.
      .filter((n) => n.durationMs > 10),
  }));
}

/**
 * The longest loop that can be accompanied, in real seconds.
 *
 * This used to be ninety seconds, and it was the single worst bug in the app.
 * The accompaniment was synthesised into one `Float32Array` before a note could
 * sound, so the ceiling was a memory and blocked-thread budget — and 219 of the
 * 258 bundled songs are longer than ninety seconds, which meant the majority of
 * the library played no backing at all and said nothing about why.
 *
 * Nothing is rendered up front any more. Web schedules Web Audio voices inside
 * a 1.6-second lookahead, so its only limit is the length of the note list.
 * Native still writes a file, but in two-second slices straight into the WAV's
 * bytes — about 44 KB of working set per slice and 2 MB of file per minute of
 * audio.
 *
 * So the ceiling is now about *waiting*, not memory: twenty minutes of audio is
 * a 53 MB file and a render the player would sit through. Fifteen minutes is
 * comfortably longer than the longest song in the library (nine minutes) even
 * slowed to 60 %, and short enough that the wait stays a progress bar rather
 * than a hang.
 */
export const MAX_RENDER_SECONDS = 900;

export interface LoopBudget {
  withinBudget: boolean;
  seconds: number;
  /** Non-null when over budget: what to tell the player. */
  message: string | null;
}

export function loopBudget(loop: PracticeLoop): LoopBudget {
  const seconds = loop.realDurationMs / 1000;
  if (seconds <= MAX_RENDER_SECONDS) {
    return { withinBudget: true, seconds, message: null };
  }
  return {
    withinBudget: false,
    seconds,
    message: `Loop is ${Math.round(seconds)}s — too long to accompany. `
      + `Shorten it to ${MAX_RENDER_SECONDS}s or less.`,
  };
}
