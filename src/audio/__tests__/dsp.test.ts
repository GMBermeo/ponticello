import { describe, expect, it } from 'vitest';

import { Decimator, RingBuffer } from '../decimate';
import { autocorrelate, createAcfScratch, FFT } from '../fft';
import { McLeodPitchDetector } from '../mpm';
import { CentsSmoother, PitchEngine } from '../PitchEngine';
import { bowedCello, centsError, harmonics, mix, noise, sawtooth, sine } from './synth';

const FS = 48000;

describe('FFT', () => {
  it('round-trips a signal through forward and inverse', () => {
    const fft = new FFT(256);
    const re = new Float32Array(256);
    const im = new Float32Array(256);
    const original = sawtooth(440, FS, 256);
    re.set(original);

    fft.forward(re, im);
    fft.inverse(re, im);

    for (let i = 0; i < 256; i++) expect(re[i]).toBeCloseTo(original[i], 4);
  });

  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(300)).toThrow(/power of two/);
  });

  it('matches a direct O(W^2) autocorrelation', () => {
    const w = 256;
    const x = mix(sawtooth(220, FS, w), noise(w, 0.02));
    const maxLag = 120;

    const fast = new Float32Array(maxLag + 1);
    autocorrelate(x, w, fast, maxLag, createAcfScratch(w));

    for (let tau = 0; tau <= maxLag; tau++) {
      let slow = 0;
      for (let j = 0; j < w - tau; j++) slow += x[j] * x[j + tau];
      // Relative tolerance: the FFT path accumulates float32 rounding.
      expect(Math.abs(fast[tau] - slow)).toBeLessThan(Math.abs(slow) * 1e-3 + 1e-3);
    }
  });
});

describe('McLeodPitchDetector', () => {
  const detector = new McLeodPitchDetector({
    sampleRate: FS, windowSize: 1024, minFrequency: 60, maxFrequency: 1200,
  });

  it.each([
    ['A3 open', 220.0],
    ['D4', 293.66],
    ['A4', 440.0],
    ['A5', 880.0],
  ])('locks a sine within 2 cents: %s', (_label, frequency) => {
    const result = detector.detect(sine(frequency, FS, 1024));
    expect(result.voiced).toBe(true);
    expect(Math.abs(centsError(result.frequency, frequency))).toBeLessThan(2);
  });

  it.each([
    ['D3 open', 146.83],
    ['G3', 196.0],
    ['A4', 440.0],
  ])('locks a sawtooth within 2 cents: %s', (_label, frequency) => {
    const result = detector.detect(sawtooth(frequency, FS, 1024));
    expect(result.voiced).toBe(true);
    expect(Math.abs(centsError(result.frequency, frequency))).toBeLessThan(2);
  });

  it('finds the fundamental when it is missing entirely', () => {
    // Harmonics 2, 3, 4, 5 of C2 with the fundamental deleted — the case that
    // makes spectral peak-picking report C3 instead.
    const wide = new McLeodPitchDetector({
      sampleRate: FS, windowSize: 2048, minFrequency: 60, maxFrequency: 1000,
    });
    const signal = harmonics(65.406, FS, 2048, [0, 0.5, 0.33, 0.25, 0.2]);

    const result = wide.detect(signal);

    expect(result.voiced).toBe(true);
    expect(Math.abs(centsError(result.frequency, 65.406))).toBeLessThan(5);
  });

  it('reports silence as unvoiced', () => {
    expect(detector.detect(new Float32Array(1024)).voiced).toBe(false);
  });

  it('rejects broadband noise', () => {
    expect(detector.detect(noise(1024, 0.4, 7)).voiced).toBe(false);
  });

  it('refuses a window too short for the requested low note', () => {
    expect(() => new McLeodPitchDetector({
      sampleRate: FS, windowSize: 256, minFrequency: 65, maxFrequency: 1000,
    })).toThrow(/cannot resolve/);
  });
});

describe('Decimator', () => {
  it('produces one sample in four', () => {
    const decimator = new Decimator(FS, 4);
    const out = new Float32Array(512);
    expect(decimator.process(sine(200, FS, 1024), 1024, out)).toBe(256);
    expect(decimator.outputSampleRate).toBe(12000);
  });

  it('passes the low band and rejects content near the new Nyquist', () => {
    const rms = (signal: Float32Array, count: number) => {
      const decimator = new Decimator(FS, 4);
      const out = new Float32Array(count / 4);
      const n = decimator.process(signal, count, out);
      // Skip the filter's settling transient.
      let sum = 0;
      for (let i = 64; i < n; i++) sum += out[i] * out[i];
      return Math.sqrt(sum / (n - 64));
    };

    const low = rms(sine(100, FS, 4096, 0.5), 4096);
    const high = rms(sine(6000, FS, 4096, 0.5), 4096);

    expect(low).toBeGreaterThan(0.3);
    expect(20 * Math.log10(high / low)).toBeLessThan(-55);
  });
});

