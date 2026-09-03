import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseMidi } from '../src/domain/midi';
import { arrangeMidi } from '../src/domain/arrangement';
import { instrumentForProgram } from '../src/domain/backing';
import { DEFAULT_WEIGHTS, solveFingering } from '../src/domain/fingering';
import { difficultyOf } from '../src/domain/difficulty';
import type { DifficultyTier } from '../src/domain/schema';
// Note: the emitted template references @/domain/cello, @/domain/schema and
// @/domain/fingering. Those are imports in the *generated* file, not here.


function parseSongInfo(filename: string, category: 'study' | 'classical' | 'song') {
  const stem = filename.replace(/\.midi?$/i, '');
  const id = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (category === 'classical') {
    const title = stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let composer = 'Classical';
    if (stem.startsWith('bach')) composer = 'J.S. Bach';
    else if (stem.startsWith('pachelbel')) composer = 'Johann Pachelbel';
    else if (stem.startsWith('moonlight') || stem.startsWith('fur-elise') || stem.startsWith('ode')) composer = 'L. van Beethoven';
    else if (stem.startsWith('dies-irae')) composer = 'Traditional 13th C.';
    return {
      id,
      title,
      composer,
      origin: 'PUBLIC DOMAIN · CELLO ARRANGEMENT',
      category: 'classical' as const,
    };
  }

  if (category === 'study') {
    const title = stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      id,
      title,
      composer: 'Ponticello Etude',
      origin: 'ORIGINAL ETUDE · CELLO',
      category: 'study' as const,
    };
  }

  if (stem.includes('-')) {
    const parts = stem.split('-');
    const artistRaw = parts[0].replace(/_/g, ' ').trim();
    const titleRaw = parts.slice(1).join(' - ').replace(/_/g, ' ').trim();
    return {
      id,
      title: titleRaw,
      composer: artistRaw,
      origin: `${artistRaw.toUpperCase()} · CELLO ARRANGEMENT`,
      category: 'song' as const,
    };
  }

  const title = stem.replace(/_/g, ' ').trim();
  return {
    id,
    title,
    composer: 'Song',
    origin: 'SONG · CELLO ARRANGEMENT',
    category: 'song' as const,
  };
}

interface CompactScoreData {
  id: string;
  title: string;
  composer: string;
  origin: string;
  bpm: number;
  meter: [number, number];
  difficulty: DifficultyTier;
  /** Share of notes in [1st/half, 2nd-4th, 5th-thumb], as whole percents. */
  positions: [number, number, number];
  category: 'study' | 'classical' | 'song';
  // [midiNumber, startTimeMs, durationMs]
  notes: [number, number, number][];
  // [name, instrument, role, gain, [[midi, startMs, durMs, vel], ...]]
  backingParts: [string, string, string, number, [number, number, number, number][]][];
}

/**
 * Most notes kept per backing track.
 *
 * A ceiling exists because `bundledSongs.json` ships inside the app and is
 * already tens of megabytes. What matters is that the ceiling is reached by
 * *thinning* rather than by cutting: 1800 notes spread over a five-minute song
 * is five events a second, which is ample for something you play over, whereas
 * the first 1800 notes of that song is a backing that quits before the second
 * chorus.
 */
const MAX_TRACK_NOTES = 1800;

/**
 * Reduces a time-sorted track to at most `cap` notes, spread over its whole
 * length.
 *
 * The track is divided into `cap` equal-count buckets and the loudest note in
 * each is kept, so what survives is the accented skeleton of the part rather
 * than an arbitrary prefix. Velocity is the right tie-break because a thinned
 * accompaniment should keep the beats a player is listening for.
 */
function thinTrack<T extends { velocity: number }>(notes: T[], cap: number): T[] {
  if (notes.length <= cap) return notes;
  const out: T[] = [];
  const stride = notes.length / cap;
  for (let i = 0; i < cap; i++) {
    const from = Math.floor(i * stride);
    const to = Math.min(notes.length, Math.max(from + 1, Math.floor((i + 1) * stride)));
    let best = from;
    for (let j = from + 1; j < to; j++) {
      if (notes[j].velocity > notes[best].velocity) best = j;
    }
    out.push(notes[best]);
  }
  return out;
}

