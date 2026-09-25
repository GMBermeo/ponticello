import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { ScrollView } from 'react-native';

import { useThemePreference } from '@state';
import { APP_NAME, APP_TAGLINE, useTheme, type ChromeName } from '@theme';

import {
  Body, Button, GlassIconButton, Label, Row, Stack, TabHeader, Title, type IconName,
} from '../ui';

const MARK = require('../../../assets/logo/ponticello-icon-512.png');

const CHROME_ICON: Record<ChromeName, IconName> = { paper: 'sun', quiet: 'moon', neon: 'sparkles' };
const CHROME_LABEL: Record<ChromeName, string> = { paper: 'Light', quiet: 'Dark', neon: 'Neon' };
const NEXT_CHROME: Record<ChromeName, ChromeName> = { paper: 'quiet', quiet: 'neon', neon: 'paper' };

/**
 * The library's title: the mark and the name as a small brand line over a
 * large "Library", with Import and the theme as glass buttons beside it.
 * Practice, the tuner and chords moved to the tab bar in 1.8.
 */
export function LibraryTopBar({ totalCount }: { totalCount: number }) {
  const router = useRouter();
  const { chrome, setChrome } = useThemePreference();
  return (
    <TabHeader
      eyebrow={<BrandLine />}
      title="Library"
      subtitle={`${totalCount} pieces · ${APP_TAGLINE.toLowerCase()}`}
    >
      <GlassIconButton
        icon={CHROME_ICON[chrome]}
        accessibilityLabel={`Theme: ${CHROME_LABEL[chrome]}. Switch to ${CHROME_LABEL[NEXT_CHROME[chrome]]}.`}
        onPress={() => setChrome(NEXT_CHROME[chrome])}
      />
      <GlassIconButton icon="plus" prominent accessibilityLabel="Import music" onPress={() => router.push('/settings/import')} />
    </TabHeader>
  );
}

/** The app icon and the name, small, above the large title. */
function BrandLine() {
  const theme = useTheme();
  return (
    <Row gap={7}>
      <Image
        source={MARK}
        accessibilityIgnoresInvertColors
        style={{ width: theme.s(20), height: theme.s(20), borderRadius: theme.s(5) }}
      />
      <Label size={11} color={theme.chrome.ink}>{APP_NAME}</Label>
    </Row>
  );
}

type NavLink = { label: string; href: Href; icon: IconName };

const SHORTCUTS: readonly NavLink[] = [
  { label: 'Reading guide', href: '/tutorial', icon: 'guide' },
  { label: 'Fingerboard', href: '/chart', icon: 'chart' },
  { label: 'Scales', href: '/scales', icon: 'scales' },
  { label: 'My tapes', href: '/settings/tapes', icon: 'tapes' },
];

/** The reference pages, as a row of chips. Wide screens show the practice rail instead. */
export function LibraryShortcuts() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.s(8) }}>
      {SHORTCUTS.map((link) => (
        <Button key={link.label} label={link.label} icon={link.icon} onPress={() => router.push(link.href)} />
      ))}
    </ScrollView>
  );
}

type EmptyCopy = { title: string; body: string; action: string };

const EMPTY_IMPORTS: EmptyCopy = {
  title: 'Make room for your music',
  body: 'Import a MIDI file to add a cello part and accompaniment to your library.',
  action: 'Import a MIDI file',
};

const NO_MATCHES: EmptyCopy = {
  title: 'No pieces found',
  body: 'Try another title, artist or key, or clear your filters.',
  action: 'Clear filters',
};

export type LibraryEmptyStateProps = { noImportsYet: boolean; onClearFilters: () => void };

export function LibraryEmptyState({ noImportsYet, onClearFilters }: LibraryEmptyStateProps) {
  const theme = useTheme();
  const router = useRouter();
  const copy = noImportsYet ? EMPTY_IMPORTS : NO_MATCHES;
  const onAction = noImportsYet ? () => router.push('/settings/import') : onClearFilters;
  return (
    <Stack padX={20} padY={24} gap={12}>
      <Title size={22}>{copy.title}</Title>
      <Body size={14} color={theme.chrome.dim}>{copy.body}</Body>
      <Button label={copy.action} onPress={onAction} />
    </Stack>
  );
}
