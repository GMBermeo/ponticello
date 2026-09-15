import { describe, expect, it } from 'vitest';

import {
  arrangeMidi, arrangeScoreForLevel, ARRANGEMENT_LEVELS, ARRANGEMENT_PROFILES,
  FULL_CELLO_RANGE, fitLineToRange, bassLine, harmonicGuide, midiContentEndMs, rebaseLine, smoothLeaps,
} from '../arrangement';
import { firstPositionFingering } from '../fingering';
import { MidiNote, MidiTrack } from '../midi';
import { CelloSongScore } from '../schema';

function track(index: number, name: string, program: number, notes: MidiNote[]): MidiTrack {
  return {
    index, name, program, channels: [0], noteCount: notes.length,
    lowestMidi: Math.min(...notes.map((n) => n.midiNumber)),
    highestMidi: Math.max(...notes.map((n) => n.midiNumber)),
    isPercussion: false,
  };
}

function line(index: number, pitches: number[], stepMs = 125, velocity = 90): MidiNote[] {
  return pitches.map((midiNumber, i) => ({
    midiNumber, startTimeMs: i * stepMs, durationMs: Math.max(40, stepMs - 10),
    track: index, channel: 0, velocity,
  }));
}

function parsed(tracks: MidiTrack[], notes: MidiNote[]) {
  return {
    tracks, notes, bpm: 120, timeSignature: [4, 4] as [number, number],
    durationMs: notes.reduce((max, n) => Math.max(max, n.startTimeMs + n.durationMs), 0),
  };
}

function scoreFrom(pitches: number[], stepMs = 100): CelloSongScore {
  const durationMs = Math.max(2000, pitches.length * stepMs);
  return {
    schemaVersion: '1.0.0', id: 'dense-riff',
    metadata: {
      title: 'Dense riff', composer: '', origin: '', keySignature: 'E MINOR',
      timeSignature: '4/4', bpm: 120, difficulty: 'Expert', tonic: 'E', teaches: '', rights: '',
    },
    measures: Array.from({ length: Math.ceil(durationMs / 2000) }, (_, index) => ({
      index, startBarTimeMs: index * 2000, durationMs: 2000,
      timeSignature: [4, 4] as [number, number], tempoBpm: 120,
    })),
    notes: pitches.map((midiNumber, i) => ({
      id: `n${i}`, midiNumber, pitchName: 'C4', frequency: 261.63,
      startTimeMs: i * stepMs, durationMs: stepMs - 10, measureIndex: Math.floor(i * stepMs / 2000),
      string: 'A' as const, finger: '1' as const, position: '1st' as const,
      extension: 'none' as const, articulation: 'arco' as const, tie: false, bowDirection: 'down' as const,
    })),
  };
}

