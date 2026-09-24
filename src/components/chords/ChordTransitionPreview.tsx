import { View, type LayoutChangeEvent } from 'react-native';

import { useTheme } from '@theme';

import { Row } from '../ui';
import { ChordSongShape } from './ChordSongShape';
import { PREVIEW_SLOTS, type UpcomingChord } from './chordReader';

const SLOTS_PER_ROW = 2;

export type ChordTransitionPreviewProps = {
  /** Current chord first; two entries on compact screens, four otherwise. */
  upcoming: readonly UpcomingChord[];
  compact: boolean;
  /** Grey the next chord's notes onto the current diagram. */
  showTransition: boolean;
  scaleKey: string | undefined;
  maxDiagramHeight: number;
  onHeightChange?: (height: number) => void;
};

/** The chord being played and the ones after it, as fingering diagrams. */
export function ChordTransitionPreview(props: ChordTransitionPreviewProps) {
  const { upcoming, compact, showTransition, scaleKey, maxDiagramHeight, onHeightChange } = props;
  const theme = useTheme();
  const next = upcoming[1]?.study ?? undefined;
  const slots = PREVIEW_SLOTS.slice(0, upcoming.length);
  const rows = Array.from({ length: Math.ceil(slots.length / SLOTS_PER_ROW) }, (_, row) =>
    slots.slice(row * SLOTS_PER_ROW, (row + 1) * SLOTS_PER_ROW));
  const onLayout = onHeightChange
    ? (event: LayoutChangeEvent) => onHeightChange(event.nativeEvent.layout.height)
    : undefined;

  return (
    <View
      testID="chord-transition-preview"
      onLayout={onLayout}
      style={{
        padding: theme.s(8),
        backgroundColor: theme.chrome.surface,
        borderBottomWidth: compact ? theme.rule(1) : 0,
        borderColor: theme.chrome.lineSoft,
        gap: theme.s(8),
      }}
    >
      {rows.map((row) => (
        <Row key={row[0].label} gap={compact ? 8 : 12} style={{ alignItems: 'flex-start' }}>
          {row.map((slot) => (
            <ChordSongShape
              key={slot.label}
              label={slot.label}
              symbol={upcoming[slot.offset]?.symbol}
              study={upcoming[slot.offset]?.study}
              nextChord={slot.offset === 0 && showTransition ? next : undefined}
              scaleKey={scaleKey}
              width={compact ? 112 : 124}
              maxHeight={maxDiagramHeight}
              titleSize={compact ? 18 : 20}
            />
          ))}
        </Row>
      ))}
    </View>
  );
}
