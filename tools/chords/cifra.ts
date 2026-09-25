import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { interpretSheetChord, validateChordSheet, type ChordSheet, type SheetLine } from '@domain';

const CIFRA_HOSTS = new Set(['www.cifraclub.com.br', 'cifraclub.com.br']);

/** A normalised Cifra Club song URL: HTTPS, the canonical host, no credentials, port or fragment. */
function cifraSongUrl(input: string): URL {
  const url = new URL(input.trim());
  const songPath = url.pathname.split('/').filter(Boolean).length >= 2;
  const plain = !url.username && !url.password && !url.port;
  if (url.protocol !== 'https:' || !CIFRA_HOSTS.has(url.hostname) || !plain || !songPath) {
    throw new Error('Expected an HTTPS Cifra Club song URL');
  }
  url.hostname = 'www.cifraclub.com.br';
  url.hash = '';
  return url;
}

export function keyboardUrl(input: string): string {
  const url = cifraSongUrl(input);
  url.searchParams.set('instrument', 'keyboard');
  return url.toString();
}

export function guitarUrl(input: string): string {
  const url = cifraSongUrl(input);
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

const SECTION_WORDS = [
  'intro(?:dução)?', 'riff', 'solo', 'interl[uú]dio', 'instrumental', 'verse', 'verso', 'estrofe', 'chorus',
  'refr[aã]o', 'pr[eé][ -]refr[aã]o', 'bridge', 'ponte', 'outro', 'final',
];
const SECTION_LABEL = new RegExp(`^\\s*(?:\\[[^\\]]+\\]|(?:${SECTION_WORDS.join('|')})(?:\\s+\\d+)?(?:\\s*[:-])?)\\s*$`, 'i');

/** Labels are structural, not the lyric following a pending chord row. */
function isSectionLabel(text: string): boolean {
  return SECTION_LABEL.test(text);
}

const TAB_INSTRUMENTS = ['guitar(?:ra)?', 'viol[aã]o', 'baixo', 'bass', 'teclado', 'keyboard', 'guitars?'];
const TAB_PART_NAMES = ['[1-9]', 'solo', 'base', 'lead', 'rhythm', 'ac[uú]stico', 'dist'];
const TAB_INSTRUMENT_HEADER = new RegExp(
  `^\\|?\\s*(?:${TAB_INSTRUMENTS.join('|')})(?:\\s+(?:${TAB_PART_NAMES.join('|')}))?(?:\\s*[(&-].*)?\\|?$`, 'i',
);

/** One line of guitar or bass tablature: an optional string name, then a bar of frets and techniques. */
const TAB_STRING_LINE = /^[a-eg#1-7]?\s*\|[-0-9x/\\hpbrs~^().|:*+#\s]+\|?$/i;
const TAB_BAR_LINE = /^\|[-0-9xX/\\hpbrs~^().|:*+#\s]+\|?$/;
const BARLINE_ONLY = /^\|[\s|\-~*#]*\|?$/;

/** Each test names one kind of line a tab carries that is not lyric: strings, barlines, headers, repeats, credits. */
const TAB_LINE_TESTS: readonly ((trimmed: string) => boolean)[] = [
  (t) => TAB_STRING_LINE.test(t) && (/-{2,}/.test(t) || /\d/.test(t)),
  (t) => TAB_BAR_LINE.test(t) && /-{2,}/.test(t),
  (t) => /-{4,}/.test(t),
  (t) => BARLINE_ONLY.test(t),
  (t) => TAB_INSTRUMENT_HEADER.test(t),
  (t) => /^(?:repita|repitir|repeat)\b/i.test(t),
  (t) => /^(?:faça\s+isto|\d+x)$/i.test(t),
  (t) => t.length > 1 && t.startsWith('*') && t.endsWith('*'),
  (t) => /^hold$/i.test(t),
];

/** Tablature lines, instrument markers, and tab annotations to ignore. */
function isTabLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && TAB_LINE_TESTS.some((test) => test(trimmed));
}

/**
 * "A e B" → "A and B". Scans left to right and, like a global regex would,
 * never lets one name serve two joins: "A e B e C" becomes "A and B e C".
 */
function replaceNameJoiners(text: string): string {
  const tokens = text.split(/(\s+)/);
  for (let i = 2; i + 2 < tokens.length; i += 2) {
    const joinable = tokens[i] === 'e' && tokens[i - 2] !== '' && tokens[i + 2] !== '';
    if (!joinable) continue;
    tokens.splice(i - 1, 3, ' and ');
    i += 2;
  }
  return tokens.join('');
}

export function translateCredits(raw: string): string {
  let text = raw.trim();
  // Strip trailing CifraClub review/report prompts if present
  text = text.replace(REPORT_PROMPT, '').trim();
  // Translate Portuguese "Composição:" / "Composição de:" -> "Composed by: "
  text = text.replace(/^composi(?:ção|cao)?(?:\s+de)?\s*:\s*/i, 'Composed by: ');
  // Replace Portuguese conjunction " e " between author names with " and "
  text = replaceNameJoiners(text);
  return text;
}

type CheerioRoot = ReturnType<typeof load>;
type JsonLdComposer = string | { name?: string };
type JsonLdItem = { '@type'?: string; composer?: JsonLdComposer | JsonLdComposer[] };

const COMPOSER_LABEL = /^composi(?:ção|cao)?(?:\s+de)?\s*:\s*\S+/i;
const COMPOSER_IN_PAGE = /composi(?:ção|cao)?(?:\s+de)?\s*:\s*([^<\r\n]+)/i;
const REPORT_PROMPT = /Essa informação está errada.*$/i;

/** 1. A text node of its own starting with "Composição:". */
function composerFromText($: CheerioRoot): string | null {
  let raw: string | null = null;
  $('p, span, div, li').each((_, el) => {
    if (raw) return;
    const text = $(el).clone().children().remove().end().text().trim();
    if (COMPOSER_LABEL.test(text)) raw = text;
  });
  return raw;
}

/** 2. "Composição:" anywhere in the page source. */
function composerFromHtml(html: string | undefined): string | null {
  const candidate = html?.match(COMPOSER_IN_PAGE)?.[1]?.replace(REPORT_PROMPT, '').trim();
  return candidate ? `Composição: ${candidate}` : null;
}

function composerNames(item: JsonLdItem): string[] {
  if (item['@type'] !== 'MusicComposition' || !item.composer) return [];
  const composers = Array.isArray(item.composer) ? item.composer : [item.composer];
  return composers.map((c) => (typeof c === 'string' ? c : c?.name)).filter((name): name is string => !!name);
}

/** 3. The composer from JSON-LD MusicComposition data. */
function composerFromJsonLd($: CheerioRoot): string | null {
  let raw: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (raw) return;
    try {
      const json: unknown = JSON.parse($(el).text());
      const items = (Array.isArray(json) ? json : [json]) as JsonLdItem[];
      const names = items.map(composerNames).find((list) => list.length > 0);
      if (names) raw = `Composição: ${names.join(', ')}`;
    } catch {
      // A malformed JSON-LD block is someone else's bug; the other sources still apply.
    }
  });
  return raw;
}

export function extractCifraCredits($: CheerioRoot, html?: string): string | null {
  const raw = composerFromText($) ?? composerFromHtml(html) ?? composerFromJsonLd($);
  return raw ? translateCredits(raw) : null;
}

export interface ParseCifraOptions {
  allowGuitar?: boolean;
}

const CHORD_SYMBOL = /^[A-G][#b]?[a-zA-Z0-9+#º°øΔ()/-]*$/;
const TAB_WIDTH = 8;

/**
 * Collects the chord sheet's rows as text with the chords' columns marked.
 * Traverses text nodes, not HTML offsets, so entities, accents and whitespace
 * survive.
 */
class RawLineReader {
  readonly lines: RawLine[] = [];
  private current: RawLine = { text: '', changes: [] };

  constructor(private readonly $: CheerioRoot) {}

  read(nodes: readonly AnyNode[]): RawLine[] {
    nodes.forEach((node) => this.walk(node));
    if (this.current.text || this.current.changes.length) this.flush();
    return this.lines;
  }

  private flush(): void {
    this.lines.push(this.current);
    this.current = { text: '', changes: [] };
  }

  private append(text: string): void {
    for (const char of text.replaceAll(/\r\n?/g, '\n').replaceAll(' ', ' ')) {
      if (char === '\n') this.flush();
      else this.current.text += char === '\t' ? ' '.repeat(TAB_WIDTH - this.current.text.length % TAB_WIDTH) : char;
    }
  }

  /** Pretty-printed whitespace BETWEEN block rows is HTML formatting, not an empty lyric line. */
  private static isBetweenBlocks(node: AnyNode & { data: string }): boolean {
    return !node.data.trim() && !!node.parent && 'children' in node.parent
      && node.parent.children.some((child) => child.type === 'tag' && child.name === 'div');
  }

  /** Reads a chord tag, returning false when its text is not a chord symbol. */
  private readChord(node: AnyNode & { attribs: Record<string, string> }): boolean {
    const symbol = node.attribs['data-chord-name'] ?? this.$(node).text();
    if (!CHORD_SYMBOL.test(symbol)) return false;
    const column = this.current.text.length;
    this.append(this.$(node).text());
    this.current.changes.push({ symbol, column, endColumn: this.current.text.length });
    return true;
  }

  private walk(node: AnyNode): void {
    if (node.type === 'text') {
      if (!RawLineReader.isBetweenBlocks(node)) this.append(node.data);
      return;
    }
    if (!('children' in node)) return;
    if (node.type !== 'tag') {
      node.children.forEach((child) => this.walk(child));
      return;
    }
    if (node.name === 'br') {
      this.flush();
      return;
    }
    if (node.name === 'script' || node.name === 'style') return;
    const isDiv = node.name === 'div';
    if (isDiv && this.current.text) this.flush();
    const chordTag = !!node.attribs['data-chord-name'] || node.name === 'b';
    if (chordTag && this.readChord(node)) return;
    node.children.forEach((child) => this.walk(child));
    if (isDiv && this.current.text) this.flush();
  }
}

const BEATS_PER_BAR = 4;

/**
 * Turns raw rows into sheet lines: a chord row pairs with the lyric under it,
 * a chord row with nothing under it stands alone as instrumental, and
 * section labels and tablature are recognised rather than read as lyrics.
 */
class SheetLineBuilder {
  readonly lines: SheetLine[] = [];
  private pending: RawLine | null = null;

  build(raw: readonly RawLine[]): SheetLine[] {
    for (const line of raw) this.accept(line);
    this.flushPending();
    return this.lines;
  }

  private accept(line: RawLine): void {
    if (line.changes.length) {
      this.flushPending();
      this.pending = line;
      // An inline "Intro: D" must not steal the first verse's lyric.
      if (isSectionLabel(line.text.slice(0, line.changes[0]!.column))) this.flushPending();
      return;
    }
    if (!line.text.trim()) {
      this.flushPending();
      return;
    }
    if (isSectionLabel(line.text)) {
      this.flushPending();
      this.add(line.text.trim(), [], 'section');
      return;
    }
    if (isTabLine(line.text)) return;
    const pending = this.pending;
    this.pending = null;
    if (pending) this.add(line.text, pending.changes, 'lyric', pending.text.length);
    else this.add(line.text, [], 'lyric');
  }

  private add(text: string, changes: RawLine['changes'], kind: SheetLine['kind'], width = 0): void {
    const beats = kind === 'section' ? 0 : Math.max(BEATS_PER_BAR, Math.ceil(changes.length / BEATS_PER_BAR) * BEATS_PER_BAR);
    const columns = Math.max(width, text.length, ...changes.map((c) => c.column + c.symbol.length));
    this.lines.push({
      id: `line-${this.lines.length + 1}`, kind, text, columns, beats,
      changes: changes.map(({ symbol, column }, i) => ({ symbol, column, beat: i * beats / Math.max(1, changes.length) })),
    });
  }

  /** A chord row with no lyric under it: blank out the chord names and keep what else it says. */
  private flushPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const blanked = pending.changes.reduceRight((text, change) =>
      text.slice(0, change.column) + ' '.repeat(change.endColumn - change.column) + text.slice(change.endColumn), pending.text);
    const label = blanked.replace(BARLINE_ONLY, '').trim();
    this.add(label, pending.changes, 'instrumental', pending.text.length);
  }
}

const KEY_LABEL = /(?:Tom|Key)\s*(?::\s*)?([A-G][#b♭♯]?(?:m(?!aj))?)/i;
const MIN_SHEET_BPM = 20;
const MAX_SHEET_BPM = 300;

function pageBpm($: CheerioRoot): number | null {
  const explicit = $('[data-bpm]').first().attr('data-bpm')
    ?? $('meta[itemprop="tempo"]').attr('content')
    ?? $('body').clone().find('script,style,pre').remove().end().text().match(/\b(\d{2,3})\s*BPM\b/i)?.[1];
  const bpm = Number(explicit);
  return Number.isFinite(bpm) && bpm >= MIN_SHEET_BPM && bpm <= MAX_SHEET_BPM ? bpm : null;
}

/** Pitch classes from the page's keyboard diagram for a chord, when it has one. */
function keyboardPitchClasses($: CheerioRoot, symbol: string): number[] {
  const diagram = $('[data-chord-mode="keyboard"][data-mount]')
    .filter((_, e) => $(e).find('[data-chord-label]').text().trim() === symbol).first();
  const mount = diagram.attr('data-mount');
  if (!mount) return [];
  const keys = mount.trim().split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(keys.map((n) => (n - 1) % 12))];
}

function titleAndArtist($: CheerioRoot): { title: string; artist: string } {
  const title = $('h1').first().text().trim();
  const artist = $('h1').first().parent().find('h2').first().text().trim() || $('h2 a').first().text().trim();
  if (!title || !artist) throw new Error('Missing title/artist; refusing to invent metadata');
  return { title, artist };
}

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
  const lines = new SheetLineBuilder().build(new RawLineReader($).read(pre.contents().toArray()));
  const { title, artist } = titleAndArtist($);
  const symbols = [...new Set(lines.flatMap((l) => l.changes.map((c) => c.symbol)))];
  if (!symbols.length) throw new Error('No chords extracted');
  const bpm = pageBpm($);
  const sheet: ChordSheet = {
    version: 1,
    id: normalizeIdentity(`${artist}-${title}`),
    title,
    artist,
    key: $('#key').text().match(KEY_LABEL)?.[1] ?? null,
    bpm,
    bpmSource: bpm === null ? 'unknown' : 'page',
    sourceUrl: url,
    instrument,
    lyrics: 'included',
    timing: 'estimated',
    timingModel: null,
    credits: extractCifraCredits($, html),
    chords: symbols.map((symbol) => interpretSheetChord(symbol, keyboardPitchClasses($, symbol))),
    lines,
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
