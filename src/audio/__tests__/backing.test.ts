import { describe, expect, it } from 'vitest';

import {
  arrangementBackingParts, backingFromMidi, generateAccompaniment, inferChord, instrumentForProgram, isMinorKey,
  soloPartFromScore, tonicPitchClass, trackDurationMs,
} from '@/domain/backing';
import { MidiTrack } from '@/domain/midi';
import { fadeEdges, limit, mixBuffers, renderParts } from '../synth';
import { encodeWav } from '../wav';
import { fromBase64, toBase64 } from '@/domain/base64';
import { BWV1007_PRELUDE } from '@/scores/bach';
import { D_MAJOR_TWO_STRINGS, OPEN_STRINGS } from '@/scores/studies';

const SR = 22050;

describe('key reading', () => {
  it.each([
    ['G MAJOR', 7, false],
    ['D MINOR', 2, true],
    ['C MAJOR', 0, false],
    ['Bb MAJOR', 10, false],
    ['F# MINOR', 6, true],
  ])('reads %s', (key, pitchClass, minor) => {
    expect(tonicPitchClass(key)).toBe(pitchClass);
    expect(isMinorKey(key)).toBe(minor);
  });
});

describe('inferChord', () => {
  it('finds G major in the first bar of the Bach', () => {
    const bar = BWV1007_PRELUDE.measures[0];
    const chord = inferChord(BWV1007_PRELUDE, bar.startBarTimeMs, bar.startBarTimeMs + bar.durationMs, 7, false);
    expect(chord.root).toBe(7);   // G
    expect(chord.minor).toBe(false);
    // Not 1.0: the bar has a passing A in it, which is not a chord tone.
    expect(chord.confidence).toBeGreaterThan(0.8);
    expect(chord.confidence).toBeLessThan(1);
  });

  it('falls back when the window is silent', () => {
    const chord = inferChord(BWV1007_PRELUDE, 1e9, 1e9 + 100, 2, true);
    expect(chord.root).toBe(2);
    expect(chord.minor).toBe(true);
    expect(chord.confidence).toBe(0);
  });

  it('spells a minor triad with a flat third', () => {
    const chord = inferChord(BWV1007_PRELUDE, 1e9, 1e9 + 100, 0, true);
    expect(chord.tones).toEqual([0, 3, 7]);
  });
});

describe('generateAccompaniment', () => {
  it('makes nothing for style none', () => {
    expect(generateAccompaniment(BWV1007_PRELUDE, { style: 'none' })).toEqual([]);
  });

  it('drones on the tonic and its fifth, and nothing else', () => {
    const [drone] = generateAccompaniment(BWV1007_PRELUDE, { style: 'drone' });
    expect(drone.notes).toHaveLength(2);
    const [root, fifth] = drone.notes.map((n) => n.midiNumber);
    expect(root % 12).toBe(7);            // G
    expect(fifth - root).toBe(7);         // a fifth above
    // No third: a drone must not decide whether the key is major or minor.
    expect(drone.notes.some((n) => (n.midiNumber - root) % 12 === 4)).toBe(false);
  });

  it('holds the drone across the whole requested span', () => {
    const [drone] = generateAccompaniment(BWV1007_PRELUDE, { style: 'drone', fromBar: 1, toBar: 2 });
    const expected = BWV1007_PRELUDE.measures[0].durationMs + BWV1007_PRELUDE.measures[1].durationMs;
    expect(drone.notes[0].durationMs).toBeCloseTo(expected, 0);
  });

  it('puts one triad under each bar in chord style', () => {
    const [chords] = generateAccompaniment(BWV1007_PRELUDE, { style: 'chords' });
    expect(chords.notes).toHaveLength(BWV1007_PRELUDE.measures.length * 3);
    expect(chords.role).toBe('accompaniment');
  });

  it('re-strikes on every beat in pulse style', () => {
    const [pulse] = generateAccompaniment(BWV1007_PRELUDE, { style: 'pulse', fromBar: 1, toBar: 1 });
    // 4/4, three voices per beat.
    expect(pulse.notes).toHaveLength(4 * 3);
    expect(pulse.notes[0].velocity).toBeGreaterThan(pulse.notes[3].velocity);
  });

  it('starts the accompaniment at zero even when the loop starts later', () => {
    const [chords] = generateAccompaniment(BWV1007_PRELUDE, { style: 'chords', fromBar: 3, toBar: 4 });
    expect(Math.min(...chords.notes.map((n) => n.startTimeMs))).toBe(0);
  });

  it('respects a loop that is a single bar', () => {
    const [chords] = generateAccompaniment(BWV1007_PRELUDE, { style: 'chords', fromBar: 2, toBar: 2 });
    expect(chords.notes).toHaveLength(3);
  });
});

