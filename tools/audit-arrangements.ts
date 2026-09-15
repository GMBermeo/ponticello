/**
 * Run: npm run audit:arrangements.
 *
 * Three gates over every runtime arrangement, and the difference between them
 * is the point.
 *
 * **DOCTRINE** checks compare the arrangement against numbers measured from
 * published beginner cello material — `.scratch/gauntlet/reference/DOCTRINE.md`,
 * which quotes the ABRSM 2024 cello syllabus and measures the note data of
 * eight published arrangements. Every doctrine constant below carries the
 * section it came from. These are the only checks that can claim a standard.
 *
 * **GAME** checks are the practice app's own rules, and they are labelled that
 * way because no syllabus covers them: DOCTRINE.md says outright that
 * "coverage/silence is not addressed by any source here". An ABRSM piece is a
 * whole short piece; ours is a part extracted from a five-minute rock track,
 * and a player staring at an empty highway for a minute is a product defect
 * with no published bar. Where a published data point exists it brackets the
 * threshold, and the bracket is printed.
 *
 * **PROFILE** checks compare the arranged score against
 * `ARRANGEMENT_PROFILES[level]` — the configuration `arrangeScoreForLevel`
 * used to build it. They are self-consistency checks, not standards: a ruler
 * that takes its graduations from the object under test cannot fail it except
 * through a bug in the arranger. They are kept, and labelled, because that bug
 * is worth catching; they are no longer the headline.
 *
 * Nothing here is tuned to produce a number. A large failure count means the
 * arrangements are wrong; where doctrine is silent, the output says so.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ARRANGEMENT_LEVELS, ARRANGEMENT_PROFILES, arrangeScoreForLevel } from '../src/domain/arrangement';
import { BackingPart, isMinorKey, tonicPitchClass } from '../src/domain/backing';
import { midiToPitchName, OPEN_STRING_MIDI } from '../src/domain/cello';
import { difficultyOf } from '../src/domain/difficulty';
import { firstPositionFingering, RawNoteEvent } from '../src/domain/fingering';
import { DetectedKey, detectKey } from '../src/domain/key';
import { CelloSongScore, DifficultyTier, measureDurationMs, validateScore } from '../src/domain/schema';
import { COMPACT_SCORES, CORE_SCORES, getBassLine, getBundledBacking, getGuideLine, getScore } from '../src/scores';

type Level = string;

// ─── Doctrine: measured from published beginner cello material ───────────────

const OPEN_G = OPEN_STRING_MIDI.G; // 43
const D4 = 62;
const G4 = 67;

/**
 * Every bound here is quoted or measured in DOCTRINE.md. The tag in each
 * comment is the section a critic should check it against.
 */
const DOCTRINE = {
  /** §1/#1 — ABRSM sight-reading ranges: Grades 1–3 stop at d′ (D4); Grade 4 reaches g′. */
  ceiling: { Beginner: D4, Intermediate: D4, Advanced: D4, Expert: G4 } as Record<Level, number>,
  /** The instrument's own floor. §6 #2's G2 floor is a Grade-1 *melody* bound — see `belowOpenG`. */
  floor: OPEN_STRING_MIDI.C,
  /**
   * §4/#11 — measured max leap: 9 st across four parts stated "Beginners";
   * an octave (12) is S6 Für Elise and 16 is S7 Bach Minuet, both stated
   * "Beginners with some playing experience".
   */
  maxLeap: { Beginner: 9, Intermediate: 12, Advanced: 16, Expert: 16 } as Record<Level, number>,
  /** §4/#11 — fewer than 4% of intervals exceed a perfect 5th at "Beginners". */
  wideLeapShare: 0.04,
  /**
   * §1/#6 — ABRSM parameter table: crotchets, minims and paired quavers at
   * Grade 1; semiquavers first appear at Grade 3. So the shortest attack gap
   * is a quaver until Advanced, and a semiquaver there.
   */
  shortestAttackBeats: { Beginner: 0.5, Intermediate: 0.5, Advanced: 0.25, Expert: 0 } as Record<Level, number>,
  /** §1/#6 — dotted minims appear at Grade 2; nothing longer is listed below Grade 3. */
  longestNoteBeats: 3,
  /** §3/#9 — measured: the published drone/bass part holds nothing longer than a crotchet. */
  droneLongestNoteBeats: 1,
  /** §3/#9 — measured: 80 notes over 16 bars of 4/4 = 5 attacks per bar. */
  droneAttacksPer4Beats: 5,
  /** §3/#10 — measured: ~50% of adjacent pairs repeat the same pitch. */
  droneRepeatedShare: 0.5,
  /** §2/#7 — measured: 27–40% open-string pitches for a melody or bass line, ~80% for a drone. */
  openStringShare: 0.27,
  /** §3/#8 — measured: 5–6 distinct *pitches* in the whole piece for a drone/bass part. */
  dronePitches: 6,
  /** §1/#4 — the 7 notes of one key. Accidentals are Grade 3; chromatic notes Grade 4. */
  pitchClasses: 7,
  /** §1/#4 — zero accidentals at Beginner. */
  accidentals: 0,
  /** §7/#13 — a printed extension is what a publisher calls level 3 of 5. */
  extensions: 0,
} as const;

/**
 * The app's own rules. DOCTRINE.md: "Coverage/silence is not addressed by any
 * source here … judge those against the game's own premise, and say so."
 *
 * Published opening rests, for the bracket: 0 quarter-beats (four arrangements
 * of Ode to Joy / Carol of the Bells play in bar 1), 12 (ABRSM Grade 2
 * "Hallelujah", 6 bars of 6/8 ≈ 12 s and 18% of the piece), 24 (Game of
 * Thrones, Tomplay 1/5 "Very Easy", 8 bars of 3/4), 40 (Phantom of the Opera,
 * Tomplay 5/5, 10 bars of 4/4). 32 quarter-beats sits between the easiest
 * non-zero datum and the hardest; 15% sits under the ABRSM proportion.
 */
const GAME = {
  /** Silence before the entry: whichever is larger, so a long song may rest longer. */
  entryBeats: 32,
  entryShare: 0.15,
  /** Same shape at the end. No published datum at all — symmetry with the entry. */
  tailBeats: 32,
  tailShare: 0.15,
  /** `nightwish…md` shows a published cello part resting 4 whole bars mid-piece. */
  liveGapBeats: 16,
  /** The UX rule, in seconds, because "bars" would dress a preference as a standard. */
  entryMs: 12_000,
  /** From the original brief. Reported in every row; see the note in the report. */
  fillShare: 0.25,
  /** From the original brief. Doctrine is silent on per-note chord agreement. */
  rootFifthShare: 0.7,
} as const;

/** Rounding slack: scores store whole milliseconds. */
const SLACK_MS = 2;
/** A detected key this unconfident is a coin flip; see the `in key` note. */
const KEY_CONFIDENCE_FLOOR = 0.2;

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

function scaleOf(tonic: number, minor: boolean): Set<number> {
  return new Set((minor ? NATURAL_MINOR_STEPS : MAJOR_STEPS).map((step) => (tonic + step) % 12));
}

// ─── Failures ────────────────────────────────────────────────────────────────

