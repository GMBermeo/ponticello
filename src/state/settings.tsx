import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
} from 'react';

import { AccompanimentStyle } from '@/domain/backing';
import { DEFAULT_TAPE_SETS, isCurrentTapeLayout, TAPE_LAYOUT_VERSION, TapeSet } from '@/domain/tapes';
import { DEFAULT_TRACK_CHOICE, TrackChoice } from '@/domain/trackPicker';
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

/**
 * Faint note overlay on the fingerboard panel.
 *
 * `off` shows only tapes and the live note. `key` shows every stopping point
 * that belongs to the song's detected key — a shape to improvise in and learn
 * the key. `song` shows only the notes the piece actually uses, so the player
 * can see the whole hand map of what is coming before the bow moves.
 */
export type NoteOverlayMode = 'off' | 'key' | 'song';

/**
 * How the noteheads on the Score page are coloured.
 *
 * `off` is the engraved page as a copyist would set it, in ink. `string`
 * colours each note by the string it is played on, which answers "where does
 * my hand go". `note` colours it by its letter name from the constant in
 * `domain/noteColors`, which answers "what note is that" — the colour code the
 * printed fingerboard charts use, and the one the chart screen prints.
 */
export type ScoreColorMode = 'off' | 'string' | 'note';

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
  /** Which way up the fingerboard panel is drawn. */
  boardView: BoardView;
  /** Which way notes travel on the highway. */
  highwayAxis: FlowAxis;
  /** Which way notes travel on the tab stave. */
  tabAxis: FlowAxis;
  /** Faint fingerboard overlay: the song's key, the song's notes, or nothing. */
  noteOverlay: NoteOverlayMode;
  /** How the Score page colours its noteheads. */
  scoreColor: ScoreColorMode;
  /**
   * Ring the other places the note being played could be taken.
   *
   * The fingering is chosen for you; this shows what it chose between.
   */
  showAlternatePlacements: boolean;
  /**
   * Hide the view/sound switchers while the music runs.
   *
   * They are setup controls, not performance controls: mid-phrase they are
   * something bright moving at the top of the screen that you cannot use
   * anyway. With this on they come back the moment you pause.
   */
  hideControlsWhilePlaying: boolean;
  /** Layout generation of `tapeSets`; a bump discards stored tapes. */
  tapeLayoutVersion: number;
  /**
   * Which source part the player takes as their cello line, per song.
   *
   * Persisted rather than held for the sitting, because it is a decision about
   * the *piece*: having worked out that this song is worth playing from its
   * bass line an octave up, you should not have to work that out again
   * tomorrow. Songs left on the default arrangement are pruned from the map on
   * write, so it only ever holds the songs the player actually changed.
   */
  trackChoices: Record<string, TrackChoice>;
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
  boardView: 'player',
  highwayAxis: 'vertical',
  tabAxis: 'horizontal',
  noteOverlay: 'key',
  scoreColor: 'off',
  showAlternatePlacements: true,
  hideControlsWhilePlaying: false,
  tapeLayoutVersion: TAPE_LAYOUT_VERSION,
  trackChoices: {},
};

const STORAGE_KEY = 'ponticello:settings:v1';

export interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  replaceTapeSet: (set: TapeSet) => void;
  resetTapes: () => void;
  /**
   * Records a choice, or clears it when it is back to the default. Read the
   * choice back with `useTrackChoice`, which subscribes: a getter that reads
   * the store's ref is memoised by React Compiler on its (stable) identity and
   * so never sees the write — which is why picking a part used to do nothing.
   */
  setTrackChoice: (songId: string, choice: TrackChoice) => void;
  /** False until the stored values have been read, so nothing flashes defaults. */
  ready: boolean;
}

interface SettingsStore {
  getSnapshot: () => Settings;
  subscribe: (listener: () => void) => () => void;
  update: (patch: Partial<Settings>) => void;
  replaceTapeSet: (set: TapeSet) => void;
  resetTapes: () => void;
  setTrackChoice: (songId: string, choice: TrackChoice) => void;
  isReady: () => boolean;
}

