import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import {
  EngravedMeasure, engrave, Glyph, locateMeasure, RepeatBlock,
} from '@/domain/engrave';
import { CelloSongScore } from '@/domain/schema';
import { useTheme } from '@/theme/ThemeProvider';
import { Label } from '../ui/primitives';
import { staffStep } from './ScoreVision';
import { Playhead } from './usePlayhead';

/**
 * The page.
 *
 * A reading view rather than a following view. Once a piece is learned the
 * scrolling highway stops helping — what a player wants then is the thing on a
 * music stand: the whole passage at once, repeats collapsed so it fits, and
 * nothing moving except a mark on the note currently sounding.
 *
 * Everything here is a multiple of the stave's line spacing, which is the only
 * absolute size in engraving. Set `gap` and the rest follows.
 */

/** Stave line spacing in design units. */
const GAP = 9;
/** Sixteenths of horizontal room per bar, before padding. */
const MIN_BAR_UNITS = 16;
/** Horizontal padding inside a bar, in gaps. */
const BAR_PAD = 1.2;
/** Least horizontal room one glyph may have, in gaps. A notehead is 1.24 wide. */
const MIN_GLYPH_GAPS = 2.1;
/** Vertical distance between systems, in gaps. */
const SYSTEM_GAP = 11;
/** Room at the left of the first system for clef, key and meter. */
const HEAD_GAPS = 7;

const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5 };
const FLAT_KEYS: Record<string, number> = { F: 1, BB: 2, EB: 3, AB: 4, DB: 5 };

