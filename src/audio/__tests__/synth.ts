/**
 * Signal generators used by the DSP tests.
 *
 * The important one is `bowedCello`, which reproduces the acoustic trap this
 * whole engine exists for: a Helmholtz sawtooth passed through a body
 * response that barely radiates below ~100 Hz, so the fundamental of a low
 * note is quieter than its own harmonics.
 */

export function sine(frequency: number, sampleRate: number, length: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

/**
 * Band-limited sawtooth — the velocity profile of a string in Helmholtz
 * stick–slip motion, which is what a bow actually produces.
 */
export function sawtooth(
  frequency: number, sampleRate: number, length: number, amplitude = 0.5,
): Float32Array {
  const out = new Float32Array(length);
  const partials = Math.floor(sampleRate / 2 / frequency);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let n = 1; n <= partials; n++) {
      sum += (((-1) ** (n + 1)) / n) * Math.sin((2 * Math.PI * n * frequency * i) / sampleRate);
    }
    out[i] = amplitude * sum * (2 / Math.PI);
  }
  return out;
}

/** Sum of explicitly weighted harmonics, so a test can delete one. */
export function harmonics(
  frequency: number, sampleRate: number, length: number, weights: number[],
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let n = 0; n < weights.length; n++) {
      if (weights[n] === 0) continue;
      sum += weights[n] * Math.sin((2 * Math.PI * (n + 1) * frequency * i) / sampleRate);
    }
    out[i] = sum;
  }
  return out;
}

/**
 * A sawtooth shaped by a crude cello body response: strong air/wood resonances
 * between 90 and 400 Hz, steep loss below them. On a C2 this leaves the
 * fundamental roughly 15 dB down on the second harmonic.
 */
export function bowedCello(
  frequency: number, sampleRate: number, length: number, amplitude = 0.5,
): Float32Array {
  const partials = Math.min(24, Math.floor(sampleRate / 2 / frequency));
  const weights: number[] = [];
  for (let n = 1; n <= partials; n++) {
    const f = n * frequency;
    // Body radiation: nothing much escapes below the main air resonance.
    const bodyGain = 1 / (1 + Math.pow(100 / f, 4));
    weights.push((((-1) ** (n + 1)) / n) * bodyGain);
  }
  const raw = harmonics(frequency, sampleRate, length, weights);
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const scale = peak > 0 ? amplitude / peak : 1;
  for (let i = 0; i < length; i++) raw[i] *= scale;
  return raw;
}

export function noise(length: number, amplitude = 0.05, seed = 1): Float32Array {
  const out = new Float32Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = ((state / 0xffffffff) * 2 - 1) * amplitude;
  }
  return out;
}

export function mix(...signals: Float32Array[]): Float32Array {
  const length = Math.max(...signals.map((s) => s.length));
  const out = new Float32Array(length);
  for (const s of signals) for (let i = 0; i < s.length; i++) out[i] += s[i];
  return out;
}

/** Cents between two frequencies — duplicated here so tests do not lean on the code under test. */
export function centsError(detected: number, expected: number): number {
  return 1200 * Math.log2(detected / expected);
}
