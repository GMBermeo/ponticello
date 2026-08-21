import React, { useMemo } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';

import { CANVAS, FOLD5_PX, ViewportContext } from '@/theme/scale';
import { PAPER } from '@/theme/tokens';

/**
 * Fold 5 preview frame — web only.
 *
 * On the device the app fills the screen. In a desktop browser it would
 * otherwise stretch to whatever shape the window happens to be, which makes it
 * impossible to check the layout it was designed for. So on web the app is laid
 * out at exactly the canvas size — 829 × 690 units, the Fold 5 inner display —
 * and the whole box is then transform-scaled to fit the window. Inside the
 * frame the scale factor is exactly 1.0, so what you see in the browser is what
 * lands on the device, down to the pixel.
 *
 * Narrow windows fall through untouched: there the window *is* the device, and
 * the compact layout is the thing worth looking at.
 */
export function DeviceCanvas({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();

  const frame = useMemo(() => {
    const margin = 40;
    const fit = Math.min(
      (width - margin * 2) / CANVAS.width,
      (height - margin * 2) / CANVAS.height,
    );
    return { fit };
  }, [width, height]);

  const viewport = useMemo(
    () => ({ width: CANVAS.width, height: CANVAS.height }),
    [],
  );

  if (Platform.OS !== 'web') return <>{children}</>;
  if (width < 900 || height < 560) return <>{children}</>;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d8d6d5' }}>
      <View
        accessibilityLabel={`Galaxy Z Fold 5 inner display preview, ${FOLD5_PX.width} by ${FOLD5_PX.height} pixels`}
        style={{
          width: CANVAS.width,
          height: CANVAS.height,
          backgroundColor: PAPER,
          overflow: 'hidden',
          borderWidth: 1 / frame.fit,
          borderColor: 'rgba(32,30,29,0.35)',
          transform: [{ scale: frame.fit }],
        }}
      >
        <ViewportContext.Provider value={viewport}>
          {children}
        </ViewportContext.Provider>
      </View>
    </View>
  );
}
