import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { OPEN_STRING_MIDI, STRING_ORDER } from '@/domain/cello';
import { CelloNote, CelloSongScore } from '@/domain/schema';
import { TapeSet, tapeForSemitones } from '@/domain/tapes';
import { Theme, useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';
import { Label, Num } from '../ui/primitives';
import { Playhead } from './usePlayhead';

/**
 * Tab vision — a four-line stave, one line per string, with finger numbers on
 * it. The default, because it is the only vision that shows the *hand* rather
 * than the pitch: a beginner reading "3 on the D line" has an instruction they
 * can act on, where a notehead on a bass clef still needs translating.
 *
 * Time runs left to right and the playhead sits a quarter of the way in, not
 * in the middle. That is a latency decision, not an aesthetic one — feedback
 * on a low C arrives up to 60 ms after the bow, so the display has to show
 * more of what is coming than of what has gone.
 */

const ROW_HEIGHT = 38;
const PX_PER_MS = 0.2;
const PLAYHEAD_FRACTION = 0.25;
const BADGE = { width: 32, height: 27 };

export interface TabVisionProps {
  score: CelloSongScore;
  playhead: Playhead;
  tapeSets: readonly TapeSet[];
  showFingerings: boolean;
  height: number;
  width: number;
}

export function TabVision({
  score, playhead, tapeSets, showFingerings, height, width,
}: TabVisionProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const drawHeight = height;
  const drawWidth = width;
  const pxPerMs = theme.s(PX_PER_MS);
  const playheadX = drawWidth * PLAYHEAD_FRACTION;

  // The four lines open out to fill the box rather than sitting in a fixed
  // block at the top: on the Fold 5's tall play area a phone-sized stave
  // leaves two thirds of the screen empty and every badge smaller than it
  // needs to be.
  const rowHeight = Math.max(theme.s(30), Math.min(theme.s(76), drawHeight * 0.15));
  const staveHeight = rowHeight * 3;
  const staveTop = Math.max(theme.s(64), (drawHeight - staveHeight) / 2);
  const bracketY = staveTop - theme.s(42);
  const bracketLabelY = staveTop - theme.s(54);
  const barLabelY = staveTop - theme.s(24);

  const rowY = (index: number) => staveTop + index * rowHeight;

  const laid = useMemo(() => score.notes.map((note, index) => ({
    note,
    index,
    x: playheadX + note.startTimeMs * pxPerMs,
    y: staveTop + (3 - Math.max(0, STRING_ORDER.indexOf(note.string))) * rowHeight,
    tapeColor: tapeColorFor(note, tapeSets, theme),
  })), [score, playheadX, pxPerMs, tapeSets, theme, staveTop, rowHeight]);

  const bars = useMemo(() => score.measures.map((measure) => ({
    index: measure.index,
    x: playheadX + measure.startBarTimeMs * pxPerMs,
  })), [score, playheadX, pxPerMs]);

  /** Runs of consecutive notes in one position, drawn as a bracket above. */
  const brackets = useMemo(() => {
    const out: { key: string; from: number; to: number; label: string; shift: boolean }[] = [];
    let start = 0;
    for (let i = 1; i <= score.notes.length; i++) {
      const ended = i === score.notes.length || score.notes[i].position !== score.notes[start].position;
      if (!ended) continue;
      const first = score.notes[start];
      const last = score.notes[i - 1];
      out.push({
        key: `${first.id}-bracket`,
        from: playheadX + first.startTimeMs * pxPerMs,
        to: playheadX + (last.startTimeMs + last.durationMs) * pxPerMs,
        label: first.position === 'Thumb' ? 'THUMB POS' : `${first.position.toUpperCase()} POS`,
        shift: out.length > 0,
      });
      start = i;
    }
    return out;
  }, [score, playheadX, pxPerMs]);

  const field = useAnimatedStyle(() => ({
    transform: [{ translateX: -playhead.timeMs.get() * pxPerMs }],
  }));

  return (
    <View style={{ height: drawHeight, width: drawWidth, overflow: 'hidden' }}>
      {/* Stave lines, one per string, tinted in that string's colour. */}
      {STRING_ORDER.map((string, index) => {
        const y = rowY(3 - index);
        return (
          <View key={string}>
            <View
              style={{
                position: 'absolute',
                left: theme.s(20),
                right: 0,
                top: y,
                height: theme.rule(2),
                backgroundColor: chrome.strings[string],
                opacity: 0.85,
              }}
            />
            <View style={{ position: 'absolute', left: 0, top: y - theme.s(9) }}>
              <Num size={13} color={chrome.strings[string]}>{string}</Num>
            </View>
          </View>
        );
      })}

      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0 }, field]}>
        {/* Bar lines and numbers. */}
        {bars.map((bar) => (
          <View key={`bar-${bar.index}`}>
            <View
              style={{
                position: 'absolute',
                left: bar.x - theme.s(12),
                top: staveTop - theme.s(8),
                width: theme.rule(1),
                height: staveHeight + theme.s(16),
                backgroundColor: chrome.lineSoft,
              }}
            />
            <View style={{ position: 'absolute', left: bar.x - theme.s(10), top: barLabelY }}>
              <Label size={10}>{`m.${bar.index + 1}`}</Label>
            </View>
          </View>
        ))}

        {/* Position brackets. */}
        {brackets.map((bracket) => (
          <View key={bracket.key}>
            <View
              style={{
                position: 'absolute',
                left: bracket.from - theme.s(14),
                width: Math.max(theme.s(20), bracket.to - bracket.from + theme.s(20)),
                top: bracketY,
                height: theme.s(12),
                borderLeftWidth: theme.rule(2),
                borderRightWidth: theme.rule(2),
                borderTopWidth: theme.rule(2),
                borderColor: bracket.shift ? chrome.accent : chrome.line,
              }}
            />
            <View
              style={{
                position: 'absolute',
                left: bracket.from - theme.s(10),
                top: bracketLabelY,
                backgroundColor: chrome.bg,
                paddingRight: theme.s(5),
              }}
            >
              <Label
                size={10}
                numberOfLines={1}
                color={bracket.shift ? chrome.accent : chrome.dim}
              >
                {bracket.label}
              </Label>
            </View>
          </View>
        ))}

        {/* Finger badges. */}
        {laid.map((item) => (
          <TabBadge
            key={item.note.id}
            note={item.note}
            x={item.x}
            y={item.y}
            tapeColor={item.tapeColor}
            showFinger={showFingerings}
            active={item.index === playhead.activeIndex}
            played={item.index < playhead.activeIndex}
          />
        ))}
      </Animated.View>

      {/* The playhead is fixed; the music moves under it. */}
      <View
        style={{
          position: 'absolute',
          left: playheadX,
          top: 0,
          bottom: 0,
          width: theme.rule(2),
          backgroundColor: chrome.accent,
        }}
      />
    </View>
  );
}

