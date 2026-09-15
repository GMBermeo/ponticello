import { OPEN_STRING_MIDI } from '../cello';
import { DIFFICULTY_TIERS } from '../difficulty';
import { MelodyMetrics } from '../melody';
import { MidiNote } from '../midi';
import { DifficultyTier } from '../schema';
import { RawNoteEvent } from '../fingering';

export type ArrangementLevel = DifficultyTier;
export type ArrangementSourceKind = 'riff' | 'melody' | 'bass' | 'roots';

export interface ArrangementRange {
  low: number;
  high: number;
}

/** Instrument compass; practice arrangements use the narrower profiles below. */
export const FULL_CELLO_RANGE: ArrangementRange = {
  low: OPEN_STRING_MIDI.C,
  high: 81,
};

export const ARRANGEMENT_LEVELS: readonly ArrangementLevel[] = DIFFICULTY_TIERS;

export interface ArrangementProfile {
  maxNotesPerSecond: number;
  minimumHoldMs: number;
  range: ArrangementRange;
  medianCeiling: number;
  firstPositionOnly: boolean;
  closedFrameOnly: boolean;
  prefersGuide: boolean;
  prefersBass: boolean;
  maxLeapSemitones: number;
}

export const ARRANGEMENT_PROFILES: Record<ArrangementLevel, ArrangementProfile> = {
  Beginner: {
    firstPositionOnly: true, closedFrameOnly: true, prefersGuide: true, prefersBass: false,
    maxNotesPerSecond: 2.5, minimumHoldMs: 0,
    range: { low: 36, high: 62 }, medianCeiling: OPEN_STRING_MIDI.A, maxLeapSemitones: 9,
  },
  Intermediate: {
    firstPositionOnly: true, closedFrameOnly: true, prefersGuide: false, prefersBass: true,
    maxNotesPerSecond: 3, minimumHoldMs: 0,
    range: { low: 36, high: 62 }, medianCeiling: 48, maxLeapSemitones: 9,
  },
  Advanced: {
    firstPositionOnly: true, closedFrameOnly: false, prefersGuide: false, prefersBass: false,
    maxNotesPerSecond: 4, minimumHoldMs: 0,
    range: { low: 36, high: 62 }, medianCeiling: 50, maxLeapSemitones: 12,
  },
  Expert: {
    firstPositionOnly: true, closedFrameOnly: false, prefersGuide: false, prefersBass: false,
    maxNotesPerSecond: Infinity, minimumHoldMs: 0,
    range: { low: 36, high: 62 }, medianCeiling: 50, maxLeapSemitones: 12,
  },
};

export interface ArrangedLine {
  notes: MidiNote[];
  sourceTrack: number | null;
  octaveShift: number;
  originalNoteCount: number;
  keptNoteCount: number;
  sourceKind: ArrangementSourceKind;
  /** Notes which needed an individual octave repair after the whole-line move. */
  foldedNotes: number;
  /** Absolute source time which became arrangement time zero. */
  originMs: number;
  /** Robust absolute end of the musical file, excluding remote corrupt events. */
  sourceEndMs: number;
  metrics: MelodyMetrics | null;
}

export interface ArrangeMidiOptions {
  level: ArrangementLevel;
  /** A player's explicit track choice bypasses automatic viability thresholds. */
  sourceTrack?: number | null;
  range?: ArrangementRange;
}

export interface ArrangeScoreOptions {
  /**
   * The song's harmonic guide, as built by `harmonicGuide` and stored beside
   * the melody, rebased onto the score's own timeline.
   */
  guide?: readonly RawNoteEvent[];
  bass?: readonly RawNoteEvent[];
}
