/**
 * Scale drills, graded by what the library actually asks for.
 *
 * Written for this app, in the same shape as `studies.ts`: an `Event` names
 * only the decisions a musician makes, and `buildScore` derives the rest so a
 * drill cannot disagree with the instrument.
 *
 * ## Where the notes come from
 *
 * Two sources, and only two.
 *
 * **The library decides which keys.** `src/domain/keyCensus.ts` counts the keys
 * of the bundled songs; a key that carries a twentieth of the library earns
 * three graded drills, a key that carries a fiftieth earns one, and a key the
 * library touches twice earns none. The counts are measured at runtime — the
 * drills are authored per key, and the census decides their order and billing.
 *
 * **The cello decides what is playable.** Every pitch is seated by
 * `firstPositionFingering`, the same fixed mapping the whole bundled library is
 * written against, so the string, finger, position and extension on every note
 * here are the ones the rest of the app would choose. The ranges are then
 * *derived* from that mapping rather than written down: the beginner drill takes
 * the lowest octave of the key that needs no hand move at all, and falls back to
 * a fifth when the key has no such octave. Change the mapping and the drills
 * follow it; they cannot drift into asking for a note nobody can reach.
 *
 * ## Where the shapes come from
 *
 * ABRSM's *Bowed Strings Practical Grades Syllabus from 2024*, cello pages.
 * See `.scratch/gauntlet/reference/SCALES.md` for the requirement tables
 * verbatim. The parts used here:
 *
 * - **Rhythm** is "even notes or long tonic" — even crotchets with the tonic
 *   held at each end.
 * - **Range** is "from the lowest possible tonic/starting note", and Initial
 *   Grade's A minor is "a 5th", which is why a five-note drill is a published
 *   requirement here and not a shortcut.
 * - **Speeds** are the cello table on p. 20: scales ♩ = 44 at Grade 1, 50 at
 *   Grade 2, 54 at Grade 3; arpeggios ♪ = 100 at Grade 2. Every tempo below is
 *   one of those numbers.
 * - **Bowing** is "separate bows or slurred (2 quavers to a bow)", so the
 *   beginner drills play the scale twice: separately, then two to a bow.
 * - The three keys Suzuki Cello School Vol. 1 lives in — D, G and C major — are
 *   exactly the three whose tonic is an open string and whose octave needs no
 *   hand move. That is not a coincidence and the drills are ordered to reflect it.
 */

import {
  CelloString, OPEN_STRING_MIDI, midiToPitchName, BackingPart, BackingTrack,
  firstPositionFingering, KeyMode, PitchClass, DRILLS_EARNED, canonicalKeyName, fifthsOf,
  keyDemand, openStringTonic, CelloSongScore, DifficultyTier, toPitchClass,
} from '@domain';
import { Event, buildScore } from './build';
import { LIBRARY_KEY_CENSUS } from './keyCensus';

const ORIGINAL = 'Original study written for this app — free to copy and change.';

// ─── The fingerboard, as first position sees it ──────────────────────────────

/** Lowest and highest pitch `firstPositionFingering` will seat. C2 – D♯4. */
const LOWEST = 36;
const HIGHEST = 63;

/**
 * How much a note asks of the hand, beyond simply putting a finger down.
 *
 * `0` is the closed frame — the four tapes, nothing to reach for. `1` is half
 * position, the first finger drawn back a semitone. `2` is a forward extension,
 * the fourth finger reaching a semitone past the frame. Read off the seat
 * `firstPositionFingering` chooses rather than guessed from the pitch, so it
 * stays true if that mapping ever moves.
 */
function handLoad(midi: number): 0 | 1 | 2 {
  const seat = firstPositionFingering(midi);
  if (seat.extension !== 'none') return 2;
  if (seat.position !== '1st') return 1;
  return 0;
}

function isClosed(midis: readonly number[]): boolean {
  return midis.every((m) => handLoad(m) === 0);
}

function inRange(midis: readonly number[]): boolean {
  return midis.every((m) => m >= LOWEST && m <= HIGHEST);
}

/** Notes needing a forward extension, in the order they appear. */
function extensionsIn(midis: readonly number[]): number[] {
  return [...new Set(midis.filter((m) => handLoad(m) === 2))];
}

/** Notes needing the hand back in half position. */
function halfPositionsIn(midis: readonly number[]): number[] {
  return [...new Set(midis.filter((m) => handLoad(m) === 1))];
}

function openStringsIn(midis: readonly number[]): CelloString[] {
  const strings = new Set<CelloString>();
  for (const midi of midis) {
    const seat = firstPositionFingering(midi);
    if (seat.finger === '0') strings.add(seat.string);
  }
  const lowToHigh: CelloString[] = ['C', 'G', 'D', 'A'];
  return lowToHigh.filter((s) => strings.has(s));
}

/**
 * Authored tier, from what the hand has to do.
 *
 * `difficultyOf` measures a solved line and is the right tool for a piece of
 * music; on a slow scale it reports Beginner for everything, because a scale is
 * slow, stays in one position and crosses strings in order. For a *drill* the
 * honest signal is the hand frame: a closed-frame scale is a beginner's scale,
 * a scale that pulls the hand back is the next step, and a scale that needs two
 * reaches is not a beginner's scale however slowly it is played.
 *
 * A forward extension counts double a half position, because the fourth finger
 * reaching a semitone past the frame is a harder thing to ask of a beginner
 * than the first finger coming back a semitone — the reach is away from the
 * hand's own weight. Distinct pitches, not note events, so a scale is not
 * penalised for running back down.
 *
 * Needing *both* a reach and a draw-back costs an extra point on top, because
 * shuffling the hand between half position and an extension inside one scale is
 * a different order of problem from doing either one of them repeatedly.
 *
 * Checked against the syllabus at both ends. Beginner: F major (load 0), which
 * ABRSM asks for at Grade 2. Intermediate: B♭ major (two draw-backs, load 2,
 * Grade 2) and A major (two reaches, load 4, Grade 3). Advanced: F minor (one
 * reach, two draw-backs, load 5) and E major (load 7), neither of which the
 * syllabus asks for below Grade 5.
 */
