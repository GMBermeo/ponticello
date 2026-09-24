import { useCallback, useEffect, useRef, useState } from 'react';

import {
  brightnessTier, envelopeAt, envelopeHeldLevel, noteSeed, noteVariation,
  spectrumForTier, VOICES,
} from '../voices';
import { BackingProgram, notesActiveAtOffset, ScheduledNote } from './program';
import { BackingPlayer } from './types';

/**
 * Web backing playback — a scheduler, not a buffer.
 *
 * The previous version synthesised the whole loop into an `AudioBuffer` and
 * looped that. Sample-accurate and drift-free, and unusable for the library
 * this app actually ships: the median bundled song is three and a half minutes,
 * which is a 47 MB buffer and a second of blocked main thread to build, so the
 * code refused to render anything over ninety seconds and 229 of 258 songs
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

/**
 * Vibrato, as an LFO on the oscillators' detune.
 *
 * Silent for the whole onset and then faded in, exactly as
 * `vibratoCents` does for the native renderer — a note that arrives already
 * wobbling is the giveaway of a synthesiser. Skipped entirely on a note too
 * short to reach its own onset, which is also what happens in the hand.
 */
function scheduleVibrato(
  audio: AudioContext,
  spec: { vibrato?: { rateHz: number; depthCents: number; onsetMs: number } },
  variation: { vibratoPhase: number; vibratoRateScale: number; vibratoDepthScale: number },
  targets: OscillatorNode[],
  at: number,
  holdSec: number,
  elapsedSec: number,
  extras: (OscillatorNode | AudioBufferSourceNode)[],
): void {
  const vibrato = spec.vibrato;
  if (!vibrato) return;
  const onset = vibrato.onsetMs / 1000;
  if (holdSec < Math.max(VIBRATO_MIN_HOLD_SEC, onset + 0.05)) return;

  const lfo = audio.createOscillator();
  lfo.frequency.value = vibrato.rateHz * variation.vibratoRateScale;
  const depth = audio.createGain();
  const cents = vibrato.depthCents * variation.vibratoDepthScale;

  // Swell in over one onset, from wherever a resumed note already is.
  const startsAt = at + Math.max(0, onset - elapsedSec);
  const already = Math.max(0, Math.min(1, (elapsedSec - onset) / Math.max(1e-6, onset)));
  depth.gain.setValueAtTime(cents * already, at);
  depth.gain.linearRampToValueAtTime(cents, startsAt + onset);

  lfo.connect(depth);
  for (const target of targets) depth.connect(target.detune);
  lfo.start(at);
  lfo.stop(at + holdSec + 1);
  extras.push(lfo);
}

/**
 * The scrape before the string speaks, on its own short envelope.
 *
 * Gated on length because it is an articulation, not a texture: a run of
 * semiquavers would otherwise become a wash of noise.
 */
function scheduleBowNoise(
  audio: AudioContext,
  spec: { bowNoise?: number; attackMs: number },
  destination: GainNode,
  peak: number,
  at: number,
  holdSec: number,
  elapsedSec: number,
  noiseFor: (audio: AudioContext) => AudioBuffer,
  extras: (OscillatorNode | AudioBufferSourceNode)[],
): void {
  const amount = spec.bowNoise ?? 0;
  if (amount <= 0 || holdSec < BOW_NOISE_MIN_HOLD_SEC) return;
  // A resumed note is long past its own attack; there is no scrape left.
  if (elapsedSec > 0.02) return;

  const span = Math.max(0.02, (spec.attackMs / 1000) * 1.8);
  const source = audio.createBufferSource();
  source.buffer = noiseFor(audio);
  source.loop = true;

  const shaper = audio.createGain();
  const g = shaper.gain;
  g.setValueAtTime(0, at);
  // Three points is enough for a rise and a fall the ear reads as a scrape.
  g.linearRampToValueAtTime(peak * amount, at + span * 0.18);
  g.linearRampToValueAtTime(peak * amount * 0.25, at + span * 0.5);
  g.linearRampToValueAtTime(0, at + span);

  shaper.connect(destination);
  source.connect(shaper);
  source.start(at);
  source.stop(at + span + 0.02);
  extras.push(source);
}

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
  /** Vibrato LFO, the detuned second copy, the attack scrape — when present. */
  extras?: (OscillatorNode | AudioBufferSourceNode)[];
}

