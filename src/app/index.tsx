import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Fingerboard, FingerboardScaleNote } from '@/components/Fingerboard';
import { Button, PressableRow, Segmented } from '@/components/ui/controls';
import {
  Body, Grow, Kicker, Label, Num, Row, Rule, Stack, TapeChip, Title,
} from '@/components/ui/primitives';
import { Screen } from '@/components/ui/Screen';
import { FONT, TAPE_COLOR_LABEL } from '@/theme/tokens';
import { APP_NAME, APP_TAGLINE } from '@/brand';
import { LIBRARY_ROWS, LibraryRow } from '@/scores';
import { useImportedRows } from '@/state/usePiece';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';

type CategoryFilter = 'ALL' | 'study' | 'song' | 'imported';
type DifficultyFilter = 'ALL' | 'Beginner' | 'Intermediate' | 'Advanced';

const CATEGORY_TABS = [
  { value: 'ALL' as const, label: 'ALL', hint: 'All pieces' },
  { value: 'study' as const, label: 'STUDIES', hint: 'Training studies & etudes' },
  { value: 'song' as const, label: 'SONGS', hint: 'Rock, metal, soundtracks & classical' },
  { value: 'imported' as const, label: 'IMPORTED', hint: 'Your imported files' },
];

const DIFFICULTY_FILTERS = [
  { value: 'ALL' as const, label: 'ALL LVLS' },
  { value: 'Beginner' as const, label: 'BEG' },
  { value: 'Intermediate' as const, label: 'INT' },
  { value: 'Advanced' as const, label: 'ADV' },
];

/**
 * Library — the landing screen.
 *
 * On the Fold 5's near-square inner display a single stretched column wastes
 * half the glass, so the list keeps a readable measure on the left and the
 * right rail carries the two things a beginner needs before any of it means
 * anything: what their tapes are, and where the tutorial is.
 */