type CheckKind = 'doctrine' | 'game' | 'profile' | 'integrity';

interface CheckDef { name: string; kind: CheckKind; source: string }

/** Every check, its class, and where its threshold comes from. Printed as-is. */
const CHECKS: readonly CheckDef[] = [
  { name: 'ids', kind: 'integrity', source: 'library must not repeat a song id' },
  { name: 'schema', kind: 'integrity', source: 'validateScore + accompaniment sources present' },
  { name: 'empty part', kind: 'integrity', source: 'a level must contain notes' },
  { name: 'ceiling', kind: 'doctrine', source: '§1/#1 ABRSM range: ≤ D4 to Grade 3, ≤ G4 at Grade 4' },
  { name: 'floor', kind: 'doctrine', source: 'the instrument: ≥ C2' },
  { name: 'stopped below open G', kind: 'doctrine', source: '§1/#2 Grade-1 floor G2 — melody role only; §3\'s published bass part contradicts it' },
  { name: 'first position', kind: 'doctrine', source: '§1/#3 1st position through Grade 3' },
  { name: 'extensions', kind: 'doctrine', source: '§7/#13 a printed extension is level 3 of 5' },
  { name: 'open strings taken', kind: 'integrity', source: 'an open-string pitch must be fingered 0' },
  { name: 'open-string share', kind: 'doctrine', source: '§2/#7 27–40% measured in published parts' },
  { name: 'leap', kind: 'doctrine', source: '§4/#11 9 st at "Beginners"; 12–16 with experience' },
  { name: 'wide leaps', kind: 'doctrine', source: '§4/#11 <4% of intervals over a P5' },
  { name: 'note values', kind: 'doctrine', source: '§1/#6 quaver floor to Grade 2; semiquavers Grade 3' },
  { name: 'longest note', kind: 'doctrine', source: '§1/#6 dotted minim at Grade 2' },
  { name: 'drone pitches', kind: 'doctrine', source: '§3/#8 5–6 distinct pitches in the whole part' },
  { name: 'pitch classes', kind: 'doctrine', source: '§1/#4 the 7 notes of one key' },
  { name: 'accidentals', kind: 'doctrine', source: '§1/#4 zero accidentals vs the score\'s own key' },
  { name: 'bass support', kind: 'integrity', source: 'a held bass note must be sounded by the source' },
  { name: 'entry latency', kind: 'game', source: `≤ max(${GAME.entryBeats} beats, ${GAME.entryShare * 100}%); published 0/12/24/40` },
  { name: 'entry seconds', kind: 'game', source: `≤ ${GAME.entryMs / 1000}s — app UX, no published bar` },
  { name: 'tail silence', kind: 'game', source: 'symmetry with the entry; no published bar' },
  { name: 'live gap', kind: 'game', source: `≤ ${GAME.liveGapBeats} beats; published part rests 4 bars` },
  { name: 'fill ratio', kind: 'game', source: `≥ ${GAME.fillShare * 100}% from the brief; see note` },
  { name: 'root agreement', kind: 'game', source: `≥ ${GAME.rootFifthShare * 100}% from the brief; doctrine silent` },
  { name: 'root validity', kind: 'integrity', source: 'the real line must outscore +1/+5/+7 transpositions' },
  { name: 'difficulty', kind: 'profile', source: 'measured tier ≤ selected level' },
  { name: 'profile range', kind: 'profile', source: 'ARRANGEMENT_PROFILES[level].range' },
  { name: 'profile leap', kind: 'profile', source: 'ARRANGEMENT_PROFILES[level].maxLeapSemitones' },
  { name: 'profile attacks', kind: 'profile', source: 'ARRANGEMENT_PROFILES[level].maxNotesPerSecond' },
];
type CheckName = (typeof CHECKS)[number]['name'];

interface Failure { check: CheckName; kind: CheckKind; id: string; level: Level; message: string }

const KIND_OF = new Map(CHECKS.map((def) => [def.name, def.kind]));
const failures: Failure[] = [];
const rows: Record<string, string | number>[] = [];

function check(ok: boolean, name: CheckName, id: string, level: Level, message: string): void {
  if (ok) return;
  failures.push({ check: name, kind: KIND_OF.get(name) ?? 'integrity', id, level, message });
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

// ─── Time spans ──────────────────────────────────────────────────────────────

interface Span { startMs: number; endMs: number }

function spansOf(
  notes: readonly { startTimeMs: number; durationMs: number }[], hangoverMs = 0,
): Span[] {
  return notes.map((note) => ({
    startMs: note.startTimeMs,
    endMs: note.startTimeMs + Math.max(0, note.durationMs) + hangoverMs,
  }));
}

function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.startMs <= last.endMs) last.endMs = Math.max(last.endMs, span.endMs);
    else merged.push({ ...span });
  }
  return merged;
}

function unionMs(spans: readonly Span[]): number {
  return mergeSpans(spans).reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
}

/**
 * The largest rest inside a line, and the largest part of any one rest during
 * which the rest of the band is still playing.
 *
 * Both matter. A piece where everybody stops for eight bars is not a hole in
 * the arrangement; eight bars of rest over a chorus is.
 */
function restsOf(line: readonly Span[], active: readonly Span[]): { gapMs: number; liveMs: number } {
  const merged = mergeSpans(line);
  let gapMs = 0;
  let liveMs = 0;
  let cursor = 0;
  for (let i = 1; i < merged.length; i++) {
    const fromMs = merged[i - 1]!.endMs;
    const toMs = merged[i]!.startMs;
    if (toMs <= fromMs) continue;
    gapMs = Math.max(gapMs, toMs - fromMs);
    while (cursor < active.length && active[cursor]!.endMs <= fromMs) cursor++;
    for (let j = cursor; j < active.length && active[j]!.startMs < toMs; j++) {
      liveMs = Math.max(liveMs, Math.min(toMs, active[j]!.endMs) - Math.max(fromMs, active[j]!.startMs));
    }
  }
  return { gapMs, liveMs };
}

// ─── The harmony actually sounding underneath ────────────────────────────────

interface HarmonyWindow { weights: number[]; total: number; lowest: number | null; classes: number }

/**
 * Sampler over the sounding backing, swept in time order.
 *
 * Queries arrive in ascending order (a line is sorted by attack), so a cursor
 * plus an active set beats re-scanning: some songs carry 13 000 backing notes
 * across 24 parts.
 */
class Harmony {
  private readonly events: { startMs: number; endMs: number; midiNumber: number }[];
  private cursor = 0;
  private active: { startMs: number; endMs: number; midiNumber: number }[] = [];
  private lastFromMs = -Infinity;

  constructor(parts: readonly BackingPart[]) {
    this.events = parts
      // Every pitched part, whatever its role. The part a song's melody came
      // from is stored here as the *source* track in its original register, and
      // at Beginner level the app sounds it along with everything else — so it
      // is part of the harmony the player is accompanying. Leaving it out reads
      // Polly's harmony off the vocal line and calls a G over a G chord wrong.
      //
      // Drum-map "pitches" are not pitches. They say the band is playing, which
      // is what `active` is for, and nothing at all about the chord.
      .filter((part) => part.instrument !== 'percussion')
      .flatMap((part) => part.notes.map((note) => ({
        startMs: note.startTimeMs,
        endMs: note.startTimeMs + Math.max(0, note.durationMs),
        midiNumber: note.midiNumber,
      })))
      .sort((a, b) => a.startMs - b.startMs);
  }

