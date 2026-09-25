/**
 * Browser-driven Spotify Link Enricher (tools/enrich-spotify-browser.ts)
 *
 * Navigates Spotify search pages using a local Google Chrome browser via
 * Chrome DevTools Protocol (CDP) to extract exact Spotify track links
 * and attaches them to chord charts in _CHORDS/charts/*.json.
 *
 * Usage:
 *   npx tsx tools/enrich-spotify-browser.ts                  # Process all charts
 *   npx tsx tools/enrich-spotify-browser.ts --max 5         # Test on 5 songs
 *   npx tsx tools/enrich-spotify-browser.ts --concurrency 4 # Run with 4 tabs
 *   npx tsx tools/enrich-spotify-browser.ts --force         # Re-search even if exists
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/** Joins between performers: "feat.", "ft.", "&", a comma, or Portuguese "e". */
const ARTIST_SEPARATOR = /feat\.?|ft\.?|&|,|\be\b/i;

/** "Song (Ao Vivo)" → "Song": each parenthetical removed, scanning rather than backtracking. */
function withoutParentheticals(text: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const open = text.indexOf('(', cursor);
    const close = open < 0 ? -1 : text.indexOf(')', open + 1);
    if (close < 0) break;
    out += text.slice(cursor, open);
    cursor = close + 1;
  }
  return (out + text.slice(cursor)).trim();
}

interface CliOptions {
  chartsDir: string;
  cacheFile: string;
  max: number | null;
  concurrency: number;
  force: boolean;
  chromePath: string;
  port: number;
}

function parseCliOptions(): CliOptions {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback?: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? fallback : (argv[i + 1] ?? fallback);
  };
  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  return {
    chartsDir: resolve(flag('charts-dir', '_CHORDS/charts')!),
    cacheFile: resolve(flag('cache', '_CHORDS/spotify_cache.json')!),
    max: flag('max') ? Number(flag('max')) : null,
    concurrency: flag('concurrency') ? Number(flag('concurrency')) : 4,
    force: hasFlag('force'),
    chromePath: flag('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')!,
    port: Number(flag('port', '9333')),
  };
}

interface CacheItem {
  id: string;
  title: string;
  artist: string;
  spotifyUrl: string | null;
  trackId: string | null;
  timestamp: string;
}

type SpotifyCache = Record<string, CacheItem>;

function loadCache(cacheFile: string): SpotifyCache {
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCache(cacheFile: string, cache: SpotifyCache): void {
  const tmp = `${cacheFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  renameSync(tmp, cacheFile);
}

function cleanQuery(text: string): string {
  return text
    .replace(/[/\\?#:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class ChromeCDP {
  private proc: ChildProcess | null = null;
  private port: number;
  private chromePath: string;

  constructor(chromePath: string, port: number) {
    this.chromePath = chromePath;
    this.port = port;
  }

  async start(): Promise<void> {
    const userDataDir = `/tmp/chrome-spotify-${Date.now()}`;
    mkdirSync(userDataDir, { recursive: true });

    this.proc = spawn(this.chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: 'ignore' });

    // Wait for CDP readiness
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (!ready) {
      this.stop();
      throw new Error(`Failed to start Chrome CDP on port ${this.port}`);
    }
  }

  stop(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {}
      this.proc = null;
    }
  }

  async searchTrack(rawQuery: string): Promise<string | null> {
    const query = cleanQuery(rawQuery);
    const encoded = encodeURIComponent(query);
    const searchUrl = `https://open.spotify.com/search/${encoded}`;

    let tabId: string | null = null;
    let ws: WebSocket | null = null;

    try {
      const newTabRes = await fetch(`http://127.0.0.1:${this.port}/json/new?${searchUrl}`, {
        method: 'PUT',
      });
      const tab = await newTabRes.json();
      tabId = tab.id;

      ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise<void>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('WebSocket open timeout')), 6000);
        ws!.onopen = () => {
          clearTimeout(timeout);
          res();
        };
        ws!.onerror = (e) => {
          clearTimeout(timeout);
          rej(e);
        };
      });

      let nextMsgId = 1;
      const send = (method: string, params: Record<string, unknown> = {}) => {
        const id = nextMsgId++;
        return new Promise<any>((resolveMsg) => {
          const handler = (event: MessageEvent) => {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              ws!.removeEventListener('message', handler);
              resolveMsg(data.result);
            }
          };
          ws!.addEventListener('message', handler);
          ws!.send(JSON.stringify({ id, method, params }));
        });
      };

      // Poll for search result track link
      let trackHref: string | null = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 300));
        const evalRes = await send('Runtime.evaluate', {
          expression: `(() => {
            // Check top track links in search results
            const a = document.querySelector('a[href^="/track/"]');
            return a ? a.getAttribute('href') : null;
          })()`,
          returnByValue: true,
        });

        if (evalRes?.result?.value) {
          trackHref = evalRes.result.value;
          break;
        }
      }

      return trackHref;
    } catch {
      // A failed search is a miss, not an error: the caller tries the next query.
      return null;
    } finally {
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
      if (tabId) {
        try {
          await fetch(`http://127.0.0.1:${this.port}/json/close/${tabId}`);
        } catch {}
      }
    }
  }
}

