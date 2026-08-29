import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { encodeWav } from '../wav';
import { BackingPlayer } from './types';

/**
 * Native backing playback.
 *
 * `expo-audio` plays files, not sample buffers, so the rendered accompaniment
 * is written to the cache as a WAV and played from there with `loop` set. The
 * file is rewritten under alternating names: replacing a URI the player is
 * currently holding open is unreliable on Android, and two names are enough to
 * guarantee the incoming file is never the one being released.
 *
 * Every operation here is serialised behind a generation counter. Loading is
 * asynchronous — a file write and a player construction — and two loads that
 * overlap used to leave two `AudioPlayer`s alive, both looping, because the
 * second one replaced the ref before the first had finished building. Every
 * repeat of that piled another voice on top, which is exactly what "the backing
 * plays over itself in layers" was. A player built for a generation that has
 * already been superseded is now released instead of installed.
 */
const CACHE_DIRECTORY = 'backing';

export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const playerRef = useRef<AudioPlayer | null>(null);
  const slotRef = useRef(0);
  const volumeRef = useRef(0.8);
  /**
   * Two counters, because loading and starting invalidate different things.
   * A `stop()` must cancel a seek without throwing away a render that is still
   * being written to disk, and a new render must not be cancelled by the play
   * that happens to arrive while it is in flight.
   */
  const loadGenerationRef = useRef(0);
  const playGenerationRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Practising happens with the phone on a stand and the mic already open, so
  // the accompaniment must not duck when recording starts, and must keep
  // playing when the screen locks.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: false,
    }).catch(() => {});
  }, []);

  /** Tears down one player. Never throws — a released player is the goal. */
  const dispose = useCallback((player: AudioPlayer | null) => {
    if (!player) return;
    try {
      player.pause();
    } catch {
      // Already stopped by the platform.
    }
    try {
      player.remove();
    } catch {
      // Already released; nothing useful to do about it.
    }
  }, []);

  const release = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    dispose(player);
  }, [dispose]);

  const load = useCallback(async (samples: Float32Array, sampleRate: number) => {
    const generation = ++loadGenerationRef.current;
    // Whatever was playing belongs to the outgoing buffer.
    playGenerationRef.current++;

    // Silence the outgoing loop before spending time on the new one. Doing it
    // first costs a short gap and removes any window in which the old audio and
    // the new audio are both alive.
    release();
    setReady(false);

    try {
      const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
      if (!directory.exists) directory.create({ intermediates: true });

      slotRef.current = slotRef.current === 0 ? 1 : 0;
      const file = new File(directory, `backing-${slotRef.current}.wav`);
      if (file.exists) file.delete();
      file.create();
      file.write(encodeWav(samples, sampleRate));

      // Nothing above is instantaneous. If a newer load started while this one
      // was writing, this player must never reach the ref.
      if (loadGenerationRef.current !== generation) return;

      const player = createAudioPlayer({ uri: file.uri });
      player.loop = true;
      player.volume = volumeRef.current;

      if (loadGenerationRef.current !== generation) {
        dispose(player);
        return;
      }

      playerRef.current = player;
      setReady(true);
      setError(null);
    } catch (cause) {
      if (loadGenerationRef.current !== generation) return;
      setReady(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [release, dispose]);

  /**
   * Starts the loop at `offsetSeconds`.
   *
   * The seek has to land before playback starts or the buffer begins at zero
   * regardless, which is the drift this offset exists to remove — so `play` is
   * chained onto it rather than fired alongside. The generation is re-checked
   * after the await: a stop that arrives mid-seek must win, otherwise pausing
   * during the seek window silently starts the audio a moment later.
   */
  const play = useCallback((offsetSeconds = 0) => {
    const player = playerRef.current;
    if (!player) return;

    const generation = ++playGenerationRef.current;
    const offset = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;

    const begin = () => {
      if (playGenerationRef.current !== generation || playerRef.current !== player) return;
      try {
        player.play();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    try {
      player.seekTo(offset).then(begin, begin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const stop = useCallback(() => {
    // Invalidate any seek still in flight, so it cannot start playback after
    // the transport has been paused.
    playGenerationRef.current++;
    try {
      playerRef.current?.pause();
    } catch {
      // Player already gone.
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (playerRef.current) playerRef.current.volume = volume;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => release, [release]);

  return { load, play, stop, setVolume, ready, error };
}
