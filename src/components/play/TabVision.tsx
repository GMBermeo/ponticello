import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import {
  DISPLAY_STRING_ORDER, OPEN_STRING_MIDI, CelloNote, CelloSongScore, TapeSet, tapeForSemitones,
} from '@domain';
import { FlowAxis } from '@state';
import { Theme, useTheme, alpha, type Chrome } from '@theme';
import { Label, Num } from '../ui';
import { flowWindow, laneGeometry, timeAlongOffset, visibleSlice } from './flow';
import { Playhead, usePlayheadPosition } from './usePlayhead';

/**
 * Tab vision — a four-line stave, one line per string, with finger numbers on
 * it. The default, because it is the only vision that shows the *hand* rather
 * than the pitch: a beginner reading "3 on the D line" has an instruction they
 * can act on, where a notehead on a bass clef still needs translating.
 *
 * The playhead sits a quarter of the way in rather than in the middle. That is a
 * latency decision, not an aesthetic one — feedback on a low C arrives up to
 * 60 ms after the bow, so the display has to show more of what is coming than of
 * what has gone.
 *
 * ## Two axes
 *
 * `horizontal` is the stave: time runs left to right, the low C string is the
 * bottom line, and the music travels leftward under a fixed playhead.
 * `vertical` turns the stave on its side — the four strings become columns with
 * C on the left, and the notes fall from the top onto a playhead near the
 * bottom, matching the highway. Both keep the same invariant as the fingerboard
 * panel beside them: the pitch axis points up, or right.
 *
 * ## Why only some notes are drawn
 *
 * This laid out every note, every bar line and every position bracket in the
 * piece, from the first frame. On `les-miserables-theme` — 519 seconds — that is
 * thousands of mounted views for the two seconds of them that are on screen, and
 * it was a major cause of playback stutter. Everything below is now windowed to
 * what is nearly visible.
 */

const ROW_HEIGHT = 38;
const PX_PER_MS = 0.2;
const PLAYHEAD_FRACTION = 0.25;
/** Falling: the playhead sits low, so most of the box is what is coming. */
const PLAYHEAD_FRACTION_VERTICAL = 0.72;
const BADGE = { width: 32, height: 27 };
const LANE_GAP = 12;

export interface TabVisionProps {
  score: CelloSongScore;
  playhead: Playhead;
  tapeSets: readonly TapeSet[];
  showFingerings: boolean;
  height: number;
  width: number;
  axis?: FlowAxis;
}

