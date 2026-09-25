import { describe, expect, it } from 'vitest';

import { ArrangementLevel, ARRANGEMENT_LEVELS, ARRANGEMENT_PROFILES } from '../arranger';
import { BackingNote, BackingPart, InstrumentName, PartRole } from '../backing';
import { firstPositionFingering } from '../fingering';
import { CelloNote, CelloSongScore, scoreDurationMs } from '../schema';
import { getBundledBacking, getScore, COMPACT_SCORES, LIBRARY_EDITION } from '@scores';
import {
  celloLineFromPart, celloPartOptions, describeOctaveFit, findCelloPart,
  FIRST_POSITION_FLOOR, FIRST_POSITION_ROOF, nearestWorkableOctave, octaveChoices,
  partKind, partLabel, scoreFromPart, suggestedOctaves, writtenForCello, type CelloPartOption,
} from '../trackPicker';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function notesFrom(pitches: readonly number[], stepMs = 500): BackingNote[] {
  return pitches.map((midiNumber, i) => ({
    midiNumber,
    startTimeMs: i * stepMs,
    durationMs: stepMs - 20,
    velocity: 0.8,
  }));
}

function part(overrides: Partial<BackingPart> & { name: string }): BackingPart {
  return {
    id: overrides.id ?? `p-${overrides.name}`,
    name: overrides.name,
    instrument: overrides.instrument ?? ('guitar' as InstrumentName),
    role: overrides.role ?? ('accompaniment' as PartRole),
    gain: 0.5,
    muted: false,
    notes: overrides.notes ?? notesFrom([60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 60]),
  };
}

/** A one-bar-per-4s host score, long enough for the fixtures above. */
function hostScore(): CelloSongScore {
  return {
    schemaVersion: '1.0.0',
    id: 'fixture',
    metadata: {
      title: 'Fixture', composer: 'Test', origin: 'TEST', keySignature: 'C major',
      timeSignature: '4/4', bpm: 120, difficulty: 'Expert', tonic: 'C',
      teaches: 'nothing', rights: 'test', preferFlats: false,
    },
    measures: Array.from({ length: 8 }, (_, index) => ({
      index, startBarTimeMs: index * 2000, durationMs: 2000,
      timeSignature: [4, 4] as [number, number], tempoBpm: 120,
    })),
    notes: [],
  };
}

// ─── Naming and classification ───────────────────────────────────────────────

