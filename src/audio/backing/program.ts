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
 * anything over ninety seconds. That refusal is why 229 of the 258 bundled
 * songs played no accompaniment at all.
 *
 * Pure: no React, no React Native, no Web Audio. See AGENTS.md.
 */

import {
  AudiblePartsQuery, AudiblePartsResult, BackingPart, InstrumentName, resolveAudibleParts,
} from '@/domain/backing';
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


export interface ActiveScheduledNote {
  note: ScheduledNote;
  /** Seconds already elapsed since this note's onset. */
  elapsedSec: number;
}

/**
 * Notes that must already be sounding when playback begins at `offsetSeconds`.
 *
 * Future-onset scheduling alone is insufficient for drones, long chords, and
 * imported legato notes: their onset may be behind the playhead while their
 * hold or release still overlaps it. The web adapter starts these voices at
 * the current envelope phase; native gets the same behavior by seeking PCM.
 */
export function notesActiveAtOffset(
  program: BackingProgram,
  offsetSeconds: number,
): ActiveScheduledNote[] {
  if (program.durationSec <= 0 || program.notes.length === 0) return [];
  const offset = ((offsetSeconds % program.durationSec) + program.durationSec)
    % program.durationSec;

  return program.notes.flatMap((note) => {
    const elapsedSec = offset - note.atSec;
    if (elapsedSec <= 0) return [];
    const spec = VOICES[note.instrument];
    const soundingSec = Math.max(0.01, note.holdSec)
      + Math.max(0.01, spec.releaseMs / 1000);
    return elapsedSec < soundingSec ? [{ note, elapsedSec }] : [];
  });
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

/**
 * Most voices allowed to sound at once.
 *
 * The busiest file in the library, `les-miserables-theme`, stacks fifteen MIDI
 * tracks with piano chords on top, and at its loudest bars that is more than
 * sixty overlapping notes. Every one is an oscillator, a gain node and a set of
 * automation events on web, and inner-loop work for every sample on native —
 * all to reproduce a reference texture under a cello nobody can pick sixty
 * voices out of. Thirty-two keeps every part audible and puts a ceiling on the
 * cost of the densest bar, which is where the stutter was.
 */
export const MAX_POLYPHONY = 32;

/**
 * Voice stealing, done once when the program is built.
 *
 * Walks the sorted notes keeping the set that is still sounding (hold plus
 * release). When a new note would exceed `max`, the quietest sounding voice
 * — the new note included — loses: if that is an older note it is cut short at
 * the new onset, exactly as a hardware synth steals a voice; if it is the new
 * note, it is dropped. Loudness decides because a thinned backing should keep
 * the accents a player is listening for.
 *
 * Returns a new array; the input is not modified. Truncated notes are copies.
 */
export function limitPolyphony(
  notes: readonly ScheduledNote[], max: number = MAX_POLYPHONY,
): ScheduledNote[] {
  if (max <= 0) return [];
  const out: (ScheduledNote | null)[] = [];
  /** Indices into `out` of voices that may still be sounding. */
  let sounding: number[] = [];
  const endOf = (note: ScheduledNote) =>
    note.atSec + note.holdSec + VOICES[note.instrument].releaseMs / 1000;

  for (const note of notes) {
    sounding = sounding.filter((index) => {
      const voice = out[index];
      return voice !== null && endOf(voice) > note.atSec;
    });

    if (sounding.length < max) {
      sounding.push(out.length);
      out.push(note);
      continue;
    }

    let quietest = sounding[0];
    for (const index of sounding) {
      if ((out[index] as ScheduledNote).amplitude < (out[quietest] as ScheduledNote).amplitude) {
        quietest = index;
      }
    }
    const victim = out[quietest] as ScheduledNote;
    if (note.amplitude <= victim.amplitude) continue;

    // The stolen voice must be *silent* by the new onset, release included, or
    // the ceiling is only a ceiling on attacks. A voice with no room left for
    // a hold never really sounded; drop it rather than keep a click.
    // A millisecond of margin, so float error cannot leave the tail ending a
    // hair after the onset it was cut for.
    const releaseSec = VOICES[victim.instrument].releaseMs / 1000;
    const holdSec = Math.min(victim.holdSec, note.atSec - victim.atSec - releaseSec - 0.001);
    out[quietest] = holdSec > 0.02 ? { ...victim, holdSec } : null;
    sounding = sounding.filter((index) => index !== quietest);
    sounding.push(out.length);
    out.push(note);
  }

  return out.filter((note): note is ScheduledNote => note !== null);
}

export interface ProgramOptions {
  /** Identifies the music, so an equivalent program keeps the same key. */
  id: string;
  parts: readonly BackingPart[];
  loop: PracticeLoop;
}

function compareScheduled(a: ScheduledNote, b: ScheduledNote): number {
  return (a.atSec - b.atSec)
    || (a.holdSec - b.holdSec)
    || (a.midiNumber - b.midiNumber)
    || a.instrument.localeCompare(b.instrument)
    || (a.amplitude - b.amplitude);
}

/** Stable FNV-1a hash; avoids Node crypto in this shared native/web module. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function contentKey(id: string, notes: readonly ScheduledNote[], durationSec: number): string {
  const canonical = [
    durationSec.toFixed(6),
    ...notes.map((note) => [
      note.atSec.toFixed(6),
      note.holdSec.toFixed(6),
      String(note.midiNumber),
      note.instrument,
      note.amplitude.toFixed(6),
    ].join(',')),
  ].join(';');
  return `${id}:${hashText(canonical)}`;
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

  if (notes.length === 0) {
    return { key: contentKey(id, [], durationSec), notes: [], durationSec };
  }

  notes.sort(compareScheduled);
  // Identity describes the requested music, not merely count and duration.
  // Compute it before peak trim so two differently authored amplitudes cannot
  // collapse to the same key just because gain protection normalises them.
  const key = contentKey(id, notes, durationSec);

  // Bounded before anything else looks at the notes, so the level estimate
  // below measures the voices that will actually sound.
  const voiced = limitPolyphony(notes);

  // One trim for the whole program, applied here rather than at playback, so
  // the two adapters cannot disagree about how loud the same music is.
  const peak = estimatePeak(voiced);
  const trim = peak > 0 ? Math.min(1, TARGET_PEAK / peak) : 1;
  if (trim < 1) for (const note of voiced) note.amplitude *= trim;

  return { key, notes: voiced, durationSec };
}

export interface AudibleProgramQuery extends AudiblePartsQuery {}

export interface AudibleProgramResult extends AudiblePartsResult {
  program: BackingProgram;
}

/**
 * Consolidates part resolution and backing program compilation into a single
 * pure function, eliminating cascaded useMemos in the React layer.
 */
export function resolveAudibleProgram(query: AudibleProgramQuery): AudibleProgramResult {
  const partsResult = resolveAudibleParts(query);
  const program = buildProgram({
    id: `${query.score?.id ?? 'none'}:${query.listenMode}:${query.accompaniment}`,
    parts: partsResult.audibleParts,
    loop: query.loop,
  });
  return {
    ...partsResult,
    program,
  };
}
