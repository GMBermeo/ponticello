/**
 * Backing playback, abstracted over two very different audio stacks.
 *
 * Both adapters take a `BackingProgram` — a flat list of notes in real seconds
 * — and neither takes samples any more. That change is the fix for "most songs
 * play no backing": handing over a rendered buffer meant somebody had to
 * synthesise the entire loop before a note could sound, which cost 47 MB and a
 * blocked JS thread on a long song, so the old code simply refused anything
 * over ninety seconds. 229 of the 258 bundled songs are longer than that.
 *
 * With a program instead, each platform can do the cheapest thing it is
 * capable of. Web schedules Web Audio voices in a rolling window and never
 * renders anything. Native still has to produce a file — `expo-audio` plays
 * files, not note events — but it renders it in slices with the event loop
 * running between them, so the length of the song costs patience rather than
 * dropped frames.
 */

import { BackingProgram } from './program';

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
  /**
   * Replaces the current music. Safe to call repeatedly.
   *
   * An adapter that is handed a program whose `key` matches the one it already
   * holds must do nothing at all — the loop and tempo steppers fire on every
   * tap and reloading identical music is audible.
   */
  load: (program: BackingProgram) => Promise<void>;
  /**
   * Starts the loop, optionally part way in.
   *
   * `offsetSeconds` is where in the buffer to begin, and it is what keeps the
   * accompaniment under the playhead: press play three bars into the loop and
   * the audio has to start three bars in as well. Both adapters wrap the offset
   * into the buffer, so a caller never has to bounds-check it. `onStarted`
   * fires once platform playback is accepted/scheduled. Web reports its small
   * remaining audio-clock lead so the visual transport can count down on the
   * UI thread; native calls it after seek with zero delay.
   */
  play: (offsetSeconds?: number, onStarted?: (delaySeconds?: number) => void) => void;
  stop: () => void;
  /** 0–1. */
  setVolume: (volume: number) => void;
  /** True once audio is loaded and playable. */
  ready: boolean;
  /**
   * 0–1 while a program is being prepared, 1 when it is playable.
   *
   * Web is always 1: there is nothing to prepare. Native reports its render
   * progress here so an eleven-minute song shows a bar rather than looking
   * broken for ten seconds.
   */
  progress: number;
  error: string | null;
}

export const NO_PLAYER: BackingPlayer = {
  load: async () => {},
  play: () => {},
  stop: () => {},
  setVolume: () => {},
  ready: false,
  progress: 0,
  error: null,
};
