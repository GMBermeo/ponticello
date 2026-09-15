import { useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyDemandBar } from '@/components/practice/KeyCensus';
import { Button, PressableRow, Segmented, useControlFeedback } from '@/components/ui/controls';
import { Body, Label, Row, Rule, Stack, TapeChip, Title } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { FONT, TAPE_COLOR_LABEL } from '@/theme/tokens';
import { APP_NAME, APP_TAGLINE } from '@/brand';
import { KEY_PRACTICE_ROWS, LIBRARY_KEY_CENSUS, LIBRARY_ROWS, LibraryRow } from '@/scores';
import { LIBRARY_EDITION } from '@/scores/libraryEdition';
import { DifficultyTier } from '@/domain/schema';
import { useImportedRows } from '@/state/usePiece';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';

type CategoryFilter = 'ALL' | 'study' | 'song' | 'imported';
type DifficultyFilter = 'ALL' | DifficultyTier;
const CATEGORIES = [
  { value: 'ALL' as const, label: 'All pieces' }, { value: 'study' as const, label: 'Studies' },
  { value: 'song' as const, label: 'Songs' }, { value: 'imported' as const, label: 'Imported' },
];
const LEVELS = [
  { value: 'ALL' as const, label: 'Any level' }, { value: 'Beginner' as const, label: 'Beginner' },
  { value: 'Intermediate' as const, label: 'Intermediate' }, { value: 'Advanced' as const, label: 'Advanced' },
  { value: 'Expert' as const, label: 'Expert' },
];

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const imported = useImportedRows();
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('ALL');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const feedback = useControlFeedback();
  const allRows = useMemo(() => [...imported, ...LIBRARY_ROWS], [imported]);
  const rows = useMemo(() => allRows.filter((row) => {
    const inCategory = category === 'ALL' || (category === 'imported' ? imported.some((r) => r.id === row.id)
      : category === 'song' ? row.category === 'song' || row.category === 'classical' : row.category === 'study');
    const query = search.trim().toLowerCase();
    return inCategory && (difficulty === 'ALL' || row.difficulty === difficulty)
      && (!query || [row.title, row.composer, row.origin, row.keySignature].some((text) => text.toLowerCase().includes(query)));
  }), [allRows, imported, category, difficulty, search]);
  const wide = !theme.scale.compact;
  const clearFilters = () => { setCategory('ALL'); setDifficulty('ALL'); setSearch(''); };

  const handleSelectSong = useCallback((id: string) => {
    router.push(`/song/${id}`);
  }, [router]);

  const renderItem = useCallback(({ item }: { item: LibraryRow }) => (
    <SongRow row={item} onSelect={handleSelectSong} />
  ), [handleSelectSong]);

  const renderSeparator = useCallback(() => (
    <Rule style={{ marginHorizontal: theme.s(24) }} />
  ), [theme]);

  const listHeader = useMemo(() => (
    <>
      <Stack padX={24} padY={16} gap={10}>
        <Row gap={8} style={{ alignItems: 'baseline' }}>
          <Title accessibilityRole="header" size={30}>Your music</Title>
          <Body size={13} color={theme.chrome.dim} style={{ marginLeft: 'auto' }}>{allRows.length} pieces</Body>
        </Row>
        <Row gap={8} style={[{ borderWidth: theme.rule(1), borderColor: theme.chrome.line, borderRadius: theme.s(8), paddingLeft: theme.s(14), minHeight: theme.tap }, feedback.focusStyle]}>
          <TextInput {...feedback.events} value={search} onChangeText={setSearch}
            accessibilityLabel="Search music" placeholder="Search title, artist or key" placeholderTextColor={theme.chrome.dim}
            style={{ flex: 1, minWidth: 0, minHeight: theme.tap, fontFamily: FONT.regular, color: theme.chrome.ink, fontSize: theme.font(15), padding: 0, outlineWidth: 0, outlineStyle: 'solid', outlineColor: 'transparent' }}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
          {search ? <Button label="×" accessibilityLabel="Clear search" tone="ghost" onPress={() => setSearch('')} /> : null}
        </Row>
        <Segmented accessibilityLabel="Music category" segments={CATEGORIES} value={category} onChange={setCategory} grow compact />
        <Row>
          <Body size={12} color={theme.chrome.dim} accessibilityLiveRegion="polite">{rows.length} {rows.length === 1 ? 'piece' : 'pieces'}{search ? ' found' : ' to explore'}</Body>
          <View style={{ marginLeft: 'auto' }}><Button label={difficulty === 'ALL' ? 'Filter by level' : difficulty} hint={filtersOpen ? '−' : '+'} expanded={filtersOpen} tone="ghost" onPress={() => setFiltersOpen(!filtersOpen)} /></View>
        </Row>
        {filtersOpen ? <View style={{ gap: theme.s(8) }}>
          <Body size={12} color={theme.chrome.dim}>Filter by the full score’s difficulty. Songs also offer easier arrangements.</Body>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.s(6) }}>
            {LEVELS.map((level) => <Button key={level.value} label={level.label} tone={difficulty === level.value ? 'accent' : 'default'} onPress={() => setDifficulty(level.value)} />)}
          </View>
        </View> : null}
      </Stack>
      <Rule />
    </>
  ), [allRows.length, category, difficulty, feedback.events, feedback.focusStyle, filtersOpen, rows.length, search, theme]);

  return (
    <Screen scroll={false} padded={false}>
      <Row padX={24} gap={12} style={{ paddingTop: insets.top, minHeight: theme.s(76) + insets.top, borderBottomWidth: theme.rule(1), borderColor: theme.chrome.lineSoft }}>
        <View style={{ flex: 1 }}>
          <Title size={22}>{APP_NAME}</Title>
          {wide ? <Body size={12} color={theme.chrome.dim}>{`${APP_TAGLINE} · ${LIBRARY_EDITION.label}`}</Body> : null}
        </View>
        <Button label="Tuner" tone="ghost" onPress={() => router.push('/tuner')} />
        <Button label="Import" onPress={() => router.push('/settings/import')} />
      </Row>
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <FlatList
            ListHeaderComponent={listHeader}
            data={rows}
            keyExtractor={keyExtractor}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: theme.s(20) }}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
            renderItem={renderItem}
            ItemSeparatorComponent={renderSeparator}
            ListEmptyComponent={<Stack pad={24} gap={12}>
              <Title size={22}>{category === 'imported' && !search ? 'Make room for your music' : 'No pieces found'}</Title>
              <Body size={14} color={theme.chrome.dim}>{category === 'imported' && !search ? 'Import a MIDI file to add a cello part and accompaniment to your library.' : 'Try another title, artist or key, or clear your filters.'}</Body>
              <Button label={category === 'imported' && !search ? 'Import a MIDI file' : 'Clear filters'} onPress={category === 'imported' && !search ? () => router.push('/settings/import') : clearFilters} />
            </Stack>}
          />
          {!wide ? <Row padX={16} style={{ borderTopWidth: theme.rule(1), borderColor: theme.chrome.lineSoft }}>
            <Button label="Reading guide" tone="ghost" onPress={() => router.push('/tutorial')} />
            <Button label="Scales" tone="ghost" onPress={() => router.push('/scales')} />
            <View style={{ marginLeft: 'auto' }}><Button label="My tapes" tone="ghost" onPress={() => router.push('/settings/tapes')} /></View>
          </Row> : null}
        </View>
        {wide ? <PracticeRail /> : null}
      </View>
    </Screen>
  );
}

