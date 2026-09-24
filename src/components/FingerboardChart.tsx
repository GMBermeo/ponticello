import { memo } from 'react';
import { View } from 'react-native';

import {
  CelloString, DISPLAY_STRING_ORDER, midiAt, POSITION_BASE_SEMITONES, stopDistanceMm,
  lettersForPitchClass, NOTE_COLOR, TapeSet, tapeGeometry,
} from '@domain';
import { useTheme } from '@theme';
import { Label, Num } from './ui';

/**
 * The printed fingerboard chart, drawn from the app's own constants.
 *
 * Every stopping point from the open string down to the octave, on all four
 * strings, as a coloured disc bearing the note's name — the wall poster a
 * beginner tapes above the music stand, except that this one cannot disagree
 * with the rest of the app: the colours come from `domain/noteColors`, the
 * distances from `stopDistanceMm`, and the tapes from the player's own set.
 *
 * Sharps and flats take both neighbouring letters' colours, split down the
 * middle, and carry both spellings — which is the whole reason the printed
 * charts are readable at all. C♯ is half green, half blue, and it is written
 * C♯ over D♭, because those are one key on the instrument and two names on the
 * page.
 *
 * Drawn to scale like every other fingerboard in the app, so the discs crowd
 * as they climb. A chart with evenly spaced rows teaches a hand that will be
 * flat by a semitone in fourth position.
 */

/** How far down the string the chart goes. Twelve semitones is the octave. */
export const CHART_SEMITONES = 12;

const POSITION_BRACKETS: { label: string; from: number; to: number }[] = [
  { label: '1st', from: POSITION_BASE_SEMITONES['1st'], to: POSITION_BASE_SEMITONES['1st'] + 3 },
  { label: '2nd', from: POSITION_BASE_SEMITONES['2nd'], to: POSITION_BASE_SEMITONES['2nd'] + 3 },
  { label: '3rd', from: POSITION_BASE_SEMITONES['3rd'], to: POSITION_BASE_SEMITONES['3rd'] + 3 },
  { label: '4th', from: POSITION_BASE_SEMITONES['4th'], to: POSITION_BASE_SEMITONES['4th'] + 3 },
];

export interface NoteDiscProps {
  /** Pitch class 0–11. Decides the colour, or the pair of colours. */
  pitchClass: number;
  /** Diameter in *design units* — the type inside scales with it. */
  units: number;
  /** Ring drawn around the disc — used to mark the open strings. */
  outline?: string | null;
}

/** One chart disc: solid for a natural, split down the middle for a black key. */
export const NoteDisc = memo(function NoteDisc({ pitchClass, units, outline = null }: NoteDiscProps) {
  const theme = useTheme();
  const letters = lettersForPitchClass(pitchClass);
  const colors = letters.map((letter) => theme.chrome.notes[NOTE_COLOR[letter]]);
  const split = letters.length === 2;
  const size = theme.s(units);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: outline ? theme.rule(2) : 0,
        borderColor: outline ?? 'transparent',
      }}
    >
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, flexDirection: 'row' }}>
        <View style={{ flex: 1, backgroundColor: colors[0] }} />
        {split ? <View style={{ flex: 1, backgroundColor: colors[1] }} /> : null}
      </View>
      {split ? (
        <View style={{ alignItems: 'center' }}>
          <Num size={units * 0.32} color="#ffffff">{`${letters[0]}♯`}</Num>
          <Num size={units * 0.32} color="#ffffff">{`${letters[1]}♭`}</Num>
        </View>
      ) : (
        <Num size={units * 0.46} color="#ffffff">{letters[0]}</Num>
      )}
    </View>
  );
});

export interface FingerboardChartProps {
  /** Height of the drawing in device-independent pixels. */
  height: number;
  tapeSets: readonly TapeSet[];
  showTapes?: boolean;
  semitones?: number;
  /** Nut at the bottom, as the player sees it. */
  invert?: boolean;
}

