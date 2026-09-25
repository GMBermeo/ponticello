import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, TextStyle, ViewStyle } from 'react-native';

import { FACE } from './faces';
import { Chrome, CHROMES, ChromeName, MENU_CHROME, RADIUS, TAP_TARGET, TRACKING } from './tokens';
import { ScaleInfo, useScale } from './scale';

/**
 * Resolved theme: a chrome plus the design-unit → dp conversion for the
 * current window. Components read `s()` for every size, which is what keeps
 * one layout working from the cover screen up to the unfolded inner display.
 */
export interface Theme {
  chrome: Chrome;
  scale: ScaleInfo;
  /** Design units → device-independent pixels. */
  s: (units: number) => number;
  /** Font size in dp, floored so labels stay legible when the canvas shrinks. */
  font: (units: number) => number;
  /** Rule width that never rounds away to nothing. */
  rule: (units?: number) => number;
  /** Minimum touch target in dp — clamped, never scaled below 44. */
  tap: number;
  /** A continuous-curve corner of `units` design units (see `RADIUS`). */
  corners: (units: number) => ViewStyle;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
  chrome = 'paper', children,
}: { chrome?: ChromeName | Chrome; children: React.ReactNode }) {
  const scale = useScale();

  const value = useMemo<Theme>(() => {
    const resolved = typeof chrome === 'string' ? CHROMES[chrome] : chrome;
    const s = (units: number) => units * scale.scale;
    return {
      chrome: resolved,
      scale,
      s,
      font: (units: number) => Math.max(9, units * scale.scale),
      rule: (units = 1) => Math.max(StyleSheet.hairlineWidth, units * scale.scale),
      tap: Math.max(44, TAP_TARGET * scale.scale),
      corners: (units: number) => ({
        borderRadius: units >= RADIUS.pill ? RADIUS.pill : s(units),
        borderCurve: 'continuous',
      }),
    };
  }, [chrome, scale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}

/** Convenience wrapper for screens; inherits current theme or falls back to default. */
export function MenuTheme({ children }: { children: React.ReactNode }) {
  const existing = useContext(ThemeContext);
  if (existing) return <>{children}</>;
  return <ThemeProvider chrome={MENU_CHROME}>{children}</ThemeProvider>;
}

// ─── Shared text styles ──────────────────────────────────────────────────────

/**
 * Tracking for an uppercase micro-label at a given size.
 *
 * Proportional to the size rather than fixed: a constant 1.2 dp of tracking is
 * 8 % of a 15 dp label and 27 % of a 4 dp one, which is the difference between
 * a set of labels and a row of scattered letters. The floor keeps the smallest
 * ones from closing up entirely.
 */
export function labelTracking(fontSize: number): number {
  return Math.max(0.3, fontSize * 0.055);
}

/** The uppercase tracked micro-label that structures every section. */
export function labelStyle(theme: Theme, color?: string): TextStyle {
  const fontSize = theme.font(12);
  return {
    ...FACE.semibold,
    fontSize,
    letterSpacing: labelTracking(fontSize),
    textTransform: 'uppercase',
    color: color ?? theme.chrome.dim,
  };
}

export function titleStyle(theme: Theme, size = 24, color?: string): TextStyle {
  return {
    ...(size >= 20 ? FACE.heavy : FACE.semibold),
    fontSize: theme.font(size),
    letterSpacing: size >= 24 ? TRACKING.tight * (size / 24) : 0,
    color: color ?? theme.chrome.ink,
  };
}

export function bodyStyle(theme: Theme, size = 16, color?: string): TextStyle {
  return {
    ...FACE.regular,
    fontSize: theme.font(size),
    lineHeight: theme.font(size) * 1.4,
    color: color ?? theme.chrome.ink,
  };
}

/** Tabular figures so numbers do not jitter as they change. */
export function numberStyle(theme: Theme, size = 16, color?: string): TextStyle {
  return {
    ...FACE.rounded,
    fontSize: theme.font(size),
    fontVariant: ['tabular-nums'],
    color: color ?? theme.chrome.ink,
  };
}
