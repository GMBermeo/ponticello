import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListenChip } from '@/components/play/ListenControl';
import { trackChoiceSummary } from '@/components/play/TrackPicker';
import { Highway } from '@/components/play/Highway';
import { ScorePage } from '@/components/play/ScorePage';
import { TabVision } from '@/components/play/TabVision';
import { TunerStrip } from '@/components/play/TunerStrip';
import { Playhead, usePlayhead } from '@/components/play/usePlayhead';
import { useMeasuredSize } from '@/components/useMeasuredSize';
import { Label, Row, Rule, Title } from '@/components/ui/primitives';
import { usePitch } from '@/audio/usePitch';
import { useBacking } from '@/audio/useBacking';
import { calculateFretboardMaxMm } from '@/domain/cello';
import { detectSongKey, fingerboardMarkers, songPlayedNotes } from '@/domain/key';
import { practiceLoop } from '@/domain/loop';
import { usePiece } from '@/state/usePiece';
import { useSession } from '@/state/session';
import {
  useAudioPreferences,
  useSettingsSelector,
  useTapeSettings,
  useTrackChoice,
  useVisionPreferences,
} from '@/state/settings';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { PlayTopBar } from '@/components/play/PlayTopBar';
import { PlayControlBar } from '@/components/play/PlayControlBar';
import { PlayFingerboardColumn } from '@/components/play/PlayFingerboardColumn';

const KEEP_AWAKE_TAG = 'ponticello-play';

/**
 * Columns of the play layout, in design units.
 *
 * Two sets, because the screen has to work held either way up. Landscape has
 * room for the fingerboard panel at a size you can read at arm's length;
 * portrait — an unfolded Fold held vertically, or any phone — has to buy that
 * width back from somewhere, and the panel is the right place to buy it from
 * because the vision in the middle is the thing being read.
 */
const FINGERBOARD_WIDTH = 152;
const FINGERBOARD_WIDTH_TALL = 104;
const STATUS_BAR = 36;

/** How often the audio's own position is compared with the picture. */
const AUDIO_LOCK_MS = 250;

export default function PlayRoute() {
  const chrome = useSettingsSelector((s) => s.chrome);
  return (
    <ThemeProvider chrome={chrome}>
      <PlayScreen />
    </ThemeProvider>
  );
}

/**
 * Play screen.
 *
 * The fingerboard panel on the left and the status strip along the bottom
 * never move, whichever vision is showing. The microphone is a tuner and only a
 * tuner: it listens while the transport is paused, across the top of the play
 * area, and switches off the moment you press play.
 *
 * Nothing on this component changes while the music runs. The note and bar
 * are subscribed to by the leaves that draw them (see `usePlayheadPosition`),
 * so a note change re-renders a badge and a label rather than this whole tree.
 */
function PlayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const choice = useTrackChoice(id);
  const { listenMode, accompaniment, backingVolume } = useAudioPreferences();
  const { vision, showFingerings, showTapes, highwayAxis, tabAxis } = useVisionPreferences();
  const { tapeSets } = useTapeSettings();
  const noteOverlayMode = useSettingsSelector((s) => s.noteOverlay);
  const { setup } = useSession();

  const [visionSize, onVisionLayout, visionRef] = useMeasuredSize();

  // Practising is the one activity where the screen must not dim: the player's
  // hands are busy and nothing is touching the glass for minutes at a time.
  // Skipped on web, where the Screen Wake Lock API throws if the tab is not
  // visible and focused — a failure that is not worth surfacing to the player.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, []);

  // The layout adapts to either orientation rather than forcing one: an
  // unfolded Fold is a tall screen that people hold vertically.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  const { score, backing: importedBacking, adaptive, line } = usePiece(id, setup.arrangementLevel, choice);

  // Resolved once, here, and handed to both the transport and the
  // accompaniment, so there is no second derivation to disagree with.
  const loop = useMemo(
    () => practiceLoop(score ?? EMPTY_SCORE, {
      loopFromBar: setup.loopFromBar,
      loopToBar: setup.loopToBar,
      tempoPercent: setup.tempoPercent,
    }),
    [score, setup.loopFromBar, setup.loopToBar, setup.tempoPercent],
  );

  const playhead = usePlayhead({ score: score ?? EMPTY_SCORE, loop });
  const {
    play: startPlayhead,
    pause: pausePlayhead,
    restart: restartPlayhead,
  } = playhead;
  const [playRequested, setPlayRequested] = useState(false);

  const handlePlaybackWillStart = useCallback(() => {
    pausePlayhead();
  }, [pausePlayhead]);

  const handlePlaybackStarted = useCallback((delaySeconds = 0) => {
    startPlayhead(delaySeconds * 1000);
  }, [startPlayhead]);

  const togglePlayback = useCallback(() => {
    if (playRequested) {
      setPlayRequested(false);
      pausePlayhead();
    } else {
      setPlayRequested(true);
    }
  }, [playRequested, pausePlayhead]);

  const restartPlayback = useCallback(() => {
    // Freeze first. The revision makes audio seek; its actual-start callback
    // releases the visual clock again when playback was requested.
    pausePlayhead();
    restartPlayhead();
  }, [pausePlayhead, restartPlayhead]);

  // Browsers may hold input while a permission prompt is pending, so on web
  // the microphone is asked for from a player action. Everywhere, it is only
  // ever open while paused: the pitch engine is real work on the JS thread
  // and has no business running beside the note field.
  const [micEnabled, setMicEnabled] = useState(Platform.OS !== 'web');
  const micActive = micEnabled && !playRequested;
  const pitch = usePitch(micActive, { tunerMode: true });
  const { setTarget } = pitch;
  // A tuner reads the nearest semitone, not the score's next note.
  useEffect(() => { setTarget(null); }, [setTarget]);
  const enableMic = useCallback(() => setMicEnabled(true), []);

  const backing = useBacking({
    score: score ?? null,
    backing: importedBacking,
    listenMode,
    accompaniment,
    loop,
    playing: playRequested,
    transportRevision: playhead.revision,
    volume: backingVolume,
    scoreTimeMs: playhead.scoreTimeMs,
    onPlaybackWillStart: handlePlaybackWillStart,
    onPlaybackStarted: handlePlaybackStarted,
  });

  useAudioLock(playhead, backing.audioScoreTimeMs, playRequested);

  /**
   * Faint fingerboard overlay markers. `key` shows the whole detected key to
   * improvise in; `song` shows only the pitch classes the piece actually uses.
   * Capped at 19 semitones to match the 440 mm the panel draws, and recomputed
   * only when the score or mode changes — never per frame.
   */
  const songKey = useMemo(() => (score ? detectSongKey(score) : null), [score]);
  const noteOverlay = useMemo(() => {
    if (!score || !songKey || noteOverlayMode === 'off') return undefined;
    const preferFlats = score.metadata.preferFlats ?? songKey.name.includes('♭');
    if (noteOverlayMode === 'song') {
      return songPlayedNotes(score, { tonic: songKey.tonic, preferFlats });
    }
    return fingerboardMarkers(songKey.scale, {
      maxSemitones: 19,
      tonic: songKey.tonic,
      preferFlats,
    });
  }, [noteOverlayMode, score, songKey]);

  const fretboardMaxMm = useMemo(() => {
    if (!score) return 440;
    return calculateFretboardMaxMm(score.notes);
  }, [score]);

  if (!score) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.chrome.bg, padding: theme.s(30) }}>
        <Title size={22}>No score for “{id}”</Title>
        <Pressable onPress={() => router.replace('/')} style={{ marginTop: theme.s(16) }}>
          <Label size={12} color={theme.chrome.accent}>← BACK TO LIBRARY</Label>
        </Pressable>
      </View>
    );
  }

  /**
   * True when the title row cannot also carry both switchers — a phone, or an
   * unfolded Fold held vertically. Derived from the resolved scale rather than
   * from a raw pixel width, so it means the same thing on every device.
   */
  const narrow = !theme.scale.landscape || theme.scale.compact;
  const fingerboardWidth = narrow ? FINGERBOARD_WIDTH_TALL : FINGERBOARD_WIDTH;
  const visionWidth = visionSize.width - theme.s(20);
  const visionHeight = visionSize.height - theme.s(12);

  const micStatus = playRequested
    ? 'Microphone off while playing'
    : !micEnabled
      ? 'Microphone off'
      : pitch.mic.live ? 'Tuner listening' : micLabel(pitch.mic.status);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.chrome.bg,
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
      }}
    >
      <PlayTopBar
        title={score.metadata.title}
        playhead={playhead}
        loopFromBar={setup.loopFromBar}
        loopToBar={setup.loopToBar}
        playRequested={playRequested}
        onEndSession={() => router.canGoBack() ? router.back() : router.replace(`/song/${id}`)}
        onRestart={restartPlayback}
        onTogglePlay={togglePlayback}
      />
      <Rule />
      <PlayControlBar />
      <Rule />

      {/* Body */}
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <PlayFingerboardColumn
          width={fingerboardWidth}
          fretboardMaxMm={fretboardMaxMm}
          songKeyName={songKey?.name}
          noteOverlay={noteOverlay}
          score={score}
          playhead={playhead}
        />

        <View
          ref={visionRef}
          onLayout={onVisionLayout}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            paddingHorizontal: theme.s(10),
            paddingTop: theme.s(6),
          }}
        >
          {visionSize.height === 0 ? null : (
            <>
              {vision === 'highway' ? (
                <Highway
                  score={score}
                  playhead={playhead}
                  tapeSets={showTapes ? tapeSets : []}
                  showFingerings={showFingerings}
                  height={visionHeight}
                  width={visionWidth}
                  axis={highwayAxis}
                />
              ) : null}
              {vision === 'tab' ? (
                <TabVision
                  score={score}
                  playhead={playhead}
                  tapeSets={showTapes ? tapeSets : []}
                  showFingerings={showFingerings}
                  height={visionHeight}
                  width={visionWidth}
                  axis={tabAxis}
                />
              ) : null}
              {vision === 'score' ? (
                <ScorePage
                  score={score}
                  playhead={playhead}
                  height={visionHeight}
                  width={visionWidth}
                  showFingerings={showFingerings}
                />
              ) : null}
            </>
          )}

          {/* Laid over the top of the play area rather than above it, so
              pausing does not resize — and re-lay out — the vision. */}
          {playRequested ? null : (
            <View
              pointerEvents="box-none"
              style={{ position: 'absolute', top: theme.s(6), left: theme.s(10), right: theme.s(10) }}
            >
              <TunerStrip pitch={pitch} micEnabled={micEnabled} onEnableMic={enableMic} />
            </View>
          )}
        </View>
      </View>

      {/* Status strip */}
      <Rule />
      <Row padX={10} gap={10} style={{ minHeight: Math.max(theme.tap, theme.s(STATUS_BAR)) }}>
        {/*
          Scrolls rather than clips. These are readings, not controls, so losing
          the tail off the right-hand edge was survivable — but it also silently
          hid the one that says whether the accompaniment is still preparing.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ alignItems: 'center', gap: theme.s(14) }}
          style={{ flex: 1 }}
        >
          <StatusChip label={micStatus} tone={!playRequested && pitch.mic.live ? 'accent' : 'dim'} />
          <StatusChip label={`${setup.tempoPercent}% tempo`} />
          <StatusChip label={adaptive
            ? `${setup.arrangementLevel === 'Expert' ? 'Full' : setup.arrangementLevel} arrangement`
            : 'Authored score'} />
          {/* Which part you are on, in the accent, because mid-session the one
              thing worth knowing about a non-default line is that it is one. */}
          {adaptive && line.partId
            ? <StatusChip label={trackChoiceSummary(line)} tone="accent" />
            : null}
          {line.fit && line.fit.reseated > 0
            ? <StatusChip label={`${line.fit.reseated} notes moved an octave`} />
            : null}
          <ListenChip mode={listenMode} rendering={backing.rendering} />
        </ScrollView>
      </Row>
    </View>
  );
}

