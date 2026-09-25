import { CelloChordDiagram } from "../CelloChordDiagram";
import { Body, Label, Title } from "../ui";
import { useMeasuredSize } from "../useMeasuredSize";
import { type CelloChordStudy, CHORD_ATLAS_DIAGRAM_SIZE } from "@domain";
import { useTheme } from "@theme";
import { View } from "react-native";

type ChordToneName = { name: string };

/** Caption under a shape: which tones it leaves out, or which chord it is really fingered as. */
function shapeNote(omitted: readonly ChordToneName[], study: CelloChordStudy | null | undefined, symbol: string | undefined): string {
  if (omitted.length) return `Omit ${omitted.map((tone) => tone.name).join(", ")}`;
  if (study && study.symbol !== symbol) return `Played as ${study.symbol}`;
  return " ";
}

/** Same first voicing in the preview, inline chart, and transition overlay. */
export function ChordSongShape({
  symbol,
  study,
  label,
  nextChord,
  scaleKey,
  allPositions = false,
  width = 128,
  maxHeight = Infinity,
  titleSize,
}: {
  symbol?: string;
  study?: CelloChordStudy | null;
  label?: string;
  nextChord?: CelloChordStudy;
  scaleKey?: string;
  /** Mark every position of the chord's notes — the improvising map. */
  allPositions?: boolean;
  width?: number;
  /** Measured device-pixel height available for the diagram. */
  maxHeight?: number;
  titleSize?: number;
}) {
  const theme = useTheme();
  const [size, onLayout, ref] = useMeasuredSize();
  const ratio =
    CHORD_ATLAS_DIAGRAM_SIZE.height / CHORD_ATLAS_DIAGRAM_SIZE.width;
  const diagramWidth = Math.min(
    size.width || theme.s(width),
    theme.s(width),
    maxHeight / ratio,
  );
  const omitted = study?.voicings[0]?.omittedTones ?? [];
  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={{ flex: 1, minWidth: 0, alignItems: "center", gap: theme.s(4) }}
    >
      {label ? <Label size={10}>{label}</Label> : null}
      {study ? (
        <CelloChordDiagram
          chord={study}
          measuredWidth={diagramWidth}
          presentation="atlas"
          tapeColors
          nextChord={nextChord}
          scaleKey={scaleKey}
          allPositions={allPositions}
        />
      ) : (
        <View
          style={{
            height: diagramWidth * ratio,
            justifyContent: "center",
            paddingHorizontal: theme.s(6),
          }}
        >
          <Body size={12} color={theme.chrome.dim}>
            {symbol ? "Diagram unavailable" : ""}
          </Body>
        </View>
      )}
      <Title size={titleSize ?? (label ? 22 : 18)} numberOfLines={1}>
        {symbol ?? "—"}
      </Title>
      {label || omitted.length ? (
        <Body
          size={10}
          color={theme.chrome.dim}
          numberOfLines={2}
          style={{ minHeight: theme.s(24), textAlign: "center" }}
        >
          {shapeNote(omitted, study, symbol)}
        </Body>
      ) : null}
    </View>
  );
}
