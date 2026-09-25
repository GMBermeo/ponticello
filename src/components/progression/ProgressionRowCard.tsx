import { Platform, Pressable, View } from 'react-native';

import type { ProgressionFlattenedChord, ProgressionRowItem } from '@domain';
import { RADIUS, useTheme, type Chrome } from '@theme';

import { CelloChordDiagram } from '../CelloChordDiagram';
import { Body, Button, Label, Row, Title } from '../ui';
import { sameCell, type GridCell } from './progressionOptions';

/** The moves a chord card offers, each already bound to its cell. */
export type ChordCardActions = {
  remove: (cell: GridCell) => void;
  moveLeft: (cell: GridCell) => void;
  moveRight: (cell: GridCell) => void;
  moveUp: (cell: GridCell) => void;
  moveDown: (cell: GridCell) => void;
  select: (globalIndex: number) => void;
  dragStart: (cell: GridCell) => void;
  dragOver: (cell: GridCell) => void;
  dragEnd: () => void;
  drop: (cell: GridCell) => void;
  recordPosition: (globalIndex: number, y: number) => void;
};

export type ChordCardState = {
  /** Look up a chord's place in the flattened, playable order. */
  flatAt: (cell: GridCell) => ProgressionFlattenedChord | undefined;
  playingIndex: number | null;
  dragged: GridCell | null;
  dropTarget: GridCell | null;
  showTransition: boolean;
  scaleKey: string | undefined;
  /** Every position of each chord's notes — see `ChordDiagramOptions.allPositions`. */
  allPositions: boolean;
  rowCount: number;
};

type PreventableEvent = { preventDefault?: () => void };

/** HTML5 drag-and-drop, which only the web build has. */
function webDragProps(cell: GridCell, actions: ChordCardActions) {
  if (Platform.OS !== 'web') return {};
  return {
    draggable: true,
    onDragStart: () => actions.dragStart(cell),
    onDragOver: (event: PreventableEvent) => {
      event.preventDefault?.();
      actions.dragOver(cell);
    },
    onDragEnd: actions.dragEnd,
    onDrop: (event: PreventableEvent) => {
      event.preventDefault?.();
      actions.drop(cell);
    },
  };
}

function cardBorderColor(playing: boolean, dropTarget: boolean, chrome: Chrome): string {
  if (playing) return chrome.accent;
  return dropTarget ? chrome.strings.D : chrome.lineSoft;
}

type ChordCardProps = {
  cell: GridCell;
  symbol: string;
  degree: string | null | undefined;
  rowLength: number;
  state: ChordCardState;
  actions: ChordCardActions;
};

