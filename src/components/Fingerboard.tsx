import { memo, useMemo } from 'react';
import { View } from 'react-native';

import {
  alternativePlacements, CelloFinger, CelloString, DISPLAY_STRING_ORDER, Landmark, LANDMARKS,
  midiAt, midiToPitchName, NECK_REACH_SEMITONES, OPEN_STRING_MIDI, Placement, semitonesAtMm,
  stopDistanceMm,
} from '@/domain/cello';
import { noteColorName } from '@/domain/noteColors';
import { CelloNote } from '@/domain/schema';
import { TapeGeometry, TapeSet, tapeForSemitones, tapeGeometry } from '@/domain/tapes';
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
  /**
   * Ring the other places the active note could be played.
   *
   * The solver picks one seat per note and the player never sees the ones it
   * turned down. A ring on each alternative says "this note is also here",
   * which is the difference between trusting the fingering and understanding
   * it — and the only way to notice that a passage the algorithm strung across
   * a string crossing sits comfortably up one string.
   */
  showAlternates?: boolean;
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
  showNoteNames = false, noteOverlay, active = null, next = null, showAlternates = false,
  gutter = 46, compact = false, invert = true,
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
  const activeString = resolvedActive?.string ?? null;

  /**
   * Bounded twice: by the neck, and by however much board this panel draws.
   *
   * The neck bound is the important one. A panel drawing the full 440 mm
   * reaches past the seventeenth semitone, and offering the player a note "also
   * available" up there is offering them somewhere the solver will never put
   * their hand and no tape marks — C3 on the G string would be answered with
   * the twelfth semitone of the C string, which is the octave harmonic and not
   * an easier way to play anything.
   */
  const alternates = useMemo(() => {
    if (!showAlternates || !resolvedActive) return EMPTY_PLACEMENTS;
    const midi = midiAt(resolvedActive.string, resolvedActive.semitones);
    const reach = Math.min(NECK_REACH_SEMITONES, Math.floor(semitonesAtMm(maxMm)));
    return alternativePlacements(midi, resolvedActive, reach);
  }, [showAlternates, resolvedActive, maxMm]);

  return (
    <View style={{ height: layout.drawHeight, flexDirection: 'row' }}>
      {/* Landmark labels sit outside the strings so nothing overlaps the tapes. */}
      <View style={{ width: layout.gutterWidth }}>
        <BoardGutter landmarks={showLandmarks ? landmarks : EMPTY_LANDMARKS} y={layout.y} compact={compact} />
      </View>

      <View style={{ width: railsWidth + theme.s(compact ? 10 : 18) }}>
        {/* Everything that does not move while the music plays. Memoised as one
            piece, because the alternative is redrawing four rails, nine tapes,
            three landmark rules and up to forty-five overlay dots on every note
            — sixteen times a second, for a picture that has not changed. */}
        <BoardBackdrop
          landmarks={showLandmarks ? landmarks : EMPTY_LANDMARKS}
          tapes={showTapes ? tapes : EMPTY_TAPES}
          noteOverlay={noteOverlay}
          y={layout.y}
          stringGap={stringGap}
          railsWidth={railsWidth}
          maxMm={maxMm}
          compact={compact}
        />

        {/* Rails dim the strings you are not on, so they follow the hand — but
            only when it crosses, which is far rarer than a note change. */}
        <BoardRails activeString={activeString} stringGap={stringGap} />

        {/* Where else this note lives. Drawn under the markers, so the note
            being played still reads as the answer and these as the options. */}
        {alternates.length > 0 ? (
          <BoardAlternates
            placements={alternates}
            midiNumber={midiAt(resolvedActive!.string, resolvedActive!.semitones)}
            tapeSets={tapeSets}
            stringGap={stringGap}
            y={layout.y}
            compact={compact}
          />
        ) : null}

        {/* The two markers are the only things that move per note. */}
        {resolvedNext ? (
          <NoteMarker
            marker={resolvedNext}
            stringGap={stringGap}
            y={layout.y}
            compact={compact}
            background="#000000"
            foreground="#FFFFFF"
          />
        ) : null}
        {resolvedActive ? (
          <NoteMarker
            marker={resolvedActive}
            stringGap={stringGap}
            y={layout.y}
            compact={compact}
            background={chrome.strings[resolvedActive.string]}
            foreground={chrome.bg}
          />
        ) : null}
      </View>

      {/* Note names for whichever string is in play — the tutorial's payload. */}
      {showNoteNames && activeString ? (
        <View style={{ flex: 1, marginLeft: theme.s(10) }}>
          <BoardNoteNames tapes={tapes} activeString={activeString} y={layout.y} />
        </View>
      ) : null}
    </View>
  );
});

