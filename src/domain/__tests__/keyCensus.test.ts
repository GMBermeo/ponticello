import { describe, expect, it } from 'vitest';

import {
  DRILLS_EARNED, KEY_DEMAND_AT, canonicalKeyName, censusEntry, censusLine, fifthsOf, keyCensus,
  keyDemand, openStringTonic, parseKeyName,
} from '../keyCensus';
import { keyName } from '../key';
import { COMPACT_SCORES } from '@/scores/bundledSongs';
import { LIBRARY_KEY_CENSUS } from '@/scores';

describe('parseKeyName', () => {
  it('reads the spellings the library and the importers produce', () => {
    expect(parseKeyName('E minor')).toEqual({ tonic: 4, mode: 'minor' });
    expect(parseKeyName('E MINOR')).toEqual({ tonic: 4, mode: 'minor' });
    expect(parseKeyName('  b♭ major ')).toEqual({ tonic: 10, mode: 'major' });
    expect(parseKeyName('Bb major')).toEqual({ tonic: 10, mode: 'major' });
    expect(parseKeyName('F# minor')).toEqual({ tonic: 6, mode: 'minor' });
    expect(parseKeyName('D♯ minor')).toEqual({ tonic: 3, mode: 'minor' });
  });

  it('refuses to guess at anything that is not a key', () => {
    for (const label of ['', 'CHROMATIC', 'minor', 'H major', 'C', 'modal']) {
      expect(parseKeyName(label)).toBeNull();
    }
  });

  it('round-trips every key through the canonical spelling', () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ['major', 'minor'] as const) {
        const label = keyName(tonic, mode);
        expect(parseKeyName(label)).toEqual({ tonic, mode });
        expect(canonicalKeyName({ tonic, mode })).toBe(label);
      }
    }
  });
});

describe('fifthsOf', () => {
  it('counts the accidentals in the key signature', () => {
    expect(fifthsOf({ tonic: 0, mode: 'major' })).toBe(0); // C major
    expect(fifthsOf({ tonic: 9, mode: 'minor' })).toBe(0); // A minor
    expect(fifthsOf({ tonic: 7, mode: 'major' })).toBe(1); // G major, one sharp
    expect(fifthsOf({ tonic: 2, mode: 'major' })).toBe(2); // D major, two sharps
    expect(fifthsOf({ tonic: 5, mode: 'major' })).toBe(-1); // F major, one flat
    expect(fifthsOf({ tonic: 10, mode: 'major' })).toBe(-2); // B♭ major, two flats
    expect(fifthsOf({ tonic: 4, mode: 'minor' })).toBe(1); // E minor, one sharp
    expect(fifthsOf({ tonic: 2, mode: 'minor' })).toBe(-1); // D minor, one flat
    expect(fifthsOf({ tonic: 6, mode: 'major' })).toBe(6); // F♯ major, six sharps
  });
});

describe('openStringTonic', () => {
  it('names the open string for exactly the four keys tuned to one', () => {
    expect(openStringTonic(0)).toBe('C');
    expect(openStringTonic(7)).toBe('G');
    expect(openStringTonic(2)).toBe('D');
    expect(openStringTonic(9)).toBe('A');
    for (const other of [1, 3, 4, 5, 6, 8, 10, 11]) {
      expect(openStringTonic(other)).toBeNull();
    }
  });
});

describe('keyCensus', () => {
  it('counts a fixture rather than assuming the library', () => {
    const census = keyCensus([
      { key: 'E minor' }, { key: 'E minor' }, { key: 'E minor' },
      { key: 'G major' }, { key: 'G major' },
      { key: 'B♭ major' },
      { key: 'CHROMATIC' },
    ]);

    expect(census.counted).toBe(6);
    expect(census.unparsed).toBe(1);
    expect(census.entries.map((e) => [e.key, e.songs, e.rank]))
      .toEqual([['E minor', 3, 1], ['G major', 2, 2], ['B♭ major', 1, 3]]);
    expect(census.entries[0]!.share).toBeCloseTo(0.5, 5);
    // Only G major's tonic is an open string here.
    expect(census.openStringSongs).toBe(2);
  });

  it('breaks ties towards the key that is easier to start on', () => {
    // Three keys, one song each: A major has an open-string tonic, B minor
    // does not, and E major has more accidentals than both.
    const census = keyCensus([{ key: 'B minor' }, { key: 'E major' }, { key: 'A major' }]);
    expect(census.entries.map((e) => e.key)).toEqual(['A major', 'B minor', 'E major']);
  });

  it('is stable when the same songs arrive in another order', () => {
    const songs = [{ key: 'D minor' }, { key: 'C major' }, { key: 'D minor' }, { key: 'F major' }];
    const forwards = keyCensus(songs).entries.map((e) => e.key);
    const backwards = keyCensus([...songs].reverse()).entries.map((e) => e.key);
    expect(backwards).toEqual(forwards);
  });

  it('survives an empty library without dividing by zero', () => {
    const census = keyCensus([]);
    expect(census).toMatchObject({ counted: 0, unparsed: 0, openStringSongs: 0 });
    expect(census.entries).toEqual([]);
  });

  it('finds a key by tonic and mode, including a negative pitch class', () => {
    const census = keyCensus([{ key: 'E minor' }, { key: 'C major' }]);
    expect(censusEntry(census, 4, 'minor')?.songs).toBe(1);
    expect(censusEntry(census, 4 - 12, 'minor')?.songs).toBe(1);
    expect(censusEntry(census, 4, 'major')).toBeUndefined();
  });
});

