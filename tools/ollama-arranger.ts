/**
 * Serial Ollama Cello Arranger (tools/ollama-arranger.ts)
 *
 * Consumes MIDI files in _MIDIS/downloaded/ one by one using local Ollama (qwen3.5:4b).
 * Enforces a strict Top-Down Arranging Hierarchy:
 *   1. EXPERT (100% complete master line, full melody, no dead air during inactive bass)
 *   2. ADVANCED (Virtuosic & expressive, smoothed rapid bursts, leaps <= 12 st)
 *   3. INTERMEDIATE (Groove & theme focus, 1st-4th pos, C2-D4, <= 3 notes/s)
 *   4. BEGINNER (1st position tapes, held roots on downbeats, <= 1.8 notes/s)
 *
 * Audits ambiguous multi-position notes for accurate fretboard visualization.
 *
 * Usage:
 *   npx vite-node tools/ollama-arranger.ts --file "_MIDIS/downloaded/3 Doors Down - Kryptonite.mid"
 *   npx vite-node tools/ollama-arranger.ts --file "_MIDIS/downloaded/ACDC - Back in Black.mid" --dry-run
 *   npx vite-node tools/ollama-arranger.ts --all --resume
 *   npx vite-node tools/ollama-arranger.ts --all --max 5
 */

import { globSync } from "glob";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  CelloFinger,
  CelloPosition,
  CelloString,
  midiToFrequency,
  midiToPitchName,
  OPEN_STRING_MIDI,
  stopDistanceMm,
} from "../src/domain/cello";
import {
  ARRANGEMENT_WEIGHTS,
  candidateStates,
  CelloState,
  firstPositionFingering,
  RawNoteEvent,
  solveFingering,
} from "../src/domain/fingering";
import { detectKey } from "../src/domain/key";
import { MidiNote, ParsedMidi, parseMidi } from "../src/domain/midi";
import {
  CelloMeasure,
  CelloNote,
  CelloSongScore,
  DifficultyTier,
  measureDurationMs,
  validateScore,
} from "../src/domain/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CliOptions {
  file: string | null;
  all: boolean;
  resume: boolean;
  dryRun: boolean;
  max: number | null;
  model: string;
  host: string;
  outDir: string;
  cacheFile: string;
}

interface AmbiguousNoteAudit {
  noteIndex: number;
  midiNumber: number;
  pitchName: string;
  chosenString: CelloString;
  chosenPosition: CelloPosition;
  chosenFinger: CelloFinger;
  chosenDistanceMm: number;
  numCandidateLocations: number;
  candidateLocations: {
    string: CelloString;
    position: CelloPosition;
    finger: CelloFinger;
    distanceMm: number;
  }[];
  verdict:
    | "OK_OPEN_STRING"
    | "OK_RIFF_CONTINUATION"
    | "OK_HIGHER_POSITION"
    | "FLAGGED_UNIDIOMATIC";
  reason: string;
}

interface ArrangementBlueprint {
  songTitle: string;
  sourceKey: string;
  recommendedKey: string;
  keyTranspositionSemitones: number;
  tempoBpm: number;
  meter: [number, number];
  analysis: {
    harmonicForm: string;
    primaryBassTrackIndex: number;
    primaryMelodyTrackIndex: number;
    inactiveBassBarsCount: number;
    chordProgressionSummary?: string;
  };
  inactiveBarsStrategy?: {
    description: string;
    fillerApproach: "LOW_RIFF" | "HARMONIC_BASS" | "HARMONIC_DRONE" | "COMPOUND_FILL";
    harmonicBassNoteChoice?: string;
    targetTrackIndexForRiffs?: number | null;
  };
  topDownTierDirectives?: {
    expert: string;
    advanced: string;
    intermediate: string;
    beginner: string;
  };
  arrangingDirectives?: {
    compoundMelodyPlan: string;
    riffPreservationNotes: string;
  };
}

interface MeasureAnalysis {
  bar: number; // 1-indexed
  startMs: number;
  endMs: number;
  chordName: string;
  rootPc: number;
  lowestRootMidi: number; // 36-47 (C2-B2)
  fifthMidi: number; // 5th in cello register
  thirdMidi: number; // 3rd in cello register
  isBassOpenString: boolean; // true if C2 (36) or G2 (43)
  celloBassDesc: string; // e.g. "B2 (stopped, G string)", "F2 (stopped, C string)", "C2 (open C string)"
  bassActivePercent: number;
  isBassInactive: boolean;
  prominentTrackIndex: number | null;
  prominentTrackName: string | null;
  prominentRiffSnippet: string;
  melodyNotesInBar: MidiNote[];
  bassNotesInBar: MidiNote[];
  otherNotesInBar: MidiNote[];
}

// ─── Argument Parser ─────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliOptions {
  const getFlag = (
    name: string,
    fallback: string | null = null,
  ): string | null => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
  };

  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);

  return {
    file: getFlag("file"),
    all: hasFlag("all"),
    resume: hasFlag("resume"),
    dryRun: hasFlag("dry-run"),
    max: getFlag("max") ? Number(getFlag("max")) : null,
    model: getFlag("model", "qwen3.5:4b") ?? "qwen3.5:4b",
    host: getFlag("host", "http://localhost:11434") ?? "http://localhost:11434",
    outDir: getFlag("out-dir", "_MIDIS/arranged") ?? "_MIDIS/arranged",
    cacheFile:
      getFlag("cache", "_MIDIS/arrangements_cache.json") ??
      "_MIDIS/arrangements_cache.json",
  };
}

// ─── Pitch and Chord Utilities ───────────────────────────────────────────────

const PITCH_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

function foldToRegister(
  midiNumber: number,
  minMidi: number,
  maxMidi: number,
): number {
  let m = midiNumber;
  while (m < minMidi) m += 12;
  while (m > maxMidi) m -= 12;
  return m;
}