const categories: { dir: string; cat: 'study' | 'classical' | 'song' }[] = [
  { dir: '_MIDIS/public-domain', cat: 'classical' },
  { dir: '_MIDIS/etudes', cat: 'study' },
  { dir: '_MIDIS/downloaded', cat: 'song' },
];

const compactList: CompactScoreData[] = [];
const difficulties: { id: string; tier: DifficultyTier; score: number }[] = [];
const quality: { id: string; track: number; trackName: string; distinct: number; movement: number; shift: number; foldedPct: number }[] = [];

for (const { dir, cat } of categories) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(f => f.endsWith('.mid') || f.endsWith('.midi'));
  for (const f of files) {
    const path = join(dir, f);
    const bytes = new Uint8Array(readFileSync(path));
    const parsed = parseMidi(bytes);
    if (parsed.notes.length === 0) continue;

    // The same arranger runs here and on-device: motif-aware riff/theme source
    // ranking, root-guide fallback, one coherent octave move, and C2–A5 range.
    const arranged = arrangeMidi(parsed, { level: 'Expert' });
    if (arranged.notes.length === 0) continue;

    const soloTrack = arranged.sourceTrack;
    const info = parseSongInfo(f, cat);
    const timeSignature = parsed.timeSignature;
    const bpm = parsed.bpm || 80;
    const originTime = arranged.originMs;

    const compactNotes: [number, number, number][] = arranged.notes.map((note) => [
      note.midiNumber,
      Math.round(note.startTimeMs),
      Math.max(1, Math.round(note.durationMs)),
    ]);
    const foldedPct = Math.round((100 * arranged.foldedNotes) / compactNotes.length);

    quality.push({
      id: info.id,
      track: soloTrack ?? -1,
      trackName: soloTrack === null
        ? 'derived roots'
        : (parsed.tracks.find((track) => track.index === soloTrack)?.name ?? '-').slice(0, 24),
      distinct: arranged.metrics?.distinctPitches ?? new Set(compactNotes.map((note) => note[0])).size,
      movement: Math.round((arranged.metrics?.movement ?? 0) * 100),
      shift: arranged.octaveShift,
      foldedPct,
    });

    // Difficulty from what the left hand actually has to do, not from pitch
    // span and tempo. Solving the line here rather than at runtime means the
    // library screen can filter on the answer without fingering 258 songs to
    // draw a list. See src/domain/difficulty.ts for the weighting.
    const events = compactNotes.map(([midiNumber, startTimeMs, durationMs]) =>
      ({ midiNumber, startTimeMs, durationMs }));
    const solvedStates = solveFingering(events, DEFAULT_WEIGHTS).states;
    const report = difficultyOf(events, solvedStates);
    const difficulty: DifficultyTier = report.tier;
    difficulties.push({ id: info.id, tier: report.tier, score: report.score });

    // Where the hand actually spends its time, stored rather than assumed.
    // The library row used to hard-code "100% 1st position", which was true
    // while every note was fingered by `firstPositionFingering` and stopped
    // being true the moment the solver was allowed to choose.
    const share = (test: (p: string) => boolean) => Math.round(
      (100 * solvedStates.filter(st => test(st.position)).length) / (solvedStates.length || 1),
    );
    const positions: [number, number, number] = [
      share(p => p === '1st' || p === 'Half'),
      share(p => ['2nd', '3rd', '4th'].includes(p)),
      share(p => ['5th', '6th', '7th', 'Thumb'].includes(p)),
    ];

    const backingParts: CompactScoreData['backingParts'] = [];
    for (const track of parsed.tracks) {
      if (track.noteCount === 0) continue;
      const isSolo = track.index === soloTrack;
      // Cap density, but by thinning across the whole track rather than by
      // truncating it. `.slice(0, 1500)` used to be here, and it meant that on
      // any track with more than 1500 notes the accompaniment simply stopped a
      // quarter of the way through the song — 223 tracks across 132 of the 258
      // songs. Six of them had no second track to cover for it and went
      // completely silent after the first minute.
      const tNotes = thinTrack(
        parsed.notes
          .filter((note) => note.track === track.index
            && note.startTimeMs < arranged.sourceEndMs
            && note.startTimeMs + note.durationMs > originTime)
          .sort((a, b) => a.startTimeMs - b.startTimeMs),
        MAX_TRACK_NOTES,
      )
        .map((note) => {
          const startTimeMs = Math.max(0, note.startTimeMs - originTime);
          const endTimeMs = Math.min(
            note.startTimeMs + note.durationMs,
            arranged.sourceEndMs,
          ) - originTime;
          return [
            note.midiNumber,
            Math.round(startTimeMs),
            Math.max(1, Math.round(endTimeMs - startTimeMs)),
            Math.round((Math.max(0.05, note.velocity / 127)) * 100) / 100,
          ] as [number, number, number, number];
        });

      if (tNotes.length === 0) continue;
      const inst = isSolo ? 'cello' : instrumentForProgram(track.program, track.isPercussion);
      const role = isSolo ? 'solo' : 'accompaniment';
      const gain = isSolo ? 0.85 : 0.5;
      const name = (track.name || `Track ${track.index + 1}`).trim().slice(0, 40);
      backingParts.push([name, inst, role, gain, tNotes]);
    }

    compactList.push({
      id: info.id,
      title: info.title,
      composer: info.composer,
      origin: info.origin,
      bpm,
      meter: timeSignature,
      difficulty,
      positions,
      category: info.category,
      notes: compactNotes,
      backingParts,
    });
  }
}

