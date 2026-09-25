import { SymbolView, type SymbolViewProps, type SymbolWeight } from 'expo-symbols';
import { Platform, Text } from 'react-native';

import { FACE, useTheme } from '@theme';

export type IconName =
  | 'back' | 'forward' | 'chevronDown' | 'close' | 'plus' | 'minus'
  | 'search' | 'library' | 'practice' | 'tuner' | 'chords' | 'import'
  | 'guide' | 'chart' | 'scales' | 'tapes' | 'sun' | 'moon' | 'sparkles'
  | 'play' | 'pause' | 'restart' | 'settings' | 'check' | 'note';

type SFSymbol = Extract<SymbolViewProps['name'], string>;
type Glyph = { sf: SFSymbol; text: string };

/**
 * One name per meaning, drawn as an SF Symbol on iOS and as a plain glyph
 * elsewhere. Screens ask for `back`, not `chevron.left`, so the whole app
 * changes symbol in one place.
 */
const GLYPHS: Record<IconName, Glyph> = {
  back: { sf: 'chevron.left', text: '‹' },
  forward: { sf: 'chevron.right', text: '›' },
  chevronDown: { sf: 'chevron.down', text: '⌄' },
  close: { sf: 'xmark', text: '×' },
  plus: { sf: 'plus', text: '+' },
  minus: { sf: 'minus', text: '−' },
  search: { sf: 'magnifyingglass', text: '⌕' },
  library: { sf: 'music.note.list', text: '♪' },
  practice: { sf: 'calendar', text: '▦' },
  tuner: { sf: 'tuningfork', text: '♮' },
  chords: { sf: 'pianokeys', text: '♯' },
  import: { sf: 'square.and.arrow.down', text: '↓' },
  guide: { sf: 'book', text: '?' },
  chart: { sf: 'square.grid.3x3', text: '▦' },
  scales: { sf: 'stairs', text: '≡' },
  tapes: { sf: 'paintpalette', text: '◐' },
  sun: { sf: 'sun.max', text: '☀' },
  moon: { sf: 'moon', text: '☾' },
  sparkles: { sf: 'sparkles', text: '✦' },
  play: { sf: 'play.fill', text: '▶' },
  pause: { sf: 'pause.fill', text: '❚❚' },
  restart: { sf: 'backward.end.fill', text: '⏮' },
  settings: { sf: 'slider.horizontal.3', text: '⚙' },
  check: { sf: 'checkmark', text: '✓' },
  note: { sf: 'music.note', text: '♪' },
};

export type IconProps = {
  name: IconName;
  /** Design units. */
  size?: number;
  color?: string;
  weight?: SymbolWeight;
};

export function Icon({ name, size = 17, color, weight = 'semibold' }: IconProps) {
  const theme = useTheme();
  const glyph = GLYPHS[name];
  const tint = color ?? theme.chrome.ink;
  const px = theme.s(size);
  const fallback = (
    <Text
      accessible={false}
      style={{ ...FACE.semibold, fontSize: px, lineHeight: px * 1.15, color: tint, textAlign: 'center', minWidth: px }}
    >
      {glyph.text}
    </Text>
  );
  if (Platform.OS !== 'ios') return fallback;
  return (
    <SymbolView
      name={glyph.sf}
      size={px}
      tintColor={tint}
      weight={weight}
      fallback={fallback}
      accessible={false}
      style={{ width: px, height: px }}
    />
  );
}
