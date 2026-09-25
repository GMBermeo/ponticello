/**
 * Resolution model.
 *
 * The app is laid out for the Galaxy Z Fold 5's inner display: 2176 × 1812
 * physical pixels at a native density of 2.625. Dividing through gives a
 * **design canvas of 829 × 690 density-independent units**, and every size in
 * the interface is written in those units.
 *
 * `useScale()` returns the factor mapping a design unit to a device-independent
 * pixel, plus how much of the canvas the window can actually show.
 *
 * The scale is clamped rather than a pure fit-to-window. A phone screen is a
 * third of the canvas wide, and shrinking everything to 0.45 would make body
 * text four points high — the answer to a narrow window is to **reflow**, not
 * to shrink, so below the clamp the canvas simply gets logically narrower and
 * `compact` goes true. Above it, a screen larger than the Fold 5 gets a
 * proportionally larger interface, up to a ceiling.
 *
 * Two things deliberately do not scale past a floor: hairline rules, which
 * would blur, and tap targets, which would shrink below what a thumb can hit
 * mid-bow. Both are clamped in `useTheme`.
 */

import { createContext, useContext, useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';

/** The Fold 5 inner display, in physical pixels. */
export const FOLD5_PX = { width: 2176, height: 1812 } as const;

/** Its native density. 2176 / 2.625 = 829 dp across. */
export const FOLD5_DENSITY = 2.625;

/** The design canvas every layout is written against, in design units. */
export const CANVAS = {
  width: FOLD5_PX.width / FOLD5_DENSITY,   // 828.95
  height: FOLD5_PX.height / FOLD5_DENSITY, // 690.29
} as const;

export const CANVAS_ASPECT = CANVAS.width / CANVAS.height; // ~1.20

/**
 * Below this, shrink no further and reflow instead.
 *
 * 1.0 since 1.8: a design unit is never smaller than a point. The iPhone Duo's
 * inner display is 466 pt wide, so at the old 0.85 floor body text set at 16
 * units came out at 13.6 pt against the system's 17 — legible, but visibly
 * smaller than every other app on the phone. At 1.0 the Duo reflows to the
 * compact layout at native iOS sizes, and the Fold 5 inner display, which fits
 * the canvas at exactly 1.0, is unchanged.
 */
export const MIN_SCALE = 1;
/** Above this, a very large screen stops magnifying and shows more instead. */
export const MAX_SCALE = 1.6;

/**
 * Below this many design units of width the interface stacks: the cover
 * screen, a folded phone, or a narrow browser window.
 */
export const COMPACT_BREAKPOINT = 620;

export interface ScaleInfo {
  /** Multiply a design unit by this to get device-independent pixels. */
  scale: number;
  /** How much of the canvas the window can show, in design units. */
  width: number;
  height: number;
  /** True on the cover screen, a folded phone, or a narrow window. */
  compact: boolean;
  landscape: boolean;
  /** True when the window matches the Fold 5 inner display within a pixel. */
  isFold5: boolean;
}

export function computeScale(
  windowWidth: number, windowHeight: number, pixelRatio = FOLD5_DENSITY,
): ScaleInfo {
  const fit = Math.min(windowWidth / CANVAS.width, windowHeight / CANVAS.height);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit));

  const width = windowWidth / scale;
  const height = windowHeight / scale;

  const px = { w: Math.round(windowWidth * pixelRatio), h: Math.round(windowHeight * pixelRatio) };
  const isFold5 =
    Math.abs(px.w - FOLD5_PX.width) <= 2 && Math.abs(px.h - FOLD5_PX.height) <= 2;

  return {
    scale,
    width,
    height,
    compact: width < COMPACT_BREAKPOINT,
    landscape: windowWidth >= windowHeight,
    isFold5,
  };
}

/**
 * Lets a container declare the viewport instead of the OS window.
 *
 * The web preview frame uses this to present exactly the Fold 5 canvas, so
 * what a developer sees in a browser is the layout that lands on the device
 * rather than whatever shape the browser window happens to be.
 */
export const ViewportContext = createContext<{ width: number; height: number } | null>(null);

export function useScale(): ScaleInfo {
  const window = useWindowDimensions();
  const viewport = useContext(ViewportContext);
  const pixelRatio = PixelRatio.get();

  const width = viewport?.width ?? window.width;
  const height = viewport?.height ?? window.height;

  return useMemo(
    () => computeScale(width, height, viewport ? FOLD5_DENSITY : pixelRatio),
    [width, height, pixelRatio, viewport],
  );
}
