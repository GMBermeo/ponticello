/** Device-pixel row geometry for a chart whose offscreen lines are virtualized. */
export class ChordSheetLayout {
  private readonly rows = new Map<number, { y: number; height: number }>();
  private cachedOffsets: number[] | undefined;

  constructor(readonly count: number, private readonly estimatedHeight: number, readonly key = '') {}

  record(index: number, y: number, height: number): void {
    if (index >= 0 && index < this.count && Number.isFinite(y) && Number.isFinite(height) && height >= 0) {
      const previous = this.rows.get(index);
      if (previous?.y === y && previous.height === height) return;
      this.rows.set(index, { y, height });
      this.cachedOffsets = undefined;
    }
  }

  /** Interpolate gaps; never treat an unmounted line as y=0 or the chart end. */
  offset(index: number): number {
    const target = Math.max(0, Math.min(this.count, index));
    const exact = this.rows.get(target);
    if (exact) return exact.y;
    let before = -1;
    let after = this.count;
    let totalHeight = 0;
    for (const [row, measurement] of this.rows) {
      totalHeight += measurement.height;
      if (row < target && row > before) before = row;
      if (row > target && row < after) after = row;
    }
    const average = this.rows.size ? totalHeight / this.rows.size : this.estimatedHeight;
    const previous = this.rows.get(before);
    const following = this.rows.get(after);
    const start = previous ? previous.y + previous.height : 0;
    const gap = target - before - 1;
    if (following) {
      return start + Math.max(0, following.y - start) * gap / (after - before - 1);
    }
    return start + gap * average;
  }

  offsets(): number[] {
    return this.cachedOffsets ??= Array.from({ length: this.count }, (_, index) => this.offset(index));
  }
}
