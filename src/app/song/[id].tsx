import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ListenControl } from '@/components/play/ListenControl';
import { TrackPicker, trackChoiceSummary } from '@/components/play/TrackPicker';
import { KeyCensusNote } from '@/components/practice/KeyCensus';
import { Button, Disclosure, Segmented, Stepper, Toggle } from '@/components/ui/controls';
import {
  Body, Kicker, Label, Num, Row, Stack, Title,
} from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { LIBRARY_KEY_CENSUS, censusForDrill } from '@/scores';
import { firstPositionVerdict } from '@/scores/scaleDrills';
import { usePiece, useTrackOptions } from '@/state/usePiece';
import { useSession } from '@/state/session';
import { useBacking } from '@/audio/useBacking';
import { ArrangementLevel } from '@/domain/arrangement';
import { AccompanimentStyle } from '@/domain/backing';
import { practiceLoop } from '@/domain/loop';
import { ListenMode } from '@/audio/backing/types';
import { BoardView, FlowAxis, ScoreColorMode, useSettings, useTrackChoice, VisionName } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { ChromeName } from '@/theme/tokens';

const ARRANGEMENT_SEGMENTS = [
  { value: 'Beginner' as const, label: 'Beginner', hint: 'Held bass notes and gentle drones. A low, spacious part with time to move.' },
  { value: 'Intermediate' as const, label: 'Intermediate', hint: 'A simple bass accompaniment in the lower register, with rests for hand changes.' },
  { value: 'Advanced' as const, label: 'Advanced', hint: 'A more detailed melody, lowered for the cello and kept in first position.' },
  { value: 'Expert' as const, label: 'Full', hint: 'The fullest melody arrangement, still lowered into a comfortable first-position range.' },
];

const VISIONS = [
  { value: 'tab' as const, label: 'Tab' },
  { value: 'score' as const, label: 'Score' },
  { value: 'highway' as const, label: 'Highway' },
];

/**
 * Orientation, offered per vision rather than as one global axis.
 *
 * They are genuinely different preferences: a falling highway is the
 * convention most people arrive with, while a horizontal one matches
 * Rocksmith and suits a short wide screen; and the tab stave is easiest to
 * read as a stave until you want it to match the highway. Whichever is
 * chosen, the low C string stays at the bottom or the left.
 */
const HIGHWAY_AXES = [
  { value: 'vertical' as const, label: 'Falling', hint: 'Notes fall from the top' },
  { value: 'horizontal' as const, label: 'Sideways', hint: 'Notes arrive from the right' },
];

const TAB_AXES = [
  { value: 'horizontal' as const, label: 'Stave', hint: 'Four lines, time left to right' },
  { value: 'vertical' as const, label: 'Falling', hint: 'Four columns, notes fall from the top' },
];

const BOARD_VIEWS = [
  { value: 'player' as const, label: 'Player', hint: 'Nut at the bottom, as you see it' },
  { value: 'reader' as const, label: 'Diagram', hint: 'Nut at the top, as it is printed' },
];

const SCORE_COLORS = [
  { value: 'off' as const, label: 'Ink', hint: 'Plain engraved noteheads' },
  { value: 'string' as const, label: 'By string', hint: 'Each note in the colour of its string' },
  { value: 'note' as const, label: 'By note', hint: 'Each note in the colour of its letter name' },
];

const CHROMES = [
  { value: 'paper' as const, label: 'Paper' },
  { value: 'quiet' as const, label: 'Quiet' },
  { value: 'neon' as const, label: 'Neon' },
];

/**
 * Practice sheet.
 *
 * Everything set here survives the jump into the play screen, because the
 * decisions that make practice useful — which four bars, how slowly, with or
 * without the fingerings showing — are the ones you want to make while you are
 * still looking at the music, not while the bow is already moving.
 */