/**
 * Expression is bought with nodes, so it is spent only where it is heard.
 *
 * A dense arrangement can put four hundred notes inside one lookahead window;
 * giving every one of them a vibrato LFO and a noise source would quadruple
 * the graph for notes far too short to show any of it. These are the lengths
 * below which each effect is inaudible anyway.
 */
const VIBRATO_MIN_HOLD_SEC = 0.3;
const UNISON_MIN_HOLD_SEC = 0.2;
const BOW_NOISE_MIN_HOLD_SEC = 0.12;

/** An ADSR envelope in seconds, for a note already `elapsed` seconds in. */
interface EnvelopeTiming {
  peak: number;
  attack: number;
  decay: number;
  sustain: number;
  hold: number;
  release: number;
  elapsed: number;
}

/**
 * Expresses the same stateless ADSR used by native PCM as Web Audio ramps.
 * For a resumed long note, it begins at envelope(elapsed) and schedules only
 * the remaining phase endpoints, so a drone does not disappear until wrap.
 */
function scheduleEnvelope(gain: AudioParam, envelope: EnvelopeTiming, at: number): void {
  const { peak, attack, decay, sustain, hold, release, elapsed } = envelope;
  gain.setValueAtTime(peak * envelopeAt(elapsed, attack, decay, sustain, hold, release), at);
  if (elapsed >= hold) {
    gain.linearRampToValueAtTime(0, at + hold + release - elapsed);
    return;
  }
  if (elapsed < attack && attack < hold) gain.linearRampToValueAtTime(peak, at + attack - elapsed);
  const decayEnd = attack + decay;
  if (elapsed < decayEnd && decayEnd < hold) gain.linearRampToValueAtTime(peak * sustain, at + decayEnd - elapsed);
  const holdEnd = at + hold - elapsed;
  gain.linearRampToValueAtTime(peak * envelopeHeldLevel(hold, attack, decay, sustain), holdEnd);
  gain.linearRampToValueAtTime(0, holdEnd + release);
}

