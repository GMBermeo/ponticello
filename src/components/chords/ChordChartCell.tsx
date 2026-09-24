import { createContext, useContext } from 'react';
import { View, type CellRendererProps } from 'react-native';
import type { SheetLine, ChordSheetLayout } from '@domain';

export type ChordChartItem = { kind: 'preview'; id: string }
  | { kind: 'line'; id: string; line: SheetLine; lineIndex: number };

export const ChordChartLayoutContext = createContext<ChordSheetLayout | null>(null);

/** Measure the list cell, not its child (whose local y is always zero). */
export function ChordChartCell({ item, children, onLayout, onFocusCapture, style }: CellRendererProps<ChordChartItem>) {
  const layout = useContext(ChordChartLayoutContext);
  return <View style={style} {...{ onFocusCapture }} onLayout={(event) => {
    if (item.kind === 'line') {
      const { y, height } = event.nativeEvent.layout;
      layout?.record(item.lineIndex, y, height);
    }
    onLayout?.(event);
  }}>{children}</View>;
}
