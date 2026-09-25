/**
 * The deterministic half of the Ollama cello arranger.
 *
 * Shared by tools/ollama-arranger.ts (one model over the whole library) and
 * tools/ollama-benchmark.ts (every model over two songs): MIDI feature
 * extraction, the arranging prompt, the top-down tier synthesizers, the
 * fretboard audit and score synthesis. Keeping them in one module is what lets
 * the benchmark compare models on exactly the notes the arranger produces.
 *
 * Nothing here touches the filesystem. `queryOllama` is the arranger's simple
 * non-streaming client; the benchmark has its own streaming one.
 */

import { basename } from "node:path";

import {
  CelloFinger, CelloPosition, CelloString, midiToFrequency, midiToPitchName, OPEN_STRING_MIDI,
  stopDistanceMm, candidateStates, CelloState, firstPositionFingering, RawNoteEvent, detectKey,
  MidiNote, ParsedMidi, CelloMeasure, CelloNote, CelloSongScore, DifficultyTier,
  measureDurationMs,
  weighPitchClasses,
} from "@domain";
import { POSITION_FREEDOM_DOCTRINE } from "./benchmarkCore";
import { CelloScoringSkill, planContext, skillMessages } from "./celloScoringSkill";

// ─── Types ───────────────────────────────────────────────────────────────────


