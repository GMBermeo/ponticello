/**
 * A small room around the accompaniment.
 *
 * A bare additive tone has nowhere to be. Real instruments are heard in a
 * space, and the space is most of why a section of players sounds like one
 * body rather than a stack of oscillators. This is a Schroeder-style reverb —
 * parallel damped combs into series all-passes — sized for a rehearsal room
 * rather than a hall: bright enough to keep the rhythm clear, short enough that
 * the next note is not sitting in the last one's tail.
 *
 * Two things keep it fit for accompaniment. Only what is above the low end goes
 * into the room, so a bass or drone stays tight instead of turning to mud; and
 * the tail is damped, so it darkens the way a real one does.
 *
 * Pure and deterministic: the same samples in give the same samples out, on
 * every platform. See AGENTS.md — nothing here may import React Native.
 */

/** The delays are designed at this rate and scaled to the real one. */
const DESIGN_RATE = 44100;

/** Comb delays in samples at {@link DESIGN_RATE}: mutually near-prime, so the echoes do not line up. */
const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491] as const;
const ALLPASS_DELAYS = [556, 441] as const;
const ALLPASS_FEEDBACK = 0.5;

/** How long the tail takes to fall by 60 dB, in seconds. */
const DECAY_SEC = 1.1;
/** How much of the highs the tail loses on each trip round a comb, 0–1. */
const DAMPING = 0.32;
/** Gap before the first reflection, in seconds; keeps the note's own attack clean. */
const PREDELAY_SEC = 0.014;
/** Below this the send is filtered out, in Hz. */
const SEND_HIGH_PASS_HZ = 180;
/** Level of the wet signal against the dry one. */
const WET = 0.12;
/** Scales the sum of the combs back to unity, so `WET` means what it says. */
const COMB_TRIM = 1 / COMB_DELAYS.length;

/** How much audio must precede a position for the room to be in its steady state there, in seconds. */
export const ROOM_SETTLE_SEC = 1.3;

class DelayLine {
  readonly buffer: Float32Array;
  index = 0;
  /** The low-pass state of a comb's feedback path; unused by the other lines. */
  damp = 0;

  constructor(length: number) {
    this.buffer = new Float32Array(Math.max(1, length));
  }

  clear(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.damp = 0;
  }
}

/**
 * The room, run a stage at a time over a whole block.
 *
 * The stages feed forward into one another — send, predelay, the combs side by
 * side, the all-passes — so running each over the block before the next gives
 * exactly the samples that threading one sample through all of them would, and
 * each stage is a tight loop the engine can keep hot.
 */
export class Room {
  private readonly combs: DelayLine[];
  private readonly combGains: number[];
  private readonly allpasses: DelayLine[];
  private readonly predelay: DelayLine;
  private readonly highPassCoefficient: number;
  /** State of the two one-pole high-pass stages: last input and last output of each. */
  private readonly highPassState = [0, 0, 0, 0];
  private send = new Float32Array(0);
  private tail = new Float32Array(0);

  /** The sample position this room has been fed up to; the next block must start here. */
  position = -1;

  constructor(readonly sampleRate: number) {
    const scale = sampleRate / DESIGN_RATE;
    this.combs = COMB_DELAYS.map((delay) => new DelayLine(Math.round(delay * scale)));
    // A comb of length d decays by g per trip, so g = 10^(−3·d / T60) gives every comb the same T60.
    this.combGains = this.combs.map((line) => Math.pow(10, (-3 * line.buffer.length) / (DECAY_SEC * sampleRate)));
    this.allpasses = ALLPASS_DELAYS.map((delay) => new DelayLine(Math.round(delay * scale)));
    this.predelay = new DelayLine(Math.round(PREDELAY_SEC * sampleRate));
    this.highPassCoefficient = Math.exp((-2 * Math.PI * SEND_HIGH_PASS_HZ) / sampleRate);
  }

  /** Empties the room, as if silence had been playing forever. */
  reset(): void {
    for (const line of [...this.combs, ...this.allpasses, this.predelay]) line.clear();
    this.highPassState.fill(0);
    this.position = -1;
  }

