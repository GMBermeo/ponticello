/**
 * Choosing which MIDI track is the tune.
 *
 * A multitrack file has no field that says "this is the melody", so it has to
 * be inferred, and the old inference was a name match: any track whose name
 * contained `cello` or `solo` scored +100 and won. Tool's bassist is Justin
 * **Chan·cello·r**, so Lateralus was transcribed from the bass — a pedal D that
 * repeats twenty-four times before it moves. The White Stripes file has a track
 * called "Solo Guitar", so Seven Nation Army was transcribed from the lead
 * break rather than the riff everyone can hum.
 *
 * So names are now a weak tiebreak on word boundaries, and the decision is made
 * from what the notes actually do. Two failure modes to avoid, and they pull in
 * opposite directions:
 *
 * - **A drone.** A line that barely changes pitch is not a tune, however
 *   prominent it is in the mix.
 * - **A solo.** A shredding lead — two octaves wide, very fast, high up — is
 *   not playable on a cello and is not the thing a listener recognises.
 *
 * What is wanted is between them: the riff or theme, moving, in a register a
 * cello can reach.
 *
 * Pure: no React, no React Native. See AGENTS.md.
 */

import { OPEN_STRING_MIDI } from './cello';
import { MidiNote, MidiTrack, monophonic } from './midi';

/** Scores closer than this are a tie; they are sums of floats. */
const SCORE_EPSILON = 1e-9;

/** Lowest note on the instrument. */
const CELLO_LOW = OPEN_STRING_MIDI.C; // 36

/** Top of the first-position range the bundled library is written for. */
const FIRST_POSITION_HIGH = 63;

/** Fewer notes than this and there is not enough material to judge, or to play. */
const MIN_NOTES = 12;

export interface MelodyMetrics {
  noteCount: number;
  distinctPitches: number;
  /** Fraction of consecutive pairs that change pitch. A drone tends to zero. */
  movement: number;
  /** Highest minus lowest, in semitones. */
  span: number;
  medianMidi: number;
  /** Notes per second. Above ~10 nothing is bowable. */
  density: number;
  /** Fraction of non-static interval/rhythm windows that recur elsewhere. */
  motifRecurrence: number;
  /** Octave shift that best fits the line into first position, in semitones. */
  octaveShift: number;
  /** Fraction inside first position once `octaveShift` is applied. */
  fitAfterShift: number;
}

/**
 * Highest median pitch an arrangement should settle on by default — A3, the
 * open A string.
 *
 * Fitting inside the compass is not the same as sitting well in it. The solo
 * compass C2–A5 is nearly four octaves, so a vocal or lead line written at E4
 * fits it perfectly without being moved, and every note then lands above the
 * neck: the hand lives in thumb position for a tune that would sit under the
 * fingers an octave lower. Sixty-odd songs in the library were built that way.
 *
 * So a placement whose median climbs past the open A string pays for it, and
 * the cheapest way not to pay is to come down an octave. Compare
 * `ARRANGING.md`, step 3: displace by octaves until the median sits near D3–A3.
 */
export const MEDIAN_CEILING_MIDI = OPEN_STRING_MIDI.A;

/** Cost per semitone of median above the ceiling, against 100 for a full fit. */
const ABOVE_CEILING_COST = 1.6;

