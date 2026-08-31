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
  pluck: {
    harmonics: [1, 0.48, 0.28, 0.15, 0.08, 0.04],
    attackMs: 2, decayMs: 340, sustain: 0.05, releaseMs: 140, gain: 0.75,
  },
  bass: {
    harmonics: [1, 0.44, 0.17, 0.07, 0.03],
    attackMs: 14, decayMs: 420, sustain: 0.48, releaseMs: 200, gain: 0.9,
  },
  percussion: {
    harmonics: [1],
    attackMs: 1, decayMs: 90, sustain: 0, releaseMs: 60, gain: 0.5, noise: true,
  },
};

/**
 * The ADSR envelope, as a function of sample index rather than as state.
 *
 * Being a pure function of `i` is what lets the native renderer synthesise a
 * note in slices without carrying anything between them: a chunk starting
 * halfway through a note asks for the envelope at that offset and gets the
 * same answer it would have got had it rendered the note from the beginning.
 */
export function envelopeAt(
  i: number, attack: number, decay: number, sustain: number,
  heldSamples: number, releaseSamples: number,
): number {
  if (i < heldSamples) {
    if (i < attack) return i / attack;
    const intoDecay = i - attack;
    if (intoDecay >= decay) return sustain;
    return 1 + (sustain - 1) * (intoDecay / decay);
  }
  const intoRelease = i - heldSamples;
  const level = i - 1 < attack ? 1 : sustain;
  return Math.max(0, level * (1 - intoRelease / releaseSamples));
}
