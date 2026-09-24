import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { LivePitch, PitchReading } from '@audio';
import { CENTS_PERFECT, formatCents, type IntonationVerdict } from '@domain';
import { intonationColor, useTheme } from '@theme';

import { Body, Button, Grow, Label, Num, Row, Title } from '../ui';

/** The meter spans ±50 cents, which is half a semitone either way. */
export const TUNER_SPAN_CENTS = 50;
const TICKS_CENTS = [-50, -25, 0, 25, 50];

/** Horizontal position, in percent of the dial, of a cents offset. */
export function dialPercent(cents: number): number {
  'worklet';
  return 50 + (cents / TUNER_SPAN_CENTS) * 50;
}

const VERDICT_WORD: Record<IntonationVerdict, string> = {
  perfect: 'IN TUNE',
  flat: 'FLAT',
  sharp: 'SHARP',
  miss: 'OUT',
};

function statusLine(reading: PitchReading, micLive: boolean, micEnabled: boolean): string {
  if (reading.voiced) return `${reading.frequency.toFixed(1)} Hz`;
  if (micLive) return 'Ready when you are';
  return micEnabled ? 'Waiting for microphone' : 'Enable the microphone to begin';
}

function verdictLabel(reading: PitchReading, micEnabled: boolean): string {
  if (!micEnabled) return 'Mic off';
  return reading.verdict ? VERDICT_WORD[reading.verdict] : 'LISTENING';
}

export type TunerDialProps = {
  pitch: LivePitch;
  reading: PitchReading;
  micEnabled: boolean;
  onEnableMic: () => void;
};

/** The heard note, its offset in cents, and a needle over a ±50 cent scale. */
export function TunerDial({ pitch, reading, micEnabled, onEnableMic }: TunerDialProps) {
  const theme = useTheme();
  const { chrome } = theme;
  const color = reading.verdict ? intonationColor(reading.verdict, chrome) : chrome.dim;
  const inTuneInset = `${dialPercent(-CENTS_PERFECT)}%` as const;

  const needle = useAnimatedStyle(() => {
    const clamped = Math.max(-TUNER_SPAN_CENTS, Math.min(TUNER_SPAN_CENTS, pitch.cents.get()));
    return { left: `${dialPercent(clamped)}%` };
  });

  return (
    <View style={{ flex: theme.scale.compact ? undefined : 1, backgroundColor: chrome.surfaceElevated, borderRadius: theme.s(16), borderWidth: theme.rule(1), borderColor: chrome.lineSoft, padding: theme.s(24), gap: theme.s(20) }}>
      <Row gap={16} style={{ alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Title size={72} style={{ lineHeight: theme.font(80) }}>{reading.heard ?? '—'}</Title>
          <Body size={13} color={chrome.dim}>{statusLine(reading, pitch.mic.live, micEnabled)}</Body>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Num size={30} color={color}>{reading.voiced ? formatCents(reading.cents) : '—'}</Num>
          <Label size={11} color={color}>{verdictLabel(reading, micEnabled)}</Label>
        </View>
      </Row>
      {micEnabled ? null : <Button label="Enable microphone" tone="accent" onPress={onEnableMic} style={{ alignSelf: 'flex-start' }} />}
      <View style={{ height: theme.s(60), borderBottomWidth: theme.rule(1), borderColor: chrome.line }}>
        <View style={{ position: 'absolute', left: inTuneInset, right: inTuneInset, top: 0, bottom: 0, backgroundColor: chrome.lineSoft }} />
        {TICKS_CENTS.map((value) => (
          <View key={value} style={{ position: 'absolute', left: `${dialPercent(value)}%`, bottom: 0, width: theme.rule(1), height: theme.s(value === 0 ? 60 : 18), backgroundColor: value === 0 ? chrome.ink : chrome.line }} />
        ))}
        {reading.voiced ? <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: theme.rule(3), backgroundColor: color }, needle]} /> : null}
      </View>
      <Row>
        <Body size={12} color={chrome.dim}>Flat</Body><Grow />
        <Body size={12} color={chrome.dim}>In tune</Body><Grow />
        <Body size={12} color={chrome.dim}>Sharp</Body>
      </Row>
    </View>
  );
}
