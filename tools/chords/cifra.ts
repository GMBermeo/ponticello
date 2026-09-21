import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { interpretSheetChord, validateChordSheet, type ChordSheet, type SheetLine } from '../../src/domain/chordSheet';

export function keyboardUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || !['www.cifraclub.com.br', 'cifraclub.com.br'].includes(url.hostname)
    || url.username || url.password || url.port || url.pathname.split('/').filter(Boolean).length < 2) throw new Error('Expected an HTTPS Cifra Club song URL');
  url.hostname = 'www.cifraclub.com.br';
  url.hash = '';
  url.searchParams.set('instrument', 'keyboard');
  return url.toString();
}

export function guitarUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || !['www.cifraclub.com.br', 'cifraclub.com.br'].includes(url.hostname)
    || url.username || url.password || url.port || url.pathname.split('/').filter(Boolean).length < 2) throw new Error('Expected an HTTPS Cifra Club song URL');
  url.hostname = 'www.cifraclub.com.br';
  url.hash = '';
  url.searchParams.delete('instrument');
  return url.toString();
}

export function parseUrlList(text: string): string[] {
  return [...new Set(text.replace(/^\uFEFF/, '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map(keyboardUrl))];
}

export function normalizeIdentity(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function matchSongId(title: string, artist: string, rows: readonly { id: string; title: string; composer: string }[], fallback: string): string {
  const matches = rows.filter((r) => normalizeIdentity(r.title) === normalizeIdentity(title) && normalizeIdentity(r.composer) === normalizeIdentity(artist));
  const ids = [...new Set(matches.map((r) => r.id))];
  if (ids.length > 1) throw new Error(`Ambiguous library match for ${artist} / ${title}; provide --ids mapping`);
  return ids[0] ?? fallback;
}

interface RawLine { text: string; changes: { symbol: string; column: number; endColumn: number }[] }

/** Labels are structural, not the lyric following a pending chord row. */
function isSectionLabel(text: string): boolean {
  return /^\s*(?:\[[^\]]+\]|(?:intro(?:dução)?|riff|solo|interl[uú]dio|instrumental|verse|verso|estrofe|chorus|refr[aã]o|pr[eé][ -]refr[aã]o|bridge|ponte|outro|final)(?:\s+\d+)?(?:\s*[:\-])?)\s*$/i.test(text);
}

/** Tablature lines, instrument markers, and tab annotations to ignore. */
function isTabLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 1. Guitar / bass tablature string lines:
  // e.g. "e|----------------", "B|---3------------", "G|---4-4-4---", "|---2--2--x--x---|", "|----"
  if (/^[eEBGDAbC#1-7]?\s*\|[-0-9xX/\\hpbrs~^().|:*+~#\s]+\|?$/i.test(trimmed) && (/[-]{2,}/.test(trimmed) || /\d/.test(trimmed))) return true;
  if (/^\|[-0-9xX/\\hpbrs~^().|:*+~#\s]+\|?$/.test(trimmed) && /[-]{2,}/.test(trimmed)) return true;
  if (/[-]{4,}/.test(trimmed)) return true;
  // 2. Barline only or border pipes: e.g. "| |", "|---|", "|"
  if (/^\|[\s|\-~*#]*\|?$/.test(trimmed)) return true;
  // 3. Tab instrument / track headers: e.g. "Guitarra 1 (S/ Dist.)", "Guitar 2", "Violão", "Baixo", "Teclado"
  if (/^\|?\s*(?:guitar(?:ra)?|viol[aã]o|baixo|bass|teclado|keyboard|guitars?)(?:\s+(?:[1-9]|solo|base|lead|rhythm|ac[uú]stico|dist))?(?:\s*[\(&\-].*)?\|?$/i.test(trimmed)) return true;
  // 4. Tab repeat instructions: e.g. "Repita - 3x", "Repita 2x", "Repitir 2x", "Repeat 2x", "Faça isto 2x", "2x"
  if (/^\s*(?:repita|repitir|repeat)\b.*$/i.test(trimmed)) return true;
  if (/^\s*(?:faça\s+isto|\d+x)\s*$/i.test(trimmed)) return true;
  // 5. Tab credits/signatures or performance directions in tabs
  if (/^\s*\*.*\*\s*$/.test(trimmed)) return true;
  if (/^\s*hold\s*$/i.test(trimmed)) return true;
  return false;
}

export function translateCredits(raw: string): string {
  let text = raw.trim();
  // Strip trailing CifraClub review/report prompts if present
  text = text.replace(/Essa informação está errada.*$/i, '').trim();
  // Translate Portuguese "Composição:" / "Composição de:" -> "Composed by: "
  text = text.replace(/^composi(?:ção|cao)?(?:\s+de)?\s*:\s*/i, 'Composed by: ');
  // Replace Portuguese conjunction " e " between author names with " and "
  text = text.replace(/(\S+)\s+e\s+(\S+)/g, '$1 and $2');
  return text;
}

export function extractCifraCredits($: ReturnType<typeof load>, html?: string): string | null {
  // 1. Text node starting with "Composição:"
  let raw: string | null = null;
  $('p, span, div, li').each((_, el) => {
    if (raw) return;
    const text = $(el).clone().children().remove().end().text().trim();
    if (/^composi(?:ção|cao)?(?:\s+de)?\s*:\s*\S+/i.test(text)) {
      raw = text;
    }
  });

  // 2. Full text scan for "Composição:"
  if (!raw && html) {
    const match = html.match(/composi(?:ção|cao)?(?:\s+de)?\s*:\s*([^<\r\n]+)/i);
    if (match?.[1]) {
      const candidate = match[1].replace(/Essa informação está errada.*$/i, '').trim();
      if (candidate) raw = `Composição: ${candidate}`;
    }
  }

  // 3. Fallback to JSON-LD MusicComposition composer schema
  if (!raw) {
    $('script[type="application/ld+json"]').each((_, el) => {
      if (raw) return;
      try {
        const json = JSON.parse($(el).text());
        const list = Array.isArray(json) ? json : [json];
        for (const item of list) {
          if (item?.['@type'] === 'MusicComposition' && item.composer) {
            const composers = Array.isArray(item.composer) ? item.composer : [item.composer];
            const names = composers.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
            if (names.length) {
              raw = `Composição: ${names.join(', ')}`;
              break;
            }
          }
        }
      } catch {}
    });
  }

  return raw ? translateCredits(raw) : null;
}

export interface ParseCifraOptions {
  allowGuitar?: boolean;
}

/** Traverse text nodes, not HTML offsets; entities, accents and whitespace survive. */
export function parseCifraHtml(html: string, sourceUrl: string, options?: ParseCifraOptions): ChordSheet {
  const $ = load(html);
  const pre = $('pre[data-chord-content], pre.cifra_cnt').first();
  if (!pre.length) throw new Error('No chord sheet found (page layout changed or access denied)');
  const hasKeyboard = Boolean($('[data-instrument="keyboard"], [data-chord-mode="keyboard"]').length);
  if (!hasKeyboard && !options?.allowGuitar) {
    throw new Error('Keyboard version was not confirmed; refusing a silent guitar fallback');
  }
  const instrument: 'keyboard' | 'guitar' = hasKeyboard ? 'keyboard' : 'guitar';
  const url = instrument === 'keyboard' ? keyboardUrl(sourceUrl) : guitarUrl(sourceUrl);
  const raw: RawLine[] = [];
  let current: RawLine = { text: '', changes: [] };
  const flush = () => { raw.push(current); current = { text: '', changes: [] }; };
  const append = (text: string) => {
    for (const char of text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')) {
      if (char === '\n') flush();
      else current.text += char === '\t' ? ' '.repeat(8 - current.text.length % 8) : char;
    }
  };
  const walk = (node: AnyNode) => {
    if (node.type === 'text') {
      // Pretty-printed whitespace BETWEEN block rows is HTML formatting, not
      // an empty lyric line. Whitespace INSIDE each row remains significant.
      const betweenBlocks = !node.data.trim() && node.parent && 'children' in node.parent
        && node.parent.children.some((child) => child.type === 'tag' && child.name === 'div');
      if (!betweenBlocks) append(node.data);
      return;
    }
    if (!('children' in node)) return;
    if (node.type === 'tag' && node.name === 'br') { flush(); return; }
    if (node.type === 'tag' && ['script', 'style'].includes(node.name)) return;
    if (node.type === 'tag' && node.name === 'div' && current.text) flush();
    if (node.type === 'tag' && (node.attribs['data-chord-name'] || node.name === 'b')) {
      const symbol = node.attribs['data-chord-name'] ?? $(node).text();
      if (/^[A-G][#b]?[a-zA-Z0-9+#bº°øΔ()/\-]*$/.test(symbol)) {
        const column = current.text.length;
        append($(node).text());
        current.changes.push({ symbol, column, endColumn: current.text.length });
        return;
      }
    }
    node.children.forEach(walk);
    if (node.type === 'tag' && node.name === 'div' && current.text) flush();
  };
  pre.contents().toArray().forEach(walk);
  if (current.text || current.changes.length) flush();
  const lines: SheetLine[] = [];
  let pending: RawLine | null = null;
  const add = (text: string, changes: RawLine['changes'], kind: SheetLine['kind'], width = 0) => {
    const beats = kind === 'section' ? 0 : Math.max(4, Math.ceil(changes.length / 4) * 4);
    const columns = Math.max(width, text.length, ...changes.map((c) => c.column + c.symbol.length));
    lines.push({ id: `line-${lines.length + 1}`, kind, text, columns, beats,
      changes: changes.map(({ symbol, column }, i) => ({ symbol, column, beat: i * beats / Math.max(1, changes.length) })) });
  };
  const flushPending = () => {
    if (pending) {
      let label = pending.changes.reduceRight((text, change) =>
        text.slice(0, change.column) + ' '.repeat(change.endColumn - change.column) + text.slice(change.endColumn), pending.text);
      label = label.replace(/^\|[\s|\-~*#]*\|?$/, '').trim();
      add(label, pending.changes, 'instrumental', pending.text.length);
      pending = null;
    }
  };
  for (const line of raw) {
    if (line.changes.length) {
      flushPending();
      pending = line;
      // An inline "Intro: D" must not steal the first verse's lyric.
      if (isSectionLabel(line.text.slice(0, line.changes[0]!.column))) flushPending();
      continue;
    }
    if (!line.text.trim()) { flushPending(); continue; }
    if (isSectionLabel(line.text)) { flushPending(); add(line.text.trim(), [], 'section'); continue; }
    if (isTabLine(line.text)) continue;
    if (pending) { add(line.text, pending.changes, 'lyric', pending.text.length); pending = null; }
    else add(line.text, [], 'lyric');
  }
  flushPending();
  const title = $('h1').first().text().trim();
  const artist = $('h1').first().parent().find('h2').first().text().trim()
    || $('h2 a').first().text().trim();
  if (!title || !artist) throw new Error('Missing title/artist; refusing to invent metadata');
  const key = $('#key').text().match(/(?:Tom|Key)\s*:?\s*([A-G][#b♭♯]?(?:m(?!aj))?)/i)?.[1] ?? null;
  const explicitBpm = $('[data-bpm]').first().attr('data-bpm')
    ?? $('meta[itemprop="tempo"]').attr('content')
    ?? $('body').clone().find('script,style,pre').remove().end().text().match(/\b(\d{2,3})\s*BPM\b/i)?.[1];
  const parsedBpm = Number(explicitBpm);
  const bpm = Number.isFinite(parsedBpm) && parsedBpm >= 20 && parsedBpm <= 300 ? parsedBpm : null;
  const credits = extractCifraCredits($, html);
  const symbols = [...new Set(lines.flatMap((l) => l.changes.map((c) => c.symbol)))];
  if (!symbols.length) throw new Error('No chords extracted');
  const chords = symbols.map((symbol) => {
    const diagram = $('[data-chord-mode="keyboard"][data-mount]').filter((_, e) => $(e).find('[data-chord-label]').text().trim() === symbol).first();
    const mount = diagram.attr('data-mount');
    const pcs = mount ? [...new Set(mount.trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0).map((n) => (n - 1) % 12))] : [];
    return interpretSheetChord(symbol, pcs);
  });
  const sheet: ChordSheet = {
    version: 1, id: normalizeIdentity(`${artist}-${title}`), title, artist, key, bpm,
    bpmSource: bpm === null ? 'unknown' : 'page', sourceUrl: url, instrument,
    lyrics: 'included', timing: 'estimated', timingModel: null, credits, chords, lines,
  };
  validateChordSheet(sheet);
  return sheet;
}

/** Ollama may estimate durations, never rewrite lyrics, chord order, key or BPM. */
export function applyTiming(sheet: ChordSheet, value: unknown, model: string): ChordSheet {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { lines?: unknown }).lines)) throw new Error('Invalid Ollama timing response');
  const rows = (value as { lines: { id: string; beats: number; chordBeats: number[] }[] }).lines;
  const expected = sheet.lines.filter((l) => l.kind !== 'section');
  if (rows.length !== expected.length || new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('Ollama changed the line count');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result: ChordSheet = { ...sheet, timingModel: model, lines: sheet.lines.map((line) => {
    if (line.kind === 'section') return line;
    const timing = byId.get(line.id);
    if (!timing || !Array.isArray(timing.chordBeats) || timing.chordBeats.length !== line.changes.length
      || !Number.isFinite(timing.beats) || timing.beats < 1 || timing.beats > 64) throw new Error(`Invalid timing for ${line.id}`);
    return { ...line, beats: timing.beats, changes: line.changes.map((c, i) => ({ ...c, beat: timing.chordBeats[i]! })) };
  }) };
  validateChordSheet(result);
  return result;
}
