import { DISPLAY_STRING_ORDER, OPEN_STRING_MIDI, STRING_ORDER, stopDistanceMm } from '../cello';
import type { CelloChordStudy, ChordPlacement, ChordTone } from './types';
import { tapeGeometry, type TapeColor, type TapeSet } from '../tapes';
import { parseScaleKey } from '../key';

export interface ChordDiagramOptions {
  readonly mode?: 'voicing' | 'arpeggio';
  readonly voicingIndex?: number;
  readonly orientation?: 'low-to-high' | 'player';
  readonly ink?: string;
  readonly muted?: string;
  readonly rootColor?: string;
  readonly background?: string;
  readonly presentation?: 'full' | 'atlas';
  readonly markerColors?: Readonly<Record<number, { fill: string; ink: string }>>;
  readonly nextChord?: CelloChordStudy;
  readonly nextVoicingIndex?: number;
  readonly ghostColor?: string;
  readonly scaleKey?: string;
  readonly scalePitchClasses?: readonly number[];
  readonly scaleTonic?: number;
  readonly scaleColor?: string;
  /**
   * Mark every place on the drawn board where the chord's notes can be
   * stopped, not just the one shape — the map for improvising over a chord
   * rather than for playing it. With `nextChord`, the next chord's positions
   * are drawn in grey too, and a note both chords share gets a ring: the
   * places a melody can stay put across the change.
   */
  readonly allPositions?: boolean;
}

export const CHORD_DIAGRAM_SIZE = { width: 200, height: 380 } as const;
export const CHORD_ATLAS_DIAGRAM_SIZE = { width: 152, height: 332 } as const;

