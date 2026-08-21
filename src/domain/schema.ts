/**
 * Song score schema v1.0.0.
 *
 * Scores are plain JSON: authored by hand for the bundled pieces, or emitted
 * by the offline MIDI/MusicXML converter in `tools/`. Nothing here depends on
 * React or on the audio engine, so a score can be validated in isolation.
 */

import { CelloFinger, CelloPosition, CelloString } from './cello';

export type CelloExtension = 'none' | 'forward' | 'backward';

export type CelloArticulation =
  | 'arco' | 'pizz' | 'slur' | 'staccato' | 'tenuto' | 'accent' | 'harmonic';

export type BowDirection = 'down' | 'up' | 'unspecified';

export interface CelloNote {
  id: string;
  startTimeMs: number;
  durationMs: number;
  /** Scientific pitch, e.g. "G3". Redundant with `midiNumber`; kept for readability. */
  pitchName: string;
  midiNumber: number;
  frequency: number;
  string: CelloString;
  finger: CelloFinger;
  position: CelloPosition;
  extension: CelloExtension;
  articulation: CelloArticulation;
  tie: boolean;
  measureIndex: number;
  bowDirection?: BowDirection;
  isHarmonic?: boolean;
}

export interface CelloMeasure {
  index: number;
  startBarTimeMs: number;
  durationMs: number;
  timeSignature: [number, number];
  tempoBpm: number;
}

export interface CelloSongMetadata {
  title: string;
  composer: string;
  arranger?: string;
  origin: string;
  keySignature: string;
  timeSignature: string;
  bpm: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  /** Tonic for the practice drone. */
  tonic: string;
  /** Prose note shown on the practice sheet — what this piece is *for*. */
  teaches: string;
  /** Written with flats rather than sharps? Drives note-name spelling. */
  preferFlats?: boolean;
  /** Rights note. Only public-domain and original material ships in the app. */
  rights: string;
}

export interface CelloSongScore {
  schemaVersion: '1.0.0';
  id: string;
  metadata: CelloSongMetadata;
  measures: CelloMeasure[];
  notes: CelloNote[];
}

/**
 * A catalogue row with no note data attached — a piece the player can add
 * themselves by dropping a converted score into `src/scores/`.
 */
export interface CatalogStub {
  id: string;
  title: string;
  composer: string;
  origin: string;
  keySignature: string;
  range: string;
  tempo: string;
  difficulty: CelloSongMetadata['difficulty'];
  /** Position load, as `[label, percent]`, for the practice sheet bars. */
  distribution: [string, number][];
  /** Why it is not bundled. Shown in place of the START button. */
  unbundledReason: string;
}

// ─── Helpers used by the authored scores ─────────────────────────────────────

export function measureDurationMs(timeSignature: [number, number], bpm: number): number {
  const [beats, unit] = timeSignature;
  const quarterMs = 60000 / bpm;
  return beats * quarterMs * (4 / unit);
}

/** Total sounding length of a score, for progress bars and loop clamping. */
export function scoreDurationMs(score: CelloSongScore): number {
  const last = score.measures[score.measures.length - 1];
  return last ? last.startBarTimeMs + last.durationMs : 0;
}

export function notesInWindow(
  score: CelloSongScore, fromMs: number, toMs: number,
): CelloNote[] {
  return score.notes.filter((n) => n.startTimeMs + n.durationMs >= fromMs && n.startTimeMs <= toMs);
}

/** Index of the note that should be sounding at `tMs`, or the next one up. */
export function activeNoteIndex(score: CelloSongScore, tMs: number): number {
  const notes = score.notes;
  let lo = 0;
  let hi = notes.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startTimeMs <= tMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function measureAt(score: CelloSongScore, tMs: number): CelloMeasure | undefined {
  return score.measures.find((m) => tMs >= m.startBarTimeMs && tMs < m.startBarTimeMs + m.durationMs)
    ?? score.measures[score.measures.length - 1];
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ScoreProblem { path: string; message: string }

/**
 * Structural check run by the score unit tests. Catches the mistakes that are
 * easy to make when hand-authoring: a note whose declared pitch disagrees with
 * its string and finger, notes that run past the last bar line, unsorted notes.
 */
export function validateScore(score: CelloSongScore): ScoreProblem[] {
  const problems: ScoreProblem[] = [];
  const push = (path: string, message: string) => problems.push({ path, message });

  if (score.schemaVersion !== '1.0.0') push('schemaVersion', `unsupported: ${score.schemaVersion}`);
  if (score.measures.length === 0) push('measures', 'score has no measures');

  score.measures.forEach((m, i) => {
    if (m.index !== i) push(`measures[${i}].index`, `expected ${i}, got ${m.index}`);
    const expected = measureDurationMs(m.timeSignature, m.tempoBpm);
    if (Math.abs(m.durationMs - expected) > 1) {
      push(`measures[${i}].durationMs`, `expected ${expected.toFixed(1)} for ${m.timeSignature.join('/')} at ${m.tempoBpm}bpm, got ${m.durationMs}`);
    }
  });

  const total = scoreDurationMs(score);
  const seen = new Set<string>();
  let previousStart = -Infinity;

  score.notes.forEach((n, i) => {
    const at = `notes[${i}]`;
    if (seen.has(n.id)) push(`${at}.id`, `duplicate id ${n.id}`);
    seen.add(n.id);

    if (n.startTimeMs < previousStart) push(`${at}.startTimeMs`, 'notes are not in ascending time order');
    previousStart = n.startTimeMs;

    if (n.durationMs <= 0) push(`${at}.durationMs`, 'must be positive');
    if (n.startTimeMs + n.durationMs > total + 1) push(`${at}`, 'note runs past the final bar line');
    if (!score.measures[n.measureIndex]) push(`${at}.measureIndex`, `no measure ${n.measureIndex}`);
  });

  return problems;
}
