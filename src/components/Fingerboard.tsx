import { memo, useMemo } from 'react';
import { View } from 'react-native';

import {
  CelloFinger, CelloString, DISPLAY_STRING_ORDER, LANDMARKS, midiAt, midiToPitchName,
  OPEN_STRING_MIDI, stopDistanceMm,
} from '@/domain/cello';
import { CelloNote } from '@/domain/schema';
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
 * ## Which way up
 *
 * By default the nut is at the **bottom** and the string climbs upward, which
 * is what a cellist actually sees looking down at their own left hand: the open
 * string — the lowest note — is nearest them, and the hand travels away from
 * them into the higher positions. The drawing used to be the other way up,
 * inherited from how fingerboard diagrams are *printed*, and that put the low
 * notes at the top of the panel while the highway beside it put them at the
 * bottom. Two axes disagreeing about which way "higher" goes is worse than
 * either convention on its own.
 *
 * `invert={false}` restores the printed-diagram orientation.
 */

export interface FingerboardMarker {
  string: CelloString;
  semitones: number;
  finger?: CelloFinger;
}

export type FingerboardTarget = CelloNote | FingerboardMarker;

export function resolveFingerboardMarker(target?: FingerboardTarget | null): FingerboardMarker | null {
  if (!target) return null;
  if ('semitones' in target) return target;
  return {
    string: target.string,
    semitones: target.midiNumber - OPEN_STRING_MIDI[target.string],
    finger: target.finger,
  };
}

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
  /**
   * Faint dots for a set of stopping points — the notes of the song's key, or
   * every note the song uses — so the player can see the shape of what they are
   * about to play, or a key to improvise in, across all four strings.
   */
  noteOverlay?: readonly {
    string: CelloString;
    semitones: number;
    pitchName: string;
    isTonic: boolean;
  }[];
  /** Highlight one stopped note. Accepts either a CelloNote or precomputed FingerboardMarker. */
  active?: FingerboardTarget | null;
  /** Next note to be played, rendered in a black square for preparation. Accepts either a CelloNote or precomputed FingerboardMarker. */
  next?: FingerboardTarget | null;
  /** Width of the left gutter that holds landmark labels, in design units. */
  gutter?: number;
  compact?: boolean;
  /**
   * Nut at the bottom, hand climbing upward — the player's own view. Default.
   * Pass `false` for the printed-diagram orientation, nut at the top.
   */
  invert?: boolean;
}

