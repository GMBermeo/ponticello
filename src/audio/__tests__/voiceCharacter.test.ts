import { describe, expect, it } from 'vitest';

import type { InstrumentName } from '@domain';
import type { BackingProgram, ScheduledNote } from '../backing/program';
import { renderProgramDry, renderProgramInto } from '../synth';
import {
  bandFor, bandLowestMidi, bodyGain, BAND_COUNT, grainAt, morphTimeSec, morphWeight, noteSeed,
  noteVariation, scoopCents, settledSpectrum, shapedSpectrum, VOICES,
} from '../voices';

const RATE = 44100;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function programOf(notes: Partial<ScheduledNote>[], durationSec = 4): BackingProgram {
  return {
    key: 'test',
    durationSec,
    notes: notes.map((note) => ({
      atSec: 0, holdSec: 2, midiNumber: 48, instrument: 'cello', amplitude: 0.4, velocity: 0.7, ...note,
    })),
  };
}

/** Energy at one frequency over a window, by a single-bin DFT. */
function energyAt(signal: Float32Array, frequency: number, fromSec: number, toSec: number): number {
  let re = 0;
  let im = 0;
  for (let i = Math.floor(fromSec * RATE); i < Math.floor(toSec * RATE); i++) {
    const angle = (2 * Math.PI * frequency * i) / RATE;
    re += signal[i]! * Math.cos(angle);
    im += signal[i]! * Math.sin(angle);
  }
  return Math.hypot(re, im);
}

/** Phase of the fundamental over a window, in radians. */
function phaseAt(signal: Float32Array, frequency: number, fromSec: number, toSec: number): number {
  let re = 0;
  let im = 0;
  for (let i = Math.floor(fromSec * RATE); i < Math.floor(toSec * RATE); i++) {
    const angle = (2 * Math.PI * frequency * i) / RATE;
    re += signal[i]! * Math.cos(angle);
    im -= signal[i]! * Math.sin(angle);
  }
  return Math.atan2(im, re);
}

function dry(program: BackingProgram, seconds = program.durationSec): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE));
  renderProgramDry(out, program, 0, RATE);
  return out;
}

describe('registers', () => {
  it('groups notes in half-octave bands that cover the whole range', () => {
    expect(bandFor(12)).toBe(0);
    expect(bandFor(17)).toBe(0);
    expect(bandFor(18)).toBe(1);
    expect(bandFor(0)).toBe(0);
    expect(bandFor(200)).toBe(BAND_COUNT - 1);
    for (let band = 0; band < BAND_COUNT; band++) expect(bandFor(bandLowestMidi(band))).toBe(band);
  });
});

describe('the body of the instrument', () => {
  it('is flat for a voice without one', () => {
    expect(bodyGain(undefined, 440)).toBe(1);
    expect(bodyGain([], 440)).toBe(1);
    expect(shapedSpectrum(VOICES.organ, 2, 5)).toEqual(shapedSpectrum(VOICES.organ, 2, 12));
  });

  it('peaks at its resonances and falls away between them', () => {
    const body = [{ hz: 300, q: 4, gain: 1 }];
    expect(bodyGain(body, 300)).toBeGreaterThan(bodyGain(body, 600));
    expect(bodyGain(body, 300)).toBeGreaterThan(bodyGain(body, 150));
    expect(bodyGain(body, 300)).toBeCloseTo(2, 5);
  });

  it('stays inside a sane range however sharp the resonance', () => {
    const body = [{ hz: 300, q: 40, gain: 20 }, { hz: 300, q: 40, gain: 20 }];
    expect(bodyGain(body, 300)).toBeLessThanOrEqual(2.6);
    expect(bodyGain(body, 5000)).toBeGreaterThanOrEqual(0.4);
  });

  it('makes the same voice a different colour in a different register', () => {
    const low = shapedSpectrum(VOICES.cello, 2, bandFor(38));
    const high = shapedSpectrum(VOICES.cello, 2, bandFor(74));
    const lowRatio = low[2]! / low[0]!;
    const highRatio = high[2]! / high[0]!;
    expect(Math.abs(lowRatio - highRatio)).toBeGreaterThan(0.05);
  });

  it('never changes how many partials a voice has', () => {
    for (const name of Object.keys(VOICES) as InstrumentName[]) {
      for (const band of [0, 7, 15]) {
        expect(shapedSpectrum(VOICES[name], 1, band)).toHaveLength(VOICES[name].harmonics.length);
      }
    }
  });
});