function ChordCard({ cell, symbol, degree, rowLength, state, actions }: ChordCardProps) {
  const theme = useTheme();
  const { s, chrome } = theme;
  const flat = state.flatAt(cell);
  const playing = flat !== undefined && state.playingIndex === flat.globalIndex;
  const dragged = sameCell(state.dragged, cell.row, cell.col);
  const dropTarget = sameCell(state.dropTarget, cell.row, cell.col);
  return (
    <View
      onLayout={(event) => { if (flat) actions.recordPosition(flat.globalIndex, event.nativeEvent.layout.y); }}
      {...webDragProps(cell, actions)}
      style={{
        width: s(130), backgroundColor: playing ? chrome.accentWash : chrome.bg, borderRadius: s(RADIUS.md),
        borderWidth: playing ? 2 : theme.rule(1), borderColor: cardBorderColor(playing, dropTarget, chrome),
        opacity: dragged ? 0.4 : 1, padding: s(8), alignItems: 'center', gap: s(4),
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      }}
    >
      <Row style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label size={11} color={chrome.accent}>{degree ?? ''}</Label>
        <Pressable hitSlop={6} accessibilityLabel={`Remove ${symbol}`} onPress={() => actions.remove(cell)}>
          <Body size={12} color={chrome.dim}>✕</Body>
        </Pressable>
      </Row>
      <Pressable onPress={() => { if (flat) actions.select(flat.globalIndex); }}>
        <Title size={20}>{symbol}</Title>
      </Pressable>
      <View style={{ width: s(114), marginVertical: s(4) }}>
        {flat?.study ? (
          <CelloChordDiagram
            chord={flat.study}
            measuredWidth={s(114)}
            presentation="atlas"
            tapeColors
            nextChord={state.showTransition ? (flat.nextChord ?? undefined) : undefined}
            scaleKey={state.scaleKey}
            allPositions={state.allPositions}
          />
        ) : (
          <View style={{ height: s(140), justifyContent: 'center', alignItems: 'center' }}>
            <Body size={11} color={chrome.dim}>Shape unavailable</Body>
          </View>
        )}
      </View>
      <Row gap={3} style={{ width: '100%', justifyContent: 'center', marginTop: s(2), borderTopWidth: theme.rule(1), borderColor: chrome.lineSoft, paddingTop: s(4) }}>
        <Button label="←" disabled={cell.col === 0} tone="ghost" onPress={() => actions.moveLeft(cell)} />
        <Button label="→" disabled={cell.col === rowLength - 1} tone="ghost" onPress={() => actions.moveRight(cell)} />
        <Button label="↑" disabled={cell.row === 0} tone="ghost" onPress={() => actions.moveUp(cell)} />
        <Button label="↓" disabled={cell.row === state.rowCount - 1} tone="ghost" onPress={() => actions.moveDown(cell)} />
      </Row>
    </View>
  );
}

function EmptyRow() {
  const { s, chrome } = useTheme();
  return (
    <View style={{ flex: 1, minHeight: s(100), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: chrome.line, borderRadius: s(8), padding: s(16) }}>
      <Body size={13} color={chrome.dim}>No chords in this row. Tap chords above to add!</Body>
    </View>
  );
}

export type ProgressionRowCardProps = {
  row: ProgressionRowItem;
  rowIndex: number;
  isTarget: boolean;
  onTarget: () => void;
  onDelete: (() => void) | undefined;
  state: ChordCardState;
  actions: ChordCardActions;
};

/** One row of the progression: its header, and its chords as reorderable cards. */
export function ProgressionRowCard({ row, rowIndex, isTarget, onTarget, onDelete, state, actions }: ProgressionRowCardProps) {
  const theme = useTheme();
  const { s, chrome } = theme;
  const chordWord = row.chords.length === 1 ? 'chord' : 'chords';
  return (
    <View style={{ backgroundColor: chrome.surface, borderRadius: s(RADIUS.lg), borderCurve: 'continuous', borderWidth: theme.rule(2), borderColor: isTarget ? chrome.accent : 'transparent', padding: s(12), gap: s(12) }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Pressable onPress={onTarget} style={{ paddingHorizontal: s(8), paddingVertical: s(4), borderRadius: s(4), backgroundColor: isTarget ? chrome.accent : chrome.surfaceElevated }}>
            <Title size={13} color={isTarget ? '#ffffff' : chrome.ink}>{row.label}</Title>
          </Pressable>
          <Body size={11} color={chrome.dim}>{row.chords.length} {chordWord}</Body>
        </Row>
        <Row gap={6}>
          <Button label="+ Add chord" tone="ghost" onPress={onTarget} />
          {onDelete ? <Button label="Delete row" tone="ghost" onPress={onDelete} /> : null}
        </Row>
      </Row>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s(12), minHeight: s(120), alignItems: 'flex-start' }}>
        {row.chords.length === 0 ? <EmptyRow /> : row.chords.map((chord, col) => (
          <ChordCard
            key={chord.id}
            cell={{ row: rowIndex, col }}
            symbol={chord.symbol}
            degree={chord.degree}
            rowLength={row.chords.length}
            state={state}
            actions={actions}
          />
        ))}
      </View>
    </View>
  );
}
