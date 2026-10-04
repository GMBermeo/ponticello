import { describe, expect, it } from 'vitest';
import { dialectSuffixes, identifyByKeyboard, simplifyByKeyboard, splitChordSymbol, withoutExtension } from '../chordDialect';
import { interpretSheetChord } from '../chordSheet';

describe('chart dialect', () => {
  it('splits a symbol into root, suffix and bass', () => {
    expect(splitChordSymbol('Bb7(9-)/D')).toEqual({ root: 'Bb', suffix: '7(9-)', bass: 'D' });
    expect(splitChordSymbol('not a chord')).toBeNull();
  });

  it('rewrites Cifra Club spellings into dictionary spellings', () => {
    expect(dialectSuffixes('7(9-)')).toContain('7b9');
    expect(dialectSuffixes('m7(5-)')).toContain('m7b5');
    expect(dialectSuffixes('m7/5-')).toContain('m7b5');
    expect(dialectSuffixes('7(4)')).toContain('7sus4');
    expect(dialectSuffixes('m7M')).toContain('mMaj7');
    expect(dialectSuffixes('5+')).toContain('aug');
    expect(dialectSuffixes('m6/9')).toContain('m69');
  });

  it('never leaves an accidental at the front of a suffix, which would read as part of the root', () => {
    expect(dialectSuffixes('9-').some((suffix) => suffix.startsWith('b'))).toBe(false);
  });

  it('names a chord from its keyboard diagram when the spelling is unknown', () => {
    expect(identifyByKeyboard('D4(6/9)/B', [11, 2, 4, 7, 9])).toBe('Dsus24/B');
    expect(identifyByKeyboard('Bº', [11, 2, 5, 8])).toBe('Bdim7');
    expect(identifyByKeyboard('C', [0])).toBeNull();
  });

  it('prefers the familiar name when two spell the same notes', () => {
    expect(identifyByKeyboard('F7M(5+)', [5, 9, 1, 4])).toBe('Fmaj7#5');
  });

  it('simplifies an extension the dictionary has no shape for, keeping a full triad', () => {
    expect(simplifyByKeyboard('F#7(11)', [6, 10, 11, 1, 4])).toBe('F#7');
    expect(simplifyByKeyboard('C', [0, 1, 4])).toBeNull();
  });

  it('drops a harmless extension but never one that changes the fifth', () => {
    expect(withoutExtension('E7(2)')).toBe('E7');
    expect(withoutExtension('Gm7(5-/9-)')).toBeNull();
    expect(withoutExtension('E7')).toBeNull();
  });
});

describe('interpreting real chart symbols', () => {
  it.each([
    ['Bº', [11, 2, 5, 8], 'Bdim7'],
    ['Cdim', [0, 3, 6, 9], 'Cdim7'],
    ['Dm5-', [2, 5, 8], 'Ddim'],
    ['G5', [7, 11, 2], 'G5'],
    ['A7(4)', [9, 2, 4, 7], 'A7sus4'],
    ['Bm7(11)', [11, 2, 4, 6, 9], 'Bm7add11'],
    ['Bm7/5-', [11, 2, 5, 9], 'Bm7b5'],
    ['F#7+', [6, 10, 1, 5], 'F#maj7'],
    ['Am7+', [9, 0, 4, 8], 'AmMaj7'],
    ['G#°/D', [2, 5, 8, 11], 'G#dim7/D'],
  ])('%s reads as %s', (symbol, pitchClasses, canonical) => {
    expect(interpretSheetChord(symbol, pitchClasses).canonical).toBe(canonical);
  });

  it('reads a symbol with no keyboard diagram from its spelling alone', () => {
    expect(interpretSheetChord('Am6/9').canonical).toBe('Am69');
    expect(interpretSheetChord('C(5+)').canonical).toBe('Caug');
    expect(interpretSheetChord('Bmb5').canonical).toBe('Bdim');
  });

  it('says so when it simplifies', () => {
    const chord = interpretSheetChord('F#7(11)', [6, 10, 11, 1, 4]);
    expect(chord.canonical).toBe('F#7');
    expect(chord.interpretation).toMatch(/^Simplified/);
  });

  it('still refuses a chord its own diagram contradicts', () => {
    expect(interpretSheetChord('C', [0, 1, 4]).canonical).toBeNull();
    expect(interpretSheetChord('F#m-F#m-G').canonical).toBeNull();
    expect(interpretSheetChord('G5-(9/13)').canonical).toBeNull();
  });
});
