import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { Grow, Label, Rule } from './primitives';

/**
 * Screen scaffold: chrome background, safe-area padding, and the design's
 * standard header — a back affordance on the left, a quiet meta line on the
 * right, and a quiet separator above the body.
 */
export function Screen({
  children, scroll = true, contentStyle, padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const frame: ViewStyle = {
    flex: 1,
    backgroundColor: theme.chrome.bg,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const body: StyleProp<ViewStyle> = [
    padded ? { paddingHorizontal: theme.s(22) } : null,
    { paddingBottom: insets.bottom + (scroll ? theme.s(28) : 0) },
    contentStyle,
  ];

  if (!scroll) {
    return <View style={frame}><View style={[{ flex: 1 }, body]}>{children}</View></View>;
  }

  return (
    <View style={frame}>
      <ScrollView
        contentContainerStyle={body}
        // Long practice sheets read better without bounce fighting the thumb.
        showsVerticalScrollIndicator
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function ScreenHeader({
  backLabel, onBack, meta, children,
}: {
  backLabel?: string;
  onBack?: () => void;
  meta?: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleBack = onBack ?? (() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  });

  return (
    <View style={{ paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.s(12),
          paddingHorizontal: theme.s(12),
          minHeight: theme.tap,
        }}
      >
        {backLabel === undefined ? null : (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            style={({ pressed }) => [{
              minHeight: theme.tap,
              justifyContent: 'center',
              paddingHorizontal: theme.s(10),
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <Label size={14} style={{ textTransform: 'none', letterSpacing: 0 }} color={theme.chrome.ink}>{`← ${backLabel}`}</Label>
          </Pressable>
        )}
        {children}
        <Grow />
        {meta === undefined ? null : <Label size={11}>{meta}</Label>}
        <View style={{ width: theme.s(10) }} />
      </View>
      <Rule />
    </View>
  );
}
