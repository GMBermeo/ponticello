import { BackingPlayer, NO_PLAYER } from './types';

/**
 * Type anchor and last-resort fallback.
 *
 * Metro resolves `useBackingPlayer.native.ts` on iOS and Android and
 * `useBackingPlayer.web.ts` in a browser, so this file never runs. It exists
 * because TypeScript does not follow platform extensions, and because an
 * unanticipated target should silently have no accompaniment rather than fail
 * to resolve.
 */
export function useBackingPlayer(_enabled: boolean): BackingPlayer {
  return NO_PLAYER;
}
