import { getCelloChord } from './celloChords';
import type { CelloChordStudy } from './chords';
import { chordsInScale, type ChordScaleId } from './chordScales';

export interface ProgressionChordItem {
  id: string;
  symbol: string;
  degree?: string | null;
  beats: number;
}

export interface ProgressionRowItem {
  id: string;
  label: string;
  chords: ProgressionChordItem[];
}

export interface CustomProgressionData {
  version: 1;
  title: string;
  keyRoot: string;
  keyScale: ChordScaleId;
  bpm: number;
  beatsPerChord: number;
  rows: ProgressionRowItem[];
}

let idSequence = 0;

/**
 * An identifier unique on this device: the clock keeps it distinct across
 * launches, the sequence within one. These are list keys and storage ids,
 * never secrets, so no randomness is needed.
 */
function uniqueId(prefix: string): string {
  idSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`;
}

export interface SavedProgressionEntry {
  id: string;
  title: string;
  savedAt: string;
  keyRoot: string;
  keyScale: ChordScaleId;
  data: CustomProgressionData;
}

export function createSavedEntry(data: CustomProgressionData): SavedProgressionEntry {
  return {
    id: uniqueId('saved'),
    title: data.title.trim() || 'Untitled Progression',
    savedAt: new Date().toISOString(),
    keyRoot: data.keyRoot,
    keyScale: data.keyScale,
    data: { ...data, title: data.title.trim() || 'Untitled Progression' },
  };
}

export interface ProgressionFlattenedChord {
  rowIndex: number;
  chordIndex: number;
  globalIndex: number;
  item: ProgressionChordItem;
  study: CelloChordStudy | null;
  nextChord: CelloChordStudy | null;
}

export const PROGRESSION_PRESETS: {
  id: string;
  name: string;
  keyRoot: string;
  keyScale: ChordScaleId;
  rows: { label: string; chords: string[] }[];
}[] = [
  {
    id: 'pop-axis',
    name: 'Pop Axis (I – V – vi – IV)',
    keyRoot: 'C',
    keyScale: 'major',
    rows: [
      { label: 'Phrase A', chords: ['C', 'G'] },
      { label: 'Phrase B', chords: ['Am', 'F'] },
    ],
  },
  {
    id: 'jazz-ii-v-i',
    name: 'Jazz Turnaround (ii – V – I – vi)',
    keyRoot: 'C',
    keyScale: 'major',
    rows: [
      { label: 'Turnaround', chords: ['Dm7', 'G7', 'Cmaj7', 'Am7'] },
    ],
  },
  {
    id: 'blues-12-bar',
    name: '12-Bar Blues',
    keyRoot: 'G',
    keyScale: 'mixolydian',
    rows: [
      { label: 'Bars 1–4', chords: ['G7', 'G7', 'G7', 'G7'] },
      { label: 'Bars 5–8', chords: ['C7', 'C7', 'G7', 'G7'] },
      { label: 'Bars 9–12', chords: ['D7', 'C7', 'G7', 'D7'] },
    ],
  },
  {
    id: 'pachelbel',
    name: 'Canon Progression (I – V – vi – iii – IV – I – IV – V)',
    keyRoot: 'D',
    keyScale: 'major',
    rows: [
      { label: 'Part 1', chords: ['D', 'A', 'Bm', 'F#m'] },
      { label: 'Part 2', chords: ['G', 'D', 'G', 'A'] },
    ],
  },
  {
    id: 'andalusian',
    name: 'Andalusian Cadence (i – VII – VI – V)',
    keyRoot: 'A',
    keyScale: 'minor',
    rows: [
      { label: 'Cadence', chords: ['Am', 'G', 'F', 'E'] },
    ],
  },
];

export function createDefaultProgression(): CustomProgressionData {
  return {
    version: 1,
    title: 'My Chord Progression',
    keyRoot: 'C',
    keyScale: 'major',
    bpm: 80,
    beatsPerChord: 4,
    rows: [
      {
        id: 'row-1',
        label: 'Row 1',
        chords: [
          { id: 'chord-1-1', symbol: 'C', degree: 'I', beats: 4 },
          { id: 'chord-1-2', symbol: 'G', degree: 'V', beats: 4 },
        ],
      },
      {
        id: 'row-2',
        label: 'Row 2',
        chords: [
          { id: 'chord-2-1', symbol: 'Am', degree: 'vi', beats: 4 },
          { id: 'chord-2-2', symbol: 'F', degree: 'IV', beats: 4 },
        ],
      },
    ],
  };
}

/**
 * Computes the flattened list of all chords in order,
 * with each chord receiving the CelloChordStudy of the NEXT chord in the sequence
 * (with the last chord looping back to the first).
 */
export function flattenProgression(
  progression: CustomProgressionData,
  studyCache = new Map<string, CelloChordStudy | null>()
): ProgressionFlattenedChord[] {
  const getStudy = (symbol: string): CelloChordStudy | null => {
    if (studyCache.has(symbol)) return studyCache.get(symbol)!;
    try {
      const s = getCelloChord(symbol);
      studyCache.set(symbol, s);
      return s;
    } catch {
      studyCache.set(symbol, null);
      return null;
    }
  };

  const rawList: { rowIndex: number; chordIndex: number; item: ProgressionChordItem }[] = [];
  progression.rows.forEach((row, rowIndex) => {
    row.chords.forEach((chord, chordIndex) => {
      rawList.push({ rowIndex, chordIndex, item: chord });
    });
  });

  const count = rawList.length;
  return rawList.map((entry, globalIndex) => {
    const nextIndex = count > 1 ? (globalIndex + 1) % count : -1;
    const study = getStudy(entry.item.symbol);
    const nextItem = nextIndex >= 0 ? rawList[nextIndex] : undefined;
    const nextChord = nextItem ? getStudy(nextItem.item.symbol) : null;
    return {
      rowIndex: entry.rowIndex,
      chordIndex: entry.chordIndex,
      globalIndex,
      item: entry.item,
      study,
      nextChord,
    };
  });
}

/** Get Roman degree for a chord symbol within a given key */
export function getRomanDegree(
  symbol: string,
  keyRoot: string,
  keyScale: ChordScaleId
): string | null {
  const chords = chordsInScale(keyRoot, keyScale);
  const found = chords.find((c) => `${c.root}${c.type.id}` === symbol || c.id === symbol);
  return found?.romanDegree ?? null;
}

/** Reorder operations on progression rows */
export function addChordToRow(
  progression: CustomProgressionData,
  rowIndex: number,
  symbol: string,
  degree?: string | null
): CustomProgressionData {
  const chord: ProgressionChordItem = {
    id: uniqueId('chord'),
    symbol,
    degree: degree ?? getRomanDegree(symbol, progression.keyRoot, progression.keyScale),
    beats: progression.beatsPerChord,
  };

  return {
    ...progression,
    rows: progression.rows.map((row, idx) => {
      if (idx !== rowIndex) return row;
      return { ...row, chords: [...row.chords, chord] };
    }),
  };
}

export function removeChord(
  progression: CustomProgressionData,
  rowIndex: number,
  chordIndex: number
): CustomProgressionData {
  return {
    ...progression,
    rows: progression.rows.map((row, rIdx) => {
      if (rIdx !== rowIndex) return row;
      return {
        ...row,
        chords: row.chords.filter((_, cIdx) => cIdx !== chordIndex),
      };
    }),
  };
}

export function moveChordWithinRow(
  progression: CustomProgressionData,
  rowIndex: number,
  fromIndex: number,
  toIndex: number
): CustomProgressionData {
  const row = progression.rows[rowIndex];
  if (!row || fromIndex < 0 || toIndex < 0 || fromIndex >= row.chords.length || toIndex >= row.chords.length) {
    return progression;
  }
  const chords = [...row.chords];
  const removed = chords.splice(fromIndex, 1)[0];
  if (removed) {
    chords.splice(toIndex, 0, removed);
  }
  return {
    ...progression,
    rows: progression.rows.map((r, i) => (i === rowIndex ? { ...r, chords } : r)),
  };
}

export function moveChordBetweenRows(
  progression: CustomProgressionData,
  fromRow: number,
  fromIndex: number,
  toRow: number,
  toIndex: number
): CustomProgressionData {
  if (
    fromRow < 0 ||
    toRow < 0 ||
    fromRow >= progression.rows.length ||
    toRow >= progression.rows.length
  ) {
    return progression;
  }
  const sourceRow = progression.rows[fromRow];
  const targetRow = progression.rows[toRow];
  if (!sourceRow || !targetRow) return progression;
  if (fromIndex < 0 || fromIndex >= sourceRow.chords.length) return progression;

  const chord = sourceRow.chords[fromIndex];
  if (!chord) return progression;
  const newSourceChords = sourceRow.chords.filter((_, idx) => idx !== fromIndex);
  const targetChords = fromRow === toRow ? newSourceChords : [...targetRow.chords];
  const clampedToIndex = Math.max(0, Math.min(toIndex, targetChords.length));
  targetChords.splice(clampedToIndex, 0, chord);

  return {
    ...progression,
    rows: progression.rows.map((row, rIdx) => {
      if (rIdx === fromRow && fromRow !== toRow) {
        return { ...row, chords: newSourceChords };
      }
      if (rIdx === toRow) {
        return { ...row, chords: targetChords };
      }
      return row;
    }),
  };
}

export function addRow(
  progression: CustomProgressionData,
  label?: string
): CustomProgressionData {
  const rowNum = progression.rows.length + 1;
  return {
    ...progression,
    rows: [
      ...progression.rows,
      {
        id: uniqueId('row'),
        label: label ?? `Row ${rowNum}`,
        chords: [],
      },
    ],
  };
}

export function removeRow(
  progression: CustomProgressionData,
  rowIndex: number
): CustomProgressionData {
  if (progression.rows.length <= 1) {
    // Keep at least one empty row
    return {
      ...progression,
      rows: [{ id: `row-${Date.now()}`, label: 'Row 1', chords: [] }],
    };
  }
  return {
    ...progression,
    rows: progression.rows.filter((_, idx) => idx !== rowIndex),
  };
}

export function applyPreset(
  presetId: string,
  currentBpm = 80,
  currentBeats = 4
): CustomProgressionData {
  const preset = PROGRESSION_PRESETS.find((p) => p.id === presetId) ?? PROGRESSION_PRESETS[0]!;
  return {
    version: 1,
    title: preset.name,
    keyRoot: preset.keyRoot,
    keyScale: preset.keyScale,
    bpm: currentBpm,
    beatsPerChord: currentBeats,
    rows: preset.rows.map((r, rIdx) => ({
      id: `row-${rIdx + 1}`,
      label: r.label,
      chords: r.chords.map((symbol, cIdx) => ({
        id: `chord-${rIdx + 1}-${cIdx + 1}`,
        symbol,
        degree: getRomanDegree(symbol, preset.keyRoot, preset.keyScale),
        beats: currentBeats,
      })),
    })),
  };
}

/** Index that `moveChordBetweenRows` clamps to the end of the target row. */
export const END_OF_ROW = Number.MAX_SAFE_INTEGER;

export const MIN_PROGRESSION_BPM = 30;
export const MAX_PROGRESSION_BPM = 240;
export const DEFAULT_PROGRESSION_BPM = 80;

/** A typed BPM, or null when it is not a whole number in the usable range. */
export function parseProgressionBpm(text: string): number | null {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return null;
  return value >= MIN_PROGRESSION_BPM && value <= MAX_PROGRESSION_BPM ? value : null;
}

/** How long each chord sounds at a tempo and playback speed. */
export function msPerChord(bpm: number, speed: number, beatsPerChord: number): number {
  const effectiveBpm = Math.max(MIN_PROGRESSION_BPM, bpm) * speed;
  return (60_000 / effectiveBpm) * beatsPerChord;
}

export function countChords(progression: CustomProgressionData): number {
  return progression.rows.reduce((total, row) => total + row.chords.length, 0);
}

/** Replaces a saved entry with the same title, ignoring case, or puts the new one first. */
export function upsertSavedEntry(
  saved: readonly SavedProgressionEntry[],
  entry: SavedProgressionEntry,
): SavedProgressionEntry[] {
  const title = entry.title.toLowerCase();
  const existing = saved.findIndex((candidate) => candidate.title.trim().toLowerCase() === title);
  if (existing < 0) return [entry, ...saved];
  return saved.map((candidate, index) => (index === existing ? entry : candidate));
}

/** A file name for an exported progression: its title with anything unsafe replaced. */
export function progressionFileName(title: string): string {
  const slug = (title || 'progression').toLowerCase().replaceAll(/[^a-z0-9_-]/gi, '_');
  return `${slug}.json`;
}

/** A stored draft, or null when the stored text is not a progression. */
export function parseStoredProgression(raw: string | null): CustomProgressionData | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  const looksValid = typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { rows?: unknown }).rows);
  return looksValid ? (parsed as CustomProgressionData) : null;
}

/** The stored saved list, or an empty one when the stored text is not a list. */
export function parseSavedProgressions(raw: string | null): SavedProgressionEntry[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as SavedProgressionEntry[]) : [];
}
