import { useCallback, useState } from 'react';
import { LayoutChangeEvent } from 'react-native';

export interface Size {
  width: number;
  height: number;
}

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
 */
export function useMeasuredSize(): [Size, (event: LayoutChangeEvent) => void] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (
      // Sub-pixel churn would re-render the whole note field on every frame.
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    ));
  }, []);

  return [size, onLayout];
}
