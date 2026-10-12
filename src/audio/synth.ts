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
import { Room, ROOM_SETTLE_SEC } from './room';
import {
  bandFor, bandLowestMidi, bowNoiseAt, bowNoiseSpanSec, GRAIN_FADE_SEC, brightnessTier, centsToRatio, envelopeAt, grainAt, morphTimeSec,
  noteSeed, NoteVariation, noteVariation, scoopCents, settledSpectrum, shapedSpectrum, spectrumForTier, vibratoCents,
  VoiceSpec, VOICES, BAND_COUNT,
} from './voices';

const TABLE_SIZE = 2048;

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

/**
 * Below this share of bright spectrum left, a morphing voice reads only its
 * settled table. The weight is rescaled to reach zero exactly here, so the
 * bright table is dropped without a step.
 */
const MORPH_FLOOR = 0.03;

/**
 * Builds one cycle per half-octave band, each dropping the harmonics that would
 * alias for the *lowest* note in that band. Without this a high piano note
 * with eight harmonics folds partials back down the spectrum and rings
 * audibly out of tune.
 *
 * `settled` builds the spectrum a morphing voice decays to instead of the one
 * it starts with. Both are shaped by the instrument's body for their band.
 */
function buildTables(spec: VoiceSpec, sampleRate: number, tier: number, settled: boolean): Float32Array[] {
  const tables: Float32Array[] = [];
  const nyquist = sampleRate / 2;
  const plain = spectrumForTier(spec, tier);

  for (let band = 0; band < BAND_COUNT; band++) {
    const harmonics = settled ? settledSpectrum(spec, tier, band) : shapedSpectrum(spec, tier, band);
    const allowed = Math.max(1, Math.floor(nyquist / midiToFrequency(bandLowestMidi(band))));
    const table = singleCycle(harmonics, allowed);
    // Shaping the spectrum must change the note's colour and not its level, or
    // the low notes of a woody voice would come out quieter than its high ones.
    matchLoudness(table, singleCycle(plain, allowed));
    tables.push(table);
  }

  return tables;
}

/** One cycle of a harmonic series, using at most `allowed` partials, scaled so its peak is 1. */
function singleCycle(harmonics: readonly number[], allowed: number): Float32Array {
  const table = new Float32Array(TABLE_SIZE);
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
  return table;
}

/** The most a table may be turned up to match a reference, so its peak stays inside the limiter's reach. */
const MAX_LOUDNESS_GAIN = 1.5;

