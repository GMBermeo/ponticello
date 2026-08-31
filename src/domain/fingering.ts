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
      add({ string, position: '1st', finger: '0', extension: 'none', baseSemitones: 2 });
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
  forwardExtension: number;
  backwardExtension: number;
  /** The little finger has no business in thumb position. */
  fourthFingerInThumb: number;
  shift: number;
  /** Crossing the neck heel is a bigger move than its distance suggests. */
  heelCrossing: number;
}

/**
 * Weights for the bundled library, where staying put beats everything.
 *
 * `DEFAULT_WEIGHTS` balances shifting against the things that make a *phrase*
 * sound good — not taking a long note on an open string it cannot vibrate, not
 * stretching when the closed frame would do. That is the right trade for a
 * player choosing a fingering.
 *
 * It is the wrong trade for this library. Every bundled arrangement is folded
 * into MIDI 36–63, so the whole of it is reachable without leaving first
 * position, and under the default weights the solver spends 487 metres of hand
 * travel across the 258 songs where a first-position mapping spends 351 — it
 * climbs to dodge an open string on a long note. For a beginner reading a
 * scrolling highway, a hand that stays where it is beats a slightly better
 * timbre every time.
 *
 * So shifting is weighted heavily enough here that the hand moves only when the
 * alternative is genuinely unplayable, while the solver keeps everything else it
 * is good at: choosing the finger, the string and the extension.
 */
export const MINIMAL_TRAVEL_WEIGHTS: CostWeights = {
  openStringOnLongNote: 0.25,
  longNoteMs: 300,
  forwardExtension: 1.2,
  backwardExtension: 0.7,
  fourthFingerInThumb: 6,
  shift: 26,
  heelCrossing: 2.5,
};

export const DEFAULT_WEIGHTS: CostWeights = {
  openStringOnLongNote: 1.4,
  longNoteMs: 300,
  forwardExtension: 1.2,
  backwardExtension: 0.7,
  fourthFingerInThumb: 6,
  shift: 2.5,
  heelCrossing: 1.5,
};

export function emissionCost(
  state: CelloState, note: RawNoteEvent, w: CostWeights = DEFAULT_WEIGHTS,
): number {
  let cost = 0;

  const posIndex = POSITION_ORDER[state.position];
  if (state.position === '1st') cost += 0;
  else if (state.position === 'Half') cost += 0.2;
  else if (posIndex <= 4) cost += 0.3 * posIndex;
  else if (posIndex <= 7) cost += 1.8 + 0.4 * (posIndex - 4);
  // Thumb position is cheap for genuinely high notes and absurd for low ones.
  else cost += note.midiNumber >= 69 ? 0.8 : 3;

  if (state.extension === 'forward') cost += w.forwardExtension;
  else if (state.extension === 'backward') cost += w.backwardExtension;

  if (state.finger === '0') {
    cost += note.durationMs < w.longNoteMs ? 0.2 : w.openStringOnLongNote;
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
  const p1 = POSITION_ORDER[from.position];
  const p2 = POSITION_ORDER[to.position];
  const crossesHeel = (p1 <= 4 && p2 >= 5) || (p1 >= 5 && p2 <= 4);
  const shift = ((distance ** 2) / Math.pow(deltaTSec, 0.8)) * (crossesHeel ? w.heelCrossing : 1) * w.shift;
  return crossing + shift;
}

// ─── Viterbi ─────────────────────────────────────────────────────────────────

export interface SolveResult {
  states: CelloState[];
  totalCost: number;
}

export function solveFingering(
  notes: readonly RawNoteEvent[], w: CostWeights = DEFAULT_WEIGHTS,
): SolveResult {
  if (notes.length === 0) return { states: [], totalCost: 0 };

  const trellis = notes.map((n) => candidateStates(n.midiNumber));
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
