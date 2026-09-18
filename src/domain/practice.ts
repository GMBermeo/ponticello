/**
 * The practice record.
 *
 * One number per calendar day: how many milliseconds the transport actually
 * ran. Nothing else is kept — not which piece, not how well it went — because
 * the only claim this record is allowed to make is *you showed up*, and that
 * is the claim a beginner needs to see. It lives on the phone and goes nowhere.
 *
 * Days are local calendar days, keyed `YYYY-MM-DD`. A practice session that
 * runs past midnight is credited to the day it started, which is how a person
 * thinks about "last night's practice".
 *
 * Pure: no React, no React Native, no storage. See AGENTS.md.
 */

/** Day key → milliseconds practised on that day. */
export type PracticeLog = Record<string, number>;

/** Sessions shorter than this are noise — a mis-tap on play, not practice. */
export const MIN_SESSION_MS = 5_000;

export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateOfKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** `days` before `from`, as a new date at local midnight. */
export function shiftDays(from: Date, days: number): Date {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** Adds a session to the log, returning a new log. Short sessions are dropped. */
export function recordSession(log: PracticeLog, at: Date, ms: number): PracticeLog {
  if (!Number.isFinite(ms) || ms < MIN_SESSION_MS) return log;
  const key = dayKey(at);
  return { ...log, [key]: (log[key] ?? 0) + Math.round(ms) };
}

export function totalMs(log: PracticeLog): number {
  return Object.values(log).reduce((sum, ms) => sum + ms, 0);
}

export function daysPractised(log: PracticeLog): number {
  return Object.values(log).filter((ms) => ms > 0).length;
}

export interface Streaks {
  /** Days in a row up to today. Yesterday still counts — today is not over. */
  current: number;
  longest: number;
}

export function streaks(log: PracticeLog, today: Date): Streaks {
  const days = Object.keys(log).filter((key) => (log[key] ?? 0) > 0).sort();
  if (days.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const previous = dateOfKey(days[i - 1] ?? '');
    const gap = Math.round((dateOfKey(days[i] ?? '').getTime() - previous.getTime()) / 86_400_000);
    run = gap === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // The current streak is counted backwards from today, and allowed to start
  // yesterday: a day with practice still ahead of it is not a broken streak.
  const set = new Set(days);
  let cursor = set.has(dayKey(today)) ? today : shiftDays(today, -1);
  let current = 0;
  while (set.has(dayKey(cursor))) {
    current += 1;
    cursor = shiftDays(cursor, -1);
  }

  return { current, longest };
}

export interface HeatCell {
  key: string;
  date: Date;
  ms: number;
  /** 0 for nothing, then 1–4 by how much, for the four shades of the grid. */
  level: 0 | 1 | 2 | 3 | 4;
  /** True for days after today, which are drawn as holes rather than blanks. */
  future: boolean;
}

/** Minutes at which a cell steps up a shade. Thirty minutes is a full square. */
const LEVEL_MINUTES = [1, 10, 20, 30] as const;

export function heatLevel(ms: number): HeatCell['level'] {
  if (ms <= 0) return 0;
  const minutes = ms / 60_000;
  if (minutes < LEVEL_MINUTES[1]) return 1;
  if (minutes < LEVEL_MINUTES[2]) return 2;
  if (minutes < LEVEL_MINUTES[3]) return 3;
  return 4;
}

export interface HeatGrid {
  /** Columns, oldest first. Each is a Sunday-to-Saturday week of seven cells. */
  weeks: HeatCell[][];
  /** Month labels: the column each month starts in, and its short name. */
  months: { column: number; label: string }[];
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * The contribution-graph grid: `weeks` columns ending with the week that
 * contains `today`, each column running Sunday to Saturday.
 */
export function heatGrid(log: PracticeLog, today: Date, weeks = 27): HeatGrid {
  const endOfWeek = shiftDays(today, 6 - today.getDay());
  const start = shiftDays(endOfWeek, -(weeks * 7 - 1));
  const todayKey = dayKey(today);

  const columns: HeatCell[][] = [];
  const months: { column: number; label: string }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDays(start, w * 7 + d);
      const key = dayKey(date);
      const ms = log[key] ?? 0;
      column.push({ key, date, ms, level: heatLevel(ms), future: key > todayKey });
    }
    // A month is labelled at the first column whose *first* day falls in it.
    const month = column[0]?.date.getMonth() ?? lastMonth;
    if (month !== lastMonth) {
      months.push({ column: w, label: MONTH_NAMES[month] ?? '' });
      lastMonth = month;
    }
    columns.push(column);
  }

  return { weeks: columns, months };
}

/** "1 h 20 m", "45 m", "30 s" — the shortest true reading. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