describe('soloPartFromScore', () => {
  it('mirrors the written notes on a cello voice', () => {
    const part = soloPartFromScore(D_MAJOR_TWO_STRINGS);
    expect(part.role).toBe('solo');
    expect(part.instrument).toBe('cello');
    expect(part.notes).toHaveLength(D_MAJOR_TWO_STRINGS.notes.length);
    expect(part.notes[0].midiNumber).toBe(D_MAJOR_TWO_STRINGS.notes[0].midiNumber);
  });

  it('shortens each note so repeated pitches still articulate', () => {
    const part = soloPartFromScore(D_MAJOR_TWO_STRINGS);
    const written = D_MAJOR_TWO_STRINGS.notes[0].durationMs;
    expect(part.notes[0].durationMs).toBeLessThan(written);
  });
});

describe('importing MIDI', () => {
  const track = (over: Partial<MidiTrack>): MidiTrack => ({
    index: 0, name: null, program: null, channels: [0], noteCount: 40,
    lowestMidi: 40, highestMidi: 70, isPercussion: false, ...over,
  });

  it('maps General MIDI programs onto native/web synthesized instrument families', () => {
    expect(instrumentForProgram(0, false)).toBe('piano');
    expect(instrumentForProgram(12, false)).toBe('mallet');
    expect(instrumentForProgram(19, false)).toBe('organ');
    expect(instrumentForProgram(29, false)).toBe('guitar');
    expect(instrumentForProgram(42, false)).toBe('cello');
    expect(instrumentForProgram(33, false)).toBe('bass');
    expect(instrumentForProgram(48, false)).toBe('strings');
    expect(instrumentForProgram(57, false)).toBe('brass');
    expect(instrumentForProgram(65, false)).toBe('reed');
    expect(instrumentForProgram(82, false)).toBe('synth');
    expect(instrumentForProgram(null, true)).toBe('percussion');
  });

  it('splits a file into a solo part and accompaniment', () => {
    const parsed = {
      bpm: 96,
      durationMs: 2000,
      tracks: [track({ index: 0, name: 'Cello' }), track({ index: 1, name: 'Piano', program: 0 })],
      notes: [
        { midiNumber: 50, startTimeMs: 0, durationMs: 500, track: 0, channel: 0, velocity: 100 },
        { midiNumber: 60, startTimeMs: 0, durationMs: 500, track: 1, channel: 0, velocity: 80 },
      ],
    };
    const backing = backingFromMidi('x', parsed, { name: 'Test', soloTrack: 0 });

    expect(backing.parts.map((p) => p.role)).toEqual(['solo', 'accompaniment']);
    expect(backing.parts[0].instrument).toBe('cello');
    expect(backing.parts[1].instrument).toBe('piano');
    expect(backing.parts[1].notes[0].velocity).toBeCloseTo(80 / 127, 3);
  });

  it('rebases accompaniment to the adapted solo origin and mirrors that solo exactly', () => {
    const parsed = {
      bpm: 120,
      durationMs: 3000,
      tracks: [track({ index: 0, name: 'Lead' }), track({ index: 1, name: 'Piano', program: 0 })],
      notes: [
        { midiNumber: 84, startTimeMs: 1000, durationMs: 400, track: 0, channel: 0, velocity: 100 },
        { midiNumber: 48, startTimeMs: 1000, durationMs: 500, track: 1, channel: 0, velocity: 80 },
        { midiNumber: 50, startTimeMs: 1500, durationMs: 500, track: 1, channel: 0, velocity: 80 },
      ],
    };
    const adaptedSolo = [
      { midiNumber: 60, startTimeMs: 0, durationMs: 360, velocity: 0.8 },
    ];
    const backing = backingFromMidi('x', parsed, {
      name: 'Test', soloTrack: 0, originMs: 1000, soloNotes: adaptedSolo,
    });
    const solo = backing.parts.find((part) => part.role === 'solo');
    const accompaniment = backing.parts.find((part) => part.role === 'accompaniment');

    expect(solo?.notes).toEqual(adaptedSolo);
    expect(accompaniment?.notes[0].startTimeMs).toBe(0);
    expect(backing.durationMs).toBe(2000);
  });

  it('treats every track as accompaniment when no solo is chosen', () => {
    const parsed = {
      bpm: 120, durationMs: 500,
      tracks: [track({ index: 0 })],
      notes: [{ midiNumber: 50, startTimeMs: 0, durationMs: 500, track: 0, channel: 0, velocity: 100 }],
    };
    const backing = backingFromMidi('x', parsed, { name: 'Test', soloTrack: null });
    expect(backing.parts.every((p) => p.role === 'accompaniment')).toBe(true);
  });
});

