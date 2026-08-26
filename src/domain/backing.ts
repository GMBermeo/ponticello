/**
 * Backing tracks — the parts you play *along with*.
 *
 * Two things feed this. A score can generate its own accompaniment (a drone,
 * a chord bed, a pulse) from the notes it already contains, which needs no
 * external file and works for every piece in the library. Or a MIDI file can
 * be imported, in which case its tracks become parts and one of them is
 * nominated as the solo line.
 *
 * Either way the result is the same shape: a list of parts, each with a role,
 * so the player can sound the solo, the accompaniment, or both.
 */

import { midiToPitchName, OPEN_STRING_MIDI } from './cello';
import { MidiNote, MidiTrack } from './midi';
import { CelloSongScore } from './schema';

export type PartRole = 'solo' | 'accompaniment';

/** The voices the synthesiser knows how to make. */
export type InstrumentName =
  | 'cello' | 'piano' | 'strings' | 'bass' | 'pluck' | 'drone' | 'percussion';

export interface BackingNote {
  midiNumber: number;
  startTimeMs: number;
  durationMs: number;
  /** 0–1. */
  velocity: number;
}

export interface BackingPart {
  id: string;
  name: string;
  instrument: InstrumentName;
  role: PartRole;
  notes: BackingNote[];
  /** Mix level, 0–1. */
  gain: number;
  muted: boolean;
}

export interface BackingTrack {
  id: string;
  name: string;
  source: 'generated' | 'imported';
  parts: BackingPart[];
  durationMs: number;
  /** Only set for imported tracks — what the file said its tempo was. */
  bpm?: number;
}

export function trackDurationMs(parts: readonly BackingPart[]): number {
  return parts.reduce(
    (max, part) => part.notes.reduce((m, n) => Math.max(m, n.startTimeMs + n.durationMs), max),
    0,
  );
}

export function partsFor(track: BackingTrack | null, role: PartRole): BackingPart[] {
  return (track?.parts ?? []).filter((p) => p.role === role && !p.muted);
}

// ─── The solo line, from the score itself ────────────────────────────────────

/**
 * The written cello part as a playable voice.
 *
 * This is what "let me hear it first" means: the same notes the visions draw,
 * sounded on a cello-ish timbre so you know what you are aiming at before you
 * try to produce it.
 */
export function soloPartFromScore(score: CelloSongScore): BackingPart {
  return {
    id: `${score.id}-solo`,
    name: 'Cello (written part)',
    instrument: 'cello',
    role: 'solo',
    gain: 0.85,
    muted: false,
    notes: score.notes.map((note) => ({
      midiNumber: note.midiNumber,
      startTimeMs: note.startTimeMs,
      // Let the sound stop just short of the next note so repeated pitches
      // articulate instead of merging into one long tone.
      durationMs: Math.max(60, note.durationMs * 0.92),
      velocity: note.articulation === 'accent' ? 0.95 : 0.75,
    })),
  };
}

// ─── Generated accompaniment ─────────────────────────────────────────────────

export type AccompanimentStyle = 'none' | 'drone' | 'chords' | 'pulse';

export const ACCOMPANIMENT_LABEL: Record<AccompanimentStyle, string> = {
  none: 'None',
  drone: 'Drone',
  chords: 'Chords',
  pulse: 'Pulse',
};

export const ACCOMPANIMENT_BLURB: Record<AccompanimentStyle, string> = {
  none: 'Nothing underneath. Just you.',
  drone: 'A sustained tonic and fifth. The oldest intonation tool there is — against a fixed drone, a note that is four cents out starts to beat, and you hear it long before a tuner shows it.',
  chords: 'One chord per bar, worked out from the notes in that bar. Tells you when you are playing the third of the chord, which wants to sit slightly lower than equal temperament.',
  pulse: 'The same chords, re-struck on every beat. A rhythm section rather than a reference tone — use it once the notes are learned.',
};

const NOTE_TO_PITCH_CLASS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * Pitch class of a key signature like "G MAJOR", "D MINOR" or "Bb MAJOR".
 *
 * Only the letter is case-folded. Upper-casing the whole string first turns
 * "Bb" into "BB" and silently loses the flat, which is how B flat major ends
 * up droning on a B.
 */
