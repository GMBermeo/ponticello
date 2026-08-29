import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { CelloNote, CelloSongScore } from '@/domain/schema';
import { OPEN_STRING_MIDI, STRING_ORDER } from '@/domain/cello';
import { TapeSet, tapeForSemitones } from '@/domain/tapes';
import { Theme, useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';
import { Label, Num } from '../ui/primitives';
import { Playhead } from './usePlayhead';

/**
 * Highway vision — notes fall down four string lanes to a hit line.
 *
 * One deliberate departure from the original mock, which drew fingerboard
 * position rules across the highway: here the vertical axis is **time and
 * nothing else**. A highway whose vertical axis means distance-from-nut in the
 * background and seconds-until-you-play-it in the foreground cannot be read at
 * speed. The tape a note lands on travels *with the note* instead, as a
 * coloured edge on its capsule, and the fingerboard panel beside the highway
 * keeps the distance axis where it belongs.
 *
 * The whole note field is laid out once and moved with a single transform, so
 * scrolling costs one animated style per frame no matter how many notes are on
 * screen.
 */

/** How far ahead of the hit line a note appears. */
const LOOKAHEAD_MS = 2500;
/** Design units of highway per millisecond of lookahead. */
const PX_PER_MS = 0.16;

const LANE_GAP = 10;
/** Room at the top for the spawn label, and at the bottom for string names. */
const HEADER = 26;
const FOOTER = 54;

export interface HighwayProps {
  score: CelloSongScore;
  playhead: Playhead;
  tapeSets: readonly TapeSet[];
  showFingerings: boolean;
  /** Box height in device-independent pixels. */
  height: number;
  /** Box width in device-independent pixels. */
  width: number;
}

export function Highway({
  score, playhead, tapeSets, showFingerings, height, width,
}: HighwayProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const drawHeight = height;
  const gap = theme.s(LANE_GAP);
  // Lanes divide the box rather than taking a fixed width: on the unfolded
  // inner display a fixed 74-unit lane leaves a third of the highway empty.
  const laneStep = width / STRING_ORDER.length;
  const laneWidth = laneStep - gap;
  const pxPerMs = theme.s(PX_PER_MS);
  const headerY = theme.s(HEADER);
  const hitLineY = drawHeight - theme.s(FOOTER);

  /**
   * Notes sit at fixed offsets; the container slides. A note's y is where it
   * *would* be at time zero, so translating by `t · pxPerMs` puts the note due
   * at time t exactly on the hit line.
   */
  const laid = useMemo(() => score.notes.map((note, index) => ({
    note,
    index,
    x: STRING_ORDER.indexOf(note.string) * laneStep,
    y: hitLineY - note.startTimeMs * pxPerMs,
    height: Math.max(theme.s(22), note.durationMs * pxPerMs),
    tapeColor: tapeColorFor(note, tapeSets, theme),
  })), [score, laneStep, hitLineY, pxPerMs, tapeSets, theme]);

  const field = useAnimatedStyle(() => ({
    transform: [{ translateY: playhead.timeMs.get() * pxPerMs }],
  }));

  return (
    <View style={{ height: drawHeight, width, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: 0 }}>
        <Label size={10}>{`SPAWN +${LOOKAHEAD_MS} MS`}</Label>
      </View>

      {/* Lanes. */}
      {STRING_ORDER.map((string, index) => (
        <View
          key={string}
          style={{
            position: 'absolute',
            top: headerY,
            bottom: theme.s(FOOTER - 18),
            left: index * laneStep,
            width: laneWidth,
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
            x={item.x}
            y={item.y}
            width={laneWidth}
            height={item.height}
            tapeColor={item.tapeColor}
            showFinger={showFingerings}
            state={noteState(item.index, playhead.activeIndex)}
          />
        ))}
      </Animated.View>

      {/* Hit line, drawn over the field. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          width: laneStep * STRING_ORDER.length - gap,
          top: hitLineY,
          height: theme.rule(3),
          backgroundColor: chrome.accent,
        }}
      />
      <View style={{ position: 'absolute', top: hitLineY + theme.s(8), left: 0 }}>
        <Label size={10} color={chrome.accent}>HIT LINE</Label>
      </View>

      {/* String names under each lane. */}
      {STRING_ORDER.map((string, index) => (
        <View
          key={string}
          style={{
            position: 'absolute',
            bottom: 0,
            left: index * laneStep + laneWidth / 2 - theme.s(6),
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
 * score or the fingering toggle changes, never on a scroll frame.
 */
type NoteState = 'upcoming' | 'active' | 'played';

function noteState(index: number, activeIndex: number): NoteState {
  if (index === activeIndex) return 'active';
  return index < activeIndex ? 'played' : 'upcoming';
}

const NoteCapsule = memo(function NoteCapsule({
  note, x, y, width, height, tapeColor, showFinger, state,
}: {
  note: CelloNote;
  x: number;
  y: number;
  width: number;
  height: number;
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
        left: x,
        top: y - height,
        width,
        height,
        backgroundColor: active ? stringColor : alpha(stringColor, played ? 0.08 : 0.3),
        borderWidth: theme.rule(2),
        borderColor: played ? chrome.lineSoft : stringColor,
        opacity: played ? 0.5 : 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: theme.s(3),
      }}
    >
      {/* The tape this note lands on, on the edge that meets the hit line
          first — full width, because a thin side stripe disappears against a
          lane already tinted in the string's own colour. */}
      {tapeColor === null ? null : (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: theme.s(9),
            backgroundColor: tapeColor,
          }}
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
