import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseMidi } from '../src/domain/midi';
import { arrangeMidi, bassLine, harmonicGuide, rebaseLine } from '../src/domain/arrangement';
import { instrumentForProgram } from '../src/domain/backing';
import { CelloState, seatLine } from '../src/domain/fingering';
import { DIFFICULTY_TIERS, difficultyOf } from '../src/domain/difficulty';
import { detectKey, keyName } from '../src/domain/key';
import { midiToPitchName } from '../src/domain/cello';
import { CelloSongScore, DifficultyTier, measureDurationMs } from '../src/domain/schema';
import type { LibraryRow } from '../src/scores/index';
import type { CompactVariantDef, VariantLibraryData } from '../src/scores/benchmarkVariants';
import { BenchmarkRecord, parseVariantFolder } from './ollama/benchmarkCore';


function parseSongInfo(filename: string, category: 'study' | 'classical' | 'song') {
  const stem = filename.replace(/\.midi?$/i, '').replace(/[—–]/g, '-');
  const id = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (category === 'classical') {
    if (stem.includes('clair_de_lune') || stem.includes('clair-de-lune')) {
      return {
        id: 'debussy-clair-de-lune',
        title: 'Clair de Lune',
        composer: 'Claude Debussy',
        origin: 'PUBLIC DOMAIN · CELLO ARRANGEMENT',
        category: 'classical' as const,
      };
    }

    if (stem.includes('gymnopedie')) {
      return {
        id: 'gymnopedie-no-1',
        title: 'Gymnopédie No. 1',
        composer: 'Erik Satie',
        origin: 'PUBLIC DOMAIN · CELLO ARRANGEMENT',
        category: 'classical' as const,
      };
    }

    if (stem.includes('scheherazade')) {
      let movement = 'Scheherazade';
      let mvtId = 'scheherazade';
      if (stem.includes('1st')) {
        movement = 'Scheherazade - 1st Movement';
        mvtId = 'scheherazade-1st-movement';
      } else if (stem.includes('2nd')) {
        movement = 'Scheherazade - 2nd Movement (Part 1)';
        mvtId = 'scheherazade-2nd-movement-part-1';
      } else if (stem.includes('3rd')) {
        movement = 'Scheherazade - 3rd Movement';
        mvtId = 'scheherazade-3rd-movement';
      }
      return {
        id: mvtId,
        title: movement,
        composer: 'Nikolai Rimsky-Korsakov',
        origin: 'PUBLIC DOMAIN · CELLO ARRANGEMENT',
        category: 'classical' as const,
      };
    }

    const title = stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let composer = 'Classical';
    if (stem.startsWith('bach')) composer = 'J.S. Bach';
    else if (stem.startsWith('pachelbel')) composer = 'Johann Pachelbel';
    else if (stem.startsWith('moonlight') || stem.startsWith('fur-elise') || stem.startsWith('ode')) composer = 'L. van Beethoven';
    else if (stem.startsWith('dies-irae')) composer = 'Traditional 13th C.';
    else if (stem.startsWith('debussy')) composer = 'Claude Debussy';
    else if (stem.includes('satie')) composer = 'Erik Satie';
    else if (stem.includes('rimsky')) composer = 'Nikolai Rimsky-Korsakov';
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
  /**
   * Key of the arranged line, as `keyName` spells it — "G major", "E minor".
   *
   * Detected here rather than left as a placeholder, because it is *read* and
   * not only displayed: `generateAccompaniment` parses this string for the
   * tonic of the practice drone. It used to say "ADAPTIVE" for all 258 songs,
   * and `tonicPitchClass` reads the leading letter of that as an A — so every
   * drone and every generated chord in the app was in A major, whatever the
   * song was in.
   */
  key: string;
  /** True when the key wants flats, so B flat major is not spelled A sharp. */
  preferFlats: boolean;
  category: 'study' | 'classical' | 'song';
  // [midiNumber, startTimeMs, durationMs]
  notes: [number, number, number][];
  /**
   * Held harmonic roots on the C and G strings, same encoding and timeline as
   * `notes`, for the Beginner level to play instead of a thinned melody.
   * Cheap to ship: one note per half-bar, merged, so a five-minute song adds
   * a couple of hundred triples against the melody's thousands.
   */
  guide: [number, number, number][];
  /** Source bass/lower voice for Intermediate, on the same timeline. */
  bass: [number, number, number][];
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

/**
 * Every pitched track as a compact backing part, thinned, clipped to
 * `[originTime, endMs)` and rebased so `originTime` is zero. `soloTrack` is
 * marked as the solo so the mixer can leave it out when the cello plays it.
 */
function buildBackingParts(
  parsed: ReturnType<typeof parseMidi>,
  soloTrack: number | null,
  originTime: number,
  endMs: number,
): CompactScoreData['backingParts'] {
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
          && note.startTimeMs < endMs
          && note.startTimeMs + note.durationMs > originTime)
        .sort((a, b) => a.startTimeMs - b.startTimeMs),
      MAX_TRACK_NOTES,
    )
      .map((note) => {
        const startTimeMs = Math.max(0, note.startTimeMs - originTime);
        const endTimeMs = Math.min(
          note.startTimeMs + note.durationMs,
          endMs,
        ) - originTime;
        return [
          note.midiNumber,
          Math.round(startTimeMs),
          Math.max(1, Math.round(endTimeMs - startTimeMs)),
          Math.round((Math.max(0.05, note.velocity / 127)) * 100) / 100,
        ] as [number, number, number, number];
      });

    if (tNotes.length === 0) continue;
    const inst = instrumentForProgram(track.program, track.isPercussion);
    const role = isSolo ? 'solo' : 'accompaniment';
    const gain = isSolo ? 0.85 : 0.5;
    const name = (track.name || `Track ${track.index + 1}`).trim().slice(0, 40);
    backingParts.push([name, inst, role, gain, tNotes]);
  }
  return backingParts;
}

