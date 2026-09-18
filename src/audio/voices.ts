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
  /** Relative amplitude of harmonic n, index 0 being the fundamental, at {@link REFERENCE_VELOCITY}. */
  harmonics: number[];
  attackMs: number;
  decayMs: number;
  /** Level held after the decay, 0–1. */
  sustain: number;
  releaseMs: number;
  gain: number;
  noise?: boolean;

  // ── What makes it sound like an instrument rather than an oscillator ──────

  /**
   * How far the spectrum opens as the note is played harder, 0–1.
   *
   * Every acoustic instrument gets *brighter* with force, not merely louder: a
   * cello played forte has far more energy in its upper partials than the same
   * note played piano. A fixed spectrum scaled by gain is the single most
   * synthetic thing about an additive voice, and this is the fix.
   */
  brightness?: number;
  /**
   * Bowed and blown vibrato. Absent for struck and plucked voices, which
   * cannot have any.
   */
  vibrato?: { rateHz: number; depthCents: number; onsetMs: number };
  /**
   * Bow or breath noise mixed under the attack, 0–1.
   *
   * The scrape before a bowed string speaks, the chiff before a pipe does.
   * Short, and nearly gone by the time the note is in tune — but a note that
   * starts as a pure tone reads as synthetic no matter what follows.
   */
  bowNoise?: number;
  /** Spread of the per-note random detune, in cents. Nothing plays dead in tune. */
  detuneCents?: number;
  /**
   * Detune between two copies of the note, in cents. A section, not a soloist:
   * several players never agree exactly, and that disagreement is the sound.
   */
  unisonCents?: number;
  /** How much the per-note dynamic and attack wander, 0–1. */
  humanize?: number;
}

/**
 * The velocity the stored `harmonics` describe. Below it a voice darkens,
 * above it the upper partials come up.
 */
export const REFERENCE_VELOCITY = 0.7;