console.log(`Writing ${compactList.length} compact scores to src/scores/bundledSongs.json...`);
writeFileSync('src/scores/bundledSongs.json', JSON.stringify(compactList));

const outTs = `/**
 * Bundled Release 1.2 Scores and Backing Tracks.
 * Auto-generated by tools/build-library.ts from _MIDIS.
 * Songs store one full C2–A5 cello line; easier levels are derived at runtime.
 */

import { CelloSongScore, CelloNote, CelloMeasure, DifficultyTier, measureDurationMs } from '@/domain/schema';
import { BackingTrack, BackingPart, InstrumentName, PartRole } from '@/domain/backing';
import { midiToPitchName, midiToFrequency } from '@/domain/cello';
import { DEFAULT_WEIGHTS, solveFingering } from '@/domain/fingering';
import rawData from './bundledSongs.json';


export interface CompactScoreDef {
  id: string;
  title: string;
  composer: string;
  origin: string;
  bpm: number;
  meter: [number, number];
  difficulty: DifficultyTier;
  /** Share of notes in [1st/half, 2nd-4th, 5th-thumb], as whole percents. */
  positions: [number, number, number];
  category: 'study' | 'classical' | 'song';
  notes: [number, number, number][];
  backingParts: [string, string, string, number, [number, number, number, number][]][];
}

export const COMPACT_SCORES: CompactScoreDef[] = rawData as CompactScoreDef[];

export function inflateScore(raw: CompactScoreDef): CelloSongScore {
  const barDurationMs = measureDurationMs(raw.meter, raw.bpm);
  const totalMs = raw.notes.reduce((max, n) => Math.max(max, n[1] + n[2]), 0);
  const barCount = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barDurationMs,
    durationMs: barDurationMs,
    timeSignature: raw.meter,
    tempoBpm: raw.bpm,
  }));

  // Fingering happens after source choice and range fitting. The normal solver
  // weights preserve phrase ergonomics across the full C2–A5 compass; easier
  // runtime levels are re-fingered after their own density/register reduction.
  const solved = solveFingering(
    raw.notes.map(([midiNumber, startTimeMs, durationMs]) =>
      ({ midiNumber, startTimeMs, durationMs })),
    DEFAULT_WEIGHTS,
  ).states;

  const notes: CelloNote[] = raw.notes.map(([midiNumber, startTimeMs, durationMs], i) => {
    const state = solved[i];
    const measureIndex = Math.min(barCount - 1, Math.floor(startTimeMs / barDurationMs));
    return {
      id: \`\${raw.id}-\${i + 1}\`,
      startTimeMs,
      durationMs: Math.max(1, Math.min(durationMs, barCount * barDurationMs - startTimeMs)),
      pitchName: midiToPitchName(midiNumber),
      midiNumber,
      frequency: Math.round(midiToFrequency(midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: 'arco',
      tie: false,
      measureIndex,
      bowDirection: i % 2 === 0 ? 'down' : 'up',
    };
  });

  return {
    schemaVersion: '1.0.0',
    id: raw.id,
    metadata: {
      title: raw.title,
      composer: raw.composer,
      origin: raw.origin,
      keySignature: 'ADAPTIVE',
      timeSignature: raw.meter.join('/'),
      bpm: raw.bpm,
      difficulty: raw.difficulty,
      tonic: 'C',
      teaches: 'Full C2–A5 cello line. Choose Beginner, Intermediate, Advanced, or Full on the practice sheet.',
      rights: raw.category === 'classical' ? 'Public domain' : raw.category === 'study' ? 'Original study' : 'Study reduction \u2014 personal practice, analysis and research',
    },
    measures,
    notes,
  };
}

export function inflateBacking(raw: CompactScoreDef): BackingTrack {
  const parts: BackingPart[] = raw.backingParts.map(([name, inst, role, gain, tNotes], idx) => ({
    id: \`\${raw.id}-p\${idx}\`,
    name,
    instrument: inst as InstrumentName,
    role: role as PartRole,
    gain,
    muted: false,
    notes: tNotes.map(([midiNumber, startTimeMs, durationMs, velocity]) => ({
      midiNumber,
      startTimeMs,
      durationMs,
      velocity,
    })),
  }));

  const durationMs = parts.reduce(
    (max, part) => part.notes.reduce((m, n) => Math.max(m, n.startTimeMs + n.durationMs), max),
    0,
  );

  return {
    id: raw.id,
    name: raw.title,
    source: 'imported',
    parts,
    bpm: raw.bpm,
    durationMs,
  };
}
`;