  window(fromMs: number, toMs: number): HarmonyWindow {
    if (fromMs < this.lastFromMs) { this.cursor = 0; this.active = []; }
    this.lastFromMs = fromMs;
    while (this.cursor < this.events.length && this.events[this.cursor]!.startMs < toMs) {
      this.active.push(this.events[this.cursor]!);
      this.cursor++;
    }
    this.active = this.active.filter((event) => event.endMs > fromMs);

    const weights = new Array<number>(12).fill(0);
    let total = 0;
    let lowest: number | null = null;
    for (const event of this.active) {
      const overlap = Math.min(toMs, event.endMs) - Math.max(fromMs, event.startMs);
      if (overlap <= 0) continue;
      const pitchClass = ((event.midiNumber % 12) + 12) % 12;
      weights[pitchClass] = weights[pitchClass]! + overlap;
      total += overlap;
      if (lowest === null || event.midiNumber < lowest) lowest = event.midiNumber;
    }
    return { weights, total, lowest, classes: weights.filter((weight) => weight > 0).length };
  }
}

/**
 * Best-fitting triad for a weighted pitch-class table.
 *
 * Weighted as `inferChord` in `domain/backing` does — root ×1.6, third ×1.2,
 * fifth ×0.6 — **but without its lowest-note bonus.** That bonus was measured
 * to dominate every window, which made "the chord root" mean "the bass note";
 * and since the Beginner and Intermediate lines are derived from the source
 * bass, the check then closed a loop and confirmed itself. Without it the
 * answer is a triad fit over what is sounding, and the bass-doubling share is
 * reported separately so the loop is visible instead of hidden.
 */
function chordOf(sample: HarmonyWindow): { root: number; minor: boolean } | null {
  if (sample.total <= 0) return null;
  const weight = (pitchClass: number) => sample.weights[((pitchClass % 12) + 12) % 12] ?? 0;
  let best = { root: 0, minor: false, score: -1 };
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const value = weight(root) * 1.6 + weight(root + (minor ? 3 : 4)) * 1.2 + weight(root + 7) * 0.6;
      if (value > best.score) best = { root, minor, score: value };
    }
  }
  return { root: best.root, minor: best.minor };
}

// ─── What the song does, independent of any level ────────────────────────────

interface SongMusic {
  beatMs: number;
  /** The stored meter's bar. Reported for reference; **no gate is denominated in it.** */
  barMs: number;
  barBeats: number;
  /** True when the build stored a bar shorter than 4 quarter-beats — usually a detection failure. */
  meterSuspect: boolean;
  /** First and last sounding moment of the backing (or of the score, if it has none). */
  startMs: number;
  endMs: number;
  songMs: number;
  songBeats: number;
  /** Merged spans where something is sounding, each note held over by a beat. */
  active: Span[];
  timeline: 'backing' | 'score';
  key: DetectedKey;
  /** The key the score itself claims, which the app's drone and overlay parse. */
  declared: { tonic: number; minor: boolean; scale: Set<number>; parallel: Set<number> };
  harmony: Harmony;
}

function musicOf(score: CelloSongScore, parts: readonly BackingPart[]): SongMusic {
  const meter = score.measures[0]?.timeSignature ?? [4, 4];
  const bpm = score.metadata.bpm;
  const beatMs = 60000 / bpm;
  const barMs = measureDurationMs(meter, bpm);

  // The song's timeline is the *backing*, not the stored full line: at every
  // level the backing carries the melody's own source track, and the stored
  // line is a part nobody plays at Beginner. Only the authored studies, which
  // ship no backing, fall back to their own notes.
  const pitched = parts.filter((part) => part.notes.length > 0);
  const timeline = pitched.length > 0 ? 'backing' : 'score';
  const timelineNotes = timeline === 'backing'
    ? pitched.flatMap((part) => part.notes)
    : score.notes;

  const sounding = spansOf(timelineNotes);
  const startMs = sounding.reduce((min, span) => Math.min(min, span.startMs), Infinity);
  const endMs = sounding.reduce((max, span) => Math.max(max, span.endMs), 0);
  const from = Number.isFinite(startMs) ? startMs : 0;

  // A rhythm section comping quarter notes is "playing" through its own rests,
  // so each note is held over by one beat before the spans are merged.
  const active = mergeSpans(spansOf(timelineNotes, beatMs));

  const harmonic = [
    ...score.notes.map((note) => ({ midiNumber: note.midiNumber, durationMs: note.durationMs })),
    ...parts.filter((part) => part.instrument !== 'percussion')
      .flatMap((part) => part.notes.map((note) => ({ midiNumber: note.midiNumber, durationMs: note.durationMs }))),
  ];

  const tonic = tonicPitchClass(score.metadata.keySignature);
  const minor = isMinorKey(score.metadata.keySignature);

  return {
    beatMs,
    barMs,
    barBeats: barMs / beatMs,
    meterSuspect: barMs / beatMs < 4,
    startMs: from,
    endMs,
    songMs: Math.max(1, endMs - from),
    songBeats: Math.max(1, endMs - from) / beatMs,
    active,
    timeline,
    key: detectKey(harmonic),
    declared: { tonic, minor, scale: scaleOf(tonic, minor), parallel: scaleOf(tonic, !minor) },
    harmony: new Harmony(parts),
  };
}

// ─── Per-level metrics ───────────────────────────────────────────────────────

interface Metrics {
  id: string;
  level: Level;
  role: string;
  notes: number;
  lowMidi: number;
  highMidi: number;
  belowOpenG: number;
  /** Notes below the open G that are *stopped*, i.e. not the open C string. */
  stoppedBelowOpenG: number;
  maxLeap: number;
  wideLeaps: number;
  shortestAttackBeats: number;
  longestNoteBeats: number;
  attacksPer4Beats: number;
  repeated: number;
  distinctPitches: number;
  pitchClasses: number;
  /** Notes outside the scale the score itself claims, and outside both parallel modes. */
  accidentals: number;
  accidentalsEitherMode: number;
  inKeyDetected: number;
  extensions: number;
  openShare: number;
  entryBeats: number;
  entryMs: number;
  tailBeats: number;
  gapBeats: number;
  liveGapBeats: number;
  fill: number;
  /** null = no pitched backing sounded under any note, so it cannot be measured. */
  rootFifth: number | null;
  root: number | null;
  chordTone: number | null;
  bassDoubling: number | null;
  /** The best score any of the +1/+5/+7 transpositions reached, so the guard is auditable. */
  nullBest: number | null;
  /** false = a transposed (wrong) line scored at least as well, so the number means nothing here. */
  discriminating: boolean | null;
  failures: number;
}

const metrics: Metrics[] = [];

