import { SvgXml } from 'react-native-svg';
import { View } from 'react-native';
import {
  type CelloChordStudy, celloChordSvg, CHORD_DIAGRAM_SIZE, CHORD_ATLAS_DIAGRAM_SIZE,
  chordTapeMarkerColors, type ChordDiagramOptions,
} from '@domain';
import { useTheme } from '@theme';
import { useSettingsSelector } from '@state';

export interface CelloChordDiagramProps {
  chord: CelloChordStudy;
  mode?: ChordDiagramOptions['mode'];
  voicingIndex?: number;
  orientation?: ChordDiagramOptions['orientation'];
  /** Design units. For a measured box, pass its device-pixel width separately. */
  width?: number;
  measuredWidth?: number;
  presentation?: ChordDiagramOptions['presentation'];
  tapeColors?: boolean;
  nextChord?: CelloChordStudy;
  scaleKey?: string;
  scalePitchClasses?: readonly number[];
  scaleTonic?: number;
  scaleColor?: string;
  /** Every place the chord's notes (and the next chord's) fall, not only the shape. */
  allPositions?: boolean;
}

function allPositionsLabel(chord: CelloChordStudy, nextChord: CelloChordStudy | undefined): string {
  const names = chord.tones.map((tone) => tone.name).join(', ');
  const next = nextChord ? `, and of ${nextChord.symbol} in grey` : '';
  return `Every position of ${names} is marked${next}.`;
}

/** Standalone diagram for future study/playback modes; no transport subscription. */
export function CelloChordDiagram({
  chord, mode = 'voicing', voicingIndex = 0, orientation = 'low-to-high', width = 160, measuredWidth,
  presentation = 'full', tapeColors = false, nextChord,
  scaleKey, scalePitchClasses, scaleTonic, scaleColor, allPositions = false,
}: CelloChordDiagramProps) {
  const { s, chrome } = useTheme();
  // Diagram colors depend only on tape positions, not board visibility/actions.
  const tapeSets = useSettingsSelector((settings) => (tapeColors || scaleKey) ? settings.tapeSets : null);
  const deviceWidth = measuredWidth ?? s(width);
  const size = presentation === 'atlas' ? CHORD_ATLAS_DIAGRAM_SIZE : CHORD_DIAGRAM_SIZE;
  const xml = celloChordSvg(chord, {
    mode, voicingIndex, orientation, ink: chrome.ink, muted: chrome.dim,
    rootColor: chrome.accent, background: chrome.bg, ghostColor: chrome.dim,
    presentation, markerColors: tapeSets ? chordTapeMarkerColors(tapeSets, chrome.tapes) : undefined, nextChord,
    scaleKey, scalePitchClasses, scaleTonic, scaleColor, allPositions,
  }).replace(/ (?:aria-label|data-[a-z-]+|role)="[^"]*"/g, '');
  const accessibilityLabel = [
    `${chord.symbol}. Squares mark roots.`,
    mode === 'arpeggio' || !chord.voicings.length ? 'Arpeggio: play notes separately.' : 'Suggested chord fingering.',
    nextChord ? `Grey notes prepare ${nextChord.symbol}.` : '',
    allPositions ? allPositionsLabel(chord, nextChord) : '',
    scaleKey ? `Scale notes for key ${scaleKey}.` : '',
  ].filter(Boolean).join(' ');
  // SvgXml camel-cases arbitrary XML attributes on web. Expose accessibility
  // through the native View adapter; retain SVG metadata in standalone exports.
  return <View
    accessible accessibilityRole="image"
    accessibilityLabel={accessibilityLabel}
  ><SvgXml xml={xml} width={deviceWidth} height={deviceWidth * size.height / size.width} /></View>;
}

