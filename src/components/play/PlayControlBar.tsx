import { memo } from 'react';
import { ScrollView } from 'react-native';

import type { ListenMode } from '@domain';
import { Segmented, Label, Row, type Segment } from '../ui';
import {
  NoteOverlayMode, ScoreColorMode, useAudioPreferences, useSettingsActions, useSettingsSelector,
  useVisionPreferences, VisionName,
} from '@state';
import { useTheme } from '@theme';

const VISION_SEGMENTS: readonly Segment<VisionName>[] = [
  { value: 'tab', label: 'Tab' },
  { value: 'score', label: 'Score' },
  { value: 'highway', label: 'Highway', hint: 'Highway' },
];

const LISTEN_SEGMENTS: readonly Segment<ListenMode>[] = [
  { value: 'off', label: 'Off', hint: 'Listen: off' },
  { value: 'backing', label: 'Backing', hint: 'Listen: backing only' },
  { value: 'solo', label: 'Cello', hint: 'Listen: written cello part' },
  { value: 'both', label: 'Both', hint: 'Listen: backing and cello' },
];

const OVERLAY_SEGMENTS: readonly Segment<Exclude<NoteOverlayMode, 'off'>>[] = [
  { value: 'key', label: 'Key', hint: 'Show key notes for improvising' },
  { value: 'song', label: 'Song', hint: 'Show all notes in song' },
];

/**
 * Colouring the page, offered only where there is a page to colour.
 *
 * `String` answers "where does my hand go" — the same four hues as the rails
 * beside it. `Note` answers "what note is that", using the one colour-per-
 * letter constant the fingerboard chart prints. They are different questions,
 * so they are different modes rather than one switch.
 */
const SCORE_COLOR_SEGMENTS: readonly Segment<ScoreColorMode>[] = [
  { value: 'off', label: 'Ink', hint: 'Plain engraved noteheads' },
  { value: 'string', label: 'String', hint: 'Colour each note by its string' },
  { value: 'note', label: 'Note', hint: 'Colour each note by its name' },
];

const CONTROL_BAR_HEIGHT = 60;

export const PlayControlBar = memo(function PlayControlBar() {
  const theme = useTheme();
  const { vision } = useVisionPreferences();
  const { listenMode } = useAudioPreferences();
  const noteOverlay = useSettingsSelector((s) => s.noteOverlay);
  const scoreColor = useSettingsSelector((s) => s.scoreColor);
  const { update } = useSettingsActions();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ alignItems: 'center', gap: theme.s(18), paddingHorizontal: theme.s(16) }}
      style={{
        height: Math.max(theme.tap + theme.s(12), theme.s(CONTROL_BAR_HEIGHT)),
        flexGrow: 0,
        backgroundColor: theme.chrome.bg,
      }}
    >
      <Row gap={8}>
        <Label size={10}>View</Label>
        <Segmented
          accessibilityLabel="Music view"
          segments={VISION_SEGMENTS}
          value={vision}
          onChange={(v: VisionName) => update({ vision: v })}
          compact
        />
      </Row>
      <Row gap={8}>
        <Label size={10}>Sound</Label>
        <Segmented
          accessibilityLabel="Playback sound"
          segments={LISTEN_SEGMENTS}
          value={listenMode}
          onChange={(m: ListenMode) => update({ listenMode: m })}
          compact
        />
      </Row>
      {vision === 'score' ? (
        <Row gap={8}>
          <Label size={10}>Colour</Label>
          <Segmented
            accessibilityLabel="Colour the noteheads"
            segments={SCORE_COLOR_SEGMENTS}
            value={scoreColor}
            onChange={(c: ScoreColorMode) => update({ scoreColor: c })}
            compact
          />
        </Row>
      ) : null}
      <Row gap={8}>
        <Label size={10}>Notes</Label>
        <Segmented
          accessibilityLabel="Fingerboard notes"
          segments={OVERLAY_SEGMENTS}
          value={noteOverlay === 'song' ? 'song' : 'key'}
          onChange={(o: NoteOverlayMode) => update({ noteOverlay: o })}
          compact
        />
      </Row>
    </ScrollView>
  );
});
