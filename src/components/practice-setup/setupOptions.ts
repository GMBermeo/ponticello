import type { ArrangementLevel, ListenMode } from '@domain';
import type { BoardView, FlowAxis, ScoreColorMode, VisionName } from '@state';
import type { ChromeName } from '@theme';

import type { Segment } from '../ui';

export const ARRANGEMENT_SEGMENTS: readonly Segment<ArrangementLevel>[] = [
  { value: 'Beginner', label: 'Beginner', hint: 'Held bass notes and gentle drones. A low, spacious part with time to move.' },
  { value: 'Intermediate', label: 'Intermediate', hint: 'A simple bass accompaniment in the lower register, with rests for hand changes.' },
  { value: 'Advanced', label: 'Advanced', hint: 'A more detailed melody, lowered for the cello and kept in first position.' },
  { value: 'Expert', label: 'Full', hint: 'The fullest melody arrangement, still lowered into a comfortable first-position range.' },
];

/** What the sheet can show: one of the three score visions, or the chord chart. */
export type SheetView = VisionName | 'chords';

export const VISION_SEGMENTS: readonly Segment<VisionName>[] = [
  { value: 'tab', label: 'Tab' },
  { value: 'score', label: 'Score' },
  { value: 'highway', label: 'Highway' },
];

export const CHORDS_SEGMENT: Segment<SheetView> = { value: 'chords', label: 'Chords' };

export const VISION_BLURB: Record<VisionName, string> = {
  tab: 'Four string lines with finger numbers. A clear guide to where your hand goes.',
  score: 'Bass clef notation for practising your music reading.',
  highway: 'Follow the notes along four string lanes to practise rhythm and crossings.',
};

export const CHORDS_BLURB = 'Lyrics and chord changes, with cello shapes and adjustable auto-scroll. Phrasing is estimated.';

/**
 * Orientation, offered per vision rather than as one global axis.
 *
 * They are genuinely different preferences: a falling highway is the
 * convention most people arrive with, while a horizontal one matches
 * Rocksmith and suits a short wide screen; and the tab stave is easiest to
 * read as a stave until you want it to match the highway. Whichever is
 * chosen, the low C string stays at the bottom or the left.
 */
export const HIGHWAY_AXES: readonly Segment<FlowAxis>[] = [
  { value: 'vertical', label: 'Falling', hint: 'Notes fall from the top' },
  { value: 'horizontal', label: 'Sideways', hint: 'Notes arrive from the right' },
];

export const TAB_AXES: readonly Segment<FlowAxis>[] = [
  { value: 'horizontal', label: 'Stave', hint: 'Four lines, time left to right' },
  { value: 'vertical', label: 'Falling', hint: 'Four columns, notes fall from the top' },
];

export const BOARD_VIEWS: readonly Segment<BoardView>[] = [
  { value: 'player', label: 'Player', hint: 'Nut at the bottom, as you see it' },
  { value: 'reader', label: 'Diagram', hint: 'Nut at the top, as it is printed' },
];

export const SCORE_COLORS: readonly Segment<ScoreColorMode>[] = [
  { value: 'off', label: 'Ink', hint: 'Plain engraved noteheads' },
  { value: 'string', label: 'By string', hint: 'Each note in the colour of its string' },
  { value: 'note', label: 'By note', hint: 'Each note in the colour of its letter name' },
];

export const CHROME_SEGMENTS: readonly Segment<ChromeName>[] = [
  { value: 'paper', label: 'Paper (Light)' },
  { value: 'quiet', label: 'Dark (Navy)' },
  { value: 'neon', label: 'Neon (OLED)' },
];

export const LISTEN_SUMMARY: Record<ListenMode, string> = {
  off: 'Accompaniment off',
  solo: 'Cello guide on',
  both: 'Backing and cello guide on',
  backing: 'Backing track on',
};

export const TEMPO_STEP_PERCENT = 5;
export const MIN_TEMPO_PERCENT = 40;
export const MAX_TEMPO_PERCENT = 120;
const FALLBACK_BPM = 60;

export function effectiveBpm(scoreBpm: number | undefined, tempoPercent: number): number {
  return Math.round((scoreBpm ?? FALLBACK_BPM) * tempoPercent / 100);
}
