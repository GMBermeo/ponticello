/**
 * Turning a score into engraved notation.
 *
 * The app's scores are millisecond timings, because that is what a MIDI file
 * and a playhead deal in. Notation deals in note *values* — a crotchet, a
 * dotted quaver — so something has to decide that a note lasting 237 ms at 126
 * bpm is a quaver. That decision is quantisation, and in this library it is not
 * a formality: better than a third of the bundled songs came from recorded
 * performances where fewer than three note starts in four land on a sixteenth
 * grid. Printed literally they are unreadable.
 *
 * So quantisation happens *here*, on the way to the page, and the stored score
 * is never touched. The playhead, the tab view and the accompaniment all keep
 * the original human timing; only the engraving is regularised. The cost is
 * that a printed note and the playhead can disagree by up to half a sixteenth,
 * which is the right trade for a page you read rather than follow.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { CelloNote, CelloSongScore, measureDurationMs } from './schema';

/** Everything is counted in sixteenth notes. Four to the beat. */
export const SIXTEENTHS_PER_BEAT = 4;

/**
 * Writable note values, in sixteenths, longest first.
 *
 * Only values a single notehead can express: a plain note, or a note with one
 * or two dots. Anything else is written as tied notes, which is what a
 * copyist does too.
 */
type DotCount = 0 | 1 | 2;

const WRITABLE: { sixteenths: number; dots: DotCount }[] = [
  { sixteenths: 16, dots: 0 }, // semibreve
  { sixteenths: 14, dots: 2 },
  { sixteenths: 12, dots: 1 }, // dotted minim
  { sixteenths: 8, dots: 0 },  // minim
  { sixteenths: 7, dots: 2 },
  { sixteenths: 6, dots: 1 },  // dotted crotchet
  { sixteenths: 4, dots: 0 },  // crotchet
  { sixteenths: 3, dots: 1 },  // dotted quaver
  { sixteenths: 2, dots: 0 },  // quaver
  { sixteenths: 1, dots: 0 },  // semiquaver
];

export interface NoteGlyph {
  kind: 'note';
  /** Index into `score.notes`, so the playhead can find its glyph. */
  noteIndex: number;
  midiNumber: number;
  pitchName: string;
  sixteenths: number;
  dots: DotCount;
  /** Position within the measure, in sixteenths from its start. */
  offset: number;
  /** Continues a note begun in the previous glyph. */
  tiedFrom: boolean;
  /** Is continued by the next glyph. */
  tiedTo: boolean;
  finger: string;
  string: string;
}

export interface RestGlyph {
  kind: 'rest';
  sixteenths: number;
  dots: DotCount;
  offset: number;
}

export type Glyph = NoteGlyph | RestGlyph;

export interface EngravedMeasure {
  /** Index of the source measure. */
  index: number;
  glyphs: Glyph[];
  /**
   * Runs of consecutive glyph indices to join with a beam. Quavers and shorter
   * only, grouped so a beam never crosses a beat — which is how a reader finds
   * the pulse without counting.
   */
  beams: [number, number][];
  sixteenths: number;
}

export interface RepeatBlock {
  measures: EngravedMeasure[];
  /** How many times to play it. 1 means no repeat marks. */
  times: number;
  /** Source measure indices covered, inclusive, across all passes. */
  from: number;
  to: number;
}

export interface EngravedScore {
  timeSignature: [number, number];
  keySignature: string;
  /** Sixteenths in one bar. */
  barSixteenths: number;
  blocks: RepeatBlock[];
  /** Measures written once, after repeat collapsing. */
  writtenMeasures: number;
  /** Measures the piece actually lasts. */
  sourceMeasures: number;
}

// ─── Rhythm ──────────────────────────────────────────────────────────────────

/**
 * Splits a length in sixteenths into writable values.
 *
 * Greedy from the longest value down, which is what makes 5 come out as a
 * crotchet tied to a semiquaver rather than five separate semiquavers.
 */
export function decomposeDuration(sixteenths: number): { sixteenths: number; dots: DotCount }[] {
  const out: { sixteenths: number; dots: DotCount }[] = [];
  let left = Math.max(1, Math.round(sixteenths));
  let guard = 0;
  while (left > 0 && guard++ < 64) {
    const fit = WRITABLE.find((w) => w.sixteenths <= left);
    if (!fit) break;
    out.push(fit);
    left -= fit.sixteenths;
  }
  return out.length > 0 ? out : [{ sixteenths: 1, dots: 0 }];
}

export interface QuantisedNote {
  noteIndex: number;
  /** Sixteenths from the start of the piece. */
  start: number;
  /** Length in sixteenths, at least 1. */
  length: number;
}

/**
 * Snaps a score's millisecond timings onto a sixteenth grid.
 *
 * Overlaps are trimmed rather than dropped, and a note that quantises to zero
 * length is given a single sixteenth: on this material a very short note is
 * usually a grace or a strum artefact, and printing it is more honest than
 * silently losing a pitch the player will hear on the backing.
 */
