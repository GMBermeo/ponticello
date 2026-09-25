/**
 * What keys does the library actually use?
 *
 * A scale is worth a player's time in proportion to how often they will meet
 * it. That is not a matter of taste: the library is a fixed set of songs, each
 * with a detected key, so the answer is a count. Forty-two of the bundled
 * songs are in E minor and two are in F♯ major, and a practice plan that gives
 * those two keys equal billing is lying to the player about where their
 * evenings will go.
 *
 * So the census is *measured*, never written down. `bundledSongs.json` is
 * rebuilt from `_MIDIS/` whenever the arranger changes, and every count here
 * moves with it. Nothing in this module or in `src/scores/scaleDrills.ts`
 * hard-codes a number of songs; the drills are authored per key and the census
 * decides their order and their billing at runtime.
 *
 * Pure: no React, no React Native, no Web Audio. See AGENTS.md.
 */

import { CelloString, toPitchClass } from './cello';
import { KeyMode, PitchClass, keyName } from './key';

// ─── Naming ──────────────────────────────────────────────────────────────────

/**
 * Letter names accepted when parsing a key label, in both the typographic
 * spellings the library stores (♯ / ♭) and the ASCII an importer might hand us.
 */
const TONIC_PITCH_CLASS: Record<string, PitchClass> = {
  c: 0, 'c♯': 1, 'c#': 1, 'd♭': 1, db: 1,
  d: 2, 'd♯': 3, 'd#': 3, 'e♭': 3, eb: 3,
  e: 4, 'e♯': 5, 'e#': 5, 'f♭': 4, fb: 4,
  f: 5, 'f♯': 6, 'f#': 6, 'g♭': 6, gb: 6,
  g: 7, 'g♯': 8, 'g#': 8, 'a♭': 8, ab: 8,
  a: 9, 'a♯': 10, 'a#': 10, 'b♭': 10, bb: 10,
  b: 11, 'b♯': 0, 'b#': 0, 'c♭': 11, cb: 11,
};

export interface ParsedKey {
  tonic: PitchClass;
  mode: KeyMode;
}

/**
 * Reads a key label back into a tonic and a mode.
 *
 * Labels reach us in three spellings of the same thing — `"E minor"` from a
 * compact score, `"E MINOR"` once a library row has upper-cased it, and
 * `"Eb major"` from an importer that had no ♭ to hand — so this is
 * case-insensitive and takes either accidental. Anything that is not a key at
 * all (`"CHROMATIC"`, `""`) returns null rather than guessing C.
 */
export function parseKeyName(label: string): ParsedKey | null {
  const trimmed = label.trim().toLowerCase();
  if (!trimmed) return null;

  const mode = keyModeOf(trimmed);
  if (!mode) return null;

  const letter = trimmed.split(/\s+/)[0];
  if (!letter) return null;
  const tonic = TONIC_PITCH_CLASS[letter];
  if (tonic === undefined) return null;

  return { tonic, mode };
}

/** Canonical label for a key, spelled the way the key itself wants it. */
export function canonicalKeyName(key: ParsedKey): string {
  return keyName(key.tonic, key.mode);
}

// ─── Open strings ────────────────────────────────────────────────────────────

/**
 * The four keys a beginner can tune a drone for by ear.
 *
 * C, G, D and A are the open strings. When the tonic is one of them the player
 * can sound the drone without stopping the string at all, check it against the
 * scale's own tonic, and hear the key settle — which is why the graded
 * syllabuses reach for exactly these keys first. ABRSM's cello Initial Grade
 * asks for "G, D majors *starting on open strings*"; the words are in the
 * requirement, not merely permitted by it.
 */
const OPEN_STRING_TONIC: Record<number, CelloString> = { 0: 'C', 7: 'G', 2: 'D', 9: 'A' };

export function openStringTonic(tonic: PitchClass): CelloString | null {
  return OPEN_STRING_TONIC[toPitchClass(tonic)] ?? null;
}

/**
 * Position of a key on the circle of fifths: 0 for C major and A minor,
 * positive for sharps, negative for flats.
 *
 * `|fifths|` is the number of accidentals in the key signature, which is the
 * tie-break when two keys are used by the same number of songs — of two keys
 * the library leans on equally, the one with the simpler signature is the one
 * to practise first.
 */
export function fifthsOf(key: ParsedKey): number {
  const relativeMajor = key.mode === 'minor' ? key.tonic + 3 : key.tonic;
  return (toPitchClass(relativeMajor * 7 + 5)) - 5;
}

// ─── The census ──────────────────────────────────────────────────────────────

export interface KeyCensusEntry {
  /** Canonical label, e.g. `"E minor"`, `"B♭ major"`. */
  key: string;
  tonic: PitchClass;
  mode: KeyMode;
  /** How many songs in the library are in this key. */
  songs: number;
  /** Share of the counted library, 0–1. */
  share: number;
  /** 1 is the key the library uses most. */
  rank: number;
  /** Accidentals in the key signature. */
  accidentals: number;
  /** The open string this key is tuned to, when its tonic is one. */
  openString: CelloString | null;
}

