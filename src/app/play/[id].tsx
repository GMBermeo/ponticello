import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import React, { useEffect, useMemo } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fingerboard, FingerboardScaleNote, FingerboardStringLabels } from '@/components/Fingerboard';
import { Highway } from '@/components/play/Highway';
import { CentsRail, LevelMeter } from '@/components/play/Meters';
import { ScoreVision } from '@/components/play/ScoreVision';
import { TabVision } from '@/components/play/TabVision';
import { usePlayhead } from '@/components/play/usePlayhead';
import { useMeasuredSize } from '@/components/useMeasuredSize';
import { Segmented } from '@/components/ui/controls';
import { Grow, Label, Row, Rule, Title } from '@/components/ui/primitives';
import { usePitch } from '@/audio/usePitch';
import { OPEN_STRING_MIDI } from '@/domain/cello';
import { getScore } from '@/scores';
import { useSession } from '@/state/session';
import { useSettings, VisionName } from '@/state/settings';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { ChromeName } from '@/theme/tokens';

const VISION_SEGMENTS = [
  { value: 'tab' as const, label: 'TAB' },
  { value: 'score' as const, label: 'SCORE' },
  { value: 'highway' as const, label: 'HWY', hint: 'Highway' },
];

const CHROME_SEGMENTS = [
  { value: 'paper' as const, label: 'PAPER' },
  { value: 'quiet' as const, label: 'QUIET' },
  { value: 'neon' as const, label: 'NEON' },
];

const KEEP_AWAKE_TAG = 'ponticello-play';

/** Fixed columns of the play layout, in design units. */
const FINGERBOARD_WIDTH = 152;
const CENTS_WIDTH = 96;
const TOP_BAR = 56;
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

  const [visionSize, onVisionLayout] = useMeasuredSize();
  const [boardSize, onBoardLayout] = useMeasuredSize();

  // Practising is the one activity where the screen must not dim: the player's
  // hands are busy and nothing is touching the glass for minutes at a time.
  // Skipped on web, where the Screen Wake Lock API throws if the tab is not
  // visible and focused — a failure that is not worth surfacing to the player.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {}); };
  }, []);

  // The play screen is the only landscape screen; everything else is portrait.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => { ScreenOrientation.unlockAsync().catch(() => {}); };
  }, []);

  const score = getScore(id);
  const playhead = usePlayhead({
    score: score ?? EMPTY_SCORE,
    loopFromBar: setup.loopFromBar,
    loopToBar: setup.loopToBar,
    tempoPercent: setup.tempoPercent,
  });

  const pitch = usePitch(true);
  const activeNote = score?.notes[playhead.activeIndex];

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

        <View style={{ maxWidth: theme.s(210), minWidth: 0 }}>
          <Title size={15} numberOfLines={1}>{score.metadata.title}</Title>
          <Label size={10}>
            {`m.${playhead.measureIndex + 1} · ${activeNote?.position ?? '1st'} pos · loop m.${setup.loopFromBar}–${setup.loopToBar}`}
          </Label>
        </View>

        <Segmented
          segments={VISION_SEGMENTS}
          value={settings.vision}
          onChange={(vision: VisionName) => update({ vision })}
          compact
        />

        <Grow />

        <Segmented
          segments={CHROME_SEGMENTS}
          value={settings.chrome}
          onChange={(chrome: ChromeName) => update({ chrome })}
          compact
        />

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

      {/* Body */}
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <View
          style={{
            width: theme.s(FINGERBOARD_WIDTH),
            paddingHorizontal: theme.s(8),
            paddingTop: theme.s(6),
            borderRightWidth: theme.rule(2),
            borderColor: theme.chrome.line,
          }}
        >
          <Label size={10}>FINGERBOARD</Label>
          <View style={{ flex: 1, marginTop: theme.s(6) }} onLayout={onBoardLayout}>
            <Fingerboard
              height={boardSize.height}
              maxMm={440}
              tapeSets={settings.tapeSets}
              showTapes={settings.showTapes}
              showLandmarks={settings.cueDensity === 'full'}
              gutter={46}
              compact
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
                />
              ) : null}
              {settings.vision === 'score' ? (
                <ScoreVision
                  score={score}
                  playhead={playhead}
                  height={visionSize.height - theme.s(12)}
                  width={visionSize.width - theme.s(20)}
                  cents={pitch.cents}
                  listening={pitch.mic.live && pitch.reading.voiced}
                />
              ) : null}
            </>
          )}
        </View>

        <View
          style={{
            width: theme.s(CENTS_WIDTH),
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
      <Row padX={10} gap={14} style={{ height: theme.s(STATUS_BAR) }}>
        <StatusChip
          label={pitch.mic.live ? `MIC LIVE · ${Math.round(pitch.mic.sampleRate / 1000)} kHz` : micLabel(pitch.mic.status)}
          tone={pitch.mic.live ? 'accent' : 'dim'}
        />
        <StatusChip label={`${setup.tempoPercent}% TEMPO`} />
        <StatusChip label={settings.showFingerings ? 'FINGERINGS ON' : 'FINGERINGS HIDDEN'} />
        <StatusChip label={settings.showTapes ? 'TAPES ON' : 'TAPES OFF'} />
        {pitch.reading.voiced ? (
          <StatusChip label={`HEARD ${pitch.reading.heard} · ${pitch.reading.band.toUpperCase()} BAND`} />
        ) : null}
        <Grow />
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