const keyExtractor = (row: LibraryRow) => row.id;

interface SongRowProps {
  row: LibraryRow;
  onSelect: (id: string) => void;
}

const SongRow = memo(function SongRow({ row, onSelect }: SongRowProps) {
  const theme = useTheme();
  const handlePress = useCallback(() => {
    onSelect(row.id);
  }, [onSelect, row.id]);

  return (
    <PressableRow onPress={handlePress} accessibilityLabel={`${row.title} by ${row.composer}. ${row.difficulty}. Open piece`}>
      <Row padX={24} padY={16} gap={14}>
        <View style={{ flex: 1, minWidth: 0, gap: theme.s(5) }}>
          <Title size={17} numberOfLines={2}>{row.title}</Title>
          <Body size={13} color={theme.chrome.dim} numberOfLines={1}>{row.composer} · {row.keySignature}</Body>
        </View>
        <View style={{ alignItems: 'flex-end', gap: theme.s(5) }}>
          <Body size={12} color={theme.chrome.dim}>{row.difficulty}</Body>
          <Body size={12} color={theme.chrome.dim}>{row.bars === null ? 'No score' : `${row.bars} bars`}</Body>
        </View>
        <Title size={20} color={theme.chrome.dim}>›</Title>
      </Row>
    </PressableRow>
  );
});

