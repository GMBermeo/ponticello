import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, TextInput, View } from 'react-native';
import { CelloChordDiagram } from '@/components/CelloChordDiagram';
import { Button, PressableRow, Segmented, Toggle } from '@/components/ui/controls';
import { useMeasuredSize } from '@/components/useMeasuredSize';
import { Body, Label, Row, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { CELLO_CHORD_ROOTS, getCelloChordByType } from '@/domain/celloChords';
import { CHORD_SCALES, chordsInScale, scaleNotes, type ChordFamily, type ChordScaleId, type ScaleChord } from '@/domain/chordScales';
import { useTheme } from '@/theme/ThemeProvider';
import { FONT } from '@/theme/tokens';

const FAMILIES = [{ value: 'all', label: 'All' }, { value: 'triads', label: 'Triads' }, { value: 'sevenths', label: 'Sevenths' }, { value: 'extensions', label: 'Extensions' }] as const;
const SORTS = [{ value: 'basic', label: 'Major & basics first' }, { value: 'degree', label: 'Scale degree' }] as const;

export default function ChordLibraryScreen() {
  const theme = useTheme();
  const [root, setRoot] = useState('C');
  const [scale, setScale] = useState<ChordScaleId>('major');
  const [family, setFamily] = useState<ChordFamily>('all');
  const [sort, setSort] = useState<'basic' | 'degree'>('basic');
  const [gripsOnly, setGripsOnly] = useState(false);
  const [tapeColors, setTapeColors] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [variant, setVariant] = useState(0);
  const [arpeggio, setArpeggio] = useState(false);
  const list = useRef<FlatList<ScaleChord>>(null);
  const scaleChords = useMemo(() => chordsInScale(root, scale, family, sort, gripsOnly), [root, scale, family, sort, gripsOnly]);
  const normalizedQuery = query.trim().toLowerCase();
  const rows = useMemo(() => scaleChords.filter((entry) =>
    `${entry.root}${entry.type.id} ${entry.type.name}`.toLowerCase().includes(normalizedQuery)), [scaleChords, normalizedQuery]);
  const active = rows.find((row) => row.id === selectedId) ?? null;
  const study = useMemo(() => active ? getCelloChordByType(active.root, active.type.id) : null, [active]);
  const columns = theme.scale.compact ? 2 : 4;
  const selectChord = useCallback((id: string) => {
    setSelectedId(id);
    setVariant(0);
    setArpeggio(false);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  return <Screen scroll={false} padded={false}>
    <ScreenHeader backLabel="Library" meta="Chord atlas" />
    <FlatList ref={list} key={columns} numColumns={columns} data={rows} keyExtractor={(row) => row.id}
      keyboardShouldPersistTaps="handled" initialNumToRender={8} windowSize={5}
      contentContainerStyle={{ paddingHorizontal: theme.s(4), paddingTop: theme.s(16), paddingBottom: theme.s(24) }}
      ListHeaderComponent={<Stack gap={14} padX={12}>
        <Title accessibilityRole="header" size={28}>Chords for your cello</Title>
        <Body size={13} color={theme.chrome.dim}>Square = root. Filter by the full chord’s notes, then explore shapes and inversions.</Body>
        <Label size={11}>Scale tonic</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><Row gap={5}>{CELLO_CHORD_ROOTS.map((note) =>
          <Button key={note} label={note} tone={note === root ? 'accent' : 'default'} onPress={() => setRoot(note)} />)}</Row></ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><Row gap={6}>{CHORD_SCALES.map((item) =>
          <Button key={item.id} label={item.label} tone={item.id === scale ? 'accent' : 'default'} onPress={() => setScale(item.id)} />)}</Row></ScrollView>
        <Body size={13}>{scale === 'all' ? 'All twelve roots' : scaleNotes(root, scale).join(' · ')}</Body>
        <Segmented accessibilityLabel="Chord family" segments={FAMILIES} value={family} onChange={setFamily} grow compact />
        <Segmented accessibilityLabel="Chord order" segments={SORTS} value={sort} onChange={setSort} grow compact />
        <Toggle label="Show shapes only" hint="Hide chords available only as arpeggios in the neck-position model." value={gripsOnly} onChange={setGripsOnly} />
        <Toggle label="Tape colors" hint="Match finger markers to your saved tape positions." value={tapeColors} onChange={setTapeColors} />
        <TextInput value={query} onChangeText={setQuery} accessibilityLabel="Search chord library" placeholder="Find a chord or type" placeholderTextColor={theme.chrome.dim}
          autoCapitalize="none" style={{ borderWidth: 1, borderColor: theme.chrome.line, borderRadius: theme.s(8), padding: theme.s(12), minHeight: theme.tap, fontFamily: FONT.regular, fontSize: theme.font(15), color: theme.chrome.ink }} />
        {study ? <View style={{ padding: theme.s(16), backgroundColor: theme.chrome.surfaceElevated, borderRadius: theme.s(12), borderWidth: theme.rule(1), borderColor: theme.chrome.lineSoft, gap: theme.s(10) }}>
          <Row gap={12}><Title size={22} style={{ flex: 1 }}>{study.symbol}</Title>{active?.romanDegree ? <Title size={20} color={theme.chrome.dim}>{active.romanDegree}</Title> : null}<Button label="Close shape" tone="ghost" onPress={() => setSelectedId(null)} /></Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.s(18) }}>
            <CelloChordDiagram chord={study} width={150} presentation="atlas" tapeColors={tapeColors} mode={arpeggio ? 'arpeggio' : 'voicing'} voicingIndex={Math.min(variant, Math.max(0, study.voicings.length - 1))} />
            <Stack gap={10} style={{ flex: 1, minWidth: theme.s(150) }}>
              <Body size={15}>{study.tones.map((tone) => tone.name).join(' · ')}</Body>
              <Body size={12} color={theme.chrome.dim}>{study.type.intervals.join(' · ')}</Body>
              <Button label={arpeggio ? 'Show chord shape' : 'Show full arpeggio'} disabled={!study.voicings.length} onPress={() => setArpeggio((value) => !value)} />
              <Row gap={6}><Button label="Previous" disabled={variant <= 0} onPress={() => setVariant((value) => Math.max(0, value - 1))} /><Button label="Next shape" disabled={variant + 1 >= study.voicings.length} onPress={() => setVariant((value) => Math.min(study.voicings.length - 1, value + 1))} /></Row>
              <Body size={12}>{study.voicings.length ? `Shape ${variant + 1} of ${study.voicings.length}` : 'Arpeggio only in this model'}</Body>
              <Body size={12} color={theme.chrome.dim}>Suggested fingering. Roll three/four-string chords. A missing grip does not mean the chord is impossible.</Body>
            </Stack>
          </View>
        </View> : null}
        <Body size={12} color={theme.chrome.dim} accessibilityLiveRegion="polite">{rows.length} chords in this selection</Body>
      </Stack>}
      renderItem={({ item }) => <ChordTile entry={item} tapeColors={tapeColors} selected={active?.id === item.id} onSelect={selectChord} />}
      ListEmptyComponent={<Stack padY={20}><Title size={18}>No matching chords</Title><Body>Try another family or turn off “Show shapes only”.</Body></Stack>}
    />
  </Screen>;
}

function ChordTile({ entry, selected, tapeColors, onSelect }: { entry: ScaleChord; selected: boolean; tapeColors: boolean; onSelect: (id: string) => void }) {
  const theme = useTheme();
  const [size, onLayout, ref] = useMeasuredSize();
  const study = useMemo(() => getCelloChordByType(entry.root, entry.type.id), [entry.root, entry.type.id]);
  const omitted = study.voicings[0]?.omittedTones ?? [];
  return <View style={{ flex: 1, maxWidth: theme.scale.compact ? '50%' : '25%', paddingHorizontal: theme.s(4), marginTop: theme.s(16) }}>
    <PressableRow accessibilityLabel={`Explore ${study.symbol}${entry.romanDegree ? `, degree ${entry.romanDegree}` : ''}`} selected={selected} onPress={() => onSelect(entry.id)}
      style={{
        alignItems: 'center', borderRadius: theme.s(10), paddingVertical: theme.s(8), gap: theme.s(4),
        borderWidth: theme.rule(1),
        borderColor: selected ? theme.chrome.accent : theme.chrome.lineSoft,
        backgroundColor: selected ? theme.chrome.surfaceElevated : theme.chrome.surface,
      }}>
      <View ref={ref} onLayout={onLayout} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
        <CelloChordDiagram chord={study} presentation="atlas" tapeColors={tapeColors} width={150} measuredWidth={size.width > 0 ? Math.min(size.width, theme.s(150)) : undefined} />
      </View>
      <Row gap={8} style={{ alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: theme.s(12), flexWrap: 'wrap' }}>
        <Title size={22} style={{ flexShrink: 1 }}>{study.symbol}</Title>
        {entry.romanDegree ? <Title size={18} color={theme.chrome.dim}>{entry.romanDegree}</Title> : null}
      </Row>
      {omitted.length ? <Body size={10} color={theme.chrome.dim} style={{ paddingHorizontal: theme.s(12) }}>Omit {omitted.map((tone) => tone.name).join(', ')}</Body> : null}
    </PressableRow>
  </View>;
}
