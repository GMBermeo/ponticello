import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CANVAS, FOLD5_PX, ViewportContext, FACE, PAPER, useTheme } from '@theme';

export type WebPreviewMode = 'fullscreen' | 'fold5';

const STORAGE_KEY = 'ponticello:web_preview_mode';

function getInitialWebMode(): WebPreviewMode {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'fullscreen';
  try {
    const params = new URLSearchParams(window.location.search);
    const paramMode = params.get('preview');
    if (paramMode === 'fold5' || paramMode === 'fullscreen') {
      return paramMode;
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'fold5' || saved === 'fullscreen') {
      return saved;
    }
  } catch {
    // Ignore storage/URL access errors in restricted contexts
  }
  return 'fullscreen';
}

/**
 * Responsive container for web and native.
 *
 * On native devices the app always fills the screen. On desktop web:
 * - Full Screen mode (default): Adapts edge-to-edge across the browser window,
 *   scaling and reflowing through the resolution engine (`scale.ts`).
 * - Fold 5 preview mode: Constrains the canvas to 829 × 690 units (the Galaxy Z
 *   Fold 5 inner display) with pixel-exact 1.0 scaling, transform-fitted
 *   inside a letterboxed preview frame.
 *
 * Switch between modes anytime via the floating control pill or by pressing 'f'.
 */
export function DeviceCanvas({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<WebPreviewMode>(getInitialWebMode);

  const frame = useMemo(() => {
    const margin = 40;
    const fit = Math.min(
      (width - margin * 2) / CANVAS.width,
      (height - margin * 2) / CANVAS.height,
    );
    return { fit };
  }, [width, height]);

  const fold5Viewport = useMemo(
    () => ({ width: CANVAS.width, height: CANVAS.height }),
    [],
  );

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: WebPreviewMode = prev === 'fullscreen' ? 'fold5' : 'fullscreen';
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, []);

  const toggleNativeFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Ignore fullscreen API errors
    }
  }, []);

  // Keyboard shortcut: Press 'f' (when not focused in a text input) to toggle modes
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const target = e.target as HTMLElement | null;
        const tagName = target?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
          return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode]);

  if (Platform.OS !== 'web') return <>{children}</>;

  // Small windows on web fall through untouched: the window is already phone-sized
  const canPreviewFold5 = width >= 900 && height >= 560;

  const pillThemeStyle = {
    backgroundColor: theme.chrome.dark ? 'rgba(29, 45, 92, 0.94)' : 'rgba(255, 255, 255, 0.94)',
    borderColor: theme.chrome.line,
  };
  const pillTextStyle = { color: theme.chrome.ink };
  const pillHintStyle = { color: theme.chrome.dim, backgroundColor: theme.chrome.surface };

  if (!canPreviewFold5 || mode === 'fullscreen') {
    return (
      <View style={[styles.fullScreenContainer, { backgroundColor: theme.chrome.bg }]}>
        <ViewportContext.Provider value={null}>
          {children}
        </ViewportContext.Provider>
        {canPreviewFold5 && (
          <View style={styles.floatingControls}>
            <Pressable
              onPress={toggleMode}
              accessibilityRole="button"
              accessibilityLabel="Switch to Galaxy Z Fold 5 preview frame (Hotkey: F)"
              style={({ pressed }) => [
                styles.pillButton,
                pillThemeStyle,
                pressed && styles.pillButtonPressed,
              ]}
            >
              <Text style={styles.pillIcon}>📱</Text>
              <Text style={[styles.pillText, pillTextStyle]}>Fold 5 frame</Text>
              <Text style={[styles.pillHint, pillHintStyle]}>F</Text>
            </Pressable>
            <Pressable
              onPress={toggleNativeFullscreen}
              accessibilityRole="button"
              accessibilityLabel="Toggle browser full screen"
              style={({ pressed }) => [
                styles.pillButtonSquare,
                pillThemeStyle,
                pressed && styles.pillButtonPressed,
              ]}
            >
              <Text style={styles.pillIcon}>⛶</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.fold5Outer, { backgroundColor: theme.chrome.dark ? '#0c101c' : '#e4e6df' }]}>
      <View style={styles.fold5HeaderControls}>
        <Pressable
          onPress={toggleMode}
          accessibilityRole="button"
          accessibilityLabel="Switch to web full screen mode (Hotkey: F)"
          style={({ pressed }) => [
            styles.pillButtonAccent,
            pressed && styles.pillButtonPressed,
          ]}
        >
          <Text style={styles.pillIcon}>⛶</Text>
          <Text style={styles.pillTextAccent}>Full screen</Text>
          <Text style={styles.pillHintAccent}>F</Text>
        </Pressable>
      </View>
      <View
        accessibilityLabel={`Galaxy Z Fold 5 inner display preview, ${FOLD5_PX.width} by ${FOLD5_PX.height} pixels`}
        style={[
          styles.fold5Frame,
          {
            width: CANVAS.width,
            height: CANVAS.height,
            borderWidth: 1 / frame.fit,
            borderColor: theme.chrome.line,
            transform: [{ scale: frame.fit }],
          },
        ]}
      >
        <ViewportContext.Provider value={fold5Viewport}>
          {children}
        </ViewportContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: PAPER,
  },
  floatingControls: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 9999,
  },
  pillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderColor: '#c5ccc3',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pillButtonSquare: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderColor: '#c5ccc3',
    borderWidth: 1,
    borderRadius: 20,
    width: 30,
    height: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pillButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.97 }],
  },
  pillIcon: {
    fontSize: 12,
  },
  pillText: {
    ...FACE.semibold,
    fontSize: 11,
    color: '#2b302a',
    letterSpacing: 0.1,
  },
  pillHint: {
    ...FACE.regular,
    fontSize: 10,
    color: '#70776d',
    backgroundColor: '#ebede8',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fold5Outer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e4e6df',
  },
  fold5HeaderControls: {
    position: 'absolute',
    top: 16,
    right: 20,
    zIndex: 9999,
  },
  pillButtonAccent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1f251e',
    borderColor: '#1f251e',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4,
  },
  pillTextAccent: {
    ...FACE.semibold,
    fontSize: 12,
    color: '#ffffff',
    letterSpacing: 0.2,
  },
  pillHintAccent: {
    ...FACE.regular,
    fontSize: 10,
    color: '#b0b8ac',
    backgroundColor: '#2f372e',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fold5Frame: {
    backgroundColor: PAPER,
    overflow: 'hidden',
    borderColor: '#c5ccc3',
    borderRadius: 12,
  },
});

