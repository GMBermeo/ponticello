import { difficultyOf, DIFFICULTY_TIERS } from '../difficulty';
import { seatLine } from '../fingering';
import { MidiNote } from '../midi';
import { ARRANGEMENT_PROFILES, ArrangementLevel, ArrangementRange } from './profiles';
import { fitLineToRange, playableAnchors, smoothLeaps, sortedNotes } from './rangeFitter';

export function recurringAnchorIndices(notes: readonly MidiNote[]): Set<number> {
  const signatures = new Map<string, number[]>();
  for (let i = 0; i + 3 < notes.length; i++) {
    const a = notes[i];
    const b = notes[i + 1];
    const c = notes[i + 2];
    const d = notes[i + 3];
    if (!a || !b || !c || !d) continue;
    const intervals = [
      b.midiNumber - a.midiNumber,
      c.midiNumber - b.midiNumber,
      d.midiNumber - c.midiNumber,
    ];
    if (intervals.every((interval) => interval === 0)) continue;
    if (intervals.every((interval) => interval === intervals[0])) continue;
    const gap = Math.max(1, b.startTimeMs - a.startTimeMs);
    const rhythm = [c.startTimeMs - b.startTimeMs, d.startTimeMs - c.startTimeMs]
      .map((value) => Math.round((value / gap) * 4) / 4);
    const signature = `${intervals.join(',')}|${rhythm.join(',')}`;
    const starts = signatures.get(signature) ?? [];
    starts.push(i);
    signatures.set(signature, starts);
  }

  const anchors = new Set<number>();
  for (const starts of signatures.values()) {
    if (starts.length < 2) continue;
    for (const start of starts) {
      anchors.add(start);
      anchors.add(start + 3);
    }
  }
  return anchors;
}

export function noteSalience(
  notes: readonly MidiNote[], index: number, beatMs: number, motifAnchors: ReadonlySet<number>,
): number {
  const note = notes[index];
  if (!note) return -Infinity;
  const previous = notes[index - 1];
  const next = notes[index + 1];
  let score = (note.velocity / 127) * 4;
  score += Math.min(6, (note.durationMs / beatMs) * 4);

  const beatDistance = Math.abs(note.startTimeMs - Math.round(note.startTimeMs / beatMs) * beatMs);
  if (beatDistance <= 35) score += 6;
  else if (beatDistance <= beatMs * 0.16) score += 2;

  if (!previous || note.startTimeMs - (previous.startTimeMs + previous.durationMs) >= beatMs * 0.45) {
    score += 8;
  }
  if (index === 0 || index === notes.length - 1) score += 7;
  if (motifAnchors.has(index)) score += 5;

  if (previous && next) {
    const into = note.midiNumber - previous.midiNumber;
    const out = next.midiNumber - note.midiNumber;
    if (into !== 0 && out !== 0 && Math.sign(into) !== Math.sign(out)) score += 4;
  }
  return score;
}

type Salience = (index: number) => number;

/** Notes grouped into windows one attack long, keeping the most salient of each. */
function mostSalientPerBucket(notes: readonly MidiNote[], bucketMs: number, salience: Salience): number[] {
  const origin = notes[0]?.startTimeMs ?? 0;
  const buckets = new Map<number, number[]>();
  notes.forEach((note, index) => {
    const bucket = Math.floor((note.startTimeMs - origin) / bucketMs);
    const entries = buckets.get(bucket) ?? [];
    entries.push(index);
    buckets.set(bucket, entries);
  });
  return [...buckets.values()].map((indices) => indices.reduce(
    (best, index) => (salience(index) > salience(best) ? index : best),
    indices[0] ?? 0,
  ));
}

/** Where two kept notes land closer than one attack apart, keeps the more salient. */
function spaceAttacks(notes: readonly MidiNote[], chosen: readonly number[], bucketMs: number, salience: Salience): number[] {
  const spaced: number[] = [];
  for (const index of chosen) {
    const note = notes[index];
    if (!note) continue;
    const previousIndex = spaced.at(-1);
    const previous = previousIndex === undefined ? undefined : notes[previousIndex];
    if (!previous || note.startTimeMs - previous.startTimeMs >= bucketMs) spaced.push(index);
    else if (previousIndex !== undefined && salience(index) > salience(previousIndex)) spaced[spaced.length - 1] = index;
  }
  return spaced;
}

/**
 * A later note, still before `limitMs` and after `floorMs`, that rings on
 * longer than the kept one — so a held note is not lost to a short attack
 * that happened to fall on the beat. −1 when there is none.
 */
