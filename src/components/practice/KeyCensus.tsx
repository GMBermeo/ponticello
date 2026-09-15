import { View } from 'react-native';

import { Body, Label, Num, Row, Stack, StringSwatch, Title } from '@/components/ui/primitives';
import { KEY_DEMAND_LABEL } from '@/domain/keyCensus';
import { KeyPracticeRow } from '@/scores';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * How a key earns its place on the practice screen.
 *
 * The number leads, because the number is the argument: a player deciding what
 * to spend an evening on wants to know that forty-four of their songs are in E
 * minor and three are in F♯ major. Everything else on the row is in service of
 * that — the bar so the comparison is pre-attentive, the demand label so the
 * top of the list reads as a recommendation rather than a coincidence, and the
 * string swatch where the key's tonic is an open string, in the same four hues
 * the highway and the fingerboard already use for C, G, D and A.
 *
 * Every size goes through `theme.s()`. The bar is the one thing here with a
 * size that is not a design unit: its width is a share of its own container,
 * expressed as a percentage, so it is right on any canvas.
 */
export function KeyDemandBar({
  row, of, maxShare, compact = false,
}: {
  row: KeyPracticeRow;
  /** Songs in the library, for the "N of M" reading. */
  of: number;
  /** Share of the most-used key, so the bars are scaled against the leader. */
  maxShare: number;
  compact?: boolean;
}) {
  const theme = useTheme();
  const tint = row.openString ? theme.chrome.strings[row.openString] : theme.chrome.accent;
  // Against the leader rather than against 100%, or every bar but the first is
  // a stub and the comparison the bar exists for is unreadable.
  const fill = maxShare > 0 ? Math.max(2, Math.round((row.share / maxShare) * 100)) : 0;

  return (
    <Stack gap={compact ? 5 : 7}>
      <Row gap={9}>
        {row.openString
          ? <StringSwatch color={tint} height={compact ? 14 : 18} width={5} />
          : <View style={{ width: theme.s(5) }} />}
        <Title size={compact ? 15 : 18} style={{ flex: 1 }} numberOfLines={1}>{row.key}</Title>
        <Num size={compact ? 12 : 13} color={theme.chrome.dim}>
          {row.songs} of {of}
        </Num>
      </Row>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${row.key}: ${row.songs} of ${of} songs, ${Math.round(row.share * 100)} per cent of the library`}
        style={{
          height: theme.s(compact ? 4 : 6),
          backgroundColor: theme.chrome.lineSoft,
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${fill}%`, height: '100%', backgroundColor: tint }} />
      </View>
      <Row gap={8}>
        <Label size={10} color={theme.chrome.dim}>{KEY_DEMAND_LABEL[row.demand]}</Label>
        <Label size={10} color={theme.chrome.dim} style={{ marginLeft: 'auto' }}>
          {row.drills.length === 0 ? 'No drill' : `${row.drills.length} drill${row.drills.length === 1 ? '' : 's'}`}
        </Label>
      </Row>
    </Stack>
  );
}

/**
 * The census in one sentence, for the practice sheet of a single drill.
 *
 * On the sheet the player has already chosen the key; what they have not been
 * told is why it was worth choosing, and that is a fact about their library
 * rather than about the scale.
 */
export function KeyCensusNote({
  row, of, verdict,
}: { row: KeyPracticeRow; of: number; verdict?: string }) {
  const theme = useTheme();
  const tint = row.openString ? theme.chrome.strings[row.openString] : theme.chrome.accent;

  return (
    <View style={{
      backgroundColor: theme.chrome.surface,
      padding: theme.s(16),
      borderRadius: theme.s(10),
      borderLeftWidth: theme.s(3),
      borderLeftColor: tint,
      gap: theme.s(7),
    }}>
      <Label size={11}>Why this key</Label>
      <Body size={14}>
        <Num size={14}>{row.songs}</Num>
        {` of the ${of} songs in your library ${row.songs === 1 ? 'is' : 'are'} in ${row.key}`}
        {row.rank === 1 ? ' — more than any other key.' : `, ranking it ${ordinal(row.rank)}.`}
      </Body>
      {row.openString ? (
        <Row gap={8}>
          <StringSwatch color={tint} height={14} width={5} />
          <Body size={13} color={theme.chrome.dim} style={{ flex: 1 }}>
            {`Its tonic is the open ${row.openString} string. Bow the string, then find the same note with a finger and listen for the two to stop beating.`}
          </Body>
        </Row>
      ) : null}
      {verdict ? <Body size={13} color={theme.chrome.dim}>{verdict}</Body> : null}
    </View>
  );
}

function ordinal(rank: number | null): string {
  if (rank === null) return 'unused';
  // 11th, 12th and 13th are the exceptions to the last-digit rule.
  const teens = rank % 100;
  if (teens >= 11 && teens <= 13) return `${rank}th`;
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`;
}
