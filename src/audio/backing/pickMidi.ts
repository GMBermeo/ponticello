/** A MIDI file the player chose from their device. */
export interface PickedMidi {
  name: string;
  bytes: Uint8Array;
}

/**
 * Type anchor and fallback. Metro resolves the `.native` and `.web` variants;
 * this one only runs on a target neither covers, where there is no picker.
 */
export async function pickMidi(): Promise<PickedMidi | null> {
  return null;
}