function longerRingingNote(notes: readonly MidiNote[], index: number, floorMs: number, limitMs: number, bucketMs: number): number {
  const note = notes[index]!;
  const endOf = (n: MidiNote) => n.startTimeMs + n.durationMs;
  let swap = -1;
  for (let j = index + 1; j < notes.length && notes[j]!.startTimeMs < limitMs; j++) {
    const candidate = notes[j]!;
    const fits = candidate.startTimeMs >= floorMs && limitMs - candidate.startTimeMs >= bucketMs;
    const ringsLonger = endOf(candidate) > endOf(note);
    if (fits && ringsLonger && (swap === -1 || endOf(candidate) > endOf(notes[swap]!))) swap = j;
  }
  return swap;
}

/** Prefers a longer-ringing note wherever the kept one leaves a gap before the next. */
function preferRingingNotes(notes: readonly MidiNote[], spaced: number[], bucketMs: number): void {
  for (let i = 1; i < spaced.length; i++) {
    const note = notes[spaced[i]!]!;
    const next = spaced[i + 1];
    if (next === undefined) continue;
    const limitMs = notes[next]!.startTimeMs;
    if (note.startTimeMs + note.durationMs + bucketMs >= limitMs) continue;
    const floorMs = notes[spaced[i - 1]!]!.startTimeMs + bucketMs;
    const swap = longerRingingNote(notes, spaced[i]!, floorMs, limitMs, bucketMs);
    if (swap !== -1) spaced[i] = swap;
  }
}

/**
 * Reduces bow attacks while retaining phrase starts, beats, long/loud notes,
 * contour turns, and anchors of recurring motifs.
 */
export function simplifyLine(
  input: readonly MidiNote[], level: ArrangementLevel, bpm: number,
  attackCeiling = ARRANGEMENT_PROFILES[level].maxNotesPerSecond,
): MidiNote[] {
  const notes = sortedNotes(input);
  const profile = ARRANGEMENT_PROFILES[level];
  if (notes.length < 2 || !Number.isFinite(attackCeiling)) return notes;

  const bucketMs = 1000 / attackCeiling;
  const beatMs = 60000 / Math.max(20, bpm || 120);
  const anchors = recurringAnchorIndices(notes);
  const salience: Salience = (index) => noteSalience(notes, index, beatMs, anchors);

  const spaced = spaceAttacks(notes, mostSalientPerBucket(notes, bucketMs, salience), bucketMs, salience);
  preferRingingNotes(notes, spaced, bucketMs);

  return spaced.map((index, outputIndex) => {
    const note = notes[index];
    const nextIndex = spaced[outputIndex + 1];
    const next = nextIndex === undefined ? undefined : notes[nextIndex];
    if (!note) throw new Error('Arrangement selection produced an invalid note index.');
    const available = next ? Math.max(1, next.startTimeMs - note.startTimeMs - 8) : Infinity;
    return {
      ...note,
      durationMs: Math.max(1, Math.min(available, Math.max(note.durationMs, profile.minimumHoldMs))),
    };
  });
}

/** Enforce the selected difficulty after measuring the actual fingered line. */
export function preparePracticeLine(
  input: readonly MidiNote[], level: ArrangementLevel, range: ArrangementRange, bpm: number,
): { fit: { notes: MidiNote[]; octaveShift: number; foldedNotes: number }; notes: MidiNote[] } {
  const profile = ARRANGEMENT_PROFILES[level];
  const fit = fitLineToRange(input, range, profile.medianCeiling, profile.maxLeapSemitones);
  const polish = (ceiling: number) => playableAnchors(smoothLeaps(
    simplifyLine(fit.notes, level, bpm, ceiling), range, profile.maxLeapSemitones,
    profile.closedFrameOnly,
  ), level);
  let ceiling = profile.maxNotesPerSecond;
  let notes = polish(ceiling);

  if (level !== 'Expert') {
    for (let attempt = 0; attempt < 6; attempt++) {
      // Measured through the seating this level will actually ship. Scoring
      // the line against a fingering nobody plays is how a line gets reduced
      // until it looks like a Beginner line under one fingering and measures
      // as an Intermediate one under the other.
      const report = difficultyOf(notes, seatLine(notes, {
        closedFrameOnly: profile.closedFrameOnly,
      }));
      if (DIFFICULTY_TIERS.indexOf(report.tier) <= DIFFICULTY_TIERS.indexOf(level)) break;
      ceiling *= 0.75;
      notes = polish(ceiling);
    }
  }
  return { fit, notes };
}
