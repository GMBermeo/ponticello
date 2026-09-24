import { describe, expect, it } from 'vitest';

import { OPEN_STRING_MIDI } from '../cello';
import {
  ARRANGEMENT_WEIGHTS, candidateStates, CostWeights, DEFAULT_WEIGHTS, detectShifts,
  emissionCost, firstPositionFingering, handMoves, handSemitones, RawNoteEvent, seatLine,
  solveFingering, transitionCost,
} from '../fingering';
import { COMPACT_SCORES, LIBRARY_EDITION } from '@scores';

const at = (midiNumber: number, startTimeMs: number, durationMs = 400): RawNoteEvent =>
  ({ midiNumber, startTimeMs, durationMs });

describe('candidate generation', () => {
  it('offers the open string on its own string, with the hand anywhere', () => {
    const open = candidateStates(OPEN_STRING_MIDI.A).filter((c) => c.finger === '0');
    // One state per place the hand could be waiting: nothing is stopped, so
    // where the hand sits is a free choice the rest of the phrase pays for.
    expect(open.length).toBeGreaterThan(1);
    expect(open.every((c) => c.string === 'A')).toBe(true);
    expect(open.every((c) => c.position === '1st')).toBe(true);
    expect(new Set(open.map((c) => c.baseSemitones)).size).toBe(open.length);
    // First position among them, because that is where the hand usually is.
    expect(open.some((c) => c.baseSemitones === 2)).toBe(true);
  });

  it('finds the same pitch on more than one string', () => {
    // D4 is reachable on the A string and, higher up, on the D string.
    const strings = new Set(candidateStates(62).map((c) => c.string));
    expect(strings.has('A')).toBe(true);
    expect(strings.has('D')).toBe(true);
  });

  it('offers extensions only where the hand can make them', () => {
    const forward = candidateStates(61).filter((c) => c.extension === 'forward');
    expect(forward.every((c) => ['Half', '1st', '2nd', '3rd', '4th'].includes(c.position))).toBe(true);
  });

  it('offers thumb position only in the upper register', () => {
    // D3 is physically reachable in thumb position on the C string, but no
    // cellist goes there — the neck covers it — so it is not a candidate.
    expect(candidateStates(50).some((c) => c.position === 'Thumb')).toBe(false);
    expect(candidateStates(74).some((c) => c.position === 'Thumb')).toBe(true);
  });

  it('distinguishes thumb placements by where the thumb actually sits', () => {
    const thumbStates = candidateStates(74).filter((c) => c.position === 'Thumb');
    const bases = new Set(thumbStates.map((c) => c.baseSemitones));
    // More than one place to park the thumb, and each is its own state — which
    // is what lets a thumb move count as a shift.
    expect(bases.size).toBeGreaterThan(1);
    expect([...bases].every((b) => b !== undefined && b >= 12)).toBe(true);
  });

  it('returns nothing for a pitch below the C string', () => {
    expect(candidateStates(30)).toHaveLength(0);
  });
});