export interface KeyCensus {
  /** Songs whose key label parsed. */
  counted: number;
  /** Songs whose key label did not — kept visible rather than silently dropped. */
  unparsed: number;
  /** Every key the library uses, most-used first. */
  entries: readonly KeyCensusEntry[];
  /** Songs in a key whose tonic is an open string. */
  openStringSongs: number;
}

/**
 * Counts the keys of a set of songs.
 *
 * Takes anything carrying a key label, so it can be run over the bundled
 * library, over one category of it, or over a test fixture of six songs. Ties
 * break towards the key that is easier to start on: an open-string tonic
 * first, then the simpler key signature, then alphabetically so the order is
 * stable across rebuilds.
 */
export function keyCensus(songs: readonly { key: string }[]): KeyCensus {
  const counts = new Map<string, { parsed: ParsedKey; songs: number }>();
  let unparsed = 0;

  for (const song of songs) {
    const parsed = parseKeyName(song.key);
    if (!parsed) { unparsed += 1; continue; }
    const label = canonicalKeyName(parsed);
    const existing = counts.get(label);
    if (existing) existing.songs += 1;
    else counts.set(label, { parsed, songs: 1 });
  }

  const counted = [...counts.values()].reduce((sum, c) => sum + c.songs, 0);

  const ordered = [...counts.entries()]
    .map(([key, { parsed, songs: n }]) => ({
      key,
      tonic: parsed.tonic,
      mode: parsed.mode,
      songs: n,
      share: counted === 0 ? 0 : n / counted,
      accidentals: Math.abs(fifthsOf(parsed)),
      openString: openStringTonic(parsed.tonic),
    }))
    .sort((a, b) => b.songs - a.songs
      || Number(b.openString !== null) - Number(a.openString !== null)
      || a.accidentals - b.accidentals
      || a.key.localeCompare(b.key))
    .map((entry, index): KeyCensusEntry => ({ ...entry, rank: index + 1 }));

  return {
    counted,
    unparsed,
    entries: ordered,
    openStringSongs: ordered
      .filter((entry) => entry.openString !== null)
      .reduce((sum, entry) => sum + entry.songs, 0),
  };
}

export function censusEntry(
  census: KeyCensus, tonic: PitchClass, mode: KeyMode,
): KeyCensusEntry | undefined {
  const wanted = toPitchClass(tonic);
  return census.entries.find((entry) => entry.tonic === wanted && entry.mode === mode);
}

// ─── How much practice a key has earned ──────────────────────────────────────

/**
 * What the library is asking of the player, per key.
 *
 * Bands are shares of the library rather than counts, so they survive the
 * library growing: `cornerstone` is a key that carries at least a twentieth of
 * everything the player owns, and `rare` is a key they will meet two or three
 * times and can read at sight when they do.
 *
 * The thresholds are the only judgement in this module. They were placed
 * against the measured distribution — the six cornerstone keys cover just over
 * half the library between them, which is what makes "learn these six first"
 * a claim worth making.
 */
export type KeyDemand = 'cornerstone' | 'common' | 'occasional' | 'rare';

export const KEY_DEMAND_AT: Record<Exclude<KeyDemand, 'rare'>, number> = {
  cornerstone: 0.05,
  common: 0.03,
  occasional: 0.015,
};

export function keyDemand(share: number): KeyDemand {
  if (share >= KEY_DEMAND_AT.cornerstone) return 'cornerstone';
  if (share >= KEY_DEMAND_AT.common) return 'common';
  if (share >= KEY_DEMAND_AT.occasional) return 'occasional';
  return 'rare';
}

/** How many graded drills a key at this demand deserves. */
export const DRILLS_EARNED: Record<KeyDemand, number> = {
  cornerstone: 3,
  common: 2,
  occasional: 1,
  rare: 0,
};

export const KEY_DEMAND_LABEL: Record<KeyDemand, string> = {
  cornerstone: 'Cornerstone key',
  common: 'Comes up often',
  occasional: 'Comes up now and then',
  rare: 'Rare here',
};

/**
 * One line telling the player why this key is worth an evening.
 *
 * The number is the argument, so it leads. `total` is passed in rather than
 * stored on the entry because it is a fact about the library, not about the
 * key, and repeating it on 24 rows is how the two drift apart.
 */
export function censusLine(entry: KeyCensusEntry, total: number): string {
  const one = entry.songs === 1;
  const songs = `${entry.songs} ${one ? 'song' : 'songs'}`;
  const of = total > 0 ? ` of ${total}` : '';
  const verb = one ? 'is' : 'are';
  const emphasis = entry.rank === 1 ? ' — more than any other key' : '';
  const lead = `${songs}${of} in your library ${verb} in ${entry.key}${emphasis}.`;
  return entry.openString
    ? `${lead} Its tonic is the open ${entry.openString} string, so you can tune the drone to it by ear.`
    : lead;
}

function keyModeOf(text: string): KeyMode | null {
  if (/\bmin(or)?\b/.test(text)) return 'minor';
  if (/\bmaj(or)?\b/.test(text)) return 'major';
  return null;
}