describe('recognising a part by what a player would call it', () => {
  it('takes the file’s own track name when it says anything', () => {
    expect(partLabel(part({ name: 'Vocals' }))).toBe('Vocals');
    expect(partLabel(part({ name: 'Overdrive' }))).toBe('Overdrive');
  });

  it('keeps the tone and section words a player is choosing between', () => {
    for (const name of ['Clean', 'Overdrive', 'Distorted', 'Acoustic', 'Backing', 'Intro']) {
      expect(partLabel(part({ name, instrument: 'guitar' })), name).toBe(name);
    }
  });

  it('falls back to the instrument when the name is a MIDI placeholder', () => {
    expect(partLabel(part({ name: 'Track 4', instrument: 'bass' }))).toBe('Bass');
    expect(partLabel(part({ name: 'Channel 2', instrument: 'strings' }))).toBe('Strings');
    expect(partLabel(part({ name: 'untitled', instrument: 'piano' }))).toBe('Piano');
    expect(partLabel(part({ name: '', instrument: 'organ' }))).toBe('Organ');
  });

  it('falls back to the instrument when the name is just whoever played it', () => {
    // Real track names in the library. A player scanning for the bass line
    // does not know that Fieldy is Korn's bassist.
    expect(partLabel(part({ name: 'Fieldy', instrument: 'bass' }))).toBe('Bass');
    expect(partLabel(part({ name: 'Jason Newstead', instrument: 'bass' }))).toBe('Bass');
    expect(partLabel(part({ name: 'WinJammer Demo', instrument: 'guitar' }))).toBe('Guitar');
    expect(partLabel(part({ name: 'Martin Foul (Unwashed Pianist)', instrument: 'piano' }))).toBe('Piano');
    // But a name that says both keeps the player's name, because it also says
    // which part they were playing.
    expect(partLabel(part({ name: 'Kurdt Kobain -Vocals-' }))).toBe('Kurdt Kobain -Vocals-');
  });

  it('stops a shouted name from shouting', () => {
    expect(partLabel(part({ name: 'CELLO' }))).toBe('Cello');
  });

  it('classifies by what the part plays, not by the track order', () => {
    expect(partKind(part({ name: 'Bass', instrument: 'bass' }))).toBe('bass');
    expect(partKind(part({ name: 'Vocal melody', instrument: 'synth' }))).toBe('melody');
    expect(partKind(part({ name: 'Drums', instrument: 'percussion' }))).toBe('percussion');
    expect(partKind(part({ name: 'Acoustic', instrument: 'guitar' }))).toBe('harmony');
    // The builder nominates one track as the solo; that is a melody claim.
    expect(partKind(part({ name: 'Track 4', role: 'solo' }))).toBe('melody');
  });

  it('reads suffixed role words, which real files are full of', () => {
    expect(partKind(part({ name: 'Leadvocal', instrument: 'synth' }))).toBe('melody');
    expect(partKind(part({ name: 'Voices', instrument: 'strings' }))).toBe('melody');
    expect(partKind(part({ name: 'vocals2(chorus only)', instrument: 'reed' }))).toBe('melody');
    expect(partKind(part({ name: 'Contrabass', instrument: 'strings' }))).toBe('bass');
    // ...but a bassoon is a reed playing an inner part, not a bass line.
    expect(partKind(part({ name: 'Bassoon', instrument: 'reed' }))).toBe('harmony');
  });

  it('calls a drum track a drum track whatever channel it was written on', () => {
    // AC/DC's "Back in Black" puts its kit on melodic channels with a synth
    // program, so these arrive as pitched parts.
    for (const name of ['Bass Drum', 'Snare', 'Crash Cymbal', 'Hi-Hat']) {
      expect(partKind(part({ name, instrument: 'synth' })), name).toBe('percussion');
    }
  });
});

describe('finding a part the source actually wrote for cello', () => {
  it('believes a name that says cello', () => {
    expect(writtenForCello(part({ name: 'Cello', instrument: 'strings' }))).toBe(true);
    expect(writtenForCello(part({ name: 'CELLO', instrument: 'strings' }))).toBe(true);
    // A doubling label: the file is telling us this guitar staff is the cello.
    expect(writtenForCello(part({ name: 'Guitar 2 - Cello', instrument: 'guitar' }))).toBe(true);
  });

  it('believes GM program 42 only when the name does not contradict it', () => {
    expect(writtenForCello(part({ name: 'Track 3', instrument: 'cello' }))).toBe(true);
    // Real files from the library: a bassist's name and a vocal staff, both
    // sitting on GM program 42.
    expect(writtenForCello(part({ name: 'Kris Novelis -Bass-', instrument: 'cello' }))).toBe(false);
    expect(writtenForCello(part({ name: 'Voice', instrument: 'cello' }))).toBe(false);
  });

  it('does not mistake Justin Chancellor for a cello', () => {
    expect(writtenForCello(part({ name: 'Chancellor', instrument: 'bass' }))).toBe(false);
  });

  it('reports the cello part when a song has one, and null when it does not', () => {
    const cello = part({ name: 'Cello', instrument: 'cello', id: 'c' });
    expect(findCelloPart([part({ name: 'Bass' }), cello])?.id).toBe('c');
    expect(findCelloPart([part({ name: 'Bass' }), part({ name: 'Drums' })])).toBeNull();
  });

  it('ignores a cello part with too few notes to practise', () => {
    const stub = part({ name: 'Cello', instrument: 'cello', notes: notesFrom([48, 50]) });
    expect(findCelloPart([stub])).toBeNull();
  });
});

