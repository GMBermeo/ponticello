import { CelloChordDiagram } from "@/components/CelloChordDiagram";
import { Body, Label, Title } from "@/components/ui/primitives";
import { useMeasuredSize } from "@/components/useMeasuredSize";
import type { CelloChordStudy } from "@/domain/celloChords";
import { CHORD_ATLAS_DIAGRAM_SIZE } from "@/domain/chords/diagram";
import { useTheme } from "@/theme/ThemeProvider";
import { View } from "react-native";

/** Same first voicing in the preview, inline chart, and transition overlay. */
export function ChordSongShape({
  symbol,
  study,
  label,
  nextChord,
  scaleKey,
  width = 128,
  maxHeight = Infinity,
  titleSize,
}: {
  symbol?: string;
  study?: CelloChordStudy | null;
  label?: string;
  nextChord?: CelloChordStudy;
  scaleKey?: string;
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
          {omitted.length
            ? `Omit ${omitted.map((tone) => tone.name).join(", ")}`
            : study && study.symbol !== symbol
              ? `Played as ${study.symbol}`
              : " "}
        </Body>
      ) : null}
    </View>
  );
}
