import { useMemo } from 'react';
import { StyleProp, Text, TextProps, TextStyle, View, ViewProps, ViewStyle } from 'react-native';

import {
  bodyStyle, labelStyle, labelTracking, numberStyle, titleStyle, useTheme,
} from '@/theme/ThemeProvider';
import { FONT } from '@/theme/tokens';

/**
 * Shared text, spacing, and musical cues for the matte practice interface. Every size arrives in design units and is converted through the
 * theme, so a component never needs to know what device it is on.
 */

// ─── Text ────────────────────────────────────────────────────────────────────

interface TypeProps extends TextProps {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/** The uppercase tracked micro-label that heads every section. */
export function Label({ size = 12, color, style, children, ...rest }: TypeProps) {
  const theme = useTheme();
  const base = useMemo(() => {
    const fontSize = theme.font(size);
    return { ...labelStyle(theme, color), fontSize, letterSpacing: labelTracking(fontSize) };
  }, [theme, color, size]);
  return <Text {...rest} style={[base, style]}>{children}</Text>;
}

export function Title({ size = 24, color, style, children, ...rest }: TypeProps) {
  const theme = useTheme();
  const base = useMemo(() => titleStyle(theme, size, color), [theme, size, color]);
  return <Text {...rest} style={[base, style]}>{children}</Text>;
}

export function Body({ size = 16, color, style, children, ...rest }: TypeProps) {
  const theme = useTheme();
  const base = useMemo(() => bodyStyle(theme, size, color), [theme, size, color]);
  return <Text {...rest} style={[base, style]}>{children}</Text>;
}

/** Tabular figures, so a changing number does not shuffle the layout. */
export function Num({ size = 16, color, style, children, ...rest }: TypeProps) {
  const theme = useTheme();
  const base = useMemo(() => numberStyle(theme, size, color), [theme, size, color]);
  return <Text {...rest} style={[base, style]}>{children}</Text>;
}

/** Small caps accent line — used for a piece's origin and section kickers. */
export function Kicker({ size = 11, color, style, children, ...rest }: TypeProps) {
  const theme = useTheme();
  const base = useMemo<TextStyle>(() => {
    const fontSize = theme.font(size);
    return {
      fontFamily: FONT.semibold,
      fontSize,
      letterSpacing: labelTracking(fontSize),
      textTransform: 'uppercase',
      color: color ?? theme.chrome.accent,
    };
  }, [theme, size, color]);
  return <Text {...rest} style={[base, style]}>{children}</Text>;
}

// ─── Structure ───────────────────────────────────────────────────────────────

/** A horizontal rule. `weight` 2 divides regions, 1 separates rows. */
export function Rule({
  weight = 1, color, style, vertical = false,
}: { weight?: number; color?: string; style?: StyleProp<ViewStyle>; vertical?: boolean }) {
  const theme = useTheme();
  const thickness = theme.rule(weight);
  const background = color ?? (weight >= 2 ? theme.chrome.line : theme.chrome.lineSoft);
  return (
    <View
      style={[
        vertical
          ? { width: thickness, alignSelf: 'stretch', backgroundColor: background }
          : { height: thickness, alignSelf: 'stretch', backgroundColor: background },
        style,
      ]}
    />
  );
}

interface StackProps extends ViewProps {
  gap?: number;
  pad?: number;
  padX?: number;
  padY?: number;
  style?: StyleProp<ViewStyle>;
}

export function Row({ gap = 0, pad, padX, padY, style, children, ...rest }: StackProps) {
  const theme = useTheme();
  const base = useMemo<ViewStyle>(() => ({
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.s(gap),
    padding: pad === undefined ? undefined : theme.s(pad),
    paddingHorizontal: padX === undefined ? undefined : theme.s(padX),
    paddingVertical: padY === undefined ? undefined : theme.s(padY),
  }), [theme, gap, pad, padX, padY]);
  return <View {...rest} style={[base, style]}>{children}</View>;
}

export function Stack({ gap = 0, pad, padX, padY, style, children, ...rest }: StackProps) {
  const theme = useTheme();
  const base = useMemo<ViewStyle>(() => ({
    flexDirection: 'column',
    gap: theme.s(gap),
    padding: pad === undefined ? undefined : theme.s(pad),
    paddingHorizontal: padX === undefined ? undefined : theme.s(padX),
    paddingVertical: padY === undefined ? undefined : theme.s(padY),
  }), [theme, gap, pad, padX, padY]);
  return <View {...rest} style={[base, style]}>{children}</View>;
}

export function Spacer({ size = 1 }: { size?: number }) {
  const theme = useTheme();
  return <View style={{ height: theme.s(size), width: theme.s(size) }} />;
}

export function Grow() {
  return <View style={GROW} />;
}

const GROW: ViewStyle = { flex: 1 };

// ─── Badges ──────────────────────────────────────────────────────────────────

/** A square-cornered tag — difficulty, string name, position bracket. */
export function Badge({
  label, background, color, style,
}: { label: string; background?: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const box = useMemo<ViewStyle>(() => ({
    paddingHorizontal: theme.s(7),
    paddingVertical: theme.s(3),
    backgroundColor: background ?? theme.chrome.ink,
  }), [theme, background]);
  return (
    <View style={[box, style]}>
      <Label size={10} color={color ?? theme.chrome.bg}>{label}</Label>
    </View>
  );
}

/** A small square in a string's colour, used wherever a string is named. */
export function StringSwatch({ color, height = 16, width = 5 }: {
  color: string; height?: number; width?: number;
}) {
  const theme = useTheme();
  return (
    <View style={{ width: theme.s(width), height: theme.s(height), backgroundColor: color }} />
  );
}

/** A colour chip that stands for a physical fingerboard tape. */
export function TapeChip({
  color, label, width = 34, height = 12,
}: { color: string; label?: string; width?: number; height?: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: theme.s(3) }}>
      <View style={{ width: theme.s(width), height: theme.s(height), backgroundColor: color }} />
      {label === undefined ? null : <Label size={10}>{label}</Label>}
    </View>
  );
}
