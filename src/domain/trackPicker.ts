/**
 * Choosing which part of the song you play, and where it sits.
 *
 * Every song in the library already stores every track of its source file —
 * the vocal, the bass, the two guitars, and occasionally a part the original
 * author wrote for a cello. The app picks one of them automatically and
 * arranges it; this module lets the player overrule that, take any part as
 * their own line, and move it by whole octaves until it lands somewhere a
 * cello can reach.
 *
 * Two rules shape the whole thing.
 *
 * **The player chooses a part, not a track.** A MIDI track index is a fact
 * about a file, not about music. What a player recognises is "the bass", "the
 * tune", "the cello" — so a part is named from its own track name where the
 * file bothered to set a useful one, and from what it plays where it did not.
 *
 * **The octave control tells the truth before it is used.** Shifting a vocal
 * line down two octaves is the whole point of the feature, and it is also the
 * easiest way to produce something unplayable. So every candidate octave is
 * costed up front — the resulting range, how much of it seats in first
 * position, how many notes the app would have to move anyway — and an octave
 * that cannot work is refused with a reason rather than rendered as a
 * plausible-looking impossible fingering. `firstPositionFingering` throws
 * outside its compass, and the honest place to catch that is here, at the
 * moment of choosing, not at draw time.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import {
  ArrangementLevel, ARRANGEMENT_PROFILES, simplifyLine, smoothLeaps,
} from './arrangement';
import { BackingPart, InstrumentName } from './backing';
import { midiToFrequency, midiToPitchName, OPEN_STRING_MIDI } from './cello';
import { firstPositionFingering, RawNoteEvent } from './fingering';
import { bestOctaveShiftToRange } from './melody';
import { MidiNote, monophonic } from './midi';
import { CelloNote, CelloSongScore, scoreDurationMs } from './schema';

// ─── The compass ─────────────────────────────────────────────────────────────

/**
 * The lowest and highest pitch `firstPositionFingering` can seat.
 *
 * The floor is the open C. The ceiling is D♯4 — the sixth semitone of the A
 * string, reached by extending the fourth finger forward — and above it the
 * hand has to leave the neck. Every arrangement profile's range is a subset of
 * this, which is what makes the pipeline below total: once a line has been
 * seated inside a profile range, fingering it cannot throw.
 */
export const FIRST_POSITION_FLOOR = OPEN_STRING_MIDI.C;
export const FIRST_POSITION_ROOF = 63;

/** Pitches that need the stretched fourth finger — the sixth on each string. */
const NEEDS_EXTENSION = new Set([42, 49, 56, 63]);

/**
 * Below this share of the line landing where the player put it, the octave is
 * refused rather than costed.
 *
 * The reasoning is that at some point the app is no longer honouring a choice,
 * it is overruling one. Once more of a line has to be dragged to a different
 * octave than stays where it was put, the octave the player picked is not the
 * octave they will hear — so offering it would be a lie, however carefully the
 * small print explained itself.
 *
 * A half is also cheap. Measured over the 1 426 pitched source parts in the
 * bundled library: at a half, 3 parts have no workable octave at all and the
 * average part still offers 2.25 of them. Tightening to 0.6 takes that to 15
 * dead parts for a quarter of an octave's extra strictness, and loosening to a
 * quarter buys 0.7 more octaves per part, all of them octaves where most of
 * the line moves anyway.
 */
const REFUSAL_SHARE = 0.5;

/** Fewer notes than this in the whole song and there is nothing to practise. */
const MIN_PLAYABLE_NOTES = 8;

/**
 * Octaves costed either way.
 *
 * Six, because six is enough that the window is never the binding constraint:
 * from the top of MIDI (127) six octaves down is 55, inside first position, and
 * from the bottom (0) four up is 48. So "no octave works for this part" means
 * the part, not the size of this constant — which matters, because that is the
 * sentence the picker shows a player.
 *
 * The stepper only ever walks the octaves that work, so a wide window costs
 * the player nothing; it costs one pass over the part's pitches per octave,
 * once, on the screen that draws the picker.
 */
const MAX_OCTAVE_SHIFT = 6;

// ─── What one octave choice would do ─────────────────────────────────────────

export type OctaveVerdict = 'fits' | 'folds' | 'refused';