function detectBarChord(notes: readonly MidiNote[]): {
  rootPc: number;
  rootName: string;
  chordName: string;
  lowestRootMidi: number;
  fifthMidi: number;
  thirdMidi: number;
  isBassOpenString: boolean;
  celloBassDesc: string;
} {
  if (notes.length === 0) {
    return {
      rootPc: 0,
      rootName: "C",
      chordName: "C",
      lowestRootMidi: 36,
      fifthMidi: 43,
      thirdMidi: 40,
      isBassOpenString: true,
      celloBassDesc: "C2 (open C string, C root)",
    };
  }
  const histogram = new Array(12).fill(0);
  for (const n of notes) {
    const pc = ((n.midiNumber % 12) + 12) % 12;
    // Notes in the bass register (< 60 MIDI) carry stronger harmonic foundation weight
    const bassWeight = n.midiNumber < 48 ? 3.0 : n.midiNumber < 60 ? 2.0 : 1.0;
    histogram[pc] += Math.max(1, n.durationMs) * bassWeight;
  }
  let bestPc = 0;
  let maxWeight = -1;
  for (let pc = 0; pc < 12; pc++) {
    if (histogram[pc] > maxWeight) {
      maxWeight = histogram[pc];
      bestPc = pc;
    }
  }
  const rootName = PITCH_NAMES[bestPc] ?? "C";
  const min3Pc = (bestPc + 3) % 12;
  const maj3Pc = (bestPc + 4) % 12;
  const sus4Pc = (bestPc + 5) % 12;
  const dim5Pc = (bestPc + 6) % 12;
  const p5Pc = (bestPc + 7) % 12;
  const aug5Pc = (bestPc + 8) % 12;
  const min7Pc = (bestPc + 10) % 12;
  const maj7Pc = (bestPc + 11) % 12;

  const hasMin3 = histogram[min3Pc] > maxWeight * 0.2;
  const hasMaj3 = histogram[maj3Pc] > maxWeight * 0.2;
  const hasSus4 = !hasMin3 && !hasMaj3 && histogram[sus4Pc] > maxWeight * 0.25;
  const hasDim5 = histogram[dim5Pc] > maxWeight * 0.25;
  const hasP5 = histogram[p5Pc] > maxWeight * 0.2;
  const hasAug5 = histogram[aug5Pc] > maxWeight * 0.25;
  const hasMin7 = histogram[min7Pc] > maxWeight * 0.2;
  const hasMaj7 = histogram[maj7Pc] > maxWeight * 0.2;

  let chordQuality = "";
  if (hasMin3 && hasDim5) {
    chordQuality = "dim";
  } else if (hasMaj3 && hasAug5) {
    chordQuality = "aug";
  } else if (hasSus4 && hasP5) {
    chordQuality = "sus4";
  } else if (hasMin3 && !hasMaj3) {
    chordQuality = hasMin7 ? "m7" : "m";
  } else if (hasMaj3) {
    chordQuality = hasMaj7 ? "maj7" : hasMin7 ? "7" : "";
  } else if (hasP5) {
    chordQuality = "5";
  }

  const chordName = `${rootName}${chordQuality}`;
  const lowestRootMidi = 36 + bestPc; // C2 (36) to B2 (47)
  const isBassOpenString = lowestRootMidi === 36 || lowestRootMidi === 43; // C2 or G2

  const thirdOffset = hasMin3 ? 3 : 4;
  const thirdMidi = foldToRegister(lowestRootMidi + thirdOffset, 36, 55);
  const fifthOffset = hasDim5 ? 6 : hasAug5 ? 8 : 7;
  const fifthMidi = foldToRegister(lowestRootMidi + fifthOffset, 36, 55);

  let celloBassDesc = "";
  const pitchWithOctave = midiToPitchName(lowestRootMidi);
  if (lowestRootMidi === 36) {
    celloBassDesc = `${pitchWithOctave} (open C string, ${chordName} root)`;
  } else if (lowestRootMidi === 43) {
    celloBassDesc = `${pitchWithOctave} (open G string, ${chordName} root)`;
  } else if (lowestRootMidi < 43) {
    const semitonesAboveC = lowestRootMidi - 36;
    const finger =
      semitonesAboveC <= 1
        ? "half pos"
        : semitonesAboveC === 2
        ? "1st finger"
        : semitonesAboveC <= 4
        ? "2nd/3rd finger"
        : "4th finger";
    celloBassDesc = `${pitchWithOctave} (stopped on C string ${finger}, ${chordName} root)`;
  } else {
    const semitonesAboveG = lowestRootMidi - 43;
    const finger =
      semitonesAboveG <= 1
        ? "half pos"
        : semitonesAboveG === 2
        ? "1st finger"
        : semitonesAboveG <= 4
        ? "2nd/3rd finger"
        : "4th finger";
    celloBassDesc = `${pitchWithOctave} (stopped on G string ${finger}, ${chordName} root)`;
  }

  return {
    rootPc: bestPc,
    rootName,
    chordName,
    lowestRootMidi,
    fifthMidi,
    thirdMidi,
    isBassOpenString,
    celloBassDesc,
  };
}

// ─── Deterministic Multi-Track & Harmonic Feature Extraction ─────────────────

