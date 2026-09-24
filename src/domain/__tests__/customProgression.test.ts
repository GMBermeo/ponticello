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
  countChords,
  END_OF_ROW,
  MAX_PROGRESSION_BPM,
  MIN_PROGRESSION_BPM,
  msPerChord,
  parseProgressionBpm,
  parseSavedProgressions,
  parseStoredProgression,
  progressionFileName,
  upsertSavedEntry,
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


describe('progression helpers', () => {
  it('counts chords across every row', () => {
    const prog = createDefaultProgression();
    expect(countChords(prog)).toBe(prog.rows.reduce((total, row) => total + row.chords.length, 0));
  });

  it('moves a chord to the end of another row with END_OF_ROW', () => {
    const prog = addRow(createDefaultProgression());
    const symbol = prog.rows[0].chords[0].symbol;
    const moved = moveChordBetweenRows(prog, 0, 0, 1, END_OF_ROW);
    expect(moved.rows[1].chords.at(-1)?.symbol).toBe(symbol);
  });

  it('accepts BPM at both bounds and rejects outside them', () => {
    expect([MIN_PROGRESSION_BPM - 1, MIN_PROGRESSION_BPM, MAX_PROGRESSION_BPM, MAX_PROGRESSION_BPM + 1]
      .map((bpm) => parseProgressionBpm(String(bpm))))
      .toEqual([null, MIN_PROGRESSION_BPM, MAX_PROGRESSION_BPM, null]);
  });

  it('rejects BPM text that is not a number', () => {
    expect(parseProgressionBpm('slow')).toBeNull();
  });

  it('times one chord as beats at the tempo, scaled by speed', () => {
    expect(msPerChord(60, 2, 4)).toBe(2000);
  });

  it('never plays slower than the minimum tempo', () => {
    expect(msPerChord(1, 1, 1)).toBe(msPerChord(MIN_PROGRESSION_BPM, 1, 1));
  });

  it('replaces a saved entry with the same title, ignoring case', () => {
    const first = createSavedEntry({ ...createDefaultProgression(), title: 'Warm up' });
    const second = createSavedEntry({ ...createDefaultProgression(), title: 'WARM UP' });
    expect(upsertSavedEntry([first], second)).toEqual([second]);
  });

  it('puts a newly titled entry first', () => {
    const first = createSavedEntry({ ...createDefaultProgression(), title: 'One' });
    const second = createSavedEntry({ ...createDefaultProgression(), title: 'Two' });
    expect(upsertSavedEntry([first], second).map((entry) => entry.title)).toEqual(['Two', 'One']);
  });

  it('gives saved entries distinct ids even when created together', () => {
    const prog = createDefaultProgression();
    expect(createSavedEntry(prog).id).not.toBe(createSavedEntry(prog).id);
  });

  it('makes a safe file name from a title', () => {
    expect(progressionFileName('My Song: Take 2')).toBe('my_song__take_2.json');
  });

  it('names an untitled export "progression"', () => {
    expect(progressionFileName('')).toBe('progression.json');
  });

  it('reads back a stored draft', () => {
    const prog = createDefaultProgression();
    expect(parseStoredProgression(JSON.stringify(prog))).toEqual(prog);
  });

  it('ignores stored text that is not a progression', () => {
    expect([parseStoredProgression(null), parseStoredProgression('{"title":"x"}')]).toEqual([null, null]);
  });

  it('reads an empty saved list from missing or malformed storage', () => {
    expect([parseSavedProgressions(null), parseSavedProgressions('{}')]).toEqual([[], []]);
  });
});
