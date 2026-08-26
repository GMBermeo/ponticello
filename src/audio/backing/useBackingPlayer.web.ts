import { useCallback, useEffect, useRef, useState } from 'react';

import { BackingPlayer } from './types';

/**
 * Web backing playback.
 *
 * An `AudioBufferSourceNode` with `loop = true` repeats the buffer without a
 * scheduler and without a gap, which is exactly what a practice loop wants —
 * no seek, no drift, no click at the loop point. Source nodes are single-use,
 * so each `play()` builds a fresh one from the same buffer.
 */
export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const volumeRef = useRef(0.8);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
    if (!contextRef.current) {
      const created = new AudioContext();
      const gain = created.createGain();
      gain.gain.value = volumeRef.current;
      gain.connect(created.destination);
      contextRef.current = created;
      gainRef.current = gain;
    }
    return contextRef.current;
  }, []);

  const stop = useCallback(() => {
    if (!sourceRef.current) return;
    try {
      sourceRef.current.stop();
    } catch {
      // Already stopped — the node is single-use and may have ended on its own.
    }
    sourceRef.current.disconnect();
    sourceRef.current = null;
  }, []);

  const load = useCallback(async (samples: Float32Array, sampleRate: number) => {
    const audio = context();
    if (!audio) {
      setError('This browser does not support Web Audio.');
      return;
    }
    stop();
    try {
      const buffer = audio.createBuffer(1, Math.max(1, samples.length), sampleRate);
      // `set` rather than `copyToChannel`: the latter's typing insists on a
      // Float32Array backed by a plain ArrayBuffer, which ours need not be.
      buffer.getChannelData(0).set(samples);
      bufferRef.current = buffer;
      setReady(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [context, stop]);

  const play = useCallback(() => {
    const audio = context();
    const buffer = bufferRef.current;
    if (!audio || !buffer || !gainRef.current) return;

    // Browsers suspend the context until a gesture; play() is always reached
    // from one, so this is the right place to resume.
    if (audio.state === 'suspended') audio.resume().catch(() => {});

    stop();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainRef.current);
    source.start();
    sourceRef.current = source;
  }, [context, stop]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => {
    stop();
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, [stop]);

  return { load, play, stop, setVolume, ready, error };
}