/**
 * Which library this build ships.
 *
 * `full` is everything the owner has arranged: the public-domain pieces, the
 * original etudes, and every song that has a folder in `_MIDIS/arranged` —
 * that folder is the curated list, so a MIDI sitting in `downloaded` without
 * an arrangement is not shipped. `free` is only what anyone may redistribute:
 * the public-domain pieces and the etudes written for this repo. Copyrighted
 * songs never enter a `free` build, whatever else is on disk.
 *
 *   npm run build:library -- --edition=free
 */
type Edition = 'full' | 'free';

const editionArg = process.argv.find((arg) => arg.startsWith('--edition='))?.split('=')[1] ?? 'full';
if (editionArg !== 'full' && editionArg !== 'free') {
  throw new Error(`Unknown edition "${editionArg}". Use --edition=full or --edition=free.`);
}
const edition: Edition = editionArg;

const ARRANGED_DIR = '_MIDIS/arranged';
const arrangedIds = existsSync(ARRANGED_DIR)
  ? new Set(readdirSync(ARRANGED_DIR).filter((name) => !name.startsWith('.')))
  : null;
if (edition === 'full' && !arrangedIds) {
  throw new Error(`The full edition is defined by ${ARRANGED_DIR}, which does not exist.`);
}

const categories: { dir: string; cat: 'study' | 'classical' | 'song' }[] = [
  { dir: '_MIDIS/public-domain', cat: 'classical' },
  { dir: '_MIDIS/etudes', cat: 'study' },
  ...(edition === 'full' ? [{ dir: '_MIDIS/downloaded', cat: 'song' as const }] : []),
];

const compactList: CompactScoreData[] = [];
const sourceHashes = new Map<string, string>();
const difficulties: { id: string; tier: DifficultyTier; score: number }[] = [];
const quality: { id: string; track: number; trackName: string; distinct: number; movement: number; shift: number; foldedPct: number }[] = [];

