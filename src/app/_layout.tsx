import {
  Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold, useFonts,
} from '@expo-google-fonts/archivo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeviceCanvas } from '@/components/DeviceCanvas';
import { ImportedLibraryProvider } from '@/state/library';
import { PracticeProvider } from '@/state/practice';
import { SessionProvider } from '@/state/session';
import { SettingsProvider, useSettingsSelector } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedRootView() {
  const theme = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.chrome.bg }}>
      <StatusBar style={theme.chrome.dark ? 'light' : 'dark'} />
      <DeviceCanvas>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.chrome.bg },
            animation: 'fade',
          }}
        />
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
  // Archivo carries the entire interface — weight and tracking do the work a
  // second typeface usually would — so nothing renders until it has loaded.
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