describe('keyDemand', () => {
  it('bands a key by its share of the library, not by a written-down count', () => {
    expect(keyDemand(0.17)).toBe('cornerstone');
    expect(keyDemand(KEY_DEMAND_AT.cornerstone)).toBe('cornerstone');
    expect(keyDemand(KEY_DEMAND_AT.cornerstone - 1e-9)).toBe('common');
    expect(keyDemand(KEY_DEMAND_AT.common)).toBe('common');
    expect(keyDemand(KEY_DEMAND_AT.occasional)).toBe('occasional');
    expect(keyDemand(0.001)).toBe('rare');
  });

  it('earns more drills the more the library leans on the key', () => {
    expect(DRILLS_EARNED.cornerstone).toBeGreaterThan(DRILLS_EARNED.common);
    expect(DRILLS_EARNED.common).toBeGreaterThan(DRILLS_EARNED.occasional);
    expect(DRILLS_EARNED.rare).toBe(0);
  });
});

describe('censusLine', () => {
  it('leads with the number and singles out the top key', () => {
    const census = keyCensus([{ key: 'E minor' }, { key: 'E minor' }, { key: 'D major' }]);
    const [top, second] = census.entries;
    expect(censusLine(top!, census.counted))
      .toBe('2 songs of 3 in your library are in E minor — more than any other key.');
    // D major's tonic is an open string, so the line says so.
    expect(censusLine(second!, census.counted))
      .toBe('1 song of 3 in your library is in D major. Its tonic is the open D string, so you can tune the drone to it by ear.');
  });
});

describe('the library census', () => {
  it('counts every bundled song and parses every key label', () => {
    expect(LIBRARY_KEY_CENSUS.counted).toBe(COMPACT_SCORES.length);
    expect(LIBRARY_KEY_CENSUS.unparsed).toBe(0);
  });

  it('is measured, not written down — it agrees with a fresh count', () => {
    const counted = new Map<string, number>();
    for (const song of COMPACT_SCORES) {
      const parsed = parseKeyName(song.key);
      expect(parsed).not.toBeNull();
      const label = canonicalKeyName(parsed!);
      counted.set(label, (counted.get(label) ?? 0) + 1);
    }
    for (const entry of LIBRARY_KEY_CENSUS.entries) {
      expect(entry.songs).toBe(counted.get(entry.key));
    }
    expect(LIBRARY_KEY_CENSUS.entries.length).toBe(counted.size);
  });

  it('is ranked, and the shares add up', () => {
    const songs = LIBRARY_KEY_CENSUS.entries.map((e) => e.songs);
    expect([...songs].sort((a, b) => b - a)).toEqual(songs);
    expect(LIBRARY_KEY_CENSUS.entries.map((e) => e.rank))
      .toEqual(LIBRARY_KEY_CENSUS.entries.map((_, i) => i + 1));
    const total = LIBRARY_KEY_CENSUS.entries.reduce((sum, e) => sum + e.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('finds a substantial share of the library in open-string keys', () => {
    // Not an assertion about a number the library happens to have today, but
    // about the claim the scales screen makes: enough of the library is tuned
    // to an open string for "drone it by ear" to be advice worth printing.
    expect(LIBRARY_KEY_CENSUS.openStringSongs / LIBRARY_KEY_CENSUS.counted)
      .toBeGreaterThan(0.25);
  });
});
