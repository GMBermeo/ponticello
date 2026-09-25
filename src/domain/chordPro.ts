import { interpretSheetChord, validateChordSheet, type ChordSheet, type SheetLine } from './chordSheet';

/** A line is at least one bar of four beats, and whole bars of up to four changes each. */
const BEATS_PER_BAR = 4;

type Directive = { name: string; value: string };

/** `{title: Yesterday}` → `{ name: 'title', value: 'Yesterday' }`; anything else is null. */
export function parseDirective(raw: string): Directive | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  const colon = body.indexOf(':');
  if (colon <= 0) return null;
  const name = body.slice(0, colon);
  if (name.includes('}')) return null;
  return { name: name.toLowerCase(), value: body.slice(colon + 1).trimStart() };
}

type InlineChords = { text: string; changes: SheetLine['changes'] };

/** Strips `[C]`-style chords out of a lyric line, recording the column each one sat over. */
export function extractInlineChords(raw: string): InlineChords {
  let text = '';
  const changes: SheetLine['changes'] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const open = raw.indexOf('[', cursor);
    const close = open < 0 ? -1 : raw.indexOf(']', open + 1);
    if (close < 0) break;
    text += raw.slice(cursor, open);
    const symbol = raw.slice(open + 1, close);
    if (symbol) changes.push({ symbol, column: text.length, beat: 0 });
    else text += '[]';
    cursor = close + 1;
  }
  text += raw.slice(cursor);
  return { text, changes };
}

function isSkippable(raw: string): boolean {
  const trimmed = raw.trim();
  return !trimmed || trimmed.startsWith('#');
}

/** Spreads a line's changes evenly across whole bars, since ChordPro carries no timing. */
function lyricLine(raw: string, index: number): SheetLine {
  const { text, changes } = extractInlineChords(raw);
  const beats = Math.max(BEATS_PER_BAR, Math.ceil(changes.length / BEATS_PER_BAR) * BEATS_PER_BAR);
  changes.forEach((change, i) => { change.beat = i * beats / changes.length; });
  return {
    id: `line-${index + 1}`,
    kind: text.trim() ? 'lyric' : 'instrumental',
    text,
    changes,
    beats,
    columns: Math.max(text.length, ...changes.map((change) => change.column + change.symbol.length)),
  };
}

/** Local/user-supplied text. Inline [chords] avoid fragile whitespace editing. */
export function parseChordPro(input: string, id: string): ChordSheet {
  const metadata: Record<string, string> = {};
  const lines: SheetLine[] = [];
  for (const raw of input.replaceAll(/\r\n?/g, '\n').split('\n')) {
    const directive = parseDirective(raw);
    if (directive) metadata[directive.name] = directive.value;
    else if (!isSkippable(raw)) lines.push(lyricLine(raw, lines.length));
  }
  const bpm = metadata.tempo ? Number(metadata.tempo) : null;
  const sheet: ChordSheet = {
    version: 1, id, title: metadata.title ?? 'Untitled chart', artist: metadata.artist ?? metadata.subtitle ?? 'Unknown artist',
    key: metadata.key ?? null, bpm, bpmSource: bpm === null ? 'unknown' : 'manual', sourceUrl: '',
    instrument: 'chordpro', lyrics: 'included', timing: 'estimated', timingModel: null,
    credits: metadata.composer ? `Composed by: ${metadata.composer}` : (metadata.credits ?? null),
    chords: [...new Set(lines.flatMap((line) => line.changes.map((change) => change.symbol)))].map((symbol) => interpretSheetChord(symbol)),
    lines,
  };
  validateChordSheet(sheet);
  return sheet;
}
