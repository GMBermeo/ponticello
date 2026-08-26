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
 */
const CACHE_DIRECTORY = 'backing';

export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const playerRef = useRef<AudioPlayer | null>(null);
  const slotRef = useRef(0);
  const volumeRef = useRef(0.8);

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

  const release = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.pause();
      player.remove();
    } catch {
      // Already released by the platform; nothing useful to do about it.
    }
  }, []);

  const load = useCallback(async (samples: Float32Array, sampleRate: number) => {
    try {
      const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
      if (!directory.exists) directory.create({ intermediates: true });

      slotRef.current = slotRef.current === 0 ? 1 : 0;
      const file = new File(directory, `backing-${slotRef.current}.wav`);
      if (file.exists) file.delete();
      file.create();
      file.write(encodeWav(samples, sampleRate));

      release();
      const player = createAudioPlayer({ uri: file.uri });
      player.loop = true;
      player.volume = volumeRef.current;
      playerRef.current = player;

      setReady(true);
      setError(null);
    } catch (cause) {
      setReady(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [release]);

  const play = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      // Always from the top: the buffer is exactly the practice loop, so its
      // start is the loop start and that is where the playhead will be.
      player.seekTo(0).catch(() => {});
      player.play();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const stop = useCallback(() => {
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