function extractMidiFeatures(parsed: ParsedMidi, fileName: string) {
  const baseTitle = basename(fileName).replace(/\.midi?$/i, "");
  const bpm = parsed.bpm > 0 ? Math.round(parsed.bpm) : 120;
  const timeSignature = parsed.timeSignature ?? [4, 4];
  const detectedKeyObj = detectKey(parsed.notes);
  const detectedKeyStr = detectedKeyObj.name;

  // Classify pitched tracks
  const pitchedTracks = parsed.tracks.filter(
    (t) => !t.isPercussion && t.noteCount > 0,
  );
  const pitchedTrackIndices = new Set(pitchedTracks.map((t) => t.index));

  // Identify Bass candidate: programs 32-39 or lowest mean pitch
  let bassTrack = pitchedTracks.find(
    (t) => t.program !== null && t.program >= 32 && t.program <= 39,
  );
  if (!bassTrack && pitchedTracks.length > 0) {
    bassTrack = pitchedTracks.reduce((lowest, current) => {
      const avgCurrent = (current.lowestMidi + current.highestMidi) / 2;
      const avgLowest = (lowest.lowestMidi + lowest.highestMidi) / 2;
      return avgCurrent < avgLowest ? current : lowest;
    }, pitchedTracks[0]);
  }

  // Identify Melody candidate: non-bass track with prominent activity in mid-high register
  const nonBassTracks = pitchedTracks.filter((t) => t !== bassTrack);
  const melodyTrack =
    nonBassTracks.length > 0
      ? nonBassTracks.reduce(
          (best, curr) => (curr.noteCount > best.noteCount ? curr : best),
          nonBassTracks[0],
        )
      : bassTrack;

  // Calculate measure metrics
  const barDurationMs = measureDurationMs(timeSignature, bpm);
  const totalMs = parsed.durationMs;
  const totalBars = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const bassTrackIndex = bassTrack?.index ?? -1;
  const melodyTrackIndex = melodyTrack?.index ?? -1;

  const bassNotes = parsed.notes.filter((n) => n.track === bassTrackIndex);
  const melodyNotes = parsed.notes.filter((n) => n.track === melodyTrackIndex);

  const measureDetails: MeasureAnalysis[] = [];
  let inactiveBassBarsCount = 0;

  for (let bar = 0; bar < totalBars; bar++) {
    const startMs = bar * barDurationMs;
    const endMs = startMs + barDurationMs;

    const barPitchedNotes = parsed.notes.filter(
      (n) =>
        pitchedTrackIndices.has(n.track) &&
        n.startTimeMs < endMs &&
        n.startTimeMs + n.durationMs > startMs,
    );

    const bNotes = bassNotes.filter(
      (n) => n.startTimeMs < endMs && n.startTimeMs + n.durationMs > startMs,
    );
    const mNotes = melodyNotes.filter(
      (n) => n.startTimeMs < endMs && n.startTimeMs + n.durationMs > startMs,
    );
    const oNotes = barPitchedNotes.filter(
      (n) => n.track !== bassTrackIndex && n.track !== melodyTrackIndex,
    );

    const bassSoundingMs = bNotes.reduce((acc, n) => {
      const overlap =
        Math.min(endMs, n.startTimeMs + n.durationMs) -
        Math.max(startMs, n.startTimeMs);
      return acc + Math.max(0, overlap);
    }, 0);
    const bassActivePercent = Math.min(
      100,
      Math.round((bassSoundingMs / barDurationMs) * 100),
    );
    const isBassInactive = bassActivePercent < 25;

    if (isBassInactive) inactiveBassBarsCount++;

    const chord = detectBarChord(barPitchedNotes);

    // Find prominent other track in this bar if bass is inactive
    let prominentTrackIndex: number | null = null;
    let prominentTrackName: string | null = null;
    let prominentRiffSnippet = "";

    if (isBassInactive && oNotes.length > 0) {
      const trackCounts = new Map<number, number>();
      for (const n of oNotes) {
        trackCounts.set(n.track, (trackCounts.get(n.track) ?? 0) + 1);
      }
      let bestTrack = -1;
      let maxCount = 0;
      for (const [tIdx, count] of trackCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestTrack = tIdx;
        }
      }
      if (bestTrack >= 0) {
        prominentTrackIndex = bestTrack;
        const trk = pitchedTracks.find((t) => t.index === bestTrack);
        prominentTrackName = trk?.name ?? `Track ${bestTrack}`;
        const riffNotes = oNotes
          .filter((n) => n.track === bestTrack)
          .slice(0, 4)
          .map((n) => midiToPitchName(n.midiNumber));
        prominentRiffSnippet = riffNotes.join(" ");
      }
    }

    measureDetails.push({
      bar: bar + 1,
      startMs,
      endMs,
      chordName: chord.chordName,
      rootPc: chord.rootPc,
      lowestRootMidi: chord.lowestRootMidi,
      fifthMidi: chord.fifthMidi,
      thirdMidi: chord.thirdMidi,
      isBassOpenString: chord.isBassOpenString,
      celloBassDesc: chord.celloBassDesc,
      bassActivePercent,
      isBassInactive,
      prominentTrackIndex,
      prominentTrackName,
      prominentRiffSnippet,
      melodyNotesInBar: mNotes,
      bassNotesInBar: bNotes,
      otherNotesInBar: oNotes,
    });
  }

  // Pick representative sample measures for the prompt
  const sampleMeasures = measureDetails
    .filter(
      (m) =>
        m.bar <= 8 || m.bar % 8 === 0 || (m.isBassInactive && m.bar % 4 === 0),
    )
    .slice(0, 24)
    .map((m) => ({
      bar: m.bar,
      chord: m.chordName,
      bassActivePercent: m.bassActivePercent,
      isBassInactive: m.isBassInactive,
      activeRiffOrDrone: m.isBassInactive
        ? m.prominentTrackName
          ? `${m.prominentTrackName}: ${m.prominentRiffSnippet}`
          : `Harmonic Bass: ${m.celloBassDesc}`
        : m.melodyNotesInBar.length > 0
          ? `Melody: ${m.melodyNotesInBar
              .slice(0, 3)
              .map((n) => midiToPitchName(n.midiNumber))
              .join(" ")}`
          : "Bass groove",
    }));

  return {
    fileName,
    title: baseTitle,
    detectedKey: detectedKeyStr,
    bpm,
    timeSignature,
    totalBars,
    totalNotes: parsed.notes.length,
    bassTrackIndex: bassTrack?.index ?? 0,
    bassTrackName: bassTrack?.name ?? "Bass",
    melodyTrackIndex: melodyTrack?.index ?? 0,
    melodyTrackName: melodyTrack?.name ?? "Melody",
    inactiveBassBarsCount,
    measureDetails,
    sampleMeasures,
    pitchedTracksSummary: pitchedTracks.map((t) => ({
      index: t.index,
      name: t.name ?? `Track ${t.index}`,
      program: t.program,
      noteCount: t.noteCount,
      range: `${midiToPitchName(t.lowestMidi)} - ${midiToPitchName(t.highestMidi)}`,
    })),
  };
}

// ─── 5-Stage Internal Grilling Prompt Builder ────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an elite computational musicologist, concert cellist, and master arranger for the Ponticello Cello platform.
You strictly adhere to the cello-scoring doctrine from .claude/skills/cello-scoring (INSTRUMENT.md, ARRANGING.md, PIPELINE.md).

CORE CELLO AXIOMS:
1. Standard Tuning: C2 (36) - G2 (43) - D3 (50) - A3 (57). Never scordatura.
2. Compass: C2 (36) to A5 (81). Practical lower resonant anchor: C2 to D4 (36-62).
3. Left-Hand Geometry:
   - Neck positions (Half-4th): 4-finger closed frame spans a MINOR THIRD (not a major third!).
   - Intermediate positions (5th-7th): Hand transitions over the body.
   - Thumb position: Offered only above D4 (MIDI 62). NO 4th finger in thumb position.
4. Monophonic Schema: Harmony must be translated into compound melody (implied polyphony) - accented downbeat roots + interleaved melodic motifs.
5. ZERO DEAD AIR PRINCIPLE: The cello is the sole hero instrument of the app. The cellist must NEVER sit with empty measures while the band is playing!

