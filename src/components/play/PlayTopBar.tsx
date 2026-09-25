import { memo } from 'react';
import { View } from 'react-native';

import { Button, GlassIconButton, Label, Row, Title } from '../ui';
import { useTheme } from '@theme';
import { Playhead, usePlayheadPosition } from './usePlayhead';

const TOP_BAR_HEIGHT = 56;

export interface PlayTopBarProps {
  title: string;
  /** Read for the bar number only; the bar re-renders itself as it changes. */
  playhead: Pick<Playhead, 'getPosition' | 'subscribePosition'>;
  loopFromBar: number;
  loopToBar: number;
  playRequested: boolean;
  /**
   * Play has been asked for but the sound has not begun yet.
   *
   * The first press of play on a long song pays for a render: the accompaniment
   * has to be built before anything can sound, and until this release the
   * button simply sat there saying "Pause" while nothing happened, which reads
   * as a dropped tap. It now says so and refuses a second press, because a
   * second press during the wait is a *stop*, and stopping something that has
   * not started is how you end up with silent playback.
   */
  starting: boolean;
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
  starting,
  onEndSession,
  onRestart,
  onTogglePlay,
}: PlayTopBarProps) {
  const theme = useTheme();
  const transportLabel = playRequested ? 'Pause' : 'Play';

  return (
    <Row
      padX={12}
      gap={10}
      style={{ minHeight: Math.max(theme.tap + theme.s(12), theme.s(TOP_BAR_HEIGHT)) }}
    >
      <GlassIconButton icon="close" accessibilityLabel="End session" onPress={onEndSession} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Title size={16} numberOfLines={1}>{title}</Title>
        <BarReadout playhead={playhead} loopFromBar={loopFromBar} loopToBar={loopToBar} />
      </View>
      <GlassIconButton icon="restart" accessibilityLabel="Restart the loop" onPress={onRestart} />
      <Button
        icon={playRequested ? 'pause' : 'play'}
        label={starting ? 'Loading…' : transportLabel}
        accessibilityLabel={starting ? 'Preparing the music' : transportLabel}
        onPress={onTogglePlay}
        disabled={starting}
        tone="accent"
        style={{ minWidth: theme.s(104), alignItems: 'center' }}
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
