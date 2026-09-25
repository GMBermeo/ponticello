import { Pressable, ScrollView, TextInput, View } from 'react-native';

import {
  CELLO_CHORD_ROOTS, chordsInScale, type ChordFamily, type ChordScaleId, type CustomProgressionData,
} from '@domain';
import { FACE, RADIUS, useTheme } from '@theme';

import { Button, Label, Row, Segmented, Title, Toggle } from '../ui';
import { KEY_SCALES, PROGRESSION_FAMILIES } from './progressionOptions';

export type ProgressionSetupPanelProps = {
  progression: CustomProgressionData;
  onChange: (patch: Partial<CustomProgressionData>) => void;
  justSaved: boolean;
  onSave: () => void;
  onExport: () => void;
  family: ChordFamily;
  onFamilyChange: (family: ChordFamily) => void;
  showTransition: boolean;
  onShowTransitionChange: (show: boolean) => void;
  showKeyScale: boolean;
  onShowKeyScaleChange: (show: boolean) => void;
  showAllPositions: boolean;
  onShowAllPositionsChange: (show: boolean) => void;
  /** Row the palette adds to, zero-based. */
  targetRow: number;
  onAddChord: (symbol: string, degree: string | null | undefined) => void;
};

function ChoiceStrip<T extends string>({ label, minWidth, options, selected, onSelect }: {
  label: string;
  minWidth: number;
  options: readonly { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  const { s } = useTheme();
  return (
    <View style={{ minWidth: s(minWidth) }}>
      <Label size={11}>{label}</Label>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={4} style={{ marginTop: s(4) }}>
          {options.map((option) => (
            <Button
              key={option.id}
              label={option.label}
              tone={option.id === selected ? 'accent' : 'default'}
              onPress={() => onSelect(option.id)}
            />
          ))}
        </Row>
      </ScrollView>
    </View>
  );
}

const ROOT_OPTIONS = CELLO_CHORD_ROOTS.map((root) => ({ id: root, label: root }));

/** Title, key, preview options and the palette of chords in the key. */
export function ProgressionSetupPanel(props: ProgressionSetupPanelProps) {
  const { progression, onChange, justSaved } = props;
  const theme = useTheme();
  const compact = theme.scale.compact;
  const { s, chrome } = theme;
  const palette = chordsInScale(progression.keyRoot, progression.keyScale, props.family, 'degree');

  return (
    <View style={{ backgroundColor: chrome.surface, ...theme.corners(RADIUS.lg), padding: s(14), gap: s(12) }}>
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s(8) }}>
        <View style={{ flex: 1, minWidth: s(200) }}>
          <Label size={11} color={chrome.dim}>Progression title</Label>
          <TextInput
            value={progression.title}
            onChangeText={(title) => onChange({ title })}
            placeholder="Name your chord progression..."
            placeholderTextColor={chrome.dim}
            style={{
              fontSize: s(16), color: chrome.ink, ...FACE.heavy,
              marginTop: s(4), paddingVertical: s(6), paddingHorizontal: s(12),
              borderRadius: s(RADIUS.sm), backgroundColor: chrome.fill,
            }}
          />
        </View>
        <Row gap={8} style={{ alignItems: 'center', marginTop: s(14) }}>
          <Button label={justSaved ? '✓ Saved!' : 'Save progression'} tone={justSaved ? 'accent' : 'default'} onPress={props.onSave} />
          <Button label="Export JSON" tone="ghost" onPress={props.onExport} />
        </Row>
      </Row>

      <Row gap={12} style={compact ? { flexDirection: 'column', alignItems: 'stretch' } : { alignItems: 'center', flexWrap: 'wrap' }}>
        <ChoiceStrip label="Key root" minWidth={140} options={ROOT_OPTIONS} selected={progression.keyRoot}
          onSelect={(keyRoot) => onChange({ keyRoot })} />
        <ChoiceStrip<ChordScaleId> label="Scale mode" minWidth={180} options={KEY_SCALES} selected={progression.keyScale}
          onSelect={(keyScale) => onChange({ keyScale })} />
        <Row gap={14} style={compact ? { flexDirection: 'column', alignItems: 'stretch' } : { marginLeft: 'auto', alignItems: 'center' }}>
          <Toggle label="Preview next" hint="Upcoming chord ghost notes" value={props.showTransition} onChange={props.onShowTransitionChange} />
          <Toggle label="Preview key" hint="Key scale notes" value={props.showKeyScale} onChange={props.onShowKeyScaleChange} />
          <Toggle label="All positions" hint="Every place the chord's notes fall, for improvising" value={props.showAllPositions} onChange={props.onShowAllPositionsChange} />
        </Row>
      </Row>

      <View style={{ gap: s(6) }}>
        <Row gap={8} style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Label size={11} style={{ flexShrink: 1 }}>
            Chords in {progression.keyRoot} {progression.keyScale} (Tap to add to Row {props.targetRow + 1})
          </Label>
          <Segmented accessibilityLabel="Chord family" segments={PROGRESSION_FAMILIES} value={props.family} onChange={props.onFamilyChange} compact />
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row gap={6} style={{ paddingVertical: s(2) }}>
            {palette.map((chord) => {
              const symbol = `${chord.root}${chord.type.id}`;
              return (
                <Pressable
                  key={chord.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${symbol} (${chord.romanDegree ?? ''})`}
                  onPress={() => props.onAddChord(symbol, chord.romanDegree)}
                  style={({ pressed }) => ({
                    paddingHorizontal: s(12), paddingVertical: s(6), borderRadius: s(RADIUS.md),
                    backgroundColor: pressed ? chrome.accentWash : chrome.fill,
                    alignItems: 'center', minWidth: s(56),
                  })}
                >
                  <Label size={10} color={chrome.accent}>{chord.romanDegree ?? '—'}</Label>
                  <Title size={13}>{symbol}</Title>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>
      </View>
    </View>
  );
}
