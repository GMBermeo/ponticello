/**
 * Timbres.
 *
 * Lifted out of `synth.ts` because there are now two consumers with nothing
 * else in common: the native renderer, which reads the harmonic series to build
 * band-limited wavetables, and the web scheduler, which hands the same series
 * to `createPeriodicWave` and lets the browser do the band-limiting. Keeping one
 * copy is the only way the two platforms sound like each other.
 *
 * Everything here is chosen to sit *under* a cello rather than compete with it.
 * The accompaniment exists to be played over, so every voice is duller than it
 * would be if it were the thing you were listening to.
 *
 * Pure: no React, no React Native, no Web Audio. See AGENTS.md.
 */

import { InstrumentName } from '@/domain/backing';

export interface VoiceSpec {
  /** Relative amplitude of harmonic n, index 0 being the fundamental. */
  harmonics: number[];
  attackMs: number;
  decayMs: number;
  /** Level held after the decay, 0–1. */
  sustain: number;
  releaseMs: number;
  gain: number;
  noise?: boolean;
}

export const VOICES: Record<InstrumentName, VoiceSpec> = {
  // Bowed: a sawtooth-ish spectrum, since a bowed string is close to one.
  cello: {
    harmonics: [1, 0.62, 0.44, 0.3, 0.23, 0.17, 0.13, 0.1, 0.08, 0.06, 0.05, 0.04],
    attackMs: 45, decayMs: 120, sustain: 0.82, releaseMs: 200, gain: 0.9,
  },
  strings: {
    harmonics: [1, 0.5, 0.32, 0.2, 0.13, 0.09, 0.06, 0.04],
    attackMs: 95, decayMs: 200, sustain: 0.85, releaseMs: 320, gain: 0.7,
  },
  // Slow in, slow out, never articulated — a reference tone, not a part.
  drone: {
    harmonics: [1, 0.42, 0.26, 0.15, 0.09, 0.05],
    attackMs: 280, decayMs: 200, sustain: 1, releaseMs: 600, gain: 0.65,
  },
  // Struck: immediate, then a long decay to almost nothing.
  piano: {
    harmonics: [1, 0.58, 0.34, 0.2, 0.12, 0.075, 0.045, 0.03],
    attackMs: 4, decayMs: 850, sustain: 0.12, releaseMs: 260, gain: 0.8,
  },
  mallet: {
    harmonics: [1, 0.7, 0.22, 0.16, 0.08, 0.045, 0.025],
    attackMs: 2, decayMs: 620, sustain: 0.025, releaseMs: 180, gain: 0.68,
  },
  organ: {
    harmonics: [1, 0.52, 0.34, 0.2, 0.14, 0.1, 0.07, 0.05],
    attackMs: 18, decayMs: 90, sustain: 0.9, releaseMs: 170, gain: 0.58,
  },
  guitar: {
    harmonics: [1, 0.54, 0.3, 0.17, 0.1, 0.06, 0.035],
    attackMs: 3, decayMs: 430, sustain: 0.11, releaseMs: 180, gain: 0.72,
  },
  // Legacy generated accompaniment still uses this neutral plucked voice.
  pluck: {
    harmonics: [1, 0.48, 0.28, 0.15, 0.08, 0.04],
    attackMs: 2, decayMs: 340, sustain: 0.05, releaseMs: 140, gain: 0.75,
  },
  bass: {
    harmonics: [1, 0.44, 0.17, 0.07, 0.03],
    attackMs: 14, decayMs: 420, sustain: 0.48, releaseMs: 200, gain: 0.9,
  },
  brass: {
    harmonics: [1, 0.76, 0.5, 0.33, 0.22, 0.14, 0.09, 0.055],
    attackMs: 38, decayMs: 170, sustain: 0.72, releaseMs: 210, gain: 0.54,
  },
  reed: {
    harmonics: [1, 0.82, 0.38, 0.23, 0.13, 0.08, 0.05],
    attackMs: 24, decayMs: 120, sustain: 0.79, releaseMs: 170, gain: 0.55,
  },
  synth: {
    harmonics: [1, 0.36, 0.24, 0.13, 0.09, 0.05],
    attackMs: 14, decayMs: 260, sustain: 0.58, releaseMs: 260, gain: 0.58,
  },
  percussion: {
    harmonics: [1],
    attackMs: 1, decayMs: 90, sustain: 0, releaseMs: 60, gain: 0.5, noise: true,
  },
};

/** Small positive denominator that preserves whatever time unit the caller uses. */
const MIN_ENVELOPE_SPAN = Number.EPSILON;

/**
 * ADSR held level in any consistent time unit (native samples or web seconds).
 */
export function envelopeHeldLevel(
  held: number, attack: number, decay: number, sustain: number,
): number {
  const safeAttack = Math.max(MIN_ENVELOPE_SPAN, attack);
  const safeDecay = Math.max(MIN_ENVELOPE_SPAN, decay);
  if (held < safeAttack) return Math.max(0, held / safeAttack);
  const intoDecay = held - safeAttack;
  if (intoDecay < safeDecay) return 1 + (sustain - 1) * (intoDecay / safeDecay);
  return sustain;
}

/**
 * ADSR value at `elapsed`, using any one consistent unit for every duration.
 * Native passes sample counts; Web Audio passes seconds.
 */
export function envelopeAt(
  elapsed: number, attack: number, decay: number, sustain: number,
  held: number, release: number,
): number {
  if (elapsed < held) {
    if (elapsed < attack) return elapsed / Math.max(MIN_ENVELOPE_SPAN, attack);
    const intoDecay = elapsed - attack;
    if (intoDecay >= decay) return sustain;
    return 1 + (sustain - 1) * (intoDecay / Math.max(MIN_ENVELOPE_SPAN, decay));
  }
  const intoRelease = elapsed - held;
  const level = envelopeHeldLevel(held, attack, decay, sustain);
  return Math.max(0, level * (1 - intoRelease / Math.max(MIN_ENVELOPE_SPAN, release)));
}
