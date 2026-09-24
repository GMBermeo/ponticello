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

import { midiToFrequency, BackingNote, BackingPart, InstrumentName } from '@domain';
import { BackingProgram } from './backing';
import {
  bowNoiseAt, brightnessTier, centsToRatio, envelopeAt, noteSeed, NoteVariation,
  noteVariation, spectrumForTier, vibratoCents, VoiceSpec, VOICES,
} from './voices';

const TABLE_SIZE = 2048;
/** One wavetable per octave, from MIDI 12 upwards. */
const BAND_COUNT = 10;

/**
 * How often the vibrato curve is re-evaluated, in samples.
 *
 * A sine per sample would be the one expensive thing in an otherwise cheap
 * inner loop. Every 32 samples is 1.4 kHz of control rate against a 5 Hz
 * wobble — three hundred points per cycle, linearly interpolated, which is far
 * past anything audible.
 */
const VIBRATO_BLOCK = 32;

/** d(ratio)/d(cents) near unity. Vibrato is small, so the tangent is exact enough. */
const CENTS_SLOPE = Math.LN2 / 1200;

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
function buildTables(spec: VoiceSpec, sampleRate: number, tier: number): Float32Array[] {
  const tables: Float32Array[] = [];
  const nyquist = sampleRate / 2;
  const harmonics = spectrumForTier(spec, tier);

  for (let band = 0; band < BAND_COUNT; band++) {
    const table = new Float32Array(TABLE_SIZE);
    const lowestHz = midiToFrequency(12 + band * 12);
    const allowed = Math.max(1, Math.floor(nyquist / lowestHz));

    let peak = 0;
    for (let i = 0; i < TABLE_SIZE; i++) {
      let sample = 0;
      const phase = (2 * Math.PI * i) / TABLE_SIZE;
      for (let h = 0; h < harmonics.length && h + 1 <= allowed; h++) {
        sample += harmonics[h]! * Math.sin(phase * (h + 1));
      }
      table[i] = sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i]! /= peak;
    tables.push(table);
  }

  return tables;
}

/**
 * Cached per instrument, sample rate *and* brightness tier.
 *
 * Four tiers per voice is four times the tables and no extra work per sample:
 * the note reads whichever one its dynamic asks for. Building them is the only
 * cost, it happens once, and it is what lets a forte note be brighter rather
 * than merely louder.
 */
const tableCache = new Map<string, Float32Array[]>();

