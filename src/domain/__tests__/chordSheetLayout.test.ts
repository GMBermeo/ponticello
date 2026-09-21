import { describe, expect, it } from 'vitest';
import { ChordSheetLayout } from '../chordSheetLayout';
import { sheetScrollY } from '../chordSheet';

describe('virtualized chord chart geometry', () => {
  it('estimates unmounted rows without jumping to zero or the chart end', () => {
    const layout = new ChordSheetLayout(5, 100);
    layout.record(0, 200, 80);
    layout.record(1, 280, 120);
    expect(layout.offsets()).toEqual([200, 280, 400, 500, 600]);
    expect(layout.offset(5)).toBe(700);
    expect(sheetScrollY(10, [0, 4, 8, 12, 16], layout.offsets(), layout.offset(5), 20)).toBe(450);
  });

  it('interpolates gaps using actual cells after a distant manual scroll', () => {
    const layout = new ChordSheetLayout(6, 100);
    layout.record(0, 200, 100);
    layout.record(4, 900, 200);
    expect(layout.offsets()).toEqual([200, 300, 500, 700, 900, 1100]);
    expect(layout.offset(6)).toBe(1250);
  });

  it('retains measured geometry after cells unmount and refreshes changed heights', () => {
    const layout = new ChordSheetLayout(3, 100);
    layout.record(0, 200, 100);
    const first = layout.offsets();
    expect(layout.offsets()).toBe(first);
    layout.record(0, 200, 100);
    expect(layout.offsets()).toBe(first);
    layout.record(0, 200, 300);
    expect(layout.offsets()).toEqual([200, 500, 800]);
    layout.record(1, 500, 60);
    layout.record(2, 560, 40);
    expect(layout.offset(3)).toBe(600);
    expect(sheetScrollY(12, [0, 4, 8], layout.offsets(), layout.offset(3), 12)).toBe(600);
  });

  it('starts fresh for a different width/mode and handles empty charts', () => {
    const old = new ChordSheetLayout(2, 100);
    old.record(0, 200, 600);
    const resized = new ChordSheetLayout(2, 100);
    expect(resized.offsets()).toEqual([0, 100]);
    expect(new ChordSheetLayout(0, 100).offset(0)).toBe(0);
    resized.record(0, NaN, 10);
    resized.record(1, 10, -1);
    expect(resized.offsets()).toEqual([0, 100]);
  });
});
