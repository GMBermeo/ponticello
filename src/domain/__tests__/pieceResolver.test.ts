import { describe, expect, it } from 'vitest';

import {
  defaultCatalogProvider, NO_LINE, resolvePiece, rowForImported,
} from '../pieceResolver';
import { DifficultyTier } from '../schema';
import { getScore } from '@/scores';

describe('PieceResolver', () => {
  it('returns empty piece for undefined id', () => {
    const piece = resolvePiece({});
    expect(piece.score).toBeNull();
    expect(piece.row).toBeNull();
    expect(piece.backing).toBeNull();
    expect(piece.adaptive).toBe(false);
    expect(piece.line).toEqual(NO_LINE);
  });

  it('resolves core authored scores with correct non-adaptive metadata', () => {
    const piece = resolvePiece({ id: 'first-position-ladder' });
    expect(piece.score).toBeDefined();
    expect(piece.score?.id).toBe('first-position-ladder');
    expect(piece.adaptive).toBe(false);
    expect(piece.imported).toBe(false);
    expect(piece.row).toBeDefined();
    expect(piece.row?.category).toBe('study');
    expect(piece.backing).toBeDefined();
    expect(piece.line).toEqual(NO_LINE);
  });

  it('resolves bundled adaptive scores and adapts score per arrangement level', () => {
    const beginner = resolvePiece({ id: 'dies-irae', level: 'Beginner' });
    const expert = resolvePiece({ id: 'dies-irae', level: 'Expert' });

    expect(beginner.score).toBeDefined();
    expect(expert.score).toBeDefined();
    expect(beginner.adaptive).toBe(true);
    expect(expert.adaptive).toBe(true);
    expect(beginner.score?.metadata.difficulty).toBe('Beginner');
    expect(expert.score?.metadata.difficulty).toBe('Expert');
    expect(beginner.row?.difficulty).toBe('Beginner');
    expect(expert.row?.difficulty).toBe('Expert');
  });

  it('handles source track choices and reports fallback when choice is invalid', () => {
    const pieceWithInvalidPart = resolvePiece({
      id: 'dies-irae',
      level: 'Expert',
      choice: { partId: 'non-existent-part-id', octaves: 0 },
    });

    expect(pieceWithInvalidPart.line.fellBackBecause).toMatch(/no longer in this song/i);
    expect(pieceWithInvalidPart.score).toBeDefined();
  });

  it('resolves imported pieces cleanly', () => {
    const sampleScore = getScore('first-position-ladder')!;
    const importedPieceData = {
      score: { ...sampleScore, id: 'custom-imported-id' },
      backing: {
        id: 'custom-imported-id',
        name: 'Custom Imported',
        source: 'imported' as const,
        parts: [],
        bpm: 80,
        durationMs: 10000,
      },
    };

    const resolved = resolvePiece({
      id: 'custom-imported-id',
      level: 'Intermediate',
      importedPiece: importedPieceData,
    });

    expect(resolved.imported).toBe(true);
    expect(resolved.adaptive).toBe(true);
    expect(resolved.row?.id).toBe('custom-imported-id');
    expect(resolved.score?.id).toBe('custom-imported-id');
  });

  it('generates accurate distribution metadata in rowForImported', () => {
    const sampleScore = getScore('first-position-ladder')!;
    const row = rowForImported(sampleScore, 2);

    expect(row.id).toBe(sampleScore.id);
    expect(row.origin).toContain('2 BACKING PARTS');
    expect(row.distribution.length).toBe(3);
  });
});

describe('authored arrangement levels', () => {
  const base = getScore('first-position-ladder')!;
  const levelScore = (level: DifficultyTier) => ({
    ...base,
    id: `variant-${level}`,
    metadata: { ...base.metadata, difficulty: level },
  });
  const catalog = {
    ...defaultCatalogProvider,
    getScore: (id: string | undefined) => (id === 'variant' ? levelScore('Expert') : defaultCatalogProvider.getScore(id)),
    getBundledBacking: () => undefined,
    isAdaptiveBundledScore: () => false,
    getAuthoredLevel: (id: string | undefined, level: DifficultyTier) => (id === 'variant' ? levelScore(level) : undefined),
  };

  it('serves the authored score for the requested level', () => {
    for (const level of ['Beginner', 'Intermediate', 'Advanced', 'Expert'] as const) {
      const piece = resolvePiece({ id: 'variant', level, catalog });
      expect(piece.score?.id).toBe(`variant-${level}`);
      expect(piece.adaptive).toBe(true);
      expect(piece.authoredLevels).toBe(true);
      expect(piece.line).toEqual(NO_LINE);
    }
  });

  it('ignores a stored source-part choice rather than re-arranging over the authored fingering', () => {
    const piece = resolvePiece({
      id: 'variant', level: 'Advanced', choice: { partId: 'anything', octaves: -1 }, catalog,
    });
    expect(piece.score?.id).toBe('variant-Advanced');
    expect(piece.line).toEqual(NO_LINE);
  });

  it('leaves every other piece on the runtime arranger', () => {
    expect(resolvePiece({ id: 'first-position-ladder', catalog }).authoredLevels).toBe(false);
  });
});
