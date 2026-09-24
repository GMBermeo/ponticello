import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBacking, usePitch } from '@audio';
import {
  EMPTY_SCORE, Label, PlayControlBar, PlayFingerboardColumn, PlayStatusStrip, PlayTopBar, PlayVision,
  Rule, Title, useAudioLock, useNoteOverlay, usePlayhead, usePlayheadTransport, usePracticeClock,
} from '@components';
import { calculateFretboardMaxMm, practiceLoop } from '@domain';
import {
  useAudioPreferences, usePiece, useSession, useSettingsSelector, useTrackChoice,
  useVisionPreferences,
} from '@state';
import { ThemeProvider, useTheme } from '@theme';

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
/** Board drawn when there is no score to measure. */
const DEFAULT_FRETBOARD_MM = 440;

export default function PlayRoute() {
  const chrome = useSettingsSelector((s) => s.chrome);
  return (
    <ThemeProvider chrome={chrome}>
      <PlayScreen />
    </ThemeProvider>
  );
}

/**
 * Practising is the one activity where the screen must not dim, and the layout
 * adapts to either orientation rather than forcing one: an unfolded Fold is a
 * tall screen that people hold vertically. Both are skipped on web, where the
 * Screen Wake Lock API throws if the tab is not visible and focused.
 */
function usePlayDevice(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, []);
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
  const { hideControlsWhilePlaying } = useVisionPreferences();
  const noteOverlayMode = useSettingsSelector((s) => s.noteOverlay);
  const { setup } = useSession();
  usePlayDevice();

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
  const { play: startPlayhead, pause: pausePlayhead, restart: restartPlayhead } = playhead;
  const [playRequested, setPlayRequested] = useState(false);
  // Subscribed, not read off the playhead object: the object is identity-stable
  // now, which is what lets every memoised child skip a transport change.
  const { playing, revision } = usePlayheadTransport(playhead);
  usePracticeClock(playing);

  const togglePlayback = () => {
    if (playRequested) pausePlayhead();
    setPlayRequested(!playRequested);
  };

  const restartPlayback = () => {
    // Freeze first. The revision makes audio seek; its actual-start callback
    // releases the visual clock again when playback was requested.
    pausePlayhead();
    restartPlayhead();
  };

  // Browsers may hold input while a permission prompt is pending, so on web
  // the microphone is asked for from a player action. Everywhere, it is only
  // ever open while paused: the pitch engine is real work on the JS thread
  // and has no business running beside the note field.
  const [micEnabled, setMicEnabled] = useState(Platform.OS !== 'web');
  const pitch = usePitch(micEnabled && !playRequested, { tunerMode: true });
  const { setTarget } = pitch;
  // A tuner reads the nearest semitone, not the score's next note.
  useEffect(() => { setTarget(null); }, [setTarget]);
  const enableMic = useCallback(() => setMicEnabled(true), []);
  const handlePlaybackStarted = useCallback(
    (delaySeconds = 0) => startPlayhead(delaySeconds * 1000),
    [startPlayhead],
  );

  const backing = useBacking({
    score: score ?? null,
    backing: importedBacking,
    listenMode,
    accompaniment,
    loop,
    playing: playRequested,
    transportRevision: revision,
    volume: backingVolume,
    scoreTimeMs: playhead.scoreTimeMs,
    onPlaybackWillStart: pausePlayhead,
    onPlaybackStarted: handlePlaybackStarted,
  });

  useAudioLock(playhead, backing.audioScoreTimeMs, playRequested);

  /**
   * Pressing play on a long song buys a render before anything can sound, so
   * the button says "Loading…" and refuses a press until the clock moves.
   *
   * The clock is the right signal rather than `backing.rendering`: with the
   * sound off, or with a program that turns out to be silent, the transport
   * releases the picture immediately and there is nothing to wait for. An
   * adapter error also lets go — `useBacking` keeps waiting in that case, and
   * a permanently disabled play button is a worse failure than a silent one.
   */
  const starting = playRequested && !playing && backing.error === null;

  const { songKey, markers: noteOverlay } = useNoteOverlay(score, noteOverlayMode);

  // What the piece needs. How much board is actually drawn is decided by the
  // panel, which knows how much room it has — see `fingerboardExtentMm`.
  const fretboardMinMm = useMemo(
    () => (score ? calculateFretboardMaxMm(score.notes) : DEFAULT_FRETBOARD_MM),
    [score],
  );

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
        starting={starting}
        onEndSession={() => (router.canGoBack() ? router.back() : router.replace(`/song/${id}`))}
        onRestart={restartPlayback}
        onTogglePlay={togglePlayback}
      />
      {/* Setup controls, not performance controls: with the preference on they
          leave while the music runs and come back the moment you pause. */}
      {hideControlsWhilePlaying && playRequested ? null : (
        <>
          <Rule />
          <PlayControlBar />
        </>
      )}
      <Rule />

      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <PlayFingerboardColumn
          width={narrow ? FINGERBOARD_WIDTH_TALL : FINGERBOARD_WIDTH}
          fretboardMinMm={fretboardMinMm}
          songKeyName={songKey?.name}
          noteOverlay={noteOverlay}
          score={score}
          playhead={playhead}
        />
        <PlayVision
          score={score}
          playhead={playhead}
          playRequested={playRequested}
          pitch={pitch}
          micEnabled={micEnabled}
          onEnableMic={enableMic}
        />
      </View>

      <Rule />
      <PlayStatusStrip
        playRequested={playRequested}
        mic={{ enabled: micEnabled, live: pitch.mic.live, status: pitch.mic.status }}
        tempoPercent={setup.tempoPercent}
        adaptive={adaptive}
        arrangementLevel={setup.arrangementLevel}
        line={line}
        listenMode={listenMode}
        rendering={backing.rendering}
      />
    </View>
  );
}
