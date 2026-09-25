import { View } from 'react-native';

import type { PracticeSetup } from '@state';
import { useTheme } from '@theme';

import { Body, Row, Stack, Stepper, Title } from '../ui';
import { MAX_TEMPO_PERCENT, MIN_TEMPO_PERCENT, TEMPO_STEP_PERCENT } from './setupOptions';

export type PracticeWindowControlsProps = {
  setup: PracticeSetup;
  bpm: number;
  barCount: number;
  onChange: (patch: Partial<PracticeSetup>) => void;
};

/** Tempo and the bars to loop: the two choices that decide how the session feels. */
export function PracticeWindowControls({ setup, bpm, barCount, onChange }: PracticeWindowControlsProps) {
  const theme = useTheme();
  const { tempoPercent, loopFromBar, loopToBar } = setup;
  return (
    <>
      <Row gap={12}>
        <View style={{ flex: 1 }}>
          <Title size={15}>Tempo</Title>
          <Body size={12} color={theme.chrome.dim}>{bpm} BPM · {tempoPercent}% of original</Body>
        </View>
        <Stepper label="tempo" value={tempoPercent} display={`${tempoPercent}%`}
          canDecrement={tempoPercent > MIN_TEMPO_PERCENT} canIncrement={tempoPercent < MAX_TEMPO_PERCENT}
          onDecrement={() => onChange({ tempoPercent: tempoPercent - TEMPO_STEP_PERCENT })}
          onIncrement={() => onChange({ tempoPercent: tempoPercent + TEMPO_STEP_PERCENT })} />
      </Row>
      <Stack gap={8}>
        <Row>
          <Title size={15} style={{ flex: 1 }}>Practice loop</Title>
          <Body size={12} color={theme.chrome.dim}>{loopToBar - loopFromBar + 1} bars selected</Body>
        </Row>
        <Row gap={12}>
          <Body size={14} style={{ flex: 1 }}>From bar</Body>
          <Stepper label="loop start bar" value={loopFromBar}
            canDecrement={loopFromBar > 1} canIncrement={loopFromBar < loopToBar}
            onDecrement={() => onChange({ loopFromBar: loopFromBar - 1 })}
            onIncrement={() => onChange({ loopFromBar: loopFromBar + 1 })} />
        </Row>
        <Row gap={12}>
          <Body size={14} style={{ flex: 1 }}>To bar</Body>
          <Stepper label="loop end bar" value={loopToBar}
            canDecrement={loopToBar > loopFromBar} canIncrement={loopToBar < barCount}
            onDecrement={() => onChange({ loopToBar: loopToBar - 1 })}
            onIncrement={() => onChange({ loopToBar: loopToBar + 1 })} />
        </Row>
      </Stack>
    </>
  );
}
