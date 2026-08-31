import { useCallback, useEffect, useRef, useState } from 'react';

import { harmonicsOf } from '../synth';
import { VOICES } from '../voices';
import { BackingProgram, ScheduledNote } from './program';
import { BackingPlayer } from './types';

/**
 * Web backing playback — a scheduler, not a buffer.
 *
 * The previous version synthesised the whole loop into an `AudioBuffer` and
 * looped that. Sample-accurate and drift-free, and unusable for the library
 * this app actually ships: the median bundled song is three and a half minutes,
 * which is a 47 MB buffer and a second of blocked main thread to build, so the
 * code refused to render anything over ninety seconds and 219 of 258 songs
 * played in silence.
 *
 * A scheduler has none of that cost. Notes are handed to Web Audio a couple of
 * seconds before they sound, as an oscillator on a `PeriodicWave` built from
 * the same harmonic series the native renderer uses, with the envelope drawn on
 * a gain node. Memory is bounded by the lookahead rather than by the song, the
 * first note sounds immediately, and there is no length limit at all.
 *
 * Drift, which the buffer approach existed to avoid, is handled by scheduling
 * against `AudioContext.currentTime` — the audio clock, not a JS timer. The
 * timer only decides *when to think about scheduling*; every note's actual
 * start time is an absolute audio-clock value, so a late tick schedules the
 * same notes at the same instants.
 */

/** How far ahead of the audio clock notes are scheduled. */
const LOOKAHEAD_SEC = 1.6;
/** How often the scheduler wakes up. Comfortably inside the lookahead. */
const TICK_MS = 320;
/** Delay between `play()` and the first note, to cover the first tick. */
const START_DELAY_SEC = 0.06;

/**
 * Ceiling on notes scheduled in one tick.
 *
 * A dense arrangement can put a hundred notes inside a 1.6-second window, and
 * `les-miserables-theme` has 12 691 of them across fifteen parts. Web Audio
 * copes with the nodes; what it does not cope with is the whole song being
 * scheduled at once if a bug ever lets the cursor run away. This is the guard
 * rail, not a musical decision, and it is high enough never to be reached by
 * real music.
 */
const MAX_PER_TICK = 400;

interface Voice {
  /** Absolute audio-clock time this voice is finished and can be forgotten. */
  endsAt: number;
  osc: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
}

