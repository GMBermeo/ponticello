/**
 * A single, cello-specific arrangement boundary for every MIDI entry path.
 *
 * Source selection asks which part carries the recognisable material; range
 * fitting moves that line bodily by octaves before repairing true outliers;
 * difficulty reduction keeps rhythmic/motif anchors rather than every Nth
 * event; and fingering happens only after those musical decisions are final.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { midiToFrequency, midiToPitchName, OPEN_STRING_MIDI } from './cello';
import { DIFFICULTY_TIERS } from './difficulty';
import { RawNoteEvent, solveFingering } from './fingering';
import {
  bestOctaveShiftToRange, MelodyMetrics, melodyMetrics, rankMelodyTracks,
} from './melody';
import { MidiNote, monophonic, ParsedMidi } from './midi';
import { CelloNote, CelloSongScore, DifficultyTier, scoreDurationMs } from './schema';

export type ArrangementLevel = DifficultyTier;
export type ArrangementSourceKind = 'riff' | 'melody' | 'bass' | 'roots';

export interface ArrangementRange {
  low: number;
  high: number;
}

/** Practical solo compass from C2 through A5, shared by imports and builds. */
export const FULL_CELLO_RANGE: ArrangementRange = {
  low: OPEN_STRING_MIDI.C,
  high: 81,
};

export const ARRANGEMENT_LEVELS: readonly ArrangementLevel[] = DIFFICULTY_TIERS;

interface ArrangementProfile {
  maxNotesPerSecond: number;
  minimumHoldMs: number;
  range: ArrangementRange;
}

/**
 * The labels are deliberately musical rather than arbitrary percentages:
 * easier levels reduce bow attacks and register; Full preserves every event.
 */
export const ARRANGEMENT_PROFILES: Record<ArrangementLevel, ArrangementProfile> = {
  Beginner: {
    maxNotesPerSecond: 2.5,
    minimumHoldMs: 220,
    range: { low: 36, high: 63 },
  },
  Intermediate: {
    maxNotesPerSecond: 4,
    minimumHoldMs: 140,
    range: { low: 36, high: 69 },
  },
  Advanced: {
    maxNotesPerSecond: 6,
    minimumHoldMs: 90,
    range: { low: 36, high: 76 },
  },
  Expert: {
    maxNotesPerSecond: Infinity,
    minimumHoldMs: 35,
    range: FULL_CELLO_RANGE,
  },
};

export interface ArrangedLine {
  notes: MidiNote[];
  sourceTrack: number | null;
  octaveShift: number;
  originalNoteCount: number;
  keptNoteCount: number;
  sourceKind: ArrangementSourceKind;
  /** Notes which needed an individual octave repair after the whole-line move. */
  foldedNotes: number;
  /** Absolute source time which became arrangement time zero. */
  originMs: number;
  /** Robust absolute end of the musical file, excluding remote corrupt events. */
  sourceEndMs: number;
  metrics: MelodyMetrics | null;
}

export interface ArrangeMidiOptions {
  level: ArrangementLevel;
  /** A player's explicit track choice bypasses automatic viability thresholds. */
  sourceTrack?: number | null;
  range?: ArrangementRange;
}

function sortedNotes(notes: readonly MidiNote[]): MidiNote[] {
  return [...notes].sort((a, b) =>
    (a.startTimeMs - b.startTimeMs)
    || (b.velocity - a.velocity)
    || (a.midiNumber - b.midiNumber));
}

function octaveCandidates(pitch: number, range: ArrangementRange): number[] {
  const candidates: number[] = [];
  for (let octave = -10; octave <= 10; octave++) {
    const value = pitch + octave * 12;
    if (value >= range.low && value <= range.high) candidates.push(value);
  }
  return candidates;
}

/**
 * Fits a line with one global octave displacement first. Only genuine span
 * outliers are repaired note-by-note, and those repairs are contour-aware.
 */
export function fitLineToRange(
  input: readonly MidiNote[], range: ArrangementRange,
): { notes: MidiNote[]; octaveShift: number; foldedNotes: number } {
  const notes = sortedNotes(input);
  const { shift: octaveShift } = bestOctaveShiftToRange(
    notes.map((note) => note.midiNumber), range.low, range.high,
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
            // Reversing a contour is much more audible than compressing it.
            if (sourceMove !== 0 && candidateMove !== 0 && Math.sign(sourceMove) !== Math.sign(candidateMove)) {
              candidateCost += 18;
            }
            if (sourceMove !== 0 && bestMove !== 0 && Math.sign(sourceMove) !== Math.sign(bestMove)) {
              bestCost += 18;
            }
            candidateCost += Math.abs(Math.abs(candidateMove) - Math.abs(sourceMove)) * 0.35;
            bestCost += Math.abs(Math.abs(bestMove) - Math.abs(sourceMove)) * 0.35;
          }
          return candidateCost < bestCost ? candidate : best;
        }, candidates[0] ?? range.low);
      } else {
        midiNumber = Math.max(range.low, Math.min(range.high, bodilyMoved));
      }
      foldedNotes++;
    }

    previousSource = note.midiNumber;
    previousFitted = midiNumber;
    return { ...note, midiNumber };
  });

  return { notes: fitted, octaveShift, foldedNotes };
}

