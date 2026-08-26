import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseMidi, monophonic } from '../src/domain/midi';
import { suggestSoloTrack } from '../src/domain/importScore';
import { instrumentForProgram, BackingTrack, BackingPart } from '../src/domain/backing';
import { OPEN_STRING_MIDI, midiToPitchName, midiToFrequency } from '../src/domain/cello';
import { CelloNote, CelloMeasure, CelloSongScore, measureDurationMs, validateScore } from '../src/domain/schema';
import { CelloState } from '../src/domain/fingering';

function firstPositionState(midi: number): CelloState {
  if (midi <= 42) {
    const diff = midi - 36;
    if (diff === 0) return { string: 'C', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'C', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'C', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'C', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'C', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'C', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'C', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else if (midi <= 49) {
    const diff = midi - 43;
    if (diff === 0) return { string: 'G', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'G', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'G', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'G', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'G', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'G', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'G', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else if (midi <= 56) {
    const diff = midi - 50;
    if (diff === 0) return { string: 'D', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'D', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'D', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'D', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'D', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'D', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'D', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else {
    const diff = midi - 57;
    if (diff === 0) return { string: 'A', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'A', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'A', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'A', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'A', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'A', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'A', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  }
}

function parseSongInfo(filename: string, category: 'study' | 'classical' | 'song') {
  const stem = filename.replace(/\.midi?$/i, '');
  const id = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (category === 'classical') {
    const title = stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let composer = 'Classical';
    if (stem.startsWith('bach')) composer = 'J.S. Bach';
    else if (stem.startsWith('pachelbel')) composer = 'Johann Pachelbel';
    else if (stem.startsWith('moonlight') || stem.startsWith('fur-elise') || stem.startsWith('ode')) composer = 'L. van Beethoven';
    else if (stem.startsWith('dies-irae')) composer = 'Traditional 13th C.';
    return {
      id,
      title,
      composer,
      origin: 'PUBLIC DOMAIN · 1ST POSITION',
      category: 'classical' as const,
    };
  }

  if (category === 'study') {
    const title = stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      id,
      title,
      composer: 'Ponticello Etude',
      origin: 'ORIGINAL ETUDE · 1ST POSITION',
      category: 'study' as const,
    };
  }

  if (stem.includes('-')) {
    const parts = stem.split('-');
    const artistRaw = parts[0].replace(/_/g, ' ').trim();
    const titleRaw = parts.slice(1).join(' - ').replace(/_/g, ' ').trim();
    return {
      id,
      title: titleRaw,
      composer: artistRaw,
      origin: `${artistRaw.toUpperCase()} · 1ST POSITION`,
      category: 'song' as const,
    };
  }

  const title = stem.replace(/_/g, ' ').trim();
  return {
    id,
    title,
    composer: 'Song',
    origin: 'SONG · 1ST POSITION',
    category: 'song' as const,
  };
}

interface CompactScoreData {
  id: string;
  title: string;
  composer: string;
  origin: string;
  bpm: number;
  meter: [number, number];
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  category: 'study' | 'classical' | 'song';
  // [midiNumber, startTimeMs, durationMs]
  notes: [number, number, number][];
  // [name, instrument, role, gain, [[midi, startMs, durMs, vel], ...]]
  backingParts: [string, string, string, number, [number, number, number, number][]][];
}

const categories: { dir: string; cat: 'study' | 'classical' | 'song' }[] = [
  { dir: '_MIDIS/public-domain', cat: 'classical' },
  { dir: '_MIDIS/etudes', cat: 'study' },
  { dir: '_MIDIS/downloaded', cat: 'song' },
];

const compactList: CompactScoreData[] = [];

for (const { dir, cat } of categories) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(f => f.endsWith('.mid') || f.endsWith('.midi'));
  for (const f of files) {
    const path = join(dir, f);
    const bytes = new Uint8Array(readFileSync(path));
    const parsed = parseMidi(bytes);
    if (parsed.notes.length === 0) continue;

    let soloTrack = suggestSoloTrack(parsed);
    if (soloTrack === null || !parsed.tracks.find(t => t.index === soloTrack && t.noteCount > 0)) {
      const trackWithNotes = parsed.tracks.find(t => t.noteCount > 0);
      if (trackWithNotes) soloTrack = trackWithNotes.index;
    }
    if (soloTrack === null) continue;

    const soloNotesRaw = monophonic(parsed.notes.filter(n => n.track === soloTrack));
    const soloNotes = soloNotesRaw.length > 0 ? soloNotesRaw : monophonic(parsed.notes);
    if (soloNotes.length === 0) continue;

    const info = parseSongInfo(f, cat);
    const timeSignature = parsed.timeSignature;
    const bpm = parsed.bpm || 80;
    const originTime = soloNotes[0].startTimeMs;

    const midis = soloNotes.map(n => n.midiNumber);
    const avgMidi = midis.reduce((a, b) => a + b, 0) / midis.length;
    let octaveShift = 0;
    if (avgMidi > 62) {
      octaveShift = -12 * Math.round((avgMidi - 49) / 12);
    } else if (avgMidi < 36) {
      octaveShift = 12 * Math.ceil((36 - avgMidi) / 12);
    }

    const compactNotes: [number, number, number][] = [];
    for (const note of soloNotes) {
      const startTimeMs = Math.round(note.startTimeMs - originTime);
      let m = note.midiNumber + octaveShift;
      while (m > 63) m -= 12;
      while (m < 36) m += 12;
      compactNotes.push([m, startTimeMs, Math.max(1, Math.round(note.durationMs))]);
    }

    const span = Math.max(...compactNotes.map(n => n[0])) - Math.min(...compactNotes.map(n => n[0]));
    const difficulty = (span <= 12 && bpm <= 80) ? 'Beginner' : (span <= 19 && bpm <= 120) ? 'Intermediate' : 'Advanced';

    const backingParts: CompactScoreData['backingParts'] = [];
    for (const track of parsed.tracks) {
      if (track.noteCount === 0) continue;
      const isSolo = track.index === soloTrack;
      // Filter out redundant notes and cap at reasonable density
      const tNotes = parsed.notes
        .filter(n => n.track === track.index)
        .slice(0, 1500)
        .map(n => [
          n.midiNumber,
          Math.max(0, Math.round(n.startTimeMs - originTime)),
          Math.max(1, Math.round(n.durationMs)),
          Math.round((Math.max(0.05, n.velocity / 127)) * 100) / 100,
        ] as [number, number, number, number]);

      if (tNotes.length === 0) continue;
      const inst = isSolo ? 'cello' : instrumentForProgram(track.program, track.isPercussion);
      const role = isSolo ? 'solo' : 'accompaniment';
      const gain = isSolo ? 0.85 : 0.5;
      const name = (track.name || `Track ${track.index + 1}`).trim().slice(0, 40);
      backingParts.push([name, inst, role, gain, tNotes]);
    }

    compactList.push({
      id: info.id,
      title: info.title,
      composer: info.composer,
      origin: info.origin,
      bpm,
      meter: timeSignature,
      difficulty,
      category: info.category,
      notes: compactNotes,
      backingParts,
    });
  }
}

console.log(`Writing ${compactList.length} compact scores to src/scores/bundledSongs.json...`);
writeFileSync('src/scores/bundledSongs.json', JSON.stringify(compactList));

const outTs = `/**
 * Bundled Release 1.1 Scores and Backing Tracks.
 * Auto-generated by tools/build-library.ts from _MIDIS.
 * All songs adapted to Cello First Position (C2 to D#4) across C, G, D, A strings.
 */

import { CelloSongScore, CelloNote, CelloMeasure, measureDurationMs } from '@/domain/schema';
import { BackingTrack, BackingPart, InstrumentName, PartRole } from '@/domain/backing';
import { midiToPitchName, midiToFrequency } from '@/domain/cello';
import { CelloState } from '@/domain/fingering';
import rawData from './bundledSongs.json';

function firstPositionState(midi: number): CelloState {
  if (midi <= 42) {
    const diff = midi - 36;
    if (diff === 0) return { string: 'C', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'C', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'C', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'C', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'C', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'C', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'C', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else if (midi <= 49) {
    const diff = midi - 43;
    if (diff === 0) return { string: 'G', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'G', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'G', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'G', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'G', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'G', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'G', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else if (midi <= 56) {
    const diff = midi - 50;
    if (diff === 0) return { string: 'D', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'D', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'D', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'D', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'D', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'D', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'D', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  } else {
    const diff = midi - 57;
    if (diff === 0) return { string: 'A', position: '1st', finger: '0', extension: 'none', baseSemitones: 2 };
    if (diff === 1) return { string: 'A', position: 'Half', finger: '1', extension: 'none', baseSemitones: 1 };
    if (diff === 2) return { string: 'A', position: '1st', finger: '1', extension: 'none', baseSemitones: 2 };
    if (diff === 3) return { string: 'A', position: '1st', finger: '2', extension: 'none', baseSemitones: 2 };
    if (diff === 4) return { string: 'A', position: '1st', finger: '3', extension: 'none', baseSemitones: 2 };
    if (diff === 5) return { string: 'A', position: '1st', finger: '4', extension: 'none', baseSemitones: 2 };
    return { string: 'A', position: '1st', finger: '4', extension: 'forward', baseSemitones: 2 };
  }
}

export interface CompactScoreDef {
  id: string;
  title: string;
  composer: string;
  origin: string;
  bpm: number;
  meter: [number, number];
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  category: 'study' | 'classical' | 'song';
  notes: [number, number, number][];
  backingParts: [string, string, string, number, [number, number, number, number][]][];
}

export const COMPACT_SCORES: CompactScoreDef[] = rawData as CompactScoreDef[];

export function inflateScore(raw: CompactScoreDef): CelloSongScore {
  const barDurationMs = measureDurationMs(raw.meter, raw.bpm);
  const totalMs = raw.notes.reduce((max, n) => Math.max(max, n[1] + n[2]), 0);
  const barCount = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const measures: CelloMeasure[] = Array.from({ length: barCount }, (_, index) => ({
    index,
    startBarTimeMs: index * barDurationMs,
    durationMs: barDurationMs,
    timeSignature: raw.meter,
    tempoBpm: raw.bpm,
  }));

  const notes: CelloNote[] = raw.notes.map(([midiNumber, startTimeMs, durationMs], i) => {
    const state = firstPositionState(midiNumber);
    const measureIndex = Math.min(barCount - 1, Math.floor(startTimeMs / barDurationMs));
    return {
      id: \`\${raw.id}-\${i + 1}\`,
      startTimeMs,
      durationMs: Math.max(1, Math.min(durationMs, barCount * barDurationMs - startTimeMs)),
      pitchName: midiToPitchName(midiNumber),
      midiNumber,
      frequency: Math.round(midiToFrequency(midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation: 'arco',
      tie: false,
      measureIndex,
      bowDirection: i % 2 === 0 ? 'down' : 'up',
    };
  });

  return {
    schemaVersion: '1.0.0',
    id: raw.id,
    metadata: {
      title: raw.title,
      composer: raw.composer,
      origin: raw.origin,
      keySignature: '1ST POSITION',
      timeSignature: raw.meter.join('/'),
      bpm: raw.bpm,
      difficulty: raw.difficulty,
      tonic: 'C',
      teaches: 'Arranged for cello first position. Playable across C, G, D, A strings.',
      rights: raw.category === 'classical' ? 'Public domain' : raw.category === 'study' ? 'Original study' : 'Arranged for Ponticello practice',
    },
    measures,
    notes,
  };
}

export function inflateBacking(raw: CompactScoreDef): BackingTrack {
  const parts: BackingPart[] = raw.backingParts.map(([name, inst, role, gain, tNotes], idx) => ({
    id: \`\${raw.id}-p\${idx}\`,
    name,
    instrument: inst as InstrumentName,
    role: role as PartRole,
    gain,
    muted: false,
    notes: tNotes.map(([midiNumber, startTimeMs, durationMs, velocity]) => ({
      midiNumber,
      startTimeMs,
      durationMs,
      velocity,
    })),
  }));

  const durationMs = parts.reduce(
    (max, part) => part.notes.reduce((m, n) => Math.max(m, n.startTimeMs + n.durationMs), max),
    0,
  );

  return {
    id: raw.id,
    name: raw.title,
    source: 'imported',
    parts,
    bpm: raw.bpm,
    durationMs,
  };
}
`;

writeFileSync('src/scores/bundledSongs.ts', outTs);
console.log('Done writing compact bundledSongs.ts and bundledSongs.json!');
