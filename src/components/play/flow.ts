/**
 * Where the notes go, and which of them are worth drawing.
 *
 * Both scrolling visions had the same two problems, so both fixes live here.
 *
 * **Windowing.** They laid out `score.notes` in full — every note in the piece,
 * as a mounted view, from the first frame. That is fine for the four-bar
 * fixtures the components were written against and ruinous for the library that
 * actually ships: `les-miserables-theme` is 519 seconds long and the tab stave
 * was mounting a badge, a bow mark, a bar line and a position bracket for all of
 * it — several thousand views, reconciled again on every parent render. Only
 * about two seconds of that is ever on screen. `visibleSlice` finds the part
 * that is, by binary search, and the field draws a dozen notes instead of a
 * thousand.
 *
 * **Axis.** A highway that falls and a stave that runs left to right are the
 * same drawing with the time and lane axes swapped. Keeping the mapping in one
 * place is what lets each vision offer both orientations without either one
 * quietly disagreeing with the fingerboard panel about which way "higher" goes.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { CelloString, DISPLAY_STRING_ORDER } from '@/domain/cello';
import type { FlowAxis } from '@/state/settings';

export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

/**
 * The notes that overlap a time window, as an index range.
 *
 * Returned as indices rather than as a new array so a caller can keep using a
 * note's position in the score — which is what decides whether it has been
 * played — without a second lookup.
 *
 * `notes` must be sorted by `startTimeMs`, which every score is. A note that
 * began before the window and is still sounding inside it counts: a held bass
 * note under the playhead is on screen even though it was struck off it. That
 * is handled by walking back from the first candidate rather than by scanning
 * the whole list, and the walk is bounded by `maxHeldNotes`.
 */
export function visibleSlice(
  notes: readonly { startTimeMs: number; durationMs: number }[],
  window: TimeWindow,
  maxHeldNotes = 64,
): { from: number; to: number } {
  if (notes.length === 0) return { from: 0, to: 0 };

  // First note starting at or after the window opens.
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startTimeMs < window.fromMs) lo = mid + 1;
    else hi = mid;
  }
  let from = lo;

  // Walk back over notes that started earlier but are still sounding. Bounded,
  // because a single very long note must not turn this into a full scan.
  for (let i = 0; i < maxHeldNotes && from > 0; i++) {
    const candidate = notes[from - 1];
    if (candidate.startTimeMs + candidate.durationMs <= window.fromMs) break;
    from--;
  }

  // First note starting after the window closes.
  lo = from;
  hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startTimeMs <= window.toMs) lo = mid + 1;
    else hi = mid;
  }

  return { from, to: lo };
}

/**
 * The window a vision needs, given where the playhead is and how much time the
 * box shows.
 *
 * Deliberately generous on both sides. The field itself slides on the UI thread
 * every frame while this is recomputed from React a dozen times a second, so the
 * window has to stay ahead of the scroll by more than one recompute's worth of
 * travel — otherwise notes appear at the edge of the screen instead of beyond
 * it, which reads as popping.
 */
export function flowWindow(
  playheadMs: number, visibleMs: number, aheadFraction: number,
): TimeWindow {
  const ahead = visibleMs * aheadFraction;
  const behind = visibleMs * (1 - aheadFraction);
  return {
    fromMs: playheadMs - behind - visibleMs * 0.5,
    toMs: playheadMs + ahead + visibleMs * 0.5,
  };
}

export interface LaneGeometry {
  /** Cross-axis offset of a string's lane, in dp from the box's top or left. */
  laneAt: (string: CelloString) => number;
  /** Cross-axis extent of one lane, in dp. */
  laneSize: number;
  /** Distance between lane centres, in dp. */
  laneStep: number;
  /** True when time runs along x and lanes stack vertically. */
  horizontal: boolean;
}

/**
 * Lane layout for an axis.
 *
 * The invariant, whichever way round: **the low string is at the bottom or the
 * left, and the pitch axis always points up or right.** Vertically the lanes are
 * columns and C is leftmost; horizontally they are rows and C is the *bottom*
 * row, which means the row order is reversed relative to `STRING_ORDER`. Getting
 * that backwards puts the C string above the A string, which is the one mistake
 * a cellist notices instantly.
 */
export function laneGeometry(
  axis: FlowAxis, crossExtent: number, gap: number,
): LaneGeometry {
  const count = DISPLAY_STRING_ORDER.length;
  const laneStep = crossExtent / count;
  const laneSize = Math.max(1, laneStep - gap);
  const horizontal = axis === 'horizontal';

  return {
    laneStep,
    laneSize,
    horizontal,
    laneAt: (string: CelloString) => {
      const slot = Math.max(0, DISPLAY_STRING_ORDER.indexOf(string));
      return slot * laneStep;
    },
  };
}

/**
 * Time-axis offset of an event at time `ms`, at time zero.
 *
 * For vertical (falling), time moves from top towards the hit line, so future
 * notes sit above the hit line (hitAt - ms * pxPerMs).
 * For horizontal (leftward stave), future notes arrive from the right of the hit
 * line (hitAt + ms * pxPerMs).
 */
export function timeAlongOffset(
  ms: number,
  axis: FlowAxis,
  hitAt: number,
  pxPerMs: number,
): number {
  return axis === 'vertical'
    ? hitAt - ms * pxPerMs
    : hitAt + ms * pxPerMs;
}