/** Match physical tape positions, never the fingering number or pitch class. */
export function chordTapeMarkerColors(sets: readonly TapeSet[], palette: Record<TapeColor, string>): Record<number, { fill: string; ink: string }> {
  const colors: Record<number, { fill: string; ink: string }> = {};
  for (const tape of tapeGeometry(sets)) {
    if (tape.semitones === 0 || colors[tape.semitones]) continue;
    const fill = palette[tape.color];
    const rgb = fill.replace('#', '').match(/.{2}/g)?.map((hex) => parseInt(hex, 16) / 255) ?? [];
    const linear = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const luminance = (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    colors[tape.semitones] = { fill, ink: luminance > 0.179 ? '#000000' : '#ffffff' };
  }
  return colors;
}

type MarkerColors = Readonly<Record<number, { fill: string; ink: string }>>;

/** Drawing bounds of the fingerboard, in SVG units. */
const BOARD_TOP = 76;
const BOARD_BOTTOM = 330;
const NUT_Y = 52;
const OPEN_SCALE_MARKER_Y = 66;
const MIN_SEMITONES_SHOWN = 12;

type StringName = ChordPlacement['string'];

export interface ScaleMarker {
  string: StringName;
  semitones: number;
  x: number;
  y: number;
  isTonic: boolean;
  pitchClass: number;
}

function assertVoicingIndex(chord: CelloChordStudy, index: number, label: string): void {
  const outOfRange = chord.voicings.length > 0 && index >= chord.voicings.length;
  if (!Number.isInteger(index) || index < 0 || outOfRange) {
    throw new RangeError(`Invalid ${label} voicing index: ${index}`);
  }
}

function nextChordNotes(options: ChordDiagramOptions): readonly ChordPlacement[] {
  const next = options.nextChord;
  if (!next) return [];
  const index = options.nextVoicingIndex ?? 0;
  assertVoicingIndex(next, index, 'next chord');
  return next.voicings[index]?.notes ?? next.arpeggio;
}

function scalePitchClassesOf(options: ChordDiagramOptions): { pitchClasses: Set<number> | null; tonic: number | undefined } {
  const parsed = options.scaleKey ? parseScaleKey(options.scaleKey) : null;
  let pitchClasses: Set<number> | null = null;
  if (options.scalePitchClasses) pitchClasses = new Set(options.scalePitchClasses);
  else if (parsed) pitchClasses = new Set(parsed.scale);
  return { pitchClasses, tonic: options.scaleTonic ?? parsed?.tonic };
}

const occupies = (notes: readonly ChordPlacement[], string: StringName, semitones: number) =>
  notes.some((note) => note.string === string && note.semitones === semitones);

type Spot = { string: StringName; semitones: number };
const occupiesSpot = (spots: readonly Spot[], string: StringName, semitones: number) =>
  spots.some((spot) => spot.string === string && spot.semitones === semitones);

/** One place a chord tone can be stopped, outside the shape being drawn. */
export interface ChordToneMarker {
  string: StringName;
  semitones: number;
  x: number;
  y: number;
  tone: ChordTone;
  /** The other chord (the next one, or the current one for a next-chord marker) has this note too. */
  shared: boolean;
}

/** Every stop from the nut to `maxSemitones` whose pitch class is one of `tones`, minus `exclude`. */
function toneMarkersFor(params: {
  strings: readonly StringName[];
  maxSemitones: number;
  tones: readonly ChordTone[];
  exclude: readonly Spot[];
  sharedWith: ReadonlySet<number>;
  x: (string: StringName) => number;
  y: (semitones: number) => number;
}): ChordToneMarker[] {
  const { strings, maxSemitones, tones, exclude, sharedWith, x, y } = params;
  const byPitchClass = new Map(tones.map((tone) => [tone.pitchClass, tone]));
  const markers: ChordToneMarker[] = [];
  for (const string of strings) {
    for (let semitones = 0; semitones <= maxSemitones; semitones++) {
      const tone = byPitchClass.get((OPEN_STRING_MIDI[string] + semitones) % 12);
      if (!tone || occupiesSpot(exclude, string, semitones)) continue;
      markers.push({ string, semitones, x: x(string), y: y(semitones), tone, shared: sharedWith.has(tone.pitchClass) });
    }
  }
  return markers;
}

/** Scale notes not already covered by the chord or its successor, string by string. */
function scaleMarkersFor(params: {
  strings: readonly StringName[];
  maxSemitones: number;
  scale: { pitchClasses: Set<number> | null; tonic: number | undefined };
  covered: readonly Spot[];
  x: (string: StringName) => number;
  y: (semitones: number) => number;
}): ScaleMarker[] {
  const { strings, maxSemitones, scale, covered, x, y } = params;
  const pitchClasses = scale.pitchClasses;
  if (!pitchClasses) return [];
  const markers: ScaleMarker[] = [];
  for (const string of strings) {
    const open = OPEN_STRING_MIDI[string];
    for (let semitones = 0; semitones <= maxSemitones; semitones++) {
      const pitchClass = (open + semitones) % 12;
      if (!pitchClasses.has(pitchClass) || occupiesSpot(covered, string, semitones)) continue;
      markers.push({
        string,
        semitones,
        x: x(string),
        y: semitones === 0 ? OPEN_SCALE_MARKER_Y : y(semitones),
        isTonic: scale.tonic !== undefined && pitchClass === scale.tonic,
        pitchClass,
      });
    }
  }
  return markers;
}

/** Shared by native component, browser study atlas and export. */
export function chordDiagramModel(chord: CelloChordStudy, options: ChordDiagramOptions = {}) {
  const index = options.voicingIndex ?? 0;
  assertVoicingIndex(chord, index, 'chord');
  const voicing = options.mode === 'arpeggio' ? undefined : chord.voicings[index];
  const notes = voicing?.notes ?? chord.arpeggio;
  const nextNotes = nextChordNotes(options);
  const strings = options.orientation === 'player' ? DISPLAY_STRING_ORDER : STRING_ORDER;
  const maxSemitones = Math.max(MIN_SEMITONES_SHOWN, ...notes.map((n) => n.semitones), ...nextNotes.map((n) => n.semitones));
  const top = BOARD_TOP;
  const bottom = BOARD_BOTTOM;
  const x = (string: StringName) => 48 + strings.indexOf(string) * 36;
  const y = (semitones: number) => (semitones === 0
    ? NUT_Y
    : top + stopDistanceMm(semitones) / stopDistanceMm(maxSemitones) * (bottom - top));
  const all = options.allPositions === true;
  const nextTones = options.nextChord?.tones ?? [];
  const toneMarkers = all ? toneMarkersFor({
    strings, maxSemitones, tones: chord.tones, exclude: notes,
    sharedWith: new Set(nextTones.map((tone) => tone.pitchClass)), x, y,
  }) : [];
  const nextToneMarkers = all && options.nextChord ? toneMarkersFor({
    strings, maxSemitones, tones: nextTones, exclude: nextNotes,
    sharedWith: new Set(chord.tones.map((tone) => tone.pitchClass)), x, y,
  }) : [];
  const scaleMarkers = scaleMarkersFor({
    strings, maxSemitones, scale: scalePitchClassesOf(options),
    covered: [...notes, ...nextNotes, ...toneMarkers, ...nextToneMarkers], x, y,
  });

  return {
    mode: voicing ? 'voicing' as const : 'arpeggio' as const,
    voicing, strings, top, bottom, x, y,
    guides: Array.from({ length: maxSemitones }, (_, i) => ({ semitones: i + 1, y: y(i + 1) })),
    scaleMarkers,
    toneMarkers,
    nextToneMarkers,
    markers: notes.map((note, i) => ({ note, x: x(note.string), y: y(note.semitones), sequence: i + 1 })),
    ghostMarkers: nextNotes.map((note) => ({ note, x: x(note.string), y: y(note.semitones),
      shared: occupies(notes, note.string, note.semitones) })),
    unusedStrings: strings.filter((string) => !notes.some((note) => note.string === string)),
  };
}

type DiagramModel = ReturnType<typeof chordDiagramModel>;

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeChordXml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (char) => XML_ESCAPES[char]!);
}

