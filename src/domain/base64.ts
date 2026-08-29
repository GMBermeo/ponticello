/**
 * Base64 without `Buffer` or `btoa`, neither of which is reliably present in a
 * React Native runtime. Used for writing rendered audio to disk and for
 * keeping imported MIDI files in settings storage.
 */

/** Six bits to a character. The index is always masked to 0-63 by the caller. */
const symbol = (sixBits: number): string => ALPHABET[sixBits & 63] ?? 'A';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  /** One byte, or zero past the end — the tail cases read beyond deliberately. */
  const at = (index: number): number => bytes[index] ?? 0;

  let out = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const triple = (at(i) << 16) | (at(i + 1) << 8) | at(i + 2);
    out += symbol(triple >> 18) + symbol(triple >> 12)
      + symbol(triple >> 6) + symbol(triple);
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = at(i) << 16;
    out += symbol(chunk >> 18) + symbol(chunk >> 12) + '==';
  } else if (remaining === 2) {
    const chunk = (at(i) << 16) | (at(i + 1) << 8);
    out += symbol(chunk >> 18) + symbol(chunk >> 12)
      + symbol(chunk >> 6) + '=';
  }

  return out;
}

export function fromBase64(text: string): Uint8Array {
  // Ignore anything outside the alphabet — padding, newlines, data-URI prefixes.
  const clean: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const value = LOOKUP[text.charCodeAt(i)] ?? -1;
    if (value >= 0) clean.push(value);
  }

  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const chunk = ((clean[i] ?? 0) << 18) | ((clean[i + 1] ?? 0) << 12)
      | ((clean[i + 2] ?? 0) << 6) | (clean[i + 3] ?? 0);
    if (out < bytes.length) bytes[out++] = (chunk >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 255;
    if (out < bytes.length) bytes[out++] = chunk & 255;
  }

  return bytes;
}
