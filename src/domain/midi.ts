/**
 * Standard MIDI File reader.
 *
 * Written here rather than pulled in as a dependency: the app needs exactly
 * one thing from a MIDI file — note events with times in milliseconds, grouped
 * by track and tagged with an instrument — and a self-contained reader is
 * easier to audit than a package. It runs both at build time (the score
 * converter) and at runtime (importing a backing track on the device), so it
 * lives in `domain` and depends on nothing.
 *
 * Handles format 0 and 1, tempo changes, and running status.
 */

export interface MidiNote {
  midiNumber: number;
  startTimeMs: number;
  durationMs: number;
  track: number;
  channel: number;
  velocity: number;
}

/** What a MIDI file says about one of its tracks. */
export interface MidiTrack {
  index: number;
  /** From the track-name meta event, if the file bothered to set one. */
  name: string | null;
  /** General MIDI program number from the first program change, 0–127. */
  program: number | null;
  /** Channels this track writes to. Channel 9 is percussion by convention. */
  channels: number[];
  noteCount: number;
  lowestMidi: number;
  highestMidi: number;
  /** True when every note is on channel 9 — a drum track. */
  isPercussion: boolean;
}

export interface ParsedMidi {
  notes: MidiNote[];
  tracks: MidiTrack[];
  /** Tempo of the first tempo event, or 120 if the file never says. */
  bpm: number;
  timeSignature: [number, number];
  durationMs: number;
}

interface Reader {
  data: Uint8Array;
  offset: number;
}

/**
 * One byte, or zero past the end.
 *
 * Reading past the end of a truncated file yields 0 rather than `undefined`,
 * which keeps every arithmetic caller total. A malformed file then fails on the
 * structure it produces — an unknown chunk id, a track length that overruns —
 * rather than on `NaN` propagating silently through the tick arithmetic.
 */
const u8 = (r: Reader): number => r.data[r.offset++] ?? 0;
const u16 = (r: Reader) => (u8(r) << 8) | u8(r);
const u32 = (r: Reader) => ((u8(r) << 24) >>> 0) + (u8(r) << 16) + (u8(r) << 8) + u8(r);

/** MIDI's 7-bits-per-byte variable-length quantity. */
function readVarInt(r: Reader): number {
  let value = 0;
  for (;;) {
    const byte = u8(r);
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }
}

function readChunkId(r: Reader): string {
  return String.fromCharCode(u8(r), u8(r), u8(r), u8(r));
}

function readText(r: Reader, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(u8(r));
  return out.trim();
}

type RawEventType = 'noteOn' | 'noteOff' | 'tempo' | 'timeSignature' | 'program' | 'trackName';

interface RawEvent {
  tick: number;
  track: number;
  type: RawEventType;
  channel: number;
  note: number;
  velocity: number;
  value: number;
  text: string;
  timeSignature: [number, number];
}

type EventInput = Partial<RawEvent> & { tick: number; track: number; type: RawEventType };
type EventSink = (event: EventInput) => void;

const META_EVENT = 0xff;
const SYSEX_START = 0xf0;
const SYSEX_ESCAPE = 0xf7;
const META_TEMPO = 0x51;
const META_TIME_SIGNATURE = 0x58;
const META_TEXT_TYPES = new Set([0x03, 0x04]);
/** Bytes of data after each channel status that this parser skips. */
const SKIPPED_DATA_BYTES: Readonly<Record<number, number>> = { 0xa0: 2, 0xb0: 2, 0xd0: 1, 0xe0: 2 };

function readHeader(r: Reader): { trackCount: number; ticksPerQuarter: number } {
  if (r.data.length < 14 || readChunkId(r) !== 'MThd') {
    throw new Error('not a MIDI file: missing MThd header');
  }
  const headerLength = u32(r);
  const headerEnd = r.offset + headerLength;
  u16(r); // format — 0 and 1 are handled identically once tracks are merged
  const trackCount = u16(r);
  const division = u16(r);
  r.offset = headerEnd;
  if (division & 0x8000) {
    throw new Error('SMPTE time division is not supported; re-export with metrical timing');
  }
  return { trackCount, ticksPerQuarter: division };
}

