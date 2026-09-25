import { describe, expect, it } from 'vitest';
import {
  beatAtTime, eventAtBeat, interpretSheetChord, sheetLineSegments, sheetScrollY, sheetTimeline,
  validateChordSheet, parseChordPro, chordsInScale, scaleNotes,
} from '@domain';
import { CHORD_SHEETS, mergeChordLibrary } from '../chordSheets';
import type { LibraryRow } from '..';

describe('scale chord membership', () => {
  it('labels scale degrees with chord quality and extensions, updating with the key', () => {
    const degree = (key: string, root: string, id: string, scale: 'major' | 'harmonic' = 'major') =>
      chordsInScale(key, scale).find((chord) => chord.root === root && chord.type.id === id)?.romanDegree;
    expect(degree('C', 'C', '')).toBe('I');
    expect(degree('G', 'C', '')).toBe('IV');
    expect(degree('C', 'A', 'm')).toBe('vi');
    expect(degree('C', 'D', 'm7')).toBe('ii7');
    expect(degree('C', 'G', '7')).toBe('V7');
    expect(degree('C', 'F', 'maj7')).toBe('IVmaj7');
    expect(degree('C', 'B', 'dim')).toBe('vii°');
    expect(degree('C', 'B', 'm7b5')).toBe('viiø7');
    expect(degree('F#', 'E#', 'dim')).toBe('vii°');
    expect(degree('A', 'C', 'aug', 'harmonic')).toBe('III+');
    expect(degree('A', 'A', 'm/ma7', 'harmonic')).toBe('imaj7');
    expect(chordsInScale('C', 'all').every((chord) => chord.romanDegree === null)).toBe(true);
  });
  it('shows major triads first, then minor and diminished chords within C major', () => {
    const rows = chordsInScale('C', 'major', 'triads');
    expect(rows.slice(0, 3).map((r) => `${r.root}${r.type.id}`)).toEqual(['C', 'F', 'G']);
    for (const symbol of ['Dm', 'Em', 'Am', 'Bdim']) expect(rows.some((r) => `${r.root}${r.type.id}` === symbol)).toBe(true);
    expect(rows.some((r) => r.root === 'C' && r.type.id === 'm')).toBe(false);
    expect(chordsInScale('D', 'major', 'sevenths').slice(0, 2).map((r) => `${r.root}${r.type.id}`)).toEqual(['Dmaj7', 'Gmaj7']);
  });
  it('filters by full extensions and spells notes from the selected scale', () => {
    const rows = chordsInScale('C', 'major');
    expect(rows.some((r) => r.root === 'C' && r.type.id === 'maj9')).toBe(true);
    expect(rows.some((r) => r.root === 'C' && r.type.id === '9')).toBe(false);
    expect(scaleNotes('F#', 'major')).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
    expect(chordsInScale('A', 'minor', 'triads', 'degree')[0].root).toBe('A');
    expect(chordsInScale('C', 'all', 'all', 'basic', true).every((r) => r.shapes > 0)).toBe(true);
    expect(chordsInScale('C', 'all')).toHaveLength(1272);
  });
});

