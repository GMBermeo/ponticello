import type { Href } from 'expo-router';

import type { DifficultyTier } from '@domain';
import { getChordSheet, type LibraryRow } from '@scores';

import type { Segment } from '../ui';

export type CategoryFilter = 'ALL' | 'study' | 'song' | 'chords' | 'imported';
export type DifficultyFilter = 'ALL' | DifficultyTier;

export const CATEGORY_SEGMENTS: readonly Segment<CategoryFilter>[] = [
  { value: 'ALL', label: 'All pieces' },
  { value: 'study', label: 'Studies' },
  { value: 'song', label: 'Songs' },
  { value: 'chords', label: 'Chords' },
  { value: 'imported', label: 'Imported' },
];

export const LEVEL_SEGMENTS: readonly Segment<DifficultyFilter>[] = [
  { value: 'ALL', label: 'Any level' },
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
  { value: 'Expert', label: 'Expert' },
];

export const CUSTOM_PROGRESSION_ID = 'custom-chord-progression';

const CUSTOM_PROGRESSION_SEARCH_TEXT = 'create chord progression interactive builder';

/** The chord-progression builder, listed as a row at the head of the Chords tab. */
export const CUSTOM_PROGRESSION_ROW: LibraryRow = {
  id: CUSTOM_PROGRESSION_ID,
  title: 'Create chord progression',
  composer: 'Interactive progression builder',
  origin: 'CUSTOM PROGRESSION',
  keySignature: 'Any key',
  range: 'All positions',
  tempo: 'Adjustable',
  difficulty: 'Beginner',
  category: 'study',
  bars: null,
  playable: false,
  distribution: [],
  note: 'Build your own chord progression in any key, organize chord shapes into rows with drag-and-drop, and practice transitions with next chord preview.',
};

export type LibraryFilter = {
  category: CategoryFilter;
  difficulty: DifficultyFilter;
  search: string;
  importedIds: ReadonlySet<string>;
};

function matchesCategory(row: LibraryRow, filter: LibraryFilter): boolean {
  switch (filter.category) {
    case 'ALL': return true;
    case 'chords': return !!getChordSheet(row.id);
    case 'imported': return filter.importedIds.has(row.id);
    case 'song': return row.category === 'song' || row.category === 'classical';
    case 'study': return row.category === 'study';
  }
}

/** A chart-only row has no score, so it has no difficulty to filter on. */
function matchesDifficulty(row: LibraryRow, difficulty: DifficultyFilter): boolean {
  if (difficulty === 'ALL') return true;
  const chartOnly = !!getChordSheet(row.id) && !row.playable;
  return !chartOnly && row.difficulty === difficulty;
}

function matchesQuery(row: LibraryRow, query: string): boolean {
  if (!query) return true;
  return [row.title, row.composer, row.origin, row.keySignature]
    .some((text) => text.toLowerCase().includes(query));
}

export function normalizeQuery(search: string): string {
  return search.trim().toLowerCase();
}

/** Rows shown for a filter, with the progression builder leading the Chords tab. */
export function filterLibraryRows(rows: readonly LibraryRow[], filter: LibraryFilter): LibraryRow[] {
  const query = normalizeQuery(filter.search);
  const filtered = rows.filter((row) =>
    matchesCategory(row, filter)
    && matchesDifficulty(row, filter.difficulty)
    && matchesQuery(row, query));
  const showBuilder = filter.category === 'chords' && (!query || CUSTOM_PROGRESSION_SEARCH_TEXT.includes(query));
  return showBuilder ? [CUSTOM_PROGRESSION_ROW, ...filtered] : filtered;
}

/** Route for a library row: chord charts open as charts unless a score exists and Chords is not the tab. */
export function routeForRow(row: LibraryRow | undefined, id: string, category: CategoryFilter): Href {
  if (id === CUSTOM_PROGRESSION_ID) return '/chord-progression';
  const chart = getChordSheet(id);
  const opensAsChart = !!chart && (category === 'chords' || !row?.playable);
  return opensAsChart ? `/chord-song/${id}` : `/song/${id}`;
}
