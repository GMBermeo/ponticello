/**
 * How hard a piece is *for the left hand*.
 *
 * The library's difficulty used to be one line in the build tool:
 *
 * ```ts
 * const difficulty = (span <= 12 && bpm <= 80) ? 'Beginner'
 *   : (span <= 19 && bpm <= 120) ? 'Intermediate' : 'Advanced';
 * ```
 *
 * Pitch span and tempo. Neither is a fact about playing the cello. A two-octave
 * line of slow whole notes scores the same as two octaves of semiquavers; a
 * piece that sits in first position and never moves scores the same as one that
 * shifts to seventh and back on every bar, as long as the extremes match.
 *
 * What actually makes a cello line hard is what the hand has to *do*: how far it
 * travels, how often, how much warning it gets, how high it has to go, and how
 * many string crossings it has to make on the way. All of that is available
 * once `solveFingering` has chosen a placement for every note, so this module
 * measures it from the solved states rather than guessing from the pitches.
 *
 * Distances are in **millimetres**, never in position numbers. Positions are
 * unevenly spaced — first to second is 67 mm and sixth to seventh is 15 mm — so
 * counting them punishes low shifts and waves through high ones. This is the
 * same rule the cost model in `fingering.ts` follows, and for the same reason.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { CelloString, POSITION_ORDER, stopDistanceMm } from './cello';
import { CelloState, detectShifts, handSemitones, RawNoteEvent } from './fingering';
import { DifficultyTier } from './schema';

export type { DifficultyTier };

export const DIFFICULTY_TIERS: readonly DifficultyTier[] =
  ['Beginner', 'Intermediate', 'Advanced', 'Expert'] as const;

export interface DifficultyFactors {
  /** Millimetres of hand travel per second of music. */
  travelMmPerSec: number;
  /** Hand shifts per second. */
  shiftsPerSec: number;
  /** The largest single shift, in millimetres. */
  maxShiftMm: number;
  /**
   * Shifts the player gets under 200 ms to make, as a share of all shifts.
   * The same distance is trivial across a half note and violent across a
   * semiquaver, which is the one thing a distance-only metric cannot see.
   */
  hurriedShiftShare: number;
  /** Share of notes stopped above fourth position. */
  upperShare: number;
  /** Share of notes in thumb position. */
  thumbShare: number;
  /** String crossings that skip at least one string, per second. */
  wideCrossingsPerSec: number;
  /** Notes per second at the written tempo. */
  notesPerSec: number;
  /** Share of notes that need a first-position extension. */
  extensionShare: number;
}

export interface DifficultyReport {
  tier: DifficultyTier;
  /** 0–100. */
  score: number;
  factors: DifficultyFactors;
  /** The components contributing most, heaviest first, for the UI to explain. */
  drivers: string[];
}

/**
 * Component weights, summing to 100.
 *
 * This ordering is a consequence of the arrangement step, and it took measuring
 * to believe. The obvious weighting puts hand travel and shifting first,
 * because on a cello they *are* first — and the draft that did scored 247 of
 * 258 songs identically, because the library is folded into MIDI 36–63 and
 * `ARRANGEMENT_WEIGHTS` then anchors the hand so hard that median travel
 * across the whole library is **zero** millimetres per second and the median
 * shift count is **zero**. Weighting a constant heavily does not make it
 * informative; it only dilutes the factors that vary.
 *
 * So the weights follow what is left once the arranger has done its job.
 * **Speed** leads: at 5 notes a second a first-position line is hard to read
 * whatever the hand is doing. **Crossings** are next, because bowing across
 * three strings is the thing that actually goes wrong in these arrangements.
 * **Extensions** are a genuine strain and vary widely here.
 *
 * Travel and shifting keep real but small weights. They are near-zero across
 * the bundled library by construction — but an imported piece is not folded
 * into first position, and for those they should and do dominate.
 *
 * **Register is the exception, and it earned its weight the hard way.** At 6
 * points it could not reach a tier boundary at all: six bundled songs sat
 * *entirely* in thumb position, one of them from E4 to A5, and the tier this
 * function printed on them was "Intermediate". A rating that calls a line
 * nobody with tapes on their fingerboard can touch the second of four tiers is
 * not a small inaccuracy, it is the rating being wrong about the only thing a
 * beginner needs it to be right about. Register now carries 18 and cannot be
 * saturated by upper-neck work alone — reaching the top of it takes thumb
 * position, which is a different technique rather than more of the same one.
 */
