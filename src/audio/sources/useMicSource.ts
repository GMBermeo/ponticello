import { MicSource, SampleSink, TARGET_SAMPLE_RATE } from './types';

/**
 * Type anchor and last-resort fallback for the platform-specific microphone
 * taps.
 *
 * Metro resolves `useMicSource.native.ts` on iOS and Android and
 * `useMicSource.web.ts` in a browser, so this file is never the one that runs.
 * It exists because TypeScript does not follow those platform extensions, and
 * because a build target nobody anticipated should degrade to "no microphone"
 * rather than fail to resolve.
 */
export function useMicSource(_onSamples: SampleSink, _enabled: boolean): MicSource {
  return {
    status: 'unavailable',
    sampleRate: TARGET_SAMPLE_RATE,
    error: 'No microphone tap is available on this platform.',
    live: false,
  };
}