export interface OctaveFit {
  /** Whole octaves, positive up. */
  octaves: number;
  level: ArrangementLevel;
  noteCount: number;
  /** Lowest and highest sounding pitch after the shift, before any repair. */
  lowMidi: number;
  highMidi: number;
  /** e.g. `"G2 – D4"`. */
  rangeLabel: string;
  /** Notes that land where the player asked and can be bowed there. */
  placed: number;
  /** Notes that fall below the open C. */
  belowFloor: number;
  /** Notes that climb above this level's first-position ceiling. */
  aboveCeiling: number;
  /** Notes needing the stretched fourth finger. */
  extended: number;
  /** Notes the app would have to move to another octave before they are playable. */
  reseated: number;
  /** `placed / noteCount`, 0–1. */
  placedShare: number;
  verdict: OctaveVerdict;
  /**
   * What this octave does, without the range in front of it.
   *
   * Kept separate from `summary` so a caller that has already shown the range
   * — or has no room for it — can print the consequence on its own, rather
   * than doing string surgery on a finished sentence.
   */
  reason: string;
  /** `"G2 – D4. Every note fits first position."` Shown verbatim. */
  summary: string;
}

function rangeLabelOf(low: number, high: number, preferFlats: boolean): string {
  return `${midiToPitchName(low, preferFlats)} – ${midiToPitchName(high, preferFlats)}`;
}

/**
 * Costs one octave choice for one line at one difficulty level.
 *
 * The window is the level's own arrangement range rather than the instrument's
 * full first position, because the level's range is what will actually be
 * enforced when the player presses play. Reporting against a wider window and
 * then quietly narrowing it later is the precise failure this function exists
 * to prevent.
 *
 * A closed-frame level — Beginner and Intermediate — will *move* a note that
 * needs the stretched fourth finger rather than ask a beginner's hand for it,
 * so on those levels an extension counts towards `reseated`. Above them the
 * stretch is allowed and is merely reported.
 */
export function describeOctaveFit(
  pitches: readonly number[], octaves: number, level: ArrangementLevel,
  preferFlats = false,
): OctaveFit {
  const profile = ARRANGEMENT_PROFILES[level];
  const shift = octaves * 12;
  const noteCount = pitches.length;

  let lowMidi = Infinity;
  let highMidi = -Infinity;
  let belowFloor = 0;
  let aboveCeiling = 0;
  let extended = 0;

  for (const pitch of pitches) {
    const moved = pitch + shift;
    if (moved < lowMidi) lowMidi = moved;
    if (moved > highMidi) highMidi = moved;
    if (moved < profile.range.low) belowFloor++;
    else if (moved > profile.range.high) aboveCeiling++;
    else if (NEEDS_EXTENSION.has(moved)) extended++;
  }

  const reseated = belowFloor + aboveCeiling + (profile.closedFrameOnly ? extended : 0);
  const placed = Math.max(0, noteCount - reseated);
  const placedShare = noteCount === 0 ? 0 : placed / noteCount;
  const verdict: OctaveVerdict = noteCount === 0 || placedShare < REFUSAL_SHARE
    ? 'refused'
    : reseated > 0 ? 'folds' : 'fits';

  const rangeLabel = noteCount === 0
    ? '—'
    : rangeLabelOf(lowMidi, highMidi, preferFlats);
  const reason = reasonFor({
    noteCount, belowFloor, aboveCeiling, extended, reseated, verdict, profile,
  });

  return {
    octaves,
    level,
    noteCount,
    lowMidi: noteCount === 0 ? 0 : lowMidi,
    highMidi: noteCount === 0 ? 0 : highMidi,
    rangeLabel,
    placed,
    belowFloor,
    aboveCeiling,
    extended,
    reseated,
    placedShare,
    verdict,
    reason,
    summary: noteCount === 0 ? reason : `${rangeLabel}. ${reason}`,
  };
}

