import {
  Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold, useFonts,
} from '@expo-google-fonts/archivo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Appearance, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeviceCanvas } from '@components';
import {
  ImportedLibraryProvider, PracticeProvider, SessionProvider, SettingsProvider,
  useSettingsSelector,
} from '@state';
import { ThemeProvider, useTheme } from '@theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedRootView() {
  const theme = useTheme();
  const dark = theme.chrome.dark;
  // The chrome is the app's own setting, not the phone's, so tell the system:
  // the native tab bar and every Liquid Glass surface take their appearance
  // from it.
  useEffect(() => {
    // Native only — react-native-web's Appearance cannot be overridden.
    if (Platform.OS !== 'web') Appearance.setColorScheme(dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.chrome.bg }}>
      <StatusBar style={theme.chrome.dark ? 'light' : 'dark'} />
      <DeviceCanvas>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.chrome.bg },
            animation: 'default',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="play/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack>
      </DeviceCanvas>
    </GestureHandlerRootView>
  );
}

function ThemedAppShell() {
  const chrome = useSettingsSelector((s) => s.chrome);
  return (
    <ThemeProvider chrome={chrome}>
      <ThemedRootView />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Archivo is the interface face on Android and the web (iOS uses SF — see
  // `theme/faces.ts`) and the brand face everywhere, so nothing renders until
  // it has loaded.
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_600SemiBold,
    Archivo_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <PracticeProvider>
        <SessionProvider>
          <ImportedLibraryProvider>
            <ThemedAppShell />
          </ImportedLibraryProvider>
        </SessionProvider>
        </PracticeProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
