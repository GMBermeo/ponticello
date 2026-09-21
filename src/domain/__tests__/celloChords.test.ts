import { describe, expect, it } from 'vitest';
import * as Note from '@tonaljs/note';
import * as ChordType from '@tonaljs/chord-type';
import { CELLO_CHORD_LIBRARY, CELLO_CHORD_ROOTS, CELLO_CHORD_TYPES, createCelloChord, getCelloChord, getCelloChordByType } from '../celloChords';
import { OPEN_STRING_MIDI, STRING_ORDER, stopDistanceMm } from '../cello';
import { CHORD_FRAMES } from '../chords/shapeSearch';
import { celloChordSvg, chordDiagramModel, chordTapeMarkerColors } from '../chords/diagram';
import { DEFAULT_TAPE_SETS } from '../tapes';

describe('cello chord catalogue', () => {
  it('covers every installed dictionary type at all twelve roots', () => {
    expect(CELLO_CHORD_TYPES).toHaveLength(ChordType.all().length);
    expect(Object.keys(CELLO_CHORD_LIBRARY)).toHaveLength(CELLO_CHORD_TYPES.length * 12);
    for (const type of CELLO_CHORD_TYPES) {
      for (const root of CELLO_CHORD_ROOTS) {
        const chord = getCelloChordByType(root, type.id);
        expect(chord.tones.map((t) => t.name)).toEqual(type.intervals.map((i) => Note.transpose(root, i)));
        expect(chord.arpeggio).toHaveLength(chord.tones.length);
        const rootMidi = 36 + Note.chroma(root)!;
        chord.arpeggio.forEach((note, i) => {
          expect(note.midi).toBe(rootMidi + type.semitones[i]);
          expect(note.midi).toBe(OPEN_STRING_MIDI[note.string] + note.semitones);
          expect(note.marker).toBe(note.tone.isRoot ? 'square' : 'circle');
          if (note.finger === '0') expect(note.semitones).toBe(0);
          else expect(note.semitones).toBe(note.anchor + CHORD_FRAMES[note.frame][Number(note.finger) - 1]);
        });
      }
    }
  });

  it('every stored grip obeys tuning, bow adjacency, a shared hand frame, and exact omissions', () => {
    for (const entry of Object.values(CELLO_CHORD_LIBRARY)) {
      const root = CELLO_CHORD_ROOTS[entry.rootPitchClass];
      const chord = getCelloChordByType(root, entry.typeId);
      expect(new Set(chord.voicings.map((v) => v.id)).size).toBe(chord.voicings.length);
      chord.voicings.forEach((voicing, index) => {
        const shape = entry.shapes[index];
        expect(voicing.notes.length).toBeGreaterThanOrEqual(2);
        expect(voicing.notes.length).toBeLessThanOrEqual(4);
        expect(voicing.notes.some((n) => n.tone.isRoot)).toBe(true);
        expect(new Set(voicing.notes.map((n) => n.string)).size).toBe(voicing.notes.length);
        const strings = voicing.notes.map((n) => STRING_ORDER.indexOf(n.string));
        expect(Math.max(...strings) - Math.min(...strings) + 1).toBe(strings.length);
        for (const note of voicing.notes) {
          expect(note.midi).toBe(OPEN_STRING_MIDI[note.string] + note.semitones);
          expect(note.tone.pitchClass).toBe(note.midi % 12);
          expect(note.marker).toBe(note.tone.isRoot ? 'square' : 'circle');
          expect(chord.tones).toContainEqual(note.tone);
          if (note.finger === '0') expect(note.semitones).toBe(0);
          else expect(note.semitones).toBe(shape.anchor + CHORD_FRAMES[shape.frame][Number(note.finger) - 1]);
        }
        for (const finger of ['1', '2', '3', '4']) {
          const seats = voicing.notes.filter((n) => n.finger === finger);
          expect(seats.length).toBeLessThanOrEqual(2);
          if (seats.length === 2) {
            expect(seats[0].semitones).toBe(seats[1].semitones);
            expect(Math.abs(STRING_ORDER.indexOf(seats[0].string) - STRING_ORDER.indexOf(seats[1].string))).toBe(1);
          }
        }
        const missing = chord.tones.filter((tone) => !voicing.notes.some((n) => n.tone.pitchClass === tone.pitchClass));
        expect(voicing.omittedTones).toEqual(missing);
        expect(missing.every((t) => chord.type.optionalIntervals.includes(t.interval))).toBe(true);
        expect(voicing.bass.pitchClass).toBe(Math.min(...voicing.notes.map((n) => n.midi)) % 12);
        expect(voicing.technique).toBe(voicing.notes.length === 2 ? 'double-stop' : 'rolled-chord');
        expect(voicing.review).toBe('generated-needs-cellist-review');
      });
    }
  });

  it('contains known C and G major cello shapes; does not call open G-D-A a Gm9', () => {
    expect(getCelloChord('C').voicings.some((v) => v.id === '0-0-2-3')).toBe(true);
    expect(getCelloChord('G').voicings.some((v) => v.id === 'x-0-0-2')).toBe(true);
    expect(getCelloChord('Gm9').voicings.some((v) => v.id === 'x-0-0-0')).toBe(false);
    expect(getCelloChord('Gm9').tones.map((t) => t.name)).toEqual(['G', 'Bb', 'D', 'F', 'A']);
  });

  it.each([
    ['C', ['C', 'E', 'G']], ['Cm', ['C', 'Eb', 'G']], ['C7', ['C', 'E', 'G', 'Bb']],
    ['Cmaj7', ['C', 'E', 'G', 'B']], ['Cdim7', ['C', 'Eb', 'Gb', 'Bbb']],
    ['Cm7b5', ['C', 'Eb', 'Gb', 'Bb']], ['Csus4', ['C', 'F', 'G']],
    ['Caug', ['C', 'E', 'G#']], ['Cadd9', ['C', 'E', 'G', 'D']],
    ['C9', ['C', 'E', 'G', 'Bb', 'D']], ['C11', ['C', 'E', 'G', 'Bb', 'D', 'F']],
    ['C13', ['C', 'E', 'G', 'Bb', 'D', 'F', 'A']],
    ['C7b9', ['C', 'E', 'G', 'Bb', 'Db']], ['C7#9', ['C', 'E', 'G', 'Bb', 'D#']],
    ['Em7(9)', ['E', 'G', 'B', 'D', 'F#']], ['D9(11)', ['D', 'F#', 'A', 'C', 'E', 'G']],
    ['E♭°', ['Eb', 'Gb', 'Bbb']], ['F#', ['F#', 'A#', 'C#']], ['Gb', ['Gb', 'Bb', 'Db']],
  ])('spells %s without losing chord degrees', (symbol, notes) => {
    expect(getCelloChord(symbol).tones.map((t) => t.name)).toEqual(notes);
  });

  it('supports dictionary aliases, including slashes that are part of chord types', () => {
    for (const type of CELLO_CHORD_TYPES) {
      for (const alias of type.aliases) {
        expect(getCelloChordByType('C', alias).type.id).toBe(type.id);
        if (!/^[b#]/.test(alias)) expect(getCelloChord(`C${alias}`).type.id).toBe(type.id);
      }
    }
    expect(getCelloChord('C6/9').type.id).toBe('6add9');
    expect(getCelloChord('Cm/maj7').tones.map((t) => t.name)).toEqual(['C', 'Eb', 'G', 'B']);
  });

  it('respects slash bass without confusing bass and harmonic root', () => {
    const chord = getCelloChord('C/E');
    expect(chord.voicings.length).toBeGreaterThan(0);
    expect(chord.voicings.every((v) => v.bass.name === 'E' && v.inversion === 1)).toBe(true);
    expect(chord.arpeggio[0].midi % 12).toBe(4);
    expect(chord.arpeggio[0].marker).toBe('circle');
    expect(chord.voicings.every((v) => v.notes.some((n) => n.tone.name === 'C' && n.marker === 'square'))).toBe(true);
    const pedal = getCelloChord('C/Bb');
    expect(pedal.voicings).toEqual([]);
    expect(pedal.status).toBe('arpeggio-only');
    expect(pedal.arpeggio[0].tone.name).toBe('Bb');
    expect(pedal.arpeggio.map((n) => n.midi)).toEqual([...pedal.arpeggio.map((n) => n.midi)].sort((a, b) => a - b));
  });

  it('keeps every tone when no full held shape is possible', () => {
    const chord = getCelloChord('C7b9#9');
    expect(chord.status).toBe('arpeggio-only');
    expect(chord.arpeggio.map((n) => n.tone.name)).toEqual(['C', 'E', 'G', 'Bb', 'Db', 'D#']);
    expect(chordDiagramModel(chord).mode).toBe('arpeggio');
  });

  it('supports every rooted chromatic pitch-class set beyond the named dictionary', () => {
    const chromatic = ['2m', '2M', '3m', '3M', '4P', '4A', '5P', '6m', '6M', '7m', '7M'];
    for (let mask = 1; mask < 2048; mask++) {
      const intervals = ['1P', ...chromatic.filter((_, bit) => mask & (1 << bit))];
      const chord = createCelloChord('C', intervals);
      expect(chord.tones).toHaveLength(intervals.length);
      expect(chord.arpeggio).toHaveLength(intervals.length);
      expect(chord.arpeggio[0].marker).toBe('square');
      if (intervals.length > 4) expect(chord.voicings).toHaveLength(0);
    }
  });

  it('rejects malformed and unknown input instead of silently substituting major', () => {
    for (const symbol of ['', 'H7', 'C???', 'C/QQ', 'ii7', 'C(add99)']) expect(() => getCelloChord(symbol)).toThrow();
    expect(() => createCelloChord('C', ['3M', '5P'])).toThrow();
    expect(() => createCelloChord('C', ['1P', '2M', '9M'])).toThrow();
    expect(() => createCelloChord('C', ['1P', '-3M'])).toThrow();
    expect(() => createCelloChord('C', ['1P', 'nonsense'])).toThrow();
    expect(() => getCelloChordByType('C4', 'm')).toThrow();
    expect(Object.isFrozen(CELLO_CHORD_LIBRARY)).toBe(true);
    expect(Object.isFrozen(getCelloChord('C').voicings[0].notes)).toBe(true);
  });
});

describe('cello chord diagrams', () => {
  it('previews the next song fingering in the current coordinate system without obscuring held notes', () => {
    const chord = getCelloChord('G');
    const nextChord = getCelloChord('G7');
    const model = chordDiagramModel(chord, { nextChord });
    expect(model.ghostMarkers.map((marker) => marker.note)).toEqual(nextChord.voicings[0].notes);
    expect(model.ghostMarkers.some((marker) => marker.shared)).toBe(true);
    expect(model.ghostMarkers.some((marker) => !marker.shared)).toBe(true);
    for (const marker of model.ghostMarkers) {
      expect(marker.x).toBe(model.x(marker.note.string));
      expect(marker.y).toBe(model.y(marker.note.semitones));
      expect(marker.shared).toBe(model.markers.some((current) => current.note.string === marker.note.string && current.note.semitones === marker.note.semitones));
    }
    const svg = celloChordSvg(chord, { nextChord, presentation: 'atlas' });
    expect(svg).toContain('Grey preparation notes for G7');
    expect(svg.indexOf('stroke-dasharray')).toBeLessThan(svg.indexOf('data-root='));
    expect(chordDiagramModel(chord).ghostMarkers).toHaveLength(0);
    expect(celloChordSvg(chord)).not.toContain('stroke-dasharray');
    const reversed = chordDiagramModel(chord, { nextChord, orientation: 'player' });
    expect(reversed.ghostMarkers.map((marker) => marker.note)).toEqual(model.ghostMarkers.map((marker) => marker.note));
    expect(() => chordDiagramModel(chord, { nextChord, nextVoicingIndex: 999 })).toThrow();
  });

  it('matches saved tape semitones, keeps roots square and numbers legible', () => {
    const palette = { blue: '#0000ff', yellow: '#ffff00', green: '#00ff00', red: '#ff0000', orange: '#ff8800', white: '#ffffff' };
    const colors = chordTapeMarkerColors(DEFAULT_TAPE_SETS, palette);
    expect(colors[4]).toEqual({ fill: '#ffff00', ink: '#000000' });
    expect(colors[2]).toEqual({ fill: '#0000ff', ink: '#ffffff' });
    expect(colors[0]).toBeUndefined();
    expect(colors[1]).toBeUndefined();
    const moved = chordTapeMarkerColors([{ id: 'custom', name: 'Custom', blurb: '', tapes: [{ id: 'one', color: 'red', semitones: 4, finger: '1', caption: '' }] }], palette);
    expect(moved[4]?.fill).toBe('#ff0000');
    expect(moved[1]).toBeUndefined();
    const svg = celloChordSvg(getCelloChord('Em'), { markerColors: colors });
    expect(svg).toMatch(/<rect[^>]*fill="#ffff00"[^>]*data-root="true"/);
    expect(celloChordSvg(getCelloChord('Em'))).not.toContain('#ffff00');
  });

  it('marks open and stopped roots as squares, all other tones as circles', () => {
    for (const symbol of ['C', 'G', 'C/E', 'Cdim7', 'Gm9', 'B13']) {
      const chord = getCelloChord(symbol);
      const model = chordDiagramModel(chord);
      const svg = celloChordSvg(chord);
      const roots = model.markers.filter((m) => m.note.tone.isRoot).length;
      expect((svg.match(/<rect /g) ?? []).length).toBe(roots);
      expect((svg.match(/<circle /g) ?? []).length).toBe(model.markers.length - roots);
      expect(svg).not.toMatch(/NaN|undefined/);
      expect(svg).toContain('aria-label=');
    }
  });

  it('uses physical cello spacing and reverses only the visual string order', () => {
    const chord = getCelloChord('G');
    const diagram = chordDiagramModel(chord);
    expect(diagram.strings).toEqual(['C', 'G', 'D', 'A']);
    expect(diagram.y(6) - diagram.top).toBeCloseTo(stopDistanceMm(6) / stopDistanceMm(12) * (diagram.bottom - diagram.top));
    expect(diagram.y(2) - diagram.y(1)).toBeGreaterThan(diagram.y(12) - diagram.y(11));
    const reversed = chordDiagramModel(chord, { orientation: 'player' });
    expect(reversed.strings).toEqual(['A', 'D', 'G', 'C']);
    expect(reversed.markers.map((m) => m.note)).toEqual(diagram.markers.map((m) => m.note));
    expect(reversed.x('C')).toBe(diagram.x('A'));
  });

  it('offers full arpeggio mode even when a held shape exists', () => {
    const chord = getCelloChord('C');
    expect(chordDiagramModel(chord, { mode: 'arpeggio' }).markers).toHaveLength(chord.tones.length);
    expect(celloChordSvg(chord, { mode: 'arpeggio' })).toContain('One note at a time');
    expect(() => chordDiagramModel(chord, { voicingIndex: -1 })).toThrow();
    expect(() => chordDiagramModel(chord, { voicingIndex: 999 })).toThrow();
  });

  it('renders scale preview markers on chord diagrams without colliding with chord or ghost markers', () => {
    const chord = getCelloChord('G');
    const nextChord = getCelloChord('F');
    const model = chordDiagramModel(chord, { scaleKey: 'C', nextChord });

    expect(model.scaleMarkers.length).toBeGreaterThan(0);
    const cMajorPcs = [0, 2, 4, 5, 7, 9, 11];

    for (const marker of model.scaleMarkers) {
      expect(cMajorPcs).toContain(marker.pitchClass);
      // Key tonic is C (pc 0)
      if (marker.isTonic) expect(marker.pitchClass).toBe(0);
      // Never collides with current chord notes
      expect(model.markers.some((m) => m.note.string === marker.string && m.note.semitones === marker.semitones)).toBe(false);
      // Never collides with next chord ghost notes
      expect(model.ghostMarkers.some((g) => g.note.string === marker.string && g.note.semitones === marker.semitones)).toBe(false);
    }

    const colors: Record<number, { fill: string; ink: string }> = {
      2: { fill: '#123456', ink: '#ffffff' },
    };
    const svg = celloChordSvg(chord, { scaleKey: 'C', nextChord, markerColors: colors, ink: '#000000' });
    expect(svg).toContain('data-scale-tonic="true"');
    expect(svg).toContain('data-scale-marker="true"');
    expect(svg).toContain('Key scale notes for C.');
    // Taped scale markers at semitone 2 use the tape color
    expect(svg).toContain('fill="#123456"');
    // Untaped scale markers use ink (#000000)
    expect(svg).toContain('fill="#000000"');
  });
});