// ─── Octave fitting: telling the truth about the result ──────────────────────

describe('costing an octave shift', () => {
  /** A vocal line around C4–G4: two octaves too high for first position. */
  const vocal = [60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 59];

  it('reports the resulting range in pitch names, not MIDI numbers', () => {
    const fit = describeOctaveFit(vocal, -1, 'Expert');
    expect(fit.rangeLabel).toBe('B2 – A3');
    expect(fit.summary).toContain('B2 – A3');
  });

  it('says so plainly when every note fits first position', () => {
    const fit = describeOctaveFit(vocal, -1, 'Expert');
    expect(fit.verdict).toBe('fits');
    expect(fit.reseated).toBe(0);
    expect(fit.placedShare).toBe(1);
    expect(fit.summary).toContain('Every note fits first position');
  });

  it('counts the notes that would move, and names the direction', () => {
    // Sits in range apart from one E4, a semitone over the D4 ceiling.
    const fit = describeOctaveFit([55, 57, 59, 60, 62, 64, 62, 60, 59, 57, 55, 53], 0, 'Expert');
    expect(fit.verdict).toBe('folds');
    expect(fit.aboveCeiling).toBe(1);
    expect(fit.belowFloor).toBe(0);
    expect(fit.summary).toContain('1 of 12 notes');
    expect(fit.summary).toContain('above D4');
    expect(fit.summary).toContain('move an octave to be reachable');
  });

  it('refuses an unshifted vocal line: most of it is over the ceiling', () => {
    const fit = describeOctaveFit(vocal, 0, 'Expert');
    expect(fit.verdict).toBe('refused');
    expect(fit.aboveCeiling).toBe(7);
    expect(fit.summary).toContain('above D4');
  });

  it('refuses a shift that would move most of the line anyway', () => {
    const fit = describeOctaveFit(vocal, -3, 'Expert');
    expect(fit.verdict).toBe('refused');
    expect(fit.belowFloor).toBe(vocal.length);
    expect(fit.summary).toContain('not the octave for this part');
    expect(fit.summary).toContain('below the open C');
  });

  /** 56 is G♯3, the sixth semitone of the D string — a forward extension. */
  const withStretch = [50, 52, 54, 55, 56, 54, 52, 50];

  it('counts a stretched fourth finger as a cost on levels that allow it', () => {
    const fit = describeOctaveFit(withStretch, 0, 'Expert');
    expect(fit.extended).toBe(1);
    expect(fit.reseated).toBe(0);
    expect(fit.verdict).toBe('fits');
    expect(fit.summary).toContain('stretched fourth finger');
  });

  it('counts it as a move on a closed-frame level, because that is what happens', () => {
    // The same eight notes. Beginner will not stretch a beginner's hand for it,
    // so the note moves — and the report says it moves rather than that it fits.
    const fit = describeOctaveFit(withStretch, 0, 'Beginner');
    expect(fit.extended).toBe(1);
    expect(fit.reseated).toBe(1);
    expect(fit.verdict).toBe('folds');
    expect(fit.summary).toContain('a stretch this level does not use');
  });

  it('reports nothing rather than pretending, for an empty part', () => {
    const fit = describeOctaveFit([], 0, 'Expert');
    expect(fit.verdict).toBe('refused');
    expect(fit.summary).toBe('Nothing to play in this part.');
  });

  it('offers a shift either way and always includes no shift at all', () => {
    const choices = octaveChoices(vocal, 'Expert');
    expect(choices.map((c) => c.octaves)).toContain(0);
    expect(choices.every((c) => c.level === 'Expert')).toBe(true);
    // Sorted low to high, so a stepper can walk it.
    expect(choices).toEqual([...choices].sort((a, b) => a.octaves - b.octaves));
  });

  it('finds the workable octave nearest a refused one', () => {
    const choices = octaveChoices(vocal, 'Expert');
    // −3 is refused (the whole line falls under the open C); −2 is the nearest
    // that works, and it is the one to point the player at.
    expect(nearestWorkableOctave(choices, -3)).toBe(-2);
    expect(nearestWorkableOctave(choices, 4)).toBe(-1);
  });

  it('has no workable octave for a line wider than the instrument', () => {
    const fiveOctavePiano = Array.from({ length: 60 }, (_, i) => 24 + i);
    expect(nearestWorkableOctave(octaveChoices(fiveOctavePiano, 'Expert'), 0)).toBeNull();
  });
});