export function FingerboardChart({
  height, tapeSets, showTapes = true, semitones = CHART_SEMITONES, invert = false,
}: FingerboardChartProps) {
  const theme = useTheme();
  const { chrome } = theme;

  // A little past the last row, so the bottom disc is not clipped by the frame.
  const maxMm = stopDistanceMm(semitones) + 14;
  const y = (mm: number) => (invert ? height - (mm / maxMm) * height : (mm / maxMm) * height);

  const discUnits = 38;
  const disc = theme.s(discUnits);
  const stringGap = Math.max(disc + theme.s(6), theme.s(46));
  const railsWidth = stringGap * (DISPLAY_STRING_ORDER.length - 1);
  const railX = (string: CelloString) => DISPLAY_STRING_ORDER.indexOf(string) * stringGap;
  const gutter = theme.s(34);
  const bracketLane = theme.s(30);

  const rows = Array.from({ length: semitones + 1 }, (_, n) => n);
  const tapes = tapeGeometry(tapeSets).filter((t) => t.mm <= maxMm);

  return (
    <View style={{ flexDirection: 'row', height }}>
      {/* Semitone counter, so the chart can be read against the tape editor. */}
      <View style={{ width: gutter }}>
        {rows.map((n) => (
          <View key={n} style={{ position: 'absolute', right: theme.s(4), top: y(stopDistanceMm(n)) - theme.s(6) }}>
            <Label size={9}>{n === 0 ? '0' : `${n}`}</Label>
          </View>
        ))}
      </View>

      <View style={{ width: railsWidth + disc }}>
        {/* The fingerboard itself, so the discs sit on wood rather than in air. */}
        <View
          style={{
            position: 'absolute',
            left: -theme.s(4),
            right: -theme.s(4),
            top: 0,
            bottom: 0,
            backgroundColor: chrome.dark ? '#2b2118' : '#efe7dd',
            borderRadius: theme.s(6),
          }}
        />

        {/* The player's tapes, across all four strings as they are stuck on. */}
        {showTapes ? tapes.map((tape) => (
          <View
            key={tape.id}
            style={{
              position: 'absolute',
              left: -theme.s(4),
              right: -theme.s(4),
              top: y(tape.mm) - theme.s(2),
              height: theme.s(4),
              backgroundColor: chrome.tapes[tape.color],
              opacity: 0.9,
            }}
          />
        )) : null}

        {/* String rails, each in the colour of the note it sounds open. */}
        {DISPLAY_STRING_ORDER.map((string) => (
          <View
            key={string}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: railX(string) + disc / 2 - theme.rule(string === 'C' ? 3 : 2) / 2,
              width: theme.rule(string === 'C' ? 3 : 2),
              backgroundColor: chrome.strings[string],
              opacity: 0.55,
            }}
          />
        ))}

        {rows.map((n) => DISPLAY_STRING_ORDER.map((string) => (
          <View
            key={`${string}-${n}`}
            style={{
              position: 'absolute',
              left: railX(string),
              top: y(stopDistanceMm(n)) - disc / 2,
            }}
          >
            <NoteDisc
              pitchClass={midiAt(string, n) % 12}
              units={discUnits}
              outline={n === 0 ? chrome.ink : null}
            />
          </View>
        )))}
      </View>

      {/* Position brackets, staggered over two lanes because they overlap:
          third position starts before second position ends. */}
      <View style={{ width: bracketLane * 2 + theme.s(6), marginLeft: theme.s(8) }}>
        {POSITION_BRACKETS.map((bracket, index) => {
          const top = Math.min(y(stopDistanceMm(bracket.from)), y(stopDistanceMm(bracket.to)));
          const bottom = Math.max(y(stopDistanceMm(bracket.from)), y(stopDistanceMm(bracket.to)));
          const lane = (index % 2) * bracketLane;
          return (
            <View key={bracket.label} style={{ position: 'absolute', left: lane, top, height: bottom - top }}>
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: theme.s(8),
                  borderColor: chrome.ink,
                  borderLeftWidth: theme.rule(2),
                  borderTopWidth: theme.rule(2),
                  borderBottomWidth: theme.rule(2),
                }}
              />
              <View style={{ position: 'absolute', left: theme.s(11), top: (bottom - top) / 2 - theme.s(7) }}>
                <Label size={10} color={chrome.ink}>{bracket.label}</Label>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
