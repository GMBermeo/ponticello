import { describe, expect, it } from 'vitest';

import type { CelloChordStudy, SheetEvent } from '@domain';

import {
  MAX_BPM, MAX_SPEED, MIN_BPM, MIN_SPEED, parseBpm, readingScrollOffset, stepSpeed, upcomingChords,
} from '../chordReader';

const event = (symbol: string, beat: number): SheetEvent => ({ lineIndex: 0, changeIndex: beat, symbol, beat });
const EVENTS = [event('C', 0), event('G', 4), event('Am', 8)];
const STUDY_C = { symbol: 'C' } as CelloChordStudy;
const STUDIES = new Map<string, CelloChordStudy | null>([['C', STUDY_C], ['G', null]]);

describe('upcomingChords', () => {
  it('returns the active chord first, then the ones after it', () => {
    expect(upcomingChords(EVENTS, STUDIES, 0, 2).map((chord) => chord.symbol)).toEqual(['C', 'G']);
  });

  it('pairs each chord with its study', () => {
    expect(upcomingChords(EVENTS, STUDIES, 0, 1)[0]?.study).toBe(STUDY_C);
  });

  it('leaves slots past the end of the chart empty', () => {
    expect(upcomingChords(EVENTS, STUDIES, 2, 3).map((chord) => chord.symbol)).toEqual(['Am', undefined, undefined]);
  });
});

describe('parseBpm', () => {
  it('accepts the range bounds', () => {
    expect([parseBpm(String(MIN_BPM)), parseBpm(String(MAX_BPM))]).toEqual([MIN_BPM, MAX_BPM]);
  });

  it('rejects values outside the range', () => {
    expect([parseBpm(String(MIN_BPM - 1)), parseBpm(String(MAX_BPM + 1))]).toEqual([null, null]);
  });

  it('rejects text that is not a number', () => {
    expect(parseBpm('fast')).toBeNull();
  });
});

describe('stepSpeed', () => {
  it('moves by a tenth, rounded to whole percent', () => {
    expect(stepSpeed(1, 1)).toBeCloseTo(1.1, 10);
  });

  it('never goes below the minimum', () => {
    expect(stepSpeed(MIN_SPEED, -1)).toBe(MIN_SPEED);
  });

  it('never goes above the maximum', () => {
    expect(stepSpeed(MAX_SPEED, 1)).toBe(MAX_SPEED);
  });
});

describe('readingScrollOffset', () => {
  it('puts the reading line a quarter of the way down the unpinned area', () => {
    expect(readingScrollOffset({ desired: 500, viewportHeight: 400, pinnedHeight: 0, contentHeight: 2000 })).toBe(400);
  });

  it('never scrolls above the top', () => {
    expect(readingScrollOffset({ desired: 10, viewportHeight: 400, pinnedHeight: 100, contentHeight: 2000 })).toBe(0);
  });

  it('never scrolls past the end of the content', () => {
    expect(readingScrollOffset({ desired: 5000, viewportHeight: 400, pinnedHeight: 0, contentHeight: 1000 })).toBe(600);
  });
});
