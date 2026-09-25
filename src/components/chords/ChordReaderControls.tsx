import { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { useTheme } from '@theme';

import { Body, Button, Row, Stepper } from '../ui';
import { MAX_SPEED, MIN_SPEED, parseBpm, stepSpeed } from './chordReader';

export type ChordReaderControlsProps = {
  bpm: number;
  onBpmChange: (bpm: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  playing: boolean;
  onTogglePlaying: () => void;
  onRestart: () => void;
};

/** Tempo, scroll speed, restart and the auto-scroll switch, along the bottom of the chart. */
export function ChordReaderControls(props: ChordReaderControlsProps) {
  const { bpm, onBpmChange, speed, onSpeedChange, playing } = props;
  const theme = useTheme();
  const [bpmText, setBpmText] = useState(String(bpm));
  const bpmInputFocused = useRef(false);
  const tempoScroll = useRef<ScrollView>(null);

  const commitBpm = () => {
    bpmInputFocused.current = false;
    const parsed = parseBpm(bpmText);
    if (parsed === null) setBpmText(String(bpm));
    else onBpmChange(parsed);
  };
  // The play and restart buttons matter most, so a narrow bar keeps them in view.
  const revealPriorityControls = () => tempoScroll.current?.scrollToEnd({ animated: false });

  return (
    <View
      testID="chord-song-controls"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.s(6),
        padding: theme.s(8),
        borderTopWidth: theme.rule(1),
        borderColor: theme.chrome.lineSoft,
        backgroundColor: theme.chrome.surfaceElevated,
      }}
    >
      <ScrollView
        ref={tempoScroll}
        horizontal
        style={{ flex: 1, minWidth: 0 }}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={revealPriorityControls}
        onContentSizeChange={revealPriorityControls}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', gap: theme.s(10) }}
      >
        <Row gap={6}>
          <Body size={12}>BPM</Body>
          <TextInput
            value={bpmText}
            onChangeText={setBpmText}
            keyboardType="numeric"
            accessibilityLabel="Auto-roll BPM"
            onFocus={() => { bpmInputFocused.current = true; }}
            onBlur={commitBpm}
            onSubmitEditing={commitBpm}
            selectTextOnFocus
            style={{
              width: theme.s(55),
              minHeight: theme.tap,
              padding: theme.s(8),
              borderWidth: 1,
              borderColor: theme.chrome.line,
              borderRadius: theme.s(6),
              color: theme.chrome.ink,
              fontSize: theme.font(12),
            }}
          />
        </Row>
        <Row gap={6}>
          <Body size={12}>Speed</Body>
          <Stepper
            label="auto-roll speed"
            value={speed}
            display={`${Math.round(speed * 100)}%`}
            canDecrement={speed > MIN_SPEED}
            canIncrement={speed < MAX_SPEED}
            onDecrement={() => onSpeedChange(stepSpeed(speed, -1))}
            onIncrement={() => onSpeedChange(stepSpeed(speed, 1))}
          />
        </Row>
      </ScrollView>
      <Button label="Restart" tone="ghost" onPress={props.onRestart} />
      <Button
        label={playing ? 'Pause scroll' : 'Auto-scroll'}
        accessibilityLabel={playing ? 'Pause auto-scroll' : 'Start auto-scroll'}
        tone="accent"
        onPress={() => {
          if (bpmInputFocused.current) commitBpm();
          props.onTogglePlaying();
        }}
      />
    </View>
  );
}