/** Sharps (positive) or flats (negative) in a key signature. */
function keyAccidentals(keySignature: string): number {
  const match = /^\s*([A-G])([#b])?/i.exec(keySignature);
  if (!match) return 0;
  const letter = match[1].toUpperCase() + (match[2] ?? '').toUpperCase();
  if (FLAT_KEYS[letter] !== undefined) return -FLAT_KEYS[letter];
  if (SHARP_KEYS[letter] !== undefined) return SHARP_KEYS[letter];
  return 0;
}

/** Diatonic steps above the bass stave's bottom line, for the key accidentals. */
const SHARP_STEPS = [8, 5, 9, 6, 3];   // F# C# G# D# A#
const FLAT_STEPS = [4, 7, 3, 6, 2];    // Bb Eb Ab Db Gb

interface LaidGlyph {
  glyph: Glyph;
  x: number;
  /** Half-spaces above the bottom stave line. Rests sit on the middle line. */
  step: number;
  accidental: string | null;
}

interface LaidMeasure {
  measure: EngravedMeasure;
  x: number;
  width: number;
  glyphs: LaidGlyph[];
}

interface LaidSystem {
  measures: LaidMeasure[];
  /** Index into `blocks` for each measure, so repeat marks can be drawn. */
  blockOf: number[];
  firstInBlock: boolean[];
  lastInBlock: boolean[];
}

export interface ScorePageProps {
  score: CelloSongScore;
  playhead: Playhead;
  height: number;
  width: number;
  showFingerings: boolean;
}

export function ScorePage({ score, playhead, height, width, showFingerings }: ScorePageProps) {
  const theme = useTheme();
  const { chrome } = theme;
  const gap = theme.s(GAP);
  const scroller = useRef<ScrollView>(null);

  const engraved = useMemo(() => engrave(score), [score]);

  /** Pack the written measures into systems that fit the width. */
  const systems = useMemo<LaidSystem[]>(() => {
    const flat: { m: EngravedMeasure; block: number; first: boolean; last: boolean }[] = [];
    engraved.blocks.forEach((block: RepeatBlock, b) => {
      block.measures.forEach((m, i) => flat.push({
        m, block: b, first: i === 0, last: i === block.measures.length - 1,
      }));
    });

    const unitWidth = gap * 0.9;
    // A bar has to be wide enough for its *glyphs*, not just its beats. Sixteen
    // semiquavers and one semibreve both last a bar; only one of them can be
    // written in a bar's worth of width without the noteheads colliding.
    const widthOf = (m: EngravedMeasure) => Math.max(
      MIN_BAR_UNITS * unitWidth,
      m.glyphs.length * gap * MIN_GLYPH_GAPS,
    ) + gap * BAR_PAD * 2;

    const out: LaidSystem[] = [];
    let row: typeof flat = [];
    let used = gap * HEAD_GAPS;

    const flush = () => {
      if (row.length === 0) return;
      // Justify: share the leftover width out so every system reaches the margin.
      const total = row.reduce((s, r) => s + widthOf(r.m), 0);
      const slack = Math.max(0, width - gap * HEAD_GAPS - total);
      const extra = slack / row.length;

      let x = gap * HEAD_GAPS;
      const measures: LaidMeasure[] = row.map((r) => {
        const w = widthOf(r.m) + extra;
        const inner = w - gap * BAR_PAD * 2;
        const laid: LaidGlyph[] = r.m.glyphs.map((glyph) => {
          const at = x + gap * BAR_PAD + (glyph.offset / r.m.sixteenths) * inner;
          if (glyph.kind === 'rest') return { glyph, x: at, step: 4, accidental: null };
          const { step, accidental } = staffStep(glyph.pitchName);
          return { glyph, x: at, step, accidental };
        });
        const entry = { measure: r.m, x, width: w, glyphs: laid };
        x += w;
        return entry;
      });

      out.push({
        measures,
        blockOf: row.map((r) => r.block),
        firstInBlock: row.map((r) => r.first),
        lastInBlock: row.map((r) => r.last),
      });
      row = [];
      used = gap * HEAD_GAPS;
    };

    for (const entry of flat) {
      const w = widthOf(entry.m);
      if (used + w > width && row.length > 0) flush();
      row.push(entry);
      used += w;
    }
    flush();
    return out;
  }, [engraved, gap, width]);

  const systemHeight = gap * SYSTEM_GAP;
  // A stave is drawn *upward* from its origin — the bottom line is y=0 and the
  // top line is y=-4gap — so the first origin has to sit far enough down to
  // leave room for the stave, its ledger lines and the fingerings above them.
  const TOP_MARGIN = gap * 8;
  const pageHeight = Math.max(height, TOP_MARGIN + systems.length * systemHeight + gap * 4);

  // ── Follow the music ──────────────────────────────────────────────────────
  // Only while playing. Paused, the page belongs to the reader: they may want
  // to look ahead at the awkward bar four systems down without it snapping back.
  const activeSystem = useMemo(() => {
    const found = locateMeasure(engraved, playhead.measureIndex);
    if (!found) return 0;
    let seen = 0;
    for (let s = 0; s < systems.length; s++) {
      for (let i = 0; i < systems[s].measures.length; i++) {
        if (systems[s].blockOf[i] === found.block
          && seen === found.measureInBlock) return s;
        if (systems[s].blockOf[i] === found.block) seen++;
      }
    }
    return 0;
  }, [engraved, systems, playhead.measureIndex]);

  useEffect(() => {
    if (!playhead.playing) return;
    // Keep the active system a third of the way down rather than at the top,
    // so the next few bars are always already in view.
    const y = Math.max(0, TOP_MARGIN + activeSystem * systemHeight - height / 3);
    scroller.current?.scrollTo({ y, animated: true });
  }, [activeSystem, playhead.playing, systemHeight, height, TOP_MARGIN]);

  const accidentalCount = keyAccidentals(engraved.keySignature);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: theme.s(12), paddingBottom: theme.s(4) }}>
        <Label size={10}>{engraved.keySignature}</Label>
        <Label size={10}>{`${engraved.writtenMeasures} BARS WRITTEN · ${engraved.sourceMeasures} PLAYED`}</Label>
        <Label size={10} color={playhead.playing ? chrome.accent : chrome.dim}>
          {playhead.playing ? 'FOLLOWING' : 'SCROLL FREELY'}
        </Label>
      </View>
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        scrollEnabled={!playhead.playing}
        showsVerticalScrollIndicator={!playhead.playing}
      >
        <Svg width={width} height={pageHeight}>
          {systems.map((system, s) => (
            <G key={s} y={TOP_MARGIN + s * systemHeight}>
              <StaveLines width={width} gap={gap} colour={chrome.lineSoft} />
              {/* Clef and key repeat on every system, as engraving requires;
                  the meter is stated once. */}
              <Head
                gap={gap}
                colour={chrome.ink}
                accidentals={accidentalCount}
                meter={engraved.timeSignature}
                showMeter={s === 0}
              />
              {system.measures.map((laid, i) => (
                <Measure
                  key={i}
                  laid={laid}
                  gap={gap}
                  chrome={chrome}
                  activeIndex={playhead.activeIndex}
                  showFingerings={showFingerings}
                  openRepeat={system.firstInBlock[i] && engraved.blocks[system.blockOf[i]].times > 1}
                  closeRepeat={system.lastInBlock[i] && engraved.blocks[system.blockOf[i]].times > 1}
                  repeatTimes={engraved.blocks[system.blockOf[i]].times}
                  isLast={i === system.measures.length - 1}
                />
              ))}
            </G>
          ))}
        </Svg>
      </ScrollView>

    </View>
  );
}

