import { describe, expect, it } from 'vitest';

import {
  BackingTrack, resolveAudibleParts,
} from '../backing';
import { practiceLoop } from '../loop';
import { CelloSongScore } from '../schema';

function makeScore(bars = 4, bpm = 120): CelloSongScore {
  const barMs = (60000 / bpm) * 4;
  return {
    schemaVersion: '1.0.0',
    id: 'test-score',
    metadata: {
      title: 'Test Score',
      composer: 'Test',
      origin: 'Test',
      keySignature: 'G MAJOR',
      timeSignature: '4/4',
      bpm,
      difficulty: 'Beginner',
      tonic: 'G',
      teaches: '',
      rights: '',
    },
    measures: Array.from({ length: bars }, (_, index) => ({
      index,
      startBarTimeMs: index * barMs,
      durationMs: barMs,
      timeSignature: [4, 4] as [number, number],
      tempoBpm: bpm,
    })),
    notes: [
      {
        id: 'n1',
        midiNumber: 43, // G2
        pitchName: 'G2',
        frequency: 98,
        startTimeMs: 0,
        durationMs: barMs,
        string: 'G',
        finger: '0',
        position: '1st',
        extension: 'none',
        articulation: 'arco',
        tie: false,
        measureIndex: 0,
      },
      {
        id: 'n2',
        midiNumber: 50, // D3
        pitchName: 'D3',
        frequency: 146.83,
        startTimeMs: barMs,
        durationMs: barMs,
        string: 'D',
        finger: '0',
        position: '1st',
        extension: 'none',
        articulation: 'arco',
        tie: false,
        measureIndex: 1,
      },
    ],
  };
}

function makeImportedBacking(): BackingTrack {
  return {
    id: 'imported-track',
    name: 'Imported Backing',
    source: 'imported',
    durationMs: 8000,
    parts: [
      {
        id: 't-solo',
        name: 'Solo',
        instrument: 'cello',
        role: 'solo',
        gain: 1,
        muted: false,
        notes: [{ midiNumber: 60, startTimeMs: 0, durationMs: 1000, velocity: 0.8 }],
      },
      {
        id: 't-acc',
        name: 'Accompaniment',
        instrument: 'piano',
        role: 'accompaniment',
        gain: 0.8,
        muted: false,
        notes: [{ midiNumber: 48, startTimeMs: 0, durationMs: 2000, velocity: 0.7 }],
      },
    ],
  };
}

describe('resolveAudibleParts', () => {
  const score = makeScore(4);
  const loop = practiceLoop(score, { loopFromBar: 1, loopToBar: 2, tempoPercent: 100 });

  it('resolves solo from score when score is present', () => {
    const result = resolveAudibleParts({
      score,
      backing: null,
      loop,
      listenMode: 'solo',
      accompaniment: 'none',
    });

    expect(result.soloParts).toHaveLength(1);
    expect(result.soloParts[0].role).toBe('solo');
    expect(result.soloParts[0].instrument).toBe('cello');
    expect(result.accompanimentParts).toEqual([]);
    expect(result.audibleParts).toEqual(result.soloParts);
  });

  it('resolves solo from imported backing when score is null', () => {
    const backing = makeImportedBacking();
    const result = resolveAudibleParts({
      score: null,
      backing,
      loop,
      listenMode: 'solo',
      accompaniment: 'none',
    });

    expect(result.soloParts).toHaveLength(1);
    expect(result.soloParts[0].id).toBe('t-solo');
    expect(result.audibleParts).toEqual(result.soloParts);
  });

  it('generates accompaniment when no imported backing is provided', () => {
    const result = resolveAudibleParts({
      score,
      backing: null,
      loop,
      listenMode: 'backing',
      accompaniment: 'drone',
    });

    expect(result.accompanimentParts).toHaveLength(1);
    expect(result.accompanimentParts[0].instrument).toBe('drone');
    expect(result.audibleParts).toEqual(result.accompanimentParts);
  });

  it('uses imported accompaniment over generated accompaniment', () => {
    const backing = makeImportedBacking();
    const result = resolveAudibleParts({
      score,
      backing,
      loop,
      listenMode: 'backing',
      accompaniment: 'drone',
    });

    expect(result.accompanimentParts).toHaveLength(1);
    expect(result.accompanimentParts[0].id).toBe('t-acc');
    expect(result.audibleParts).toEqual(result.accompanimentParts);
  });

  it('combines accompaniment and solo parts when listenMode is both', () => {
    const result = resolveAudibleParts({
      score,
      backing: null,
      loop,
      listenMode: 'both',
      accompaniment: 'drone',
    });

    expect(result.audibleParts).toHaveLength(result.accompanimentParts.length + result.soloParts.length);
    expect(result.audibleParts).toEqual([...result.accompanimentParts, ...result.soloParts]);
  });

  it('returns empty audible parts when listenMode is off, while retaining available parts', () => {
    const result = resolveAudibleParts({
      score,
      backing: null,
      loop,
      listenMode: 'off',
      accompaniment: 'drone',
    });

    expect(result.audibleParts).toEqual([]);
    expect(result.soloParts).toHaveLength(1);
    expect(result.accompanimentParts).toHaveLength(1);
  });
});