export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useSettings();
  const imported = useImportedRows();
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('ALL');
  const [search, setSearch] = useState('');

  // Imported pieces come first when not filtered
  const allRows = useMemo(() => [...imported, ...LIBRARY_ROWS], [imported]);

  const rows = useMemo(() => {
    let list = allRows;

    if (category === 'imported') {
      list = imported;
    } else if (category === 'study') {
      list = list.filter((r) => r.category === 'study');
    } else if (category === 'song') {
      list = list.filter((r) => r.category === 'song' || r.category === 'classical');
    }

    if (difficulty !== 'ALL') {
      list = list.filter((r) => r.difficulty === difficulty);
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q)
        || r.composer.toLowerCase().includes(q)
        || r.origin.toLowerCase().includes(q)
        || r.keySignature.toLowerCase().includes(q),
      );
    }

    return list;
  }, [allRows, imported, category, difficulty, search]);

  const wide = !theme.scale.compact;

  const header = (
    <>
      <Stack padX={20} padY={14} gap={2}>
        <Kicker size={10}>
          {search.trim()
            ? `${rows.length} MATCHES OF ${allRows.length} PIECES · OFFLINE`
            : `${allRows.length} PIECES · ${imported.length} IMPORTED · OFFLINE`}
        </Kicker>
        <Title size={34}>{APP_NAME}</Title>
        <Label size={11} style={{ textTransform: 'none' }}>{APP_TAGLINE}</Label>
      </Stack>
      <Rule weight={2} />

      {/* Search bar */}
      <View style={{ paddingHorizontal: theme.s(20), paddingTop: theme.s(10), paddingBottom: theme.s(6) }}>
        <Row
          gap={8}
          style={{
            borderWidth: theme.rule(1),
            borderColor: search.trim() ? theme.chrome.accent : theme.chrome.line,
            backgroundColor: theme.chrome.surface,
            paddingHorizontal: theme.s(12),
            height: theme.s(38),
            alignItems: 'center',
          }}
        >
          <Label size={11} color={search.trim() ? theme.chrome.accent : theme.chrome.dim}>
            SEARCH
          </Label>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by title, artist, key..."
            placeholderTextColor={theme.chrome.dim}
            style={{
              flex: 1,
              color: theme.chrome.ink,
              fontSize: theme.font(13),
              fontFamily: FONT.regular,
              padding: 0,
            }}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {search.length > 0 ? (
            <Pressable
              onPress={() => setSearch('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={{ padding: theme.s(4) }}
            >
              <Label size={13} color={theme.chrome.dim}>✕</Label>
            </Pressable>
          ) : null}
        </Row>
      </View>

      {/* Category Tabs */}
      <View style={{ paddingHorizontal: theme.s(20), paddingTop: theme.s(6), paddingBottom: theme.s(6) }}>
        <Segmented segments={CATEGORY_TABS} value={category} onChange={setCategory} grow compact />
      </View>

      {/* Difficulty Sub-filter */}
      <View style={{ paddingHorizontal: theme.s(20), paddingBottom: theme.s(10) }}>
        <Segmented segments={DIFFICULTY_FILTERS} value={difficulty} onChange={setDifficulty} grow compact />
      </View>
      <Rule weight={2} />
    </>
  );

  const list = (
    <>
      {rows.map((row, index) => (
        <SongRow
          key={row.id}
          row={row}
          index={index + 1}
          onPress={() => router.push(`/song/${row.id}`)}
        />
      ))}
      {rows.length === 0 ? (
        <View style={{ padding: theme.s(24) }}>
          <Body size={15} color={theme.chrome.dim}>
            {search.trim()
              ? `No pieces found matching “${search}”.`
              : 'Nothing in this category yet.'}
          </Body>
        </View>
      ) : null}
    </>
  );

  const panel = (
    <StartHerePanel
      onTutorial={() => router.push('/tutorial')}
      onTuner={() => router.push('/tuner')}
      onTapes={() => router.push('/settings/tapes')}
      onImport={() => router.push('/settings/import')}
      tapeSets={settings.tapeSets}
      scroll={wide}
    />
  );

  // Two flex:1 scroll views stacked in a column would split the screen in half
  // and give the player two tiny panes, so a narrow window gets a single
  // scroll with the panel above the list instead.
  if (!wide) {
    return (
      <Screen padded={false} contentStyle={{ paddingBottom: theme.s(24) }}>
        {header}
        {panel}
        <Rule weight={2} />
        {list}
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ flex: 1.55, minWidth: 0 }}>
          {header}
          <Screen padded={false} contentStyle={{ paddingBottom: theme.s(20) }}>
            {list}
          </Screen>
        </View>
        <Rule weight={2} vertical />
        <View style={{ flex: 1, minWidth: 0 }}>{panel}</View>
      </View>
    </Screen>
  );
}

function SongRow({
  row, index, onPress,
}: { row: LibraryRow; index: number; onPress: () => void }) {
  const theme = useTheme();
  const { chrome } = theme;

  const badge = row.difficulty === 'Beginner'
    ? { bg: chrome.surface, fg: chrome.ink }
    : row.difficulty === 'Intermediate'
      ? { bg: chrome.accentWash, fg: chrome.ink }
      : { bg: chrome.accent, fg: chrome.bg };

  return (
    <>
      <PressableRow
        onPress={onPress}
        accessibilityLabel={`${row.title} by ${row.composer}. ${row.difficulty}. ${row.playable ? 'Ready to play' : 'No score bundled'}`}
      >
        <Row padX={20} padY={12} gap={12} style={{ alignItems: 'flex-start' }}>
          <Num size={12} color={chrome.dim} style={{ width: theme.s(24), paddingTop: theme.s(3) }}>
            {String(index).padStart(2, '0')}
          </Num>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Title size={17}>{row.title}</Title>
            <Label size={11} style={{ textTransform: 'none' }}>{row.composer}</Label>
            <Row gap={12} style={{ marginTop: theme.s(5), flexWrap: 'wrap' }}>
              <Label size={10}>{row.keySignature}</Label>
              <Label size={10}>{row.range}</Label>
              <Label size={10}>{row.bars === null ? 'NO SCORE' : `${row.bars} BARS`}</Label>
              <Label size={10} color={row.playable ? chrome.dim : chrome.accent}>
                {row.playable ? `${row.distribution[0][1]}% 1ST POS` : 'ADD YOUR OWN'}
              </Label>
            </Row>
          </View>
          <View style={{
            paddingHorizontal: theme.s(7),
            paddingVertical: theme.s(3),
            backgroundColor: badge.bg,
          }}>
            <Label size={9} color={badge.fg}>{row.difficulty.toUpperCase()}</Label>
          </View>
        </Row>
      </PressableRow>
      <Rule />
    </>
  );
}