function PracticeRail() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useSettings();
  return <View style={{ width: theme.s(224), borderLeftWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, backgroundColor: theme.chrome.surface }}>
    <Screen padded={false}>
      <Stack pad={20} gap={14}>
        <Label size={11}>A gentle start</Label>
        <Title size={24}>Find your sound.</Title>
        <Body size={14} color={theme.chrome.dim}>Settle into the bow with a short open-string study.</Body>
        <Button label="Open-string study" hint="→" onPress={() => router.push(`/song/${LIBRARY_ROWS[0].id}`)} />
        <Body size={12} color={theme.chrome.dim}>8 bars · Beginner</Body>
      </Stack>
      <Rule style={{ marginHorizontal: theme.s(20) }} />
      <PracticeByKey />
      <Rule style={{ marginHorizontal: theme.s(20) }} />
      <Stack pad={20} gap={12}>
        <Label size={11}>Before you play</Label>
        <PressableRow onPress={() => router.push('/tutorial')} accessibilityLabel="Open the reading guide" style={{ justifyContent: 'center' }}><Title size={15}>Reading guide →</Title><Body size={12} color={theme.chrome.dim}>Notes, numbers and string colours</Body></PressableRow>
        <PressableRow onPress={() => router.push('/settings/tapes')} accessibilityLabel="Edit my tapes" style={{ justifyContent: 'center' }}><Title size={15}>My fingerboard tapes →</Title><Body size={12} color={theme.chrome.dim}>Match the colours on your cello</Body></PressableRow>
        <Row gap={7} style={{ flexWrap: 'wrap' }}>{settings.tapeSets[0]?.tapes.map((tape) => <TapeChip key={tape.id} color={theme.chrome.tapes[tape.color]} label={TAPE_COLOR_LABEL[tape.color]} width={32} height={5} />)}</Row>
      </Stack>
      <Stack padX={20} padY={12} gap={6}><Label size={10}>Always at your pace</Label><Body size={13} color={theme.chrome.dim}>Choose a lower arrangement, slow the tempo and repeat a few bars.</Body></Stack>
    </Screen>
  </View>;
}

/**
 * The three keys the library leans on hardest, with the drills behind them.
 *
 * This is the census earning its place on the first screen: a player who has
 * never thought about which key to practise is shown that a sixth of their
 * music is in one key, and one tap away is a scale for it. Counts come from
 * `LIBRARY_KEY_CENSUS`, measured at load, so this block cannot go stale
 * against the library.
 */
function PracticeByKey() {
  const theme = useTheme();
  const router = useRouter();
  const top = KEY_PRACTICE_ROWS.filter((row) => row.drills.length > 0).slice(0, 3);
  const total = LIBRARY_KEY_CENSUS.counted;
  const maxShare = KEY_PRACTICE_ROWS[0]?.share ?? 0;

  return <Stack pad={20} gap={12}>
    <Label size={11}>Practise by key</Label>
    <Body size={13} color={theme.chrome.dim}>
      {`The keys your ${total} songs are actually in. Most-used first.`}
    </Body>
    {top.map((row) => (
      <PressableRow key={row.key} onPress={() => router.push('/scales')}
        accessibilityLabel={`${row.key}, ${row.songs} of ${total} songs, ${row.drills.length} drills. Open scales by key`}
        style={{ justifyContent: 'center' }}>
        <KeyDemandBar row={row} of={total} maxShare={maxShare} compact />
      </PressableRow>
    ))}
    <Button label="All scales by key" hint="→" onPress={() => router.push('/scales')} />
  </Stack>;
}
