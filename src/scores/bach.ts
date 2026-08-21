/**
 * J. S. Bach — Prélude from Cello Suite No. 1 in G major, BWV 1007.
 * Bars 1–4. Public domain.
 *
 * Chosen as the first real piece because of what it does *not* demand: the
 * opening four bars never leave first position, and every stopped note lands
 * on a tape. Over a held G pedal the hand only ever plays the blue tape
 * (first finger) and the two yellows, while the bow does all the travelling.
 * It sounds like Bach on the first attempt, which no scale does.
 */

import { CelloSongScore } from '@/domain/schema';
import { alternateBows, buildScore, Event, twice } from './build';

/** The bar's eight-semiquaver figure; Bach writes each one twice. */
const G_MAJOR: Event[] = [
  { s: 'G', n: 0, f: '0', b: 0.25 },  // G2  open III
  { s: 'D', n: 0, f: '0', b: 0.25 },  // D3  open II
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3  blue tape
  { s: 'A', n: 0, f: '0', b: 0.25 },  // A3  open I
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3
  { s: 'D', n: 0, f: '0', b: 0.25 },  // D3
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3
  { s: 'D', n: 0, f: '0', b: 0.25 },  // D3
];

const C_OVER_G: Event[] = [
  { s: 'G', n: 0, f: '0', b: 0.25 },  // G2
  { s: 'D', n: 2, f: '1', b: 0.25 },  // E3  blue tape
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4  first yellow
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3  blue
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4
  { s: 'D', n: 2, f: '1', b: 0.25 },  // E3
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4
  { s: 'D', n: 2, f: '1', b: 0.25 },  // E3
];

const D7_OVER_G: Event[] = [
  { s: 'G', n: 0, f: '0', b: 0.25 },  // G2
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3 second yellow
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4  first yellow
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3  blue
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3
  { s: 'A', n: 3, f: '2', b: 0.25 },  // C4
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3
];

const D_OVER_G: Event[] = [
  { s: 'G', n: 0, f: '0', b: 0.25 },  // G2
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3 second yellow
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3  blue
  { s: 'A', n: 0, f: '0', b: 0.25 },  // A3  open I
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3
  { s: 'A', n: 2, f: '1', b: 0.25 },  // B3
  { s: 'D', n: 4, f: '3', b: 0.25 },  // F#3
];

export const BWV1007_PRELUDE: CelloSongScore = buildScore({
  id: 'bwv1007-prelude',
  timeSignature: [4, 4],
  metadata: {
    title: 'Prélude, Cello Suite No. 1',
    composer: 'J. S. Bach · BWV 1007',
    origin: 'CLASSICAL · MOTO PERPETUO · BARS 1–4',
    keySignature: 'G MAJOR',
    timeSignature: '4/4',
    bpm: 66,
    difficulty: 'Intermediate',
    tonic: 'G',
    teaches: 'Four bars over a G pedal that never leave first position. The left hand plays only blue and the two yellows; everything hard here belongs to the bow — four string planes, even semiquavers, no accent where the string changes.',
    rights: 'Public domain (composed c. 1720). Bars 1–4, hand-entered; check against an edition before performing.',
  },
  bars: [G_MAJOR, C_OVER_G, D7_OVER_G, D_OVER_G].map((figure) => alternateBows(twice(figure))),
});
