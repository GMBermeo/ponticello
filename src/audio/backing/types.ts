/**
 * Backing playback, abstracted over two very different audio stacks.
 *
 * Web can play a sample buffer directly and loop it sample-accurately. Native
 * has no such API — `expo-audio` plays files — so the same buffer is encoded
 * as a WAV, written to the cache, and handed over as a URI. Both end up
 * looping the same audio; nothing above this line needs to know which.
 */

export type ListenMode = 'off' | 'backing' | 'solo' | 'both';

export const LISTEN_LABEL: Record<ListenMode, string> = {
  off: 'Off',
  backing: 'Backing',
  solo: 'Cello',
  both: 'Both',
};

export const LISTEN_BLURB: Record<ListenMode, string> = {
  off: 'Silence. You are the only thing making sound.',
  backing: 'Everything except the cello line — play the solo over the top.',
  solo: 'The written cello part on its own, so you can hear what you are aiming at.',
  both: 'The whole thing, cello included. Useful for learning a piece, less so for testing yourself.',
};

export interface BackingPlayer {
  /** Replaces the current audio. Safe to call repeatedly. */
  load: (samples: Float32Array, sampleRate: number) => Promise<void>;
  play: () => void;
  stop: () => void;
  /** 0–1. */
  setVolume: (volume: number) => void;
  /** True once audio is loaded and playable. */
  ready: boolean;
  error: string | null;
}

export const NO_PLAYER: BackingPlayer = {
  load: async () => {},
  play: () => {},
  stop: () => {},
  setVolume: () => {},
  ready: false,
  error: null,
};