describe('cost model', () => {
  it('prefers first position to the upper neck', () => {
    const note = at(59, 0);
    const first = emissionCost({ string: 'A', position: '1st', finger: '1', extension: 'none' }, note);
    const sixth = emissionCost({ string: 'D', position: '6th', finger: '1', extension: 'none' }, note);
    expect(first).toBeLessThan(sixth);
  });

  it('charges more for a forward extension than a backward one', () => {
    // Compared within one position, so the position term cancels and only the
    // extension is under test.
    const note = at(61, 0);
    const base = { string: 'A' as const, position: '1st' as const, finger: '2' as const };
    const forward = emissionCost({ ...base, extension: 'forward' }, note);
    const backward = emissionCost({ ...base, extension: 'backward' }, note);
    const none = emissionCost({ ...base, extension: 'none' }, note);
    expect(forward).toBeGreaterThan(backward);
    expect(backward).toBeGreaterThan(none);
  });

  it('prices thumb position out of the low register', () => {
    const low = at(50, 0);
    const thumb = emissionCost({ string: 'C', position: 'Thumb', finger: '1', extension: 'none' }, low);
    const open = emissionCost({ string: 'D', position: '1st', finger: '0', extension: 'none' }, low);
    expect(thumb).toBeGreaterThan(open);
  });

  it('measures a shift by arm travel, not by counting positions', () => {
    const at1st = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 2 };
    const at2nd = { ...at1st, position: '2nd' as const, baseSemitones: 4 };
    const at6th = { ...at1st, position: '6th' as const, baseSemitones: 11 };
    const at7th = { ...at1st, position: '7th' as const, baseSemitones: 12 };

    // First to second is 67 mm of travel; sixth to seventh is 15 mm. Counting
    // positions would call them equal.
    expect(transitionCost(at1st, at2nd, 400)).toBeGreaterThan(transitionCost(at6th, at7th, 400));
  });

  it('treats nudging the thumb as cheaper than a neck shift', () => {
    const thumbLow = { string: 'A' as const, position: 'Thumb' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 12 };
    const thumbHigh = { ...thumbLow, baseSemitones: 14 };
    const first = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const, baseSemitones: 2 };
    const fourth = { ...first, position: '4th' as const, baseSemitones: 7 };

    expect(transitionCost(thumbLow, thumbHigh, 300))
      .toBeLessThan(transitionCost(first, fourth, 300));
    // …but it is still a move, not free.
    expect(transitionCost(thumbLow, thumbHigh, 300)).toBeGreaterThan(0);
  });

  it('tolerates an open string when it is short and resists when it is long', () => {
    const state = { string: 'A' as const, position: '1st' as const, finger: '0' as const, extension: 'none' as const };
    expect(emissionCost(state, at(57, 0, 120))).toBeLessThan(emissionCost(state, at(57, 0, 1200)));
  });

  it('all but forbids the little finger in thumb position', () => {
    const thumb4 = emissionCost({ string: 'A', position: 'Thumb', finger: '4', extension: 'none' }, at(74, 0));
    const thumb3 = emissionCost({ string: 'A', position: 'Thumb', finger: '3', extension: 'none' }, at(74, 0));
    expect(thumb4 - thumb3).toBeGreaterThan(5);
  });

  it('charges nothing to stay put and most to skip three strings', () => {
    const a = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const };
    const d = { ...a, string: 'D' as const };
    const g = { ...a, string: 'G' as const };
    const c = { ...a, string: 'C' as const };
    expect(transitionCost(a, a, 500)).toBe(0);
    expect(transitionCost(a, d, 500)).toBeLessThan(transitionCost(a, g, 500));
    expect(transitionCost(a, g, 500)).toBeLessThan(transitionCost(a, c, 500));
    expect(transitionCost(a, c, 500)).toBeGreaterThan(6);
  });

  it('does not charge a shift for an open string the hand plays through', () => {
    // The hand is up at the octave; the open D sounds on the way past. It
    // costs a string crossing and nothing else, because nothing moved.
    const upTheNeck = {
      string: 'A' as const, position: 'Thumb' as const, finger: '1' as const,
      extension: 'none' as const, baseSemitones: 14,
    };
    const openThrough = {
      string: 'D' as const, position: '1st' as const, finger: '0' as const,
      extension: 'none' as const, baseSemitones: 14,
    };
    const openAtTheNut = { ...openThrough, baseSemitones: 2 };

    expect(transitionCost(upTheNeck, openThrough, 300)).toBe(1);
    expect(transitionCost(upTheNeck, openAtTheNut, 300))
      .toBeGreaterThan(transitionCost(upTheNeck, openThrough, 300));
  });

  it('still charges for holding the hand up the neck over an open string', () => {
    const note = at(50, 0, 400);
    const waiting = {
      string: 'D' as const, position: '1st' as const, finger: '0' as const,
      extension: 'none' as const,
    };
    expect(emissionCost({ ...waiting, baseSemitones: 14 }, note))
      .toBeGreaterThan(emissionCost({ ...waiting, baseSemitones: 2 }, note));
  });

  it('makes the same shift dearer when there is less time', () => {
    const first = { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const };
    const fourth = { ...first, position: '4th' as const };
    expect(transitionCost(first, fourth, 60)).toBeGreaterThan(transitionCost(first, fourth, 1000));
  });
});