/** Scales `table` to the RMS level of `reference`, within {@link MAX_LOUDNESS_GAIN}. */
function matchLoudness(table: Float32Array, reference: Float32Array): void {
  const level = rms(table);
  if (level <= 0) return;
  const gain = Math.min(MAX_LOUDNESS_GAIN, rms(reference) / level);
  for (let i = 0; i < table.length; i++) table[i]! *= gain;
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/**
 * Cached per instrument, sample rate, brightness tier *and* whether it is the
 * settled spectrum.
 *
 * Four tiers per voice is four times the tables and no extra work per sample:
 * the note reads whichever one its dynamic asks for. Building them is the only
 * cost, it happens once, and it is what lets a forte note be brighter rather
 * than merely louder.
 */
const tableCache = new Map<string, Float32Array[]>();

function tablesFor(
  instrument: InstrumentName, sampleRate: number, tier: number, settled = false,
): Float32Array[] {
  const key = `${instrument}@${sampleRate}@${tier}@${settled ? 's' : 'b'}`;
  let tables = tableCache.get(key);
  if (!tables) {
    tables = buildTables(VOICES[instrument], sampleRate, tier, settled);
    tableCache.set(key, tables);
  }
  return tables;
}

/** Time constant of a note's fading brightness, in samples; irrelevant to a voice that does not morph. */
function morphSamplesFor(spec: VoiceSpec, midiNumber: number, sampleRate: number): number {
  return Math.max(1, morphTimeSec(spec, midiNumber) * sampleRate);
}

/** The bright table for a note and, when the voice morphs, the one it settles to. */
function tablesForNote(
  instrument: InstrumentName, sampleRate: number, velocity: number, midiNumber: number,
): { table: Float32Array; settled: Float32Array | null } {
  const tier = brightnessTier(velocity);
  const band = bandFor(midiNumber);
  return {
    table: tablesFor(instrument, sampleRate, tier)[band]!,
    settled: VOICES[instrument].morph ? tablesFor(instrument, sampleRate, tier, true)[band]! : null,
  };
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

/** Everything one voice needs to render: the note, its sound, and which samples of it to write. */
interface VoiceJob {
  /** Output index at which note-relative sample 0 sits. May be negative. */
  originIndex: number;
  firstI: number;
  lastI: number;
  spec: VoiceSpec;
  table: Float32Array;
  /** What a morphing voice's spectrum settles to; null for a voice whose spectrum stays put. */
  settled: Float32Array | null;
  /** Time constant of the brightness fading, in samples. */
  morphSamples: number;
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

/** A well-mixed 32-bit hash of an integer. */
function hash32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Samples between the random points of the bow noise; it is smooth between them. */
const NOISE_STEP = 6;

/**
 * Band-limited noise that is a pure function of the sample index.
 *
 * A random value every few samples, joined by straight lines: white noise with
 * its top taken off, which is what a bow on rosin or breath across a reed
 * sounds like — a hiss is the giveaway of a synthesiser. Because it depends
 * only on the index, a slice starting mid-note reads exactly what a single pass
 * would have, with nothing to wind forward.
 */
class SmoothNoise {
  private block = -1;
  private from = 0;
  private to = 0;

  constructor(private readonly seed: number) {}

  at(i: number): number {
    const b = (i / NOISE_STEP) | 0;
    if (b !== this.block) {
      this.block = b;
      this.from = this.pointAt(b);
      this.to = this.pointAt(b + 1);
    }
    return this.from + (this.to - this.from) * ((i - b * NOISE_STEP) / NOISE_STEP);
  }

  private pointAt(block: number): number {
    return (hash32(this.seed ^ Math.imul(block, 0x9e3779b1)) / 2147483648) - 1;
  }
}

/**
 * The bow or breath noise of one note: the smooth noise itself and the level
 * it sounds at, which is re-evaluated once per block and interpolated for the
 * same reason the pitch is.
 */
class NoiseBed {
  private readonly noise: SmoothNoise;
  private block = -1;
  private from = 0;
  private to = 0;
  /** From this sample on the level is the sustained texture and no longer moves. */
  private readonly steadyFrom: number;
  private readonly steadyLevel: number;

  constructor(private readonly spec: VoiceSpec, private readonly sampleRate: number, seed: number) {
    this.noise = new SmoothNoise(seed ^ 0x5bf03635);
    const settledAt = Math.max(bowNoiseSpanSec(spec), GRAIN_FADE_SEC);
    this.steadyFrom = Math.ceil(settledAt * sampleRate / VIBRATO_BLOCK) * VIBRATO_BLOCK;
    this.steadyLevel = grainAt(spec, settledAt);
  }

  at(i: number): number {
    if (i >= this.steadyFrom) return this.steadyLevel > 0 ? this.noise.at(i) * this.steadyLevel : 0;
    const b = (i / VIBRATO_BLOCK) | 0;
    if (b !== this.block) {
      this.block = b;
      this.from = this.levelAtBlock(b);
      this.to = this.levelAtBlock(b + 1);
    }
    const level = this.from + (this.to - this.from) * ((i - b * VIBRATO_BLOCK) / VIBRATO_BLOCK);
    return level > 0 ? this.noise.at(i) * level : 0;
  }

  /** Attack scrape plus the texture that stays under the note. */
  private levelAtBlock(block: number): number {
    const seconds = (block * VIBRATO_BLOCK) / this.sampleRate;
    return bowNoiseAt(this.spec, seconds) + grainAt(this.spec, seconds);
  }
}

/** Bow or breath noise, when this voice has any. */
function noiseBedFor(job: VoiceJob): Pick<NoiseBed, 'at'> {
  return (job.spec.bowNoise ?? 0) > 0 ? new NoiseBed(job.spec, job.sampleRate, job.seed) : NO_NOISE;
}

/**
 * Where the note's pitch is away from steady, as a phase offset in table
 * units, interpolated across fixed blocks so the costly curves run once per
 * block rather than once per sample.
 *
 * Two things move the pitch: vibrato, a wobble that starts after the note is
 * down, and the scoop, a slide up from just under the note as the string
 * catches. Both are closed-form in `i`, so they survive being rendered in
 * slices.
 */
class PitchCursor {
  private block = -1;
  private from = 0;
  private to = 0;

  constructor(
    private readonly spec: VoiceSpec,
    private readonly variation: NoteVariation,
    private readonly sampleRate: number,
    /** Phase units per unit of vibrato cents. */
    private readonly vibratoScale: number,
    /** Phase units per second per cent of scoop. */
    private readonly scoopScale: number,
  ) {}

  offsetAt(i: number): number {
    const b = (i / VIBRATO_BLOCK) | 0;
    if (b !== this.block) {
      this.block = b;
      this.from = this.unitsAtBlock(b);
      this.to = this.unitsAtBlock(b + 1);
    }
    const within = (i - b * VIBRATO_BLOCK) / VIBRATO_BLOCK;
    return this.from + (this.to - this.from) * within;
  }

  private unitsAtBlock(block: number): number {
    const seconds = (block * VIBRATO_BLOCK) / this.sampleRate;
    return vibratoCents(this.spec, this.variation, seconds) * this.vibratoScale + this.scoopUnitsAt(seconds);
  }

  /**
   * Phase behind a steady pitch after `seconds` of the scoop. The pitch is
   * `cents·e^(−t/τ)` flat, so the phase lost is the integral of that: its
   * total, minus what is still to come.
   */
  private scoopUnitsAt(seconds: number): number {
    const scoop = this.spec.scoop;
    if (!scoop) return 0;
    const total = scoop.cents * this.variation.scoopScale;
    const timeConstant = scoop.ms / 1000;
    return -this.scoopScale * timeConstant * (total - scoopCents(this.spec, this.variation, seconds));
  }
}

/** The stand-ins a voice uses for the parts it does not have, so the sample loop need not ask. */
const STEADY_PITCH = { offsetAt: (_i: number): number => 0 };
const NO_NOISE = { at: (_i: number): number => 0 };
const NO_MORPH = { next: (): number => 0 };

function pitchCursorFor(job: VoiceJob, increment: number): Pick<PitchCursor, 'offsetAt'> {
  const rateHz = job.spec.vibrato?.rateHz ?? 0;
  if (rateHz <= 0 && !job.spec.scoop) return STEADY_PITCH;
  const vibratoScale = rateHz > 0 ? (CENTS_SLOPE * increment * job.sampleRate) / (2 * Math.PI * rateHz) : 0;
  const scoopScale = CENTS_SLOPE * increment * job.sampleRate;
  return new PitchCursor(job.spec, job.variation, job.sampleRate, vibratoScale, scoopScale);
}

/**
 * How much of a morphing voice's bright spectrum is left, sample by sample:
 * 1 at the attack, falling exponentially toward the settled one, and 0 once it
 * is too faint to hear so the bright table need no longer be read at all.
 */
class SpectralMorph {
  private weight: number;
  private readonly step: number;

  constructor(morphSamples: number, firstI: number) {
    this.step = Math.exp(-1 / morphSamples);
    // Seeded from a closed form so a slice starting mid-note agrees with a full pass.
    const seeded = Math.exp(-firstI / morphSamples);
    this.weight = seeded < MORPH_FLOOR ? 0 : seeded;
  }

  /** The brightness for this sample, 0–1; call once per sample. */
  next(): number {
    const now = this.weight;
    if (now === 0) return 0;
    const after = now * this.step;
    this.weight = after < MORPH_FLOOR ? 0 : after;
    return (now - MORPH_FLOOR) / (1 - MORPH_FLOOR);
  }
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
  const { originIndex, firstI, lastI, spec, table, settled, envelope, sampleRate } = job;
  const increment = job.baseIncrement * centsToRatio(job.variation.detuneCents);
  const { incrementA, incrementB, unison } = unisonIncrements(increment, unisonHalfSpread(spec, envelope.heldSamples, sampleRate));
  const voiceGain = unison ? job.amplitude * 0.5 : job.amplitude;
  const pitch = pitchCursorFor(job, increment);
  const noise = noiseBedFor(job);
  const morph = settled ? new SpectralMorph(job.morphSamples, firstI) : NO_MORPH;
  const wraps = pitch !== STEADY_PITCH;

  // Phase is accumulated within the slice but *seeded* from a closed form, so
  // a slice starting mid-note lands on the same phase a single pass would have
  // reached. That keeps the join exact while making the inner step an add
  // rather than a multiply and a modulo.
  let phaseA = wrapPhase(incrementA * firstI);
  let phaseB = unison ? wrapPhase(incrementB * firstI) : 0;
  const lastIndex = Math.min(lastI, out.length - originIndex);

  for (let i = firstI; i < lastIndex; i++) {
    const index = originIndex + i;
    const brightness = morph.next();
    if (index >= 0) {
      const offset = pitch.offsetAt(i);
      let sample = voiceSample(table, settled, wraps, phaseA + offset, brightness);
      if (unison) sample += voiceSample(table, settled, wraps, phaseB + offset, brightness);
      out[index] += (sample + noise.at(i)) * voiceGain * envelopeGain(i, envelope);
    }
    phaseA = advance(phaseA, incrementA);
    if (unison) phaseB = advance(phaseB, incrementB);
  }
}

/**
 * One sample of a voice at a phase: the bright table blended toward the
 * settled one by `brightness`. A phase that carries an offset can sit outside
 * the table and is wrapped; one that does not is already inside it.
 */
function voiceSample(
  table: Float32Array, settled: Float32Array | null, offset: boolean, phase: number, brightness: number,
): number {
  if (!settled) return offset ? readTable(table, phase) : readAt(table, phase);
  const dark = offset ? readTable(settled, phase) : readAt(settled, phase);
  if (brightness <= 0) return dark;
  const bright = offset ? readTable(table, phase) : readAt(table, phase);
  return dark + (bright - dark) * brightness;
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

  const { table, settled } = tablesForNote(instrument, sampleRate, velocity, note.midiNumber);
  const increment = (midiToFrequency(note.midiNumber) / sampleRate) * TABLE_SIZE;

  renderVoice(out, {
    originIndex: startSample, firstI: 0, lastI: totalSamples, spec, table, settled,
    morphSamples: morphSamplesFor(spec, note.midiNumber, sampleRate), baseIncrement: increment, amplitude,
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
 * The voices carry nothing between slices. A note that straddles a boundary is
 * rendered twice — once as a tail, once as a head — and both halves land on
 * the same samples because phase and envelope are computed from the note's own
 * offset rather than accumulated. That is why `envelopeAt` is a pure function
 * of the sample index and why the phase below is derived with a modulo instead
 * of being stepped from zero.
 *
 * The room is the one thing that does remember, since a reverb tail is by
 * nature the last few seconds of everything. A caller rendering consecutive
 * slices hands the same `Room` to each and pays nothing extra. A caller that
 * renders anywhere else — or none — gets the room warmed up first from the
 * audio that leads into the slice, wrapping round the loop for the first one,
 * so the result is the same either way.
 */
export function renderProgramInto(
  out: Float32Array, program: BackingProgram, fromSample: number, sampleRate: number, room?: Room,
): void {
  const inRoom = room ?? new Room(sampleRate);
  if (inRoom.position !== fromSample) warmRoom(inRoom, program, fromSample, sampleRate);
  renderProgramDry(out, program, fromSample, sampleRate);
  inRoom.process(out);
  limit(out);
}

/** Brings a room to the state it would be in at `fromSample` by playing it the audio that leads in. */
function warmRoom(room: Room, program: BackingProgram, fromSample: number, sampleRate: number): void {
  room.reset();
  const total = Math.ceil(program.durationSec * sampleRate);
  const lead = Math.min(Math.ceil(ROOM_SETTLE_SEC * sampleRate), total);
  const start = fromSample - lead;
  // The loop repeats, so what leads into its first bars is its own last ones.
  if (start < 0 && total > 0) feedRoom(room, program, total + start, -start, sampleRate);
  if (fromSample > 0) feedRoom(room, program, Math.max(0, start), fromSample - Math.max(0, start), sampleRate);
  room.position = fromSample;
}

function feedRoom(room: Room, program: BackingProgram, from: number, length: number, sampleRate: number): void {
  if (length <= 0) return;
  const lead = new Float32Array(length);
  renderProgramDry(lead, program, from, sampleRate);
  room.process(lead);
}

/**
 * Every voice of the program that sounds in `[fromSample, fromSample + out.length)`,
 * before any room or limiting.
 *
 * What the voices alone do, and so what has to be identical however the song is
 * cut into slices. Exported for the tests that hold it to that.
 */
export function renderProgramDry(out: Float32Array, program: BackingProgram, fromSample: number, sampleRate: number): void {
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
    const envelope: Envelope = { attack, decay, sustain: spec.sustain, heldSamples, releaseSamples };

    /** Where in the note this slice begins, and where it ends. */
    const firstI = Math.max(0, fromSample - startSample);
    const lastI = Math.min(totalSamples, toSample - startSample);

    if (spec.noise) {
      renderHit(out, startSample - fromSample, firstI, lastI, seed, amplitude, envelope, spec);
      continue;
    }

    // The dynamic the note was *played* at, not the level it is mixed at — a
    // quiet part is not a dull part. `velocity` is carried on the scheduled
    // note for exactly this.
    const { table, settled } = tablesForNote(note.instrument, sampleRate, note.velocity * variation.velocityScale, note.midiNumber);
    const increment = (midiToFrequency(note.midiNumber) / sampleRate) * TABLE_SIZE;

    renderVoice(out, {
      originIndex: startSample - fromSample, firstI, lastI, spec, table, settled,
      morphSamples: morphSamplesFor(spec, note.midiNumber, sampleRate), baseIncrement: increment, amplitude,
      envelope, sampleRate, variation, seed,
    });
  }
}

/**
 * A noise hit — the percussion voice.
 *
 * Deterministic noise has to be wound forward to the slice, or a hit split
 * across a boundary would change timbre mid-hit. Percussion notes are short, so
 * the cost is bounded.
 */
function renderHit(
  out: Float32Array, originIndex: number, firstI: number, lastI: number, seed: number,
  amplitude: number, envelope: Envelope, spec: VoiceSpec,
): void {
  const noise = makeNoise(seed);
  for (let i = 0; i < firstI; i++) noise();
  for (let i = firstI; i < lastI; i++) {
    out[originIndex + i] += noise() * amplitude
      * envelopeAt(i, envelope.attack, envelope.decay, spec.sustain, envelope.heldSamples, envelope.releaseSamples);
  }
}
