import type { ChordFamily, ChordScaleId } from '@domain';

import type { Segment } from '../ui';

export type KeyScaleOption = { id: ChordScaleId; label: string };

export const KEY_SCALES: readonly KeyScaleOption[] = [
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
  { id: 'harmonic', label: 'Harmonic min' },
  { id: 'dorian', label: 'Dorian' },
  { id: 'mixolydian', label: 'Mixolydian' },
];

export const PROGRESSION_FAMILIES: readonly Segment<ChordFamily>[] = [
  { value: 'all', label: 'All chords' },
  { value: 'triads', label: 'Triads' },
  { value: 'sevenths', label: 'Sevenths' },
];

type BeatsValue = '1' | '2' | '4' | '8';

export const BEATS_SEGMENTS: readonly Segment<BeatsValue>[] = [
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
  { value: '4', label: '4 beats' },
  { value: '8', label: '8 beats' },
];

export const MIN_PROGRESSION_SPEED = 0.5;
export const MAX_PROGRESSION_SPEED = 1.5;
const PROGRESSION_SPEED_STEP = 0.1;

/** One click of playback speed, kept to tenths and inside the range. */
export function stepProgressionSpeed(speed: number, direction: 1 | -1): number {
  const next = Math.round((speed + direction * PROGRESSION_SPEED_STEP) * 10) / 10;
  return Math.min(MAX_PROGRESSION_SPEED, Math.max(MIN_PROGRESSION_SPEED, next));
}

/** Where a chord sits in the progression grid. */
export type GridCell = { row: number; col: number };

export function sameCell(a: GridCell | null, row: number, col: number): boolean {
  return a?.row === row && a?.col === col;
}
