import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { CelloNote, CelloSongScore } from '@/domain/schema';
import { OPEN_STRING_MIDI, STRING_ORDER } from '@/domain/cello';
import { TapeSet, tapeForSemitones } from '@/domain/tapes';
import { FlowAxis } from '@/state/settings';
import { Theme, useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';
import { Label, Num } from '../ui/primitives';
import { flowWindow, laneGeometry, visibleSlice } from './flow';
import { Playhead } from './usePlayhead';

/**
 * Highway vision — notes travel down four string lanes to a hit line.
 *
 * One deliberate departure from the original mock, which drew fingerboard
 * position rules across the highway: here the time axis is **time and nothing
 * else**. A highway whose long axis means distance-from-nut in the background
 * and seconds-until-you-play-it in the foreground cannot be read at speed. The
 * tape a note lands on travels *with the note* instead, as a coloured edge on
 * its capsule, and the fingerboard panel beside the highway keeps the distance
 * axis where it belongs.
 *
 * ## Two axes
 *
 * `vertical` is the falling highway most people arrive already knowing. In
 * `horizontal` the lanes become rows with the **low C string at the bottom**,
 * and notes enter from the right and travel left to a hit line a quarter of the
 * way in — the Rocksmith arrangement, and the better one on a short wide screen
 * because four lanes get the full width instead of the full height.
 *
 * ## Why only some notes are drawn
 *
 * The field used to lay out every note in the score. On a nine-minute song that
 * is several thousand mounted views, re-reconciled on every parent render, and
 * it was the largest single cause of playback stutter — nothing to do with the
 * audio. Only the notes inside `flowWindow` are laid out now; the rest do not
 * exist until they are nearly on screen. The whole visible field is still moved
 * with a single transform, so scrolling costs one animated style per frame no
 * matter how dense the passage.
 */

/** How far ahead of the hit line a note appears. */
const LOOKAHEAD_MS = 2500;
/** Design units of highway per millisecond of lookahead. */
const PX_PER_MS = 0.16;

const LANE_GAP = 10;
/** Room before the lanes for the spawn label, and after them for string names. */
const HEADER = 26;
const FOOTER = 54;
/** Where the hit line sits along the time axis, as a fraction of the box. */
const HIT_FRACTION_HORIZONTAL = 0.26;

export interface HighwayProps {
  score: CelloSongScore;
  playhead: Playhead;
  tapeSets: readonly TapeSet[];
  showFingerings: boolean;
  /** Box height in device-independent pixels. */
  height: number;
  /** Box width in device-independent pixels. */
  width: number;
  axis?: FlowAxis;
}

export function Highway({
  score, playhead, tapeSets, showFingerings, height, width, axis = 'vertical',
}: HighwayProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const horizontal = axis === 'horizontal';
  const gap = theme.s(LANE_GAP);
  const pxPerMs = theme.s(PX_PER_MS);

  /** Extent along the time axis, and across the lanes. */
  const timeExtent = horizontal ? width : height;
  const crossExtent = horizontal ? height : width;

  const lanes = laneGeometry(axis, crossExtent, gap);

  const headerPx = theme.s(HEADER);
  const footerPx = theme.s(FOOTER);
  /**
   * Where the hit line sits, measured along the time axis from the box's start.
   *
   * Falling: near the bottom, so most of the screen is what is coming.
   * Horizontal: a quarter in from the left, because notes arrive from the right
   * and the same reasoning applies — you need to see more of the future than
   * of the past.
   */
  const hitAt = horizontal
    ? timeExtent * HIT_FRACTION_HORIZONTAL
    : timeExtent - footerPx;

  /**
   * The window worth drawing.
   *
   * Anchored on the active note rather than on the shared clock: the clock lives
   * on the UI thread and reading it into React every frame is exactly the cost
   * this windowing exists to avoid. `activeIndex` updates about sixteen times a
   * second, and `flowWindow` is generous enough on both sides to cover the
   * travel between updates.
   */
  const anchorMs = score.notes[playhead.activeIndex]?.startTimeMs ?? playhead.loopStartMs;
  const visibleMs = timeExtent / pxPerMs;
  const window = useMemo(
    () => flowWindow(anchorMs, Math.max(visibleMs, LOOKAHEAD_MS), horizontal ? 0.74 : 0.8),
    [anchorMs, visibleMs, horizontal],
  );

  /**
   * Notes sit at fixed offsets; the container slides. A note's offset is where
   * it *would* be at time zero, so translating by `t · pxPerMs` puts the note
   * due at time t exactly on the hit line.
   *
   * The two axes travel in opposite directions and so the sign differs. Falling:
   * a future note sits *above* the line and the field moves down. Horizontal:
   * the user asked for notes entering from the right, so a future note sits to
   * the *right* of the line and the field moves left. Getting this pair
   * consistent is the whole of the axis switch — everything else is layout.
   */
  const laid = useMemo(() => {
    const { from, to } = visibleSlice(score.notes, window);
    const out = [];
    for (let index = from; index < to; index++) {
      const note = score.notes[index];
      out.push({
        note,
        index,
        lane: lanes.laneAt(note.string),
        along: horizontal
          ? hitAt + note.startTimeMs * pxPerMs
          : hitAt - note.startTimeMs * pxPerMs,
        length: Math.max(theme.s(22), note.durationMs * pxPerMs),
        tapeColor: tapeColorFor(note, tapeSets, theme),
      });
    }
    return out;
  }, [score, window, lanes, hitAt, pxPerMs, tapeSets, theme, horizontal]);

  const field = useAnimatedStyle(() => {
    const shift = playhead.timeMs.get() * pxPerMs;
    return { transform: horizontal ? [{ translateX: -shift }] : [{ translateY: shift }] };
  });

  return (
    <View style={{ height, width, overflow: 'hidden' }}>
      {/* Sideways, the top-left corner is inside the A-string lane, so the
          spawn caption goes under the lanes instead of over them. */}
      <View
        style={horizontal
          ? { position: 'absolute', bottom: 0, right: 0 }
          : { position: 'absolute', top: 0, left: 0 }}
      >
        <Label size={10}>{`SPAWN +${LOOKAHEAD_MS} MS`}</Label>
      </View>

      {/* Lanes. */}
      {STRING_ORDER.map((string) => (
        <View
          key={string}
          style={horizontal
            ? {
              position: 'absolute',
              left: headerPx,
              right: 0,
              top: lanes.laneAt(string),
              height: lanes.laneSize,
              backgroundColor: alpha(chrome.strings[string], 0.1),
            }
            : {
              position: 'absolute',
              top: headerPx,
              bottom: footerPx - theme.s(18),
              left: lanes.laneAt(string),
              width: lanes.laneSize,
              backgroundColor: alpha(chrome.strings[string], 0.1),
            }}
        />
      ))}

      {/* Scrolling note field. */}
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, field]}>
        {laid.map((item) => (
          <NoteCapsule
            key={item.note.id}
            note={item.note}
            lane={item.lane}
            along={item.along}
            laneSize={lanes.laneSize}
            length={item.length}
            horizontal={horizontal}
            tapeColor={item.tapeColor}
            showFinger={showFingerings}
            state={noteState(item.index, playhead.activeIndex)}
          />
        ))}
      </Animated.View>

      {/* Hit line, drawn over the field. */}
      <View
        style={horizontal
          ? {
            position: 'absolute',
            top: 0,
            height: lanes.laneStep * STRING_ORDER.length - gap,
            left: hitAt,
            width: theme.rule(3),
            backgroundColor: chrome.accent,
          }
          : {
            position: 'absolute',
            left: 0,
            width: lanes.laneStep * STRING_ORDER.length - gap,
            top: hitAt,
            height: theme.rule(3),
            backgroundColor: chrome.accent,
          }}
      />
      <View
        style={horizontal
          ? { position: 'absolute', left: hitAt + theme.s(6), bottom: 0 }
          : { position: 'absolute', top: hitAt + theme.s(8), left: 0 }}
      >
        <Label size={10} color={chrome.accent}>HIT LINE</Label>
      </View>

      {/* String names beside each lane. */}
      {STRING_ORDER.map((string) => (
        <View
          key={string}
          style={horizontal
            ? {
              position: 'absolute',
              left: 0,
              top: lanes.laneAt(string) + lanes.laneSize / 2 - theme.s(8),
            }
            : {
              position: 'absolute',
              bottom: 0,
              left: lanes.laneAt(string) + lanes.laneSize / 2 - theme.s(6),
            }}
        >
          <Num size={13} color={chrome.strings[string]}>{string}</Num>
        </View>
      ))}
    </View>
  );
}

