import { validateChordSheet, type ChordSheet, type ChordSheetSummary } from '@domain';
import type { LibraryRow } from './library';
import { CHORD_CATALOG } from './chordCatalog.generated';

/**
 * Chord charts are listed from summaries and opened one at a time. Each chart
 * is its own JSON module (see tools/chordBundle.ts), so nothing but the list
 * is read until a chart is asked for, and the list is a few hundred kilobytes
 * where the charts together are tens of megabytes.
 */
export const CHORD_SHEET_SUMMARIES: readonly ChordSheetSummary[] = CHORD_CATALOG.map(([summary]) => summary);
const loaders = new Map(CHORD_CATALOG.map(([summary, load]) => [summary.id, load]));

const summaries = new Map(CHORD_SHEET_SUMMARIES.map((summary) => [summary.id, summary]));
/** Charts already checked. The bundler's own module cache keeps a chart once it is read, so this only avoids checking twice. */
const checked = new Set<string>();

export function hasChordSheet(id: string | undefined): boolean { return !!id && loaders.has(id); }
export function getChordSummary(id: string | undefined): ChordSheetSummary | undefined { return id ? summaries.get(id) : undefined; }

/** The chart itself, read and checked on first use. Prefer `hasChordSheet` to ask only whether one exists. */
export function getChordSheet(id: string | undefined): ChordSheet | undefined {
  const load = id ? loaders.get(id) : undefined;
  if (!id || !load) return undefined;
  const sheet = load();
  if (!checked.has(id)) {
    validateChordSheet(sheet);
    checked.add(id);
  }
  return sheet as ChordSheet;
}

/** Same ID + one library row for a score/chart pair. Existing score metadata wins. */
export function mergeChordLibrary(rows: readonly LibraryRow[], sheets: readonly ChordSheetSummary[] = CHORD_SHEET_SUMMARIES): LibraryRow[] {
  const result = new Map(rows.map((row) => [row.id, row]));
  for (const sheet of sheets) {
    if (result.has(sheet.id)) continue;
    result.set(sheet.id, {
      id: sheet.id, title: sheet.title, composer: sheet.artist, origin: 'HARMONY MAP',
      keySignature: sheet.key ?? 'Key unavailable', range: 'Chord shapes', tempo: sheet.bpm ? `♩ ${sheet.bpm}` : 'Manual tempo',
      difficulty: 'Intermediate', category: 'song', bars: null, playable: false, distribution: [],
      note: 'Harmony map with cello shapes and adjustable auto-scroll.',
    });
  }
  return [...result.values()];
}
