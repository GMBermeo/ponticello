import { interpretSheetChord, validateChordSheet, type ChordSheet, type SheetLine } from './chordSheet';

/** Local/user-supplied text. Inline [chords] avoid fragile whitespace editing. */
export function parseChordPro(input: string, id: string): ChordSheet {
  const metadata: Record<string, string> = {};
  const lines: SheetLine[] = [];
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const directive = /^\s*\{([^:}]+):\s*(.*?)\}\s*$/.exec(raw);
    if (directive) { metadata[directive[1]!.toLowerCase()] = directive[2]!; continue; }
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    let text = '', previous = 0;
    const changes: SheetLine['changes'] = [];
    for (const match of raw.matchAll(/\[([^\]]+)\]/g)) {
      text += raw.slice(previous, match.index);
      changes.push({ symbol: match[1]!, column: text.length, beat: 0 });
      previous = match.index! + match[0].length;
    }
    text += raw.slice(previous);
    const beats = Math.max(4, Math.ceil(changes.length / 4) * 4);
    changes.forEach((c, i) => { c.beat = i * beats / changes.length; });
    lines.push({ id: `line-${lines.length + 1}`, kind: text.trim() ? 'lyric' : 'instrumental', text, changes, beats,
      columns: Math.max(text.length, ...changes.map((c) => c.column + c.symbol.length)) });
  }
  const bpm = metadata.tempo ? Number(metadata.tempo) : null;
  const sheet: ChordSheet = {
    version: 1, id, title: metadata.title ?? 'Untitled chart', artist: metadata.artist ?? metadata.subtitle ?? 'Unknown artist',
    key: metadata.key ?? null, bpm, bpmSource: bpm === null ? 'unknown' : 'manual', sourceUrl: '',
    instrument: 'chordpro', lyrics: 'included', timing: 'estimated', timingModel: null,
    credits: metadata.composer ? `Composed by: ${metadata.composer}` : (metadata.credits ?? null),
    chords: [...new Set(lines.flatMap((l) => l.changes.map((c) => c.symbol)))].map((s) => interpretSheetChord(s)), lines,
  };
  validateChordSheet(sheet);
  return sheet;
}
