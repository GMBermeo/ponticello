/**
 * What is sounding, harmonically: pitch-class weights over a time window, and
 * the chord or root they point to.
 *
 * Every harmonic question in the app goes through here — the generated
 * accompaniment, the arranger's harmonic guide, the Ollama prompt features and
 * the arrangement audit — so a change to how chords are read is made once.
 * Callers still choose their policy: the accompaniment trusts the lowest note
 * as the root (`bassBonus`), the audit deliberately does not, and the guide
 * asks only for a root.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { toPitchClass } from './cello';
import type { PitchClass } from './key';

/** Anything with a pitch and a place in time. */
export interface TimedPitch {
  midiNumber: number;
  startTimeMs: number;
  durationMs: number;
}

export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

/** Milliseconds of `note` inside `window`; zero or less when they do not meet. */
export function overlapMs(note: TimedPitch, window: TimeWindow): number {
  return Math.min(window.toMs, note.startTimeMs + note.durationMs) - Math.max(window.fromMs, note.startTimeMs);
}

/** How much each of the twelve pitch classes sounds, and the sum of all of them. */
export interface PitchClassWeights {
  weights: number[];
  total: number;
}

export interface WeighOptions<T extends TimedPitch> {
  /** Count only the part of each note inside this window. Without one, whole notes count. */
  window?: TimeWindow;
  /** Weight a note from the milliseconds it contributes. Defaults to those milliseconds. */
  weightOf?: (note: T, ms: number) => number;
}

/** Weight of each pitch class by how long it sounds. Notes that miss the window count for nothing. */
export function weighPitchClasses<T extends TimedPitch>(
  notes: readonly T[], options: WeighOptions<T> = {},
): PitchClassWeights {
  const { window, weightOf = (_note: T, ms: number) => ms } = options;
  const weights = new Array<number>(12).fill(0);
  let total = 0;
  for (const note of notes) {
    const ms = window ? overlapMs(note, window) : note.durationMs;
    if (window && ms <= 0) continue;
    const weight = weightOf(note, ms);
    weights[toPitchClass(note.midiNumber)]! += weight;
    total += weight;
  }
  return { weights, total };
}

/** One pitch class's weight, for any integer pitch class. */
export function weightAt(weights: readonly number[], pitchClass: number): number {
  return weights[toPitchClass(pitchClass)] ?? 0;
}

/** Root, third and fifth of a major or minor triad, as pitch classes. */
export function triadTones(root: PitchClass, minor: boolean): [PitchClass, PitchClass, PitchClass] {
  return [toPitchClass(root), toPitchClass(root + (minor ? 3 : 4)), toPitchClass(root + 7)];
}

/**
 * How well a triad explains the weights. The root carries the most
 * information about which chord this is, the third decides its quality, and
 * the fifth barely distinguishes anything.
 */
export function triadFit(weights: readonly number[], root: PitchClass, minor: boolean): number {
  const [, third, fifth] = triadTones(root, minor);
  return weightAt(weights, root) * 1.6 + weightAt(weights, third) * 1.2 + weightAt(weights, fifth) * 0.6;
}

export interface TriadEstimate {
  root: PitchClass;
  minor: boolean;
  score: number;
}

export interface TriadOptions {
  /** Pitch class of the lowest sounding note, when the caller trusts it as a root cue. */
  bassPc?: PitchClass | null;
  /** Added to a triad rooted on `bassPc`, as a share of the total weight. */
  bassBonus?: number;
  /** Returned when nothing scores above it; its score is the bar to beat. */
  fallback?: TriadEstimate;
}

const NO_TRIAD: TriadEstimate = { root: 0, minor: false, score: -1 };

/** The major or minor triad that best explains the weights, ties going to the lower root and to major. */
export function bestTriad(harmony: PitchClassWeights, options: TriadOptions = {}): TriadEstimate {
  const { bassPc = null, bassBonus = 0, fallback = NO_TRIAD } = options;
  let best = fallback;
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const bonus = root === bassPc ? harmony.total * bassBonus : 0;
      const score = triadFit(harmony.weights, root, minor) + bonus;
      if (score > best.score) best = { root, minor, score };
    }
  }
  return best;
}

/** Intervals a chord's root implies, with their weight: fifth and third strongly, a seventh a little. */
const ROOT_TEMPLATE: readonly (readonly [number, number])[] =
  [[0, 1.7], [7, 0.75], [4, 0.9], [3, 0.9], [10, 0.3]];

export interface RootOptions {
  /** The bass pitch class and how much of the window it covers, 0–1. */
  bass: { pc: PitchClass; share: number } | null;
  /** Pitch classes of the key; a root in the key is preferred. */
  scale: ReadonlySet<PitchClass>;
}

/**
 * The likeliest chord root, without deciding the chord's quality. Penalises a
 * root whose semitone above sounds (it is more likely a leading tone), and a
 * root that is not sounding at all. Null when nothing sounds.
 */
export function likeliestRoot(harmony: PitchClassWeights, options: RootOptions): PitchClass | null {
  const { weights, total } = harmony;
  if (total <= 0) return null;
  let best: PitchClass | null = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    let score = 0;
    for (const [interval, weight] of ROOT_TEMPLATE) score += weightAt(weights, root + interval) * weight;
    score -= weightAt(weights, root + 1) * 0.45;
    if (options.bass?.pc === root) score += total * 0.45 * options.bass.share;
    if (options.scale.has(root)) score += total * 0.15;
    if (weightAt(weights, root) <= 0) score -= total * 0.7;
    if (score > bestScore) {
      bestScore = score;
      best = root;
    }
  }
  return best;
}