describe('a note that changes over its life', () => {
  it('starts bright and settles dull for a struck or plucked voice', () => {
    for (const name of ['piano', 'guitar', 'pluck', 'mallet', 'bass'] as const) {
      const start = shapedSpectrum(VOICES[name], 2, 6);
      const end = settledSpectrum(VOICES[name], 2, 6);
      const upper = (series: number[]) => series.slice(1).reduce((sum, value) => sum + value, 0) / series[0]!;
      expect(upper(end), name).toBeLessThan(upper(start));
    }
  });

  it('starts with a bite and settles to the steady tone for a bowed voice', () => {
    const start = shapedSpectrum(VOICES.cello, 2, 6);
    const end = settledSpectrum(VOICES.cello, 2, 6);
    expect(start[6]! / start[0]!).toBeGreaterThan(end[6]! / end[0]!);
  });

  it('leaves a voice with no morph exactly as stored', () => {
    expect(settledSpectrum(VOICES.organ, 2, 6)).toEqual(shapedSpectrum(VOICES.organ, 2, 6));
  });

  it('rings its brightness longer on a low note than a high one', () => {
    expect(morphTimeSec(VOICES.piano, 36)).toBeGreaterThan(morphTimeSec(VOICES.piano, 84));
    expect(morphTimeSec(VOICES.organ, 60)).toBe(0);
  });

  it('is fully bright at the attack and gone after enough time constants', () => {
    expect(morphWeight(0.3, 0)).toBe(1);
    expect(morphWeight(0.3, 0.3)).toBeCloseTo(Math.exp(-1), 8);
    expect(morphWeight(0.3, 3)).toBeLessThan(1e-4);
    expect(morphWeight(0, 1)).toBe(0);
  });
});

describe('the scoop and the grain', () => {
  const variation = noteVariation(VOICES.cello, noteSeed(48, 0));

  it('starts below the pitch and settles onto it', () => {
    const first = scoopCents(VOICES.cello, variation, 0);
    expect(first).toBeGreaterThan(0);
    expect(scoopCents(VOICES.cello, variation, 0.02)).toBeLessThan(first);
    expect(scoopCents(VOICES.cello, variation, 0.3)).toBeLessThan(0.05);
    expect(scoopCents(VOICES.cello, variation, -1)).toBe(0);
  });

  it('is left out of voices that cannot slide', () => {
    expect(scoopCents(VOICES.piano, noteVariation(VOICES.piano, 1), 0)).toBe(0);
    expect(scoopCents(VOICES.organ, noteVariation(VOICES.organ, 1), 0)).toBe(0);
  });

  it('fades the texture in and holds it under a bowed note', () => {
    expect(grainAt(VOICES.cello, 0)).toBe(0);
    expect(grainAt(VOICES.cello, 0.03)).toBeGreaterThan(0);
    expect(grainAt(VOICES.cello, 2)).toBeGreaterThan(grainAt(VOICES.cello, 0.03));
    expect(grainAt(VOICES.cello, 2)).toBe(grainAt(VOICES.cello, 5));
    expect(grainAt(VOICES.piano, 1)).toBe(0);
  });

  it('bends the pitch of a rendered bowed note up into place', () => {
    // A cello note has vibrato only after its onset, so the first tenth of a
    // second is the scoop and nothing else. The fundamental's phase advances
    // by exactly 2πf·t at true pitch; early on it advances less.
    const f0 = hz(48);
    const signal = dry(programOf([{ instrument: 'cello', midiNumber: 48, holdSec: 1.5 }], 2), 1);
    const advance = (from: number, to: number) => {
      const step = 0.01;
      let delta = phaseAt(signal, f0, to, to + step) - phaseAt(signal, f0, from, from + step);
      const expected = 2 * Math.PI * f0 * (to - from);
      delta = delta - expected;
      return Math.atan2(Math.sin(delta), Math.cos(delta));
    };
    // Each pair of windows is the same distance apart, so a steady note gives the same drift in both.
    const early = advance(0.02, 0.03);
    const late = advance(0.2, 0.21);
    expect(Math.abs(early - late)).toBeGreaterThan(0.02);
  });
});

