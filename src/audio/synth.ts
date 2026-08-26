/**
 * A small offline synthesiser for backing tracks.
 *
 * There is no MIDI playback on either platform — `expo-audio` plays files, not
 * note events — so the accompaniment is synthesised to PCM up front and played
 * as audio. That turns out to be the better shape anyway: rendering happens
 * once when the loop or tempo changes, and playback afterwards is a plain
 * looped buffer with no scheduler to drift.
 *
 * Voices are additive, read from band-limited wavetables. Summing harmonics
 * per sample would mean tens of millions of `Math.sin` calls for a few bars;
 * building one cycle per octave band up front turns each sample into two array
 * reads and a lerp, which is roughly two orders of magnitude cheaper and lets
 * a re-render finish inside a frame or two.
 */

import { midiToFrequency } from '@/domain/cello';
import { BackingNote, BackingPart, InstrumentName } from '@/domain/backing';

interface VoiceSpec {
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

/**
 * Timbres, chosen to sit *under* a cello rather than compete with it. The
 * accompaniment exists to be played over, so everything here is duller than it
 * would be if it were the thing you were listening to.
 */
const VOICES: Record<InstrumentName, VoiceSpec> = {
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

const TABLE_SIZE = 2048;
/** One wavetable per octave, from MIDI 12 upwards. */
const BAND_COUNT = 10;

/** Which band-limited table a pitch should read from. */
function bandFor(midiNumber: number): number {
  return Math.max(0, Math.min(BAND_COUNT - 1, Math.floor((midiNumber - 12) / 12)));
}

/**
 * Builds one cycle per octave band, each dropping the harmonics that would
 * alias for the *lowest* note in that band. Without this a high piano note
 * with eight harmonics folds partials back down the spectrum and rings
 * audibly out of tune.
 */
function buildTables(spec: VoiceSpec, sampleRate: number): Float32Array[] {
  const tables: Float32Array[] = [];
  const nyquist = sampleRate / 2;

  for (let band = 0; band < BAND_COUNT; band++) {
    const table = new Float32Array(TABLE_SIZE);
    const lowestHz = midiToFrequency(12 + band * 12);
    const allowed = Math.max(1, Math.floor(nyquist / lowestHz));

    let peak = 0;
    for (let i = 0; i < TABLE_SIZE; i++) {
      let sample = 0;
      const phase = (2 * Math.PI * i) / TABLE_SIZE;
      for (let h = 0; h < spec.harmonics.length && h + 1 <= allowed; h++) {
        sample += spec.harmonics[h] * Math.sin(phase * (h + 1));
      }
      table[i] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak;
    tables.push(table);
  }

  return tables;
}

const tableCache = new Map<string, Float32Array[]>();

function tablesFor(instrument: InstrumentName, sampleRate: number): Float32Array[] {
  const key = `${instrument}@${sampleRate}`;
  let tables = tableCache.get(key);
  if (!tables) {
    tables = buildTables(VOICES[instrument], sampleRate);
    tableCache.set(key, tables);
  }
  return tables;
}

export interface RenderOptions {
  sampleRate: number;
  /** Length of the output buffer in milliseconds of *real* time. */
  durationMs: number;
  /**
   * Fraction of the written tempo, e.g. 0.8 for 80 %. Note times are divided
   * by this, so a slower tempo stretches the accompaniment to match.
   */
  tempoScale?: number;
}

/** Deterministic noise, so a rendered percussion hit sounds the same each time. */
function makeNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0x80000000) - 1;
  };
}

/** Adds one note into `out`. */
function renderNote(
  out: Float32Array, note: BackingNote, spec: VoiceSpec, tables: Float32Array[],
  sampleRate: number, tempoScale: number, gain: number,
): void {
  const startSample = Math.floor((note.startTimeMs / tempoScale / 1000) * sampleRate);
  if (startSample >= out.length) return;

  const heldMs = note.durationMs / tempoScale;
  const heldSamples = Math.max(1, Math.floor((heldMs / 1000) * sampleRate));
  const releaseSamples = Math.max(1, Math.floor((spec.releaseMs / 1000) * sampleRate));
  const totalSamples = heldSamples + releaseSamples;

  const attack = Math.max(1, (spec.attackMs / 1000) * sampleRate);
  const decay = Math.max(1, (spec.decayMs / 1000) * sampleRate);
  const amplitude = gain * spec.gain * note.velocity;

  if (spec.noise) {
    const noise = makeNoise(note.midiNumber * 7919 + note.startTimeMs);
    for (let i = 0; i < totalSamples; i++) {
      const index = startSample + i;
      if (index >= out.length) break;
      out[index] += noise() * amplitude * envelope(i, attack, decay, spec.sustain, heldSamples, releaseSamples);
    }
    return;
  }

  const table = tables[bandFor(note.midiNumber)];
  const increment = (midiToFrequency(note.midiNumber) / sampleRate) * TABLE_SIZE;
  let phase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const index = startSample + i;
    if (index >= out.length) break;

    const base = phase | 0;
    const frac = phase - base;
    const a = table[base % TABLE_SIZE];
    const b = table[(base + 1) % TABLE_SIZE];

    out[index] += (a + (b - a) * frac)
      * amplitude
      * envelope(i, attack, decay, spec.sustain, heldSamples, releaseSamples);

    phase += increment;
    if (phase >= TABLE_SIZE) phase -= TABLE_SIZE;
  }
}

function envelope(
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

/** Renders a set of parts into one mono buffer. */
export function renderParts(
  parts: readonly BackingPart[], options: RenderOptions,
): Float32Array {
  const { sampleRate, durationMs, tempoScale = 1 } = options;
  const length = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const out = new Float32Array(length);

  for (const part of parts) {
    if (part.muted || part.gain <= 0) continue;
    const spec = VOICES[part.instrument];
    const tables = tablesFor(part.instrument, sampleRate);
    for (const note of part.notes) {
      renderNote(out, note, spec, tables, sampleRate, tempoScale, part.gain);
    }
  }

  return out;
}

/** Sums buffers of possibly different lengths into a new one. */
export function mixBuffers(...buffers: Float32Array[]): Float32Array {
  const length = buffers.reduce((max, b) => Math.max(max, b.length), 0);
  const out = new Float32Array(length);
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) out[i] += buffer[i];
  }
  return out;
}

/**
 * Soft-clips anything over the ceiling instead of scaling the whole buffer.
 *
 * Normalising by the peak would make a mix quieter every time a couple of
 * notes happened to line up, so a passage would change level for reasons that
 * have nothing to do with how it is written. A tanh knee keeps the level
 * steady and only touches the moments that would actually have clipped.
 */
export function limit(buffer: Float32Array, ceiling = 0.89): Float32Array {
  const knee = ceiling * 0.7;
  for (let i = 0; i < buffer.length; i++) {
    const x = buffer[i];
    const magnitude = Math.abs(x);
    if (magnitude <= knee) continue;
    const over = (magnitude - knee) / (1 - knee);
    const shaped = knee + (ceiling - knee) * Math.tanh(over);
    buffer[i] = Math.sign(x) * shaped;
  }
  return buffer;
}

/** Fades the first and last few milliseconds so a looped buffer does not click. */
export function fadeEdges(buffer: Float32Array, sampleRate: number, fadeMs = 8): Float32Array {
  const fade = Math.min(Math.floor((fadeMs / 1000) * sampleRate), buffer.length >> 1);
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    buffer[i] *= gain;
    buffer[buffer.length - 1 - i] *= gain;
  }
  return buffer;
}
