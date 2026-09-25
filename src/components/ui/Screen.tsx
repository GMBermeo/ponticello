import { useRouter } from 'expo-router';
import React, { createContext, useContext } from 'react';
import { Platform, Pressable, ScrollView, StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@theme';
import { Glass } from './Glass';
import { Icon } from './Icon';
import { Body, Title } from './primitives';

/**
 * True inside a `Screen`. A screen nested in another — a scrolling body under
 * a fixed header, a side rail — must not add the safe-area insets again, or
 * on the iPhone Duo, whose tab rail is a right-hand inset, the content loses
 * that width twice.
 */
const InsideScreen = createContext(false);

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
  const nested = useContext(InsideScreen);
  const safe = useSafeAreaInsets();
  const insets = nested ? { left: 0, right: 0, bottom: 0 } : safe;

  const frame: ViewStyle = {
    flex: 1,
    backgroundColor: nested ? undefined : theme.chrome.bg,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };

  const body: StyleProp<ViewStyle> = [
    padded ? { paddingHorizontal: theme.s(16) } : null,
    { paddingBottom: insets.bottom + (scroll ? theme.s(28) : 0) },
    contentStyle,
  ];

  if (!scroll) {
    return (
      <InsideScreen.Provider value>
        <View style={frame}><View style={[{ flex: 1 }, body]}>{children}</View></View>
      </InsideScreen.Provider>
    );
  }

  return (
    <InsideScreen.Provider value>
      <View style={frame}>
        <ScrollView
          contentContainerStyle={body}
          // Long practice sheets read better without bounce fighting the thumb.
          showsVerticalScrollIndicator
        >
          {children}
        </ScrollView>
      </View>
    </InsideScreen.Provider>
  );
}

/**
 * The navigation bar: a Liquid Glass back button, the screen's name as an
 * inline title, and any trailing actions. No rule underneath — content scrolls
 * up to the bar, as it does in the system apps.
 *
 * `meta` is the title. `backLabel` names where the button goes, for the
 * accessibility label; visually the button is the chevron alone, as on iOS.
 * Screens that are tabs pass no `backLabel` and get no button.
 */
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
  const size = theme.tap;

  return (
    <View style={{ paddingTop: insets.top + theme.s(4), paddingBottom: theme.s(6), backgroundColor: theme.chrome.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.s(10),
          paddingHorizontal: theme.s(16),
          minHeight: size,
        }}
      >
        {backLabel === undefined ? null : (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}`}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Glass interactive style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={18} color={theme.chrome.ink} />
            </Glass>
          </Pressable>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {meta === undefined ? null : (
            <Title accessibilityRole="header" size={17} numberOfLines={1}>{meta}</Title>
          )}
        </View>
        {children}
      </View>
    </View>
  );
}

/** On the web the tab bar is a pill floating over the top of the page. */
const WEB_TAB_BAR = 64;

/**
 * The header of a tab: an iOS large title with an optional line under it and
 * trailing actions beside it. Tabs have nowhere to go back to, so no button.
 */
export function TabHeader({
  title, subtitle, eyebrow, children,
}: {
  title: string;
  subtitle?: string;
  /** A small line above the title — the library puts the brand here. */
  eyebrow?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + theme.s(Platform.OS === 'web' ? WEB_TAB_BAR : 10), paddingHorizontal: theme.s(20), paddingBottom: theme.s(10), gap: theme.s(4) }}>
      {eyebrow}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.s(10), minHeight: theme.tap }}>
        <Title accessibilityRole="header" size={34} style={{ flex: 1 }} numberOfLines={1}>{title}</Title>
        {children}
      </View>
      {subtitle === undefined ? null : <Body size={15} color={theme.chrome.dim}>{subtitle}</Body>}
    </View>
  );
}