export const Fingerboard = memo(function Fingerboard({
  height, maxMm = 400, tapeSets, showTapes = true, showLandmarks = true,
  showNoteNames = false, noteOverlay, active = null, next = null, gutter = 46, compact = false,
  invert = true,
}: FingerboardProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const resolvedActive = resolveFingerboardMarker(active);
  const resolvedNext = resolveFingerboardMarker(next);

  const layout = useMemo(() => {
    const drawHeight = height;
    const gutterWidth = theme.s(gutter);
    /**
     * Millimetres from the nut → vertical offset in dp.
     *
     * One function, so every layer of the drawing — rails, tapes, landmarks,
     * the active note, the note names — flips together. Flipping them
     * individually is how a diagram ends up with its labels upside down
     * relative to its rules.
     */
    const y = (mm: number) => (invert
      ? drawHeight - (mm / maxMm) * drawHeight
      : (mm / maxMm) * drawHeight);

    return { drawHeight, gutterWidth, y };
  }, [theme, height, gutter, maxMm, invert]);

  const tapes = useMemo(
    () => tapeGeometry(tapeSets).filter((t) => t.mm <= maxMm),
    [tapeSets, maxMm],
  );

  const landmarks = useMemo(
    () => LANDMARKS.filter((l) => l.mm <= maxMm && (compact ? l.weight === 'major' : true)),
    [maxMm, compact],
  );

  const stringGap = theme.s(compact ? 15 : 26);
  const railsWidth = stringGap * (DISPLAY_STRING_ORDER.length - 1);
  const railX = (string: CelloString) => DISPLAY_STRING_ORDER.indexOf(string) * stringGap;

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
        {DISPLAY_STRING_ORDER.map((string) => (
          <View
            key={string}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: railX(string),
              width: theme.rule(string === 'C' ? 3 : 2),
              backgroundColor: chrome.strings[string],
              opacity: resolvedActive && resolvedActive.string !== string ? 0.35 : 0.9,
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

        {/* Faint scale/song overlay: stopping points across all four strings.
            Drawn before the active note so the live marker sits on top.
            Use light dots on dark themes and ink on paper for clear visibility. */}
        {noteOverlay ? noteOverlay
          .filter((marker) => stopDistanceMm(marker.semitones) <= maxMm)
          .map((marker) => {
            const dot = theme.s(compact ? (marker.isTonic ? 10 : 8) : (marker.isTonic ? 13 : 10));
            return (
              <View
                key={`ov-${marker.string}-${marker.semitones}`}
                style={{
                  position: 'absolute',
                  left: railX(marker.string) - dot / 2 + theme.rule(marker.string === 'C' ? 1.5 : 1),
                  top: layout.y(stopDistanceMm(marker.semitones)) - dot / 2,
                  width: dot,
                  height: dot,
                  borderRadius: dot / 2,
                  backgroundColor: chrome.dark ? '#FFFFFF' : chrome.ink,
                  opacity: marker.isTonic ? 0.95 : 0.7,
                  borderWidth: theme.rule(1),
                  borderColor: chrome.dark ? '#FFFFFF' : chrome.ink,
                }}
              />
            );
          }) : null}

        {/* Next note to be played: solid black square without border and white finger number */}
        {resolvedNext ? (
          <View
            style={{
              position: 'absolute',
              left: railX(resolvedNext.string) - theme.s(compact ? 8 : 11),
              top: layout.y(stopDistanceMm(resolvedNext.semitones)) - theme.s(compact ? 9 : 12),
              width: theme.s(compact ? 20 : 26),
              height: theme.s(compact ? 20 : 26),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#000000',
            }}
          >
            <Num size={compact ? 11 : 14} color="#FFFFFF">{resolvedNext.finger}</Num>
          </View>
        ) : null}

        {/* The note under the hand right now. */}
        {resolvedActive ? (
          <View
            style={{
              position: 'absolute',
              left: railX(resolvedActive.string) - theme.s(compact ? 8 : 11),
              top: layout.y(stopDistanceMm(resolvedActive.semitones)) - theme.s(compact ? 9 : 12),
              width: theme.s(compact ? 20 : 26),
              height: theme.s(compact ? 20 : 26),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: chrome.strings[resolvedActive.string],
            }}
          >
            <Num size={compact ? 11 : 14} color={chrome.bg}>{resolvedActive.finger}</Num>
          </View>
        ) : null}
      </View>

      {/* Note names for whichever string is in play — the tutorial's payload. */}
      {showNoteNames && resolvedActive ? (
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
                {midiToPitchName(midiAt(resolvedActive.string, tape.semitones))}
              </Num>
              <Label size={9}>{tape.caption}</Label>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** String name labels, drawn under a fingerboard at matching spacing. */
export function FingerboardStringLabels({
  compact = false, activeString,
}: { compact?: boolean; activeString?: CelloString | null }) {
  const theme = useTheme();
  const stringGap = theme.s(compact ? 15 : 26);
  return (
    <View style={{ height: theme.s(16), marginTop: theme.s(4) }}>
      {DISPLAY_STRING_ORDER.map((string) => (
        <View key={string} style={{ position: 'absolute', left: DISPLAY_STRING_ORDER.indexOf(string) * stringGap - theme.s(3) }}>
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

/** Footer caption naming the instrument the drawing is to scale for. (Removed per user request) */
export function FingerboardScaleNote() {
  return null;
}
