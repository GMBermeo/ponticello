/**
 * Minimal Standard MIDI File reader.
 *
 * Written here rather than pulled in as a dependency: the converter needs
 * exactly one thing from a MIDI file — note-on/note-off pairs with times in
 * milliseconds — and a self-contained ~150 lines is easier to audit than a
 * package, and keeps the app's dependency tree free of build-only code.
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

interface Reader {
  data: Uint8Array;
  offset: number;
}

const u8 = (r: Reader) => r.data[r.offset++];
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

interface RawEvent {
  tick: number;
  track: number;
  type: 'noteOn' | 'noteOff' | 'tempo';
  channel: number;
  note: number;
  velocity: number;
  microsecondsPerQuarter: number;
}

export function parseMidi(bytes: Uint8Array): MidiNote[] {
  const r: Reader = { data: bytes, offset: 0 };

  if (readChunkId(r) !== 'MThd') throw new Error('not a MIDI file: missing MThd header');
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

  for (let track = 0; track < trackCount; track++) {
    if (r.offset >= bytes.length) break;
    if (readChunkId(r) !== 'MTrk') throw new Error(`expected MTrk at byte ${r.offset - 4}`);
    const length = u32(r);
    const end = r.offset + length;

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
        if (metaType === 0x51 && metaLength === 3) {
          const microsecondsPerQuarter = (u8(r) << 16) | (u8(r) << 8) | u8(r);
          events.push({
            tick, track, type: 'tempo', channel: 0, note: 0, velocity: 0, microsecondsPerQuarter,
          });
        } else {
          r.offset += metaLength;
        }
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
          events.push({
            tick, track, channel, note, velocity,
            // A note-on with zero velocity is a note-off. Very common.
            type: velocity === 0 ? 'noteOff' : 'noteOn',
            microsecondsPerQuarter: 0,
          });
          break;
        }
        case 0x80: {
          const note = u8(r);
          const velocity = u8(r);
          events.push({
            tick, track, channel, note, velocity, type: 'noteOff', microsecondsPerQuarter: 0,
          });
          break;
        }
        case 0xa0: case 0xb0: case 0xe0:
          r.offset += 2;
          break;
        case 0xc0: case 0xd0:
          r.offset += 1;
          break;
        default:
          throw new Error(`unhandled MIDI status 0x${status.toString(16)} at byte ${r.offset}`);
      }
    }

    r.offset = end;
  }

  return toNotes(events, ticksPerQuarter);
}

/** Converts tick-stamped events into millisecond-stamped notes. */
function toNotes(events: RawEvent[], ticksPerQuarter: number): MidiNote[] {
  events.sort((a, b) => (a.tick - b.tick) || (a.type === 'tempo' ? -1 : 1));

  const notes: MidiNote[] = [];
  const open = new Map<string, { startMs: number; velocity: number }>();

  let microsecondsPerQuarter = 500000; // 120 bpm, the MIDI default
  let lastTick = 0;
  let elapsedMs = 0;

  for (const event of events) {
    elapsedMs += ((event.tick - lastTick) / ticksPerQuarter) * (microsecondsPerQuarter / 1000);
    lastTick = event.tick;

    if (event.type === 'tempo') {
      microsecondsPerQuarter = event.microsecondsPerQuarter;
      continue;
    }

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

  return notes.sort((a, b) => a.startTimeMs - b.startTimeMs);
}

/**
 * Reduces overlapping notes to a single line.
 *
 * A cello part exported from notation software often carries chords or a
 * second voice. This app plays one note at a time, so overlaps are resolved by
 * keeping the highest sounding pitch — which is the melody far more often than
 * not — and truncating whatever it displaces.
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