/** Guide lines at these semitones are the landmarks a cellist hears and feels. */
const LANDMARK_SEMITONES = new Set([2, 5, 7, 12]);
const WHITE_TAPES = new Set(['#ffffff', '#f8fafc']);

type Palette = { ink: string; muted: string; root: string; background: string; ghost: string };

function paletteOf(options: ChordDiagramOptions): Palette {
  return {
    ink: escapeChordXml(options.ink ?? '#292c29'),
    muted: escapeChordXml(options.muted ?? '#727971'),
    root: escapeChordXml(options.rootColor ?? '#a64132'),
    background: escapeChordXml(options.background ?? '#f9faf7'),
    ghost: escapeChordXml(options.ghostColor ?? '#858585'),
  };
}

function svgText(x: number, y: number, label: string, style: { size?: number; color: string; weight?: number }): string {
  const { size = 11, color, weight = 400 } = style;
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="Arial, sans-serif">${escapeChordXml(label)}</text>`;
}

function techniqueSentence(model: DiagramModel): string {
  if (model.mode === 'arpeggio') return 'Arpeggio: play one note at a time.';
  return model.voicing?.technique === 'double-stop' ? 'Double stop.' : 'Roll across the strings.';
}

function describePlacement(note: ChordPlacement): string {
  const where = note.semitones === 0 ? 'open' : `finger ${note.finger}, semitone ${note.semitones}`;
  const rootNote = note.tone.isRoot ? ', root (square)' : '';
  return `${note.string} string, ${where}, ${note.tone.name}${rootNote}`;
}

function describeOmitted(tone: { name: string; interval: string }): string {
  return `${tone.name} (${tone.interval})`;
}

/** The spoken description: technique, every note, what is left out, and what comes next. */
function describeDiagram(chord: CelloChordStudy, model: DiagramModel, options: ChordDiagramOptions): string {
  const parts = [`${chord.symbol}. ${techniqueSentence(model)} ${model.markers.map(({ note }) => describePlacement(note)).join('; ')}`];
  const omitted = model.voicing?.omittedTones ?? [];
  if (omitted.length) parts.push(`Reduced shape. Omitted: ${omitted.map(describeOmitted).join(', ')}`);
  if (options.nextChord) {
    const ghosts = model.ghostMarkers.map(({ note }) => `${note.string} string, semitone ${note.semitones}, finger ${note.finger}`);
    parts.push(`Grey preparation notes for ${options.nextChord.symbol}: ${ghosts.join('; ')}`);
  }
  if (options.allPositions) {
    const names = chord.tones.map((tone) => tone.name).join(', ');
    parts.push(`Every position of ${names} up to the octave (${model.toneMarkers.length} more places)`);
    if (options.nextChord) {
      const common = model.toneMarkers.filter((marker) => marker.shared).map((marker) => marker.tone.name);
      const kept = [...new Set(common)];
      const shared = kept.length ? `; notes shared with it: ${kept.join(', ')}` : '';
      parts.push(`Grey rings: every position of ${options.nextChord.symbol}${shared}`);
    }
  }
  const description = parts.join('. ');
  return options.scaleKey ? `${description}. Key scale notes for ${options.scaleKey}.` : description;
}

function drawBoard(model: DiagramModel, palette: Palette): string[] {
  const out: string[] = [];
  for (const string of model.strings) {
    out.push(
      svgText(model.x(string), 36, string, { size: 10, color: palette.muted, weight: 600 }),
      `<line x1="${model.x(string)}" y1="${model.top}" x2="${model.x(string)}" y2="${model.bottom}" stroke="${palette.muted}" stroke-width="${string === 'C' ? 1.6 : 1}"/>`,
    );
  }
  for (const { semitones, y } of model.guides) {
    out.push(
      `<line x1="48" y1="${y}" x2="156" y2="${y}" stroke="${palette.muted}" stroke-opacity="${LANDMARK_SEMITONES.has(semitones) ? 0.7 : 0.25}"/>`,
      svgText(27, y + 3, String(semitones), { size: 9, color: palette.muted }),
    );
  }
  out.push(`<line x1="46" y1="${model.top}" x2="158" y2="${model.top}" stroke="${palette.ink}" stroke-width="4"/>`);
  model.unusedStrings
    .filter((string) => !model.ghostMarkers.some(({ note }) => note.string === string && note.semitones === 0))
    .forEach((string) => out.push(svgText(model.x(string), 56, '×', { size: 14, color: palette.muted })));
  return out;
}

function tapeAt(semitones: number, colors: MarkerColors | undefined) {
  return semitones === 0 ? undefined : colors?.[semitones];
}

function drawScaleMarker(marker: ScaleMarker, options: ChordDiagramOptions, palette: Palette): string {
  const { x, y, isTonic } = marker;
  const tape = tapeAt(marker.semitones, options.markerColors);
  let color = palette.ink;
  if (tape) color = escapeChordXml(tape.fill);
  else if (options.scaleColor) color = escapeChordXml(options.scaleColor);
  const strokeWidth = isTonic ? '1.2' : '1';
  if (isTonic) {
    const points = `${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}`;
    return `<polygon points="${points}" fill="${color}" fill-opacity="${tape ? '0.95' : '0.75'}" stroke="${color}" stroke-width="${strokeWidth}" data-scale-tonic="true"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="3.2" fill="${color}" fill-opacity="${tape ? '0.88' : '0.38'}" stroke="${color}" stroke-width="${strokeWidth}" data-scale-marker="true"/>`;
}

function markerShape(square: boolean, x: number, y: number, radius: number, attrs: string): string {
  return square
    ? `<rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" ${attrs}/>`
    : `<circle cx="${x}" cy="${y}" r="${radius}" ${attrs}/>`;
}