export const VOICES: Record<InstrumentName, VoiceSpec> = {
  // Bowed: a sawtooth-ish spectrum, since a bowed string is close to one.
  cello: {
    harmonics: [1, 0.62, 0.44, 0.3, 0.23, 0.17, 0.13, 0.1, 0.08, 0.06, 0.05, 0.04],
    attackMs: 45, decayMs: 120, sustain: 0.82, releaseMs: 200, gain: 0.9,
    brightness: 0.55, bowNoise: 0.16, detuneCents: 4, humanize: 0.18,
    // Slow and shallow. A guide part that wobbles like a soloist is worse than
    // one that does not wobble at all — this is meant to be played over.
    vibrato: { rateHz: 5.1, depthCents: 13, onsetMs: 260 },
  },
  strings: {
    harmonics: [1, 0.5, 0.32, 0.2, 0.13, 0.09, 0.06, 0.04],
    attackMs: 95, decayMs: 200, sustain: 0.85, releaseMs: 320, gain: 0.7,
    brightness: 0.4, bowNoise: 0.1, detuneCents: 6, unisonCents: 11, humanize: 0.2,
    vibrato: { rateHz: 4.6, depthCents: 9, onsetMs: 380 },
  },
  // Slow in, slow out, never articulated — a reference tone, not a part.
  // No vibrato at all: a drone you tune against must not move.
  drone: {
    harmonics: [1, 0.42, 0.26, 0.15, 0.09, 0.05],
    attackMs: 280, decayMs: 200, sustain: 1, releaseMs: 600, gain: 0.65,
    brightness: 0.12,
  },
  // Struck: immediate, then a long decay to almost nothing. Brightness with
  // force is most of what a piano's dynamic actually *is*.
  piano: {
    harmonics: [1, 0.58, 0.34, 0.2, 0.12, 0.075, 0.045, 0.03],
    attackMs: 4, decayMs: 850, sustain: 0.12, releaseMs: 260, gain: 0.8,
    brightness: 0.75, detuneCents: 2.5, unisonCents: 3.5, humanize: 0.14,
  },
  mallet: {
    harmonics: [1, 0.7, 0.22, 0.16, 0.08, 0.045, 0.025],
    attackMs: 2, decayMs: 620, sustain: 0.025, releaseMs: 180, gain: 0.68,
    brightness: 0.5, detuneCents: 2, humanize: 0.12,
  },
  // Electro-mechanical: the one voice that really is the same every time.
  organ: {
    harmonics: [1, 0.52, 0.34, 0.2, 0.14, 0.1, 0.07, 0.05],
    attackMs: 18, decayMs: 90, sustain: 0.9, releaseMs: 170, gain: 0.58,
    brightness: 0.08, detuneCents: 1,
  },
  guitar: {
    harmonics: [1, 0.54, 0.3, 0.17, 0.1, 0.06, 0.035],
    attackMs: 3, decayMs: 430, sustain: 0.11, releaseMs: 180, gain: 0.72,
    brightness: 0.62, bowNoise: 0.1, detuneCents: 4, humanize: 0.16,
  },
  // Legacy generated accompaniment still uses this neutral plucked voice.
  pluck: {
    harmonics: [1, 0.48, 0.28, 0.15, 0.08, 0.04],
    attackMs: 2, decayMs: 340, sustain: 0.05, releaseMs: 140, gain: 0.75,
    brightness: 0.55, detuneCents: 3, humanize: 0.14,
  },
  bass: {
    harmonics: [1, 0.44, 0.17, 0.07, 0.03],
    attackMs: 14, decayMs: 420, sustain: 0.48, releaseMs: 200, gain: 0.9,
    brightness: 0.45, detuneCents: 2.5, humanize: 0.12,
  },
  brass: {
    harmonics: [1, 0.76, 0.5, 0.33, 0.22, 0.14, 0.09, 0.055],
    attackMs: 38, decayMs: 170, sustain: 0.72, releaseMs: 210, gain: 0.54,
    brightness: 0.85, bowNoise: 0.12, detuneCents: 5, humanize: 0.2,
    vibrato: { rateHz: 5.4, depthCents: 8, onsetMs: 420 },
  },
  reed: {
    harmonics: [1, 0.82, 0.38, 0.23, 0.13, 0.08, 0.05],
    attackMs: 24, decayMs: 120, sustain: 0.79, releaseMs: 170, gain: 0.55,
    brightness: 0.6, bowNoise: 0.18, detuneCents: 4, humanize: 0.18,
    vibrato: { rateHz: 5.6, depthCents: 10, onsetMs: 300 },
  },
  synth: {
    harmonics: [1, 0.36, 0.24, 0.13, 0.09, 0.05],
    attackMs: 14, decayMs: 260, sustain: 0.58, releaseMs: 260, gain: 0.58,
    brightness: 0.3, detuneCents: 1.5,
  },
  percussion: {
    harmonics: [1],
    attackMs: 1, decayMs: 90, sustain: 0, releaseMs: 60, gain: 0.5, noise: true,
    humanize: 0.22,
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

// ─── Expression ──────────────────────────────────────────────────────────────

/**
 * The spectrum this voice has when played at `velocity`.
 *
 * A spectral tilt, not a filter: each harmonic is scaled by `tilt^n`, so the
 * fundamental is untouched and the partials above it fan out or close in. That
 * is the shape a bowed or blown instrument actually changes with effort, and
 * it costs one `Math.pow` per harmonic rather than a filter per sample.
 *
 * The result is renormalised on the fundamental, so brightness changes the
 * *colour* of the note and the envelope keeps owning its loudness. Those are
 * two different things and a voice that confuses them cannot be mixed.
 */
export function spectrumAt(spec: VoiceSpec, velocity: number): number[] {
  const brightness = spec.brightness ?? 0;
  if (brightness <= 0) return spec.harmonics;

  const drive = Math.max(0, Math.min(1.4, velocity)) - REFERENCE_VELOCITY;
  const tilt = Math.max(0.35, Math.min(1.9, 1 + brightness * drive * 1.6));
  if (Math.abs(tilt - 1) < 1e-6) return spec.harmonics;

  const out = new Array<number>(spec.harmonics.length);
  for (let h = 0; h < spec.harmonics.length; h++) {
    out[h] = spec.harmonics[h]! * Math.pow(tilt, h);
  }
  const fundamental = out[0] || 1;
  for (let h = 0; h < out.length; h++) out[h] /= fundamental;
  return out;
}

/**
 * How many distinct spectra are built per voice.
 *
 * Both renderers cache a wavetable (native) or a `PeriodicWave` (web) per
 * spectrum, so this is a cache budget, not a musical resolution. Four steps is
 * the point where the seam between two tiers stops being audible on a
 * crescendo and the tables still all fit.
 */
export const BRIGHTNESS_TIERS = 4;

/** Which tier a velocity reads from. */
export function brightnessTier(velocity: number): number {
  const v = Math.max(0, Math.min(1, velocity));
  return Math.min(BRIGHTNESS_TIERS - 1, Math.floor(v * BRIGHTNESS_TIERS));
}

/** The velocity a tier's spectrum is built at — the middle of its band. */
export function tierVelocity(tier: number): number {
  return (Math.max(0, Math.min(BRIGHTNESS_TIERS - 1, tier)) + 0.5) / BRIGHTNESS_TIERS;
}

/** The spectrum for a tier, ready to cache. */
export function spectrumForTier(spec: VoiceSpec, tier: number): number[] {
  return spectrumAt(spec, tierVelocity(tier));
}

/**
 * Everything about one note that is *not* written in the score.
 *
 * Two identical notes a bar apart are not identical on any real instrument:
 * the bow lands a shade differently, the finger is a few cents off, the
 * vibrato is at a different point in its cycle. This is what turns a repeated
 * figure from a loop into a phrase — and it is derived from the note's own
 * seed rather than from `Math.random`, because the native renderer builds a
 * song in slices and a note that straddles a boundary must come out the same
 * on both sides of it.
 */
export interface NoteVariation {
  /** Cents off dead centre, from `detuneCents`. */
  detuneCents: number;
  /** Multiplies the written dynamic, from `humanize`. */
  velocityScale: number;
  /** Multiplies the attack time, from `humanize`. */
  attackScale: number;
  /** Radians into the vibrato cycle at note onset. */
  vibratoPhase: number;
  vibratoRateScale: number;
  vibratoDepthScale: number;
}

const NEUTRAL: NoteVariation = {
  detuneCents: 0, velocityScale: 1, attackScale: 1,
  vibratoPhase: 0, vibratoRateScale: 1, vibratoDepthScale: 1,
};

/** Stable seed for a note. Same pitch at the same instant is the same note. */
export function noteSeed(midiNumber: number, atMs: number): number {
  return (Math.round(atMs) * 2654435761 + midiNumber * 40503) >>> 0;
}

/** mulberry32 — small, fast, and good enough for six numbers per note. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noteVariation(spec: VoiceSpec, seed: number): NoteVariation {
  const detune = spec.detuneCents ?? 0;
  const humanize = spec.humanize ?? 0;
  const hasVibrato = spec.vibrato !== undefined;
  if (detune === 0 && humanize === 0 && !hasVibrato) return NEUTRAL;

  const next = randomFrom(seed);
  const bipolar = () => next() * 2 - 1;

  return {
    detuneCents: bipolar() * detune,
    velocityScale: 1 + bipolar() * humanize * 0.25,
    attackScale: 1 + bipolar() * humanize * 0.5,
    vibratoPhase: next() * Math.PI * 2,
    vibratoRateScale: 1 + bipolar() * 0.12,
    vibratoDepthScale: 1 + bipolar() * 0.3,
  };
}

/**
 * Vibrato offset in cents, `elapsedSec` into the note.
 *
 * Nothing for the first `onsetMs`, then faded in over the same span again — a
 * player sets the note down before they start moving, and vibrato that is
 * already at full depth on the attack is the giveaway of a synthesiser. Short
 * notes therefore get none at all, which is also what happens in the hand.
 */
export function vibratoCents(
  spec: VoiceSpec, variation: NoteVariation, elapsedSec: number,
): number {
  const vibrato = spec.vibrato;
  if (!vibrato || elapsedSec <= 0) return 0;

  const onsetSec = vibrato.onsetMs / 1000;
  const past = elapsedSec - onsetSec;
  if (past <= 0) return 0;

  const swell = Math.min(1, past / Math.max(1e-6, onsetSec));
  const rate = vibrato.rateHz * variation.vibratoRateScale;
  const depth = vibrato.depthCents * variation.vibratoDepthScale;
  return Math.sin(variation.vibratoPhase + past * rate * Math.PI * 2) * depth * swell;
}

/** Cents → frequency ratio. The one conversion both renderers need. */
export function centsToRatio(cents: number): number {
  return cents === 0 ? 1 : Math.pow(2, cents / 1200);
}

/**
 * Level of the attack noise `elapsedSec` into a note.
 *
 * Its own short envelope, independent of the note's: bow noise is loudest
 * before the string speaks and is gone well inside the sustain.
 */
export function bowNoiseAt(spec: VoiceSpec, elapsedSec: number): number {
  const amount = spec.bowNoise ?? 0;
  if (amount <= 0 || elapsedSec < 0) return 0;
  const span = Math.max(0.02, (spec.attackMs / 1000) * 1.8);
  if (elapsedSec >= span) return 0;
  const t = elapsedSec / span;
  // Rises fast, falls away — a scrape, not a swell.
  return amount * Math.min(1, t * 6) * (1 - t) * (1 - t);
}
