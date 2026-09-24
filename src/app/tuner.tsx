import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { usePitch, usePitchReading } from '@audio';
import {
  Body, LevelMeter, OpenStringList, Screen, ScreenHeader, Stack, Title, TunerDial,
} from '@components';
import { A4_HZ } from '@domain';
import { useTheme } from '@theme';

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

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta={`A = ${A4_HZ} Hz`} />
      <Screen>
        <Stack padY={24} gap={8}>
          <Title accessibilityRole="header" size={30}>Tune your cello</Title>
          <Body size={15} color={chrome.dim}>Bow one open string at a time, starting with low C.</Body>
        </Stack>
        <View style={{ flexDirection: theme.scale.compact ? 'column' : 'row', gap: theme.s(24) }}>
          <TunerDial pitch={pitch} reading={reading} micEnabled={micEnabled} onEnableMic={() => setMicEnabled(true)} />
          <OpenStringList reading={reading} />
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
