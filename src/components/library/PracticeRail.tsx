import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';

import { KEY_PRACTICE_ROWS, LIBRARY_KEY_CENSUS, LIBRARY_ROWS } from '@scores';
import { useTapeSettings } from '@state';
import { TAPE_COLOR_LABEL, useTheme } from '@theme';

import { KeyDemandBar } from '../practice';
import { Body, Button, Label, PressableRow, Row, Rule, Screen, Stack, TapeChip, Title } from '../ui';

const TOP_KEY_COUNT = 3;

type RailLink = { href: Href; title: string; detail: string; accessibilityLabel: string };

const BEFORE_YOU_PLAY_LINKS: readonly RailLink[] = [
  { href: '/tutorial', title: 'Reading guide →', detail: 'Notes, numbers and string colours', accessibilityLabel: 'Open the reading guide' },
  { href: '/chart', title: 'Fingerboard chart →', detail: 'Every note, coloured by its name', accessibilityLabel: 'Open the fingerboard chart' },
  { href: '/profile', title: 'Your practice →', detail: 'Hours, days and streaks, kept on this phone', accessibilityLabel: 'Open your practice record' },
  { href: '/settings/tapes', title: 'My fingerboard tapes →', detail: 'Match the colours on your cello', accessibilityLabel: 'Edit my tapes' },
];

/** Side column on wide screens: a first study, the busiest keys, and the reference pages. */
export function PracticeRail() {
  const theme = useTheme();
  const router = useRouter();
  const { tapeSets } = useTapeSettings();
  return (
    <View
      style={{
        width: theme.s(224),
        borderLeftWidth: theme.rule(1),
        borderColor: theme.chrome.lineSoft,
        backgroundColor: theme.chrome.surface,
      }}
    >
      <Screen padded={false}>
        <Stack pad={20} gap={14}>
          <Label size={11}>A gentle start</Label>
          <Title size={24}>Find your sound.</Title>
          <Body size={14} color={theme.chrome.dim}>
            Settle into the bow with a short open-string study.
          </Body>
          <Button label="Open-string study" hint="→" onPress={() => router.push(`/song/${LIBRARY_ROWS[0].id}`)} />
          <Body size={12} color={theme.chrome.dim}>8 bars · Beginner</Body>
        </Stack>
        <Rule style={{ marginHorizontal: theme.s(20) }} />
        <PracticeByKey />
        <Rule style={{ marginHorizontal: theme.s(20) }} />
        <Stack pad={20} gap={12}>
          <Label size={11}>Before you play</Label>
          {BEFORE_YOU_PLAY_LINKS.map((link) => (
            <PressableRow
              key={link.title}
              onPress={() => router.push(link.href)}
              accessibilityLabel={link.accessibilityLabel}
              style={{ justifyContent: 'center' }}
            >
              <Title size={15}>{link.title}</Title>
              <Body size={12} color={theme.chrome.dim}>{link.detail}</Body>
            </PressableRow>
          ))}
          <Row gap={7} style={{ flexWrap: 'wrap' }}>
            {tapeSets[0]?.tapes.map((tape) => (
              <TapeChip
                key={tape.id}
                color={theme.chrome.tapes[tape.color]}
                label={TAPE_COLOR_LABEL[tape.color]}
                width={32}
                height={5}
              />
            ))}
          </Row>
        </Stack>
        <Stack padX={20} padY={12} gap={6}>
          <Label size={10}>Always at your pace</Label>
          <Body size={13} color={theme.chrome.dim}>
            Choose a lower arrangement, slow the tempo and repeat a few bars.
          </Body>
        </Stack>
      </Screen>
    </View>
  );
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
  const topKeys = KEY_PRACTICE_ROWS.filter((row) => row.drills.length > 0).slice(0, TOP_KEY_COUNT);
  const total = LIBRARY_KEY_CENSUS.counted;
  const maxShare = KEY_PRACTICE_ROWS[0]?.share ?? 0;

  return (
    <Stack pad={20} gap={12}>
      <Label size={11}>Practise by key</Label>
      <Body size={13} color={theme.chrome.dim}>
        {`The keys your ${total} songs are actually in. Most-used first.`}
      </Body>
      {topKeys.map((row) => (
        <PressableRow
          key={row.key}
          onPress={() => router.push('/scales')}
          accessibilityLabel={`${row.key}, ${row.songs} of ${total} songs, ${row.drills.length} drills. Open scales by key`}
          style={{ justifyContent: 'center' }}
        >
          <KeyDemandBar row={row} of={total} maxShare={maxShare} compact />
        </PressableRow>
      ))}
      <Button label="All scales by key" hint="→" onPress={() => router.push('/scales')} />
    </Stack>
  );
}
