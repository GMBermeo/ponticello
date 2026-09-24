import { describe, expect, it } from 'vitest';

import { CHORD_SHEETS, LIBRARY_ROWS, mergeChordLibrary, type LibraryRow } from '@scores';

import {
  CUSTOM_PROGRESSION_ID, filterLibraryRows, routeForRow, type LibraryFilter,
} from '../libraryFilters';

const ALL_ROWS = mergeChordLibrary(LIBRARY_ROWS);
const NO_FILTER: LibraryFilter = { category: 'ALL', difficulty: 'ALL', search: '', importedIds: new Set() };

function filtered(overrides: Partial<LibraryFilter>): LibraryRow[] {
  return filterLibraryRows(ALL_ROWS, { ...NO_FILTER, ...overrides });
}

describe('filterLibraryRows', () => {
  it('returns every row when nothing is filtered', () => {
    expect(filtered({})).toHaveLength(ALL_ROWS.length);
  });

  it('keeps only studies on the Studies tab', () => {
    expect(filtered({ category: 'study' }).every((row) => row.category === 'study')).toBe(true);
  });

  it('counts classical pieces as songs', () => {
    const songs = filtered({ category: 'song' });
    expect(songs.every((row) => row.category === 'song' || row.category === 'classical')).toBe(true);
  });

  it('leads the Chords tab with the progression builder', () => {
    expect(filtered({ category: 'chords' })[0]?.id).toBe(CUSTOM_PROGRESSION_ID);
  });

  it('hides the builder when the search does not describe it', () => {
    const ids = filtered({ category: 'chords', search: 'zzz-no-match' }).map((row) => row.id);
    expect(ids).not.toContain(CUSTOM_PROGRESSION_ID);
  });

  it('shows only imported rows on the Imported tab', () => {
    const first = ALL_ROWS[0];
    expect(filtered({ category: 'imported', importedIds: new Set([first.id]) })).toEqual([first]);
  });

  it('matches search case-insensitively, ignoring surrounding spaces', () => {
    const title = ALL_ROWS[0].title;
    expect(filtered({ search: `  ${title.toUpperCase()}  ` }).map((row) => row.id)).toContain(ALL_ROWS[0].id);
  });

  it('drops chart-only rows when a level is chosen', () => {
    const chartOnlyIds = new Set(CHORD_SHEETS.map((sheet) => sheet.id));
    const beginner = filtered({ difficulty: 'Beginner' });
    expect(beginner.every((row) => row.playable || !chartOnlyIds.has(row.id))).toBe(true);
  });
});

describe('routeForRow', () => {
  it('opens the builder route for the builder row', () => {
    expect(routeForRow(undefined, CUSTOM_PROGRESSION_ID, 'ALL')).toBe('/chord-progression');
  });

  it('opens a scored piece as a song', () => {
    const scored = ALL_ROWS.find((row) => row.playable);
    expect(scored && routeForRow(scored, scored.id, 'study')).toBe(`/song/${scored?.id}`);
  });

  it('opens a chart as a chord song on the Chords tab', () => {
    const chart = CHORD_SHEETS[0];
    const row = ALL_ROWS.find((candidate) => candidate.id === chart.id);
    expect(routeForRow(row, chart.id, 'chords')).toBe(`/chord-song/${chart.id}`);
  });
});
