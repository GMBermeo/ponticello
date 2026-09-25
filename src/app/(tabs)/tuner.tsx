import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { usePitch, usePitchReading } from '@audio';
import {
  Body, Card, LevelMeter, OpenStringList, Screen, Stack, TabHeader, TunerDial,
} from '@components';
import { A4_HZ } from '@domain';
import { useTheme } from '@theme';

/**
 * Open-string tuner.
 *
 * Runs the same dual-rate engine the play screens use, on purpose: if the
 * tuner and the practice feedback disagreed about a low C, the player would
 * have no way of knowing which to believe. One pitch path, one answer.
 *
 * Since 1.8 the tuner is a tab, and the tab bar mounts its screens before
 * they are shown. On iOS merely creating the audio stream asks for the
 * microphone, so the live part is rendered only while the tab is focused:
 * opening the app never prompts, and leaving the tab releases the mic.
 */
export default function TunerScreen() {
  const focused = useIsFocused();
  return (
    <Screen scroll={false} padded={false}>
      <TabHeader title="Tuner" subtitle={`Bow one open string at a time, starting with low C · A = ${A4_HZ} Hz`} />
      {focused ? <LiveTuner /> : null}
    </Screen>
  );
}

function LiveTuner() {
  const theme = useTheme();
  const { chrome } = theme;
  const [micEnabled, setMicEnabled] = useState(Platform.OS !== 'web');
  const pitch = usePitch(micEnabled, { tunerMode: true });

  // No target — report whatever is sounding, and let the player aim at it.
  useEffect(() => { pitch.setTarget(null); }, [pitch]);

  const reading = usePitchReading(pitch);

  return (
    <ScrollView contentContainerStyle={{ gap: theme.s(14), paddingHorizontal: theme.s(16), paddingBottom: theme.s(28) }}>
      <View style={{ flexDirection: theme.scale.compact ? 'column' : 'row', gap: theme.s(14) }}>
        <Card style={{ flex: theme.scale.compact ? undefined : 1 }}>
          <TunerDial pitch={pitch} reading={reading} micEnabled={micEnabled} onEnableMic={() => setMicEnabled(true)} />
        </Card>
        <Card style={{ flex: theme.scale.compact ? undefined : 1 }}>
          <OpenStringList reading={reading} />
        </Card>
      </View>
      <Card>
        <Stack gap={10}>
          <LevelMeter level={pitch.level} height={16} label="Microphone input" />
          {pitch.mic.error === null ? null : <Body size={13} color={chrome.accent}>{pitch.mic.error}</Body>}
          <Body size={13} color={chrome.dim}>Make small adjustments, then check all four strings again.</Body>
        </Stack>
      </Card>
    </ScrollView>
  );
}
