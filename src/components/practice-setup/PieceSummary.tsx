import { LIBRARY_KEY_CENSUS, censusForDrill, firstPositionVerdict, type ResolvedPiece } from '@scores';
import { useTheme } from '@theme';

import { trackChoiceSummary } from '../play';
import { KeyCensusNote } from '../practice';
import { Body, Card, Kicker, Label, Stack, Title } from '../ui';

export type PieceSummaryProps = {
  pieceId: string | undefined;
  piece: ResolvedPiece;
  arrangementLabel: string | undefined;
  arrangementHint: string | undefined;
  wide: boolean;
};

/**
 * What you are about to play. When the player has taken a source part, this
 * describes *that* rather than the arrangement they overruled — including
 * what the octave shift cost, so the consequence is in the place they
 * already read.
 */
function cellPartHeadline({ piece, arrangementLabel }: PieceSummaryProps): string | undefined {
  const { row, line, adaptive } = piece;
  if (!adaptive) return row?.difficulty;
  if (line.partId) return trackChoiceSummary(line);
  return `${arrangementLabel} arrangement`;
}

function cellPartDetail({ piece, arrangementHint }: PieceSummaryProps): string | undefined {
  const { row, line, adaptive, score } = piece;
  if (!adaptive) return row?.note;
  if (line.fit) return line.fit.reason;
  if (piece.authoredLevels) return score?.metadata.teaches;
  return arrangementHint;
}

/** Left column of the practice sheet: title, meter and the part being practised. */
export function PieceSummary(props: PieceSummaryProps) {
  const theme = useTheme();
  const { piece, pieceId, wide } = props;
  const { row, score } = piece;
  // Set only for a scale drill: the census row for its key, so the sheet can
  // say how much of the player's own library the key is worth.
  const keyRow = censusForDrill(pieceId);
  if (!row) return null;
  return (
    <Stack gap={12} style={[{ paddingHorizontal: theme.s(4) }, wide ? { width: theme.s(280) } : null]}>
      <Kicker size={11}>{row.composer}</Kicker>
      <Title accessibilityRole="header" size={32}>{row.title}</Title>
      <Body size={14} color={theme.chrome.dim}>
        {row.keySignature} · {score?.metadata.timeSignature ?? 'Meter unavailable'} · {score?.measures.length ?? 0} bars
      </Body>
      <Card gap={8}>
        <Label size={11}>{piece.adaptive ? 'Your cello part' : 'About this study'}</Label>
        <Title size={19}>{cellPartHeadline(props)}</Title>
        <Body size={14} color={theme.chrome.dim}>{cellPartDetail(props)}</Body>
        <Body size={13} color={theme.chrome.dim}>Range {row.range}</Body>
      </Card>
      {keyRow ? (
        <KeyCensusNote row={keyRow} of={LIBRARY_KEY_CENSUS.counted}
          verdict={firstPositionVerdict(keyRow.tonic, keyRow.mode).note} />
      ) : null}
      {wide ? <Body size={13} color={theme.chrome.dim}>Start slowly. Repeat a few bars until the movements feel familiar.</Body> : null}
    </Stack>
  );
}
