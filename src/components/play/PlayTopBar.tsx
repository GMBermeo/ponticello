import { memo } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { Label, Row, Title } from '@/components/ui/primitives';
import { useTheme } from '@/theme/ThemeProvider';
import { Playhead, usePlayheadPosition } from './usePlayhead';

const TOP_BAR_HEIGHT = 56;

export interface PlayTopBarProps {
  title: string;
  /** Read for the bar number only; the bar re-renders itself as it changes. */
  playhead: Pick<Playhead, 'getPosition' | 'subscribePosition'>;
  loopFromBar: number;
  loopToBar: number;
  playRequested: boolean;
  onEndSession: () => void;
  onRestart: () => void;
  onTogglePlay: () => void;
}

export const PlayTopBar = memo(function PlayTopBar({
  title,
  playhead,
  loopFromBar,
  loopToBar,
  playRequested,
  onEndSession,
  onRestart,
  onTogglePlay,
}: PlayTopBarProps) {
  const theme = useTheme();

  return (
    <Row
      padX={12}
      gap={10}
      style={{ minHeight: Math.max(theme.tap + theme.s(12), theme.s(TOP_BAR_HEIGHT)) }}
    >
      <Button
        label="×"
        accessibilityLabel="End session"
        onPress={onEndSession}
        tone="ghost"
        style={{ minWidth: theme.tap, alignItems: 'center', paddingHorizontal: 0 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Title size={16} numberOfLines={1}>{title}</Title>
        <BarReadout playhead={playhead} loopFromBar={loopFromBar} loopToBar={loopToBar} />
      </View>
      <Button
        label="↺"
        accessibilityLabel="Restart the loop"
        onPress={onRestart}
        tone="ghost"
        style={{ minWidth: theme.tap, paddingHorizontal: 0, alignItems: 'center' }}
      />
      <Button
        label={playRequested ? 'Pause' : 'Play'}
        onPress={onTogglePlay}
        tone="accent"
        style={{ minWidth: theme.s(78), alignItems: 'center' }}
      />
    </Row>
  );
});

/** The only part of the bar that changes during playback, so the only part that renders. */
function BarReadout({ playhead, loopFromBar, loopToBar }: {
  playhead: Pick<Playhead, 'getPosition' | 'subscribePosition'>;
  loopFromBar: number;
  loopToBar: number;
}) {
  const { measureIndex } = usePlayheadPosition(playhead);
  return (
    <Label size={11} style={{ textTransform: 'none', letterSpacing: 0 }} numberOfLines={1}>
      {`Bar ${measureIndex + 1} · Loop ${loopFromBar}–${loopToBar}`}
    </Label>
  );
}
