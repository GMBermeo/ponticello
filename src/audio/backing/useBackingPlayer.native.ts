import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { renderProgramInto } from '../synth';
import { encodeWavInto, wavByteLength, writeWavHeader } from '../wav';
import { BackingProgram } from './program';
import { BackingPlayer } from './types';

/**
 * Native backing playback.
 *
 * `expo-audio` plays files, not note events, so this side still has to produce
 * audio — but it no longer does it in one blocking call. The program is
 * synthesised two seconds at a time straight into the WAV's byte array, with
 * the event loop running between slices, so an eleven-minute song costs a
 * progress bar instead of ten seconds of frozen UI. That freeze is why the old
 * code capped the loop at ninety seconds and why most of the library played
 * nothing at all.
 *
 * Two things are unchanged because they were right. The file is written under
 * alternating names, since replacing a URI the player is holding open is
 * unreliable on Android and two names guarantee the incoming file is never the
 * one being released. And every operation is serialised behind generation
 * counters: loading is asynchronous, and two overlapping loads used to leave
 * two `AudioPlayer`s alive and both looping, which is what "the backing plays
 * over itself in layers" was.
 */
const CACHE_DIRECTORY = 'backing';

/**
 * Sample rate for the rendered file.
 *
 * An accompaniment is a reference, not the recording. 22.05 kHz halves both the
 * render time and the file, and the top octave it gives up is above anything a
 * cello accompaniment puts there.
 */
const SAMPLE_RATE = 22050;

/**
 * Seconds of audio per slice.
 *
 * Two seconds is about 2 ms of synthesis on a laptop and 20 ms on a mid-range
 * phone — one dropped frame per slice at worst, and only while preparing,
 * never during playback. Larger slices amortise the loop overhead but start to
 * be felt as a stutter in the UI; smaller ones spend more time in the event
 * loop than in the synthesiser.
 */
const SLICE_SEC = 2;

/** Yields to the event loop so the UI can paint between slices. */
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const playerRef = useRef<AudioPlayer | null>(null);
  const slotRef = useRef(0);
  const volumeRef = useRef(0.8);
  const keyRef = useRef<string | null>(null);
  const durationRef = useRef(0);
  /**
   * Two counters, because loading and starting invalidate different things.
   * A `stop()` must cancel a seek without throwing away a render that is still
   * being written, and a new render must not be cancelled by the play that
   * happens to arrive while it is in flight.
   */
  const loadGenerationRef = useRef(0);
  const playGenerationRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Practising happens with the phone on a stand, so the accompaniment must not
  // duck when the microphone opens.
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
    try { player.pause(); } catch { /* already stopped by the platform */ }
    try { player.remove(); } catch { /* already released */ }
  }, []);

  const release = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    dispose(player);
  }, [dispose]);

  const load = useCallback(async (program: BackingProgram) => {
    // Identical music must not be re-rendered. The loop and tempo steppers fire
    // on every tap, and re-rendering is both slow and audible.
    if (keyRef.current === program.key && playerRef.current) return;

    const generation = ++loadGenerationRef.current;
    // Whatever is playing belongs to the outgoing program.
    playGenerationRef.current++;

    release();
    keyRef.current = program.key;
    durationRef.current = Math.max(0, program.durationSec);
    setReady(false);

    if (program.notes.length === 0 || program.durationSec <= 0) {
      setProgress(1);
      return;
    }

    setProgress(0);

    try {
      const totalSamples = Math.max(1, Math.ceil(program.durationSec * SAMPLE_RATE));
      const bytes = new Uint8Array(wavByteLength(totalSamples));
      writeWavHeader(bytes, totalSamples, SAMPLE_RATE);

      const sliceSamples = SLICE_SEC * SAMPLE_RATE;
      const slice = new Float32Array(sliceSamples);

      for (let from = 0; from < totalSamples; from += sliceSamples) {
        const length = Math.min(sliceSamples, totalSamples - from);
        const view = length === sliceSamples ? slice : slice.subarray(0, length);

        renderProgramInto(view, program, from, SAMPLE_RATE);
        // Fade the very first and very last few milliseconds, or the loop point
        // clicks on every repeat.
        if (from === 0) fadeIn(view, SAMPLE_RATE);
        if (from + length >= totalSamples) fadeOut(view, SAMPLE_RATE);
        encodeWavInto(bytes, view, from);

        // Abandon a superseded render rather than finish it: the loop may have
        // moved three times while this one was halfway through.
        if (loadGenerationRef.current !== generation) return;
        setProgress(Math.min(0.99, (from + length) / totalSamples));
        await yieldToLoop();
        if (loadGenerationRef.current !== generation) return;
      }

      const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
      if (!directory.exists) directory.create({ intermediates: true });

      slotRef.current = slotRef.current === 0 ? 1 : 0;
      const file = new File(directory, `backing-${slotRef.current}.wav`);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);

      if (loadGenerationRef.current !== generation) return;

      const player = createAudioPlayer({ uri: file.uri });
      player.loop = true;
      player.volume = volumeRef.current;

      if (loadGenerationRef.current !== generation) {
        dispose(player);
        return;
      }

      playerRef.current = player;
      setProgress(1);
      setReady(true);
      setError(null);
    } catch (cause) {
      if (loadGenerationRef.current !== generation) return;
      setReady(false);
      setProgress(1);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [release, dispose]);

  /**
   * Starts the loop at `offsetSeconds`.
   *
   * The seek has to land before playback starts or the file begins at zero
   * regardless, which is the drift the offset exists to remove — so `play` is
   * chained onto the seek rather than fired alongside it. The generation is
   * re-checked afterwards: a stop that arrives mid-seek must win, or pausing
   * during the seek window silently starts the audio a moment later.
   */
  const play = useCallback((
    offsetSeconds = 0,
    onStarted?: (delaySeconds?: number) => void,
  ) => {
    const player = playerRef.current;
    if (!player) return;

    const generation = ++playGenerationRef.current;
    const duration = durationRef.current;
    const requested = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
    const offset = duration > 0 ? requested % duration : 0;

    const begin = () => {
      if (playGenerationRef.current !== generation || playerRef.current !== player) return;
      try {
        player.play();
        onStarted?.(0);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    try {
      player.seekTo(offset).then(begin, (cause) => {
        if (playGenerationRef.current !== generation || playerRef.current !== player) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const stop = useCallback(() => {
    // Invalidate any seek still in flight, so it cannot start playback after
    // the transport has been paused.
    playGenerationRef.current++;
    try { playerRef.current?.pause(); } catch { /* player already gone */ }
  }, []);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (playerRef.current) playerRef.current.volume = volume;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => {
    loadGenerationRef.current++;
    playGenerationRef.current++;
    release();
  }, [release]);

  return { load, play, stop, setVolume, ready, progress, error };
}

/** Fade lengths are in samples; 8 ms is short enough to be inaudible as a fade. */
const FADE_MS = 8;

function fadeIn(buffer: Float32Array, sampleRate: number): void {
  const fade = Math.min(Math.floor((FADE_MS / 1000) * sampleRate), buffer.length);
  for (let i = 0; i < fade; i++) buffer[i] *= i / fade;
}

function fadeOut(buffer: Float32Array, sampleRate: number): void {
  const fade = Math.min(Math.floor((FADE_MS / 1000) * sampleRate), buffer.length);
  for (let i = 0; i < fade; i++) buffer[buffer.length - 1 - i] *= i / fade;
}
