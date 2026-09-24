import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  FingerboardChart, NoteDisc, Segmented, Toggle, Body, Label, Num, Row, Rule, Stack, Title,
  Screen, ScreenHeader,
  type Segment,
} from '@components';
import {
  DISPLAY_STRING_ORDER, midiAt, midiToPitchName, OPEN_STRING_MIDI, STRING_NUMERAL,
  LETTER_PITCH_CLASS, NOTE_COLOR, NOTE_COLOR_LABEL, NOTE_LETTERS,
} from '@domain';
import { BoardView, useTapeSettings, useVisionPreferences } from '@state';
import { useTheme } from '@theme';

const BOARD_VIEWS: readonly Segment<BoardView>[] = [
  { value: 'reader', label: 'Diagram', hint: 'Nut at the top, as a chart is printed' },
  { value: 'player', label: 'Player', hint: 'Nut at the bottom, as you see it' },
];

/**
 * Cello fingerboard chart.
 *
 * The wall poster, generated rather than scanned. Every note from the open
 * string to the octave, on every string, in the app's own colour constant —
 * so the chart, the score page's coloured noteheads and the string rails on
 * the play screen are all saying the same thing.
 *
 * The colour code itself is the payload, and it is printed here in full
 * underneath the board. It is a constant today; the point of naming it in one
 * place is that it can become the player's own palette without any screen
 * needing to learn about it.
 */
export default function ChartScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const { tapeSets, showTapes: preferTapes } = useTapeSettings();
  const { boardView: preferredBoardView } = useVisionPreferences();
  const wide = !theme.scale.compact;

  // Local, not the shared preference. Turning the chart round to read it the
  // way a poster is printed should not quietly turn the play screen's
  // fingerboard round too — but it is worth arriving on whichever way up the
  // player already reads everything else.
  const [boardView, setBoardView] = useState<BoardView>(preferredBoardView);
  const [showTapes, setShowTapes] = useState(preferTapes);

  // Tall enough that the crowded rows near the octave still take a disc each.
  const boardHeight = theme.s(720);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Fingerboard chart" />

      <ScrollView contentContainerStyle={{ paddingBottom: theme.s(30) }}>
        <Stack padX={22} padY={16} gap={8}>
          <Title accessibilityRole="header" size={30}>Cello fingerboard chart</Title>
          <Body size={14} color={chrome.dim}>
            Every note from the open string down to the octave, coloured by its name. A sharp
            and its flat are one place on the string and two names on the page, so they take
            both neighbours’ colours — C♯ is half green, half blue.
          </Body>
          <Body size={13} color={chrome.dim}>
            Drawn to scale: the rows crowd together as they climb, exactly as the notes do
            under your hand.
          </Body>
        </Stack>
        <Rule weight={1} />

        <View style={{ flexDirection: wide ? 'row' : 'column' }}>
          <View style={{ flex: wide ? 1.1 : undefined, minWidth: 0 }}>
            <Stack padX={22} padY={16} gap={12}>
              <Row gap={12} style={{ flexWrap: 'wrap' }}>
                <Label size={11}>Orientation</Label>
                <Segmented
                  accessibilityLabel="Chart orientation"
                  segments={BOARD_VIEWS}
                  value={boardView}
                  onChange={setBoardView}
                  compact
                />
              </Row>
              <Toggle
                label="Show my tapes"
                hint="Lay your own tape colours across the chart."
                value={showTapes}
                onChange={setShowTapes}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <FingerboardChart
                    height={boardHeight}
                    tapeSets={tapeSets}
                    showTapes={showTapes}
                    invert={boardView === 'player'}
                  />
                  <ChartStringLabels />
                </View>
              </ScrollView>
            </Stack>
          </View>

          {wide ? <Rule weight={1} vertical /> : null}

          <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
            <ColourKey />
            <Rule />
            <OpenStrings />
            <Rule />
            <FirstPositionNotes />
          </View>
        </View>

        <Rule weight={1} />
        <Scales />
      </ScrollView>
    </Screen>
  );
}

/** String names under the chart, on the same 38-unit disc pitch. */
function ChartStringLabels() {
  const theme = useTheme();
  const disc = theme.s(38);
  const stringGap = Math.max(disc + theme.s(6), theme.s(46));
  return (
    <Row style={{ marginLeft: theme.s(34), marginTop: theme.s(6) }}>
      {DISPLAY_STRING_ORDER.map((string) => (
        <View key={string} style={{ width: stringGap, alignItems: 'flex-start' }}>
          <View style={{ width: disc, alignItems: 'center' }}>
            <Num size={14} color={theme.chrome.strings[string]}>{string}</Num>
            <Label size={9}>{STRING_NUMERAL[string]}</Label>
          </View>
        </View>
      ))}
    </Row>
  );
}