const WEIGHTS = {
  speed: 28,
  crossings: 20,
  register: 18,
  extensions: 14,
  travel: 10,
  shifting: 10,
} as const;

/**
 * Saturation points — the value at which a component is "as hard as it gets".
 *
 * Measured from the library *after* arranging, rather than reasoned from the
 * instrument, and the difference is large: guessing 190 mm/s of hand travel as
 * the ceiling put 247 of 258 songs in one tier, which is the same as having no
 * difficulty rating at all.
 *
 * Each value sits a little above the measured 95th percentile, so the scale
 * spends its range on the music that exists rather than on a hypothetical
 * worst case. That makes the tiers relative to *this* library — Expert means
 * the hardest thing here, not the hardest thing on the instrument — which is
 * what a filter on a library screen has to mean to be useful.
 *
 * Travel and shifting were measured at 6 mm/s and 0.15 shifts/s, which was
 * true of a library fingered under `DEFAULT_WEIGHTS`, which is what the build
 * was doing at the time — while this file's own comments reasoned about
 * `ARRANGEMENT_WEIGHTS`. With the weighting actually applied, the median song
 * sits at 1.5 mm/s and the 95th percentile at 40, so the old ceilings pinned
 * two of six components to maximum for a third of the library. Re-measured.
 */
const SATURATION = {
  notesPerSec: 5.5,
  wideCrossingsPerSec: 1.1,
  extensionShare: 0.5,
  travelMmPerSec: 42,
  shiftsPerSec: 0.75,
} as const;

/**
 * Tier boundaries on the 0–100 score.
 *
 * Placed at the 33rd, 67th and 90th percentiles of the library, which is what
 * makes the four tiers usable as a filter: a third of the library is
 * approachable, a third is the next step, a fifth is a stretch, and Expert is
 * the top tenth. Boundaries chosen from the distribution rather than from round
 * numbers, because a tier that holds 60 % of the library tells a player nothing
 * — and re-measured whenever the arranger or the weights above change, because
 * they are percentiles of a distribution and not facts about the cello.
 */
const TIER_AT = { Intermediate: 11.2, Advanced: 22.8, Expert: 40.3 } as const;

/** Below this, a shift is being made in a hurry rather than prepared. */
const HURRIED_MS = 200;

/**
 * Tier floors that no amount of slowness can lower.
 *
 * The weighted score answers "how much work is this?", and for almost
 * everything that is the right question. It is the wrong question about
 * technique the player has not learned yet: a line in thumb position is not an
 * easy piece played high up, it is a piece you cannot begin until someone has
 * taught you to put your thumb on the string, and a slow one is *more*
 * exposed, not less. Left to the score alone, a placid thumb-position line
 * came out "Intermediate", which is a rating that tells the exact player it is
 * aimed at the exact wrong thing.
 *
 * So register sets a floor as well as contributing weight. Shares rather than
 * single notes, so one passing harmonic does not relabel a piece.
 */
