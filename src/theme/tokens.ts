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

/** The brand blues, by role. */
export const BLUE = {
  ocean: '#0066CC',
  cobalt: '#0A84FF',
  navy: '#0B1220',
  deep: '#141E34',
} as const;

export const PAPER = '#f8f9fa';
export const INK = '#0f172a';
export const SURFACE = '#edf1f7';
/** 7.4:1 on paper — body-text contrast, so it is safe as a text colour too. */
export const ACCENT = APPLE_HIG.blue.accessibleLight;
export const ACCENT_DARK = BLUE.navy;
export const ACCENT_WASH = '#e1ebf7';
/** Accent tint for navy grounds: the electric blue hue, lifted to 8:1 on dark grounds. */
const ACCENT_ON_NAVY = APPLE_HIG.blue.dark;

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
  bg: string;
  surface: string;
  surfaceElevated: string;
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
    ink: INK,
    dim: '#5b677a',
    line: '#7a8699',
    lineSoft: '#d3d9e2',
    accent: ACCENT,
    accentWash: ACCENT_WASH,
    glow: false,
    strings: STRING_COLOR_MUTED,
    tapes: TAPE_COLOR_ON_PAPER,
    notes: NOTE_COLOR_ON_PAPER,
  },
  quiet: {
    name: 'quiet',
    dark: true,
    bg: BLUE.navy,
    surface: BLUE.deep,
    surfaceElevated: '#1c2b4b',
    ink: '#f8fafc',
    dim: '#94a3b8',
    line: 'rgba(248,250,252,0.36)',
    lineSoft: 'rgba(248,250,252,0.22)',
    accent: ACCENT_ON_NAVY,
    accentWash: 'rgba(10, 132, 255, 0.16)',
    glow: false,
    strings: STRING_COLOR_HOT,
    tapes: TAPE_COLOR_ON_DARK,
    notes: NOTE_COLOR_ON_DARK,
  },
  neon: {
    name: 'neon',
    dark: true,
    bg: '#060913',
    surface: '#0f172a',
    surfaceElevated: '#1e293b',
    ink: '#f8fafc',
    dim: '#94a3b8',
    line: 'rgba(248,250,252,0.34)',
    lineSoft: 'rgba(248,250,252,0.20)',
    accent: '#38bdf8',
    accentWash: 'rgba(56, 189, 248, 0.16)',
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