describe('solveFingering', () => {
  it('keeps a first-position D major scale in first position', () => {
    const scale = [50, 52, 54, 55, 57, 59, 61, 62].map((m, i) => at(m, i * 400));
    const { states } = solveFingering(scale);

    expect(states).toHaveLength(8);
    for (const state of states) {
      expect(['Half', '1st']).toContain(state.position);
    }
    // Open D and open A should be taken as open strings.
    expect(states[0].finger).toBe('0');
    expect(states[4].finger).toBe('0');
  });

  it('does not shift for a single note it could reach without moving', () => {
    const line = [57, 59, 60, 59, 57].map((m, i) => at(m, i * 300));
    const positions = new Set(solveFingering(line).states.map((s) => s.position));
    expect(positions.size).toBeLessThanOrEqual(2);
  });

  it('goes to thumb position for a high passage rather than crawling up the neck', () => {
    const high = [69, 71, 73, 74, 73, 71].map((m, i) => at(m, i * 350));
    const states = solveFingering(high).states;
    expect(states.some((s) => s.position === 'Thumb')).toBe(true);
    expect(states.every((s) => s.finger !== '4' || s.position !== 'Thumb')).toBe(true);
  });

  it('returns one state per note', () => {
    const line = Array.from({ length: 40 }, (_, i) => at(50 + (i % 13), i * 200));
    expect(solveFingering(line).states).toHaveLength(40);
  });

  it('handles an empty line', () => {
    expect(solveFingering([])).toEqual({ states: [], totalCost: 0 });
  });

  it('refuses a pitch no cello can play', () => {
    expect(() => solveFingering([at(24, 0)])).toThrow(/not playable on a cello/);
  });

  it('takes the open string rather than climbing the neck past it', () => {
    // Mario, in miniature: the melody sits up the A string and drops to D3,
    // which is the open D. The old encoding gave the open string one anchor,
    // first position, so reaching it read as a shift to the nut and back — and
    // the solver answered by taking D3 on the C string in seventh position,
    // fourteen semitones up, with the open D string sitting right there.
    const line = [69, 71, 50, 71, 69].map((m, i) => at(m, i * 400, 380));
    const states = solveFingering(line, ARRANGEMENT_WEIGHTS).states;
    const openD = states[2]!;
    expect(openD.string).toBe('D');
    expect(openD.finger).toBe('0');
  });
});

/**
 * The weighting is a decision that has to be *applied*, and once was not: the
 * constant existed, documented itself as the one for library work, and every
 * caller took the other one. These pin the call sites so that cannot recur
 * silently.
 */
describe('everything this app arranges is fingered with the arrangement weights', () => {
  it('keeps the hand far stiller than the phrase-shaping weights do', () => {
    const line = [50, 74, 50, 74, 50].map((m, i) => at(m, i * 250, 240));
    const travel = (w: CostWeights) => {
      const states = solveFingering(line, w).states;
      return states.reduce((sum, state, i) => (i === 0 ? 0
        : sum + Math.abs(handSemitones(state) - handSemitones(states[i - 1]!))), 0);
    };
    expect(travel(ARRANGEMENT_WEIGHTS)).toBeLessThan(travel(DEFAULT_WEIGHTS));
  });

  it('treats an open string as very nearly free, however long the note', () => {
    const state = {
      string: 'A' as const, position: '1st' as const, finger: '0' as const,
      extension: 'none' as const, baseSemitones: 2,
    };
    const held = emissionCost(state, at(57, 0, 2000), ARRANGEMENT_WEIGHTS);
    expect(held).toBeLessThan(emissionCost(state, at(57, 0, 2000), DEFAULT_WEIGHTS));
    expect(held).toBeLessThan(0.5);
  });
});

