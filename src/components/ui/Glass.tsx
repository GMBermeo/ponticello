import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type React from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';

import { useTheme } from '@theme';

import { Icon, type IconName } from './Icon';

const LIQUID_GLASS = isLiquidGlassAvailable();

export type GlassProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Responds to touch with the system's glass press effect. */
  interactive?: boolean;
  /** Tints the glass — used for a primary action floating over content. */
  tint?: string;
};

/**
 * A floating surface: Liquid Glass on iOS 26 and later, and an opaque
 * elevated card with a hairline everywhere else, so a control that floats over
 * the score stays legible on Android and in a browser.
 *
 * Glass is for chrome that floats over content — the back button, the play
 * transport, the library's toolbar. Content itself sits on plain cards.
 */
export function Glass({ children, style, interactive = false, tint }: GlassProps) {
  const theme = useTheme();
  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint}
        colorScheme={theme.chrome.dark ? 'dark' : 'light'}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  const fallback: ViewStyle = {
    backgroundColor: tint ?? theme.chrome.surfaceElevated,
    borderWidth: theme.rule(1),
    borderColor: theme.chrome.lineSoft,
    boxShadow: `0 ${theme.s(4)}px ${theme.s(18)}px rgba(0, 0, 0, ${theme.chrome.dark ? 0.4 : 0.1})`,
  };
  return <View style={[fallback, style]}>{children}</View>;
}

export type GlassIconButtonProps = {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  /** Filled with the accent, for the one primary action in a bar. */
  prominent?: boolean;
};

/** A round Liquid Glass button carrying one symbol, as in the system toolbars. */
export function GlassIconButton({ icon, accessibilityLabel, onPress, prominent = false }: GlassIconButtonProps) {
  const theme = useTheme();
  const size = theme.tap;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Glass
        interactive
        tint={prominent ? theme.chrome.accent : undefined}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={icon} size={17} color={prominent ? theme.chrome.onAccent : theme.chrome.ink} />
      </Glass>
    </Pressable>
  );
}
