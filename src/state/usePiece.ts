import { useMemo } from 'react';

import { ArrangementLevel } from '@/domain/arrangement';
import {
  celloPartOptions, CelloPartOption, DEFAULT_TRACK_CHOICE, TrackChoice,
} from '@/domain/trackPicker';
import {
  NO_LINE, resolvePiece, ResolvedCelloLine, ResolvedPiece, rowForImported,
  rowForArrangement,
} from '@/domain/pieceResolver';
import { LibraryRow } from '@/scores';
import { useImportedLibrary } from './library';

export type { ResolvedPiece, ResolvedCelloLine };
export { rowForImported, rowForArrangement, NO_LINE };

/**
 * One lookup hook for a piece, delegating domain resolution to `resolvePiece`.
 */
export function usePiece(
  id: string | undefined,
  level: ArrangementLevel = 'Expert',
  choice: TrackChoice = DEFAULT_TRACK_CHOICE,
): ResolvedPiece {
  const { entries, resolve } = useImportedLibrary();

  const importedPiece = useMemo(() => {
    if (!id || !entries.some((e) => e.id === id)) return null;
    return resolve(id);
  }, [id, entries, resolve]);

  return useMemo(
    () => resolvePiece({ id, level, choice, importedPiece }),
    [id, level, choice, importedPiece],
  );
}

/**
 * The costed part list the picker chooses from.
 */
export function useTrackOptions(
  piece: ResolvedPiece,
  level: ArrangementLevel,
): CelloPartOption[] {
  const { adaptive, score, backing, authoredLevels } = piece;

  return useMemo(() => {
    // Authored levels carry their own fingering; picking a source part would
    // replace it with a runtime arrangement, so there is nothing to offer.
    if (!adaptive || !score || authoredLevels) return [];
    const parts = backing?.parts ?? [];
    if (parts.length === 0) return [];
    return celloPartOptions(parts, level, {
      preferFlats: score.metadata.preferFlats ?? false,
    });
  }, [adaptive, score, backing, level, authoredLevels]);
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