for (const { dir, cat } of categories) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(f => f.endsWith('.mid') || f.endsWith('.midi')).sort();
  for (const f of files) {
    const path = join(dir, f);
    const bytes = new Uint8Array(readFileSync(path));
    const info = parseSongInfo(f, cat);
    if (cat === 'song' && !arrangedIds?.has(info.id)) continue;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (sourceHashes.get(info.id) === hash) continue;
    if (sourceHashes.has(info.id)) throw new Error(`Different MIDI sources share id ${info.id}`);
    sourceHashes.set(info.id, hash);
    const parsed = parseMidi(bytes);
    if (parsed.notes.length === 0) continue;

    // The same arranger runs here and on-device: motif-aware riff/theme source
    // ranking, root-guide fallback, one coherent octave move, and a low first-position range.
    const arranged = arrangeMidi(parsed, { level: 'Expert' });
    if (arranged.notes.length === 0) continue;

    const soloTrack = arranged.sourceTrack;
    const timeSignature = parsed.timeSignature;
    const bpm = parsed.bpm || 80;
    const originTime = arranged.originMs;

    const compactNotes: [number, number, number][] = arranged.notes.map((note) => [
      note.midiNumber,
      Math.round(note.startTimeMs),
      Math.max(1, Math.round(note.durationMs)),
    ]);
    const foldedPct = Math.round((100 * arranged.foldedNotes) / compactNotes.length);

    // Rebased onto the same zero as the melody, so a player switching level
    // mid-practice does not find the bars have moved.
    const compactLine = (line: ReturnType<typeof bassLine>): [number, number, number][] =>
      rebaseLine(line, originTime, arranged.sourceEndMs).map((note) => [
        note.midiNumber, Math.round(note.startTimeMs), Math.max(1, Math.round(note.durationMs)),
      ]);
    const guideNotes = compactLine(harmonicGuide(parsed, arranged.sourceEndMs));
    const bassNotes = compactLine(bassLine(parsed, arranged.sourceEndMs));

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

    // Read from the arranged line plus every pitched note in the source.
    //
    // Melody alone leaves a key ambiguous, and melody-plus-guide is worse than
    // it sounds: the guide is a few hundred re-struck roots, so it outweighs
    // everything else and the Krumhansl profile reads the progression's most
    // common root as the tonic — Back in Black came out "A major" because its
    // roots are E, A and D. Measured against the key of the whole texture,
    // melody alone agrees on 162 of 260 songs, melody plus guide on 195, and
    // the texture on 244. The label is read and not merely shown
    // (`generateAccompaniment` parses it for the drone, and the fingerboard
    // overlay draws the scale from it), so it is worth getting right.
    const percussion = new Set(parsed.tracks.filter((track) => track.isPercussion)
      .map((track) => track.index));
    const detected = detectKey([
      ...events,
      ...parsed.notes
        .filter((note) => !percussion.has(note.track) && note.startTimeMs < arranged.sourceEndMs)
        .map((note) => ({ midiNumber: note.midiNumber, durationMs: note.durationMs })),
    ]);
    const key = keyName(detected.tonic, detected.mode);
    // Seated as a line, exactly as the app seats it — so the stored position
    // distribution describes the fingering the player is actually shown.
    const solvedStates = seatLine(events);
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

    const backingParts = buildBackingParts(parsed, soloTrack, originTime, arranged.sourceEndMs);

    compactList.push({
      id: info.id,
      title: info.title,
      composer: info.composer,
      origin: info.origin,
      bpm,
      meter: timeSignature,
      difficulty,
      positions,
      key,
      preferFlats: key.includes('\u266d'),
      category: info.category,
      notes: compactNotes,
      guide: guideNotes,
      bass: bassNotes,
      backingParts,
    });
  }
}

// ── Model benchmark variants ────────────────────────────────────────────────
// `tools/ollama-benchmark.ts` writes one folder per song per model,
// `_MIDIS/arranged/<song>--<model>/`. Each keeps that model's own fingering,
// which the compact format above cannot (it stores pitches and re-fingers them
// on load), so they ship as their own data file and appear as extra rows.
// Full edition only: the benchmark songs are copyrighted.
const variantData: VariantLibraryData = { variants: [], backings: {} };
const variantRows: LibraryRow[] = [];

