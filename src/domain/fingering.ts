/**
 * Ergonomic fingering solver.
 *
 * Given a monophonic line of MIDI notes, choose where to put the left hand.
 * Each note has many physically valid answers — A4 can be taken on the A
 * string in first position with the fourth finger, on the D string in fourth,
 * or in thumb position — and the *sequence* is what makes one set good and
 * another exhausting. So this is a shortest-path problem, not a per-note one.
 *
 * States are ⟨string, position, finger, extension⟩. Emission cost scores how
 * comfortable a state is on its own; transition cost scores the move between
 * two states, scaled by how much time the player has to make it. Viterbi finds
 * the cheapest path through the whole line.
 */

import {
  CelloFinger, CelloPosition, CelloString, OPEN_STRING_MIDI, POSITION_BASE_SEMITONES,
  POSITION_ORDER, stopDistanceMm, STRING_ORDER,
} from './cello';
import { CelloExtension } from './schema';

export interface RawNoteEvent {
  startTimeMs: number;
  durationMs: number;
  midiNumber: number;
}

export interface CelloState {
  string: CelloString;
  position: CelloPosition;
  finger: CelloFinger;
  extension: CelloExtension;
  /**
   * Semitones from the nut to the hand's anchor — the first finger in a neck
   * position, or the thumb itself in thumb position.
   *
   * Thumb position is not one place. The thumb parks anywhere from the octave
   * harmonic upwards, and without tracking where, every thumb placement looks
   * identical to the shift model: the solver discovers it can play a whole
   * two-octave scale "without moving" and parks the hand in thumb position for
   * notes no cellist would ever take there.
   */
  baseSemitones?: number;
}

/** The hand's anchor for a state, falling back to the position's nominal base. */
export function handSemitones(state: CelloState): number {
  return state.baseSemitones ?? POSITION_BASE_SEMITONES[state.position];
}

const STRING_INDEX: Record<CelloString, number> = { C: 0, G: 1, D: 2, A: 3 };

const NECK_POSITIONS: CelloPosition[] =
  ['Half', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];

/** Highest stopped note we will ask for on any one string. */
const MAX_SEMITONES_ON_STRING = 26;

/**
 * Lowest pitch for which thumb position is even offered.
 *
 * Below D4 the neck positions reach everything, and putting the thumb on the
 * string down there is something no cellist does. It stays physically possible
 * — it is simply not a candidate.
 */
const THUMB_FLOOR_MIDI = 62;

// ─── Candidate generation ────────────────────────────────────────────────────

/** Closed hand frame: fingers 1–4 one semitone apart from the position base. */
const CLOSED_FRAME: Record<number, CelloFinger> = { 0: '1', 1: '2', 2: '3', 3: '4' };
/** Forward extension: 1 stays put, 2/3/4 reach one semitone further. */
const FORWARD_FRAME: Record<number, CelloFinger> = { 2: '2', 3: '3', 4: '4' };
/** Thumb position frame: T, then 1, 2, 3 climbing a tetrachord above it. */
const THUMB_FRAME: Record<number, CelloFinger> = { 0: 'T', 1: '1', 2: '1', 3: '2', 4: '2', 5: '3', 6: '3' };

const POSITIONS_ALLOWING_FORWARD: CelloPosition[] = ['Half', '1st', '2nd', '3rd', '4th'];
const POSITIONS_ALLOWING_BACKWARD: CelloPosition[] = ['1st', '2nd', '3rd', '4th'];

/**
 * Anchors the left hand can be resting at while an open string sounds.
 *
 * An open string is not a hand position — nothing is stopping the string, so
 * the hand is wherever the music left it. Modelling it as first position (the
 * one anchor it used to get) charged a shift down to the nut and another back
 * up for a note the hand never touches, and the solver responded the only way
 * it could: by refusing open strings in any passage above first position and
 * taking the pitch high up a neighbouring string instead. Open D at the top of
 * the C string, in seventh position, with the open D string sitting right
 * there.
 *
 * Offering the open string at every anchor another state can occupy lets the
 * path keep the hand where it already is, and lets an open note pay for a
 * shift with its own duration — which is what open strings are *for*.
 */
