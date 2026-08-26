import { useMemo } from 'react';

import { BackingTrack } from '@/domain/backing';
import { CelloSongScore } from '@/domain/schema';
import { getBundledBacking, getScore, LIBRARY_ROWS, LibraryRow } from '@/scores';
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

export function usePiece(id: string | undefined): ResolvedPiece {
  const { entries, resolve } = useImportedLibrary();

  return useMemo(() => {
    if (!id) return { row: null, score: null, backing: null, imported: false };

    const bundled = getScore(id);
    if (bundled) {
      return {
        row: LIBRARY_ROWS.find((r) => r.id === id) ?? null,
        score: bundled,
        backing: getBundledBacking(id) ?? null,
        imported: false,
      };
    }

    if (entries.some((e) => e.id === id)) {
      const piece = resolve(id);
      if (piece) {
        return {
          row: rowForImported(piece.score, piece.backing.parts.filter((p) => p.role === 'accompaniment').length),
          score: piece.score,
          backing: piece.backing,
          imported: true,
        };
      }
    }

    return {
      row: LIBRARY_ROWS.find((r) => r.id === id) ?? null,
      score: null,
      backing: null,
      imported: false,
    };
  }, [id, entries, resolve]);
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
