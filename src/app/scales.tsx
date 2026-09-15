import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { KeyDemandBar } from '@/components/practice/KeyCensus';
import { Button, PressableRow, Segmented } from '@/components/ui/controls';
import { Body, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { KEY_PRACTICE_ROWS, KeyPracticeRow, LIBRARY_KEY_CENSUS } from '@/scores';
import { firstPositionVerdict } from '@/scores/scaleDrills';
import { useTheme } from '@/theme/ThemeProvider';

type Filter = 'ALL' | 'DRILLED' | 'OPEN';

const FILTERS = [
  { value: 'ALL' as const, label: 'Every key' },
  { value: 'DRILLED' as const, label: 'Has drills' },
  { value: 'OPEN' as const, label: 'Open-string tonic' },
];

/**
 * Scales by key.
 *
 * Ordered by the library's own census, which is the whole point: a beginner
 * with a fixed number of evenings should spend them on the keys their music is
 * actually in, and the order of this list is that argument made in one screen.
 * Nothing here is a written-down number — the counts, the shares, the ranking
 * and the "cornerstone / comes up often" labels are all measured from the
 * bundled library at load, so rebuilding the library re-sorts this screen.
 *
 * Keys with no drill still get a row. A gap that is visible and explained is
 * more use to a player than a tidy list that quietly omits the three keys the
 * cello finds hardest.
 */
export default function ScalesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('ALL');

  const total = LIBRARY_KEY_CENSUS.counted;
  const maxShare = LIBRARY_KEY_CENSUS.entries[0]?.share ?? 0;
  const drills = useMemo(
    () => KEY_PRACTICE_ROWS.reduce((sum, row) => sum + row.drills.length, 0),
    [],
  );
  const drilledKeys = useMemo(
    () => KEY_PRACTICE_ROWS.filter((row) => row.drills.length > 0).length,
    [],
  );
  const covered = useMemo(
    () => KEY_PRACTICE_ROWS.reduce((sum, row) => sum + (row.drills.length > 0 ? row.songs : 0), 0),
    [],
  );

  const rows = useMemo(() => KEY_PRACTICE_ROWS.filter((row) => (
    filter === 'ALL'
      || (filter === 'DRILLED' && row.drills.length > 0)
      || (filter === 'OPEN' && row.openString !== null)
  )), [filter]);

  const wide = !theme.scale.compact;

  const header = <>
    <Stack padX={24} padY={16} gap={12}>
      <Label size={11}>Graded by your own library</Label>
      <Title accessibilityRole="header" size={30}>Scales by key</Title>
      <Body size={14} color={theme.chrome.dim}>
        {`Your ${total} songs sit in ${LIBRARY_KEY_CENSUS.entries.length} keys. The keys at the top are the ones you will meet most often, so they get the most drills — ${drills} of them across ${drilledKeys} keys, easiest first.`}
      </Body>
      <Row gap={16} style={{ flexWrap: 'wrap' }}>
        <Stack gap={2}>
          <Num size={20}>{Math.round((covered / Math.max(1, total)) * 100)}%</Num>
          <Label size={10} color={theme.chrome.dim}>of your songs, in a drilled key</Label>
        </Stack>
        <Stack gap={2}>
          <Num size={20}>{LIBRARY_KEY_CENSUS.openStringSongs}</Num>
          <Label size={10} color={theme.chrome.dim}>in a key you can drone by ear</Label>
        </Stack>
      </Row>
      <Body size={13} color={theme.chrome.dim}>
        Four keys are tuned to an open string — C, G, D and A. Bow the string, leave it ringing, and
        the scale has a reference pitch you never have to find. Those keys are marked with their
        string’s colour.
      </Body>
      <Segmented accessibilityLabel="Which keys to show" segments={FILTERS} value={filter} onChange={setFilter} grow compact />
    </Stack>
    <Rule />
  </>;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Scale drills" />
      <FlatList
        ListHeaderComponent={header}
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingBottom: theme.s(24) }}
        initialNumToRender={8}
        ItemSeparatorComponent={() => <Rule style={{ marginHorizontal: theme.s(24) }} />}
        renderItem={({ item }) => (
          <KeyBlock row={item} of={total} maxShare={maxShare} wide={wide}
            onOpen={(id) => router.push(`/song/${id}`)} />
        )}
        ListEmptyComponent={<Stack pad={24} gap={10}>
          <Title size={20}>Nothing to show</Title>
          <Body size={14} color={theme.chrome.dim}>No key in your library matches that filter.</Body>
        </Stack>}
      />
    </Screen>
  );
}

function KeyBlock({
  row, of, maxShare, wide, onOpen,
}: {
  row: KeyPracticeRow;
  of: number;
  maxShare: number;
  wide: boolean;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  // Derived from the instrument, not from the census: what this key costs the
  // left hand down here, which is the other half of "should I practise it".
  const verdict = firstPositionVerdict(row.tonic, row.mode);

  return (
    <Stack padX={24} padY={16} gap={12}>
      <KeyDemandBar row={row} of={of} maxShare={maxShare} />
      <Body size={13} color={theme.chrome.dim}>{verdict.note}</Body>
      {row.drills.length === 0 ? (
        <View style={{
          backgroundColor: theme.chrome.surface,
          padding: theme.s(12),
          borderRadius: theme.s(8),
          gap: theme.s(4),
        }}>
          <Label size={10}>No drill, on purpose</Label>
          <Body size={13} color={theme.chrome.dim}>
            {`${row.songs} ${row.songs === 1 ? 'song' : 'songs'} — too few to be worth an evening, and the octave is ${verdict.tier.toLowerCase()} down here. Read these at sight and spend the time on the keys above.`}
          </Body>
        </View>
      ) : (
        <Stack gap={0}>
          {row.drills.map((drill, i) => (
            <PressableRow key={drill.id} onPress={() => onOpen(drill.id)}
              accessibilityLabel={`${drill.title}. ${drill.difficulty}. ${drill.bars} bars. Open drill`}>
              <Row padY={10} gap={12}>
                <Num size={13} color={theme.chrome.dim}>{i + 1}</Num>
                <View style={{ flex: 1, minWidth: 0, gap: theme.s(3) }}>
                  <Title size={15} numberOfLines={1}>{drill.title}</Title>
                  <Body size={12} color={theme.chrome.dim} numberOfLines={wide ? 2 : 1}>
                    {`${drill.difficulty} · ${drill.range} · ${drill.tempo} · ${drill.bars} bars`}
                  </Body>
                </View>
                <Title size={18} color={theme.chrome.dim}>›</Title>
              </Row>
            </PressableRow>
          ))}
        </Stack>
      )}
      {row.drills.length > 0 ? (
        <Button label={`Start ${row.key}`} hint="→" tone="ghost"
          onPress={() => { const first = row.drills[0]; if (first) onOpen(first.id); }} />
      ) : null}
    </Stack>
  );
}
