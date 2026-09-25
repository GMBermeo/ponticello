import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { FACE, RADIUS, useTheme } from '@theme';

import { Body, Button, Icon, Row, Segmented, Stack, Title, useControlFeedback } from '../ui';
import { LibraryShortcuts } from './LibraryChrome';
import {
  CATEGORY_SEGMENTS, LEVEL_SEGMENTS, type CategoryFilter, type DifficultyFilter,
} from './libraryFilters';

export type LibraryHeaderProps = {
  shownCount: number;
  /** Narrow screens have no practice rail, so its reference pages come here. */
  showShortcuts: boolean;
  search: string;
  onSearchChange: (next: string) => void;
  category: CategoryFilter;
  onCategoryChange: (next: CategoryFilter) => void;
  difficulty: DifficultyFilter;
  onDifficultyChange: (next: DifficultyFilter) => void;
};

/** Search, category tabs, shortcuts and the level filter above the library list. */
export function LibraryHeader(props: LibraryHeaderProps) {
  const { shownCount, search, category } = props;
  const theme = useTheme();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pieceWord = shownCount === 1 ? 'piece' : 'pieces';
  return (
    <>
      <Stack padX={4} padY={6} gap={12}>
        <SearchField value={search} onChange={props.onSearchChange} />
        <Segmented
          accessibilityLabel="Music category"
          segments={CATEGORY_SEGMENTS}
          value={category}
          onChange={props.onCategoryChange}
          grow
          compact
        />
        {props.showShortcuts ? <LibraryShortcuts /> : null}
        <Row style={{ paddingLeft: theme.s(4) }}>
          <Body size={12} color={theme.chrome.dim} accessibilityLiveRegion="polite">
            {shownCount} {pieceWord}
            {search ? ' found' : ' to explore'}
          </Body>
          <View style={{ marginLeft: 'auto' }}>
            <Button
              label={props.difficulty === 'ALL' ? 'Filter by level' : props.difficulty}
              hint={filtersOpen ? '−' : '+'}
              expanded={filtersOpen}
              tone="ghost"
              onPress={() => setFiltersOpen(!filtersOpen)}
            />
          </View>
        </Row>
        {filtersOpen ? <LevelFilter value={props.difficulty} onChange={props.onDifficultyChange} /> : null}
        {category === 'chords' ? <CreateProgressionCard /> : null}
      </Stack>
      <View style={{ height: theme.s(8) }} />
    </>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  return (
    <Row
      gap={8}
      style={[
        {
          backgroundColor: theme.chrome.fill,
          ...theme.corners(RADIUS.pill),
          paddingLeft: theme.s(14),
          minHeight: theme.tap,
        },
        feedback.focusStyle,
      ]}
    >
      <Icon name="search" size={16} color={theme.chrome.dim} />
      <TextInput
        {...feedback.events}
        value={value}
        onChangeText={onChange}
        accessibilityLabel="Search music"
        placeholder="Search title, artist or key"
        placeholderTextColor={theme.chrome.dim}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: theme.tap,
          ...FACE.regular,
          color: theme.chrome.ink,
          fontSize: theme.font(16),
          padding: 0,
          outlineWidth: 0,
          outlineStyle: 'solid',
          outlineColor: 'transparent',
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? <Button label="" icon="close" accessibilityLabel="Clear search" tone="ghost" onPress={() => onChange('')} /> : null}
    </Row>
  );
}

function LevelFilter({ value, onChange }: { value: DifficultyFilter; onChange: (next: DifficultyFilter) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.s(8) }}>
      <Body size={12} color={theme.chrome.dim}>
        Filter by the full score’s difficulty. Songs also offer easier arrangements.
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.s(6) }}>
        {LEVEL_SEGMENTS.map((level) => (
          <Button
            key={level.value}
            label={level.label}
            tone={value === level.value ? 'accent' : 'default'}
            onPress={() => onChange(level.value)}
          />
        ))}
      </View>
    </View>
  );
}

function CreateProgressionCard() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create your own chord progression"
      onPress={() => router.push('/chord-progression')}
      style={({ pressed }) => ({
        padding: theme.s(14),
        ...theme.corners(RADIUS.lg),
        backgroundColor: pressed ? theme.chrome.accentWash : theme.chrome.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.s(12),
      })}
    >
      <View
        style={{
          width: theme.s(36),
          height: theme.s(36),
          ...theme.corners(RADIUS.sm),
          backgroundColor: theme.chrome.accent,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Icon name="plus" size={18} color={theme.chrome.onAccent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Title size={15}>Create chord progression</Title>
        <Body size={12} color={theme.chrome.dim} numberOfLines={1}>
          Pick a key, arrange chord shapes in rows, and practice transitions
        </Body>
      </View>
      <Icon name="forward" size={15} color={theme.chrome.dim} />
    </Pressable>
  );
}