function insertSpotifyUrl(rawJson: Record<string, any>, spotifyUrl: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(rawJson)) {
    out[key] = value;
    if (key === 'sourceUrl') {
      out.spotifyUrl = spotifyUrl;
    }
  }
  if (!('spotifyUrl' in out)) {
    out.spotifyUrl = spotifyUrl;
  }
  return out;
}

/** Tracks the search picks wrongly, pinned by hand. */
const PINNED_TRACKS: Readonly<Record<string, string>> = {
  '3-doors-down-kryptonite': 'https://open.spotify.com/track/6ZOBP3NvffbU4SZcrnt1k6?si=ba02766359f946af',
};

type KnownUrl = { url: string; source: 'pinned' | 'chart' | 'cache' };

/** A URL that needs no search: pinned, already in the chart, or cached — unless forcing a fresh look. */
function knownSpotifyUrl(songId: string, chart: Record<string, any>, cache: SpotifyCache, force: boolean): KnownUrl | null {
  const pinned = PINNED_TRACKS[songId];
  if (pinned) return { url: pinned, source: 'pinned' };
  if (force) return null;
  if (chart.spotifyUrl) return { url: chart.spotifyUrl, source: 'chart' };
  const cached = cache[songId]?.spotifyUrl;
  return cached ? { url: cached, source: 'cache' } : null;
}

function trackIdOf(hrefOrUrl: string): string | null {
  return /\/track\/([a-zA-Z0-9]+)/.exec(hrefOrUrl)?.[1] ?? null;
}

/**
 * Searches as written, then without parenthetical notes such as "(Ao Vivo)",
 * then with only the first of several performers.
 */
async function findTrackHref(cdp: ChromeCDP, artist: string, title: string): Promise<{ href: string | null; query: string }> {
  const cleanTitle = withoutParentheticals(title);
  const primaryArtist = artist.split(ARTIST_SEPARATOR)[0].trim();
  const queries = [`${artist} ${title}`];
  if (cleanTitle !== title.trim()) queries.push(`${artist} ${cleanTitle}`);
  if (primaryArtist !== artist.trim()) queries.push(`${primaryArtist} ${cleanTitle}`);
  let query = queries[0]!;
  for (const candidate of queries) {
    query = candidate;
    const href = await cdp.searchTrack(candidate);
    if (href) return { href, query };
  }
  return { href: null, query };
}

