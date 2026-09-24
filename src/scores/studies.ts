/**
 * Original practice studies, written for this app.
 *
 * Each one walks a specific set of fingerboard tapes so that the first thing a
 * beginner does is connect a colour under the hand to a note on the screen.
 * They are short on purpose — a study you can loop twenty times in five
 * minutes teaches more than one you get through once.
 */

import { CelloString, STRING_ORDER, CelloSongScore, BackingTrack, BackingPart } from '@domain';
import { alternateBows, buildScore, Event } from './build';

const ORIGINAL = 'Original study written for this app — free to copy and change.';

// ─── 1. Four open strings ────────────────────────────────────────────────────

export const OPEN_STRINGS: CelloSongScore = buildScore({
  id: 'open-strings',
  timeSignature: [4, 4],
  metadata: {
    title: 'Four Open Strings',
    composer: 'Study',
    origin: 'WARM-UP · NO LEFT HAND',
    keySignature: 'C MAJOR',
    timeSignature: '4/4',
    bpm: 60,
    difficulty: 'Beginner',
    tonic: 'C',
    teaches: 'One whole bow per string, nothing for the left hand to do. Watch the cents rail settle — this is where you learn what "in tune" looks like before you have to find it.',
    rights: ORIGINAL,
  },
  bars: [...STRING_ORDER, ...STRING_ORDER].map((s, i): Event[] => [
    { s, n: 0, f: '0', b: 4, bow: i % 2 === 0 ? 'down' : 'up', art: 'tenuto' },
  ]),
});

// ─── 2. First position ladder ────────────────────────────────────────────────

/** 0 → 1 → 2 → 3 → 4 → 3 → 2 → 1: every tape in the first-position set, twice. */
function ladderBars(string: CelloString): Event[][] {
  const rungs: [number, Event['f']][] = [
    [0, '0'], [2, '1'], [3, '2'], [4, '3'], [5, '4'], [4, '3'], [3, '2'], [2, '1'],
  ];
  const events = rungs.map(([n, f]): Event => ({ s: string, n, f, b: 1 }));
  return [alternateBows(events.slice(0, 4)), alternateBows(events.slice(4), false)];
}

export const FIRST_POSITION_LADDER: CelloSongScore = buildScore({
  id: 'first-position-ladder',
  timeSignature: [4, 4],
  metadata: {
    title: 'First Position Ladder',
    composer: 'Study',
    origin: 'TAPES · THE FIRST FOUR',
    keySignature: 'CHROMATIC',
    timeSignature: '4/4',
    bpm: 60,
    difficulty: 'Beginner',
    tonic: 'D',
    teaches: 'The first four tapes — the closed first-position frame — one finger at a time, on all four strings, up and back down. The hand frame never moves; only the fingers do.',
    rights: ORIGINAL,
  },
  bars: STRING_ORDER.flatMap(ladderBars),
});

// ─── 3. D major on two strings ───────────────────────────────────────────────

export const D_MAJOR_TWO_STRINGS: CelloSongScore = buildScore({
  id: 'd-major-two-strings',
  timeSignature: [4, 4],
  metadata: {
    title: 'D Major, Two Strings',
    composer: 'Study',
    origin: 'SCALE · OPEN · BLUE · YELLOW 2 · GREEN',
    keySignature: 'D MAJOR',
    timeSignature: '4/4',
    bpm: 66,
    difficulty: 'Beginner',
    tonic: 'D',
    teaches: 'A real scale using only open, blue, the second yellow and green — the same four rungs on the D string and then the A string. The first yellow sits out entirely, which is what makes this key feel easy.',
    rights: ORIGINAL,
  },
  bars: [
    alternateBows([
      { s: 'D', n: 0, f: '0', b: 1 }, { s: 'D', n: 2, f: '1', b: 1 },
      { s: 'D', n: 4, f: '3', b: 1 }, { s: 'D', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'A', n: 0, f: '0', b: 1 }, { s: 'A', n: 2, f: '1', b: 1 },
      { s: 'A', n: 4, f: '3', b: 1 }, { s: 'A', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'A', n: 4, f: '3', b: 1 }, { s: 'A', n: 2, f: '1', b: 1 },
      { s: 'A', n: 0, f: '0', b: 1 }, { s: 'D', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'D', n: 4, f: '3', b: 1 }, { s: 'D', n: 2, f: '1', b: 1 },
      { s: 'D', n: 0, f: '0', b: 2, art: 'tenuto' },
    ]),
  ],
});