function variantRow(variant: CompactVariantDef): LibraryRow {
  const line = variant.levels.Intermediate;
  const events = line.map(([midiNumber, startTimeMs, durationMs]) => ({ midiNumber, startTimeMs, durationMs }));
  const states: CelloState[] = line.map(([, , , string, finger, position, extension]) => ({ string, finger, position, extension }));
  const report = difficultyOf(events, states);
  let low = Infinity;
  let high = -Infinity;
  let end = 0;
  for (const note of line) {
    low = Math.min(low, note[0]);
    high = Math.max(high, note[0]);
  }
  for (const notes of Object.values(variant.levels)) {
    for (const note of notes) end = Math.max(end, note[1] + note[2]);
  }
  const share = (test: (position: string) => boolean) =>
    Math.round((100 * line.filter((note) => test(note[5])).length) / (line.length || 1));
  return {
    id: variant.id,
    title: `${variant.title} [${variant.model}]`,
    composer: variant.composer,
    origin: `MODEL BENCHMARK · ${variant.model.toUpperCase()}`,
    keySignature: variant.key.toUpperCase(),
    range: line.length > 0
      ? `${midiToPitchName(low, variant.preferFlats)} – ${midiToPitchName(high, variant.preferFlats)}`
      : '—',
    tempo: `♩ ${variant.bpm}`,
    difficulty: report.tier,
    category: 'song',
    bars: Math.max(1, Math.ceil(end / measureDurationMs(variant.meter, variant.bpm))),
    playable: true,
    distribution: [
      ['1st position', share((p) => p === '1st' || p === 'Half')],
      ['2nd – 4th', share((p) => ['2nd', '3rd', '4th'].includes(p))],
      ['Thumb / upper', share((p) => ['5th', '6th', '7th', 'Thumb'].includes(p))],
    ],
    note: `Fingered by ${variant.model}: it placed ${Math.round(variant.placedByModel * 100)}% of the notes it was asked about; the solver placed the rest.`,
  };
}

if (edition === 'full' && arrangedIds) {
  const downloads = existsSync('_MIDIS/downloaded')
    ? readdirSync('_MIDIS/downloaded').filter((f) => /\.midi?$/i.test(f))
    : [];
  const fileForSong = new Map(downloads.map((f) => [parseSongInfo(f, 'song').id, f]));

  for (const folder of [...arrangedIds].sort()) {
    const name = parseVariantFolder(folder);
    if (!name) continue;
    const dir = join(ARRANGED_DIR, folder);
    const recordPath = join(dir, 'benchmark.json');
    if (!existsSync(recordPath)) continue;
    const record = JSON.parse(readFileSync(recordPath, 'utf8')) as BenchmarkRecord;
    if (record.status !== 'completed') continue;
    const file = fileForSong.get(name.songId);
    if (!file) {
      console.warn(`benchmark variant ${folder}: no source MIDI for ${name.songId} in _MIDIS/downloaded — skipped`);
      continue;
    }

    const levels = {} as CompactVariantDef['levels'];
    const teaches = {} as CompactVariantDef['teaches'];
    let complete = true;
    for (const tier of DIFFICULTY_TIERS) {
      const path = join(dir, `${tier.toLowerCase()}.json`);
      if (!existsSync(path)) { complete = false; break; }
      const score = JSON.parse(readFileSync(path, 'utf8')) as CelloSongScore;
      levels[tier] = score.notes.map((n) => [
        n.midiNumber, n.startTimeMs, n.durationMs, n.string, n.finger, n.position, n.extension,
        n.articulation === 'accent' ? 1 : 0,
      ]);
      teaches[tier] = score.metadata.teaches;
    }
    if (!complete) {
      console.warn(`benchmark variant ${folder}: missing a tier file — skipped`);
      continue;
    }

    if (!variantData.backings[name.songId]) {
      const source = parseMidi(new Uint8Array(readFileSync(join('_MIDIS/downloaded', file))));
      // The arranger writes notes on the file's own clock, with no rebase to
      // the first note, so the backing is built on that clock too.
      variantData.backings[name.songId] = buildBackingParts(source, record.melodyTrackIndex, 0, source.durationMs);
    }

    const asked = record.tiers.filter((tier) => tier.askedModel);
    const askedNotes = asked.reduce((total, tier) => total + tier.notes, 0);
    const info = parseSongInfo(file, 'song');
    const variant: CompactVariantDef = {
      id: folder,
      baseId: name.songId,
      model: record.model,
      title: info.title,
      composer: info.composer,
      bpm: record.bpm,
      meter: record.meter,
      key: record.key,
      preferFlats: record.key.includes('♭'),
      levels,
      teaches,
      placedByModel: askedNotes === 0 ? 0 : asked.reduce((total, tier) => total + tier.accepted, 0) / askedNotes,
    };
    variantData.variants.push(variant);
    variantRows.push(variantRow(variant));
  }
}

