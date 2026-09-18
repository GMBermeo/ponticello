import { describe, expect, it } from 'vitest';

import {
  dayKey, daysPractised, formatDuration, heatGrid, heatLevel, MIN_SESSION_MS, PracticeLog,
  recordSession, shiftDays, streaks, totalMs,
} from '../practice';

const AT = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

const minutes = (n: number) => n * 60_000;

describe('recording a session', () => {
  it('credits the day it started, in local time', () => {
    const log = recordSession({}, AT('2026-09-17'), minutes(20));
    expect(log).toEqual({ '2026-09-17': minutes(20) });
  });

  it('adds to a day that already has practice', () => {
    const first = recordSession({}, AT('2026-09-17'), minutes(20));
    const second = recordSession(first, AT('2026-09-17'), minutes(5));
    expect(second['2026-09-17']).toBe(minutes(25));
    // Immutable: the caller's log is untouched.
    expect(first['2026-09-17']).toBe(minutes(20));
  });

  it('ignores a mis-tap on play', () => {
    const log = recordSession({}, AT('2026-09-17'), MIN_SESSION_MS - 1);
    expect(log).toEqual({});
  });

  it('ignores nonsense rather than poisoning the total', () => {
    expect(recordSession({}, AT('2026-09-17'), Number.NaN)).toEqual({});
    expect(recordSession({}, AT('2026-09-17'), -5000)).toEqual({});
  });
});

describe('totals', () => {
  const log: PracticeLog = {
    '2026-09-15': minutes(10),
    '2026-09-16': minutes(30),
    '2026-09-17': minutes(5),
  };

  it('sums every day', () => {
    expect(totalMs(log)).toBe(minutes(45));
    expect(daysPractised(log)).toBe(3);
  });

  it('writes the shortest true reading', () => {
    expect(formatDuration(30_000)).toBe('30 s');
    expect(formatDuration(minutes(45))).toBe('45 m');
    expect(formatDuration(minutes(60))).toBe('1 h');
    expect(formatDuration(minutes(80))).toBe('1 h 20 m');
  });
});

describe('streaks', () => {
  it('counts consecutive days up to today', () => {
    const log = {
      '2026-09-15': minutes(10),
      '2026-09-16': minutes(10),
      '2026-09-17': minutes(10),
    };
    expect(streaks(log, AT('2026-09-17'))).toEqual({ current: 3, longest: 3 });
  });

  it('does not break the streak before today is over', () => {
    const log = { '2026-09-15': minutes(10), '2026-09-16': minutes(10) };
    expect(streaks(log, AT('2026-09-17')).current).toBe(2);
  });

  it('breaks once a whole day has been missed', () => {
    const log = { '2026-09-14': minutes(10), '2026-09-15': minutes(10) };
    expect(streaks(log, AT('2026-09-17')).current).toBe(0);
    expect(streaks(log, AT('2026-09-17')).longest).toBe(2);
  });

  it('remembers the longest run even after it ends', () => {
    const log = {
      '2026-08-01': minutes(10),
      '2026-08-02': minutes(10),
      '2026-08-03': minutes(10),
      '2026-08-04': minutes(10),
      '2026-09-17': minutes(10),
    };
    expect(streaks(log, AT('2026-09-17'))).toEqual({ current: 1, longest: 4 });
  });

  it('says nothing about an empty record', () => {
    expect(streaks({}, AT('2026-09-17'))).toEqual({ current: 0, longest: 0 });
  });
});

describe('the heat grid', () => {
  const today = AT('2026-09-17');

  it('is seven rows by however many weeks were asked for', () => {
    const grid = heatGrid({}, today, 10);
    expect(grid.weeks).toHaveLength(10);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('runs Sunday to Saturday and ends with the week containing today', () => {
    const grid = heatGrid({}, today, 4);
    const last = grid.weeks[grid.weeks.length - 1];
    expect(last[0].date.getDay()).toBe(0);
    expect(last.some((cell) => cell.key === dayKey(today))).toBe(true);
  });

  it('marks days after today as future, not as blank days', () => {
    const grid = heatGrid({}, today, 4);
    const cells = grid.weeks.flat();
    expect(cells.filter((cell) => cell.future).every((cell) => cell.key > dayKey(today))).toBe(true);
    expect(cells.find((cell) => cell.key === dayKey(today))?.future).toBe(false);
  });

  it('steps the shade with the minutes practised', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(minutes(5))).toBe(1);
    expect(heatLevel(minutes(15))).toBe(2);
    expect(heatLevel(minutes(25))).toBe(3);
    expect(heatLevel(minutes(45))).toBe(4);
  });

  it('puts each day of practice in its own square', () => {
    const grid = heatGrid({ [dayKey(shiftDays(today, -3))]: minutes(40) }, today, 4);
    const lit = grid.weeks.flat().filter((cell) => cell.ms > 0);
    expect(lit).toHaveLength(1);
    expect(lit[0].level).toBe(4);
  });

  it('labels a month over the column it begins in', () => {
    const grid = heatGrid({}, today, 27);
    expect(grid.months.length).toBeGreaterThan(1);
    expect(grid.months[0].column).toBe(0);
  });
});
