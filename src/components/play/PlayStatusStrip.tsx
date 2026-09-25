import { ScrollView, View } from 'react-native';

import type { MicStatus } from '@audio';
import type { ArrangementLevel, ListenMode } from '@domain';
import type { ResolvedCelloLine } from '@scores';
import { useTheme } from '@theme';

import { Label, Row } from '../ui';
import { ListenChip } from './ListenControl';
import { trackChoiceSummary } from './TrackPicker';

const STATUS_BAR_HEIGHT = 36;

type ChipTone = 'dim' | 'accent';

function StatusChip({ label, tone = 'dim' }: { label: string; tone?: ChipTone }) {
  const theme = useTheme();
  return (
    <Row gap={5}>
      <View
        style={{
          width: theme.s(6),
          height: theme.s(6),
          borderRadius: theme.s(3),
          backgroundColor: tone === 'accent' ? theme.chrome.accent : theme.chrome.lineSoft,
        }}
      />
      <Label size={11} style={{ textTransform: 'none', letterSpacing: 0 }}>{label}</Label>
    </Row>
  );
}

const MIC_STATUS_LABEL: Record<MicStatus, string> = {
  idle: 'Microphone idle',
  running: 'Microphone idle',
  requesting: 'Waiting for microphone',
  denied: 'Microphone permission needed',
  unavailable: 'Microphone unavailable',
  error: 'Check microphone connection',
};

export type MicState = { enabled: boolean; live: boolean; status: MicStatus };

export function micStatusLabel(playRequested: boolean, mic: MicState): string {
  if (playRequested) return 'Microphone off while playing';
  if (!mic.enabled) return 'Microphone off';
  return mic.live ? 'Tuner listening' : MIC_STATUS_LABEL[mic.status];
}

function arrangementLabel(adaptive: boolean, level: ArrangementLevel): string {
  if (!adaptive) return 'Authored score';
  const levelName = level === 'Expert' ? 'Full' : level;
  return `${levelName} arrangement`;
}

export type PlayStatusStripProps = {
  playRequested: boolean;
  mic: MicState;
  tempoPercent: number;
  adaptive: boolean;
  arrangementLevel: ArrangementLevel;
  line: ResolvedCelloLine;
  listenMode: ListenMode;
  rendering: boolean;
};

/** Readings along the bottom of the play screen: microphone, tempo, arrangement and sound. */
export function PlayStatusStrip(props: PlayStatusStripProps) {
  const { playRequested, mic, line } = props;
  const theme = useTheme();
  const reseated = line.fit?.reseated ?? 0;
  return (
    <Row padX={10} gap={10} style={{ minHeight: Math.max(theme.tap, theme.s(STATUS_BAR_HEIGHT)) }}>
      {/*
        Scrolls rather than clips. These are readings, not controls, so losing
        the tail off the right-hand edge was survivable — but it also silently
        hid the one that says whether the accompaniment is still preparing.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', gap: theme.s(14) }}
        style={{ flex: 1 }}
      >
        <StatusChip label={micStatusLabel(playRequested, mic)} tone={!playRequested && mic.live ? 'accent' : 'dim'} />
        <StatusChip label={`${props.tempoPercent}% tempo`} />
        <StatusChip label={arrangementLabel(props.adaptive, props.arrangementLevel)} />
        {/* Which part you are on, in the accent, because mid-session the one
            thing worth knowing about a non-default line is that it is one. */}
        {props.adaptive && line.partId ? <StatusChip label={trackChoiceSummary(line)} tone="accent" /> : null}
        {reseated > 0 ? <StatusChip label={`${reseated} notes moved an octave`} /> : null}
        <ListenChip mode={props.listenMode} rendering={props.rendering} />
      </ScrollView>
    </Row>
  );
}