/**
 * Where else a chord tone can be stopped: a tinted disc carrying the note's
 * name — not a finger number, because it is a place to find, not a shape to
 * hold. Roots are squares, as on the shape itself.
 */
function drawToneMarkers(model: DiagramModel, options: ChordDiagramOptions, palette: Palette): string[] {
  return model.toneMarkers.flatMap(({ tone, semitones, x, y }) => {
    const tape = tapeAt(semitones, options.markerColors);
    let color = tone.isRoot ? palette.root : palette.ink;
    if (tape && !tone.isRoot) color = escapeChordXml(tape.fill);
    const attrs = `fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.3" data-chord-tone="${escapeChordXml(tone.name)}"`;
    // An opaque backing first, so the string line does not strike through the name.
    const backing = markerShape(tone.isRoot, x, y, 6.5, `fill="${palette.background}"`);
    return [backing, markerShape(tone.isRoot, x, y, 6.5, attrs), svgText(x, y + 2.6, tone.name, { size: tone.name.length > 1 ? 6 : 7.5, color, weight: 700 })];
  });
}

/**
 * The next chord's positions, as dashed grey rings with the note's name. A
 * note the current chord shares is only a wider ring around the current
 * marker — the name is already there.
 */
function drawNextToneMarkers(model: DiagramModel, palette: Palette): string[] {
  return model.nextToneMarkers.flatMap(({ tone, shared, x, y }) => {
    // A shared ring surrounds the current marker, so only an unshared one is backed.
    const attrs = `fill="${shared ? 'none' : palette.background}" stroke="${palette.ghost}" stroke-width="1.4" stroke-dasharray="2.5 1.8" data-next-tone="${escapeChordXml(tone.name)}"`;
    const ring = markerShape(tone.isRoot, x, y, shared ? 11 : 6.5, attrs);
    return shared ? [ring] : [ring, svgText(x, y + 2.6, tone.name, { size: tone.name.length > 1 ? 6 : 7.5, color: palette.ghost, weight: 700 })];
  });
}

