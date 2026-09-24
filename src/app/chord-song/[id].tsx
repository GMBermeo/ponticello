import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, FlatList, Platform, ScrollView, View } from 'react-native';

import {
  Body, Button, ChordChartCell, ChordChartLayoutContext, ChordReaderControls, ChordReaderHeader,
  ChordTransitionPreview, COMPACT_PREVIEW_SLOTS, DEFAULT_BPM, LyricLine, PREVIEW_SLOTS, Screen,
  ScreenHeader, Stack, Title, upcomingChords, useChordAutoScroll, useMeasuredSize,
  type ChartView, type ChordChartItem,
} from '@components';
import { ChordSheetLayout, sheetChordStudy, sheetTimeline, type ChordSheet } from '@domain';
import { getChordSheet, LIBRARY_ROWS } from '@scores';
import { useTheme } from '@theme';

/** Estimated row heights, in design units, before a line has been measured. */
const ESTIMATED_ROW_HEIGHT: Record<ChartView, number> = { names: 70, shapes: 280 };
/** Layout changes smaller than this are measurement noise, not a resize. */
const LAYOUT_TOLERANCE_PX = 1;

const chartItemKey = (item: ChordChartItem) => item.id;

function keepIfClose(previous: number, next: number): number {
  return Math.abs(previous - next) > LAYOUT_TOLERANCE_PX ? next : previous;
}

export default function ChordSongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sheet = getChordSheet(id);
  if (!sheet) {
    return (
      <Screen>
        <ScreenHeader backLabel="Library" />
        <Title>Chord chart unavailable</Title>
        <Body>Import a chart for this piece to read its chords.</Body>
      </Screen>
    );
  }
  return <ChordReader key={sheet.id} sheet={sheet} />;
}

/** Largest a preview diagram may be drawn, before the body has been measured and after. */
function diagramHeightLimit(bodyHeight: number, compact: boolean, s: (units: number) => number): number {
  if (bodyHeight <= 0) return s(compact ? 230 : 180);
  if (compact) return bodyHeight * 0.36;
  return Math.max(s(120), (bodyHeight - s(170)) / 2);
}

/** Side column holding the preview on wide screens. */
function PreviewPanel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: theme.s(310), borderLeftWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, backgroundColor: theme.chrome.surface }}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        {children}
      </ScrollView>
    </View>
  );
}

/** Stops the scroll whenever the reader leaves the foreground. */
function useStopWhenAway(stop: () => void): void {
  useFocusEffect(useCallback(() => stop, [stop]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
    });
    return () => listener.remove();
  }, [stop]);
}

