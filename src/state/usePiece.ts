import { useMemo } from 'react';

import { ArrangementLevel, arrangeScoreForLevel } from '@/domain/arrangement';
import { BackingTrack } from '@/domain/backing';
import { CelloSongScore } from '@/domain/schema';
import {
  getBundledBacking, getScore, isAdaptiveBundledScore, LIBRARY_ROWS, LibraryRow,
} from '@/scores';
import { useImportedLibrary } from './library';

/**
 * One lookup for a piece, wherever it came from.
 *
 * A screen should not care whether a piece shipped with the app or was
 * imported this morning — it needs a score to draw, a row to describe, and
 * possibly a backing track. Resolving that in one place keeps the three
 * screens that need it from disagreeing about what counts as playable.
 */
export interface ResolvedPiece {
  row: LibraryRow | null;
  score: CelloSongScore | null;
  backing: BackingTrack | null;
  imported: boolean;
  /** Whether this piece is MIDI-derived and supports runtime arrangement levels. */
  adaptive: boolean;
}

/** A library row describing an imported piece. */
export function rowForImported(score: CelloSongScore, backingParts: number): LibraryRow {
  const midi = score.notes.map((n) => n.midiNumber);
  const low = score.notes[midi.indexOf(Math.min(...midi))];
  const high = score.notes[midi.indexOf(Math.max(...midi))];

  const total = score.notes.length || 1;
  const share = (test: (p: string) => boolean) =>
    Math.round((score.notes.filter((n) => test(n.position)).length / total) * 100);

  return {
    id: score.id,
    title: score.metadata.title,
    composer: score.metadata.composer,
    origin: backingParts > 0 ? `IMPORTED · ${backingParts} BACKING PARTS` : 'IMPORTED · MIDI',
    keySignature: score.metadata.keySignature,
    range: `${low.pitchName} – ${high.pitchName}`,
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

function rowForArrangement(base: LibraryRow, score: CelloSongScore): LibraryRow {
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

export function usePiece(id: string | undefined, level: ArrangementLevel = 'Expert'): ResolvedPiece {
  const { entries, resolve } = useImportedLibrary();

  return useMemo(() => {
    if (!id) {
      return { row: null, score: null, backing: null, imported: false, adaptive: false };
    }

    const bundled = getScore(id);
    if (bundled) {
      const baseRow = LIBRARY_ROWS.find((row) => row.id === id) ?? null;
      const adaptive = isAdaptiveBundledScore(id);
      const score = adaptive ? arrangeScoreForLevel(bundled, level) : bundled;
      return {
        row: baseRow ? rowForArrangement(baseRow, score) : null,
        score,
        backing: getBundledBacking(id) ?? null,
        imported: false,
        adaptive,
      };
    }

    if (entries.some((e) => e.id === id)) {
      const piece = resolve(id);
      if (piece) {
        const score = arrangeScoreForLevel(piece.score, level);
        const backingParts = piece.backing.parts.filter((part) => part.role === 'accompaniment').length;
        return {
          row: rowForImported(score, backingParts),
          score,
          backing: piece.backing,
          imported: true,
          adaptive: true,
        };
      }
    }

    return {
      row: LIBRARY_ROWS.find((r) => r.id === id) ?? null,
      score: null,
      backing: null,
      imported: false,
      adaptive: false,
    };
  }, [id, level, entries, resolve]);
}

/** Library rows for every imported piece, newest first. */
export function useImportedRows(): LibraryRow[] {
  const { entries, resolve } = useImportedLibrary();
  return useMemo(
    () => entries.flatMap((entry) => {
      const piece = resolve(entry.id);
      if (!piece) return [];
      const backingParts = piece.backing.parts.filter((p) => p.role === 'accompaniment').length;
      return [rowForImported(piece.score, backingParts)];
    }),
    [entries, resolve],
  );
}
