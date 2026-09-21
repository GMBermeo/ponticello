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
    } catch (err) {
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

  const worker = async () => {
    while (queue.length > 0) {
      const filename = queue.shift();
      if (!filename) break;

      const idx = ++currentIndex;
      const filePath = join(options.chartsDir, filename);
      let chart: Record<string, any>;
      try {
        chart = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.error(`[${idx}/${targets.length}] Failed to parse ${filename}:`, err);
        failedCount++;
        continue;
      }

      const songId = chart.id || filename.replace('.json', '');
      const title = chart.title;
      const artist = chart.artist;

      // Check special case for kryptonite
      if (songId === '3-doors-down-kryptonite') {
        const specialUrl = 'https://open.spotify.com/track/6ZOBP3NvffbU4SZcrnt1k6?si=ba02766359f946af';
        chart = insertSpotifyUrl(chart, specialUrl);
        writeFileSync(filePath, JSON.stringify(chart, null, 2) + '\n');
        cache[songId] = {
          id: songId,
          title,
          artist,
          spotifyUrl: specialUrl,
          trackId: '6ZOBP3NvffbU4SZcrnt1k6',
          timestamp: new Date().toISOString(),
        };
        saveCache(options.cacheFile, cache);
        console.log(`[${idx}/${targets.length}] ✓ ${title} by ${artist} -> ${specialUrl} (user default)`);
        updatedCount++;
        results.push({ file: filename, id: songId, spotifyUrl: specialUrl });
        continue;
      }

      // If already in file and not forcing
      if (!options.force && chart.spotifyUrl) {
        console.log(`[${idx}/${targets.length}] • ${title} by ${artist} -> already present: ${chart.spotifyUrl}`);
        cachedCount++;
        results.push({ file: filename, id: songId, spotifyUrl: chart.spotifyUrl });
        continue;
      }

      // If in cache and not forcing
      if (!options.force && cache[songId]?.spotifyUrl) {
        const cachedUrl = cache[songId].spotifyUrl!;
        chart = insertSpotifyUrl(chart, cachedUrl);
        writeFileSync(filePath, JSON.stringify(chart, null, 2) + '\n');
        console.log(`[${idx}/${targets.length}] • ${title} by ${artist} -> from cache: ${cachedUrl}`);
        cachedCount++;
        results.push({ file: filename, id: songId, spotifyUrl: cachedUrl });
        continue;
      }

      // Primary search query
      let query = `${artist} ${title}`;
      let trackHref = await cdp.searchTrack(query);

      // Fallback 1: remove text in parentheses from title (e.g. "(Ao Vivo)", "(feat. ...)")
      if (!trackHref && /\([^)]*\)/.test(title)) {
        const cleanTitle = title.replace(/\([^)]*\)/g, '').trim();
        query = `${artist} ${cleanTitle}`;
        trackHref = await cdp.searchTrack(query);
      }

      // Fallback 2: if artist has multiple performers (feat, e, &), use primary artist
      if (!trackHref && /(?:feat\.?|ft\.?|&|,|\be\b)/i.test(artist)) {
        const primaryArtist = artist.split(/(?:feat\.?|ft\.?|&|,|\be\b)/i)[0].trim();
        query = `${primaryArtist} ${title.replace(/\([^)]*\)/g, '').trim()}`;
        trackHref = await cdp.searchTrack(query);
      }

      if (trackHref) {
        const match = /\/track\/([a-zA-Z0-9]+)/.exec(trackHref);
        const trackId = match ? match[1] : null;
        const spotifyUrl = trackId ? `https://open.spotify.com/track/${trackId}` : `https://open.spotify.com${trackHref}`;

        chart = insertSpotifyUrl(chart, spotifyUrl);
        writeFileSync(filePath, JSON.stringify(chart, null, 2) + '\n');

        cache[songId] = {
          id: songId,
          title,
          artist,
          spotifyUrl,
          trackId,
          timestamp: new Date().toISOString(),
        };
        saveCache(options.cacheFile, cache);

        console.log(`[${idx}/${targets.length}] ✓ ${title} by ${artist} -> ${spotifyUrl}`);
        updatedCount++;
        results.push({ file: filename, id: songId, spotifyUrl });
      } else {
        console.warn(`[${idx}/${targets.length}] ✗ No track found on Spotify for "${query}"`);
        failedCount++;
        results.push({ file: filename, id: songId, spotifyUrl: null });
      }
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
