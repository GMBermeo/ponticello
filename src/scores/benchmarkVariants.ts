/**
 * Model benchmark variants: one song, arranged and fingered by one model.
 *
 * `tools/ollama-benchmark.ts` writes `_MIDIS/arranged/<song>--<model>/`, and
 * `tools/build-library.ts` packs those folders into `benchmarkVariants.json`
 * (full edition only). They cannot ride in `bundledSongs.json`: that format
 * stores pitches and re-fingers them in first position on load, which would
 * erase the very choices the benchmark exists to compare. Here every note keeps
 * the string, finger and position the model gave it, and each arrangement level
 * is the model's own tier rather than a runtime re-arrangement.
 *
 * Notes and backing are on the source file's own clock — the arranger does not
 * rebase to the first note — so the two stay in step by construction.
 */

import { BackingPart, BackingTrack, InstrumentName, PartRole } from '@/domain/backing';
import {
  CelloFinger, CelloPosition, CelloString, midiToFrequency, midiToPitchName,
} from '@/domain/cello';
import {
  CelloExtension, CelloMeasure, CelloNote, CelloSongScore, DifficultyTier, measureDurationMs,
} from '@/domain/schema';
import rawData from './benchmarkVariants.json';

/** `[midi, startMs, durationMs, string, finger, position, extension, accent]`. */
export type CompactVariantNote = [
  number, number, number, CelloString, CelloFinger, CelloPosition, CelloExtension, 0 | 1,
];

/** `[name, instrument, role, gain, [[midi, startMs, durationMs, velocity], ...]]`. */
export type CompactVariantBackingPart = [string, string, string, number, [number, number, number, number][]];

export interface CompactVariantDef {
  /** The folder name, `<song-id>--<model-slug>`. */
  id: string;
  baseId: string;
  /** As the server names it, e.g. `gpt-oss:20b`. */
  model: string;
  title: string;
  composer: string;
  bpm: number;
  meter: [number, number];
  key: string;
  preferFlats: boolean;
  levels: Record<DifficultyTier, CompactVariantNote[]>;
  teaches: Record<DifficultyTier, string>;
  /** Share of the notes the model was asked about that it placed legally, 0–1. */
  placedByModel: number;
}

export interface VariantLibraryData {
  variants: CompactVariantDef[];
  /** Keyed by base song id: every model of one song shares its backing. */
  backings: Record<string, CompactVariantBackingPart[]>;
}

const DATA = rawData as unknown as VariantLibraryData;

export const BENCHMARK_VARIANTS: readonly CompactVariantDef[] = DATA.variants;

const BY_ID = new Map(DATA.variants.map((variant) => [variant.id, variant]));
const SCORE_CACHE = new Map<string, CelloSongScore>();

export function isBenchmarkVariant(id: string | undefined): boolean {
  return id !== undefined && BY_ID.has(id);
}

/** Last sounding millisecond across every level and the backing. */
function endOf(variant: CompactVariantDef, backing: readonly CompactVariantBackingPart[]): number {
  let end = 0;
  for (const notes of Object.values(variant.levels)) {
    for (const note of notes) end = Math.max(end, note[1] + note[2]);
  }
  for (const part of backing) {
    for (const note of part[4]) end = Math.max(end, note[1] + note[2]);
  }
  return end;
}

/**
 * One level of a variant as a score.
 *
 * Every level gets the same bar grid — sized to the longest of them and the
 * backing — so switching level on the practice sheet keeps the loop's bars.
 */
export function inflateVariantLevel(
  variant: CompactVariantDef,
  level: DifficultyTier,
  backing: readonly CompactVariantBackingPart[] = [],
): CelloSongScore {
  const barMs = measureDurationMs(variant.meter, variant.bpm);
  const barCount = Math.max(1, Math.ceil(endOf(variant, backing) / barMs));

  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barMs,
    durationMs: barMs,
    timeSignature: variant.meter,
    tempoBpm: variant.bpm,
  }));

  const notes: CelloNote[] = variant.levels[level].map(
    ([midiNumber, startTimeMs, durationMs, string, finger, position, extension, accent], index) => ({
      id: `${variant.id}-${level.toLowerCase()}-${index + 1}`,
      startTimeMs,
      durationMs: Math.max(1, Math.min(durationMs, barCount * barMs - startTimeMs)),
      pitchName: midiToPitchName(midiNumber, variant.preferFlats),
      midiNumber,
      frequency: Math.round(midiToFrequency(midiNumber) * 100) / 100,
      string,
      finger,
      position,
      extension,
      articulation: accent ? 'accent' : 'arco',
      tie: false,
      measureIndex: Math.min(barCount - 1, Math.floor(startTimeMs / barMs)),
      bowDirection: index % 2 === 0 ? 'down' : 'up',
    }),
  );

  return {
    schemaVersion: '1.0.0',
    id: variant.id,
    metadata: {
      title: variant.title,
      composer: variant.composer,
      origin: `MODEL BENCHMARK · ${variant.model.toUpperCase()}`,
      keySignature: variant.key,
      timeSignature: variant.meter.join('/'),
      bpm: variant.bpm,
      difficulty: level,
      tonic: variant.key.split(' ')[0] ?? 'C',
      preferFlats: variant.preferFlats,
      teaches: variant.teaches[level],
      rights: 'Study reduction — personal practice, analysis and research',
    },
    measures,
    notes,
  };
}

export function inflateVariantBacking(
  variant: Pick<CompactVariantDef, 'id' | 'title' | 'bpm'>,
  parts: readonly CompactVariantBackingPart[],
): BackingTrack {
  const inflated: BackingPart[] = parts.map(([name, instrument, role, gain, notes], index) => ({
    id: `${variant.id}-p${index}`,
    name,
    instrument: instrument as InstrumentName,
    role: role as PartRole,
    gain,
    muted: false,
    notes: notes.map(([midiNumber, startTimeMs, durationMs, velocity]) => ({
      midiNumber, startTimeMs, durationMs, velocity,
    })),
  }));
  const durationMs = inflated.reduce(
    (max, part) => part.notes.reduce((m, n) => Math.max(m, n.startTimeMs + n.durationMs), max),
    0,
  );
  return { id: variant.id, name: variant.title, source: 'imported', parts: inflated, bpm: variant.bpm, durationMs };
}

/** The model's own score for a level, or undefined when `id` is not a variant. */
export function variantLevelScore(id: string | undefined, level: DifficultyTier): CelloSongScore | undefined {
  const variant = id ? BY_ID.get(id) : undefined;
  if (!variant) return undefined;
  const key = `${variant.id}|${level}`;
  const cached = SCORE_CACHE.get(key);
  if (cached) return cached;
  const score = inflateVariantLevel(variant, level, DATA.backings[variant.baseId] ?? []);
  SCORE_CACHE.set(key, score);
  return score;
}

export function variantBacking(id: string | undefined): BackingTrack | undefined {
  const variant = id ? BY_ID.get(id) : undefined;
  if (!variant) return undefined;
  return inflateVariantBacking(variant, DATA.backings[variant.baseId] ?? []);
}
