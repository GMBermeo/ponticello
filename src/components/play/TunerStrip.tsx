import { memo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { LivePitch, usePitchReading } from '@audio';
import { CENTS_PERFECT, formatCents } from '@domain';
import { useTheme, alpha, intonationColor } from '@theme';
import { dialPercent, TUNER_SPAN_CENTS } from '../tuner';
import { Button, Label, Num, Title } from '../ui';
import { useMeasuredSize } from '../useMeasuredSize';
import { LevelMeter } from './Meters';

export interface TunerStripProps {
  pitch: LivePitch;
  /** False on web until the player grants the microphone from a gesture. */
  micEnabled: boolean;
  onEnableMic: () => void;
}

/**
 * The paused-state tuner, laid across the top of the play area.
 *
 * The microphone has one job on this screen now: tuning, while the transport
 * is stopped. Live intonation during playback was removed — nobody reads a
 * needle mid-phrase, and the pitch engine running beside the note field cost
 * frames on exactly the devices that could least spare them. So the tuner is
 * only ever mounted while paused, and it reads the note you are *sounding*
 * against its nearest semitone, like any tuner, rather than against the score.
 *
 * Horizontal because the play area is wide and short in landscape, and a
 * left-to-right flat/sharp bar is the tuner everyone already knows how to read.
 * The needle rides a shared value on a transform, so it moves every audio
 * frame without re-rendering; only the note name and cents text are React.
 */
export const TunerStrip = memo(function TunerStrip({
  pitch, micEnabled, onEnableMic,
}: TunerStripProps) {
  const theme = useTheme();
  const { chrome } = theme;
  const reading = usePitchReading(pitch);
  const [bar, onBarLayout, barRef] = useMeasuredSize();

  const live = micEnabled && pitch.mic.live;
  const voiced = live && reading.voiced;
  const color = voiced && reading.verdict ? intonationColor(reading.verdict, chrome) : chrome.dim;
  const width = bar.width;

  const needle = useAnimatedStyle(() => {
    const clamped = Math.max(-TUNER_SPAN_CENTS, Math.min(TUNER_SPAN_CENTS, pitch.cents.get()));
    return { transform: [{ translateX: (dialPercent(clamped) / 100) * width }] };
  });

  const centsText = voiced ? formatCents(reading.cents) : '—';
  const inTuneInset = `${dialPercent(-CENTS_PERFECT)}%` as const;
  let status = 'Starting microphone';
  if (voiced) status = `${reading.frequency.toFixed(1)} Hz`;
  else if (live) status = 'Listening';

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={voiced ? `Tuner: ${reading.heard}, ${centsText}` : 'Tuner'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.s(14),
        paddingHorizontal: theme.s(14),
        paddingVertical: theme.s(8),
        borderRadius: theme.s(12),
        backgroundColor: alpha(chrome.surface, 0.94),
        borderWidth: theme.rule(1),
        borderColor: chrome.lineSoft,
      }}
    >
      <View style={{ minWidth: theme.s(58) }}>
        <Label size={9}>Tuner</Label>
        <Title size={24} color={voiced ? chrome.ink : chrome.dim} numberOfLines={1}>
          {voiced ? reading.heard : '—'}
        </Title>
      </View>

      {micEnabled ? (
        <>
          <View style={{ flex: 1, minWidth: theme.s(80), gap: theme.s(4) }}>
            <View
              ref={barRef}
              onLayout={onBarLayout}
              style={{ height: theme.s(22), justifyContent: 'center' }}
            >
              <View style={{ position: 'absolute', left: 0, right: 0, height: theme.rule(2), backgroundColor: chrome.lineSoft, borderRadius: theme.s(1) }} />
              <View style={{
                position: 'absolute', left: inTuneInset, right: inTuneInset,
                top: 0, bottom: 0, borderRadius: theme.s(4), backgroundColor: alpha(chrome.accent, 0.16),
              }} />
              <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: theme.rule(1), backgroundColor: chrome.line }} />
              {voiced && width > 0 ? (
                <Animated.View
                  style={[{
                    position: 'absolute', left: -theme.s(2), top: 0, bottom: 0,
                    width: theme.s(4), borderRadius: theme.s(2), backgroundColor: color,
                  }, needle]}
                />
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Label size={9}>Flat</Label>
              <Label size={9}>{status}</Label>
              <Label size={9}>Sharp</Label>
            </View>
          </View>
          <Num size={20} color={color} style={{ minWidth: theme.s(52), textAlign: 'right' }}>{centsText}</Num>
          <LevelMeter level={pitch.level} height={12} />
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.s(12) }}>
          <Label size={11} style={{ flex: 1, textTransform: 'none', letterSpacing: 0 }}>
            Tune while paused. The microphone switches off when you press play.
          </Label>
          <Button label="Enable microphone" tone="accent" onPress={onEnableMic} />
        </View>
      )}
    </View>
  );
});
