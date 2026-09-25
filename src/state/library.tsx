import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import { fromBase64, toBase64, ImportedPiece, importScore, parseMidi } from '@domain';

/**
 * Pieces the player imported themselves.
 *
 * The original MIDI is kept — a few tens of kilobytes — and the score is
 * rebuilt from it on demand rather than stored. Regenerating means running the
 * fingering solver again, which takes milliseconds, and it means a later
 * improvement to the solver applies to everything already imported instead of
 * only to new files.
 */

export interface ImportedEntry {
  id: string;
  title: string;
  composer: string;
  /** Index of the MIDI track carrying the cello line. */
  soloTrack: number;
  bpm: number;
  addedAt: number;
  /** The original file, base64-encoded. */
  data: string;
}

/**
 * Refuse anything larger than this. Settings storage is not a filesystem, and
 * a MIDI file big enough to matter is almost always a whole album rather than
 * a piece to practise.
 */
export const MAX_MIDI_BYTES = 512 * 1024;

const STORAGE_KEY = 'ponticello:imported:v1';

interface LibraryContextValue {
  entries: ImportedEntry[];
  ready: boolean;
  add: (entry: Omit<ImportedEntry, 'addedAt'>) => void;
  remove: (id: string) => void;
  /** Rebuilds the score and backing for an imported piece. Cached. */
  resolve: (id: string) => ImportedPiece | null;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function ImportedLibraryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ImportedEntry[]>([]);
  const [ready, setReady] = useState(false);
  const hydrated = useRef(false);
  // Solving fingerings is fast but not free, and every render of the library
  // would otherwise redo it for each row.
  const cache = useRef(new Map<string, ImportedPiece | null>());

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const stored = JSON.parse(raw) as ImportedEntry[];
        if (Array.isArray(stored)) setEntries(stored);
      })
      .catch(() => {
        // A corrupt store should cost the player their imports, not the app.
      })
      .finally(() => {
        if (cancelled) return;
        hydrated.current = true;
        setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  }, [entries]);

  const add = useCallback((entry: Omit<ImportedEntry, 'addedAt'>) => {
    cache.current.delete(entry.id);
    setEntries((current) => [
      { ...entry, addedAt: Date.now() },
      ...current.filter((e) => e.id !== entry.id),
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    cache.current.delete(id);
    setEntries((current) => current.filter((e) => e.id !== id));
  }, []);

  const resolve = useCallback((id: string): ImportedPiece | null => {
    if (cache.current.has(id)) return cache.current.get(id) ?? null;

    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;

    let piece: ImportedPiece | null = null;
    try {
      const parsed = parseMidi(fromBase64(entry.data));
      piece = importScore(parsed, {
        id: entry.id,
        title: entry.title,
        composer: entry.composer,
        soloTrack: entry.soloTrack,
        bpm: entry.bpm,
      });
    } catch {
      // A file that no longer parses shows as unplayable rather than crashing
      // the library it appears in.
      piece = null;
    }

    cache.current.set(id, piece);
    return piece;
  }, [entries]);

  const value = useMemo<LibraryContextValue>(
    () => ({ entries, ready, add, remove, resolve }),
    [entries, ready, add, remove, resolve],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useImportedLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useImportedLibrary must be used inside <ImportedLibraryProvider>');
  return context;
}

/** Encodes a picked file for storage, refusing anything oversized. */
export function encodeForStorage(bytes: Uint8Array): string {
  if (bytes.length > MAX_MIDI_BYTES) {
    throw new Error(
      `That file is ${(bytes.length / 1024).toFixed(0)} KB. The limit is ${MAX_MIDI_BYTES / 1024} KB — `
      + 'try a single movement rather than a whole set.',
    );
  }
  return toBase64(bytes);
}

/** A stable id from the file name, so re-importing replaces rather than duplicates. */
export function idForFile(name: string): string {
  const slug = name.replace(/\.midi?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `import-${slug.replace(/^-|-$/g, '') || Date.now().toString(36)}`;
}
