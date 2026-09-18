import { midiToFrequency, midiToPitchName } from '../cello';
import { CelloState, RawNoteEvent, seatLine } from '../fingering';
import { melodyMetrics, rankMelodyTracks } from '../melody';
import { MidiNote, monophonic, ParsedMidi } from '../midi';
import { CelloNote, CelloSongScore, scoreDurationMs } from '../schema';
import {
  ARRANGEMENT_PROFILES,
  ArrangedLine,
  ArrangeMidiOptions,
  ArrangeScoreOptions,
  ArrangementLevel,
  ArrangementRange,
  ArrangementSourceKind,
} from './profiles';
import { bassLine, harmonicGuide, sourceKind } from './harmonicBass';
import { preparePracticeLine } from './rhythmReducer';

/** Clip notes that cross the new origin instead of losing an opening drone. */
export function rebaseLine(
  notes: readonly RawNoteEvent[], originMs: number, endMs: number, timeScale = 1,
): RawNoteEvent[] {
  return notes.filter((note) => note.startTimeMs < endMs
    && note.startTimeMs + note.durationMs > originMs).map((note) => {
    const start = Math.max(originMs, note.startTimeMs);
    const end = Math.min(endMs, note.startTimeMs + note.durationMs);
    return {
      midiNumber: note.midiNumber,
      startTimeMs: (start - originMs) * timeScale,
      durationMs: (end - start) * timeScale,
    };
  });
}

/**
 * MIDI files in the wild occasionally contain one event hours after the song.
 * When at least three musical tracks agree on a normal ending, treat a lone end
 * beyond both 1.8× and two minutes past the median as corrupt. A genuinely long
 * composition has its tracks ending together and therefore remains untouched.
 */
export function midiContentEndMs(parsed: ParsedMidi): number {
  const ends = parsed.tracks
    .filter((track) => !track.isPercussion && track.noteCount > 0)
    .map((track) => parsed.notes
      .filter((note) => note.track === track.index)
      .reduce((end, note) => Math.max(end, note.startTimeMs + note.durationMs), 0))
    .filter((end) => end > 0)
    .sort((a, b) => a - b);

  if (ends.length < 3) return parsed.durationMs;
  const median = ends[Math.floor(ends.length / 2)] ?? parsed.durationMs;
  const outlierAt = Math.max(median * 1.8, median + 120_000);
  if (parsed.durationMs <= outlierAt) return parsed.durationMs;

  const plausible = ends.filter((end) => end <= outlierAt);
  return plausible[plausible.length - 1] ?? median;
}

/** Arrange a parsed MIDI through the same policy on device and at build time. */
export function arrangeMidi(parsed: ParsedMidi, options: ArrangeMidiOptions): ArrangedLine {
  const sourceEndMs = midiContentEndMs(parsed);
  const musicalNotes = parsed.notes
    .filter((note) => note.startTimeMs < sourceEndMs)
    .map((note) => ({
      ...note,
      durationMs: Math.max(1, Math.min(note.durationMs, sourceEndMs - note.startTimeMs)),
    }));
  const musicalParsed: ParsedMidi = {
    ...parsed,
    notes: musicalNotes,
    durationMs: sourceEndMs,
  };
  const profile = ARRANGEMENT_PROFILES[options.level];
  const range = options.range ?? profile.range;
  let sourceTrack: number | null = null;
  let source: MidiNote[] = [];
  let metrics = null;
  let kind: ArrangementSourceKind = 'roots';

  if (options.sourceTrack !== undefined && options.sourceTrack !== null) {
    sourceTrack = options.sourceTrack;
    source = monophonic(musicalNotes.filter((note) => note.track === sourceTrack));
    metrics = melodyMetrics(source, sourceEndMs);
    const descriptor = parsed.tracks.find((track) => track.index === sourceTrack);
    kind = sourceKind(metrics, descriptor?.program ?? null);
  } else if (profile.prefersGuide) {
    source = harmonicGuide(musicalParsed, sourceEndMs);
  } else if (profile.prefersBass) {
    source = bassLine(musicalParsed, sourceEndMs);
    kind = 'bass';
  } else {
    const choice = rankMelodyTracks(musicalParsed)[0];
    if (choice) {
      sourceTrack = choice.track;
      source = monophonic(musicalNotes.filter((note) => note.track === sourceTrack));
      metrics = choice.metrics;
      const descriptor = parsed.tracks.find((track) => track.index === sourceTrack);
      kind = sourceKind(choice.metrics, descriptor?.program ?? null);
    } else {
      source = harmonicGuide(musicalParsed, sourceEndMs);
    }
  }

  if (source.length === 0) {
    return {
      notes: [], sourceTrack, octaveShift: 0, originalNoteCount: 0, keptNoteCount: 0,
      sourceKind: kind, foldedNotes: 0, originMs: 0, sourceEndMs, metrics,
    };
  }

  const originalNoteCount = source.length;
  const originMs = options.sourceTrack !== undefined && options.sourceTrack !== null
    ? source[0]?.startTimeMs ?? 0
    : Math.min(...musicalNotes.filter((note) =>
      parsed.tracks.some((track) => track.index === note.track && !track.isPercussion))
      .map((note) => note.startTimeMs));
  const { fit: fitted, notes: smoothed } = preparePracticeLine(source, options.level, range, parsed.bpm);
  const rebased = smoothed.map((note) => ({
    ...note,
    startTimeMs: Math.max(0, note.startTimeMs - originMs),
  }));

  return {
    notes: rebased,
    sourceTrack,
    octaveShift: fitted.octaveShift,
    originalNoteCount,
    keptNoteCount: rebased.length,
    sourceKind: kind,
    foldedNotes: fitted.foldedNotes,
    originMs,
    sourceEndMs,
    metrics,
  };
}

