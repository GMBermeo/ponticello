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

import { CatalogStub, CelloSongScore, scoreDurationMs } from '@/domain/schema';
import { BWV1007_PRELUDE } from './bach';
import { STUDIES } from './studies';

export const SCORES: CelloSongScore[] = [...STUDIES, BWV1007_PRELUDE];

export const SCORES_BY_ID: Record<string, CelloSongScore> =
  Object.fromEntries(SCORES.map((s) => [s.id, s]));

export function getScore(id: string | undefined): CelloSongScore | undefined {
  return id ? SCORES_BY_ID[id] : undefined;
}

/**
 * Rows the design called for that cannot ship with notes attached. Kept
 * visible rather than deleted: the position load and range are still useful
 * for deciding what to learn next, and the row is where a converted score
 * lands when you add one.
 */
const COPYRIGHTED = 'Still in copyright — convert your own licensed copy to add it.';

export const STUBS: CatalogStub[] = [
  {
    id: 'secunda', title: 'Secunda', composer: 'Jeremy Soule · Skyrim',
    origin: 'GAME · SUSTAINED LEGATO', keySignature: 'D MINOR', range: 'G2 – E4',
    tempo: '♩ 56–64', difficulty: 'Beginner',
    distribution: [['1st position', 70], ['2nd – 4th', 30], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'song-of-storms', title: 'Song of Storms', composer: 'Koji Kondo · Ocarina of Time',
    origin: 'GAME · SPICCATO', keySignature: 'D MINOR', range: 'D2 – D4',
    tempo: '♩ 112–126', difficulty: 'Beginner',
    distribution: [['1st position', 80], ['2nd – 4th', 20], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'pallet-town', title: 'Pallet Town', composer: 'Junichi Masuda · Pokémon',
    origin: 'GAME · FIRST POSITION ONLY', keySignature: 'C MAJOR', range: 'G2 – C4',
    tempo: '♩ 76–84', difficulty: 'Beginner',
    distribution: [['1st position', 90], ['2nd – 3rd', 10], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'concerning-hobbits', title: 'Concerning Hobbits', composer: 'Howard Shore · Fellowship',
    origin: 'FILM · DÉTACHÉ LÉGER', keySignature: 'D MAJOR', range: 'G2 – D4',
    tempo: '♩ 84–92', difficulty: 'Beginner',
    distribution: [['1st position', 75], ['2nd – 4th', 25], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'lullaby-of-woe', title: 'Lullaby of Woe', composer: 'M. Przybyłowicz · Witcher 3',
    origin: 'GAME · DORIAN MODE', keySignature: 'D MINOR', range: 'C2 – F4',
    tempo: '♩. 50–54', difficulty: 'Intermediate',
    distribution: [['1st position', 60], ['2nd – 4th', 40], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'wind-scene', title: 'Wind Scene', composer: 'Yasunori Mitsuda · Chrono Trigger',
    origin: 'GAME · CANTABILE', keySignature: 'G MINOR', range: 'G2 – G4',
    tempo: '♩ 72–80', difficulty: 'Intermediate',
    distribution: [['1st position', 50], ['2nd – 4th', 40], ['Upper neck', 10]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'hes-a-pirate', title: "He's a Pirate", composer: 'Badelt & Zimmer · Pirates',
    origin: 'FILM · DOUBLE STOPS', keySignature: 'D MINOR', range: 'D2 – F4',
    tempo: '♩. 104–116', difficulty: 'Intermediate',
    distribution: [['1st position', 65], ['2nd – 4th', 35], ['Thumb', 0]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'game-of-thrones', title: 'Game of Thrones Main Theme', composer: 'Ramin Djawadi',
    origin: 'TELEVISION · OSTINATO', keySignature: 'C MINOR', range: 'C2 – D5',
    tempo: '♩. 64–76', difficulty: 'Advanced',
    distribution: [['1st position', 40], ['2nd – 4th', 35], ['Thumb / 5th–7th', 25]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'aeriths-theme', title: "Aerith's Theme", composer: 'Nobuo Uematsu · Final Fantasy VII',
    origin: 'GAME · HIGH CANTABILE', keySignature: 'D MAJOR', range: 'G2 – B4',
    tempo: '♩ 60–68', difficulty: 'Advanced',
    distribution: [['1st position', 35], ['2nd – 4th', 45], ['5th – 6th', 20]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'merry-go-round', title: 'Merry-Go-Round of Life', composer: "Joe Hisaishi · Howl's Moving Castle",
    origin: 'FILM · WALTZ', keySignature: 'G MINOR', range: 'G2 – D5',
    tempo: '♩ 128–144', difficulty: 'Advanced',
    distribution: [['1st position', 40], ['2nd – 4th', 40], ['Thumb / 5th–7th', 20]],
    unbundledReason: COPYRIGHTED,
  },
  {
    id: 'le-cygne', title: 'The Swan (Le Cygne)', composer: 'Camille Saint-Saëns',
    origin: 'CLASSICAL · BOW DIVISION', keySignature: 'G MAJOR', range: 'G2 – G4',
    tempo: '♩ 66–72', difficulty: 'Advanced',
    distribution: [['1st position', 20], ['2nd – 4th', 50], ['5th–7th / Thumb', 30]],
    unbundledReason: 'Public domain, but not yet transcribed. Convert an edition to add it.',
  },
];

// ─── Unified library view ────────────────────────────────────────────────────

export type LibraryEntry =
  | { kind: 'score'; id: string; score: CelloSongScore }
  | { kind: 'stub'; id: string; stub: CatalogStub };

export const LIBRARY: LibraryEntry[] = [
  ...SCORES.map((score): LibraryEntry => ({ kind: 'score', id: score.id, score })),
  ...STUBS.map((stub): LibraryEntry => ({ kind: 'stub', id: stub.id, stub })),
];

export interface LibraryRow {
  id: string;
  title: string;
  composer: string;
  origin: string;
  keySignature: string;
  range: string;
  tempo: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
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

export function toRow(entry: LibraryEntry): LibraryRow {
  if (entry.kind === 'stub') {
    const { stub } = entry;
    return {
      id: stub.id, title: stub.title, composer: stub.composer, origin: stub.origin,
      keySignature: stub.keySignature, range: stub.range, tempo: stub.tempo,
      difficulty: stub.difficulty, bars: null, playable: false,
      distribution: stub.distribution, note: stub.unbundledReason,
    };
  }
  const { score } = entry;
  return {
    id: score.id,
    title: score.metadata.title,
    composer: score.metadata.composer,
    origin: score.metadata.origin,
    keySignature: score.metadata.keySignature,
    range: rangeOf(score),
    tempo: `♩ ${score.metadata.bpm}`,
    difficulty: score.metadata.difficulty,
    bars: score.measures.length,
    playable: true,
    distribution: distributionOf(score),
    note: score.metadata.teaches,
  };
}

export const LIBRARY_ROWS: LibraryRow[] = LIBRARY.map(toRow);

export function durationOf(id: string): number {
  const score = getScore(id);
  return score ? scoreDurationMs(score) : 0;
}