describe('the octave the app suggests', () => {
  it('drops a melody written two octaves high into cello range', () => {
    const vocal = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74];
    const octaves = suggestedOctaves(vocal, 'Expert');
    expect(octaves).toBe(-2);
    expect(describeOctaveFit(vocal, octaves, 'Expert').verdict).toBe('fits');
  });

  it('lifts a bass line written below the cello', () => {
    const bass = [28, 28, 31, 33, 28, 26, 28, 31, 33, 28, 26, 24];
    const octaves = suggestedOctaves(bass, 'Expert');
    expect(octaves).toBe(1);
    expect(describeOctaveFit(bass, octaves, 'Expert').verdict).not.toBe('refused');
  });

  it('leaves a line already in range where it was written', () => {
    const written = [43, 45, 47, 48, 50, 48, 47, 45, 43, 45, 47, 43];
    expect(suggestedOctaves(written, 'Expert')).toBe(0);
  });
});

// ─── The list the player chooses from ────────────────────────────────────────

describe('the part list', () => {
  const parts: BackingPart[] = [
    part({ id: 'p0', name: 'Drums', instrument: 'percussion' }),
    part({ id: 'p1', name: 'Acoustic', instrument: 'guitar' }),
    part({ id: 'p2', name: 'Bass', instrument: 'bass', notes: notesFrom([40, 40, 43, 45, 40, 38, 40, 43, 45, 40, 38, 36]) }),
    part({ id: 'p3', name: 'Vocals', instrument: 'reed', role: 'solo' }),
    part({ id: 'p4', name: 'Cello', instrument: 'cello', notes: notesFrom([48, 50, 52, 53, 55, 53, 52, 50, 48, 50, 52, 48]) }),
  ];

  it('always leads with the app’s own arrangement, and it is always playable', () => {
    const options = celloPartOptions(parts, 'Expert');
    expect(options[0]?.id).toBeNull();
    expect(options[0]?.kind).toBe('arrangement');
    expect(options[0]?.unplayable).toBeNull();
  });

  it('puts a real cello part first among the source parts', () => {
    const options = celloPartOptions(parts, 'Expert');
    expect(options[1]?.id).toBe('p4');
    expect(options[1]?.writtenForCello).toBe(true);
  });

  it('orders the rest the way a cellist would reach for them', () => {
    const options = celloPartOptions(parts, 'Expert');
    expect(options.map((o) => o.kind))
      .toEqual(['arrangement', 'cello', 'melody', 'bass', 'harmony', 'percussion']);
  });

  it('shows an unplayable part rather than hiding it, and says why', () => {
    const options = celloPartOptions(parts, 'Expert');
    const drums = options.find((o) => o.id === 'p0');
    expect(drums?.unplayable).toBe('A drum track. There are no pitches here to bow.');
    expect(drums?.octaves).toEqual([]);
  });

  it('refuses a part with too little in it to practise', () => {
    const options = celloPartOptions([part({ id: 'x', name: 'Stab', notes: notesFrom([60, 62]) })], 'Expert');
    expect(options[1]?.unplayable).toBe('Only 2 notes in the whole song.');
  });

  it('suggests an octave that is never a refused one', () => {
    for (const level of ARRANGEMENT_LEVELS) {
      for (const option of celloPartOptions(parts, level)) {
        if (option.unplayable || option.octaves.length === 0) continue;
        const chosen = option.octaves.find((fit) => fit.octaves === option.suggested);
        expect(chosen, `${option.label} at ${level}`).toBeDefined();
        expect(chosen?.verdict, `${option.label} at ${level}`).not.toBe('refused');
      }
    }
  });

  it('describes each part by what it plays and where it was written', () => {
    const options = celloPartOptions(parts, 'Expert');
    expect(options.find((o) => o.id === 'p2')?.detail)
      .toBe('Bass line · 12 notes · written C2 – A2');
  });
});