/**
 * A single note. Memoised on its own props: the field re-renders only when the
 * window moves or the fingering toggle changes, never on a scroll frame.
 */
type NoteState = 'upcoming' | 'active' | 'played';

function noteState(index: number, activeIndex: number): NoteState {
  if (index === activeIndex) return 'active';
  return index < activeIndex ? 'played' : 'upcoming';
}

const NoteCapsule = memo(function NoteCapsule({
  note, lane, along, laneSize, length, horizontal, tapeColor, showFinger, state,
}: {
  note: CelloNote;
  /** Cross-axis offset of the lane this note is in. */
  lane: number;
  /** Time-axis offset of the note's leading edge at time zero. */
  along: number;
  laneSize: number;
  length: number;
  horizontal: boolean;
  tapeColor: string | null;
  showFinger: boolean;
  state: NoteState;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const stringColor = chrome.strings[note.string];
  const active = state === 'active';
  const played = state === 'played';

  return (
    <View
      style={{
        position: 'absolute',
        // A note's leading edge is the one that reaches the hit line first, and
        // the block extends from it into the future: rightward when the field
        // travels left, upward when it falls. Both give a long note a long
        // block, which is the point.
        left: horizontal ? along : lane,
        top: horizontal ? lane : along - length,
        width: horizontal ? length : laneSize,
        height: horizontal ? laneSize : length,
        backgroundColor: active ? stringColor : alpha(stringColor, played ? 0.08 : 0.3),
        borderWidth: theme.rule(2),
        borderColor: played ? chrome.lineSoft : stringColor,
        opacity: played ? 0.5 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The tape this note lands on, on the edge that meets the hit line
          first — full width, because a thin side stripe disappears against a
          lane already tinted in the string's own colour. */}
      {tapeColor === null ? null : (
        <View
          style={horizontal
            ? { position: 'absolute', top: 0, bottom: 0, right: 0, width: theme.s(9), backgroundColor: tapeColor }
            : { position: 'absolute', left: 0, right: 0, bottom: 0, height: theme.s(9), backgroundColor: tapeColor }}
        />
      )}
      {showFinger ? (
        <Num size={15} color={active ? chrome.bg : chrome.ink}>{note.finger}</Num>
      ) : null}
    </View>
  );
});

/** The colour of the tape a note lands on, or null when it lands between tapes. */
function tapeColorFor(
  note: CelloNote, tapeSets: readonly TapeSet[], theme: Theme,
): string | null {
  const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
  if (semitones === 0) return null;
  const tape = tapeForSemitones(tapeSets, semitones);
  return tape ? theme.chrome.tapes[tape.color] : null;
}
