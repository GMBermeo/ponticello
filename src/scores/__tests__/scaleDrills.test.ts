import { describe, expect, it } from 'vitest';

import {
  OPEN_STRING_MIDI, midiToPitchName, firstPositionFingering, canonicalKeyName, fifthsOf,
  keyDemand, openStringTonic, parseKeyName, validateScore,
} from '@domain';
import {
  KEY_NOTES, SCALE_DRILLS, SCALE_DRILL_BACKINGS, SCALE_DRILL_KEYS, firstPositionVerdict,
} from '../scaleDrills';
import { KEY_PRACTICE_ROWS, LIBRARY_KEY_CENSUS, LIBRARY_ROWS } from '@scores';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

/** Pitch classes a drill is allowed to use: its key, plus step 3's other mode. */
function allowedPitchClasses(tonic: number, mode: 'major' | 'minor', step: number): Set<number> {
  const steps = mode === 'major' ? MAJOR : NATURAL_MINOR;
  const allowed = new Set(steps.map((s) => (tonic + s) % 12));
  if (step === 3) {
    const other = mode === 'minor' ? HARMONIC_MINOR : NATURAL_MINOR;
    for (const s of other) allowed.add((tonic + s) % 12);
  }
  return allowed;
}

const cases = SCALE_DRILLS.map((score) => [score.id, score] as const);

