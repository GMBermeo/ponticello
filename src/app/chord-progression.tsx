import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CelloChordDiagram } from '@/components/CelloChordDiagram';
import { Button, Segmented, Toggle } from '@/components/ui/controls';
import { Body, Label, Row, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { CELLO_CHORD_ROOTS } from '@/domain/celloChords';
import { chordsInScale, type ChordFamily, type ChordScaleId } from '@/domain/chordScales';
import {
  addChordToRow,
  addRow,
  applyPreset,
  createDefaultProgression,
  createSavedEntry,
  flattenProgression,
  moveChordBetweenRows,
  moveChordWithinRow,
  PROGRESSION_PRESETS,
  removeChord,
  removeRow,
  type CustomProgressionData,
  type ProgressionFlattenedChord,
  type SavedProgressionEntry,
} from '@/domain/customProgression';
import { useTheme } from '@/theme/ThemeProvider';
import { FONT } from '@/theme/tokens';

const STORAGE_KEY = 'ponticello:custom-progression:v1';
const SAVED_PROGRESSIONS_KEY = 'ponticello:saved-progressions:v1';
const KEY_SCALES: { id: ChordScaleId; label: string }[] = [
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
  { id: 'harmonic', label: 'Harmonic min' },
  { id: 'dorian', label: 'Dorian' },
  { id: 'mixolydian', label: 'Mixolydian' },
];

const FAMILIES: { value: ChordFamily; label: string }[] = [
  { value: 'all', label: 'All chords' },
  { value: 'triads', label: 'Triads' },
  { value: 'sevenths', label: 'Sevenths' },
];

const BEATS_OPTIONS = [
  { value: '1', label: '1 beat' },
  { value: '2', label: '2 beats' },
  { value: '4', label: '4 beats' },
  { value: '8', label: '8 beats' },
];

export default function ChordProgressionScreen() {
  const theme = useTheme();
  const { s, chrome, font } = theme;

  const [progression, setProgression] = useState<CustomProgressionData>(createDefaultProgression());
  const [loaded, setLoaded] = useState(false);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [family, setFamily] = useState<ChordFamily>('triads');
  const [showTransition, setShowTransition] = useState(true);
  const [showKeyScale, setShowKeyScale] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [savedList, setSavedList] = useState<SavedProgressionEntry[]>([]);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(false);
  const [draggedCoords, setDraggedCoords] = useState<{ row: number; col: number } | null>(null);
  const [dropTargetCoords, setDropTargetCoords] = useState<{ row: number; col: number } | null>(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeGlobalIndex, setActiveGlobalIndex] = useState(0);
  const [bpmText, setBpmText] = useState('80');
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const chordPositions = useRef<Map<number, number>>(new Map());

  // Load saved active progression & saved progressions list
  useEffect(() => {
    async function loadSaved() {
      try {
        const [rawProg, rawList] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SAVED_PROGRESSIONS_KEY),
        ]);
        if (rawProg) {
          const parsed = JSON.parse(rawProg);
          if (parsed && Array.isArray(parsed.rows)) {
            setProgression(parsed);
            setBpmText(String(parsed.bpm || 80));
          }
        }
        if (rawList) {
          const parsedList = JSON.parse(rawList);
          if (Array.isArray(parsedList)) {
            setSavedList(parsedList);
          }
        }
      } catch (err) {
        console.warn('Could not load custom progression:', err);
      } finally {
        setLoaded(true);
      }
    }
    void loadSaved();
  }, []);

  // Auto-save active working draft on change
  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progression));
  }, [progression, loaded]);

  // Available chords in current key and scale
  const availableChords = useMemo(
    () => chordsInScale(progression.keyRoot, progression.keyScale, family, 'degree'),
    [progression.keyRoot, progression.keyScale, family]
  );

  // Study cache to prevent repeated re-parsing
  const studyCache = useMemo(() => new Map(), []);

  // Flattened progression with universal nextChord calculation
  const flattened = useMemo(
    () => flattenProgression(progression, studyCache),
    [progression, studyCache]
  );

  // Map from (row, col) to flattened item
  const flattenedLookup = useMemo(() => {
    const map = new Map<string, ProgressionFlattenedChord>();
    flattened.forEach((f) => {
      map.set(`${f.rowIndex}:${f.chordIndex}`, f);
    });
    return map;
  }, [flattened]);

  // Set Key Root
  const handleKeyRootChange = useCallback((keyRoot: string) => {
    setProgression((prev) => ({ ...prev, keyRoot }));
  }, []);

  // Set Key Scale
  const handleKeyScaleChange = useCallback((keyScale: ChordScaleId) => {
    setProgression((prev) => ({ ...prev, keyScale }));
  }, []);

  // Add Chord to active row
  const handleAddChord = useCallback(
    (symbol: string, degree?: string | null) => {
      const validRowIndex = Math.min(activeRowIndex, progression.rows.length - 1);
      setProgression((prev) => addChordToRow(prev, validRowIndex, symbol, degree));
    },
    [activeRowIndex, progression.rows.length]
  );

  // Reordering helpers
  const handleMoveLeft = useCallback((rIdx: number, cIdx: number) => {
    if (cIdx > 0) {
      setProgression((prev) => moveChordWithinRow(prev, rIdx, cIdx, cIdx - 1));
    }
  }, []);

  const handleMoveRight = useCallback(
    (rIdx: number, cIdx: number, rowLen: number) => {
      if (cIdx < rowLen - 1) {
        setProgression((prev) => moveChordWithinRow(prev, rIdx, cIdx, cIdx + 1));
      }
    },
    []
  );

  const handleMoveUpRow = useCallback((rIdx: number, cIdx: number) => {
    if (rIdx > 0) {
      setProgression((prev) => moveChordBetweenRows(prev, rIdx, cIdx, rIdx - 1, 9999));
    }
  }, []);

  const handleMoveDownRow = useCallback(
    (rIdx: number, cIdx: number, totalRows: number) => {
      if (rIdx < totalRows - 1) {
        setProgression((prev) => moveChordBetweenRows(prev, rIdx, cIdx, rIdx + 1, 9999));
      }
    },
    []
  );

  const handleRemoveChord = useCallback((rIdx: number, cIdx: number) => {
    setProgression((prev) => removeChord(prev, rIdx, cIdx));
  }, []);

  // Drop handler
  const handleDropOnChord = useCallback(
    (targetRow: number, targetCol: number) => {
      if (!draggedCoords) return;
      if (draggedCoords.row === targetRow) {
        setProgression((prev) =>
          moveChordWithinRow(prev, targetRow, draggedCoords.col, targetCol)
        );
      } else {
        setProgression((prev) =>
          moveChordBetweenRows(prev, draggedCoords.row, draggedCoords.col, targetRow, targetCol)
        );
      }
      setDraggedCoords(null);
      setDropTargetCoords(null);
    },
    [draggedCoords]
  );

  // Playback timer
  const totalChords = flattened.length;
  useEffect(() => {
    if (!playing || totalChords === 0) {
      if (playTimer.current) {
        clearInterval(playTimer.current);
        playTimer.current = null;
      }
      return;
    }

    const effectiveBpm = Math.max(30, progression.bpm) * speed;
    const msPerBeat = (60 / effectiveBpm) * 1000;
    const msPerChord = msPerBeat * progression.beatsPerChord;

    playTimer.current = setInterval(() => {
      setActiveGlobalIndex((prev) => {
        const next = (prev + 1) % totalChords;
        // Auto scroll to active chord
        const y = chordPositions.current.get(next);
        if (typeof y === 'number' && scrollRef.current) {
          scrollRef.current.scrollTo({ y: Math.max(0, y - s(120)), animated: true });
        }
        return next;
      });
    }, msPerChord);

    return () => {
      if (playTimer.current) clearInterval(playTimer.current);
    };
  }, [playing, totalChords, progression.bpm, progression.beatsPerChord, speed, s]);

  const togglePlay = () => setPlaying((p) => !p);
  const restart = () => {
    setPlaying(false);
    setActiveGlobalIndex(0);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const handleBpmCommit = () => {
    const val = parseInt(bpmText, 10);
    if (!isNaN(val) && val >= 30 && val <= 240) {
      setProgression((prev) => ({ ...prev, bpm: val }));
    } else {
      setBpmText(String(progression.bpm));
    }
  };

  const handleSave = useCallback(async () => {
    try {
      const entry = createSavedEntry(progression);
      setSavedList((prev) => {
        const existingIdx = prev.findIndex(
          (p) => p.title.trim().toLowerCase() === entry.title.toLowerCase()
        );
        let next: SavedProgressionEntry[];
        if (existingIdx >= 0) {
          next = [...prev];
          next[existingIdx] = entry;
        } else {
          next = [entry, ...prev];
        }
        void AsyncStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(next));
        return next;
      });
      setSaveFeedback(true);
      setTimeout(() => setSaveFeedback(false), 2000);
    } catch (err) {
      console.warn('Could not save progression:', err);
    }
  }, [progression]);

  const handleDeleteSaved = useCallback((id: string) => {
    setSavedList((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void AsyncStorage.setItem(SAVED_PROGRESSIONS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleLoadSaved = useCallback((entry: SavedProgressionEntry) => {
    setProgression(entry.data);
    setBpmText(String(entry.data.bpm || 80));
    setSavedModalOpen(false);
  }, []);

  const handleExportJson = useCallback((data: CustomProgressionData) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const titleSlug = (data.title || 'progression').toLowerCase().replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${titleSlug}.json`;

    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } else {
      void Share.share({
        title: filename,
        message: jsonStr,
      });
    }
  }, []);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader
        backLabel="Library"
        meta="Chord progression"
      >
        <Row gap={6} style={{ alignItems: 'center' }}>
          <Button
            label={saveFeedback ? '✓ Saved!' : 'Save'}
            tone={saveFeedback ? 'accent' : 'default'}
            onPress={handleSave}
          />
          <Button
            label={`Saved (${savedList.length})`}
            tone="ghost"
            onPress={() => setSavedModalOpen(true)}
          />
          <Button
            label="Presets"
            tone="ghost"
            onPress={() => setPresetsOpen(true)}
          />
          <Button
            label="Clear"
            tone="ghost"
            onPress={() => setProgression(createDefaultProgression())}
          />
        </Row>
      </ScreenHeader>

      {/* Main Full-screen Canvas */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: s(16),
          paddingBottom: s(110),
          gap: s(16),
        }}
      >
        {/* Top Configuration & In-Key Palette (Inside ScrollView so it's scrollable!) */}
        <View
          style={{
            backgroundColor: chrome.surface,
            borderRadius: s(10),
            borderWidth: theme.rule(1),
            borderColor: chrome.lineSoft,
            padding: s(14),
            gap: s(12),
          }}
        >
          {/* Progression Title & Actions */}
          <Row style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s(8) }}>
            <View style={{ flex: 1, minWidth: s(200) }}>
              <Label size={11} color={chrome.dim}>
                Progression title
              </Label>
              <TextInput
                value={progression.title}
                onChangeText={(title) => setProgression((prev) => ({ ...prev, title }))}
                placeholder="Name your chord progression..."
                placeholderTextColor={chrome.dim}
                style={{
                  fontSize: s(16),
                  fontWeight: '700',
                  color: chrome.ink,
                  fontFamily: FONT.semibold,
                  marginTop: s(4),
                  paddingVertical: s(6),
                  paddingHorizontal: s(10),
                  backgroundColor: chrome.bg,
                  borderRadius: s(6),
                  borderWidth: theme.rule(1),
                  borderColor: chrome.lineSoft,
                }}
              />
            </View>

            <Row gap={8} style={{ alignItems: 'center', marginTop: s(14) }}>
              <Button
                label={saveFeedback ? '✓ Saved!' : 'Save progression'}
                tone={saveFeedback ? 'accent' : 'default'}
                onPress={handleSave}
              />
              <Button
                label="Export JSON"
                tone="ghost"
                onPress={() => handleExportJson(progression)}
              />
            </Row>
          </Row>

          {/* Key Root & Scale Selector */}
          <Row gap={12} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <View style={{ minWidth: s(140) }}>
              <Label size={11}>Key root</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Row gap={4} style={{ marginTop: s(4) }}>
                  {CELLO_CHORD_ROOTS.map((root) => (
                    <Button
                      key={root}
                      label={root}
                      tone={root === progression.keyRoot ? 'accent' : 'default'}
                      onPress={() => handleKeyRootChange(root)}
                    />
                  ))}
                </Row>
              </ScrollView>
            </View>

            <View style={{ minWidth: s(180) }}>
              <Label size={11}>Scale mode</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Row gap={4} style={{ marginTop: s(4) }}>
                  {KEY_SCALES.map((scale) => (
                    <Button
                      key={scale.id}
                      label={scale.label}
                      tone={scale.id === progression.keyScale ? 'accent' : 'default'}
                      onPress={() => handleKeyScaleChange(scale.id)}
                    />
                  ))}
                </Row>
              </ScrollView>
            </View>

            {/* Feature Toggles */}
            <Row gap={14} style={{ marginLeft: 'auto', alignItems: 'center' }}>
              <Toggle
                label="Preview next"
                hint="Upcoming chord ghost notes"
                value={showTransition}
                onChange={setShowTransition}
              />
              <Toggle
                label="Preview key"
                hint="Key scale notes"
                value={showKeyScale}
                onChange={setShowKeyScale}
              />
            </Row>
          </Row>

          {/* Chords in Key Palette */}
          <View style={{ gap: s(6) }}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Label size={11}>
                Chords in {progression.keyRoot} {progression.keyScale} (Tap to add to Row {activeRowIndex + 1})
              </Label>
              <Segmented
                accessibilityLabel="Chord family"
                segments={FAMILIES}
                value={family}
                onChange={setFamily}
                compact
              />
            </Row>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Row gap={6} style={{ paddingVertical: s(2) }}>
                {availableChords.map((chord) => {
                  const symbol = `${chord.root}${chord.type.id}`;
                  return (
                    <Pressable
                      key={chord.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${symbol} (${chord.romanDegree ?? ''})`}
                      onPress={() => handleAddChord(symbol, chord.romanDegree)}
                      style={({ pressed }) => ({
                        paddingHorizontal: s(10),
                        paddingVertical: s(6),
                        borderRadius: s(6),
                        backgroundColor: pressed ? chrome.accentWash : chrome.bg,
                        borderWidth: theme.rule(1),
                        borderColor: chrome.line,
                        alignItems: 'center',
                        minWidth: s(54),
                      })}
                    >
                      <Label size={10} color={chrome.accent}>
                        {chord.romanDegree ?? '—'}
                      </Label>
                      <Title size={13}>{symbol}</Title>
                    </Pressable>
                  );
                })}
              </Row>
            </ScrollView>
          </View>
        </View>
        {progression.rows.map((row, rIdx) => {
          const isActiveRow = activeRowIndex === rIdx;
          return (
            <View
              key={row.id}
              style={{
                backgroundColor: chrome.surface,
                borderRadius: s(10),
                borderWidth: theme.rule(1),
                borderColor: isActiveRow ? chrome.accent : chrome.lineSoft,
                padding: s(12),
                gap: s(12),
              }}
            >
              {/* Row Header */}
              <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Row gap={8} style={{ alignItems: 'center' }}>
                  <Pressable
                    onPress={() => setActiveRowIndex(rIdx)}
                    style={{
                      paddingHorizontal: s(8),
                      paddingVertical: s(4),
                      borderRadius: s(4),
                      backgroundColor: isActiveRow ? chrome.accent : chrome.surfaceElevated,
                    }}
                  >
                    <Title size={13} color={isActiveRow ? '#ffffff' : chrome.ink}>
                      {row.label}
                    </Title>
                  </Pressable>
                  <Body size={11} color={chrome.dim}>
                    {row.chords.length} {row.chords.length === 1 ? 'chord' : 'chords'}
                  </Body>
                </Row>

                <Row gap={6}>
                  <Button
                    label="+ Add chord"
                    tone="ghost"
                    onPress={() => setActiveRowIndex(rIdx)}
                  />
                  {progression.rows.length > 1 ? (
                    <Button
                      label="Delete row"
                      tone="ghost"
                      onPress={() => setProgression((prev) => removeRow(prev, rIdx))}
                    />
                  ) : null}
                </Row>
              </Row>

              {/* Chords Grid in Row */}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: s(12),
                  minHeight: s(120),
                  alignItems: 'flex-start',
                }}
              >
                {row.chords.length === 0 ? (
                  <View
                    style={{
                      flex: 1,
                      minHeight: s(100),
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: chrome.line,
                      borderRadius: s(8),
                      padding: s(16),
                    }}
                  >
                    <Body size={13} color={chrome.dim}>
                      No chords in this row. Tap chords above to add!
                    </Body>
                  </View>
                ) : (
                  row.chords.map((chordItem, cIdx) => {
                    const lookupKey = `${rIdx}:${cIdx}`;
                    const flat = flattenedLookup.get(lookupKey);
                    const globalIdx = flat ? flat.globalIndex : -1;
                    const isPlayingChord = playing && activeGlobalIndex === globalIdx;

                    const isDragged =
                      draggedCoords?.row === rIdx && draggedCoords?.col === cIdx;
                    const isDropTarget =
                      dropTargetCoords?.row === rIdx && dropTargetCoords?.col === cIdx;

                    // HTML5 drag handlers on web
                    const webDragProps =
                      Platform.OS === 'web'
                        ? {
                            draggable: true,
                            onDragStart: () => setDraggedCoords({ row: rIdx, col: cIdx }),
                            onDragOver: (e: any) => {
                              e.preventDefault?.();
                              setDropTargetCoords({ row: rIdx, col: cIdx });
                            },
                            onDragEnd: () => {
                              setDraggedCoords(null);
                              setDropTargetCoords(null);
                            },
                            onDrop: (e: any) => {
                              e.preventDefault?.();
                              handleDropOnChord(rIdx, cIdx);
                            },
                          }
                        : {};

                    return (
                      <View
                        key={chordItem.id}
                        onLayout={(e) => {
                          if (flat) {
                            chordPositions.current.set(flat.globalIndex, e.nativeEvent.layout.y);
                          }
                        }}
                        {...webDragProps}
                        style={{
                          width: s(130),
                          backgroundColor: isPlayingChord ? chrome.accentWash : chrome.bg,
                          borderRadius: s(8),
                          borderWidth: isPlayingChord ? 2 : theme.rule(1),
                          borderColor: isPlayingChord
                            ? chrome.accent
                            : isDropTarget
                            ? chrome.strings.D
                            : chrome.lineSoft,
                          opacity: isDragged ? 0.4 : 1,
                          padding: s(8),
                          alignItems: 'center',
                          gap: s(4),
                          // Subtle shadow
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.1,
                          shadowRadius: 2,
                          elevation: 1,
                        }}
                      >
                        {/* Chord Badge & Reorder Controls */}
                        <Row
                          style={{
                            width: '100%',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <Label size={11} color={chrome.accent}>
                            {chordItem.degree ?? ''}
                          </Label>
                          <Pressable
                            hitSlop={6}
                            accessibilityLabel={`Remove ${chordItem.symbol}`}
                            onPress={() => handleRemoveChord(rIdx, cIdx)}
                          >
                            <Body size={12} color={chrome.dim}>
                              ✕
                            </Body>
                          </Pressable>
                        </Row>

                        {/* Chord Name Header */}
                        <Pressable
                          onPress={() => {
                            if (flat) setActiveGlobalIndex(flat.globalIndex);
                          }}
                        >
                          <Title size={20}>{chordItem.symbol}</Title>
                        </Pressable>

                        {/* Full Cello Chord Diagram with Universal Next-Chord Preview */}
                        <View style={{ width: s(114), marginVertical: s(4) }}>
                          {flat?.study ? (
                            <CelloChordDiagram
                              chord={flat.study}
                              measuredWidth={s(114)}
                              presentation="atlas"
                              tapeColors
                              nextChord={
                                showTransition && flat.nextChord ? flat.nextChord : undefined
                              }
                              scaleKey={showKeyScale ? progression.keyRoot : undefined}
                            />
                          ) : (
                            <View
                              style={{
                                height: s(140),
                                justifyContent: 'center',
                                alignItems: 'center',
                              }}
                            >
                              <Body size={11} color={chrome.dim}>
                                Shape unavailable
                              </Body>
                            </View>
                          )}
                        </View>

                        {/* Reordering Control Buttons */}
                        <Row
                          gap={3}
                          style={{
                            width: '100%',
                            justifyContent: 'center',
                            marginTop: s(2),
                            borderTopWidth: theme.rule(1),
                            borderColor: chrome.lineSoft,
                            paddingTop: s(4),
                          }}
                        >
                          <Button
                            label="←"
                            disabled={cIdx === 0}
                            tone="ghost"
                            onPress={() => handleMoveLeft(rIdx, cIdx)}
                          />
                          <Button
                            label="→"
                            disabled={cIdx === row.chords.length - 1}
                            tone="ghost"
                            onPress={() => handleMoveRight(rIdx, cIdx, row.chords.length)}
                          />
                          <Button
                            label="↑"
                            disabled={rIdx === 0}
                            tone="ghost"
                            onPress={() => handleMoveUpRow(rIdx, cIdx)}
                          />
                          <Button
                            label="↓"
                            disabled={rIdx === progression.rows.length - 1}
                            tone="ghost"
                            onPress={() => handleMoveDownRow(rIdx, cIdx, progression.rows.length)}
                          />
                        </Row>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          );
        })}

        {/* Add Row Button */}
        <Button
          label="+ Add new row"
          tone="default"
          onPress={() => setProgression((prev) => addRow(prev))}
        />
      </ScrollView>

      {/* Bottom Playback & Practice Control Bar */}
      <View
        testID="custom-progression-controls"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(10),
          padding: s(10),
          borderTopWidth: theme.rule(1),
          borderColor: chrome.lineSoft,
          backgroundColor: chrome.surfaceElevated,
          flexWrap: 'wrap',
        }}
      >
        {/* BPM Input */}
        <Row gap={4} style={{ alignItems: 'center' }}>
          <Label size={11}>BPM</Label>
          <TextInput
            accessibilityLabel="Progression BPM"
            value={bpmText}
            onChangeText={setBpmText}
            onBlur={handleBpmCommit}
            onSubmitEditing={handleBpmCommit}
            keyboardType="numeric"
            maxLength={3}
            style={{
              width: s(46),
              height: s(34),
              borderWidth: theme.rule(1),
              borderColor: chrome.line,
              borderRadius: s(4),
              textAlign: 'center',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              fontSize: font(14),
              fontWeight: '700',
              color: chrome.ink,
              backgroundColor: chrome.bg,
            }}
          />
        </Row>

        {/* Beats Per Chord */}
        <Row gap={4} style={{ alignItems: 'center' }}>
          <Label size={11}>Beats</Label>
          <Segmented
            accessibilityLabel="Beats per chord"
            segments={BEATS_OPTIONS}
            value={String(progression.beatsPerChord)}
            onChange={(val) =>
              setProgression((prev) => ({ ...prev, beatsPerChord: parseInt(val, 10) }))
            }
            compact
          />
        </Row>

        {/* Speed multiplier */}
        <Row gap={4} style={{ alignItems: 'center' }}>
          <Label size={11}>Speed</Label>
          <Button
            label="−"
            disabled={speed <= 0.5}
            onPress={() => setSpeed((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
          />
          <Body
            size={12}
            style={{
              width: s(42),
              textAlign: 'center',
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              fontWeight: '700',
            }}
          >
            {Math.round(speed * 100)}%
          </Body>
          <Button
            label="+"
            disabled={speed >= 1.5}
            onPress={() => setSpeed((s) => Math.min(1.5, Math.round((s + 0.1) * 10) / 10))}
          />
        </Row>

        {/* Play and Restart */}
        <Row gap={8} style={{ marginLeft: 'auto', alignItems: 'center' }}>
          <Button label="Restart" tone="default" onPress={restart} />
          <Button
            label={playing ? 'Pause' : 'Play progression'}
            tone="accent"
            onPress={togglePlay}
          />
        </Row>
      </View>

      {/* Presets Modal */}
      <Modal
        visible={presetsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPresetsOpen(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: s(20),
          }}
          onPress={() => setPresetsOpen(false)}
        >
          <Pressable
            style={{
              backgroundColor: chrome.surface,
              borderRadius: s(12),
              padding: s(20),
              width: '100%',
              maxWidth: s(420),
              gap: s(14),
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Title size={20}>Progression Presets</Title>
            <Body size={13} color={chrome.dim}>
              Load a popular chord progression to explore fingerings and practice transitions.
            </Body>
            <Stack gap={8}>
              {PROGRESSION_PRESETS.map((preset) => (
                <Pressable
                  key={preset.id}
                  onPress={() => {
                    setProgression(applyPreset(preset.id, progression.bpm, progression.beatsPerChord));
                    setPresetsOpen(false);
                  }}
                  style={({ pressed }) => ({
                    padding: s(12),
                    borderRadius: s(8),
                    backgroundColor: pressed ? chrome.accentWash : chrome.bg,
                    borderWidth: theme.rule(1),
                    borderColor: chrome.lineSoft,
                  })}
                >
                  <Title size={15}>{preset.name}</Title>
                  <Body size={12} color={chrome.dim}>
                    Key {preset.keyRoot} · {preset.rows.map((r) => r.chords.join(' – ')).join(' | ')}
                  </Body>
                </Pressable>
              ))}
            </Stack>
            <Button label="Close" tone="ghost" onPress={() => setPresetsOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Saved Progressions Modal */}
      <Modal
        visible={savedModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSavedModalOpen(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: s(20),
          }}
          onPress={() => setSavedModalOpen(false)}
        >
          <Pressable
            style={{
              backgroundColor: chrome.surface,
              borderRadius: s(12),
              padding: s(20),
              width: '100%',
              maxWidth: s(480),
              maxHeight: '80%',
              gap: s(14),
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Title size={20}>Saved Progressions</Title>
              <Button label="✕" tone="ghost" onPress={() => setSavedModalOpen(false)} />
            </Row>

            <Body size={13} color={chrome.dim}>
              Your locally saved chord progressions stored on this device.
            </Body>

            <ScrollView style={{ maxHeight: s(360) }}>
              <Stack gap={10}>
                {savedList.length === 0 ? (
                  <View
                    style={{
                      padding: s(24),
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: s(8),
                      borderWidth: theme.rule(1),
                      borderColor: chrome.lineSoft,
                      borderStyle: 'dashed',
                      gap: s(8),
                    }}
                  >
                    <Body size={13} color={chrome.dim}>
                      No saved progressions yet.
                    </Body>
                    <Body size={11} color={chrome.dim}>
                      Tap "Save" in the top bar to save your current progression!
                    </Body>
                  </View>
                ) : (
                  savedList.map((item) => {
                    const chordsCount = item.data.rows.reduce(
                      (acc, r) => acc + r.chords.length,
                      0
                    );
                    const dateFormatted = new Date(item.savedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });

                    return (
                      <View
                        key={item.id}
                        style={{
                          padding: s(12),
                          borderRadius: s(8),
                          backgroundColor: chrome.bg,
                          borderWidth: theme.rule(1),
                          borderColor: chrome.lineSoft,
                          gap: s(8),
                        }}
                      >
                        <Row style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s(8) }}>
                          <View style={{ flex: 1, minWidth: s(180) }}>
                            <Title size={15}>{item.title}</Title>
                            <Body size={11} color={chrome.dim}>
                              Key {item.keyRoot} {item.keyScale} · {item.data.rows.length} {item.data.rows.length === 1 ? 'row' : 'rows'} · {chordsCount} chords · {dateFormatted}
                            </Body>
                          </View>

                          <Row gap={6} style={{ alignItems: 'center' }}>
                            <Button
                              label="Load"
                              tone="accent"
                              onPress={() => handleLoadSaved(item)}
                            />
                            <Button
                              label="Export JSON"
                              tone="ghost"
                              onPress={() => handleExportJson(item.data)}
                            />
                            <Button
                              label="✕"
                              tone="ghost"
                              onPress={() => handleDeleteSaved(item.id)}
                            />
                          </Row>
                        </Row>
                      </View>
                    );
                  })
                )}
              </Stack>
            </ScrollView>

            <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(4) }}>
              <Button
                label="Save current progression"
                tone="default"
                onPress={handleSave}
              />
              <Button
                label="Close"
                tone="ghost"
                onPress={() => setSavedModalOpen(false)}
              />
            </Row>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