function reasonFor(fit: {
  noteCount: number; belowFloor: number; aboveCeiling: number;
  extended: number; reseated: number; verdict: OctaveVerdict;
  profile: { closedFrameOnly: boolean; range: { low: number; high: number } };
}): string {
  if (fit.noteCount === 0) return 'Nothing to play in this part.';
  const ceiling = midiToPitchName(fit.profile.range.high);

  if (fit.verdict === 'refused') {
    const direction = fit.belowFloor >= fit.aboveCeiling ? 'below the open C' : `above ${ceiling}`;
    return `${fit.reseated} of ${fit.noteCount} notes land ${direction}, `
      + 'so this is not the octave for this part.';
  }

  if (fit.verdict === 'folds') {
    const where: string[] = [];
    if (fit.belowFloor > 0) where.push(`${fit.belowFloor} below the open C`);
    if (fit.aboveCeiling > 0) where.push(`${fit.aboveCeiling} above ${ceiling}`);
    if (fit.profile.closedFrameOnly && fit.extended > 0) {
      where.push(`${fit.extended} needing a stretch this level does not use`);
    }
    return `${fit.reseated} of ${fit.noteCount} notes `
      + `(${where.join(', ')}) move an octave to be reachable.`;
  }

  if (fit.extended > 0) {
    return `Every note fits first position; `
      + `${fit.extended} need the stretched fourth finger.`;
  }
  return 'Every note fits first position.';
}

/** Every octave the player may consider, lowest first. */
export function octaveChoices(
  pitches: readonly number[], level: ArrangementLevel, preferFlats = false,
): OctaveFit[] {
  const out: OctaveFit[] = [];
  for (let octaves = -MAX_OCTAVE_SHIFT; octaves <= MAX_OCTAVE_SHIFT; octaves++) {
    out.push(describeOctaveFit(pitches, octaves, level, preferFlats));
  }
  return out;
}

/**
 * The octave the app would choose for this line.
 *
 * Delegated to `bestOctaveShiftToRange` rather than re-derived, so a part the
 * player selects by hand is seated by exactly the same policy that seats every
 * automatic arrangement — including its deliberate asymmetry, which prefers
 * being an octave too dark over being an octave too high up the neck.
 *
 * Clamped to the costed window, so the suggestion is always an octave the
 * player can actually reach with the stepper. Without the clamp a part could be
 * marked unplayable — every costed octave refused — and still carry a suggested
 * octave from outside the window that happened to work, which is the kind of
 * contradiction a player discovers as a control that does nothing.
 */
export function suggestedOctaves(
  pitches: readonly number[], level: ArrangementLevel,
): number {
  if (pitches.length === 0) return 0;
  const profile = ARRANGEMENT_PROFILES[level];
  const { shift } = bestOctaveShiftToRange(
    pitches, profile.range.low, profile.range.high, profile.medianCeiling,
  );
  return Math.max(-MAX_OCTAVE_SHIFT, Math.min(MAX_OCTAVE_SHIFT, Math.round(shift / 12)));
}

/** The workable octave nearest `octaves`, or null when the part has none. */
export function nearestWorkableOctave(
  choices: readonly OctaveFit[], octaves: number,
): number | null {
  let best: OctaveFit | null = null;
  for (const choice of choices) {
    if (choice.verdict === 'refused') continue;
    if (!best) { best = choice; continue; }
    const closer = Math.abs(choice.octaves - octaves) - Math.abs(best.octaves - octaves);
    if (closer < 0 || (closer === 0 && choice.placedShare > best.placedShare)) best = choice;
  }
  return best?.octaves ?? null;
}

// ─── Naming a part the way a player would ────────────────────────────────────

/**
 * Word-boundary matching throughout, for the reason `melody.ts` documents at
 * length: Tool's bassist is Justin Chan**cello**r, and a substring match on
 * "cello" transcribes Lateralus from the bass.
 */
const NAME_CELLO = /\b(cello|violoncello|celli|vc)\b/i;

/**
 * Bass, spelled out rather than matched with a suffix wildcard, because a
 * bassoon is a reed instrument playing an inner part and not a bass line.
 */
const NAME_BASS = /\b(bass|basses|basse|bassline|contrabass|bajo)\b/i;

/**
 * The tune. Suffixes are allowed here — "Leadvocal", "Voices", "vocals2" are
 * all real track names in the library and all name the same thing — which is
 * safe in a way it is not for `cello`, whose one dangerous false positive
 * ("Chancellor") is a *prefix* match.
 */
