import Constants from 'expo-constants';
import { Linking, Pressable } from 'react-native';

import { APP_AUTHOR, APP_AUTHOR_URL, APP_NAME, APP_REPOSITORY_URL, useTheme } from '@theme';

import { Body, Label, Stack } from '../ui';

function Link({ label, url, accessibilityLabel }: { label: string; url: string; accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel} hitSlop={8}
      onPress={() => void Linking.openURL(url)}>
      <Body size={12} color={theme.chrome.accent} style={{ textDecorationLine: 'underline' }}>{label}</Body>
    </Pressable>
  );
}

/** Version, author and source, at the foot of the library. */
export function AppCredits() {
  const theme = useTheme();
  const version = Constants.expoConfig?.version ?? '';
  return (
    <Stack padX={24} padY={20} gap={6} style={{ alignItems: 'center' }}>
      <Label size={10}>{`${APP_NAME} ${version}`.trim()}</Label>
      <Body size={12} color={theme.chrome.dim} style={{ textAlign: 'center' }}>
        {`App development by ${APP_AUTHOR}`}
      </Body>
      <Link label="gm.bermeo.dev" url={APP_AUTHOR_URL} accessibilityLabel={`Open ${APP_AUTHOR}'s website`} />
      <Link label="Open source on GitHub" url={APP_REPOSITORY_URL} accessibilityLabel={`Open the ${APP_NAME} source code on GitHub`} />
    </Stack>
  );
}