function readMetaEvent(r: Reader, at: { tick: number; track: number }, emit: EventSink): void {
  const metaType = u8(r);
  const metaLength = readVarInt(r);
  const next = r.offset + metaLength;
  if (metaType === META_TEMPO && metaLength === 3) {
    emit({ ...at, type: 'tempo', value: (u8(r) << 16) | (u8(r) << 8) | u8(r) });
  } else if (metaType === META_TIME_SIGNATURE && metaLength >= 2) {
    const numerator = u8(r);
    const denominator = 2 ** u8(r);
    emit({ ...at, type: 'timeSignature', timeSignature: [numerator, denominator] });
  } else if (META_TEXT_TYPES.has(metaType)) {
    emit({ ...at, type: 'trackName', text: readText(r, metaLength) });
  }
  r.offset = next;
}

/** Reads one channel message. Returns false when the status is unknown and the stream is out of sync. */
function readChannelEvent(r: Reader, status: number, at: { tick: number; track: number }, emit: EventSink): boolean {
  const command = status & 0xf0;
  const channel = status & 0x0f;
  if (command === 0x90 || command === 0x80) {
    const note = u8(r);
    const velocity = u8(r);
    // A note-on with zero velocity is a note-off. Very common.
    const type = command === 0x90 && velocity > 0 ? 'noteOn' : 'noteOff';
    emit({ ...at, channel, note, velocity, type });
    return true;
  }
  if (command === 0xc0) {
    emit({ ...at, channel, type: 'program', value: u8(r) });
    return true;
  }
  const skip = SKIPPED_DATA_BYTES[command];
  if (skip === undefined) return false;
  r.offset += skip;
  return true;
}

function readTrack(r: Reader, track: number, emit: EventSink): void {
  if (readChunkId(r) !== 'MTrk') throw new Error(`expected MTrk at byte ${r.offset - 4}`);
  const length = u32(r);
  const end = Math.min(r.offset + length, r.data.length);
  let tick = 0;
  let runningStatus = 0;

  while (r.offset < end) {
    tick += readVarInt(r);
    let status = u8(r);
    // Running status: a data byte here means "same status as last time".
    if (status < 0x80) {
      r.offset--;
      status = runningStatus;
    } else if (status < SYSEX_START) {
      runningStatus = status;
    }

    if (status === META_EVENT) readMetaEvent(r, { tick, track }, emit);
    else if (status === SYSEX_START || status === SYSEX_ESCAPE) r.offset += readVarInt(r);
    // An unknown status means the stream is out of sync; the rest of this
    // track cannot be trusted, so skip to the next one rather than emitting
    // garbage notes.
    else if (!readChannelEvent(r, status, { tick, track }, emit)) r.offset = end;
  }
  r.offset = end;
}

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const r: Reader = { data: bytes, offset: 0 };
  const { trackCount, ticksPerQuarter } = readHeader(r);

  const events: RawEvent[] = [];
  const emit: EventSink = (event) => {
    events.push({ channel: 0, note: 0, velocity: 0, value: 0, text: '', timeSignature: [4, 4], ...event });
  };
  for (let track = 0; track < trackCount && r.offset < bytes.length; track++) {
    readTrack(r, track, emit);
  }
  return assemble(events, ticksPerQuarter, trackCount);
}

/** What the meta events say about the file, gathered while notes are paired. */
interface FileFacts {
  names: Map<number, string>;
  programs: Map<number, number>;
  channels: Map<number, Set<number>>;
  microsecondsPerQuarter: number;
  firstTempo: number | null;
  timeSignature: [number, number];
}

/** Records a meta event. Returns false for note events, which the caller pairs. */
function recordMeta(facts: FileFacts, event: RawEvent): boolean {
  switch (event.type) {
    case 'tempo':
      facts.microsecondsPerQuarter = event.value;
      facts.firstTempo ??= event.value;
      return true;
    case 'timeSignature':
      if (event.tick === 0) facts.timeSignature = event.timeSignature;
      return true;
    case 'trackName':
      if (!facts.names.has(event.track)) facts.names.set(event.track, event.text);
      return true;
    case 'program':
      if (!facts.programs.has(event.track)) facts.programs.set(event.track, event.value);
      return true;
    default:
      return false;
  }
}

