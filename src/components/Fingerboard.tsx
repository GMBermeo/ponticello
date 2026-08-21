import React, { useMemo } from 'react';
import { View } from 'react-native';

import {
  CelloFinger, CelloString, LANDMARKS, midiAt, midiToPitchName, STRING_ORDER,
  stopDistanceMm, STRING_LENGTH_MM,
} from '@/domain/cello';
import { TapeSet, tapeGeometry } from '@/domain/tapes';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';
import { Label, Num } from './ui/primitives';

/**
 * The fingerboard, drawn to scale.
 *
 * Distances come straight from `stopDistanceMm`, so the picture is a true
 * scale drawing of a 690 mm string rather than an evenly-spaced diagram: the
 * tapes bunch up as they climb, exactly as they do on the instrument. That
 * compression is the single most useful thing a beginner can internalise about
 * the upper positions, and evenly-spaced "frets" would teach the opposite.
 *
 * The nut is at the top and the bridge is off the bottom, matching the view a
 * cellist has looking down at their own left hand.
 */

export interface FingerboardProps {
  /** Height of the drawing in device-independent pixels — usually measured. */
  height: number;
  /** How far down the string to draw, in millimetres. */
  maxMm?: number;
  tapeSets: readonly TapeSet[];
  showTapes?: boolean;
  /** Draw the instrument's own landmarks (nut, neck heel, octave harmonic). */
  showLandmarks?: boolean;
  /** Print the note each tape gives on the active string. */
  showNoteNames?: boolean;
  /** Highlight one stopped note. */
  active?: { string: CelloString; semitones: number; finger: CelloFinger } | null;
  /** Width of the left gutter that holds landmark labels, in design units. */
  gutter?: number;
  compact?: boolean;
}

export function Fingerboard({
  height, maxMm = 400, tapeSets, showTapes = true, showLandmarks = true,
  showNoteNames = false, active = null, gutter = 46, compact = false,
}: FingerboardProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const layout = useMemo(() => {
    const drawHeight = height;
    const gutterWidth = theme.s(gutter);
    /** Millimetres from the nut → vertical offset in dp. */
    const y = (mm: number) => (mm / maxMm) * drawHeight;

    return { drawHeight, gutterWidth, y };
  }, [theme, height, gutter, maxMm]);

  const tapes = useMemo(
    () => tapeGeometry(tapeSets).filter((t) => t.mm <= maxMm),
    [tapeSets, maxMm],
  );

  const landmarks = useMemo(
    () => LANDMARKS.filter((l) => l.mm <= maxMm && (compact ? l.weight === 'major' : true)),
    [maxMm, compact],
  );

  const stringGap = theme.s(compact ? 15 : 26);
  const railsWidth = stringGap * (STRING_ORDER.length - 1);
  const railX = (string: CelloString) => STRING_ORDER.indexOf(string) * stringGap;

  return (
    <View style={{ height: layout.drawHeight, flexDirection: 'row' }}>
      {/* Landmark labels sit outside the strings so nothing overlaps the tapes. */}
      <View style={{ width: layout.gutterWidth }}>
        {showLandmarks ? landmarks.map((landmark) => (
          <View
            key={landmark.id}
            style={{
              position: 'absolute',
              top: layout.y(landmark.mm) - theme.s(7),
              right: theme.s(6),
            }}
          >
            <Label
              size={compact ? 9 : 10}
              color={landmark.weight === 'major' ? chrome.ink : chrome.dim}
            >
              {landmark.label}
            </Label>
          </View>
        )) : null}
      </View>

      <View style={{ width: railsWidth + theme.s(compact ? 10 : 18) }}>
        {/* Landmark rules run the full width behind everything else. */}
        {showLandmarks ? landmarks.map((landmark) => (
          <View
            key={landmark.id}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: layout.y(landmark.mm),
              height: theme.rule(landmark.weight === 'major' ? 2 : 1),
              backgroundColor: landmark.weight === 'major' ? chrome.line : chrome.lineSoft,
            }}
          />
        )) : null}

        {/* String rails. */}
        {STRING_ORDER.map((string) => (
          <View
            key={string}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: railX(string),
              width: theme.rule(string === 'C' ? 3 : 2),
              backgroundColor: chrome.strings[string],
              opacity: active && active.string !== string ? 0.35 : 0.9,
            }}
          />
        ))}

        {/* Tapes, drawn as they are stuck on: across all four strings at once. */}
        {showTapes ? tapes.map((tape) => (
          <View
            key={tape.id}
            style={{
              position: 'absolute',
              left: -theme.s(3),
              width: railsWidth + theme.s(6),
              top: layout.y(tape.mm) - theme.s(compact ? 2 : 3),
              height: theme.s(compact ? 4 : 6),
              backgroundColor: chrome.tapes[tape.color],
            }}
          />
        )) : null}

        {/* The note under the hand right now. */}
        {active ? (
          <View
            style={{
              position: 'absolute',
              left: railX(active.string) - theme.s(compact ? 8 : 11),
              top: layout.y(stopDistanceMm(active.semitones)) - theme.s(compact ? 9 : 12),
              width: theme.s(compact ? 20 : 26),
              height: theme.s(compact ? 20 : 26),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: chrome.strings[active.string],
            }}
          >
            <Num size={compact ? 11 : 14} color={chrome.bg}>{active.finger}</Num>
          </View>
        ) : null}
      </View>

      {/* Note names for whichever string is in play — the tutorial's payload. */}
      {showNoteNames && active ? (
        <View style={{ flex: 1, marginLeft: theme.s(10) }}>
          {tapes.map((tape) => (
            <View
              key={tape.id}
              style={{
                position: 'absolute',
                top: layout.y(tape.mm) - theme.s(9),
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.s(6),
              }}
            >
              <Num size={13} color={chrome.tapes[tape.color]}>
                {midiToPitchName(midiAt(active.string, tape.semitones))}
              </Num>
              <Label size={9}>{tape.caption}</Label>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** String name labels, drawn under a fingerboard at matching spacing. */
export function FingerboardStringLabels({
  compact = false, activeString,
}: { compact?: boolean; activeString?: CelloString | null }) {
  const theme = useTheme();
  const stringGap = theme.s(compact ? 15 : 26);
  return (
    <View style={{ height: theme.s(16), marginTop: theme.s(4) }}>
      {STRING_ORDER.map((string) => (
        <View key={string} style={{ position: 'absolute', left: STRING_ORDER.indexOf(string) * stringGap - theme.s(3) }}>
          <Num
            size={compact ? 10 : 12}
            color={activeString && activeString !== string
              ? alpha(theme.chrome.strings[string], 0.5)
              : theme.chrome.strings[string]}
          >
            {string}
          </Num>
        </View>
      ))}
    </View>
  );
}

/** Footer caption naming the instrument the drawing is to scale for. */
export function FingerboardScaleNote() {
  return <Label size={9}>{`L ${STRING_LENGTH_MM} MM · TO SCALE`}</Label>;
}
