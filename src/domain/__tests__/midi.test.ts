import { describe, expect, it } from 'vitest';

import { monophonic, parseMidi } from '../midi';

interface WriteNote { midi: number; startTicks: number; durationTicks: number; track?: number }

interface WriteOptions {
  ticksPerQuarter?: number;
  microsecondsPerQuarter?: number;
  runningStatus?: boolean;
  trackNames?: Record<number, string>;
  programs?: Record<number, number>;
  channels?: Record<number, number>;
  timeSignature?: [number, number] | null;
}

/** MIDI's 7-bits-per-byte variable-length quantity. */
function varInt(value: number): number[] {
  const buffer = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    buffer.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return buffer;
}

const bigEndian32 = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** Tempo, and optionally a time signature, as delta-zero meta events. */
function conductorEvents(microsecondsPerQuarter: number, timeSignature: [number, number] | null): number[] {
  const tempo = [...varInt(0), 0xff, 0x51, 0x03, (microsecondsPerQuarter >> 16) & 0xff, (microsecondsPerQuarter >> 8) & 0xff, microsecondsPerQuarter & 0xff];
  if (!timeSignature) return tempo;
  return [...tempo, ...varInt(0), 0xff, 0x58, 0x04, timeSignature[0], Math.log2(timeSignature[1]), 24, 8];
}

function noteEvents(notes: readonly WriteNote[], channel: number, runningStatus: boolean): number[] {
  const events = notes.flatMap((n) => [
    { tick: n.startTicks, on: true, midi: n.midi },
    { tick: n.startTicks + n.durationTicks, on: false, midi: n.midi },
  ]).sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));

  const out: number[] = [];
  let lastTick = 0;
  let lastStatus = -1;
  for (const event of events) {
    out.push(...varInt(event.tick - lastTick));
    lastTick = event.tick;
    // With running status, note-offs are sent as zero-velocity note-ons.
    const command = runningStatus || event.on ? 0x90 : 0x80;
    const status = command | channel;
    if (!runningStatus || status !== lastStatus) {
      out.push(status);
      lastStatus = status;
    }
    out.push(event.midi, event.on ? 0x64 : 0x00);
  }
  return out;
}

function trackChunk(t: number, notes: readonly WriteNote[], options: Required<WriteOptions>): number[] {
  const track: number[] = t === 0 ? conductorEvents(options.microsecondsPerQuarter, options.timeSignature) : [];
  const name = options.trackNames[t];
  if (name) {
    const text = [...name].map((c) => c.charCodeAt(0));
    track.push(...varInt(0), 0xff, 0x03, ...varInt(text.length), ...text);
  }
  const channel = options.channels[t] ?? 0;
  const program = options.programs[t];
  if (program !== undefined) track.push(...varInt(0), 0xc0 | channel, program);
  track.push(...noteEvents(notes.filter((n) => (n.track ?? 0) === t), channel, options.runningStatus));
  track.push(...varInt(0), 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...bigEndian32(track.length), ...track];
}

/** Minimal SMF writer, so the parser is tested against bytes rather than mocks. */
function writeMidi(notes: WriteNote[], options: WriteOptions = {}): Uint8Array {
  const settings: Required<WriteOptions> = {
    ticksPerQuarter: 480, microsecondsPerQuarter: 500000, runningStatus: false,
    trackNames: {}, programs: {}, channels: {}, timeSignature: null, ...options,
  };
  const trackCount = Math.max(1, ...notes.map((n) => (n.track ?? 0) + 1));
  const { ticksPerQuarter } = settings;
  const bytes: number[] = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, trackCount > 1 ? 1 : 0,
    0, trackCount, (ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff,
  ];
  for (let t = 0; t < trackCount; t++) bytes.push(...trackChunk(t, notes, settings));
  return new Uint8Array(bytes);
}