const TabBadge = memo(function TabBadge({
  note, x, y, tapeColor, showFinger, active, played,
}: {
  note: CelloNote;
  x: number;
  y: number;
  tapeColor: string | null;
  showFinger: boolean;
  active: boolean;
  played: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const stringColor = chrome.strings[note.string];

  return (
    <View
      style={{
        position: 'absolute',
        left: x - theme.s(BADGE.width / 2),
        top: y - theme.s(BADGE.height / 2),
        width: theme.s(BADGE.width),
        height: theme.s(BADGE.height),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? stringColor : chrome.bg,
        borderWidth: theme.rule(2),
        borderColor: played ? chrome.lineSoft : stringColor,
        opacity: played ? 0.45 : 1,
      }}
    >
      {/* Tape colour as an underline, so it reads without crowding the number. */}
      {tapeColor === null ? null : (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: theme.s(4),
            backgroundColor: tapeColor,
          }}
        />
      )}
      <Num size={13} color={active ? chrome.bg : (played ? chrome.dim : stringColor)}>
        {showFinger ? note.finger : '·'}
      </Num>
      {note.bowDirection === 'down' || note.bowDirection === 'up' ? (
        <View style={{ position: 'absolute', top: theme.s(-14) }}>
          <BowMark direction={note.bowDirection} color={played ? chrome.lineSoft : chrome.dim} />
        </View>
      ) : null}
    </View>
  );
});

/** ⊓ for a down bow, V for an up bow — the standard marks. */
function BowMark({ direction, color }: { direction: 'down' | 'up'; color: string }) {
  const theme = useTheme();
  if (direction === 'up') return <Num size={11} color={color}>V</Num>;
  return (
    <View
      style={{
        width: theme.s(12),
        height: theme.s(7),
        borderLeftWidth: theme.rule(1.5),
        borderRightWidth: theme.rule(1.5),
        borderTopWidth: theme.rule(1.5),
        borderColor: color,
      }}
    />
  );
}

function tapeColorFor(
  note: CelloNote, tapeSets: readonly TapeSet[], theme: Theme,
): string | null {
  const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
  if (semitones === 0) return null;
  const tape = tapeForSemitones(tapeSets, semitones);
  return tape ? theme.chrome.tapes[tape.color] : null;
}

/** Exported for the tutorial, which draws a still frame of this stave. */
export const TAB_METRICS = { ROW_HEIGHT, PX_PER_MS, PLAYHEAD_FRACTION, BADGE, alpha };
