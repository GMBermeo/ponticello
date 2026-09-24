/**
 * Deep piece resolution module.
 *
 * A single, pure domain boundary for resolving any piece — core authored study,
 * bundled adaptive score, or user-imported MIDI — into a complete playable score,
 * backing track, and descriptive library row.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import {
  ArrangementLevel, arrangeScoreForLevel, BackingPart, BackingTrack, RawNoteEvent, CelloSongScore,
  DEFAULT_TRACK_CHOICE, findCelloPart, octaveMoveLabel, OctaveFit, partLabel, scoreFromPart, TrackChoice,
} from '@domain';
import {
  getAuthoredLevel, getBassLine, getBundledBacking, getGuideLine, getScore, isAdaptiveBundledScore,
  LIBRARY_ROWS, LibraryRow,
} from './library';

export interface ResolvedPiece {
  row: LibraryRow | null;
  score: CelloSongScore | null;
  backing: BackingTrack | null;
  imported: boolean;
  /** Whether this piece is MIDI-derived and supports runtime arrangement levels. */
  adaptive: boolean;
  /**
   * The levels are authored — one score per level, fingering included — rather
   * than arranged at runtime. The level selector still applies; the source-part
   * picker does not, because re-arranging a part would discard the authored
   * fingering it exists to show.
   */
  authoredLevels: boolean;
  /** Where the cello line on screen actually came from. */
  line: ResolvedCelloLine;
}

export interface ResolvedCelloLine {
  /** Null when this is the app's own arrangement. */
  partId: string | null;
  /** What to call it on screen. */
  label: string;
  octaves: number;
  /** The costed octave, when a source part is in play. */
  fit: OctaveFit | null;
  /** The part the source file wrote for a cello, if it has one. */
  celloPart: BackingPart | null;
  /** How many source parts the player could choose between. */
  partCount: number;
  fellBackBecause: string | null;
}

export const NO_LINE: ResolvedCelloLine = {
  partId: null,
  label: 'Ponticello arrangement',
  octaves: 0,
  fit: null,
  celloPart: null,
  partCount: 0,
  fellBackBecause: null,
};

export interface ImportedPieceData {
  score: CelloSongScore;
  backing: BackingTrack;
  guide?: RawNoteEvent[];
  bass?: RawNoteEvent[];
}

export interface ScoreCatalogProvider {
  getScore: (id: string | undefined) => CelloSongScore | undefined;
  getBundledBacking: (id: string | undefined) => BackingTrack | undefined;
  isAdaptiveBundledScore: (id: string | undefined) => boolean;
  getGuideLine: (id: string | undefined) => RawNoteEvent[] | undefined;
  getBassLine: (id: string | undefined) => RawNoteEvent[] | undefined;
  getLibraryRows: () => readonly LibraryRow[];
  /** A score authored for this level, for pieces that ship one per level. */
  getAuthoredLevel?: (id: string | undefined, level: ArrangementLevel) => CelloSongScore | undefined;
}

export const defaultCatalogProvider: ScoreCatalogProvider = {
  getScore,
  getBundledBacking,
  isAdaptiveBundledScore,
  getGuideLine,
  getBassLine,
  getLibraryRows: () => LIBRARY_ROWS,
  getAuthoredLevel,
};

/** A library row describing an imported piece. */
export function rowForImported(score: CelloSongScore, backingParts: number): LibraryRow {
  const midi = score.notes.map((n) => n.midiNumber);
  const low = score.notes[midi.indexOf(Math.min(...midi))];
  const high = score.notes[midi.indexOf(Math.max(...midi))];

  const total = score.notes.length || 1;
  const share = (test: (position: string) => boolean) =>
    Math.round((score.notes.filter((n) => test(n.position)).length / total) * 100);

  return {
    id: score.id,
    title: score.metadata.title,
    composer: score.metadata.composer,
    origin: backingParts > 0 ? `IMPORTED · ${backingParts} BACKING PARTS` : 'IMPORTED · MIDI',
    keySignature: score.metadata.keySignature,
    range: `${low?.pitchName ?? 'C2'} – ${high?.pitchName ?? 'A3'}`,
    tempo: `♩ ${score.metadata.bpm}`,
    difficulty: score.metadata.difficulty,
    category: 'imported',
    bars: score.measures.length,
    playable: true,
    distribution: [
      ['1st position', share((p) => p === '1st' || p === 'Half')],
      ['2nd – 4th', share((p) => ['2nd', '3rd', '4th'].includes(p))],
      ['Thumb / upper', share((p) => ['5th', '6th', '7th', 'Thumb'].includes(p))],
    ],
    note: score.metadata.teaches,
  };
}

