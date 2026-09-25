import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  PracticeHeatmap, Button, Body, Card, Label, Num, Row, Screen, TabHeader,
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
      <TabHeader
        title="Practice"
        subtitle="Counted while the music is actually running. Everything here lives on this phone and goes nowhere."
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.s(16), paddingBottom: theme.s(30), gap: theme.s(14) }}>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.s(14) }}>
          <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: theme.s(10) }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.s(10) }}>
              <Stat label="Total" value={formatDuration(total)} highlight />
              <Stat label="This week" value={formatDuration(week)} />
              <Stat label="Last 30 days" value={formatDuration(month)} />
              <Stat label="Current streak" value={`${run.current} ${run.current === 1 ? 'day' : 'days'}`} />
              <Stat label="Longest streak" value={`${run.longest} ${run.longest === 1 ? 'day' : 'days'}`} />
              <Stat label="Days practised" value={`${days}`} />
            </View>
            {best ? (
              <Body size={13} color={chrome.dim} style={{ paddingHorizontal: theme.s(4) }}>
                {`Your longest day so far was ${formatDuration(best.ms)} on ${best.key}.`}
              </Body>
            ) : null}
          </View>

          <Card gap={12} style={{ flex: wide ? 1.3 : undefined, minWidth: 0 }}>
            <Label size={11}>The last six months</Label>
              {ready ? <PracticeHeatmap log={log} today={today} /> : (
                <Body size={13} color={chrome.dim}>Reading your practice record…</Body>
              )}
              {ready && days === 0 ? (
                <Body size={13} color={chrome.dim}>
                  Nothing here yet. Open a piece, press play, and the first square fills in.
                </Body>
              ) : null}
          </Card>
        </View>

        <Card gap={10}>
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
        </Card>
      </ScrollView>
    </Screen>
  );
}

/** One figure on its own tile, three to a row on the Duo's inner display. */
function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  const theme = useTheme();
  const { chrome } = theme;
  return (
    <Card
      pad={14}
      gap={6}
      style={{
        flexGrow: 1, flexBasis: theme.s(128), minWidth: theme.s(120),
        backgroundColor: highlight ? chrome.accent : chrome.surface,
      }}
    >
      <Label size={10} color={highlight ? chrome.onAccent : chrome.dim}>{label}</Label>
      <Num size={24} color={highlight ? chrome.onAccent : chrome.ink}>{value}</Num>
    </Card>
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
