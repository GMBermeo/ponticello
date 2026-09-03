export type BackingTransportDecision = 'halt' | 'visual-only' | 'wait' | 'start';

export interface BackingTransportState {
  requested: boolean;
  wouldSound: boolean;
  withinBudget: boolean;
  loadedProgramKey: string | null;
  programKey: string;
  playerReady: boolean;
  playerError: string | null;
}

/**
 * Decide who may advance the shared transport.
 *
 * The exact program key matters as much as adapter readiness: an adapter can
 * still report ready while a replacement is in its debounce/render window.
 * Starting then would replay the outgoing passage. Silence and adapter errors
 * intentionally release the visual clock so practice remains usable.
 */
export function backingTransportDecision(
  state: BackingTransportState,
): BackingTransportDecision {
  if (!state.requested) return 'halt';

  const currentProgramLoaded = state.loadedProgramKey === state.programKey;
  if (!state.wouldSound || !state.withinBudget
    || (currentProgramLoaded && state.playerError !== null)) {
    return 'visual-only';
  }

  if (currentProgramLoaded && state.playerReady) return 'start';
  return 'wait';
}