function StaveLines({ width, gap, colour }: { width: number; gap: number; colour: string }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <Line
          key={i}
          x1={0}
          x2={width}
          y1={-i * gap}
          y2={-i * gap}
          stroke={colour}
          strokeWidth={Math.max(0.6, gap * 0.06)}
        />
      ))}
    </>
  );
}

/** Clef, key signature and — on the first system only — the time signature. */
function Head({
  gap, colour, accidentals, meter, showMeter,
}: {
  gap: number; colour: string; accidentals: number;
  meter: [number, number]; showMeter: boolean;
}) {
  const steps = accidentals >= 0 ? SHARP_STEPS : FLAT_STEPS;
  const glyph = accidentals >= 0 ? '♯' : '♭';
  const count = Math.min(Math.abs(accidentals), 5);

  return (
    <G>
      {/* Bass clef: the F line is the second from the top, so the two dots
          straddle it. Drawn rather than typeset — a music font is not worth a
          megabyte for one glyph. */}
      <SvgText x={gap * 0.3} y={-gap * 1.1} fill={colour} fontSize={gap * 4.4} fontWeight="700">
        𝄢
      </SvgText>
      {Array.from({ length: count }, (_, i) => (
        <SvgText
          key={i}
          x={gap * 2.6 + i * gap * 0.75}
          y={-(steps[i] / 2) * gap + gap * 0.45}
          fill={colour}
          fontSize={gap * 1.9}
        >
          {glyph}
        </SvgText>
      ))}
      {showMeter ? (
        <>
          <SvgText x={gap * 5.4} y={-gap * 2.6} fill={colour} fontSize={gap * 1.9} fontWeight="700">
            {String(meter[0])}
          </SvgText>
          <SvgText x={gap * 5.4} y={-gap * 0.5} fill={colour} fontSize={gap * 1.9} fontWeight="700">
            {String(meter[1])}
          </SvgText>
        </>
      ) : null}
    </G>
  );
}

interface BeamGeometry {
  up: boolean;
  x1: number; y1: number; x2: number; y2: number;
}

/**
 * Where a beam sits, and which way the stems point under it.
 *
 * Two rules do most of the work. The slope is clamped, because a beam that
 * simply joins the first and last notehead of a wide group runs off at an angle
 * no engraver would set. And the whole beam is then pushed clear of every
 * notehead in the group, so an inner note higher than both ends cannot poke
 * through it.
 */
function beamGeometry(glyphs: LaidGlyph[], gap: number): BeamGeometry {
  const first = glyphs[0];
  const last = glyphs[glyphs.length - 1];
  const average = glyphs.reduce((sum, g) => sum + g.step, 0) / glyphs.length;
  const up = average < 4;

  const STEM = 3.2;
  const stemEnd = (g: LaidGlyph) => -(g.step / 2) * gap + (up ? -gap * STEM : gap * STEM);

  let y1 = stemEnd(first);
  let y2 = stemEnd(last);

  const MAX_RISE = gap * 1.2;
  const middle = (y1 + y2) / 2;
  const half = Math.max(-MAX_RISE, Math.min(MAX_RISE, (y2 - y1) / 2));
  y1 = middle - half;
  y2 = middle + half;

  const span = Math.max(1e-6, last.x - first.x);
  for (const g of glyphs) {
    const at = y1 + ((y2 - y1) * (g.x - first.x)) / span;
    const noteY = -(g.step / 2) * gap;
    const clearance = up ? noteY - gap * 2.4 : noteY + gap * 2.4;
    const push = up ? at - clearance : clearance - at;
    if (push > 0) { y1 += up ? -push : push; y2 += up ? -push : push; }
  }

  const offset = up ? gap * 0.62 : -gap * 0.62;
  return { up, x1: first.x + offset, y1, x2: last.x + offset, y2 };
}

/** The beam's height at a given x, for a stem that has to reach it. */
function beamYAt(beam: BeamGeometry, x: number): number {
  const span = Math.max(1e-6, beam.x2 - beam.x1);
  return beam.y1 + ((beam.y2 - beam.y1) * (x - beam.x1)) / span;
}

