import {
  ChordChartCell,
  ChordChartLayoutContext,
  type ChordChartItem,
} from "@/components/chords/ChordChartCell";
import { ChordSongShape } from "@/components/chords/ChordSongShape";
import { Button, Segmented, Stepper, Toggle } from "@/components/ui/controls";
import { Body, Label, Row, Stack, Title } from "@/components/ui/primitives";
import { Screen, ScreenHeader } from "@/components/ui/Screen";
import { useMeasuredSize } from "@/components/useMeasuredSize";
import type { CelloChordStudy } from "@/domain/celloChords";
import {
  beatAtTime,
  eventAtBeat,
  sheetChordStudy,
  sheetLineSegments,
  sheetScrollY,
  sheetTimeline,
  type ChordSheet,
  type SheetLine,
} from "@/domain/chordSheet";
import { ChordSheetLayout } from "@/domain/chordSheetLayout";
import { LIBRARY_ROWS } from "@/scores";
import { getChordSheet } from "@/scores/chordSheets";
import { useTheme } from "@/theme/ThemeProvider";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { SvgXml } from "react-native-svg";

const SPOTIFY_ROUND_ICON_XML = `
<svg viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="12" fill="#1DB954"/>
  <path d="M17.9 10.9C14.3 8.8 8.4 8.6 5 9.6c-.6.2-1.1-.2-1.3-.7-.2-.6.2-1.1.7-1.3 4-1.2 10.5-1 14.7 1.5.5.3.7 1 .4 1.5-.3.4-1 .6-1.6.3zm-.2 2.8c-.2.4-.7.5-1.1.3-3-1.8-7.5-2.3-11-1.3-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 4-1.2 9.1-.6 12.5 1.5.4.1.5.7.1 1zm-1.3 2.7c-.2.3-.6.4-.9.2-2.6-1.6-5.8-1.9-9.7-1.1-.3.1-.7-.1-.8-.5-.1-.3.1-.7.5-.8 4.2-.9 7.8-.6 10.7 1.2.3.2.4.6.2 1z" fill="#000000"/>
</svg>
`;

type ChartView = "names" | "shapes";
const CHART_VIEWS = [
  { value: "names", label: "Chord names" },
  { value: "shapes", label: "Chord shapes" },
] as const;

export default function ChordSongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sheet = getChordSheet(id);
  if (!sheet)
    return (
      <Screen>
        <ScreenHeader backLabel="Library" />
        <Title>Chord chart unavailable</Title>
        <Body>Import a chart for this piece to read its chords.</Body>
      </Screen>
    );
  return <ChordReader key={sheet.id} sheet={sheet} />;
}

