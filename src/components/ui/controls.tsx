import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleProp, View, ViewStyle } from 'react-native';

import { useTheme, type Chrome } from '@theme';
import { Body, Num, Row, Title } from './primitives';

const PRESSED_OPACITY = 0.7;
const BUTTON_PRESSED_OPACITY = 0.75;
const DISABLED_OPACITY = 0.4;
const DISABLED_ROW_OPACITY = 0.55;
const ACCENT_INK_DARK = '#060913';
const ACCENT_INK_LIGHT = '#FFFFFF';

type ControlFeedback = {
  events: {
    onFocus: () => void;
    onBlur: () => void;
    onHoverIn: () => void;
    onHoverOut: () => void;
  };
  hovered: boolean;
  focusStyle: ViewStyle | undefined;
};

/** Shared pointer and keyboard feedback. The outline never changes layout. */
export function useControlFeedback(): ControlFeedback {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  return {
    events: {
      onFocus: () => setFocused(true), onBlur: () => setFocused(false),
      onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false),
    },
    hovered,
    focusStyle: focused ? {
      outlineStyle: 'solid', outlineWidth: 2, outlineOffset: -2,
      outlineColor: theme.chrome.accent,
    } : undefined,
  };
}

function pressOpacity(pressed: boolean, disabled: boolean, disabledOpacity: number, pressedOpacity: number): number {
  if (disabled) return disabledOpacity;
  return pressed ? pressedOpacity : 1;
}

export type ButtonTone = 'default' | 'accent' | 'ghost';

type ButtonColors = { ink: string; background: string; border: string; hint: string };

function buttonColors(tone: ButtonTone, chrome: Chrome, hovered: boolean): ButtonColors {
  if (tone === 'accent') {
    const ink = chrome.dark ? ACCENT_INK_DARK : ACCENT_INK_LIGHT;
    return { ink, background: chrome.accent, border: chrome.accent, hint: ink };
  }
  return {
    ink: chrome.ink,
    background: hovered ? chrome.surfaceElevated : chrome.surface,
    border: tone === 'ghost' ? 'transparent' : chrome.lineSoft,
    hint: chrome.dim,
  };
}

export type ButtonProps = {
  label: string;
  hint?: string;
  accessibilityLabel?: string;
  expanded?: boolean;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, hint, onPress, tone = 'default', disabled = false, style, accessibilityLabel, expanded }: ButtonProps) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  const colors = buttonColors(tone, theme.chrome, feedback.hovered);
  const accentFocusRing = tone === 'accent' && feedback.focusStyle
    ? { outlineColor: theme.chrome.bg, outlineOffset: -4 }
    : undefined;
  return (
    <Pressable {...feedback.events} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (hint ? `${label}. ${hint}` : label)}
      accessibilityState={{ disabled, expanded }} aria-disabled={disabled} aria-expanded={expanded}
      style={({ pressed }) => [{
        minHeight: theme.tap, justifyContent: 'center', borderRadius: theme.s(8),
        paddingHorizontal: theme.s(14), paddingVertical: theme.s(11),
        backgroundColor: colors.background,
        borderWidth: theme.rule(1), borderColor: colors.border,
        opacity: pressOpacity(pressed, disabled, DISABLED_OPACITY, BUTTON_PRESSED_OPACITY),
      }, style, feedback.focusStyle, accentFocusRing]}>
      <Row gap={10}>
        <Title size={15} color={colors.ink} style={{ flexShrink: 1 }}>{label}</Title>
        {hint === undefined ? null : <Body size={12} color={colors.hint} style={{ marginLeft: 'auto' }}>{hint}</Body>}
      </Row>
    </Pressable>
  );
}

export type ToggleProps = {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
};

function toggleTrackColor(value: boolean, chrome: Chrome): string {
  if (value) return chrome.accent;
  return chrome.dark ? 'rgba(248,250,252,0.18)' : 'rgba(15,23,42,0.16)';
}

export function Toggle({ label, hint, value, onChange }: ToggleProps) {
  const theme = useTheme();
  const { chrome } = theme;
  const feedback = useControlFeedback();
  return (
    <Pressable {...feedback.events} onPress={() => onChange(!value)} accessibilityRole="switch"
      accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: value }} aria-checked={value}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: theme.s(14), minHeight: theme.tap,
        paddingVertical: theme.s(6), borderRadius: theme.s(6), opacity: pressed ? PRESSED_OPACITY : 1,
      }, feedback.focusStyle]}>
      <View style={{ flex: 1 }}>
        <Title size={15}>{label}</Title>
        {hint === undefined ? null : <Body size={12} color={chrome.dim} style={{ marginTop: theme.s(3) }}>{hint}</Body>}
      </View>
      <View style={{ width: theme.s(44), height: theme.s(26), borderRadius: theme.s(13), backgroundColor: toggleTrackColor(value, chrome) }}>
        <View style={{
          position: 'absolute', top: theme.s(3), left: theme.s(value ? 21 : 3),
          width: theme.s(20), height: theme.s(20), borderRadius: theme.s(10),
          backgroundColor: '#FFFFFF',
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
        }} />
      </View>
    </Pressable>
  );
}

export type StepperProps = {
  label: string;
  value: number;
  display?: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement?: boolean;
  canIncrement?: boolean;
};