function frameTier(midis: readonly number[]): DifficultyTier {
  const reaches = extensionsIn(midis).length;
  const drawBacks = halfPositionsIn(midis).length;
  const both = reaches > 0 && drawBacks > 0 ? 1 : 0;
  const load = reaches * 2 + drawBacks + both;
  if (load === 0) return 'Beginner';
  return load <= 4 ? 'Intermediate' : 'Advanced';
}

const TIER_ORDER: DifficultyTier[] = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];

function atLeast(tier: DifficultyTier, floor: DifficultyTier): DifficultyTier {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(floor) ? tier : floor;
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * A pitch at its one first-position seat.
 *
 * The whole point of routing every note through `firstPositionFingering` is
 * that the drills and the 258 bundled songs agree, note for note, about where
 * a pitch lives — so a player who learns D major here finds the same fingers
 * waiting in every song in D.
 */
function at(midi: number, beats: number, extra: Partial<Event> = {}): Event {
  const seat = firstPositionFingering(midi);
  return {
    s: seat.string,
    n: midi - OPEN_STRING_MIDI[seat.string],
    f: seat.finger,
    b: beats,
    pos: seat.position,
    ext: seat.extension,
    ...extra,
  };
}

/**
 * A run of pitches as even notes with the last one held.
 *
 * `finalBeats` is chosen by the caller so the run fills whole bars — a bar that
 * does not add up is a `buildScore` throw, which is the right place for that
 * mistake to surface.
 */
function evenNotes(midis: readonly number[], finalBeats: number, beats = 1): Event[] {
  return midis.map((midi, i) => at(
    midi,
    i === midis.length - 1 ? finalBeats : beats,
    i === midis.length - 1 ? { art: 'tenuto' } : {},
  ));
}

/** Down, up, down, up — the separate-bow détaché a scale is first learned with. */
function separateBows(events: Event[]): Event[] {
  return events.map((e, i) => ({ ...e, bow: i % 2 === 0 ? 'down' as const : 'up' as const }));
}

/**
 * Two notes to a bow: ABRSM's slurring alternative for every graded scale.
 *
 * The held final tonic gets its own bow rather than being dragged into the last
 * pair, because that is how the last bow of a scale is actually taken.
 */
function slurredPairs(events: Event[]): Event[] {
  const last = events.length - 1;
  return events.map((e, i) => {
    if (i === last) return { ...e, bow: 'down' as const, art: e.art ?? 'tenuto' };
    return {
      ...e,
      art: 'slur' as const,
      bow: Math.floor(i / 2) % 2 === 0 ? 'down' as const : 'up' as const,
    };
  });
}

/**
 * Cuts a flat run into 4/4 bars.
 *
 * Throws on a note that would straddle a bar line. Nothing below produces one —
 * the long tonics are sized to land on or inside a bar — and a loud failure is
 * better than a drill whose playhead drifts.
 */
function intoBars(events: readonly Event[], beatsPerBar = 4): Event[][] {
  const bars: Event[][] = [];
  let bar: Event[] = [];
  let filled = 0;
  for (const event of events) {
    if (filled + event.b > beatsPerBar + 1e-9) {
      throw new Error(`scale drill: a ${event.b}-beat note crosses a bar line at beat ${filled}`);
    }
    bar.push(event);
    filled += event.b;
    if (Math.abs(filled - beatsPerBar) < 1e-9) { bars.push(bar); bar = []; filled = 0; }
  }
  if (bar.length > 0) throw new Error(`scale drill: ${filled} beats left over after the last bar`);
  return bars;
}

/** Beats to hold the final note so a run of `n` crotchets fills whole bars. */
function finalHold(n: number, beatsPerBar = 4): number {
  const before = n - 1;
  const remainder = before % beatsPerBar;
  return remainder === 0 ? beatsPerBar : beatsPerBar - remainder;
}

// ─── Scale shapes ────────────────────────────────────────────────────────────

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
/** Natural minor with the seventh raised — the dominant gets a leading note. */
const HARMONIC_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 11];

function stepsFor(mode: KeyMode): number[] {
  return mode === 'major' ? MAJOR_STEPS : NATURAL_MINOR_STEPS;
}

/** One octave, tonic to tonic: 8 notes. */
function octaveUp(tonic: number, steps: readonly number[]): number[] {
  return [...steps.map((s) => tonic + s), tonic + 12];
}

/** Up and back down, 15 notes, the top note sounded once. */
function upAndDown(ascending: readonly number[]): number[] {
  return [...ascending, ...[...ascending].slice(0, -1).reverse()];
}

/** The first five degrees — ABRSM Initial Grade's "a 5th". */
function fifthUp(tonic: number, steps: readonly number[]): number[] {
  return steps.slice(0, 5).map((s) => tonic + s);
}

