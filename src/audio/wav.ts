/**
 * WAV encoding.
 *
 * Native playback goes through `expo-audio`, which takes a file or a URI rather
 * than a sample buffer, so a rendered accompaniment has to be written out as
 * audio before it can be heard. 16-bit PCM is the least interesting format that
 * every platform will definitely open.
 *
 * Encoding is split into a header write and repeated slice writes so the native
 * player can synthesise a long song piece by piece — allocating the output
 * bytes once and filling them two seconds at a time — instead of holding the
 * whole thing as floats first. On an eleven-minute song that is the difference
 * between 24 MB and 71 MB, and between a responsive UI and a frozen one.
 *
 * Web does not use any of this: there the notes are scheduled as Web Audio
 * voices and nothing is ever rendered.
 */

const HEADER_BYTES = 44;

/** Bytes a mono 16-bit WAV of `sampleCount` samples occupies, header included. */
export function wavByteLength(sampleCount: number): number {
  return HEADER_BYTES + sampleCount * 2;
}

/** Writes the 44-byte RIFF header for a mono 16-bit file of `sampleCount`. */
export function writeWavHeader(
  bytes: Uint8Array, sampleCount: number, sampleRate: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  const dataBytes = sampleCount * 2;
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // format: uncompressed PCM
  view.setUint16(22, 1, true);       // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
}

/**
 * Writes one slice of samples into an already-headered file.
 *
 * `atSample` is where in the *file* the slice starts, so consecutive calls with
 * consecutive offsets fill the data chunk in order.
 */
export function encodeWavInto(
  bytes: Uint8Array, samples: Float32Array, atSample: number,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample above 1.0 would wrap to a loud negative
    // spike rather than merely distorting.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + (atSample + i) * 2, Math.round(clamped * 32767), true);
  }
}

/** Encodes a mono float buffer as a complete 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  const dataBytes = samples.length * 2;
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // format: uncompressed PCM
  view.setUint16(22, 1, true);       // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling: a sample above 1.0 would wrap to a loud negative
    // spike rather than merely distorting.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 32767), true);
  }

  return bytes;
}
