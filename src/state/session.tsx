import React, { createContext, useContext, useMemo, useState } from 'react';

import { ArrangementLevel } from '@domain';

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
  /** Bow/register detail derived from the stored full line. */
  arrangementLevel: ArrangementLevel;
}

const DEFAULTS: PracticeSetup = {
  songId: null,
  loopFromBar: 1,
  loopToBar: 4,
  /**
   * Full tempo.
   *
   * This was 80 %, on the reasoning that a practice app should start you slow.
   * It is the wrong default: opening a song and hearing it at four fifths speed
   * reads as the app being broken rather than as a kindness, and the piece you
   * are trying to recognise is the one at its written tempo. Slowing down is a
   * deliberate act, and the stepper is right there for it.
   */
  tempoPercent: 100,
  arrangementLevel: 'Intermediate',
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