describe('riff-first MIDI arrangement', () => {
  it('chooses a recurring guitar/bass riff over a wide fast solo', () => {
    const riffPattern = [40, 40, 43, 45, 43, 40, 47, 45];
    const riff = line(0, Array.from({ length: 6 }, () => riffPattern).flat(), 250);
    const solo = line(1, Array.from({ length: 80 }, (_, i) => 72 + ((i * 7) % 29)), 75);
    const source = parsed(
      [track(0, 'Bass riff', 34, riff), track(1, 'Solo Guitar', 29, solo)],
      [...riff, ...solo],
    );

    const arranged = arrangeMidi(source, { level: 'Expert' });
    expect(arranged.sourceTrack).toBe(0);
    expect(arranged.sourceKind).toBe('riff');
  });

  it('falls back to a root guide when no track is a viable melodic line', () => {
    const chordNotes = [
      ...line(0, [36, 40, 43, 38, 41, 45], 500),
      ...line(1, [60, 64, 67, 62, 65, 69], 500),
    ];
    const source = parsed(
      [track(0, 'Low harmony', 0, chordNotes.filter((n) => n.track === 0)), track(1, 'High harmony', 0, chordNotes.filter((n) => n.track === 1))],
      chordNotes,
    );

    const arranged = arrangeMidi(source, { level: 'Beginner' });
    expect(arranged.sourceKind).toBe('roots');
    expect(arranged.notes.length).toBeGreaterThan(0);
    expect(arranged.notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 63)).toBe(true);
  });

  it('rejects an isolated remote trailing event when the other tracks agree on the ending', () => {
    const theme = line(0, Array.from({ length: 40 }, (_, index) => 48 + (index % 8)), 250);
    theme.push({
      midiNumber: 60, startTimeMs: 3_600_000, durationMs: 100,
      track: 0, channel: 0, velocity: 90,
    });
    const harmony = line(1, Array.from({ length: 20 }, (_, index) => 52 + (index % 4)), 500);
    const bass = line(2, Array.from({ length: 20 }, (_, index) => 36 + (index % 3)), 500);
    const source = parsed(
      [track(0, 'Theme riff', 27, theme), track(1, 'Harmony', 48, harmony), track(2, 'Bass', 34, bass)],
      [...theme, ...harmony, ...bass],
    );
    source.durationMs = 3_600_100;

    expect(midiContentEndMs(source)).toBeLessThan(11_000);
    const arranged = arrangeMidi(source, { level: 'Expert', sourceTrack: 0 });
    expect(arranged.notes.at(-1)?.startTimeMs).toBeLessThan(11_000);
  });

  it('fits a high guitar line into the full cello compass as one coherent octave move', () => {
    const high = line(0, [84, 86, 88, 89, 88, 86, 84, 81, 79, 81, 84, 86], 300);
    const arranged = arrangeMidi(parsed([track(0, 'Theme', 27, high)], high), { level: 'Expert' });
    expect(arranged.notes.every((n) => n.midiNumber >= FULL_CELLO_RANGE.low && n.midiNumber <= FULL_CELLO_RANGE.high)).toBe(true);
    expect(Math.abs(arranged.octaveShift % 12)).toBe(0);
    expect(arranged.foldedNotes).toBe(0);
  });
});

describe('the harmonic guide', () => {
  const chords = [
    ...line(0, [48, 48, 53, 53, 55, 55, 48, 48], 1000),   // bass: C C F F G G C C
    ...line(1, [72, 76, 77, 81, 79, 83, 72, 76], 1000),   // melody two octaves up
  ];
  const source = parsed(
    [track(0, 'Bass', 34, chords.filter((n) => n.track === 0)),
      track(1, 'Lead', 30, chords.filter((n) => n.track === 1))],
    chords,
  );

  it('reads the roots of the harmony, not the melody on top of it', () => {
    const guide = harmonicGuide(source, source.durationMs);
    expect(guide.length).toBeGreaterThan(0);
    // C F G C, in the low register, whatever octave the source wrote them in.
    expect([...new Set(guide.map((n) => n.midiNumber % 12))].sort((a, b) => a - b))
      .toEqual([0, 5, 7]);
    expect(guide.every((n) => n.midiNumber >= 36 && n.midiNumber <= 55)).toBe(true);
  });

  it('re-strikes the root on the beat rather than tying it, and changes it only on the harmony', () => {
    const guide = harmonicGuide(source, source.durationMs);
    // A published beginner bass part holds nothing longer than a crotchet and
    // repeats about half its adjacent pairs. See DOCTRINE.md \u00a73.
    const beatMs = 500;
    expect(guide.every((note) => note.durationMs <= beatMs * 1.6)).toBe(true);
    const repeated = guide.filter((note, i) => i > 0 && guide[i - 1]!.midiNumber === note.midiNumber);
    expect(repeated.length / guide.length).toBeGreaterThan(0.4);
    // C F G C: four changes of pitch across eight seconds, and no more.
    const changes = guide.filter((note, i) => i > 0 && guide[i - 1]!.midiNumber !== note.midiNumber);
    expect(changes.length).toBeLessThanOrEqual(4);
  });

  it('is what the Beginner level plays', () => {
    const arranged = arrangeMidi(source, { level: 'Beginner' });
    expect(arranged.sourceKind).toBe('roots');
    expect(arranged.sourceTrack).toBeNull();
    expect(arranged.notes.every((n) => n.midiNumber <= ARRANGEMENT_PROFILES.Beginner.range.high)).toBe(true);
    expect(arrangeMidi(source, { level: 'Intermediate' }).sourceKind).toBe('bass');
  });
});