const EMPTY_LANDMARKS: readonly Landmark[] = [];
const EMPTY_TAPES: readonly TapeGeometry[] = [];
const EMPTY_PLACEMENTS: readonly Placement[] = [];

/** Millimetres from the nut to a vertical offset. Stable per layout. */
type MmToY = (mm: number) => number;

const railX = (string: CelloString, stringGap: number) =>
  DISPLAY_STRING_ORDER.indexOf(string) * stringGap;

/** Landmark captions in the left gutter. */
const BoardGutter = memo(function BoardGutter({
  landmarks, y, compact,
}: { landmarks: readonly Landmark[]; y: MmToY; compact: boolean }) {
  const theme = useTheme();
  const { chrome } = theme;
  return (
    <>
      {landmarks.map((landmark) => (
        <View
          key={landmark.id}
          style={{ position: 'absolute', top: y(landmark.mm) - theme.s(7), right: theme.s(6) }}
        >
          <Label
            size={compact ? 9 : 10}
            color={landmark.weight === 'major' ? chrome.ink : chrome.dim}
          >
            {landmark.label}
          </Label>
        </View>
      ))}
    </>
  );
});

/** Landmark rules, tapes and the faint note overlay — the still picture. */
const BoardBackdrop = memo(function BoardBackdrop({
  landmarks, tapes, noteOverlay, y, stringGap, railsWidth, maxMm, compact,
}: {
  landmarks: readonly Landmark[];
  tapes: readonly TapeGeometry[];
  noteOverlay?: FingerboardProps['noteOverlay'];
  y: MmToY;
  stringGap: number;
  railsWidth: number;
  maxMm: number;
  compact: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  return (
    <>
      {landmarks.map((landmark) => (
        <View
          key={landmark.id}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: y(landmark.mm),
            height: theme.rule(landmark.weight === 'major' ? 2 : 1),
            backgroundColor: landmark.weight === 'major' ? chrome.line : chrome.lineSoft,
          }}
        />
      ))}

      {/* Tapes, drawn as they are stuck on: across all four strings at once. */}
      {tapes.map((tape) => (
        <View
          key={tape.id}
          style={{
            position: 'absolute',
            left: -theme.s(3),
            width: railsWidth + theme.s(6),
            top: y(tape.mm) - theme.s(compact ? 2 : 3),
            height: theme.s(compact ? 4 : 6),
            backgroundColor: chrome.tapes[tape.color],
          }}
        />
      ))}

      {/* Faint scale/song overlay: stopping points across all four strings.
          Drawn before the markers so the live one sits on top. */}
      {noteOverlay ? noteOverlay
        .filter((marker) => stopDistanceMm(marker.semitones) <= maxMm)
        .map((marker) => {
          const dot = theme.s(compact ? (marker.isTonic ? 10 : 8) : (marker.isTonic ? 13 : 10));
          return (
            <View
              key={`ov-${marker.string}-${marker.semitones}`}
              style={{
                position: 'absolute',
                left: railX(marker.string, stringGap) - dot / 2
                  + theme.rule(marker.string === 'C' ? 1.5 : 1),
                top: y(stopDistanceMm(marker.semitones)) - dot / 2,
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
    </>
  );
});

/** The four string rails, dimmed away from the hand. */
const BoardRails = memo(function BoardRails({
  activeString, stringGap,
}: { activeString: CelloString | null; stringGap: number }) {
  const theme = useTheme();
  const { chrome } = theme;
  return (
    <>
      {DISPLAY_STRING_ORDER.map((string) => (
        <View
          key={string}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: railX(string, stringGap),
            width: theme.rule(string === 'C' ? 3 : 2),
            backgroundColor: chrome.strings[string],
            opacity: activeString && activeString !== string ? 0.35 : 0.9,
          }}
        />
      ))}
    </>
  );
});

/** One stopped note, drawn as a square with its finger number. */
const NoteMarker = memo(function NoteMarker({
  marker, stringGap, y, compact, background, foreground,
}: {
  marker: FingerboardMarker;
  stringGap: number;
  y: MmToY;
  compact: boolean;
  background: string;
  foreground: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: railX(marker.string, stringGap) - theme.s(compact ? 8 : 11),
        top: y(stopDistanceMm(marker.semitones)) - theme.s(compact ? 9 : 12),
        width: theme.s(compact ? 20 : 26),
        height: theme.s(compact ? 20 : 26),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
      }}
    >
      <Num size={compact ? 11 : 14} color={foreground}>{marker.finger}</Num>
    </View>
  );
});

/**
 * The same note, ringed wherever else it can be played.
 *
 * Coloured by the tape it lands on when it lands on one — because that is the
 * name the player already has for that spot — and by the note's own colour
 * when it does not. A ring rather than a filled square: the filled square is
 * the note you are playing, and these must never be mistaken for it.
 */
const BoardAlternates = memo(function BoardAlternates({
  placements, midiNumber, tapeSets, stringGap, y, compact,
}: {
  placements: readonly Placement[];
  midiNumber: number;
  tapeSets: readonly TapeSet[];
  stringGap: number;
  y: MmToY;
  compact: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const size = theme.s(compact ? 16 : 21);

  return (
    <>
      {placements.map((place) => {
        const tape = tapeForSemitones(tapeSets, place.semitones);
        const color = tape
          ? chrome.tapes[tape.color]
          : chrome.notes[noteColorName(midiNumber)];
        return (
          <View
            key={`alt-${place.string}-${place.semitones}`}
            style={{
              position: 'absolute',
              left: railX(place.string, stringGap) - size / 2
                + theme.rule(place.string === 'C' ? 1.5 : 1),
              top: y(stopDistanceMm(place.semitones)) - size / 2,
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: theme.rule(compact ? 2 : 3),
              borderColor: color,
              backgroundColor: alpha(chrome.bg, 0.55),
            }}
          />
        );
      })}
    </>
  );
});

/** What each tape gives on the string under the hand. */
const BoardNoteNames = memo(function BoardNoteNames({
  tapes, activeString, y,
}: { tapes: readonly TapeGeometry[]; activeString: CelloString; y: MmToY }) {
  const theme = useTheme();
  const { chrome } = theme;
  return (
    <>
      {tapes.map((tape) => (
        <View
          key={tape.id}
          style={{
            position: 'absolute',
            top: y(tape.mm) - theme.s(9),
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.s(6),
          }}
        >
          <Num size={13} color={chrome.tapes[tape.color]}>
            {midiToPitchName(midiAt(activeString, tape.semitones))}
          </Num>
          <Label size={9}>{tape.caption}</Label>
        </View>
      ))}
    </>
  );
});

/**
 * String name labels, drawn under a fingerboard at matching spacing.
 *
 * `gutter` must be the same value the `Fingerboard` above it was given: the
 * rails start *after* the landmark gutter, so labels laid out from the
 * container's own left edge sit a gutter's width to the left of the strings
 * they name. Each label is centred on its rail rather than hung off it, so the
 * letter sits over the line whatever the type metrics do.
 */
export function FingerboardStringLabels({
  compact = false, activeString, gutter = 46,
}: { compact?: boolean; activeString?: CelloString | null; gutter?: number }) {
  const theme = useTheme();
  const stringGap = theme.s(compact ? 15 : 26);
  const box = theme.s(compact ? 14 : 20);
  const gutterWidth = theme.s(gutter);
  return (
    <View style={{ height: theme.s(16), marginTop: theme.s(4) }}>
      {DISPLAY_STRING_ORDER.map((string) => {
        // Centre of the rail: its left edge plus half its own stroke.
        const railCentre = DISPLAY_STRING_ORDER.indexOf(string) * stringGap
          + theme.rule(string === 'C' ? 3 : 2) / 2;
        return (
          <View
            key={string}
            style={{
              position: 'absolute',
              left: gutterWidth + railCentre - box / 2,
              width: box,
              alignItems: 'center',
            }}
          >
            <Num
              size={compact ? 10 : 12}
              color={activeString && activeString !== string
                ? alpha(theme.chrome.strings[string], 0.5)
                : theme.chrome.strings[string]}
            >
              {string}
            </Num>
          </View>
        );
      })}
    </View>
  );
}

/** Footer caption naming the instrument the drawing is to scale for. (Removed per user request) */
export function FingerboardScaleNote() {
  return null;
}
