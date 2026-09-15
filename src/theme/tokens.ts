/**
 * Design tokens.
 *
 * A cool, matte practice surface, quiet separators, readable type, and one
 * blue accent family reserved for actions and selection. Musical string and
 * tape colours retain their established meaning. Nothing here knows about
 * screen size — see `scale.ts` for that.
 *
 * The blues are the brand set — #165788, #274490, #1D2D5C, #1E3765 — used
 * where they hold contrast: the deep pair as the dark practice grounds, the
 * mid pair as the accent on paper. On a navy ground the accent has to be a
 * lighter tint of the same hue, or it disappears into the background.
 */

import { CelloString } from '@/domain/cello';
import { TapeColor } from '@/domain/tapes';

// ─── Base palette ────────────────────────────────────────────────────────────

/** The brand blues, by role. */
export const BLUE = {
  ocean: '#165788',
  cobalt: '#274490',
  navy: '#1D2D5C',
  deep: '#1E3765',
} as const;

export const PAPER = '#f6f7f9';
export const INK = '#131a2a';
export const SURFACE = '#eceff4';
/** 7.4:1 on paper — body-text contrast, so it is safe as a text colour too. */
export const ACCENT = BLUE.ocean;
export const ACCENT_DARK = BLUE.navy;
export const ACCENT_WASH = '#e2ebf4';
/** Accent tint for navy grounds: the ocean hue, lifted to 8:1 on `BLUE.navy`. */
const ACCENT_ON_NAVY = '#a9c8ec';

/**
 * String hues.
 *
 * Built in OKLCH at one lightness and chroma so that no string shouts louder
 * than another — an equal-luminance set means the eye reads *which* string
 * from hue alone, without one lane dominating the highway. Converted to sRGB
 * here because React Native's style engine takes hex, not colour functions.
 */
export const STRING_COLOR_MUTED: Record<CelloString, string> = {
  C: '#ba2b2e', // oklch(0.52 0.18 25)
  G: '#9d6400', // oklch(0.55 0.14 78)
  D: '#00793d', // oklch(0.50 0.14 155)
  A: '#6250b2', // oklch(0.50 0.15 288)
};

/** The same four hues lifted for dark chromes, where muted reads as murky. */
export const STRING_COLOR_HOT: Record<CelloString, string> = {
  C: '#ff515a', // oklch(0.68 0.21 22)
  G: '#edaa00', // oklch(0.78 0.17 82)
  D: '#22c373', // oklch(0.72 0.17 155)
  A: '#9475ff', // oklch(0.66 0.20 290)
};

/**
 * Tape colours.
 *
 * These are not free design choices — they have to look like the blue, yellow
 * and green vinyl actually stuck to the fingerboard, or the whole point of
 * drawing them is lost. Held at one lightness band per chrome so the four
 * tapes read as a set.
 */
export const TAPE_COLOR_ON_DARK: Record<TapeColor, string> = {
  blue: '#3689dd',
  yellow: '#e5c226',
  green: '#3bb360',
  red: '#e0524a',
  orange: '#e08b2c',
  white: '#f7f6f2',
};

export const TAPE_COLOR_ON_PAPER: Record<TapeColor, string> = {
  blue: '#0063ba',
  yellow: '#c6a000',
  green: '#0a7e3a',
  red: '#c0342c',
  orange: '#b56a00',
  white: '#8a8785',
};

/** Human-readable tape colour names, for the tutorial's prose. */
export const TAPE_COLOR_LABEL: Record<TapeColor, string> = {
  blue: 'Blue', yellow: 'Yellow', green: 'Green',
  red: 'Red', orange: 'Orange', white: 'White',
};

// ─── Chromes ─────────────────────────────────────────────────────────────────

export type ChromeName = 'paper' | 'quiet' | 'neon';

