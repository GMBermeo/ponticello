/**
 * Renders every synthesised voice to a WAV file so it can be listened to.
 *
 *     npm run audition:voices            # → _AUDITION/<voice>.wav, at the phone's 22 050 Hz
 *     npm run audition:voices -- 44100   # a higher rate, if the speakers are good
 *
 * Each file plays the same short phrase — a rising figure, a held note that
 * shows how the voice settles, and a chord — in the low, middle and high of the
 * cello's range, through the same synthesiser and room the app uses. There is
 * no other way to judge a timbre: the tests can say it is stable, in tune and
 * the right level, but not that it sounds like a cello.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstrumentName } from '@domain';
import type { BackingProgram, ScheduledNote } from '../src/audio/backing/program';
import { Room } from '../src/audio/room';
import { renderProgramInto } from '../src/audio/synth';
import { VOICES } from '../src/audio/voices';
import { encodeWav } from '../src/audio/wav';

const OUTPUT_DIR = '_AUDITION';
const sampleRate = Number(process.argv[2] ?? 22050);
const FIGURE = [0, 4, 7, 12, 7, 4];

function phrase(instrument: InstrumentName, root: number): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  const note = (atSec: number, holdSec: number, midiNumber: number, velocity = 0.7): void => {
    notes.push({ atSec, holdSec, midiNumber, instrument, amplitude: 0.35, velocity });
  };
  FIGURE.forEach((interval, index) => note(index * 0.32, 0.3, root + interval));
  note(2.2, 2.4, root, 0.6);
  [0, 4, 7].forEach((interval) => note(5.0, 2.2, root + interval, 0.75));
  return notes;
}

function render(instrument: InstrumentName): Float32Array {
  const notes = [-12, 0, 12].flatMap((shift, index) =>
    phrase(instrument, 48 + shift).map((note) => ({ ...note, atSec: note.atSec + index * 8.5 })));
  const program: BackingProgram = { key: instrument, notes, durationSec: 3 * 8.5 + 1 };
  const total = Math.ceil(program.durationSec * sampleRate);
  const out = new Float32Array(total);
  const room = new Room(sampleRate);
  const slice = 2 * sampleRate;
  for (let from = 0; from < total; from += slice) {
    renderProgramInto(out.subarray(from, Math.min(total, from + slice)), program, from, sampleRate, room);
  }
  return out;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const instrument of Object.keys(VOICES) as InstrumentName[]) {
  if (VOICES[instrument].noise) continue;
  writeFileSync(join(OUTPUT_DIR, `${instrument}.wav`), encodeWav(render(instrument), sampleRate));
  console.log(`${OUTPUT_DIR}/${instrument}.wav`);
}