/**
 * The right rail. Its job is to answer "what am I looking at" before the
 * player has opened anything — the tape strip is the single most useful thing
 * on this screen for someone three weeks into the instrument.
 */
function StartHerePanel({
  onTutorial, onTuner, onTapes, onImport, tapeSets, scroll,
}: {
  onTutorial: () => void;
  onTuner: () => void;
  onTapes: () => void;
  onImport: () => void;
  tapeSets: ReturnType<typeof useSettings>['settings']['tapeSets'];
  /** False when the panel is inlined into a parent that already scrolls. */
  scroll: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;

  const body = (
    <>
      <Stack padX={20} padY={16} gap={12}>
        <Label size={11}>START HERE</Label>
        <Button label="How to read this" hint="4 MIN" onPress={onTutorial} tone="accent" />
        <Body size={13} color={chrome.dim}>
          What the numbers mean, where the nut is, and which colour under your hand matches
          which mark on screen.
        </Body>
        <Button label="Tuner" hint="OPEN STRINGS" onPress={onTuner} />
        <Button label="Import a MIDI file" hint="YOUR OWN MUSIC" onPress={onImport} />
        <Body size={12} color={chrome.dim}>
          Bring a file you have the right to use and the app will finger the cello line and turn
          the rest into a backing track to play over.
        </Body>
      </Stack>

      <Rule weight={2} />

      <Stack padX={20} padY={16} gap={12}>
        <Row>
          <Label size={11}>MY TAPES</Label>
          <Grow />
          <PressableRow onPress={onTapes} accessibilityLabel="Edit my tapes">
            <Label size={10} color={chrome.accent}>EDIT</Label>
          </PressableRow>
        </Row>

        {tapeSets.map((set) => (
          <View key={set.id}>
            <Label size={10} color={chrome.ink}>{set.name.toUpperCase()}</Label>
            <Row gap={6} style={{ marginTop: theme.s(6) }}>
              {set.tapes.map((tape) => (
                <TapeChip
                  key={tape.id}
                  color={chrome.tapes[tape.color]}
                  label={TAPE_COLOR_LABEL[tape.color]}
                  width={44}
                />
              ))}
            </Row>
          </View>
        ))}

        <Row gap={14} style={{ alignItems: 'flex-start', marginTop: theme.s(6) }}>
          <Fingerboard
            height={theme.s(230)}
            maxMm={440}
            tapeSets={tapeSets}
            gutter={40}
            compact
          />
          <View style={{ flex: 1, paddingTop: theme.s(4) }}>
            <Body size={12} color={chrome.dim}>
              Drawn to scale. The tapes crowd together as they climb because the string
              halves at the octave — that is the instrument, not the drawing.
            </Body>
            <View style={{ marginTop: theme.s(8) }}>
              <FingerboardScaleNote />
            </View>
          </View>
        </Row>
      </Stack>
    </>
  );

  return scroll ? <Screen padded={false}>{body}</Screen> : body;
}