export function scoreMidiNotes(score: CelloSongScore): MidiNote[] {
  return score.notes.map((note) => ({
    midiNumber: note.midiNumber,
    startTimeMs: note.startTimeMs,
    durationMs: note.durationMs,
    track: 0,
    channel: 0,
    velocity: note.articulation === 'accent' ? 116 : 92,
  }));
}

/** Derive a difficulty level from one stored full line without duplicating JSON. */
export function arrangeScoreForLevel(
  score: CelloSongScore, level: ArrangementLevel, options: ArrangeScoreOptions = {},
): CelloSongScore {
  if (score.notes.length === 0) return score;

  const profile = ARRANGEMENT_PROFILES[level];
  const totalMs = scoreDurationMs(score);

  const prepare = (input: readonly MidiNote[], range: ArrangementRange) => {
    const { fit, notes: arranged } = preparePracticeLine(input, level, range, score.metadata.bpm);
    const events: RawNoteEvent[] = arranged.map((note) => ({
      midiNumber: note.midiNumber,
      startTimeMs: note.startTimeMs,
      durationMs: Math.max(1, Math.min(note.durationMs, totalMs - note.startTimeMs)),
    })).filter((note) => note.durationMs > 0 && note.startTimeMs < totalMs);
    return { fit, events };
  };

  const offered = profile.prefersGuide ? options.guide
    : profile.prefersBass ? options.bass : undefined;
  const accompaniment = offered?.length
    ? prepare(offered.map((note) => ({ ...note, track: 0, channel: 0, velocity: 112 })), profile.range)
    : null;

  const fallback = () => {
    const source = scoreMidiNotes(score);
    if (!profile.prefersGuide) return prepare(source, profile.range);
    const derived = harmonicGuide({ notes: source, bpm: score.metadata.bpm,
      timeSignature: score.measures[0]?.timeSignature ?? [4, 4], durationMs: totalMs,
      tracks: [{ index: 0, name: 'Score', program: 42, channels: [0], noteCount: source.length,
        lowestMidi: 36, highestMidi: 81, isPercussion: false }] }, totalMs);
    return prepare(derived, profile.range);
  };
  const { fit: fitted, events } = accompaniment?.events.length ? accompaniment : fallback();
  const guide = profile.prefersGuide;
  const role = guide ? 'roots' : profile.prefersBass && accompaniment?.events.length ? 'bass' : 'melody';

  const states: CelloState[] = seatLine(events, { closedFrameOnly: profile.closedFrameOnly });
  const originalsByStart = new Map<number, CelloNote>();
  for (const note of score.notes) if (!originalsByStart.has(note.startTimeMs)) originalsByStart.set(note.startTimeMs, note);

  const notes: CelloNote[] = events.map((event, index) => {
    const state = states[index];
    if (!state) throw new Error(`No fingering was found for arranged note ${index + 1}.`);
    const original = originalsByStart.get(event.startTimeMs);
    const measureIndex = Math.max(0, score.measures.findIndex((measure) =>
      event.startTimeMs >= measure.startBarTimeMs
      && event.startTimeMs < measure.startBarTimeMs + measure.durationMs));
    return {
      id: `${score.id}-${level.toLowerCase()}-${index + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      durationMs: Math.round(event.durationMs),
      pitchName: midiToPitchName(event.midiNumber, score.metadata.preferFlats),
      midiNumber: event.midiNumber,
      frequency: Math.round(midiToFrequency(event.midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: role !== 'melody' ? 'accent' : original?.articulation ?? 'arco',
      tie: false,
      measureIndex,
      bowDirection: index % 2 === 0 ? 'down' : 'up',
      isHarmonic: role === 'melody' ? original?.isHarmonic : undefined,
    };
  });

  const changed = notes.length !== score.notes.length || fitted.octaveShift !== 0 || fitted.foldedNotes > 0;
  const detail = role === 'bass'
    ? `${level} line: a simple bass accompaniment in first position, with rests for difficult changes.`
    : guide
      ? `${level} line: ${notes.length} bass anchors in the low register, drawn from the song's own harmony.`
      : changed
        ? `${level} line: ${notes.length}/${score.notes.length} attacks, ${profile.range.low}–${profile.range.high} MIDI.`
        : `${level} line: the full part already fits this level.`;

  return {
    ...score,
    metadata: {
      ...score.metadata,
      difficulty: level,
      arrangementRole: role,
      teaches: `${detail} ${score.metadata.teaches}`,
    },
    notes,
  };
}
