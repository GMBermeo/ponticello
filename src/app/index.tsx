import { APP_NAME } from "@/brand";
import { KeyDemandBar } from "@/components/practice/KeyCensus";
import {
  Button,
  PressableRow,
  Segmented,
  useControlFeedback,
} from "@/components/ui/controls";
import {
  Badge,
  Body,
  Label,
  Row,
  Rule,
  Stack,
  TapeChip,
  Title,
} from "@/components/ui/primitives";
import { Screen } from "@/components/ui/Screen";
import { DifficultyTier } from "@/domain/schema";
import {
  KEY_PRACTICE_ROWS,
  LIBRARY_KEY_CENSUS,
  LIBRARY_ROWS,
  LibraryRow,
} from "@/scores";
import { getChordSheet, mergeChordLibrary } from "@/scores/chordSheets";
import { useSettings, useThemePreference } from "@/state/settings";
import { useImportedRows } from "@/state/usePiece";
import { useTheme } from "@/theme/ThemeProvider";
import { FONT, TAPE_COLOR_LABEL } from "@/theme/tokens";
import { useRouter } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type CategoryFilter = "ALL" | "study" | "song" | "chords" | "imported";
type DifficultyFilter = "ALL" | DifficultyTier;
const CATEGORIES = [
  { value: "ALL" as const, label: "All pieces" },
  { value: "study" as const, label: "Studies" },
  { value: "song" as const, label: "Songs" },
  { value: "chords" as const, label: "Chords" },
  { value: "imported" as const, label: "Imported" },
];
const LEVELS = [
  { value: "ALL" as const, label: "Any level" },
  { value: "Beginner" as const, label: "Beginner" },
  { value: "Intermediate" as const, label: "Intermediate" },
  { value: "Advanced" as const, label: "Advanced" },
  { value: "Expert" as const, label: "Expert" },
];

