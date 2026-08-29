import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';

import { CENTS_ACCEPTABLE } from '@/domain/cello';
import { CelloNote, CelloSongScore } from '@/domain/schema';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha } from '@/theme/tokens';
import { Label, Num } from '../ui/primitives';
import { Playhead } from './usePlayhead';

/**
 * Score vision — engraved bass-clef notation with a live intonation ribbon.
 *
 * The ribbon is the whole point. A notehead tells you which pitch to play; it
 * cannot tell you that you are consistently eleven cents under it. Drawing the
 * measured pitch as a continuous trace across a ±30 cent band turns intonation
 * from a pass/fail verdict into a shape you can watch and correct.
 */

const PX_PER_MS = 0.2;
const PLAYHEAD_FRACTION = 0.25;
/** Stave line spacing, as a fraction of the box height, then clamped. */
const LINE_GAP_RATIO = 0.062;
const LINE_GAP_MIN = 13;
const LINE_GAP_MAX = 32;

/**
 * Half-height of the cent band, in stave spaces.
 *
 * Has to clear the notation, not merely sit outside the five lines: cello
 * writing runs to two ledger lines below the stave for the C string and two
 * above for the A, so a band pinned a space and a half out would be drawn
 * straight through the low C of any piece that uses one.
 */
const CENTS_SPACES = 5.5;

/** Diatonic index of the bass clef's bottom line, G2. */
const BASS_BOTTOM_LINE = 18;
const LETTER_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/**
 * Vertical position of a pitch on the stave, counted in half-spaces above the
 * bottom line. Derived from the note's *spelling*, not its MIDI number: F#3
 * and Gb3 sound the same and sit on different lines.
 */
export function staffStep(pitchName: string): { step: number; accidental: string | null } {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(pitchName);
  if (!match) return { step: 0, accidental: null };
  const [, letter, accidental, octave] = match;
  const diatonic = Number(octave) * 7 + LETTER_STEP[letter];
  return {
    step: diatonic - BASS_BOTTOM_LINE,
    accidental: accidental === '#' ? '♯' : accidental === 'b' ? '♭' : null,
  };
}

export interface ScoreVisionProps {
  score: CelloSongScore;
  playhead: Playhead;
  height: number;
  width: number;
  /** Live cents deviation, for the ribbon. */
  cents: SharedValue<number>;
  listening: boolean;
}

export function ScoreVision({
  score, playhead, height, width, cents, listening,
}: ScoreVisionProps) {
  const theme = useTheme();
  const { chrome } = theme;

  const drawHeight = height;
  const drawWidth = width;
  // Engraved notation has no intrinsic size — everything is a multiple of the
  // stave's line spacing — so the one number that matters is derived from the
  // box rather than fixed, and noteheads, stems and ledger lines follow it.
  const gap = Math.max(
    theme.s(LINE_GAP_MIN),
    Math.min(theme.s(LINE_GAP_MAX), drawHeight * LINE_GAP_RATIO),
  );
  const pxPerMs = theme.s(PX_PER_MS);
  const playheadX = drawWidth * PLAYHEAD_FRACTION;

  // The drawing spans seven line-spaces in all — five for the stave, one and a
  // half of cent band above and below — so the bottom line is placed to centre
  // that whole block rather than the stave alone.
  const staveBottom = drawHeight / 2 + gap * 2;
  /**
   * Cents are pinned to the stave's own geometry: zero at the middle line, and
   * the ±30 guides a stave-and-a-half clear of the top and bottom lines so the
   * ribbon never crosses the notation it is commenting on.
   */
  const centsY = (value: number) =>
    staveBottom - 2 * gap - (value / CENTS_ACCEPTABLE) * CENTS_SPACES * gap;

  const laid = useMemo(() => score.notes.map((note, index) => {
    const { step, accidental } = staffStep(note.pitchName);
    return {
      note,
      index,
      x: playheadX + note.startTimeMs * pxPerMs,
      y: staveBottom - (step / 2) * gap,
      step,
      accidental,
    };
  }), [score, playheadX, pxPerMs, staveBottom, gap]);

  const bars = useMemo(() => score.measures.map((measure) => ({
    index: measure.index,
    x: playheadX + measure.startBarTimeMs * pxPerMs,
  })), [score, playheadX, pxPerMs]);

  const field = useAnimatedStyle(() => ({
    transform: [{ translateX: -playhead.timeMs.get() * pxPerMs }],
  }));

  return (
    <View style={{ height: drawHeight, width: drawWidth, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', gap: theme.s(12) }}>
        <Label size={10}>BASS CLEF</Label>
        <Label size={10}>{score.metadata.keySignature}</Label>
        <Label size={10}>{score.metadata.timeSignature}</Label>
        <Label size={10} color={chrome.accent} style={{ marginLeft: 'auto' }}>
          {`RIBBON ±${CENTS_ACCEPTABLE}¢`}
        </Label>
      </View>

      {/* Intonation band guides, at exactly the tolerance the app judges by. */}
      {[CENTS_ACCEPTABLE, -CENTS_ACCEPTABLE].map((value) => (
        <View
          key={value}
          style={{
            position: 'absolute',
            left: theme.s(26),
            right: 0,
            top: centsY(value),
            height: theme.rule(1),
            backgroundColor: alpha(chrome.accent, 0.35),
          }}
        />
      ))}
      <View style={{ position: 'absolute', left: 0, top: centsY(CENTS_ACCEPTABLE) - theme.s(7) }}>
        <Label size={9}>{`+${CENTS_ACCEPTABLE}`}</Label>
      </View>
      <View style={{ position: 'absolute', left: 0, top: centsY(-CENTS_ACCEPTABLE) - theme.s(7) }}>
        <Label size={9}>{`−${CENTS_ACCEPTABLE}`}</Label>
      </View>

      {/* The five stave lines. */}
      {[0, 1, 2, 3, 4].map((line) => (
        <View
          key={line}
          style={{
            position: 'absolute',
            left: theme.s(26),
            right: 0,
            top: staveBottom - line * gap,
            height: theme.rule(1),
            // Stave lines carry the pitch reading; at 0.36 alpha on a dark
            // chrome they vanished, and a notehead you cannot place on a line
            // is not notation.
            backgroundColor: chrome.dim,
          }}
        />
      ))}

      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0 }, field]}>
        {bars.map((bar) => (
          <View key={`bar-${bar.index}`}>
            <View
              style={{
                position: 'absolute',
                left: bar.x - theme.s(14),
                top: staveBottom - 4 * gap,
                width: theme.rule(1),
                height: 4 * gap,
                backgroundColor: chrome.lineSoft,
              }}
            />
            <View style={{ position: 'absolute', left: bar.x - theme.s(12), top: staveBottom + gap * 2.2 }}>
              <Label size={10}>{`m.${bar.index + 1}`}</Label>
            </View>
          </View>
        ))}

        {laid.map((item) => (
          <Notehead
            key={item.note.id}
            note={item.note}
            x={item.x}
            y={item.y}
            step={item.step}
            accidental={item.accidental}
            gap={gap}
            staveBottom={staveBottom}
            active={item.index === playhead.activeIndex}
            played={item.index < playhead.activeIndex}
          />
        ))}
      </Animated.View>

      {listening ? (
        <IntonationRibbon
          cents={cents}
          width={playheadX}
          height={drawHeight}
          centsY={centsY}
          color={chrome.accent}
        />
      ) : null}

      <View
        style={{
          position: 'absolute',
          left: playheadX,
          top: theme.s(18),
          bottom: 0,
          width: theme.rule(2),
          backgroundColor: chrome.accent,
        }}
      />
    </View>
  );
}