const TIER_FLOORS: readonly { tier: DifficultyTier; test: (f: DifficultyFactors) => boolean }[] = [
  { tier: 'Advanced', test: (f) => f.thumbShare >= 0.08 },
  { tier: 'Intermediate', test: (f) => f.upperShare + f.thumbShare >= 0.12 },
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Where the hand's first finger sits, in millimetres from the nut. */
function handMm(state: CelloState): number {
  return stopDistanceMm(handSemitones(state));
}

export function measure(
  notes: readonly RawNoteEvent[], states: readonly CelloState[],
): DifficultyFactors {
  const empty: DifficultyFactors = {
    travelMmPerSec: 0, shiftsPerSec: 0, maxShiftMm: 0, hurriedShiftShare: 0,
    upperShare: 0, thumbShare: 0, wideCrossingsPerSec: 0, notesPerSec: 0,
    extensionShare: 0,
  };
  if (notes.length === 0 || states.length === 0) return empty;

  const last = notes[notes.length - 1];
  if (!last) return empty;
  const seconds = Math.max(1, (last.startTimeMs + last.durationMs) / 1000);

  let travelMm = 0;
  let maxShiftMm = 0;
  let wideCrossings = 0;
  let upper = 0;
  let thumb = 0;
  let extensions = 0;

  /** Adjacent strings are one apart; C to A is three. */
  const stringIndex: Record<CelloString, number> = { C: 0, G: 1, D: 2, A: 3 };

  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    // The guards below cannot fire — `i` is bounded by `states.length` — but
    // the compiler cannot see that under `noUncheckedIndexedAccess`, and
    // skipping a note is the honest answer if the invariant is ever broken.
    if (!state) continue;

    const order = POSITION_ORDER[state.position];
    if (state.position === 'Thumb') thumb++;
    else if (order >= 5) upper++;
    if (state.extension !== 'none') extensions++;

    if (i === 0) continue;
    const previous = states[i - 1];
    if (!previous) continue;

    // An open string does not move the hand, so it cannot contribute travel.
    if (state.finger !== '0' && previous.finger !== '0') {
      const moved = Math.abs(handMm(state) - handMm(previous));
      travelMm += moved;
      maxShiftMm = Math.max(maxShiftMm, moved);
    }
    if (Math.abs(stringIndex[state.string] - stringIndex[previous.string]) >= 2) {
      wideCrossings++;
    }
  }

  const shifts = detectShifts(notes, states);
  const hurried = shifts.filter((s) => s.preparationMs < HURRIED_MS).length;

  return {
    travelMmPerSec: travelMm / seconds,
    shiftsPerSec: shifts.length / seconds,
    maxShiftMm,
    hurriedShiftShare: shifts.length === 0 ? 0 : hurried / shifts.length,
    upperShare: upper / states.length,
    thumbShare: thumb / states.length,
    wideCrossingsPerSec: wideCrossings / seconds,
    notesPerSec: notes.length / seconds,
    extensionShare: extensions / states.length,
  };
}

/** Scores a solved line and puts it in a tier. */
export function difficultyOf(
  notes: readonly RawNoteEvent[], states: readonly CelloState[],
): DifficultyReport {
  const f = measure(notes, states);

  const components: [string, number, number][] = [
    ['hand travel', WEIGHTS.travel, clamp01(f.travelMmPerSec / SATURATION.travelMmPerSec)],
    [
      'shifting',
      WEIGHTS.shifting,
      // Rate is most of it, but a line whose shifts are all hurried is harder
      // than the same rate given time to prepare, so the share lifts it.
      clamp01(f.shiftsPerSec / SATURATION.shiftsPerSec) * (0.75 + 0.25 * f.hurriedShiftShare * 2),
    ],
    [
      'upper positions',
      WEIGHTS.register,
      // Thumb position counts double: it is a different technique, not simply
      // further up the same one. A line wholly in the upper neck therefore
      // reaches 0.5 of this component and a line wholly in thumb position
      // reaches all of it, which is the ordering a cellist would give them.
      clamp01(f.upperShare * 0.5 + f.thumbShare),
    ],
    [
      'speed',
      WEIGHTS.speed,
      // One note a second is not a speed problem for anybody, so the scale
      // starts there rather than at zero.
      clamp01((f.notesPerSec - 1) / (SATURATION.notesPerSec - 1)),
    ],
    ['string crossings', WEIGHTS.crossings, clamp01(f.wideCrossingsPerSec / SATURATION.wideCrossingsPerSec)],
    ['extensions', WEIGHTS.extensions, clamp01(f.extensionShare / SATURATION.extensionShare)],
  ];

  const score = components.reduce((sum, [, weight, value]) => sum + weight * value, 0);

  const drivers = components
    .filter(([, weight, value]) => weight * value >= 8)
    .sort((a, b) => b[1] * b[2] - a[1] * a[2])
    .map(([name]) => name);

  const scored = tierFor(score);
  const floor = TIER_FLOORS.find((entry) => entry.test(f))?.tier;
  const tier = floor && DIFFICULTY_TIERS.indexOf(floor) > DIFFICULTY_TIERS.indexOf(scored)
    ? floor
    : scored;

  return { tier, score, factors: f, drivers };
}

export function tierFor(score: number): DifficultyTier {
  if (score >= TIER_AT.Expert) return 'Expert';
  if (score >= TIER_AT.Advanced) return 'Advanced';
  if (score >= TIER_AT.Intermediate) return 'Intermediate';
  return 'Beginner';
}

/**
 * One line saying why, for the practice sheet.
 *
 * "Advanced" on its own tells a player nothing they can act on; "Advanced —
 * hand travel, speed" tells them what to go and practise.
 */
export function difficultyBlurb(report: DifficultyReport): string {
  if (report.drivers.length === 0) return 'Stays in one position at a steady tempo.';
  return report.drivers.slice(0, 3).join(' · ');
}
