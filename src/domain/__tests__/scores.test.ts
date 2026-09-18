import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_LEVELS, ARRANGEMENT_PROFILES, arrangeScoreForLevel } from '../arrangement';
import { soloPartFromScore } from '../backing';
import { midiToFrequency, midiToPitchName, OPEN_STRING_MIDI } from '../cello';
import { difficultyOf } from '../difficulty';
import { seatLine } from '../fingering';
import { scoreDurationMs, validateScore } from '../schema';
import { LIBRARY_ROWS, SCORES } from '@/scores';
import { LIBRARY_EDITION } from '@/scores/libraryEdition';

/** Size thresholds describe the full library; the free edition ships a dozen pieces. */
const FULL_LIBRARY = LIBRARY_EDITION.id === 'full';

/** Where an arrangement is allowed to put the hand: the neck, never past it. */
const NECK_POSITIONS = ['Half', '1st', '2nd', '3rd', '4th'];

describe('bundled scores', () => {
  it.each(SCORES.map((s) => [s.id, s] as const))('%s passes structural validation', (_id, score) => {
    expect(validateScore(score)).toEqual([]);
  });

  it.each(SCORES.map((s) => [s.id, s] as const))('%s has self-consistent notes', (_id, score) => {
    for (const note of score.notes) {
      const semitones = note.midiNumber - OPEN_STRING_MIDI[note.string];
      expect(semitones).toBeGreaterThanOrEqual(0);
      expect(note.pitchName).toBe(midiToPitchName(note.midiNumber, score.metadata.preferFlats));
      expect(note.frequency).toBeCloseTo(midiToFrequency(note.midiNumber), 1);
      // An open string must name finger 0, and vice versa.
      expect(semitones === 0).toBe(note.finger === '0');
    }
  });

  it.each(SCORES.map((s) => [s.id, s] as const))('%s stays inside the cello range', (_id, score) => {
    for (const note of score.notes) {
      expect(note.midiNumber).toBeGreaterThanOrEqual(36); // C2
      expect(note.midiNumber).toBeLessThanOrEqual(81);    // A5
    }
  });

  it('ships only original or public-domain material', () => {
    for (const score of SCORES) {
      expect(score.metadata.rights).toMatch(/Original|[Pp]ublic domain/);
    }
  });

  it('opens the Bach on the right notes', () => {
    const bach = SCORES.find((s) => s.id === 'bwv1007-prelude')!;
    expect(bach.notes.slice(0, 8).map((n) => n.pitchName))
      .toEqual(['G2', 'D3', 'B3', 'A3', 'B3', 'D3', 'B3', 'D3']);
    // Bars 1–4 sit entirely in first position, which is the point of the excerpt.
    expect(new Set(bach.notes.map((n) => n.position))).toEqual(new Set(['1st']));
  });

  it('walks all four first-position tapes in the ladder', () => {
    const ladder = SCORES.find((s) => s.id === 'first-position-ladder')!;
    const semitones = new Set(
      ladder.notes.map((n) => n.midiNumber - OPEN_STRING_MIDI[n.string]),
    );
    expect(semitones).toEqual(new Set([0, 2, 3, 4, 5]));
  });

  it('puts the thumb ladder on the octave harmonic and above', () => {
    const ladder = SCORES.find((s) => s.id === 'thumb-position-ladder')!;
    for (const note of ladder.notes) {
      expect(note.midiNumber - OPEN_STRING_MIDI[note.string]).toBeGreaterThanOrEqual(12);
      expect(note.position).toBe('Thumb');
    }
    expect(ladder.notes.some((n) => n.finger === 'T')).toBe(true);
    // The little finger has no business up here.
    expect(ladder.notes.some((n) => n.finger === '4')).toBe(false);
  });

  it('rejects a bar that does not add up', async () => {
    const { buildScore } = await import('@/scores/build');
    expect(() => buildScore({
      id: 'broken',
      timeSignature: [4, 4],
      metadata: SCORES[0].metadata,
      bars: [[{ s: 'A', n: 0, f: '0', b: 3 }]],
    })).toThrow(/holds 3 beats but 4\/4 needs 4/);
  });

  it('rejects an open string that names a finger', async () => {
    const { buildScore } = await import('@/scores/build');
    expect(() => buildScore({
      id: 'broken',
      timeSignature: [4, 4],
      metadata: SCORES[0].metadata,
      bars: [[{ s: 'A', n: 0, f: '2', b: 4 }]],
    })).toThrow(/open string but names finger 2/);
  });
});