interface MeasureProps {
  laid: LaidMeasure;
  gap: number;
  chrome: { ink: string; dim: string; accent: string; line: string; lineSoft: string };
  activeIndex: number;
  showFingerings: boolean;
  openRepeat: boolean;
  closeRepeat: boolean;
  repeatTimes: number;
  isLast: boolean;
}

function Measure({
  laid, gap, chrome, activeIndex, showFingerings,
  openRepeat, closeRepeat, repeatTimes, isLast,
}: MeasureProps) {
  const right = laid.x + laid.width;
  const rule = Math.max(0.8, gap * 0.09);

  const beams = laid.measure.beams.map(([from, to]) =>
    beamGeometry(laid.glyphs.slice(from, to + 1), gap));
  const beamFor = (index: number): BeamGeometry | null => {
    const at = laid.measure.beams.findIndex(([from, to]) => index >= from && index <= to);
    return at >= 0 ? beams[at] : null;
  };

  return (
    <G>
      {/* Barlines. A repeat's thick line and dots replace the plain one. */}
      {openRepeat ? <RepeatBar x={laid.x} gap={gap} colour={chrome.ink} facing="right" /> : null}
      {closeRepeat
        ? <RepeatBar x={right} gap={gap} colour={chrome.ink} facing="left" />
        : (
          <Line
            x1={right} x2={right} y1={0} y2={-gap * 4}
            stroke={isLast ? chrome.ink : chrome.line} strokeWidth={rule}
          />
        )}
      {closeRepeat && repeatTimes > 1 ? (
        <SvgText
          x={right - gap * 0.6}
          y={-gap * 5.2}
          fill={chrome.accent}
          fontSize={gap * 1.3}
          fontWeight="700"
          textAnchor="end"
        >
          {`×${repeatTimes}`}
        </SvgText>
      ) : null}

      {laid.glyphs.map((g, i) => (
        <GlyphMark
          key={i}
          laid={g}
          next={laid.glyphs[i + 1]}
          gap={gap}
          chrome={chrome}
          active={g.glyph.kind === 'note' && g.glyph.noteIndex === activeIndex}
          showFingerings={showFingerings}
          beam={beamFor(i)}
        />
      ))}

      {beams.map((beam, i) => (
        <Line
          key={i}
          x1={beam.x1} y1={beam.y1} x2={beam.x2} y2={beam.y2}
          stroke={chrome.ink} strokeWidth={gap * 0.34} strokeLinecap="butt"
        />
      ))}
    </G>
  );
}

function RepeatBar({
  x, gap, colour, facing,
}: { x: number; gap: number; colour: string; facing: 'left' | 'right' }) {
  const thick = gap * 0.32;
  const dotX = facing === 'right' ? x + thick + gap * 0.55 : x - thick - gap * 0.55;
  return (
    <G>
      <Rect x={facing === 'right' ? x : x - thick} y={-gap * 4} width={thick} height={gap * 4} fill={colour} />
      <Line
        x1={facing === 'right' ? x + thick + gap * 0.22 : x - thick - gap * 0.22}
        x2={facing === 'right' ? x + thick + gap * 0.22 : x - thick - gap * 0.22}
        y1={0} y2={-gap * 4} stroke={colour} strokeWidth={Math.max(0.8, gap * 0.08)}
      />
      <Circle cx={dotX} cy={-gap * 1.5} r={gap * 0.16} fill={colour} />
      <Circle cx={dotX} cy={-gap * 2.5} r={gap * 0.16} fill={colour} />
    </G>
  );
}