export function Stepper({ label, value, display, onDecrement, onIncrement, canDecrement = true, canIncrement = true }: StepperProps) {
  const theme = useTheme();
  const stepStyle: ViewStyle = { paddingHorizontal: 0, minWidth: theme.tap, alignItems: 'center' };
  return (
    <Row style={{ borderWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, borderRadius: theme.s(8), backgroundColor: theme.chrome.surface }}>
      <Button label="−" accessibilityLabel={`Decrease ${label}`} onPress={onDecrement} disabled={!canDecrement} tone="ghost" style={stepStyle} />
      <View accessibilityLabel={`${label}: ${display ?? value}`} style={{ minWidth: theme.s(62), alignItems: 'center' }}>
        <Num size={15}>{display ?? String(value)}</Num>
      </View>
      <Button label="+" accessibilityLabel={`Increase ${label}`} onPress={onIncrement} disabled={!canIncrement} tone="ghost" style={stepStyle} />
    </Row>
  );
}

export interface Segment<T extends string> { value: T; label: string; hint?: string }

const SEGMENT_NAVIGATION_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** Index a radio-group key press moves to, wrapping at both ends. */
export function segmentIndexAfterKey(index: number, key: string, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  return (index + step + count) % count;
}

export type SegmentedProps<T extends string> = {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  grow?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
};

export function Segmented<T extends string>({ segments, value, onChange, grow = false, compact = false, accessibilityLabel }: SegmentedProps<T>) {
  const theme = useTheme();
  const buttons = useRef<(View | null)[]>([]);
  const selectWithKeyboard = (index: number, key: string) => {
    const next = segmentIndexAfterKey(index, key, segments.length);
    onChange(segments[next].value);
    buttons.current[next]?.focus();
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', padding: theme.s(3), borderRadius: theme.s(9), backgroundColor: theme.chrome.surface, alignSelf: grow ? 'stretch' : 'flex-start' }}>
      {segments.map((segment, index) => <SegmentButton key={segment.value} segment={segment} selected={segment.value === value} onPress={() => onChange(segment.value)} grow={grow} compact={compact} setRef={(node) => { buttons.current[index] = node; }} onArrow={(key) => selectWithKeyboard(index, key)} />)}
    </View>
  );
}

type SegmentButtonProps<T extends string> = {
  segment: Segment<T>;
  selected: boolean;
  onPress: () => void;
  grow: boolean;
  compact: boolean;
  setRef: (node: View | null) => void;
  onArrow: (key: string) => void;
};

type KeyEvent = { key: string; preventDefault: () => void };

function webKeyboardProps(selected: boolean, onArrow: (key: string) => void) {
  if (Platform.OS !== 'web') return {};
  return {
    tabIndex: selected ? 0 as const : -1 as const,
    onKeyDown: (event: KeyEvent) => {
      if (!SEGMENT_NAVIGATION_KEYS.includes(event.key)) return;
      event.preventDefault();
      onArrow(event.key);
    },
  };
}

function segmentBackground(selected: boolean, hovered: boolean, chrome: Chrome): string {
  if (selected) return chrome.surfaceElevated;
  return hovered ? chrome.lineSoft : 'transparent';
}

function SegmentButton<T extends string>({ segment, selected, onPress, grow, compact, setRef, onArrow }: SegmentButtonProps<T>) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  return (
    <Pressable ref={setRef} {...feedback.events} onPress={onPress} accessibilityRole="radio"
      {...webKeyboardProps(selected, onArrow)}
      accessibilityLabel={segment.label} accessibilityHint={segment.hint} accessibilityState={{ checked: selected }} aria-checked={selected}
      style={({ pressed }) => [{
        flex: grow ? 1 : undefined, minWidth: 0, minHeight: theme.tap,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.s(compact ? 7 : 11),
        borderRadius: theme.s(6), backgroundColor: segmentBackground(selected, feedback.hovered, theme.chrome),
        borderWidth: theme.rule(1), borderColor: selected ? theme.chrome.lineSoft : 'transparent', opacity: pressed ? PRESSED_OPACITY : 1,
      }, feedback.focusStyle]}>
      <Title size={compact ? 12 : 13} color={selected ? theme.chrome.ink : theme.chrome.dim} style={{ textAlign: 'center' }}>{segment.label}</Title>
    </Pressable>
  );
}

export type PressableRowProps = {
  onPress?: () => void;
  accessibilityLabel: string;
  selected?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PressableRow({ onPress, accessibilityLabel, selected, disabled = false, children, style }: PressableRowProps) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  const inert = disabled || !onPress;
  return (
    <Pressable {...feedback.events} onPress={onPress} disabled={inert} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled: inert }} aria-pressed={selected} aria-disabled={inert}
      style={({ pressed }) => [{
        minHeight: theme.tap,
        backgroundColor: selected || feedback.hovered ? theme.chrome.surface : 'transparent',
        opacity: pressOpacity(pressed, disabled, DISABLED_ROW_OPACITY, PRESSED_OPACITY),
      }, style, feedback.focusStyle]}>
      {children}
    </Pressable>
  );
}

export type DisclosureProps = { title: string; summary?: string; children: React.ReactNode };

/** Keep optional setup choices out of the path to starting a practice session. */
export function Disclosure({ title, summary, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const feedback = useControlFeedback();
  return (
    <View style={{ borderTopWidth: theme.rule(1), borderColor: theme.chrome.lineSoft }}>
      <Pressable {...feedback.events} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} aria-expanded={open}
        style={[{ minHeight: theme.tap, paddingVertical: theme.s(14), flexDirection: 'row', alignItems: 'center', gap: theme.s(12) }, feedback.focusStyle]}>
        <View style={{ flex: 1 }}><Title size={15}>{title}</Title>{summary ? <Body size={12} color={theme.chrome.dim} style={{ marginTop: theme.s(3) }}>{summary}</Body> : null}</View>
        <Title size={18} color={theme.chrome.dim}>{open ? '−' : '+'}</Title>
      </Pressable>
      {open ? <View style={{ gap: theme.s(12), paddingBottom: theme.s(18) }}>{children}</View> : null}
    </View>
  );
}
