import { describe, expect, it } from 'vitest';

import { OPEN_STRING_MIDI, STRING_ORDER } from '../cello';
import {
  isAccidental, lettersForPitchClass, NOTE_COLOR, noteColorName, noteColorNames,
  NOTE_LETTERS, STRING_NOTE_COLOR,
} from '../noteColors';

describe('the note colour constant', () => {
  it('fixes the four open strings: C green, G red, D blue, A yellow', () => {
    expect(NOTE_COLOR.C).toBe('green');
    expect(NOTE_COLOR.G).toBe('red');
    expect(NOTE_COLOR.D).toBe('blue');
    expect(NOTE_COLOR.A).toBe('yellow');
  });

  it('fills the three gaps without reusing a colour', () => {
    const colors = NOTE_LETTERS.map((letter) => NOTE_COLOR[letter]);
    expect(new Set(colors).size).toBe(NOTE_LETTERS.length);
  });

  it('colours a string as the note it sounds open', () => {
    for (const string of STRING_ORDER) {
      expect(STRING_NOTE_COLOR[string]).toBe(NOTE_COLOR[string]);
      expect(noteColorName(OPEN_STRING_MIDI[string])).toBe(NOTE_COLOR[string]);
    }
  });
});

describe('accidentals take both neighbours', () => {
  it('splits a black key between the letters either side of it', () => {
    expect(lettersForPitchClass(1)).toEqual(['C', 'D']);   // C♯ / D♭
    expect(lettersForPitchClass(6)).toEqual(['F', 'G']);   // F♯ / G♭
    expect(noteColorNames(1)).toEqual(['green', 'blue']);
  });

  it('gives a natural exactly one colour', () => {
    for (const pc of [0, 2, 4, 5, 7, 9, 11]) {
      expect(noteColorNames(pc)).toHaveLength(1);
      expect(isAccidental(pc)).toBe(false);
    }
    for (const pc of [1, 3, 6, 8, 10]) {
      expect(isAccidental(pc)).toBe(true);
    }
  });

  it('reads any MIDI number, octave and sign included', () => {
    expect(noteColorName(60)).toBe(NOTE_COLOR.C);
    expect(noteColorNames(-11)).toEqual(noteColorNames(1));
  });
});
