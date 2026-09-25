/**
 * Design tokens.
 *
 * 1.8 re-grounds the interface on the phone it now lives on: iOS's grouped
 * surfaces — cards on a soft grey ground in light, near-black in dark —
 * continuous corners, capsule controls and one indigo accent reserved for
 * actions and selection. Musical string, note and tape colours keep their
 * established meaning and are never used for chrome. Nothing here knows about
 * screen size — see `scale.ts` for that.
 */

import { CelloString, NoteColorName, STRING_NOTE_COLOR, TapeColor } from '@domain';

// ─── Base palette ────────────────────────────────────────────────────────────

/**
 * Apple Human Interface Guidelines (HIG) System Colors.
 * Calibrated for light and dark appearance with high vibrancy and WCAG AA contrast.
 * https://developer.apple.com/design/human-interface-guidelines/color
 */
export const APPLE_HIG = {
  blue: { light: '#007AFF', accessibleLight: '#0066CC', dark: '#0A84FF' },
  green: { light: '#34C759', accessibleLight: '#1F8A4C', dark: '#30D158' },
  indigo: { light: '#5856D6', accessibleLight: '#4342BD', dark: '#5E5CE6' },
  orange: { light: '#FF9500', accessibleLight: '#C93400', dark: '#FF9F0A' },
  pink: { light: '#FF2D55', accessibleLight: '#D30F3C', dark: '#FF375F' },
  purple: { light: '#AF52DE', accessibleLight: '#7D39B8', dark: '#BF5AF2' },
  red: { light: '#FF3B30', accessibleLight: '#D70015', dark: '#FF453A' },
  teal: { light: '#00C7BE', accessibleLight: '#00828A', dark: '#63E6E2' },
  yellow: { light: '#FFCC00', accessibleLight: '#9E7400', dark: '#FFD60A' },
  cyan: { light: '#32ADE6', accessibleLight: '#007AA6', dark: '#64D2FF' },
} as const;

/**
 * The brand, by role.
 *
 * 1.8 moves the accent off system blue and onto an indigo of its own. Blue is
 * a *note* colour here — the D string, every D on the chart — so an accent in
 * the same hue made "selected" and "D" look alike. Indigo is still one of
 * Apple's system hues, so it sits naturally beside Liquid Glass, but nothing
 * musical is drawn in it.
 */
export const BRAND = {
  /** The accent on light grounds: 7.5:1 on white. */
  indigo: '#4638D6',
  /** The accent lifted for dark grounds: 7.6:1 on the Dark chrome. */
  indigoLight: '#9C95FF',
  /** The icon ground, top to bottom. */
  glow: '#7A6CFF',
  deep: '#2A1C9E',
  /** The splash ground and the Dark chrome's floor. */
  midnight: '#0B0A14',
} as const;

/** The light chrome's grounds — iOS grouped background and card. */
export const PAPER = '#F2F2F7';
export const INK = '#111114';
export const SURFACE = '#FFFFFF';
export const ACCENT = BRAND.indigo;
export const ACCENT_WASH = 'rgba(70, 56, 214, 0.10)';
const ACCENT_ON_DARK = BRAND.indigoLight;

/**
 * Note hues — the palette behind `domain/noteColors`.
 *
 * One colour per letter name, so a C is the same colour on the fingerboard
 * chart, on the string rails and on a notehead. Calibrated with Apple HIG
 * vibrant system hues to ensure crisp contrast and harmonic distinction.
 */
export const NOTE_COLOR_ON_PAPER: Record<NoteColorName, string> = {
  green: APPLE_HIG.green.accessibleLight,
  blue: APPLE_HIG.blue.accessibleLight,
  orange: APPLE_HIG.orange.accessibleLight,
  cyan: APPLE_HIG.teal.accessibleLight,
  red: APPLE_HIG.red.accessibleLight,
  yellow: APPLE_HIG.yellow.accessibleLight,
  purple: APPLE_HIG.purple.accessibleLight,
};

export const NOTE_COLOR_ON_DARK: Record<NoteColorName, string> = {
  green: APPLE_HIG.green.dark,
  blue: APPLE_HIG.blue.dark,
  orange: APPLE_HIG.orange.dark,
  cyan: APPLE_HIG.cyan.dark,
  red: APPLE_HIG.red.dark,
  yellow: APPLE_HIG.yellow.dark,
  purple: APPLE_HIG.purple.dark,
};

/**
 * String hues.
 *
 * Not a separate palette any more: a string is drawn in the colour of the note
 * it sounds open, straight out of the note constant. C green, G red, D blue,
 * A yellow — so the rail under a note and the note itself cannot disagree.
 */
export const STRING_COLOR_MUTED: Record<CelloString, string> = {
  C: NOTE_COLOR_ON_PAPER[STRING_NOTE_COLOR.C],
  G: NOTE_COLOR_ON_PAPER[STRING_NOTE_COLOR.G],
  D: NOTE_COLOR_ON_PAPER[STRING_NOTE_COLOR.D],
  A: NOTE_COLOR_ON_PAPER[STRING_NOTE_COLOR.A],
};