/**
 * Every note of the key from its lowest first-position tonic up to the top of
 * first position.
 *
 * Anchored on the tonic rather than on the lowest note of the key that happens
 * to fall inside first position, because a run that opens on the leading note
 * is not a scale — D major's lowest first-position note is C♯2, and starting
 * there tells the player nothing about D major. Starting and ending on the
 * tonic and reaching as high as the hand goes is a two-octave scale in the keys
 * that have two octaves down here and an honest partial one in the keys that do
 * not.
 */
function firstPositionSpan(tonic: PitchClass, mode: KeyMode, from: number): number[] {
  const pitchClasses = new Set(stepsFor(mode).map((s) => (tonic + s) % 12));
  const span: number[] = [];
  for (let midi = from; midi <= HIGHEST; midi++) {
    if (pitchClasses.has(midi % 12)) span.push(midi);
  }
  return span;
}

/**
 * Broken thirds: 1–3, 2–4, 3–5 … up, then back down.
 *
 * ABRSM's own "scale in broken thirds" pattern (a Grade 6 requirement on the
 * cello). Taken slowly it is the cheapest way to find out whether a hand frame
 * is really solid, because the fingers stop arriving in order.
 */
function brokenThirds(tonic: number, steps: readonly number[]): number[] {
  const degrees = octaveUp(tonic, steps);
  const up: number[] = [];
  for (let i = 0; i + 2 < degrees.length; i++) {
    up.push(degrees[i] as number, degrees[i + 2] as number);
  }
  const down: number[] = [];
  for (let i = degrees.length - 1; i - 2 >= 0; i--) {
    down.push(degrees[i] as number, degrees[i - 2] as number);
  }
  return [...up, ...down];
}

/** Root-position tonic triad over `octaves`, up and down. */
function arpeggio(tonic: number, mode: KeyMode, octaves: 1 | 2): number[] {
  const third = mode === 'major' ? 4 : 3;
  const up: number[] = [];
  for (let o = 0; o < octaves; o++) {
    up.push(tonic + 12 * o, tonic + 12 * o + third, tonic + 12 * o + 7);
  }
  up.push(tonic + 12 * octaves);
  return upAndDown(up);
}

// ─── Which range each drill takes ────────────────────────────────────────────

function tonicsInRange(tonic: PitchClass): number[] {
  const out: number[] = [];
  for (let midi = LOWEST; midi <= HIGHEST; midi++) if (midi % 12 === tonic) out.push(midi);
  return out;
}

interface Ranges {
  /** Lowest tonic whose whole octave fits in first position. */
  octaveFrom: number;
  /** Lowest tonic whose octave needs no hand move at all, if any. */
  closedOctaveFrom: number | null;
  /** Lowest tonic whose first five degrees need no hand move, if any. */
  closedFifthFrom: number | null;
  /**
   * Lowest tonic with two whole octaves in first position and nothing to reach
   * for, if any.
   *
   * The no-extension condition is what makes this useful rather than merely
   * true. Two octaves of D major fit inside first position, but only with F♯2
   * and C♯3 both stretched — and ABRSM duly leaves D major's two octaves until
   * Grade 3 while asking for C major's from Grade 1. Requiring a closed or
   * half-position hand throughout lands on exactly **C major and D minor**, the
   * two keys whose two-octave scales the syllabus asks for early, which is a
   * derived agreement rather than a coincidence.
   */
  twoOctaveFrom: number | null;
  /** Where the broken thirds run from: the closed octave if there is one. */
  thirdsFrom: number;
  span: number[];
}

function rangesFor(tonic: PitchClass, mode: KeyMode): Ranges {
  const steps = stepsFor(mode);
  const tonics = tonicsInRange(tonic);

  const octaves = tonics.filter((t) => inRange(octaveUp(t, steps)));
  const octaveFrom = octaves[0];
  if (octaveFrom === undefined) {
    throw new Error(`no first-position octave of ${canonicalKeyName({ tonic, mode })}`);
  }

  const closedOctaveFrom = octaves.find((t) => isClosed(octaveUp(t, steps))) ?? null;
  const closedFifthFrom = tonics.find(
    (t) => inRange(fifthUp(t, steps)) && isClosed(fifthUp(t, steps)),
  ) ?? null;
  const twoOctaveFrom = tonics.find((t) => {
    const both = [...octaveUp(t, steps), ...octaveUp(t + 12, steps)];
    return inRange(both) && extensionsIn(both).length === 0;
  }) ?? null;

  return {
    octaveFrom,
    closedOctaveFrom,
    closedFifthFrom,
    twoOctaveFrom,
    thirdsFrom: closedOctaveFrom ?? octaveFrom,
    span: firstPositionSpan(tonic, mode, octaveFrom),
  };
}

// ─── Prose ───────────────────────────────────────────────────────────────────

function noteName(midi: number, preferFlats: boolean): string {
  return midiToPitchName(midi, preferFlats).replace('#', '♯').replace('b', '♭');
}

/**
 * Does this key want flats?
 *
 * From the key signature, not from the spelling of the tonic. The obvious test
 * — "does the name contain a ♭" — is wrong for exactly the keys a beginner
 * cellist meets first: F major, D minor and G minor all have flat signatures
 * and plain-letter tonics, and under that test F major's own fourth degree came
 * out spelled **A♯**. `fifthsOf` is negative for every flat key and zero or
 * positive for the rest, which is the question actually being asked.
 */