writeFileSync('src/scores/benchmarkVariants.json', JSON.stringify(variantData));
console.log(`Benchmark variants: ${variantData.variants.length}`);

console.log(`Writing ${compactList.length} compact scores to src/scores/bundledSongs.json...`);
writeFileSync('src/scores/bundledSongs.json', JSON.stringify(compactList));

// Only the data is generated. `src/scores/bundledSongs.ts`, which inflates it, is ordinary
// source: it used to be rewritten from a copy of itself held in a template
// string here, and the two drifted — a rebuild silently dropped a strict-mode
// fallback and broke the typecheck.
console.log('Done writing bundledSongs.json.');

// ── Chord sheets by edition ──────────────────────────────────────────────────
// In free edition, only original etudes & public domain chord sheets are bundled.
// In full edition, personal imported chord sheets from _CHORDS/ are included.
const baseChordsPath = 'src/scores/chordSheets.base.json';
const baseChordSheets = existsSync(baseChordsPath) ? JSON.parse(readFileSync(baseChordsPath, 'utf8')) : [];
let bundledChordSheets = [...baseChordSheets];

if (edition === 'full') {
  const customChordsFile = '_CHORDS/chordSheets.json';
  if (existsSync(customChordsFile)) {
    try {
      const customSheets = JSON.parse(readFileSync(customChordsFile, 'utf8'));
      const idMap = new Map(bundledChordSheets.map((s: { id: string }) => [s.id, s]));
      for (const s of customSheets) {
        idMap.set(s.id, s);
      }
      bundledChordSheets = [...idMap.values()].sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    } catch (e) {
      console.warn('Could not read _CHORDS/chordSheets.json:', e);
    }
  }
}

writeFileSync('src/scores/chordSheets.generated.json', `${JSON.stringify(bundledChordSheets, null, 2)}\n`);
console.log(`Chord sheets (${edition}): ${bundledChordSheets.length} charts written to src/scores/chordSheets.generated.json.`);

// ── Catalogue index and edition stamp ────────────────────────────────────────
// The library screen lists rows from `catalogIndex.ts` so it never inflates
// tens of megabytes of songs to draw a list. It has to be written by the same
// run as the JSON, or the list and the songs behind it disagree.
const { toCompactRow } = await import('../src/scores/index');
const rows = [...compactList.map((entry) => toCompactRow(entry)), ...variantRows];
writeFileSync('src/scores/catalogIndex.ts', `import type { LibraryRow } from './index';

/**
 * Precomputed catalog index for the bundled songs. Generated by
 * tools/build-library.ts (${edition} edition) — do not edit by hand.
 */
export const BUNDLED_CATALOG_ROWS: readonly LibraryRow[] = ${JSON.stringify(rows)};
`);

const songCount = compactList.filter((entry) => entry.category === 'song').length;
writeFileSync('src/scores/libraryEdition.ts', `/**
 * Which library this build carries. Generated by tools/build-library.ts — do
 * not edit by hand. Shown in the app so an installed build says what it is.
 */
export interface LibraryEdition {
  /** Widened on purpose: code that compares editions must compile in both builds. */
  id: 'full' | 'free';
  label: string;
  detail: string;
  bundledCount: number;
  songCount: number;
}

export const LIBRARY_EDITION: LibraryEdition = ${JSON.stringify({
    id: edition,
    label: edition === 'full' ? 'Full library' : 'Free library',
    detail: edition === 'full'
      ? `${compactList.length} bundled pieces, including ${songCount} arranged songs for personal practice`
      : `${compactList.length} bundled public-domain pieces and original etudes — free to share`,
    bundledCount: compactList.length,
    songCount,
  }, null, 2)};
`);
console.log(`Edition: ${edition} — ${compactList.length} pieces (${songCount} songs). Wrote catalogIndex.ts and libraryEdition.ts.`);

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
