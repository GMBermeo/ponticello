/**
 * Which chords in the bundled charts have no cello diagram yet.
 *
 *     npm run audit:chords
 *
 * Reads every chart the library build would bundle (the shipped ones and
 * anything imported into `_CHORDS/`), reads each chord the way the app does, and
 * lists what could not be mapped — with the songs that use it — plus the count of
 * chords that were mapped only by simplifying. Chart text the importer cut in
 * the wrong place ("F#m-F#m-G") shows up here too, which is how it gets noticed.
 */
import { loadChordSources } from './chordBundle';

interface Tally { count: number; songs: Set<string>; keyboard: readonly number[] }

const sheets = loadChordSources();
const unmapped = new Map<string, Tally>();
let total = 0;
let simplified = 0;
for (const sheet of sheets) {
  for (const chord of sheet.chords) {
    total++;
    if (chord.canonical === null) {
      const tally = unmapped.get(chord.symbol) ?? { count: 0, songs: new Set(), keyboard: chord.keyboardPitchClasses };
      tally.count++;
      tally.songs.add(sheet.id);
      unmapped.set(chord.symbol, tally);
    } else if (chord.interpretation?.startsWith('Simplified')) {
      simplified++;
    }
  }
}

const missing = [...unmapped.values()].reduce((sum, tally) => sum + tally.count, 0);
console.log(`${sheets.length} charts, ${total} chords: ${total - missing} mapped (${simplified} simplified), ${missing} not (${unmapped.size} distinct symbols).\n`);
for (const [symbol, tally] of [...unmapped].sort((a, b) => b[1].count - a[1].count)) {
  const example = [...tally.songs].slice(0, 2).join(', ');
  console.log(`${symbol.padEnd(18)} ×${String(tally.count).padEnd(3)} keyboard [${tally.keyboard.join(',')}]  e.g. ${example}`);
}