// ─── Building the line: the playability discipline still applies ─────────────

describe('building a cello line from a chosen part', () => {
  const vocal = part({
    id: 'v', name: 'Vocals', instrument: 'reed', role: 'solo',
    notes: notesFrom([72, 74, 76, 77, 79, 81, 79, 77, 76, 74, 72, 71, 72, 76, 79, 72]),
  });

  it('drops a melody two octaves down into cello range and fingers it', () => {
    const built = scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: -2 }, 'Expert');
    expect(built).not.toBeNull();
    const midis = built!.score.notes.map((note) => note.midiNumber);
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(FIRST_POSITION_FLOOR);
    expect(Math.max(...midis)).toBeLessThanOrEqual(FIRST_POSITION_ROOF);
    expect(built!.fit.verdict).toBe('fits');
  });

  it('refuses rather than rendering an impossible line', () => {
    expect(scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: -5 }, 'Expert')).toBeNull();
    expect(scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: 2 }, 'Expert')).toBeNull();
  });

  it('refuses a stale choice that now points at a drum track', () => {
    const drums = part({ id: 'd', name: 'Drums', instrument: 'percussion' });
    expect(scoreFromPart(hostScore(), drums, { partId: 'd', octaves: 0 }, 'Expert')).toBeNull();
  });

  it('refuses a part that has lost most of its notes since it was chosen', () => {
    const stub = part({ id: 's', name: 'Vocals', notes: notesFrom([50, 52, 54]) });
    expect(scoreFromPart(hostScore(), stub, { partId: 's', octaves: 0 }, 'Expert')).toBeNull();
  });

  it('never emits a note first position cannot seat, at any level or shift', () => {
    for (const level of ARRANGEMENT_LEVELS) {
      const { range } = ARRANGEMENT_PROFILES[level];
      for (let octaves = -4; octaves <= 4; octaves++) {
        const built = scoreFromPart(hostScore(), vocal, { partId: 'v', octaves }, level);
        if (!built) continue;
        for (const note of built.score.notes) {
          expect(note.midiNumber, `${level} ${octaves}`).toBeGreaterThanOrEqual(range.low);
          expect(note.midiNumber, `${level} ${octaves}`).toBeLessThanOrEqual(range.high);
          // The guardrail itself: this throws outside first position.
          expect(() => firstPositionFingering(note.midiNumber)).not.toThrow();
        }
      }
    }
  });

  it('keeps a closed hand on the levels that require one', () => {
    const closed = ARRANGEMENT_LEVELS.filter((level) => ARRANGEMENT_PROFILES[level].closedFrameOnly);
    expect(closed.length).toBeGreaterThan(0);
    for (const level of closed) {
      const built = scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: -2 }, level);
      if (!built) continue;
      for (const note of built.score.notes) expect(note.extension, level).toBe('none');
    }
  });

  it('honours the octave the player chose wherever it works', () => {
    const built = celloLineFromPart(vocal, { partId: 'v', octaves: -2 }, 'Expert',
      { bpm: 120, totalMs: 16_000 });
    expect(built).not.toBeNull();
    const byStart = new Map(vocal.notes.map((n) => [n.startTimeMs, n.midiNumber]));
    for (const event of built!.events) {
      const source = byStart.get(event.startTimeMs);
      if (source === undefined) continue;
      expect(event.midiNumber).toBe(source - 24);
    }
  });

  it('thins the attacks a level cannot bow, keeping the timeline', () => {
    const fast = part({
      id: 'f', name: 'Lead', instrument: 'guitar',
      notes: notesFrom([60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67, 65, 64, 62], 60),
    });
    const expert = scoreFromPart(hostScore(), fast, { partId: 'f', octaves: -1 }, 'Expert');
    const beginner = scoreFromPart(hostScore(), fast, { partId: 'f', octaves: -1 }, 'Beginner');
    expect(beginner!.score.notes.length).toBeLessThan(expert!.score.notes.length);
  });

  it('clips the line to the host score rather than running past its last bar', () => {
    const long = part({
      id: 'l', name: 'Pad', instrument: 'strings',
      notes: notesFrom([60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 60], 4000),
    });
    const score = hostScore();
    const built = scoreFromPart(score, long, { partId: 'l', octaves: -1 }, 'Expert');
    const end = 8 * 2000;
    for (const note of built!.score.notes) {
      expect(note.startTimeMs).toBeLessThan(end);
      expect(note.startTimeMs + note.durationMs).toBeLessThanOrEqual(end);
    }
  });

  it('keeps the source melody audible when the player takes the bass', () => {
    const bass = part({
      id: 'b', name: 'Bass', instrument: 'bass',
      notes: notesFrom([40, 40, 43, 45, 40, 38, 40, 43, 45, 40, 38, 36]),
    });
    const taken = scoreFromPart(hostScore(), bass, { partId: 'b', octaves: 0 }, 'Expert');
    expect(taken!.score.metadata.arrangementRole).toBe('bass');
    const tune = scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: -2 }, 'Expert');
    expect(tune!.score.metadata.arrangementRole).toBe('melody');
  });

  it('says on the practice sheet where the line came from and what it cost', () => {
    const built = scoreFromPart(hostScore(), vocal, { partId: 'v', octaves: -2 }, 'Expert');
    expect(built!.score.metadata.teaches).toContain('Vocals');
    expect(built!.score.metadata.teaches).toContain('2 octaves down');
    expect(built!.score.metadata.teaches).toContain('Every note fits first position');
  });

  it('keeps the song’s bars, so switching source does not move the loop', () => {
    const score = hostScore();
    const built = scoreFromPart(score, vocal, { partId: 'v', octaves: -2 }, 'Expert');
    expect(built!.score.measures).toEqual(score.measures);
    expect(built!.score.id).toBe(score.id);
  });
});

