import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FlatList } from 'react-native';

import {
  beatAtTime, eventAtBeat, sheetScrollY, type ChordSheetLayout, type SheetTimeline,
} from '@domain';

import type { ChordChartItem } from './ChordChartCell';
import { readingScrollOffset } from './chordReader';

export type ChordAutoScrollOptions = {
  timeline: SheetTimeline;
  layout: ChordSheetLayout;
  lineCount: number;
  bpm: number;
  speed: number;
  playing: boolean;
  /** Stops the scroll: at the end of the chart, and on every seek. */
  onStop: () => void;
  list: RefObject<FlatList<ChordChartItem> | null>;
  viewportHeight: number;
  /** Height of the preview pinned over the top of the list, on compact screens. */
  pinnedHeight: number;
  /** Extra room above a line when jumping to it. */
  seekMargin: number;
};

export type ChordAutoScroll = {
  activeIndex: number;
  seek: (index: number) => void;
  reset: () => void;
  onContentHeight: (height: number) => void;
};

/**
 * Scrolls the chart in time with the chords.
 *
 * The beat is anchored to absolute time and recomputed each frame rather than
 * accumulated from frame deltas, so a dropped frame costs nothing and a pause
 * or tempo change snapshots the exact position.
 */
export function useChordAutoScroll(options: ChordAutoScrollOptions): ChordAutoScroll {
  const {
    timeline, layout, lineCount, bpm, speed, playing, onStop, list, viewportHeight, pinnedHeight, seekMargin,
  } = options;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef(0);
  const beat = useRef(0);
  const anchor = useRef({ beat: 0, ms: 0 });
  const contentHeight = useRef(0);

  const scrollTo = useCallback((offset: number) => {
    list.current?.scrollToOffset({ offset, animated: false });
  }, [list]);

  useEffect(() => {
    if (!playing) return;
    if (beat.current >= timeline.totalBeats) beat.current = 0;
    anchor.current = { beat: beat.current, ms: performance.now() };
    const beatNow = (now: number) =>
      Math.min(timeline.totalBeats, beatAtTime(anchor.current.beat, anchor.current.ms, now, bpm, speed));
    let frame = 0;
    const tick = (now: number) => {
      beat.current = beatNow(now);
      const index = Math.max(0, eventAtBeat(timeline.events, beat.current));
      if (index !== activeRef.current) {
        activeRef.current = index;
        setActiveIndex(index);
      }
      const desired = sheetScrollY(
        beat.current, timeline.starts, layout.offsets(), layout.offset(lineCount), timeline.totalBeats,
      );
      scrollTo(readingScrollOffset({ desired, viewportHeight, pinnedHeight, contentHeight: contentHeight.current }));
      if (beat.current >= timeline.totalBeats) onStop();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Snapshot absolute time on pause/rate change; never accumulate frame deltas.
      beat.current = beatNow(performance.now());
    };
  }, [playing, bpm, speed, timeline, viewportHeight, pinnedHeight, layout, lineCount, onStop, scrollTo]);

  const seek = useCallback((index: number) => {
    const event = timeline.events[index];
    if (!event) return;
    onStop();
    // Cleanup of a running clock must not overwrite the new position.
    anchor.current = { beat: event.beat, ms: performance.now() };
    beat.current = event.beat;
    activeRef.current = index;
    setActiveIndex(index);
    scrollTo(Math.max(0, layout.offset(event.lineIndex) - pinnedHeight - seekMargin));
  }, [timeline, pinnedHeight, seekMargin, layout, onStop, scrollTo]);

  const reset = useCallback(() => {
    seek(0);
    beat.current = 0;
    anchor.current = { beat: 0, ms: performance.now() };
    scrollTo(0);
  }, [seek, scrollTo]);

  const onContentHeight = useCallback((height: number) => {
    contentHeight.current = height;
  }, []);

  return { activeIndex, seek, reset, onContentHeight };
}
