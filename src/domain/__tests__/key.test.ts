import { describe, expect, it } from 'vitest';

import { OPEN_STRING_MIDI } from '../cello';
import {
  detectKey, fingerboardMarkers, keyName, parseScaleKey, pitchClassHistogram, songPitchClasses,
  songPlayedNotes,
} from '../key';
import { CelloSongScore } from '../schema';

function note(midiNumber: number, durationMs = 500) {
  return { midiNumber, durationMs };
}

/** A minimal score wrapper for the song-level helpers. */
function scoreOf(midis: number[]): CelloSongScore {
  return {
    schemaVersion: '1.0.0',
    id: 'k',
    metadata: {
      title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
      bpm: 120, difficulty: 'Beginner', tonic: 'C', teaches: '', rights: '',
    },
    measures: [{ index: 0, startBarTimeMs: 0, durationMs: 2000, timeSignature: [4, 4], tempoBpm: 120 }],
    notes: midis.map((midiNumber, i) => ({
      id: `k-${i}`, startTimeMs: i * 100, durationMs: 100,
      pitchName: '', midiNumber, frequency: 0, string: 'C' as const, finger: '0' as const,
      position: '1st' as const, extension: 'none' as const, articulation: 'arco' as const,
      tie: false, measureIndex: 0,
    })),
  };
}

describe('key detection', () => {
  it('names keys with the conventional accidental', () => {
    expect(keyName(2, 'major')).toBe('D major');   // two sharps
    expect(keyName(5, 'major')).toBe('F major');   // one flat
    expect(keyName(9, 'minor')).toBe('A minor');   // no accidentals
    expect(keyName(7, 'minor')).toBe('G minor');   // flats
  });

  it('finds C major from a C major scale', () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72].map((m) => note(m));
    const key = detectKey(scale);
    expect(key.tonic).toBe(0);
    expect(key.mode).toBe('major');
    expect(key.name).toBe('C major');
    expect(key.scale).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('finds A minor and distinguishes it from C major by emphasis', () => {
    // Weight the A-minor tonic and dominant heavily.
    const notes = [
      note(57, 2000), note(57, 2000), note(64, 1500), // A and E emphasised
      note(60, 300), note(62, 300), note(65, 300), note(67, 300), note(69, 800),
    ];
    const key = detectKey(notes);
    expect(key.tonic).toBe(9);
    expect(key.mode).toBe('minor');
    expect(key.name).toBe('A minor');
  });

  it('finds D major from a first-position D major scale', () => {
    const dMajor = [50, 52, 54, 55, 57, 59, 61, 62].map((m) => note(m));
    const key = detectKey(dMajor);
    expect(key.name).toBe('D major');
    expect(key.scale).toEqual([2, 4, 6, 7, 9, 11, 1]);
  });

  it('weights the histogram by duration', () => {
    const histogram = pitchClassHistogram([note(60, 1000), note(62, 200)]);
    expect(histogram[0]).toBe(1000);
    expect(histogram[2]).toBe(200);
  });

  it('reports zero confidence for no notes', () => {
    expect(detectKey([]).confidence).toBe(0);
  });

  it('reports higher confidence for a clear key than an ambiguous cluster', () => {
    const clear = detectKey([60, 62, 64, 65, 67, 69, 71, 72].map((m) => note(m, 500)));
    const chromatic = detectKey(Array.from({ length: 12 }, (_, i) => note(60 + i, 500)));
    expect(clear.confidence).toBeGreaterThan(chromatic.confidence);
  });
});

describe('song pitch classes', () => {
  it('collects the distinct classes used, ascending', () => {
    expect(songPitchClasses(scoreOf([60, 72, 64, 60, 67]))).toEqual([0, 4, 7]);
  });
});

describe('fingerboard markers', () => {
  it('places an open string when its pitch class belongs', () => {
    const markers = fingerboardMarkers([0]); // C
    const openC = markers.find((m) => m.string === 'C' && m.semitones === 0);
    expect(openC).toBeDefined();
    expect(openC!.midiNumber).toBe(OPEN_STRING_MIDI.C);
  });

  it('marks every diatonic stopping point on every string within range', () => {
    const cMajor = [0, 2, 4, 5, 7, 9, 11];
    const markers = fingerboardMarkers(cMajor, { maxSemitones: 12, tonic: 0 });
    // All markers are in the requested set.
    expect(markers.every((m) => cMajor.includes(m.pitchClass))).toBe(true);
    // Tonic flag is set only for C.
    expect(markers.every((m) => m.isTonic === (m.pitchClass === 0))).toBe(true);
    // The A string (open A, pc 9) is diatonic in C major, so semitone 0 appears.
    expect(markers.some((m) => m.string === 'A' && m.semitones === 0)).toBe(true);
  });

  it('respects the drawn range ceiling', () => {
    const markers = fingerboardMarkers([0, 2, 4, 5, 7, 9, 11], { maxSemitones: 5 });
    expect(markers.every((m) => m.semitones <= 5)).toBe(true);
  });

  it('spells with flats when asked', () => {
    const [marker] = fingerboardMarkers([1], { maxSemitones: 2, preferFlats: true });
    expect(marker.pitchName.startsWith('Db')).toBe(true);
  });
});

describe('songPlayedNotes', () => {
  it('returns only unique notes actually played in the score', () => {
    const score = scoreOf([36, 38, 36]); // C2, D2, C2 on C string (semitones 0 and 2)
    const played = songPlayedNotes(score, { tonic: 0 });

    expect(played).toHaveLength(2);
    expect(played.map((p) => p.semitones)).toEqual([0, 2]);
    expect(played[0].string).toBe('C');
    expect(played[0].isTonic).toBe(true);
    expect(played[1].isTonic).toBe(false);
  });
});

describe('parseScaleKey', () => {
  it('parses major and minor keys with accidentals and suffixes', () => {
    const cMaj = parseScaleKey('C');
    expect(cMaj).toEqual({
      tonic: 0,
      mode: 'major',
      scale: [0, 2, 4, 5, 7, 9, 11],
      name: 'C major',
    });

    const aMin = parseScaleKey('Am');
    expect(aMin).toEqual({
      tonic: 9,
      mode: 'minor',
      scale: [9, 11, 0, 2, 4, 5, 7],
      name: 'A minor',
    });

    const bMin = parseScaleKey('Bm');
    expect(bMin?.tonic).toBe(11);
    expect(bMin?.mode).toBe('minor');
    expect(bMin?.scale).toEqual([11, 1, 2, 4, 6, 7, 9]);

    const fSharpMin = parseScaleKey('F#m');
    expect(fSharpMin?.tonic).toBe(6);
    expect(fSharpMin?.mode).toBe('minor');

    const bFlat = parseScaleKey('Bb');
    expect(bFlat?.tonic).toBe(10);
    expect(bFlat?.mode).toBe('major');

    const bFlatMin = parseScaleKey('Bbm');
    expect(bFlatMin?.tonic).toBe(10);
    expect(bFlatMin?.mode).toBe('minor');

    const ebMajor = parseScaleKey('Eb major');
    expect(ebMajor?.tonic).toBe(3);
    expect(ebMajor?.mode).toBe('major');

    const dMinor = parseScaleKey('D minor');
    expect(dMinor?.tonic).toBe(2);
    expect(dMinor?.mode).toBe('minor');
  });

  it('returns null for unknown or empty input', () => {
    expect(parseScaleKey('')).toBeNull();
    expect(parseScaleKey(null)).toBeNull();
    expect(parseScaleKey('unknown')).toBeNull();
    expect(parseScaleKey('XYZ')).toBeNull();
  });
});