/** Drawn before the chord's own markers, so those stay readable over a shared grey halo. */
function drawGhostMarkers(model: DiagramModel, palette: Palette): string[] {
  return model.ghostMarkers.flatMap(({ note, x, y, shared }) => {
    const attrs = `fill="${shared ? 'none' : palette.ghost}" fill-opacity="0.22" stroke="${palette.ghost}" stroke-width="1.8" stroke-dasharray="3 2"`;
    const shape = markerShape(note.marker === 'square', x, y, shared ? 11 : 9, attrs);
    return shared ? [shape] : [shape, svgText(x, y + 3.5, note.finger, { size: 10, color: palette.ghost, weight: 700 })];
  });
}

function drawChordMarkers(model: DiagramModel, options: ChordDiagramOptions, palette: Palette): string[] {
  return model.markers.flatMap(({ note, x, y }) => {
    const open = note.semitones === 0;
    const tape = tapeAt(note.semitones, options.markerColors);
    let color = note.tone.isRoot ? palette.root : palette.ink;
    if (tape) color = escapeChordXml(tape.fill);
    const attrs = `fill="${open ? palette.background : color}" stroke="${tape ? palette.ink : color}" stroke-width="1.5" data-root="${note.tone.isRoot}"`;
    let textColor = '#ffffff';
    if (open) textColor = color;
    else if (tape && WHITE_TAPES.has(tape.fill.toLowerCase())) textColor = '#000000';
    return [markerShape(note.marker === 'square', x, y, 9, attrs), svgText(x, y + 3.5, note.finger, { size: 10, color: textColor, weight: 700 })];
  });
}

function drawArpeggioFooter(palette: Palette, atlas: boolean): string[] {
  const out = [svgText(100, 353, 'ARPEGGIO', { size: 10, color: palette.muted, weight: 600 })];
  if (!atlas) out.push(svgText(100, 373, 'One note at a time', { size: 10, color: palette.muted }));
  return out;
}

function drawFooter(model: DiagramModel, palette: Palette, atlas: boolean): string[] {
  const voicing = model.voicing;
  if (!voicing) return drawArpeggioFooter(palette, atlas);
  const out: string[] = [];
  for (const string of model.strings) {
    const note = voicing.notes.find((n) => n.string === string);
    if (!note) continue;
    const color = note.tone.isRoot ? palette.root : palette.ink;
    out.push(svgText(model.x(string), 351, note.tone.name, { size: 10, color, weight: 600 }));
  }
  if (!atlas) {
    const technique = voicing.technique === 'double-stop' ? 'DOUBLE STOP' : 'ROLL CHORD';
    const missing = voicing.omittedTones.map((tone) => tone.interval).join(', ');
    const label = missing ? `${technique} · OMIT ${missing}` : technique;
    out.push(svgText(100, 374, label, { size: missing ? 8 : 9, color: palette.muted, weight: 600 }));
  }
  return out;
}

/** Fretless geometry: markers sit ON pitch lines, whose spacing contracts. */
export function celloChordSvg(chord: CelloChordStudy, options: ChordDiagramOptions = {}): string {
  const model = chordDiagramModel(chord, options);
  const palette = paletteOf(options);
  const description = describeDiagram(chord, model, options);
  const displayTitle = chord.type.name === 'Custom chord' ? `${chord.root} custom` : chord.symbol;
  const atlas = options.presentation === 'atlas';
  const viewBox = atlas ? '16 26 152 332' : '0 0 200 380';
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${escapeChordXml(description)}">`,
    `<title>${escapeChordXml(chord.symbol)}</title><desc>${escapeChordXml(description)}</desc>`,
  ];
  if (!atlas) {
    svg.push(svgText(100, 18, displayTitle, { size: Math.min(18, 180 / (displayTitle.length * 0.62)), color: palette.ink, weight: 700 }));
  }
  svg.push(
    ...drawBoard(model, palette),
    ...model.scaleMarkers.map((marker) => drawScaleMarker(marker, options, palette)),
    ...drawNextToneMarkers(model, palette),
    ...drawToneMarkers(model, options, palette),
    ...drawGhostMarkers(model, palette),
    ...drawChordMarkers(model, options, palette),
    ...drawFooter(model, palette, atlas),
    '</svg>',
  );
  return svg.join('');
}
