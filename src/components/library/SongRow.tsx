import { memo } from 'react';
import { View } from 'react-native';

import { NOTE_COLOR, type ChordSheet, type DifficultyTier } from '@domain';
import { getChordSheet, type LibraryRow } from '@scores';
import { alpha, RADIUS, useTheme, type Chrome } from '@theme';

import { Badge, Body, Icon, PressableRow, Row, Title, type IconName } from '../ui';
import { keyTile } from './keyTile';
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
      accessibilityLabel={`${row.title} by ${row.composer}, ${row.keySignature}. ${description}. Open piece`}
      style={{ backgroundColor: theme.chrome.surface, ...theme.corners(RADIUS.lg) }}
    >
      <Row padX={12} padY={12} gap={12}>
        <KeyTileView keySignature={row.keySignature} kind={kind} />
        <View style={{ flex: 1, minWidth: 0, gap: theme.s(4) }}>
          <Title size={17} numberOfLines={2}>{row.title}</Title>
          <Body size={13} color={theme.chrome.dim} numberOfLines={1}>
            {`${row.composer} · ${rowDetail(kind, row, chart)}`}
          </Body>
          <Row gap={6}>
            <Badge label={badge.label} background={badge.background} color={badge.color} />
          </Row>
        </View>
        <Icon name="forward" size={14} color={theme.chrome.dim} />
      </Row>
    </PressableRow>
  );
});

const TILE_ICON: Record<RowKind, IconName> = { builder: 'plus', chart: 'chords', score: 'note' };

/**
 * The row's leading tile: the piece's tonic on a wash of that note's colour,
 * so the list can be scanned by key the way the fingerboard chart is read.
 * Charts, the builder and keyless studies get a symbol instead.
 */
function KeyTileView({ keySignature, kind }: { keySignature: string; kind: RowKind }) {
  const theme = useTheme();
  const { chrome } = theme;
  const tile = kind === 'score' ? keyTile(keySignature) : null;
  const colour = tile ? chrome.notes[NOTE_COLOR[tile.letter]] : chrome.accent;
  return (
    <View
      style={{
        width: theme.s(48), height: theme.s(48), ...theme.corners(RADIUS.md),
        backgroundColor: alpha(colour, chrome.dark ? 0.2 : 0.14),
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {tile
        ? <Title size={tile.label.length > 1 ? 18 : 22} color={colour}>{tile.label}</Title>
        : <Icon name={TILE_ICON[kind]} size={20} color={colour} />}
    </View>
  );
}

export function LibraryRowSeparator() {
  const theme = useTheme();
  return <View style={{ height: theme.s(8) }} />;
}