describe('chord sheets and scrolling', () => {
  const sheet = parseChordPro('{title: Study}\n{artist: Ponticello}\n{tempo: 90}\n[C]One [G/B]two [Am7]three [G]four [F]five [Dm7]six [G7]seven.\n[C]Home.', 'study');
  it('preserves all lyric characters and all seven chord anchors when wrapping', () => {
    const parts = sheetLineSegments(sheet.lines[0]);
    expect(parts.map((p) => p.lyric).join('')).toBe('One two three four five six seven.');
    expect(parts.filter((p) => p.chord)).toHaveLength(7);
    expect(parts[1].chord?.symbol).toBe('G/B');
    expect(sheet.lines[0].changes[1].column).toBe(4);
    expect(sheet.bpm).toBe(90);
  });
  it('uses anchored time, preserves position on a rate change, and never accumulates frame errors', () => {
    expect(beatAtTime(0, 1000, 3000, 120, 1)).toBe(4);
    const heldBeat = beatAtTime(0, 1000, 2000, 120, 1);
    expect(beatAtTime(heldBeat, 2000, 3000, 120, 0.5)).toBe(3);
    expect(beatAtTime(5, 1000, 900, 90, 1)).toBe(5);
    expect(beatAtTime(0, 0, 3600000, 120, 1)).toBe(7200);
  });
  it('advances every event, including dense phrases, and follows measured row positions', () => {
    const timeline = sheetTimeline(sheet);
    expect(timeline.events).toHaveLength(8);
    expect(eventAtBeat(timeline.events, -1)).toBe(-1);
    timeline.events.forEach((event, i) => expect(eventAtBeat(timeline.events, event.beat)).toBe(i));
    expect(sheetScrollY(4, [0, 8], [20, 220], 320, 12)).toBe(120);
    expect(sheetScrollY(99, [0, 8], [20, 220], 320, 12)).toBe(320);
  });
  it('keeps source labels separate from keyboard-derived interpretations', () => {
    expect(interpretSheetChord('G7M').canonical).toBe('Gmaj7');
    expect(interpretSheetChord('G5/D', [2, 7, 11]).canonical).toBe('G/D');
    expect(interpretSheetChord('C9', [0, 2, 4]).canonical).toBe('Cadd9');
    expect(interpretSheetChord('C9', [0, 2, 4, 7, 10]).canonical).toBe('C9');
    expect(interpretSheetChord('G4').canonical).toBe('Gsus4');
    expect(interpretSheetChord('C', [0, 1, 4]).canonical).toBeNull();
  });
  it('adds chart-only songs while keeping score/chart pairs under a single ID', () => {
    const scoreRow: LibraryRow = { id: 'study', title: 'Study', composer: 'Ponticello', origin: 'ARRANGED', category: 'song', playable: true, keySignature: 'C', range: 'C2', tempo: '90', difficulty: 'Beginner', bars: 4, distribution: [], note: '' };
    const result = mergeChordLibrary([scoreRow], [sheet, { ...sheet, id: 'standalone' }]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(scoreRow);
    expect(result[1].id).toBe('standalone');
    expect(result[1].playable).toBe(false);
  });
  it('validates imported charts and retains seven-change phrases', () => {
    CHORD_SHEETS.forEach(validateChordSheet);
    const fresno = CHORD_SHEETS.find((s) => s.id === 'fresno-sexto-andar');
    if (fresno) {
      expect(fresno.instrument).toBe('keyboard');
      expect(fresno.chords).toHaveLength(12);
      expect(fresno.lines.some((l) => l.changes.length === 7)).toBe(true);
      if (fresno.lyrics === 'omitted') {
        expect(fresno.lines.filter((l) => l.kind === 'lyric').every((l) => l.text === '')).toBe(true);
      } else {
        expect(fresno.lyrics).toBe('included');
        expect(fresno.lines.filter((l) => l.kind === 'lyric').some((l) => l.text.length > 0)).toBe(true);
      }
      expect(fresno.bpm).toBeNull();
      expect(fresno.chords.every((c) => c.canonical !== null)).toBe(true);
    }
    const study = CHORD_SHEETS.find((s) => s.id === 'ponticello-seven-changes');
    if (study) {
      expect(study.instrument).toBe('chordpro');
      expect(study.lines.some((l) => l.changes.length === 7)).toBe(true);
    }
  });
  it('rejects invalid anchors and malformed imported data', () => {
    expect(() => validateChordSheet({ ...sheet, bpm: 0 })).toThrow();
    expect(() => parseChordPro('{tempo: nope}\n[C]Home.', 'study')).toThrow();
    expect(() => validateChordSheet({ ...sheet, lines: [{ ...sheet.lines[0], changes: [{ symbol: 'C', column: -1, beat: 0 }] }] })).toThrow();
  });
});
