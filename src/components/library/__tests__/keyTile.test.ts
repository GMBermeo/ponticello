import { describe, expect, it } from 'vitest';

import { keyTile } from '../keyTile';

describe('keyTile', () => {
  it('reads a major key as its capital tonic', () => {
    expect(keyTile('G major')).toEqual({ letter: 'G', label: 'G' });
  });

  it('keeps the accidental, in either spelling', () => {
    expect(keyTile('D♭ major')).toEqual({ letter: 'D', label: 'D♭' });
    expect(keyTile('F# minor')).toEqual({ letter: 'F', label: 'f♯' });
    expect(keyTile('Bb major')).toEqual({ letter: 'B', label: 'B♭' });
  });

  it('writes a minor key in lower case', () => {
    expect(keyTile('C♯ minor')?.label).toBe('c♯');
    expect(keyTile('Dm')?.label).toBe('d');
  });

  it('ignores case in the mode', () => {
    expect(keyTile('G MAJOR')).toEqual({ letter: 'G', label: 'G' });
  });

  it('has no tile for a row without a key', () => {
    expect(keyTile('Any key')).toBeNull();
    expect(keyTile('')).toBeNull();
  });
});