function summarizeTrack(index: number, notes: readonly MidiNote[], facts: FileFacts): MidiTrack {
  const trackNotes = notes.filter((n) => n.track === index);
  const pitches = trackNotes.map((n) => n.midiNumber);
  return {
    index,
    name: facts.names.get(index) ?? null,
    program: facts.programs.get(index) ?? null,
    channels: [...(facts.channels.get(index) ?? [])].sort((a, b) => a - b),
    noteCount: trackNotes.length,
    lowestMidi: pitches.length ? Math.min(...pitches) : 0,
    highestMidi: pitches.length ? Math.max(...pitches) : 0,
    isPercussion: trackNotes.length > 0 && trackNotes.every((n) => n.channel === 9),
  };
}

const MIDI_DEFAULT_TEMPO_US = 500000; // 120 bpm
const EVENT_ORDER: Record<RawEventType, number> = {
  tempo: 0, timeSignature: 0, trackName: 0, program: 0, noteOff: 1, noteOn: 2,
};

/** Turns tick-stamped events into millisecond-stamped notes and track summaries. */
function assemble(events: RawEvent[], ticksPerQuarter: number, trackCount: number): ParsedMidi {
  events.sort((a, b) => (a.tick - b.tick) || (EVENT_ORDER[a.type] - EVENT_ORDER[b.type]));

  const notes: MidiNote[] = [];
  const open = new Map<string, { startMs: number; velocity: number }>();
  const facts: FileFacts = {
    names: new Map(), programs: new Map(), channels: new Map(),
    microsecondsPerQuarter: MIDI_DEFAULT_TEMPO_US, firstTempo: null, timeSignature: [4, 4],
  };
  let lastTick = 0;
  let elapsedMs = 0;

  for (const event of events) {
    elapsedMs += ((event.tick - lastTick) / ticksPerQuarter) * (facts.microsecondsPerQuarter / 1000);
    lastTick = event.tick;
    if (recordMeta(facts, event)) continue;

    const channels = facts.channels.get(event.track) ?? new Set<number>();
    channels.add(event.channel);
    facts.channels.set(event.track, channels);

    const key = `${event.track}:${event.channel}:${event.note}`;
    if (event.type === 'noteOn') {
      open.set(key, { startMs: elapsedMs, velocity: event.velocity });
      continue;
    }
    const started = open.get(key);
    if (!started) continue;
    open.delete(key);
    notes.push({
      midiNumber: event.note,
      startTimeMs: Math.round(started.startMs),
      durationMs: Math.max(1, Math.round(elapsedMs - started.startMs)),
      track: event.track,
      channel: event.channel,
      velocity: started.velocity,
    });
  }

  notes.sort((a, b) => a.startTimeMs - b.startTimeMs || a.midiNumber - b.midiNumber);

  return {
    notes,
    tracks: Array.from({ length: trackCount }, (_, index) => summarizeTrack(index, notes, facts)),
    bpm: facts.firstTempo === null ? 120 : Math.round(60000000 / facts.firstTempo),
    timeSignature: facts.timeSignature,
    durationMs: notes.reduce((max, n) => Math.max(max, n.startTimeMs + n.durationMs), 0),
  };
}

/**
 * Reduces overlapping notes to a single line.
 *
 * A cello part exported from notation software often carries chords or a
 * second voice. The solo line plays one note at a time, so overlaps are
 * resolved by keeping the highest sounding pitch — which is the melody far
 * more often than not — and truncating whatever it displaces.
 */
export function monophonic(notes: MidiNote[]): MidiNote[] {
  /** Shorter than this and the note never really sounded — drop it instead. */
  const MIN_AUDIBLE_MS = 10;

  const out: MidiNote[] = [];
  for (const note of notes.slice().sort((a, b) => a.startTimeMs - b.startTimeMs)) {
    const previous = out[out.length - 1];
    if (!previous) { out.push({ ...note }); continue; }

    const previousEnd = previous.startTimeMs + previous.durationMs;
    if (note.startTimeMs >= previousEnd) { out.push({ ...note }); continue; }

    // The lower note of an overlap is an accompaniment voice; drop it.
    if (note.midiNumber <= previous.midiNumber) continue;

    // Truncate whatever the higher note displaces. In a block chord every
    // note starts at the same instant, so the truncation is to zero — those
    // must be removed outright rather than left as one-millisecond stubs.
    const trimmed = note.startTimeMs - previous.startTimeMs;
    if (trimmed < MIN_AUDIBLE_MS) out.pop();
    else previous.durationMs = trimmed;

    out.push({ ...note });
  }
  return out;
}
