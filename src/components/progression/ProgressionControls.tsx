import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { parseProgressionBpm } from '@domain';
import { FACE, RADIUS, useTheme } from '@theme';

import { Button, Card, Glass, Label, Num, Row, Segmented } from '../ui';
import {
  BEATS_SEGMENTS, MAX_PROGRESSION_SPEED, MIN_PROGRESSION_SPEED, stepProgressionSpeed,
} from './progressionOptions';

export type ProgressionControlsProps = {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  beatsPerChord: number;
  onBeatsPerChordChange: (beats: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  playing: boolean;
  onTogglePlaying: () => void;
  onRestart: () => void;
};

/**
 * Tempo, beats per chord, speed and transport.
 *
 * On a wide screen all of it floats in one glass bar under the rows. On a
 * compact one — the iPhone Duo held upright — that bar would wrap to four
 * lines and cover a third of the page, so only the transport floats and the
 * tempo settings sit in the page as a card (`ProgressionTempoCard`).
 */
export function ProgressionControls(props: ProgressionControlsProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { s } = theme;
  const compact = theme.scale.compact;
  return (
    <View testID="custom-progression-controls" style={{ position: 'absolute', left: compact ? undefined : s(12), right: s(12), bottom: insets.bottom + s(8) }}>
      <Glass
        style={{ flexDirection: 'row', alignItems: 'center', gap: s(10), padding: s(compact ? 6 : 12), ...theme.corners(RADIUS.xl), flexWrap: 'wrap' }}
      >
        {compact ? null : <ProgressionTempoControls {...props} />}
        <Row gap={8} style={{ marginLeft: 'auto', alignItems: 'center' }}>
          <Button label="Restart" icon="restart" tone="default" onPress={props.onRestart} />
          <Button label={props.playing ? 'Pause' : 'Play'} icon={props.playing ? 'pause' : 'play'} tone="accent" onPress={props.onTogglePlaying} />
        </Row>
      </Glass>
    </View>
  );
}

/** The tempo settings as a card in the page, for compact screens. */
export function ProgressionTempoCard(props: ProgressionControlsProps) {
  const theme = useTheme();
  if (!theme.scale.compact) return null;
  return (
    <Card gap={12}>
      <ProgressionTempoControls {...props} />
    </Card>
  );
}

/**
 * BPM, beats per chord and speed. Give it `key={bpm}`: the typed text is only
 * a draft, and a new tempo from anywhere else should replace it.
 */
function ProgressionTempoControls(props: ProgressionControlsProps) {
  const { bpm, speed } = props;
  const theme = useTheme();
  const { s, chrome, font } = theme;
  const [bpmText, setBpmText] = useState(String(bpm));
  const commitBpm = () => {
    const parsed = parseProgressionBpm(bpmText);
    if (parsed === null) setBpmText(String(bpm));
    else props.onBpmChange(parsed);
  };
  return (
    <>
      <Row gap={4} style={{ alignItems: 'center' }}>
        <Label size={11}>BPM</Label>
        <TextInput
          accessibilityLabel="Progression BPM"
          value={bpmText}
          onChangeText={setBpmText}
          onBlur={commitBpm}
          onSubmitEditing={commitBpm}
          keyboardType="numeric"
          maxLength={3}
          style={{
            width: s(56), height: s(36), borderRadius: s(18),
            textAlign: 'center', ...FACE.rounded, fontSize: font(15), color: chrome.ink, backgroundColor: chrome.fill,
          }}
        />
      </Row>
      <Row gap={4} style={{ alignItems: 'center' }}>
        <Label size={11}>Beats</Label>
        <Segmented
          accessibilityLabel="Beats per chord"
          segments={BEATS_SEGMENTS}
          value={String(props.beatsPerChord) as (typeof BEATS_SEGMENTS)[number]['value']}
          onChange={(value) => props.onBeatsPerChordChange(Number.parseInt(value, 10))}
          compact
        />
      </Row>
      <Row gap={4} style={{ alignItems: 'center' }}>
        <Label size={11}>Speed</Label>
        <Button label="" icon="minus" accessibilityLabel="Slower" disabled={speed <= MIN_PROGRESSION_SPEED} onPress={() => props.onSpeedChange(stepProgressionSpeed(speed, -1))} />
        <Num size={14} style={{ width: s(48), textAlign: 'center' }}>
          {Math.round(speed * 100)}%
        </Num>
        <Button label="" icon="plus" accessibilityLabel="Faster" disabled={speed >= MAX_PROGRESSION_SPEED} onPress={() => props.onSpeedChange(stepProgressionSpeed(speed, 1))} />
      </Row>
    </>
  );
}