const NAME_TUNE = /\b(vocal\w*|voice\w*|vox|sing\w*|lyric\w*|melod\w*|tune|theme|lead\w*|riff|solo)\b/i;

/**
 * A drum part, whatever channel it was programmed on.
 *
 * `instrumentForProgram` only calls a track percussion when every note is on
 * MIDI channel 9, and plenty of files ignore that convention — AC/DC's "Back in
 * Black" has its snare, bass drum and cymbal on melodic channels with a synth
 * program, so they arrive as pitched parts and would otherwise be offered as a
 * bass line. They do have pitches; they are not music. `tom` and `clap` are
 * deliberately absent, being too common in a musician's name for the risk.
 */
const NAME_DRUM = /\b(drum\w*|snare|kick|cymbal|hi-?hat|hihat|conga|bongo|tambourine|cabasa|shaker|cowbell|timbale|perc\w*)\b/i;

const NAME_PLACEHOLDER = /^(track|channel|chan|part|midi|inst|instrument|untitled|new)\s*[\d.]*$/i;

/**
 * Any word that tells a player something about the part.
 *
 * A track name only earns its place on the row if it says something. Plenty in
 * the library do not: the file is named after whoever played it ("Fieldy",
 * "Jason Newstead", "Marco Coti Celati"), after the software that wrote it
 * ("WinJammer Demo"), or in mojibake. A player scanning for the bass line does
 * not know that Fieldy is Korn's bassist, so those rows are titled by the
 * instrument instead and the tone and section words — "Clean", "Overdrive",
 * "Acoustic", "Backing", "Intro" — are kept, because those are exactly the
 * distinctions a player is choosing between when a song has four guitars.
 */
const NAME_INFORMATIVE = new RegExp([
  NAME_CELLO.source, NAME_BASS.source, NAME_TUNE.source, NAME_DRUM.source,
  /\b(guitar\w*|gtr|drum\w*|perc\w*|piano|keys?|organ|synth\w*|horn\w*|brass|sax\w*|trumpet|trombone|flute|clarinet|oboe|bassoon|violin\w*|viola|harp|strings?|pad|choir|orch\w*)\b/.source,
  /\b(clean|overdrive\w*|overdriven|distort\w*|acoustic|electric|rhythm|backing|accomp\w*|harmony|counter\w*|intro|verse|chorus|bridge|outro|fill|pedal|drone|arpegg\w*|tremolo|pizz\w*|staccato)\b/.source,
].join('|'), 'i');

/**
 * Instrument words that make a General MIDI program of 42 a lie.
 *
 * Program 42 is GM cello, and `instrumentForProgram` maps it to `'cello'`
 * without asking questions. That is usually right and occasionally absurd: one
 * file in the library has a track called "Kris Novelis -Bass-" sitting on
 * program 42, and another labels its vocal line "Voice". A track whose own
 * name says what it is beats a program number that was probably never set
 * deliberately.
 */
const NAME_NOT_CELLO = /\b(bass|basses|basse|guitar\w*|gtr|drum\w*|perc\w*|vocal\w*|voice\w*|vox|sing\w*|piano|keys?|organ|synth\w*|horn\w*|brass|sax\w*|trumpet|trombone|flute|clarinet|oboe|violin\w*|viola|harp|pad|strings?)\b/i;

export type CelloPartKind =
  | 'arrangement' | 'cello' | 'melody' | 'bass' | 'harmony' | 'percussion';

const INSTRUMENT_LABEL: Record<InstrumentName, string> = {
  cello: 'Cello', piano: 'Piano', mallet: 'Mallets', organ: 'Organ', guitar: 'Guitar',
  strings: 'Strings', bass: 'Bass', pluck: 'Plucked', brass: 'Brass', reed: 'Reed',
  synth: 'Synth', drone: 'Drone', percussion: 'Drums',
};

const KIND_WORD: Record<CelloPartKind, string> = {
  arrangement: 'Arranged for you',
  cello: 'Written for cello',
  melody: 'The tune',
  bass: 'Bass line',
  harmony: 'Accompaniment',
  percussion: 'Drums',
};

/** Order the list is shown in: what a cellist would try, in that order. */
const KIND_RANK: Record<CelloPartKind, number> = {
  arrangement: 0, cello: 1, melody: 2, bass: 3, harmony: 4, percussion: 5,
};

