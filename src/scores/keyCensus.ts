/**
 * The library's own key census, measured once at load.
 *
 * Its own module because two things need it and neither should own it: the
 * scale drills, which let it decide how many drills each key gets, and the
 * library index, which hands it to the UI. Counting it twice would be cheap but
 * would let the two disagree, and "the screen says 44 and the drill set thinks
 * 42" is exactly the failure this whole feature exists to avoid.
 *
 * Counted over the bundled songs only — not over the studies and drills, which
 * would otherwise let a drill vote for its own key.
 */

import { KeyCensus, keyCensus } from '@domain';
import { COMPACT_SCORES } from './bundledSongs';

export const LIBRARY_KEY_CENSUS: KeyCensus = keyCensus(COMPACT_SCORES);