describe('leap smoothing', () => {
  it('folds a two-octave jump back toward its neighbours', () => {
    // What `monophonic` leaves behind when one track carries a melody and its
    // own bass notes: the tune, a root two octaves down, the tune again.
    const jumpy = line(0, [55, 31 + 12, 57, 33 + 12, 59], 250)
      .map((n, i) => ({ ...n, midiNumber: [55, 31, 57, 33, 59][i]! + (i % 2 ? 0 : 0) }));
    const smoothed = smoothLeaps(jumpy, { low: 36, high: 63 }, 12);
    for (let i = 1; i < smoothed.length; i++) {
      expect(Math.abs(smoothed[i]!.midiNumber - smoothed[i - 1]!.midiNumber))
        .toBeLessThanOrEqual(12);
    }
    // Only octaves are used, so the harmony is untouched.
    for (const [i, note] of smoothed.entries()) {
      expect(Math.abs(note.midiNumber - jumpy[i]!.midiNumber) % 12).toBe(0);
    }
  });

  it('leaves an octave leap alone, because that is ordinary cello writing', () => {
    const octaves = line(0, [48, 60, 48, 60], 500);
    expect(smoothLeaps(octaves, { low: 36, high: 63 }, 12).map((n) => n.midiNumber))
      .toEqual([48, 60, 48, 60]);
  });
});

describe('adaptive score difficulty', () => {
  it('offers all four levels with monotonically increasing detail and range', () => {
    const motif = [72, 74, 76, 77, 76, 74, 69, 71];
    const full = scoreFrom(Array.from({ length: 12 }, () => motif).flat(), 90);
    const versions = ARRANGEMENT_LEVELS.map((level) => arrangeScoreForLevel(full, level));
    const counts = versions.map((version) => version.notes.length);

    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
    expect(counts[2]).toBeLessThanOrEqual(counts[3]);
    expect(versions[0].notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 63)).toBe(true);
    expect(versions[3].notes.every((n) => n.midiNumber >= 36 && n.midiNumber <= 81)).toBe(true);
  });

  it('keeps a sparse beginner line low and limits its bow attacks', () => {
    const sparse = scoreFrom([48, 50, 52, 53, 55, 53, 52, 50], 600);
    const beginner = arrangeScoreForLevel(sparse, 'Beginner');
    const { range, maxNotesPerSecond } = ARRANGEMENT_PROFILES.Beginner;
    expect(beginner.notes.every((note) => note.midiNumber <= range.high)).toBe(true);
    expect(beginner.notes.every((note) => note.midiNumber >= range.low)).toBe(true);
    for (let i = 1; i < beginner.notes.length; i++) {
      expect(beginner.notes[i]!.startTimeMs - beginner.notes[i - 1]!.startTimeMs)
        .toBeGreaterThanOrEqual(1000 / maxNotesPerSecond - 1);
    }
  });

  it('fingers the beginner level in first position and nowhere else', () => {
    const full = scoreFrom([72, 74, 76, 77, 76, 74, 71, 69, 67, 65, 64, 62], 400);
    const beginner = arrangeScoreForLevel(full, 'Beginner');
    expect(ARRANGEMENT_PROFILES.Beginner.firstPositionOnly).toBe(true);
    expect(beginner.notes.every((n) => n.position === '1st' || n.position === 'Half')).toBe(true);
  });

  it('plays a stored guide at Beginner and the melody above it', () => {
    const full = scoreFrom([72, 74, 76, 77, 76, 74, 71, 69], 600);
    const guide = [43, 48, 43, 50].map((midiNumber, i) => ({
      midiNumber, startTimeMs: i * 1000, durationMs: 980,
    }));
    const beginner = arrangeScoreForLevel(full, 'Beginner', { guide });
    expect(beginner.notes.map((n) => n.midiNumber)).toEqual([43, 48, 43, 50]);
    expect(beginner.notes.every((n) => n.articulation === 'accent')).toBe(true);

    const intermediate = arrangeScoreForLevel(full, 'Intermediate', { guide });
    expect(intermediate.notes.map((n) => n.midiNumber)).not.toEqual([43, 48, 43, 50]);
  });

  it('keeps a single drone instead of falling back to the lead melody', () => {
    const full = scoreFrom([60, 62, 64, 65, 64, 62, 59, 57], 400);
    const stub = [{ midiNumber: 43, startTimeMs: 0, durationMs: 400 }];
    const beginner = arrangeScoreForLevel(full, 'Beginner', { guide: stub });
    expect(beginner.notes.map((note) => note.midiNumber)).toEqual([43]);
    expect(beginner.notes[0]!.durationMs).toBe(400);
  });
});


