import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  PracticeHeatmap, Button, Body, Label, Num, Row, Rule, Stack, Title, Screen, ScreenHeader,
} from '@components';
import {
  dayKey, daysPractised, formatDuration, PracticeLog, shiftDays, streaks, totalMs,
} from '@domain';
import { usePracticeActions, usePracticeLog, usePracticeReady } from '@state';
import { useTheme } from '@theme';

/**
 * Your practice.
 *
 * The only record the app keeps about the player, and it keeps it on the
 * phone: how long the transport actually ran, per day, and nothing else. No
 * account, no upload, no score out of ten — a beginner who plays for twenty
 * minutes badly has practised for twenty minutes, and that is the whole claim
 * this page is allowed to make.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { chrome } = theme;
  const log = usePracticeLog();
  const ready = usePracticeReady();
  const { clear } = usePracticeActions();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const wide = !theme.scale.compact;

  const today = new Date();
  const total = totalMs(log);
  const run = streaks(log, today);
  const days = daysPractised(log);
  const week = rangeMs(log, today, 7);
  const month = rangeMs(log, today, 30);
  const best = bestDay(log);

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader backLabel="Library" meta="Your practice" />

      <ScrollView contentContainerStyle={{ paddingBottom: theme.s(30) }}>
        <Stack padX={22} padY={16} gap={8}>
          <Title accessibilityRole="header" size={30}>Your practice</Title>
          <Body size={14} color={chrome.dim}>
            Counted while the music is actually running. Everything here lives on this phone
            and goes nowhere.
          </Body>
        </Stack>
        <Rule weight={1} />

        <View style={{ flexDirection: wide ? 'row' : 'column' }}>
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0 }}>
            <Stack padX={22} padY={18} gap={16}>
              <Row gap={20} style={{ flexWrap: 'wrap' }}>
                <Stat label="Total" value={formatDuration(total)} />
                <Stat label="This week" value={formatDuration(week)} />
                <Stat label="Last 30 days" value={formatDuration(month)} />
              </Row>
              <Row gap={20} style={{ flexWrap: 'wrap' }}>
                <Stat label="Current streak" value={`${run.current} ${run.current === 1 ? 'day' : 'days'}`} />
                <Stat label="Longest streak" value={`${run.longest} ${run.longest === 1 ? 'day' : 'days'}`} />
                <Stat label="Days practised" value={`${days}`} />
              </Row>
              {best ? (
                <Body size={13} color={chrome.dim}>
                  {`Your longest day so far was ${formatDuration(best.ms)} on ${best.key}.`}
                </Body>
              ) : null}
            </Stack>
          </View>

          {wide ? <Rule weight={1} vertical /> : null}

          <View style={{ flex: wide ? 1.3 : undefined, minWidth: 0 }}>
            <Stack padX={22} padY={18} gap={12}>
              <Label size={11}>The last six months</Label>
              {ready ? <PracticeHeatmap log={log} today={today} /> : (
                <Body size={13} color={chrome.dim}>Reading your practice record…</Body>
              )}
              {ready && days === 0 ? (
                <Body size={13} color={chrome.dim}>
                  Nothing here yet. Open a piece, press play, and the first square fills in.
                </Body>
              ) : null}
            </Stack>
          </View>
        </View>

        <Rule />
        <Stack padX={22} padY={18} gap={10}>
          <Label size={11}>Start again</Label>
          <Body size={13} color={chrome.dim}>
            Clearing the record cannot be undone — there is no copy anywhere else.
          </Body>
          {confirmingClear ? (
            <Row gap={10}>
              <Button label="Yes, clear it" tone="accent" onPress={() => { clear(); setConfirmingClear(false); }} />
              <Button label="Keep it" onPress={() => setConfirmingClear(false)} />
            </Row>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button label="Clear my practice record" onPress={() => setConfirmingClear(true)} />
            </View>
          )}
        </Stack>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Stack gap={4} style={{ minWidth: theme.s(104) }}>
      <Label size={10}>{label}</Label>
      <Num size={26}>{value}</Num>
    </Stack>
  );
}

/** Milliseconds practised over the last `days` days, today included. */
function rangeMs(log: PracticeLog, today: Date, days: number): number {
  let sum = 0;
  for (let back = 0; back < days; back++) {
    sum += log[dayKey(shiftDays(today, -back))] ?? 0;
  }
  return sum;
}

function bestDay(log: PracticeLog): { key: string; ms: number } | null {
  let best: { key: string; ms: number } | null = null;
  for (const [key, ms] of Object.entries(log)) {
    if (!best || ms > best.ms) best = { key, ms };
  }
  return best;
}