export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const programRef = useRef<BackingProgram | null>(null);
  const volumeRef = useRef(0.8);

  /** Cached `PeriodicWave` per instrument — building one per note is wasteful. */
  const wavesRef = useRef<Map<string, PeriodicWave>>(new Map());
  /** Cached noise buffer for the percussion voice. */
  const noiseRef = useRef<AudioBuffer | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voicesRef = useRef<Voice[]>([]);
  /**
   * The audio-clock time at which loop position zero occurs for the current
   * pass. Advanced by one loop length each time the cursor wraps, so the
   * schedule is a single monotonic timeline and a repeat is not a special case.
   */
  const cycleOriginRef = useRef(0);
  /** Index into `program.notes` of the next note to schedule. */
  const cursorRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
    if (!contextRef.current) {
      const created = new AudioContext();
      const master = created.createGain();
      master.gain.value = volumeRef.current;
      master.connect(created.destination);
      contextRef.current = created;
      masterRef.current = master;
    }
    return contextRef.current;
  }, []);

  /** The band-limited wave for an instrument, built once. */
  const waveFor = useCallback((audio: AudioContext, instrument: string): PeriodicWave => {
    const cached = wavesRef.current.get(instrument);
    if (cached) return cached;
    const harmonics = harmonicsOf(instrument as never);
    // Index 0 of a PeriodicWave is DC and must stay zero; harmonic n lives at
    // index n. Sine phase means the whole series goes in the imaginary part.
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    for (let h = 0; h < harmonics.length; h++) imag[h + 1] = harmonics[h];
    const wave = audio.createPeriodicWave(real, imag, { disableNormalization: false });
    wavesRef.current.set(instrument, wave);
    return wave;
  }, []);

  const noiseFor = useCallback((audio: AudioContext): AudioBuffer => {
    if (noiseRef.current) return noiseRef.current;
    const length = Math.floor(audio.sampleRate * 0.5);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const channel = buffer.getChannelData(0);
    // Deterministic, so a percussion hit sounds the same every pass.
    let state = 22222;
    for (let i = 0; i < length; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      channel[i] = (state / 0x80000000) - 1;
    }
    noiseRef.current = buffer;
    return buffer;
  }, []);

  /** Releases every sounding voice immediately. */
  const silence = useCallback(() => {
    for (const voice of voicesRef.current) {
      try {
        voice.gain.gain.cancelScheduledValues(0);
        voice.osc.stop();
      } catch {
        // Already ended — nodes are single-use and may have stopped on their own.
      }
      try { voice.osc.disconnect(); voice.gain.disconnect(); } catch { /* gone */ }
    }
    voicesRef.current = [];
  }, []);

  /** Schedules one note at an absolute audio-clock time. */
  const scheduleNote = useCallback((
    audio: AudioContext, note: ScheduledNote, at: number,
  ) => {
    const master = masterRef.current;
    if (!master) return;

    const spec = VOICES[note.instrument];
    const peak = note.amplitude * spec.gain;
    if (peak <= 0.0004) return;

    const attack = Math.max(0.001, spec.attackMs / 1000);
    const decay = Math.max(0.001, spec.decayMs / 1000);
    const release = Math.max(0.01, spec.releaseMs / 1000);
    const hold = Math.max(0.01, note.holdSec);

    const gain = audio.createGain();
    gain.connect(master);

    // The same ADSR the native renderer draws, expressed as automation. Ramps
    // rather than steps throughout: a step on a gain node is a click.
    const g = gain.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(peak, at + Math.min(attack, hold));
    if (hold > attack) {
      g.linearRampToValueAtTime(peak * spec.sustain, at + Math.min(attack + decay, hold));
    }
    g.setValueAtTime(hold > attack ? peak * spec.sustain : peak, at + hold);
    g.linearRampToValueAtTime(0, at + hold + release);

    let source: OscillatorNode | AudioBufferSourceNode;
    if (spec.noise) {
      const noise = audio.createBufferSource();
      noise.buffer = noiseFor(audio);
      noise.loop = true;
      source = noise;
    } else {
      const osc = audio.createOscillator();
      osc.setPeriodicWave(waveFor(audio, note.instrument));
      // 440 · 2^((m−69)/12), inline rather than imported: `midiToFrequency`
      // lives in the domain layer and this is the audio thread's hot path.
      osc.frequency.setValueAtTime(440 * Math.pow(2, (note.midiNumber - 69) / 12), at);
      source = osc;
    }

    source.connect(gain);
    source.start(at);
    source.stop(at + hold + release + 0.02);

    const voice: Voice = { endsAt: at + hold + release + 0.05, osc: source, gain };
    source.onended = () => {
      try { source.disconnect(); gain.disconnect(); } catch { /* already gone */ }
      const index = voicesRef.current.indexOf(voice);
      if (index >= 0) voicesRef.current.splice(index, 1);
    };
    voicesRef.current.push(voice);
  }, [noiseFor, waveFor]);

  /**
   * One scheduling pass: push every note that falls inside the lookahead.
   *
   * The cursor walks the sorted note list and wraps at the end, advancing the
   * cycle origin by one loop length — so an eight-bar loop repeating for twenty
   * minutes is the same code path as the first pass, with no seek and no
   * accumulated error, because every start time is derived from an origin that
   * moves in exact loop lengths.
   */
  const tick = useCallback(() => {
    const audio = contextRef.current;
    const program = programRef.current;
    if (!audio || !program || program.durationSec <= 0 || program.notes.length === 0) return;

    const horizon = audio.currentTime + LOOKAHEAD_SEC;
    let scheduled = 0;

    while (scheduled < MAX_PER_TICK) {
      if (cursorRef.current >= program.notes.length) {
        cursorRef.current = 0;
        cycleOriginRef.current += program.durationSec;
        continue;
      }
      const note = program.notes[cursorRef.current];
      const at = cycleOriginRef.current + note.atSec;
      if (at > horizon) break;

      // A note whose start has already gone past is skipped rather than fired
      // late: firing it would put it audibly after the playhead, which is worse
      // than a missing note nobody was waiting for.
      if (at > audio.currentTime) scheduleNote(audio, note, at);
      cursorRef.current++;
      scheduled++;
    }
  }, [scheduleNote]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    silence();
  }, [silence]);

  const load = useCallback(async (program: BackingProgram) => {
    const audio = context();
    if (!audio) {
      setError('This browser does not support Web Audio.');
      return;
    }
    // Identical music must not restart the audio. The steppers fire on every
    // tap and a restart mid-phrase is the most audible thing this file can do.
    if (programRef.current?.key === program.key) return;

    stop();
    programRef.current = program;
    setReady(program.notes.length > 0 && program.durationSec > 0);
    setError(null);
  }, [context, stop]);

  const play = useCallback((offsetSeconds = 0) => {
    const audio = context();
    const program = programRef.current;
    if (!audio || !program || program.durationSec <= 0) return;

    // Browsers suspend the context until a gesture; `play` is always reached
    // from one, so this is the right place to resume.
    if (audio.state === 'suspended') audio.resume().catch(() => {});

    stop();

    const duration = program.durationSec;
    const offset = ((offsetSeconds % duration) + duration) % duration;
    // Position zero of this pass sits `offset` seconds in the past, so a note
    // due at `offset` lands now — which is how the accompaniment starts under
    // the playhead rather than at the top of the loop.
    cycleOriginRef.current = audio.currentTime + START_DELAY_SEC - offset;

    // Start the cursor at the first note not already behind us.
    let index = 0;
    while (index < program.notes.length && program.notes[index].atSec < offset) index++;
    cursorRef.current = index;

    tick();
    timerRef.current = setInterval(tick, TICK_MS);
  }, [context, stop, tick]);

  const setVolume = useCallback((volume: number) => {
    volumeRef.current = volume;
    if (masterRef.current) masterRef.current.gain.value = volume;
  }, []);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => {
    stop();
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, [stop]);

  // Nothing to prepare, so preparation is always finished.
  return { load, play, stop, setVolume, ready, progress: 1, error };
}