export interface Chrome {
  name: ChromeName;
  dark: boolean;
  bg: string;
  surface: string;
  ink: string;
  dim: string;
  line: string;
  lineSoft: string;
  accent: string;
  accentWash: string;
  /** Non-empty enables the glow treatment on active elements. */
  glow: boolean;
  strings: Record<CelloString, string>;
  tapes: Record<TapeColor, string>;
}

export const CHROMES: Record<ChromeName, Chrome> = {
  paper: {
    name: 'paper',
    dark: false,
    bg: PAPER,
    surface: SURFACE,
    ink: INK,
    dim: '#586173',
    line: '#8b94a4',
    lineSoft: '#dce1e9',
    accent: ACCENT,
    accentWash: ACCENT_WASH,
    glow: false,
    strings: STRING_COLOR_MUTED,
    tapes: TAPE_COLOR_ON_PAPER,
  },
  quiet: {
    name: 'quiet',
    dark: true,
    bg: BLUE.navy,
    surface: BLUE.deep,
    ink: '#f3f6fb',
    dim: '#b8c3d9',
    line: 'rgba(243,246,251,0.34)',
    lineSoft: 'rgba(243,246,251,0.14)',
    accent: ACCENT_ON_NAVY,
    accentWash: BLUE.cobalt,
    glow: false,
    strings: STRING_COLOR_HOT,
    tapes: TAPE_COLOR_ON_DARK,
  },
  neon: {
    name: 'neon',
    dark: true,
    bg: '#0a0f1e',
    surface: '#131b33',
    ink: '#f5f7fc',
    dim: '#b5bdd0',
    line: 'rgba(245,247,252,0.32)',
    lineSoft: 'rgba(245,247,252,0.13)',
    accent: '#8db8ef',
    accentWash: BLUE.deep,
    glow: true,
    strings: STRING_COLOR_HOT,
    tapes: TAPE_COLOR_ON_DARK,
  },
};

/** Menus are always paper; only the play screen offers a chrome choice. */
export const MENU_CHROME = CHROMES.paper;

// ─── Type ────────────────────────────────────────────────────────────────────

/**
 * Font sizes in design units — see `scale.ts`. Archivo carries the whole
 * interface: 800 for anything structural, 400 for prose.
 */
export const TYPE = {
  micro: 12,      // uppercase tracked labels
  small: 14,
  body: 16,
  bodyLarge: 18,
  title: 24,
  heading: 30,
  display: 42,
  hero: 88,       // the tuner's note name
} as const;

export const WEIGHT = {
  regular: '400',
  semibold: '600',
  heavy: '800',
} as const;

export const FONT = {
  regular: 'Archivo_400Regular',
  semibold: 'Archivo_600SemiBold',
  heavy: 'Archivo_800ExtraBold',
} as const;

/** Tracking for the uppercase micro-labels that structure every screen. */
export const TRACKING = {
  label: 1.2,
  tight: -0.4,
} as const;

// ─── Spacing and rules ───────────────────────────────────────────────────────

export const SPACE = {
  xs: 4, sm: 8, md: 14, lg: 20, xl: 30, xxl: 44,
} as const;

/** Rule weights. `major` divides regions; `soft` separates rows. */
export const RULE = { major: 2, minor: 1 } as const;

/**
 * Minimum interactive size in design units. Google's 48dp guidance in canvas
 * units — the play screen is used mid-bow with one hand, so nothing shrinks
 * below this even where the design looks tighter.
 */
export const TAP_TARGET = 48;

// ─── Intonation feedback colours ─────────────────────────────────────────────

export function intonationColor(
  verdict: 'perfect' | 'flat' | 'sharp' | 'miss', chrome: Chrome,
): string {
  switch (verdict) {
    case 'perfect': return chrome.dark ? '#22c55e' : '#0a7e3a';
    case 'flat':
    case 'sharp': return chrome.dark ? '#eab308' : '#a07800';
    case 'miss': return chrome.accent;
  }
}

/** `rgba` from a hex colour — RN has no `color-mix`. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