export interface AmbiguousNoteAudit {
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

export interface ArrangementBlueprint {
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

export interface MeasureAnalysis {
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

export function foldToRegister(
  midiNumber: number,
  minMidi: number,
  maxMidi: number,
): number {
  let m = midiNumber;
  while (m < minMidi) m += 12;
  while (m > maxMidi) m -= 12;
  return m;
}

export interface BarChord {
  rootPc: number;
  rootName: string;
  chordName: string;
  lowestRootMidi: number;
  fifthMidi: number;
  thirdMidi: number;
  isBassOpenString: boolean;
  celloBassDesc: string;
}

const EMPTY_BAR_CHORD: BarChord = {
  rootPc: 0,
  rootName: "C",
  chordName: "C",
  lowestRootMidi: 36,
  fifthMidi: 43,
  thirdMidi: 40,
  isBassOpenString: true,
  celloBassDesc: "C2 (open C string, C root)",
};

/** Notes in the bass register carry stronger harmonic foundation weight. */
function registerWeight(midiNumber: number): number {
  if (midiNumber < 48) return 3.0;
  return midiNumber < 60 ? 2.0 : 1.0;
}

function weightedPitchClasses(notes: readonly MidiNote[]): number[] {
  return weighPitchClasses(notes, { weightOf: (note, ms) => Math.max(1, ms) * registerWeight(note.midiNumber) }).weights;
}

type ChordIntervals = {
  min3: boolean; maj3: boolean; sus4: boolean; dim5: boolean; p5: boolean; aug5: boolean; min7: boolean; maj7: boolean;
};

/** Which intervals above the root sound strongly enough to count, relative to the root's weight. */
function intervalsPresent(histogram: readonly number[], rootPc: number, rootWeight: number): ChordIntervals {
  const strong = (semitones: number, share: number) => histogram[(rootPc + semitones) % 12]! > rootWeight * share;
  const min3 = strong(3, 0.2);
  const maj3 = strong(4, 0.2);
  return {
    min3,
    maj3,
    sus4: !min3 && !maj3 && strong(5, 0.25),
    dim5: strong(6, 0.25),
    p5: strong(7, 0.2),
    aug5: strong(8, 0.25),
    min7: strong(10, 0.2),
    maj7: strong(11, 0.2),
  };
}

function majorQuality(i: ChordIntervals): string {
  if (i.maj7) return "maj7";
  return i.min7 ? "7" : "";
}

function chordQuality(i: ChordIntervals): string {
  if (i.min3 && i.dim5) return "dim";
  if (i.maj3 && i.aug5) return "aug";
  if (i.sus4 && i.p5) return "sus4";
  if (i.min3 && !i.maj3) return i.min7 ? "m7" : "m";
  if (i.maj3) return majorQuality(i);
  return i.p5 ? "5" : "";
}

function fifthOffset(i: ChordIntervals): number {
  if (i.dim5) return 6;
  return i.aug5 ? 8 : 7;
}

/** The finger that stops a note this many semitones above the open string, in first position. */
function stoppingFinger(semitones: number): string {
  if (semitones <= 1) return "half pos";
  if (semitones === 2) return "1st finger";
  return semitones <= 4 ? "2nd/3rd finger" : "4th finger";
}

function celloBassDescription(lowestRootMidi: number, chordName: string): string {
  const pitch = midiToPitchName(lowestRootMidi);
  if (lowestRootMidi === 36) return `${pitch} (open C string, ${chordName} root)`;
  if (lowestRootMidi === 43) return `${pitch} (open G string, ${chordName} root)`;
  const [string, open] = lowestRootMidi < 43 ? ["C", 36] : ["G", 43];
  return `${pitch} (stopped on ${string} string ${stoppingFinger(lowestRootMidi - open)}, ${chordName} root)`;
}

export function detectBarChord(notes: readonly MidiNote[]): BarChord {
  if (notes.length === 0) return { ...EMPTY_BAR_CHORD };
  const histogram = weightedPitchClasses(notes);
  let bestPc = 0;
  let maxWeight = -1;
  for (let pc = 0; pc < 12; pc++) {
    if (histogram[pc]! > maxWeight) {
      maxWeight = histogram[pc]!;
      bestPc = pc;
    }
  }
  const rootName = PITCH_NAMES[bestPc] ?? "C";
  const intervals = intervalsPresent(histogram, bestPc, maxWeight);
  const chordName = `${rootName}${chordQuality(intervals)}`;
  const lowestRootMidi = 36 + bestPc; // C2 (36) to B2 (47)
  return {
    rootPc: bestPc,
    rootName,
    chordName,
    lowestRootMidi,
    fifthMidi: foldToRegister(lowestRootMidi + fifthOffset(intervals), 36, 55),
    thirdMidi: foldToRegister(lowestRootMidi + (intervals.min3 ? 3 : 4), 36, 55),
    isBassOpenString: lowestRootMidi === 36 || lowestRootMidi === 43, // C2 or G2
    celloBassDesc: celloBassDescription(lowestRootMidi, chordName),
  };
}

// ─── Deterministic Multi-Track & Harmonic Feature Extraction ─────────────────

type PitchedTrack = ParsedMidi["tracks"][number];

const meanPitch = (track: PitchedTrack) => (track.lowestMidi + track.highestMidi) / 2;

/** A track on a bass program (32–39), else the lowest-sounding one. */
function pickBassTrack(tracks: readonly PitchedTrack[]): PitchedTrack | undefined {
  const byProgram = tracks.find((t) => t.program !== null && t.program >= 32 && t.program <= 39);
  if (byProgram || tracks.length === 0) return byProgram;
  return tracks.reduce((lowest, current) => (meanPitch(current) < meanPitch(lowest) ? current : lowest), tracks[0]!);
}

/** The busiest track that is not the bass; the bass itself when it is alone. */
function pickMelodyTrack(tracks: readonly PitchedTrack[], bass: PitchedTrack | undefined): PitchedTrack | undefined {
  const others = tracks.filter((t) => t !== bass);
  if (others.length === 0) return bass;
  return others.reduce((best, curr) => (curr.noteCount > best.noteCount ? curr : best), others[0]!);
}

const soundsIn = (n: MidiNote, startMs: number, endMs: number) =>
  n.startTimeMs < endMs && n.startTimeMs + n.durationMs > startMs;

function soundingMs(notes: readonly MidiNote[], startMs: number, endMs: number): number {
  return notes.reduce((acc, n) => acc + Math.max(0, Math.min(endMs, n.startTimeMs + n.durationMs) - Math.max(startMs, n.startTimeMs)), 0);
}

type ProminentTrack = { index: number | null; name: string | null; riff: string };

/** The busiest other track in a bar, named, with its first four notes as a riff. */
function prominentTrack(others: readonly MidiNote[], tracks: readonly PitchedTrack[]): ProminentTrack {
  const counts = new Map<number, number>();
  for (const n of others) counts.set(n.track, (counts.get(n.track) ?? 0) + 1);
  let best = -1;
  let maxCount = 0;
  for (const [index, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      best = index;
    }
  }
  if (best < 0) return { index: null, name: null, riff: "" };
  const riff = others.filter((n) => n.track === best).slice(0, 4).map((n) => midiToPitchName(n.midiNumber)).join(" ");
  return { index: best, name: tracks.find((t) => t.index === best)?.name ?? `Track ${best}`, riff };
}

interface BarInput {
  bar: number;
  startMs: number;
  endMs: number;
  notes: readonly MidiNote[];
  pitchedTracks: readonly PitchedTrack[];
  pitchedTrackIndices: ReadonlySet<number>;
  bassNotes: readonly MidiNote[];
  melodyNotes: readonly MidiNote[];
  bassTrackIndex: number;
  melodyTrackIndex: number;
}

const BASS_INACTIVE_PERCENT = 25;

function analyseBar(input: BarInput): MeasureAnalysis {
  const { bar, startMs, endMs } = input;
  const barMs = endMs - startMs;
  const pitched = input.notes.filter((n) => input.pitchedTrackIndices.has(n.track) && soundsIn(n, startMs, endMs));
  const bNotes = input.bassNotes.filter((n) => soundsIn(n, startMs, endMs));
  const mNotes = input.melodyNotes.filter((n) => soundsIn(n, startMs, endMs));
  const oNotes = pitched.filter((n) => n.track !== input.bassTrackIndex && n.track !== input.melodyTrackIndex);
  const bassActivePercent = Math.min(100, Math.round((soundingMs(bNotes, startMs, endMs) / barMs) * 100));
  const isBassInactive = bassActivePercent < BASS_INACTIVE_PERCENT;
  const chord = detectBarChord(pitched);
  const prominent = isBassInactive && oNotes.length > 0
    ? prominentTrack(oNotes, input.pitchedTracks)
    : { index: null, name: null, riff: "" };
  return {
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
    prominentTrackIndex: prominent.index,
    prominentTrackName: prominent.name,
    prominentRiffSnippet: prominent.riff,
    melodyNotesInBar: mNotes,
    bassNotesInBar: bNotes,
    otherNotesInBar: oNotes,
  };
}

/** What carries a bar, for the prompt: the riff or drone when the bass rests, else the melody or the groove. */
function activeLineLabel(m: MeasureAnalysis): string {
  if (m.isBassInactive) {
    return m.prominentTrackName ? `${m.prominentTrackName}: ${m.prominentRiffSnippet}` : `Harmonic Bass: ${m.celloBassDesc}`;
  }
  if (m.melodyNotesInBar.length === 0) return "Bass groove";
  const opening = m.melodyNotesInBar.slice(0, 3).map((n) => midiToPitchName(n.midiNumber)).join(" ");
  return `Melody: ${opening}`;
}

export function extractMidiFeatures(parsed: ParsedMidi, fileName: string) {
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

  const bassTrack = pickBassTrack(pitchedTracks);
  const melodyTrack = pickMelodyTrack(pitchedTracks, bassTrack);

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
    const detail = analyseBar({
      bar, startMs, endMs: startMs + barDurationMs, notes: parsed.notes, pitchedTracks, pitchedTrackIndices,
      bassNotes, melodyNotes, bassTrackIndex, melodyTrackIndex,
    });
    if (detail.isBassInactive) inactiveBassBarsCount++;
    measureDetails.push(detail);
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
      activeRiffOrDrone: activeLineLabel(m),
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

export function buildSystemPrompt(options: { positionFreedom?: boolean } = {}): string {
  // The benchmark adds the position doctrine; the library arranger keeps its
  // original prompt so existing arrangements stay reproducible.
  const positionSection = options.positionFreedom ? `${POSITION_FREEDOM_DOCTRINE}\n\n` : "";
  const gate5Extra = options.positionFreedom
    ? "\n- Above Beginner, weigh keeping a figure on ONE string in 2nd-4th position (an open string, then fret 6 or 7 on that same string) against crossing to the next string, and choose whichever is easier to play."
    : "";
  return `You are an elite computational musicologist, concert cellist, and master arranger for the Ponticello Cello platform.
You strictly adhere to the complete cello-scoring skill included verbatim at the top of this prompt (SKILL.md, INSTRUMENT.md, ARRANGING.md, PIPELINE.md), as qualified by its precedence rules.

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

${positionSection}MANDATORY 5-STAGE INTERNAL GRILLING PROCEDURE:
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
- In Beginner, open strings provide relief, but do not force an open string abruptly inside a tight riff.${gate5Extra}

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

export function buildUserPrompt(
  features: ReturnType<typeof extractMidiFeatures>,
  options: { positionFreedom?: boolean } = {},
): string {
  const positionRequirement = options.positionFreedom
    ? "\n3. POSITION FREEDOM:\n   Do not confine the tiers above Beginner to first position. Where a figure is easier on one string, plan it in 2nd-4th position (open string, then fret 6 or 7 on the same string) instead of crossing strings, and say so in the tier directives."
    : "";
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
   Remember: a harmonic bass does NOT need to be an open string! All 12 chromatic pitches (Bb2, F2, Eb2, B2, C#2, etc.) are available as stopped notes on the C and G strings and provide rich, resonant bass foundations with vibrato.${positionRequirement}

Conduct your deep 5-stage internal grilling in <think>, starting from the 100% Expert master arrangement and deriving down to Beginner with zero dead air, then provide the JSON ArrangementBlueprint.`;
}

// ─── Ollama Client ───────────────────────────────────────────────────────────

export async function queryOllama(
  host: string,
  model: string,
  /** Required: the complete cello-scoring skill rides with every request. */
  skill: CelloScoringSkill,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ thinking: string; blueprint: ArrangementBlueprint }> {
  const url = `${host}/api/chat`;

  const messages = skillMessages([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], skill);
  // This client does not know the model's window, so it only ever grows the
  // request to fit the skill; the server rejects what the model cannot hold.
  const context = planContext(
    messages.reduce((total, message) => total + message.content.length, 0),
    { requested: 32768, modelMax: null, reserve: 8192 },
  );

  const payload = {
    model,
    messages,
    options: {
      temperature: 0.2,
      num_ctx: context.numCtx,
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
  const cleanedJson = fencedContent(jsonContent) ?? jsonContent;

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

const FENCE = "```";

/** The body of the first ``` or ```json code fence, trimmed; null when there is no closed fence. */
function fencedContent(text: string): string | null {
  const open = text.indexOf(FENCE);
  if (open < 0) return null;
  let bodyStart = open + FENCE.length;
  if (text.startsWith("json", bodyStart)) bodyStart += "json".length;
  const close = text.indexOf(FENCE, bodyStart);
  return close < 0 ? null : text.slice(bodyStart, close).trim();
}

/** Where melody leaves the downbeat empty, silence at the start of a bar longer than this is filled. */
const DOWNBEAT_GAP_MS = 350;
const MIN_NOTE_MS = 40;

type BarAnalysis = ReturnType<typeof extractMidiFeatures>["measureDetails"][number];

function copied(notes: readonly MidiNote[], low: number, high: number): RawNoteEvent[] {
  return notes.map((n) => ({
    midiNumber: foldToRegister(n.midiNumber, low, high),
    startTimeMs: n.startTimeMs,
    durationMs: Math.max(MIN_NOTE_MS, n.durationMs),
  }));
}

/** Every melody note, with the bass (or the chord root) on the downbeat if the melody enters late. */
function melodyBar(m: BarAnalysis): RawNoteEvent[] {
  const events = copied(m.melodyNotesInBar, 36, 81);
  const firstStart = m.melodyNotesInBar[0]!.startTimeMs;
  if (firstStart - m.startMs <= DOWNBEAT_GAP_MS) return events;
  const downbeatBass = m.bassNotesInBar.find((b) => b.startTimeMs < m.startMs + DOWNBEAT_GAP_MS);
  events.push(downbeatBass
    ? {
      midiNumber: foldToRegister(downbeatBass.midiNumber, 36, 50),
      startTimeMs: Math.max(m.startMs, downbeatBass.startTimeMs),
      durationMs: Math.min(downbeatBass.durationMs, firstStart - m.startMs - 20),
    }
    : {
      midiNumber: foldToRegister(m.lowestRootMidi, 36, 47),
      startTimeMs: m.startMs,
      durationMs: Math.min(500, firstStart - m.startMs - 20),
    });
  return events;
}

/**
 * Neither melody nor bass: zero dead air. The cello takes the busiest other
 * part's riff in its low register, or else the chord root with a fifth on
 * beat three when the bar is long enough.
 */
function fillerBar(m: BarAnalysis): RawNoteEvent[] {
  const riff = m.prominentTrackIndex === null
    ? m.otherNotesInBar
    : m.otherNotesInBar.filter((n) => n.track === m.prominentTrackIndex);
  if (riff.length > 0) return copied(riff, 36, 55);
  const barDur = m.endMs - m.startMs;
  const events: RawNoteEvent[] = [{
    midiNumber: foldToRegister(m.lowestRootMidi, 36, 47),
    startTimeMs: m.startMs,
    durationMs: Math.max(100, Math.min(barDur * 0.9, 1500)),
  }];
  if (barDur >= 1400) {
    events.push({ midiNumber: foldToRegister(m.fifthMidi, 36, 55), startTimeMs: m.startMs + barDur / 2, durationMs: Math.max(100, barDur * 0.4) });
  }
  return events;
}

function expertBar(m: BarAnalysis): RawNoteEvent[] {
  if (m.melodyNotesInBar.length > 0) return melodyBar(m);
  if (m.bassNotesInBar.length > 0 && !m.isBassInactive) return copied(m.bassNotesInBar, 36, 55);
  return fillerBar(m);
}

/** One note at a time: of simultaneous attacks the highest wins, and each note ends where the next begins. */
function toMonophonic(events: RawNoteEvent[]): RawNoteEvent[] {
  events.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const out: RawNoteEvent[] = [];
  events.forEach((curr, i) => {
    if (i > 0 && curr.startTimeMs === events[i - 1]!.startTimeMs) {
      if (curr.midiNumber > out[out.length - 1]!.midiNumber) out[out.length - 1] = curr;
      return;
    }
    const next = events[i + 1];
    if (next && curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(30, next.startTimeMs - curr.startTimeMs);
    }
    if (curr.durationMs >= 30) out.push(curr);
  });
  return out;
}

/**
 * 1. EXPERT TIER (Master Score - 100% Complete)
 * Retains 100% of melody notes in the original key — backing MIDI plays in the
 * source key, so this never transposes. During melody gaps, weaves in bass
 * downbeat roots. When bass is inactive, takes over guitar/keyboard riffs in
 * low register or harmonic drones. Zero dead air.
 */
export function buildMasterExpertNotes(
  features: ReturnType<typeof extractMidiFeatures>,
  _blueprint: ArrangementBlueprint,
): RawNoteEvent[] {
  return toMonophonic(features.measureDetails.flatMap(expertBar));
}

/**
 * Moves `midi` by octaves, within `[low, high]`, until it is no more than
 * `maxLeap` semitones from `previous`.
 */
function limitLeap(midi: number, previous: number, maxLeap: number, low: number, high: number): number {
  let m = midi;
  while (m - previous > maxLeap && m - 12 >= low) m -= 12;
  while (m - previous < -maxLeap && m + 12 <= high) m += 12;
  return m;
}

/** Shortens each note so it ends where the next begins, but never below `minMs`. */
function trimOverlaps(notes: RawNoteEvent[], minMs: number): RawNoteEvent[] {
  for (let i = 0; i < notes.length - 1; i++) {
    const curr = notes[i]!;
    const next = notes[i + 1]!;
    if (curr.startTimeMs + curr.durationMs > next.startTimeMs) {
      curr.durationMs = Math.max(minMs, next.startTimeMs - curr.startTimeMs);
    }
  }
  return notes;
}

type Thinning = { maxLeap: number; low: number; high: number; mergeWithinMs: number; merges: (index: number) => boolean };

/** Seats each note near the last one, folding an attack that follows too closely into the note before it. */
function thinLine(notes: readonly RawNoteEvent[], rule: Thinning, seat: (midi: number) => number): RawNoteEvent[] {
  const out: RawNoteEvent[] = [];
  notes.forEach((note, i) => {
    const curr = { ...note, midiNumber: seat(note.midiNumber) };
    const prev = out.at(-1);
    if (prev) {
      curr.midiNumber = limitLeap(curr.midiNumber, prev.midiNumber, rule.maxLeap, rule.low, rule.high);
      if (curr.startTimeMs - prev.startTimeMs < rule.mergeWithinMs && rule.merges(i)) {
        prev.durationMs += curr.durationMs;
        return;
      }
    }
    out.push(curr);
  });
  return out;
}

/**
 * 2. ADVANCED TIER (Derived from Expert)
 * Retains ~80% of notes, smooths rapid runs, bounds leaps <= 12 st, 1st-7th position.
 */
export function deriveAdvancedNotes(
  expertNotes: readonly RawNoteEvent[],
): RawNoteEvent[] {
  const rule: Thinning = { maxLeap: 12, low: 36, high: 79, mergeWithinMs: 130, merges: (i) => i % 2 !== 0 };
  return trimOverlaps(thinLine(expertNotes, rule, (midi) => (midi > 79 ? midi - 12 : midi)), 30);
}

/**
 * 3. INTERMEDIATE TIER (Derived from Advanced)
 * 1st-4th position only (MIDI 36-62). Rate <= 3 notes/s. Leaps <= 12 st. Groove & theme focus.
 */
export function deriveIntermediateNotes(
  advancedNotes: readonly RawNoteEvent[],
): RawNoteEvent[] {
  const rule: Thinning = { maxLeap: 12, low: 36, high: 62, mergeWithinMs: 200, merges: () => true };
  return trimOverlaps(thinLine(advancedNotes, rule, (midi) => foldToRegister(midi, 36, 62)), 40);
}

const BEGINNER_LEAP = 9;

/** One bar of the beginner line: its downbeat, held, and a second note near the middle if there is room. */
function beginnerBar(m: BarAnalysis, barNotes: readonly RawNoteEvent[], previous: number | undefined, barDurationMs: number): RawNoteEvent[] {
  const { startMs, endMs } = m;
  if (barNotes.length === 0) {
    return [{ midiNumber: foldToRegister(m.lowestRootMidi, 36, 50), startTimeMs: startMs, durationMs: Math.max(200, (endMs - startMs) * 0.85) }];
  }
  const downbeat = barNotes[0]!;
  const seated = foldToRegister(downbeat.midiNumber, 36, 62);
  const firstMidi = previous === undefined ? seated : limitLeap(seated, previous, BEGINNER_LEAP, 36, 62);
  const firstDuration = barNotes.length === 1
    ? Math.max(300, (endMs - downbeat.startTimeMs) * 0.85)
    : Math.min(barDurationMs / 2 - 20, Math.max(200, downbeat.durationMs));
  const out: RawNoteEvent[] = [{ midiNumber: firstMidi, startTimeMs: downbeat.startTimeMs, durationMs: firstDuration }];
  const midpoint = startMs + barDurationMs / 2;
  const second = barNotes.find((n) => n.startTimeMs >= midpoint - 100);
  if (second && second.startTimeMs - downbeat.startTimeMs > 400) {
    out.push({
      midiNumber: limitLeap(foldToRegister(second.midiNumber, 36, 62), firstMidi, BEGINNER_LEAP, 36, 62),
      startTimeMs: second.startTimeMs,
      durationMs: Math.max(200, (endMs - second.startTimeMs) * 0.85),
    });
  }
  return out;
}

/**
 * 4. BEGINNER TIER (Derived from Intermediate)
 * Strictly 1st position (MIDI 36-62). Held downbeat roots, minimal movement, rate <= 1.8 notes/s, leap <= 9 st.
 */
export function deriveBeginnerNotes(
  intermediateNotes: readonly RawNoteEvent[],
  features: ReturnType<typeof extractMidiFeatures>,
  blueprint: ArrangementBlueprint,
): RawNoteEvent[] {
  const barDurationMs = measureDurationMs(blueprint.meter, blueprint.tempoBpm);
  const out: RawNoteEvent[] = [];
  for (const m of features.measureDetails) {
    const barNotes = intermediateNotes.filter((n) => n.startTimeMs >= m.startMs && n.startTimeMs < m.endMs);
    out.push(...beginnerBar(m, barNotes, out.at(-1)?.midiNumber, barDurationMs));
  }
  return trimOverlaps(out, 40);
}

// ─── Fretboard & Ambiguous Note Verification Gate ────────────────────────────

type Placement = { verdict: AmbiguousNoteAudit["verdict"]; reason: string };

/** Why a chosen placement is idiomatic for the tier, or that it is not. */
function placementVerdict(state: CelloState, tier: DifficultyTier, distanceMm: number, riffContinuation: boolean): Placement {
  if (state.finger === "0") {
    return { verdict: "OK_OPEN_STRING", reason: `Utilizes open string ${state.string} for intonation anchor and acoustic resonance.` };
  }
  if (riffContinuation) {
    return { verdict: "OK_RIFF_CONTINUATION", reason: `Maintains string ${state.string} with finger ${state.finger} to preserve riff continuity and tonal cohesion.` };
  }
  const beginner = tier === "Beginner";
  if (beginner && (state.position === "1st" || state.position === "Half")) {
    return { verdict: "OK_RIFF_CONTINUATION", reason: `Within 1st position hand frame (${distanceMm.toFixed(1)} mm).` };
  }
  if (!beginner && distanceMm > 173) {
    return { verdict: "OK_HIGHER_POSITION", reason: `Higher position (${state.position}) acceptable for ${tier} tier.` };
  }
  if (beginner && distanceMm > 175) {
    return { verdict: "FLAGGED_UNIDIOMATIC", reason: `Note exceeds 1st position limit (${distanceMm.toFixed(1)} mm > 173 mm) in Beginner tier!` };
  }
  return { verdict: "OK_OPEN_STRING", reason: "Standard placement." };
}

const roundTenth = (mm: number) => Math.round(mm * 10) / 10;

export function auditFretboardNotes(
  notes: readonly RawNoteEvent[],
  states: readonly CelloState[],
  tier: DifficultyTier,
): AmbiguousNoteAudit[] {
  const audits: AmbiguousNoteAudit[] = [];
  notes.forEach((note, i) => {
    const state = states[i];
    if (!state) return;
    const candidates = candidateStates(note.midiNumber);
    if (candidates.length <= 1) return; // Unambiguous note

    const chosenDistanceMm = stopDistanceMm(note.midiNumber - OPEN_STRING_MIDI[state.string]);
    const prevNote = notes[i - 1];
    const prevState = states[i - 1];
    const riffContinuation = prevState?.string === state.string
      && !!prevNote && Math.abs(note.midiNumber - prevNote.midiNumber) <= 4
      && state.finger !== "0";
    audits.push({
      noteIndex: i + 1,
      midiNumber: note.midiNumber,
      pitchName: midiToPitchName(note.midiNumber),
      chosenString: state.string,
      chosenPosition: state.position,
      chosenFinger: state.finger,
      chosenDistanceMm: roundTenth(chosenDistanceMm),
      numCandidateLocations: candidates.length,
      candidateLocations: candidates.map((c) => ({
        string: c.string,
        position: c.position,
        finger: c.finger,
        distanceMm: roundTenth(stopDistanceMm(note.midiNumber - OPEN_STRING_MIDI[c.string])),
      })),
      ...placementVerdict(state, tier, chosenDistanceMm, riffContinuation),
    });
  });
  return audits;
}

// ─── Score Synthesizer ───────────────────────────────────────────────────────

export function synthesizeScore(
  id: string,
  blueprint: ArrangementBlueprint,
  arrangedNotes: RawNoteEvent[],
  states: CelloState[],
  tier: DifficultyTier,
  modelLabel = "qwen3.5:4b",
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
      composer: `Arranged via Ponticello ${modelLabel}`,
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
