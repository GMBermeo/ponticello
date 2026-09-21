/**
 * Key detection and fingerboard note placement.
 *
 * Two questions the fingerboard overlay needs answered, both pure:
 *
 *   1. What key is this song in? Bundled compact scores hard-code `tonic: 'C'`,
 *      so the honest answer comes from the notes themselves — a pitch-class
 *      histogram matched against the Krumhansl–Kessler major and minor
 *      profiles. It is the standard first-order key finder and it is good
 *      enough for "which notes belong to this key", which is all the overlay
 *      claims.
 *
 *   2. Where does a given set of pitch classes fall on the fingerboard? Every
 *      stopping point on every string that produces one of those pitch classes,
 *      within the drawn range — so the player sees the whole shape of the key
 *      or the whole shape of the song across all four strings at once.
 *
 * Pure: no React, no React Native, no Web Audio. See AGENTS.md.
 */

import {
  CelloString, OPEN_STRING_MIDI, STRING_ORDER, midiToPitchName, stopDistanceMm,
} from './cello';
import { CelloSongScore } from './schema';

/** 0 = C, 1 = C♯/D♭, … 11 = B. */
export type PitchClass = number;

export type KeyMode = 'major' | 'minor';

export interface DetectedKey {
  /** Pitch class of the tonic, 0–11. */
  tonic: PitchClass;
  mode: KeyMode;
  /** Pitch classes in the diatonic scale, ascending from the tonic. */
  scale: PitchClass[];
  /** Human label, e.g. "D major", spelled with flats when the key wants them. */
  name: string;
  /** How strongly the histogram matched, 0–1. Low means "take this with salt". */
  confidence: number;
}

/**
 * Krumhansl–Kessler tonal hierarchy profiles.
 *
 * Relative weights of each scale degree in a large corpus. Correlating a song's
 * pitch-class histogram against all 24 rotations of these two profiles and
 * taking the best match is the Krumhansl–Schmuckler algorithm.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** Keys conventionally spelled with flats, by tonic pitch class and mode. */
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1]); // F, B♭, E♭, A♭, D♭
const FLAT_MINOR_TONICS = new Set([2, 7, 0, 5, 10]); // D, G, C, F, B♭ minor

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

function rotate(profile: readonly number[], tonic: number): number[] {
  return profile.map((_, i) => profile[(i - tonic + 12) % 12]!);
}

export function scaleFor(tonic: PitchClass, mode: KeyMode): PitchClass[] {
  const steps = mode === 'major' ? MAJOR_SCALE_STEPS : NATURAL_MINOR_STEPS;
  return steps.map((step) => (tonic + step) % 12);
}

export function keyName(tonic: PitchClass, mode: KeyMode): string {
  const flats = mode === 'major' ? FLAT_MAJOR_TONICS : FLAT_MINOR_TONICS;
  const names = flats.has(tonic) ? FLAT_NAMES : SHARP_NAMES;
  return `${names[tonic]} ${mode}`;
}

/** Pitch-class histogram weighted by how long each note sounds. */
export function pitchClassHistogram(midis: readonly { midiNumber: number; durationMs: number }[]): number[] {
  const histogram = new Array(12).fill(0) as number[];
  for (const note of midis) {
    const weight = Math.max(1, note.durationMs);
    const bin = ((note.midiNumber % 12) + 12) % 12;
    histogram[bin] = (histogram[bin] ?? 0) + weight;
  }
  return histogram;
}

/**
 * Best-fitting key for a set of notes, by the Krumhansl–Schmuckler correlation.
 *
 * `confidence` is the gap between the winning correlation and the runner-up,
 * clamped to 0–1: a song that fits one key far better than any other scores
 * high; an ambiguous or atonal passage scores low, and the caller can say so.
 */
export function detectKey(
  notes: readonly { midiNumber: number; durationMs: number }[],
): DetectedKey {
  const histogram = pitchClassHistogram(notes);
  const total = histogram.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return { tonic: 0, mode: 'major', scale: scaleFor(0, 'major'), name: keyName(0, 'major'), confidence: 0 };
  }

  const candidates: { tonic: PitchClass; mode: KeyMode; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    candidates.push({ tonic, mode: 'major', score: pearson(histogram, rotate(MAJOR_PROFILE, tonic)) });
    candidates.push({ tonic, mode: 'minor', score: pearson(histogram, rotate(MINOR_PROFILE, tonic)) });
  }
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0]!;
  const runnerUp = candidates[1]!;
  const confidence = Math.max(0, Math.min(1, best.score - runnerUp.score));

  return {
    tonic: best.tonic,
    mode: best.mode,
    scale: scaleFor(best.tonic, best.mode),
    name: keyName(best.tonic, best.mode),
    confidence,
  };
}

/** Detect the key of a whole song from its written notes. */
export function detectSongKey(score: CelloSongScore): DetectedKey {
  return detectKey(score.notes);
}

