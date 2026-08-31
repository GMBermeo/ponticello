/**
 * The backing program — what should sound, when, and how loudly.
 *
 * This is the one description of an accompaniment that both platforms agree
 * on. Web schedules these notes as Web Audio voices; native renders them to a
 * WAV. Neither adapter knows anything about parts, loops, tempo or roles: by
 * the time a program exists all of that has been resolved into absolute real
 * seconds from the start of the loop.
 *
 * It exists because the previous shape — "hand the player a Float32Array" —
 * forced every platform to pay for a full synthesis before a single note could
 * sound. A 539-second song came to a 47 MB buffer and a second of blocked JS
 * thread on a laptop, several on a phone, and the code's answer was to refuse
 * anything over ninety seconds. That refusal is why 219 of the 258 bundled
 * songs played no accompaniment at all.
 *
 * Pure: no React, no React Native, no Web Audio. See AGENTS.md.
 */

import { BackingPart, InstrumentName } from '@/domain/backing';
import { PracticeLoop } from '@/domain/loop';
import { VOICES } from '../voices';

/** One note, resolved into real time and final amplitude. */
export interface ScheduledNote {
  /** Seconds from the start of the loop, at the chosen tempo. */
  atSec: number;
  /** How long the note is held before its release begins, in real seconds. */
  holdSec: number;
  midiNumber: number;
  instrument: InstrumentName;
  /** Linear amplitude, 0–1, with part gain and master trim already folded in. */
  amplitude: number;
}

export interface BackingProgram {
  /**
   * Changes whenever anything about the program does.
   *
   * The adapters compare this rather than the array identity: a re-render that
   * produces the same music must not restart the audio, because restarting is
   * audible and the loop steppers fire on every tap.
   */
  key: string;
  /** Sorted by `atSec`. */
  notes: readonly ScheduledNote[];
  /** Length of one time round the loop, in real seconds. */
  durationSec: number;
}

export const EMPTY_PROGRAM: BackingProgram = { key: 'empty', notes: [], durationSec: 0 };

/**
 * Peak the mix is trimmed to.
 *
 * Below unity so the limiter's knee is somewhere to go rather than somewhere
 * the music lives. The old code skipped this step entirely and fed the limiter
 * a mix that peaked at *forty* on the densest imported songs — fifteen MIDI
 * tracks summed at full gain — so every loud bar arrived as a wall of tanh
 * distortion. That was "the backing sounds terrible", and no amount of
 * playback fixing would have touched it.
 */
const TARGET_PEAK = 0.72;

/**
 * Estimates the loudest moment in a set of notes.
 *
 * Concurrent voices are summed **incoherently** — root of the sum of squares —
 * because independent notes at unrelated frequencies do not line up their
 * peaks. Summing them arithmetically is the worst case and would leave a busy
 * arrangement inaudibly quiet to protect against a coincidence that does not
 * happen; ignoring concurrency altogether is what produced a peak of forty.
 */
export function estimatePeak(notes: readonly ScheduledNote[]): number {
  if (notes.length === 0) return 0;

  // An on/off sweep over squared amplitudes. Sorting the two event lists is
  // cheaper than sampling the timeline, and exact at the only points that can
  // be maxima — the instants a note begins.
  const events: { t: number; power: number }[] = [];
  for (const note of notes) {
    const spec = VOICES[note.instrument];
    // A note is at its loudest during the attack; after the decay it sits at
    // its sustain level. Take the higher of the two as its contribution.
    const level = note.amplitude * spec.gain;
    const power = level * level;
    events.push({ t: note.atSec, power });
    events.push({ t: note.atSec + note.holdSec + spec.releaseMs / 1000, power: -power });
  }
  events.sort((a, b) => a.t - b.t || b.power - a.power);

  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.power;
    if (running > peak) peak = running;
  }
  return Math.sqrt(Math.max(0, peak));
}

export interface ProgramOptions {
  /** Identifies the music, so an equivalent program keeps the same key. */
  id: string;
  parts: readonly BackingPart[];
  loop: PracticeLoop;
}

/**
 * Resolves parts into a program.
 *
 * `parts` are expected to have been clipped to the loop already — their times
 * are loop-relative *score* milliseconds. Everything here converts those to
 * real seconds by dividing through the tempo scale, which is the single place
 * that conversion now happens.
 */
export function buildProgram({ id, parts, loop }: ProgramOptions): BackingProgram {
  const { tempoScale, realDurationMs } = loop;
  const durationSec = realDurationMs / 1000;
  if (durationSec <= 0) return EMPTY_PROGRAM;

  const notes: ScheduledNote[] = [];
  for (const part of parts) {
    if (part.muted || part.gain <= 0) continue;
    for (const note of part.notes) {
      if (note.durationMs <= 0) continue;
      notes.push({
        atSec: note.startTimeMs / tempoScale / 1000,
        holdSec: note.durationMs / tempoScale / 1000,
        midiNumber: note.midiNumber,
        instrument: part.instrument,
        amplitude: part.gain * note.velocity,
      });
    }
  }

  if (notes.length === 0) return { key: `${id}:silent`, notes: [], durationSec };

  notes.sort((a, b) => a.atSec - b.atSec);

  // One trim for the whole program, applied here rather than at playback, so
  // the two adapters cannot disagree about how loud the same music is.
  const peak = estimatePeak(notes);
  const trim = peak > 0 ? Math.min(1, TARGET_PEAK / peak) : 1;
  if (trim < 1) for (const note of notes) note.amplitude *= trim;

  return {
    key: `${id}:${notes.length}:${durationSec.toFixed(3)}:${trim.toFixed(4)}`,
    notes,
    durationSec,
  };
}

/**
 * Where in the program a score time falls, in real seconds, wrapped.
 *
 * The playhead is a cycle, so a time past the end of the loop is the same time
 * at the start of the next pass. This is what phase-locks the accompaniment to
 * the playhead when playback starts part way through a phrase.
 */
export function programOffsetSeconds(
  program: BackingProgram, loop: PracticeLoop, scoreTimeMs: number,
): number {
  if (program.durationSec <= 0 || loop.scoreDurationMs <= 0) return 0;
  const into = (scoreTimeMs - loop.fromMs) % loop.scoreDurationMs;
  const wrapped = into < 0 ? into + loop.scoreDurationMs : into;
  return wrapped / loop.tempoScale / 1000;
}