function tablesFor(
  instrument: InstrumentName, sampleRate: number, tier: number,
): Float32Array[] {
  const key = `${instrument}@${sampleRate}@${tier}`;
  let tables = tableCache.get(key);
  if (!tables) {
    tables = buildTables(VOICES[instrument], sampleRate, tier);
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

/**
 * Adds one sounding voice into `out`.
 *
 * Shared by the whole-buffer renderer and the slice renderer, which is what
 * keeps them sounding identical. Everything here is a pure function of the
 * note-relative sample index `i` — phase included — so a note rendered in two
 * slices produces exactly the same samples as one rendered in a single pass.
 * That is not a nicety: the native player builds an eleven-minute song in
 * two-second pieces, and a note straddling a boundary that disagreed with
 * itself would click.
 *
 * Vibrato is applied as a *phase* offset rather than by stepping the
 * increment. Stepping would make the phase an accumulation, and an
 * accumulation cannot be resumed from the middle of a note. Modulating phase
 * by `sin` gives a frequency deviation proportional to `cos` — the same wobble,
 * a quarter-cycle over, and closed-form in `i`.
 */
/** Everything one voice needs to render: the note, its sound, and which samples of it to write. */
interface VoiceJob {
  /** Output index at which note-relative sample 0 sits. May be negative. */
  originIndex: number;
  firstI: number;
  lastI: number;
  spec: VoiceSpec;
  table: Float32Array;
  baseIncrement: number;
  amplitude: number;
  envelope: Envelope;
  sampleRate: number;
  variation: NoteVariation;
  seed: number;
}

/** Envelope timings, in samples. */
interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  heldSamples: number;
  releaseSamples: number;
}

function envelopeGain(i: number, envelope: Envelope): number {
  return envelopeAt(i, envelope.attack, envelope.decay, envelope.sustain, envelope.heldSamples, envelope.releaseSamples);
}

/**
 * Half the unison spread in cents, or 0 for a single voice.
 *
 * A section, not a soloist: two copies a few cents apart, half level each.
 * Not worth it on a note too short for the beating to be heard.
 */
function unisonHalfSpread(spec: VoiceSpec, heldSamples: number, sampleRate: number): number {
  const cents = spec.unisonCents ?? 0;
  return cents > 0 && heldSamples > sampleRate * 0.08 ? cents / 2 : 0;
}

/** Phase steps for the two unison copies; the second is silent (0) for a single voice. */
function unisonIncrements(increment: number, halfSpread: number): { incrementA: number; incrementB: number; unison: boolean } {
  if (!halfSpread) return { incrementA: increment, incrementB: 0, unison: false };
  return { incrementA: increment * centsToRatio(halfSpread), incrementB: increment * centsToRatio(-halfSpread), unison: true };
}

/**
 * Bow noise runs on its own short envelope from the note's own zero, so it
 * has to be wound forward when a slice starts partway in. Null when the
 * voice has none, or the slice starts after it has died away.
 */
function bowNoiseSource(job: VoiceJob): { next: () => number; span: number } | null {
  const { spec, sampleRate, firstI, seed } = job;
  if ((spec.bowNoise ?? 0) <= 0) return null;
  const span = Math.ceil(Math.max(0.02, (spec.attackMs / 1000) * 1.8) * sampleRate);
  if (firstI >= span) return null;
  const next = makeNoise(seed ^ 0x5bf03635);
  for (let i = 0; i < firstI; i++) next();
  return { next, span };
}

/**
 * Vibrato phase offset, interpolated across fixed blocks so the costly
 * `vibratoCents` runs once per block rather than once per sample.
 */
class VibratoCursor {
  private block = -1;
  private from = 0;
  private to = 0;

  constructor(
    private readonly spec: VoiceSpec,
    private readonly variation: NoteVariation,
    private readonly sampleRate: number,
    private readonly scale: number,
  ) {}

  offsetAt(i: number): number {
    const b = (i / VIBRATO_BLOCK) | 0;
    if (b !== this.block) {
      this.block = b;
      this.from = this.centsAtBlock(b);
      this.to = this.centsAtBlock(b + 1);
    }
    const within = (i - b * VIBRATO_BLOCK) / VIBRATO_BLOCK;
    return this.from + (this.to - this.from) * within;
  }

  private centsAtBlock(block: number): number {
    return vibratoCents(this.spec, this.variation, (block * VIBRATO_BLOCK) / this.sampleRate) * this.scale;
  }
}

function vibratoFor(job: VoiceJob, increment: number): VibratoCursor | null {
  const rateHz = job.spec.vibrato?.rateHz ?? 0;
  if (rateHz <= 0) return null;
  const scale = (CENTS_SLOPE * increment * job.sampleRate) / (2 * Math.PI * rateHz);
  return new VibratoCursor(job.spec, job.variation, job.sampleRate, scale);
}

/**
 * Adds one sounding voice into `out`.
 *
 * Shared by the whole-buffer renderer and the slice renderer, which is what
 * keeps them sounding identical. Everything here is a pure function of the
 * note-relative sample index `i` — phase included — so a note rendered in two
 * slices produces exactly the same samples as one rendered in a single pass.
 * That is not a nicety: the native player builds an eleven-minute song in
 * two-second pieces, and a note straddling a boundary that disagreed with
 * itself would click.
 *
 * Vibrato is applied as a *phase* offset rather than by stepping the
 * increment. Stepping would make the phase an accumulation, and an
 * accumulation cannot be resumed from the middle of a note. Modulating phase
 * by `sin` gives a frequency deviation proportional to `cos` — the same wobble,
 * a quarter-cycle over, and closed-form in `i`.
 */
function renderVoice(out: Float32Array, job: VoiceJob): void {
  const { originIndex, firstI, lastI, spec, table, envelope, sampleRate } = job;
  const increment = job.baseIncrement * centsToRatio(job.variation.detuneCents);
  const { incrementA, incrementB, unison } = unisonIncrements(increment, unisonHalfSpread(spec, envelope.heldSamples, sampleRate));
  const voiceGain = unison ? job.amplitude * 0.5 : job.amplitude;
  const vibrato = vibratoFor(job, increment);
  const noise = bowNoiseSource(job);
  const readVoice = (phase: number, offset: number) =>
    (vibrato ? readTable(table, phase + offset) : readAt(table, phase));

  // Phase is accumulated within the slice but *seeded* from a closed form, so
  // a slice starting mid-note lands on the same phase a single pass would have
  // reached. That keeps the join exact while making the inner step an add
  // rather than a multiply and a modulo.
  let phaseA = wrapPhase(incrementA * firstI);
  let phaseB = unison ? wrapPhase(incrementB * firstI) : 0;
  const lastIndex = Math.min(lastI, out.length - originIndex);

  for (let i = firstI; i < lastIndex; i++) {
    const index = originIndex + i;
    if (index >= 0) {
      const offset = vibrato?.offsetAt(i) ?? 0;
      let sample = readVoice(phaseA, offset);
      if (unison) sample += readVoice(phaseB, offset);
      if (noise && i < noise.span) sample += noise.next() * bowNoiseAt(spec, i / sampleRate);
      out[index] += sample * voiceGain * envelopeGain(i, envelope);
    }
    phaseA = advance(phaseA, incrementA);
    if (unison) phaseB = advance(phaseB, incrementB);
  }
}

/** Steps a phase already inside the table by one increment. */
function advance(phase: number, increment: number): number {
  const next = phase + increment;
  return next >= TABLE_SIZE ? next - TABLE_SIZE : next;
}

/** Brings any phase into `[0, TABLE_SIZE)`. */
function wrapPhase(phase: number): number {
  const wrapped = phase % TABLE_SIZE;
  return wrapped < 0 ? wrapped + TABLE_SIZE : wrapped;
}

/** One read at a phase already known to be inside the table. */
function readAt(table: Float32Array, phase: number): number {
  const base = phase | 0;
  const frac = phase - base;
  const a = table[base]!;
  const b = table[base + 1 === TABLE_SIZE ? 0 : base + 1]!;
  return a + (b - a) * frac;
}

/** One linearly-interpolated read, for a phase that may sit outside the table. */
function readTable(table: Float32Array, phase: number): number {
  return readAt(table, wrapPhase(phase));
}

/** Adds one note into `out`. */
function renderNote(
  out: Float32Array, note: BackingNote, spec: VoiceSpec,
  sampleRate: number, tempoScale: number, gain: number, instrument: InstrumentName,
): void {
  const startSample = Math.floor((note.startTimeMs / tempoScale / 1000) * sampleRate);
  if (startSample >= out.length) return;

  const seed = noteSeed(note.midiNumber, note.startTimeMs);
  const variation = noteVariation(spec, seed);
  const velocity = Math.max(0, Math.min(1, note.velocity * variation.velocityScale));

  const heldMs = note.durationMs / tempoScale;
  const heldSamples = Math.max(1, Math.floor((heldMs / 1000) * sampleRate));
  const releaseSamples = Math.max(1, Math.floor((spec.releaseMs / 1000) * sampleRate));
  const totalSamples = heldSamples + releaseSamples;

  const attack = Math.max(1, (spec.attackMs / 1000) * sampleRate * variation.attackScale);
  const decay = Math.max(1, (spec.decayMs / 1000) * sampleRate);
  const amplitude = gain * spec.gain * velocity;

  if (spec.noise) {
    const noise = makeNoise(seed);
    for (let i = 0; i < totalSamples; i++) {
      const index = startSample + i;
      if (index >= out.length) break;
      out[index] += noise() * amplitude
        * envelopeAt(i, attack, decay, spec.sustain, heldSamples, releaseSamples);
    }
    return;
  }

  const table = tablesFor(instrument, sampleRate, brightnessTier(velocity))[bandFor(note.midiNumber)]!;
  const increment = (midiToFrequency(note.midiNumber) / sampleRate) * TABLE_SIZE;

  renderVoice(out, {
    originIndex: startSample, firstI: 0, lastI: totalSamples, spec, table, baseIncrement: increment, amplitude,
    envelope: { attack, decay, sustain: spec.sustain, heldSamples, releaseSamples }, sampleRate, variation, seed,
  });
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
    for (const note of part.notes) {
      renderNote(out, note, spec, sampleRate, tempoScale, part.gain, part.instrument);
    }
  }

  return limit(out);
}
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