/**
 * True when the source file genuinely wrote this part for a cello.
 *
 * The one case where the arranging decisions have already been made by someone
 * who knew what instrument they were writing for, so it deserves to be found
 * and said out loud rather than treated as one more track.
 */
export function writtenForCello(part: Pick<BackingPart, 'name' | 'instrument'>): boolean {
  if (NAME_CELLO.test(part.name)) return true;
  return part.instrument === 'cello' && !NAME_NOT_CELLO.test(part.name);
}

export function partKind(part: Pick<BackingPart, 'name' | 'instrument' | 'role'>): CelloPartKind {
  if (part.instrument === 'percussion' || NAME_DRUM.test(part.name)) return 'percussion';
  if (writtenForCello(part)) return 'cello';
  if (NAME_BASS.test(part.name) || part.instrument === 'bass') return 'bass';
  if (NAME_TUNE.test(part.name)) return 'melody';
  if (part.role === 'solo') return 'melody';
  return 'harmony';
}

/** Sentence case for a name the file shouted, left alone otherwise. */
function tidyName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 4 || trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.charAt(0) + trimmed.slice(1).toLowerCase();
}

/**
 * What to call this part on screen.
 *
 * The file's own track name wins whenever it says anything — "Vocals",
 * "Overdrive", "Clean" are what the person who made the file called them, and
 * they are more use than any classification this module could invent. A name
 * that says nothing a player can act on falls back to the instrument, which is
 * the one thing always known: "Track 4" and "Fieldy" both become "Bass". The
 * row's second line then says what it plays, so nothing is lost.
 */
export function partLabel(part: Pick<BackingPart, 'name' | 'instrument' | 'role'>): string {
  const name = tidyName(part.name);
  if (!name || NAME_PLACEHOLDER.test(name)) return INSTRUMENT_LABEL[part.instrument];
  if (!NAME_INFORMATIVE.test(name)) return INSTRUMENT_LABEL[part.instrument];
  return name;
}

// ─── The list the player chooses from ────────────────────────────────────────

export interface CelloPartOption {
  /** The backing part's id, or null for the app's own arrangement. */
  id: string | null;
  kind: CelloPartKind;
  /** What a player calls it: "Vocals", "Bass", "Cello". */
  label: string;
  /** The second line: what it plays, how much of it, and where it was written. */
  detail: string;
  writtenForCello: boolean;
  noteCount: number;
  lowMidi: number;
  highMidi: number;
  /** Every octave, costed. Empty for the app's arrangement. */
  octaves: OctaveFit[];
  /** Where the app would put this part. */
  suggested: number;
  /** Null when this part can be played; a plain sentence when it cannot. */
  unplayable: string | null;
}

/** The part list a score's own line already occupies, so it is never offered twice. */
export const ARRANGEMENT_OPTION_ID = null;

function detailOf(kind: CelloPartKind, noteCount: number, range: string): string {
  return `${KIND_WORD[kind]} · ${noteCount} notes · written ${range}`;
}

/**
 * Builds the picker's rows from a song's stored source parts.
 *
 * The app's own arrangement always leads and is always playable — it is the
 * default and the thing every other row is an alternative to. After it the
 * order is what a cellist would reach for: a real cello part, then the tune,
 * then the bass, then everything else, with the parts that cannot be played at
 * all last and marked as such rather than hidden. Hiding them invites the
 * question "where is the drum track?"; showing them greyed answers it.
 */
