import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useMemo } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fingerboard, FingerboardScaleNote, FingerboardStringLabels } from '@/components/Fingerboard';
import { ListenChip } from '@/components/play/ListenControl';
import { Highway } from '@/components/play/Highway';
import { CentsRail, LevelMeter } from '@/components/play/Meters';
import { ScorePage } from '@/components/play/ScorePage';
import { TabVision } from '@/components/play/TabVision';
import { usePlayhead } from '@/components/play/usePlayhead';
import { useMeasuredSize } from '@/components/useMeasuredSize';
import { Segmented } from '@/components/ui/controls';
import { Grow, Label, Row, Rule, Title } from '@/components/ui/primitives';
import { usePitch } from '@/audio/usePitch';
import { useBacking } from '@/audio/useBacking';
import { ListenMode } from '@/audio/backing/types';
import { OPEN_STRING_MIDI } from '@/domain/cello';
import { practiceLoop } from '@/domain/loop';
import { usePiece } from '@/state/usePiece';
import { useSession } from '@/state/session';
import { useSettings, VisionName } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

const VISION_SEGMENTS = [
  { value: 'tab' as const, label: 'TAB' },
  { value: 'score' as const, label: 'SCORE' },
  { value: 'highway' as const, label: 'HWY', hint: 'Highway' },
];

/**
 * Short labels: the play screen is landscape and this control sits beside the
 * vision switcher, so it has to earn its width. The full wording lives on the
 * practice sheet, where there is room to explain it.
 */
const LISTEN_SEGMENTS = [
  { value: 'off' as const, label: 'OFF', hint: 'Listen: off' },
  { value: 'backing' as const, label: 'BACK', hint: 'Listen: backing only' },
  { value: 'solo' as const, label: 'CELLO', hint: 'Listen: written cello part' },
  { value: 'both' as const, label: 'BOTH', hint: 'Listen: backing and cello' },
];

const KEEP_AWAKE_TAG = 'ponticello-play';

/**
 * Columns of the play layout, in design units.
 *
 * Two sets, because the screen has to work held either way up. Landscape has
 * room for the fingerboard panel at a size you can read at arm's length;
 * portrait — an unfolded Fold held vertically, or any phone — has to buy that
 * width back from somewhere, and the panels are the right place to buy it from
 * because the vision in the middle is the thing being read.
 */
const FINGERBOARD_WIDTH = 152;
const FINGERBOARD_WIDTH_TALL = 104;
const CENTS_WIDTH = 96;
const CENTS_WIDTH_TALL = 72;
const TOP_BAR = 56;
const CONTROL_BAR = 46;
const STATUS_BAR = 36;

export default function PlayRoute() {
  const { settings } = useSettings();
  return (
    <ThemeProvider chrome={settings.chrome}>
      <PlayScreen />
    </ThemeProvider>
  );
}

/**
 * Play screen.
 *
 * Three things never move, whichever vision is showing: the fingerboard panel
 * on the left, the cents rail on the right, and the status strip along the
 * bottom. Switching vision changes the middle and nothing else, so the two
 * readings you check mid-phrase — where is my hand, how far off am I — are
 * always in the same place.
 */
function PlayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, update } = useSettings();
  const { setup } = useSession();

  const [visionSize, onVisionLayout, visionRef] = useMeasuredSize();
  const [boardSize, onBoardLayout, boardRef] = useMeasuredSize();

  // Practising is the one activity where the screen must not dim: the player's
  // hands are busy and nothing is touching the glass for minutes at a time.
  // Skipped on web, where the Screen Wake Lock API throws if the tab is not
  // visible and focused — a failure that is not worth surfacing to the player.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, []);

  // The play screen used to force landscape. It no longer does: an unfolded
  // Fold is a tall screen that people hold vertically, and locking rotation
  // meant either turning the device or reading the interface sideways. The
  // layout below adapts instead, which is the only version of "works on that
  // device" worth having.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  const { score, backing: importedBacking } = usePiece(id);

  // Resolved once, here, and handed to both the transport and the
  // accompaniment. They used to work the window out separately and disagree
  // about it, which is why the backing never lined up with the notes.
  const loop = useMemo(
    () => practiceLoop(score ?? EMPTY_SCORE, {
      loopFromBar: setup.loopFromBar,
      loopToBar: setup.loopToBar,
      tempoPercent: setup.tempoPercent,
    }),
    [score, setup.loopFromBar, setup.loopToBar, setup.tempoPercent],
  );

  const playhead = usePlayhead({ score: score ?? EMPTY_SCORE, loop });

  /**
   * The microphone is closed while the transport runs, unless the player has
   * asked otherwise in Settings.
   *
   * This is the fix the user proposed for the stutter, and it is the right one.
   * The pitch engine runs on the JS thread — about 375 analysis frames a second
   * — and publishes a React state update twelve times a second. Because that
   * state is read here, at the top of the play screen, every one of those
   * updates re-rendered the entire screen including the note field. With the
   * field windowed that is no longer catastrophic, but it is still twelve
   * renders a second bought for a reading nobody can act on mid-phrase: while
   * the backing is carrying you along you are watching the notes, not the
   * needle. Intonation feedback is where it is useful — stopped on a bar,
   * working the pitch.
   */
  const micActive = settings.micWhilePlaying || !playhead.playing;
  const pitch = usePitch(micActive);
  const activeNote = score?.notes[playhead.activeIndex];

  const backing = useBacking({
    score: score ?? null,
    backing: importedBacking,
    listenMode: settings.listenMode,
    accompaniment: settings.accompaniment,
    loop,
    playing: playhead.playing,
    volume: settings.backingVolume,
    scoreTimeMs: playhead.scoreTimeMs,
  });

  // Point the cents calculation at whatever the player is supposed to be on.
  useEffect(() => {
    pitch.setTarget(activeNote?.midiNumber ?? null);
  }, [activeNote?.midiNumber, pitch]);

  const centsText = useMemo(() => {
    if (!pitch.reading.voiced) return '—';
    const rounded = Math.round(pitch.reading.cents);
    return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded)}¢`;
  }, [pitch.reading]);

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

  const activeSemitones = activeNote
    ? activeNote.midiNumber - OPEN_STRING_MIDI[activeNote.string]
    : 0;

  /**
   * True when the title row cannot also carry both switchers — a phone, or an
   * unfolded Fold held vertically. Derived from the resolved scale rather than
   * from a raw pixel width, so it means the same thing on every device.
   */
  const narrow = !theme.scale.landscape || theme.scale.compact;
  const fingerboardWidth = narrow ? FINGERBOARD_WIDTH_TALL : FINGERBOARD_WIDTH;
  const centsWidth = narrow ? CENTS_WIDTH_TALL : CENTS_WIDTH;

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
      {/* Top bar */}
      <Row padX={10} gap={10} style={{ height: theme.s(TOP_BAR) }}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="End session"
          style={{ width: theme.tap, height: theme.tap, alignItems: 'center', justifyContent: 'center' }}
        >
          <Title size={22} color={theme.chrome.ink}>×</Title>
        </Pressable>

        {/*
          Narrow: the title takes the slack, because there is no switcher row
          beside it to compete with. Wide: it sizes to its content up to a cap,
          and `<Grow />` below absorbs the slack instead — giving it `flex` there
          shrinks it to whatever the switchers leave over, which truncates a
          title that would otherwise have fitted.
        */}
        <View style={narrow
          ? { flex: 1, minWidth: 0 }
          : { minWidth: 0, maxWidth: theme.s(210) }}
        >
          <Title size={15} numberOfLines={1}>{score.metadata.title}</Title>
          <Label size={10} numberOfLines={1}>
            {`m.${playhead.measureIndex + 1} · ${activeNote?.position ?? '1st'} pos · loop m.${setup.loopFromBar}–${setup.loopToBar}`}
          </Label>
        </View>

        {/*
          On a wide screen the switchers ride in the title row. On a narrow one
          they drop to their own row below: the transport is the control you
          reach for mid-phrase, and it was being pushed off the right-hand edge
          entirely, which made the screen unusable rather than merely cramped.
        */}
        {narrow ? null : (
          <>
            <Segmented
              segments={VISION_SEGMENTS}
              value={settings.vision}
              onChange={(vision: VisionName) => update({ vision })}
              compact
            />
            <Segmented
              segments={LISTEN_SEGMENTS}
              value={settings.listenMode}
              onChange={(listenMode: ListenMode) => update({ listenMode })}
              compact
            />
            <Grow />
          </>
        )}

        <Pressable
          onPress={playhead.restart}
          accessibilityRole="button"
          accessibilityLabel="Restart the loop"
          style={{ minWidth: theme.tap, height: theme.tap, alignItems: 'center', justifyContent: 'center' }}
        >
          <Label size={11} color={theme.chrome.dim}>↺</Label>
        </Pressable>
        <Pressable
          onPress={playhead.toggle}
          accessibilityRole="button"
          accessibilityLabel={playhead.playing ? 'Pause' : 'Play'}
          style={{ minWidth: theme.tap, height: theme.tap, alignItems: 'center', justifyContent: 'center' }}
        >
          <Title size={16} color={theme.chrome.accent}>{playhead.playing ? '❙❙' : '▶'}</Title>
        </Pressable>
      </Row>
      <Rule weight={2} />

      {narrow ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              alignItems: 'center',
              gap: theme.s(10),
              paddingHorizontal: theme.s(10),
            }}
            style={{ height: theme.s(CONTROL_BAR), flexGrow: 0 }}
          >
            <Segmented
              segments={VISION_SEGMENTS}
              value={settings.vision}
              onChange={(vision: VisionName) => update({ vision })}
              compact
            />
            <Segmented
              segments={LISTEN_SEGMENTS}
              value={settings.listenMode}
              onChange={(listenMode: ListenMode) => update({ listenMode })}
              compact
            />
          </ScrollView>
          <Rule weight={2} />
        </>
      ) : null}

      {/* Body */}
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <View
          style={{
            width: theme.s(fingerboardWidth),
            paddingHorizontal: theme.s(8),
            paddingTop: theme.s(6),
            borderRightWidth: theme.rule(2),
            borderColor: theme.chrome.line,
          }}
        >
          {/* The panel is narrower when the screen is; the label follows it. */}
          <Label size={10} numberOfLines={1}>{narrow ? 'BOARD' : 'FINGERBOARD'}</Label>
          <View ref={boardRef} style={{ flex: 1, marginTop: theme.s(6) }} onLayout={onBoardLayout}>
            <Fingerboard
              height={boardSize.height}
              maxMm={440}
              tapeSets={settings.tapeSets}
              showTapes={settings.showTapes}
              showLandmarks={settings.cueDensity === 'full'}
              gutter={46}
              compact
              invert={settings.boardView === 'player'}
              active={activeNote ? {
                string: activeNote.string,
                semitones: activeSemitones,
                finger: activeNote.finger,
              } : null}
            />
          </View>
          <FingerboardStringLabels compact activeString={activeNote?.string ?? null} />
          <FingerboardScaleNote />
        </View>

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
              {settings.vision === 'highway' ? (
                <Highway
                  score={score}
                  playhead={playhead}
                  tapeSets={settings.showTapes ? settings.tapeSets : []}
                  showFingerings={settings.showFingerings}
                  height={visionSize.height - theme.s(12)}
                  width={visionSize.width - theme.s(20)}
                  axis={settings.highwayAxis}
                />
              ) : null}
              {settings.vision === 'tab' ? (
                <TabVision
                  score={score}
                  playhead={playhead}
                  tapeSets={settings.showTapes ? settings.tapeSets : []}
                  showFingerings={settings.showFingerings}
                  height={visionSize.height - theme.s(12)}
                  width={visionSize.width - theme.s(20)}
                  axis={settings.tabAxis}
                />
              ) : null}
              {settings.vision === 'score' ? (
                <ScorePage
                  score={score}
                  playhead={playhead}
                  height={visionSize.height - theme.s(12)}
                  width={visionSize.width - theme.s(20)}
                  showFingerings={settings.showFingerings}
                />
              ) : null}
            </>
          )}
        </View>

        <View
          style={{
            width: theme.s(centsWidth),
            paddingHorizontal: theme.s(8),
            paddingTop: theme.s(6),
            borderLeftWidth: theme.rule(2),
            borderColor: theme.chrome.line,
          }}
        >
          <CentsRail
            cents={pitch.cents}
            verdict={pitch.reading.verdict}
            centsText={centsText}
            listening={pitch.mic.live && pitch.reading.voiced}
          />
        </View>
      </View>

      {/* Status strip */}
      <Rule weight={2} />
      <Row padX={10} gap={10} style={{ height: theme.s(STATUS_BAR) }}>
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
          <StatusChip
            label={pitch.mic.live
              ? `MIC LIVE · ${Math.round(pitch.mic.sampleRate / 1000)} kHz`
              : (micActive ? micLabel(pitch.mic.status) : 'MIC PAUSED WHILE PLAYING')}
            tone={pitch.mic.live ? 'accent' : 'dim'}
          />
          <StatusChip label={`${setup.tempoPercent}% TEMPO`} />
          <StatusChip label={settings.showFingerings ? 'FINGERINGS ON' : 'FINGERINGS HIDDEN'} />
          <StatusChip label={settings.showTapes ? 'TAPES ON' : 'TAPES OFF'} />
          <ListenChip mode={settings.listenMode} rendering={backing.rendering} />
          {pitch.reading.voiced ? (
            <StatusChip label={`HEARD ${pitch.reading.heard} · ${pitch.reading.band.toUpperCase()} BAND`} />
          ) : null}
        </ScrollView>
        <LevelMeter level={pitch.level} height={13} />
      </Row>
    </View>
  );
}

function StatusChip({ label, tone = 'dim' }: { label: string; tone?: 'dim' | 'accent' }) {
  const theme = useTheme();
  return (
    <Row gap={5}>
      <View
        style={{
          width: theme.s(6),
          height: theme.s(6),
          backgroundColor: tone === 'accent' ? theme.chrome.accent : theme.chrome.lineSoft,
        }}
      />
      <Label size={10}>{label}</Label>
    </Row>
  );
}

function micLabel(status: string): string {
  switch (status) {
    case 'denied': return 'MIC REFUSED';
    case 'requesting': return 'ASKING FOR MIC';
    case 'unavailable': return 'NO MIC ON THIS PLATFORM';
    case 'error': return 'MIC ERROR';
    default: return 'MIC IDLE';
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
