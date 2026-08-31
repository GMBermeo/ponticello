import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ListenControl } from '@/components/play/ListenControl';
import { Button, Segmented, Stepper, Toggle } from '@/components/ui/controls';
import {
  Body, Grow, Kicker, Label, Num, Row, Rule, Stack, Title,
} from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { LIBRARY_ROWS } from '@/scores';
import { usePiece } from '@/state/usePiece';
import { useSession } from '@/state/session';
import { useBacking } from '@/audio/useBacking';
import { AccompanimentStyle } from '@/domain/backing';
import { practiceLoop } from '@/domain/loop';
import { ListenMode } from '@/audio/backing/types';
import { BoardView, FlowAxis, useSettings, VisionName } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { ChromeName } from '@/theme/tokens';

const VISIONS = [
  { value: 'tab' as const, label: 'TAB' },
  { value: 'score' as const, label: 'SCORE' },
  { value: 'highway' as const, label: 'HIGHWAY' },
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
  { value: 'vertical' as const, label: 'FALLING', hint: 'Notes fall from the top' },
  { value: 'horizontal' as const, label: 'SIDEWAYS', hint: 'Notes arrive from the right' },
];

const TAB_AXES = [
  { value: 'horizontal' as const, label: 'STAVE', hint: 'Four lines, time left to right' },
  { value: 'vertical' as const, label: 'FALLING', hint: 'Four columns, notes fall from the top' },
];

const BOARD_VIEWS = [
  { value: 'player' as const, label: 'PLAYER', hint: 'Nut at the bottom, as you see it' },
  { value: 'reader' as const, label: 'DIAGRAM', hint: 'Nut at the top, as it is printed' },
];