export function quantiseScore(score: CelloSongScore): QuantisedNote[] {
  const bpm = score.metadata.bpm || 80;
  const msPerSixteenth = (60_000 / bpm) / SIXTEENTHS_PER_BEAT;

  const out: QuantisedNote[] = [];
  score.notes.forEach((note, noteIndex) => {
    const start = Math.round(note.startTimeMs / msPerSixteenth);
    const end = Math.round((note.startTimeMs + note.durationMs) / msPerSixteenth);
    out.push({ noteIndex, start, length: Math.max(1, end - start) });
  });

  out.sort((a, b) => a.start - b.start || a.noteIndex - b.noteIndex);

  // One voice: a note may not begin before the previous one has finished.
  //
  // Trimming the previous note is not enough on its own. Two notes can quantise
  // to the *same* start — a chord in the source, or two notes a few
  // milliseconds apart — and there is then no room to trim into. Shortening the
  // first to a minimum of one sixteenth still leaves it overlapping, and the
  // second is then written at a point the bar has already passed, which
  // silently overfills the bar. So a note with nowhere to go is moved after the
  // one before it instead.
  for (let i = 1; i < out.length; i++) {
    const previous = out[i - 1];
    const current = out[i];
    if (!previous || !current) continue;

    const previousEnd = previous.start + previous.length;
    if (current.start >= previousEnd) continue;

    const room = current.start - previous.start;
    if (room >= 1) previous.length = room;
    else current.start = previousEnd;
  }
  return out;
}

// ─── Measures ────────────────────────────────────────────────────────────────

function beamRuns(glyphs: Glyph[], beatSixteenths: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;

  const beamable = (g: Glyph) => g.kind === 'note' && g.sixteenths < 4 && g.dots === 0;
  const beatOf = (offset: number) => Math.floor(offset / beatSixteenths);

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    if (!g) continue;
    const anchor = start >= 0 ? glyphs[start] : undefined;
    const continues = beamable(g)
      && anchor !== undefined
      // A beam that crosses a beat hides the pulse rather than showing it.
      && beatOf(g.offset) === beatOf(anchor.offset);

    if (continues) continue;
    if (start >= 0 && i - start > 1) runs.push([start, i - 1]);
    start = beamable(g) ? i : -1;
  }
  if (start >= 0 && glyphs.length - start > 1) runs.push([start, glyphs.length - 1]);
  return runs;
}

/**
 * Lays quantised notes into measures, filling silence with rests and tying
 * anything that crosses a barline.
 */
export function buildMeasures(
  score: CelloSongScore, quantised: QuantisedNote[],
): EngravedMeasure[] {
  const [beats = 4, unit = 4] = score.metadata.timeSignature.split('/').map(Number);
  const barSixteenths = Math.max(1, Math.round(beats * (16 / (unit || 4))));
  const beatSixteenths = Math.max(1, Math.round(16 / (unit || 4)));

  const totalSixteenths = quantised.length === 0
    ? barSixteenths
    : Math.max(...quantised.map((q) => q.start + q.length));
  const barCount = Math.max(1, Math.ceil(totalSixteenths / barSixteenths));

  const measures: EngravedMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index, glyphs: [], beams: [], sixteenths: barSixteenths,
  }));

  /** Writes a span into whichever measures it covers, tying across barlines. */
  const place = (start: number, length: number, note: CelloNote | null, noteIndex: number) => {
    let cursor = start;
    let left = length;
    let first = true;

    while (left > 0) {
      const bar = Math.floor(cursor / barSixteenths);
      const target = measures[bar];
      if (!target) return;
      const intoBar = cursor - bar * barSixteenths;
      const room = barSixteenths - intoBar;
      const take = Math.min(left, room);

      for (const value of decomposeDuration(take)) {
        const glyph: Glyph = note
          ? {
            kind: 'note',
            noteIndex,
            midiNumber: note.midiNumber,
            pitchName: note.pitchName,
            sixteenths: value.sixteenths,
            dots: value.dots,
            offset: cursor - bar * barSixteenths,
            tiedFrom: !first,
            tiedTo: false,
            finger: note.finger,
            string: note.string,
          }
          : { kind: 'rest', sixteenths: value.sixteenths, dots: value.dots, offset: cursor - bar * barSixteenths };

        const previous = target.glyphs[target.glyphs.length - 1];
        if (note && previous && previous.kind === 'note' && previous.noteIndex === noteIndex) {
          previous.tiedTo = true;
        }
        target.glyphs.push(glyph);
        cursor += value.sixteenths;
        first = false;
      }
      left -= take;
    }
  };

  let written = 0;
  for (const q of quantised) {
    if (q.start > written) place(written, q.start - written, null, -1);
    place(q.start, q.length, score.notes[q.noteIndex] ?? null, q.noteIndex);
    written = Math.max(written, q.start + q.length);
  }
  // Pad the final bar so it is not left visually short.
  const tail = barCount * barSixteenths - written;
  if (tail > 0) place(written, tail, null, -1);

  // Tie flags across a barline: the last glyph of a bar and the first of the
  // next belong to one note whenever they share a note index.
  for (let i = 1; i < measures.length; i++) {
    const before = measures[i - 1];
    const after = measures[i];
    if (!before || !after) continue;
    const previous = before.glyphs[before.glyphs.length - 1];
    const next = after.glyphs[0];
    if (previous?.kind === 'note' && next?.kind === 'note' && previous.noteIndex === next.noteIndex) {
      previous.tiedTo = true;
      next.tiedFrom = true;
    }
  }

  for (const m of measures) m.beams = beamRuns(m.glyphs, beatSixteenths);
  return measures;
}