describe('bass accompaniment safeguards', () => {
  it('uses the lowest voice of a piano chord, excluding percussion', () => {
    const piano = [48, 52, 55, 76].map((midiNumber) => ({ ...line(0, [midiNumber], 1500)[0]! }));
    const drums = line(1, [24], 1500);
    const drumTrack = { ...track(1, 'Drums', 0, drums), isPercussion: true };
    const source = parsed([track(0, 'Piano', 0, piano), drumTrack], [...piano, ...drums]);
    expect(bassLine(source, source.durationMs).map((note) => note.midiNumber)).toEqual([48]);
  });

  it('ends a held bass at a chord change rather than holding over it', () => {
    const notes = [
      { ...line(0, [48], 500)[0]!, durationMs: 700 },
      { ...line(0, [49], 500)[0]!, startTimeMs: 700, durationMs: 800 },
      { ...line(0, [50], 500)[0]!, startTimeMs: 2200, durationMs: 800 },
    ];
    const source = parsed([track(0, 'Bass', 33, notes)], notes);
    const guide = harmonicGuide(source, source.durationMs);
    expect(guide[0]!.midiNumber % 12).toBe(0);
    expect(guide[0]!.durationMs).toBe(700);
    const bass = bassLine(source, source.durationMs);
    for (const note of guide) expect(supportedByBass(bass, note)).toBe(true);
  });

  it('clips an opening drone across an imported solo origin and tempo change', () => {
    expect(rebaseLine([{ midiNumber: 43, startTimeMs: 500, durationMs: 3000 }], 1000, 2500, 2))
      .toEqual([{ midiNumber: 43, startTimeMs: 0, durationMs: 3000 }]);
  });

  it('plays a stored bass at Intermediate even when the lead is more active', () => {
    const full = scoreFrom([72, 76, 79, 76, 74, 77, 81, 77], 500);
    const bass = [36, 41, 43, 36].map((midiNumber, i) => ({
      midiNumber, startTimeMs: i * 1000, durationMs: 900,
    }));
    const arranged = arrangeScoreForLevel(full, 'Intermediate', { bass });
    expect(arranged.notes.map((note) => note.midiNumber)).toEqual([36, 41, 43, 36]);
    expect(arranged.metadata.arrangementRole).toBe('bass');
  });

  it('keeps every level of a high, jumpy lead in the low first-position compass', () => {
    const full = scoreFrom([71, 69, 50, 83, 48, 81, 47, 76, 36, 71], 120);
    for (const level of ARRANGEMENT_LEVELS) {
      const score = arrangeScoreForLevel(full, level);
      expect(score.notes.every((note) => note.midiNumber <= 62)).toBe(true);
      expect(score.notes.every((note) => ['1st', 'Half'].includes(note.position))).toBe(true);
      for (const note of score.notes) {
        if ([36, 43, 50, 57].includes(note.midiNumber)) expect(note.finger).toBe('0');
      }
    }
  });
});