describe('RingBuffer', () => {
  it('reads the most recent samples in order across a wrap', () => {
    const ring = new RingBuffer(8);
    ring.write(Float32Array.from([1, 2, 3, 4, 5, 6]));
    ring.write(Float32Array.from([7, 8, 9, 10]));

    const out = new Float32Array(4);
    expect(ring.readLatest(out, 4)).toBe(true);
    expect(Array.from(out)).toEqual([7, 8, 9, 10]);
    expect(ring.written).toBe(10);
  });

  it('refuses to read more than it has been given', () => {
    const ring = new RingBuffer(8);
    ring.write(Float32Array.from([1, 2]));
    expect(ring.readLatest(new Float32Array(4), 4)).toBe(false);
  });
});

describe('PitchEngine', () => {
  /** Streams a signal through the engine in realistic 128-sample blocks. */
  function run(signal: Float32Array, engine = new PitchEngine({ sampleRate: FS, useOnsetGate: false })) {
    const block = 128;
    for (let i = 0; i + block <= signal.length; i += block) {
      engine.push(signal.subarray(i, i + block), block);
    }
    return engine.read();
  }

  it.each([
    ['C2 open — IV string', 65.41, 'low'],
    ['G2 open — III string', 98.0, 'low'],
    ['D3 open — II string', 146.83, 'low'],
    ['A3 open — I string', 220.0, undefined],
    ['D4', 293.66, 'high'],
    ['A4 — thumb position', 440.0, 'high'],
    ['A5 — top of the range', 880.0, 'high'],
  ])('tracks %s within 5 cents', (_label, frequency, band) => {
    const frame = run(bowedCello(frequency, FS, FS));

    expect(frame.voiced).toBe(true);
    expect(Math.abs(centsError(frame.frequency, frequency))).toBeLessThan(5);
    if (band) expect(frame.band).toBe(band);
  });

  it('does not report C3 for a C2 with a weak fundamental', () => {
    // The specific octave error this architecture exists to prevent.
    const frame = run(bowedCello(65.406, FS, FS));
    expect(frame.frequency).toBeGreaterThan(60);
    expect(frame.frequency).toBeLessThan(72);
  });

  it('survives a noisy room', () => {
    const frame = run(mix(bowedCello(146.83, FS, FS, 0.4), noise(FS, 0.02, 13)));
    expect(frame.voiced).toBe(true);
    expect(Math.abs(centsError(frame.frequency, 146.83))).toBeLessThan(10);
  });

  it('goes unvoiced on silence', () => {
    const engine = new PitchEngine({ sampleRate: FS, useOnsetGate: false });
    run(bowedCello(220, FS, FS / 2), engine);
    expect(engine.read().voiced).toBe(true);

    run(new Float32Array(FS / 2), engine);
    expect(engine.read().voiced).toBe(false);
  });

  it('holds the previous reading through a bow attack', () => {
    const engine = new PitchEngine({ sampleRate: FS, useOnsetGate: true });
    run(bowedCello(220, FS, FS / 2), engine);
    const before = engine.read();
    expect(before.voiced).toBe(true);

    // A sudden broadband scratch: the flux gate should freeze rather than
    // publish whatever the detector makes of it.
    run(noise(2048, 0.6, 99), engine);
    const during = engine.read();
    expect(during.held || !during.voiced).toBe(true);
    if (during.held) expect(during.frequency).toBeCloseTo(before.frequency, 1);
  });

  it('resets to a clean slate', () => {
    const engine = new PitchEngine({ sampleRate: FS, useOnsetGate: false });
    run(bowedCello(220, FS, FS / 2), engine);
    engine.reset();
    expect(engine.read().voiced).toBe(false);
    expect(engine.read().frequency).toBe(0);
  });
});

describe('CentsSmoother', () => {
  it('converges on a steady value', () => {
    const smoother = new CentsSmoother(90);
    let value = 0;
    for (let i = 0; i < 60; i++) value = smoother.push(20, 10);
    expect(value).toBeCloseTo(20, 1);
  });

  it('damps a single-frame spike', () => {
    const smoother = new CentsSmoother(90);
    for (let i = 0; i < 40; i++) smoother.push(0, 10);
    expect(smoother.push(40, 10)).toBeLessThan(10);
  });

  it('snaps rather than glides when the note changes', () => {
    const smoother = new CentsSmoother(90);
    for (let i = 0; i < 40; i++) smoother.push(0, 10);
    expect(smoother.push(-350, 10)).toBe(-350);
  });
});
