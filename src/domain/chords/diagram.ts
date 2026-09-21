import { DISPLAY_STRING_ORDER, OPEN_STRING_MIDI, STRING_ORDER, stopDistanceMm } from '../cello';
import type { CelloChordStudy, ChordPlacement } from './types';
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

/** Shared by native component, browser study atlas and export. */
export function chordDiagramModel(chord: CelloChordStudy, options: ChordDiagramOptions = {}) {
  const index = options.voicingIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || (chord.voicings.length > 0 && index >= chord.voicings.length)) {
    throw new RangeError(`Invalid chord voicing index: ${index}`);
  }
  const voicing = options.mode === 'arpeggio' ? undefined : chord.voicings[index];
  const notes = voicing?.notes ?? chord.arpeggio;
  const nextIndex = options.nextVoicingIndex ?? 0;
  if (options.nextChord && (!Number.isInteger(nextIndex) || nextIndex < 0
    || (options.nextChord.voicings.length > 0 && nextIndex >= options.nextChord.voicings.length))) {
    throw new RangeError(`Invalid next chord voicing index: ${nextIndex}`);
  }
  const nextNotes = options.nextChord
    ? options.nextChord.voicings[nextIndex]?.notes ?? options.nextChord.arpeggio : [];
  const strings = options.orientation === 'player' ? DISPLAY_STRING_ORDER : STRING_ORDER;
  const maxSemitones = Math.max(12, ...notes.map((n) => n.semitones), ...nextNotes.map((n) => n.semitones));
  const top = 76;
  const bottom = 330;
  const x = (string: ChordPlacement['string']) => 48 + strings.indexOf(string) * 36;
  const y = (semitones: number) => semitones === 0 ? 52
    : top + stopDistanceMm(semitones) / stopDistanceMm(maxSemitones) * (bottom - top);
  const parsedScale = options.scaleKey ? parseScaleKey(options.scaleKey) : null;
  const scalePcs = options.scalePitchClasses
    ? new Set(options.scalePitchClasses)
    : parsedScale
      ? new Set(parsedScale.scale)
      : null;
  const scaleTonic = options.scaleTonic ?? parsedScale?.tonic;

  const scaleMarkers: {
    string: ChordPlacement['string'];
    semitones: number;
    x: number;
    y: number;
    isTonic: boolean;
    pitchClass: number;
  }[] = [];

  if (scalePcs) {
    for (const string of strings) {
      const open = OPEN_STRING_MIDI[string];
      for (let semitones = 0; semitones <= maxSemitones; semitones++) {
        const pitchClass = (open + semitones) % 12;
        if (!scalePcs.has(pitchClass)) continue;
        const isChord = notes.some((n) => n.string === string && n.semitones === semitones);
        const isGhost = nextNotes.some((n) => n.string === string && n.semitones === semitones);
        if (isChord || isGhost) continue;
        scaleMarkers.push({
          string,
          semitones,
          x: x(string),
          y: semitones === 0 ? 66 : y(semitones),
          isTonic: scaleTonic !== undefined && pitchClass === scaleTonic,
          pitchClass,
        });
      }
    }
  }

  return {
    mode: voicing ? 'voicing' as const : 'arpeggio' as const,
    voicing, strings, top, bottom, x, y,
    guides: Array.from({ length: maxSemitones }, (_, i) => ({ semitones: i + 1, y: y(i + 1) })),
    scaleMarkers,
    markers: notes.map((note, i) => ({ note, x: x(note.string), y: y(note.semitones), sequence: i + 1 })),
    ghostMarkers: nextNotes.map((note) => ({ note, x: x(note.string), y: y(note.semitones),
      shared: notes.some((current) => current.string === note.string && current.semitones === note.semitones) })),
    unusedStrings: strings.filter((string) => !notes.some((note) => note.string === string)),
  };
}

export function escapeChordXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