describe('rendering', () => {
  it('produces audible signal for a drone', () => {
    const parts = generateAccompaniment(OPEN_STRINGS, { style: 'drone', fromBar: 1, toBar: 1 });
    const buffer = renderParts(parts, { sampleRate: SR, durationMs: 1000 });

    expect(buffer.length).toBe(SR);
    const peak = buffer.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(1.5);
  });

  it('starts quiet and rises — the attack is not a click', () => {
    const parts = generateAccompaniment(OPEN_STRINGS, { style: 'drone', fromBar: 1, toBar: 1 });
    const buffer = renderParts(parts, { sampleRate: SR, durationMs: 1000 });
    expect(Math.abs(buffer[0])).toBeLessThan(0.02);
  });

  it('stretches the accompaniment when the tempo is reduced', () => {
    const parts = generateAccompaniment(BWV1007_PRELUDE, { style: 'pulse', fromBar: 1, toBar: 1 });
    const lastSound = (tempoScale: number) => {
      const buffer = renderParts(parts, { sampleRate: SR, durationMs: 12000, tempoScale });
      for (let i = buffer.length - 1; i >= 0; i--) if (Math.abs(buffer[i]) > 1e-4) return i;
      return -1;
    };
    // Half tempo means the bar takes twice as long, so the last audible sample
    // arrives about twice as late.
    const full = lastSound(1);
    const slow = lastSound(0.5);
    expect(slow).toBeGreaterThan(full * 1.7);
  });

  it('renders nothing for a muted part', () => {
    const parts = generateAccompaniment(OPEN_STRINGS, { style: 'drone' })
      .map((p) => ({ ...p, muted: true }));
    const buffer = renderParts(parts, { sampleRate: SR, durationMs: 500 });
    expect(buffer.every((x) => x === 0)).toBe(true);
  });

  it('mixes buffers of different lengths', () => {
    const a = Float32Array.from([1, 1, 1]);
    const b = Float32Array.from([1, 1]);
    expect(Array.from(mixBuffers(a, b))).toEqual([2, 2, 1]);
  });

  it('limits peaks without changing quiet passages', () => {
    const buffer = Float32Array.from([0.1, -0.2, 3.0, -4.0]);
    const limited = limit(Float32Array.from(buffer));
    expect(limited[0]).toBeCloseTo(0.1, 6);
    expect(limited[1]).toBeCloseTo(-0.2, 6);
    expect(Math.abs(limited[2])).toBeLessThan(0.9);
    expect(Math.abs(limited[3])).toBeLessThan(0.9);
  });

  it('fades both edges so a loop does not click', () => {
    const buffer = new Float32Array(1000).fill(1);
    fadeEdges(buffer, SR, 10);
    expect(buffer[0]).toBe(0);
    expect(buffer[buffer.length - 1]).toBe(0);
    expect(buffer[500]).toBe(1);
  });
});

describe('wav encoding', () => {
  it('writes a valid RIFF/WAVE header', () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -0.5]), 44100);
    const text = (from: number, length: number) =>
      String.fromCharCode(...Array.from(wav.slice(from, from + length)));

    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(36, 4)).toBe('data');
    expect(wav.length).toBe(44 + 3 * 2);

    const view = new DataView(wav.buffer);
    expect(view.getUint16(22, true)).toBe(1);       // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);      // bit depth
  });

  it('clamps rather than wrapping when a sample is over full scale', () => {
    const wav = encodeWav(Float32Array.from([2, -2]), 8000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });

  it('base64-encodes with correct padding', () => {
    expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(toBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(toBase64(new Uint8Array([77]))).toBe('TQ==');
    expect(toBase64(new Uint8Array([]))).toBe('');
  });

  it('round-trips arbitrary bytes through base64', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 1024]) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) & 255;
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('survives whitespace and data-URI noise when decoding', () => {
    expect(Array.from(fromBase64('TW\nFu'))).toEqual([77, 97, 110]);
  });
});

describe('trackDurationMs', () => {
  it('measures to the end of the last note', () => {
    const parts = generateAccompaniment(BWV1007_PRELUDE, { style: 'chords', fromBar: 1, toBar: 2 });
    const expected = BWV1007_PRELUDE.measures[0].durationMs + BWV1007_PRELUDE.measures[1].durationMs;
    expect(trackDurationMs(parts)).toBeGreaterThan(expected * 0.9);
  });
});


describe('backing while the cello accompanies', () => {
  it('keeps the lead audible for bass/drone levels and excludes it for melody levels', () => {
    const lead = soloPartFromScore(D_MAJOR_TWO_STRINGS);
    const accompaniment = { ...lead, id: 'bass', role: 'accompaniment' as const };
    const backing = { id: 'test', name: 'Test', source: 'imported' as const,
      bpm: 60, durationMs: 4000, parts: [lead, accompaniment] };
    for (const arrangementRole of ['roots', 'bass'] as const) {
      const score = { ...D_MAJOR_TWO_STRINGS, metadata: { ...D_MAJOR_TWO_STRINGS.metadata, arrangementRole } };
      expect(arrangementBackingParts(backing, score)).toEqual([lead, accompaniment]);
    }
    expect(arrangementBackingParts(backing, D_MAJOR_TWO_STRINGS)).toEqual([accompaniment]);
  });
});
