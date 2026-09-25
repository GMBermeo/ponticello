import { View, type ViewStyle } from 'react-native';

import type { LivePitch } from '@audio';
import type { CelloSongScore } from '@domain';
import { useTapeSettings, useVisionPreferences } from '@state';
import { useTheme } from '@theme';

import { useMeasuredSize } from '../useMeasuredSize';
import { Highway } from './Highway';
import { ScorePage } from './ScorePage';
import { TabVision } from './TabVision';
import { TunerStrip } from './TunerStrip';
import type { Playhead } from './usePlayhead';

type VisionBoxProps = { score: CelloSongScore; playhead: Playhead; width: number; height: number };

function ActiveVision({ score, playhead, width, height }: VisionBoxProps) {
  const { vision, showFingerings, showTapes, highwayAxis, tabAxis, scoreColor } = useVisionPreferences();
  const { tapeSets } = useTapeSettings();
  const visibleTapes = showTapes ? tapeSets : [];
  switch (vision) {
    case 'highway':
      return <Highway score={score} playhead={playhead} tapeSets={visibleTapes} showFingerings={showFingerings}
        height={height} width={width} axis={highwayAxis} />;
    case 'tab':
      return <TabVision score={score} playhead={playhead} tapeSets={visibleTapes} showFingerings={showFingerings}
        height={height} width={width} axis={tabAxis} />;
    case 'score':
      return <ScorePage score={score} playhead={playhead} height={height} width={width}
        showFingerings={showFingerings} colorMode={scoreColor} />;
  }
}

export type PlayVisionProps = {
  score: CelloSongScore;
  playhead: Playhead;
  playRequested: boolean;
  pitch: LivePitch;
  micEnabled: boolean;
  onEnableMic: () => void;
};

/** The chosen vision, sized to its box, with the paused-state tuner laid over it. */
export function PlayVision({ score, playhead, playRequested, pitch, micEnabled, onEnableMic }: PlayVisionProps) {
  const theme = useTheme();
  const { vision } = useVisionPreferences();
  const [size, onLayout, ref] = useMeasuredSize();
  // Laid over the play area rather than above it, so pausing does not
  // resize — and re-lay out — the vision.
  //
  // On the Score page it goes to the *bottom*. A page of notation is read
  // from the top down, and a tuner parked over the first system covers the
  // clef, the key signature and the first bar — the three things you look at
  // first. Every other vision scrolls towards the bottom edge, so there the
  // tuner stays out of the way up top.
  const edge = theme.s(6);
  const tunerPlacement: ViewStyle = vision === 'score'
    ? { position: 'absolute', bottom: edge, left: theme.s(10), right: theme.s(10) }
    : { position: 'absolute', top: edge, left: theme.s(10), right: theme.s(10) };
  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={{ flex: 1, minWidth: 0, overflow: 'hidden', paddingHorizontal: theme.s(10), paddingTop: edge }}
    >
      {size.height === 0 ? null : (
        <ActiveVision score={score} playhead={playhead} width={size.width - theme.s(20)} height={size.height - theme.s(12)} />
      )}
      {playRequested ? null : (
        <View pointerEvents="box-none" style={tunerPlacement}>
          <TunerStrip pitch={pitch} micEnabled={micEnabled} onEnableMic={onEnableMic} />
        </View>
      )}
    </View>
  );
}