HIERARCHICAL TOP-DOWN ARRANGING PHILOSOPHY:
You MUST start the arranging analysis from the most complete tier (Expert) and systematically adapt downward:
- EXPERT (100% Complete Master Line):
  Keeps 100% of the melody, vocal lines, and thematic guitar/solo hooks.
  When the melody rests, it weaves in the active bass groove.
  When the bass is "doing nothing" (silent intro/outro or guitar solo), the cello MUST NOT BE SILENT:
  It analyzes the chords being played by other instruments in that bar to provide the harmonic bass foundation:
  - Selects the functional bass note (chord root or harmonic inversion) in the cello's bass register (C2–D3 / MIDI 36–50) based on that bar's harmony.
  - CRITICAL: This harmonic bass does NOT need to be an open string! It can be any stopped note (e.g. F2, Bb2, Eb2, B2, C#2) or open string (C2, G2). Stopped bass notes on C and G strings are fully resonant, idiomatic, and allow expressive vibrato.
  - Sounds the bass note with an ACCENT on the downbeat ('accent'), with optional rhythmic pulses (e.g. 5th on beat 3) to support the groove.
  - If another instrument is playing an active signature riff (guitar/keyboard hook), the cello adapts that riff into the low register.
- ADVANCED (Virtuosic with Ergonomic Smoothing):
  Derived from Expert. Keeps the complete melody, but smooths extreme rapid bursts (>4 notes/s) and limits leaps to <= 12 semitones.
- INTERMEDIATE (Groove & Theme Focus):
  Derived from Advanced. Emphasizes driving bass roots, chord progression pulses, and core themes. Bound to 1st-4th position (C2-D4, <= 62 MIDI), max rate <= 3 notes/s.
- BEGINNER (1st Position Tapes):
  Derived from Intermediate. Bound strictly to 1st position (MIDI 36-62, tapes: Blue, Yellow, Yellow, Green). Plays held downbeat roots and open-string foundations. Minimal hand movement, max leap <= 9 semitones, rate <= 1.8 notes/s.

MANDATORY 5-STAGE INTERNAL GRILLING PROCEDURE:
You MUST think through your decisions inside a <think> block across these 5 specific audit gates before emitting JSON:

[GATE 1: ORIGINAL KEY INVARIANT (NEVER TRANSPOSE)]
CRITICAL REQUIREMENT: You must NEVER transpose a song to another key!
The original MIDI file and backing tracks will NOT be transposed at runtime. If the cello is transposed, it will clash dissonantly with the backing tracks.
Therefore, you must ALWAYS preserve the exact original key of the song. Both "sourceKey" and "recommendedKey" must be identical, and "keyTranspositionSemitones" MUST ALWAYS BE 0.
Do NOT attempt to transpose to a "more resonant" key (like C, G, D, or A). Standard cello tuning (C2-G2-D3-A3) can play in all 12 keys using closed and open fingerings. Your job is to adapt the register and fingerings in the ORIGINAL KEY.

[GATE 2: TOP-DOWN REGISTER & COMPASS GRILLING (EXPERT -> BEGINNER)]
Plan the register allocation top-down in the original key. Ensure Expert contains 100% of the vocal/melody line, folded into cello cantabile register (C3-A4) or virtuosic heights (up to A5). Plan how the easier tiers progressively narrow to 1st-4th position (Intermediate) and strictly 1st position C2-D4 (Beginner).

[GATE 3: ZERO DEAD AIR & HARMONIC BASS CHORD ANALYSIS (NOT AN OPEN STRING)]
Examine every section where the bass is "doing nothing" (silent or <25% active):
1. A "HARMONIC BASS" FOUNDATION DOES NOT NEED TO BE AN OPEN STRING!
   Do NOT assume or claim that a drone must be an open string (C2 or G2) or make nonsensical statements like "Bb is G# in cello terms".
   The cello's lowest register (C2–D3 / MIDI 36–50) contains all 12 chromatic pitches. Only C2 and G2 are open strings; the other 10 chromatic pitches (C#, D, Eb, E, F, F#, Ab, A, Bb, B) are played as STOPPED notes in neck positions on the C and G strings.
   Stopped bass notes on the cello are deep, resonant, and have the added advantage of allowing warm vibrato on held notes.
2. ANALYZE THE BAR'S CHORD HARMONY:
   Look at the chords being played across all active instruments in each bar (guitars, piano, synth, pads).
   Decide the appropriate bass note for that chord based on its harmony:
   - Primarily the chord root in cello low register (C2–D3 / MIDI 36–50), e.g. B2 for Bm, F2 for F major, Bb2 for Bb minor, Eb2 for Eb major.
   - If an inversion or slash chord is played by the band (e.g., C/E or D/F#), the functional bass note (E2 or F#2) provides smooth stepwise voice leading.
3. PRESCRIBE CELLO EXECUTION:
   - Sound the chord's bass note on the downbeat with an ACCENT ('accent' articulation) so it mentally sustains through the bar (cello implied polyphony doctrine).
   - If the harmony sustains across the bar, maintain rhythmic momentum with a secondary chord-tone pulse (such as the perfect fifth on beat 3, or a rhythmic pulse matching the meter).
   - If a signature riff (guitar/keyboard hook) is active while the bass rests, adapt that riff into the low cello register.
Result: The cello always plays an active, harmonically accurate bass or melodic line throughout every bar of the song.

[GATE 4: MULTI-TRACK HARMONIC ALIGNMENT]
Inspect the sounding chords across all tracks in each measure. Ensure that every note played by the cello—whether carrying the vocal melody, guitar riff, bass groove, or chord foundation—makes rigorous harmonic sense with the chords played by the rest of the band.

[GATE 5: RIFF CONTINUITY VS. OPEN STRINGS & FRETBOARD GATING]
For ambiguous notes (such as D3 or A3):
- Balance open string resonance against riff continuity with finger 4.
- If playing a coherent rock or scalar riff on the lower string (e.g. G string riff), using finger 4 preserves tone color, groove, and avoids unmotivated string crossings.
- In Beginner, open strings provide relief, but do not force an open string abruptly inside a tight riff.

OUTPUT FORMAT:
After your <think> section, output ONLY valid JSON matching this exact structure:
{
  "songTitle": string,
  "sourceKey": string,
  "recommendedKey": string,
  "keyTranspositionSemitones": 0,
  "tempoBpm": number,
  "meter": [number, number],
  "analysis": {
    "harmonicForm": string,
    "primaryBassTrackIndex": number,
    "primaryMelodyTrackIndex": number,
    "inactiveBassBarsCount": number,
    "chordProgressionSummary": string
  },
  "inactiveBarsStrategy": {
    "description": string,
    "fillerApproach": "LOW_RIFF" | "HARMONIC_BASS" | "HARMONIC_DRONE" | "COMPOUND_FILL",
    "harmonicBassNoteChoice": string,
    "targetTrackIndexForRiffs": number | null
  },
  "topDownTierDirectives": {
    "expert": string,
    "advanced": string,
    "intermediate": string,
    "beginner": string
  }
}`;
}

function buildUserPrompt(
  features: ReturnType<typeof extractMidiFeatures>,
): string {
  return `Please analyze this MIDI file and generate the hierarchical top-down cello arrangement blueprint:

Song Title: ${features.title}
Detected Key: ${features.detectedKey}
Tempo: ${features.bpm} BPM
Time Signature: ${features.timeSignature[0]}/${features.timeSignature[1]}
Total Length: ${features.totalBars} bars (${features.totalNotes} notes)

Instrument Tracks in File:
${JSON.stringify(features.pitchedTracksSummary, null, 2)}

Primary Bass Candidate: Track ${features.bassTrackIndex} ("${features.bassTrackName}")
Primary Melody Candidate: Track ${features.melodyTrackIndex} ("${features.melodyTrackName}")
Inactive Bass Bars (<25% active): ${features.inactiveBassBarsCount} of ${features.totalBars} bars

Measure-by-Measure Harmonic & Inactive Bass Overview:
${JSON.stringify(features.sampleMeasures, null, 2)}

CRITICAL REQUIREMENTS:
1. NEVER transpose this song to another key! The MIDI backing tracks will play in the original detected key (${features.detectedKey}).
   You MUST set "recommendedKey" equal to "${features.detectedKey}", and "keyTranspositionSemitones" MUST be 0.
2. HARMONIC BASS DIRECTIVE:
   When the bass is inactive, analyze the chords and harmony played in those bars and decide the functional bass note (primarily the chord root in C2-D3).
   Remember: a harmonic bass does NOT need to be an open string! All 12 chromatic pitches (Bb2, F2, Eb2, B2, C#2, etc.) are available as stopped notes on the C and G strings and provide rich, resonant bass foundations with vibrato.

Conduct your deep 5-stage internal grilling in <think>, starting from the 100% Expert master arrangement and deriving down to Beginner with zero dead air, then provide the JSON ArrangementBlueprint.`;
}

// ─── Ollama Client ───────────────────────────────────────────────────────────

async function queryOllama(
  host: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ thinking: string; blueprint: ArrangementBlueprint }> {
  const url = `${host}/api/chat`;

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options: {
      temperature: 0.2,
      num_ctx: 32768,
    },
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${errorText}`);
  }

  const json = await res.json();
  const rawContent = json?.message?.content ?? "";
  let thinking = json?.message?.thinking ?? "";

  if (!thinking) {
    const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
    }
  }

  const jsonContent = rawContent
    .replace(/<think>[\s\S]*?<\/think>/i, "")
    .trim();

  // Extract JSON from potential code fences
  const fenceMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const cleanedJson = fenceMatch ? fenceMatch[1] : jsonContent;

  let blueprint: ArrangementBlueprint;
  try {
    blueprint = JSON.parse(cleanedJson);
    // Invariant: NEVER transpose! Backing MIDI plays in the original key.
    blueprint.keyTranspositionSemitones = 0;
    if (blueprint.sourceKey) {
      blueprint.recommendedKey = blueprint.sourceKey;
    }
  } catch (err) {
    throw new Error(
      `Failed to parse Ollama JSON response: ${err}\nRaw content:\n${jsonContent}`,
    );
  }

  return { thinking, blueprint };
}