// ─── The whole library, through the whole pipeline ───────────────────────────

/**
 * The claim this feature has to make good on is that no choice the picker
 * offers can fail at draw time. The real library is the only honest test of
 * that, and it is split here by cost.
 *
 * The **cheap** half is exhaustive: for every song, every source part and every
 * costed octave, what `celloPartOptions` offers must agree with what
 * `celloLineFromPart` will accept. That consistency is this module's own
 * contract and the place its bugs live — it is what caught `suggestedOctaves`
 * escaping the costed octave window and reporting a part as unplayable that
 * built fine.
 *
 * The **expensive** half actually builds and fingers the scores, on a sample:
 * the first forty songs plus the six with the most source parts, at every
 * level. Building is ~6 ms a shot and exhaustive coverage costs a minute, which
 * is too much for every `npm test`. Sampling is safe rather than hopeful
 * because the step that could fail — seating a pitch class inside a profile's
 * range — is proved exhaustively and in closed form by the invariant at the
 * bottom of this file.
 */
describe('every offerable choice in the real library is playable', () => {
  const songs = COMPACT_SCORES.map((compact) => compact.id);
  /**
   * Coverage thresholds describe the full library. The free edition ships a
   * dozen public-domain pieces and etudes; every correctness check below still
   * runs over all of them.
   */
  const FULL_LIBRARY = LIBRARY_EDITION.id === 'full';

  /** The busiest songs: most source parts, so most classifying and fitting. */
  const busiest = [...COMPACT_SCORES]
    .sort((a, b) => b.backingParts.length - a.backingParts.length)
    .slice(0, 6)
    .map((compact) => compact.id);

  it('has a library to test', () => {
    expect(songs.length).toBeGreaterThan(FULL_LIBRARY ? 100 : 0);
    expect(busiest).toHaveLength(6);
  });

  it('offers exactly the choices that build, for every part of every song', () => {
    let offered = 0;
    let refused = 0;

    songs.forEach((id, index) => {
      const score = getScore(id);
      const backing = getBundledBacking(id);
      if (!score || !backing) return;
      // One level per song, cycling, so all four are exercised against a
      // quarter of the library's pitch content each.
      const level = ARRANGEMENT_LEVELS[index % ARRANGEMENT_LEVELS.length]!;

      for (const option of celloPartOptions(backing.parts, level)) {
        if (option.id === null) continue;
        const part = backing.parts.find((candidate) => candidate.id === option.id);
        expect(part, `${id} ${option.id}`).toBeDefined();

        // The suggested octave must be one the stepper can actually reach.
        if (option.octaves.length > 0) {
          expect(
            option.octaves.some((fit) => fit.octaves === option.suggested),
            `${id} / ${option.label} / suggested ${option.suggested} is outside the costed window`,
          ).toBe(true);
        }

        if (option.unplayable) {
          // A refusal has to be real: nothing the picker rules out may build.
          expect(
            celloLineFromPart(part!, { partId: option.id, octaves: option.suggested }, level,
              { bpm: score.metadata.bpm, totalMs: scoreDurationMs(score) }),
            `${id} / ${option.label} / ${level} / ${option.unplayable}`,
          ).toBeNull();
          refused++;
          continue;
        }

        // And every octave it does offer has to be one a player can select:
        // present in the costed list, and not refused.
        expect(option.octaves.length, `${id} ${option.label}`).toBeGreaterThan(0);
        const workable = option.octaves.filter((fit) => fit.verdict !== 'refused');
        expect(workable.length, `${id} / ${option.label} has no workable octave`)
          .toBeGreaterThan(0);
        for (const fit of workable) {
          expect(fit.placedShare, `${id} ${option.label} ${fit.octaves}`).toBeGreaterThanOrEqual(0.5);
          expect(fit.rangeLabel).not.toBe('—');
          expect(fit.summary.length).toBeGreaterThan(10);
          offered++;
        }
      }
    });

    // Sanity on the shape of the coverage, so a silently empty sweep cannot
    // pass as a green test.
    expect(offered).toBeGreaterThan(FULL_LIBRARY ? 1000 : 0);
    if (FULL_LIBRARY) expect(refused).toBeGreaterThan(50);
  }, 300_000);

  /** Every note inside the level's range, closed-frame where the level demands it, and fingerable. */
  function expectPlayableAtLevel(notes: readonly CelloNote[], level: ArrangementLevel, where: string): void {
    const { range, closedFrameOnly } = ARRANGEMENT_PROFILES[level];
    for (const note of notes) {
      expect(note.midiNumber, where).toBeGreaterThanOrEqual(range.low);
      expect(note.midiNumber, where).toBeLessThanOrEqual(range.high);
      // Read from the profile rather than from a list of level names:
      // which levels forbid the stretch is arrangement policy, and it has
      // changed under this test once already.
      if (closedFrameOnly) expect(note.extension, where).toBe('none');
      expect(() => firstPositionFingering(note.midiNumber), where).not.toThrow();
    }
  }

  /** Builds every workable octave of one part at one level; returns how many it built. */
  function buildPart(score: CelloSongScore, part: BackingPart, option: CelloPartOption, level: ArrangementLevel, id: string): number {
    let built = 0;
    for (const fit of option.octaves.filter((candidate) => candidate.verdict !== 'refused')) {
      const where = `${id} / ${option.label} / ${fit.octaves} / ${level}`;
      const result = scoreFromPart(score, part, { partId: option.id, octaves: fit.octaves }, level);
      expect(result, where).not.toBeNull();
      built++;
      expectPlayableAtLevel(result?.score.notes ?? [], level, where);
    }
    return built;
  }

  /** Builds every workable octave of every part and fingers what comes out. */
  function build(id: string, levels: readonly ArrangementLevel[]): number {
    const score = getScore(id);
    const backing = getBundledBacking(id);
    if (!score || !backing) return 0;
    let built = 0;
    for (const level of levels) {
      for (const option of celloPartOptions(backing.parts, level)) {
        const part = backing.parts.find((candidate) => candidate.id === option.id);
        if (option.id === null || option.unplayable || !part) continue;
        built += buildPart(score, part, option, level, id);
      }
    }
    return built;
  }

  it('builds a fingerable line for every octave it offers', () => {
    let built = 0;
    songs.forEach((id, index) => {
      if (index >= 40) return;
      built += build(id, [ARRANGEMENT_LEVELS[index % ARRANGEMENT_LEVELS.length]!]);
    });
    expect(built).toBeGreaterThan(FULL_LIBRARY ? 100 : 0);
  }, 300_000);

  it('holds at every level for the songs with the most parts', () => {
    let built = 0;
    for (const id of busiest) built += build(id, ARRANGEMENT_LEVELS);
    expect(built).toBeGreaterThan(FULL_LIBRARY ? 100 : 0);
  }, 300_000);

  it('keeps every part’s notes inside the song’s own bars', () => {
    for (const id of songs.slice(0, 40)) {
      const score = getScore(id);
      const backing = getBundledBacking(id);
      if (!score || !backing) continue;
      const end = scoreDurationMs(score);
      for (const option of celloPartOptions(backing.parts, 'Expert')) {
        if (option.id === null || option.unplayable) continue;
        const part = backing.parts.find((candidate) => candidate.id === option.id)!;
        const result = scoreFromPart(score, part, { partId: option.id, octaves: option.suggested }, 'Expert');
        if (!result) continue;
        for (const note of result.score.notes) {
          expect(note.startTimeMs + note.durationMs, `${id} ${option.label}`).toBeLessThanOrEqual(end);
          expect(note.measureIndex).toBeLessThan(score.measures.length);
        }
      }
    }
  }, 120_000);

  it('finds the cello parts the library actually contains', () => {
    const withCello = songs.filter((id) => {
      const backing = getBundledBacking(id);
      return backing ? findCelloPart(backing.parts) !== null : false;
    });
    // Eight source files write a real cello part, plus the hand-built
    // classical reductions whose single part is a cello by construction.
    if (FULL_LIBRARY) {
      expect(withCello.length).toBeGreaterThan(5);
      expect(withCello.length).toBeLessThan(songs.length / 2);
    } else {
      // Every free piece is a hand-built cello reduction, so all of them qualify.
      expect(withCello.length).toBeGreaterThan(0);
    }
  });
});

// ─── The guardrail, stated as an invariant ───────────────────────────────────

describe('every arrangement profile stays inside first position', () => {
  it('can seat any pitch in its range', () => {
    for (const level of ARRANGEMENT_LEVELS) {
      const { range } = ARRANGEMENT_PROFILES[level];
      expect(range.low).toBeGreaterThanOrEqual(FIRST_POSITION_FLOOR);
      expect(range.high).toBeLessThanOrEqual(FIRST_POSITION_ROOF);
      for (let midi = range.low; midi <= range.high; midi++) {
        expect(() => firstPositionFingering(midi)).not.toThrow();
      }
    }
  });

  it('leaves every pitch class a closed-frame seat, so seating cannot fail', () => {
    for (const level of ARRANGEMENT_LEVELS) {
      const profile = ARRANGEMENT_PROFILES[level];
      for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
        const seats: number[] = [];
        for (let midi = profile.range.low; midi <= profile.range.high; midi++) {
          if (midi % 12 !== pitchClass) continue;
          if (profile.closedFrameOnly && firstPositionFingering(midi).extension !== 'none') continue;
          seats.push(midi);
        }
        expect(seats.length, `${level} pitch class ${pitchClass}`).toBeGreaterThan(0);
      }
    }
  });
});