describe('scale drills', () => {
  it('authors one drill per step for each drilled key', () => {
    expect(SCALE_DRILLS.length).toBeGreaterThan(0);
    expect(new Set(SCALE_DRILLS.map((s) => s.id)).size).toBe(SCALE_DRILLS.length);

    const steps = new Map<string, number[]>();
    for (const score of SCALE_DRILLS) {
      const drill = SCALE_DRILL_KEYS[score.id];
      expect(drill, `${score.id} is not registered in SCALE_DRILL_KEYS`).toBeDefined();
      const list = steps.get(drill!.key) ?? [];
      list.push(drill!.step);
      steps.set(drill!.key, list);
    }
    // Steps run 1, 2, 3 with no gaps — a key cannot have an Advanced drill and
    // no Beginner one to arrive from.
    for (const [key, list] of steps) {
      expect(list, key).toEqual(list.map((_, i) => i + 1));
      expect(list.length, key).toBeLessThanOrEqual(3);
    }
  });

  it.each(cases)('%s passes structural validation', (_id, score) => {
    expect(validateScore(score)).toEqual([]);
  });

  // The guardrail the whole library is built on. Every note of every drill has
  // to be a note `firstPositionFingering` will seat — and the authored seat has
  // to be the one it chooses, or a player who learns a key here would find
  // different fingers waiting in the songs written in it.
  it.each(cases)('%s is first-position playable, note for note', (_id, score) => {
    for (const note of score.notes) {
      const seat = firstPositionFingering(note.midiNumber);
      expect(seat.string, note.pitchName).toBe(note.string);
      expect(seat.finger, note.pitchName).toBe(note.finger);
      expect(seat.position, note.pitchName).toBe(note.position);
      expect(seat.extension, note.pitchName).toBe(note.extension);
      // And the pitch agrees with where it is stopped.
      expect(note.midiNumber - OPEN_STRING_MIDI[note.string])
        .toBe(note.midiNumber - OPEN_STRING_MIDI[seat.string]);
    }
  });

  it.each(cases)('%s stays inside first position, C2 to D♯4', (_id, score) => {
    for (const note of score.notes) {
      expect(note.midiNumber).toBeGreaterThanOrEqual(36);
      expect(note.midiNumber).toBeLessThanOrEqual(63);
      const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
      expect(semitones).toBeGreaterThanOrEqual(0);
      expect(semitones).toBeLessThanOrEqual(6);
      expect(['1st', 'Half']).toContain(note.position);
      expect(note.extension).not.toBe('backward');
    }
  });

  it.each(cases)('%s only plays notes that belong to its key', (_id, score) => {
    const drill = SCALE_DRILL_KEYS[score.id]!;
    const allowed = allowedPitchClasses(drill.tonic, drill.mode, drill.step);
    for (const note of score.notes) {
      expect(allowed.has(note.midiNumber % 12), `${score.id}: ${note.pitchName}`).toBe(true);
    }
  });

  it.each(cases)('%s starts and ends on the tonic', (_id, score) => {
    const drill = SCALE_DRILL_KEYS[score.id]!;
    const first = score.notes[0]!;
    const last = score.notes[score.notes.length - 1]!;
    expect(first.midiNumber % 12, `${score.id} opens on ${first.pitchName}`).toBe(drill.tonic);
    expect(last.midiNumber % 12, `${score.id} closes on ${last.pitchName}`).toBe(drill.tonic);
  });

  it.each(cases)('%s is spelled the way its key signature is', (_id, score) => {
    // Flat keys with a plain-letter tonic are the trap: F major, D minor and
    // G minor all want flats, and naming them from the tonic's own spelling
    // gets every one of them wrong.
    const drill = SCALE_DRILL_KEYS[score.id]!;
    const flats = fifthsOf({ tonic: drill.tonic, mode: drill.mode }) < 0;
    expect(score.metadata.preferFlats, drill.key).toBe(flats);
    for (const note of score.notes) {
      expect(note.pitchName).toBe(midiToPitchName(note.midiNumber, flats));
      if (flats) expect(note.pitchName, `${drill.key}: ${note.pitchName}`).not.toMatch(/#/);
      else expect(note.pitchName, `${drill.key}: ${note.pitchName}`).not.toMatch(/b\d/);
    }
  });

  it.each(cases)('%s takes its tempo from the ABRSM cello table', (_id, score) => {
    // Initial ♪ = 76 (♩ = 38), Grade 1 ♩ = 44, Grade 2 ♩ = 50, Grade 3 ♩ = 54.
    expect([38, 44, 50, 54]).toContain(score.metadata.bpm);
    expect(score.metadata.timeSignature).toBe('4/4');
  });

  it.each(cases)('%s holds its final note, as "long tonic" requires', (_id, score) => {
    const notes = score.notes;
    const last = notes[notes.length - 1]!;
    const penultimate = notes[notes.length - 2]!;
    expect(last.durationMs).toBeGreaterThan(penultimate.durationMs);
    expect(last.articulation).toBe('tenuto');
  });
});

describe('the beginner tier is honestly beginner', () => {
  const beginners = SCALE_DRILLS.filter((s) => s.metadata.difficulty === 'Beginner');

  // Stated as a relationship rather than a count, because the drill set is
  // re-graded from the census every time the library is rebuilt: a key whose
  // easiest first-position octave needs no hand move MUST open with a Beginner
  // drill, and no first drill may be harder than the key's own easiest octave.
  it('opens every closed-hand key with a Beginner drill', () => {
    expect(beginners.length).toBeGreaterThan(0);
    const order = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
    for (const score of SCALE_DRILLS) {
      const drill = SCALE_DRILL_KEYS[score.id]!;
      if (drill.step !== 1) continue;
      const verdict = firstPositionVerdict(drill.tonic, drill.mode);
      if (verdict.tier === 'Beginner') {
        expect(score.metadata.difficulty, `${drill.key} has a closed-hand octave`).toBe('Beginner');
      }
      // A first drill may fall back to a fifth and so be *easier* than the
      // key's octave, but it must never be harder than it.
      expect(order.indexOf(score.metadata.difficulty), drill.key)
        .toBeLessThanOrEqual(order.indexOf(verdict.tier));
    }
  });

  it.each(beginners.map((s) => [s.id, s] as const))(
    '%s uses a closed hand: no extension, no half position',
    (_id, score) => {
      for (const note of score.notes) {
        expect(note.extension, note.pitchName).toBe('none');
        expect(note.position, note.pitchName).toBe('1st');
        expect(note.midiNumber - OPEN_STRING_MIDI[note.string]).toBeLessThanOrEqual(5);
      }
    },
  );

  it.each(beginners.map((s) => [s.id, s] as const))(
    '%s takes the open strings the key offers it',
    (_id, score) => {
      const drill = SCALE_DRILL_KEYS[score.id]!;
      const scale = allowedPitchClasses(drill.tonic, drill.mode, 1);
      // Open strings whose pitch belongs to the key and lies inside the drill's
      // own range — those are the ones it must not have passed over.
      const midis = score.notes.map((n) => n.midiNumber);
      const low = Math.min(...midis);
      const high = Math.max(...midis);
      const available = (['C', 'G', 'D', 'A'] as const).filter((s) => {
        const open = OPEN_STRING_MIDI[s];
        return scale.has(open % 12) && open >= low && open <= high;
      });
      const taken = new Set(score.notes.filter((n) => n.finger === '0').map((n) => n.string));
      for (const string of available) {
        expect(taken.has(string), `${score.id} skipped the open ${string} string`).toBe(true);
      }
    },
  );

  it('says so when the key has no beginner scale at all', () => {
    // A♭ major's tonic pitch class has no closed-frame seat anywhere in first
    // position, so it must not be labelled Beginner, and its own text has to
    // admit it rather than quietly presenting a stretchy scale as easy.
    const verdict = firstPositionVerdict(8, 'major');
    expect(verdict.tier).not.toBe('Beginner');
    expect(verdict.note).toMatch(/No closed-hand octave|no closed-frame seat/i);
  });

  it('never labels a stretched scale Beginner', () => {
    for (const score of SCALE_DRILLS) {
      const stretched = score.notes.some((n) => n.extension !== 'none' || n.position === 'Half');
      if (stretched) expect(score.metadata.difficulty, score.id).not.toBe('Beginner');
    }
  });
});

describe('the graded steps get harder, and stay honest', () => {
  it('never makes a later step easier than an earlier one', () => {
    const order = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
    const byKey = new Map<string, { step: number; tier: string }[]>();
    for (const score of SCALE_DRILLS) {
      const drill = SCALE_DRILL_KEYS[score.id]!;
      const list = byKey.get(drill.key) ?? [];
      list.push({ step: drill.step, tier: score.metadata.difficulty });
      byKey.set(drill.key, list);
    }
    for (const [key, list] of byKey) {
      const tiers = list.sort((a, b) => a.step - b.step).map((d) => order.indexOf(d.tier));
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i], `${key} step ${i + 1}`).toBeGreaterThanOrEqual(tiers[i - 1]!);
      }
    }
  });

  it('puts the tonic triad in every second step', () => {
    for (const score of SCALE_DRILLS) {
      const drill = SCALE_DRILL_KEYS[score.id]!;
      if (drill.step !== 2) continue;
      const third = drill.mode === 'major' ? 4 : 3;
      // The arpeggio is the closing figure: root, third, fifth from the tonic.
      const tail = score.notes.slice(-7).map((n) => n.midiNumber % 12);
      expect(tail, score.id).toContain(drill.tonic);
      expect(tail, score.id).toContain((drill.tonic + third) % 12);
      expect(tail, score.id).toContain((drill.tonic + 7) % 12);
    }
  });

  it('reaches past the closed hand only in the later steps of a key', () => {
    for (const score of SCALE_DRILLS) {
      const drill = SCALE_DRILL_KEYS[score.id]!;
      if (drill.step !== 3) continue;
      // Step 3 is where extensions are allowed; it should also be the widest
      // or equal-widest thing in the key, never a retreat into a narrower one.
      expect(score.metadata.difficulty).toBe('Advanced');
      expect(score.metadata.bpm).toBe(54);
    }
  });
});

