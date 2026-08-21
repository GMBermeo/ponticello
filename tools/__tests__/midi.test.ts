import { describe, expect, it } from 'vitest';

import { monophonic, parseMidi } from '../midi';

/** Minimal SMF writer, so the parser is tested against bytes rather than mocks. */
function writeMidi(
  notes: { midi: number; startTicks: number; durationTicks: number }[],
  { ticksPerQuarter = 480, microsecondsPerQuarter = 500000, runningStatus = false } = {},
): Uint8Array {
  const bytes: number[] = [];
  const push = (...v: number[]) => bytes.push(...v);
  const varInt = (value: number) => {
    const buffer = [value & 0x7f];
    let v = value >> 7;
    while (v > 0) { buffer.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return buffer;
  };

  // Header
  push(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1);
  push((ticksPerQuarter >> 8) & 0xff, ticksPerQuarter & 0xff);

  const track: number[] = [];
  track.push(...varInt(0), 0xff, 0x51, 0x03,
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff);

  const events = notes
    .flatMap((n) => [
      { tick: n.startTicks, on: true, midi: n.midi },
      { tick: n.startTicks + n.durationTicks, on: false, midi: n.midi },
    ])
    .sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));

  let lastTick = 0;
  let lastStatus = -1;
  for (const event of events) {
    track.push(...varInt(event.tick - lastTick));
    lastTick = event.tick;
    // Note-off written as note-on with zero velocity when exercising running status.
    const status = runningStatus ? 0x90 : (event.on ? 0x90 : 0x80);
    if (!runningStatus || status !== lastStatus) { track.push(status); lastStatus = status; }
    track.push(event.midi, event.on ? 0x64 : 0x00);
  }
  track.push(...varInt(0), 0xff, 0x2f, 0x00);

  push(0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff);
  push(...track);

  return new Uint8Array(bytes);
}

describe('parseMidi', () => {
  it('reads notes with times in milliseconds', () => {
    // 480 ticks per quarter at 120 bpm — one quarter note is 500 ms.
    const file = writeMidi([
      { midi: 50, startTicks: 0, durationTicks: 480 },
      { midi: 52, startTicks: 480, durationTicks: 480 },
      { midi: 54, startTicks: 960, durationTicks: 240 },
    ]);

    const notes = parseMidi(file);

    expect(notes).toHaveLength(3);
    expect(notes.map((n) => n.midiNumber)).toEqual([50, 52, 54]);
    expect(notes.map((n) => n.startTimeMs)).toEqual([0, 500, 1000]);
    expect(notes.map((n) => n.durationMs)).toEqual([500, 500, 250]);
  });

  it('honours the tempo meta event', () => {
    // 250000 µs per quarter = 240 bpm, so a quarter note is 250 ms.
    const file = writeMidi(
      [{ midi: 57, startTicks: 0, durationTicks: 480 }],
      { microsecondsPerQuarter: 250000 },
    );
    expect(parseMidi(file)[0].durationMs).toBe(250);
  });

  it('handles running status and zero-velocity note-offs', () => {
    const file = writeMidi([
      { midi: 50, startTicks: 0, durationTicks: 480 },
      { midi: 55, startTicks: 480, durationTicks: 480 },
    ], { runningStatus: true });

    const notes = parseMidi(file);
    expect(notes.map((n) => n.midiNumber)).toEqual([50, 55]);
    expect(notes.map((n) => n.durationMs)).toEqual([500, 500]);
  });

  it('rejects a file that is not MIDI', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))
      .toThrow(/not a MIDI file/);
  });
});

describe('monophonic', () => {
  it('keeps the top note of a chord and drops the rest', () => {
    const chord = [50, 54, 57].map((midiNumber) => ({
      midiNumber, startTimeMs: 0, durationMs: 500, track: 0, channel: 0, velocity: 100,
    }));
    const line = monophonic(chord);
    expect(line).toHaveLength(1);
    expect(line[0].midiNumber).toBe(57);
  });

  it('truncates a held note when a higher one starts under it', () => {
    const line = monophonic([
      { midiNumber: 50, startTimeMs: 0, durationMs: 1000, track: 0, channel: 0, velocity: 100 },
      { midiNumber: 62, startTimeMs: 400, durationMs: 400, track: 0, channel: 0, velocity: 100 },
    ]);
    expect(line).toHaveLength(2);
    expect(line[0].durationMs).toBe(400);
  });

  it('leaves a line that is already monophonic alone', () => {
    const notes = [0, 1, 2].map((i) => ({
      midiNumber: 50 + i, startTimeMs: i * 500, durationMs: 500,
      track: 0, channel: 0, velocity: 100,
    }));
    expect(monophonic(notes)).toHaveLength(3);
  });
});
