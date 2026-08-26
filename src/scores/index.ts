/**
 * The library.
 *
 * Everything with note data attached is either an original study or public
 * domain. The pieces from the original brief that are still in copyright —
 * the game, film and television themes — appear as rows with no notes: the
 * app will not ship a transcription of somebody else's melody. Convert your
 * own copy with `tools/convert-score.ts` and drop the result in this folder to
 * fill one in.
 */

import { CatalogStub, CelloSongScore, scoreDurationMs, measureDurationMs } from '@/domain/schema';
import { BackingTrack } from '@/domain/backing';
import { midiToPitchName } from '@/domain/cello';
import { BWV1007_PRELUDE } from './bach';
import { STUDIES, STUDIES_BACKINGS } from './studies';
import { COMPACT_SCORES, inflateBacking, inflateScore, CompactScoreDef } from './bundledSongs';

export { COMPACT_SCORES };

// Core authored studies & Bach
export const CORE_SCORES: CelloSongScore[] = [...STUDIES, BWV1007_PRELUDE];

const SCORE_CACHE = new Map<string, CelloSongScore>();
for (const s of CORE_SCORES) {
  SCORE_CACHE.set(s.id, s);
}

const COMPACT_MAP = new Map<string, CompactScoreDef>();
for (const c of COMPACT_SCORES) {
  COMPACT_MAP.set(c.id, c);
}

export const SCORES: CelloSongScore[] = CORE_SCORES;

export const SCORES_BY_ID: Record<string, CelloSongScore> =
  Object.fromEntries(CORE_SCORES.map((s) => [s.id, s]));

export function getScore(id: string | undefined): CelloSongScore | undefined {
  if (!id) return undefined;
  if (SCORE_CACHE.has(id)) return SCORE_CACHE.get(id);
  const compact = COMPACT_MAP.get(id);
  if (compact) {
    const score = inflateScore(compact);
    SCORE_CACHE.set(id, score);
    return score;
  }
  return undefined;
}

export function getBundledBacking(id: string | undefined): BackingTrack | undefined {
  if (!id) return undefined;
  if (STUDIES_BACKINGS[id]) return STUDIES_BACKINGS[id];
  const compact = COMPACT_MAP.get(id);
  if (compact) {
    return inflateBacking(compact);
  }
  return undefined;
}

export interface LibraryRow {
  id: string;
  title: string;
  composer: string;
  origin: string;
  keySignature: string;
  range: string;
  tempo: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  category: 'study' | 'classical' | 'song' | 'imported';
  bars: number | null;
  playable: boolean;
  distribution: [string, number][];
  note: string;
}

/** Range of a score as written on the row, e.g. "G2 – D4". */
function rangeOf(score: CelloSongScore): string {
  const midi = score.notes.map((n) => n.midiNumber);
  const low = score.notes[midi.indexOf(Math.min(...midi))];
  const high = score.notes[midi.indexOf(Math.max(...midi))];
  return `${low.pitchName} – ${high.pitchName}`;
}

/** Share of notes in each position band, for the practice sheet's load bars. */
function distributionOf(score: CelloSongScore): [string, number][] {
  const total = score.notes.length || 1;
  const count = (test: (p: string) => boolean) =>
    Math.round((score.notes.filter((n) => test(n.position)).length / total) * 100);
  return [
    ['1st position', count((p) => p === '1st' || p === 'Half')],
    ['2nd – 4th', count((p) => ['2nd', '3rd', '4th'].includes(p))],
    ['Thumb / upper', count((p) => ['5th', '6th', '7th', 'Thumb'].includes(p))],
  ];
}

function categoryOf(id: string, origin: string): 'study' | 'classical' | 'song' {
  if (id.includes('study') || id.includes('ladder') || id.includes('open-strings') || origin.includes('STUDY') || origin.includes('WARM-UP') || origin.includes('SCALE')) {
    return 'study';
  }
  if (id.startsWith('bwv') || id.includes('bach') || id.includes('pachelbel') || id.includes('beethoven') || id.includes('dies-irae') || id.includes('moonlight') || id.includes('fur-elise') || id.includes('ode-to-joy') || origin.includes('PUBLIC DOMAIN') || origin.includes('CLASSICAL')) {
    return 'classical';
  }
  return 'song';
}

function toCoreRow(score: CelloSongScore): LibraryRow {
  return {
    id: score.id,
    title: score.metadata.title,
    composer: score.metadata.composer,
    origin: score.metadata.origin,
    keySignature: score.metadata.keySignature,
    range: rangeOf(score),
    tempo: `♩ ${score.metadata.bpm}`,
    difficulty: score.metadata.difficulty,
    category: categoryOf(score.id, score.metadata.origin),
    bars: score.measures.length,
    playable: true,
    distribution: distributionOf(score),
    note: score.metadata.teaches,
  };
}

function toCompactRow(c: CompactScoreDef): LibraryRow {
  const midis = c.notes.map((n) => n[0]);
  const minMidi = Math.min(...midis);
  const maxMidi = Math.max(...midis);
  const barDurationMs = measureDurationMs(c.meter, c.bpm);
  const totalMs = c.notes.reduce((max, n) => Math.max(max, n[1] + n[2]), 0);
  const bars = Math.max(1, Math.ceil(totalMs / barDurationMs));

  return {
    id: c.id,
    title: c.title,
    composer: c.composer,
    origin: c.origin,
    keySignature: '1ST POS',
    range: `${midiToPitchName(minMidi)} – ${midiToPitchName(maxMidi)}`,
    tempo: `♩ ${c.bpm}`,
    difficulty: c.difficulty,
    category: c.category,
    bars,
    playable: true,
    distribution: [['1st position', 100], ['2nd – 4th', 0], ['Thumb / upper', 0]],
    note: 'Arranged for cello first position. Complete melody playable on 1st position tapes.',
  };
}

export const LIBRARY_ROWS: LibraryRow[] = [
  ...CORE_SCORES.map(toCoreRow),
  ...COMPACT_SCORES.map(toCompactRow),
];

export function durationOf(id: string): number {
  const score = getScore(id);
  return score ? scoreDurationMs(score) : 0;
}