// ─── 4. C major on two strings ───────────────────────────────────────────────

export const C_MAJOR_TWO_STRINGS: CelloSongScore = buildScore({
  id: 'c-major-two-strings',
  timeSignature: [4, 4],
  metadata: {
    title: 'C Major, Two Strings',
    composer: 'Study',
    origin: 'SCALE · THE SECOND TAPE EARNS ITS PLACE',
    keySignature: 'C MAJOR',
    timeSignature: '4/4',
    bpm: 66,
    difficulty: 'Beginner',
    tonic: 'C',
    teaches: 'The same shape as D major but a string lower, and now the second tape is in play: F natural on the D string is the second finger, not the third. Feel the semitone between the second and third tapes.',
    rights: ORIGINAL,
  },
  bars: [
    alternateBows([
      { s: 'G', n: 0, f: '0', b: 1 }, { s: 'G', n: 2, f: '1', b: 1 },
      { s: 'G', n: 4, f: '3', b: 1 }, { s: 'G', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'D', n: 0, f: '0', b: 1 }, { s: 'D', n: 2, f: '1', b: 1 },
      { s: 'D', n: 3, f: '2', b: 1 }, { s: 'D', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'D', n: 3, f: '2', b: 1 }, { s: 'D', n: 2, f: '1', b: 1 },
      { s: 'D', n: 0, f: '0', b: 1 }, { s: 'G', n: 5, f: '4', b: 1 },
    ]),
    alternateBows([
      { s: 'G', n: 4, f: '3', b: 1 }, { s: 'G', n: 2, f: '1', b: 1 },
      { s: 'G', n: 0, f: '0', b: 2, art: 'tenuto' },
    ]),
  ],
});

// ─── 5. Thumb position ladder ────────────────────────────────────────────────

export const THUMB_POSITION_LADDER: CelloSongScore = buildScore({
  id: 'thumb-position-ladder',
  timeSignature: [4, 4],
  metadata: {
    title: 'Thumb Position Ladder',
    composer: 'Study',
    origin: 'LANDMARK · OCTAVE HARMONIC',
    keySignature: 'D MAJOR',
    timeSignature: '4/4',
    bpm: 56,
    difficulty: 'Intermediate',
    tonic: 'D',
    teaches: 'The thumb lies flat across two strings on the octave harmonic, at exactly half the string, and fingers 1, 2 and 3 climb a major tetrachord above it — whole, whole, half. There are no tapes this far down; find the thumb by its harmonic instead. Touch it lightly and bow — if it rings an octave above the open string, the thumb is home.',
    rights: ORIGINAL,
  },
  bars: [
    alternateBows([
      { s: 'D', n: 12, f: 'T', b: 1 }, { s: 'D', n: 14, f: '1', b: 1 },
      { s: 'D', n: 16, f: '2', b: 1 }, { s: 'D', n: 17, f: '3', b: 1 },
    ]),
    alternateBows([
      { s: 'A', n: 12, f: 'T', b: 1 }, { s: 'A', n: 14, f: '1', b: 1 },
      { s: 'A', n: 16, f: '2', b: 1 }, { s: 'A', n: 17, f: '3', b: 1 },
    ]),
    alternateBows([
      { s: 'A', n: 16, f: '2', b: 1 }, { s: 'A', n: 14, f: '1', b: 1 },
      { s: 'A', n: 12, f: 'T', b: 1 }, { s: 'D', n: 17, f: '3', b: 1 },
    ]),
    alternateBows([
      { s: 'D', n: 16, f: '2', b: 1 }, { s: 'D', n: 14, f: '1', b: 1 },
      { s: 'D', n: 12, f: 'T', b: 2, art: 'tenuto' },
    ]),
  ],
});

export const STUDIES: CelloSongScore[] = [
  OPEN_STRINGS,
  FIRST_POSITION_LADDER,
  D_MAJOR_TWO_STRINGS,
  C_MAJOR_TWO_STRINGS,
  THUMB_POSITION_LADDER,
];