function recurringAnchorIndices(notes: readonly MidiNote[]): Set<number> {
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

function noteSalience(
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
): MidiNote[] {
  const notes = sortedNotes(input);
  const profile = ARRANGEMENT_PROFILES[level];
  if (notes.length < 2 || !Number.isFinite(profile.maxNotesPerSecond)) return notes;

  const bucketMs = 1000 / profile.maxNotesPerSecond;
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

  // Bucket boundaries can otherwise leave two attacks only a few milliseconds
  // apart. Resolve those pairs by the same musical salience rule.
  const spaced: number[] = [];
  for (const index of chosen) {
    const previousIndex = spaced[spaced.length - 1];
    const note = notes[index];
    const previous = previousIndex === undefined ? undefined : notes[previousIndex];
    if (!note) continue;
    if (!previous || note.startTimeMs - previous.startTimeMs >= bucketMs * 0.55) {
      spaced.push(index);
      continue;
    }
    if (previousIndex !== undefined
      && noteSalience(notes, index, beatMs, anchors) > noteSalience(notes, previousIndex, beatMs, anchors)) {
      spaced[spaced.length - 1] = index;
    }
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

function isBassProgram(program: number | null): boolean {
  return program !== null && program >= 32 && program <= 39;
}

function sourceKind(metrics: MelodyMetrics, program: number | null): ArrangementSourceKind {
  if (metrics.motifRecurrence >= 0.3) return 'riff';
  if (isBassProgram(program)) return 'bass';
  return 'melody';
}

/** One lowest structural pitch per beat when no track can carry a solo line. */
function rootGuide(parsed: ParsedMidi, level: ArrangementLevel): MidiNote[] {
  const melodicTracks = new Set(parsed.tracks.filter((track) => !track.isPercussion).map((track) => track.index));
  const source = sortedNotes(parsed.notes.filter((note) => melodicTracks.has(note.track)));
  if (source.length === 0) return [];

  const beatMs = 60000 / Math.max(20, parsed.bpm || 120);
  const origin = source[0]?.startTimeMs ?? 0;
  const buckets = new Map<number, MidiNote[]>();
  for (const note of source) {
    const bucket = Math.floor((note.startTimeMs - origin) / beatMs);
    const values = buckets.get(bucket) ?? [];
    values.push(note);
    buckets.set(bucket, values);
  }

  const roots = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, values]) => {
    const root = values.reduce((lowest, note) => note.midiNumber < lowest.midiNumber ? note : lowest, values[0] as MidiNote);
    return {
      ...root,
      startTimeMs: origin + bucket * beatMs,
      durationMs: Math.max(80, beatMs * 0.88),
      velocity: Math.max(72, root.velocity),
    };
  });
  return simplifyLine(roots, level, parsed.bpm);
}

/**
 * MIDI files in the wild occasionally contain one event hours after the song.
 * When at least three musical tracks agree on a normal ending, treat a lone end
 * beyond both 1.8× and two minutes past the median as corrupt. A genuinely long
 * composition has its tracks ending together and therefore remains untouched.
 */
export function midiContentEndMs(parsed: ParsedMidi): number {
  const ends = parsed.tracks
    .filter((track) => !track.isPercussion && track.noteCount > 0)
    .map((track) => parsed.notes
      .filter((note) => note.track === track.index)
      .reduce((end, note) => Math.max(end, note.startTimeMs + note.durationMs), 0))
    .filter((end) => end > 0)
    .sort((a, b) => a - b);

  if (ends.length < 3) return parsed.durationMs;
  const median = ends[Math.floor(ends.length / 2)] ?? parsed.durationMs;
  const outlierAt = Math.max(median * 1.8, median + 120_000);
  if (parsed.durationMs <= outlierAt) return parsed.durationMs;

  const plausible = ends.filter((end) => end <= outlierAt);
  return plausible[plausible.length - 1] ?? median;
}

