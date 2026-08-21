import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import { DEFAULT_TAPE_SETS, TapeSet } from '@/domain/tapes';
import { ChromeName } from '@/theme/tokens';

export type VisionName = 'tab' | 'score' | 'highway';
export type CueDensity = 'full' | 'essentials';

export interface Settings {
  /** Chrome for the play screen only; menus are always paper. */
  chrome: ChromeName;
  vision: VisionName;
  showFingerings: boolean;
  cueDensity: CueDensity;
  /** The player's own fingerboard tapes. Editable in Settings → My tapes. */
  tapeSets: TapeSet[];
  /** Draw the tapes behind the notes on the highway and the fingerboard panel. */
  showTapes: boolean;
  metronome: boolean;
  drone: boolean;
  countInBars: number;
}

const DEFAULTS: Settings = {
  chrome: 'quiet',
  vision: 'tab',
  showFingerings: true,
  cueDensity: 'full',
  tapeSets: DEFAULT_TAPE_SETS,
  showTapes: true,
  metronome: true,
  drone: false,
  countInBars: 2,
};

const STORAGE_KEY = 'ponticello:settings:v1';

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  replaceTapeSet: (set: TapeSet) => void;
  resetTapes: () => void;
  /** False until the stored values have been read, so nothing flashes defaults. */
  ready: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  // Skip the write that would otherwise fire immediately after hydration.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const stored = JSON.parse(raw) as Partial<Settings>;
        // Merge rather than replace: a settings key added in a later version
        // must not come back undefined for someone upgrading.
        setSettings((current) => ({ ...current, ...stored }));
      })
      .catch(() => {
        // A corrupt or unreadable store is not worth interrupting practice
        // over — fall back to defaults silently.
      })
      .finally(() => {
        if (!cancelled) {
          hydrated.current = true;
          setReady(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const replaceTapeSet = useCallback((set: TapeSet) => {
    setSettings((current) => ({
      ...current,
      tapeSets: current.tapeSets.map((s) => (s.id === set.id ? set : s)),
    }));
  }, []);

  const resetTapes = useCallback(() => {
    setSettings((current) => ({ ...current, tapeSets: DEFAULT_TAPE_SETS }));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update, replaceTapeSet, resetTapes, ready }),
    [settings, update, replaceTapeSet, resetTapes, ready],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}
