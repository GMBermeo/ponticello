import { Linking, Pressable, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import type { ChordSheet } from '@domain';
import { useTheme } from '@theme';

import { Body, Button, Row, Segmented, Stack, Title, Toggle, type Segment } from '../ui';
import type { ChartView } from './chordReader';

const SPOTIFY_ROUND_ICON_XML = `
<svg viewBox="0 0 24 24" width="24" height="24">
  <circle cx="12" cy="12" r="12" fill="#1DB954"/>
  <path d="M17.9 10.9C14.3 8.8 8.4 8.6 5 9.6c-.6.2-1.1-.2-1.3-.7-.2-.6.2-1.1.7-1.3 4-1.2 10.5-1 14.7 1.5.5.3.7 1 .4 1.5-.3.4-1 .6-1.6.3zm-.2 2.8c-.2.4-.7.5-1.1.3-3-1.8-7.5-2.3-11-1.3-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 4-1.2 9.1-.6 12.5 1.5.4.1.5.7.1 1zm-1.3 2.7c-.2.3-.6.4-.9.2-2.6-1.6-5.8-1.9-9.7-1.1-.3.1-.7-.1-.8-.5-.1-.3.1-.7.5-.8 4.2-.9 7.8-.6 10.7 1.2.3.2.4.6.2 1z" fill="#000000"/>
</svg>
`;

const CHART_VIEWS: readonly Segment<ChartView>[] = [
  { value: 'names', label: 'Chord names' },
  { value: 'shapes', label: 'Chord shapes' },
];

export type ChordReaderHeaderProps = {
  sheet: ChordSheet;
  chartView: ChartView;
  onChartViewChange: (view: ChartView) => void;
  /** The preview toggles only apply where a preview is drawn. */
  showPreviewToggles: boolean;
  showTransition: boolean;
  onShowTransitionChange: (show: boolean) => void;
  showKeyScale: boolean;
  onShowKeyScaleChange: (show: boolean) => void;
  /** Called before leaving the app for a link, so the scroll stops. */
  onLeave: () => void;
};

/** Title, listening links, and the chart's view options. */
export function ChordReaderHeader(props: ChordReaderHeaderProps) {
  const { sheet, onLeave } = props;
  const theme = useTheme();
  const open = (url: string) => {
    onLeave();
    void Linking.openURL(url);
  };
  return (
    <Stack pad={16} gap={10}>
      <Row gap={12} style={{ alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Title size={24}>{sheet.title}</Title>
          <Body size={12} color={theme.chrome.dim}>{sheet.artist} · Key {sheet.key ?? 'unknown'}</Body>
        </View>
        {sheet.spotifyUrl ? (
          <SpotifyLink title={sheet.title} onPress={() => open(sheet.spotifyUrl ?? '')} />
        ) : null}
        {sheet.sourceUrl ? <Button label="Source" tone="ghost" onPress={() => open(sheet.sourceUrl)} /> : null}
      </Row>
      <Segmented
        accessibilityLabel="Chord chart view"
        segments={CHART_VIEWS}
        value={props.chartView}
        onChange={props.onChartViewChange}
        grow
        compact
      />
      {props.showPreviewToggles ? (
        <>
          <Toggle
            label="Preview next fingering"
            hint="Show next chord notes in grey on the current diagram."
            value={props.showTransition}
            onChange={props.onShowTransitionChange}
          />
          <Toggle
            label="Preview key"
            hint={sheet.key ? `Show ${sheet.key} scale notes on chord diagrams.` : 'Show key scale notes on chord diagrams.'}
            value={props.showKeyScale}
            onChange={props.onShowKeyScaleChange}
          />
        </>
      ) : null}
    </Stack>
  );
}

function SpotifyLink({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${title} on Spotify`}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, justifyContent: 'center', alignItems: 'center', padding: theme.s(4) })}
    >
      <SvgXml xml={SPOTIFY_ROUND_ICON_XML} width={theme.s(28)} height={theme.s(28)} />
    </Pressable>
  );
}
