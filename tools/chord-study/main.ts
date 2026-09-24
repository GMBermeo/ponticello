import {
  CELLO_CHORD_LIBRARY, CELLO_CHORD_ROOTS, CELLO_CHORD_TYPES, getCelloChord, getCelloChordByType,
  celloChordSvg, escapeChordXml, type CelloChordStudy, type ChordDiagramOptions,
} from '@domain';

const el = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing study element: ${id}`);
  return element as T;
};
const input = el<HTMLInputElement>('symbol');
const types = el<HTMLSelectElement>('type');
const variant = el<HTMLSelectElement>('variant');
const mode = el<HTMLSelectElement>('mode');
const orientation = el<HTMLSelectElement>('orientation');
const error = el<HTMLParagraphElement>('error');
let chord = getCelloChord('Gm9');

const preferred = ['', 'm', '5', 'sus2', 'sus4', 'dim', 'aug', '6', 'm6', 'maj7', '7', 'm7', 'm7b5', 'dim7', 'Madd9', '9', 'maj9', 'm9', '11', 'm11', '13'];
const sortedTypes = [...CELLO_CHORD_TYPES].sort((a, b) => {
  const rank = (id: string) => preferred.includes(id) ? preferred.indexOf(id) : 100;
  return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name);
});
sortedTypes.forEach((type) => types.add(new Option(`${type.id || 'major'} · ${type.intervals.join(' ')}`, type.id)));
el('coverage').textContent = `${CELLO_CHORD_TYPES.length} chord types · 12 roots\n${Object.keys(CELLO_CHORD_LIBRARY).length.toLocaleString()} chords to explore`;

function run(action: () => void) {
  try { action(); error.hidden = true; }
  catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); error.hidden = false; }
}

function select(symbol: string) {
  run(() => { chord = getCelloChord(symbol); variant.value = '0'; mode.value = 'voicing'; render(true); });
}

function render(reset = false) {
  input.value = chord.symbol;
  types.value = chord.type.id;
  const options: ChordDiagramOptions = {
    mode: mode.value as 'voicing' | 'arpeggio',
    orientation: orientation.value as 'low-to-high' | 'player',
    voicingIndex: reset ? 0 : Number(variant.value || 0),
  };
  if (reset) {
    variant.replaceChildren();
    chord.voicings.forEach((shape, i) => variant.add(new Option(
      `${i + 1}. Bass ${shape.bass.name} · ${shape.completeness} · ${shape.difficulty}`, String(i),
    )));
    if (!chord.voicings.length) variant.add(new Option('No grip in neck-position model', '0'));
    variant.value = '0';
  }
  const shape = chord.voicings[options.voicingIndex ?? 0];
  const arpeggio = options.mode === 'arpeggio' || !shape;
  variant.disabled = arpeggio;
  const shapeOption = mode.options[0];
  if (shapeOption) shapeOption.disabled = !chord.voicings.length;
  if (!chord.voicings.length) mode.value = 'arpeggio';
  el('chord-name').textContent = chord.type.name.toUpperCase();
  el('chord-title').textContent = chord.symbol;
  el('formula').textContent = chord.tones.map((t) => t.interval).join('  ·  ');
  el('tones').innerHTML = chord.tones.map((t) => `<span class="${t.isRoot ? 'root-tone' : ''}">${escapeChordXml(t.name)}<small>${escapeChordXml(t.interval)}</small></span>`).join('');
  el('diagram').innerHTML = celloChordSvg(chord, options);
  const grip = arpeggio ? undefined : shape;
  el('diagram-caption').textContent = captionFor(grip);
  el('technique').textContent = techniqueFor(grip, chord.voicings.length > 0);
  el('omissions').textContent = omissionsFor(grip);
  el('sequence').innerHTML = chord.arpeggio.map(sequenceItem).join('');
  el('roots').replaceChildren(...CELLO_CHORD_ROOTS.map((root) => {
    const button = document.createElement('button');
    button.textContent = root;
    button.type = 'button';
    const active = getCelloChordByType(root, '').tones[0].pitchClass === chord.tones[0].pitchClass;
    button.setAttribute('aria-pressed', String(active));
    button.onclick = () => run(() => { chord = getCelloChordByType(root, chord.type.id); mode.value = 'voicing'; render(true); });
    return button;
  }));
  el('footer-status').textContent = `${chord.voicings.length} candidate shapes for ${chord.symbol}`;
}

el<HTMLFormElement>('search-form').onsubmit = (event) => { event.preventDefault(); select(input.value); };
types.onchange = () => run(() => { chord = getCelloChordByType(chord.root, types.value); mode.value = 'voicing'; render(true); });
variant.onchange = () => render();
mode.onchange = () => render();
orientation.onchange = () => render();

['Gm9', 'Ebm', 'Gm', 'Eb', 'C9', 'D9(11)', 'Eb°', 'Em', 'Em7(9)', 'G'].forEach((symbol) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'example';
  button.setAttribute('aria-label', `Study ${symbol}`);
  const example = getCelloChord(symbol);
  button.innerHTML = celloChordSvg(example);
  button.onclick = () => select(symbol);
  el('examples').append(button);
});

const lyrics = [
  [['G', 'Let the low string ring,'], ['Cadd9', 'let the daylight in.']],
  [['Em7(9)', 'Every note a footstep,'], ['D9(11)', 'every breath begins.']],
];
lyrics.forEach((line) => {
  const row = document.createElement('div');
  row.className = 'lyric-line';
  line.forEach(([symbol, words]) => {
    const phrase = document.createElement('div');
    const button = document.createElement('button');
    button.textContent = symbol;
    button.onclick = () => select(symbol);
    const text = document.createElement('p');
    text.textContent = words;
    phrase.append(button, text);
    row.append(phrase);
  });
  el('lyric-chords').append(row);
});
render(true);

type Grip = CelloChordStudy['voicings'][number];
type ArpeggioNote = CelloChordStudy['arpeggio'][number];

function captionFor(grip: Grip | undefined): string {
  if (!grip) return 'Sequential notes. Do not hold this as one grip.';
  const frame = grip.notes.find((n) => n.semitones > 0)?.frame ?? 'open';
  return `${grip.notes.length} strings · ${frame} frame · bass ${grip.bass.name}`;
}

function techniqueFor(grip: Grip | undefined, hasGrips: boolean): string {
  if (!grip) return hasGrips ? 'Arpeggio: play one note at a time.' : 'No grip found in this model. Study the full arpeggio.';
  return grip.technique === 'double-stop'
    ? 'Bow both adjacent strings together.'
    : 'Roll the chord across adjacent strings; do not sustain all strings together.';
}

function omissionsFor(grip: Grip | undefined): string {
  if (!grip) return 'All chord tones included.';
  if (!grip.omittedTones.length) return 'Complete shape. All chord tones included.';
  const omitted = grip.omittedTones.map((t) => `${t.name} (${t.interval})`).join(', ');
  return `Reduced shape. Omitted: ${omitted}.`;
}

function sequenceItem(note: ArpeggioNote): string {
  const rootClass = note.tone.isRoot ? 'root-text' : '';
  const rootMark = note.tone.isRoot ? ' ▪' : '';
  const open = note.semitones === 0;
  const where = open ? 'open' : `finger ${note.finger}`;
  const offset = open ? '0' : `+${note.semitones}`;
  return `<li><strong class="${rootClass}">${escapeChordXml(note.tone.name)}${rootMark}</strong><span>${note.string} string · ${where}</span><small>${offset} st</small></li>`;
}