export function tonicPitchClass(keySignature: string): number {
  const match = /^\s*([A-Ga-g])\s*([#b\u266f\u266d]?)/.exec(keySignature);
  if (!match) return 0;
  const base = NOTE_TO_PITCH_CLASS[match[1].toUpperCase()] ?? 0;
  const sharp = match[2] === '#' || match[2] === '\u266f';
  const flat = match[2] === 'b' || match[2] === '\u266d';
  return (base + (sharp ? 1 : 0) - (flat ? 1 : 0) + 12) % 12;
}

export function isMinorKey(keySignature: string): boolean {
  return /minor|min\b|m$/i.test(keySignature.trim());
}

/**
 * Puts a pitch class in a register that sits under the cello without muddying
 * it — low enough to be a foundation, high enough not to rumble.
 */
function inBassRegister(pitchClass: number, floor = OPEN_STRING_MIDI.C): number {
  let midi = pitchClass;
  while (midi < floor) midi += 12;
  while (midi >= floor + 12) midi -= 12;
  return midi;
}

/** Pitch class of the lowest note sounding in a window. */
function lowestPitchClass(score: CelloSongScore, fromMs: number, toMs: number): number | null {
  let lowest: number | null = null;
  for (const note of score.notes) {
    if (note.startTimeMs + note.durationMs <= fromMs || note.startTimeMs >= toMs) continue;
    if (lowest === null || note.midiNumber < lowest) lowest = note.midiNumber;
  }
  return lowest === null ? null : lowest % 12;
}

/** Weight of each pitch class in a time window, by how long it sounds. */
function pitchClassWeights(score: CelloSongScore, fromMs: number, toMs: number): number[] {
  const weights = new Array(12).fill(0);
  for (const note of score.notes) {
    const start = Math.max(note.startTimeMs, fromMs);
    const end = Math.min(note.startTimeMs + note.durationMs, toMs);
    if (end <= start) continue;
    weights[note.midiNumber % 12] += end - start;
  }
  return weights;
}

export interface InferredChord {
  root: number;
  minor: boolean;
  /** Chord tones as pitch classes, root first. */
  tones: number[];
  /** How much of the bar's weight the chord accounts for, 0–1. */
  confidence: number;
}

/**
 * Best-fitting triad for a window of the score.
 *
 * Scores every major and minor triad by how much of the window's sounding time
 * its three notes account for, with the root weighted highest. Crude next to a
 * real harmonic analyser, and quite good enough to put something under a scale
 * or a Bach prélude — where the bass note is usually spelling the chord out
 * loud anyway.
 */
export function inferChord(
  score: CelloSongScore, fromMs: number, toMs: number, fallbackRoot: number, fallbackMinor: boolean,
): InferredChord {
  const weights = pitchClassWeights(score, fromMs, toMs);
  const total = weights.reduce((a, b) => a + b, 0);
  const bass = lowestPitchClass(score, fromMs, toMs);
  if (total === 0) {
    const tones = fallbackMinor ? [0, 3, 7] : [0, 4, 7];
    return {
      root: fallbackRoot,
      minor: fallbackMinor,
      tones: tones.map((t) => (fallbackRoot + t) % 12),
      confidence: 0,
    };
  }

  let best = { root: fallbackRoot, minor: fallbackMinor, score: -1 };
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const third = (root + (minor ? 3 : 4)) % 12;
      const fifth = (root + 7) % 12;
      // The root carries the most information about which chord this is, the
      // third decides its quality, and the fifth barely distinguishes anything.
      let value = weights[root] * 1.6 + weights[third] * 1.2 + weights[fifth] * 0.6;

      // The lowest note is the single strongest cue for the root — it is why
      // figured bass works at all. Without this the opening of the Bach reads
      // as B minor: B and D each sound six times against a G that sounds
      // twice, but that G is the bass and the bar is plainly G major.
      if (bass !== null && root === bass) value += total * 0.5;

      if (value > best.score) best = { root, minor, score: value };
    }
  }

  const third = (best.root + (best.minor ? 3 : 4)) % 12;
  const fifth = (best.root + 7) % 12;
  return {
    root: best.root,
    minor: best.minor,
    tones: [best.root, third, fifth],
    confidence: Math.min(1, (weights[best.root] + weights[third] + weights[fifth]) / total),
  };
}

export interface AccompanimentOptions {
  style: AccompanimentStyle;
  /** Restrict to these bars, 1-based inclusive. Defaults to the whole score. */
  fromBar?: number;
  toBar?: number;
}

/**
 * Builds accompaniment parts for a score.
 *
 * Generated rather than sourced, which means it works for every piece in the
 * library — including anything imported later — and involves no third party's
 * material.
 */