/** Share of a line's notes that are the root (or root/fifth, or any chord tone) of the sounding chord. */
function harmonyAgreement(
  notes: readonly { midiNumber: number; startTimeMs: number; durationMs: number }[],
  music: SongMusic, transpose = 0,
): { judged: number; root: number; rootFifth: number; chordTone: number; bass: number } {
  let judged = 0;
  let root = 0;
  let rootFifth = 0;
  let chordTone = 0;
  let bass = 0;
  const sorted = [...notes].sort((a, b) => a.startTimeMs - b.startTimeMs);
  for (const note of sorted) {
    const attackMs = Math.max(1, Math.min(note.durationMs, music.beatMs));
    let sample = music.harmony.window(note.startTimeMs, note.startTimeMs + attackMs);
    if (sample.total === 0) {
      sample = music.harmony.window(note.startTimeMs, note.startTimeMs + Math.max(1, note.durationMs));
    }
    const chord = chordOf(sample);
    if (!chord) continue;
    judged++;
    const pitchClass = (((note.midiNumber + transpose) % 12) + 12) % 12;
    const third = (chord.root + (chord.minor ? 3 : 4)) % 12;
    const fifth = (chord.root + 7) % 12;
    if (pitchClass === chord.root) root++;
    if (pitchClass === chord.root || pitchClass === fifth) rootFifth++;
    if (pitchClass === chord.root || pitchClass === third || pitchClass === fifth) chordTone++;
    if (sample.lowest !== null && pitchClass === ((sample.lowest % 12) + 12) % 12) bass++;
  }
  return { judged, root, rootFifth, chordTone, bass };
}

function measureLevel(score: CelloSongScore, music: SongMusic): Omit<Metrics, 'id' | 'level' | 'failures'> {
  const notes = score.notes;
  const role = score.metadata.arrangementRole ?? 'authored';
  if (notes.length === 0) {
    return {
      role, notes: 0, lowMidi: 0, highMidi: 0, belowOpenG: 0, stoppedBelowOpenG: 0,
      maxLeap: 0, wideLeaps: 0,
      shortestAttackBeats: 0, longestNoteBeats: 0, attacksPer4Beats: 0, repeated: 0,
      distinctPitches: 0, pitchClasses: 0, accidentals: 0, accidentalsEitherMode: 0,
      inKeyDetected: 0, extensions: 0, openShare: 0,
      entryBeats: music.songBeats, entryMs: music.songMs, tailBeats: music.songBeats,
      gapBeats: music.songBeats, liveGapBeats: music.songBeats, fill: 0,
      rootFifth: null, root: null, chordTone: null, bassDoubling: null, nullBest: null,
      discriminating: null,
    };
  }

  const pitches = notes.map((note) => note.midiNumber);
  const opens = new Set(Object.values(OPEN_STRING_MIDI));
  let maxLeap = 0;
  let wide = 0;
  let repeated = 0;
  let shortestMs = Infinity;
  for (let i = 1; i < notes.length; i++) {
    const interval = Math.abs(notes[i]!.midiNumber - notes[i - 1]!.midiNumber);
    maxLeap = Math.max(maxLeap, interval);
    if (interval > 7) wide++;
    if (interval === 0) repeated++;
    shortestMs = Math.min(shortestMs, notes[i]!.startTimeMs - notes[i - 1]!.startTimeMs);
  }

  const line = spansOf(notes);
  const firstMs = line.reduce((min, span) => Math.min(min, span.startMs), Infinity);
  const lastMs = line.reduce((max, span) => Math.max(max, span.endMs), 0);
  const { gapMs, liveMs } = restsOf(line, music.active);

  const real = harmonyAgreement(notes, music);
  // A wrong answer must not be able to outscore the right one. Transposing the
  // whole line by a fifth maps every root onto a fifth, and "root or fifth"
  // accepts both — so without this guard the metric cannot tell tonic from
  // dominant, and a +7 line scores as well as the real one.
  const nulls = real.judged === 0 ? [] : [1, 5, 7].map((semitones) =>
    harmonyAgreement(notes, music, semitones).rootFifth / real.judged);
  const rootFifth = real.judged === 0 ? null : real.rootFifth / real.judged;

  return {
    role,
    notes: notes.length,
    lowMidi: Math.min(...pitches),
    highMidi: Math.max(...pitches),
    belowOpenG: notes.filter((note) => note.midiNumber < OPEN_G).length / notes.length,
    stoppedBelowOpenG: notes.filter((note) => note.midiNumber < OPEN_G && note.finger !== '0').length,
    maxLeap,
    wideLeaps: notes.length > 1 ? wide / (notes.length - 1) : 0,
    shortestAttackBeats: Number.isFinite(shortestMs) ? shortestMs / music.beatMs : Infinity,
    longestNoteBeats: Math.max(...notes.map((note) => note.durationMs)) / music.beatMs,
    attacksPer4Beats: notes.length / (music.songBeats / 4),
    repeated: notes.length > 1 ? repeated / (notes.length - 1) : 0,
    distinctPitches: new Set(pitches).size,
    pitchClasses: new Set(pitches.map((midi) => ((midi % 12) + 12) % 12)).size,
    accidentals: notes.filter((note) => !music.declared.scale.has(((note.midiNumber % 12) + 12) % 12)).length,
    accidentalsEitherMode: notes.filter((note) => {
      const pitchClass = ((note.midiNumber % 12) + 12) % 12;
      return !music.declared.scale.has(pitchClass) && !music.declared.parallel.has(pitchClass);
    }).length,
    inKeyDetected: notes.filter((note) =>
      music.key.scale.includes(((note.midiNumber % 12) + 12) % 12)).length / notes.length,
    extensions: notes.filter((note) => note.extension !== 'none').length,
    openShare: notes.filter((note) => opens.has(note.midiNumber)).length / notes.length,
    entryBeats: (firstMs - music.startMs) / music.beatMs,
    entryMs: firstMs - music.startMs,
    tailBeats: (music.endMs - lastMs) / music.beatMs,
    gapBeats: gapMs / music.beatMs,
    liveGapBeats: liveMs / music.beatMs,
    fill: unionMs(line) / music.songMs,
    rootFifth,
    root: real.judged === 0 ? null : real.root / real.judged,
    chordTone: real.judged === 0 ? null : real.chordTone / real.judged,
    bassDoubling: real.judged === 0 ? null : real.bass / real.judged,
    nullBest: nulls.length === 0 ? null : Math.max(...nulls),
    discriminating: rootFifth === null ? null : nulls.every((score) => score < rootFifth),
  };
}

// ─── The audit ───────────────────────────────────────────────────────────────

interface AuditOptions {
  score: CelloSongScore;
  level: Level;
  adaptive: boolean;
  music: SongMusic;
  declared: DifficultyTier;
  storedTier: DifficultyTier;
  source?: readonly RawNoteEvent[];
}

const ACCOMPANIMENT: readonly Level[] = ['Beginner', 'Intermediate'];

