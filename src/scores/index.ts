/**
 * The library.
 *
 * Everything here exists for personal study: practising intonation, position
 * work and reading on one instrument. Alongside the original studies and
 * public-domain works, melodies still in copyright are included as single-line
 * cello reductions on that basis — private practice, theory analysis and
 * research — following the fair-use guidance the Musicians Institute Library
 * publishes for study copies. Nothing here is performed, distributed or sold.
 *
 * That is a statement of purpose, not legal advice. Anyone intending to
 * perform, publish or distribute this material should clear the rights first.
 * Add your own with `tools/convert-score.ts`.
 */

import { CelloSongScore, DifficultyTier, scoreDurationMs, measureDurationMs } from '@/domain/schema';
import { BackingTrack } from '@/domain/backing';
import { RawNoteEvent } from '@/domain/fingering';
import { CelloString, midiToPitchName } from '@/domain/cello';
import { KeyMode, PitchClass } from '@/domain/key';
import { KeyDemand, keyDemand, openStringTonic } from '@/domain/keyCensus';

import { BWV1007_PRELUDE } from './bach';
import { LIBRARY_KEY_CENSUS } from './keyCensus';
import { STUDIES, STUDIES_BACKINGS } from './studies';
import { SCALE_DRILLS, SCALE_DRILL_BACKINGS, SCALE_DRILL_KEYS } from './scaleDrills';
import { COMPACT_SCORES, inflateBacking, inflateScore, CompactScoreDef } from './bundledSongs';
import { BUNDLED_CATALOG_ROWS } from './catalogIndex';
import { variantBacking, variantLevelScore } from './benchmarkVariants';

export { COMPACT_SCORES, BUNDLED_CATALOG_ROWS };

/**
 * Core authored material: the tape studies, the scale drills, and the Bach.
 *
 * Order matters in one place — the library screen's opening suggestion reads
 * `LIBRARY_ROWS[0]`, which has to stay the open-string warm-up — so the
 * studies lead and everything else follows.
 */
export const CORE_SCORES: CelloSongScore[] = [...STUDIES, ...SCALE_DRILLS, BWV1007_PRELUDE];

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
  // A benchmark variant answers with its full tier; the resolver asks for the
  // level it needs through `getAuthoredLevel`.
  return variantLevelScore(id, 'Expert');
}

/** True for MIDI-derived bundled scores that support runtime arrangement levels. */
export function isAdaptiveBundledScore(id: string | undefined): boolean {
  return id !== undefined && COMPACT_MAP.has(id);
}

/**
 * An authored score for one arrangement level, for pieces that ship a score
 * per level — the model benchmark variants — instead of being arranged at
 * runtime. Undefined for everything else.
 */
export function getAuthoredLevel(id: string | undefined, level: DifficultyTier): CelloSongScore | undefined {
  return variantLevelScore(id, level);
}

/**
 * The song's stored harmonic guide — held roots the Beginner level plays
 * instead of a thinned melody. See `harmonicGuide` in `domain/arrangement`.
 */
export function getGuideLine(id: string | undefined): RawNoteEvent[] | undefined {
  if (!id) return undefined;
  const compact = COMPACT_MAP.get(id);
  if (!compact?.guide?.length) return undefined;
  return compact.guide.map(([midiNumber, startTimeMs, durationMs]) =>
    ({ midiNumber, startTimeMs, durationMs }));
}

/** The original bass/lower voice for a moving Intermediate accompaniment. */
export function getBassLine(id: string | undefined): RawNoteEvent[] | undefined {
  const compact = id ? COMPACT_MAP.get(id) : undefined;
  return compact?.bass?.map(([midiNumber, startTimeMs, durationMs]) =>
    ({ midiNumber, startTimeMs, durationMs }));
}

