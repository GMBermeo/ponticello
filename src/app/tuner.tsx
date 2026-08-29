import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { LevelMeter } from '@/components/play/Meters';
import { Body, Grow, Kicker, Label, Num, Row, Rule, Stack, Title } from '@/components/ui/primitives';
import { Screen, ScreenHeader } from '@/components/ui/Screen';
import { usePitch } from '@/audio/usePitch';
import {
  A4_HZ, CENTS_PERFECT, midiToFrequency, midiToPitchName, OPEN_STRING_MIDI,
  STRING_NUMERAL, STRING_ORDER, CelloString,
} from '@/domain/cello';
import { useTheme } from '@/theme/ThemeProvider';
import { intonationColor } from '@/theme/tokens';

/** The meter spans ±50 cents, which is half a semitone either way. */
const SPAN = 50;

/**
 * Open-string tuner.
 *
 * Runs the same dual-rate engine the play screens use, on purpose: if the
 * tuner and the practice feedback disagreed about a low C, the player would
 * have no way of knowing which to believe. One pitch path, one answer.
 */
export default function TunerScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const pitch = usePitch(true, { tunerMode: true });

  // No target — report whatever is sounding, and let the player aim at it.
  useEffect(() => { pitch.setTarget(null); }, [pitch]);

  const { reading } = pitch;

  /** Which open string the player is closest to, so its row can light up. */
  const nearestString = useMemo<CelloString | null>(() => {
    if (!reading.voiced) return null;
    let best: CelloString | null = null;
    let bestDistance = Infinity;
    for (const string of STRING_ORDER) {
      const distance = Math.abs(
        1200 * Math.log2(reading.frequency / midiToFrequency(OPEN_STRING_MIDI[string])),
      );
      if (distance < bestDistance) { bestDistance = distance; best = string; }
    }
    // Beyond a whole tone away it is not the open string being tuned.
    return bestDistance <= 200 ? best : null;
  }, [reading]);

  const color = reading.verdict ? intonationColor(reading.verdict, chrome) : chrome.dim;

  const needle = useAnimatedStyle(() => {
    const clamped = Math.max(-SPAN, Math.min(SPAN, pitch.cents.get()));
    return { left: `${50 + (clamped / SPAN) * 50}%` };
  });

  const centsText = reading.voiced
    ? `${reading.cents > 0 ? '+' : reading.cents < 0 ? '−' : ''}${Math.abs(Math.round(reading.cents))}¢`
    : '—';

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="LIBRARY" meta={`A = ${A4_HZ} Hz`} />

      <Screen padded={false}>
        <Stack padX={22} padY={18} gap={8}>
          <Kicker size={10}>OPEN STRING TUNER · MPM / NSDF</Kicker>
          <Row gap={16} style={{ alignItems: 'flex-end' }}>
            <Title size={78} style={{ lineHeight: theme.font(78) }}>
              {reading.heard ?? '—'}
            </Title>
            <View style={{ paddingBottom: theme.s(10) }}>
              <Num size={16}>{reading.voiced ? `${reading.frequency.toFixed(1)} Hz` : '— Hz'}</Num>
              <Label size={11} style={{ textTransform: 'none' }}>
                {reading.heard === null
                  ? 'bow an open string'
                  : `target ${midiToFrequency(midiFromName(reading.heard)).toFixed(2)} Hz`}
              </Label>
            </View>
            <Grow />
            <View style={{ alignItems: 'flex-end', paddingBottom: theme.s(8) }}>
              <Num size={36} color={color}>{centsText}</Num>
              <Label size={10} color={color}>{verdictWord(reading.verdict)}</Label>
            </View>
          </Row>
        </Stack>
        <Rule />

        {/* Horizontal meter. */}
        <Stack padX={22} padY={18} gap={6}>
          <View style={{ height: theme.s(70), borderBottomWidth: theme.rule(2), borderColor: chrome.line }}>
            <View
              style={{
                position: 'absolute',
                left: `${50 - (CENTS_PERFECT / SPAN) * 50}%`,
                right: `${50 - (CENTS_PERFECT / SPAN) * 50}%`,
                top: 0,
                bottom: 0,
                backgroundColor: chrome.surface,
              }}
            />
            {[-50, -25, 0, 25, 50].map((value) => (
              <View
                key={value}
                style={{
                  position: 'absolute',
                  left: `${50 + (value / SPAN) * 50}%`,
                  bottom: 0,
                  width: theme.rule(1),
                  height: theme.s(value === 0 ? 70 : 22),
                  backgroundColor: value === 0 ? chrome.ink : chrome.line,
                }}
              />
            ))}
            {reading.voiced ? (
              <Animated.View
                style={[
                  { position: 'absolute', top: 0, bottom: 0, width: theme.rule(4), backgroundColor: color },
                  needle,
                ]}
              />
            ) : null}
          </View>
          <Row>
            <Label size={9}>−50¢</Label>
            <Grow />
            <Label size={9}>{`±${CENTS_PERFECT}¢ IN TUNE`}</Label>
            <Grow />
            <Label size={9}>+50¢</Label>
          </Row>
        </Stack>
        <Rule weight={2} />

        {/* The four open strings. */}
        {STRING_ORDER.map((string) => {
          const midi = OPEN_STRING_MIDI[string];
          const target = midiToFrequency(midi);
          const isNear = nearestString === string;
          const cents = isNear && reading.voiced
            ? 1200 * Math.log2(reading.frequency / target)
            : null;
          return (
            <View key={string}>
              <Row
                padX={22}
                padY={14}
                gap={14}
                style={{ backgroundColor: isNear ? chrome.surface : 'transparent' }}
              >
                <View style={{ width: theme.s(6), height: theme.s(36), backgroundColor: chrome.strings[string] }} />
                <View style={{ flex: 1 }}>
                  <Title size={18}>{`${midiToPitchName(midi)} · ${STRING_NUMERAL[string]}`}</Title>
                  <Label size={10}>
                    {string === 'C'
                      ? `${target.toFixed(2)} HZ · WEAK FUNDAMENTAL — READ ON THE LOW BAND`
                      : `${target.toFixed(2)} HZ`}
                  </Label>
                </View>
                <Num size={15} color={isNear ? chrome.ink : chrome.dim}>
                  {isNear && reading.voiced ? reading.frequency.toFixed(2) : '—'}
                </Num>
                <View style={{ width: theme.s(64), alignItems: 'flex-end' }}>
                  <Num
                    size={14}
                    color={cents === null
                      ? chrome.dim
                      : Math.abs(cents) <= CENTS_PERFECT
                        ? intonationColor('perfect', chrome)
                        : chrome.accent}
                  >
                    {cents === null
                      ? '—'
                      : Math.abs(cents) <= CENTS_PERFECT
                        ? '✓'
                        : `${cents > 0 ? '+' : '−'}${Math.abs(Math.round(cents))}¢`}
                  </Num>
                </View>
              </Row>
              <Rule />
            </View>
          );
        })}

        <Stack padX={22} padY={16} gap={10}>
          <Row gap={12}>
            <LevelMeter level={pitch.level} height={16} label="INPUT LEVEL" />
          </Row>
          {pitch.mic.error === null ? null : (
            <Body size={13} color={chrome.accent}>{pitch.mic.error}</Body>
          )}
          <Body size={12} color={chrome.dim}>
            Tune from the C string up. Each string you tighten pulls the others slightly flat,
            so go round twice.
          </Body>
        </Stack>
      </Screen>
    </Screen>
  );
}

function verdictWord(verdict: string | null): string {
  switch (verdict) {
    case 'perfect': return 'IN TUNE';
    case 'flat': return 'FLAT';
    case 'sharp': return 'SHARP';
    case 'miss': return 'OUT';
    default: return 'LISTENING';
  }
}

/** Scientific pitch name back to a MIDI number, for the target readout. */
function midiFromName(name: string): number {
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!match) return 69;
  const [, letter, accidental, octave] = match;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + letters[letter] + offset;
}