// ─── Top-Down Hierarchical Synthesizers ──────────────────────────────────────

/**
 * 1. EXPERT TIER (Master Score - 100% Complete)
 * Retains 100% of melody notes in the original key.
 * During melody gaps, weaves in bass downbeat roots.
 * When bass is inactive, takes over guitar/keyboard riffs in low register or harmonic drones.
 * Zero dead air.
 */
function buildMasterExpertNotes(
  features: ReturnType<typeof extractMidiFeatures>,
  _blueprint: ArrangementBlueprint,
): RawNoteEvent[] {
  // Invariant: NEVER transpose to another key because MIDI backing tracks play in original key
  const transposition = 0;
  const expertEvents: RawNoteEvent[] = [];

  for (const m of features.measureDetails) {
    const {
      startMs,
      endMs,
      melodyNotesInBar,
      bassNotesInBar,
      otherNotesInBar,
    } = m;

    if (melodyNotesInBar.length > 0) {
      // 100% of melody notes are preserved!
      for (const n of melodyNotesInBar) {
        const midi = foldToRegister(n.midiNumber + transposition, 36, 81);
        expertEvents.push({
          midiNumber: midi,
          startTimeMs: n.startTimeMs,
          durationMs: Math.max(40, n.durationMs),
        });
      }

      // Check if beat 1 downbeat has a rest before melody starts
      const firstStart = melodyNotesInBar[0]!.startTimeMs;
      if (firstStart - startMs > 350) {
        // Gap at beginning of bar: weave in bass downbeat root
        const downbeatBass = bassNotesInBar.find(
          (b) => b.startTimeMs < startMs + 350,
        );
        if (downbeatBass) {
          const bassMidi = foldToRegister(
            downbeatBass.midiNumber + transposition,
            36,
            50,
          );
          expertEvents.push({
            midiNumber: bassMidi,
            startTimeMs: Math.max(startMs, downbeatBass.startTimeMs),
            durationMs: Math.min(
              downbeatBass.durationMs,
              firstStart - startMs - 20,
            ),
          });
        } else {
          // Add harmonic root on beat 1
          const rootMidi = foldToRegister(m.lowestRootMidi, 36, 47);
          expertEvents.push({
            midiNumber: rootMidi,
            startTimeMs: startMs,
            durationMs: Math.min(500, firstStart - startMs - 20),
          });
        }
      }
    } else if (bassNotesInBar.length > 0 && !m.isBassInactive) {
      // Melody rests, but bass is active: cello plays full bass groove
      for (const n of bassNotesInBar) {
        const midi = foldToRegister(n.midiNumber + transposition, 36, 55);
        expertEvents.push({
          midiNumber: midi,
          startTimeMs: n.startTimeMs,
          durationMs: Math.max(40, n.durationMs),
        });
      }
    } else {
      // Inactive bass & inactive melody: Zero Dead Air!
      // Cello plays other instrument's riff or harmonic bass foundation based on chord analysis
      const targetRiffNotes =
        m.prominentTrackIndex !== null
          ? otherNotesInBar.filter((n) => n.track === m.prominentTrackIndex)
          : otherNotesInBar;

      if (targetRiffNotes.length > 0) {
        for (const n of targetRiffNotes) {
          // Adapt to cello's lowest register (C2 to G3, MIDI 36-55)
          const midi = foldToRegister(n.midiNumber + transposition, 36, 55);
          expertEvents.push({
            midiNumber: midi,
            startTimeMs: n.startTimeMs,
            durationMs: Math.max(40, n.durationMs),
          });
        }
      } else {
        // Emit harmonic bass foundation based on chord analysis of this bar.
        // The chord root is placed in the low cello register (C2 to B2 / MIDI 36-47), stopped or open.
        const rootMidi = foldToRegister(m.lowestRootMidi, 36, 47);
        const barDur = endMs - startMs;
        const bassDur = Math.max(100, Math.min(barDur * 0.9, 1500));
        expertEvents.push({
          midiNumber: rootMidi,
          startTimeMs: startMs,
          durationMs: bassDur,
        });
        if (barDur >= 1400) {
          // Secondary pulse on beat 3 (perfect 5th of the chord) for rhythmic vitality and harmonic support
          const fifthMidi = foldToRegister(m.fifthMidi, 36, 55);
          expertEvents.push({
            midiNumber: fifthMidi,
            startTimeMs: startMs + barDur / 2,
            durationMs: Math.max(100, barDur * 0.4),
          });
        }
      }
    }
  }

  // Sort and resolve monophonic overlaps
  expertEvents.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const monophonicExpert: RawNoteEvent[] = [];
  for (let i = 0; i < expertEvents.length; i++) {
    const curr = expertEvents[i]!;
    if (i > 0 && curr.startTimeMs === expertEvents[i - 1]!.startTimeMs) {
      if (
        curr.midiNumber >
        monophonicExpert[monophonicExpert.length - 1]!.midiNumber
      ) {
        monophonicExpert[monophonicExpert.length - 1] = curr;
      }
      continue;
    }
    const next = expertEvents[i + 1];
    if (next && curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(30, next.startTimeMs - curr.startTimeMs);
    }
    if (curr.durationMs >= 30) {
      monophonicExpert.push(curr);
    }
  }

  return monophonicExpert;
}

