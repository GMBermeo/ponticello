/**
 * Original practice studies, written for this app.
 *
 * Each one walks a specific set of fingerboard tapes so that the first thing a
 * beginner does is connect a colour under the hand to a note on the screen.
 * They are short on purpose — a study you can loop twenty times in five
 * minutes teaches more than one you get through once.
 */

import { CelloString, STRING_ORDER } from '@/domain/cello';
import { CelloSongScore } from '@/domain/schema';
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
    origin: 'TAPES · BLUE YELLOW YELLOW GREEN',
    keySignature: 'CHROMATIC',
    timeSignature: '4/4',
    bpm: 60,
    difficulty: 'Beginner',
    tonic: 'D',
    teaches: 'Every tape in the first-position set, one finger at a time, on all four strings. Blue, yellow, yellow, green — up and back down. The hand frame never moves; only the fingers do.',
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
    origin: 'SCALE · THE FIRST YELLOW EARNS ITS PLACE',
    keySignature: 'C MAJOR',
    timeSignature: '4/4',
    bpm: 66,
    difficulty: 'Beginner',
    tonic: 'C',
    teaches: 'The same shape as D major but a string lower, and now the first yellow tape is in play: F natural on the D string is the second finger, not the third. Feel the difference between the two yellows.',
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
    origin: 'TAPES · BLUE GREEN GREEN YELLOW',
    keySignature: 'D MAJOR',
    timeSignature: '4/4',
    bpm: 56,
    difficulty: 'Intermediate',
    tonic: 'D',
    teaches: 'The thumb lies flat across the blue tape at the octave harmonic, and fingers 1, 2 and 3 climb the two greens and the yellow above it. Find the blue by its harmonic first: touch it lightly and bow — if it rings an octave, the thumb is home.',
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