describe('the drill set follows the census', () => {
  it('gives every cornerstone key its full three drills', () => {
    for (const row of KEY_PRACTICE_ROWS) {
      if (row.demand !== 'cornerstone') continue;
      expect(row.drills.length, `${row.key} carries ${row.songs} songs`).toBe(3);
    }
  });

  it('gives every common key at least two, and every occasional key at least one', () => {
    for (const row of KEY_PRACTICE_ROWS) {
      if (row.demand === 'common') expect(row.drills.length, row.key).toBeGreaterThanOrEqual(2);
      if (row.demand === 'occasional') expect(row.drills.length, row.key).toBeGreaterThanOrEqual(1);
    }
  });

  it('covers the overwhelming majority of the library by song count', () => {
    // A claim about the shape of the distribution, not about today's numbers:
    // the library's key use has a heavy head, so drilling everything above a
    // seventieth of it reaches nearly every song the player owns.
    if (LIBRARY_KEY_CENSUS.counted > 0) {
      const covered = KEY_PRACTICE_ROWS
        .filter((row) => row.drills.length > 0)
        .reduce((sum, row) => sum + row.songs, 0);
      expect(covered / LIBRARY_KEY_CENSUS.counted).toBeGreaterThan(0.9);
    } else {
      expect(SCALE_DRILLS.length).toBeGreaterThan(0);
    }
  });

  it('has something to say about all 24 keys, so a promotion is never mute', () => {
    // A rebuild can lift a key out of `rare` at any time, and the drill it then
    // gets opens with this sentence.
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const key = canonicalKeyName({ tonic, mode });
        expect(KEY_NOTES[key], key).toBeTruthy();
        expect(KEY_NOTES[key]!.length, key).toBeGreaterThan(40);
      }
    }
  });

  it('leaves out only keys the library barely uses', () => {
    for (const row of KEY_PRACTICE_ROWS) {
      if (row.drills.length > 0) continue;
      expect(row.demand, `${row.key} has ${row.songs} songs and no drill`).toBe('rare');
    }
  });

  it('orders the keys by the census, most-used first', () => {
    const ranks = KEY_PRACTICE_ROWS.map((row) => row.rank ?? Number.MAX_SAFE_INTEGER);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const songs = KEY_PRACTICE_ROWS.map((row) => row.songs);
    expect([...songs].sort((a, b) => b - a)).toEqual(songs);
  });

  it('bands each row the same way the domain does', () => {
    for (const row of KEY_PRACTICE_ROWS) {
      expect(row.demand).toBe(keyDemand(row.share));
      expect(row.openString).toBe(openStringTonic(row.tonic));
    }
  });

  it('reaches every key the drills were authored for', () => {
    const drilled = new Set(Object.values(SCALE_DRILL_KEYS).map((d) => d.key));
    const listed = new Set(KEY_PRACTICE_ROWS.filter((r) => r.drills.length > 0).map((r) => r.key));
    expect(listed).toEqual(drilled);
  });
});