/**
 * 2. ADVANCED TIER (Derived from Expert)
 * Retains ~80% of notes, smooths rapid runs, bounds leaps <= 12 st, 1st-7th position.
 */
function deriveAdvancedNotes(
  expertNotes: readonly RawNoteEvent[],
): RawNoteEvent[] {
  const out: RawNoteEvent[] = [];
  for (let i = 0; i < expertNotes.length; i++) {
    const curr = { ...expertNotes[i]! };
    if (curr.midiNumber > 79) {
      curr.midiNumber -= 12;
    }

    if (out.length > 0) {
      const prev = out[out.length - 1]!;
      let diff = curr.midiNumber - prev.midiNumber;
      while (diff > 12 && curr.midiNumber - 12 >= 36) {
        curr.midiNumber -= 12;
        diff = curr.midiNumber - prev.midiNumber;
      }
      while (diff < -12 && curr.midiNumber + 12 <= 79) {
        curr.midiNumber += 12;
        diff = curr.midiNumber - prev.midiNumber;
      }

      const gapMs = curr.startTimeMs - prev.startTimeMs;
      if (gapMs < 130 && i % 2 !== 0) {
        prev.durationMs += curr.durationMs;
        continue;
      }
    }

    out.push(curr);
  }

  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    if (curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(30, next.startTimeMs - curr.startTimeMs);
    }
  }

  return out;
}

/**
 * 3. INTERMEDIATE TIER (Derived from Advanced)
 * 1st-4th position only (MIDI 36-62). Rate <= 3 notes/s. Leaps <= 12 st. Groove & theme focus.
 */
function deriveIntermediateNotes(
  advancedNotes: readonly RawNoteEvent[],
): RawNoteEvent[] {
  const out: RawNoteEvent[] = [];
  for (let i = 0; i < advancedNotes.length; i++) {
    const curr = { ...advancedNotes[i]! };
    while (curr.midiNumber > 62) curr.midiNumber -= 12;
    while (curr.midiNumber < 36) curr.midiNumber += 12;

    if (out.length > 0) {
      const prev = out[out.length - 1]!;
      let diff = curr.midiNumber - prev.midiNumber;
      while (diff > 12 && curr.midiNumber - 12 >= 36) {
        curr.midiNumber -= 12;
        diff = curr.midiNumber - prev.midiNumber;
      }
      while (diff < -12 && curr.midiNumber + 12 <= 62) {
        curr.midiNumber += 12;
        diff = curr.midiNumber - prev.midiNumber;
      }

      const gapMs = curr.startTimeMs - prev.startTimeMs;
      if (gapMs < 200) {
        prev.durationMs += curr.durationMs;
        continue;
      }
    }

    out.push(curr);
  }

  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    if (curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(40, next.startTimeMs - curr.startTimeMs);
    }
  }

  return out;
}

/**
 * 4. BEGINNER TIER (Derived from Intermediate)
 * Strictly 1st position (MIDI 36-62). Held downbeat roots, minimal movement, rate <= 1.8 notes/s, leap <= 9 st.
 */
function deriveBeginnerNotes(
  intermediateNotes: readonly RawNoteEvent[],
  features: ReturnType<typeof extractMidiFeatures>,
  blueprint: ArrangementBlueprint,
): RawNoteEvent[] {
  const barDurationMs = measureDurationMs(blueprint.meter, blueprint.tempoBpm);
  // Invariant: NEVER transpose to another key because MIDI backing tracks play in original key
  const transposition = 0;
  const out: RawNoteEvent[] = [];

  for (const m of features.measureDetails) {
    const { startMs, endMs, lowestRootMidi } = m;
    const barInterNotes = intermediateNotes.filter(
      (n) => n.startTimeMs >= startMs && n.startTimeMs < endMs,
    );

    if (barInterNotes.length === 0) {
      const rootMidi = foldToRegister(lowestRootMidi + transposition, 36, 50);
      out.push({
        midiNumber: rootMidi,
        startTimeMs: startMs,
        durationMs: Math.max(200, (endMs - startMs) * 0.85),
      });
      continue;
    }

    const downbeat = barInterNotes[0]!;
    let firstMidi = foldToRegister(downbeat.midiNumber, 36, 62);

    if (out.length > 0) {
      const prev = out[out.length - 1]!;
      let diff = firstMidi - prev.midiNumber;
      while (diff > 9 && firstMidi - 12 >= 36) {
        firstMidi -= 12;
        diff = firstMidi - prev.midiNumber;
      }
      while (diff < -9 && firstMidi + 12 <= 62) {
        firstMidi += 12;
        diff = firstMidi - prev.midiNumber;
      }
    }

    const firstNoteDuration =
      barInterNotes.length === 1
        ? Math.max(300, (endMs - downbeat.startTimeMs) * 0.85)
        : Math.min(barDurationMs / 2 - 20, Math.max(200, downbeat.durationMs));

    out.push({
      midiNumber: firstMidi,
      startTimeMs: downbeat.startTimeMs,
      durationMs: firstNoteDuration,
    });

    const midpoint = startMs + barDurationMs / 2;
    const secondNote = barInterNotes.find(
      (n) => n.startTimeMs >= midpoint - 100,
    );
    if (secondNote && secondNote.startTimeMs - downbeat.startTimeMs > 400) {
      let secondMidi = foldToRegister(secondNote.midiNumber, 36, 62);
      let diff = secondMidi - firstMidi;
      while (diff > 9 && secondMidi - 12 >= 36) {
        secondMidi -= 12;
        diff = secondMidi - firstMidi;
      }
      while (diff < -9 && secondMidi + 12 <= 62) {
        secondMidi += 12;
        diff = secondMidi - firstMidi;
      }

      out.push({
        midiNumber: secondMidi,
        startTimeMs: secondNote.startTimeMs,
        durationMs: Math.max(200, (endMs - secondNote.startTimeMs) * 0.85),
      });
    }
  }

  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i]!;
    const next = out[i + 1]!;
    if (curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(40, next.startTimeMs - curr.startTimeMs);
    }
  }

  return out;
}