function ChordReader({ sheet }: { sheet: ChordSheet }) {
  const theme = useTheme();
  const { push } = useRouter();
  const compact = theme.scale.compact;
  const timeline = useMemo(() => sheetTimeline(sheet), [sheet]);
  const studies = useMemo(
    () =>
      new Map(
        sheet.chords.map((chord) => [chord.symbol, sheetChordStudy(chord)]),
      ),
    [sheet],
  );
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(sheet.bpm ?? 80);
  const [bpmText, setBpmText] = useState(String(sheet.bpm ?? 80));
  const [speed, setSpeed] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [chartView, setChartView] = useState<ChartView>("names");
  const [showTransition, setShowTransition] = useState(false);
  const [showKeyScale, setShowKeyScale] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [bodySize, onBodyLayout, bodyRef] = useMeasuredSize();
  const scroll = useRef<FlatList<ChordChartItem>>(null);
  const tempoScroll = useRef<ScrollView>(null);
  // A width/mode change invalidates every wrapped row height and list metric.
  const layoutKey = `${chartView}:${Math.round(bodySize.width)}:${theme.scale.scale}`;
  const estimatedRowHeight = theme.s(chartView === "shapes" ? 280 : 70);
  const layout = useMemo(
    () =>
      new ChordSheetLayout(sheet.lines.length, estimatedRowHeight, layoutKey),
    [sheet.lines.length, estimatedRowHeight, layoutKey],
  );
  const chartItems = useMemo<ChordChartItem[]>(
    () => [
      ...(compact ? [{ kind: "preview" as const, id: "preview" }] : []),
      ...sheet.lines.map((line, lineIndex) => ({
        kind: "line" as const,
        id: `line:${line.id}`,
        line,
        lineIndex,
      })),
    ],
    [compact, sheet],
  );
  const contentHeight = useRef(0);
  const beat = useRef(0);
  const anchor = useRef({ beat: 0, ms: 0 });
  const activeRef = useRef(0);
  const bpmInputFocused = useRef(false);
  const chord0 = timeline.events[activeIndex];
  const chord1 = timeline.events[activeIndex + 1];
  const chord2 = timeline.events[activeIndex + 2];
  const chord3 = timeline.events[activeIndex + 3];
  const study0 = studies.get(chord0?.symbol ?? "");
  const study1 = studies.get(chord1?.symbol ?? "");
  const study2 = studies.get(chord2?.symbol ?? "");
  const study3 = studies.get(chord3?.symbol ?? "");
  const active = chord0;
  const pinnedHeight = compact ? previewHeight : 0;
  const pause = useCallback(() => setPlaying(false), []);
  const hasScore = LIBRARY_ROWS.some(
    (row) => row.id === sheet.id && row.playable,
  );

  useFocusEffect(useCallback(() => () => setPlaying(false), []));
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") setPlaying(false);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (beat.current >= timeline.totalBeats) beat.current = 0;
    anchor.current = { beat: beat.current, ms: performance.now() };
    let frame = 0;
    const tick = (now: number) => {
      beat.current = Math.min(
        timeline.totalBeats,
        beatAtTime(anchor.current.beat, anchor.current.ms, now, bpm, speed),
      );
      const index = Math.max(0, eventAtBeat(timeline.events, beat.current));
      if (index !== activeRef.current) {
        activeRef.current = index;
        setActiveIndex(index);
      }
      const desired = sheetScrollY(
        beat.current,
        timeline.starts,
        layout.offsets(),
        layout.offset(sheet.lines.length),
        timeline.totalBeats,
      );
      const readingHeight = Math.max(0, viewportHeight - pinnedHeight);
      const y = Math.max(
        0,
        Math.min(
          Math.max(0, contentHeight.current - viewportHeight),
          desired - pinnedHeight - readingHeight * 0.25,
        ),
      );
      scroll.current?.scrollToOffset({ offset: y, animated: false });
      if (beat.current >= timeline.totalBeats) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Snapshot absolute time on pause/rate change; never accumulate frame deltas.
      beat.current = Math.min(
        timeline.totalBeats,
        beatAtTime(
          anchor.current.beat,
          anchor.current.ms,
          performance.now(),
          bpm,
          speed,
        ),
      );
    };
  }, [
    playing,
    bpm,
    speed,
    timeline,
    viewportHeight,
    pinnedHeight,
    layout,
    sheet.lines.length,
  ]);

  const seek = useCallback(
    (index: number) => {
      const event = timeline.events[index];
      if (!event) return;
      setPlaying(false);
      // Cleanup of a running clock must not overwrite the new position.
      anchor.current = { beat: event.beat, ms: performance.now() };
      beat.current = event.beat;
      activeRef.current = index;
      setActiveIndex(index);
      const y = Math.max(
        0,
        layout.offset(event.lineIndex) - pinnedHeight - theme.s(16),
      );
      scroll.current?.scrollToOffset({ offset: y, animated: false });
    },
    [timeline, pinnedHeight, theme, layout],
  );
  const reset = useCallback(() => {
    seek(0);
    beat.current = 0;
    anchor.current = { beat: 0, ms: performance.now() };
    scroll.current?.scrollToOffset({ offset: 0, animated: false });
  }, [seek]);
  const commitBpm = () => {
    bpmInputFocused.current = false;
    const value = Number(bpmText);
    if (Number.isFinite(value) && value >= 20 && value <= 300) setBpm(value);
    else setBpmText(String(bpm));
  };
  const revealPriorityControls = () =>
    tempoScroll.current?.scrollToEnd({ animated: false });
  const selectChord = useCallback(
    (lineIndex: number, changeIndex: number) => {
      seek(
        timeline.events.findIndex(
          (event) =>
            event.lineIndex === lineIndex && event.changeIndex === changeIndex,
        ),
      );
    },
    [seek, timeline],
  );
  const maxDiagramHeight =
    bodySize.height > 0
      ? compact
        ? bodySize.height * 0.36
        : Math.max(theme.s(120), (bodySize.height - theme.s(170)) / 2)
      : theme.s(compact ? 230 : 180);
  const preview = (
    <View
      testID="chord-transition-preview"
      onLayout={
        compact
          ? (e) => {
              const nextHeight = e.nativeEvent.layout.height;
              setPreviewHeight((height) =>
                Math.abs(height - nextHeight) > 1 ? nextHeight : height,
              );
            }
          : undefined
      }
      style={{
        padding: theme.s(8),
        backgroundColor: theme.chrome.surface,
        borderBottomWidth: compact ? theme.rule(1) : 0,
        borderColor: theme.chrome.lineSoft,
        gap: theme.s(8),
      }}
    >
      <Row gap={compact ? 8 : 12} style={{ alignItems: "flex-start" }}>
        <ChordSongShape
          label="Current"
          symbol={chord0?.symbol}
          study={study0}
          nextChord={showTransition ? (study1 ?? undefined) : undefined}
          scaleKey={showKeyScale ? (sheet.key ?? undefined) : undefined}
          width={compact ? 112 : 124}
          maxHeight={maxDiagramHeight}
          titleSize={compact ? 18 : 20}
        />
        <ChordSongShape
          label="Next"
          symbol={chord1?.symbol}
          study={study1}
          scaleKey={showKeyScale ? (sheet.key ?? undefined) : undefined}
          width={compact ? 112 : 124}
          maxHeight={maxDiagramHeight}
          titleSize={compact ? 18 : 20}
        />
      </Row>
      {!compact ? (
        <Row gap={12} style={{ alignItems: "flex-start" }}>
          <ChordSongShape
            label="+2"
            symbol={chord2?.symbol}
            study={study2}
            scaleKey={showKeyScale ? (sheet.key ?? undefined) : undefined}
            width={124}
            maxHeight={maxDiagramHeight}
            titleSize={20}
          />
          <ChordSongShape
            label="+3"
            symbol={chord3?.symbol}
            study={study3}
            scaleKey={showKeyScale ? (sheet.key ?? undefined) : undefined}
            width={124}
            maxHeight={maxDiagramHeight}
            titleSize={20}
          />
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Chords & lyrics">
        {hasScore ? (
          <Button
            label="Score setup"
            tone="ghost"
            onPress={() => {
              pause();
              push(`/song/${sheet.id}`);
            }}
          />
        ) : null}
      </ScreenHeader>
      <View
        ref={bodyRef}
        onLayout={onBodyLayout}
        style={{ flex: 1, minHeight: 0, flexDirection: "row" }}
      >
        <ChordChartLayoutContext.Provider value={layout}>
          <FlatList
            key={layout.key}
            ref={scroll}
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
            {...(Platform.OS === "web" ? { onWheel: pause } : {})}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setViewportHeight((v) => (Math.abs(v - h) > 1 ? h : v));
            }}
            onContentSizeChange={(_, height) => {
              contentHeight.current = height;
            }}
            scrollEventThrottle={32}
            contentContainerStyle={{
              paddingBottom: Math.max(theme.s(30), viewportHeight * 0.65),
            }}
            ListHeaderComponent={
              <Stack pad={16} gap={10}>
                <Row gap={12} style={{ alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Title size={24}>{sheet.title}</Title>
                    <Body size={12} color={theme.chrome.dim}>
                      {sheet.artist} · Key {sheet.key ?? "unknown"}
                    </Body>
                  </View>
                  {sheet.spotifyUrl ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${sheet.title} on Spotify`}
                      hitSlop={8}
                      onPress={() => {
                        pause();
                        void Linking.openURL(sheet.spotifyUrl!);
                      }}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.7 : 1,
                        justifyContent: "center",
                        alignItems: "center",
                        padding: theme.s(4),
                      })}
                    >
                      <SvgXml
                        xml={SPOTIFY_ROUND_ICON_XML}
                        width={theme.s(28)}
                        height={theme.s(28)}
                      />
                    </Pressable>
                  ) : null}
                  {sheet.sourceUrl ? (
                    <Button
                      label="Source"
                      tone="ghost"
                      onPress={() => {
                        pause();
                        void Linking.openURL(sheet.sourceUrl);
                      }}
                    />
                  ) : null}
                </Row>
                <Segmented
                  accessibilityLabel="Chord chart view"
                  segments={CHART_VIEWS}
                  value={chartView}
                  onChange={(mode) => {
                    pause();
                    setChartView(mode);
                  }}
                  grow
                  compact
                />
                {compact || chartView === "names" ? (
                  <>
                    <Toggle
                      label="Preview next fingering"
                      hint="Show next chord notes in grey on the current diagram."
                      value={showTransition}
                      onChange={setShowTransition}
                    />
                    <Toggle
                      label="Preview key"
                      hint={
                        sheet.key
                          ? `Show ${sheet.key} scale notes on chord diagrams.`
                          : "Show key scale notes on chord diagrams."
                      }
                      value={showKeyScale}
                      onChange={setShowKeyScale}
                    />
                  </>
                ) : null}
              </Stack>
            }
            renderItem={({ item }) =>
              item.kind === "preview" ? (
                preview
              ) : (
                <View style={{ paddingHorizontal: theme.s(12) }}>
                  <LyricLine
                    line={item.line}
                    lineIndex={item.lineIndex}
                    activeChange={
                      active?.lineIndex === item.lineIndex
                        ? active.changeIndex
                        : -1
                    }
                    omitted={sheet.lyrics === "omitted"}
                    mode={chartView}
                    studies={studies}
                    scaleKey={showKeyScale ? (sheet.key ?? undefined) : undefined}
                    onChord={selectChord}
                  />
                </View>
              )
            }
            ListFooterComponent={
              <Stack pad={16} gap={6}>
                {sheet.credits ? (
                  <Body
                    size={12}
                    color={theme.chrome.dim}
                    style={{ fontStyle: "italic" }}
                  >
                    {sheet.credits}
                  </Body>
                ) : null}
                <Body size={12} color={theme.chrome.dim}>
                  End of chart
                </Body>
              </Stack>
            }
          />
        </ChordChartLayoutContext.Provider>
        {!compact && chartView === "names" ? (
          <View
            style={{
              width: theme.s(310),
              borderLeftWidth: theme.rule(1),
              borderColor: theme.chrome.lineSoft,
              backgroundColor: theme.chrome.surface,
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              {preview}
            </ScrollView>
          </View>
        ) : null}
      </View>
      <View
        testID="chord-song-controls"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.s(6),
          padding: theme.s(8),
          borderTopWidth: theme.rule(1),
          borderColor: theme.chrome.lineSoft,
          backgroundColor: theme.chrome.surfaceElevated,
        }}
      >
        <ScrollView
          ref={tempoScroll}
          horizontal
          style={{ flex: 1, minWidth: 0 }}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onLayout={revealPriorityControls}
          onContentSizeChange={revealPriorityControls}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "flex-end",
            alignItems: "center",
            gap: theme.s(10),
          }}
        >
          <Row gap={6}>
            <Body size={12}>BPM</Body>
            <TextInput
              value={bpmText}
              onChangeText={setBpmText}
              keyboardType="numeric"
              accessibilityLabel="Auto-roll BPM"
              onFocus={() => {
                bpmInputFocused.current = true;
              }}
              onBlur={commitBpm}
              onSubmitEditing={commitBpm}
              selectTextOnFocus
              style={{
                width: theme.s(55),
                minHeight: theme.tap,
                padding: theme.s(8),
                borderWidth: 1,
                borderColor: theme.chrome.line,
                borderRadius: theme.s(6),
                color: theme.chrome.ink,
                fontSize: theme.font(12),
              }}
            />
          </Row>
          <Row gap={6}>
            <Body size={12}>Speed</Body>
            <Stepper
              label="auto-roll speed"
              value={speed}
              display={`${Math.round(speed * 100)}%`}
              canDecrement={speed > 0.25}
              canIncrement={speed < 3}
              onDecrement={() =>
                setSpeed((s) =>
                  Math.max(0.25, Math.round((s - 0.1) * 100) / 100),
                )
              }
              onIncrement={() =>
                setSpeed((s) => Math.min(3, Math.round((s + 0.1) * 100) / 100))
              }
            />
          </Row>
        </ScrollView>
        <Button label="Restart" tone="ghost" onPress={reset} />
        <Button
          label={playing ? "Pause scroll" : "Auto-scroll"}
          accessibilityLabel={
            playing ? "Pause auto-scroll" : "Start auto-scroll"
          }
          tone="accent"
          onPress={() => {
            if (bpmInputFocused.current) commitBpm();
            setPlaying((current) => !current);
          }}
        />
      </View>
    </Screen>
  );
}

function LyricLine({
  line,
  lineIndex,
  activeChange,
  omitted,
  mode,
  studies,
  scaleKey,
  onChord,
}: {
  line: SheetLine;
  lineIndex: number;
  activeChange: number;
  omitted: boolean;
  mode: ChartView;
  studies: ReadonlyMap<string, CelloChordStudy | null>;
  scaleKey?: string;
  onChord: (lineIndex: number, changeIndex: number) => void;
}) {
  const { s, font, chrome, tap } = useTheme();
  if (line.kind === "section")
    return (
      <Label size={12} style={{ marginTop: s(18), marginBottom: s(8) }}>
        {line.text}
      </Label>
    );
  if (omitted && !line.changes.length)
    return <View style={{ minHeight: s(28) }} />;
  const shapes = mode === "shapes";
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: shapes ? "flex-start" : "flex-end",
        marginBottom: s(18),
        paddingVertical: s(4),
        borderRadius: s(6),
        backgroundColor: activeChange >= 0 ? chrome.accentWash : "transparent",
      }}
    >
      {sheetLineSegments(line).map((part, i) => (
        <View
          key={i}
          style={{
            maxWidth: "100%",
            minWidth: part.chord ? tap : 0,
            paddingRight: part.chord ? s(6) : 0,
          }}
        >
          {part.chord ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${part.chord.symbol}${shapes ? " shape" : ""}, ${line.id}, change ${part.changeIndex + 1}`}
              accessibilityState={{
                selected: activeChange === part.changeIndex,
              }}
              onPress={() => onChord(lineIndex, part.changeIndex)}
              style={{
                minHeight: tap,
                justifyContent: "center",
                alignSelf: "flex-start",
                minWidth: tap,
                padding: s(4),
                borderRadius: s(4),
                borderWidth: shapes ? 2 : 0,
                borderColor:
                  activeChange === part.changeIndex
                    ? chrome.accent
                    : "transparent",
                backgroundColor:
                  activeChange === part.changeIndex && !shapes
                    ? chrome.accent
                    : "transparent",
              }}
            >
              {shapes ? (
                <View style={{ width: s(112) }}>
                  <ChordSongShape
                    symbol={part.chord.symbol}
                    study={studies.get(part.chord.symbol)}
                    scaleKey={scaleKey}
                    width={108}
                  />
                </View>
              ) : (
                <Text
                  style={{
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    fontWeight: "700",
                    fontSize: font(16),
                    color:
                      activeChange === part.changeIndex
                        ? chrome.dark
                          ? "#060913"
                          : "#FFFFFF"
                        : chrome.accent,
                  }}
                >
                  {part.chord.symbol}
                </Text>
              )}
            </Pressable>
          ) : !shapes ? (
            <View style={{ height: tap }} />
          ) : null}
          {!omitted && part.lyric ? (
            <Text
              style={{
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                fontSize: font(16),
                lineHeight: font(26),
                color: chrome.ink,
              }}
            >
              {part.lyric}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const chartItemKey = (item: ChordChartItem) => item.id;