writeFileSync('src/scores/bundledSongs.ts', outTs);
console.log('Done writing compact bundledSongs.ts and bundledSongs.json!');

// ── Run report ───────────────────────────────────────────────────────────────
const tiers = difficulties.reduce<Record<string, number>>((acc, d) => {
  acc[d.tier] = (acc[d.tier] ?? 0) + 1;
  return acc;
}, {});
const total = difficulties.length || 1;
console.log('\ndifficulty:');
for (const tier of ['Beginner', 'Intermediate', 'Advanced', 'Expert']) {
  const n = tiers[tier] ?? 0;
  console.log(`  ${tier.padEnd(13)} ${String(n).padStart(3)}  ${Math.round((100 * n) / total)}%`);
}
const hardest = [...difficulties].sort((a, b) => b.score - a.score).slice(0, 6);
console.log(`  hardest: ${hardest.map(d => `${d.id}:${d.score.toFixed(0)}`).join(' ')}`);

const dull = quality.filter(q => q.distinct < 7 || q.movement < 25);
const mangled = quality.filter(q => q.foldedPct > 15);
console.log(`\nsongs built: ${quality.length}`);
console.log(`octave-shifted into range: ${quality.filter(q => q.shift !== 0).length}`);
console.log(`\nDULL (few pitches or barely moves): ${dull.length}`);
for (const q of dull.slice(0, 15)) {
  console.log(`  ${q.id.slice(0, 40).padEnd(42)} tr${q.track} "${q.trackName}" distinct=${q.distinct} move=${q.movement}%`);
}
console.log(`\nMANGLED (>15% of notes octave-folded): ${mangled.length}`);
for (const q of mangled.slice(0, 15)) {
  console.log(`  ${q.id.slice(0, 40).padEnd(42)} folded=${q.foldedPct}% shift=${q.shift}`);
}
