import type { CelloChordStudy, SheetEvent } from '@domain';

export type ChartView = 'names' | 'shapes';

export type ChordStudies = ReadonlyMap<string, CelloChordStudy | null>;

/** A chord change coming up in the chart, with the shape that plays it. */
export type UpcomingChord = { symbol: string | undefined; study: CelloChordStudy | null | undefined };

/** The preview's slots: what is sounding, then what follows. */
export const PREVIEW_SLOTS = [
  { label: 'Current', offset: 0 },
  { label: 'Next', offset: 1 },
  { label: '+2', offset: 2 },
  { label: '+3', offset: 3 },
] as const;

/** Compact screens only have room for the first two preview slots. */
export const COMPACT_PREVIEW_SLOTS = 2;

/** The chord at `activeIndex` and the `count − 1` after it; past the end, slots are empty. */
export function upcomingChords(
  events: readonly SheetEvent[],
  studies: ChordStudies,
  activeIndex: number,
  count: number,
): UpcomingChord[] {
  return Array.from({ length: count }, (_, offset) => {
    const symbol = events[activeIndex + offset]?.symbol;
    return { symbol, study: studies.get(symbol ?? '') };
  });
}

export const MIN_BPM = 20;
export const MAX_BPM = 300;
export const DEFAULT_BPM = 80;

/** A typed BPM, or null when it is not a number in the usable range. */
export function parseBpm(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value >= MIN_BPM && value <= MAX_BPM ? value : null;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 3;
const SPEED_STEP = 0.1;

/** One stepper click of scroll speed, kept to whole percent and inside the range. */
export function stepSpeed(speed: number, direction: 1 | -1): number {
  const next = Math.round((speed + direction * SPEED_STEP) * 100) / 100;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, next));
}

/** Where the list should sit so the reading line is a quarter of the way down the unpinned area. */
export function readingScrollOffset(params: {
  desired: number;
  viewportHeight: number;
  pinnedHeight: number;
  contentHeight: number;
}): number {
  const { desired, viewportHeight, pinnedHeight, contentHeight } = params;
  const readingHeight = Math.max(0, viewportHeight - pinnedHeight);
  const maxOffset = Math.max(0, contentHeight - viewportHeight);
  return Math.max(0, Math.min(maxOffset, desired - pinnedHeight - readingHeight * 0.25));
}
