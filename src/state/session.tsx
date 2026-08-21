import React, { createContext, useContext, useMemo, useState } from 'react';

/**
 * Practice setup for the current piece.
 *
 * Kept separate from persisted settings because it belongs to one sitting, not
 * to the player: a loop over bars 9–14 at 70% tempo is the right setup for the
 * next twenty minutes and the wrong one to greet you with tomorrow.
 */
export interface PracticeSetup {
  songId: string | null;
  loopFromBar: number;
  loopToBar: number;
  /** Percentage of the written tempo, 40–120. */
  tempoPercent: number;
}

const DEFAULTS: PracticeSetup = {
  songId: null,
  loopFromBar: 1,
  loopToBar: 4,
  tempoPercent: 80,
};

interface SessionContextValue {
  setup: PracticeSetup;
  update: (patch: Partial<PracticeSetup>) => void;
  /** Points the setup at a piece, resetting the loop to its full length. */
  openSong: (songId: string, barCount: number) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [setup, setSetup] = useState<PracticeSetup>(DEFAULTS);

  const value = useMemo<SessionContextValue>(() => ({
    setup,
    update: (patch) => setSetup((current) => ({ ...current, ...patch })),
    openSong: (songId, barCount) => setSetup((current) =>
      current.songId === songId
        ? current
        : { ...DEFAULTS, songId, loopToBar: Math.max(1, barCount) }),
  }), [setup]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
