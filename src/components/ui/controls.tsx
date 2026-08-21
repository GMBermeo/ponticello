import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleProp, View, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Label, Num, Row, Title } from './primitives';

/**
 * Controls sized for one-handed use with a bow in the other hand: nothing
 * interactive is smaller than the theme's clamped 44 dp target, even where the
 * visual mark is smaller than that.
 */

// ─── Button ──────────────────────────────────────────────────────────────────

export function Button({
  label, hint, onPress, tone = 'default', disabled = false, style,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  tone?: 'default' | 'accent' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { chrome } = theme;

  const box = useMemo<ViewStyle>(() => ({
    minHeight: theme.tap,
    justifyContent: 'center',
    paddingHorizontal: theme.s(16),
    paddingVertical: theme.s(12),
    backgroundColor: tone === 'accent' ? chrome.accent : 'transparent',
    borderWidth: tone === 'ghost' ? 0 : theme.rule(1),
    borderColor: tone === 'accent' ? chrome.accent : chrome.line,
    opacity: disabled ? 0.4 : 1,
  }), [theme, chrome, tone, disabled]);

  const labelColor = tone === 'accent' ? chrome.bg : chrome.ink;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [box, pressed ? PRESSED : null, style]}
    >
      <Row gap={10}>
        <Title size={16} color={labelColor}>{label}</Title>
        {hint === undefined ? null : (
          <Label size={10} color={tone === 'accent' ? chrome.bg : chrome.dim} style={{ marginLeft: 'auto' }}>
            {hint}
          </Label>
        )}
      </Row>
    </Pressable>
  );
}

const PRESSED: ViewStyle = { opacity: 0.62 };

// ─── Toggle ──────────────────────────────────────────────────────────────────

export function Toggle({
  label, hint, value, onChange,
}: { label: string; hint?: string; value: boolean; onChange: (next: boolean) => void }) {
  const theme = useTheme();
  const { chrome } = theme;
  const handlePress = useCallback(() => onChange(!value), [onChange, value]);

  const track = useMemo<ViewStyle>(() => ({
    width: theme.s(46),
    height: theme.s(26),
    borderWidth: theme.rule(1),
    borderColor: value ? chrome.accent : chrome.line,
    backgroundColor: value ? chrome.accentWash : 'transparent',
    justifyContent: 'center',
  }), [theme, chrome, value]);

  const knob = useMemo<ViewStyle>(() => ({
    position: 'absolute',
    left: theme.s(value ? 25 : 3),
    width: theme.s(18),
    height: theme.s(18),
    backgroundColor: value ? chrome.accent : chrome.line,
  }), [theme, chrome, value]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: theme.s(12), minHeight: theme.tap },
        pressed ? PRESSED : null,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Title size={15}>{label}</Title>
        {hint === undefined ? null : <Label size={10}>{hint}</Label>}
      </View>
      <View style={track}><View style={knob} /></View>
    </Pressable>
  );
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

export function Stepper({
  label, value, display, onDecrement, onIncrement, canDecrement = true, canIncrement = true,
}: {
  label: string;
  value: number;
  display?: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement?: boolean;
  canIncrement?: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;

  const button = useMemo<ViewStyle>(() => ({
    minWidth: theme.tap,
    minHeight: theme.tap,
    alignItems: 'center',
    justifyContent: 'center',
  }), [theme]);

  const frame = useMemo<ViewStyle>(() => ({
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: theme.rule(1),
    borderColor: chrome.line,
  }), [theme, chrome]);

  return (
    <View style={frame}>
      <Pressable
        onPress={canDecrement ? onDecrement : undefined}
        disabled={!canDecrement}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        style={({ pressed }) => [button, { opacity: canDecrement ? (pressed ? 0.6 : 1) : 0.3 }]}
      >
        <Title size={20}>–</Title>
      </Pressable>
      <View
        style={{
          minWidth: theme.s(58),
          alignItems: 'center',
          paddingHorizontal: theme.s(6),
          borderLeftWidth: theme.rule(1),
          borderRightWidth: theme.rule(1),
          borderColor: chrome.lineSoft,
        }}
        accessibilityLabel={`${label}: ${display ?? value}`}
      >
        <Num size={15}>{display ?? String(value)}</Num>
      </View>
      <Pressable
        onPress={canIncrement ? onIncrement : undefined}
        disabled={!canIncrement}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        style={({ pressed }) => [button, { opacity: canIncrement ? (pressed ? 0.6 : 1) : 0.3 }]}
      >
        <Title size={20}>+</Title>
      </Pressable>
    </View>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────────

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Spoken label, when the visible one is an abbreviation. */
  hint?: string;
}

export function Segmented<T extends string>({
  segments, value, onChange, grow = false, compact = false,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  grow?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        borderWidth: theme.rule(1),
        borderColor: chrome.line,
        alignSelf: grow ? 'stretch' : 'flex-start',
        flex: grow ? 1 : undefined,
      }}
    >
      {segments.map((segment, index) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            accessibilityRole="tab"
            accessibilityLabel={segment.hint ?? segment.label}
            accessibilityState={{ selected }}
            style={({ pressed }) => [{
              flex: grow ? 1 : undefined,
              minHeight: compact ? theme.s(36) : theme.tap,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.s(compact ? 10 : 16),
              backgroundColor: selected ? chrome.accent : 'transparent',
              borderLeftWidth: index === 0 ? 0 : theme.rule(1),
              borderColor: chrome.lineSoft,
              opacity: pressed ? 0.7 : 1,
            }]}
          >
            <Label size={11} color={selected ? chrome.bg : chrome.dim}>{segment.label}</Label>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Pressable row ───────────────────────────────────────────────────────────

export function PressableRow({
  onPress, accessibilityLabel, selected = false, disabled = false, children, style,
}: {
  onPress?: () => void;
  accessibilityLabel: string;
  selected?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        {
          minHeight: theme.tap,
          backgroundColor: selected ? theme.chrome.surface : 'transparent',
          opacity: disabled ? 0.55 : 1,
        },
        pressed && !disabled ? PRESSED : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
