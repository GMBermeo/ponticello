import {
  Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold, useFonts,
} from '@expo-google-fonts/archivo';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeviceCanvas } from '@/components/DeviceCanvas';
import { SessionProvider } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { PAPER } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: PAPER }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <SessionProvider>
            <DeviceCanvas>
              <ThemeProvider chrome="paper">
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: PAPER },
                    animation: 'fade',
                  }}
                />
              </ThemeProvider>
            </DeviceCanvas>
          </SessionProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
