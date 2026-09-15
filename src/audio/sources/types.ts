/**
 * Microphone capture, abstracted over the two very different ways the two
 * platforms hand over samples.
 *
 * Native gets real PCM from `expo-audio`'s `AudioStream`, which runs on the
 * OS audio thread. Web has no such thing, so it builds its own tap out of an
 * `AudioWorklet`. Both end up calling the same callback with mono float
 * samples, and everything above this line is platform-agnostic.
 */

export type MicStatus =
  | 'idle'
  | 'requesting'
  | 'running'
  | 'denied'
  | 'unavailable'
  | 'error';

export interface MicSource {
  status: MicStatus;
  /** The rate the hardware actually gave us, which is not always what we asked for. */
  sampleRate: number;
  error: string | null;
  /** True when samples are real rather than synthesised. */
  live: boolean;
}

/** Called with mono float samples in [-1, 1] as they arrive. */
export type SampleSink = (samples: Float32Array) => void;

export const TARGET_SAMPLE_RATE = 16000;

/** Mixes interleaved multi-channel PCM down to mono in place-ish. */
export function toMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += interleaved[i * channels + c];
    mono[i] = sum / channels;
  }
  return mono;
}

export function int16ToFloat(data: Int16Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] / 32768;
  return out;
}
