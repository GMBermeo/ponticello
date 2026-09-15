import { difficultyOf, DIFFICULTY_TIERS } from '../difficulty';
import { firstPositionFingering } from '../fingering';
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
  const origin = notes[0]?.startTimeMs ?? 0;
  const buckets = new Map<number, number[]>();

  notes.forEach((note, index) => {
    const bucket = Math.floor((note.startTimeMs - origin) / bucketMs);
    const entries = buckets.get(bucket) ?? [];
    entries.push(index);
    buckets.set(bucket, entries);
  });

  const chosen = [...buckets.values()].map((indices) => indices.reduce((best, index) => {
    const candidateScore = noteSalience(notes, index, beatMs, anchors);
    const bestScore = noteSalience(notes, best, beatMs, anchors);
    return candidateScore > bestScore ? index : best;
  }, indices[0] ?? 0));

  const spaced: number[] = [];
  for (const index of chosen) {
    const previousIndex = spaced[spaced.length - 1];
    const note = notes[index];
    const previous = previousIndex === undefined ? undefined : notes[previousIndex];
    if (!note) continue;
    if (!previous || note.startTimeMs - previous.startTimeMs >= bucketMs) {
      spaced.push(index);
      continue;
    }
    if (previousIndex !== undefined
      && noteSalience(notes, index, beatMs, anchors) > noteSalience(notes, previousIndex, beatMs, anchors)) {
      spaced[spaced.length - 1] = index;
    }
  }

  for (let i = 1; i < spaced.length; i++) {
    const index = spaced[i]!;
    const note = notes[index]!;
    const next = spaced[i + 1];
    const limit = next === undefined ? Infinity : notes[next]!.startTimeMs;
    if (!Number.isFinite(limit) || note.startTimeMs + note.durationMs + bucketMs >= limit) continue;
    const previous = spaced[i - 1];
    const floor = previous === undefined ? -Infinity : notes[previous]!.startTimeMs + bucketMs;
    let swap = -1;
    for (let j = index + 1; j < notes.length && notes[j]!.startTimeMs < limit; j++) {
      const candidate = notes[j]!;
      if (candidate.startTimeMs < floor) continue;
      if (limit - candidate.startTimeMs < bucketMs) continue;
      if (candidate.startTimeMs + candidate.durationMs <= note.startTimeMs + note.durationMs) continue;
      if (swap === -1
        || candidate.startTimeMs + candidate.durationMs > notes[swap]!.startTimeMs + notes[swap]!.durationMs) {
        swap = j;
      }
    }
    if (swap !== -1) spaced[i] = swap;
  }

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
      const report = difficultyOf(notes, notes.map((note) => firstPositionFingering(note.midiNumber)));
      if (DIFFICULTY_TIERS.indexOf(report.tier) <= DIFFICULTY_TIERS.indexOf(level)) break;
      ceiling *= 0.75;
      notes = polish(ceiling);
    }
  }
  return { fit, notes };
}
