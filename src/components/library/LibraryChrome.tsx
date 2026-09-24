import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemePreference } from '@state';
import { APP_NAME, useTheme, type ChromeName } from '@theme';

import { Body, Button, Row, Stack, Title } from '../ui';

const CHROME_LABEL: Record<ChromeName, string> = { paper: '☀ Light', quiet: '☾ Dark', neon: '✦ Neon' };
const NEXT_CHROME: Record<ChromeName, ChromeName> = { paper: 'quiet', quiet: 'neon', neon: 'paper' };

type NavLink = { label: string; href: Href; tone?: 'ghost' };

const TOP_BAR_LINKS: readonly NavLink[] = [
  { label: 'Practice', href: '/profile', tone: 'ghost' },
  { label: 'Tuner', href: '/tuner', tone: 'ghost' },
  { label: 'Chords', href: '/chords', tone: 'ghost' },
  { label: 'Import', href: '/settings/import' },
];

/** App name, the main destinations and the theme switch. */
export function LibraryTopBar({ wide }: { wide: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chrome, setChrome } = useThemePreference();
  return (
    <Row
      padX={24}
      gap={12}
      style={{
        paddingTop: insets.top + theme.s(8),
        paddingBottom: theme.s(8),
        flexWrap: 'wrap',
        minHeight: theme.s(76) + insets.top,
        borderBottomWidth: theme.rule(1),
        borderColor: theme.chrome.lineSoft,
      }}
    >
      <View style={{ flex: 1, ...(wide ? {} : { flexBasis: '100%' }) }}>
        <Title size={22}>{APP_NAME}</Title>
      </View>
      {TOP_BAR_LINKS.map((link) => (
        <Button key={link.label} label={link.label} tone={link.tone} onPress={() => router.push(link.href)} />
      ))}
      <Button
        label={CHROME_LABEL[chrome]}
        accessibilityLabel={`Theme: ${chrome}. Tap to switch theme.`}
        tone="ghost"
        onPress={() => setChrome(NEXT_CHROME[chrome])}
      />
    </Row>
  );
}

const BOTTOM_BAR_LINKS: readonly NavLink[] = [
  { label: 'Reading guide', href: '/tutorial' },
  { label: 'Chart', href: '/chart' },
  { label: 'Scales', href: '/scales' },
];

/** Narrow screens have no practice rail; its reference links move here. */
export function LibraryBottomBar() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Row padX={16} style={{ borderTopWidth: theme.rule(1), borderColor: theme.chrome.lineSoft }}>
      {BOTTOM_BAR_LINKS.map((link) => (
        <Button key={link.label} label={link.label} tone="ghost" onPress={() => router.push(link.href)} />
      ))}
      <View style={{ marginLeft: 'auto' }}>
        <Button label="My tapes" tone="ghost" onPress={() => router.push('/settings/tapes')} />
      </View>
    </Row>
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
    <Stack pad={24} gap={12}>
      <Title size={22}>{copy.title}</Title>
      <Body size={14} color={theme.chrome.dim}>{copy.body}</Body>
      <Button label={copy.action} onPress={onAction} />
    </Stack>
  );
}