export function useBackingPlayer(enabled: boolean): BackingPlayer {
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const programRef = useRef<BackingProgram | null>(null);
  const volumeRef = useRef(0.8);

  /**
   * Cached `PeriodicWave` per instrument *and brightness tier* — building one
   * per note is wasteful, and a voice needs one spectrum per dynamic so that
   * playing harder opens the tone rather than only raising it.
   */
  const wavesRef = useRef<Map<string, PeriodicWave>>(new Map());
  /** Cached noise buffer for the percussion voice. */
  const noiseRef = useRef<AudioBuffer | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playGenerationRef = useRef(0);
  const voicesRef = useRef<Voice[]>([]);
  /**
   * The audio-clock time at which loop position zero occurs for the current
   * pass. Advanced by one loop length each time the cursor wraps, so the
   * schedule is a single monotonic timeline and a repeat is not a special case.
   */
  const cycleOriginRef = useRef(0);
  /** Index into `program.notes` of the next note to schedule. */
  const cursorRef = useRef(0);
  /** Audio-clock time of the first scheduled sound; NaN when stopped. */
  const startsAtRef = useRef(Number.NaN);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
    if (!contextRef.current) {
      const created = new AudioContext();
      const master = created.createGain();
      const safety = created.createDynamicsCompressor();
      master.gain.value = volumeRef.current;
      safety.threshold.value = -3;
      safety.knee.value = 3;
      safety.ratio.value = 12;
      safety.attack.value = 0.002;
      safety.release.value = 0.12;
      master.connect(safety);
      safety.connect(created.destination);
      contextRef.current = created;
      masterRef.current = master;
    }
    return contextRef.current;
  }, []);

  /** The band-limited wave for an instrument at one dynamic, built once. */
  const waveFor = useCallback((
    audio: AudioContext, instrument: string, tier: number,
  ): PeriodicWave => {
    const key = `${instrument}@${tier}`;
    const cached = wavesRef.current.get(key);
    if (cached) return cached;
    const harmonics = spectrumForTier(VOICES[instrument as never], tier);
    // Index 0 of a PeriodicWave is DC and must stay zero; harmonic n lives at
    // index n. Sine phase means the whole series goes in the imaginary part.
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    for (let h = 0; h < harmonics.length; h++) imag[h + 1] = harmonics[h]!;
    const wave = audio.createPeriodicWave(real, imag, { disableNormalization: false });
    wavesRef.current.set(key, wave);
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
      for (const extra of voice.extras ?? []) {
        try { extra.stop(); } catch { /* already ended */ }
        try { extra.disconnect(); } catch { /* gone */ }
      }
      try { voice.osc.disconnect(); voice.gain.disconnect(); } catch { /* gone */ }
    }
    voicesRef.current = [];
  }, []);

  /** Schedules one note at an absolute audio-clock time. */
  const scheduleNote = useCallback((
    audio: AudioContext, note: ScheduledNote, at: number, elapsedSec = 0,
  ) => {
    const master = masterRef.current;
    if (!master) return;

    const spec = VOICES[note.instrument];
    // The same per-note wander the native renderer applies, from the same seed,
    // so a song does not change character when it changes platform.
    const seed = noteSeed(note.midiNumber, Math.round(note.atSec * 1000));
    const variation = noteVariation(spec, seed);

    const peak = note.amplitude * spec.gain * variation.velocityScale;
    if (peak <= 0.0004) return;

    const attack = Math.max(0.001, (spec.attackMs / 1000) * variation.attackScale);
    const decay = Math.max(0.001, spec.decayMs / 1000);
    const release = Math.max(0.01, spec.releaseMs / 1000);
    const hold = Math.max(0.01, note.holdSec);
    const elapsed = Math.max(0, elapsedSec);
    if (elapsed >= hold + release) return;

    const gain = audio.createGain();
    gain.connect(master);

    scheduleEnvelope(gain.gain, { peak, attack, decay, sustain: spec.sustain, hold, release, elapsed }, at);

    const remaining = hold + release - elapsed;
    const extras: (OscillatorNode | AudioBufferSourceNode)[] = [];

    let source: OscillatorNode | AudioBufferSourceNode;
    if (spec.noise) {
      const noise = audio.createBufferSource();
      noise.buffer = noiseFor(audio);
      noise.loop = true;
      source = noise;
    } else {
      // 440 · 2^((m−69)/12), inline rather than imported: `midiToFrequency`
      // lives in the domain layer and this is the audio thread's hot path.
      const hz = 440 * Math.pow(2, (note.midiNumber - 69) / 12);
      const wave = waveFor(audio, note.instrument, brightnessTier(note.velocity * variation.velocityScale));

      const osc = audio.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.setValueAtTime(hz, at);
      osc.detune.setValueAtTime(variation.detuneCents, at);
      source = osc;

      // A section rather than a soloist: a second copy a few cents away, half
      // level each. The beating between them is the sound of more than one
      // player, and it cannot be faked with a chorus on the master.
      const unison = spec.unisonCents ?? 0;
      if (unison > 0 && hold >= UNISON_MIN_HOLD_SEC) {
        const twin = audio.createOscillator();
        twin.setPeriodicWave(wave);
        twin.frequency.setValueAtTime(hz, at);
        twin.detune.setValueAtTime(variation.detuneCents - unison, at);
        osc.detune.setValueAtTime(variation.detuneCents + unison, at);
        const half = audio.createGain();
        half.gain.setValueAtTime(0.5, at);
        half.connect(gain);
        twin.connect(half);
        twin.start(at);
        twin.stop(at + remaining + 0.02);
        extras.push(twin);
        // The first copy drops to half too, or the pair is twice as loud.
        const firstHalf = audio.createGain();
        firstHalf.gain.setValueAtTime(0.5, at);
        firstHalf.connect(gain);
        osc.connect(firstHalf);
        osc.start(at);
        osc.stop(at + remaining + 0.02);
        scheduleVibrato(audio, spec, variation, [osc, twin], at, hold, elapsed, extras);
        scheduleBowNoise(audio, spec, gain, peak, at, hold, elapsed, noiseFor, extras);
        registerVoice(at + remaining + 0.05, osc, gain, extras);
        return;
      }

      scheduleVibrato(audio, spec, variation, [osc], at, hold, elapsed, extras);
      scheduleBowNoise(audio, spec, gain, peak, at, hold, elapsed, noiseFor, extras);
    }

    source.connect(gain);
    source.start(at);
    source.stop(at + remaining + 0.02);
    registerVoice(at + remaining + 0.05, source, gain, extras);

    function registerVoice(
      endsAt: number, node: OscillatorNode | AudioBufferSourceNode,
      output: GainNode, held: (OscillatorNode | AudioBufferSourceNode)[],
    ) {
      const voice: Voice = { endsAt, osc: node, gain: output, extras: held };
      node.onended = () => {
        try { node.disconnect(); output.disconnect(); } catch { /* already gone */ }
        for (const extra of held) {
          try { extra.stop(); } catch { /* already ended */ }
          try { extra.disconnect(); } catch { /* gone */ }
        }
        const index = voicesRef.current.indexOf(voice);
        if (index >= 0) voicesRef.current.splice(index, 1);
      };
      voicesRef.current.push(voice);
    }
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
    playGenerationRef.current++;
    startsAtRef.current = Number.NaN;
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    silence();
  }, [silence]);

  const positionSeconds = useCallback((): number | null => {
    const audio = contextRef.current;
    const program = programRef.current;
    if (!audio || !program || program.durationSec <= 0 || timerRef.current === null) return null;
    // What is reaching the speaker now was scheduled `outputLatency` ago.
    const heard = audio.currentTime - (audio.outputLatency || audio.baseLatency || 0);
    if (Number.isNaN(heard) || heard < startsAtRef.current) return null;
    const duration = program.durationSec;
    // The scheduler advances the cycle origin up to a lookahead early, so the
    // raw difference can be negative near the loop point; the modulo folds it.
    return (((heard - cycleOriginRef.current) % duration) + duration) % duration;
  }, []);

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

  const play = useCallback((
    offsetSeconds = 0,
    onStarted?: (delaySeconds?: number) => void,
  ) => {
    const audio = context();
    const program = programRef.current;
    if (!audio || !program || program.durationSec <= 0) return;

    stop();
    const generation = playGenerationRef.current;

    const schedule = () => {
      if (playGenerationRef.current !== generation || programRef.current !== program) return;

      const duration = program.durationSec;
      const offset = ((offsetSeconds % duration) + duration) % duration;
      // Position zero of this pass sits `offset` seconds in the past. The small
      // lead gives Web Audio time to accept the first nodes; the playhead
      // receives that same lead and counts it down on the UI thread.
      const startsAt = audio.currentTime + START_DELAY_SEC;
      cycleOriginRef.current = startsAt - offset;
      startsAtRef.current = startsAt;

      // Restore notes whose onset is behind the playhead but whose hold/release
      // still overlaps it. This is essential for a loop-length drone: without
      // it, resuming anywhere after zero is silent until the next wrap.
      for (const active of notesActiveAtOffset(program, offset).slice(0, MAX_PER_TICK)) {
        scheduleNote(audio, active.note, startsAt, active.elapsedSec);
      }

      // Start the cursor at the first future onset; overlapping notes above are
      // intentionally excluded so they are not scheduled twice.
      let index = 0;
      while (index < program.notes.length && program.notes[index].atSec < offset) index++;
      cursorRef.current = index;

      tick();
      timerRef.current = setInterval(tick, TICK_MS);
      onStarted?.(START_DELAY_SEC);
    };

    // Browsers suspend the context until a gesture. Do not announce playback
    // until resume has completed, or the visual transport can run over silence.
    if (audio.state === 'suspended') {
      audio.resume().then(schedule).catch((cause) => {
        if (playGenerationRef.current !== generation) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    } else {
      schedule();
    }
  }, [context, scheduleNote, stop, tick]);

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
  return { load, play, stop, setVolume, positionSeconds, ready, progress: 1, error };
}