function GlyphMark({
  laid, next, gap, chrome, active, showFingerings, beam,
}: {
  laid: LaidGlyph;
  next: LaidGlyph | undefined;
  gap: number;
  chrome: { ink: string; dim: string; accent: string; line: string; lineSoft: string };
  active: boolean;
  showFingerings: boolean;
  beam: BeamGeometry | null;
}) {
  const { glyph } = laid;
  const y = -(laid.step / 2) * gap;
  const colour = active ? chrome.accent : chrome.ink;

  if (glyph.kind === 'rest') {
    return <RestMark x={laid.x} gap={gap} sixteenths={glyph.sixteenths} colour={chrome.dim} />;
  }

  const hollow = glyph.sixteenths >= 8;
  // Under a beam the whole group shares one stem direction, or the beam would
  // have to cross the stave to reach them.
  const up = beam ? beam.up : laid.step < 4;
  const stemX = laid.x + (up ? gap * 0.62 : -gap * 0.62);
  const stemY = beam ? beamYAt(beam, stemX) : y + (up ? -gap * 3.2 : gap * 3.2);
  const flags = glyph.sixteenths <= 1 ? 2 : glyph.sixteenths < 4 ? 1 : 0;

  return (
    <G>
      {/* Ledger lines, above and below the stave. */}
      {ledgerSteps(laid.step).map((step) => (
        <Line
          key={step}
          x1={laid.x - gap * 0.95} x2={laid.x + gap * 0.95}
          y1={-(step / 2) * gap} y2={-(step / 2) * gap}
          stroke={chrome.lineSoft} strokeWidth={Math.max(0.6, gap * 0.07)}
        />
      ))}

      {active ? <Circle cx={laid.x} cy={y} r={gap * 1.25} fill={chrome.accent} opacity={0.18} /> : null}

      {laid.accidental ? (
        <SvgText
          x={laid.x - gap * 1.1} y={y + gap * 0.42}
          fill={colour} fontSize={gap * 1.7} textAnchor="end"
        >
          {laid.accidental}
        </SvgText>
      ) : null}

      <Ellipse
        cx={laid.x} cy={y} rx={gap * 0.62} ry={gap * 0.46}
        fill={hollow ? 'none' : colour}
        stroke={colour}
        strokeWidth={hollow ? Math.max(1, gap * 0.13) : 0}
      />

      {glyph.dots > 0 ? (
        <Circle cx={laid.x + gap * 1.0} cy={y - gap * 0.25} r={gap * 0.14} fill={colour} />
      ) : null}

      {glyph.sixteenths < 16 ? (
        <Line x1={stemX} y1={y} x2={stemX} y2={stemY} stroke={colour} strokeWidth={Math.max(0.9, gap * 0.1)} />
      ) : null}

      {!beam && flags > 0
        ? Array.from({ length: flags }, (_, i) => (
          <Path
            key={i}
            d={`M ${stemX} ${stemY + (up ? i * gap * 0.5 : -i * gap * 0.5)}
                q ${gap * 0.9} ${up ? gap * 0.5 : -gap * 0.5} ${gap * 0.55} ${up ? gap * 1.5 : -gap * 1.5}`}
            stroke={colour} strokeWidth={Math.max(0.9, gap * 0.11)} fill="none"
          />
        ))
        : null}

      {glyph.tiedTo && next ? (
        <Path
          d={`M ${laid.x + gap * 0.7} ${y + gap * 0.6}
              Q ${(laid.x + next.x) / 2} ${y + gap * 1.5} ${next.x - gap * 0.7} ${y + gap * 0.6}`}
          stroke={colour} strokeWidth={Math.max(0.8, gap * 0.09)} fill="none"
        />
      ) : null}

      {showFingerings && !glyph.tiedFrom ? (
        <SvgText
          x={laid.x} y={y - gap * (up ? 4.2 : 1.4)}
          fill={active ? chrome.accent : chrome.dim}
          fontSize={gap * 1.15} fontWeight="700" textAnchor="middle"
        >
          {glyph.finger}
        </SvgText>
      ) : null}
    </G>
  );
}

/** Every ledger line a notehead at `step` needs, above or below the stave. */
function ledgerSteps(step: number): number[] {
  const out: number[] = [];
  for (let s = 10; s <= step; s += 2) out.push(s);
  for (let s = -2; s >= step; s -= 2) out.push(s);
  return out;
}

function RestMark({
  x, gap, sixteenths, colour,
}: { x: number; gap: number; sixteenths: number; colour: string }) {
  // A bar's rest hangs under the fourth line; shorter rests sit on the middle.
  if (sixteenths >= 16) {
    return <Rect x={x - gap * 0.55} y={-gap * 3} width={gap * 1.1} height={gap * 0.42} fill={colour} />;
  }
  if (sixteenths >= 8) {
    return <Rect x={x - gap * 0.55} y={-gap * 2} width={gap * 1.1} height={gap * 0.42} fill={colour} />;
  }
  const strokes = sixteenths >= 4 ? 1 : sixteenths >= 2 ? 2 : 3;
  return (
    <G>
      {Array.from({ length: strokes }, (_, i) => (
        <Path
          key={i}
          d={`M ${x - gap * 0.4} ${-gap * 2.6 + i * gap * 0.62}
              q ${gap * 0.5} ${gap * 0.3} ${gap * 0.8} ${gap * 0.05}`}
          stroke={colour} strokeWidth={Math.max(0.8, gap * 0.1)} fill="none"
        />
      ))}
    </G>
  );
}