/** Distinct pitch classes actually used in a song, ascending. */
export function songPitchClasses(score: CelloSongScore): PitchClass[] {
  const present = new Set<PitchClass>();
  for (const note of score.notes) present.add(((note.midiNumber % 12) + 12) % 12);
  return [...present].sort((a, b) => a - b);
}

/**
 * Exact string and semitone stopping points actually played in the song.
 * Unlike `fingerboardMarkers(songPitchClasses(score))`, this only returns notes
 * the score actually asks the player to stop or play, preventing dots from appearing
 * in positions or octaves never touched by the piece (e.g. on 1st position studies).
 */
export function songPlayedNotes(
  score: CelloSongScore,
  options: { tonic?: PitchClass; preferFlats?: boolean } = {},
): FingerboardMarker[] {
  const { tonic, preferFlats = false } = options;
  const seen = new Set<string>();
  const markers: FingerboardMarker[] = [];

  for (const note of score.notes) {
    const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
    if (semitones < 0) continue;
    const key = `${note.string}-${semitones}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const pitchClass = ((note.midiNumber % 12) + 12) % 12;
    markers.push({
      string: note.string,
      semitones,
      midiNumber: note.midiNumber,
      pitchName: midiToPitchName(note.midiNumber, preferFlats),
      pitchClass,
      isTonic: tonic !== undefined && pitchClass === ((tonic % 12) + 12) % 12,
    });
  }

  return markers.sort((a, b) => {
    if (a.string !== b.string) return a.string.localeCompare(b.string);
    return a.semitones - b.semitones;
  });
}

/** One placeable note on the fingerboard: a stopping point on a string. */
export interface FingerboardMarker {
  string: CelloString;
  /** Semitones above the nut, 0 = open string. */
  semitones: number;
  midiNumber: number;
  pitchName: string;
  pitchClass: PitchClass;
  /** True for the tonic of the key, so the overlay can weight it. */
  isTonic: boolean;
}

/**
 * Every stopping point within `maxSemitones` of the nut, on every string, whose
 * pitch class is in `pitchClasses`. Open strings (semitone 0) are included when
 * the open pitch itself belongs.
 */
export function fingerboardMarkers(
  pitchClasses: readonly PitchClass[],
  options: { maxSemitones?: number; tonic?: PitchClass; preferFlats?: boolean } = {},
): FingerboardMarker[] {
  const { maxSemitones = 26, tonic, preferFlats = false } = options;
  const wanted = new Set(pitchClasses.map((pc) => ((pc % 12) + 12) % 12));
  const markers: FingerboardMarker[] = [];

  for (const string of STRING_ORDER) {
    const open = OPEN_STRING_MIDI[string];
    for (let semitones = 0; semitones <= maxSemitones; semitones++) {
      const midiNumber = open + semitones;
      const pitchClass = midiNumber % 12;
      if (!wanted.has(pitchClass)) continue;
      markers.push({
        string,
        semitones,
        midiNumber,
        pitchName: midiToPitchName(midiNumber, preferFlats),
        pitchClass,
        isTonic: tonic !== undefined && pitchClass === ((tonic % 12) + 12) % 12,
      });
    }
  }
  return markers;
}

/** Convenience: markers for the millimetre-based fingerboard drawing. */
export function markerMm(marker: FingerboardMarker): number {
  return stopDistanceMm(marker.semitones);
}

export interface ParsedScaleKey {
  readonly tonic: PitchClass;
  readonly mode: KeyMode;
  readonly scale: readonly PitchClass[];
  readonly name: string;
}

const TONIC_PITCH_CLASS: Record<string, PitchClass> = {
  c: 0, 'c♯': 1, 'c#': 1, 'd♭': 1, db: 1,
  d: 2, 'd♯': 3, 'd#': 3, 'e♭': 3, eb: 3,
  e: 4, 'e♯': 5, 'e#': 5, 'f♭': 4, fb: 4,
  f: 5, 'f♯': 6, 'f#': 6, 'g♭': 6, gb: 6,
  g: 7, 'g♯': 8, 'g#': 8, 'a♭': 8, ab: 8,
  a: 9, 'a♯': 10, 'a#': 10, 'b♭': 10, bb: 10,
  b: 11, 'b♯': 0, 'b#': 0, 'c♭': 11, cb: 11,
};

/**
 * Parses key signatures like "C", "Dm", "F#m", "Bb", "Eb minor", "A major", etc.
 * Returns the scale's tonic pitch class, diatonic scale pitch classes, and mode.
 */
export function parseScaleKey(raw?: string | null): ParsedScaleKey | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^([a-g][#b♭♯]?)\s*(minor|min|m|major|maj)?$/i);
  if (!match) return null;
  const letter = match[1]!.toLowerCase();
  const tonic = TONIC_PITCH_CLASS[letter];
  if (tonic === undefined) return null;
  const suffix = (match[2] ?? '').toLowerCase();
  const mode: KeyMode = suffix === 'm' || suffix.startsWith('min') ? 'minor' : 'major';
  return {
    tonic,
    mode,
    scale: scaleFor(tonic, mode),
    name: keyName(tonic, mode),
  };
}