export function celloPartOptions(
  parts: readonly BackingPart[], level: ArrangementLevel,
  options: { arrangementDetail?: string; preferFlats?: boolean } = {},
): CelloPartOption[] {
  const preferFlats = options.preferFlats ?? false;

  const arrangement: CelloPartOption = {
    id: ARRANGEMENT_OPTION_ID,
    kind: 'arrangement',
    label: 'Ponticello arrangement',
    detail: options.arrangementDetail
      ?? `${KIND_WORD.arrangement} · follows the difficulty you pick`,
    writtenForCello: false,
    noteCount: 0,
    lowMidi: 0,
    highMidi: 0,
    octaves: [],
    suggested: 0,
    unplayable: null,
  };

  const rest = parts.map((part) => {
    const kind = partKind(part);
    const pitches = part.notes.map((note) => note.midiNumber);
    const noteCount = pitches.length;
    const lowMidi = noteCount === 0 ? 0 : Math.min(...pitches);
    const highMidi = noteCount === 0 ? 0 : Math.max(...pitches);
    const range = noteCount === 0 ? '—' : rangeLabelOf(lowMidi, highMidi, preferFlats);
    const octaves = kind === 'percussion' || noteCount < MIN_PLAYABLE_NOTES
      ? []
      : octaveChoices(pitches, level, preferFlats);
    const suggested = suggestedOctaves(pitches, level);

    let unplayable: string | null = null;
    if (kind === 'percussion') {
      unplayable = 'A drum track. There are no pitches here to bow.';
    } else if (noteCount < MIN_PLAYABLE_NOTES) {
      unplayable = `Only ${noteCount} note${noteCount === 1 ? '' : 's'} in the whole song.`;
    } else if (octaves.every((fit) => fit.verdict === 'refused')) {
      unplayable = `Spans ${highMidi - lowMidi} semitones — no octave puts enough of it `
        + 'inside first position.';
    }

    const option: CelloPartOption = {
      id: part.id,
      kind,
      label: partLabel(part),
      detail: detailOf(kind, noteCount, range),
      writtenForCello: writtenForCello(part),
      noteCount,
      lowMidi,
      highMidi,
      octaves,
      suggested: nearestWorkableOctave(octaves, suggested) ?? suggested,
      unplayable,
    };
    return option;
  });

  rest.sort((a, b) => {
    if (!!a.unplayable !== !!b.unplayable) return a.unplayable ? 1 : -1;
    const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rank !== 0) return rank;
    return b.noteCount - a.noteCount;
  });

  return [arrangement, ...rest];
}

/**
 * A real cello part written into the source file, if there is one.
 *
 * Surfaced separately because it is worth saying on the library row and on the
 * practice sheet, before the picker is ever opened: this song came with cello
 * in it.
 */
export function findCelloPart(parts: readonly BackingPart[]): BackingPart | null {
  for (const part of parts) {
    if (part.notes.length >= MIN_PLAYABLE_NOTES && writtenForCello(part)) return part;
  }
  return null;
}

// ─── Turning a chosen part into a cello line ─────────────────────────────────

/** What the player picked, as stored. */
export interface TrackChoice {
  /** Null — or absent — means the app's arrangement for the current level. */
  partId: string | null;
  /** Whole octaves, positive up. */
  octaves: number;
}

export const DEFAULT_TRACK_CHOICE: TrackChoice = { partId: null, octaves: 0 };

function toMidiNotes(part: BackingPart, shift: number): MidiNote[] {
  return part.notes.map((note) => ({
    midiNumber: note.midiNumber + shift,
    startTimeMs: note.startTimeMs,
    durationMs: Math.max(1, note.durationMs),
    track: 0,
    channel: 0,
    // Stored 0–1, and `simplifyLine` reads it as MIDI 0–127 when scoring which
    // attack in a crowded bucket is the one worth keeping.
    velocity: Math.round(Math.max(0.05, Math.min(1, note.velocity)) * 127),
  }));
}

/**
 * The chosen part, shifted, thinned, seated and clipped to the song.
 *
 * The order matters and is the same order the automatic arranger uses, with
 * exactly one substitution: the global octave move is the player's rather than
 * the arranger's. After that, everything downstream is untouched policy —
 * `simplifyLine` reduces bow attacks to what the level allows, `smoothLeaps`
 * chooses octaves jointly so a repaired note does not strand the next one, and
 * the closed-frame flag keeps a beginner's hand out of extensions.
 *
 * `smoothLeaps` is what makes the result safe to finger: it seats every note
 * inside the profile's range, and every profile range is a subset of what
 * `firstPositionFingering` can take. It also leaves a well-placed line alone —
 * its placement cost is measured against the incoming pitch — so the player's
 * octave is honoured wherever it works and overruled only where it cannot.
 *
 * Returns null when the choice is refused, so the caller can fall back and say
 * why instead of drawing a line nobody asked for.
 */
