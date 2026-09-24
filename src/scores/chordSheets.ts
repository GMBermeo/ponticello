import data from './chordSheets.generated.json';
import { validateChordSheet, type ChordSheet } from '@domain';
import type { LibraryRow } from './library';

data.forEach(validateChordSheet);
export const CHORD_SHEETS: readonly ChordSheet[] = data as ChordSheet[];
const byId = new Map(CHORD_SHEETS.map((sheet) => [sheet.id, sheet]));
export function getChordSheet(id: string | undefined): ChordSheet | undefined { return id ? byId.get(id) : undefined; }

/** Same ID + one library row for a score/chart pair. Existing score metadata wins. */
export function mergeChordLibrary(rows: readonly LibraryRow[], sheets: readonly ChordSheet[] = CHORD_SHEETS): LibraryRow[] {
  const result = new Map(rows.map((row) => [row.id, row]));
  for (const sheet of sheets) {
    if (result.has(sheet.id)) continue;
    result.set(sheet.id, {
      id: sheet.id, title: sheet.title, composer: sheet.artist, origin: 'CHORD SHEET',
      keySignature: sheet.key ?? 'Key unavailable', range: 'Chord shapes', tempo: sheet.bpm ? `♩ ${sheet.bpm}` : 'Manual tempo',
      difficulty: 'Intermediate', category: 'song', bars: null, playable: false, distribution: [],
      note: 'Chord chart with cello shapes and adjustable auto-scroll.',
    });
  }
  return [...result.values()];
}