/** The same four hues lifted for dark chromes, where muted reads as murky. */
export const STRING_COLOR_HOT: Record<CelloString, string> = {
  C: NOTE_COLOR_ON_DARK[STRING_NOTE_COLOR.C],
  G: NOTE_COLOR_ON_DARK[STRING_NOTE_COLOR.G],
  D: NOTE_COLOR_ON_DARK[STRING_NOTE_COLOR.D],
  A: NOTE_COLOR_ON_DARK[STRING_NOTE_COLOR.A],
};

/**
 * Tape colours.
 *
 * Held at one lightness band per chrome so the four tapes read as a set,
 * matching real physical fingerboard tape vinyl with Apple HIG saturation.
 */
export const TAPE_COLOR_ON_DARK: Record<TapeColor, string> = {
  blue: APPLE_HIG.blue.dark,
  yellow: APPLE_HIG.yellow.dark,
  green: APPLE_HIG.green.dark,
  red: APPLE_HIG.red.dark,
  orange: APPLE_HIG.orange.dark,
  white: '#f8fafc',
};

export const TAPE_COLOR_ON_PAPER: Record<TapeColor, string> = {
  blue: APPLE_HIG.blue.accessibleLight,
  yellow: APPLE_HIG.yellow.accessibleLight,
  green: APPLE_HIG.green.accessibleLight,
  red: APPLE_HIG.red.accessibleLight,
  orange: APPLE_HIG.orange.accessibleLight,
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
  /** The screen's ground — iOS's grouped background. */
  bg: string;
  /** Cards and grouped rows sitting on `bg`. */
  surface: string;
  /** The selected thumb of a segmented control, a popover, a sheet. */
  surfaceElevated: string;
  /** Translucent control fill: segment tracks, grey buttons, toggle tracks. */
  fill: string;
  ink: string;
  dim: string;
  line: string;
  lineSoft: string;
  accent: string;
  /** Text and glyphs drawn on a solid `accent` fill. */
  onAccent: string;
  accentWash: string;
  /** Non-empty enables the glow treatment on active elements. */
  glow: boolean;
  strings: Record<CelloString, string>;
  tapes: Record<TapeColor, string>;
  /** One colour per note name — see `domain/noteColors`. */
  notes: Record<NoteColorName, string>;
}

export const CHROMES: Record<ChromeName, Chrome> = {
  paper: {
    name: 'paper',
    dark: false,
    bg: PAPER,
    surface: SURFACE,
    surfaceElevated: '#ffffff',
    fill: 'rgba(118, 118, 128, 0.12)',
    ink: INK,
    dim: '#636369',
    line: 'rgba(60, 60, 67, 0.36)',
    lineSoft: 'rgba(60, 60, 67, 0.14)',
    accent: ACCENT,
    onAccent: '#ffffff',
    accentWash: ACCENT_WASH,
    glow: false,
    strings: STRING_COLOR_MUTED,
    tapes: TAPE_COLOR_ON_PAPER,
    notes: NOTE_COLOR_ON_PAPER,
  },
  quiet: {
    name: 'quiet',
    dark: true,
    bg: BRAND.midnight,
    surface: '#18171F',
    surfaceElevated: '#25242E',
    fill: 'rgba(120, 120, 136, 0.24)',
    ink: '#f5f5f7',
    dim: '#9d9ca8',
    line: 'rgba(235, 235, 245, 0.30)',
    lineSoft: 'rgba(235, 235, 245, 0.12)',
    accent: ACCENT_ON_DARK,
    onAccent: BRAND.midnight,
    accentWash: 'rgba(156, 149, 255, 0.16)',
    glow: false,
    strings: STRING_COLOR_HOT,
    tapes: TAPE_COLOR_ON_DARK,
    notes: NOTE_COLOR_ON_DARK,
  },
  neon: {
    name: 'neon',
    dark: true,
    bg: '#000000',
    surface: '#0E1016',
    surfaceElevated: '#1A1D26',
    fill: 'rgba(120, 130, 150, 0.22)',
    ink: '#f5f5f7',
    dim: '#98a0ae',
    line: 'rgba(235, 240, 255, 0.30)',
    lineSoft: 'rgba(235, 240, 255, 0.12)',
    accent: '#5EE3FF',
    onAccent: '#000000',
    accentWash: 'rgba(94, 227, 255, 0.14)',
    glow: true,
    strings: STRING_COLOR_HOT,
    tapes: TAPE_COLOR_ON_DARK,
    notes: NOTE_COLOR_ON_DARK,
  },
};

/** Default fallback chrome when none is specified. */
export const MENU_CHROME = CHROMES.paper;

// ─── Type ────────────────────────────────────────────────────────────────────

/**
 * Font sizes in design units — see `scale.ts`.
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
 * Corner radii in design units. Drawn with continuous (squircle) corners on
 * iOS — see `corners()` in ThemeProvider — so a card's curve matches the
 * phone's own display corners rather than a plain circular arc.
 */
export const RADIUS = {
  xs: 6, sm: 10, md: 14, lg: 20, xl: 28,
  /** Large enough to make any control a capsule. */
  pill: 999,
} as const;

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
    case 'perfect': return chrome.dark ? APPLE_HIG.green.dark : APPLE_HIG.green.accessibleLight;
    case 'flat':
    case 'sharp': return chrome.dark ? APPLE_HIG.yellow.dark : APPLE_HIG.orange.accessibleLight;
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
