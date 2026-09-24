import { memo } from 'react';
import { View } from 'react-native';

import type { ChordSheet, DifficultyTier } from '@domain';
import { getChordSheet, type LibraryRow } from '@scores';
import { useTheme, type Chrome } from '@theme';

import { Badge, Body, PressableRow, Row, Rule, Title } from '../ui';
import { CUSTOM_PROGRESSION_ID } from './libraryFilters';

type RowKind = 'builder' | 'chart' | 'score';

type Tint = { light: string; dark: string };

const DIFFICULTY_WASH: Record<DifficultyTier, Tint> = {
  Beginner: { light: 'rgba(31, 138, 76, 0.12)', dark: 'rgba(48, 209, 88, 0.16)' },
  Intermediate: { light: 'rgba(201, 52, 0, 0.12)', dark: 'rgba(255, 159, 10, 0.16)' },
  Advanced: { light: 'rgba(215, 0, 21, 0.12)', dark: 'rgba(255, 69, 58, 0.16)' },
  Expert: { light: 'rgba(215, 0, 21, 0.12)', dark: 'rgba(255, 69, 58, 0.16)' },
};

const INTERMEDIATE_INK: Tint = { light: '#C93400', dark: '#FF9F0A' };

type BadgeStyle = { label: string; background: string; color: string };

function badgeStyle(kind: RowKind, difficulty: DifficultyTier, chrome: Chrome): BadgeStyle {
  if (kind !== 'score') {
    return { label: kind === 'builder' ? 'BUILDER' : 'CHORD', background: chrome.accentWash, color: chrome.accent };
  }
  const tone = chrome.dark ? 'dark' : 'light';
  const inkByDifficulty: Record<DifficultyTier, string> = {
    Beginner: chrome.strings.C,
    Intermediate: INTERMEDIATE_INK[tone],
    Advanced: chrome.strings.G,
    Expert: chrome.strings.G,
  };
  return { label: difficulty.toUpperCase(), background: DIFFICULTY_WASH[difficulty][tone], color: inkByDifficulty[difficulty] };
}

function rowDetail(kind: RowKind, row: LibraryRow, chart: ChordSheet | undefined): string {
  if (kind === 'builder') return 'Interactive';
  if (kind === 'chart') return `${chart?.chords.length ?? 0} chords`;
  if (row.bars === null) return 'No score';
  const chordsSuffix = chart ? ' · Chords' : '';
  return `${row.bars} bars${chordsSuffix}`;
}

const KIND_DESCRIPTION: Record<Exclude<RowKind, 'score'>, string> = {
  builder: 'Custom chord progression builder',
  chart: 'Chord chart',
};

export type SongRowProps = {
  row: LibraryRow;
  onSelect: (id: string) => void;
};

export const SongRow = memo(function SongRow({ row, onSelect }: SongRowProps) {
  const theme = useTheme();
  const isBuilder = row.id === CUSTOM_PROGRESSION_ID;
  const chart = isBuilder ? undefined : getChordSheet(row.id);
  let kind: RowKind = 'score';
  if (isBuilder) kind = 'builder';
  else if (chart && !row.playable) kind = 'chart';
  const badge = badgeStyle(kind, row.difficulty, theme.chrome);
  const description = kind === 'score' ? row.difficulty : KIND_DESCRIPTION[kind];

  return (
    <PressableRow
      onPress={() => onSelect(row.id)}
      accessibilityLabel={`${row.title} by ${row.composer}. ${description}. Open piece`}
    >
      <Row padX={24} padY={16} gap={14}>
        <View style={{ flex: 1, minWidth: 0, gap: theme.s(5) }}>
          <Title size={17} numberOfLines={2}>{row.title}</Title>
          <Body size={13} color={theme.chrome.dim} numberOfLines={1}>
            {row.composer} · {row.keySignature}
          </Body>
        </View>
        <View style={{ alignItems: 'flex-end', gap: theme.s(6) }}>
          <Badge label={badge.label} background={badge.background} color={badge.color} />
          <Body size={11} color={theme.chrome.dim}>{rowDetail(kind, row, chart)}</Body>
        </View>
        <Title size={20} color={theme.chrome.dim}>›</Title>
      </Row>
    </PressableRow>
  );
});

export function LibraryRowSeparator() {
  const theme = useTheme();
  return <Rule style={{ marginHorizontal: theme.s(24) }} />;
}