describe('drills reach the library the way studies do', () => {
  it.each(cases)('%s is a playable study row with a range and a tempo', (_id, score) => {
    const row = LIBRARY_ROWS.find((r) => r.id === score.id);
    expect(row, `${score.id} is missing from LIBRARY_ROWS`).toBeDefined();
    expect(row!.category).toBe('study');
    expect(row!.playable).toBe(true);
    expect(row!.keySignature).toBe(score.metadata.keySignature);
    expect(row!.range).toMatch(/ – /);
    expect(row!.tempo).toBe(`♩ ${score.metadata.bpm}`);
    expect(row!.bars).toBe(score.measures.length);
    // Every drill sits wholly in first position, so the load bars say so.
    expect(row!.distribution[0]).toEqual(['1st position', 100]);
  });

  it('ships only original material', () => {
    for (const score of SCALE_DRILLS) {
      expect(score.metadata.rights, score.id).toMatch(/^Original/);
    }
  });

  it('carries a tonic drone as long as the drill itself', () => {
    for (const score of SCALE_DRILLS) {
      const backing = SCALE_DRILL_BACKINGS[score.id];
      expect(backing, score.id).toBeDefined();
      const last = score.measures[score.measures.length - 1]!;
      expect(backing!.durationMs).toBe(last.startBarTimeMs + last.durationMs);

      const drill = SCALE_DRILL_KEYS[score.id]!;
      const notes = backing!.parts.flatMap((p) => p.notes);
      expect(notes).toHaveLength(2);
      const [root, fifth] = notes;
      expect(root!.midiNumber % 12).toBe(drill.tonic);
      expect(fifth!.midiNumber - root!.midiNumber).toBe(7);

      // Where the tonic is an open string the drone is that string's own pitch,
      // so the player can check it by bowing the string.
      const open = openStringTonic(drill.tonic);
      if (open) expect(root!.midiNumber).toBe(OPEN_STRING_MIDI[open]);
    }
  });
});

describe('firstPositionVerdict', () => {
  it('answers for every key in the library without throwing', () => {
    for (const entry of LIBRARY_KEY_CENSUS.entries) {
      const parsed = parseKeyName(entry.key)!;
      const verdict = firstPositionVerdict(parsed.tonic, parsed.mode);
      expect(verdict.note.length).toBeGreaterThan(10);
      expect(verdict.range).toMatch(/^[A-G][♯♭#b]?\d–[A-G][♯♭#b]?\d$/);
      expect(verdict.reaches + verdict.drawBacks).toBeGreaterThanOrEqual(0);
    }
  });

  it('answers for all 24 keys, including the ones with no drill', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        expect(() => firstPositionVerdict(tonic, mode)).not.toThrow();
      }
    }
  });

  it('calls the closed-hand keys closed and the rest not', () => {
    // These are facts about the instrument: C, G, D, F majors and A, D minors
    // are the keys whose lowest first-position octave needs no hand move, which
    // is why the graded syllabuses ask for exactly them first.
    for (const [tonic, mode] of [[0, 'major'], [7, 'major'], [2, 'major'], [5, 'major'],
      [9, 'minor'], [2, 'minor']] as const) {
      const verdict = firstPositionVerdict(tonic, mode);
      expect(verdict).toMatchObject({ reaches: 0, drawBacks: 0, tier: 'Beginner' });
    }
    // And A♭ major is the key with nowhere closed to put its own tonic.
    expect(firstPositionVerdict(8, 'major').tier).toBe('Advanced');
    // E minor is one forward extension away from being closed.
    expect(firstPositionVerdict(4, 'minor')).toMatchObject({ reaches: 1, drawBacks: 0 });
  });
});
