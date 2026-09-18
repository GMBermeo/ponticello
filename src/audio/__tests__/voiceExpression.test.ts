import { describe, expect, it } from 'vitest';

import {
  bowNoiseAt, BRIGHTNESS_TIERS, brightnessTier, centsToRatio, noteSeed, noteVariation,
  REFERENCE_VELOCITY, spectrumAt, spectrumForTier, tierVelocity, vibratoCents, VOICES,
} from '../voices';

const CELLO = VOICES.cello;
const ORGAN = VOICES.organ;
const DRONE = VOICES.drone;

/** Energy above the fundamental, relative to it. The ear's "brightness". */
function upperEnergy(harmonics: readonly number[]): number {
  let sum = 0;
  for (let h = 1; h < harmonics.length; h++) sum += harmonics[h]!;
  return sum / harmonics[0]!;
}

describe('spectrum opens with force', () => {
  it('is the stored spectrum at the reference velocity', () => {
    expect(spectrumAt(CELLO, REFERENCE_VELOCITY)).toEqual(CELLO.harmonics);
  });

  it('brightens as the note is played harder', () => {
    const soft = upperEnergy(spectrumAt(CELLO, 0.2));
    const mid = upperEnergy(spectrumAt(CELLO, REFERENCE_VELOCITY));
    const loud = upperEnergy(spectrumAt(CELLO, 1));
    expect(soft).toBeLessThan(mid);
    expect(mid).toBeLessThan(loud);
  });

  it('changes colour, never loudness — the fundamental stays at 1', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(spectrumAt(CELLO, v)[0]).toBeCloseTo(1, 10);
    }
  });

  it('leaves a voice with no brightness alone, whatever the velocity', () => {
    expect(spectrumAt({ ...ORGAN, brightness: 0 }, 0.1)).toBe(ORGAN.harmonics);
    expect(spectrumAt({ ...ORGAN, brightness: undefined }, 1)).toBe(ORGAN.harmonics);
  });

  // Not "no partial may pass the fundamental" — a reed legitimately does, which
  // is why an oboe sounds like an oboe. What must hold is that brightness
  // cannot run away and turn a voice into a buzzer.
  it('stays bounded at every velocity, for every voice', () => {
    for (const name of Object.keys(VOICES) as (keyof typeof VOICES)[]) {
      const spec = VOICES[name];
      for (let v = 0; v <= 1.0001; v += 0.05) {
        for (const amplitude of spectrumAt(spec, v)) {
          expect(amplitude).toBeGreaterThanOrEqual(0);
          expect(amplitude).toBeLessThanOrEqual(1.5);
        }
      }
    }
  });

  it('keeps the series descending overall — the top never outweighs the bottom', () => {
    for (const name of Object.keys(VOICES) as (keyof typeof VOICES)[]) {
      const spec = VOICES[name];
      if (spec.harmonics.length < 3) continue;
      const loud = spectrumAt(spec, 1);
      expect(loud[loud.length - 1]!).toBeLessThan(loud[0]!);
    }
  });
});

describe('brightness tiers', () => {
  it('covers 0–1 with no gaps and no overflow', () => {
    for (const v of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
      const tier = brightnessTier(v);
      expect(tier).toBeGreaterThanOrEqual(0);
      expect(tier).toBeLessThan(BRIGHTNESS_TIERS);
    }
  });

  it('is monotonic — harder never reads a darker tier', () => {
    let previous = -1;
    for (let v = 0; v <= 1; v += 0.01) {
      const tier = brightnessTier(v);
      expect(tier).toBeGreaterThanOrEqual(previous);
      previous = tier;
    }
  });

  it('builds a brighter spectrum for a higher tier', () => {
    const tiers = Array.from({ length: BRIGHTNESS_TIERS }, (_, t) => upperEnergy(spectrumForTier(CELLO, t)));
    for (let t = 1; t < tiers.length; t++) expect(tiers[t]!).toBeGreaterThan(tiers[t - 1]!);
  });

  it('places each tier velocity inside its own band', () => {
    for (let t = 0; t < BRIGHTNESS_TIERS; t++) expect(brightnessTier(tierVelocity(t))).toBe(t);
  });
});