const OPEN_STRING_ANCHORS: readonly number[] = [...new Set([
  ...Object.values(POSITION_BASE_SEMITONES),
  ...Array.from({ length: MAX_SEMITONES_ON_STRING - 11 }, (_, i) => 12 + i),
])].sort((a, b) => a - b);

export function candidateStates(midi: number): CelloState[] {
  const out: CelloState[] = [];
  const key = new Set<string>();
  const add = (s: CelloState) => {
    const k = `${s.string}|${s.position}|${s.finger}|${s.extension}|${s.baseSemitones}`;
    if (!key.has(k)) { key.add(k); out.push(s); }
  };

  for (const string of STRING_ORDER) {
    const semitones = midi - OPEN_STRING_MIDI[string];

    if (semitones === 0) {
      // Written as first position throughout, because that is how an open
      // string is notated and read; `baseSemitones` is the part that varies,
      // and it is the only part the shift model looks at.
      for (const base of OPEN_STRING_ANCHORS) {
        add({ string, position: '1st', finger: '0', extension: 'none', baseSemitones: base });
      }
      continue;
    }
    if (semitones < 0 || semitones > MAX_SEMITONES_ON_STRING) continue;

    for (const position of NECK_POSITIONS) {
      const diff = semitones - POSITION_BASE_SEMITONES[position];

      const base = POSITION_BASE_SEMITONES[position];

      const closed = CLOSED_FRAME[diff];
      if (closed) add({ string, position, finger: closed, extension: 'none', baseSemitones: base });

      const forward = FORWARD_FRAME[diff];
      if (forward && POSITIONS_ALLOWING_FORWARD.includes(position)) {
        add({ string, position, finger: forward, extension: 'forward', baseSemitones: base });
      }

      if (diff === -1 && POSITIONS_ALLOWING_BACKWARD.includes(position)) {
        add({ string, position, finger: '1', extension: 'backward', baseSemitones: base });
      }
    }

    // Thumb position: the thumb can park anywhere from the octave harmonic up,
    // so every base from 12 semitones to the note itself is a candidate.
    if (semitones >= 12 && midi >= THUMB_FLOOR_MIDI) {
      for (let base = 12; base <= semitones; base++) {
        const finger = THUMB_FRAME[semitones - base];
        if (finger) add({ string, position: 'Thumb', finger, extension: 'none', baseSemitones: base });
      }
    }
  }

  return out;
}

// ─── Cost model ──────────────────────────────────────────────────────────────

export interface CostWeights {
  /** Long notes want vibrato, which an open string cannot give. */
  openStringOnLongNote: number;
  longNoteMs: number;
  /**
   * Credited to any open string, against every other seat for that pitch.
   *
   * For a player with tapes on the fingerboard the open string is the
   * reference pitch — the one note they can be certain of — so a library that
   * answers an open G with a third finger on the D string has taken away the
   * thing they tune everything else against. Held as its own term because it
   * has to stay ahead of the neck positions: making second and third position
   * nearly free is what let stopped seats start winning these.
   */
  openStringBonus: number;
  forwardExtension: number;
  backwardExtension: number;
  /** The little finger has no business in thumb position. */
  fourthFingerInThumb: number;
  shift: number;
  /** Crossing the neck heel is a bigger move than its distance suggests. */
  heelCrossing: number;
  /**
   * Charged per position above first, for the neck positions 2nd–4th.
   *
   * This is the dial that decides whether the hand is allowed to leave first
   * position at all. Set it high and every awkward note is answered with an
   * extension or a drop into half position, because moving the frame is priced
   * out; set it low and the solver will settle the hand wherever the passage
   * actually lies. Second, third and fourth are ordinary places for a hand to
   * be — they should not cost much more than first.
   */
  neckPosition: number;
  /**
   * Charged for fifth position and above — where the hand leaves the neck.
   *
   * Priced apart from `neckPosition` and not derived from it. Making second to
   * fourth position cheap is a statement about the neck; it must not quietly
   * make sixth position cheap too, or the solver answers an open A with a
   * fourth finger in sixth position on the G string.
   */
  upperPosition: number;
  /**
   * Charged for half position.
   *
   * Priced separately, and above the neck positions, because it is not one of
   * them: it is a first-position hand slid back by a semitone, and a line that
   * keeps dipping into it and back is the hand jumping, not settling.
   */
  halfPosition: number;
}