function ChordReader({ sheet }: { sheet: ChordSheet }) {
  const theme = useTheme();
  const { push } = useRouter();
  const compact = theme.scale.compact;
  const timeline = useMemo(() => sheetTimeline(sheet), [sheet]);
  const studies = useMemo(
    () => new Map(sheet.chords.map((chord) => [chord.symbol, sheetChordStudy(chord)])),
    [sheet],
  );
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(sheet.bpm ?? DEFAULT_BPM);
  const [speed, setSpeed] = useState(1);
  const [chartView, setChartView] = useState<ChartView>('names');
  const [showTransition, setShowTransition] = useState(false);
  const [showKeyScale, setShowKeyScale] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [bodySize, onBodyLayout, bodyRef] = useMeasuredSize();
  const list = useRef<FlatList<ChordChartItem>>(null);

  // A width/mode change invalidates every wrapped row height and list metric.
  const layoutKey = `${chartView}:${Math.round(bodySize.width)}:${theme.scale.scale}`;
  const estimatedRowHeight = theme.s(ESTIMATED_ROW_HEIGHT[chartView]);
  const layout = useMemo(
    () => new ChordSheetLayout(sheet.lines.length, estimatedRowHeight, layoutKey),
    [sheet.lines.length, estimatedRowHeight, layoutKey],
  );
  const chartItems = useMemo<ChordChartItem[]>(() => [
    ...(compact ? [{ kind: 'preview' as const, id: 'preview' }] : []),
    ...sheet.lines.map((line, lineIndex) => ({ kind: 'line' as const, id: `line:${line.id}`, line, lineIndex })),
  ], [compact, sheet]);

  const pause = useCallback(() => setPlaying(false), []);
  useStopWhenAway(pause);
  const pinnedHeight = compact ? previewHeight : 0;
  const { activeIndex, seek, reset, onContentHeight } = useChordAutoScroll({
    timeline,
    layout,
    lineCount: sheet.lines.length,
    bpm,
    speed,
    playing,
    onStop: pause,
    list,
    viewportHeight,
    pinnedHeight,
    seekMargin: theme.s(16),
  });
  const active = timeline.events[activeIndex];
  const upcoming = upcomingChords(timeline.events, studies, activeIndex, compact ? COMPACT_PREVIEW_SLOTS : PREVIEW_SLOTS.length);
  const hasScore = LIBRARY_ROWS.some((row) => row.id === sheet.id && row.playable);
  const scaleKey = showKeyScale ? (sheet.key ?? undefined) : undefined;

  const selectChord = useCallback((lineIndex: number, changeIndex: number) => {
    seek(timeline.events.findIndex((event) => event.lineIndex === lineIndex && event.changeIndex === changeIndex));
  }, [seek, timeline]);

  const maxDiagramHeight = diagramHeightLimit(bodySize.height, compact, theme.s);
  const preview = (
    <ChordTransitionPreview
      upcoming={upcoming}
      compact={compact}
      showTransition={showTransition}
      scaleKey={scaleKey}
      maxDiagramHeight={maxDiagramHeight}
      onHeightChange={compact ? (height) => setPreviewHeight((previous) => keepIfClose(previous, height)) : undefined}
    />
  );

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Chords & lyrics">
        {hasScore ? (
          <Button label="Score setup" tone="ghost" onPress={() => { pause(); push(`/song/${sheet.id}`); }} />
        ) : null}
      </ScreenHeader>
      <View ref={bodyRef} onLayout={onBodyLayout} style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
        <ChordChartLayoutContext.Provider value={layout}>
          <FlatList
            key={layout.key}
            ref={list}
            data={chartItems}
            keyExtractor={chartItemKey}
            CellRendererComponent={ChordChartCell}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={5}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1, minWidth: 0 }}
            stickyHeaderIndices={compact ? [1] : undefined}
            testID="chord-song-scroll"
            onScrollBeginDrag={pause}
            {...(Platform.OS === 'web' ? { onWheel: pause } : {})}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              setViewportHeight((previous) => keepIfClose(previous, height));
            }}
            onContentSizeChange={(_, height) => onContentHeight(height)}
            scrollEventThrottle={32}
            contentContainerStyle={{ paddingBottom: Math.max(theme.s(30), viewportHeight * 0.65) }}
            ListHeaderComponent={
              <ChordReaderHeader
                sheet={sheet}
                chartView={chartView}
                onChartViewChange={(view) => { pause(); setChartView(view); }}
                showPreviewToggles={compact || chartView === 'names'}
                showTransition={showTransition}
                onShowTransitionChange={setShowTransition}
                showKeyScale={showKeyScale}
                onShowKeyScaleChange={setShowKeyScale}
                onLeave={pause}
              />
            }
            renderItem={({ item }) => {
              if (item.kind === 'preview') return preview;
              return (
                <View style={{ paddingHorizontal: theme.s(12) }}>
                  <LyricLine
                    line={item.line}
                    lineIndex={item.lineIndex}
                    activeChange={active?.lineIndex === item.lineIndex ? active.changeIndex : -1}
                    omitted={sheet.lyrics === 'omitted'}
                    mode={chartView}
                    studies={studies}
                    scaleKey={scaleKey}
                    onChord={selectChord}
                  />
                </View>
              );
            }}
            ListFooterComponent={
              <Stack pad={16} gap={6}>
                {sheet.credits ? (
                  <Body size={12} color={theme.chrome.dim} style={{ fontStyle: 'italic' }}>{sheet.credits}</Body>
                ) : null}
                <Body size={12} color={theme.chrome.dim}>End of chart</Body>
              </Stack>
            }
          />
        </ChordChartLayoutContext.Provider>
        {!compact && chartView === 'names' ? <PreviewPanel>{preview}</PreviewPanel> : null}
      </View>
      <ChordReaderControls
        bpm={bpm}
        onBpmChange={setBpm}
        speed={speed}
        onSpeedChange={setSpeed}
        playing={playing}
        onTogglePlaying={() => setPlaying((current) => !current)}
        onRestart={reset}
      />
    </Screen>
  );
}
