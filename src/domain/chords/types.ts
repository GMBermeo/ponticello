import type { CelloString } from '../cello';

export interface CelloChordType {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  /** Spelled compound intervals, not just pitch classes (9 != 2). */
  readonly intervals: readonly string[];
  readonly semitones: readonly number[];
  readonly optionalIntervals: readonly string[];
}

export type ChordFinger = '0' | '1' | '2' | '3' | '4';
export type FourStrings<T> = readonly [T, T, T, T];

/** All tuples use musical order C, G, D, A, regardless of display orientation. */
export interface CelloChordShape {
  readonly stops: FourStrings<number | null>;
  readonly fingers: FourStrings<ChordFinger | null>;
  /** First finger's distance in semitones from the nut. Not a position number. */
  readonly anchor: number;
  readonly frame: 'closed' | 'extended';
  readonly omittedIntervals: readonly string[];
}

export interface CelloChordEntry {
  readonly id: string;
  readonly typeId: string;
  readonly rootPitchClass: number;
  readonly symbol: string;
  /** Every distinct stop pattern found within the documented hand-frame model. */
  readonly shapes: readonly CelloChordShape[];
}

export interface CelloChordCatalog {
  readonly version: number;
  readonly tuning: FourStrings<number>;
  readonly maxAnchor: number;
  readonly types: readonly CelloChordType[];
  readonly entries: readonly CelloChordEntry[];
}

export interface ChordTone {
  readonly interval: string;
  readonly semitones: number;
  readonly pitchClass: number;
  readonly name: string;
  readonly isRoot: boolean;
}

export interface ChordPlacement {
  readonly string: CelloString;
  readonly semitones: number;
  readonly midi: number;
  readonly finger: ChordFinger;
  readonly anchor: number;
  readonly frame: 'closed' | 'extended';
  readonly tone: ChordTone;
  readonly marker: 'square' | 'circle';
}

export interface ChordVoicing {
  readonly id: string;
  readonly notes: readonly ChordPlacement[];
  readonly unusedStrings: readonly CelloString[];
  readonly bass: ChordTone;
  readonly inversion: number | null;
  readonly technique: 'double-stop' | 'rolled-chord';
  readonly completeness: 'complete' | 'reduced';
  readonly omittedTones: readonly ChordTone[];
  readonly difficulty: 'basic' | 'intermediate' | 'advanced';
  readonly review: 'generated-needs-cellist-review';
}

export interface CelloChordStudy {
  readonly symbol: string;
  readonly root: string;
  readonly type: CelloChordType;
  readonly tones: readonly ChordTone[];
  readonly requestedBass: string | null;
  readonly voicings: readonly ChordVoicing[];
  /** Ascending, one note at a time; includes every compound interval. */
  readonly arpeggio: readonly ChordPlacement[];
  readonly status: 'shapes-available' | 'arpeggio-only';
}