export function celloLineFromPart(
  part: BackingPart, choice: TrackChoice, level: ArrangementLevel,
  options: { bpm: number; totalMs: number; preferFlats?: boolean },
): { events: RawNoteEvent[]; fit: OctaveFit } | null {
  // The picker never offers these, but a stored choice can outlive a rebuilt
  // library and point at a part that has since become a drum track or lost most
  // of its notes. Refusing here rather than trusting the caller is what stops a
  // stale choice turning into a bowed drum pattern.
  if (partKind(part) === 'percussion' || part.notes.length < MIN_PLAYABLE_NOTES) return null;

  const pitches = part.notes.map((note) => note.midiNumber);
  const fit = describeOctaveFit(pitches, choice.octaves, level, options.preferFlats);
  if (fit.verdict === 'refused') return null;

  const profile = ARRANGEMENT_PROFILES[level];
  const flattened = monophonic(toMidiNotes(part, choice.octaves * 12));
  if (flattened.length === 0) return null;

  const thinned = simplifyLine(flattened, level, options.bpm);
  const seated = smoothLeaps(
    thinned, profile.range, profile.maxLeapSemitones, profile.closedFrameOnly,
  );

  const events: RawNoteEvent[] = [];
  for (const note of seated) {
    if (note.startTimeMs >= options.totalMs) continue;
    const durationMs = Math.max(1, Math.min(note.durationMs, options.totalMs - note.startTimeMs));
    events.push({ midiNumber: note.midiNumber, startTimeMs: note.startTimeMs, durationMs });
  }
  if (events.length === 0) return null;

  return { events, fit };
}

/**
 * The chosen part as a score, on the song's own bars and timeline.
 *
 * Every source part is stored rebased onto the same zero as the arranged line
 * (see `tools/build-library.ts`), so a part can be dropped straight onto the
 * score's measures without re-deriving anything. The metadata is rewritten to
 * describe what the player is actually holding: the part's name, its role in
 * the texture — which is what tells the mixer to keep the original melody
 * audible when the player has taken the bass — and a `teaches` line that says
 * where this line came from.
 */
export function scoreFromPart(
  base: CelloSongScore, part: BackingPart, choice: TrackChoice, level: ArrangementLevel,
): { score: CelloSongScore; fit: OctaveFit } | null {
  const totalMs = scoreDurationMs(base);
  const built = celloLineFromPart(part, choice, level, {
    bpm: base.metadata.bpm,
    totalMs,
    preferFlats: base.metadata.preferFlats ?? false,
  });
  if (!built) return null;

  const kind = partKind(part);
  const label = partLabel(part);
  const preferFlats = base.metadata.preferFlats ?? false;

  const notes: CelloNote[] = built.events.map((event, index) => {
    const state = firstPositionFingering(event.midiNumber);
    const measureIndex = Math.max(0, base.measures.findIndex((measure) =>
      event.startTimeMs >= measure.startBarTimeMs
      && event.startTimeMs < measure.startBarTimeMs + measure.durationMs));
    return {
      id: `${base.id}-${level.toLowerCase()}-part-${index + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      durationMs: Math.round(event.durationMs),
      pitchName: midiToPitchName(event.midiNumber, preferFlats),
      midiNumber: event.midiNumber,
      frequency: Math.round(midiToFrequency(event.midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: kind === 'bass' ? 'accent' : 'arco',
      tie: false,
      measureIndex,
      bowDirection: index % 2 === 0 ? 'down' : 'up',
    };
  });

  const move = choice.octaves === 0
    ? 'at written pitch'
    : `${Math.abs(choice.octaves)} octave${Math.abs(choice.octaves) === 1 ? '' : 's'} `
      + `${choice.octaves < 0 ? 'down' : 'up'}`;

  return {
    fit: built.fit,
    score: {
      ...base,
      metadata: {
        ...base.metadata,
        // Keeping the original melody in the backing is the difference between
        // accompanying the song and replacing it. `arrangementBackingParts`
        // reads this, and only a bass or roots part earns the whole texture.
        arrangementRole: kind === 'bass' ? 'bass' : 'melody',
        teaches: `The song's own ${label} part, ${move}. `
          + `${built.fit.summary} ${notes.length} notes at ${level} level.`,
      },
      notes,
    },
  };
}