function makePulsePart(id: string, totalMs: number, beatMs: number): BackingPart {
  const notes = [];
  const beats = Math.floor(totalMs / beatMs);
  for (let i = 0; i < beats; i++) {
    notes.push({
      midiNumber: 42, // Hi-hat / click
      startTimeMs: i * beatMs,
      durationMs: Math.min(80, beatMs * 0.4),
      velocity: i % 4 === 0 ? 0.6 : 0.35,
    });
  }
  return {
    id: `${id}-pulse`,
    name: 'Rhythm Pulse',
    instrument: 'percussion',
    role: 'accompaniment',
    gain: 0.45,
    muted: false,
    notes,
  };
}

export const OPEN_STRINGS_BACKING: BackingTrack = {
  id: 'open-strings',
  name: 'Four Open Strings',
  source: 'imported',
  durationMs: 32000,
  bpm: 60,
  parts: [
    {
      id: 'open-strings-harmony',
      name: 'Acoustic Guitar & Piano',
      instrument: 'piano',
      role: 'accompaniment',
      gain: 0.55,
      muted: false,
      notes: [
        // Bar 1 & 5: C major (0-4000ms, 16000-20000ms)
        ...[0, 16000].flatMap((t) => [
          { midiNumber: 48, startTimeMs: t, durationMs: 3800, velocity: 0.55 },
          { midiNumber: 52, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 55, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 60, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
        ]),
        // Bar 2 & 6: G major (4000-8000ms, 20000-24000ms)
        ...[4000, 20000].flatMap((t) => [
          { midiNumber: 43, startTimeMs: t, durationMs: 3800, velocity: 0.55 },
          { midiNumber: 50, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 55, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 59, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
        ]),
        // Bar 3 & 7: D major (8000-12000ms, 24000-28000ms)
        ...[8000, 24000].flatMap((t) => [
          { midiNumber: 50, startTimeMs: t, durationMs: 3800, velocity: 0.55 },
          { midiNumber: 57, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 62, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 66, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
        ]),
        // Bar 4 & 8: A major (12000-16000ms, 28000-32000ms)
        ...[12000, 28000].flatMap((t) => [
          { midiNumber: 45, startTimeMs: t, durationMs: 3800, velocity: 0.55 },
          { midiNumber: 52, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 57, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
          { midiNumber: 61, startTimeMs: t, durationMs: 3800, velocity: 0.5 },
        ]),
      ],
    },
    {
      id: 'open-strings-bass',
      name: 'Acoustic Bass',
      instrument: 'bass',
      role: 'accompaniment',
      gain: 0.6,
      muted: false,
      notes: [
        ...[0, 16000].map((t) => ({ midiNumber: 36, startTimeMs: t, durationMs: 3800, velocity: 0.6 })),
        ...[4000, 20000].map((t) => ({ midiNumber: 43, startTimeMs: t, durationMs: 3800, velocity: 0.6 })),
        ...[8000, 24000].map((t) => ({ midiNumber: 38, startTimeMs: t, durationMs: 3800, velocity: 0.6 })),
        ...[12000, 28000].map((t) => ({ midiNumber: 45, startTimeMs: t, durationMs: 3800, velocity: 0.6 })),
      ],
    },
    makePulsePart('open-strings', 32000, 1000),
  ],
};

export const FIRST_POSITION_LADDER_BACKING: BackingTrack = {
  id: 'first-position-ladder',
  name: 'First Position Ladder',
  source: 'imported',
  durationMs: 32000,
  bpm: 60,
  parts: [
    {
      id: 'first-position-ladder-chords',
      name: 'Piano Chords',
      instrument: 'piano',
      role: 'accompaniment',
      gain: 0.5,
      muted: false,
      notes: [
        // C string: C - G7 (0-8000ms)
        { midiNumber: 48, startTimeMs: 0, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 0, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 0, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 47, startTimeMs: 4000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 53, startTimeMs: 4000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 4000, durationMs: 3800, velocity: 0.45 },
        // G string: G - D7 (8000-16000ms)
        { midiNumber: 43, startTimeMs: 8000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 50, startTimeMs: 8000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 8000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 50, startTimeMs: 12000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 54, startTimeMs: 12000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 57, startTimeMs: 12000, durationMs: 3800, velocity: 0.45 },
        // D string: D - A7 (16000-24000ms)
        { midiNumber: 50, startTimeMs: 16000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 54, startTimeMs: 16000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 57, startTimeMs: 16000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 45, startTimeMs: 20000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 20000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 57, startTimeMs: 20000, durationMs: 3800, velocity: 0.45 },
        // A string: A - E7 (24000-32000ms)
        { midiNumber: 45, startTimeMs: 24000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 24000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 57, startTimeMs: 24000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 52, startTimeMs: 28000, durationMs: 3800, velocity: 0.5 },
        { midiNumber: 56, startTimeMs: 28000, durationMs: 3800, velocity: 0.45 },
        { midiNumber: 59, startTimeMs: 28000, durationMs: 3800, velocity: 0.45 },
      ],
    },
    makePulsePart('first-position-ladder', 32000, 1000),
  ],
};

export const D_MAJOR_TWO_STRINGS_BACKING: BackingTrack = {
  id: 'd-major-two-strings',
  name: 'D Major, Two Strings',
  source: 'imported',
  durationMs: 14545,
  bpm: 66,
  parts: [
    {
      id: 'd-major-chords',
      name: 'Acoustic Guitar',
      instrument: 'pluck',
      role: 'accompaniment',
      gain: 0.52,
      muted: false,
      notes: [
        // Bar 1: D major
        { midiNumber: 50, startTimeMs: 0, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 57, startTimeMs: 0, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 62, startTimeMs: 0, durationMs: 3500, velocity: 0.45 },
        // Bar 2: G major
        { midiNumber: 43, startTimeMs: 3636, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 50, startTimeMs: 3636, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 3636, durationMs: 3500, velocity: 0.45 },
        // Bar 3: A7
        { midiNumber: 45, startTimeMs: 7272, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 7272, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 57, startTimeMs: 7272, durationMs: 3500, velocity: 0.45 },
        // Bar 4: D major
        { midiNumber: 50, startTimeMs: 10908, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 57, startTimeMs: 10908, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 62, startTimeMs: 10908, durationMs: 3500, velocity: 0.45 },
      ],
    },
    makePulsePart('d-major', 14545, 909),
  ],
};

export const C_MAJOR_TWO_STRINGS_BACKING: BackingTrack = {
  id: 'c-major-two-strings',
  name: 'C Major, Two Strings',
  source: 'imported',
  durationMs: 14545,
  bpm: 66,
  parts: [
    {
      id: 'c-major-chords',
      name: 'Acoustic Guitar',
      instrument: 'pluck',
      role: 'accompaniment',
      gain: 0.52,
      muted: false,
      notes: [
        // Bar 1: C major
        { midiNumber: 48, startTimeMs: 0, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 0, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 0, durationMs: 3500, velocity: 0.45 },
        // Bar 2: F major
        { midiNumber: 41, startTimeMs: 3636, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 48, startTimeMs: 3636, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 53, startTimeMs: 3636, durationMs: 3500, velocity: 0.45 },
        // Bar 3: G7
        { midiNumber: 43, startTimeMs: 7272, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 50, startTimeMs: 7272, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 53, startTimeMs: 7272, durationMs: 3500, velocity: 0.45 },
        // Bar 4: C major
        { midiNumber: 48, startTimeMs: 10908, durationMs: 3500, velocity: 0.5 },
        { midiNumber: 52, startTimeMs: 10908, durationMs: 3500, velocity: 0.45 },
        { midiNumber: 55, startTimeMs: 10908, durationMs: 3500, velocity: 0.45 },
      ],
    },
    makePulsePart('c-major', 14545, 909),
  ],
};

export const THUMB_POSITION_LADDER_BACKING: BackingTrack = {
  id: 'thumb-position-ladder',
  name: 'Thumb Position Ladder',
  source: 'imported',
  durationMs: 17142,
  bpm: 56,
  parts: [
    {
      id: 'thumb-ladder-drone',
      name: 'Ambient Drone Pad',
      instrument: 'drone',
      role: 'accompaniment',
      gain: 0.5,
      muted: false,
      notes: [
        { midiNumber: 50, startTimeMs: 0, durationMs: 17142, velocity: 0.5 },
        { midiNumber: 57, startTimeMs: 0, durationMs: 17142, velocity: 0.45 },
      ],
    },
    makePulsePart('thumb-ladder', 17142, 1071),
  ],
};

export const STUDIES_BACKINGS: Record<string, BackingTrack> = {
  'open-strings': OPEN_STRINGS_BACKING,
  'first-position-ladder': FIRST_POSITION_LADDER_BACKING,
  'd-major-two-strings': D_MAJOR_TWO_STRINGS_BACKING,
  'c-major-two-strings': C_MAJOR_TWO_STRINGS_BACKING,
  'thumb-position-ladder': THUMB_POSITION_LADDER_BACKING,
};