describe('every voice renders the same however the song is cut', () => {
  const instruments = Object.keys(VOICES) as InstrumentName[];
  const notes = instruments.map((instrument, index) => ({
    instrument, midiNumber: 40 + index * 3, atSec: 0.1 * index, holdSec: 1.4,
  }));
  const program = programOf(notes, 3);

  it.each([1.234, 0.5, 1.9999])('joins two slices cut at %s s exactly', (cut) => {
    const total = Math.floor(3 * RATE);
    const split = Math.floor(cut * RATE) + 3;
    const whole = new Float32Array(total);
    const first = new Float32Array(split);
    const second = new Float32Array(total - split);
    renderProgramDry(whole, program, 0, RATE);
    renderProgramDry(first, program, 0, RATE);
    renderProgramDry(second, program, split, RATE);
    let worst = 0;
    for (let i = 0; i < total; i++) {
      const sliced = i < split ? first[i]! : second[i - split]!;
      worst = Math.max(worst, Math.abs(whole[i]! - sliced));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('is the same sound every time it is rendered', () => {
    expect(dry(program)).toEqual(dry(program));
  });

  it('produces finite samples for every voice at every end of the range', () => {
    for (const instrument of instruments) {
      for (const midiNumber of [24, 48, 72, 96]) {
        const signal = dry(programOf([{ instrument, midiNumber, holdSec: 0.5 }], 1));
        expect(signal.every(Number.isFinite), `${instrument} ${midiNumber}`).toBe(true);
        expect(Math.max(...signal.map(Math.abs)), `${instrument} ${midiNumber}`).toBeLessThan(2);
      }
    }
  });
});

describe('how a rendered note evolves', () => {
  it('rings a struck note down from bright to dull', () => {
    const midi = 55;
    const f0 = hz(midi);
    const signal = dry(programOf([{ instrument: 'piano', midiNumber: midi, holdSec: 2.5 }], 3), 2.6);
    const ratio = (from: number, to: number) => energyAt(signal, f0 * 5, from, to) / energyAt(signal, f0, from, to);
    expect(ratio(0.02, 0.12)).toBeGreaterThan(ratio(1.4, 1.5) * 1.5);
  });

  it('keeps an organ note the same colour throughout', () => {
    const midi = 55;
    const f0 = hz(midi);
    const signal = dry(programOf([{ instrument: 'organ', midiNumber: midi, holdSec: 2.5 }], 3), 2.6);
    const ratio = (from: number, to: number) => energyAt(signal, f0 * 3, from, to) / energyAt(signal, f0, from, to);
    expect(ratio(0.5, 0.6) / ratio(1.8, 1.9)).toBeCloseTo(1, 1);
  });
});

describe('the room', () => {
  it('lets a note ring on after the dry sound has died away', () => {
    const program = programOf([{ instrument: 'piano', midiNumber: 60, holdSec: 0.3 }], 4);
    const withRoom = new Float32Array(4 * RATE);
    renderProgramInto(withRoom, program, 0, RATE);
    const bare = dry(program, 4);
    const tail = (signal: Float32Array) => {
      let sum = 0;
      for (let i = Math.floor(1.0 * RATE); i < Math.floor(1.3 * RATE); i++) sum += signal[i]! * signal[i]!;
      return Math.sqrt(sum / (0.3 * RATE));
    };
    expect(tail(bare)).toBeLessThan(1e-4);
    expect(tail(withRoom)).toBeGreaterThan(tail(bare));
  });

  it('is the same sound whether the slices share a room or each warms its own', () => {
    // The chords are in the second bar and after, so the seam falls in the middle of a tail.
    const program = programOf([
      { instrument: 'strings', midiNumber: 48, atSec: 0.2, holdSec: 1.5 },
      { instrument: 'piano', midiNumber: 64, atSec: 1.0, holdSec: 1.0 },
      { instrument: 'cello', midiNumber: 55, atSec: 2.2, holdSec: 1.0 },
    ], 4);
    const total = 4 * RATE;
    const split = Math.floor(RATE * 1.9);
    const whole = new Float32Array(total);
    renderProgramInto(whole, program, 0, RATE);

    const alone = [new Float32Array(split), new Float32Array(total - split)];
    renderProgramInto(alone[0]!, program, 0, RATE);
    renderProgramInto(alone[1]!, program, split, RATE);
    let worst = 0;
    for (let i = 0; i < total; i++) worst = Math.max(worst, Math.abs(whole[i]! - (i < split ? alone[0]![i]! : alone[1]![i - split]!)));
    // Each slice re-warms from the audio leading in; what it cannot see is older than the room remembers.
    expect(worst).toBeLessThan(2e-4);
  });

  it('lets a caller carry one room through consecutive slices with nothing lost at the seams', async () => {
    const { Room } = await import('../room');
    const program = programOf([
      { instrument: 'strings', midiNumber: 48, atSec: 0.2, holdSec: 1.5 },
      { instrument: 'piano', midiNumber: 64, atSec: 1.0, holdSec: 1.0 },
    ], 4);
    const total = 4 * RATE;
    const whole = new Float32Array(total);
    renderProgramInto(whole, program, 0, RATE);

    const room = new Room(RATE);
    const slice = 2 * RATE;
    const joined = new Float32Array(total);
    for (let from = 0; from < total; from += slice) {
      const piece = new Float32Array(Math.min(slice, total - from));
      renderProgramInto(piece, program, from, RATE, room);
      joined.set(piece, from);
    }
    // Not bit for bit: a note cut across a slice is rebuilt from its own clock, which differs in the last place.
    let worst = 0;
    for (let i = 0; i < total; i++) worst = Math.max(worst, Math.abs(joined[i]! - whole[i]!));
    expect(worst).toBeLessThan(1e-6);
  });

  it('keeps the bottom end out of the room', async () => {
    const { Room } = await import('../room');
    const tone = (frequency: number) => {
      const room = new Room(RATE);
      room.reset();
      room.position = 0;
      const block = new Float32Array(RATE);
      for (let i = 0; i < 4410; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * frequency * i) / RATE);
      const before = block.slice();
      room.process(block);
      let added = 0;
      let original = 0;
      for (let i = 0; i < block.length; i++) {
        added += (block[i]! - before[i]!) ** 2;
        original += before[i]! ** 2;
      }
      return Math.sqrt(added / original);
    };
    expect(tone(45)).toBeLessThan(tone(900) / 3);
  });

  it('dies away, so the next note is not in the last one\'s tail', async () => {
    const { Room } = await import('../room');
    const room = new Room(RATE);
    room.position = 0;
    const block = new Float32Array(3 * RATE);
    block[100] = 0.5;
    room.process(block);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = Math.floor(from * RATE); i < Math.floor(to * RATE); i++) sum += block[i]! ** 2;
      return Math.sqrt(sum / ((to - from) * RATE));
    };
    expect(rms(0.05, 0.15)).toBeGreaterThan(0);
    expect(rms(1.5, 1.6)).toBeLessThan(rms(0.05, 0.15) / 100);
  });

  it('builds an impulse response for the browser that decays and starts after the predelay', async () => {
    const { createRoomImpulse } = await import('../room');
    const impulse = createRoomImpulse(RATE);
    expect(impulse.every(Number.isFinite)).toBe(true);
    expect(impulse.slice(0, 400).every((value) => value === 0)).toBe(true);
    const level = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += impulse[i]! ** 2;
      return Math.sqrt(sum / (to - from));
    };
    expect(level(2000, 4000)).toBeGreaterThan(level(40000, 42000) * 10);
    expect(impulse).toEqual(createRoomImpulse(RATE));
  });
});
