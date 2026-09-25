import { chroma } from '@tonaljs/note';
import { getCelloChord } from './celloChords';
import type { CelloChordStudy } from './chords';

export interface SheetChord {
  symbol: string;
  canonical: string | null;
  keyboardPitchClasses: number[];
  interpretation: string | null;
}
export interface SheetChange { symbol: string; column: number; beat: number }
export interface SheetLine {
  id: string;
  kind: 'lyric' | 'instrumental' | 'section';
  text: string;
  columns: number;
  changes: SheetChange[];
  beats: number;
}
export interface ChordSheet {
  version: 1;
  id: string;
  title: string;
  artist: string;
  key: string | null;
  bpm: number | null;
  bpmSource: 'page' | 'manual' | 'unknown';
  sourceUrl: string;
  spotifyUrl?: string | null;
  instrument: 'keyboard' | 'guitar' | 'chordpro';
  lyrics: 'included' | 'omitted';
  timing: 'estimated';
  timingModel: string | null;
  credits?: string | null;
  chords: SheetChord[];
  lines: SheetLine[];
}

/** Cifra's spelling is retained for display, a separate canonical name drives cello. */
export function interpretSheetChord(symbol: string, keyboardPitchClasses: number[] = []): SheetChord {
  let canonical = symbol.replace(/7M/g, 'maj7').replace(/º/g, 'dim').replace(/°/g, 'dim');
  canonical = canonical.replace(/^([A-G][b#]?)4(?=\/|$)/, '$1sus4');
  const ninth = /^([A-G][b#]?)9(\/[A-G][b#]?)?$/.exec(canonical);
  if (ninth?.[1] && keyboardPitchClasses.length) {
    const tonic = chroma(ninth[1])!;
    if (keyboardPitchClasses.includes((tonic + 2) % 12)
      && !keyboardPitchClasses.includes((tonic + 10) % 12) && !keyboardPitchClasses.includes((tonic + 11) % 12)) {
      canonical = `${ninth[1]}add9${ninth[2] ?? ''}`;
    }
  }
  const fifth = /^([A-G][b#]?)5(\/[A-G][b#]?)$/.exec(canonical);
  if (fifth?.[1] && keyboardPitchClasses.includes((chroma(fifth[1])! + 4) % 12)) canonical = `${fifth[1]}${fifth[2]}`;
  try {
    const study = getCelloChord(canonical);
    const allowed = study.tones.map((t) => t.pitchClass);
    if (study.requestedBass) allowed.push(chroma(study.requestedBass)!);
    if (keyboardPitchClasses.some((n) => !allowed.includes(n))) throw new Error('Keyboard diagram disagrees with chord name');
    return { symbol, canonical, keyboardPitchClasses, interpretation: canonical === symbol ? null : `Keyboard interpretation: ${canonical}` };
  } catch {
    return { symbol, canonical: null, keyboardPitchClasses, interpretation: 'No verified cello diagram for this symbol. Source chord retained.' };
  }
}

export function sheetChordStudy(chord: SheetChord): CelloChordStudy | null {
  if (!chord.canonical) return null;
  try { return getCelloChord(chord.canonical); } catch { return null; }
}

export interface SheetEvent { lineIndex: number; changeIndex: number; symbol: string; beat: number }
export interface SheetTimeline { events: SheetEvent[]; starts: number[]; totalBeats: number }
export function sheetTimeline(sheet: ChordSheet): SheetTimeline {
  let beat = 0;
  const events: SheetEvent[] = [];
  const starts: number[] = [];
  sheet.lines.forEach((line, lineIndex) => {
    starts.push(beat);
    line.changes.forEach((change, changeIndex) => events.push({ lineIndex, changeIndex, symbol: change.symbol, beat: beat + change.beat }));
    beat += line.beats;
  });
  return { events, starts, totalBeats: beat };
}

export function eventAtBeat(events: readonly SheetEvent[], beat: number): number {
  let low = 0, high = events.length - 1, found = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid]!.beat <= beat) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

export function beatAtTime(anchorBeat: number, anchorMs: number, nowMs: number, bpm: number, speed: number): number {
  return anchorBeat + Math.max(0, nowMs - anchorMs) * bpm * speed / 60000;
}

/** Musical-time scroll through measured rows; changing font/viewport needs new offsets. */
export function sheetScrollY(beat: number, starts: readonly number[], offsets: readonly number[], endY: number, totalBeats: number): number {
  let row = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i]! <= beat) row = i;
  const from = offsets[row] ?? 0;
  const to = offsets[row + 1] ?? endY;
  const begin = starts[row] ?? 0;
  const end = starts[row + 1] ?? totalBeats;
  const progress = Math.max(0, Math.min(1, (beat - begin) / Math.max(0.001, end - begin)));
  return from + (to - from) * progress;
}

/** Preserve chord anchors while making space for long names and 44px touch targets. */
export function sheetLineSegments(line: SheetLine): { lyric: string; chord: SheetChange | null; changeIndex: number }[] {
  if (!line.changes.length) return [{ lyric: line.text, chord: null, changeIndex: -1 }];
  // A source chord can sit after the final lyric character. Preserve that
  // silent horizontal gap for display without altering the imported text.
  const text = line.text.padEnd(line.changes[line.changes.length - 1]!.column);
  const parts: { lyric: string; chord: SheetChange | null; changeIndex: number }[] = [];
  const first = line.changes[0]!;
  if (first.column > 0) parts.push({ lyric: text.slice(0, first.column), chord: null, changeIndex: -1 });
  line.changes.forEach((change, i) => parts.push({
    lyric: text.slice(change.column, line.changes[i + 1]?.column ?? text.length), chord: change, changeIndex: i,
  }));
  return parts;
}

const SHEET_ID = /^[a-z0-9][a-z0-9-]*$/;
const LYRIC_MODES = new Set(['included', 'omitted']);
const SOURCE_INSTRUMENTS = new Set(['keyboard', 'guitar', 'chordpro']);
const MIN_SHEET_BPM = 20;
const MAX_SHEET_BPM = 300;
const MAX_LINE_BEATS = 128;

function isPitchClass(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 11;
}

function hasValidMetadata(sheet: ChordSheet): boolean {
  return sheet.version === 1 && typeof sheet.id === 'string' && SHEET_ID.test(sheet.id)
    && !!sheet.title && !!sheet.artist && Array.isArray(sheet.lines) && Array.isArray(sheet.chords)
    && LYRIC_MODES.has(sheet.lyrics) && SOURCE_INSTRUMENTS.has(sheet.instrument) && sheet.timing === 'estimated';
}

function hasValidBpm(bpm: number | null): boolean {
  return bpm === null || (Number.isFinite(bpm) && bpm >= MIN_SHEET_BPM && bpm <= MAX_SHEET_BPM);
}

function validateChordDictionary(chords: ChordSheet['chords'], lineCount: number): Set<string> {
  const symbols = new Set(chords.map((chord) => chord.symbol));
  if (symbols.size !== chords.length || !symbols.size || !lineCount) throw new Error('Empty or duplicate chord dictionary');
  for (const chord of chords) {
    const validPitches = Array.isArray(chord.keyboardPitchClasses) && chord.keyboardPitchClasses.every(isPitchClass);
    if (typeof chord.symbol !== 'string' || !validPitches) throw new Error('Invalid chord definition');
    // Throws when the canonical name is not a chord the cello catalogue can build.
    if (chord.canonical !== null) getCelloChord(chord.canonical);
  }
  return symbols;
}

function hasValidLineShape(line: SheetLine, seenIds: ReadonlySet<string>): boolean {
  const beatsInRange = Number.isFinite(line.beats) && line.beats >= 0 && line.beats <= MAX_LINE_BEATS;
  return !!line.id && !seenIds.has(line.id) && typeof line.text === 'string' && Array.isArray(line.changes)
    && Number.isInteger(line.columns) && line.columns >= line.text.length
    && beatsInRange && !(line.changes.length > 0 && line.beats <= 0);
}

/** Changes must name a known chord, sit inside the line, and move strictly forward in time. */
function validateAnchors(line: SheetLine, symbols: ReadonlySet<string>): void {
  let lastColumn = -1;
  let lastBeat = -1;
  for (const change of line.changes) {
    const columnOk = Number.isInteger(change.column) && change.column >= Math.max(0, lastColumn) && change.column <= line.columns;
    const beatOk = Number.isFinite(change.beat) && change.beat >= 0 && change.beat > lastBeat && change.beat < line.beats;
    if (!symbols.has(change.symbol) || !columnOk || !beatOk) {
      throw new Error(`Invalid chord anchor: ${line.id} ${change.symbol}, column ${change.column}, beat ${change.beat}/${line.beats}`);
    }
    lastColumn = change.column;
    lastBeat = change.beat;
  }
}

export function validateChordSheet(value: unknown): asserts value is ChordSheet {
  if (!value || typeof value !== 'object') throw new Error('Invalid chord sheet');
  const sheet = value as ChordSheet;
  if (!hasValidMetadata(sheet)) throw new Error('Invalid chord sheet metadata');
  if (sheet.credits !== undefined && sheet.credits !== null && typeof sheet.credits !== 'string') throw new Error('Invalid chord sheet credits');
  if (!hasValidBpm(sheet.bpm)) throw new Error('Invalid BPM');
  const symbols = validateChordDictionary(sheet.chords, sheet.lines.length);
  const ids = new Set<string>();
  for (const line of sheet.lines) {
    if (!hasValidLineShape(line, ids)) throw new Error('Invalid chord line');
    ids.add(line.id);
    validateAnchors(line, symbols);
  }
}
