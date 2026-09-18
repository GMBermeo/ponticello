import { describe, expect, it } from 'vitest';

import { validateScore } from '@/domain/schema';
import {
  CompactVariantBackingPart, CompactVariantDef, inflateVariantBacking, inflateVariantLevel,
} from '@/scores/benchmarkVariants';

const variant: CompactVariantDef = {
  id: 'song--gpt-oss-20b',
  baseId: 'song',
  model: 'gpt-oss:20b',
  title: 'Song',
  composer: 'Band',
  bpm: 120,
  meter: [4, 4],
  key: 'D major',
  preferFlats: false,
  levels: {
    Beginner: [[50, 0, 1900, 'D', '0', '1st', 'none', 1]],
    Intermediate: [
      [50, 0, 400, 'D', '0', '1st', 'none', 1],
      [57, 500, 400, 'D', '1', '4th', 'none', 0],
    ],
    Advanced: [[57, 0, 400, 'D', '1', '4th', 'none', 0]],
    Expert: [[57, 0, 400, 'A', '0', '1st', 'none', 0]],
  },
  teaches: {
    Beginner: 'b', Intermediate: 'Stay on the D string.', Advanced: 'a', Expert: 'e',
  },
  placedByModel: 0.9,
};

const backing: CompactVariantBackingPart[] = [
  ['Piano', 'piano', 'accompaniment', 0.5, [[62, 0, 5000, 0.8]]],
  ['Vocals', 'synth', 'solo', 0.85, [[74, 0, 1000, 0.8]]],
];

describe('benchmark variants', () => {
  it('keep the model’s fingering instead of re-fingering in first position', () => {
    const score = inflateVariantLevel(variant, 'Intermediate', backing);
    expect(validateScore(score)).toEqual([]);
    expect(score.notes[1]).toMatchObject({ string: 'D', finger: '1', position: '4th', pitchName: 'A3' });
    expect(score.metadata.teaches).toBe('Stay on the D string.');
    expect(score.metadata.difficulty).toBe('Intermediate');
  });

  it('size every level to the same bars, covering the backing', () => {
    const beginner = inflateVariantLevel(variant, 'Beginner', backing);
    const expert = inflateVariantLevel(variant, 'Expert', backing);
    expect(beginner.measures.length).toBe(expert.measures.length);
    // 5 s of piano at 120 BPM in 4/4 is three bars.
    expect(expert.measures.length).toBe(3);
  });

  it('inflate a backing whose melody track is marked as the solo part', () => {
    const track = inflateVariantBacking(variant, backing);
    expect(track.parts.map((part) => part.role)).toEqual(['accompaniment', 'solo']);
    expect(track.durationMs).toBe(5000);
  });
});