/** Fretless geometry: markers sit ON pitch lines, whose spacing contracts. */
export function celloChordSvg(chord: CelloChordStudy, options: ChordDiagramOptions = {}): string {
  const model = chordDiagramModel(chord, options);
  const ink = escapeChordXml(options.ink ?? '#292c29');
  const muted = escapeChordXml(options.muted ?? '#727971');
  const root = escapeChordXml(options.rootColor ?? '#a64132');
  const background = escapeChordXml(options.background ?? '#f9faf7');
  const text = (x: number, y: number, label: string, size = 11, color = ink, weight = 400) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}" font-family="Arial, sans-serif">${escapeChordXml(label)}</text>`;
  const description = `${chord.symbol}. ${model.mode === 'arpeggio' ? 'Arpeggio: play one note at a time.'
    : model.voicing?.technique === 'double-stop' ? 'Double stop.' : 'Roll across the strings.'} `
    + model.markers.map(({ note }) => `${note.string} string, ${note.semitones === 0 ? 'open' : `finger ${note.finger}, semitone ${note.semitones}`}, ${note.tone.name}${note.tone.isRoot ? ', root (square)' : ''}`).join('; ')
    + (model.voicing?.omittedTones.length ? `. Reduced shape. Omitted: ${model.voicing.omittedTones.map((t) => `${t.name} (${t.interval})`).join(', ')}` : '')
    + (options.nextChord ? `. Grey preparation notes for ${options.nextChord.symbol}: ${model.ghostMarkers.map(({ note }) => `${note.string} string, semitone ${note.semitones}, finger ${note.finger}`).join('; ')}` : '')
    + (options.scaleKey ? `. Key scale notes for ${options.scaleKey}.` : '');
  const displayTitle = chord.type.name === 'Custom chord' ? `${chord.root} custom` : chord.symbol;
  const atlas = options.presentation === 'atlas';
  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${atlas ? '16 26 152 332' : '0 0 200 380'}" role="img" aria-label="${escapeChordXml(description)}">`,
    `<title>${escapeChordXml(chord.symbol)}</title><desc>${escapeChordXml(description)}</desc>`,
    ...(atlas ? [] : [text(100, 18, displayTitle, Math.min(18, 180 / (displayTitle.length * 0.62)), ink, 700)]),
  ];
  model.strings.forEach((string) => {
    svg.push(text(model.x(string), 36, string, 10, muted, 600));
    svg.push(`<line x1="${model.x(string)}" y1="${model.top}" x2="${model.x(string)}" y2="${model.bottom}" stroke="${muted}" stroke-width="${string === 'C' ? 1.6 : 1}"/>`);
  });
  model.guides.forEach(({ semitones, y }) => {
    svg.push(`<line x1="48" y1="${y}" x2="156" y2="${y}" stroke="${muted}" stroke-opacity="${[2, 5, 7, 12].includes(semitones) ? 0.7 : 0.25}"/>`);
    svg.push(text(27, y + 3, String(semitones), 9, muted));
  });
  svg.push(`<line x1="46" y1="${model.top}" x2="158" y2="${model.top}" stroke="${ink}" stroke-width="4"/>`);
  model.unusedStrings.filter((string) => !model.ghostMarkers.some(({ note }) => note.string === string && note.semitones === 0))
    .forEach((string) => svg.push(text(model.x(string), 56, '×', 14, muted)));
  model.scaleMarkers.forEach(({ x, y, semitones, isTonic }) => {
    const tape = semitones === 0 ? undefined : options.markerColors?.[semitones];
    const hasTape = Boolean(tape);
    const color = tape ? escapeChordXml(tape.fill) : (options.scaleColor ? escapeChordXml(options.scaleColor) : ink);
    const fillOpacity = hasTape ? '0.88' : '0.38';
    const strokeWidth = isTonic ? '1.2' : '1';
    if (isTonic) {
      svg.push(`<polygon points="${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}" fill="${color}" fill-opacity="${hasTape ? '0.95' : '0.75'}" stroke="${color}" stroke-width="${strokeWidth}" data-scale-tonic="true"/>`);
    } else {
      svg.push(`<circle cx="${x}" cy="${y}" r="3.2" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="${strokeWidth}" data-scale-marker="true"/>`);
    }
  });
  const ghost = escapeChordXml(options.ghostColor ?? '#858585');
  model.ghostMarkers.forEach(({ note, x, y, shared }) => {
    // Draw first: current colored markers stay readable over a shared grey halo.
    const radius = shared ? 11 : 9;
    const attrs = `fill="${shared ? 'none' : ghost}" fill-opacity="0.22" stroke="${ghost}" stroke-width="1.8" stroke-dasharray="3 2"`;
    svg.push(note.marker === 'square'
      ? `<rect x="${x - radius}" y="${y - radius}" width="${radius * 2}" height="${radius * 2}" ${attrs}/>`
      : `<circle cx="${x}" cy="${y}" r="${radius}" ${attrs}/>`);
    if (!shared) svg.push(text(x, y + 3.5, note.finger, 10, ghost, 700));
  });
  model.markers.forEach(({ note, x, y }) => {
    const open = note.semitones === 0;
    const tape = open ? undefined : options.markerColors?.[note.semitones];
    const color = tape ? escapeChordXml(tape.fill) : note.tone.isRoot ? root : ink;
    const attrs = `fill="${open ? background : color}" stroke="${tape ? ink : color}" stroke-width="1.5" data-root="${note.tone.isRoot}"`;
    svg.push(note.marker === 'square'
      ? `<rect x="${x - 9}" y="${y - 9}" width="18" height="18" ${attrs}/>`
      : `<circle cx="${x}" cy="${y}" r="9" ${attrs}/>`);
    const textColor = open
      ? color
      : (tape && (tape.fill.toLowerCase() === '#ffffff' || tape.fill.toLowerCase() === '#f8fafc'))
        ? '#000000'
        : '#ffffff';
    svg.push(text(x, y + 3.5, note.finger, 10, textColor, 700));
  });
  if (model.voicing) {
    model.strings.forEach((string) => {
      const note = model.voicing!.notes.find((n) => n.string === string);
      if (note) svg.push(text(model.x(string), 351, note.tone.name, 10, note.tone.isRoot ? root : ink, 600));
    });
    const technique = model.voicing.technique === 'double-stop' ? 'DOUBLE STOP' : 'ROLL CHORD';
    const missing = model.voicing.omittedTones.map((t) => t.interval).join(', ');
    if (!atlas) svg.push(text(100, 374, missing ? `${technique} · OMIT ${missing}` : technique, missing ? 8 : 9, muted, 600));
  } else {
    svg.push(text(100, 353, 'ARPEGGIO', 10, muted, 600));
    if (!atlas) svg.push(text(100, 373, 'One note at a time', 10, muted));
  }
  svg.push('</svg>');
  return svg.join('');
}
