import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@theme';

/**
 * The four places a player goes back to: the system tab bar, which is Liquid
 * Glass on iOS 26+ and a Material bar on Android. Everything a tab opens —
 * a piece, its setup, the play screen — is pushed over it by the root stack,
 * so the bar never sits on top of the music.
 */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <NativeTabs
      tintColor={theme.chrome.accent}
      minimizeBehavior="onScrollDown"
      labelStyle={{ color: theme.chrome.dim }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'music.note.list', selected: 'music.note.list' }} md="library_music" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} md="calendar_month" />
        <NativeTabs.Trigger.Label>Practice</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tuner">
        <NativeTabs.Trigger.Icon sf={{ default: 'tuningfork', selected: 'tuningfork' }} md="tune" />
        <NativeTabs.Trigger.Label>Tuner</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chords">
        <NativeTabs.Trigger.Icon sf={{ default: 'pianokeys', selected: 'pianokeys.inverse' }} md="piano" />
        <NativeTabs.Trigger.Label>Chords</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