/**
 * Weights for anything this app arranges, where staying put beats everything.
 *
 * `DEFAULT_WEIGHTS` balances shifting against the things that make a *phrase*
 * sound good — not taking a long note on an open string it cannot vibrate, not
 * stretching when the closed frame would do. That is the right trade for a
 * player choosing a fingering for themselves.
 *
 * It is the wrong trade for a library somebody is learning from. Under the
 * default weights the solver climbs the neck to dodge an open string on any
 * note over 300 ms — a quarter note at a walking tempo — and across the 258
 * bundled songs it refused **37 % of the open strings available to it**,
 * answering an open A with a fourth finger in second position on the D string.
 * That is the wrong answer for a player with tapes on the fingerboard, for
 * whom the open string is the reference pitch, and it was the direct cause of
 * "instead of playing 0 on a string it's playing 5 on another".
 *
 * So shifting is weighted heavily enough here that the hand moves only when the
 * alternative is genuinely unplayable, the open-string penalty is cut to a
 * token, and the solver keeps everything else it is good at: choosing the
 * finger, the string and the extension.
 *
 * This was named `ARRANGEMENT_WEIGHTS` and described itself as the weighting
 * "for the bundled library" while every path that actually built the library —
 * `build-library.ts`, `inflateScore`, `arrangeScoreForLevel`, `importScore`,
 * `convert-score` — silently took `DEFAULT_WEIGHTS`. A name describing the
 * mechanism instead of the role is how a decision gets made and then not
 * applied, so the name now says what it is for, and
 * `fingering.test.ts` pins the call sites.
 */
export const ARRANGEMENT_WEIGHTS: CostWeights = {
  openStringOnLongNote: 0.25,
  longNoteMs: 300,
  // Set just above `CROSSING_COST`'s widest entry, so an open string can never
  // be refused in order to avoid a string crossing — which makes it a
  // guarantee in practice rather than a preference, and `fingering.test.ts`
  // holds it to that across the whole library. It costs nothing elsewhere:
  // raising it to here *lowered* the library's hand movement, because an open
  // string is the one note that needs no hand at all.
  openStringBonus: 8,
  // Reaching is dearer than moving. A forward extension repeated through a
  // passage is the thing that tires a hand and pulls it out of tune, and it is
  // what the solver reached for whenever a position change looked expensive —
  // answering a C sharp with an extended little finger bar after bar instead
  // of putting the hand where the passage plainly sits.
  forwardExtension: 2.6,
  backwardExtension: 1.4,
  fourthFingerInThumb: 6,
  shift: 26,
  heelCrossing: 2.5,
  // Second, third and fourth position are ordinary places to play, not last
  // resorts. Nearly free, so the frame lands where the music is.
  neckPosition: 0.08,
  // Leaving the neck is not. Nothing this app arranges needs to.
  upperPosition: 4,
  // Half position is still discouraged: it is where the old fixed mapping put
  // every semitone-above-the-nut note, and it is the flapping this fixes.
  halfPosition: 1.1,
};

export const DEFAULT_WEIGHTS: CostWeights = {
  openStringOnLongNote: 1.4,
  longNoteMs: 300,
  openStringBonus: 0,
  forwardExtension: 1.2,
  backwardExtension: 0.7,
  fourthFingerInThumb: 6,
  shift: 2.5,
  heelCrossing: 1.5,
  neckPosition: 0.3,
  upperPosition: 1.8,
  halfPosition: 0.2,
};

/**
 * Comfort of holding the hand at an anchor with nothing stopped under it,
 * on the same 0.3-per-position scale the neck positions use.
 */
function idleAnchorCost(semitones: number): number {
  return Math.max(0, semitones - POSITION_BASE_SEMITONES['1st']) * 0.3;
}

