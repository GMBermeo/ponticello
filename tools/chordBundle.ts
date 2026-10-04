import { existsSync, readFileSync } from 'node:fs';
import { interpretSheetChord, summarizeChordSheet, type ChordSheet } from '@domain';
import { writeLazyBundle, type LazyBundle, type LazyBundleReport } from './lazyBundle';

/** Chord charts reach the app as one JSON file each; see tools/lazyBundle.ts. */
export const CHORD_BUNDLE: LazyBundle = {
  dir: 'src/scores/chords',
  catalogFile: 'src/scores/chordCatalog.generated.ts',
  exportName: 'CHORD_CATALOG',
  summaryImport: "import type { ChordSheetSummary } from '@domain';",
  summaryType: 'ChordSheetSummary',
  writtenBy: 'tools/build-library.ts',
};
const BASE_CHARTS_FILE = 'src/scores/chordSheets.base.json';
const PERSONAL_CHARTS_FILE = '_CHORDS/chordSheets.json';

function readCharts(path: string): ChordSheet[] {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as ChordSheet[] : [];
}

/** Charts get their cello reading from the current chord dictionary, not the one they were imported with. */
export function reinterpret(sheet: ChordSheet): ChordSheet {
  return { ...sheet, chords: sheet.chords.map((chord) => interpretSheetChord(chord.symbol, chord.keyboardPitchClasses)) };
}

/** The bundled charts: the ones the repo ships, then any imported into `_CHORDS/`, by id. */
export function loadChordSources(): ChordSheet[] {
  const byId = new Map<string, ChordSheet>();
  for (const sheet of [...readCharts(BASE_CHARTS_FILE), ...readCharts(PERSONAL_CHARTS_FILE)]) byId.set(sheet.id, sheet);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).map(reinterpret);
}

export function writeChordBundle(sheets: readonly ChordSheet[]): LazyBundleReport {
  return writeLazyBundle(CHORD_BUNDLE, sheets.map((sheet) => ({ id: sheet.id, summary: summarizeChordSheet(sheet), data: sheet })));
}
