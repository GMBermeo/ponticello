import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';

export interface Size {
  width: number;
  height: number;
}

/** How often to retry the imperative measurement, and how many times. */
const RETRY_MS = 50;
const RETRIES = 12;

/**
 * Measures a view from its own layout event.
 *
 * The play screen's three columns cannot have their sizes worked out by
 * arithmetic — safe-area insets, the status bar and rounding all take a slice,
 * and a drawing sized from a guess overflows its column by exactly the amount
 * you forgot. Measuring is one render slower and always right.
 *
 * Returns dimensions in device-independent pixels, which is what the drawing
 * components take: they are sizing themselves to a box, not to the canvas.
 *
 * ## Why there is a fallback
 *
 * `onLayout` is not reliable enough to be the only source. On the play screen
 * it does not fire on first paint at all — the drawings stay blank until
 * something resizes the window, at which point everything appears at once. The
 * columns are laid out and then never change size, so a view that only ever
 * reports *changes* never reports anything, and the guard that hides a drawing
 * of zero height hides it forever.
 *
 * So the ref is measured directly for a few frames after mount, and whichever
 * source answers first wins. The retry stops as soon as a real size arrives.
 */
export function useMeasuredSize(): [
  Size,
  (event: LayoutChangeEvent) => void,
  React.RefObject<View | null>,
] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const ref = useRef<View | null>(null);

  const apply = useCallback((width: number, height: number) => {
    setSize((current) => (
      // Sub-pixel churn would re-render the whole note field on every frame.
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    ));
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    apply(width, height);
  }, [apply]);

  const measured = size.width > 0 && size.height > 0;

  useEffect(() => {
    if (measured) return;

    let cancelled = false;
    let tries = 0;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const attempt = () => {
      if (cancelled || tries >= RETRIES) return;
      tries += 1;
      ref.current?.measure?.((_x, _y, width, height) => {
        if (!cancelled && width > 0 && height > 0) apply(width, height);
      });
      handle = setTimeout(attempt, RETRY_MS);
    };

    attempt();
    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [measured, apply]);

  return [size, onLayout, ref];
}