const CHROMES = [
  { value: 'paper' as const, label: 'PAPER' },
  { value: 'quiet' as const, label: 'QUIET' },
  { value: 'neon' as const, label: 'NEON' },
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
  const { settings, update } = useSettings();
  const { setup, update: updateSetup, openSong } = useSession();
  // Preview lets you hear the accompaniment before committing to a session —
  // choosing between a drone and a pulse is a listening decision.
  //
  // Stored as *which piece* is being previewed rather than a boolean, so that
  // turning listening off or opening another piece stops the sound by
  // derivation rather than by an effect that writes state back.
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const previewing = previewFor === id && settings.listenMode !== 'off';

  const { row, score, backing, imported } = usePiece(id);
  const barCount = score?.measures.length ?? 0;
  const index = LIBRARY_ROWS.findIndex((r) => r.id === id) + 1;

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

  const meta = useMemo(() => {
    if (!row) return [];
    return [
      { k: 'KEY', v: row.keySignature },
      { k: 'METER', v: score?.metadata.timeSignature ?? '—' },
      { k: 'TEMPO', v: row.tempo },
      { k: 'RANGE', v: row.range },
      { k: 'DIFFICULTY', v: row.difficulty.toUpperCase() },
      { k: 'BARS', v: barCount === 0 ? '—' : String(barCount) },
    ];
  }, [row, score, barCount]);

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
  const loopSpan = `m.${setup.loopFromBar}–${setup.loopToBar}`;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="LIBRARY" meta={`${index} / ${LIBRARY_ROWS.length}`} />

      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Screen padded={false}>
            <Stack padX={20} padY={16} gap={4}>
              <Kicker size={10}>{row.origin}</Kicker>
              <Title size={30}>{row.title}</Title>
              <Label size={12} style={{ textTransform: 'none' }}>{row.composer}</Label>
            </Stack>
            <Rule />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {meta.map((item) => (
                <View
                  key={item.k}
                  style={{
                    // Two columns rather than three: at a third of the pane
                    // "INTERMEDIATE" breaks mid-word, and a hyphenless break
                    // in a one-word value reads as a rendering fault.
                    width: '50%',
                    paddingHorizontal: theme.s(14),
                    paddingVertical: theme.s(10),
                    borderRightWidth: theme.rule(1),
                    borderBottomWidth: theme.rule(1),
                    borderColor: theme.chrome.lineSoft,
                  }}
                >
                  <Label size={9}>{item.k}</Label>
                  <Num size={15} style={{ marginTop: theme.s(3) }}>{item.v}</Num>
                </View>
              ))}
            </View>

            <Stack padX={20} padY={16} gap={8}>
              <Label size={11}>WHAT THIS TEACHES</Label>
              <Body size={14} color={theme.chrome.ink}>{row.note}</Body>
            </Stack>
            <Rule />

            <Stack padX={20} padY={16} gap={10}>
              <Label size={11}>LEFT-HAND POSITION LOAD</Label>
              {row.distribution.map(([label, percent], i) => (
                <View key={label}>
                  <Row>
                    <Label size={10}>{label.toUpperCase()}</Label>
                    <Grow />
                    <Num size={11} color={theme.chrome.dim}>{`${percent}%`}</Num>
                  </Row>
                  <View
                    style={{
                      height: theme.s(7),
                      marginTop: theme.s(4),
                      backgroundColor: theme.chrome.surface,
                    }}
                  >
                    <View
                      style={{
                        height: '100%',
                        width: `${percent}%`,
                        backgroundColor: i === 0
                          ? theme.chrome.ink
                          : i === 1 ? theme.chrome.dim : theme.chrome.accent,
                      }}
                    />
                  </View>
                </View>
              ))}
            </Stack>
          </Screen>
        </View>

        {wide ? <Rule weight={2} vertical /> : null}

        <View style={{ flex: 1, minWidth: 0 }}>
          <Screen padded={false}>
            <Stack padX={20} padY={16} gap={12}>
              <Label size={11}>VISION</Label>
              <Segmented
                segments={VISIONS}
                value={settings.vision}
                onChange={(vision: VisionName) => update({ vision })}
                grow
              />
              <Body size={12} color={theme.chrome.dim}>
                {VISION_BLURB[settings.vision]}
              </Body>

              {/* Only the axis of the vision actually selected — offering all
                  three at once is three controls for one decision. */}
              {settings.vision === 'highway' ? (
                <>
                  <Rule />
                  <Label size={10}>HIGHWAY DIRECTION</Label>
                  <Segmented
                    segments={HIGHWAY_AXES}
                    value={settings.highwayAxis}
                    onChange={(highwayAxis: FlowAxis) => update({ highwayAxis })}
                    grow
                    compact
                  />
                </>
              ) : null}
              {settings.vision === 'tab' ? (
                <>
                  <Rule />
                  <Label size={10}>TAB DIRECTION</Label>
                  <Segmented
                    segments={TAB_AXES}
                    value={settings.tabAxis}
                    onChange={(tabAxis: FlowAxis) => update({ tabAxis })}
                    grow
                    compact
                  />
                </>
              ) : null}

              <Rule />
              <Label size={10}>FINGERBOARD PANEL</Label>
              <Segmented
                segments={BOARD_VIEWS}
                value={settings.boardView}
                onChange={(boardView: BoardView) => update({ boardView })}
                grow
                compact
              />
            </Stack>
            <Rule weight={2} />

            <Stack padX={20} padY={16} gap={14}>
              <Label size={11}>PRACTICE SETUP</Label>

              <Row gap={10}>
                <Body size={14} style={{ flex: 1 }}>Loop from</Body>
                <Stepper
                  label="loop start bar"
                  value={setup.loopFromBar}
                  display={`m.${setup.loopFromBar}`}
                  canDecrement={setup.loopFromBar > 1}
                  canIncrement={setup.loopFromBar < setup.loopToBar}
                  onDecrement={() => updateSetup({ loopFromBar: setup.loopFromBar - 1 })}
                  onIncrement={() => updateSetup({ loopFromBar: setup.loopFromBar + 1 })}
                />
              </Row>
              <Row gap={10}>
                <Body size={14} style={{ flex: 1 }}>Loop to</Body>
                <Stepper
                  label="loop end bar"
                  value={setup.loopToBar}
                  display={`m.${setup.loopToBar}`}
                  canDecrement={setup.loopToBar > setup.loopFromBar}
                  canIncrement={setup.loopToBar < barCount}
                  onDecrement={() => updateSetup({ loopToBar: setup.loopToBar - 1 })}
                  onIncrement={() => updateSetup({ loopToBar: setup.loopToBar + 1 })}
                />
              </Row>
              <Row gap={10}>
                <Body size={14} style={{ flex: 1 }}>Tempo</Body>
                <Stepper
                  label="tempo"
                  value={setup.tempoPercent}
                  display={`${setup.tempoPercent}%`}
                  canDecrement={setup.tempoPercent > 40}
                  canIncrement={setup.tempoPercent < 120}
                  onDecrement={() => updateSetup({ tempoPercent: setup.tempoPercent - 5 })}
                  onIncrement={() => updateSetup({ tempoPercent: setup.tempoPercent + 5 })}
                />
              </Row>

              <Rule />
              <Toggle
                label="Show fingerings"
                hint="turn off to test yourself — rhythm and stave stay"
                value={settings.showFingerings}
                onChange={(showFingerings) => update({ showFingerings })}
              />
              <Rule />
              <Toggle
                label="Show my tapes"
                hint="colour every note by the tape it lands on"
                value={settings.showTapes}
                onChange={(showTapes) => update({ showTapes })}
              />
              <Rule />
              <Toggle
                label="Full scaffolding"
                hint="every landmark and bracket, not just the loud ones"
                value={settings.cueDensity === 'full'}
                onChange={(full) => update({ cueDensity: full ? 'full' : 'essentials' })}
              />
              <Rule />
              <Toggle
                label="Listen to me while playing"
                hint="off keeps playback smooth — intonation still reads when paused"
                value={settings.micWhilePlaying}
                onChange={(micWhilePlaying) => update({ micWhilePlaying })}
              />
            </Stack>

            <Rule weight={2} />
            <Stack padX={20} padY={16} gap={12}>
              <ListenControl
                mode={settings.listenMode}
                onModeChange={(listenMode: ListenMode) => update({ listenMode })}
                style={settings.accompaniment}
                onStyleChange={(accompaniment: AccompanimentStyle) => update({ accompaniment })}
                volume={settings.backingVolume}
                onVolumeChange={(backingVolume) => update({ backingVolume })}
                rendering={listen.rendering}
                error={listen.error}
                audibleParts={listen.audibleParts}
                imported={imported}
                hasSolo={listen.hasSolo}
              />
              {settings.listenMode === 'off' ? null : (
                <Button
                  label={previewing ? 'Stop preview' : 'Preview'}
                  hint={listen.rendering ? 'PREPARING' : `${(listen.loopDurationMs / 1000).toFixed(1)}s LOOP`}
                  onPress={() => setPreviewFor(previewing ? null : (id ?? null))}
                  disabled={!listen.ready && !previewing}
                />
              )}
            </Stack>

            <Rule weight={2} />
            <Stack padX={20} padY={16} gap={10}>
              <Label size={11}>PLAY SCREEN CHROME</Label>
              <Segmented
                segments={CHROMES}
                value={settings.chrome}
                onChange={(chrome: ChromeName) => update({ chrome })}
                grow
                compact
              />
            </Stack>

            <Rule weight={2} />
            <Stack padX={20} padY={16} gap={8}>
              {row.playable ? (
                <>
                  <Button
                    label="START SESSION"
                    hint="LANDSCAPE"
                    tone="accent"
                    onPress={() => router.push(`/play/${row.id}`)}
                  />
                  <Label size={10} style={{ textTransform: 'none' }}>
                    {`Loop ${loopSpan} at ${setup.tempoPercent}% · fingerings ${settings.showFingerings ? 'on' : 'hidden'}`}
                  </Label>
                </>
              ) : (
                <>
                  <View
                    style={{
                      borderWidth: theme.rule(1),
                      borderColor: theme.chrome.line,
                      padding: theme.s(14),
                    }}
                  >
                    <Label size={10} color={theme.chrome.accent}>NO SCORE BUNDLED</Label>
                    <Body size={13} style={{ marginTop: theme.s(6) }}>{row.note}</Body>
                  </View>
                  <Label size={10} style={{ textTransform: 'none' }}>
                    Convert a licensed copy with tools/convert-score.ts and drop the JSON into
                    src/scores to fill this row in.
                  </Label>
                </>
              )}
            </Stack>
          </Screen>
        </View>
      </View>
    </Screen>
  );
}

const VISION_BLURB: Record<VisionName, string> = {
  tab: 'Four lines, one per string, with finger numbers on them. Shows the hand rather than the pitch — the fastest read when you are still learning where notes live.',
  score: 'Bass clef notation with a live intonation trace over it. Read this when you want to practise reading, or to see how far under the note you are sitting.',
  highway: 'Notes travel down — or across — four string lanes to a hit line. Best for rhythm and string crossings; the tape colour rides on each note as it arrives.',
};