describe('source harmony and phrasing', () => {
  it('refuses to change a pitch class to force it into an impossible custom range', () => {
    expect(() => fitLineToRange(line(0, [61]), { low: 36, high: 36 })).toThrow(/harmony/);
  });

  it('re-bows a long drone without climbing to the melody', () => {
    const notes = [{ ...line(0, [43], 10000)[0]!, durationMs: 10000 }];
    const source = parsed([track(0, 'Bass', 33, notes)], notes);
    const guide = harmonicGuide(source, source.durationMs);
    expect(guide.length).toBeGreaterThanOrEqual(3);
    expect(guide.every((note) => note.midiNumber === 43 && note.durationMs <= 4000)).toBe(true);
    // Separately bowed, so the ten seconds come back as attacks on the pulse
    // with written rests between them rather than one tied note.
    expect(guide[0]!.startTimeMs).toBe(0);
    expect(guide.at(-1)!.startTimeMs + guide.at(-1)!.durationMs).toBe(10000);
    const sounding = guide.reduce((sum, note) => sum + note.durationMs, 0);
    expect(sounding).toBeGreaterThan(10000 * 0.6);
    expect(sounding).toBeLessThan(10000);
  });

  it('prefers a recurring theme across the song over a tiny, attractive lead fragment', () => {
    const theme = line(0, Array.from({ length: 100 }, (_, i) => [48, 50, 52, 55, 53, 52, 50, 48][i % 8]!), 400);
    const fragment = line(1, [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65], 100);
    const source = parsed([track(0, 'Theme', 0, theme), track(1, 'Solo melody', 42, fragment)], [...theme, ...fragment]);
    expect(arrangeMidi(source, { level: 'Expert' }).sourceTrack).toBe(0);
  });
});

/**
 * The audit's bass-support rule, copied so the engine cannot drift from it: a
 * held anchor has to be sounding in the song's bass for as long as it is held,
 * allowing 32 ms of articulation gap and 2 ms of rounding.
 */
function supportedByBass(
  bass: readonly { midiNumber: number; startTimeMs: number; durationMs: number }[],
  note: { midiNumber: number; startTimeMs: number; durationMs: number },
): boolean {
  let supportedUntil = note.startTimeMs;
  for (const original of [...bass].sort((a, b) => a.startTimeMs - b.startTimeMs)) {
    if (original.startTimeMs > note.startTimeMs + note.durationMs + 32) break;
    if (original.midiNumber % 12 !== note.midiNumber % 12) continue;
    if (original.startTimeMs > supportedUntil + 32) continue;
    supportedUntil = Math.max(supportedUntil, original.startTimeMs + original.durationMs);
  }
  return supportedUntil + 2 >= note.startTimeMs + note.durationMs;
}

const BAR_MS = 2000;

/**
 * Eight bars of Am–G–C–F in a piano, with a bass that only joins for the last
 * four — the shape that left 128 of the 258 bundled songs silent at the start.
 */
function lateBassSource() {
  const chords: Record<string, number[]> = {
    Am: [69, 72, 76], G: [67, 71, 74], C: [72, 76, 79], F: [65, 69, 72],
  };
  const roots: Record<string, number> = { Am: 9, G: 7, C: 0, F: 5 };
  const progression = ['Am', 'G', 'C', 'F', 'Am', 'G', 'C', 'F'];
  const piano: MidiNote[] = progression.flatMap((name, bar) =>
    chords[name]!.map((midiNumber) => ({
      midiNumber, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
      track: 0, channel: 0, velocity: 90,
    })));
  const bass: MidiNote[] = progression.slice(4).map((name, index) => ({
    midiNumber: 36 + roots[name]!, startTimeMs: (index + 4) * BAR_MS, durationMs: BAR_MS - 20,
    track: 1, channel: 0, velocity: 100,
  }));
  return {
    source: parsed([track(0, 'Piano', 0, piano), track(1, 'Bass', 34, bass)], [...piano, ...bass]),
    roots: new Set(Object.values(roots)),
  };
}

