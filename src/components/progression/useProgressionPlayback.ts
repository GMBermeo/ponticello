import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ScrollView } from 'react-native';

import { msPerChord } from '@domain';

export type ProgressionPlaybackOptions = {
  chordCount: number;
  bpm: number;
  beatsPerChord: number;
  speed: number;
  scroll: RefObject<ScrollView | null>;
  /** Room left above the sounding chord when it is scrolled into view. */
  scrollMargin: number;
};

export type ProgressionPlayback = {
  playing: boolean;
  togglePlaying: () => void;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  restart: () => void;
  /** Records where a chord card was laid out, so playback can scroll to it. */
  recordChordPosition: (index: number, y: number) => void;
};

/** Steps through the progression chord by chord, looping, and keeps the sounding chord in view. */
export function useProgressionPlayback(options: ProgressionPlaybackOptions): ProgressionPlayback {
  const { chordCount, bpm, beatsPerChord, speed, scroll, scrollMargin } = options;
  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const positions = useRef(new Map<number, number>());

  useEffect(() => {
    if (!playing || chordCount === 0) return;
    const timer = setInterval(() => {
      setActiveIndex((previous) => {
        const next = (previous + 1) % chordCount;
        const y = positions.current.get(next);
        if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - scrollMargin), animated: true });
        return next;
      });
    }, msPerChord(bpm, speed, beatsPerChord));
    return () => clearInterval(timer);
  }, [playing, chordCount, bpm, beatsPerChord, speed, scroll, scrollMargin]);

  const restart = () => {
    setPlaying(false);
    setActiveIndex(0);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  return {
    playing,
    togglePlaying: () => setPlaying((current) => !current),
    activeIndex,
    setActiveIndex,
    restart,
    recordChordPosition: (index, y) => positions.current.set(index, y),
  };
}