function wantsFlats(tonic: PitchClass, mode: KeyMode): boolean {
  return fifthsOf({ tonic, mode }) < 0;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What this run asks of the left hand, in words, derived from the notes.
 *
 * Generated rather than written so it cannot flatter the drill: if a range
 * needs two reaches, the sentence says two reaches, whatever the prose above it
 * claims.
 */
function handReport(midis: readonly number[], preferFlats: boolean): string {
  const opens = openStringsIn(midis);
  const extensions = extensionsIn(midis);
  const halves = halfPositionsIn(midis);

  const parts: string[] = [];
  if (opens.length === 1) {
    parts.push(`The open ${opens[0]} string belongs to the key and is used.`);
  } else if (opens.length === 2) {
    parts.push(`Open ${list(opens)} both belong to the key and are used.`);
  } else if (opens.length > 2) {
    parts.push(`Open ${list(opens)} all belong to the key and are used.`);
  }
  if (extensions.length === 0 && halves.length === 0) {
    parts.push('Nothing leaves the closed hand — four fingers, four tapes, no reaching.');
  }
  if (halves.length > 0) {
    const names = halves.map((m) => `${noteName(m, preferFlats)} on the ${firstPositionFingering(m).string} string`);
    parts.push(halves.length === 1
      ? `${names[0]} asks the first finger back a semitone into half position.`
      : `${list(names)} ask the first finger back a semitone into half position.`);
  }
  if (extensions.length > 0) {
    const names = extensions.map((m) => `${noteName(m, preferFlats)} on the ${firstPositionFingering(m).string} string`);
    parts.push(extensions.length === 1
      ? `${names[0]} needs the fourth finger to reach a semitone forward.`
      : `${list(names)} each need the fourth finger to reach a semitone forward.`);
  }
  return parts.join(' ');
}

/**
 * One sentence per key about what the key *is* on a cello.
 *
 * Hand-written, because this is the part no derivation can supply: which
 * graded syllabus asks for it, which method book lives in it, and why the
 * instrument likes or dislikes it.
 */
export const KEY_NOTES: Record<string, string> = {
  'E minor': 'Three of the four open strings belong to E minor, which is why the library reaches for it more than any other key. Only F♯ at the bottom of the C string falls outside the closed hand.',
  'D minor': 'D minor lies across the strings with open D and open A both in the key. ABRSM asks for it "starting on open strings" at Grade 2 — from D3 — and across two octaves at Grade 3. This drill starts a seventh lower, at D2 under the first finger on the C string, because that octave is the one that needs no hand move at all; the version from the open D needs the first finger drawn back for B♭, which is in the next drill.',
  'C major': 'The one two-octave scale on the cello that never leaves the closed hand: C2 to C4, four fingers on each of the four strings in turn. ABRSM asks for two octaves of it from Grade 1 for exactly that reason.',
  'A minor': 'A minor is C major’s relative and it lies just as flat — every note of it in first position is a closed-frame note. It is ABRSM’s first minor scale, and at Initial Grade only a fifth of it is asked for.',
  'D major': 'The key Suzuki Cello School Vol. 1 is built on, and the one ABRSM asks for at Initial Grade "starting on open strings". Open D to open A and up to D again: 0 1 3 4 twice, the same shape on two neighbouring strings.',
  'G major': 'Open G to the fourth finger on the D string — the other half of the Suzuki Vol. 1 world, and the same 0 1 3 4 shape as D major one string lower. ABRSM asks for it at Initial Grade alongside D.',
  'B minor': 'Everything in B minor is open-hand except C♯, which has no closed seat on the G string, so the octave from B2 asks the fourth finger forward once.',
  'A major': 'Both C♯ and G♯ need a forward extension in the octave from A2, which is why ABRSM leaves A major until Grade 3 while G and D arrive at Initial. The tonic is still the open A string.',
  'G minor': 'G minor starts on the open G string, and its E♭ is the first note most beginners meet that asks the first finger back a semitone. ABRSM asks for it at Grade 2, "starting on open strings".',
  'D♯ minor': 'Spelled D♯ minor because that is how the library’s songs are spelled; a cellist would read it as E♭ minor. Either way its A♭/G♯ has nowhere closed to sit in first position.',
  'F♯ minor': 'F♯ minor’s tonic is itself a reach — F♯ at the bottom of the C string is a forward extension — and C♯ is another. A key to read carefully rather than to drill fast.',
  'E major': 'E major is a guitarist’s key, which is where the library’s E major songs come from. On a cello in first position both G♯ and D♯ fall outside the closed hand.',
  'C♯ minor': 'Four sharps, and both G♯ and C♯ sit off the closed frame down here.',
  'C minor': 'C minor starts on the open C string and its first five notes are closed-frame; A♭ above them is the note that moves the hand. ABRSM asks for C minor at Grade 3.',
  'E♭ major': 'Three flats, and two of them ask the first finger back into half position. The tonic sits under the second finger on the C string.',
  'B♭ major': 'The first flat key most cellists meet after F: B♭ under the second finger on the G string, then the first finger drawn back for E♭ and again for B♭ on the A string. ABRSM asks for it at Grade 2.',
  'D♭ major': 'Five flats. In first position D♭ major has no closed-frame octave at all — A♭ and D♭ both move the hand — so this is a reading drill, not a speed drill.',
  'B major': 'Five sharps, and G♯ has no closed seat anywhere in first position.',
  'F minor': 'Four flats, and A♭ and D♭ both pull the hand out of the closed frame.',
  'F major': 'F major is the last key that lies completely flat under the closed hand: the fourth finger on the C string for F2, then open G and open D on the way up. ABRSM asks for it at Grade 2.',
  'B♭ minor': 'Five flats, and A♭ and D♭ both fall outside the closed hand. Along with F♯ major it is the key this instrument likes least down here.',
  'F♯ major': 'Six sharps. The tonic itself is a forward extension at the bottom of the C string, and G♯ has nowhere closed to sit — the least cello-shaped key there is in first position.',
  'G♯ minor': 'Five sharps and the same problem as its relative B major: G♯ itself has no closed-frame seat in first position, so the tonic of the key is a hand move before a note is played.',
  'A♭ major': 'A♭ is the one pitch class with no closed-frame seat anywhere in first position — it exists as half position on the G string or a forward extension on the D string, and nowhere else. Its own scale therefore cannot be a beginner’s scale on this instrument, and saying so is more use than pretending.',
};

// ─── Drill construction ──────────────────────────────────────────────────────

export interface ScaleDrillKey {
  tonic: PitchClass;
  mode: KeyMode;
  /** Canonical key label, e.g. `"B♭ major"`. */
  key: string;
  /** 1, 2 or 3 — how far through the key's progression this drill is. */
  step: number;
}

/** Which key each drill belongs to, so the UI can join a drill to the census. */
export const SCALE_DRILL_KEYS: Record<string, ScaleDrillKey> = {};

const KEY_SLUG_PART: Record<string, string> = { '♯': '-sharp', '♭': '-flat' };

function slug(key: string): string {
  return key
    .replace(/[♯♭]/g, (c) => KEY_SLUG_PART[c] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleKey(key: string): string {
  return key.replace(/\bmajor\b/, 'Major').replace(/\bminor\b/, 'Minor');
}

interface DrillInput {
  tonic: PitchClass;
  mode: KeyMode;
  step: number;
  title: string;
  origin: string;
  bpm: number;
  difficulty: DifficultyTier;
  teaches: string;
  preferFlats: boolean;
  bars: Event[][];
}

/** "F#4" → "F#": the pitch name without its octave number. */
function withoutOctave(pitchName: string): string {
  let end = pitchName.length;
  while (end > 0 && pitchName[end - 1]! >= '0' && pitchName[end - 1]! <= '9') end--;
  return pitchName.slice(0, end);
}

function makeDrill(input: DrillInput): CelloSongScore {
  const key = canonicalKeyName({ tonic: input.tonic, mode: input.mode });
  const id = `scale-${slug(key)}-${input.step}`;
  const tonicLetter = withoutOctave(noteName(input.tonic + 60, input.preferFlats));

  SCALE_DRILL_KEYS[id] = { tonic: input.tonic, mode: input.mode, key, step: input.step };

  return buildScore({
    id,
    timeSignature: [4, 4],
    metadata: {
      title: input.title,
      composer: 'Scale study',
      origin: input.origin,
      keySignature: key.toUpperCase(),
      timeSignature: '4/4',
      bpm: input.bpm,
      difficulty: input.difficulty,
      tonic: tonicLetter,
      teaches: input.teaches,
      preferFlats: input.preferFlats,
      rights: ORIGINAL,
    },
    bars: input.bars,
  });
}

/**
 * Drill 1 — one octave, or a fifth where the key has no closed octave.
 *
 * Played twice: separate bows, then two notes to a bow. Both are on ABRSM's
 * list of acceptable bowings for every graded scale, and a beginner who has
 * only ever played a scale détaché discovers on the slurred repeat that their
 * left hand was being carried by the bow change.
 */
function drillOne(entry: KeyEntry): CelloSongScore {
  const { tonic, mode, preferFlats } = entry;
  const steps = stepsFor(mode);
  const ranges = rangesFor(tonic, mode);
  const key = canonicalKeyName({ tonic, mode });
  const openString = openStringTonic(tonic);

  const useFifth = ranges.closedOctaveFrom === null && ranges.closedFifthFrom !== null;
  const from = useFifth
    ? ranges.closedFifthFrom as number
    : ranges.closedOctaveFrom ?? ranges.octaveFrom;

  const ascending = useFifth ? fifthUp(from, steps) : octaveUp(from, steps);
  const run = upAndDown(ascending);
  const hold = finalHold(run.length);
  const notes = evenNotes(run, hold);

  const low = noteName(from, preferFlats);
  const high = noteName(ascending[ascending.length - 1] as number, preferFlats);
  const octaveTop = noteName(ranges.octaveFrom + 12, preferFlats);
  const octaveBottom = noteName(ranges.octaveFrom, preferFlats);

  // Where the closed hand cannot reach a whole octave, the drill says which
  // notes are missing rather than quietly claiming a beginner's scale.
  const shortfall = handReport(
    octaveUp(ranges.octaveFrom, steps).filter((m) => handLoad(m) !== 0),
    preferFlats,
  );
  const wholeOctaveWords = entry.steps > 1
    ? 'The whole octave is the next drill.'
    : `The whole octave from ${octaveBottom} to ${octaveTop} is not a closed-hand scale: ${shortfall}`;
  const handMovesWords = ranges.closedOctaveFrom === null
    ? ` There is no octave of ${key} the closed hand can play in first position, so this is written with the hand moves it needs rather than pretending otherwise.`
    : '';
  const rangeWords = useFifth
    ? `The first five notes only, ${low} up to ${high} and back. ABRSM’s Initial Grade asks for A minor exactly this way — "a 5th", not an octave — so a part-scale is a published requirement here, not a shortcut. ${wholeOctaveWords}`
    : `One octave up and down, ${low} to ${high}, even crotchets with the tonic held at each end — the rhythm ABRSM specifies for every graded scale.${handMovesWords}`;
  const tonicWords = openString
    ? ` The tonic is the open ${openString} string: sound it, then find it again with your finger and listen for the two to agree.`
    : '';

  return makeDrill({
    tonic,
    mode,
    step: 1,
    title: `${titleKey(key)}, ${useFifth ? 'a Fifth' : 'One Octave'}`,
    origin: `SCALE · ${useFifth ? 'A FIFTH' : 'ONE OCTAVE'} · ${frameWords(run)}`,
    bpm: useFifth ? 38 : 44,
    difficulty: frameTier(run),
    teaches: `${KEY_NOTES[key] ?? ''} ${rangeWords}${tonicWords} ${handReport(run, preferFlats)} Bars 1–${(notes.length + hold - 1) / 4} separately, then the same scale two notes to a bow.`.trim(),
    preferFlats,
    bars: [...intoBars(separateBows(notes)), ...intoBars(slurredPairs(notes))],
  });
}

function frameWords(midis: readonly number[]): string {
  const extensions = extensionsIn(midis).length;
  const halves = halfPositionsIn(midis).length;
  if (extensions === 0 && halves === 0) return 'CLOSED HAND';
  if (extensions === 0) return 'HALF POSITION';
  if (halves === 0) return extensions === 1 ? 'ONE EXTENSION' : 'FORWARD EXTENSIONS';
  return 'HALF POSITION AND EXTENSIONS';
}

/**
 * Drill 2 — the whole key across all four strings, then the tonic triad.
 *
 * Two octaves where the key has two in first position (C major and D minor do,
 * which is why ABRSM asks for exactly those two octaves early); otherwise every
 * note of the key first position can reach, bottom of the C string to top of
 * the A string. The arpeggio runs in quavers, so at ♩ = 50 it arrives at
 * ♪ = 100 — ABRSM's Grade 2 arpeggio speed.
 */
function drillTwo(entry: KeyEntry): CelloSongScore {
  const { tonic, mode, preferFlats } = entry;
  const steps = stepsFor(mode);
  const ranges = rangesFor(tonic, mode);
  const key = canonicalKeyName({ tonic, mode });

  const twoOctaves = ranges.twoOctaveFrom !== null;
  const from = ranges.twoOctaveFrom ?? ranges.octaveFrom;
  const ascending = twoOctaves
    ? [...octaveUp(from, steps).slice(0, -1), ...octaveUp(from + 12, steps)]
    : ranges.span;
  const run = upAndDown(ascending);
  const scaleNotes = evenNotes(run, finalHold(run.length));

  const arpeggioOctaves: 1 | 2 = twoOctaves ? 2 : 1;
  const arpeggioNotes = arpeggio(from, mode, arpeggioOctaves);
  // Quavers, with the last note filling out its bar.
  const arpeggioEvents = arpeggioNotes.map((midi, i) => {
    const last = i === arpeggioNotes.length - 1;
    return last ? at(midi, arpeggioOctaves, { art: 'tenuto' }) : at(midi, 0.5, {});
  });

  const all = [...run, ...arpeggioNotes];
  const low = noteName(ascending[0] as number, preferFlats);
  const high = noteName(ascending[ascending.length - 1] as number, preferFlats);
  const rangeWords = twoOctaves
    ? `Two octaves, ${low} to ${high}, entirely in first position — the range ABRSM asks for in this key.`
    : `${key} from its lowest first-position tonic, ${low}, up to ${high} — the highest note of the key the hand reaches without leaving the position — and back down. A scale that stops where first position stops rather than on a convenient octave, which is what a song in this key actually asks of you once it goes past an octave.`;

  return makeDrill({
    tonic,
    mode,
    step: 2,
    title: `${titleKey(key)} Across the Strings`,
    origin: twoOctaves ? 'SCALE · TWO OCTAVES · TONIC TRIAD' : 'SCALE · ALL FOUR STRINGS · TONIC TRIAD',
    bpm: 50,
    difficulty: atLeast(frameTier(all), 'Intermediate'),
    teaches: `${rangeWords} Then the tonic triad in root position, in quavers — ♪ = 100 at this tempo, which is ABRSM’s Grade 2 arpeggio speed. ${handReport(all, preferFlats)}`,
    preferFlats,
    bars: [...intoBars(separateBows(scaleNotes)), ...intoBars(separateBows(arpeggioEvents))],
  });
}

/**
 * Drill 3 — broken thirds, then the key's other face.
 *
 * Thirds because they are the cheapest test of a hand frame: the fingers stop
 * arriving in order, and any tape the player was only half trusting shows up at
 * once. Then the parallel minor of a major key, or the harmonic minor of a
 * minor one — the same tonic with one or three notes moved, which is how a song
 * in this key will actually bend away from the scale.
 */
function drillThree(entry: KeyEntry): CelloSongScore {
  const { tonic, mode, preferFlats } = entry;
  const ranges = rangesFor(tonic, mode);
  const key = canonicalKeyName({ tonic, mode });
  const steps = stepsFor(mode);

  const thirds = brokenThirds(ranges.thirdsFrom, steps);
  const thirdsEvents = [
    ...thirds.map((midi) => at(midi, 0.5)),
    at(ranges.thirdsFrom, finalHold(thirds.length / 2 + 1), { art: 'tenuto' }),
  ];

  // The mode runs from the same tonic as the thirds wherever it fits, so the
  // two halves of the drill answer each other instead of jumping an octave.
  const otherSteps = mode === 'minor' ? HARMONIC_MINOR_STEPS : NATURAL_MINOR_STEPS;
  const otherFrom = inRange(octaveUp(ranges.thirdsFrom, otherSteps))
    ? ranges.thirdsFrom
    : tonicsInRange(tonic).find((t) => inRange(octaveUp(t, otherSteps))) ?? ranges.octaveFrom;
  const otherRun = upAndDown(octaveUp(otherFrom, otherSteps));
  const otherNotes = evenNotes(otherRun, finalHold(otherRun.length));
  const otherName = mode === 'minor'
    ? `${titleKey(key).replace(' Minor', '')} harmonic minor`
    : `${titleKey(key).replace(' Major', '')} minor, the parallel key`;
  const otherWords = mode === 'minor'
    ? `then the same octave as ${otherName} — the seventh raised by a semitone, which is what gives a minor key a dominant that pulls home.`
    : `then the same octave as ${otherName} — third, sixth and seventh each dropped a semitone.`;

  const all = [...thirds, ...otherRun];

  return makeDrill({
    tonic,
    mode,
    step: 3,
    title: `${titleKey(key)} in Broken Thirds`,
    origin: `SCALE · BROKEN THIRDS · ${mode === 'minor' ? 'HARMONIC MINOR' : 'PARALLEL MINOR'}`,
    bpm: 54,
    difficulty: 'Advanced',
    teaches: `Broken thirds over the octave from ${noteName(ranges.thirdsFrom, preferFlats)} — 1–3, 2–4, 3–5 and on up, ABRSM’s own broken-thirds pattern taken far slower than the Grade 6 tempo it is set at — ${otherWords} Forward extensions are allowed here. ${handReport(all, preferFlats)}`,
    preferFlats,
    bars: [...intoBars(separateBows(thirdsEvents)), ...intoBars(separateBows(otherNotes))],
  });
}

// ─── The authored set ────────────────────────────────────────────────────────

interface KeyEntry {
  tonic: PitchClass;
  mode: KeyMode;
  /** How many of the three graded steps this key gets. */
  steps: number;
  preferFlats: boolean;
}

const BUILDERS = [drillOne, drillTwo, drillThree] as const;

/**
 * Which keys are drilled, and how far each one goes — decided by the library.
 *
 * Not a hand-maintained list, and it used to be one. Written down, it went
 * stale twice inside a single afternoon: the arranger was rebuilt,
 * `bundledSongs.json` was regenerated, and keys crossed the band boundaries
 * underneath a table that still said what yesterday's library needed. A list
 * of drill counts is a *derived* fact about a moving library, so it is derived:
 *
 * - every key the census bands above `rare` is drilled,
 * - it gets `DRILLS_EARNED[demand]` of the three graded steps — three for a key
 *   carrying a twentieth of the library, two for a thirtieth, one for a
 *   seventieth,
 * - in census order, so the most-used keys are also the most prominent,
 * - spelled with flats or sharps as the key itself wants, which
 *   `canonicalKeyName` already decides.
 *
 * Rebuild the library and the drill set re-grades itself. The only authored
 * per-key content is the prose in `KEY_NOTES`, which exists for all 24 keys so
 * that a key rising out of `rare` arrives with something to say.
 */
/**
 * Pedagogical baseline drilled keys for cello when the library contains no songs.
 * Preserves the graded scale curriculum across cornerstone and common keys so
 * author-designed drills are not wiped out when the library is cleaned or rebuilt.
 */
const BASELINE_KEY_ENTRIES: readonly { tonic: PitchClass; mode: KeyMode; steps: number }[] = [
  // Cornerstone keys (3 steps)
  { tonic: 4, mode: 'minor', steps: 3 }, // E minor
  { tonic: 2, mode: 'minor', steps: 3 }, // D minor
  { tonic: 2, mode: 'major', steps: 3 }, // D major
  { tonic: 7, mode: 'major', steps: 3 }, // G major
  { tonic: 9, mode: 'minor', steps: 3 }, // A minor
  { tonic: 0, mode: 'major', steps: 3 }, // C major
  { tonic: 4, mode: 'major', steps: 3 }, // E major
  // Common keys (2 steps)
  { tonic: 9, mode: 'major', steps: 2 }, // A major
  { tonic: 11, mode: 'minor', steps: 2 }, // B minor
  { tonic: 0, mode: 'minor', steps: 2 }, // C minor
  { tonic: 5, mode: 'major', steps: 2 }, // F major
  { tonic: 1, mode: 'major', steps: 2 }, // D♭ major
  // Occasional keys (1 step)
  { tonic: 7, mode: 'minor', steps: 1 }, // G minor
  { tonic: 11, mode: 'major', steps: 1 }, // B major
  { tonic: 3, mode: 'minor', steps: 1 }, // D♯ minor
  { tonic: 10, mode: 'major', steps: 1 }, // B♭ major
  { tonic: 1, mode: 'minor', steps: 1 }, // C♯ minor
  { tonic: 3, mode: 'major', steps: 1 }, // E♭ major
  { tonic: 6, mode: 'minor', steps: 1 }, // F♯ minor
  { tonic: 6, mode: 'major', steps: 1 }, // F♯ major
];

const BASELINE_DRILLED_KEYS: KeyEntry[] = BASELINE_KEY_ENTRIES.map((entry) => ({
  ...entry,
  preferFlats: wantsFlats(entry.tonic, entry.mode),
}));

const DRILLED_KEYS: KeyEntry[] = LIBRARY_KEY_CENSUS.entries.length > 0
  ? LIBRARY_KEY_CENSUS.entries
      .map((entry) => ({
        tonic: entry.tonic,
        mode: entry.mode,
        steps: Math.min(BUILDERS.length, DRILLS_EARNED[keyDemand(entry.share)]),
        preferFlats: wantsFlats(entry.tonic, entry.mode),
      }))
      .filter((entry) => entry.steps > 0)
  : BASELINE_DRILLED_KEYS;

export const SCALE_DRILLS: CelloSongScore[] = DRILLED_KEYS.flatMap(
  (entry) => BUILDERS.slice(0, entry.steps).map((build) => build(entry)),
);

// ─── Drones ──────────────────────────────────────────────────────────────────

/**
 * A tonic-and-fifth drone for every drill.
 *
 * The oldest intonation tool there is, and the right one for a scale: against a
 * fixed drone a note four cents out starts to beat, and the player hears it
 * long before a needle would show it. Where the tonic is an open string the
 * drone is that string's own pitch, so the reference is one the player can
 * check by bowing the open string itself.
 */
function droneFor(score: CelloSongScore): BackingTrack {
  const drill = SCALE_DRILL_KEYS[score.id];
  const last = score.measures[score.measures.length - 1];
  const durationMs = last ? last.startBarTimeMs + last.durationMs : 0;
  const tonic = drill?.tonic ?? 0;

  // Where the tonic is an open string, the drone *is* that string: C major
  // drones open C and open G, D major drones open D and open A. The player can
  // bow the string itself and hear the two agree, which is the cheapest
  // possible reference pitch and the reason the graded syllabuses start here.
  // Otherwise the lowest sounding of the tonic below open D, so the drone sits
  // under the drill rather than inside it.
  const openString = openStringTonic(tonic);
  const root = openString ? OPEN_STRING_MIDI[openString] : 36 + toPitchClass(tonic);

  const part: BackingPart = {
    id: `${score.id}-drone`,
    name: 'Tonic Drone',
    instrument: 'drone',
    role: 'accompaniment',
    gain: 0.45,
    muted: false,
    notes: [
      { midiNumber: root, startTimeMs: 0, durationMs, velocity: 0.5 },
      { midiNumber: root + 7, startTimeMs: 0, durationMs, velocity: 0.38 },
    ],
  };

  return {
    id: score.id,
    name: `${score.metadata.title} — drone`,
    source: 'generated',
    durationMs,
    bpm: score.metadata.bpm,
    parts: [part],
  };
}

export const SCALE_DRILL_BACKINGS: Record<string, BackingTrack> =
  Object.fromEntries(SCALE_DRILLS.map((score) => [score.id, droneFor(score)]));

// ─── What any key costs the left hand ───────────────────────────────────────

export interface KeyHandVerdict {
  /**
   * The easiest whole octave of the key first position reaches — the
   * closed-hand one if the key has one, otherwise the lowest.
   *
   * The *same* octave `drillOne` chooses, deliberately. Reporting the lowest
   * octave instead would put "D major needs two forward extensions" directly
   * above a Beginner D major drill that needs none, because D major's lowest
   * octave starts on the C string at D2 and its easy one starts on the open D.
   */
  range: string;
  /** Distinct pitches in that octave needing the fourth finger to reach forward. */
  reaches: number;
  /** Distinct pitches needing the first finger drawn back into half position. */
  drawBacks: number;
  /** Tier that octave earns from the hand frame alone. */
  tier: DifficultyTier;
  /** One sentence on what the key costs down here. */
  note: string;
}

/**
 * What a key asks of the left hand in first position — for any key, drilled or
 * not.
 *
 * The scales screen needs this for the keys it has no drill for: "three songs,
 * and no closed-hand octave" is a reason a player can act on, where a blank
 * row is not. Measured through `firstPositionFingering`, so it is the same
 * verdict the drills are built from.
 */
export function firstPositionVerdict(
  tonic: PitchClass, mode: KeyMode, preferFlats = wantsFlats(tonic, mode),
): KeyHandVerdict {
  const steps = stepsFor(mode);
  const ranges = rangesFor(tonic, mode);
  const from = ranges.closedOctaveFrom ?? ranges.octaveFrom;
  const octave = octaveUp(from, steps);
  const reaches = extensionsIn(octave);
  const drawBacks = halfPositionsIn(octave);
  const range = `${noteName(from, preferFlats)}–${noteName(from + 12, preferFlats)}`;

  const note = handMoveNote({ range, reaches: reaches.length, drawBacks: drawBacks.length, closedFifthFrom: ranges.closedFifthFrom, preferFlats });

  return { range, reaches: reaches.length, drawBacks: drawBacks.length, tier: frameTier(octave), note };
}

type HandMoveFacts = { range: string; reaches: number; drawBacks: number; closedFifthFrom: number | null; preferFlats: boolean };

/** What the hand has to do for a key's octave, in words. */
function handMoveNote({ range, reaches, drawBacks, closedFifthFrom, preferFlats }: HandMoveFacts): string {
  if (reaches === 0 && drawBacks === 0) return `The octave ${range} needs no hand move at all — four fingers, four tapes.`;
  if (closedFifthFrom !== null) {
    return `No closed-hand octave down here, but the first five notes from ${noteName(closedFifthFrom, preferFlats)} need no hand move.`;
  }
  const noteWord = reaches === 1 ? 'note' : 'notes';
  const moves = [
    reaches > 0 ? `${reaches} ${noteWord} of the octave ${range} need the fourth finger to reach forward` : '',
    drawBacks > 0 ? `${drawBacks} need the first finger drawn back` : '',
  ].filter(Boolean).join(' and ');
  return `No closed-hand octave and no closed-hand fifth in first position: ${moves}.`;
}