  /** Adds the room to `block` in place, and moves the position on by its length. */
  process(block: Float32Array): void {
    if (this.send.length < block.length) {
      this.send = new Float32Array(block.length);
      this.tail = new Float32Array(block.length);
    }
    const length = block.length;
    this.highPass(block, this.send, length);
    this.delay(this.predelay, this.send, length);
    this.tail.fill(0, 0, length);
    for (let c = 0; c < this.combs.length; c++) this.comb(this.combs[c]!, this.combGains[c]!, length);
    for (let n = 0; n < length; n++) this.tail[n] = this.tail[n]! * COMB_TRIM;
    for (const line of this.allpasses) this.allpass(line, length);
    for (let n = 0; n < length; n++) block[n] = block[n]! + this.tail[n]! * WET;
    if (this.position >= 0) this.position += length;
  }

  /** Two one-pole high-passes in a row, so the send carries no low end. */
  private highPass(input: Float32Array, output: Float32Array, length: number): void {
    const a = this.highPassCoefficient;
    const state = this.highPassState;
    let inA = state[0]!;
    let outA = state[1]!;
    let inB = state[2]!;
    let outB = state[3]!;
    for (let n = 0; n < length; n++) {
      const x = input[n]!;
      outA = a * (outA + x - inA);
      inA = x;
      outB = a * (outB + outA - inB);
      inB = outA;
      output[n] = outB;
    }
    state[0] = inA;
    state[1] = outA;
    state[2] = inB;
    state[3] = outB;
  }

  /** Delays `signal` by the line's length, in place. */
  private delay(line: DelayLine, signal: Float32Array, length: number): void {
    const { buffer } = line;
    let index = line.index;
    for (let n = 0; n < length; n++) {
      const held = buffer[index]!;
      buffer[index] = signal[n]!;
      signal[n] = held;
      index = index + 1 === buffer.length ? 0 : index + 1;
    }
    line.index = index;
  }

  /** A feedback comb whose loop loses highs, its echoes summed into the tail. */
  private comb(line: DelayLine, gain: number, length: number): void {
    const { buffer } = line;
    let index = line.index;
    let damp = line.damp;
    for (let n = 0; n < length; n++) {
      const echo = buffer[index]!;
      damp = damp * DAMPING + echo * (1 - DAMPING);
      buffer[index] = this.send[n]! + damp * gain;
      this.tail[n] = this.tail[n]! + echo;
      index = index + 1 === buffer.length ? 0 : index + 1;
    }
    line.index = index;
    line.damp = damp;
  }

  /** A Schroeder all-pass over the tail: smears the comb echoes into a diffuse wash. */
  private allpass(line: DelayLine, length: number): void {
    const { buffer } = line;
    let index = line.index;
    for (let n = 0; n < length; n++) {
      const input = this.tail[n]!;
      const held = buffer[index]!;
      buffer[index] = input + held * ALLPASS_FEEDBACK;
      this.tail[n] = held - input;
      index = index + 1 === buffer.length ? 0 : index + 1;
    }
    line.index = index;
  }
}

/**
 * An impulse response for the browser's `ConvolverNode`, in the same room.
 *
 * The native renderer runs the feedback network above; Web Audio would rather
 * convolve. This is decaying noise with the same reverberation time, the same
 * predelay and the same darkening as the tail lengthens — a single channel,
 * deterministic, for a convolver to normalise.
 */
export function createRoomImpulse(sampleRate: number): Float32Array<ArrayBuffer> {
  const length = Math.ceil(DECAY_SEC * 1.4 * sampleRate);
  const predelay = Math.round(PREDELAY_SEC * sampleRate);
  const impulse = new Float32Array(length);
  let state = 0x2545f491;
  let darkened = 0;
  for (let n = predelay; n < length; n++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const noise = state / 0x80000000 - 1;
    const seconds = (n - predelay) / sampleRate;
    // The tail loses its highs as it goes: a one-pole low-pass that closes over time.
    const openness = 1 - Math.min(0.94, DAMPING + seconds * 0.9);
    darkened += (noise - darkened) * openness;
    impulse[n] = darkened * Math.pow(10, (-3 * seconds) / DECAY_SEC);
  }
  return impulse;
}
