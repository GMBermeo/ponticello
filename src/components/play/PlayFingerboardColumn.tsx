import { memo } from 'react';
import { View } from 'react-native';

import { Fingerboard, FingerboardProps, FingerboardStringLabels } from '@/components/Fingerboard';
import { useMeasuredSize } from '@/components/useMeasuredSize';
import { Label, Row } from '@/components/ui/primitives';
import { fingerboardExtentMm } from '@/domain/cello';
import { CelloSongScore } from '@/domain/schema';
import {
  shallowEqual,
  useSettingsSelector,
  useTapeSettings,
  useVisionPreferences,
} from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { Playhead, usePlayheadPosition } from './usePlayhead';

export interface PlayFingerboardColumnProps {
  width: number;
  /** The least the drawing must cover for this piece, in millimetres. */
  fretboardMinMm: number;
  songKeyName?: string;
  noteOverlay?: FingerboardProps['noteOverlay'];
  score: CelloSongScore;
  /** Subscribed to here, so a note change re-renders this column and not its parent. */
  playhead: Pick<Playhead, 'getPosition' | 'subscribePosition'>;
}

export const PlayFingerboardColumn = memo(function PlayFingerboardColumn({
  width,
  fretboardMinMm,
  songKeyName,
  noteOverlay,
  score,
  playhead,
}: PlayFingerboardColumnProps) {
  const theme = useTheme();
  const [boardSize, onBoardLayout, boardRef] = useMeasuredSize();
  const { activeIndex } = usePlayheadPosition(playhead);
  const activeNote = score.notes[activeIndex] ?? null;
  const nextNote = score.notes[activeIndex + 1] ?? null;

  /**
   * What the piece needs, widened to whatever the column can show without
   * stretching the board — see `fingerboardExtentMm`. A first-position study on
   * a tall phone gets the whole tape ladder rather than four tapes spread over
   * the height of the screen.
   */
  const maxMm = fingerboardExtentMm(
    fretboardMinMm,
    theme.scale.scale > 0 ? boardSize.height / theme.scale.scale : 0,
  );

  const { tapeSets } = useTapeSettings();
  const { showTapes, showAlternatePlacements } = useVisionPreferences();
  const { cueDensity, boardView, noteOverlayMode } = useSettingsSelector((s) => ({
    cueDensity: s.cueDensity,
    boardView: s.boardView,
    noteOverlayMode: s.noteOverlay,
  }), shallowEqual);

  const labelText = noteOverlayMode === 'song' ? 'Song notes' : songKeyName ?? 'Fingerboard';

  return (
    <View
      style={{
        width: theme.s(width),
        paddingHorizontal: theme.s(8),
        paddingTop: theme.s(6),
        borderRightWidth: theme.rule(1),
        borderColor: theme.chrome.lineSoft,
      }}
    >
      <Row gap={6} style={{ alignItems: 'center', minHeight: theme.s(24) }}>
        <Label size={11} numberOfLines={1}>{labelText}</Label>
      </Row>
      <View ref={boardRef} style={{ flex: 1, marginTop: theme.s(6) }} onLayout={onBoardLayout}>
        <Fingerboard
          height={boardSize.height}
          maxMm={maxMm}
          tapeSets={tapeSets}
          showTapes={showTapes}
          showLandmarks={cueDensity === 'full'}
          noteOverlay={noteOverlay}
          gutter={46}
          compact
          invert={boardView === 'player'}
          active={activeNote}
          next={nextNote}
          showAlternates={showAlternatePlacements}
        />
      </View>
      <FingerboardStringLabels compact gutter={46} activeString={activeNote?.string ?? null} />
    </View>
  );
});