function audit({ score, level, adaptive, music, declared, storedTier, source }: AuditOptions): void {
  const notes = score.notes;
  const id = score.id;
  const label = `${id}/${level}`;
  const before = failures.length;
  const m = measureLevel(score, music);
  const beginner = level === 'Beginner';
  const drone = m.role === 'roots' || m.role === 'bass';

  check(validateScore(score).length === 0, 'schema', id, level, `${label}: invalid score`);
  check(notes.length > 0, 'empty part', id, level, `${label}: empty part`);
  if (notes.length === 0) {
    metrics.push({ id, level, ...m, failures: failures.length - before });
    return;
  }

  const pitches = notes.map((note) => note.midiNumber).sort((a, b) => a - b);
  const maximumStop = Math.max(...notes.map((note) => note.midiNumber - OPEN_STRING_MIDI[note.string]));
  const missedOpens = notes.filter((note) => Object.values(OPEN_STRING_MIDI).includes(note.midiNumber)
    && note.finger !== '0').length;
  const upper = notes.filter((note) => !['Half', '1st'].includes(note.position)).length;

  if (adaptive) {
    const profile = ARRANGEMENT_PROFILES[level as keyof typeof ARRANGEMENT_PROFILES];

    // ── Doctrine: the published standard, with its own constants ────────────
    const ceiling = DOCTRINE.ceiling[level] ?? D4;
    check(m.highMidi <= ceiling, 'ceiling', id, level,
      `${label}: tops out at ${midiToPitchName(m.highMidi)}, above ${midiToPitchName(ceiling)}`);
    check(m.lowMidi >= DOCTRINE.floor, 'floor', id, level,
      `${label}: bottoms at ${midiToPitchName(m.lowMidi)}, below ${midiToPitchName(DOCTRINE.floor)}`);
    // §1/#2 puts the Grade-1 floor at G2, and §3's measured published beginner
    // *bass* part runs D2–B2 with stopped notes all over the C string. The two
    // sources only agree about a melody, so only a melody is gated; for a
    // roots/bass part the share below the open G is reported instead.
    if (beginner && m.role === 'melody') {
      check(m.stoppedBelowOpenG === 0, 'stopped below open G', id, level,
        `${label}: ${m.stoppedBelowOpenG} stopped notes below the open G`);
    }
    check(upper === 0 && maximumStop <= 6, 'first position', id, level, `${label}: left first position`);
    check(missedOpens === 0, 'open strings taken', id, level, `${label}: bypassed an open string`);
    if (beginner) {
      // Beginner only: §6's checklist is "for a Beginner line", and S10 prints
      // two extensions in an arrangement its publisher calls level 3 of 5.
      // Reported for the other levels rather than failed.
      check(m.extensions === DOCTRINE.extensions, 'extensions', id, level,
        `${label}: ${m.extensions} extended-position notes`);
    }
    const leapCeiling = DOCTRINE.maxLeap[level] ?? 16;
    check(m.maxLeap <= leapCeiling, 'leap', id, level,
      `${label}: leaps ${m.maxLeap} semitones, over the published ${leapCeiling}`);
    if (beginner) {
      check(m.wideLeaps <= DOCTRINE.wideLeapShare, 'wide leaps', id, level,
        `${label}: ${pct(m.wideLeaps)} of intervals exceed a perfect 5th`);
      check(m.openShare >= DOCTRINE.openStringShare, 'open-string share', id, level,
        `${label}: ${pct(m.openShare)} open-string pitches, under the published 27–40% band`);
      check(m.pitchClasses <= DOCTRINE.pitchClasses, 'pitch classes', id, level,
        `${label}: ${m.pitchClasses} distinct pitch classes`);
      check(m.accidentals <= DOCTRINE.accidentals, 'accidentals', id, level,
        `${label}: ${m.accidentals}/${notes.length} notes outside ${score.metadata.keySignature}`
        + ` (${m.accidentalsEitherMode} outside both parallel modes)`);
    }
    const attackFloor = DOCTRINE.shortestAttackBeats[level] ?? 0;
    check(m.shortestAttackBeats + SLACK_MS / music.beatMs >= attackFloor, 'note values', id, level,
      `${label}: attacks ${m.shortestAttackBeats.toFixed(2)} beats apart, under ${attackFloor}`);
    if (beginner) {
      check(m.longestNoteBeats <= DOCTRINE.longestNoteBeats + SLACK_MS / music.beatMs, 'longest note', id, level,
        `${label}: holds ${m.longestNoteBeats.toFixed(1)} beats, over a dotted minim`);
    }
    if (drone && beginner) {
      check(m.distinctPitches <= DOCTRINE.dronePitches, 'drone pitches', id, level,
        `${label}: ${m.distinctPitches} distinct pitches, over the published 5–6`);
    }

    // ── Game: coverage and silence, which no syllabus covers ────────────────
    if (ACCOMPANIMENT.includes(level)) {
      const entryBudget = Math.max(GAME.entryBeats, GAME.entryShare * music.songBeats);
      check(m.entryBeats <= entryBudget + SLACK_MS / music.beatMs, 'entry latency', id, level,
        `${label}: enters ${m.entryBeats.toFixed(1)} beats in, past a budget of ${entryBudget.toFixed(1)}`);
      check(m.entryMs <= GAME.entryMs + SLACK_MS, 'entry seconds', id, level,
        `${label}: ${(m.entryMs / 1000).toFixed(1)}s of empty highway before the first note`);
      const tailBudget = Math.max(GAME.tailBeats, GAME.tailShare * music.songBeats);
      check(m.tailBeats <= tailBudget + SLACK_MS / music.beatMs, 'tail silence', id, level,
        `${label}: stops ${m.tailBeats.toFixed(1)} beats early, past a budget of ${tailBudget.toFixed(1)}`);
      check(m.liveGapBeats <= GAME.liveGapBeats, 'live gap', id, level,
        `${label}: rests ${m.liveGapBeats.toFixed(1)} beats while the backing plays`);
    }
    if (beginner) {
      check(m.fill >= GAME.fillShare, 'fill ratio', id, level, `${label}: sounds for ${pct(m.fill)} of the song`);
      check(m.rootFifth === null || m.rootFifth >= GAME.rootFifthShare, 'root agreement', id, level,
        `${label}: ${m.rootFifth === null ? 'not measurable' : pct(m.rootFifth)} on the root or fifth`
        + ` of the sounding chord (${m.bassDoubling === null ? '—' : pct(m.bassDoubling)} simply double the bass)`);
      // Never a silent pass: an unmeasurable score is a defect of its own, and
      // a score a wrong line can match means nothing.
      check(m.rootFifth !== null, 'root validity', id, level,
        `${label}: no pitched backing sounds under any note, so chord agreement cannot be measured`);
      check(m.discriminating !== false, 'root validity', id, level,
        `${label}: a +1/+5/+7 transposition of this line scores as well as the line itself`);
    }

    // ── Profile: the arranger against its own configuration ────────────────
    check(pitches[0]! >= profile.range.low && pitches.at(-1)! <= profile.range.high, 'profile range', id, level,
      `${label}: outside the profile's ${profile.range.low}–${profile.range.high}`);
    check(m.maxLeap <= profile.maxLeapSemitones, 'profile leap', id, level,
      `${label}: leap ${m.maxLeap} over the profile's ${profile.maxLeapSemitones}`);
    check(m.shortestAttackBeats * music.beatMs + 1 >= 1000 / profile.maxNotesPerSecond, 'profile attacks', id, level,
      `${label}: attacks ${Math.round(m.shortestAttackBeats * music.beatMs)} ms apart`);

    // Octave placement may change, but a bass anchor must still be supported
    // at that time by the source bass. Allow at most 30 ms articulation gaps
    // and 2 ms of MIDI-to-JSON rounding, not a held note over another chord.
    if (source) for (const note of notes) {
      let supportedUntil = note.startTimeMs;
      for (const original of source) {
        if (original.startTimeMs > note.startTimeMs + note.durationMs + 32) break;
        if (original.midiNumber % 12 !== note.midiNumber % 12) continue;
        if (original.startTimeMs > supportedUntil + 32) continue;
        supportedUntil = Math.max(supportedUntil, original.startTimeMs + original.durationMs);
      }
      check(supportedUntil + 2 >= note.startTimeMs + note.durationMs, 'bass support', id, level,
        `${label}: unsupported bass hold at ${note.startTimeMs} ms`);
    }
  }

  const states = adaptive ? notes.map((note) => firstPositionFingering(note.midiNumber)) : notes;
  const report = difficultyOf(notes, states);
  if (adaptive) {
    check(ARRANGEMENT_LEVELS.indexOf(report.tier) <= ARRANGEMENT_LEVELS.indexOf(level as typeof report.tier),
      'difficulty', id, level, `${label}: measured difficulty ${report.tier} exceeds the selected level`);
  }

  const failedChecks = failures.length - before;
  metrics.push({ id, level, ...m, failures: failedChecks });

  const round = (value: number | null, places = 1) =>
    value === null || !Number.isFinite(value) ? '' : Number(value.toFixed(places));
  const share = (value: number | null) => value === null ? '' : Math.round(value * 100);
  rows.push({
    id, level, role: m.role, failedChecks,
    // Reference only: the stored meter's bar. No gate is denominated in it —
    // 30 songs store a bar under four beats and 7 store the degenerate 1/4 the
    // build emits when meter detection fails, so every budget is in beats.
    meter: score.measures[0]?.timeSignature.join('/') ?? score.metadata.timeSignature,
    barBeats: round(music.barBeats, 2), meterSuspect: music.meterSuspect ? 'yes' : '',
    timeline: music.timeline, songBeats: round(music.songBeats),
    key: score.metadata.keySignature, detectedKey: music.key.name,
    keyConfidence: round(music.key.confidence, 2),
    keyDetermined: music.key.confidence >= KEY_CONFIDENCE_FLOOR ? 'yes' : 'no',
    keyAgrees: music.key.tonic === music.declared.tonic
      && (music.key.mode === 'minor') === music.declared.minor ? 'yes' : 'no',
    notes: notes.length,
    range: `${midiToPitchName(pitches[0]!)}–${midiToPitchName(pitches.at(-1)!)}`,
    medianMidi: pitches[Math.floor(pitches.length / 2)]!, maximumStop, upperNotes: upper, missedOpens,
    maxLeap: m.maxLeap, wideLeapPct: share(m.wideLeaps),
    minimumAttackMs: Math.round(m.shortestAttackBeats * music.beatMs),
    shortestAttackBeats: round(m.shortestAttackBeats, 2), longestNoteBeats: round(m.longestNoteBeats),
    attacksPer4Beats: round(m.attacksPer4Beats, 2), repeatedPitchPct: share(m.repeated),
    maximumHandShiftMm: Math.round(report.factors.maxShiftMm), measuredDifficulty: report.tier,
    entryBeats: round(m.entryBeats), entrySeconds: round(m.entryMs / 1000),
    tailBeats: round(m.tailBeats), maxGapBeats: round(m.gapBeats), liveGapBeats: round(m.liveGapBeats),
    fillPct: share(m.fill), attacks: notes.length,
    distinctPitches: m.distinctPitches, pitchClasses: m.pitchClasses,
    accidentals: m.accidentals, accidentalsEitherMode: m.accidentalsEitherMode,
    inKeyDetectedPct: share(m.inKeyDetected),
    rootPct: share(m.root), rootFifthPct: share(m.rootFifth), chordTonePct: share(m.chordTone),
    bassDoublingPct: share(m.bassDoubling), rootNullBestPct: share(m.nullBest),
    rootDiscriminating: m.discriminating === null ? '' : m.discriminating ? 'yes' : 'no',
    openStringPct: share(m.openShare), belowOpenGPct: share(m.belowOpenG),
    stoppedBelowOpenG: m.stoppedBelowOpenG,
    extensions: m.extensions,
    declaredDifficulty: declared, storedLineTier: storedTier,
    difficultyMislabelled: declared === storedTier ? '' : `${declared}→${storedTier}`,
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

check(new Set(COMPACT_SCORES.map((raw) => raw.id)).size === COMPACT_SCORES.length, 'ids', '-', '-', 'Duplicate song ids');
for (const raw of COMPACT_SCORES) {
  const full = getScore(raw.id)!;
  const guide = getGuideLine(raw.id);
  const bass = getBassLine(raw.id);
  const backing = getBundledBacking(raw.id);
  check(Boolean(guide?.length && bass?.length), 'schema', raw.id, '-', `${raw.id}: missing accompaniment sources`);
  const music = musicOf(full, backing?.parts ?? []);
  const storedTier = difficultyOf(full.notes, full.notes.map((note) => firstPositionFingering(note.midiNumber))).tier;
  for (const level of ARRANGEMENT_LEVELS) {
    const score = arrangeScoreForLevel(full, level, { guide, bass });
    audit({
      score, level, adaptive: true, music, declared: raw.difficulty, storedTier,
      source: level === 'Beginner' || level === 'Intermediate' ? bass : undefined,
    });
  }
}
for (const score of CORE_SCORES) {
  const backing = getBundledBacking(score.id);
  const music = musicOf(score, backing?.parts ?? []);
  audit({
    score, level: score.metadata.difficulty, adaptive: false, music,
    declared: score.metadata.difficulty, storedTier: difficultyOf(score.notes, score.notes).tier,
  });
}

// ─── Reporting ───────────────────────────────────────────────────────────────

const md5 = (path: string) => createHash('md5').update(readFileSync(path)).digest('hex').slice(0, 12);
/** A number nobody can pin to a population is not a measurement. */
const provenance = {
  measuredAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  songs: COMPACT_SCORES.length,
  parts: COMPACT_SCORES.length * ARRANGEMENT_LEVELS.length,
  library: md5('src/scores/bundledSongs.json'),
  arranger: md5('src/domain/arrangement.ts'),
  gate: md5('tools/audit-arrangements.ts'),
};

const songRows = rows.slice(0, COMPACT_SCORES.length * ARRANGEMENT_LEVELS.length);
const songMetrics = metrics.slice(0, COMPACT_SCORES.length * ARRANGEMENT_LEVELS.length);

mkdirSync('docs', { recursive: true });
const columns = Object.keys(rows[0]!);
const csv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
writeFileSync('docs/cello-arrangement-audit.csv', [columns.join(','),
  ...rows.map((row) => columns.map((column) => csv(row[column] ?? '')).join(','))].join('\n') + '\n');

/** True median: the mean of the two middle values on an even-length list. */
const median = (values: readonly number[]): number => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const fixed = (value: number, places = 1) => Number.isFinite(value) ? value.toFixed(places) : '—';

const levelGroup = (level: Level) => songMetrics.filter((row) => row.level === level);
const pick = (level: Level, get: (row: Metrics) => number | null) =>
  levelGroup(level).map(get).filter((value): value is number => value !== null && Number.isFinite(value));

/** `median / worst`, where worst follows the metric's own direction. */
const cell = (level: Level, get: (row: Metrics) => number | null, worst: 'high' | 'low', places = 1, scale = 1) => {
  const values = pick(level, get);
  if (values.length === 0) return '— / —';
  const extreme = worst === 'high' ? Math.max(...values) : Math.min(...values);
  return `${fixed(median(values) * scale, places)} / ${fixed(extreme * scale, places)}`;
};
const count = (level: Level, test: (row: Metrics) => boolean) => levelGroup(level).filter(test).length;

/** Median / worst as pitch names — "57 / 62" tells a cellist nothing. */
const noteCell = (level: Level, get: (row: Metrics) => number, worst: 'high' | 'low') => {
  const values = pick(level, get);
  if (values.length === 0) return '— / —';
  const extreme = worst === 'high' ? Math.max(...values) : Math.min(...values);
  return `${midiToPitchName(Math.round(median(values)))} / ${midiToPitchName(extreme)}`;
};

const physical = ARRANGEMENT_LEVELS.map((level) => `| ${level} | ${levelGroup(level).length} `
  + `| ${noteCell(level, (r) => r.highMidi, 'high')} | ${noteCell(level, (r) => r.lowMidi, 'low')} `
  + `| ${cell(level, (r) => r.maxLeap, 'high', 0)} | ${cell(level, (r) => r.wideLeaps, 'high', 1, 100)} `
  + `| ${cell(level, (r) => r.openShare, 'low', 0, 100)} | ${cell(level, (r) => r.belowOpenG, 'high', 0, 100)} `
  + `| ${cell(level, (r) => r.stoppedBelowOpenG, 'high', 0)} `
  + `| ${cell(level, (r) => r.distinctPitches, 'high', 0)} | ${cell(level, (r) => r.pitchClasses, 'high', 0)} |`);

const musical = ARRANGEMENT_LEVELS.map((level) => `| ${level} `
  + `| ${cell(level, (r) => r.entryBeats, 'high')} | ${cell(level, (r) => r.tailBeats, 'high')} `
  + `| ${cell(level, (r) => r.liveGapBeats, 'high')} | ${cell(level, (r) => r.fill, 'low', 0, 100)} `
  + `| ${cell(level, (r) => r.attacksPer4Beats, 'low', 2)} | ${cell(level, (r) => r.longestNoteBeats, 'high')} `
  + `| ${cell(level, (r) => r.repeated, 'low', 0, 100)} `
  + `| ${cell(level, (r) => r.rootFifth, 'low', 0, 100)} | ${cell(level, (r) => r.root, 'low', 0, 100)} `
  + `| ${cell(level, (r) => r.bassDoubling, 'high', 0, 100)} |`);

const byCheck = CHECKS.map((def) => {
  const hits = failures.filter((failure) => failure.check === def.name);
  const perLevel = ARRANGEMENT_LEVELS.map((level) => hits.filter((hit) => hit.level === level).length);
  return { def, hits: hits.length, perLevel };
}).filter((entry) => entry.hits > 0)
  .sort((a, b) => b.hits - a.hits)
  .map((entry) => `| ${entry.def.name} | ${entry.def.kind} | ${entry.def.source} `
    + `| ${entry.perLevel.join(' | ')} | ${entry.hits} |`);

const byKind = (['doctrine', 'game', 'profile', 'integrity'] as const).map((kind) =>
  `| ${kind} | ${failures.filter((failure) => failure.kind === kind).length} |`);

/** Worst songs first: most failing checks across the song's four levels, then the most dead air. */
const worst = COMPACT_SCORES.map((raw) => {
  const levels = songMetrics.filter((row) => row.id === raw.id);
  const beginner = levels.find((row) => row.level === 'Beginner');
  return {
    id: raw.id,
    failed: levels.reduce((sum, row) => sum + row.failures, 0),
    beginner,
    deadBeats: beginner ? beginner.entryBeats + beginner.tailBeats + beginner.liveGapBeats : 0,
  };
}).sort((a, b) => (b.failed - a.failed) || (b.deadBeats - a.deadBeats));

const worstTable = worst.slice(0, 20).filter((song) => song.beginner).map((song) => {
  const b = song.beginner!;
  return `| ${song.id} | ${song.failed} | ${fixed(b.entryBeats)} | ${fixed(b.tailBeats)} | ${fixed(b.liveGapBeats)} `
    + `| ${fixed(b.fill * 100, 0)} | ${fixed(b.openShare * 100, 0)} | ${b.distinctPitches} | ${b.pitchClasses} `
    + `| ${b.accidentals} | ${b.rootFifth === null ? '—' : fixed(b.rootFifth * 100, 0)} |`;
});

const mislabelled = songRows.filter((row) => row.level === 'Beginner' && row.difficultyMislabelled !== '');
const suspectMeters = songRows.filter((row) => row.level === 'Beginner' && row.meterSuspect === 'yes');
const keyConfidences = songRows.filter((row) => row.level === 'Beginner').map((row) => Number(row.keyConfidence));
const keyDisagreements = songRows.filter((row) => row.level === 'Beginner' && row.keyAgrees === 'no').length;
const keyUndetermined = songRows.filter((row) => row.level === 'Beginner' && row.keyDetermined === 'no').length;
const notDiscriminating = count('Beginner', (row) => row.discriminating === false);
const beaten = count('Beginner', (row) =>
  row.discriminating === false && row.nullBest !== null && row.rootFifth !== null
  && row.nullBest > row.rootFifth);

const text = `# Cello arrangement audit

| | |
|---|---|
| Measured | ${provenance.measuredAt} |
| Songs × levels | ${provenance.songs} × ${ARRANGEMENT_LEVELS.length} = ${provenance.parts} parts, plus ${CORE_SCORES.length} authored studies |
| \`src/scores/bundledSongs.json\` | md5 \`${provenance.library}\` |
| \`src/domain/arrangement.ts\` | md5 \`${provenance.arranger}\` |
| \`tools/audit-arrangements.ts\` | md5 \`${provenance.gate}\` |

Reproduce with \`npm run audit:arrangements\`. **The three md5s above are part of
the result**: the library and the arranger move under this tool, and a failure
count that cannot be pinned to a population is not a measurement.

Checks come in four classes, and the class is printed with every failure:

| Class | What its thresholds are | Failures |
|---|---|---:|
| **doctrine** | measured from published beginner cello material — \`.scratch/gauntlet/reference/DOCTRINE.md\`, quoting the ABRSM 2024 cello syllabus and the note data of eight published arrangements. Each carries its section. | ${failures.filter((f) => f.kind === 'doctrine').length} |
| **game** | this app's own rules. DOCTRINE.md says outright that *"coverage/silence is not addressed by any source here"*, so these are not standards and are not dressed as any. Published data points bracket them where they exist. | ${failures.filter((f) => f.kind === 'game').length} |
| **profile** | \`ARRANGEMENT_PROFILES[level]\` — the configuration the arranger used to build the thing being measured. Self-consistency, not a standard; kept because a bug there is worth catching. | ${failures.filter((f) => f.kind === 'profile').length} |
| **integrity** | the data must describe itself: schema, ids, open strings fingered open, held notes actually sounded, and a harmony metric that a wrong answer cannot beat. | ${failures.filter((f) => f.kind === 'integrity').length} |

## Doctrine gate — is it written the way published beginner cello parts are written?

Median / worst across the ${provenance.songs} songs. Published bounds, from DOCTRINE.md:
top note ≤ D4 (G4 at Grade 4), bottom ≥ C2, max leap 9 st at "Beginners" and
12–16 with experience, under 4% of intervals over a perfect 5th, 27–40%
open-string pitches (up to ~80% for a drone), 5–6 distinct pitches in a
drone/bass part, 7 pitch classes in one key.

**Which bound applies to which level, and why.** DOCTRINE.md §6 is headed *"for
a Beginner line"*, so the bounds it measured from published arrangements —
open-string share, distinct pitches, accidentals, pitch classes, the >P5 share,
extensions and the sustain ceiling — are **gated at Beginner only** and merely
reported above it. The bounds ABRSM publishes *per grade* are gated per level on
this stated mapping: Beginner = Grade 1, Intermediate = Grade 2, Advanced =
Grade 3, Expert = Grade 4. That is range (\`G–d′\`, \`C–d′\`, \`C–d′\`, \`C–g′\`), the
note-value floor (paired quavers to Grade 2, semiquavers from Grade 3) and the
leap ceiling (9 st at "Beginners", 12–16 at "Beginners with some playing
experience"). Attack the mapping if you disagree with it — it is stated here so
it can be attacked, rather than left implicit in a threshold.

| Level | Parts | Top note | Bottom note | Max leap | > P5 % | Open string % | Below open G % | Stopped below G | Distinct pitches | Pitch classes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${physical.join('\n')}

## Game gate — is there anything to play?

No syllabus covers coverage. Entry, tail and gap are in **quarter-beats**, not
bars: ${suspectMeters.length} songs store a bar shorter than four beats (seven of them the
degenerate \`1/4\` the build emits when meter detection fails), so a
bar-denominated budget silently converts a meter-detection bug into a musical
verdict. \`meter\` and \`barBeats\` stay in the CSV for reference.

| Level | Entry (beats) | Tail (beats) | Live gap (beats) | Fill % | Attacks / 4 beats | Longest note (beats) | Repeated pitch % | Root+5th % | Root % | Doubles the bass % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${musical.join('\n')}

For scale: the published beginner drone part measured in DOCTRINE.md §3 plays
**${DOCTRINE.droneAttacksPer4Beats} attacks per bar of 4/4**, holds **nothing longer than a crotchet**, and
repeats the same pitch on **~${DOCTRINE.droneRepeatedShare * 100}%** of adjacent pairs.

## Failures by check

| Check | Class | Threshold and source | ${ARRANGEMENT_LEVELS.join(' | ')} | Total |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
${byCheck.length ? byCheck.join('\n') : '| — | — | — | 0 | 0 | 0 | 0 | 0 |'}

| Class | Failures |
| --- | ---: |
${byKind.join('\n')}

## Worst 20 songs (Beginner numbers)

| Song | Failed | Entry beats | Tail beats | Live gap beats | Fill % | Open % | Pitches | PCs | Accidentals | Root+5th % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${worstTable.join('\n')}

## What this gate does not claim

- **Key.** Every in-key number is measured against the key the score itself
  claims (\`metadata.keySignature\`), because that is the label the app parses —
  \`generateAccompaniment\` drones on it and the fingerboard overlay draws its
  scale. It is *also* \`detectKey\` output, and the detector is not confident:
  median confidence ${fixed(median(keyConfidences), 2)} across the ${provenance.songs} songs, ${keyUndetermined} of them below the
  ${KEY_CONFIDENCE_FLOOR} floor at which this report will call a key determined, and ${keyDisagreements} songs where
  the key detected from the whole texture disagrees with the stored label. So the
  \`accidentals\` check is a **self-consistency** test — the line against its own
  declared key — not a musicological verdict, and \`accidentalsEitherMode\`
  reports how much of it survives a major/minor flip. The detected-key share
  (\`inKeyDetectedPct\`) is reported next to \`keyConfidence\` and **is not gated**.
- **Root agreement** is a triad fit over the sounding backing with **no
  lowest-note bonus** — that bonus made "the chord root" mean "the bass note",
  and since the accompaniment levels are derived from the source bass, the
  check then confirmed itself. \`bassDoublingPct\` reports how much of the
  agreement is plain bass doubling. Because "root or fifth" is invariant under
  transposing a line by a fifth, every Beginner line is also scored at +1, +5
  and +7 semitones; ${notDiscriminating} songs fail \`root validity\` because a wrong line
  scores as well as the right one (${beaten} of them are beaten outright, the rest
  matched), and their percentage means nothing. \`rootNullBestPct\` records the
  best score a wrong line reached, so the guard is auditable from the CSV.
- **Silence** has no published bar at all. The entry budget is bracketed by
  published opening rests of 0, 12, 24 and 40 quarter-beats; the ${GAME.entryMs / 1000}-second cap
  is an app-UX rule and is labelled as one. The tail budget has no published
  datum whatsoever and only mirrors the entry.
- **\`difficultyMislabelled\` is empty for all ${provenance.songs} songs and that proves
  nothing yet**: \`tools/build-library.ts\` writes the \`difficulty\` field *from*
  \`difficultyOf()\`, so the comparison is tautological until someone hand-edits
  a tier or changes the weights. ${mislabelled.length} songs currently disagree.
- **Doctrine's own gaps**, quoted: no first-hand Suzuki or Mooney notation, no
  Trinity data, and no published rule for coverage. Where §6 #2 sets a G2 floor
  for a Grade-1 melody, §3's measured published *bass* part runs D2–B2 with
  stopped notes across the C string — two published sources, opposite answers.
  So the hard floor is gated at the instrument (C2), \`stopped below open G\` is
  gated only for a Beginner line in a *melody* role, and both shares are
  reported per level rather than failed. The beginner engine is coding to the
  stricter reading (no stopped note below the open G, open C allowed); this gate
  will not claim a source says so for a bass part, because §3 says otherwise.
- These are automated source, geometry, timing and harmony checks. Nobody has
  played every piece.

Every song/level's numbers are in [the CSV](cello-arrangement-audit.csv).

Audit failures: ${failures.length}.
${failures.length ? '\n' + failures.slice(0, 40).map((failure) => `- [${failure.kind}/${failure.check}] ${failure.message}`).join('\n') : ''}
`;
writeFileSync('docs/cello-arrangement-audit.md', text);
console.log(text);
if (failures.length) process.exitCode = 1;