export default function SongScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, update, setTrackChoice } = useSettings();
  const { setup, update: updateSetup, openSong } = useSession();
  // Subscribed, not read through a getter: see `useTrackChoice`.
  const choice = useTrackChoice(id);
  // Preview lets you hear the accompaniment before committing to a session —
  // choosing between a drone and a pulse is a listening decision.
  //
  // Stored as *which piece* is being previewed rather than a boolean, so that
  // turning listening off or opening another piece stops the sound by
  // derivation rather than by an effect that writes state back.
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const previewing = previewFor === id && settings.listenMode !== 'off';

  const piece = usePiece(id, setup.arrangementLevel, choice);
  const { row, score, backing, adaptive, line } = piece;
  const trackOptions = useTrackOptions(piece, setup.arrangementLevel);
  // Set only for a scale drill: the census row for its key, so the sheet can
  // say how much of the player's own library the key is worth.
  const keyRow = censusForDrill(id);
  const fixedBacking = backing?.parts.some((part) => part.role === 'accompaniment') ?? false;
  const barCount = score?.measures.length ?? 0;

  useEffect(() => {
    if (id && barCount > 0) openSong(id, barCount);
  }, [id, barCount, openSong]);

  // The same window the play screen will use, so the preview you audition here
  // is the loop you get when the session starts.
  const loop = useMemo(
    () => practiceLoop(score ?? null, {
      loopFromBar: setup.loopFromBar,
      loopToBar: setup.loopToBar,
      tempoPercent: setup.tempoPercent,
    }),
    [score, setup.loopFromBar, setup.loopToBar, setup.tempoPercent],
  );

  const listen = useBacking({
    score: score ?? null,
    backing,
    listenMode: settings.listenMode,
    accompaniment: settings.accompaniment,
    loop,
    playing: previewing,
    volume: settings.backingVolume,
  });

  if (!row) {
    return (
      <Screen>
        <ScreenHeader backLabel="LIBRARY" />
        <Stack padY={30} gap={10}>
          <Title size={22}>Not in the library</Title>
          <Body color={theme.chrome.dim}>Nothing here with the id “{id}”.</Body>
        </Stack>
      </Screen>
    );
  }

  const wide = !theme.scale.compact;
  const bpm = Math.round((score?.metadata.bpm ?? 60) * setup.tempoPercent / 100);
  const arrangement = ARRANGEMENT_SEGMENTS.find((segment) => segment.value === setup.arrangementLevel);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Practice setup" />
      <ScrollView contentContainerStyle={{ padding: theme.s(24), paddingBottom: theme.s(30) }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.s(wide ? 32 : 24) }}>
          <Stack gap={14} style={wide ? { width: theme.s(260) } : undefined}>
            <Kicker size={11}>{row.composer}</Kicker>
            <Title accessibilityRole="header" size={30}>{row.title}</Title>
            <Body size={14} color={theme.chrome.dim}>{row.keySignature} · {score?.metadata.timeSignature ?? 'Meter unavailable'} · {barCount} bars</Body>
            {/* What you are about to play. When the player has taken a source
                part, this describes *that* rather than the arrangement they
                overruled — including what the octave shift cost, so the
                consequence is in the place they already read. */}
            <View style={{ backgroundColor: theme.chrome.surface, padding: theme.s(16), borderRadius: theme.s(10), gap: theme.s(8) }}>
              <Label size={11}>{adaptive ? 'Your cello part' : 'About this study'}</Label>
              <Title size={19}>
                {!adaptive ? row.difficulty
                  : line.partId ? trackChoiceSummary(line)
                    : `${arrangement?.label} arrangement`}
              </Title>
              <Body size={14} color={theme.chrome.dim}>
                {!adaptive ? row.note
                  : line.fit ? line.fit.reason
                    : piece.authoredLevels ? score?.metadata.teaches
                      : arrangement?.hint}
              </Body>
              <Body size={13} color={theme.chrome.dim}>Range {row.range}</Body>
            </View>
            {keyRow ? <KeyCensusNote row={keyRow} of={LIBRARY_KEY_CENSUS.counted}
              verdict={firstPositionVerdict(keyRow.tonic, keyRow.mode).note} /> : null}
            {wide ? <Body size={13} color={theme.chrome.dim}>Start slowly. Repeat a few bars until the movements feel familiar.</Body> : null}
          </Stack>

          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: theme.s(18) }}>
            <Title size={20}>Make it your practice</Title>
            {adaptive ? <Stack gap={8}>
              <Label size={11}>Arrangement</Label>
              <Segmented accessibilityLabel="Arrangement difficulty" segments={ARRANGEMENT_SEGMENTS} value={setup.arrangementLevel}
                onChange={(arrangementLevel: ArrangementLevel) => updateSetup({ arrangementLevel })} grow compact />
            </Stack> : null}
            {/* Immediately under the difficulty, because they are one decision:
                which line am I playing, and can I reach it. */}
            {adaptive && id ? <TrackPicker options={trackOptions} line={line} choice={choice}
              level={setup.arrangementLevel} onChange={(next) => setTrackChoice(id, next)} /> : null}
            <Row gap={12}>
              <View style={{ flex: 1 }}><Title size={15}>Tempo</Title><Body size={12} color={theme.chrome.dim}>{bpm} BPM · {setup.tempoPercent}% of original</Body></View>
              <Stepper label="tempo" value={setup.tempoPercent} display={`${setup.tempoPercent}%`}
                canDecrement={setup.tempoPercent > 40} canIncrement={setup.tempoPercent < 120}
                onDecrement={() => updateSetup({ tempoPercent: setup.tempoPercent - 5 })}
                onIncrement={() => updateSetup({ tempoPercent: setup.tempoPercent + 5 })} />
            </Row>
            <Stack gap={8}>
              <Row><Title size={15} style={{ flex: 1 }}>Practice loop</Title><Body size={12} color={theme.chrome.dim}>{setup.loopToBar - setup.loopFromBar + 1} bars selected</Body></Row>
              <Row gap={12}>
                <Body size={14} style={{ flex: 1 }}>From bar</Body>
                <Stepper label="loop start bar" value={setup.loopFromBar}
                  canDecrement={setup.loopFromBar > 1} canIncrement={setup.loopFromBar < setup.loopToBar}
                  onDecrement={() => updateSetup({ loopFromBar: setup.loopFromBar - 1 })}
                  onIncrement={() => updateSetup({ loopFromBar: setup.loopFromBar + 1 })} />
              </Row>
              <Row gap={12}>
                <Body size={14} style={{ flex: 1 }}>To bar</Body>
                <Stepper label="loop end bar" value={setup.loopToBar}
                  canDecrement={setup.loopToBar > setup.loopFromBar} canIncrement={setup.loopToBar < barCount}
                  onDecrement={() => updateSetup({ loopToBar: setup.loopToBar - 1 })}
                  onIncrement={() => updateSetup({ loopToBar: setup.loopToBar + 1 })} />
              </Row>
            </Stack>
            <Stack gap={8}>
              <Label size={11}>Read the music as</Label>
              <Segmented accessibilityLabel="Music view" segments={VISIONS} value={settings.vision} onChange={(vision: VisionName) => update({ vision })} grow />
              <Body size={12} color={theme.chrome.dim}>{VISION_BLURB[settings.vision]}</Body>
            </Stack>
            <View>
              <Disclosure title="Display preferences" summary={`${settings.showFingerings ? 'Fingerings on' : 'Fingerings hidden'} · ${settings.chrome} theme`}>
                {settings.vision === 'highway' ? <><Label size={11}>Highway direction</Label><Segmented accessibilityLabel="Highway direction" segments={HIGHWAY_AXES} value={settings.highwayAxis} onChange={(highwayAxis: FlowAxis) => update({ highwayAxis })} grow /></> : null}
                {settings.vision === 'score' ? <><Label size={11}>Score colours</Label><Segmented accessibilityLabel="Score colours" segments={SCORE_COLORS} value={settings.scoreColor} onChange={(scoreColor: ScoreColorMode) => update({ scoreColor })} grow /></> : null}
                {settings.vision === 'tab' ? <><Label size={11}>Tab direction</Label><Segmented accessibilityLabel="Tab direction" segments={TAB_AXES} value={settings.tabAxis} onChange={(tabAxis: FlowAxis) => update({ tabAxis })} grow /></> : null}
                <Label size={11}>Fingerboard orientation</Label>
                <Segmented accessibilityLabel="Fingerboard orientation" segments={BOARD_VIEWS} value={settings.boardView} onChange={(boardView: BoardView) => update({ boardView })} grow />
                <Toggle label="Show fingerings" hint="Hide the numbers when you want to test yourself." value={settings.showFingerings} onChange={(showFingerings) => update({ showFingerings })} />
                <Toggle label="Show my tapes" hint="Match each note to your fingerboard tape colours." value={settings.showTapes} onChange={(showTapes) => update({ showTapes })} />
                <Toggle label="Show the same note elsewhere" hint="Ring the other places the note being played could be taken, in its tape colour where there is one." value={settings.showAlternatePlacements} onChange={(showAlternatePlacements) => update({ showAlternatePlacements })} />
                <Toggle label="Show all position guides" hint="Include every fingerboard landmark and bracket." value={settings.cueDensity === 'full'} onChange={(full) => update({ cueDensity: full ? 'full' : 'essentials' })} />
                <Toggle label="Hide the switchers while playing" hint="The view and sound rows leave the screen once the music starts, and come back when you pause." value={settings.hideControlsWhilePlaying} onChange={(hideControlsWhilePlaying) => update({ hideControlsWhilePlaying })} />
                <Label size={11}>Practice theme</Label>
                <Segmented accessibilityLabel="Practice theme" segments={CHROMES} value={settings.chrome} onChange={(chrome: ChromeName) => update({ chrome })} grow />
              </Disclosure>
              <Disclosure title="Sound & listening" summary={settings.listenMode === 'off' ? 'Accompaniment off' : settings.listenMode === 'solo' ? 'Cello guide on' : settings.listenMode === 'both' ? 'Backing and cello guide on' : 'Backing track on'}>
                <ListenControl mode={settings.listenMode} onModeChange={(listenMode: ListenMode) => update({ listenMode })}
                  style={settings.accompaniment} onStyleChange={(accompaniment: AccompanimentStyle) => update({ accompaniment })}
                  volume={settings.backingVolume} onVolumeChange={(backingVolume) => update({ backingVolume })}
                  rendering={listen.rendering} error={listen.error} audibleParts={listen.audibleParts} fixedBacking={fixedBacking} hasSolo={listen.hasSolo} />
                {settings.listenMode === 'off' ? null : <Button label={previewing ? 'Stop preview' : 'Preview this loop'}
                  hint={listen.rendering ? 'Preparing…' : `${(listen.loopDurationMs / 1000).toFixed(1)}s`}
                  onPress={() => setPreviewFor(previewing ? null : (id ?? null))} disabled={!listen.ready && !previewing} />}
              </Disclosure>
              <Disclosure title="Score details" summary={row.origin}>
                <Body size={13} color={theme.chrome.dim}>{row.note}</Body>
                {row.distribution.map(([label, percent]) => <Row key={label}><Body size={13} style={{ flex: 1 }}>{label}</Body><Num size={13}>{percent}%</Num></Row>)}
              </Disclosure>
            </View>
          </View>
        </View>
      </ScrollView>
      <Row padX={24} padY={14} gap={16} style={{ borderTopWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, backgroundColor: theme.chrome.bg }}>
        <View style={{ flex: 1 }}><Title size={14}>{`Bars ${setup.loopFromBar}–${setup.loopToBar}`}</Title><Body size={12} color={theme.chrome.dim} numberOfLines={1}>{bpm} BPM{adaptive ? ` · ${arrangement?.label}` : ''}{adaptive && line.partId ? ` · ${trackChoiceSummary(line)}` : ''}</Body></View>
        <Button label={row.playable ? 'Start practice' : 'Import a score'} hint="→" tone="accent" onPress={() => { setPreviewFor(null); router.push(row.playable ? `/play/${row.id}` : '/settings/import'); }} />
      </Row>
    </Screen>
  );
}

const VISION_BLURB: Record<VisionName, string> = {
  tab: 'Four string lines with finger numbers. A clear guide to where your hand goes.',
  score: 'Bass clef notation for practising your music reading.',
  highway: 'Follow the notes along four string lanes to practise rhythm and crossings.',
};
