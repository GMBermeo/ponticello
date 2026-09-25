import { useEffect, useMemo, useRef } from 'react';

import {
  detectSongKey, fingerboardMarkers, songPlayedNotes, type CelloSongScore, type DetectedKey,
  type FingerboardMarker,
} from '@domain';
import { usePracticeActions, type NoteOverlayMode } from '@state';

import type { Playhead } from './usePlayhead';

/** How often the audio's own position is compared with the picture. */
const AUDIO_LOCK_MS = 250;
/** The fingerboard panel draws 440 mm, which is 19 semitones above the nut. */
const OVERLAY_MAX_SEMITONES = 19;
const MAX_SYNC_SAMPLES = 2400;

/** Keeps the transport hook's contract when the route id is unknown. */
export const EMPTY_SCORE: CelloSongScore = {
  schemaVersion: '1.0.0',
  id: 'empty',
  metadata: {
    title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
    bpm: 60, difficulty: 'Beginner', tonic: 'C', teaches: '', rights: '',
  },
  measures: [],
  notes: [],
};

/**
 * Credits time to the practice log while the transport is actually running.
 *
 * Only while it *runs*: a screen left open on the play view for an hour with
 * nothing sounding is not an hour of practice, and a log that claimed it was
 * would be worth nothing to look at. The tally is flushed on every pause and
 * on unmount, so leaving the screen mid-phrase still counts.
 */
export function usePracticeClock(playing: boolean): void {
  const { log } = usePracticeActions();
  const startedAt = useRef<number | null>(null);
  const startedOn = useRef<Date | null>(null);

  useEffect(() => {
    if (!playing) return;
    startedAt.current = Date.now();
    startedOn.current = new Date();
    return () => {
      const from = startedAt.current;
      const on = startedOn.current;
      startedAt.current = null;
      startedOn.current = null;
      if (from !== null) log(Date.now() - from, on ?? undefined);
    };
  }, [playing, log]);
}

/**
 * Keeps the picture on the audio.
 *
 * Four times a second, while music is sounding, the adapter's own position is
 * handed to the playhead, which eases its anchor onto it. The audio clock is
 * the reference because it is the one the player hears; see
 * `domain/transportClock.ts` for the policy.
 */
export function useAudioLock(
  playhead: Pick<Playhead, 'syncToAudio' | 'scoreTimeMs'>,
  audioScoreTimeMs: () => number | null,
  active: boolean,
): void {
  const { syncToAudio, scoreTimeMs } = playhead;
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => {
      const audioMs = audioScoreTimeMs();
      if (audioMs === null) return;
      if (__DEV__) recordSync(scoreTimeMs(), audioMs);
      syncToAudio(audioMs);
    }, AUDIO_LOCK_MS);
    return () => clearInterval(handle);
  }, [active, audioScoreTimeMs, scoreTimeMs, syncToAudio]);
}

type SyncTelemetry = { samples: number[]; last: number };

/**
 * Development-only sync telemetry, readable from a debugger as
 * `globalThis.__ponticelloSync`. It is how playback is verified in a browser:
 * the error between what is drawn and what is heard, sampled as the lock runs.
 */
function recordSync(visualMs: number, audioMs: number): void {
  const store = globalThis as { __ponticelloSync?: SyncTelemetry };
  const sync = store.__ponticelloSync ?? { samples: [], last: 0 };
  sync.last = audioMs - visualMs;
  sync.samples.push(sync.last);
  if (sync.samples.length > MAX_SYNC_SAMPLES) sync.samples.shift();
  store.__ponticelloSync = sync;
}

export type NoteOverlay = { songKey: DetectedKey | null; markers: FingerboardMarker[] | undefined };

/**
 * Faint fingerboard overlay markers. `key` shows the whole detected key to
 * improvise in; `song` shows only the pitch classes the piece actually uses.
 * Capped to match the 440 mm the panel draws, and recomputed only when the
 * score or mode changes — never per frame.
 */
export function useNoteOverlay(score: CelloSongScore | null | undefined, mode: NoteOverlayMode): NoteOverlay {
  const songKey = useMemo(() => (score ? detectSongKey(score) : null), [score]);
  const markers = useMemo(() => {
    if (!score || !songKey || mode === 'off') return undefined;
    const preferFlats = score.metadata.preferFlats ?? songKey.name.includes('♭');
    if (mode === 'song') return songPlayedNotes(score, { tonic: songKey.tonic, preferFlats });
    return fingerboardMarkers(songKey.scale, { maxSemitones: OVERLAY_MAX_SEMITONES, tonic: songKey.tonic, preferFlats });
  }, [mode, score, songKey]);
  return { songKey, markers };
}
