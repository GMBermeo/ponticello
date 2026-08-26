/**
 * Base64 without `Buffer` or `btoa`, neither of which is reliably present in a
 * React Native runtime. Used for writing rendered audio to disk and for
 * keeping imported MIDI files in settings storage.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63]
      + ALPHABET[(triple >> 6) & 63] + ALPHABET[triple & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63]
      + ALPHABET[(chunk >> 6) & 63] + '=';
  }

  return out;
}

export function fromBase64(text: string): Uint8Array {
  // Ignore anything outside the alphabet — padding, newlines, data-URI prefixes.
  const clean: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const value = LOOKUP[text.charCodeAt(i)];
    if (value >= 0) clean.push(value);
  }

  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let out = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const chunk = (clean[i] << 18) | (clean[i + 1] << 12)
      | ((clean[i + 2] ?? 0) << 6) | (clean[i + 3] ?? 0);
    if (out < bytes.length) bytes[out++] = (chunk >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 255;
    if (out < bytes.length) bytes[out++] = chunk & 255;
  }

  return bytes;
}
