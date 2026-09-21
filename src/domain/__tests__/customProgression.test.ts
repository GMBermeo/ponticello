import { describe, expect, it } from 'vitest';
import {
  addChordToRow,
  addRow,
  applyPreset,
  createDefaultProgression,
  createSavedEntry,
  flattenProgression,
  getRomanDegree,
  moveChordBetweenRows,
  moveChordWithinRow,
  removeChord,
  removeRow,
} from '../customProgression';

describe('custom progression domain', () => {
  it('creates default progression with 4 chords in C major', () => {
    const prog = createDefaultProgression();
    expect(prog.keyRoot).toBe('C');
    expect(prog.keyScale).toBe('major');
    expect(prog.rows).toHaveLength(2);
    expect(prog.rows[0].chords).toHaveLength(2);
    expect(prog.rows[1].chords).toHaveLength(2);
  });

  it('flattens progression and assigns nextChord in cyclic sequence', () => {
    const prog = createDefaultProgression(); // C, G, Am, F
    const flattened = flattenProgression(prog);
    expect(flattened).toHaveLength(4);

    expect(flattened[0].item.symbol).toBe('C');
    expect(flattened[0].nextChord?.symbol).toBe('G');

    expect(flattened[1].item.symbol).toBe('G');
    expect(flattened[1].nextChord?.symbol).toBe('Am');

    expect(flattened[2].item.symbol).toBe('Am');
    expect(flattened[2].nextChord?.symbol).toBe('F');

    // Last chord loops back to the first!
    expect(flattened[3].item.symbol).toBe('F');
    expect(flattened[3].nextChord?.symbol).toBe('C');
  });

  it('calculates roman degrees for keys', () => {
    expect(getRomanDegree('C', 'C', 'major')).toBe('I');
    expect(getRomanDegree('Dm', 'C', 'major')).toBe('ii');
    expect(getRomanDegree('G', 'C', 'major')).toBe('V');
    expect(getRomanDegree('Am', 'C', 'major')).toBe('vi');
    expect(getRomanDegree('Bdim', 'C', 'major')).toBe('vii°');
  });

  it('adds and removes chords from rows', () => {
    let prog = createDefaultProgression();
    prog = addChordToRow(prog, 0, 'Em');
    expect(prog.rows[0].chords).toHaveLength(3);
    expect(prog.rows[0].chords[2].symbol).toBe('Em');
    expect(prog.rows[0].chords[2].degree).toBe('iii');

    prog = removeChord(prog, 0, 1); // remove G
    expect(prog.rows[0].chords).toHaveLength(2);
    expect(prog.rows[0].chords[0].symbol).toBe('C');
    expect(prog.rows[0].chords[1].symbol).toBe('Em');
  });

  it('moves chords within and between rows', () => {
    let prog = createDefaultProgression(); // row 0: [C, G], row 1: [Am, F]
    prog = moveChordWithinRow(prog, 0, 0, 1); // swap C and G
    expect(prog.rows[0].chords[0].symbol).toBe('G');
    expect(prog.rows[0].chords[1].symbol).toBe('C');

    // move Am from row 1 (index 0) to row 0 (index 1)
    prog = moveChordBetweenRows(prog, 1, 0, 0, 1);
    expect(prog.rows[0].chords.map((c) => c.symbol)).toEqual(['G', 'Am', 'C']);
    expect(prog.rows[1].chords.map((c) => c.symbol)).toEqual(['F']);
  });

  it('adds and removes rows safely', () => {
    let prog = createDefaultProgression();
    prog = addRow(prog, 'Bridge');
    expect(prog.rows).toHaveLength(3);
    expect(prog.rows[2].label).toBe('Bridge');

    prog = removeRow(prog, 2);
    expect(prog.rows).toHaveLength(2);
  });

  it('applies popular progression presets', () => {
    const pop = applyPreset('pop-axis');
    expect(pop.keyRoot).toBe('C');
    const flat = flattenProgression(pop);
    expect(flat.map((f) => f.item.symbol)).toEqual(['C', 'G', 'Am', 'F']);

    const blues = applyPreset('blues-12-bar');
    expect(blues.keyRoot).toBe('G');
    const flatBlues = flattenProgression(blues);
    expect(flatBlues).toHaveLength(12);
  });

  it('creates saved entry with valid metadata and title fallback', () => {
    const prog = createDefaultProgression();
    const entry = createSavedEntry(prog);
    expect(entry.id).toMatch(/^saved-/);
    expect(entry.title).toBe('My Chord Progression');
    expect(entry.keyRoot).toBe('C');
    expect(entry.keyScale).toBe('major');
    expect(entry.savedAt).toBeDefined();

    const emptyTitleProg = { ...prog, title: '   ' };
    const fallbackEntry = createSavedEntry(emptyTitleProg);
    expect(fallbackEntry.title).toBe('Untitled Progression');
  });
});