const CUSTOM_PROGRESSION_ROW: LibraryRow = {
  id: "custom-chord-progression",
  title: "Create chord progression",
  composer: "Interactive progression builder",
  origin: "CUSTOM PROGRESSION",
  keySignature: "Any key",
  range: "All positions",
  tempo: "Adjustable",
  difficulty: "Beginner",
  category: "study",
  bars: null,
  playable: false,
  distribution: [],
  note: "Build your own chord progression in any key, organize chord shapes into rows with drag-and-drop, and practice transitions with next chord preview.",
};

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const imported = useImportedRows();
  const { chrome, setChrome } = useThemePreference();
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("ALL");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const feedback = useControlFeedback();
  const allRows = useMemo(
    () => mergeChordLibrary([...imported, ...LIBRARY_ROWS]),
    [imported],
  );
  const rows = useMemo(
    () => {
      const filtered = allRows.filter((row) => {
        const inCategory =
          category === "ALL" ||
          (category === "chords"
            ? !!getChordSheet(row.id)
            : category === "imported"
              ? imported.some((r) => r.id === row.id)
              : category === "song"
                ? row.category === "song" || row.category === "classical"
                : row.category === "study");
        const query = search.trim().toLowerCase();
        return (
          inCategory &&
          (difficulty === "ALL" ||
            ((!getChordSheet(row.id) || row.playable) &&
              row.difficulty === difficulty)) &&
          (!query ||
            [row.title, row.composer, row.origin, row.keySignature].some(
              (text) => text.toLowerCase().includes(query),
            ))
        );
      });

      if (category === "chords") {
        const query = search.trim().toLowerCase();
        const matches =
          !query ||
          "create chord progression interactive builder".includes(query);
        if (matches) {
          return [CUSTOM_PROGRESSION_ROW, ...filtered];
        }
      }
      return filtered;
    },
    [allRows, imported, category, difficulty, search],
  );
  const wide = !theme.scale.compact;
  const clearFilters = () => {
    setCategory("ALL");
    setDifficulty("ALL");
    setSearch("");
  };

  const handleSelectSong = useCallback(
    (id: string) => {
      if (id === "custom-chord-progression") {
        router.push("/chord-progression");
        return;
      }
      const chart = getChordSheet(id);
      const hasScore = allRows.find((row) => row.id === id)?.playable;
      router.push(
        chart && (category === "chords" || !hasScore)
          ? `/chord-song/${id}`
          : `/song/${id}`,
      );
    },
    [router, category, allRows],
  );

  const renderItem = useCallback(
    ({ item }: { item: LibraryRow }) => (
      <SongRow row={item} onSelect={handleSelectSong} />
    ),
    [handleSelectSong],
  );

  const renderSeparator = useCallback(
    () => <Rule style={{ marginHorizontal: theme.s(24) }} />,
    [theme],
  );

  const listHeader = useMemo(
    () => (
      <>
        <Stack padX={24} padY={16} gap={10}>
          <Row gap={8} style={{ alignItems: "baseline" }}>
            <Title accessibilityRole="header" size={30}>
              Your music
            </Title>
            <Body
              size={13}
              color={theme.chrome.dim}
              style={{ marginLeft: "auto" }}
            >
              {allRows.length} pieces
            </Body>
          </Row>
          <Row
            gap={8}
            style={[
              {
                borderWidth: theme.rule(1),
                borderColor: theme.chrome.line,
                borderRadius: theme.s(8),
                paddingLeft: theme.s(14),
                minHeight: theme.tap,
              },
              feedback.focusStyle,
            ]}
          >
            <TextInput
              {...feedback.events}
              value={search}
              onChangeText={setSearch}
              accessibilityLabel="Search music"
              placeholder="Search title, artist or key"
              placeholderTextColor={theme.chrome.dim}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: theme.tap,
                fontFamily: FONT.regular,
                color: theme.chrome.ink,
                fontSize: theme.font(12),
                padding: 0,
                outlineWidth: 0,
                outlineStyle: "solid",
                outlineColor: "transparent",
              }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {search ? (
              <Button
                label="×"
                accessibilityLabel="Clear search"
                tone="ghost"
                onPress={() => setSearch("")}
              />
            ) : null}
          </Row>
          <Segmented
            accessibilityLabel="Music category"
            segments={CATEGORIES}
            value={category}
            onChange={setCategory}
            grow
            compact
          />
          <Row>
            <Body
              size={12}
              color={theme.chrome.dim}
              accessibilityLiveRegion="polite"
            >
              {rows.length} {rows.length === 1 ? "piece" : "pieces"}
              {search ? " found" : " to explore"}
            </Body>
            <View style={{ marginLeft: "auto" }}>
              <Button
                label={difficulty === "ALL" ? "Filter by level" : difficulty}
                hint={filtersOpen ? "−" : "+"}
                expanded={filtersOpen}
                tone="ghost"
                onPress={() => setFiltersOpen(!filtersOpen)}
              />
            </View>
          </Row>
          {filtersOpen ? (
            <View style={{ gap: theme.s(8) }}>
              <Body size={12} color={theme.chrome.dim}>
                Filter by the full score’s difficulty. Songs also offer easier
                arrangements.
              </Body>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: theme.s(6),
                }}
              >
                {LEVELS.map((level) => (
                  <Button
                    key={level.value}
                    label={level.label}
                    tone={difficulty === level.value ? "accent" : "default"}
                    onPress={() => setDifficulty(level.value)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          {category === "chords" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create your own chord progression"
              onPress={() => router.push("/chord-progression")}
              style={({ pressed }) => ({
                padding: theme.s(12),
                borderRadius: theme.s(10),
                backgroundColor: pressed
                  ? theme.chrome.accentWash
                  : theme.chrome.surface,
                borderWidth: theme.rule(1),
                borderColor: theme.chrome.accent,
                flexDirection: "row",
                alignItems: "center",
                gap: theme.s(12),
              })}
            >
              <View
                style={{
                  width: theme.s(36),
                  height: theme.s(36),
                  borderRadius: theme.s(8),
                  backgroundColor: theme.chrome.accent,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Title size={20} color="#ffffff">
                  +
                </Title>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Title size={15}>Create chord progression</Title>
                <Body size={12} color={theme.chrome.dim} numberOfLines={1}>
                  Pick a key, arrange chord shapes in rows, and practice transitions
                </Body>
              </View>
              <Title size={20} color={theme.chrome.dim}>
                ›
              </Title>
            </Pressable>
          ) : null}
        </Stack>
        <Rule />
      </>
    ),
    [
      allRows.length,
      category,
      difficulty,
      feedback.events,
      feedback.focusStyle,
      filtersOpen,
      rows.length,
      search,
      theme,
    ],
  );

  return (
    <Screen scroll={false} padded={false}>
      <Row
        padX={24}
        gap={12}
        style={{
          paddingTop: insets.top + theme.s(8),
          paddingBottom: theme.s(8),
          flexWrap: "wrap",
          minHeight: theme.s(76) + insets.top,
          borderBottomWidth: theme.rule(1),
          borderColor: theme.chrome.lineSoft,
        }}
      >
        <View style={{ flex: 1, ...(wide ? {} : { flexBasis: "100%" }) }}>
          <Title size={22}>{APP_NAME}</Title>
        </View>
        <Button
          label="Practice"
          tone="ghost"
          onPress={() => router.push("/profile")}
        />
        <Button
          label="Tuner"
          tone="ghost"
          onPress={() => router.push("/tuner")}
        />
        <Button
          label="Chords"
          tone="ghost"
          onPress={() => router.push("/chords")}
        />
        <Button
          label="Import"
          onPress={() => router.push("/settings/import")}
        />
        <Button
          label={
            chrome === "paper"
              ? "☀ Light"
              : chrome === "quiet"
                ? "☾ Dark"
                : "✦ Neon"
          }
          accessibilityLabel={`Theme: ${chrome}. Tap to switch theme.`}
          tone="ghost"
          onPress={() => {
            const next =
              chrome === "paper"
                ? "quiet"
                : chrome === "quiet"
                  ? "neon"
                  : "paper";
            setChrome(next);
          }}
        />
      </Row>
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <FlatList
            ListHeaderComponent={listHeader}
            data={rows}
            keyExtractor={keyExtractor}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: theme.s(20) }}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
            renderItem={renderItem}
            ItemSeparatorComponent={renderSeparator}
            ListEmptyComponent={
              <Stack pad={24} gap={12}>
                <Title size={22}>
                  {category === "imported" && !search
                    ? "Make room for your music"
                    : "No pieces found"}
                </Title>
                <Body size={14} color={theme.chrome.dim}>
                  {category === "imported" && !search
                    ? "Import a MIDI file to add a cello part and accompaniment to your library."
                    : "Try another title, artist or key, or clear your filters."}
                </Body>
                <Button
                  label={
                    category === "imported" && !search
                      ? "Import a MIDI file"
                      : "Clear filters"
                  }
                  onPress={
                    category === "imported" && !search
                      ? () => router.push("/settings/import")
                      : clearFilters
                  }
                />
              </Stack>
            }
          />
          {!wide ? (
            <Row
              padX={16}
              style={{
                borderTopWidth: theme.rule(1),
                borderColor: theme.chrome.lineSoft,
              }}
            >
              <Button
                label="Reading guide"
                tone="ghost"
                onPress={() => router.push("/tutorial")}
              />
              <Button
                label="Chart"
                tone="ghost"
                onPress={() => router.push("/chart")}
              />
              <Button
                label="Scales"
                tone="ghost"
                onPress={() => router.push("/scales")}
              />
              <View style={{ marginLeft: "auto" }}>
                <Button
                  label="My tapes"
                  tone="ghost"
                  onPress={() => router.push("/settings/tapes")}
                />
              </View>
            </Row>
          ) : null}
        </View>
        {wide ? <PracticeRail /> : null}
      </View>
    </Screen>
  );
}

const keyExtractor = (row: LibraryRow) => row.id;

interface SongRowProps {
  row: LibraryRow;
  onSelect: (id: string) => void;
}

const SongRow = memo(function SongRow({ row, onSelect }: SongRowProps) {
  const theme = useTheme();
  const isCustom = row.id === "custom-chord-progression";
  const chart = isCustom ? undefined : getChordSheet(row.id);
  const chartOnly = isCustom || (!!chart && !row.playable);
  const handlePress = useCallback(() => {
    onSelect(row.id);
  }, [onSelect, row.id]);

  const difficultyBg = chartOnly
    ? theme.chrome.accentWash
    : row.difficulty === "Beginner"
      ? theme.chrome.dark
        ? "rgba(48, 209, 88, 0.16)"
        : "rgba(31, 138, 76, 0.12)"
      : row.difficulty === "Intermediate"
        ? theme.chrome.dark
          ? "rgba(255, 159, 10, 0.16)"
          : "rgba(201, 52, 0, 0.12)"
        : theme.chrome.dark
          ? "rgba(255, 69, 58, 0.16)"
          : "rgba(215, 0, 21, 0.12)";

  const difficultyColor = chartOnly
    ? theme.chrome.accent
    : row.difficulty === "Beginner"
      ? theme.chrome.strings.C
      : row.difficulty === "Intermediate"
        ? theme.chrome.dark
          ? "#FF9F0A"
          : "#C93400"
        : theme.chrome.strings.G;

  return (
    <PressableRow
      onPress={handlePress}
      accessibilityLabel={`${row.title} by ${row.composer}. ${isCustom ? "Custom chord progression builder" : chartOnly ? "Chord chart" : row.difficulty}. Open piece`}
    >
      <Row padX={24} padY={16} gap={14}>
        <View style={{ flex: 1, minWidth: 0, gap: theme.s(5) }}>
          <Title size={17} numberOfLines={2}>
            {row.title}
          </Title>
          <Body size={13} color={theme.chrome.dim} numberOfLines={1}>
            {row.composer} · {row.keySignature}
          </Body>
        </View>
        <View style={{ alignItems: "flex-end", gap: theme.s(6) }}>
          <Badge
            label={isCustom ? "BUILDER" : chartOnly ? "CHORD" : row.difficulty.toUpperCase()}
            background={difficultyBg}
            color={difficultyColor}
          />
          <Body size={11} color={theme.chrome.dim}>
            {isCustom
              ? "Interactive"
              : chartOnly
                ? `${chart?.chords.length ?? 0} chords`
                : row.bars === null
                  ? "No score"
                  : `${row.bars} bars${chart ? " · Chords" : ""}`}
          </Body>
        </View>
        <Title size={20} color={theme.chrome.dim}>
          ›
        </Title>
      </Row>
    </PressableRow>
  );
});

function PracticeRail() {
  const theme = useTheme();
  const router = useRouter();
  const { settings } = useSettings();
  return (
    <View
      style={{
        width: theme.s(224),
        borderLeftWidth: theme.rule(1),
        borderColor: theme.chrome.lineSoft,
        backgroundColor: theme.chrome.surface,
      }}
    >
      <Screen padded={false}>
        <Stack pad={20} gap={14}>
          <Label size={11}>A gentle start</Label>
          <Title size={24}>Find your sound.</Title>
          <Body size={14} color={theme.chrome.dim}>
            Settle into the bow with a short open-string study.
          </Body>
          <Button
            label="Open-string study"
            hint="→"
            onPress={() => router.push(`/song/${LIBRARY_ROWS[0].id}`)}
          />
          <Body size={12} color={theme.chrome.dim}>
            8 bars · Beginner
          </Body>
        </Stack>
        <Rule style={{ marginHorizontal: theme.s(20) }} />
        <PracticeByKey />
        <Rule style={{ marginHorizontal: theme.s(20) }} />
        <Stack pad={20} gap={12}>
          <Label size={11}>Before you play</Label>
          <PressableRow
            onPress={() => router.push("/tutorial")}
            accessibilityLabel="Open the reading guide"
            style={{ justifyContent: "center" }}
          >
            <Title size={15}>Reading guide →</Title>
            <Body size={12} color={theme.chrome.dim}>
              Notes, numbers and string colours
            </Body>
          </PressableRow>
          <PressableRow
            onPress={() => router.push("/chart")}
            accessibilityLabel="Open the fingerboard chart"
            style={{ justifyContent: "center" }}
          >
            <Title size={15}>Fingerboard chart →</Title>
            <Body size={12} color={theme.chrome.dim}>
              Every note, coloured by its name
            </Body>
          </PressableRow>
          <PressableRow
            onPress={() => router.push("/profile")}
            accessibilityLabel="Open your practice record"
            style={{ justifyContent: "center" }}
          >
            <Title size={15}>Your practice →</Title>
            <Body size={12} color={theme.chrome.dim}>
              Hours, days and streaks, kept on this phone
            </Body>
          </PressableRow>
          <PressableRow
            onPress={() => router.push("/settings/tapes")}
            accessibilityLabel="Edit my tapes"
            style={{ justifyContent: "center" }}
          >
            <Title size={15}>My fingerboard tapes →</Title>
            <Body size={12} color={theme.chrome.dim}>
              Match the colours on your cello
            </Body>
          </PressableRow>
          <Row gap={7} style={{ flexWrap: "wrap" }}>
            {settings.tapeSets[0]?.tapes.map((tape) => (
              <TapeChip
                key={tape.id}
                color={theme.chrome.tapes[tape.color]}
                label={TAPE_COLOR_LABEL[tape.color]}
                width={32}
                height={5}
              />
            ))}
          </Row>
        </Stack>
        <Stack padX={20} padY={12} gap={6}>
          <Label size={10}>Always at your pace</Label>
          <Body size={13} color={theme.chrome.dim}>
            Choose a lower arrangement, slow the tempo and repeat a few bars.
          </Body>
        </Stack>
      </Screen>
    </View>
  );
}

/**
 * The three keys the library leans on hardest, with the drills behind them.
 *
 * This is the census earning its place on the first screen: a player who has
 * never thought about which key to practise is shown that a sixth of their
 * music is in one key, and one tap away is a scale for it. Counts come from
 * `LIBRARY_KEY_CENSUS`, measured at load, so this block cannot go stale
 * against the library.
 */
function PracticeByKey() {
  const theme = useTheme();
  const router = useRouter();
  const top = KEY_PRACTICE_ROWS.filter((row) => row.drills.length > 0).slice(
    0,
    3,
  );
  const total = LIBRARY_KEY_CENSUS.counted;
  const maxShare = KEY_PRACTICE_ROWS[0]?.share ?? 0;

  return (
    <Stack pad={20} gap={12}>
      <Label size={11}>Practise by key</Label>
      <Body size={13} color={theme.chrome.dim}>
        {`The keys your ${total} songs are actually in. Most-used first.`}
      </Body>
      {top.map((row) => (
        <PressableRow
          key={row.key}
          onPress={() => router.push("/scales")}
          accessibilityLabel={`${row.key}, ${row.songs} of ${total} songs, ${row.drills.length} drills. Open scales by key`}
          style={{ justifyContent: "center" }}
        >
          <KeyDemandBar row={row} of={total} maxShare={maxShare} compact />
        </PressableRow>
      ))}
      <Button
        label="All scales by key"
        hint="→"
        onPress={() => router.push("/scales")}
      />
    </Stack>
  );
}