describe('the accompaniment covers the whole song', () => {
  it('enters in the first bar even when the band\u2019s bass waits eight', () => {
    const { source } = lateBassSource();
    const guide = harmonicGuide(source, source.durationMs);
    const bass = bassLine(source, source.durationMs);
    expect(guide[0]!.startTimeMs).toBeLessThan(2 * BAR_MS);
    expect(bass[0]!.startTimeMs).toBeLessThan(2 * BAR_MS);
  });

  it('plays to the last bar and never rests for more than two of them', () => {
    const { source } = lateBassSource();
    const endMs = source.durationMs;
    for (const line of [harmonicGuide(source, endMs), bassLine(source, endMs)]) {
      const last = line.reduce((max, note) => Math.max(max, note.startTimeMs + note.durationMs), 0);
      expect(endMs - last).toBeLessThanOrEqual(2 * BAR_MS);
      const sorted = [...line].sort((a, b) => a.startTimeMs - b.startTimeMs);
      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i]!.startTimeMs - (sorted[i - 1]!.startTimeMs + sorted[i - 1]!.durationMs);
        expect(gap).toBeLessThanOrEqual(2 * BAR_MS);
      }
    }
  });

  it('reads the roots off the piano while the bass is still resting', () => {
    const { source, roots } = lateBassSource();
    const guide = harmonicGuide(source, source.durationMs);
    const opening = guide.filter((note) => note.startTimeMs < 4 * BAR_MS);
    expect(opening.length).toBeGreaterThanOrEqual(4);
    // Roots and fifths of the sounding chord, and nothing invented: no tonic
    // pedal ground through the G, the C and the F.
    for (const note of opening) {
      const pitchClass = note.midiNumber % 12;
      expect([...roots].some((root) => pitchClass === root || pitchClass === (root + 7) % 12)).toBe(true);
    }
    expect(new Set(opening.map((note) => note.midiNumber % 12)).size).toBeGreaterThan(1);
  });

  it('never holds an anchor the song\u2019s bass has stopped playing', () => {
    const { source } = lateBassSource();
    const endMs = source.durationMs;
    const bass = bassLine(source, endMs);
    for (const note of harmonicGuide(source, endMs)) {
      expect(supportedByBass(bass, note)).toBe(true);
    }
  });

  it('holds one pitch class through a bass that hammers it in sixteenths', () => {
    // The Thunderstruck shape: a pedal root alternating with a riff note, far
    // too fast for any single articulation to be worth a bow stroke.
    const notes: MidiNote[] = [];
    for (let i = 0; i < 64; i++) {
      notes.push({
        midiNumber: i % 2 === 0 ? 42 : 61, startTimeMs: i * 125, durationMs: 120,
        track: 0, channel: 0, velocity: 100,
      });
    }
    const source = parsed([track(0, 'Bass', 34, notes)], notes);
    const guide = harmonicGuide(source, source.durationMs);
    expect(guide.length).toBeGreaterThanOrEqual(3);
    // One pitch class, re-struck on the beat: nothing shorter than the level's
    // attack ceiling allows, and no 120 ms bow strokes chasing the source.
    expect(new Set(guide.map((note) => note.midiNumber % 12)).size).toBe(1);
    for (let i = 1; i < guide.length; i++) {
      expect(guide[i]!.startTimeMs - guide[i - 1]!.startTimeMs)
        .toBeGreaterThanOrEqual(1000 / ARRANGEMENT_PROFILES.Beginner.maxNotesPerSecond - 1);
    }
  });
});

