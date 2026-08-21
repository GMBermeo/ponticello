import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { CENTS_ACCEPTABLE, CENTS_PERFECT, IntonationVerdict } from '@/domain/cello';
import { useTheme } from '@/theme/ThemeProvider';
import { intonationColor } from '@/theme/tokens';
import { Label, Num } from '../ui/primitives';
import { useMeasuredSize } from '../useMeasuredSize';

/**
 * Cents rail — a vertical needle showing how far the sounding pitch is from
 * the note being aimed at.
 *
 * Deliberately damped, and deliberately *not* labelled below the perfect band.
 * The engine's own resolution is around a cent, but its latency on the low
 * strings is 60 ms; a needle that twitched at full speed would imply a
 * precision the pipeline does not have. The shaded band is the tolerance the
 * app actually judges by, so "inside the box" and "counted as in tune" are the
 * same statement.
 */

const RANGE = CENTS_ACCEPTABLE * 2; // ±60¢ across the full rail

export function CentsRail({
  cents, verdict, centsText, listening,
}: {
  cents: SharedValue<number>;
  verdict: IntonationVerdict | null;
  centsText: string;
  listening: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;

  // The rail measures itself rather than taking a height: it shares a column
  // with a label and a readout whose heights depend on the font metrics, and a
  // rail whose ticks disagree with its own box by even a few pixels reads as a
  // miscalibrated instrument.
  const [railSize, onRailLayout] = useMeasuredSize();
  const railHeight = railSize.height;
  const color = verdict ? intonationColor(verdict, chrome) : chrome.dim;

  /** Cents → offset down the rail. +60 at the top, −60 at the bottom. */
  const yFor = useCallback(
    (value: number) => ((RANGE - value) / (RANGE * 2)) * railHeight,
    [railHeight],
  );

  const needle = useAnimatedStyle(() => {
    const clamped = Math.max(-RANGE, Math.min(RANGE, cents.get()));
    return {
      transform: [{ translateY: ((RANGE - clamped) / (RANGE * 2)) * railHeight }],
    };
  });

  const ticks = useMemo(
    () => [RANGE, CENTS_PERFECT, 0, -CENTS_PERFECT, -RANGE].map((value) => ({
      value,
      y: yFor(value),
      label: Math.abs(value) === RANGE ? `${value > 0 ? '+' : '−'}${RANGE}` : '',
    })),
    [yFor],
  );

  return (
    <View style={{ flex: 1 }}>
      <Label size={10}>CENTS</Label>
      <Num size={26} color={listening ? color : chrome.dim} style={{ marginTop: theme.s(3) }}>
        {listening ? centsText : '—'}
      </Num>

      <View
        onLayout={onRailLayout}
        style={{
          flex: 1,
          marginTop: theme.s(8),
          borderLeftWidth: theme.rule(1),
          borderColor: chrome.line,
        }}
      >
        {/* The in-tune band, drawn to the same ±15¢ the judgement uses. */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: yFor(CENTS_PERFECT),
            height: yFor(-CENTS_PERFECT) - yFor(CENTS_PERFECT),
            backgroundColor: chrome.surface,
          }}
        />
        {railHeight === 0 ? null : ticks.map((tick) => (
          <View key={tick.value}>
            <View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: tick.y,
                height: theme.rule(1),
                backgroundColor: tick.value === 0 ? chrome.line : chrome.lineSoft,
              }}
            />
            {tick.label === '' ? null : (
              <View style={{ position: 'absolute', left: theme.s(4), top: tick.y - theme.s(6) }}>
                <Label size={9}>{tick.label}</Label>
              </View>
            )}
          </View>
        ))}

        {listening && railHeight > 0 ? (
          <Animated.View
            style={[
              { position: 'absolute', left: 0, right: 0, top: 0 },
              needle,
            ]}
          >
            <View style={{ height: theme.rule(3), backgroundColor: color }} />
          </Animated.View>
        ) : null}
      </View>

      <Label size={10} color={listening ? color : chrome.dim} style={{ marginTop: theme.s(5) }}>
        {!listening ? 'NO INPUT' : verdictWord(verdict)}
      </Label>
    </View>
  );
}

function verdictWord(verdict: IntonationVerdict | null): string {
  switch (verdict) {
    case 'perfect': return 'IN TUNE';
    case 'flat': return 'FLAT';
    case 'sharp': return 'SHARP';
    case 'miss': return 'OFF';
    default: return 'LISTENING';
  }
}

// ─── Level meter ─────────────────────────────────────────────────────────────

const BAR_COUNT = 14;

/**
 * Input level, as a row of bars that fill from the left. Driven straight off
 * the shared value on the UI thread — it is the one thing on screen that
 * should react instantly, because it answers "is the microphone even hearing
 * me" before any pitch question arises.
 */
export function LevelMeter({
  level, height = 14, label,
}: { level: SharedValue<number>; height?: number; label?: string }) {
  const theme = useTheme();
  const bars = useMemo(() => Array.from({ length: BAR_COUNT }, (_, i) => i), []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.s(2) }}>
      {bars.map((index) => (
        <LevelBar key={index} index={index} level={level} height={theme.s(height)} />
      ))}
      {label === undefined ? null : (
        <Label size={10} style={{ marginLeft: theme.s(8) }}>{label}</Label>
      )}
    </View>
  );
}

function LevelBar({
  index, level, height,
}: { index: number; level: SharedValue<number>; height: number }) {
  const theme = useTheme();
  const threshold = (index + 1) / BAR_COUNT;

  const style = useAnimatedStyle(() => ({
    opacity: level.get() >= threshold ? 1 : 0.18,
  }));

  return (
    <Animated.View
      style={[
        {
          width: theme.s(4),
          // A rising ramp reads as a meter even before it lights up.
          height: height * (0.4 + 0.6 * ((index + 1) / BAR_COUNT)),
          backgroundColor: theme.chrome.ink,
        },
        style,
      ]}
    />
  );
}
