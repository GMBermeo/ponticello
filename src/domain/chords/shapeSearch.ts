import { OPEN_STRING_MIDI, STRING_ORDER, toPitchClass } from '../cello';
import type { ChordFinger, CelloChordShape, CelloChordType, FourStrings } from './types';

/** Half position through fourth position, including chromatic intermediate seats. */
/**
 * First position is the normal study home. Half position costs a little, so
 * its second finger is not recommended for a note usually taken with first
 * finger; anything higher costs by distance.
 */
const ANCHOR_COST: Readonly<Record<number, number>> = { 1: 3, 2: 0 };

export const MAX_CHORD_ANCHOR = 7;
export const CHORD_FRAMES = {
  closed: [0, 1, 2, 3],
  extended: [0, 2, 3, 4],
} as const;

interface Candidate extends CelloChordShape {
  readonly mask: number;
  readonly bassPc: number;
  readonly cost: number;
}


function candidates(): readonly Candidate[] {
  const unique = new Map<string, Candidate>();
  for (let anchor = 1; anchor <= MAX_CHORD_ANCHOR; anchor++) {
    for (const frame of ['closed', 'extended'] as const) {
      const offsets = CHORD_FRAMES[frame];
      const options = [null, 0, ...offsets.map((offset) => anchor + offset)];
      const visit = (stops: (number | null)[], fingers: (ChordFinger | null)[]) => {
        if (stops.length < 4) {
          options.forEach((stop, index) => visit(
            [...stops, stop], [...fingers, index === 0 ? null : String(index - 1) as ChordFinger],
          ));
          return;
        }
        const active = stops.flatMap((stop, index) => stop === null ? [] : [index]);
        if (active.length < 2) return;
        const first = active[0];
        const last = active[active.length - 1];
        // Bowed double stops / rolled chords cannot jump across an unused string.
        if (first === undefined || last === undefined || last - first + 1 !== active.length) return;
        // Allow a fifth with one finger across TWO adjacent strings. No three-string
        // barres, gaps, or one finger at conflicting distances masquerading as a grip.
        for (const finger of ['1', '2', '3', '4']) {
          const seats = fingers.flatMap((f, i) => f === finger ? [i] : []);
          if (seats.length > 2 || (seats.length === 2 && seats[1]! - seats[0]! !== 1)) return;
        }
        let mask = 0;
        let bassMidi = Infinity;
        stops.forEach((stop, i) => {
          const string = STRING_ORDER[i];
          if (stop === null || !string) return;
          const midi = OPEN_STRING_MIDI[string] + stop;
          mask |= 1 << toPitchClass(midi);
          bassMidi = Math.min(bassMidi, midi);
        });
        const stopped = stops.filter((n): n is number => n !== null && n > 0);
        const flattened = new Set(fingers.filter((f) => f !== null && f !== '0')).size < stopped.length;
        const anchorCost = ANCHOR_COST[anchor] ?? anchor * 2;
        const cost = anchorCost + stopped.length * 3 + (frame === 'extended' ? 5 : 0)
          + (flattened ? 4 : 0) + active.length;
        const shape: Candidate = {
          stops: stops as unknown as FourStrings<number | null>,
          fingers: fingers as unknown as FourStrings<ChordFinger | null>,
          anchor, frame, omittedIntervals: [], mask, bassPc: toPitchClass(bassMidi), cost,
        };
        const key = stops.join(',');
        const previous = unique.get(key);
        if (!previous || cost < previous.cost) unique.set(key, shape);
      };
      visit([], []);
    }
  }
  return [...unique.values()];
}

// Search is lazy. Importing the catalogue does not enumerate hand frames.
let pool: readonly Candidate[] | undefined;

/** Exhaustive within MAX_CHORD_ANCHOR / CHORD_FRAMES, then ranked for study. */
export function findCelloChordShapes(
  type: CelloChordType, root: number, bassPitchClass?: number,
): readonly CelloChordShape[] {
  pool ??= candidates();
  const pitchClasses = type.semitones.map((n) => toPitchClass(root + n));
  const mask = pitchClasses.reduce((m, n) => m | (1 << n), 0);
  const required = type.intervals.reduce((m, interval, i) => {
    const pitch = pitchClasses[i];
    return pitch === undefined || type.optionalIntervals.includes(interval) ? m : m | (1 << pitch);
  }, 0);
  return pool
    .filter((shape) => (shape.mask & mask) === shape.mask && (shape.mask & required) === required
      && (bassPitchClass === undefined || shape.bassPc === bassPitchClass))
    .map((shape) => ({
      shape,
      omitted: type.intervals.filter((_, i) => !(shape.mask & (1 << pitchClasses[i]!))),
    }))
    .sort((a, b) => a.omitted.length - b.omitted.length
      || Number(a.shape.bassPc !== root) - Number(b.shape.bassPc !== root)
      || a.shape.cost - b.shape.cost || a.shape.stops.join(',').localeCompare(b.shape.stops.join(',')))
    .map(({ shape, omitted }) => ({
      stops: shape.stops, fingers: shape.fingers, anchor: shape.anchor,
      frame: shape.frame, omittedIntervals: omitted,
    }));
}
