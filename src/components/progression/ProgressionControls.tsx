import { useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import { parseProgressionBpm } from '@domain';
import { useTheme } from '@theme';

import { Body, Button, Label, Row, Segmented } from '../ui';
import {
  BEATS_SEGMENTS, MAX_PROGRESSION_SPEED, MIN_PROGRESSION_SPEED, stepProgressionSpeed,
} from './progressionOptions';

const MONOSPACE = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

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
 * Give it `key={bpm}`: the typed text is only a draft, and a new tempo from
 * anywhere else should replace it.
 */
export function ProgressionControls(props: ProgressionControlsProps) {
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
    <View
      testID="custom-progression-controls"
      style={{ flexDirection: 'row', alignItems: 'center', gap: s(10), padding: s(10), borderTopWidth: theme.rule(1), borderColor: chrome.lineSoft, backgroundColor: chrome.surfaceElevated, flexWrap: 'wrap' }}
    >
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
            width: s(46), height: s(34), borderWidth: theme.rule(1), borderColor: chrome.line, borderRadius: s(4),
            textAlign: 'center', fontFamily: MONOSPACE, fontSize: font(14), fontWeight: '700', color: chrome.ink, backgroundColor: chrome.bg,
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
        <Button label="−" disabled={speed <= MIN_PROGRESSION_SPEED} onPress={() => props.onSpeedChange(stepProgressionSpeed(speed, -1))} />
        <Body size={12} style={{ width: s(42), textAlign: 'center', fontFamily: MONOSPACE, fontWeight: '700' }}>
          {Math.round(speed * 100)}%
        </Body>
        <Button label="+" disabled={speed >= MAX_PROGRESSION_SPEED} onPress={() => props.onSpeedChange(stepProgressionSpeed(speed, 1))} />
      </Row>
      <Row gap={8} style={{ marginLeft: 'auto', alignItems: 'center' }}>
        <Button label="Restart" tone="default" onPress={props.onRestart} />
        <Button label={props.playing ? 'Pause' : 'Play progression'} tone="accent" onPress={props.onTogglePlaying} />
      </Row>
    </View>
  );
}
