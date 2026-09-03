import { describe, expect, it } from 'vitest';

import { backingTransportDecision, BackingTransportState } from '../transport';

const READY: BackingTransportState = {
  requested: true,
  wouldSound: true,
  withinBudget: true,
  loadedProgramKey: 'current',
  programKey: 'current',
  playerReady: true,
  playerError: null,
};

describe('backing transport decision', () => {
  it('starts only when the exact requested program is ready', () => {
    expect(backingTransportDecision(READY)).toBe('start');
    expect(backingTransportDecision({
      ...READY,
      loadedProgramKey: 'outgoing',
    })).toBe('wait');
  });

  it('clears audio but releases visual practice for a silent program', () => {
    expect(backingTransportDecision({
      ...READY,
      wouldSound: false,
      loadedProgramKey: 'outgoing',
    })).toBe('visual-only');
  });

  it('waits while sounding content is loading', () => {
    expect(backingTransportDecision({
      ...READY,
      loadedProgramKey: null,
      playerReady: false,
    })).toBe('wait');
  });

  it('keeps visual practice available when the current adapter fails', () => {
    expect(backingTransportDecision({
      ...READY,
      playerReady: false,
      playerError: 'Audio device unavailable',
    })).toBe('visual-only');
  });

  it('halts both transports when playback is not requested', () => {
    expect(backingTransportDecision({ ...READY, requested: false })).toBe('halt');
  });
});