export function getBundledBacking(id: string | undefined): BackingTrack | undefined {
  if (!id) return undefined;
  if (STUDIES_BACKINGS[id]) return STUDIES_BACKINGS[id];
  if (SCALE_DRILL_BACKINGS[id]) return SCALE_DRILL_BACKINGS[id];
  const variant = variantBacking(id);
  if (variant) return variant;
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
  difficulty: DifficultyTier;
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
  return `${low?.pitchName ?? 'C2'} – ${high?.pitchName ?? 'A3'}`;
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

export function toCompactRow(c: CompactScoreDef): LibraryRow {
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
    keySignature: c.key.toUpperCase(),
    range: `${midiToPitchName(minMidi, c.preferFlats)} – ${midiToPitchName(maxMidi, c.preferFlats)}`,
    tempo: `♩ ${c.bpm}`,
    difficulty: c.difficulty,
    category: c.category,
    bars,
    playable: true,
    distribution: [
      ['1st position', c.positions[0]],
      ['2nd – 4th', c.positions[1]],
      ['Thumb / upper', c.positions[2]],
    ],
    note: c.positions[0] === 100
      ? 'Arranged for cello first position. Complete melody playable on 1st position tapes.'
      : `Arranged for minimal hand movement; ${c.positions[0]}% of it sits in first position.`,
  };
}

export const LIBRARY_ROWS: LibraryRow[] = [
  ...CORE_SCORES.map(toCoreRow),
  ...BUNDLED_CATALOG_ROWS,
];

export function durationOf(id: string): number {
  const score = getScore(id);
  return score ? scoreDurationMs(score) : 0;
}

// ─── Keys: what the library asks for, and what is drilled ────────────────────

export { LIBRARY_KEY_CENSUS };

export interface KeyPracticeRow {
  /** Canonical key label, e.g. `"B♭ major"`. */
  key: string;
  tonic: PitchClass;
  mode: KeyMode;
  /** Set when the tonic is an open string, so a drone can be checked by ear. */
  openString: CelloString | null;
  /** Songs in the library in this key. */
  songs: number;
  /** Share of the library, 0–1. */
  share: number;
  /** 1 is the key the library uses most; null if the library no longer uses it. */
  rank: number | null;
  demand: KeyDemand;
  /** The drills authored for this key, easiest first. */
  drills: LibraryRow[];
}

const ROWS_BY_ID: Record<string, LibraryRow> =
  Object.fromEntries(CORE_SCORES.map(toCoreRow).map((row) => [row.id, row]));

/**
 * Every key the library uses, most-used first, with the drills it has.
 *
 * This is the join the scales screen is built on, and the reason the drills are
 * authored per key rather than per row: the census decides the order and the
 * billing at runtime, so a rebuilt library re-sorts the screen and re-labels
 * the demand without anybody re-authoring a note. A key the census ranks highly
 * but that has no drills yet still gets a row — an empty one, which is the
 * honest way to show a gap rather than hiding it.
 */
export const KEY_PRACTICE_ROWS: KeyPracticeRow[] = (() => {
  const drillsByKey = new Map<string, LibraryRow[]>();
  for (const score of SCALE_DRILLS) {
    const drill = SCALE_DRILL_KEYS[score.id];
    const row = ROWS_BY_ID[score.id];
    if (!drill || !row) continue;
    const list = drillsByKey.get(drill.key);
    if (list) list.push(row);
    else drillsByKey.set(drill.key, [row]);
  }

  const rows: KeyPracticeRow[] = LIBRARY_KEY_CENSUS.entries.map((entry) => ({
    key: entry.key,
    tonic: entry.tonic,
    mode: entry.mode,
    openString: entry.openString,
    songs: entry.songs,
    share: entry.share,
    rank: entry.rank,
    demand: keyDemand(entry.share),
    drills: drillsByKey.get(entry.key) ?? [],
  }));

  // A drill whose key has dropped out of the library entirely still belongs on
  // the screen — the player may have learnt it — but it goes to the bottom.
  for (const [key, drills] of drillsByKey) {
    if (rows.some((row) => row.key === key)) continue;
    const first = drills[0];
    const meta = first ? SCALE_DRILL_KEYS[first.id] : undefined;
    if (!meta) continue;
    rows.push({
      key,
      tonic: meta.tonic,
      mode: meta.mode,
      openString: openStringTonic(meta.tonic),
      songs: 0,
      share: 0,
      rank: null,
      demand: 'rare',
      drills,
    });
  }

  return rows;
})();

/** Drills for one key, easiest first. */
export function drillsForKey(key: string): LibraryRow[] {
  return KEY_PRACTICE_ROWS.find((row) => row.key === key)?.drills ?? [];
}

/** The census row behind a scale drill, for the practice sheet's "why". */
export function censusForDrill(id: string | undefined): KeyPracticeRow | undefined {
  const drill = id ? SCALE_DRILL_KEYS[id] : undefined;
  if (!drill) return undefined;
  return KEY_PRACTICE_ROWS.find((row) => row.key === drill.key);
}