function medianOf(pitches: readonly number[]): number {
  const sorted = [...pitches].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * The octave displacement that best seats a line in a range.
 *
 * Octave displacement is the cheapest transformation that keeps a tune
 * recognisable, so it is tried before a track is judged out of range — a guitar
 * riff written two octaves above the cello is still that riff.
 *
 * Two things are traded: how much of the line lands inside `[low, high]`, and
 * how far the resulting median climbs above `medianCeiling`. Sitting *below*
 * the ceiling is free, so a bass line already at the bottom of the instrument
 * is never lifted out of its register, and ties still go to the smaller move.
 * The asymmetry is deliberate: on a cello the cost of being an octave too high
 * is a hand out of the neck, and the cost of being an octave too low is a
 * darker colour.
 */
export function bestOctaveShiftToRange(
  pitches: readonly number[], low: number, high: number,
  medianCeiling: number = MEDIAN_CEILING_MIDI,
): { shift: number; fit: number } {
  let best = { shift: 0, fit: -1 };
  let bestScore = -Infinity;
  for (let octaves = -8; octaves <= 8; octaves++) {
    const shift = octaves === 0 ? 0 : octaves * 12;
    let inside = 0;
    for (const p of pitches) {
      const moved = p + shift;
      if (moved >= low && moved <= high) inside++;
    }
    const fit = pitches.length === 0 ? 0 : inside / pitches.length;
    const median = medianOf(pitches) + shift;
    const score = fit * 100 - Math.max(0, median - medianCeiling) * ABOVE_CEILING_COST;
    // Ties go to the smaller move: leave the music where it was written.
    const tied = Math.abs(score - bestScore) < SCORE_EPSILON;
    if ((score > bestScore && !tied) || (tied && Math.abs(shift) < Math.abs(best.shift))) {
      best = { shift, fit };
      bestScore = score;
    }
  }
  return best;
}

export function bestOctaveShift(pitches: readonly number[]): { shift: number; fit: number } {
  return bestOctaveShiftToRange(pitches, CELLO_LOW, FIRST_POSITION_HIGH);
}

/**
 * Recurrence of short interval-and-rhythm cells, independent of absolute key.
 * Static windows are excluded so a pedal is not mistaken for a memorable riff.
 */
export function motifRecurrence(notes: readonly MidiNote[]): number {
  if (notes.length < 8) return 0;

  const counts = new Map<string, number>();
  let windows = 0;
  for (let i = 0; i + 3 < notes.length; i++) {
    const a = notes[i];
    const b = notes[i + 1];
    const c = notes[i + 2];
    const d = notes[i + 3];
    if (!a || !b || !c || !d) continue;

    const intervals = [
      b.midiNumber - a.midiNumber,
      c.midiNumber - b.midiNumber,
      d.midiNumber - c.midiNumber,
    ];
    if (intervals.every((interval) => interval === 0)) continue;
    windows++;
    if (intervals.every((interval) => interval === intervals[0])) continue;

    // Ratios are quantized coarsely so expressive timing jitter does not erase
    // an otherwise identical riff, while a straight shred does not gain credit
    // merely for repeating the same pitch-class cycle.
    const gap1 = Math.max(1, b.startTimeMs - a.startTimeMs);
    const gap2 = Math.max(1, c.startTimeMs - b.startTimeMs);
    const gap3 = Math.max(1, d.startTimeMs - c.startTimeMs);
    const ratio = (gap: number) => Math.round((gap / gap1) * 4) / 4;
    const signature = `${intervals.join(',')}|${ratio(gap2)},${ratio(gap3)}`;
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  if (windows === 0) return 0;
  let recurring = 0;
  for (const count of counts.values()) if (count > 1) recurring += count;
  return recurring / windows;
}

export function melodyMetrics(
  notes: readonly MidiNote[], durationMs: number,
): MelodyMetrics {
  const pitches = notes.map((n) => n.midiNumber);
  if (pitches.length === 0) {
    return {
      noteCount: 0, distinctPitches: 0, movement: 0, span: 0, medianMidi: 0,
      density: 0, motifRecurrence: 0, octaveShift: 0, fitAfterShift: 0,
    };
  }

  let moves = 0;
  for (let i = 1; i < pitches.length; i++) if (pitches[i] !== pitches[i - 1]) moves++;

  const sorted = [...pitches].sort((a, b) => a - b);
  // Non-empty by the guard above; named rather than indexed so the compiler
  // can see it too.
  const [lowest = 0] = sorted;
  const highest = sorted[sorted.length - 1] ?? lowest;
  const median = sorted[Math.floor(sorted.length / 2)] ?? lowest;
  const { shift, fit } = bestOctaveShift(pitches);

  return {
    noteCount: pitches.length,
    distinctPitches: new Set(pitches).size,
    movement: pitches.length > 1 ? moves / (pitches.length - 1) : 0,
    span: highest - lowest,
    medianMidi: median,
    density: durationMs > 0 ? pitches.length / (durationMs / 1000) : 0,
    motifRecurrence: motifRecurrence(notes),
    octaveShift: shift,
    fitAfterShift: fit,
  };
}

/** Word-boundary name matching, so "Chancellor" is not a cello. */
const NAME_MELODIC = /\b(cello|violoncello|vc|violin|viola|lead|melody|theme|vocal|voice|riff)\b/i;
const NAME_SOLO = /\b(solo|shred|improv)\b/i;
const NAME_IGNORE = /\b(ignore|unused|empty|click|metronome)\b/i;

/** GM programs 32–39 are basses. Not disqualifying — some riffs live there. */
function isBassProgram(program: number | null): boolean {
  return program !== null && program >= 32 && program <= 39;
}

/**
 * How good a candidate this track is for the cello line. Negative means reject.
 *
 * Every term is a musical property except the name bonus, which is deliberately
 * small enough that it can never override what the notes are doing.
 */
export function melodyTrackScore(
  track: MidiTrack, notes: readonly MidiNote[], durationMs: number,
): number {
  if (track.isPercussion) return -1;
  if (notes.length < MIN_NOTES) return -1;
  if (track.name && NAME_IGNORE.test(track.name)) return -1;

  const m = melodyMetrics(notes, durationMs);
  let score = 0;

  // ── Anti-drone ────────────────────────────────────────────────────────────
  // Two terms, because neither survives alone. Movement catches a pedal that
  // never moves; variety catches an ostinato that alternates between two
  // pitches and so scores 100 % movement while being no more a tune than the
  // pedal is. The Interstellar and Du Hast files are both the second kind.
  score += m.movement * 45;
  if (m.movement < 0.2) score -= 40;

  score += Math.min(m.distinctPitches, 16) * 3.5;
  if (m.distinctPitches < 7) score -= 25;

  // ── Recognisability ───────────────────────────────────────────────────────
  // Main riffs and themes announce themselves by returning. This interval-and-
  // rhythm measure is transposition invariant and excludes static windows, so
  // it rewards a guitar or bass hook without promoting a drone.
  score += m.motifRecurrence * 34;

  // ── Register fit ──────────────────────────────────────────────────────────
  // Measured after the best octave shift, so a riff written high still counts.
  score += m.fitAfterShift * 45;

  // ── Anti-solo ─────────────────────────────────────────────────────────────
  // A lead break is wide, fast and high. None of those is disqualifying alone;
  // together they describe something no cellist wants in first position.
  if (m.span > 24) score -= (m.span - 24) * 1.5;
  if (m.density > 10) score -= (m.density - 10) * 4;
  if (m.medianMidi > 72) score -= (m.medianMidi - 72) * 1.5;

  // ── Weak hints ────────────────────────────────────────────────────────────
  if (track.name && NAME_MELODIC.test(track.name)) score += 12;
  // "Solo" now counts against a track rather than for it: in a rock or metal
  // file it names the shred break, not the theme.
  if (track.name && NAME_SOLO.test(track.name)) score -= 15;
  if (track.program === 42) score += 8;          // GM cello
  if (isBassProgram(track.program)) score -= 6;  // usually, not always, the pedal

  return score;
}

export interface MelodyChoice {
  track: number;
  score: number;
  metrics: MelodyMetrics;
  /** Apply this to every pitch to bring the line into first position. */
  octaveShift: number;
}

/**
 * Picks the track most likely to be the tune, and how far to transpose it.
 *
 * Returns null when nothing in the file is a plausible cello line — which is a
 * real outcome for a drum loop or a sound-effects file, and better reported
 * than faked.
 */
export function rankMelodyTracks(parsed: {
  notes: MidiNote[];
  tracks: MidiTrack[];
  durationMs: number;
}): MelodyChoice[] {
  const ranked: MelodyChoice[] = [];

  for (const track of parsed.tracks) {
    // Judge the line that will actually be played, not the raw track: a chord
    // stack reads as constant movement until it is flattened.
    const notes = monophonic(parsed.notes.filter((n) => n.track === track.index));
    const first = notes[0];
    const last = notes[notes.length - 1];
    const activeDurationMs = first && last
      ? Math.max(1, last.startTimeMs + last.durationMs - first.startTimeMs)
      : parsed.durationMs;
    const rawScore = melodyTrackScore(track, notes, activeDurationMs);
    // A tiny lead break must not outrank a theme that spans the song.
    const coverage = Math.min(1, activeDurationMs / Math.max(1, parsed.durationMs));
    const score = rawScore < 0 ? rawScore : rawScore * (0.2 + 0.8 * Math.sqrt(coverage));
    if (score < 0) continue;
    const metrics = melodyMetrics(notes, activeDurationMs);
    ranked.push({ track: track.index, score, metrics, octaveShift: metrics.octaveShift });
  }

  return ranked.sort((a, b) => (b.score - a.score) || (a.track - b.track));
}

export function chooseMelodyTrack(parsed: {
  notes: MidiNote[];
  tracks: MidiTrack[];
  durationMs: number;
}): MelodyChoice | null {
  return rankMelodyTracks(parsed)[0] ?? null;
}