// ─── Repeats ─────────────────────────────────────────────────────────────────

/** A measure's content as a string, for comparing bars. */
function measureKey(m: EngravedMeasure): string {
  return m.glyphs.map(glyphKey).join('|');
}

function glyphKey(glyph: EngravedMeasure['glyphs'][number]): string {
  if (glyph.kind !== 'note') return `r${glyph.sixteenths}.${glyph.dots}`;
  const tie = glyph.tiedFrom ? 't' : '';
  return `n${glyph.midiNumber}.${glyph.sixteenths}.${glyph.dots}${tie}`;
}

/** Whether bars `[a, a + size)` and `[b, b + size)` have identical content. */
function sameBars(keys: readonly string[], a: number, b: number, size: number): boolean {
  for (let k = 0; k < size; k++) {
    if (keys[a + k] !== keys[b + k]) return false;
  }
  return true;
}

/** How many times the `size`-bar block at `start` plays in a row, counting itself. */
function consecutiveTimes(keys: readonly string[], start: number, size: number): number {
  let times = 1;
  while (start + size * (times + 1) <= keys.length && sameBars(keys, start, start + size * times, size)) times++;
  return times;
}

/**
 * The longest block starting at `start` that repeats at once, or null.
 * Prefer the longest: a four-bar phrase read as two repeated two-bar halves
 * is not how anyone counts it.
 */
function repeatAt(keys: readonly string[], start: number): { size: number; times: number } | null {
  for (let size = MAX_REPEAT_BARS; size >= MIN_REPEAT_BARS; size--) {
    if (start + size * 2 > keys.length) continue;
    const times = consecutiveTimes(keys, start, size);
    if (times > 1) return { size, times };
  }
  return null;
}

/** Shortest block worth collapsing. One repeated bar is not worth the marks. */
const MIN_REPEAT_BARS = 2;
/** Longest block to look for, so detection stays linear enough. */
const MAX_REPEAT_BARS = 8;

/**
 * Collapses immediately-repeated groups of bars into repeat blocks.
 *
 * Only *adjacent* repeats, because that is what a repeat barline means. A
 * chorus returning after a verse is a different notation problem (segno, coda)
 * and pretending a repeat sign covers it would send the reader to the wrong bar.
 */
export function detectRepeats(measures: EngravedMeasure[]): RepeatBlock[] {
  const keys = measures.map(measureKey);
  const blocks: RepeatBlock[] = [];
  let i = 0;

  while (i < measures.length) {
    const chosen = repeatAt(keys, i);
    const here = measures[i];
    if (!here) break;

    if (chosen) {
      blocks.push({
        measures: measures.slice(i, i + chosen.size),
        times: chosen.times,
        from: i,
        to: i + chosen.size * chosen.times - 1,
      });
      i += chosen.size * chosen.times;
    } else {
      blocks.push({ measures: [here], times: 1, from: i, to: i });
      i++;
    }
  }
  return blocks;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function engrave(score: CelloSongScore): EngravedScore {
  const [beats = 4, unit = 4] = score.metadata.timeSignature.split('/').map(Number);
  const measures = buildMeasures(score, quantiseScore(score));
  const blocks = detectRepeats(measures);

  return {
    timeSignature: [beats || 4, unit || 4],
    keySignature: score.metadata.keySignature,
    barSixteenths: Math.max(1, Math.round((beats || 4) * (16 / (unit || 4)))),
    blocks,
    writtenMeasures: blocks.reduce((n, b) => n + b.measures.length, 0),
    sourceMeasures: measures.length,
  };
}

/**
 * Which written measure a source measure index falls in, and on which pass.
 *
 * The playhead moves through the piece; the page shows each repeated block
 * once. This is the map between them, and without it the highlight lands on
 * the wrong bar the moment anything repeats.
 */
export function locateMeasure(
  engraved: EngravedScore, sourceMeasure: number,
): { block: number; measureInBlock: number; pass: number } | null {
  for (let b = 0; b < engraved.blocks.length; b++) {
    const block = engraved.blocks[b];
    if (!block) continue;
    if (sourceMeasure < block.from || sourceMeasure > block.to) continue;
    const into = sourceMeasure - block.from;
    return {
      block: b,
      measureInBlock: into % block.measures.length,
      pass: Math.floor(into / block.measures.length),
    };
  }
  return null;
}

/** Measure duration in ms, for mapping playhead time onto engraved bars. */
export function barDurationMs(score: CelloSongScore): number {
  const [beats = 4, unit = 4] = score.metadata.timeSignature.split('/').map(Number);
  return measureDurationMs([beats, unit], score.metadata.bpm || 80);
}
