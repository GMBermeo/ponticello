import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { sheetLineSegments, type SheetLine } from '@domain';
import { useTheme, type Chrome } from '@theme';

import { Label } from '../ui';
import { ChordSongShape } from './ChordSongShape';
import type { ChartView, ChordStudies } from './chordReader';

const MONOSPACE = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const ACCENT_INK_DARK = '#060913';
const ACCENT_INK_LIGHT = '#FFFFFF';

function chordSymbolColor(selected: boolean, chrome: Chrome): string {
  if (!selected) return chrome.accent;
  return chrome.dark ? ACCENT_INK_DARK : ACCENT_INK_LIGHT;
}

export type LyricLineProps = {
  line: SheetLine;
  lineIndex: number;
  /** Change index sounding on this line, or −1 when the playhead is elsewhere. */
  activeChange: number;
  omitted: boolean;
  mode: ChartView;
  studies: ChordStudies;
  scaleKey?: string;
  onChord: (lineIndex: number, changeIndex: number) => void;
};

type ChordButtonProps = {
  symbol: string;
  selected: boolean;
  shapes: boolean;
  accessibilityLabel: string;
  studies: ChordStudies;
  scaleKey?: string;
  onPress: () => void;
};

function ChordButton({ symbol, selected, shapes, accessibilityLabel, studies, scaleKey, onPress }: ChordButtonProps) {
  const { s, font, chrome, tap } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: tap,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        minWidth: tap,
        padding: s(4),
        borderRadius: s(4),
        borderWidth: shapes ? 2 : 0,
        borderColor: selected ? chrome.accent : 'transparent',
        backgroundColor: selected && !shapes ? chrome.accent : 'transparent',
      }}
    >
      {shapes ? (
        <View style={{ width: s(112) }}>
          <ChordSongShape symbol={symbol} study={studies.get(symbol)} scaleKey={scaleKey} width={108} />
        </View>
      ) : (
        <Text style={{ fontFamily: MONOSPACE, fontWeight: '700', fontSize: font(16), color: chordSymbolColor(selected, chrome) }}>
          {symbol}
        </Text>
      )}
    </Pressable>
  );
}

/** One line of the chart: chord changes over their lyric syllables, or a section heading. */
export function LyricLine({ line, lineIndex, activeChange, omitted, mode, studies, scaleKey, onChord }: LyricLineProps) {
  const { s, font, chrome, tap } = useTheme();
  if (line.kind === 'section') {
    return <Label size={12} style={{ marginTop: s(18), marginBottom: s(8) }}>{line.text}</Label>;
  }
  if (omitted && !line.changes.length) return <View style={{ minHeight: s(28) }} />;
  const shapes = mode === 'shapes';
  const shapeSuffix = shapes ? ' shape' : '';
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: shapes ? 'flex-start' : 'flex-end',
        marginBottom: s(18),
        paddingVertical: s(4),
        borderRadius: s(6),
        backgroundColor: activeChange >= 0 ? chrome.accentWash : 'transparent',
      }}
    >
      {sheetLineSegments(line).map((part, i) => {
        const { chord, changeIndex } = part;
        let chordSlot: ReactNode = null;
        if (chord) {
          chordSlot = (
            <ChordButton
              symbol={chord.symbol}
              selected={activeChange === changeIndex}
              shapes={shapes}
              accessibilityLabel={`${chord.symbol}${shapeSuffix}, ${line.id}, change ${changeIndex + 1}`}
              studies={studies}
              scaleKey={scaleKey}
              onPress={() => onChord(lineIndex, changeIndex)}
            />
          );
        } else if (!shapes) {
          chordSlot = <View style={{ height: tap }} />;
        }
        return (
          <View key={i} style={{ maxWidth: '100%', minWidth: chord ? tap : 0, paddingRight: chord ? s(6) : 0 }}>
            {chordSlot}
            {!omitted && part.lyric ? (
              <Text style={{ fontFamily: MONOSPACE, fontSize: font(16), lineHeight: font(26), color: chrome.ink }}>
                {part.lyric}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