describe('library rows', () => {
  it('marks every unbundled row as unplayable with a reason', () => {
    for (const row of LIBRARY_ROWS.filter((r) => !r.playable)) {
      expect(row.note.length).toBeGreaterThan(10);
      expect(row.bars).toBeNull();
    }
  });

  it('has a unique id per row', () => {
    const ids = LIBRARY_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports the Bach range from its actual notes', () => {
    const row = LIBRARY_ROWS.find((r) => r.id === 'bwv1007-prelude')!;
    expect(row.range).toBe('G2 – C4');
    expect(row.bars).toBe(4);
  });

  it('derives arrangement capability from score provenance, not category', async () => {
    const { COMPACT_SCORES, CORE_SCORES, isAdaptiveBundledScore } = await import('@/scores');

    expect(COMPACT_SCORES.every((score) => isAdaptiveBundledScore(score.id))).toBe(true);
    expect(CORE_SCORES.every((score) => !isAdaptiveBundledScore(score.id))).toBe(true);

    const generatedStudies = COMPACT_SCORES.filter((score) => score.category === 'study');
    expect(generatedStudies).toHaveLength(6);
    expect(generatedStudies.every((score) => isAdaptiveBundledScore(score.id))).toBe(true);
    expect(isAdaptiveBundledScore('bwv1007-prelude')).toBe(false);
  });

  it('validates every compact song and every adaptive arrangement level', async () => {
    const { COMPACT_SCORES, getScore, getBundledBacking, getGuideLine, getBassLine } = await import('@/scores');
    // Not a fixed number: `build:library` rewrites `bundledSongs.json` from
    // whatever is in `_MIDIS/`, so the count moves when the user adds or
    // deletes a source file. What must hold is that the library is there and
    // every song in it validates.
    expect(COMPACT_SCORES.length).toBeGreaterThan(FULL_LIBRARY ? 200 : 0);

    for (const item of COMPACT_SCORES) {
      const full = getScore(item.id);
      expect(full, item.id).toBeDefined();
      if (!full) continue;
      expect(validateScore(full), item.id).toEqual([]);
      expect(full.notes.length, item.id).toBeGreaterThan(0);
      expect(full.notes.every((note) => note.midiNumber >= 36 && note.midiNumber <= 81), item.id).toBe(true);

      const guide = getGuideLine(item.id);
      const versions = ARRANGEMENT_LEVELS.map((level) =>
        arrangeScoreForLevel(full, level, { guide, bass: getBassLine(item.id) }));
      // Beginner is not on the melody's note-count ladder: it plays the
      // harmonic guide, a different line whose notes are held roots rather
      // than melody attacks, so counting them says nothing about which is
      // easier. The three melody levels still have to be a ladder, and
      // Beginner still has to be a beginner's line — asserted below.
      const counts = versions.map((score) => score.notes.length);
      expect(counts[2], item.id).toBeLessThanOrEqual(counts[3] ?? Infinity);
      expect(counts[3], item.id).toBe(full.notes.length);

      const beginner = versions[0]!;
      const seconds = Math.max(1, scoreDurationMs(beginner) / 1000);
      expect(beginner.notes.length / seconds, `${item.id} attacks/s`)
        .toBeLessThanOrEqual(ARRANGEMENT_PROFILES.Beginner.maxNotesPerSecond + 0.01);
      // Every note in the neck, where the tapes are. Not "first position
      // only": a line is seated by reading the whole passage now, and the
      // answer to an awkward semitone is often a settled hand in second or
      // third position rather than a dip into half position and straight back
      // out. What a beginner needs is a hand that stays put, and that is
      // asserted in `fingering.test.ts` where it can be counted properly.
      expect(
        beginner.notes.every((note) => NECK_POSITIONS.includes(note.position)),
        `${item.id} beginner stays in the neck`,
      ).toBe(true);
      for (let i = 1; i < beginner.notes.length; i++) {
        expect(
          Math.abs(beginner.notes[i]!.midiNumber - beginner.notes[i - 1]!.midiNumber),
          `${item.id} beginner leap at note ${i}`,
        ).toBeLessThanOrEqual(ARRANGEMENT_PROFILES.Beginner.maxLeapSemitones);
      }

      for (let index = 0; index < versions.length; index++) {
        const level = ARRANGEMENT_LEVELS[index];
        const version = versions[index];
        if (!level || !version) continue;
        const range = ARRANGEMENT_PROFILES[level].range;
        // Measured through the seating the app actually uses, not through the
        // fixed first-position map it used to use. Scoring a line against a
        // fingering nobody plays is how a tier drifts away from the thing it
        // describes.
        const actual = difficultyOf(version.notes, seatLine(
          version.notes.map((note) => ({
            midiNumber: note.midiNumber,
            startTimeMs: note.startTimeMs,
            durationMs: note.durationMs,
          })),
          { closedFrameOnly: ARRANGEMENT_PROFILES[level].closedFrameOnly },
        ));
        expect(ARRANGEMENT_LEVELS.indexOf(actual.tier), `${item.id}/${level} measured difficulty`)
          .toBeLessThanOrEqual(ARRANGEMENT_LEVELS.indexOf(level));
        for (const note of version.notes) {
          if (level === 'Beginner' || level === 'Intermediate') expect(note.extension, `${item.id}/${level} extension`).toBe('none');
          expect(NECK_POSITIONS, `${item.id}/${level}/${note.id}`).toContain(note.position);
          // Inside the neck: fourth position anchors at 7 and the little
          // finger reaches 3 above it, one more when extended.
          expect(note.midiNumber - OPEN_STRING_MIDI[note.string], `${item.id}/${level} stop`)
            .toBeLessThanOrEqual(11);
          if (Object.values(OPEN_STRING_MIDI).includes(note.midiNumber)) {
            expect(note.finger, `${item.id}/${level} open string`).toBe('0');
          }
        }
        // The guide is written narrower than the level allows, never wider.
        expect(validateScore(version), `${item.id}/${level}`).toEqual([]);
        expect(version.notes.length, `${item.id}/${level}`).toBeGreaterThan(0);
        expect(
          version.notes.every((note) => note.midiNumber >= range.low && note.midiNumber <= range.high),
          `${item.id}/${level}`,
        ).toBe(true);

        const cello = soloPartFromScore(version);
        expect(cello.notes.map((note) => note.midiNumber), `${item.id}/${level}`)
          .toEqual(version.notes.map((note) => note.midiNumber));
        expect(cello.notes.map((note) => note.startTimeMs), `${item.id}/${level}`)
          .toEqual(version.notes.map((note) => note.startTimeMs));
      }

      const backing = getBundledBacking(item.id);
      expect(backing, item.id).toBeDefined();
      expect(backing?.parts.length ?? 0, item.id).toBeGreaterThan(0);
      for (const part of backing?.parts ?? []) {
        expect(part.notes.every((note) => note.startTimeMs >= 0 && note.durationMs > 0), `${item.id}/${part.id}`)
          .toBe(true);
      }
    }
  }, 120_000);

  it('provides backing tracks for all 5 training study exercises', async () => {
    const { getBundledBacking } = await import('@/scores');
    const studyIds = [
      'open-strings',
      'first-position-ladder',
      'd-major-two-strings',
      'c-major-two-strings',
      'thumb-position-ladder',
    ];

    for (const id of studyIds) {
      const backing = getBundledBacking(id);
      expect(backing).toBeDefined();
      expect(backing!.parts.length).toBeGreaterThan(0);
      expect(backing!.durationMs).toBeGreaterThan(0);
    }
  });
});

