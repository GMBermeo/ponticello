import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import { AccompanimentStyle } from '@/domain/backing';
import { DEFAULT_TAPE_SETS, TapeSet } from '@/domain/tapes';
import { ListenMode } from '@/audio/backing/types';
import { ChromeName } from '@/theme/tokens';

export type VisionName = 'tab' | 'score' | 'highway';
export type CueDensity = 'full' | 'essentials';

/**
 * Which way up the fingerboard panel is drawn.
 *
 * `player` puts the nut at the bottom and the bridge at the top, which is what
 * a cellist sees looking down at their own left hand: the lowest note on a
 * string is nearest them, and the hand climbs *upward* into the higher
 * positions. `reader` is the old drawing — nut at the top, like a chord chart —
 * kept because it matches how fingerboard diagrams are printed.
 */
export type BoardView = 'player' | 'reader';

/**
 * Which way the notes travel.
 *
 * Both visions can run either way, and neither axis is universally better: a
 * falling highway matches the guitar-hero convention most people arrive with,
 * a horizontal one matches Rocksmith and leaves room for four wide lanes on a
 * short screen. Whichever axis is chosen, the *low* string is always at the
 * bottom and time always runs towards the hit line.
 */
export type FlowAxis = 'vertical' | 'horizontal';

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
  countInBars: number;
  /** What to sound while you play: nothing, the backing, the cello line, or both. */
  listenMode: ListenMode;
  /** How to build an accompaniment for pieces that did not come with one. */
  accompaniment: AccompanimentStyle;
  /** Backing level, 0–1. Deliberately below the cello you are producing. */
  backingVolume: number;
  /**
   * Keep the microphone open while the transport is running.
   *
   * Off by default, and that default is a performance decision. The pitch
   * engine publishes about 375 frames a second on the JS thread and pushes a
   * React state update twelve times a second; because the whole play screen
   * reads that state, every one of those updates used to re-render the note
   * field. Combined with a field that drew every note in the song it was the
   * largest single cause of playback stutter.
   *
   * It is a setting rather than a removal because intonation feedback is the
   * point of the app — it is simply more useful when you are working a phrase
   * with the transport stopped than when the backing is carrying you along.
   */
  micWhilePlaying: boolean;
  /** Which way up the fingerboard panel is drawn. */
  boardView: BoardView;
  /** Which way notes travel on the highway. */
  highwayAxis: FlowAxis;
  /** Which way notes travel on the tab stave. */
  tabAxis: FlowAxis;
}

const DEFAULTS: Settings = {
  chrome: 'quiet',
  vision: 'tab',
  showFingerings: true,
  cueDensity: 'full',
  tapeSets: DEFAULT_TAPE_SETS,
  showTapes: true,
  metronome: true,
  countInBars: 2,
  listenMode: 'off',
  accompaniment: 'drone',
  backingVolume: 0.7,
  micWhilePlaying: false,
  boardView: 'player',
  highwayAxis: 'vertical',
  tabAxis: 'horizontal',
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
