import { File } from 'expo-file-system';

import { PickedMidi } from './pickMidi';

/**
 * Native file picker.
 *
 * `expo-file-system` ships its own document picker, so no extra dependency is
 * needed. The MIME filter is deliberately wide: Android reports MIDI under
 * several types and plenty of files arrive as `application/octet-stream`, so
 * the parser is left to reject anything that is not really a MIDI file.
 */
export async function pickMidi(): Promise<PickedMidi | null> {
  try {
    const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
    if (picked.canceled || !picked.result) return null;

    const file = picked.result;
    const buffer = await file.arrayBuffer();
    return { name: file.name, bytes: new Uint8Array(buffer) };
  } catch {
    // Some platforms reject rather than returning `canceled`; either way the
    // player simply did not choose a file.
    return null;
  }
}