const SettingsStoreContext = createContext<SettingsStore | null>(null);

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(objA[key], objB[key])) return false;
  }
  return true;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const settingsRef = useRef<Settings>(DEFAULTS);
  const readyRef = useRef(false);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const hydrated = useRef(false);

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const getSnapshot = useCallback(() => settingsRef.current, []);
  const isReady = useCallback(() => readyRef.current, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    notify();
    if (hydrated.current) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current)).catch(() => {});
    }
  }, [notify]);

  const replaceTapeSet = useCallback((set: TapeSet) => {
    settingsRef.current = {
      ...settingsRef.current,
      tapeSets: settingsRef.current.tapeSets.map((s) => (s.id === set.id ? set : s)),
    };
    notify();
    if (hydrated.current) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current)).catch(() => {});
    }
  }, [notify]);

  const resetTapes = useCallback(() => {
    settingsRef.current = { ...settingsRef.current, tapeSets: DEFAULT_TAPE_SETS };
    notify();
    if (hydrated.current) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current)).catch(() => {});
    }
  }, [notify]);

  const setTrackChoice = useCallback((songId: string, choice: TrackChoice) => {
    const next = { ...settingsRef.current.trackChoices };
    if (choice.partId === null && choice.octaves === 0) delete next[songId];
    else next[songId] = choice;
    settingsRef.current = { ...settingsRef.current, trackChoices: next };
    notify();
    if (hydrated.current) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current)).catch(() => {});
    }
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const stored = JSON.parse(raw) as Partial<Settings>;
        if (stored.noteOverlay === 'off' || !stored.noteOverlay) {
          stored.noteOverlay = 'key';
        }
        if (!stored.trackChoices || typeof stored.trackChoices !== 'object') {
          delete stored.trackChoices;
        }
        // Tapes stored against an older layout are dropped rather than merged.
        // Nine tapes cannot be reconciled with a stored four plus a thumb set,
        // and half-applying one would leave the drawing disagreeing with the
        // instrument, which is the one thing this feature must never do.
        if (stored.tapeLayoutVersion !== TAPE_LAYOUT_VERSION
          || !isCurrentTapeLayout(stored.tapeSets)) {
          delete stored.tapeSets;
          stored.tapeLayoutVersion = TAPE_LAYOUT_VERSION;
        }
        // Retired: the microphone is for tuning while paused, never mid-playback.
        delete (stored as { micWhilePlaying?: unknown }).micWhilePlaying;
        settingsRef.current = { ...settingsRef.current, ...stored };
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          hydrated.current = true;
          readyRef.current = true;
          notify();
        }
      });
    return () => { cancelled = true; };
  }, [notify]);

  const store = useMemo<SettingsStore>(() => ({
    getSnapshot,
    subscribe,
    update,
    replaceTapeSet,
    resetTapes,
    setTrackChoice,
    isReady,
  }), [getSnapshot, subscribe, update, replaceTapeSet, resetTapes, setTrackChoice, isReady]);

  return <SettingsStoreContext.Provider value={store}>{children}</SettingsStoreContext.Provider>;
}

export function useSettingsStore(): SettingsStore {
  const store = useContext(SettingsStoreContext);
  if (!store) throw new Error('Settings hooks must be used inside <SettingsProvider>');
  return store;
}

/**
 * Subscribes to one slice of the settings.
 *
 * Shallow equality is the default, not `Object.is`. A selector that builds an
 * object — `(s) => ({ a: s.a, b: s.b })` — returns a new reference on every
 * call, and `useSyncExternalStore` treats a changed snapshot as a reason to
 * render again, forever: the play screen died of "Maximum update depth
 * exceeded" that way. With shallow comparison that shape is simply correct,
 * and a primitive selector costs the same as before.
 */
export function useSettingsSelector<T>(
  selector: (settings: Settings) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const store = useSettingsStore();
  const lastSelectedRef = useRef<T | undefined>(undefined);

  const getSelected = useCallback(() => {
    const next = selector(store.getSnapshot());
    if (lastSelectedRef.current !== undefined && isEqual(lastSelectedRef.current, next)) {
      return lastSelectedRef.current;
    }
    lastSelectedRef.current = next;
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSelected);
}

export function useSettingsActions() {
  const store = useSettingsStore();
  return {
    update: store.update,
    replaceTapeSet: store.replaceTapeSet,
    resetTapes: store.resetTapes,
    setTrackChoice: store.setTrackChoice,
  };
}

export function useVisionPreferences() {
  const prefs = useSettingsSelector((s) => ({
    vision: s.vision,
    showFingerings: s.showFingerings,
    cueDensity: s.cueDensity,
    boardView: s.boardView,
    highwayAxis: s.highwayAxis,
    tabAxis: s.tabAxis,
    noteOverlay: s.noteOverlay,
    showTapes: s.showTapes,
    scoreColor: s.scoreColor,
    showAlternatePlacements: s.showAlternatePlacements,
    hideControlsWhilePlaying: s.hideControlsWhilePlaying,
  }), shallowEqual);
  const { update } = useSettingsActions();
  return { ...prefs, update };
}

export function useAudioPreferences() {
  const prefs = useSettingsSelector((s) => ({
    listenMode: s.listenMode,
    accompaniment: s.accompaniment,
    backingVolume: s.backingVolume,
    metronome: s.metronome,
    countInBars: s.countInBars,
  }), shallowEqual);
  const { update } = useSettingsActions();
  return { ...prefs, update };
}

export function useTapeSettings() {
  const tapeSets = useSettingsSelector((s) => s.tapeSets);
  const showTapes = useSettingsSelector((s) => s.showTapes);
  const { replaceTapeSet, resetTapes, update } = useSettingsActions();
  return { tapeSets, showTapes, replaceTapeSet, resetTapes, update };
}

export function useTrackChoice(songId: string | undefined): TrackChoice {
  return useSettingsSelector(
    (s) => (songId ? s.trackChoices[songId] : undefined) ?? DEFAULT_TRACK_CHOICE,
    shallowEqual,
  );
}

export function useSettings(): SettingsContextValue {
  const settings = useSettingsSelector((s) => s);
  const store = useSettingsStore();
  const ready = useSyncExternalStore(store.subscribe, store.isReady);

  return useMemo(() => ({
    settings,
    update: store.update,
    replaceTapeSet: store.replaceTapeSet,
    resetTapes: store.resetTapes,
    setTrackChoice: store.setTrackChoice,
    ready,
  }), [settings, store, ready]);
}