// ─── Slice rendering, for the native player ──────────────────────────────────

/**
 * Renders one slice of a program into `out`.
 *
 * `out` covers output samples `[fromSample, fromSample + out.length)`. Calling
 * this repeatedly over consecutive slices produces exactly the buffer
 * `renderParts` would have produced in one go, which is the whole point: the
 * native player can synthesise an eleven-minute song in two-second pieces,
 * yielding to the event loop between each, and never block a frame.
 *
 * Nothing is carried between slices. A note that straddles a boundary is
 * rendered twice — once as a tail, once as a head — and both halves land on
 * the same samples because phase and envelope are computed from the note's own
 * offset rather than accumulated. That is why `envelopeAt` is a pure function
 * of the sample index and why the phase below is derived with a modulo instead
 * of being stepped from zero.
 */
export function renderProgramInto(
  out: Float32Array, program: BackingProgram, fromSample: number, sampleRate: number,
): void {
  out.fill(0);
  const toSample = fromSample + out.length;

  for (const note of program.notes) {
    const startSample = Math.floor(note.atSec * sampleRate);
    if (startSample >= toSample) break;   // notes are sorted by start time

    const spec = VOICES[note.instrument];
    const seed = noteSeed(note.midiNumber, Math.round(note.atSec * 1000));
    const variation = noteVariation(spec, seed);

    const heldSamples = Math.max(1, Math.floor(note.holdSec * sampleRate));
    const releaseSamples = Math.max(1, Math.floor((spec.releaseMs / 1000) * sampleRate));
    const totalSamples = heldSamples + releaseSamples;
    if (startSample + totalSamples <= fromSample) continue;

    const attack = Math.max(1, (spec.attackMs / 1000) * sampleRate * variation.attackScale);
    const decay = Math.max(1, (spec.decayMs / 1000) * sampleRate);
    const amplitude = note.amplitude * spec.gain * variation.velocityScale;

    /** Where in the note this slice begins, and where it ends. */
    const firstI = Math.max(0, fromSample - startSample);
    const lastI = Math.min(totalSamples, toSample - startSample);

    if (spec.noise) {
      // Deterministic noise has to be wound forward to the slice, or a
      // percussion hit split across a boundary would change timbre mid-hit.
      // Percussion notes are short, so the cost is bounded.
      const noise = makeNoise(seed);
      for (let i = 0; i < firstI; i++) noise();
      for (let i = firstI; i < lastI; i++) {
        out[startSample + i - fromSample] +=
          noise() * amplitude
          * envelopeAt(i, attack, decay, spec.sustain, heldSamples, releaseSamples);
      }
      continue;
    }

    // The dynamic the note was *played* at, not the level it is mixed at — a
    // quiet part is not a dull part. `velocity` is carried on the scheduled
    // note for exactly this.
    const tier = brightnessTier(note.velocity * variation.velocityScale);
    const table = tablesFor(note.instrument, sampleRate, tier)[bandFor(note.midiNumber)]!;
    const increment = (midiToFrequency(note.midiNumber) / sampleRate) * TABLE_SIZE;

    renderVoice(out, {
      originIndex: startSample - fromSample, firstI, lastI, spec, table, baseIncrement: increment, amplitude,
      envelope: { attack, decay, sustain: spec.sustain, heldSamples, releaseSamples }, sampleRate, variation, seed,
    });
  }

  limit(out);
}

