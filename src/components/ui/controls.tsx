import React, { useRef, useState } from 'react';
import { Platform, Pressable, StyleProp, View, ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { Body, Num, Row, Title } from './primitives';

/** Shared pointer and keyboard feedback. The outline never changes layout. */
export function useControlFeedback() {
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
    } as ViewStyle : undefined,
  };
}

export function Button({ label, hint, onPress, tone = 'default', disabled = false, style, accessibilityLabel, expanded }: {
  label: string; hint?: string; accessibilityLabel?: string; expanded?: boolean; onPress: () => void;
  tone?: 'default' | 'accent' | 'ghost'; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const feedback = useControlFeedback();
  const color = tone === 'accent' ? (chrome.dark ? '#060913' : '#FFFFFF') : chrome.ink;
  return (
    <Pressable {...feedback.events} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (hint ? `${label}. ${hint}` : label)}
      accessibilityState={{ disabled, expanded }} aria-disabled={disabled} aria-expanded={expanded}
      style={({ pressed }) => [{
        minHeight: theme.tap, justifyContent: 'center', borderRadius: theme.s(8),
        paddingHorizontal: theme.s(14), paddingVertical: theme.s(11),
        backgroundColor: tone === 'accent' ? chrome.accent : feedback.hovered ? chrome.surfaceElevated : chrome.surface,
        borderWidth: theme.rule(1), borderColor: tone === 'ghost' ? 'transparent' : tone === 'accent' ? chrome.accent : chrome.lineSoft,
        opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      }, style, feedback.focusStyle, tone === 'accent' && feedback.focusStyle ? { outlineColor: chrome.bg, outlineOffset: -4 } : undefined]}>
      <Row gap={10}>
        <Title size={15} color={color} style={{ flexShrink: 1 }}>{label}</Title>
        {hint === undefined ? null : <Body size={12} color={tone === 'accent' ? color : chrome.dim} style={{ marginLeft: 'auto' }}>{hint}</Body>}
      </Row>
    </Pressable>
  );
}

export function Toggle({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const feedback = useControlFeedback();
  return (
    <Pressable {...feedback.events} onPress={() => onChange(!value)} accessibilityRole="switch"
      accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: value }} aria-checked={value}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: theme.s(14), minHeight: theme.tap,
        paddingVertical: theme.s(6), borderRadius: theme.s(6), opacity: pressed ? 0.7 : 1,
      }, feedback.focusStyle]}>
      <View style={{ flex: 1 }}>
        <Title size={15}>{label}</Title>
        {hint === undefined ? null : <Body size={12} color={chrome.dim} style={{ marginTop: theme.s(3) }}>{hint}</Body>}
      </View>
      <View style={{ width: theme.s(44), height: theme.s(26), borderRadius: theme.s(13), backgroundColor: value ? chrome.accent : (chrome.dark ? 'rgba(248,250,252,0.18)' : 'rgba(15,23,42,0.16)') }}>
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

export function Stepper({ label, value, display, onDecrement, onIncrement, canDecrement = true, canIncrement = true }: {
  label: string; value: number; display?: string;
  onDecrement: () => void; onIncrement: () => void; canDecrement?: boolean; canIncrement?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row style={{ borderWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, borderRadius: theme.s(8), backgroundColor: theme.chrome.surface }}>
      <Button label="−" accessibilityLabel={`Decrease ${label}`} onPress={onDecrement} disabled={!canDecrement} tone="ghost" style={{ paddingHorizontal: 0, minWidth: theme.tap, alignItems: 'center' }} />
      <View accessibilityLabel={`${label}: ${display ?? value}`} style={{ minWidth: theme.s(62), alignItems: 'center' }}>
        <Num size={15}>{display ?? String(value)}</Num>
      </View>
      <Button label="+" accessibilityLabel={`Increase ${label}`} onPress={onIncrement} disabled={!canIncrement} tone="ghost" style={{ paddingHorizontal: 0, minWidth: theme.tap, alignItems: 'center' }} />
    </Row>
  );
}

export interface Segment<T extends string> { value: T; label: string; hint?: string }

export function Segmented<T extends string>({ segments, value, onChange, grow = false, compact = false, accessibilityLabel }: {
  segments: readonly Segment<T>[]; value: T; onChange: (next: T) => void; grow?: boolean; compact?: boolean; accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const buttons = useRef<(View | null)[]>([]);
  const selectWithKeyboard = (index: number, key: string) => {
    const next = key === 'Home' ? 0 : key === 'End' ? segments.length - 1
      : (index + (key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1) + segments.length) % segments.length;
    onChange(segments[next].value);
    buttons.current[next]?.focus();
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', padding: theme.s(3), borderRadius: theme.s(9), backgroundColor: theme.chrome.surface, alignSelf: grow ? 'stretch' : 'flex-start' }}>
      {segments.map((segment, index) => <SegmentButton key={segment.value} segment={segment} selected={segment.value === value} onPress={() => onChange(segment.value)} grow={grow} compact={compact} setRef={(node) => { buttons.current[index] = node; }} onArrow={(key) => selectWithKeyboard(index, key)} />)}
    </View>
  );
}

function SegmentButton<T extends string>({ segment, selected, onPress, grow, compact, setRef, onArrow }: {
  segment: Segment<T>; selected: boolean; onPress: () => void; grow: boolean; compact: boolean; setRef: (node: View | null) => void; onArrow: (key: string) => void;
}) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  return (
    <Pressable ref={setRef} {...feedback.events} onPress={onPress} accessibilityRole="radio"
      {...(Platform.OS === 'web' ? { tabIndex: selected ? 0 as const : -1 as const, onKeyDown: (event: { key: string; preventDefault: () => void }) => {
        if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onArrow(event.key); }
      } } : {})}
      accessibilityLabel={segment.label} accessibilityHint={segment.hint} accessibilityState={{ checked: selected }} aria-checked={selected}
      style={({ pressed }) => [{
        flex: grow ? 1 : undefined, minWidth: 0, minHeight: theme.tap,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.s(compact ? 7 : 11),
        borderRadius: theme.s(6), backgroundColor: selected ? theme.chrome.surfaceElevated : feedback.hovered ? theme.chrome.lineSoft : 'transparent',
        borderWidth: theme.rule(1), borderColor: selected ? theme.chrome.lineSoft : 'transparent', opacity: pressed ? 0.7 : 1,
      }, feedback.focusStyle]}>
      <Title size={compact ? 12 : 13} color={selected ? theme.chrome.ink : theme.chrome.dim} style={{ textAlign: 'center' }}>{segment.label}</Title>
    </Pressable>
  );
}

export function PressableRow({ onPress, accessibilityLabel, selected, disabled = false, children, style }: {
  onPress?: () => void; accessibilityLabel: string; selected?: boolean; disabled?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const feedback = useControlFeedback();
  return (
    <Pressable {...feedback.events} onPress={onPress} disabled={disabled || !onPress} accessibilityRole="button"
      accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, disabled: disabled || !onPress }} aria-pressed={selected} aria-disabled={disabled || !onPress}
      style={({ pressed }) => [{ minHeight: theme.tap, backgroundColor: selected || feedback.hovered ? theme.chrome.surface : 'transparent', opacity: disabled ? 0.55 : pressed ? 0.7 : 1 }, style, feedback.focusStyle]}>
      {children}
    </Pressable>
  );
}

/** Keep optional setup choices out of the path to starting a practice session. */
export function Disclosure({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
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