/**
 * Keeps the picture on the audio.
 *
 * Four times a second, while music is sounding, the adapter's own position is
 * handed to the playhead, which eases its anchor onto it. The audio clock is
 * the reference because it is the one the player hears; see
 * `domain/transportClock.ts` for the policy.
 */
function useAudioLock(
  playhead: Pick<Playhead, 'syncToAudio' | 'scoreTimeMs'>,
  audioScoreTimeMs: () => number | null,
  active: boolean,
) {
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

/**
 * Development-only sync telemetry, readable from a debugger as
 * `globalThis.__ponticelloSync`. It is how playback is verified in a browser:
 * the error between what is drawn and what is heard, sampled as the lock runs.
 */
function recordSync(visualMs: number, audioMs: number) {
  const store = globalThis as { __ponticelloSync?: { samples: number[]; last: number } };
  const sync = store.__ponticelloSync ?? { samples: [], last: 0 };
  sync.last = audioMs - visualMs;
  sync.samples.push(sync.last);
  if (sync.samples.length > 2400) sync.samples.shift();
  store.__ponticelloSync = sync;
}

function StatusChip({ label, tone = 'dim' }: { label: string; tone?: 'dim' | 'accent' }) {
  const theme = useTheme();
  return (
    <Row gap={5}>
      <View
        style={{
          width: theme.s(6),
          height: theme.s(6),
          borderRadius: theme.s(3),
          backgroundColor: tone === 'accent' ? theme.chrome.accent : theme.chrome.lineSoft,
        }}
      />
      <Label size={11} style={{ textTransform: 'none', letterSpacing: 0 }}>{label}</Label>
    </Row>
  );
}

function micLabel(status: string): string {
  switch (status) {
    case 'denied': return 'Microphone permission needed';
    case 'requesting': return 'Waiting for microphone';
    case 'unavailable': return 'Microphone unavailable';
    case 'error': return 'Check microphone connection';
    default: return 'Microphone idle';
  }
}

/** Keeps the transport hook's contract when the route id is unknown. */
const EMPTY_SCORE = {
  schemaVersion: '1.0.0' as const,
  id: 'empty',
  metadata: {
    title: '', composer: '', origin: '', keySignature: '', timeSignature: '4/4',
    bpm: 60, difficulty: 'Beginner' as const, tonic: 'C', teaches: '', rights: '',
  },
  measures: [],
  notes: [],
};