/** Arrange a parsed MIDI through the same policy on device and at build time. */
export function arrangeMidi(parsed: ParsedMidi, options: ArrangeMidiOptions): ArrangedLine {
  const sourceEndMs = midiContentEndMs(parsed);
  const musicalNotes = parsed.notes
    .filter((note) => note.startTimeMs < sourceEndMs)
    .map((note) => ({
      ...note,
      durationMs: Math.max(1, Math.min(note.durationMs, sourceEndMs - note.startTimeMs)),
    }));
  const musicalParsed: ParsedMidi = {
    ...parsed,
    notes: musicalNotes,
    durationMs: sourceEndMs,
  };
  const range = options.range ?? ARRANGEMENT_PROFILES[options.level].range;
  let sourceTrack: number | null = null;
  let source: MidiNote[] = [];
  let metrics: MelodyMetrics | null = null;
  let kind: ArrangementSourceKind = 'roots';

  if (options.sourceTrack !== undefined && options.sourceTrack !== null) {
    sourceTrack = options.sourceTrack;
    source = monophonic(musicalNotes.filter((note) => note.track === sourceTrack));
    metrics = melodyMetrics(source, sourceEndMs);
    const descriptor = parsed.tracks.find((track) => track.index === sourceTrack);
    kind = sourceKind(metrics, descriptor?.program ?? null);
  } else {
    const choice = rankMelodyTracks(musicalParsed)[0];
    if (choice) {
      sourceTrack = choice.track;
      source = monophonic(musicalNotes.filter((note) => note.track === sourceTrack));
      metrics = choice.metrics;
      const descriptor = parsed.tracks.find((track) => track.index === sourceTrack);
      kind = sourceKind(choice.metrics, descriptor?.program ?? null);
    } else {
      source = rootGuide(musicalParsed, options.level);
    }
  }

  if (source.length === 0) {
    return {
      notes: [], sourceTrack, octaveShift: 0, originalNoteCount: 0, keptNoteCount: 0,
      sourceKind: kind, foldedNotes: 0, originMs: 0, sourceEndMs, metrics,
    };
  }

  const originalNoteCount = source.length;
  const originMs = source[0]?.startTimeMs ?? 0;
  const fitted = fitLineToRange(source, range);
  const simplified = simplifyLine(fitted.notes, options.level, parsed.bpm);
  const rebased = simplified.map((note) => ({
    ...note,
    startTimeMs: Math.max(0, note.startTimeMs - originMs),
  }));

  return {
    notes: rebased,
    sourceTrack,
    octaveShift: fitted.octaveShift,
    originalNoteCount,
    keptNoteCount: rebased.length,
    sourceKind: kind,
    foldedNotes: fitted.foldedNotes,
    originMs,
    sourceEndMs,
    metrics,
  };
}

function scoreMidiNotes(score: CelloSongScore): MidiNote[] {
  return score.notes.map((note) => ({
    midiNumber: note.midiNumber,
    startTimeMs: note.startTimeMs,
    durationMs: note.durationMs,
    track: 0,
    channel: 0,
    velocity: note.articulation === 'accent' ? 116 : 92,
  }));
}

/** Derive a difficulty level from one stored full line without duplicating JSON. */
export function arrangeScoreForLevel(
  score: CelloSongScore, level: ArrangementLevel,
): CelloSongScore {
  if (score.notes.length === 0) return score;

  const profile = ARRANGEMENT_PROFILES[level];
  const fitted = fitLineToRange(scoreMidiNotes(score), profile.range);
  const arranged = simplifyLine(fitted.notes, level, score.metadata.bpm);
  const totalMs = scoreDurationMs(score);
  const events: RawNoteEvent[] = arranged.map((note) => ({
    midiNumber: note.midiNumber,
    startTimeMs: note.startTimeMs,
    durationMs: Math.max(1, Math.min(note.durationMs, totalMs - note.startTimeMs)),
  })).filter((note) => note.durationMs > 0 && note.startTimeMs < totalMs);

  const states = solveFingering(events).states;
  const originalsByStart = new Map<number, CelloNote>();
  for (const note of score.notes) if (!originalsByStart.has(note.startTimeMs)) originalsByStart.set(note.startTimeMs, note);

  const notes: CelloNote[] = events.map((event, index) => {
    const state = states[index];
    if (!state) throw new Error(`No fingering was found for arranged note ${index + 1}.`);
    const original = originalsByStart.get(event.startTimeMs);
    const measureIndex = Math.max(0, score.measures.findIndex((measure) =>
      event.startTimeMs >= measure.startBarTimeMs
      && event.startTimeMs < measure.startBarTimeMs + measure.durationMs));
    return {
      id: `${score.id}-${level.toLowerCase()}-${index + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      durationMs: Math.round(event.durationMs),
      pitchName: midiToPitchName(event.midiNumber, score.metadata.preferFlats),
      midiNumber: event.midiNumber,
      frequency: Math.round(midiToFrequency(event.midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: original?.articulation ?? 'arco',
      tie: false,
      measureIndex,
      bowDirection: index % 2 === 0 ? 'down' : 'up',
      isHarmonic: original?.isHarmonic,
    };
  });

  const changed = notes.length !== score.notes.length || fitted.octaveShift !== 0 || fitted.foldedNotes > 0;
  const detail = changed
    ? `${level} line: ${notes.length}/${score.notes.length} attacks, ${profile.range.low}–${profile.range.high} MIDI.`
    : `${level} line: the full part already fits this level.`;

  return {
    ...score,
    metadata: {
      ...score.metadata,
      difficulty: level,
      teaches: `${detail} ${score.metadata.teaches}`,
    },
    notes,
  };
}
