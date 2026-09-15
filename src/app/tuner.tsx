import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Button } from '@/components/ui/controls';
import { LevelMeter } from '@/components/play/Meters';
import { Body, Grow, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { usePitch, usePitchReading } from '@/audio/usePitch';
import {
  A4_HZ, CENTS_PERFECT, midiToFrequency, midiToPitchName, OPEN_STRING_MIDI,
  STRING_NUMERAL, STRING_ORDER, CelloString,
} from '@/domain/cello';
import { useTheme } from '@/theme/ThemeProvider';
import { intonationColor } from '@/theme/tokens';

/** The meter spans ±50 cents, which is half a semitone either way. */
const SPAN = 50;

/**
 * Open-string tuner.
 *
 * Runs the same dual-rate engine the play screens use, on purpose: if the
 * tuner and the practice feedback disagreed about a low C, the player would
 * have no way of knowing which to believe. One pitch path, one answer.
 */
export default function TunerScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const [micEnabled, setMicEnabled] = useState(Platform.OS !== 'web');
  const pitch = usePitch(micEnabled, { tunerMode: true });

  // No target — report whatever is sounding, and let the player aim at it.
  useEffect(() => { pitch.setTarget(null); }, [pitch]);

  const reading = usePitchReading(pitch);

  /** Which open string the player is closest to, so its row can light up. */
  const nearestString = useMemo<CelloString | null>(() => {
    if (!reading.voiced) return null;
    let best: CelloString | null = null;
    let bestDistance = Infinity;
    for (const string of STRING_ORDER) {
      const distance = Math.abs(
        1200 * Math.log2(reading.frequency / midiToFrequency(OPEN_STRING_MIDI[string])),
      );
      if (distance < bestDistance) { bestDistance = distance; best = string; }
    }
    // Beyond a whole tone away it is not the open string being tuned.
    return bestDistance <= 200 ? best : null;
  }, [reading]);

  const color = reading.verdict ? intonationColor(reading.verdict, chrome) : chrome.dim;

  const needle = useAnimatedStyle(() => {
    const clamped = Math.max(-SPAN, Math.min(SPAN, pitch.cents.get()));
    return { left: `${50 + (clamped / SPAN) * 50}%` };
  });

  const centsText = reading.voiced
    ? `${reading.cents > 0 ? '+' : reading.cents < 0 ? '−' : ''}${Math.abs(Math.round(reading.cents))}¢`
    : '—';

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta={`A = ${A4_HZ} Hz`} />
      <Screen>
        <Stack padY={24} gap={8}>
          <Title accessibilityRole="header" size={30}>Tune your cello</Title>
          <Body size={15} color={chrome.dim}>Bow one open string at a time, starting with low C.</Body>
        </Stack>
        <View style={{ flexDirection: theme.scale.compact ? 'column' : 'row', gap: theme.s(24) }}>
        <View style={{ flex: theme.scale.compact ? undefined : 1, backgroundColor: chrome.surface, borderRadius: theme.s(12), padding: theme.s(24), gap: theme.s(20) }}>
          <Row gap={16} style={{ alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Title size={72} style={{ lineHeight: theme.font(80) }}>{reading.heard ?? '—'}</Title>
              <Body size={13} color={chrome.dim}>{reading.voiced ? `${reading.frequency.toFixed(1)} Hz` : pitch.mic.live ? 'Ready when you are' : micEnabled ? 'Waiting for microphone' : 'Enable the microphone to begin'}</Body>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Num size={30} color={color}>{centsText}</Num>
              <Label size={11} color={color}>{micEnabled ? verdictWord(reading.verdict) : 'Mic off'}</Label>
            </View>
          </Row>
          {!micEnabled ? <Button label="Enable microphone" tone="accent" onPress={() => setMicEnabled(true)} style={{ alignSelf: 'flex-start' }} /> : null}
          <View style={{ height: theme.s(60), borderBottomWidth: theme.rule(1), borderColor: chrome.line }}>
            <View style={{ position: 'absolute', left: `${50 - (CENTS_PERFECT / SPAN) * 50}%`, right: `${50 - (CENTS_PERFECT / SPAN) * 50}%`, top: 0, bottom: 0, backgroundColor: chrome.lineSoft }} />
            {[-50, -25, 0, 25, 50].map((value) => <View key={value} style={{ position: 'absolute', left: `${50 + (value / SPAN) * 50}%`, bottom: 0, width: theme.rule(1), height: theme.s(value === 0 ? 60 : 18), backgroundColor: value === 0 ? chrome.ink : chrome.line }} />)}
            {reading.voiced ? <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, width: theme.rule(3), backgroundColor: color }, needle]} /> : null}
          </View>
          <Row><Body size={12} color={chrome.dim}>Flat</Body><Grow /><Body size={12} color={chrome.dim}>In tune</Body><Grow /><Body size={12} color={chrome.dim}>Sharp</Body></Row>
        </View>
        <Stack padY={theme.scale.compact ? 0 : 8} gap={8} style={{ flex: theme.scale.compact ? undefined : 1 }}>
          <Row><Label size={11}>Open strings</Label><Grow /><Body size={12} color={chrome.dim}>C → G → D → A</Body></Row>
          {STRING_ORDER.map((string) => {
            const midi = OPEN_STRING_MIDI[string];
            const target = midiToFrequency(midi);
            const isNear = nearestString === string;
            const cents = isNear && reading.voiced ? 1200 * Math.log2(reading.frequency / target) : null;
            return <View key={string}>
              <Row padY={10} padX={8} gap={14} style={{ borderRadius: theme.s(8), backgroundColor: isNear ? chrome.surface : 'transparent' }}>
                <View style={{ width: theme.s(38), height: theme.s(38), borderRadius: theme.s(19), backgroundColor: chrome.surface, alignItems: 'center', justifyContent: 'center' }}><Title size={20} color={chrome.strings[string]}>{string}</Title></View>
                <View style={{ flex: 1 }}><Title size={15}>{`${midiToPitchName(midi)} · String ${STRING_NUMERAL[string]}`}</Title><Body size={12} color={chrome.dim}>{target.toFixed(2)} Hz</Body></View>
                <Num size={15} color={cents !== null && Math.abs(cents) <= CENTS_PERFECT ? intonationColor('perfect', chrome) : chrome.dim}>
                  {cents === null ? '—' : Math.abs(cents) <= CENTS_PERFECT ? 'In tune' : `${cents > 0 ? '+' : '−'}${Math.abs(Math.round(cents))}¢`}
                </Num>
              </Row><Rule />
            </View>;
          })}
        </Stack>
        </View>
        <Stack padY={20} gap={10}>
          <LevelMeter level={pitch.level} height={16} label="Microphone input" />
          {pitch.mic.error === null ? null : <Body size={13} color={chrome.accent}>{pitch.mic.error}</Body>}
          <Body size={13} color={chrome.dim}>Make small adjustments, then check all four strings again.</Body>
        </Stack>
      </Screen>
    </Screen>
  );
}

function verdictWord(verdict: string | null): string {
  switch (verdict) {
    case 'perfect': return 'IN TUNE';
    case 'flat': return 'FLAT';
    case 'sharp': return 'SHARP';
    case 'miss': return 'OUT';
    default: return 'LISTENING';
  }
}
