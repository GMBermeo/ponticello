import { View } from 'react-native';

import type { PitchReading } from '@audio';
import {
  CENTS_PERFECT, centsBetween, formatCents, midiToFrequency, midiToPitchName, nearestOpenString,
  OPEN_STRING_MIDI, STRING_NUMERAL, STRING_ORDER, type CelloString,
} from '@domain';
import { intonationColor, useTheme } from '@theme';

import { Body, Grow, Label, Num, Row, Rule, Stack, Title } from '../ui';

function OpenStringRow({ string, cents }: { string: CelloString; cents: number | null }) {
  const theme = useTheme();
  const { chrome } = theme;
  const midi = OPEN_STRING_MIDI[string];
  const inTune = cents !== null && Math.abs(cents) <= CENTS_PERFECT;
  let offset = '—';
  if (inTune) offset = 'In tune';
  else if (cents !== null) offset = formatCents(cents);
  return (
    <View>
      <Row padY={10} padX={8} gap={14} style={{ borderRadius: theme.s(8), backgroundColor: cents === null ? 'transparent' : chrome.surface }}>
        <View style={{ width: theme.s(38), height: theme.s(38), borderRadius: theme.s(19), backgroundColor: chrome.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Title size={20} color={chrome.strings[string]}>{string}</Title>
        </View>
        <View style={{ flex: 1 }}>
          <Title size={15}>{`${midiToPitchName(midi)} · String ${STRING_NUMERAL[string]}`}</Title>
          <Body size={12} color={chrome.dim}>{midiToFrequency(midi).toFixed(2)} Hz</Body>
        </View>
        <Num size={15} color={inTune ? intonationColor('perfect', chrome) : chrome.dim}>{offset}</Num>
      </Row>
      <Rule />
    </View>
  );
}

/** The four open strings, with the one being bowed lit and its offset shown. */
export function OpenStringList({ reading }: { reading: PitchReading }) {
  const theme = useTheme();
  const compact = theme.scale.compact;
  const nearest = reading.voiced ? nearestOpenString(reading.frequency) : null;
  return (
    <Stack padY={compact ? 0 : 8} gap={8} style={{ flex: compact ? undefined : 1 }}>
      <Row><Label size={11}>Open strings</Label><Grow /><Body size={12} color={theme.chrome.dim}>C → G → D → A</Body></Row>
      {STRING_ORDER.map((string) => {
        const cents = nearest === string
          ? centsBetween(reading.frequency, midiToFrequency(OPEN_STRING_MIDI[string]))
          : null;
        return <OpenStringRow key={string} string={string} cents={cents} />;
      })}
    </Stack>
  );
}
