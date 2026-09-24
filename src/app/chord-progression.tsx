import { useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';

import {
  Button, exportProgressionJson, PresetsModal, ProgressionControls, ProgressionRowCard,
  ProgressionSetupPanel, Row, SavedProgressionsModal, Screen, ScreenHeader, useProgressionPlayback,
  useProgressionStorage, type ChordCardActions, type ChordCardState, type GridCell,
} from '@components';
import {
  addChordToRow, addRow, applyPreset, createDefaultProgression, END_OF_ROW, flattenProgression,
  moveChordBetweenRows, moveChordWithinRow, removeChord, removeRow, type CelloChordStudy,
  type ChordFamily, type CustomProgressionData, type ProgressionFlattenedChord,
} from '@domain';
import { useTheme } from '@theme';

/** Room left above the sounding chord when playback scrolls to it, in design units. */
const PLAYBACK_SCROLL_MARGIN = 120;

export default function ChordProgressionScreen() {
  const { s } = useTheme();
  const { progression, setProgression, saved, justSaved, save, remove } = useProgressionStorage();
  const [targetRow, setTargetRow] = useState(0);
  const [family, setFamily] = useState<ChordFamily>('triads');
  const [showTransition, setShowTransition] = useState(true);
  const [showKeyScale, setShowKeyScale] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [dragged, setDragged] = useState<GridCell | null>(null);
  const [dropTarget, setDropTarget] = useState<GridCell | null>(null);
  const [speed, setSpeed] = useState(1);
  const scroll = useRef<ScrollView>(null);

  // One cache for the screen's life, so a chord symbol is parsed once.
  const studyCache = useMemo(() => new Map<string, CelloChordStudy | null>(), []);
  const flattened = useMemo(() => flattenProgression(progression, studyCache), [progression, studyCache]);
  const flatByCell = useMemo(
    () => new Map<string, ProgressionFlattenedChord>(flattened.map((flat) => [`${flat.rowIndex}:${flat.chordIndex}`, flat])),
    [flattened],
  );

  const playback = useProgressionPlayback({
    chordCount: flattened.length,
    bpm: progression.bpm,
    beatsPerChord: progression.beatsPerChord,
    speed,
    scroll,
    scrollMargin: s(PLAYBACK_SCROLL_MARGIN),
  });

  const edit = (change: (previous: CustomProgressionData) => CustomProgressionData) => setProgression(change);
  const patch = (fields: Partial<CustomProgressionData>) => edit((previous) => ({ ...previous, ...fields }));
  const rowCount = progression.rows.length;

  const endDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };

  const actions: ChordCardActions = {
    remove: ({ row, col }) => edit((previous) => removeChord(previous, row, col)),
    moveLeft: ({ row, col }) => edit((previous) => moveChordWithinRow(previous, row, col, col - 1)),
    moveRight: ({ row, col }) => edit((previous) => moveChordWithinRow(previous, row, col, col + 1)),
    moveUp: ({ row, col }) => edit((previous) => moveChordBetweenRows(previous, row, col, row - 1, END_OF_ROW)),
    moveDown: ({ row, col }) => edit((previous) => moveChordBetweenRows(previous, row, col, row + 1, END_OF_ROW)),
    select: playback.setActiveIndex,
    dragStart: setDragged,
    dragOver: setDropTarget,
    dragEnd: endDrag,
    drop: (target) => {
      if (!dragged) return;
      edit((previous) => (dragged.row === target.row
        ? moveChordWithinRow(previous, target.row, dragged.col, target.col)
        : moveChordBetweenRows(previous, dragged.row, dragged.col, target.row, target.col)));
      endDrag();
    },
    recordPosition: playback.recordChordPosition,
  };

  const cardState: ChordCardState = {
    flatAt: ({ row, col }) => flatByCell.get(`${row}:${col}`),
    playingIndex: playback.playing ? playback.activeIndex : null,
    dragged,
    dropTarget,
    showTransition,
    scaleKey: showKeyScale ? progression.keyRoot : undefined,
    rowCount,
  };

  const addToTargetRow = (symbol: string, degree: string | null | undefined) => {
    const row = Math.min(targetRow, rowCount - 1);
    edit((previous) => addChordToRow(previous, row, symbol, degree));
  };

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Chord progression">
        <Row gap={6} style={{ alignItems: 'center' }}>
          <Button label={justSaved ? '✓ Saved!' : 'Save'} tone={justSaved ? 'accent' : 'default'} onPress={save} />
          <Button label={`Saved (${saved.length})`} tone="ghost" onPress={() => setSavedOpen(true)} />
          <Button label="Presets" tone="ghost" onPress={() => setPresetsOpen(true)} />
          <Button label="Clear" tone="ghost" onPress={() => setProgression(createDefaultProgression())} />
        </Row>
      </ScreenHeader>

      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: s(16), paddingBottom: s(110), gap: s(16) }}>
        <ProgressionSetupPanel
          progression={progression}
          onChange={patch}
          justSaved={justSaved}
          onSave={save}
          onExport={() => exportProgressionJson(progression)}
          family={family}
          onFamilyChange={setFamily}
          showTransition={showTransition}
          onShowTransitionChange={setShowTransition}
          showKeyScale={showKeyScale}
          onShowKeyScaleChange={setShowKeyScale}
          targetRow={targetRow}
          onAddChord={addToTargetRow}
        />
        {progression.rows.map((row, rowIndex) => (
          <ProgressionRowCard
            key={row.id}
            row={row}
            rowIndex={rowIndex}
            isTarget={targetRow === rowIndex}
            onTarget={() => setTargetRow(rowIndex)}
            onDelete={rowCount > 1 ? () => edit((previous) => removeRow(previous, rowIndex)) : undefined}
            state={cardState}
            actions={actions}
          />
        ))}
        <Button label="+ Add new row" tone="default" onPress={() => edit(addRow)} />
      </ScrollView>

      <ProgressionControls
        key={progression.bpm}
        bpm={progression.bpm}
        onBpmChange={(bpm) => patch({ bpm })}
        beatsPerChord={progression.beatsPerChord}
        onBeatsPerChordChange={(beatsPerChord) => patch({ beatsPerChord })}
        speed={speed}
        onSpeedChange={setSpeed}
        playing={playback.playing}
        onTogglePlaying={playback.togglePlaying}
        onRestart={playback.restart}
      />

      <PresetsModal
        visible={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        onApply={(presetId) => {
          setProgression(applyPreset(presetId, progression.bpm, progression.beatsPerChord));
          setPresetsOpen(false);
        }}
      />
      <SavedProgressionsModal
        visible={savedOpen}
        onClose={() => setSavedOpen(false)}
        saved={saved}
        onLoad={(entry) => {
          setProgression(entry.data);
          setSavedOpen(false);
        }}
        onExport={(entry) => exportProgressionJson(entry.data)}
        onDelete={remove}
        onSaveCurrent={save}
      />
    </Screen>
  );
}
