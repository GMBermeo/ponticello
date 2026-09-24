import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@theme';
import { Label } from '../ui';

/**
 * Input level meter, shared by the tuner screen and the play screen's tuner
 * strip. Each bar's opacity rides the level shared value, so it moves every
 * audio frame without a React render.
 */

const BAR_COUNT = 14;

export const LevelMeter = memo(function LevelMeter({
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
});

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
          height: height * (0.4 + 0.6 * ((index + 1) / BAR_COUNT)),
          borderRadius: theme.s(1),
          backgroundColor: theme.chrome.ink,
        },
        style,
      ]}
    />
  );
}
