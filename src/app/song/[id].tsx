import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useBacking } from '@audio';
import {
  ARRANGEMENT_SEGMENTS, Body, Button, CHORDS_BLURB, CHORDS_SEGMENT, Disclosure, DisplayPreferences,
  effectiveBpm, Label, Num, PieceSummary, PracticeWindowControls, Row, Screen, ScreenHeader,
  Segmented, SoundPreferences, Stack, Title, trackChoiceSummary, TrackPicker, VISION_BLURB,
  VISION_SEGMENTS, type SheetView,
} from '@components';
import { practiceLoop } from '@domain';
import { getChordSheet, type LibraryRow } from '@scores';
import {
  useAudioPreferences, usePiece, useSession, useSettingsActions, useTrackChoice, useTrackOptions,
  useVisionPreferences,
} from '@state';
import { useTheme } from '@theme';

function startTarget(row: LibraryRow, chordsSelected: boolean): { label: string; href: Href } {
  if (chordsSelected) return { label: 'Read chords', href: `/chord-song/${row.id}` };
  if (row.playable) return { label: 'Start practice', href: `/play/${row.id}` };
  return { label: 'Import a score', href: '/settings/import' };
}

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
  const chordSheet = getChordSheet(id);
  const [chordsSelectedFor, setChordsSelectedFor] = useState<string | null>(null);
  const chordsSelected = !!chordSheet && chordsSelectedFor === id;
  const { listenMode, accompaniment, backingVolume } = useAudioPreferences();
  const { vision } = useVisionPreferences();
  const { update, setTrackChoice } = useSettingsActions();
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
  const previewing = previewFor === id && listenMode !== 'off';

  const piece = usePiece(id, setup.arrangementLevel, choice);
  const { row, score, backing, adaptive, line } = piece;
  const trackOptions = useTrackOptions(piece, setup.arrangementLevel);
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
    listenMode,
    accompaniment,
    loop,
    playing: previewing,
    volume: backingVolume,
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
  const bpm = effectiveBpm(score?.metadata.bpm, setup.tempoPercent);
  const arrangement = ARRANGEMENT_SEGMENTS.find((segment) => segment.value === setup.arrangementLevel);
  const viewSegments = chordSheet ? [...VISION_SEGMENTS, CHORDS_SEGMENT] : VISION_SEGMENTS;
  const start = startTarget(row, chordsSelected);
  const footerDetail = [
    `${bpm} BPM`,
    adaptive ? arrangement?.label : undefined,
    adaptive && line.partId ? trackChoiceSummary(line) : undefined,
  ].filter(Boolean).join(' · ');

  const selectView = (view: SheetView) => {
    if (view === 'chords') {
      setChordsSelectedFor(id ?? null);
      setPreviewFor(null);
      return;
    }
    setChordsSelectedFor(null);
    update({ vision: view });
  };

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Practice setup" />
      <ScrollView contentContainerStyle={{ padding: theme.s(24), paddingBottom: theme.s(30) }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.s(wide ? 32 : 24) }}>
          <PieceSummary pieceId={id} piece={piece} arrangementLabel={arrangement?.label}
            arrangementHint={arrangement?.hint} wide={wide} />

          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: theme.s(18) }}>
            <Title size={20}>Make it your practice</Title>
            {adaptive ? (
              <Stack gap={8}>
                <Label size={11}>Arrangement</Label>
                <Segmented accessibilityLabel="Arrangement difficulty" segments={ARRANGEMENT_SEGMENTS}
                  value={setup.arrangementLevel} onChange={(arrangementLevel) => updateSetup({ arrangementLevel })} grow compact />
              </Stack>
            ) : null}
            {/* Immediately under the difficulty, because they are one decision:
                which line am I playing, and can I reach it. */}
            {adaptive && id ? (
              <TrackPicker options={trackOptions} line={line} choice={choice}
                level={setup.arrangementLevel} onChange={(next) => setTrackChoice(id, next)} />
            ) : null}
            <PracticeWindowControls setup={setup} bpm={bpm} barCount={barCount} onChange={updateSetup} />
            <Stack gap={8}>
              <Label size={11}>Read the music as</Label>
              <Segmented<SheetView> accessibilityLabel="Music view" segments={viewSegments}
                value={chordsSelected ? 'chords' : vision} onChange={selectView} grow />
              <Body size={12} color={theme.chrome.dim}>{chordsSelected ? CHORDS_BLURB : VISION_BLURB[vision]}</Body>
            </Stack>
            <View>
              <DisplayPreferences />
              <SoundPreferences listen={listen} fixedBacking={fixedBacking} previewing={previewing}
                onTogglePreview={() => setPreviewFor(previewing ? null : (id ?? null))} />
              <Disclosure title="Score details" summary={row.origin}>
                <Body size={13} color={theme.chrome.dim}>{row.note}</Body>
                {row.distribution.map(([label, percent]) => (
                  <Row key={label}><Body size={13} style={{ flex: 1 }}>{label}</Body><Num size={13}>{percent}%</Num></Row>
                ))}
              </Disclosure>
            </View>
          </View>
        </View>
      </ScrollView>
      <Row padX={24} padY={14} gap={16} style={{ borderTopWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, backgroundColor: theme.chrome.bg }}>
        <View style={{ flex: 1 }}>
          <Title size={14}>{`Bars ${setup.loopFromBar}–${setup.loopToBar}`}</Title>
          <Body size={12} color={theme.chrome.dim} numberOfLines={1}>{footerDetail}</Body>
        </View>
        <Button label={start.label} hint="→" tone="accent" onPress={() => { setPreviewFor(null); router.push(start.href); }} />
      </Row>
    </Screen>
  );
}
