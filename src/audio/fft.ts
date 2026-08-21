/**
 * In-place radix-2 complex FFT with cached twiddle factors.
 *
 * Both the autocorrelation inside the pitch detector and the spectral-flux
 * onset gate need a transform on every hop, so this allocates once per size
 * and is then garbage-free — which matters when it runs on the audio thread.
 */

export class FFT {
  readonly size: number;
  private readonly levels: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.levels = Math.log2(size) | 0;

    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }

    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < this.levels; b++) {
        r = (r << 1) | (x & 1);
        x >>>= 1;
      }
      this.reverse[i] = r;
    }
  }

  /** Forward transform. `re`/`im` are modified in place and must be `size` long. */
  forward(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, false);
  }

  /** Inverse transform, scaled by 1/size so `inverse(forward(x)) === x`. */
  inverse(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, true);
    const n = this.size;
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }

  private transform(re: Float32Array, im: Float32Array, invert: boolean): void {
    const n = this.size;
    const { reverse, cos, sin } = this;

    for (let i = 0; i < n; i++) {
      const j = reverse[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = cos[k];
          const s = invert ? sin[k] : -sin[k];
          const l = j + half;
          const tre = re[l] * c - im[l] * s;
          const tim = re[l] * s + im[l] * c;
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }
}

/**
 * Type-II autocorrelation of `x` — the shrinking-window form the McLeod method
 * needs:
 *
 *     r(τ) = Σ_{j=0}^{W−1−τ} x[j]·x[j+τ]
 *
 * Computed through the Wiener–Khinchin theorem on a zero-padded signal, which
 * keeps the wrap-around out of the result and turns an O(W²) sum into
 * O(W log W). `out` must be at least `maxLag + 1` long.
 */
export function autocorrelate(
  x: Float32Array, windowSize: number, out: Float32Array, maxLag: number, scratch: AcfScratch,
): void {
  const { fft, re, im } = scratch;
  const n = fft.size;

  re.fill(0);
  im.fill(0);
  for (let i = 0; i < windowSize; i++) re[i] = x[i];

  fft.forward(re, im);
  for (let i = 0; i < n; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p;
    im[i] = 0;
  }
  fft.inverse(re, im);

  for (let tau = 0; tau <= maxLag; tau++) out[tau] = re[tau];
}

export interface AcfScratch {
  fft: FFT;
  re: Float32Array;
  im: Float32Array;
}

/** Allocates the transform and buffers for a given analysis window size. */
export function createAcfScratch(windowSize: number): AcfScratch {
  const n = 1 << Math.ceil(Math.log2(windowSize * 2));
  return { fft: new FFT(n), re: new Float32Array(n), im: new Float32Array(n) };
}
