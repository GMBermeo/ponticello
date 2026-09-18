import { memo } from 'react';
import { ScrollView } from 'react-native';

import { ListenMode } from '@/audio/backing/types';
import { Segmented } from '@/components/ui/controls';
import { Label, Row } from '@/components/ui/primitives';
import {
  NoteOverlayMode,
  ScoreColorMode,
  useAudioPreferences,
  useSettingsActions,
  useSettingsSelector,
  useVisionPreferences,
  VisionName,
} from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';

const VISION_SEGMENTS = [
  { value: 'tab' as const, label: 'Tab' },
  { value: 'score' as const, label: 'Score' },
  { value: 'highway' as const, label: 'Highway', hint: 'Highway' },
];

const LISTEN_SEGMENTS = [
  { value: 'off' as const, label: 'Off', hint: 'Listen: off' },
  { value: 'backing' as const, label: 'Backing', hint: 'Listen: backing only' },
  { value: 'solo' as const, label: 'Cello', hint: 'Listen: written cello part' },
  { value: 'both' as const, label: 'Both', hint: 'Listen: backing and cello' },
];

const OVERLAY_SEGMENTS = [
  { value: 'key' as const, label: 'Key', hint: 'Show key notes for improvising' },
  { value: 'song' as const, label: 'Song', hint: 'Show all notes in song' },
];

/**
 * Colouring the page, offered only where there is a page to colour.
 *
 * `String` answers "where does my hand go" — the same four hues as the rails
 * beside it. `Note` answers "what note is that", using the one colour-per-
 * letter constant the fingerboard chart prints. They are different questions,
 * so they are different modes rather than one switch.
 */
const SCORE_COLOR_SEGMENTS = [
  { value: 'off' as const, label: 'Ink', hint: 'Plain engraved noteheads' },
  { value: 'string' as const, label: 'String', hint: 'Colour each note by its string' },
  { value: 'note' as const, label: 'Note', hint: 'Colour each note by its name' },
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