export function emissionCost(
  state: CelloState, note: RawNoteEvent, w: CostWeights = DEFAULT_WEIGHTS,
): number {
  let cost = 0;

  const posIndex = POSITION_ORDER[state.position];
  if (state.position === '1st') cost += 0;
  else if (state.position === 'Half') cost += w.halfPosition;
  else if (posIndex <= 4) cost += w.neckPosition * posIndex;
  else if (posIndex <= 7) cost += w.upperPosition + 0.4 * (posIndex - 4);
  // Thumb position is cheap for genuinely high notes and absurd for low ones.
  else cost += note.midiNumber >= 69 ? 0.8 : 3;

  if (state.extension === 'forward') cost += w.forwardExtension;
  else if (state.extension === 'backward') cost += w.backwardExtension;

  if (state.finger === '0') {
    cost += note.durationMs < w.longNoteMs ? 0.2 : w.openStringOnLongNote;
    cost -= w.openStringBonus;
    // The hand is still somewhere. An open string costs no shift to reach —
    // nothing is stopped — but holding the arm out at seventh position while
    // no finger is down is a posture, not a rest, and left uncharged the
    // solver would open a line up the neck for nothing and then stay there.
    cost += idleAnchorCost(handSemitones(state));
  } else if (state.finger === '4' && state.position === 'Thumb') {
    cost += w.fourthFingerInThumb;
  }

  return cost;
}

/** Same string 0, neighbour 1, skip one 3.5, C to A 7. */
const CROSSING_COST = [0, 1, 3.5, 7];

/**
 * Reference shift: first position to fourth, 154 mm. One of these is "a
 * shift" in the ordinary sense, and its cost is the unit everything else is
 * measured against.
 */
const REFERENCE_SHIFT_MM = stopDistanceMm(POSITION_BASE_SEMITONES['4th'])
  - stopDistanceMm(POSITION_BASE_SEMITONES['1st']);

/**
 * The anchor at which the hand leaves the neck.
 *
 * Fourth position sits at 7 semitones and fifth at 9, so anything from 8
 * upwards has passed the heel and the thumb has to come off the neck.
 */
const NECK_HEEL_SEMITONES = POSITION_BASE_SEMITONES['4th'] + 1;

export function transitionCost(
  from: CelloState, to: CelloState, deltaTMs: number, w: CostWeights = DEFAULT_WEIGHTS,
): number {
  const deltaTSec = Math.max(deltaTMs / 1000, 0.05);
  const crossing = CROSSING_COST[Math.abs(STRING_INDEX[from.string] - STRING_INDEX[to.string])] ?? 7;

  // Distance is measured in millimetres of actual arm travel, not in position
  // numbers. Positions are not evenly spaced — first to second is 67 mm while
  // sixth to seventh is 15 mm — so counting them punishes low shifts and
  // waves through high ones. Millimetres also let thumb-position adjustments
  // cost what they really cost, which is very little.
  const fromMm = stopDistanceMm(handSemitones(from));
  const toMm = stopDistanceMm(handSemitones(to));
  const distance = Math.abs(fromMm - toMm) / REFERENCE_SHIFT_MM;
  if (distance < 1e-9) return crossing;

  // Effort grows with the square of the distance and shrinks with the time
  // available: the same shift is trivial over a half note and violent over a
  // semiquaver.
  //
  // The heel is read off the hand's anchor, not off the position label. Those
  // agree for every stopped note — fourth position anchors below the heel and
  // fifth above it — and they disagree for an open string, which is written as
  // first position wherever the hand happens to be waiting. Labels would call
  // every open string a trip past the heel and back.
  const crossesHeel = (handSemitones(from) < NECK_HEEL_SEMITONES)
    !== (handSemitones(to) < NECK_HEEL_SEMITONES);
  const shift = ((distance ** 2) / Math.pow(deltaTSec, 0.8)) * (crossesHeel ? w.heelCrossing : 1) * w.shift;
  return crossing + shift;
}

// ─── Viterbi ─────────────────────────────────────────────────────────────────

export interface SolveResult {
  states: CelloState[];
  totalCost: number;
}

