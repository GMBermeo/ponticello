import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View, type DimensionValue } from 'react-native';

import { countChords, PROGRESSION_PRESETS, type SavedProgressionEntry } from '@domain';
import { useTheme } from '@theme';

import { Body, Button, Row, Stack, Title } from '../ui';

const BACKDROP = 'rgba(0, 0, 0, 0.5)';
const SAVED_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
};

/** A centred card over a dimmed backdrop; tapping the backdrop closes it. */
function ModalSheet({ visible, onClose, maxWidth, maxHeight, children }: {
  visible: boolean; onClose: () => void; maxWidth: number; maxHeight?: DimensionValue; children: ReactNode;
}) {
  const { s, chrome } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: BACKDROP, justifyContent: 'center', alignItems: 'center', padding: s(20) }} onPress={onClose}>
        <Pressable
          style={{ backgroundColor: chrome.surface, borderRadius: s(12), padding: s(20), width: '100%', maxWidth: s(maxWidth), maxHeight, gap: s(14) }}
          onPress={(event) => event.stopPropagation()}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type PresetsModalProps = { visible: boolean; onClose: () => void; onApply: (presetId: string) => void };

export function PresetsModal({ visible, onClose, onApply }: PresetsModalProps) {
  const theme = useTheme();
  const { s, chrome } = theme;
  return (
    <ModalSheet visible={visible} onClose={onClose} maxWidth={420}>
      <Title size={20}>Progression Presets</Title>
      <Body size={13} color={chrome.dim}>
        Load a popular chord progression to explore fingerings and practice transitions.
      </Body>
      <Stack gap={8}>
        {PROGRESSION_PRESETS.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => onApply(preset.id)}
            style={({ pressed }) => ({ padding: s(12), borderRadius: s(8), backgroundColor: pressed ? chrome.accentWash : chrome.bg, borderWidth: theme.rule(1), borderColor: chrome.lineSoft })}
          >
            <Title size={15}>{preset.name}</Title>
            <Body size={12} color={chrome.dim}>
              Key {preset.keyRoot} · {preset.rows.map((row) => row.chords.join(' – ')).join(' | ')}
            </Body>
          </Pressable>
        ))}
      </Stack>
      <Button label="Close" tone="ghost" onPress={onClose} />
    </ModalSheet>
  );
}

function savedSummary(entry: SavedProgressionEntry): string {
  const rows = entry.data.rows.length;
  const rowWord = rows === 1 ? 'row' : 'rows';
  const savedOn = new Date(entry.savedAt).toLocaleDateString(undefined, SAVED_DATE_FORMAT);
  return `Key ${entry.keyRoot} ${entry.keyScale} · ${rows} ${rowWord} · ${countChords(entry.data)} chords · ${savedOn}`;
}

function NoSavedProgressions() {
  const theme = useTheme();
  const { s, chrome } = theme;
  return (
    <View style={{ padding: s(24), alignItems: 'center', justifyContent: 'center', borderRadius: s(8), borderWidth: theme.rule(1), borderColor: chrome.lineSoft, borderStyle: 'dashed', gap: s(8) }}>
      <Body size={13} color={chrome.dim}>No saved progressions yet.</Body>
      <Body size={11} color={chrome.dim}>Tap “Save” in the top bar to save your current progression!</Body>
    </View>
  );
}

export type SavedProgressionsModalProps = {
  visible: boolean;
  onClose: () => void;
  saved: readonly SavedProgressionEntry[];
  onLoad: (entry: SavedProgressionEntry) => void;
  onExport: (entry: SavedProgressionEntry) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
};

export function SavedProgressionsModal({ visible, onClose, saved, onLoad, onExport, onDelete, onSaveCurrent }: SavedProgressionsModalProps) {
  const theme = useTheme();
  const { s, chrome } = theme;
  return (
    <ModalSheet visible={visible} onClose={onClose} maxWidth={480} maxHeight="80%">
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Title size={20}>Saved Progressions</Title>
        <Button label="✕" tone="ghost" onPress={onClose} />
      </Row>
      <Body size={13} color={chrome.dim}>Your locally saved chord progressions stored on this device.</Body>
      <ScrollView style={{ maxHeight: s(360) }}>
        <Stack gap={10}>
          {saved.length === 0 ? <NoSavedProgressions /> : saved.map((entry) => (
            <View key={entry.id} style={{ padding: s(12), borderRadius: s(8), backgroundColor: chrome.bg, borderWidth: theme.rule(1), borderColor: chrome.lineSoft, gap: s(8) }}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: s(8) }}>
                <View style={{ flex: 1, minWidth: s(180) }}>
                  <Title size={15}>{entry.title}</Title>
                  <Body size={11} color={chrome.dim}>{savedSummary(entry)}</Body>
                </View>
                <Row gap={6} style={{ alignItems: 'center' }}>
                  <Button label="Load" tone="accent" onPress={() => onLoad(entry)} />
                  <Button label="Export JSON" tone="ghost" onPress={() => onExport(entry)} />
                  <Button label="✕" tone="ghost" onPress={() => onDelete(entry.id)} />
                </Row>
              </Row>
            </View>
          ))}
        </Stack>
      </ScrollView>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingTop: s(4) }}>
        <Button label="Save current progression" tone="default" onPress={onSaveCurrent} />
        <Button label="Close" tone="ghost" onPress={onClose} />
      </Row>
    </ModalSheet>
  );
}
