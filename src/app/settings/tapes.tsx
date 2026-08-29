import { View } from 'react-native';

import { Fingerboard, FingerboardScaleNote, FingerboardStringLabels } from '@/components/Fingerboard';
import { Button, PressableRow, Stepper } from '@/components/ui/controls';
import { Body, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { midiToPitchName, stopDistanceMm, midiAt, STRING_ORDER } from '@/domain/cello';
import { TapeColor, TapeSet } from '@/domain/tapes';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';
import { TAPE_COLOR_LABEL } from '@/theme/tokens';

const COLORS: TapeColor[] = ['blue', 'yellow', 'green', 'red', 'orange', 'white'];

/**
 * My tapes.
 *
 * The defaults describe one particular cello — blue, yellow, yellow, green in
 * first position and blue, green, green, yellow up in thumb position. Tapes
 * get moved, and teachers disagree about where the thumb frame should sit, so
 * every one of them is editable here and everything downstream follows.
 */
export default function TapesScreen() {
  const theme = useTheme();
  const { settings, replaceTapeSet, resetTapes } = useSettings();
  const wide = !theme.scale.compact;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="LIBRARY" meta="EDIT THE TAPES ON YOUR OWN CELLO" />

      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        <View style={{ flex: 1.3, minWidth: 0 }}>
          <Screen padded={false}>
            <Stack padX={22} padY={16} gap={6}>
              <Title size={26}>My tapes</Title>
              <Body size={13} color={theme.chrome.dim}>
                Each tape is a distance from the nut, written here in semitones because that is
                what fixes the note. Move one and every screen in the app moves with it.
              </Body>
            </Stack>
            <Rule weight={2} />

            {settings.tapeSets.map((set) => (
              <TapeSetEditor key={set.id} set={set} onChange={replaceTapeSet} />
            ))}

            <Stack padX={22} padY={18} gap={10}>
              <Button label="Reset to my defaults" onPress={resetTapes} />
              <Body size={12} color={theme.chrome.dim}>
                Back to blue · yellow · yellow · green in first position and
                blue · green · green · yellow in thumb position.
              </Body>
            </Stack>
          </Screen>
        </View>

        {wide ? <Rule weight={2} vertical /> : null}

        <View style={{ flex: 1, minWidth: 0 }}>
          <Screen padded={false}>
            <Stack padX={22} padY={16} gap={12}>
              <Label size={11}>TO SCALE</Label>
              <Row gap={12} style={{ alignItems: 'flex-start' }}>
                <Fingerboard height={theme.s(430)} maxMm={460} tapeSets={settings.tapeSets} gutter={50} />
                <View style={{ flex: 1 }}>
                  <Body size={12} color={theme.chrome.dim}>
                    Measure from the edge of the nut nearest the fingerboard, along the D string.
                    If your tapes sit somewhere else, change the semitone values on the left until
                    the millimetres match.
                  </Body>
                </View>
              </Row>
              <FingerboardStringLabels />
              <FingerboardScaleNote />
            </Stack>
          </Screen>
        </View>
      </View>
    </Screen>
  );
}

function TapeSetEditor({
  set, onChange,
}: { set: TapeSet; onChange: (next: TapeSet) => void }) {
  const theme = useTheme();
  const { chrome } = theme;

  const patch = (id: string, changes: Partial<TapeSet['tapes'][number]>) => {
    onChange({ ...set, tapes: set.tapes.map((t) => (t.id === id ? { ...t, ...changes } : t)) });
  };

  return (
    <View>
      <Stack padX={22} padY={12} gap={4}>
        <Label size={11} color={chrome.ink}>{set.name.toUpperCase()}</Label>
        <Body size={12} color={chrome.dim}>{set.blurb}</Body>
      </Stack>
      <Rule />

      {set.tapes.map((tape) => (
        <View key={tape.id}>
          <Row padX={22} padY={12} gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: theme.s(46), height: theme.s(14), backgroundColor: chrome.tapes[tape.color] }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Title size={15}>{`${TAPE_COLOR_LABEL[tape.color]} · ${tape.caption}`}</Title>
              <Label size={10}>
                {`${stopDistanceMm(tape.semitones).toFixed(1)} MM FROM THE NUT · ${tape.semitones} SEMITONES`}
              </Label>
              <Row gap={10} style={{ marginTop: theme.s(5), flexWrap: 'wrap' }}>
                {STRING_ORDER.map((string) => (
                  <Num key={string} size={11} color={chrome.strings[string]}>
                    {midiToPitchName(midiAt(string, tape.semitones))}
                  </Num>
                ))}
              </Row>
              <Row gap={5} style={{ marginTop: theme.s(7) }}>
                {COLORS.map((color) => (
                  <PressableRow
                    key={color}
                    accessibilityLabel={`Set ${tape.caption} to ${TAPE_COLOR_LABEL[color]}`}
                    onPress={() => patch(tape.id, { color })}
                  >
                    <View
                      style={{
                        width: theme.s(26),
                        height: theme.s(18),
                        backgroundColor: chrome.tapes[color],
                        borderWidth: theme.rule(tape.color === color ? 2 : 1),
                        borderColor: tape.color === color ? chrome.ink : chrome.lineSoft,
                      }}
                    />
                  </PressableRow>
                ))}
              </Row>
            </View>
            <Stepper
              label={`${tape.caption} position`}
              value={tape.semitones}
              display={`${tape.semitones} st`}
              canDecrement={tape.semitones > 1}
              canIncrement={tape.semitones < 24}
              onDecrement={() => patch(tape.id, { semitones: tape.semitones - 1 })}
              onIncrement={() => patch(tape.id, { semitones: tape.semitones + 1 })}
            />
          </Row>
          <Rule />
        </View>
      ))}
      <View style={{ height: theme.s(4) }} />
      <Rule weight={2} />
    </View>
  );
}