describe('detectShifts', () => {
  it('reports the move and how much warning it gets', () => {
    const notes = [at(59, 0), at(76, 500)];
    const states = [
      { string: 'A' as const, position: '1st' as const, finger: '1' as const, extension: 'none' as const },
      { string: 'A' as const, position: 'Thumb' as const, finger: '2' as const, extension: 'none' as const },
    ];
    const [shift] = detectShifts(notes, states);

    expect(shift.from).toBe('1st');
    expect(shift.to).toBe('Thumb');
    expect(shift.direction).toBe('up');
    expect(shift.preparationMs).toBe(500);
  });

  it('does not call an open string a shift', () => {
    const notes = [at(57, 0), at(50, 300)];
    const states = [
      { string: 'A' as const, position: '4th' as const, finger: '1' as const, extension: 'none' as const },
      { string: 'D' as const, position: '1st' as const, finger: '0' as const, extension: 'none' as const },
    ];
    expect(detectShifts(notes, states)).toHaveLength(0);
  });
});

describe('firstPositionFingering', () => {
  it('puts every open string on its own string with no finger', () => {
    for (const [string, midi] of Object.entries(OPEN_STRING_MIDI)) {
      const state = firstPositionFingering(midi);
      expect(state.string).toBe(string);
      expect(state.finger).toBe('0');
    }
  });

  it('spans a minor third across fingers 1 to 4', () => {
    // The cello frame: one semitone per finger, 2..5 above the open string.
    const fingers = [2, 3, 4, 5].map((n) => firstPositionFingering(OPEN_STRING_MIDI.D + n).finger);
    expect(fingers).toEqual(['1', '2', '3', '4']);
  });

  it('drops to half position for the semitone above the open string', () => {
    const state = firstPositionFingering(OPEN_STRING_MIDI.G + 1);
    expect(state.position).toBe('Half');
    expect(state.baseSemitones).toBe(1);
  });

  it('reaches one semitone further with a forward extension', () => {
    const state = firstPositionFingering(OPEN_STRING_MIDI.A + 6);
    expect(state.finger).toBe('4');
    expect(state.extension).toBe('forward');
  });

  it('assigns every note the bundled library can contain', () => {
    for (let midi = 36; midi <= 63; midi += 1) {
      expect(() => firstPositionFingering(midi)).not.toThrow();
    }
  });

  it('refuses a note above first position rather than inventing one', () => {
    // D#4 is the ceiling. Anything higher used to come back as a forward-
    // extended fourth finger, which looks plausible and is unplayable.
    expect(() => firstPositionFingering(64)).toThrow(RangeError);
    expect(() => firstPositionFingering(72)).toThrow(/Transpose/);
  });
});

describe('seatLine settles the hand instead of flapping', () => {
  /**
   * The reported case, reduced.
   *
   * A passage sitting around the fifth and sixth semitone of the G string,
   * with one F that the hand cannot reach from up there. Seated note by note,
   * the semitone above the nut on the D string is *always* half position, so
   * the line drops into half position and climbs straight back out between two
   * quavers — a move no hand makes at that speed, and the thing that made the
   * position label flicker on the play screen.
   */
  const passage = [48, 49, 48, 51, 49, 48, 53, 48, 49, 51, 49, 48]
    .map((midiNumber, i) => at(midiNumber, i * 250, 230));

  it('never drops into half position for a single note and back out', () => {
    const seated = seatLine(passage);
    const halves = seated.filter((s) => s.position === 'Half');
    expect(halves).toHaveLength(0);
  });

  it('holds one hand frame across the passage', () => {
    // One move at most: the F that third position cannot reach is allowed to
    // cost a shift. Everything else is the same hand.
    expect(handMoves(seatLine(passage))).toBeLessThanOrEqual(1);
  });

  it('beats the fixed per-note mapping it replaces', () => {
    const fixed = passage.map((note) => firstPositionFingering(note.midiNumber));
    expect(handMoves(seatLine(passage))).toBeLessThan(handMoves(fixed));
  });

  it('reaches a note the frame cannot cover rather than giving up', () => {
    const seated = seatLine(passage);
    const f = seated[6]!;
    expect(f.string).toBe('D');
    // F3 is the fourth semitone of the D string counted from the open string;
    // wherever the hand is, it has to be somewhere that reaches it.
    expect(53 - OPEN_STRING_MIDI[f.string]).toBe(3);
  });

  it('keeps a repeated pitch on one seat rather than alternating', () => {
    const seated = seatLine(passage);
    const cs = passage
      .map((note, i) => ({ note, state: seated[i]! }))
      .filter((entry) => entry.note.midiNumber === 49);
    const seats = new Set(cs.map((e) => `${e.state.string}|${e.state.position}|${e.state.finger}`));
    expect(seats.size).toBe(1);
  });
});