describe('a beginner part is drones and roots, in the key', () => {
  /** Twelve bars of C and F, with a chromatic walk-up into every chord. */
  function chromaticApproachSource() {
    const notes: MidiNote[] = [];
    for (let bar = 0; bar < 12; bar++) {
      const root = bar % 2 === 0 ? 36 : 41;
      // Root for three beats, then a semitone approach to the next chord.
      notes.push({ midiNumber: root, startTimeMs: bar * BAR_MS, durationMs: 1400,
        track: 0, channel: 0, velocity: 100 });
      notes.push({ midiNumber: (bar % 2 === 0 ? 41 : 36) - 1, startTimeMs: bar * BAR_MS + 1500,
        durationMs: 480, track: 0, channel: 0, velocity: 80 });
      for (const midiNumber of bar % 2 === 0 ? [60, 64, 67] : [65, 69, 72]) {
        notes.push({ midiNumber, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
          track: 1, channel: 0, velocity: 85 });
      }
    }
    return parsed(
      [track(0, 'Bass', 34, notes.filter((n) => n.track === 0)),
        track(1, 'Piano', 0, notes.filter((n) => n.track === 1))],
      notes,
    );
  }

  it('uses at most six pitch classes', () => {
    const source = chromaticApproachSource();
    const guide = harmonicGuide(source, source.durationMs);
    expect(new Set(guide.map((note) => note.midiNumber % 12)).size).toBeLessThanOrEqual(6);
  });

  it('leaves the chromatic approach notes to the bass player', () => {
    const source = chromaticApproachSource();
    const guide = harmonicGuide(source, source.durationMs);
    // 40 is the approach to F and 35 the approach back to C.
    expect(guide.some((note) => note.midiNumber % 12 === 4)).toBe(false);
    expect(guide.some((note) => note.midiNumber % 12 === 11)).toBe(false);
  });

  it('takes the open string whenever the harmony offers one', () => {
    // C, G, D and A roots: every one of them is an open cello string.
    const roots = [0, 7, 2, 9, 0, 7, 2, 9];
    const notes: MidiNote[] = roots.flatMap((pc, bar) => [
      { midiNumber: 48 + pc, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
        track: 0, channel: 0, velocity: 100 },
      { midiNumber: 72 + pc, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
        track: 1, channel: 0, velocity: 85 },
    ]);
    const source = parsed(
      [track(0, 'Bass', 34, notes.filter((n) => n.track === 0)),
        track(1, 'Lead', 30, notes.filter((n) => n.track === 1))],
      notes,
    );
    const guide = harmonicGuide(source, source.durationMs);
    const opens = guide.filter((note) => [36, 43, 50, 57].includes(note.midiNumber));
    // Three of the four, not all four: the open C and the open A are 21
    // semitones apart, so a progression that turns from the A back to the C
    // cannot take both, and one class gets a stopped seat instead.
    expect(opens.length / guide.length).toBeGreaterThanOrEqual(0.7);
    expect(new Set(guide.map((note) => note.midiNumber)).size).toBe(4);
  });

  it('keeps every anchor inside the closed first-position frame', () => {
    const source = chromaticApproachSource();
    for (const note of harmonicGuide(source, source.durationMs)) {
      const state = firstPositionFingering(note.midiNumber);
      expect(state.extension).toBe('none');
      expect(['Half', '1st']).toContain(state.position);
    }
  });
});

describe('Advanced and Expert are two levels', () => {
  it('thins a fast passage at Advanced and keeps it at Expert', () => {
    const fast = scoreFrom(Array.from({ length: 96 }, (_, i) => 52 + (i % 8)), 100);
    const advanced = arrangeScoreForLevel(fast, 'Advanced');
    const expert = arrangeScoreForLevel(fast, 'Expert');
    expect(advanced.notes.length).toBeLessThan(expert.notes.length);
    expect(ARRANGEMENT_PROFILES.Advanced.maxNotesPerSecond)
      .toBeLessThan(ARRANGEMENT_PROFILES.Expert.maxNotesPerSecond);
    // Thinning, not folding: both melody levels get the published easy-grade
    // register, up to D4 on the A string.
    expect(ARRANGEMENT_PROFILES.Advanced.range.high).toBe(62);
  });
});

describe('the published beginner register', () => {
  it('stops nothing below the open G when the octave above is reachable', () => {
    // G, D, A and E all have a seat on the G, D or A string within reach of
    // each other, and all four also have a low C-string seat. The chooser has
    // to decline every one of those: ABRSM Grade 1 starts at the open G.
    const roots = [7, 2, 9, 4];
    const notes: MidiNote[] = roots.flatMap((pc, bar) => [
      { midiNumber: 48 + pc, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
        track: 0, channel: 0, velocity: 100 },
      { midiNumber: 72 + pc, startTimeMs: bar * BAR_MS, durationMs: BAR_MS - 20,
        track: 1, channel: 0, velocity: 85 },
    ]);
    const source = parsed(
      [track(0, 'Bass', 34, notes.filter((n) => n.track === 0)),
        track(1, 'Lead', 30, notes.filter((n) => n.track === 1))],
      notes,
    );
    for (const note of harmonicGuide(source, source.durationMs)) {
      const state = firstPositionFingering(note.midiNumber);
      expect(state.string === 'C' ? state.finger : '0').toBe('0');
    }
  });

  it('never writes above D4, the published beginner ceiling', () => {
    const { source } = lateBassSource();
    for (const note of harmonicGuide(source, source.durationMs)) {
      expect(note.midiNumber).toBeLessThanOrEqual(62);
    }
  });
});