export function solveFingering(
  notes: readonly RawNoteEvent[],
  w: CostWeights = DEFAULT_WEIGHTS,
  candidates: (midi: number) => CelloState[] = candidateStates,
): SolveResult {
  if (notes.length === 0) return { states: [], totalCost: 0 };

  const trellis = notes.map((n) => candidates(n.midiNumber));
  const unreachable = trellis.findIndex((c) => c.length === 0);
  if (unreachable >= 0) {
    throw new Error(
      `MIDI ${notes[unreachable]?.midiNumber} is not playable on a cello in standard tuning (note ${unreachable})`,
    );
  }

  // Each column of the trellis and its note are bound once per step rather than
  // indexed repeatedly. The guards cannot fire — `trellis` is built from `notes`
  // and the empty-column case threw above — but binding them is how the
  // compiler is told that, and it reads better than the index soup it replaces.
  const firstColumn = trellis[0];
  const firstNote = notes[0];
  if (!firstColumn || !firstNote) return { states: [], totalCost: 0 };

  let costs = firstColumn.map((s) => emissionCost(s, firstNote, w));
  const backpointers: number[][] = [new Array(firstColumn.length).fill(-1)];

  for (let t = 1; t < notes.length; t++) {
    const note = notes[t];
    const previousNote = notes[t - 1];
    const column = trellis[t];
    const previousColumn = trellis[t - 1];
    if (!note || !previousNote || !column || !previousColumn) continue;

    const deltaT = note.startTimeMs - previousNote.startTimeMs;
    const next = new Array<number>(column.length);
    const back = new Array<number>(column.length);

    for (let j = 0; j < column.length; j++) {
      const to = column[j];
      if (!to) continue;
      const emit = emissionCost(to, note, w);
      let best = Infinity;
      let bestIndex = -1;
      for (let i = 0; i < previousColumn.length; i++) {
        const from = previousColumn[i];
        if (!from) continue;
        const total = (costs[i] ?? Infinity) + transitionCost(from, to, deltaT, w) + emit;
        if (total < best) { best = total; bestIndex = i; }
      }
      next[j] = best;
      back[j] = bestIndex;
    }

    costs = next;
    backpointers.push(back);
  }

  let index = costs.reduce((best, c, i) => (c < (costs[best] ?? Infinity) ? i : best), 0);
  const totalCost = costs[index] ?? 0;

  const states: CelloState[] = new Array(notes.length);
  for (let t = notes.length - 1; t >= 0; t--) {
    const chosen = trellis[t]?.[index];
    if (!chosen) break;
    states[t] = chosen;
    index = backpointers[t]?.[index] ?? 0;
  }

  return { states, totalCost };
}

/**
 * Where the hand shifts, and how much warning the player gets. The Tab and
 * Score visions draw these ahead of time — a shift you see coming two beats
 * out is a different move from one you discover on arrival.
 */
export interface Shift {
  noteIndex: number;
  from: CelloPosition;
  to: CelloPosition;
  /** Milliseconds between the previous note starting and this one. */
  preparationMs: number;
  direction: 'up' | 'down';
}

export function detectShifts(
  notes: readonly RawNoteEvent[], states: readonly CelloState[],
): Shift[] {
  const shifts: Shift[] = [];
  for (let i = 1; i < states.length; i++) {
    const previous = states[i - 1];
    const current = states[i];
    const note = notes[i];
    const previousNote = notes[i - 1];
    if (!previous || !current || !note || !previousNote) continue;
    // An open string is not a hand position — the hand has not moved yet.
    if (current.finger === '0' || previous.finger === '0') continue;

    // Compare anchors rather than labels, so sliding the thumb from the octave
    // harmonic up a third registers as the shift it is.
    const fromBase = handSemitones(previous);
    const toBase = handSemitones(current);
    if (fromBase === toBase) continue;

    shifts.push({
      noteIndex: i,
      from: previous.position,
      to: current.position,
      preparationMs: note.startTimeMs - previousNote.startTimeMs,
      direction: toBase > fromBase ? 'up' : 'down',
    });
  }
  return shifts;
}

// ─── Seating a line ──────────────────────────────────────────────────────────