const Notehead = memo(function Notehead({
  note, x, y, step, accidental, gap, staveBottom, active, played,
}: {
  note: CelloNote;
  x: number;
  y: number;
  step: number;
  accidental: string | null;
  gap: number;
  staveBottom: number;
  active: boolean;
  played: boolean;
}) {
  const theme = useTheme();
  const { chrome } = theme;
  const stringColor = chrome.strings[note.string];
  // Engraving proportions: a notehead fills one stave space vertically and is
  // roughly a third wider than it is tall; a stem runs three and a half spaces.
  const width = gap * 1.12;
  const headHeight = gap * 0.82;
  const stemLength = gap * 3.3;

  /** Ledger lines for anything past the top or bottom line of the stave. */
  const ledgers: number[] = [];
  for (let s = 10; s <= step; s += 2) ledgers.push(s);
  for (let s = -2; s >= step; s -= 2) ledgers.push(s);

  return (
    <View style={{ position: 'absolute', left: x - width / 2, top: 0, bottom: 0 }}>
      {ledgers.map((s) => (
        <View
          key={s}
          style={{
            position: 'absolute',
            left: -gap * 0.3,
            width: width + gap * 0.6,
            top: staveBottom - (s / 2) * gap,
            height: theme.rule(1),
            backgroundColor: chrome.line,
          }}
        />
      ))}

      {accidental === null ? null : (
        <View style={{ position: 'absolute', left: -gap * 0.85, top: y - headHeight }}>
          <Num size={14} color={played ? chrome.dim : chrome.ink}>{accidental}</Num>
        </View>
      )}

      {/* Stems point up below the middle line and down above it, as engraved. */}
      <View
        style={{
          position: 'absolute',
          left: step < 4 ? width - theme.rule(1.5) : 0,
          top: step < 4 ? y - stemLength : y,
          width: theme.rule(1.5),
          height: stemLength,
          backgroundColor: played ? chrome.lineSoft : chrome.ink,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: y - headHeight / 2,
          width,
          height: headHeight,
          borderRadius: headHeight,
          transform: [{ rotate: '-18deg' }],
          backgroundColor: active ? stringColor : (played ? chrome.lineSoft : 'transparent'),
          borderWidth: theme.rule(2),
          borderColor: played ? chrome.lineSoft : stringColor,
        }}
      />
    </View>
  );
});

// ─── Live intonation ribbon ──────────────────────────────────────────────────

/** Samples of the smoothed cents value, oldest first. */
const RIBBON_SAMPLES = 72;
const RIBBON_INTERVAL_MS = 40;

/**
 * A rolling trace of measured pitch.
 *
 * Sampled off the shared value at 25 Hz rather than every frame: the ribbon is
 * a shape to read, not an instrument reading, and 25 Hz is already smoother
 * than intonation actually changes.
 */
function IntonationRibbon({
  cents, width, height, centsY, color,
}: {
  cents: SharedValue<number>;
  width: number;
  height: number;
  centsY: (value: number) => number;
  color: string;
}) {
  const [samples, setSamples] = useState<number[]>(() => new Array(RIBBON_SAMPLES).fill(0));
  const buffer = useRef<number[]>(new Array(RIBBON_SAMPLES).fill(0));

  useEffect(() => {
    const handle = setInterval(() => {
      buffer.current = [...buffer.current.slice(1), cents.get()];
      setSamples(buffer.current);
    }, RIBBON_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [cents]);

  const points = useMemo(() => samples
    .map((value, i) => `${(i / (RIBBON_SAMPLES - 1)) * width},${centsY(value)}`)
    .join(' '), [samples, width, centsY]);

  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0 }}
      pointerEvents="none"
    >
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}