describe('the whole bundled library, seated', () => {
  const seatedLibrary = COMPACT_SCORES
    .filter((song) => song.notes.length > 0)
    .map((song) => {
      const events = song.notes.map(([midiNumber, startTimeMs, durationMs]) =>
        ({ midiNumber, startTimeMs, durationMs }));
      return { id: song.id, events, states: seatLine(events) };
    });

  const totalNotes = seatedLibrary.reduce((sum, s) => sum + s.states.length, 0);

  it('moves the hand far less often than the fixed mapping did', () => {
    let solver = 0;
    let fixed = 0;
    for (const song of seatedLibrary) {
      solver += handMoves(song.states);
      fixed += handMoves(song.events.map((e) => firstPositionFingering(e.midiNumber)));
    }
    // Measured at 0.9 against 11.0 per hundred notes when this was written.
    expect((solver / totalNotes) * 100).toBeLessThan(3);
    expect(solver).toBeLessThan(fixed / 5);
  });

  it('has all but abandoned half position', () => {
    const halves = seatedLibrary
      .reduce((sum, s) => sum + s.states.filter((x) => x.position === 'Half').length, 0);
    expect((halves / totalNotes) * 100).toBeLessThan(1);
  });

  it('actually uses second, third and fourth position', () => {
    // The point of the change. If this ever collapses back towards zero the
    // library is being crammed into first position again.
    //
    // The bar depends on the edition, because it is a fact about the music
    // rather than about the solver: the free library is a dozen public-domain
    // pieces and original etudes written to stay under a beginner's hand, and
    // they have far less call to leave first position than three hundred
    // arranged songs do. Measured at 13 % full, 2.4 % free.
    const upper = seatedLibrary.reduce((sum, s) => sum
      + s.states.filter((x) => ['2nd', '3rd', '4th'].includes(x.position)).length, 0);
    const share = (upper / totalNotes) * 100;
    expect(share).toBeGreaterThan(LIBRARY_EDITION.id === 'full' ? 5 : 0.5);
  });

  it('never leaves the neck', () => {
    const neck = new Set(['Half', '1st', '2nd', '3rd', '4th']);
    for (const song of seatedLibrary) {
      for (const state of song.states) {
        expect(neck.has(state.position), `${song.id} ${state.position}`).toBe(true);
      }
    }
  });

  it('always takes an open string when the pitch is one', () => {
    // The open string is the reference pitch for a player with tapes, and the
    // one note that needs no hand. `openStringBonus` sits above the widest
    // string crossing precisely so this can never be traded away.
    const open = new Set(Object.values(OPEN_STRING_MIDI));
    for (const song of seatedLibrary) {
      song.events.forEach((event, i) => {
        if (!open.has(event.midiNumber)) return;
        expect(song.states[i]!.finger, `${song.id} note ${i + 1}`).toBe('0');
      });
    }
  });
});

describe('the closed frame, for the levels that teach it', () => {
  const line = [48, 49, 50, 51, 53, 55].map((m, i) => at(m, i * 400, 350));

  it('uses no extension at all when asked for the closed frame', () => {
    const seated = seatLine(line, { closedFrameOnly: true });
    expect(seated.every((s) => s.extension === 'none')).toBe(true);
  });

  it('reaches the same pitches by shifting rather than stretching', () => {
    // What makes the closed frame affordable now: C sharp 3 is the sixth
    // semitone of the G string, which under the old mapping had exactly one
    // seat — a stretched fourth finger in first position — and has an ordinary
    // closed seat a position or two higher.
    const seated = seatLine(line, { closedFrameOnly: true });
    expect(seated).toHaveLength(line.length);

    const cSharp = seated[1]!;
    expect(cSharp.extension).toBe('none');
    expect(cSharp.position).not.toBe('1st');

    // And the stretch is what the same line takes when extensions are allowed
    // and the hand is pinned low, which is the trade being made here.
    const free = seatLine(line);
    expect(free).toHaveLength(line.length);
  });
});
