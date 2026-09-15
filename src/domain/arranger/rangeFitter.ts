import { firstPositionFingering } from '../fingering';
import { bestOctaveShiftToRange } from '../melody';
import { MidiNote } from '../midi';
import { ARRANGEMENT_PROFILES, ArrangementLevel, ArrangementRange } from './profiles';

export function sortedNotes(notes: readonly MidiNote[]): MidiNote[] {
  return [...notes].sort((a, b) =>
    (a.startTimeMs - b.startTimeMs)
    || (b.velocity - a.velocity)
    || (a.midiNumber - b.midiNumber));
}

export function octaveCandidates(pitch: number, range: ArrangementRange): number[] {
  const candidates: number[] = [];
  for (let octave = -10; octave <= 10; octave++) {
    const value = pitch + octave * 12;
    if (value >= range.low && value <= range.high) candidates.push(value);
  }
  return candidates;
}

/** Cost of a leap, per semitone past what the level allows. */
export const LEAP_COST = 1.1;

/**
 * Fits a line with one global octave displacement first. Only genuine span
 * outliers are repaired note-by-note, and those repairs are contour-aware.
 */
export function fitLineToRange(
  input: readonly MidiNote[], range: ArrangementRange,
  medianCeiling?: number, maxLeapSemitones = Infinity,
): { notes: MidiNote[]; octaveShift: number; foldedNotes: number } {
  const notes = sortedNotes(input);
  const { shift: octaveShift } = bestOctaveShiftToRange(
    notes.map((note) => note.midiNumber), range.low, range.high, medianCeiling,
  );

  let foldedNotes = 0;
  let previousSource: number | null = null;
  let previousFitted: number | null = null;
  const fitted = notes.map((note) => {
    const bodilyMoved = note.midiNumber + octaveShift;
    let midiNumber = bodilyMoved;

    if (midiNumber < range.low || midiNumber > range.high) {
      const candidates = octaveCandidates(bodilyMoved, range);
      if (candidates.length > 0) {
        midiNumber = candidates.reduce((best, candidate) => {
          let candidateCost = Math.abs(candidate - bodilyMoved);
          let bestCost = Math.abs(best - bodilyMoved);

          if (previousSource !== null && previousFitted !== null) {
            const sourceMove = note.midiNumber - previousSource;
            const candidateMove = candidate - previousFitted;
            const bestMove = best - previousFitted;
            if (sourceMove !== 0 && candidateMove !== 0 && Math.sign(sourceMove) !== Math.sign(candidateMove)) {
              candidateCost += 18;
            }
            if (sourceMove !== 0 && bestMove !== 0 && Math.sign(sourceMove) !== Math.sign(bestMove)) {
              bestCost += 18;
            }
            candidateCost += Math.abs(Math.abs(candidateMove) - Math.abs(sourceMove)) * 0.35;
            bestCost += Math.abs(Math.abs(bestMove) - Math.abs(sourceMove)) * 0.35;
            candidateCost += Math.max(0, Math.abs(candidateMove) - maxLeapSemitones) * LEAP_COST;
            bestCost += Math.max(0, Math.abs(bestMove) - maxLeapSemitones) * LEAP_COST;
          }
          return candidateCost < bestCost ? candidate : best;
        }, candidates[0] ?? range.low);
      } else {
        throw new RangeError('Arrangement range cannot contain this pitch class without changing the harmony.');
      }
      foldedNotes++;
    }

    previousSource = note.midiNumber;
    previousFitted = midiNumber;
    return { ...note, midiNumber };
  });

  return { notes: fitted, octaveShift, foldedNotes };
}

/**
 * Choose octaves jointly to minimize wide leaps while preserving pitch classes.
 */
export function smoothLeaps(
  input: readonly MidiNote[], range: ArrangementRange, maxLeapSemitones: number,
  closedFrameOnly = false,
): MidiNote[] {
  if (input.length === 0) return [];
  if (!closedFrameOnly && (!Number.isFinite(maxLeapSemitones) || input.length < 2)) return [...input];

  const candidates = input.map((note) => octaveCandidates(note.midiNumber, range)
    .filter((pitch) => !closedFrameOnly || firstPositionFingering(pitch).extension === 'none'));
  if (candidates.some((column) => column.length === 0)) {
    throw new RangeError('Arrangement range must contain every source pitch class.');
  }
  const placement = (pitch: number, index: number) =>
    Math.abs(pitch - input[index]!.midiNumber) * 0.05;
  let costs = candidates[0]!.map((pitch) => placement(pitch, 0));
  const back: number[][] = [[]];
  for (let i = 1; i < input.length; i++) {
    const pointers: number[] = [];
    const next = candidates[i]!.map((pitch) => {
      let best = Infinity;
      let chosen = 0;
      candidates[i - 1]!.forEach((previous, index) => {
        const excess = Math.max(0, Math.abs(pitch - previous) - maxLeapSemitones);
        const cost = costs[index]! + excess * excess * 1000 + placement(pitch, i);
        if (cost < best) { best = cost; chosen = index; }
      });
      pointers.push(chosen);
      return best;
    });
    back.push(pointers);
    costs = next;
  }
  let chosen = costs.indexOf(Math.min(...costs));
  const output = [...input];
  for (let i = input.length - 1; i >= 0; i--) {
    output[i] = { ...input[i]!, midiNumber: candidates[i]![chosen]! };
    chosen = back[i]![chosen] ?? 0;
  }
  return output;
}

/** A sparse accompaniment may rest instead of demanding an awkward crossing. */
export function playableAnchors(notes: readonly MidiNote[], level: ArrangementLevel): MidiNote[] {
  const profile = ARRANGEMENT_PROFILES[level];
  if (!profile.prefersGuide && !profile.prefersBass) return [...notes];
  const out: MidiNote[] = [];
  for (const note of notes) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(note.midiNumber - previous.midiNumber) > profile.maxLeapSemitones) continue;
    out.push(note);
  }
  return out;
}