export function rowForArrangement(base: LibraryRow, score: CelloSongScore): LibraryRow {
  const projected = rowForImported(score, 0);
  return {
    ...base,
    keySignature: score.metadata.keySignature,
    range: projected.range,
    difficulty: score.metadata.difficulty,
    bars: score.measures.length,
    distribution: projected.distribution,
    note: score.metadata.teaches,
  };
}

/**
 * Applies the player's part-and-octave choice to one resolved piece.
 */
export function applyChoice(
  arranged: CelloSongScore,
  backing: BackingTrack | null,
  choice: TrackChoice,
  level: ArrangementLevel,
): { score: CelloSongScore; backing: BackingTrack | null; line: ResolvedCelloLine } {
  const parts = backing?.parts ?? [];
  const line: ResolvedCelloLine = {
    ...NO_LINE,
    celloPart: findCelloPart(parts),
    partCount: parts.length,
  };

  if (!choice.partId) return { score: arranged, backing, line };

  const part = parts.find((candidate) => candidate.id === choice.partId);
  if (!part) {
    return {
      score: arranged,
      backing,
      line: { ...line, fellBackBecause: 'That part is no longer in this song.' },
    };
  }

  const built = scoreFromPart(arranged, part, choice, level);
  if (!built) {
    return {
      score: arranged,
      backing,
      line: {
        ...line,
        fellBackBecause: `${partLabel(part)} ${octaveMoveLabel(choice.octaves)}`
          + ' will not fit first position, so the arrangement is showing instead.',
      },
    };
  }

  return {
    score: built.score,
    backing: backing
      ? {
        ...backing,
        parts: parts.map((candidate) =>
          (candidate.id === part.id ? { ...candidate, muted: true } : candidate)),
      }
      : null,
    line: {
      ...line,
      partId: part.id,
      label: partLabel(part),
      octaves: choice.octaves,
      fit: built.fit,
    },
  };
}

export interface ResolvePieceOptions {
  id?: string;
  level?: ArrangementLevel;
  choice?: TrackChoice;
  catalog?: ScoreCatalogProvider;
  importedPiece?: ImportedPieceData | null;
}

const EMPTY_PIECE: ResolvedPiece = {
  row: null,
  score: null,
  backing: null,
  imported: false,
  adaptive: false,
  authoredLevels: false,
  line: NO_LINE,
};

/**
 * Resolves a piece by ID across all sources (core, bundled adaptive, or imported).
 */
export function resolvePiece({
  id,
  level = 'Expert',
  choice = DEFAULT_TRACK_CHOICE,
  catalog = defaultCatalogProvider,
  importedPiece = null,
}: ResolvePieceOptions): ResolvedPiece {
  if (!id) return EMPTY_PIECE;

  const { partId, octaves } = choice;
  const rows = catalog.getLibraryRows();

  // 1. Check bundled score (core authored or adaptive)
  const bundled = catalog.getScore(id);
  if (bundled) {
    const baseRow = rows.find((r) => r.id === id) ?? null;

    const authored = catalog.getAuthoredLevel?.(id, level);
    if (authored) {
      return {
        row: baseRow ? rowForArrangement(baseRow, authored) : null,
        score: authored,
        backing: catalog.getBundledBacking(id) ?? null,
        imported: false,
        adaptive: true,
        authoredLevels: true,
        line: NO_LINE,
      };
    }

    const adaptive = catalog.isAdaptiveBundledScore(id);
    const arranged = adaptive
      ? arrangeScoreForLevel(bundled, level, {
        guide: catalog.getGuideLine(id),
        bass: catalog.getBassLine(id),
      })
      : bundled;

    if (!adaptive) {
      return {
        row: baseRow,
        score: arranged,
        backing: catalog.getBundledBacking(id) ?? null,
        imported: false,
        adaptive,
        authoredLevels: false,
        line: NO_LINE,
      };
    }

    const applied = applyChoice(
      arranged,
      catalog.getBundledBacking(id) ?? null,
      { partId, octaves },
      level,
    );

    return {
      row: baseRow ? rowForArrangement(baseRow, applied.score) : null,
      score: applied.score,
      backing: applied.backing,
      imported: false,
      adaptive,
      authoredLevels: false,
      line: applied.line,
    };
  }

  // 2. Check imported piece
  if (importedPiece) {
    const arranged = arrangeScoreForLevel(importedPiece.score, level, {
      guide: importedPiece.guide,
      bass: importedPiece.bass,
    });
    const applied = applyChoice(arranged, importedPiece.backing, { partId, octaves }, level);
    const backingParts = (applied.backing?.parts ?? [])
      .filter((part) => part.role === 'accompaniment').length;

    return {
      row: rowForImported(applied.score, backingParts),
      score: applied.score,
      backing: applied.backing,
      imported: true,
      adaptive: true,
      authoredLevels: false,
      line: applied.line,
    };
  }

  return { ...EMPTY_PIECE, row: rows.find((r) => r.id === id) ?? null };
}