describe('parseMidi', () => {
  it('reads notes with times in milliseconds', () => {
    // 480 ticks per quarter at 120 bpm — one quarter note is 500 ms.
    const { notes, bpm, durationMs } = parseMidi(writeMidi([
      { midi: 50, startTicks: 0, durationTicks: 480 },
      { midi: 52, startTicks: 480, durationTicks: 480 },
      { midi: 54, startTicks: 960, durationTicks: 240 },
    ]));

    expect(notes.map((n) => n.midiNumber)).toEqual([50, 52, 54]);
    expect(notes.map((n) => n.startTimeMs)).toEqual([0, 500, 1000]);
    expect(notes.map((n) => n.durationMs)).toEqual([500, 500, 250]);
    expect(bpm).toBe(120);
    expect(durationMs).toBe(1250);
  });

  it('honours the tempo meta event', () => {
    // 250000 µs per quarter = 240 bpm, so a quarter note is 250 ms.
    const parsed = parseMidi(writeMidi(
      [{ midi: 57, startTicks: 0, durationTicks: 480 }],
      { microsecondsPerQuarter: 250000 },
    ));
    expect(parsed.notes[0].durationMs).toBe(250);
    expect(parsed.bpm).toBe(240);
  });

  it('reads the time signature', () => {
    const parsed = parseMidi(writeMidi(
      [{ midi: 57, startTicks: 0, durationTicks: 480 }],
      { timeSignature: [6, 8] },
    ));
    expect(parsed.timeSignature).toEqual([6, 8]);
  });

  it('handles running status and zero-velocity note-offs', () => {
    const { notes } = parseMidi(writeMidi([
      { midi: 50, startTicks: 0, durationTicks: 480 },
      { midi: 55, startTicks: 480, durationTicks: 480 },
    ], { runningStatus: true }));

    expect(notes.map((n) => n.midiNumber)).toEqual([50, 55]);
    expect(notes.map((n) => n.durationMs)).toEqual([500, 500]);
  });

  it('summarises each track with its name, instrument and range', () => {
    const parsed = parseMidi(writeMidi(
      [
        { midi: 45, startTicks: 0, durationTicks: 480, track: 0 },
        { midi: 60, startTicks: 0, durationTicks: 480, track: 1 },
        { midi: 72, startTicks: 480, durationTicks: 480, track: 1 },
      ],
      { trackNames: { 0: 'Violoncello', 1: 'Piano' }, programs: { 0: 42, 1: 0 } },
    ));

    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0].name).toBe('Violoncello');
    expect(parsed.tracks[0].program).toBe(42);
    expect(parsed.tracks[0].noteCount).toBe(1);
    expect(parsed.tracks[1].name).toBe('Piano');
    expect(parsed.tracks[1].lowestMidi).toBe(60);
    expect(parsed.tracks[1].highestMidi).toBe(72);
  });

  it('flags a percussion track by its channel', () => {
    const parsed = parseMidi(writeMidi(
      [{ midi: 38, startTicks: 0, durationTicks: 120, track: 0 }],
      { channels: { 0: 9 } },
    ));
    expect(parsed.tracks[0].isPercussion).toBe(true);
  });

  it('rejects a file that is not MIDI', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))
      .toThrow(/not a MIDI file/);
  });

  it('rejects SMPTE timing rather than reporting nonsense times', () => {
    const bytes = writeMidi([{ midi: 60, startTicks: 0, durationTicks: 480 }]);
    bytes[12] = 0xe7; // negative frames-per-second byte sets the SMPTE flag
    expect(() => parseMidi(bytes)).toThrow(/SMPTE/);
  });
});

describe('monophonic', () => {
  const note = (midiNumber: number, startTimeMs: number, durationMs: number) =>
    ({ midiNumber, startTimeMs, durationMs, track: 0, channel: 0, velocity: 100 });

  it('keeps the top note of a chord and drops the rest', () => {
    const line = monophonic([note(50, 0, 500), note(54, 0, 500), note(57, 0, 500)]);
    expect(line).toHaveLength(1);
    expect(line[0].midiNumber).toBe(57);
  });

  it('truncates a held note when a higher one starts under it', () => {
    const line = monophonic([note(50, 0, 1000), note(62, 400, 400)]);
    expect(line).toHaveLength(2);
    expect(line[0].durationMs).toBe(400);
  });

  it('leaves a line that is already monophonic alone', () => {
    expect(monophonic([note(50, 0, 500), note(51, 500, 500), note(52, 1000, 500)]))
      .toHaveLength(3);
  });
});
