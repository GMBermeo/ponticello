import type { ChordSheet } from '@domain';
import { applyTiming } from './cifra';

/** Positive durations are easier for small models than consistent start/end math. */
export function applyDurationTiming(sheet: ChordSheet, value: unknown, model: string): ChordSheet {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { lines?: unknown }).lines)) throw new Error('Missing duration estimates');
  const input = (value as { lines: { id: string; durations: number[]; restBeats: number }[] }).lines;
  const lines = input.map((line) => {
    if (!Array.isArray(line.durations) || line.durations.some((d) => !Number.isFinite(d) || d < 0.25 || d > 16)
      || !Number.isFinite(line.restBeats) || line.restBeats < 0 || line.restBeats > 16) throw new Error('Invalid model duration');
    let beats = 0;
    const chordBeats = line.durations.map((duration) => { const start = beats; beats += duration; return start; });
    return { id: line.id, beats: beats + line.restBeats, chordBeats };
  });
  return applyTiming(sheet, { lines }, model);
}