// ─── Fretboard & Ambiguous Note Verification Gate ────────────────────────────

function auditFretboardNotes(
  notes: readonly RawNoteEvent[],
  states: readonly CelloState[],
  tier: DifficultyTier,
): AmbiguousNoteAudit[] {
  const audits: AmbiguousNoteAudit[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const state = states[i];
    if (!note || !state) continue;

    const candidates = candidateStates(note.midiNumber);
    if (candidates.length <= 1) continue; // Unambiguous note

    const semitonesOnString = note.midiNumber - OPEN_STRING_MIDI[state.string];
    const chosenDistanceMm = stopDistanceMm(semitonesOnString);

    const prevNote = i > 0 ? notes[i - 1] : null;
    const prevState = i > 0 ? states[i - 1] : null;

    const isSameString = prevState && prevState.string === state.string;
    const isSmallStep =
      prevNote && Math.abs(note.midiNumber - prevNote.midiNumber) <= 4;
    const isRiffContinuation = Boolean(
      isSameString && isSmallStep && state.finger !== "0",
    );

    let verdict: AmbiguousNoteAudit["verdict"] = "OK_OPEN_STRING";
    let reason = "Standard placement.";

    if (state.finger === "0") {
      verdict = "OK_OPEN_STRING";
      reason = `Utilizes open string ${state.string} for intonation anchor and acoustic resonance.`;
    } else if (isRiffContinuation) {
      verdict = "OK_RIFF_CONTINUATION";
      reason = `Maintains string ${state.string} with finger ${state.finger} to preserve riff continuity and tonal cohesion.`;
    } else if (
      tier === "Beginner" &&
      (state.position === "1st" || state.position === "Half")
    ) {
      verdict = "OK_RIFF_CONTINUATION";
      reason = `Within 1st position hand frame (${chosenDistanceMm.toFixed(1)} mm).`;
    } else if (tier !== "Beginner" && chosenDistanceMm > 173) {
      verdict = "OK_HIGHER_POSITION";
      reason = `Higher position (${state.position}) acceptable for ${tier} tier.`;
    } else if (tier === "Beginner" && chosenDistanceMm > 175) {
      verdict = "FLAGGED_UNIDIOMATIC";
      reason = `Note exceeds 1st position limit (${chosenDistanceMm.toFixed(1)} mm > 173 mm) in Beginner tier!`;
    }

    audits.push({
      noteIndex: i + 1,
      midiNumber: note.midiNumber,
      pitchName: midiToPitchName(note.midiNumber),
      chosenString: state.string,
      chosenPosition: state.position,
      chosenFinger: state.finger,
      chosenDistanceMm: Math.round(chosenDistanceMm * 10) / 10,
      numCandidateLocations: candidates.length,
      candidateLocations: candidates.map((c) => {
        const semi = note.midiNumber - OPEN_STRING_MIDI[c.string];
        return {
          string: c.string,
          position: c.position,
          finger: c.finger,
          distanceMm: Math.round(stopDistanceMm(semi) * 10) / 10,
        };
      }),
      verdict,
      reason,
    });
  }

  return audits;
}

// ─── Score Synthesizer ───────────────────────────────────────────────────────

function synthesizeScore(
  id: string,
  blueprint: ArrangementBlueprint,
  arrangedNotes: RawNoteEvent[],
  states: CelloState[],
  tier: DifficultyTier,
): CelloSongScore {
  const barDurationMs = measureDurationMs(blueprint.meter, blueprint.tempoBpm);
  const totalMs = Math.max(
    ...arrangedNotes.map((n) => n.startTimeMs + n.durationMs),
  );
  const barCount = Math.max(1, Math.ceil(totalMs / barDurationMs));

  const measures: CelloMeasure[] = Array.from(
    { length: barCount },
    (_, index) => ({
      index,
      startBarTimeMs: index * barDurationMs,
      durationMs: barDurationMs,
      timeSignature: blueprint.meter,
      tempoBpm: blueprint.tempoBpm,
    }),
  );

  const celloNotes: CelloNote[] = arrangedNotes.map((event, i) => {
    const state = states[i] ?? firstPositionFingering(event.midiNumber);
    const measureIndex = Math.min(
      barCount - 1,
      Math.floor(event.startTimeMs / barDurationMs),
    );
    return {
      id: `${id}-${tier.toLowerCase()}-${i + 1}`,
      startTimeMs: Math.round(event.startTimeMs),
      durationMs: Math.max(
        1,
        Math.min(
          event.durationMs,
          barCount * barDurationMs - event.startTimeMs,
        ),
      ),
      pitchName: midiToPitchName(event.midiNumber),
      midiNumber: event.midiNumber,
      frequency: Math.round(midiToFrequency(event.midiNumber) * 100) / 100,
      string: state.string,
      finger: state.finger,
      position: state.position,
      extension: state.extension,
      articulation:
        (tier === "Beginner" && i % 4 === 0) ||
        (event.midiNumber <= 50 && event.startTimeMs % barDurationMs < 40)
          ? "accent"
          : "arco",
      tie: false,
      measureIndex,
      bowDirection: i % 2 === 0 ? "down" : "up",
    };
  });

  const directive =
    blueprint.topDownTierDirectives?.[
      tier.toLowerCase() as keyof typeof blueprint.topDownTierDirectives
    ] ??
    blueprint.arrangingDirectives?.compoundMelodyPlan ??
    `${tier} arrangement.`;

  return {
    schemaVersion: "1.0.0",
    id: `${id}-${tier.toLowerCase()}`,
    metadata: {
      title: `${blueprint.songTitle} (${tier})`,
      composer: "Arranged via Ponticello qwen3.5:4b",
      origin: "OLLAMA CELLO ADAPTATION",
      keySignature: blueprint.recommendedKey,
      timeSignature: `${blueprint.meter[0]}/${blueprint.meter[1]}`,
      bpm: blueprint.tempoBpm,
      difficulty: tier,
      tonic: blueprint.recommendedKey.trim().split(" ")[0] ?? "C",
      teaches: `${tier} arrangement. ${directive}`,
      rights:
        "Transcribed for educational practice on the Ponticello Cello platform.",
    },
    measures,
    notes: celloNotes,
  };
}

// ─── Single File Processing Pipeline ─────────────────────────────────────────

