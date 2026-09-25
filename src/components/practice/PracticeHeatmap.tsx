import { useCallback, useRef } from 'react';
import { ScrollView, View } from 'react-native';

import { formatDuration, HeatCell, heatGrid, PracticeLog } from '@domain';
import { useTheme, alpha } from '@theme';
import { Label, Row } from '../ui';

/**
 * The practice grid.
 *
 * One square per day, seven to a column, newest column on the right — the
 * contribution graph, because it is the one chart people already know how to
 * read and because what it says is exactly what a beginner needs told: the
 * unbroken run matters more than any single day's length.
 *
 * Shade is minutes, not sessions. Four steps at 10, 20 and 30 minutes, so a
 * short honest practice still shows up and half an hour fills the square.
 */

/** Square size and spacing, in design units. */
const CELL = 11;
const GAP = 3;

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

export interface PracticeHeatmapProps {
  log: PracticeLog;
  today?: Date;
  weeks?: number;
}

export function PracticeHeatmap({ log, today = new Date(), weeks = 27 }: PracticeHeatmapProps) {
  const theme = useTheme();
  const { chrome } = theme;
  const scroller = useRef<ScrollView>(null);

  const grid = heatGrid(log, today, weeks);
  const cell = theme.s(CELL);
  const gap = theme.s(GAP);
  const column = cell + gap;

  // The newest week is the one you came to look at, so the grid arrives
  // scrolled to its right-hand edge on a screen too narrow to hold it all.
  const onContentSizeChange = useCallback(() => {
    scroller.current?.scrollToEnd({ animated: false });
  }, []);

  return (
    <View>
      <Row gap={6} style={{ alignItems: 'flex-start' }}>
        {/* Day-of-week rail, fixed while the grid scrolls under the months. */}
        <View style={{ paddingTop: theme.s(16) }}>
          {DAY_LABELS.map((label, index) => (
            <View key={index} style={{ height: column, justifyContent: 'center', minWidth: theme.s(24) }}>
              <Label size={9}>{label}</Label>
            </View>
          ))}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={onContentSizeChange}
        >
          <View>
            {/* Month labels, each over the column its month begins in. */}
            <View style={{ height: theme.s(16), width: grid.weeks.length * column }}>
              {grid.months.map((month) => (
                <View key={`${month.label}-${month.column}`} style={{ position: 'absolute', left: month.column * column }}>
                  <Label size={9}>{month.label}</Label>
                </View>
              ))}
            </View>

            <Row gap={gap} style={{ alignItems: 'flex-start' }}>
              {grid.weeks.map((week, index) => (
                <View key={index} style={{ gap }}>
                  {week.map((day) => (
                    <HeatSquare key={day.key} day={day} size={cell} />
                  ))}
                </View>
              ))}
            </Row>
          </View>
        </ScrollView>
      </Row>

      <Row gap={6} style={{ alignItems: 'center', marginTop: theme.s(10) }}>
        <Label size={9}>Less</Label>
        {[0, 1, 2, 3, 4].map((level) => (
          <View
            key={level}
            style={{
              width: cell,
              height: cell,
              borderRadius: theme.s(2),
              backgroundColor: shadeFor(level as HeatCell['level'], chrome.notes.green, chrome.lineSoft),
            }}
          />
        ))}
        <Label size={9}>More</Label>
        <Label size={9} style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
          A full square is 30 minutes
        </Label>
      </Row>
    </View>
  );
}

function HeatSquare({ day, size }: { day: HeatCell; size: number }) {
  const theme = useTheme();
  const { chrome } = theme;
  if (day.future) {
    return <View style={{ width: size, height: size }} />;
  }
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={day.ms > 0
        ? `${day.key}: ${formatDuration(day.ms)} practised`
        : `${day.key}: no practice`}
      style={{
        width: size,
        height: size,
        borderRadius: theme.s(2),
        backgroundColor: shadeFor(day.level, chrome.notes.green, chrome.lineSoft),
      }}
    />
  );
}

/** Empty days take the chrome's own soft line; the rest are four steps of green. */
function shadeFor(level: HeatCell['level'], green: string, empty: string): string {
  switch (level) {
    case 0: return empty;
    case 1: return alpha(green, 0.3);
    case 2: return alpha(green, 0.52);
    case 3: return alpha(green, 0.76);
    case 4: return green;
  }
}
