import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';

import { MicSource, MicStatus, SampleSink, TARGET_SAMPLE_RATE, toMono } from './types';

/**
 * Native microphone tap.
 *
 * `expo-audio`'s `AudioStream` hands over real PCM straight from the platform
 * audio unit — AVAudioEngine on iOS, AAudio on Android — so the pitch engine
 * gets the same float samples it gets on the web, without a bespoke native
 * module in between.
 *
 * Buffers arrive as an `ArrayBuffer` on the JS thread. That is a bridge hop
 * the original architecture wanted to avoid with a JSI TurboModule, and it is
 * the right thing to revisit if profiling ever shows it mattering — but the
 * analysis window is 10–43 ms wide, which dwarfs the hop, so it does not
 * dominate the latency budget today.
 */

interface Outcome {
  status: MicStatus;
  error: string | null;
}

/**
 * Only the resolved outcome is stored. "Idle" is a fact about `enabled` and
 * "requesting" is the absence of an answer, so both are derived — which keeps
 * every setState in this file inside an async continuation rather than
 * synchronously inside an effect, where it would cascade a render.
 */
const PENDING: Outcome = { status: 'requesting', error: null };

export function useMicSource(onSamples: SampleSink, enabled: boolean): MicSource {
  const [permission, setPermission] = useState<Outcome>(PENDING);
  const [streaming, setStreaming] = useState<Outcome | null>(null);

  const sink = useRef(onSamples);
  // Written in an effect, not during render: a ref mutated mid-render is a
  // correctness error under React Compiler, and one stale audio block is
  // harmless.
  useEffect(() => { sink.current = onSamples; });

  const { stream } = useAudioStream({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => {
      const samples = new Float32Array(buffer.data);
      sink.current(buffer.channels > 1 ? toMono(samples, buffer.channels) : samples);
    },
  });

  const granted = permission.status !== 'denied' && permission.status !== 'error'
    && permission.status !== 'requesting';

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    requestRecordingPermissionsAsync()
      .then((response) => {
        if (cancelled) return;
        setPermission(response.granted
          ? { status: 'running', error: null }
          : {
            status: 'denied',
            error: 'Microphone access was refused. Grant it in system settings to hear the cello.',
          });
      })
      .catch((cause) => {
        if (cancelled) return;
        setPermission({
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !granted || !stream) return;
    let cancelled = false;

    stream.start()
      .then(() => { if (!cancelled) setStreaming({ status: 'running', error: null }); })
      .catch((cause) => {
        if (cancelled) return;
        setStreaming({
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      cancelled = true;
      try {
        stream.stop();
      } catch {
        // Already torn down by the platform; nothing useful to do about it.
      }
    };
  }, [enabled, granted, stream]);

  const resolved = permission.status === 'denied' || permission.status === 'error'
    ? permission
    : (streaming ?? PENDING);
  const status: MicStatus = enabled ? resolved.status : 'idle';

  return {
    status,
    sampleRate: stream?.sampleRate ?? TARGET_SAMPLE_RATE,
    error: enabled ? resolved.error : null,
    live: status === 'running',
  };
}
