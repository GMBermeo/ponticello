import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Platform, Share } from 'react-native';

import {
  createDefaultProgression, createSavedEntry, parseSavedProgressions, parseStoredProgression,
  progressionFileName, upsertSavedEntry, type CustomProgressionData, type SavedProgressionEntry,
} from '@domain';

const DRAFT_KEY = 'ponticello:custom-progression:v1';
const SAVED_KEY = 'ponticello:saved-progressions:v1';
const SAVED_FEEDBACK_MS = 2000;

export type ProgressionStorage = {
  progression: CustomProgressionData;
  setProgression: Dispatch<SetStateAction<CustomProgressionData>>;
  saved: SavedProgressionEntry[];
  /** True for a moment after a save, so the button can say so. */
  justSaved: boolean;
  save: () => void;
  remove: (id: string) => void;
};

function persistSaved(next: SavedProgressionEntry[]): void {
  void AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
}

/**
 * The working draft, kept on the device as it changes, and the list of
 * progressions the player has saved by name.
 */
export function useProgressionStorage(): ProgressionStorage {
  const [progression, setProgression] = useState<CustomProgressionData>(createDefaultProgression);
  const [saved, setSaved] = useState<SavedProgressionEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(DRAFT_KEY), AsyncStorage.getItem(SAVED_KEY)])
      .then(([rawDraft, rawSaved]) => {
        const draft = parseStoredProgression(rawDraft);
        if (draft) setProgression(draft);
        setSaved(parseSavedProgressions(rawSaved));
      })
      .catch((error: unknown) => console.warn('Could not load custom progression:', error))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(progression));
  }, [progression, loaded]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), SAVED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const save = () => {
    const next = upsertSavedEntry(saved, createSavedEntry(progression));
    setSaved(next);
    persistSaved(next);
    setJustSaved(true);
  };

  const remove = (id: string) => {
    const next = saved.filter((entry) => entry.id !== id);
    setSaved(next);
    persistSaved(next);
  };

  return { progression, setProgression, saved, justSaved, save, remove };
}

function downloadOnWeb(fileName: string, json: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Downloads the progression as JSON on web; hands it to the share sheet elsewhere. */
export function exportProgressionJson(data: CustomProgressionData): void {
  const json = JSON.stringify(data, null, 2);
  const fileName = progressionFileName(data.title);
  if (Platform.OS === 'web') downloadOnWeb(fileName, json);
  else void Share.share({ title: fileName, message: json });
}