describe('per-note variation', () => {
  it('is deterministic — the same note is the same note', () => {
    const seed = noteSeed(50, 1234);
    expect(noteVariation(CELLO, seed)).toEqual(noteVariation(CELLO, seed));
  });

  it('differs between two notes, so a repeated figure is not a loop', () => {
    const a = noteVariation(CELLO, noteSeed(50, 0));
    const b = noteVariation(CELLO, noteSeed(50, 500));
    expect(a.detuneCents).not.toBe(b.detuneCents);
    expect(a.vibratoPhase).not.toBe(b.vibratoPhase);
  });

  it('stays inside the spec, however many notes are drawn', () => {
    for (let i = 0; i < 400; i++) {
      const v = noteVariation(CELLO, noteSeed(36 + (i % 40), i * 137));
      expect(Math.abs(v.detuneCents)).toBeLessThanOrEqual(CELLO.detuneCents!);
      expect(v.velocityScale).toBeGreaterThan(0.9);
      expect(v.velocityScale).toBeLessThan(1.1);
      expect(v.attackScale).toBeGreaterThan(0.8);
      expect(v.attackScale).toBeLessThan(1.2);
    }
  });

  it('leaves a voice with nothing to vary exactly neutral', () => {
    const plain = { ...DRONE, detuneCents: undefined, humanize: undefined, vibrato: undefined };
    const v = noteVariation(plain, noteSeed(50, 10));
    expect(v).toEqual({
      detuneCents: 0, velocityScale: 1, attackScale: 1,
      vibratoPhase: 0, vibratoRateScale: 1, vibratoDepthScale: 1,
    });
  });
});

describe('vibrato', () => {
  const variation = noteVariation(CELLO, noteSeed(50, 0));

  it('is silent for the whole onset — the note is set down first', () => {
    const onset = CELLO.vibrato!.onsetMs / 1000;
    expect(vibratoCents(CELLO, variation, 0)).toBe(0);
    expect(vibratoCents(CELLO, variation, onset * 0.99)).toBe(0);
  });

  it('never appears on a short note', () => {
    for (let t = 0; t <= 0.2; t += 0.01) expect(vibratoCents(CELLO, variation, t)).toBe(0);
  });

  it('fades in rather than arriving at full depth', () => {
    const onset = CELLO.vibrato!.onsetMs / 1000;
    const early = peakOver(onset, onset * 1.3);
    const settled = peakOver(onset * 2.2, onset * 4);
    expect(early).toBeLessThan(settled);
  });

  it('stays inside the written depth', () => {
    const ceiling = CELLO.vibrato!.depthCents * variation.vibratoDepthScale + 1e-9;
    for (let t = 0; t < 8; t += 0.005) {
      expect(Math.abs(vibratoCents(CELLO, variation, t))).toBeLessThanOrEqual(ceiling);
    }
  });

  it('is absent from voices that cannot have it', () => {
    for (const name of ['drone', 'piano', 'mallet', 'organ', 'pluck', 'percussion'] as const) {
      expect(VOICES[name].vibrato).toBeUndefined();
      expect(vibratoCents(VOICES[name], variation, 5)).toBe(0);
    }
  });

  function peakOver(fromSec: number, toSec: number): number {
    let peak = 0;
    for (let t = fromSec; t < toSec; t += 0.002) {
      peak = Math.max(peak, Math.abs(vibratoCents(CELLO, variation, t)));
    }
    return peak;
  }
});

describe('cents and attack noise', () => {
  it('converts cents to a ratio, an octave at a time', () => {
    expect(centsToRatio(0)).toBe(1);
    expect(centsToRatio(1200)).toBeCloseTo(2, 10);
    expect(centsToRatio(-1200)).toBeCloseTo(0.5, 10);
  });

  it('puts bow noise under the attack and nowhere else', () => {
    expect(bowNoiseAt(CELLO, 0)).toBe(0);
    expect(bowNoiseAt(CELLO, 0.01)).toBeGreaterThan(0);
    expect(bowNoiseAt(CELLO, 5)).toBe(0);
  });

  it('never lets the scrape reach the level of the note', () => {
    for (let t = 0; t < 0.5; t += 0.001) {
      expect(bowNoiseAt(CELLO, t)).toBeLessThanOrEqual(CELLO.bowNoise!);
    }
  });

  it('is silent for voices with no bow or breath', () => {
    for (const name of ['piano', 'organ', 'drone', 'synth'] as const) {
      expect(bowNoiseAt(VOICES[name], 0.01)).toBe(0);
    }
  });
});