/** The constant, printed. One row per letter, in scale order. */
function ColourKey() {
  const theme = useTheme();
  return (
    <Stack padX={22} padY={16} gap={12}>
      <Label size={11}>The colour code</Label>
      <Body size={13} color={theme.chrome.dim}>
        Seven letters, seven colours. The four open strings keep theirs everywhere in the
        app — C green, G red, D blue, A yellow — and the other three sit in the gaps those
        four leave, so no two neighbouring letters look alike.
      </Body>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.s(10) }}>
        {NOTE_LETTERS.map((letter) => (
          <Row key={letter} gap={8} style={{ alignItems: 'center', minWidth: theme.s(96) }}>
            <NoteDisc pitchClass={LETTER_PITCH_CLASS[letter]} units={30} />
            <View>
              <Num size={15}>{letter}</Num>
              <Label size={9}>{NOTE_COLOR_LABEL[NOTE_COLOR[letter]]}</Label>
            </View>
          </Row>
        ))}
      </View>
      <Row gap={10} style={{ alignItems: 'center' }}>
        <NoteDisc pitchClass={1} units={30} />
        <Body size={13} color={theme.chrome.dim} style={{ flex: 1 }}>
          A black key takes both: C♯ and D♭ are the same finger in the same place.
        </Body>
      </Row>
    </Stack>
  );
}

function OpenStrings() {
  const theme = useTheme();
  return (
    <Stack padX={22} padY={16} gap={12}>
      <Label size={11}>Open strings</Label>
      <Body size={13} color={theme.chrome.dim}>
        Low to high. Finger 0 — the nut does the stopping, not your hand.
      </Body>
      <Row gap={14}>
        {['C', 'G', 'D', 'A'].map((string) => {
          const midi = OPEN_STRING_MIDI[string as 'C'];
          return (
            <View key={string} style={{ alignItems: 'center', gap: theme.s(5) }}>
              <NoteDisc pitchClass={midi % 12} units={34} />
              <Label size={9}>{midiToPitchName(midi)}</Label>
            </View>
          );
        })}
      </Row>
    </Stack>
  );
}

/** Degrees of a major scale, in semitones above the tonic. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12] as const;

/** The seven keys the printed charts put across the top, in colour. */
const SCALE_KEYS: { label: string; tonic: number }[] = [
  { label: 'C major', tonic: 0 },
  { label: 'G major', tonic: 7 },
  { label: 'D major', tonic: 2 },
  { label: 'A major', tonic: 9 },
  { label: 'E major', tonic: 4 },
  { label: 'B major', tonic: 11 },
  { label: 'F major', tonic: 5 },
];

/**
 * The scales, as colour rather than as notation.
 *
 * The printed poster sets each scale on a stave; this prints the same seven
 * keys as the colours you are about to look for on the fingerboard above,
 * which is the part a beginner is actually reading off the wall. The notated
 * version, with fingerings, is a tap away under Scales in the library.
 */
function Scales() {
  const theme = useTheme();
  return (
    <Stack padX={22} padY={16} gap={12}>
      <Label size={11}>Scales</Label>
      <Body size={13} color={theme.chrome.dim}>
        One octave, tonic to tonic. Read the colours across, then find the same colours
        going down the chart.
      </Body>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Stack gap={8}>
          {SCALE_KEYS.map((scale) => (
            <Row key={scale.label} gap={8} style={{ alignItems: 'center' }}>
              <View style={{ width: theme.s(72) }}>
                <Label size={10}>{scale.label}</Label>
              </View>
              {MAJOR.map((degree, index) => (
                <NoteDisc key={index} pitchClass={(scale.tonic + degree) % 12} units={28} />
              ))}
            </Row>
          ))}
        </Stack>
      </ScrollView>
    </Stack>
  );
}

/** What the four fingers give on each string, the way a beginner is taught it. */
function FirstPositionNotes() {
  const theme = useTheme();
  // Fingers 0–4 in first position: open, then the closed frame at 2, 3, 4, 5.
  const seats: { finger: string; semitones: number }[] = [
    { finger: '0', semitones: 0 },
    { finger: '1', semitones: 2 },
    { finger: '2', semitones: 3 },
    { finger: '3', semitones: 4 },
    { finger: '4', semitones: 5 },
  ];

  return (
    <Stack padX={22} padY={16} gap={12}>
      <Label size={11}>First position, string by string</Label>
      <Row gap={10} style={{ paddingLeft: theme.s(28) }}>
        {seats.map((seat) => (
          <View key={seat.finger} style={{ width: theme.s(34), alignItems: 'center' }}>
            <Label size={9}>{seat.finger}</Label>
          </View>
        ))}
      </Row>
      {['A', 'D', 'G', 'C'].map((string) => (
        <Row key={string} gap={10} style={{ alignItems: 'center' }}>
          <View style={{ width: theme.s(22) }}>
            <Num size={14} color={theme.chrome.strings[string as 'A']}>{string}</Num>
          </View>
          {seats.map((seat) => (
            <View key={seat.finger} style={{ width: theme.s(34), alignItems: 'center' }}>
              <NoteDisc pitchClass={midiAt(string as 'A', seat.semitones) % 12} units={30} />
            </View>
          ))}
        </Row>
      ))}
    </Stack>
  );
}