/**
 * Where the left hand goes for a whole line — the one seating every entry path
 * should use.
 *
 * This replaces a per-note lookup. A lookup cannot answer the question, because
 * the question is not "where does this note live" but "where should the hand be
 * for this passage": the same C sharp is a second finger in third position in
 * one bar and an extension in first in another, and only the notes either side
 * of it decide which. Seating each note independently is what produced a line
 * that dropped into half position for one semitone and climbed straight back
 * out — a move no hand can make at speed, written into the library hundreds of
 * times over.
 *
 * Weighted for arranging by default: the hand stays put unless moving is
 * genuinely better, second to fourth position are ordinary places to be, and
 * half position and repeated extensions are what the solver avoids.
 */
export interface SeatOptions {
  weights?: CostWeights;
  /**
   * Refuse extensions, for the levels that teach the closed hand frame.
   *
   * Cheap to honour now and it was not before. Under a fixed first-position
   * mapping the sixth semitone of a string had exactly one seat — the fourth
   * finger stretched forward — so "no extensions" and "play this note" were in
   * direct conflict. Reading the whole line, the same pitch is an ordinary
   * second finger in third position, so the closed frame costs nothing but a
   * shift the solver was going to consider anyway.
   *
   * Applied per note and never fatally: a pitch with no closed-frame seat
   * anywhere keeps its full candidate set rather than making the line
   * unplayable.
   */
  closedFrameOnly?: boolean;
}

export function seatLine(
  notes: readonly RawNoteEvent[], options: SeatOptions = {},
): CelloState[] {
  if (notes.length === 0) return [];
  const { weights = ARRANGEMENT_WEIGHTS, closedFrameOnly = false } = options;

  const candidates = closedFrameOnly
    ? (midi: number) => {
      const all = candidateStates(midi);
      const closed = all.filter((state) => state.extension === 'none');
      return closed.length > 0 ? closed : all;
    }
    : candidateStates;

  return solveFingering(notes, weights, candidates).states;
}

/**
 * How many times the hand's anchor moves across a seated line.
 *
 * The number this whole cost model exists to keep down, and the one a test can
 * hold a regression against. Counted on the anchor rather than the position
 * name because those disagree for open strings, which move no hand at all.
 */
export function handMoves(states: readonly CelloState[]): number {
  let moves = 0;
  for (let i = 1; i < states.length; i++) {
    const previous = states[i - 1];
    const current = states[i];
    if (!previous || !current) continue;
    if (handSemitones(previous) !== handSemitones(current)) moves++;
  }
  return moves;
}

// ─── Beginner mapping ────────────────────────────────────────────────────────

/**
 * Where a first-position player puts a note.
 *
 * The solver above chooses freely across the whole instrument. This does not:
 * it is the fixed mapping the bundled library is written against, where every
 * piece stays in first position and each string covers a fixed span. Given a
 * pitch it answers with the one place a beginner would take it.
 *
 * It lives here rather than in the build tool because it is instrument
 * knowledge, not build mechanics — and because it used to live in three places
 * at once (the tool, the tool's emit template, and the generated file), so a
 * single-line fix to the top of its range had to be made three times and was
 * wrong once.
 *
 * Throws above D#4. The caller is expected to have transposed into range, and a
 * plausible-looking unplayable fingering is worse than a stopped build.
 */
export function firstPositionFingering(midi: number): CelloState {
  const closed: Record<number, { finger: CelloFinger; position: CelloPosition; base: number }> = {
    0: { finger: '0', position: '1st', base: 2 },
    1: { finger: '1', position: 'Half', base: 1 },
    2: { finger: '1', position: '1st', base: 2 },
    3: { finger: '2', position: '1st', base: 2 },
    4: { finger: '3', position: '1st', base: 2 },
    5: { finger: '4', position: '1st', base: 2 },
  };

  const string: CelloString = midi <= 42 ? 'C' : midi <= 49 ? 'G' : midi <= 56 ? 'D' : 'A';
  const semitones = midi - OPEN_STRING_MIDI[string];

  const seat = closed[semitones];
  if (seat) {
    return {
      string,
      position: seat.position,
      finger: seat.finger,
      extension: 'none',
      baseSemitones: seat.base,
    };
  }

  // A forward-extended fourth finger reaches one semitone past the closed frame
  // and no further.
  if (semitones === 6) {
    return { string, position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  }

  throw new RangeError(
    `MIDI ${midi} cannot be played in first position on the ${string} string. `
    + 'Transpose the line into range before assigning fingerings.',
  );
}
