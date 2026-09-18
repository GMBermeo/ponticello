import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
} from 'react';

import { PracticeLog, recordSession } from '@/domain/practice';

/**
 * The practice log, on this phone only.
 *
 * Same shape as the settings store — a ref plus an external subscription —
 * because the play screen writes to it while the transport is running and a
 * context value that changed identity on every write would re-render the whole
 * play tree mid-phrase. Read it with `usePracticeLog`, never through the
 * store's getter during render: see the note in `settings.tsx`.
 */

const STORAGE_KEY = 'ponticello:practice:v1';

interface PracticeStore {
  getSnapshot: () => PracticeLog;
  subscribe: (listener: () => void) => () => void;
  /** Credits `ms` of practice to the day it started. Short sessions are ignored. */
  log: (ms: number, at?: Date) => void;
  clear: () => void;
  isReady: () => boolean;
}

const PracticeStoreContext = createContext<PracticeStore | null>(null);

const EMPTY: PracticeLog = {};

export function PracticeProvider({ children }: { children: React.ReactNode }) {
  const logRef = useRef<PracticeLog>(EMPTY);
  const readyRef = useRef(false);
  const hydrated = useRef(false);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const getSnapshot = useCallback(() => logRef.current, []);
  const isReady = useCallback(() => readyRef.current, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  const persist = useCallback(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(logRef.current)).catch(() => {});
  }, []);

  const log = useCallback((ms: number, at: Date = new Date()) => {
    const next = recordSession(logRef.current, at, ms);
    if (next === logRef.current) return;
    logRef.current = next;
    notify();
    persist();
  }, [notify, persist]);

  const clear = useCallback(() => {
    logRef.current = EMPTY;
    notify();
    persist();
  }, [notify, persist]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const stored = JSON.parse(raw) as unknown;
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
          const clean: PracticeLog = {};
          for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) clean[key] = value;
          }
          logRef.current = clean;
        }
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        hydrated.current = true;
        readyRef.current = true;
        notify();
      });
    return () => { cancelled = true; };
  }, [notify]);

  const store = useMemo<PracticeStore>(
    () => ({ getSnapshot, subscribe, log, clear, isReady }),
    [getSnapshot, subscribe, log, clear, isReady],
  );

  return (
    <PracticeStoreContext.Provider value={store}>{children}</PracticeStoreContext.Provider>
  );
}

function usePracticeStore(): PracticeStore {
  const store = useContext(PracticeStoreContext);
  if (!store) throw new Error('Practice hooks must be used inside <PracticeProvider>');
  return store;
}

/** Subscribed read of the whole log. Re-renders only when a day changes. */
export function usePracticeLog(): PracticeLog {
  const store = usePracticeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function usePracticeReady(): boolean {
  const store = usePracticeStore();
  return useSyncExternalStore(store.subscribe, store.isReady, store.isReady);
}

/** Write side only — stable, so a component can hold it without re-rendering. */
export function usePracticeActions() {
  const store = usePracticeStore();
  return useMemo(() => ({ log: store.log, clear: store.clear }), [store]);
}
