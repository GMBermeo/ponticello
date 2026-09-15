import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { pickMidi } from '@/audio/backing/pickMidi';
import { Button, PressableRow } from '@/components/ui/controls';
import { Body, Grow, Kicker, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { instrumentForProgram } from '@/domain/backing';
import { midiToPitchName } from '@/domain/cello';
import { importScore, suggestSoloTrack } from '@/domain/importScore';
import { ParsedMidi, parseMidi } from '@/domain/midi';
import { encodeForStorage, idForFile, MAX_MIDI_BYTES, useImportedLibrary } from '@/state/library';
import { useTheme } from '@/theme/ThemeProvider';

interface Staged {
  name: string;
  bytes: Uint8Array;
  parsed: ParsedMidi;
}

/**
 * Import a MIDI file.
 *
 * The app ships no third party's music, so this is how a piece you want to
 * practise gets in: bring a MIDI file you have the right to use, say which
 * track is the cello, and the app fingers that line and turns everything else
 * into the backing you play over.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const router = useRouter();
  const { add } = useImportedLibrary();

  const [staged, setStaged] = useState<Staged | null>(null);
  const [soloTrack, setSoloTrack] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await pickMidi();
      if (!picked) return;

      if (picked.bytes.length > MAX_MIDI_BYTES) {
        setError(`That file is ${(picked.bytes.length / 1024).toFixed(0)} KB; the limit is ${MAX_MIDI_BYTES / 1024} KB.`);
        return;
      }

      const parsed = parseMidi(picked.bytes);
      const playable = parsed.tracks.filter((t) => t.noteCount > 0);
      if (playable.length === 0) {
        setError('That file has no notes in it.');
        return;
      }

      setStaged({ name: picked.name, bytes: picked.bytes, parsed });
      setSoloTrack(suggestSoloTrack(parsed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const title = useMemo(
    () => (staged ? staged.name.replace(/\.midi?$/i, '').replace(/[_-]+/g, ' ').trim() : ''),
    [staged],
  );

  /** Dry run, so problems surface before the piece joins the library. */
  const preview = useMemo(() => {
    if (!staged || soloTrack === null) return null;
    try {
      const piece = importScore(staged.parsed, {
        id: 'preview', title, composer: 'Imported', soloTrack,
      });
      return { piece, error: null as string | null };
    } catch (cause) {
      return { piece: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [staged, soloTrack, title]);

  const save = useCallback(() => {
    if (!staged || soloTrack === null) return;
    try {
      add({
        id: idForFile(staged.name),
        title,
        composer: 'Imported',
        soloTrack,
        bpm: staged.parsed.bpm,
        data: encodeForStorage(staged.bytes),
      });
      router.replace('/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [staged, soloTrack, title, add, router]);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Import music" />

      <Screen padded={false}>
        <Stack padX={22} padY={18} gap={10}>
          <Kicker size={10}>ADD A PIECE</Kicker>
          <Title accessibilityRole="header" size={30}>Import a MIDI file</Title>
          <Body size={14} color={chrome.dim}>
            Pick a file, say which track is the cello, and the app works out a fingering for that
            line and turns everything else into a backing track you can play over. The file stays
            on this device.
          </Body>
          <Button
            label={staged ? 'Choose a different file' : 'Choose a MIDI file'}
            hint={busy ? 'OPENING…' : '.MID'}
            tone={staged ? 'default' : 'accent'}
            onPress={choose}
            disabled={busy}
          />
          {error === null ? null : <Body size={13} color={chrome.accent}>{error}</Body>}
        </Stack>

        {staged === null ? (
          <>
            <Rule weight={2} />
            <Stack padX={22} padY={18} gap={8}>
              <Label size={11}>WHERE TO FIND FILES</Label>
              <Body size={13} color={chrome.dim}>
                For classical repertoire, the Mutopia Project publishes public-domain editions with
                MIDI alongside them, including all six Bach cello suites. Anything you import stays
                on this device and is yours to study — practice, analysis, reading. Clear the rights
                yourself before performing or sharing what comes out.
              </Body>
            </Stack>
          </>
        ) : (
          <>
            <Rule weight={2} />
            <Stack padX={22} padY={16} gap={4}>
              <Label size={11}>{staged.name.toUpperCase()}</Label>
              <Row gap={14} style={{ flexWrap: 'wrap' }}>
                <Num size={13}>{`${staged.parsed.bpm} BPM`}</Num>
                <Num size={13}>{staged.parsed.timeSignature.join('/')}</Num>
                <Num size={13}>{`${(staged.parsed.durationMs / 1000).toFixed(0)}s`}</Num>
                <Num size={13}>{`${staged.parsed.notes.length} NOTES`}</Num>
              </Row>
            </Stack>

            <Rule weight={2} />
            <Stack padX={22} padY={14} gap={4}>
              <Label size={11}>WHICH TRACK IS THE CELLO?</Label>
              <Body size={12} color={chrome.dim}>
                That track gets fingered and drawn in the visions. Every other track becomes the
                backing.
              </Body>
            </Stack>

            {staged.parsed.tracks.filter((t) => t.noteCount > 0).map((track) => {
              const selected = soloTrack === track.index;
              return (
                <View key={track.index}>
                  <PressableRow
                    accessibilityLabel={`Use ${track.name ?? `track ${track.index + 1}`} as the cello line`}
                    selected={selected}
                    onPress={() => setSoloTrack(track.index)}
                  >
                    <Row padX={22} padY={12} gap={12}>
                      <View
                        style={{
                          width: theme.s(16),
                          height: theme.s(16),
                          borderWidth: theme.rule(2),
                          borderColor: selected ? chrome.accent : chrome.line,
                          backgroundColor: selected ? chrome.accent : 'transparent',
                        }}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Title size={15}>{track.name || `Track ${track.index + 1}`}</Title>
                        <Row gap={12} style={{ flexWrap: 'wrap', marginTop: theme.s(3) }}>
                          <Label size={10}>
                            {instrumentForProgram(track.program, track.isPercussion).toUpperCase()}
                          </Label>
                          <Label size={10}>{`${track.noteCount} NOTES`}</Label>
                          <Label size={10}>
                            {`${midiToPitchName(track.lowestMidi)}–${midiToPitchName(track.highestMidi)}`}
                          </Label>
                          {track.isPercussion ? (
                            <Label size={10} color={chrome.accent}>PERCUSSION</Label>
                          ) : null}
                        </Row>
                      </View>
                    </Row>
                  </PressableRow>
                  <Rule />
                </View>
              );
            })}

            <Stack padX={22} padY={18} gap={10}>
              {preview?.error ? (
                <Body size={13} color={chrome.accent}>{preview.error}</Body>
              ) : preview?.piece ? (
                <>
                  <Label size={11}>WHAT YOU WILL GET</Label>
                  <Row gap={16} style={{ flexWrap: 'wrap' }}>
                    <Num size={14}>{`${preview.piece.score.notes.length} NOTES`}</Num>
                    <Num size={14}>{`${preview.piece.score.measures.length} BARS`}</Num>
                    <Num size={14}>{`${preview.piece.shiftCount} SHIFTS`}</Num>
                    <Num size={14}>
                      {`${preview.piece.backing.parts.filter((p) => p.role === 'accompaniment').length} BACKING PARTS`}
                    </Num>
                  </Row>
                  {preview.piece.skippedNotes > 0 ? (
                    <Body size={12} color={chrome.dim}>
                      {`${preview.piece.skippedNotes} notes fall outside the cello's range and were dropped. Notes merely too high are moved down an octave rather than lost.`}
                    </Body>
                  ) : null}
                </>
              ) : null}

              <Button
                label="Add to library"
                tone="accent"
                onPress={save}
                disabled={soloTrack === null || !preview?.piece}
              />
              <Grow />
            </Stack>
          </>
        )}
      </Screen>
    </Screen>
  );
}