export function generateAccompaniment(
  score: CelloSongScore, options: AccompanimentOptions,
): BackingPart[] {
  const { style } = options;
  if (style === 'none' || score.measures.length === 0) return [];

  const first = Math.max(1, options.fromBar ?? 1);
  const last = Math.min(score.measures.length, options.toBar ?? score.measures.length);
  const measures = score.measures.slice(first - 1, last);
  if (measures.length === 0) return [];

  const origin = measures[0].startBarTimeMs;
  const tonic = tonicPitchClass(score.metadata.keySignature);
  const minor = isMinorKey(score.metadata.keySignature);

  if (style === 'drone') {
    const durationMs = measures.reduce((sum, m) => sum + m.durationMs, 0);
    const root = inBassRegister(tonic);
    return [{
      id: `${score.id}-drone`,
      name: `Drone on ${midiToPitchName(root)}`,
      instrument: 'drone',
      role: 'accompaniment',
      gain: 0.4,
      muted: false,
      // Tonic and fifth only. Adding the third would fix the chord's quality
      // and defeat the point — a drone is a reference, not a harmony.
      notes: [root, root + 7].map((midiNumber) => ({
        midiNumber,
        startTimeMs: 0,
        durationMs,
        velocity: 0.5,
      })),
    }];
  }

  const notes: BackingNote[] = [];
  for (const measure of measures) {
    const barStart = measure.startBarTimeMs;
    const barEnd = barStart + measure.durationMs;
    const chord = inferChord(score, barStart, barEnd, tonic, minor);

    const voicing = [
      inBassRegister(chord.tones[0]),
      inBassRegister(chord.tones[1]) + 12,
      inBassRegister(chord.tones[2]) + 12,
    ];

    if (style === 'chords') {
      for (const midiNumber of voicing) {
        notes.push({
          midiNumber,
          startTimeMs: barStart - origin,
          durationMs: measure.durationMs * 0.98,
          velocity: 0.45,
        });
      }
      continue;
    }

    const beats = measure.timeSignature[0];
    const beatMs = measure.durationMs / beats;
    for (let beat = 0; beat < beats; beat++) {
      for (const midiNumber of voicing) {
        notes.push({
          midiNumber,
          startTimeMs: barStart - origin + beat * beatMs,
          durationMs: beatMs * 0.7,
          // Beat one carries the bar; the rest step back so the pulse has shape.
          velocity: beat === 0 ? 0.5 : 0.32,
        });
      }
    }
  }

  return [{
    id: `${score.id}-${style}`,
    name: style === 'chords' ? 'Chords' : 'Pulse',
    instrument: style === 'chords' ? 'strings' : 'piano',
    role: 'accompaniment',
    gain: 0.42,
    muted: false,
    notes,
  }];
}

// ─── Imported MIDI ───────────────────────────────────────────────────────────

/** General MIDI program families, mapped onto the voices we can actually make. */
export function instrumentForProgram(program: number | null, percussion: boolean): InstrumentName {
  if (percussion) return 'percussion';
  if (program === null) return 'piano';
  if (program === 42) return 'cello';
  if (program < 8) return 'piano';
  if (program < 24) return 'pluck';       // chromatic percussion, organ
  if (program < 32) return 'pluck';       // guitar
  if (program < 40) return 'bass';
  if (program < 56) return 'strings';
  if (program < 80) return 'strings';     // brass, reed, pipe
  return 'piano';
}

/** How likely a track is to be the cello line, for pre-selecting one on import. */
export function soloTrackScore(track: MidiTrack): number {
  if (track.noteCount === 0 || track.isPercussion) return -1;
  let score = 0;
  if (/cello|violoncello|vc\b|solo/i.test(track.name ?? '')) score += 100;
  if (track.program === 42) score += 60;
  // A cello part sits roughly C2–A5 and is usually close to monophonic.
  const centre = (track.lowestMidi + track.highestMidi) / 2;
  if (centre >= 40 && centre <= 72) score += 25;
  if (track.lowestMidi >= 30 && track.highestMidi <= 88) score += 15;
  return score;
}

export interface ImportOptions {
  name: string;
  /** Track index to treat as the solo line, or null for "all accompaniment". */
  soloTrack: number | null;
}

export function backingFromMidi(
  id: string,
  parsed: { notes: MidiNote[]; tracks: MidiTrack[]; bpm: number; durationMs: number },
  options: ImportOptions,
): BackingTrack {
  const parts: BackingPart[] = [];

  for (const track of parsed.tracks) {
    if (track.noteCount === 0) continue;
    const isSolo = options.soloTrack === track.index;
    const notes = parsed.notes
      .filter((n) => n.track === track.index)
      .map((n) => ({
        midiNumber: n.midiNumber,
        startTimeMs: n.startTimeMs,
        durationMs: n.durationMs,
        velocity: Math.max(0.05, n.velocity / 127),
      }));

    parts.push({
      id: `${id}-t${track.index}`,
      name: track.name || `Track ${track.index + 1}`,
      instrument: isSolo ? 'cello' : instrumentForProgram(track.program, track.isPercussion),
      role: isSolo ? 'solo' : 'accompaniment',
      gain: isSolo ? 0.85 : 0.5,
      muted: false,
      notes,
    });
  }

  return {
    id,
    name: options.name,
    source: 'imported',
    parts,
    bpm: parsed.bpm,
    durationMs: parsed.durationMs,
  };
}