async function processFile(filePath: string, options: CliOptions) {
  const fileName = basename(filePath);
  const songId = fileName
    .replace(/\.midi?$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  console.log(
    `\n================================================================`,
  );
  console.log(`[START] Processing: ${fileName}`);
  console.log(
    `================================================================`,
  );

  // Step 1: Deterministic Multi-Track & Harmonic Extraction
  const midiBytes = new Uint8Array(readFileSync(filePath));
  const parsed = parseMidi(midiBytes);
  if (parsed.notes.length === 0) {
    console.warn(`  [WARN] Skipping ${fileName}: No notes found.`);
    return;
  }

  const features = extractMidiFeatures(parsed, fileName);
  console.log(
    `  Extracted: Key=${features.detectedKey}, BPM=${features.bpm}, Measures=${features.totalBars}, Notes=${features.totalNotes}`,
  );
  console.log(
    `  Pitched Tracks: ${features.pitchedTracksSummary.length}, Inactive Bass Bars: ${features.inactiveBassBarsCount}/${features.totalBars}`,
  );

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(features);

  if (options.dryRun) {
    console.log("\n[DRY RUN] System Prompt Preview:");
    console.log(systemPrompt.slice(0, 500) + "...\n");
    console.log("[DRY RUN] User Prompt Preview:");
    console.log(userPrompt);
    console.log("\n[DRY RUN] Completed without calling Ollama.");
    return;
  }

  // Step 2: Ollama Deep Thinking & Blueprint Generation
  console.log(`  Sending request to local Ollama (${options.model})...`);
  console.log(`  Allowing deep thinking (no rush)...`);
  const startTime = Date.now();

  const { thinking, blueprint } = await queryOllama(
    options.host,
    options.model,
    systemPrompt,
    userPrompt,
  );

  const elapsedSec: string = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `  Model responded in ${elapsedSec}s. Captured ${thinking.length} chars of <think> log.`,
  );

  // CRITICAL INVARIANT: NEVER transpose! Backing MIDI plays in original key.
  blueprint.keyTranspositionSemitones = 0;
  blueprint.sourceKey = features.detectedKey || blueprint.sourceKey;
  blueprint.recommendedKey = blueprint.sourceKey;

  // Step 3: Top-Down Multi-tier Arrangement & Fretboard Verification
  const songOutDir = join(options.outDir, songId);
  mkdirSync(songOutDir, { recursive: true });

  writeFileSync(
    join(songOutDir, "thinking_log.md"),
    `# Arrangement Thinking Log: ${blueprint.songTitle}\n\n${thinking}\n\n## Blueprint\n\`\`\`json\n${JSON.stringify(blueprint, null, 2)}\n\`\`\`\n`,
  );

  console.log(
    `  Synthesizing top-down: Expert (100% master) -> Advanced -> Intermediate -> Beginner...`,
  );

  // Hierarchical generation
  const expertNotes = buildMasterExpertNotes(features, blueprint);
  const advancedNotes = deriveAdvancedNotes(expertNotes);
  const intermediateNotes = deriveIntermediateNotes(advancedNotes);
  const beginnerNotes = deriveBeginnerNotes(
    intermediateNotes,
    features,
    blueprint,
  );

  const tierNotesMap: Record<DifficultyTier, RawNoteEvent[]> = {
    Expert: expertNotes,
    Advanced: advancedNotes,
    Intermediate: intermediateNotes,
    Beginner: beginnerNotes,
  };

  const tiers: DifficultyTier[] = [
    "Expert",
    "Advanced",
    "Intermediate",
    "Beginner",
  ];
  const allAudits: Record<string, AmbiguousNoteAudit[]> = {};

  for (const tier of tiers) {
    const rawEvents = tierNotesMap[tier];

    // Solve fingering
    const states: CelloState[] =
      tier === "Beginner"
        ? rawEvents.map((e) => firstPositionFingering(e.midiNumber))
        : solveFingering(rawEvents, ARRANGEMENT_WEIGHTS).states;

    // Audit ambiguous notes for fretboard
    const audits = auditFretboardNotes(rawEvents, states, tier);
    allAudits[tier] = audits;

    // Synthesize score
    const score = synthesizeScore(songId, blueprint, rawEvents, states, tier);

    // Validate score
    const problems = validateScore(score);
    if (problems.length > 0) {
      console.warn(
        `  [WARN] ${tier} score has validation problems:`,
        problems.slice(0, 3),
      );
    }

    // Minify JSON: strip all indentation and whitespace to keep files as compact as possible
    writeFileSync(
      join(songOutDir, `${tier.toLowerCase()}.json`),
      JSON.stringify(score),
    );
    const densityPct =
      tier === "Expert"
        ? 100
        : Math.round((score.notes.length / expertNotes.length) * 100);
    console.log(
      `  Emitted ${tier}: ${score.notes.length} notes (${densityPct}% density), ${audits.length} ambiguous notes audited.`,
    );
  }

  // Minify fretboard audit JSON
  writeFileSync(
    join(songOutDir, "fretboard_audit.json"),
    JSON.stringify(allAudits),
  );
  console.log(`  Saved arranged package to: ${songOutDir}`);
}

// ─── Main Batch Orchestrator ─────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log("--- Ollama Serial Cello Arranger (qwen3.5:4b) ---");
  console.log(`Host: ${options.host} | Model: ${options.model}`);

  if (options.file) {
    await processFile(resolve(options.file), options);
    return;
  }

  if (options.all) {
    const midiFiles = globSync("_MIDIS/downloaded/*.{mid,midi}").sort();
    console.log(`Found ${midiFiles.length} files in _MIDIS/downloaded/`);

    // Load cache
    let cache: Record<string, { status: string; timestamp: string }> = {};
    if (existsSync(options.cacheFile)) {
      try {
        cache = JSON.parse(readFileSync(options.cacheFile, "utf-8"));
      } catch {
        cache = {};
      }
    }

    let processedCount = 0;
    for (const filePath of midiFiles) {
      const fileName = basename(filePath);

      if (options.resume && cache[fileName]?.status === "completed") {
        console.log(`  [SKIP] ${fileName} (already completed)`);
        continue;
      }

      if (options.max !== null && processedCount >= options.max) {
        console.log(`\nReached maximum batch limit of ${options.max} songs.`);
        break;
      }

      try {
        await processFile(filePath, options);
        cache[fileName] = {
          status: "completed",
          timestamp: new Date().toISOString(),
        };
        processedCount++;
      } catch (err) {
        console.error(`  [ERROR] Failed processing ${fileName}:`, err);
        cache[fileName] = {
          status: "failed",
          timestamp: new Date().toISOString(),
        };
      }

      writeFileSync(options.cacheFile, JSON.stringify(cache, null, 2));
    }

    console.log(`\nBatch run completed. Processed: ${processedCount} songs.`);
    return;
  }

  console.error('Please specify either --file "<path>" or --all.');
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal pipeline error:", err);
  process.exit(1);
});