export const TabVision = memo(function TabVision({
  score, playhead, tapeSets, showFingerings, height, width, axis = 'horizontal',
}: TabVisionProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const vertical = axis === 'vertical';
  const pxPerMs = theme.s(PX_PER_MS);

  /** Extent along the time axis, and across the four strings. */
  const timeExtent = vertical ? height : width;
  const crossExtent = vertical ? width : height;

  const hitAt = timeExtent * (vertical ? PLAYHEAD_FRACTION_VERTICAL : PLAYHEAD_FRACTION);

  // Horizontal keeps the hand-tuned stave metrics: the four lines open out to
  // fill the box rather than sitting in a fixed block at the top, because on the
  // Fold's tall play area a phone-sized stave leaves two thirds of the screen
  // empty and every badge smaller than it needs to be. Vertical hands the cross
  // axis to `laneGeometry` instead, so it agrees with the highway by construction.
  const rowHeight = Math.max(theme.s(30), Math.min(theme.s(76), crossExtent * 0.15));
  const staveHeight = rowHeight * 3;
  const staveTop = Math.max(theme.s(64), (crossExtent - staveHeight) / 2);

  const lanes = laneGeometry('vertical', crossExtent, theme.s(LANE_GAP));

  /** Cross-axis offset of a string's line or column. */
  const laneAt = (string: string) => (vertical
    ? lanes.laneAt(string as never) + lanes.laneSize / 2
    // Horizontal: row 0 is the A string (top) and row 3 is the C string (bottom).
    : staveTop + Math.max(0, DISPLAY_STRING_ORDER.indexOf(string as never)) * rowHeight);

  /** Time-axis offset of a score time, at time zero. */
  const alongAt = (ms: number) => timeAlongOffset(ms, axis, hitAt, pxPerMs);

  /** Labels and rules that sit just off the stave, on the cross axis. */
  const bracketOffset = vertical ? theme.s(30) : theme.s(42);
  const barLabelOffset = vertical ? theme.s(14) : theme.s(24);

  const position = usePlayheadPosition(playhead);
  const anchorMs = position.windowMs;
  const visibleMs = timeExtent / pxPerMs;
  const window = useMemo(
    () => flowWindow(
      anchorMs,
      Math.max(visibleMs, 2000),
      vertical ? PLAYHEAD_FRACTION_VERTICAL : 1 - PLAYHEAD_FRACTION,
    ),
    [anchorMs, visibleMs, vertical],
  );

  const laid = useMemo(() => {
    const { from, to } = visibleSlice(score.notes, window);
    const out = [];
    for (let index = from; index < to; index++) {
      const note = score.notes[index];
      out.push({
        note,
        index,
        along: alongAt(note.startTimeMs),
        lane: laneAt(note.string),
        tapeColor: tapeColorFor(note, tapeSets, theme),
      });
    }
    return out;
    // `alongAt` and `laneAt` are closures over the geometry already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, window, hitAt, pxPerMs, tapeSets, theme, vertical, staveTop, rowHeight, lanes]);

  /** Bar lines, windowed the same way as the notes. */
  const bars = useMemo(() => score.measures
    .filter((m) => m.startBarTimeMs + m.durationMs >= window.fromMs
      && m.startBarTimeMs <= window.toMs)
    .map((measure) => ({ index: measure.index, along: alongAt(measure.startBarTimeMs) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [score, window, hitAt, pxPerMs, vertical]);

  /**
   * Runs of consecutive notes in one position, drawn as a bracket.
   *
   * Computed over the *whole* score rather than the window, because a run's
   * label has to say which position the hand is in even when the run started
   * off screen — then filtered to what overlaps. The scan is O(notes) once per
   * score, memoised on the score alone, so it does not repeat as the window
   * moves.
   */
  const runs = useMemo(() => {
    const out: { key: string; fromMs: number; toMs: number; label: string; shift: boolean }[] = [];
    let start = 0;
    for (let i = 1; i <= score.notes.length; i++) {
      const ended = i === score.notes.length
        || score.notes[i].position !== score.notes[start].position;
      if (!ended) continue;
      const first = score.notes[start];
      const last = score.notes[i - 1];
      out.push({
        key: `${first.id}-bracket`,
        fromMs: first.startTimeMs,
        toMs: last.startTimeMs + last.durationMs,
        label: first.position === 'Thumb' ? 'THUMB POS' : `${first.position.toUpperCase()} POS`,
        shift: out.length > 0,
      });
      start = i;
    }
    return out;
  }, [score]);

  const brackets = useMemo(() => runs
    .filter((r) => r.toMs >= window.fromMs && r.fromMs <= window.toMs)
    .map((r) => ({ ...r, from: alongAt(r.fromMs), to: alongAt(r.toMs) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [runs, window, hitAt, pxPerMs, vertical]);

  const field = useAnimatedStyle(() => {
    const shift = playhead.timeMs.get() * pxPerMs;
    return { transform: vertical ? [{ translateY: shift }] : [{ translateX: -shift }] };
  });

  /** Cross-axis span the stave occupies, for rules that run its whole width. */
  const staveSpan = vertical
    ? { from: lanes.laneAt('A') + lanes.laneSize / 2, to: lanes.laneAt('C') + lanes.laneSize / 2 }
    : { from: staveTop, to: staveTop + staveHeight };

  return (
    <View style={{ height, width, overflow: 'hidden' }}>
      {/* Stave lines, one per string, tinted in that string's colour. */}
      {DISPLAY_STRING_ORDER.map((string) => {
        const lane = laneAt(string);
        return (
          <View key={string}>
            <View
              style={vertical
                ? {
                  position: 'absolute',
                  top: theme.s(20),
                  // An explicit height, not `bottom: 0`. These lines are wrapped
                  // in an unstyled `<View key={string}>`, which has no height of
                  // its own because everything inside it is absolutely
                  // positioned — so `bottom` had nothing to measure against and
                  // the four string columns rendered zero pixels tall. The
                  // horizontal branch never showed this because its `height` is
                  // stated outright.
                  height: Math.max(0, timeExtent - theme.s(20)),
                  left: lane,
                  width: theme.rule(2),
                  backgroundColor: chrome.strings[string],
                  opacity: 0.85,
                }
                : {
                  position: 'absolute',
                  left: theme.s(20),
                  right: 0,
                  top: lane,
                  height: theme.rule(2),
                  backgroundColor: chrome.strings[string],
                  opacity: 0.85,
                }}
            />
            <View
              style={vertical
                ? { position: 'absolute', left: lane - theme.s(3), top: 0 }
                : { position: 'absolute', left: 0, top: lane - theme.s(9) }}
            >
              <Num size={13} color={chrome.strings[string]}>{string}</Num>
            </View>
          </View>
        );
      })}

      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, field]}>
        {/* Bar lines and numbers. */}
        {bars.map((bar) => (
          <View key={`bar-${bar.index}`}>
            <View
              style={vertical
                ? {
                  position: 'absolute',
                  top: bar.along,
                  left: staveSpan.from - theme.s(10),
                  height: theme.rule(1),
                  width: staveSpan.to - staveSpan.from + theme.s(20),
                  backgroundColor: chrome.lineSoft,
                }
                : {
                  position: 'absolute',
                  left: bar.along - theme.s(12),
                  top: staveSpan.from - theme.s(8),
                  width: theme.rule(1),
                  height: staveHeight + theme.s(16),
                  backgroundColor: chrome.lineSoft,
                }}
            />
            <View
              style={vertical
                ? { position: 'absolute', top: bar.along - theme.s(6), left: staveSpan.to + barLabelOffset }
                : { position: 'absolute', left: bar.along - theme.s(10), top: staveSpan.from - barLabelOffset }}
            >
              <Label size={10}>{`m.${bar.index + 1}`}</Label>
            </View>
          </View>
        ))}

        {/* Position brackets. */}
        {brackets.map((bracket) => {
          const span = Math.max(theme.s(20), Math.abs(bracket.to - bracket.from) + theme.s(20));
          const head = Math.min(bracket.from, bracket.to) - theme.s(14);
          return (
            <View key={bracket.key}>
              <View
                style={vertical
                  ? {
                    position: 'absolute',
                    top: head,
                    height: span,
                    left: staveSpan.from - bracketOffset,
                    width: theme.s(12),
                    borderTopWidth: theme.rule(2),
                    borderBottomWidth: theme.rule(2),
                    borderLeftWidth: theme.rule(2),
                    borderColor: bracket.shift ? chrome.accent : chrome.line,
                  }
                  : {
                    position: 'absolute',
                    left: head,
                    width: span,
                    top: staveSpan.from - bracketOffset,
                    height: theme.s(12),
                    borderLeftWidth: theme.rule(2),
                    borderRightWidth: theme.rule(2),
                    borderTopWidth: theme.rule(2),
                    borderColor: bracket.shift ? chrome.accent : chrome.line,
                  }}
              />
              <View
                style={vertical
                  ? {
                    position: 'absolute',
                    top: head + theme.s(2),
                    left: staveSpan.from - bracketOffset - theme.s(2),
                    backgroundColor: chrome.bg,
                  }
                  : {
                    position: 'absolute',
                    left: head + theme.s(4),
                    top: staveSpan.from - bracketOffset - theme.s(12),
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
          );
        })}

        {/* Finger badges. */}
        {laid.map((item) => (
          <TabBadge
            key={item.note.id}
            note={item.note}
            along={item.along}
            lane={item.lane}
            vertical={vertical}
            tapeColor={item.tapeColor}
            showFinger={showFingerings}
            active={item.index === position.activeIndex}
            played={item.index < position.activeIndex}
          />
        ))}
      </Animated.View>

      {/* The playhead is fixed; the music moves under it. */}
      <View
        style={vertical
          ? {
            position: 'absolute',
            top: hitAt,
            left: 0,
            right: 0,
            height: theme.rule(2),
            backgroundColor: chrome.accent,
          }
          : {
            position: 'absolute',
            left: hitAt,
            top: 0,
            bottom: 0,
            width: theme.rule(2),
            backgroundColor: chrome.accent,
          }}
      />
    </View>
  );
});

type BadgeColors = { background: string; border: string; ink: string };

/** A taped note wears its tape; otherwise the badge follows the string colour and the note's state. */
function tabBadgeColors(chrome: Chrome, stringColor: string, tapeColor: string | null, active: boolean, played: boolean): BadgeColors {
  if (tapeColor !== null) {
    const ink = tapeTextColor(tapeColor);
    const lightInkBorder = ink === '#000000' ? chrome.line : '#FFFFFF';
    return { background: tapeColor, border: chrome.dark ? '#FFFFFF' : lightInkBorder, ink };
  }
  if (active) return { background: stringColor, border: stringColor, ink: chrome.bg };
  if (played) return { background: chrome.bg, border: chrome.lineSoft, ink: chrome.dim };
  return { background: chrome.bg, border: stringColor, ink: stringColor };
}

const TabBadge = memo(function TabBadge({
  note, along, lane, vertical, tapeColor, showFinger, active, played,
}: {
  note: CelloNote;
  /** Time-axis offset at time zero. */
  along: number;
  /** Cross-axis offset — the centre of the string's line or column. */
  lane: number;
  vertical: boolean;
  tapeColor: string | null;
  showFinger: boolean;
  active: boolean;
  played: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const stringColor = chrome.strings[note.string];
  const w = theme.s(BADGE.width);
  const h = theme.s(BADGE.height);

  const fret = Math.max(0, note.midiNumber - OPEN_STRING_MIDI[note.string]);
  const colors = tabBadgeColors(chrome, stringColor, tapeColor, active, played);

  return (
    <View
      style={{
        position: 'absolute',
        left: (vertical ? lane : along) - w / 2,
        top: (vertical ? along : lane) - h / 2,
        width: w,
        height: h,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        borderWidth: theme.rule(2),
        borderColor: colors.border,
        opacity: played ? 0.45 : 1,
      }}
    >
      <Num size={13} color={colors.ink}>
        {showFinger ? fret : '·'}
      </Num>
      {note.bowDirection === 'down' || note.bowDirection === 'up' ? (
        <View
          style={vertical
            ? { position: 'absolute', left: theme.s(-16) }
            : { position: 'absolute', top: theme.s(-14) }}
        >
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

/**
 * Text colour for numbers drawn over a solid tape fill. Chooses black or white
 * based on the relative luminance of the tape colour so the number is always legible.
 */
function tapeTextColor(hex: string): string {
  const raw = hex.replace('#', '');
  const h = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.18 ? '#000000' : '#FFFFFF';
}

/** Exported for the tutorial, which draws a still frame of this stave. */
export const TAB_METRICS = { ROW_HEIGHT, PX_PER_MS, PLAYHEAD_FRACTION, BADGE, alpha };