async function main() {
  const options = parseCliOptions();
  console.log(`Starting Spotify enricher...`);
  console.log(`Charts Directory: ${options.chartsDir}`);
  console.log(`Concurrency:      ${options.concurrency}`);

  const cache = loadCache(options.cacheFile);
  const files = readdirSync(options.chartsDir).filter((f) => f.endsWith('.json')).sort();
  console.log(`Total charts found: ${files.length}`);

  let targets = files;
  if (options.max) {
    targets = targets.slice(0, options.max);
    console.log(`Processing first ${options.max} charts as requested.`);
  }

  const cdp = new ChromeCDP(options.chromePath, options.port);
  console.log(`Launching Chrome headless (${options.chromePath}) on port ${options.port}...`);
  await cdp.start();
  console.log(`Chrome CDP ready.`);

  let updatedCount = 0;
  let cachedCount = 0;
  let failedCount = 0;

  process.on('SIGINT', () => {
    console.log('\nShutting down Chrome...');
    cdp.stop();
    process.exit(1);
  });

  const queue = [...targets];
  let currentIndex = 0;

  const results: { file: string; id: string; spotifyUrl: string | null }[] = [];

  type Outcome = 'updated' | 'cached' | 'failed';

  const readChart = (filePath: string): Record<string, any> | null => {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`Failed to parse ${filePath}:`, err);
      return null;
    }
  };

  const writeChart = (filePath: string, chart: Record<string, any>) => {
    writeFileSync(filePath, JSON.stringify(chart, null, 2) + '\n');
  };

  const remember = (songId: string, chart: Record<string, any>, spotifyUrl: string) => {
    cache[songId] = {
      id: songId, title: chart.title, artist: chart.artist, spotifyUrl, trackId: trackIdOf(spotifyUrl), timestamp: new Date().toISOString(),
    };
    saveCache(options.cacheFile, cache);
  };

  const processChart = async (filename: string, tag: string): Promise<Outcome> => {
    const filePath = join(options.chartsDir, filename);
    const chart = readChart(filePath);
    if (!chart) return 'failed';
    const songId = chart.id || filename.replace('.json', '');
    const { title, artist } = chart;

    const known = knownSpotifyUrl(songId, chart, cache, options.force);
    if (known) {
      if (known.source !== 'chart') writeChart(filePath, insertSpotifyUrl(chart, known.url));
      results.push({ file: filename, id: songId, spotifyUrl: known.url });
      if (known.source === 'pinned') {
        remember(songId, chart, known.url);
        console.log(`${tag} ✓ ${title} by ${artist} -> ${known.url} (user default)`);
        return 'updated';
      }
      const where = known.source === 'chart' ? 'already present' : 'from cache';
      console.log(`${tag} • ${title} by ${artist} -> ${where}: ${known.url}`);
      return 'cached';
    }

    const { href, query } = await findTrackHref(cdp, artist, title);
    if (!href) {
      console.warn(`${tag} ✗ No track found on Spotify for "${query}"`);
      results.push({ file: filename, id: songId, spotifyUrl: null });
      return 'failed';
    }
    const trackId = trackIdOf(href);
    const spotifyUrl = trackId ? `https://open.spotify.com/track/${trackId}` : `https://open.spotify.com${href}`;
    writeChart(filePath, insertSpotifyUrl(chart, spotifyUrl));
    remember(songId, chart, spotifyUrl);
    console.log(`${tag} ✓ ${title} by ${artist} -> ${spotifyUrl}`);
    results.push({ file: filename, id: songId, spotifyUrl });
    return 'updated';
  };

  const worker = async () => {
    for (let filename = queue.shift(); filename; filename = queue.shift()) {
      const outcome = await processChart(filename, `[${++currentIndex}/${targets.length}]`);
      if (outcome === 'updated') updatedCount++;
      else if (outcome === 'cached') cachedCount++;
      else failedCount++;
    }
  };

  const workers = Array.from({ length: options.concurrency }, () => worker());
  await Promise.all(workers);

  cdp.stop();
  console.log(`\nEnrichment finished.`);
  console.log(`- Updated: ${updatedCount}`);
  console.log(`- Cached / already present: ${cachedCount}`);
  console.log(`- Failed / Not found: ${failedCount}`);

  // Sync to _CHORDS/chordSheets.json and src/scores/chordSheets.generated.json
  const bundleFile = resolve('_CHORDS/chordSheets.json');
  if (existsSync(bundleFile)) {
    console.log(`Syncing into ${bundleFile}...`);
    try {
      const allCharts = readdirSync(options.chartsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(options.chartsDir, f), 'utf8')))
        .sort((a, b) => a.id.localeCompare(b.id));

      const tmp = `${bundleFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(allCharts, null, 2) + '\n');
      renameSync(tmp, bundleFile);
      console.log(`Synced ${allCharts.length} charts to ${bundleFile}`);
    } catch (e) {
      console.error(`Failed to sync to ${bundleFile}:`, e);
    }
  }

  const devBundle = resolve('src/scores/chordSheets.generated.json');
  if (existsSync(devBundle)) {
    console.log(`Syncing into ${devBundle}...`);
    try {
      const existing: Record<string, any>[] = JSON.parse(readFileSync(devBundle, 'utf8'));
      const map = new Map(existing.map((s) => [s.id, s]));
      for (const res of results) {
        if (res.spotifyUrl && map.has(res.id)) {
          const item = map.get(res.id)!;
          map.set(res.id, insertSpotifyUrl(item, res.spotifyUrl));
        }
      }
      const sorted = [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
      const tmp = `${devBundle}.tmp`;
      writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
      renameSync(tmp, devBundle);
      console.log(`Synced ${sorted.length} charts to ${devBundle}`);
    } catch (e) {
      console.error(`Failed to sync to ${devBundle}:`, e);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
