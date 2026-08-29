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

export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const r: Reader = { data: bytes, offset: 0 };

  if (bytes.length < 14 || readChunkId(r) !== 'MThd') {
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
  const ticksPerQuarter = division;

  const events: RawEvent[] = [];
  const push = (e: Partial<RawEvent> & { tick: number; track: number; type: RawEventType }) => {
    events.push({
      channel: 0, note: 0, velocity: 0, value: 0, text: '', timeSignature: [4, 4], ...e,
    });
  };

  for (let track = 0; track < trackCount; track++) {
    if (r.offset >= bytes.length) break;
    if (readChunkId(r) !== 'MTrk') throw new Error(`expected MTrk at byte ${r.offset - 4}`);
    const length = u32(r);
    const end = Math.min(r.offset + length, bytes.length);

    let tick = 0;
    let runningStatus = 0;

    while (r.offset < end) {
      tick += readVarInt(r);
      let status = u8(r);

      // Running status: a data byte here means "same status as last time".
      if (status < 0x80) {
        r.offset--;
        status = runningStatus;
      } else if (status < 0xf0) {
        runningStatus = status;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;

      if (status === 0xff) {
        const metaType = u8(r);
        const metaLength = readVarInt(r);
        const next = r.offset + metaLength;
        if (metaType === 0x51 && metaLength === 3) {
          push({ tick, track, type: 'tempo', value: (u8(r) << 16) | (u8(r) << 8) | u8(r) });
        } else if (metaType === 0x58 && metaLength >= 2) {
          const numerator = u8(r);
          const denominator = 2 ** u8(r);
          push({ tick, track, type: 'timeSignature', timeSignature: [numerator, denominator] });
        } else if (metaType === 0x03 || metaType === 0x04) {
          push({ tick, track, type: 'trackName', text: readText(r, metaLength) });
        }
        r.offset = next;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        r.offset += readVarInt(r);
        continue;
      }

      switch (command) {
        case 0x90: {
          const note = u8(r);
          const velocity = u8(r);
          // A note-on with zero velocity is a note-off. Very common.
          push({ tick, track, channel, note, velocity, type: velocity === 0 ? 'noteOff' : 'noteOn' });
          break;
        }
        case 0x80: {
          const note = u8(r);
          const velocity = u8(r);
          push({ tick, track, channel, note, velocity, type: 'noteOff' });
          break;
        }
        case 0xc0:
          push({ tick, track, channel, type: 'program', value: u8(r) });
          break;
        case 0xd0:
          r.offset += 1;
          break;
        case 0xa0: case 0xb0: case 0xe0:
          r.offset += 2;
          break;
        default:
          // An unknown status means the stream is out of sync; the rest of this
          // track cannot be trusted, so skip to the next one rather than
          // emitting garbage notes.
          r.offset = end;
          break;
      }
    }

    r.offset = end;
  }

  return assemble(events, ticksPerQuarter, trackCount);
}

/** Turns tick-stamped events into millisecond-stamped notes and track summaries. */
function assemble(events: RawEvent[], ticksPerQuarter: number, trackCount: number): ParsedMidi {
  const order: Record<RawEventType, number> = {
    tempo: 0, timeSignature: 0, trackName: 0, program: 0, noteOff: 1, noteOn: 2,
  };
  events.sort((a, b) => (a.tick - b.tick) || (order[a.type] - order[b.type]));

  const notes: MidiNote[] = [];
  const open = new Map<string, { startMs: number; velocity: number }>();

  const names = new Map<number, string>();
  const programs = new Map<number, number>();
  const channels = new Map<number, Set<number>>();

  let microsecondsPerQuarter = 500000; // 120 bpm, the MIDI default
  let firstTempo: number | null = null;
  let timeSignature: [number, number] = [4, 4];
  let lastTick = 0;
  let elapsedMs = 0;

  for (const event of events) {
    elapsedMs += ((event.tick - lastTick) / ticksPerQuarter) * (microsecondsPerQuarter / 1000);
    lastTick = event.tick;

    switch (event.type) {
      case 'tempo':
        microsecondsPerQuarter = event.value;
        if (firstTempo === null) firstTempo = event.value;
        continue;
      case 'timeSignature':
        if (event.tick === 0) timeSignature = event.timeSignature;
        continue;
      case 'trackName':
        if (!names.has(event.track)) names.set(event.track, event.text);
        continue;
      case 'program':
        if (!programs.has(event.track)) programs.set(event.track, event.value);
        continue;
      default:
        break;
    }

    if (!channels.has(event.track)) channels.set(event.track, new Set());
    channels.get(event.track)!.add(event.channel);

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

  const tracks: MidiTrack[] = [];
  for (let index = 0; index < trackCount; index++) {
    const trackNotes = notes.filter((n) => n.track === index);
    const used = [...(channels.get(index) ?? [])].sort((a, b) => a - b);
    tracks.push({
      index,
      name: names.get(index) ?? null,
      program: programs.get(index) ?? null,
      channels: used,
      noteCount: trackNotes.length,
      lowestMidi: trackNotes.length ? Math.min(...trackNotes.map((n) => n.midiNumber)) : 0,
      highestMidi: trackNotes.length ? Math.max(...trackNotes.map((n) => n.midiNumber)) : 0,
      isPercussion: trackNotes.length > 0 && trackNotes.every((n) => n.channel === 9),
    });
  }

  return {
    notes,
    tracks,
    bpm: firstTempo === null ? 120 : Math.round(60000000 / firstTempo),
    timeSignature,
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
