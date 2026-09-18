import React, { useCallback, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollView, View } from 'react-native';

import { Fingerboard, FingerboardScaleNote, FingerboardStringLabels } from '@/components/Fingerboard';
import {
  Callout, CentsStill, FingerKey, HighwayStill, TabStill, TapeTable,
} from '@/components/tutorial/diagrams';
import { PressableRow } from '@/components/ui/controls';
import { Body, Kicker, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { stopDistanceMm, STRING_LENGTH_MM } from '@/domain/cello';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/theme/ThemeProvider';

const SECTIONS = [
  { id: 'nut', label: 'The nut is zero' },
  { id: 'numbers', label: 'The numbers are fingers' },
  { id: 'first', label: 'Your tapes' },
  { id: 'tab', label: 'Reading Tab' },
  { id: 'highway', label: 'Reading Highway' },
  { id: 'score', label: 'Reading Score' },
  { id: 'cents', label: 'The cents rail' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * Tutorial.
 *
 * Static by design: no microphone, no scrolling playhead, nothing to get
 * wrong. It answers the questions a beginner actually has in front of the
 * instrument — what is that number, where is that colour, which way is sharp —
 * and it answers them using this player's own tapes rather than a generic
 * diagram, because the whole point is that the screen matches the hand.
 */
export default function TutorialScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const { settings } = useSettings();

  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<SectionId, number>>>({});
  const [active, setActive] = useState<SectionId>('nut');

  const onSectionLayout = useCallback((id: SectionId) => (event: LayoutChangeEvent) => {
    offsets.current[id] = event.nativeEvent.layout.y;
  }, []);

  const jumpTo = useCallback((id: SectionId) => {
    setActive(id);
    const y = offsets.current[id];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, []);

  const [firstSet] = settings.tapeSets;
  const wide = !theme.scale.compact;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Reading guide" />

      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        {wide ? (
          <View style={{ width: theme.s(210), borderRightWidth: theme.rule(1), borderColor: chrome.lineSoft }}>
            <Stack padX={18} padY={16} gap={4}>
              <Label size={11}>HOW TO READ THIS</Label>
            </Stack>
            {SECTIONS.map((section, index) => (
              <PressableRow
                key={section.id}
                accessibilityLabel={`Jump to ${section.label}`}
                selected={active === section.id}
                onPress={() => jumpTo(section.id)}
              >
                <Row padX={18} padY={10} gap={10}>
                  <Num size={11} color={chrome.dim}>{String(index + 1).padStart(2, '0')}</Num>
                  <Label
                    size={13}
                    numberOfLines={2}
                    color={active === section.id ? chrome.accent : chrome.ink}
                    style={{ flex: 1, textTransform: 'none' }}
                  >
                    {section.label}
                  </Label>
                </Row>
              </PressableRow>
            ))}
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: theme.s(24), paddingBottom: theme.s(60) }}
          showsVerticalScrollIndicator={false}
        >
          <Stack padY={18} gap={8}>
            <Kicker size={11}>FOUR MINUTES · READ IT WITH THE CELLO IN FRONT OF YOU</Kicker>
            <Title accessibilityRole="header" size={30}>Reading guide</Title>
            <Body size={15} color={chrome.dim}>
              Three ways of showing the same four strings, one fingerboard panel that never
              moves, and one number that tells you whether you are in tune. Nothing here is a
              score you have to beat.
            </Body>
          </Stack>

          {/* ── 1 ─────────────────────────────────────────────────────────── */}
          <Section index={1} title="The nut is zero" onLayout={onSectionLayout('nut')}>
            <Body size={15}>
              The nut is the notched ridge at the top of the fingerboard, where the strings
              leave the pegbox. Every distance in this app is measured from it, and the
              diagram below uses Player orientation: the nut is at the bottom, as you see it while playing. Choose Diagram in display preferences to put it at the top.
            </Body>
            <Body size={15}>
              Play a string without touching it at all and you get its <B>open</B> note —
              C, G, D or A. That is finger 0, and it is the only note where the nut does the
              stopping instead of your hand.
            </Body>

            <Row gap={20} style={{ alignItems: 'flex-start' }}>
              <View>
                <Fingerboard
                  height={theme.s(300)}
                  maxMm={460}
                  tapeSets={settings.tapeSets}
                  gutter={54}
                />
                <FingerboardStringLabels gutter={54} />
                <FingerboardScaleNote />
              </View>
              <Stack gap={12} style={{ flex: 1 }}>
                <Callout title="WHY THE TAPES CROWD TOGETHER">
                  <Body size={14}>
                    Halving a string raises it by an octave. On a full-size cello the string is{' '}
                    {STRING_LENGTH_MM} mm, so the octave sits at exactly{' '}
                    {stopDistanceMm(12).toFixed(0)} mm — the halfway point. The first twelve
                    semitones take up that whole {stopDistanceMm(12).toFixed(0)} mm; the next
                    twelve are squeezed into just{' '}
                    {(stopDistanceMm(24) - stopDistanceMm(12)).toFixed(0)} mm. That is why every
                    diagram in this app is drawn to scale rather than evenly spaced: the
                    crowding is the single most useful thing to know about the upper positions.
                  </Body>
                </Callout>
                <Body size={14} color={chrome.dim}>
                  Your tapes sit at {firstSet.tapes.map((t) => `${stopDistanceMm(t.semitones).toFixed(0)} mm`).join(', ')}.
                </Body>
              </Stack>
            </Row>
          </Section>

          {/* ── 2 ─────────────────────────────────────────────────────────── */}
          <Section index={2} title="The numbers are fingers, not frets" onLayout={onSectionLayout('numbers')}>
            <Body size={15}>
              On a guitar tab, the number is which fret. A cello has no frets, so here the
              number means something different: it is <B>which finger</B>. Where that finger
              goes is decided by two other things — which line or lane the number sits on
              (that is the string) and which position the hand is in (that is the bracket
              above it).
            </Body>
            <FingerKey />
            <Callout title="THE HAND FRAME">
              <Body size={14}>
                In first position the four fingers sit one semitone apart, so first finger to
                little finger spans a minor third. Keep that shape and the hand does almost no
                work: you drop fingers rather than reaching for them. That shape is exactly
                what your four first-position tapes mark out.
              </Body>
            </Callout>
          </Section>

          {/* ── 3 ─────────────────────────────────────────────────────────── */}
          <Section
            index={3}
            title={`Your tapes: ${firstSet.tapes.map((t) => t.color).join(' · ')}`}
            onLayout={onSectionLayout('first')}
          >
            <Body size={15}>
              {firstSet.blurb}
            </Body>
            <TapeTable set={firstSet} />
            <Callout title="THE REPEATED COLOURS ARE NOT AMBIGUOUS">
              <Body size={14}>
                With nine tapes the colours have to come round again — there are three greens
                and three yellows. They are never confusable in practice, because a tape only
                ever narrows the note to a semitone and the string finishes the job. The
                second tape on the D string is F; the same colour on the A string is C. Those
                are not notes you will mix up once you have heard them.
              </Body>
            </Callout>
            <Callout title="THE FIRST FOUR ARE ONE HAND SHAPE">
              <Body size={14}>
                Blue, green, yellow, red — the first four tapes are the closed first-position
                frame, one semitone per finger, first finger to little finger spanning a minor
                third. Keep that shape and you drop fingers rather than reaching for them.
                Everything above the red tape is a shift: the hand travels, the shape does not
                change.
              </Body>
            </Callout>
            <Body size={15}>
              The blue tape further down, at the seventh semitone, is the neck heel — the
              point where you can feel the body of the cello against your hand. It is the one
              landmark up there you can find with your eyes shut, which is why it is worth
              having a tape on it even before you can use it.
            </Body>
            <Body size={15} color={chrome.dim}>
              Try “First Position Ladder” in the library. It walks the first four tapes on all
              four strings, one finger at a time, with nothing else going on.
            </Body>
          </Section>

          {/* ── 4 ─────────────────────────────────────────────────────────── */}
          <Section index={4} title="Reading Tab" onLayout={onSectionLayout('tab')}>
            <Body size={15}>
              Four horizontal lines, one per string, in the same order you see them looking
              down at the instrument: the A string on top, the C string at the bottom. Each
              line is drawn in that string’s colour, and the same four colours are used
              everywhere else in the app.
            </Body>
            <TabStill />
            <Stack gap={10}>
              <Legend swatchLabel="0" text="The number in the box is the finger. A zero means an open string." />
              <Legend swatchLabel="▁" text="The coloured bar under the number is the tape that finger lands on. No bar means no tape — either an open string or a note between tapes." />
              <Legend swatchLabel="⌐" text="The bracket across the top says which position the hand is in. When it turns orange, a shift is coming." />
              <Legend swatchLabel="⊓ V" text="Bow direction above the note: ⊓ is a down bow, V is an up bow." />
              <Legend swatchLabel="│" text="The orange line is now. The music slides right to left underneath it — play whatever is touching the line." />
            </Stack>
            <Callout title="WHY THE LINE SITS ON THE LEFT">
              <Body size={14}>
                It is a quarter of the way across rather than in the middle, because there is
                far more use in seeing what is coming than in reviewing what has gone. The low
                strings also need about 43 milliseconds of sound before the app can be sure
                what note they are — so a little more runway is honest.
              </Body>
            </Callout>
          </Section>

          {/* ── 5 ─────────────────────────────────────────────────────────── */}
          <Section index={5} title="Reading Highway" onLayout={onSectionLayout('highway')}>
            <Body size={15}>
              Four vertical lanes, one per string, C on the left through to A on the right.
              Blocks fall down the lanes towards the orange hit line at the bottom. Bow when a
              block touches the line; a tall block is a long note, so keep the bow moving.
            </Body>
            <HighwayStill />
            <Body size={15}>
              The coloured bar along the bottom edge of a block is the tape that note lands on
              — it is on the bottom because that is the edge that reaches the line first, and
              by then your hand should already be there.
            </Body>
            <Callout title="ONE DIFFERENCE FROM THE FINGERBOARD PANEL">
              <Body size={14}>
                Down the highway means <B>time</B>, not distance along the string. Down the
                fingerboard panel on the left means distance from the nut. They are two
                different axes on purpose: the highway answers “when”, the panel answers
                “where”.
              </Body>
            </Callout>
          </Section>

          {/* ── 6 ─────────────────────────────────────────────────────────── */}
          <Section index={6} title="Reading Score" onLayout={onSectionLayout('score')}>
            <Body size={15}>
              Standard bass clef notation, which is what cello music is actually written in.
              Higher on the stave means a higher note. The notehead is drawn in the colour of
              the string it should be played on, which is the one thing ordinary notation does
              not tell you.
            </Body>
            <Body size={15}>
              Two faint orange lines run above and below the stave, marking thirty cents sharp
              and thirty cents flat. The orange trace between them is your actual pitch as the
              app hears it, scrolling along with you. A trace that sits steadily under the
              middle is not a wrong note — it is a hand that needs to move a millimetre away
              from the nut.
            </Body>
            <Body size={15} color={chrome.dim}>
              Use this one when you want to practise reading. Use Tab when you want to practise
              playing.
            </Body>
          </Section>

          {/* ── 7 ─────────────────────────────────────────────────────────── */}
          <Section index={7} title="The cents rail" onLayout={onSectionLayout('cents')}>
            <CentsStill />
            <Callout title="LOW NOTES ANSWER SLOWLY">
              <Body size={14}>
                A low C vibrates 65 times a second, so the app has to listen for about 43
                milliseconds before it can tell you anything — roughly three frames. Up on the
                A string it answers in about 25. This is a property of sound, not a bug, and it
                is why the needle is deliberately damped rather than twitching: a jittery
                needle would be claiming a precision the microphone does not have.
              </Body>
            </Callout>
            <Body size={15}>
              Nothing here is scored. The rail is a mirror, not a mark.
            </Body>
          </Section>

          <View style={{ height: theme.s(20) }} />
          <Rule weight={2} />
          <Stack padY={18} gap={8}>
            <Label size={11}>IF YOUR TAPES ARE SOMEWHERE ELSE</Label>
            <Body size={14} color={chrome.dim}>
              Everything above is drawn from the tape set stored in Settings → My tapes. Move a
              tape there and every diagram, every note name and every colour in the app follows
              it.
            </Body>
          </Stack>
        </ScrollView>
      </View>
    </Screen>
  );
}

function Section({
  index, title, children, onLayout,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  return (
    <View onLayout={onLayout} style={{ paddingTop: theme.s(26) }}>
      <Rule weight={2} />
      <Row gap={12} style={{ paddingTop: theme.s(16), alignItems: 'flex-start' }}>
        <Num size={13} color={theme.chrome.accent} style={{ paddingTop: theme.s(6) }}>
          {String(index).padStart(2, '0')}
        </Num>
        <Title size={26} style={{ flex: 1 }}>{title}</Title>
      </Row>
      <Stack gap={16} style={{ paddingTop: theme.s(12) }}>{children}</Stack>
    </View>
  );
}

function Legend({ swatchLabel, text }: { swatchLabel: string; text: string }) {
  const theme = useTheme();
  return (
    <Row gap={12} style={{ alignItems: 'flex-start' }}>
      <View
        style={{
          width: theme.s(38),
          paddingVertical: theme.s(3),
          alignItems: 'center',
          borderWidth: theme.rule(1),
          borderColor: theme.chrome.line,
        }}
      >
        <Num size={12}>{swatchLabel}</Num>
      </View>
      <Body size={14} style={{ flex: 1 }}>{text}</Body>
    </Row>
  );
}

/** Inline emphasis. Archivo's heavy weight does the work a second face would. */
function B({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <Title size={15} style={{ lineHeight: theme.font(15) * 1.45 }}>{children}</Title>;
}
