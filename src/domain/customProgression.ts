import { getCelloChord, type CelloChordStudy } from './celloChords';
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
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    id: `chord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
