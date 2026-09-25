import { OPEN_STRING_MIDI, toPitchClass } from '../cello';
import { firstPositionFingering } from '../fingering';
import { detectKey } from '../key';
import { MelodyMetrics } from '../melody';
import { MidiNote, ParsedMidi } from '../midi';
import { ARRANGEMENT_PROFILES, ArrangementRange, ArrangementSourceKind } from './profiles';
import { octaveCandidates } from './rangeFitter';
import { likeliestRoot, overlapMs, weighPitchClasses } from '../harmony';

export function isBassProgram(program: number | null): boolean {
  return program !== null && program >= 32 && program <= 39;
}

export function sourceKind(metrics: MelodyMetrics, program: number | null): ArrangementSourceKind {
  if (metrics.motifRecurrence >= 0.3) return 'riff';
  if (isBassProgram(program)) return 'bass';
  return 'melody';
}

function lowestOf(notes: Iterable<MidiNote>): MidiNote | undefined {
  let lowest: MidiNote | undefined;
  for (const note of notes) {
    if (!lowest || note.midiNumber < lowest.midiNumber) lowest = note;
  }
  return lowest;
}

/** Appends a span of `note`, extending the previous one instead when it is the same pitch and touches it. */
function appendOrExtend(out: MidiNote[], note: MidiNote, fromMs: number, toMs: number): void {
  const previous = out.at(-1);
  if (previous?.midiNumber === note.midiNumber && previous.startTimeMs + previous.durationMs === fromMs) {
    previous.durationMs = toMs - previous.startTimeMs;
  } else {
    out.push({ ...note, startTimeMs: fromMs, durationMs: toMs - fromMs });
  }
}

/** A sounding lower voice, including note-offs and rests, before octave fitting. */
export function lowestVoice(notes: readonly MidiNote[], endMs: number): MidiNote[] {
  const events = notes.flatMap((note, id) => [
    { time: note.startTimeMs, id, note, on: true },
    { time: Math.min(endMs, note.startTimeMs + note.durationMs), id, note, on: false },
  ]).filter((event) => event.time >= 0 && event.time <= endMs)
    .sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
  const active = new Map<number, MidiNote>();
  const out: MidiNote[] = [];
  let i = 0;
  while (i < events.length) {
    const from = events[i]!.time;
    for (; i < events.length && events[i]!.time === from; i++) {
      const event = events[i]!;
      if (event.on) active.set(event.id, event.note);
      else active.delete(event.id);
    }
    const to = events[i]?.time ?? endMs;
    const lowest = to > from ? lowestOf(active.values()) : undefined;
    if (lowest) appendOrExtend(out, lowest, from, to);
  }
  return out;
}

/** Prefer a real bass part; piano and single-track files use their lower voice. */
export function sourceBassVoice(parsed: ParsedMidi, endMs: number): MidiNote[] {
  const tracks = parsed.tracks.filter((track) => !track.isPercussion);
  const pitched = new Set(tracks.map((track) => track.index));
  const notes = parsed.notes.filter((note) => pitched.has(note.track)
    && note.durationMs > 0 && note.startTimeMs < endMs);
  const basses = tracks.filter((track) => isBassProgram(track.program)
    || /\b(bass|contrabass)\b/i.test(track.name ?? ''))
    .map((track) => {
      const voice = lowestVoice(notes.filter((note) => note.track === track.index), endMs);
      return { voice, coverage: voice.reduce((sum, note) => sum + note.durationMs, 0) };
    }).filter(({ coverage }) => coverage >= endMs * 0.2)
    .sort((a, b) => b.coverage - a.coverage);
  return basses[0]?.voice ?? lowestVoice(notes, endMs);
}

const MIN_SLOT_MS = 900;
const MAX_HOLD_MS = 4000;

export function pulseLengthMs(beatMs: number): number {
  const floorMs = 1000 / ARRANGEMENT_PROFILES.Beginner.maxNotesPerSecond;
  let pulseMs = beatMs;
  while (pulseMs < floorMs) pulseMs *= 2;
  return pulseMs;
}

const MAX_ROOT_PITCH_CLASSES = 6;
const MIN_ANCHOR_MS = 240;

const OPEN_PITCHES: ReadonlySet<number> = new Set(Object.values(OPEN_STRING_MIDI));
const OPEN_PITCH_CLASSES: ReadonlySet<number> = new Set([...OPEN_PITCHES].map((pitch) => pitch % 12));

const DETACHED_SHARE = 0.72;
const GUIDE_SPACING_MS = 1000 / ARRANGEMENT_PROFILES.Beginner.maxNotesPerSecond + 20;
const BASS_FILL_RANGE = { low: 28, high: 59 };

export interface HarmonySpan { fromMs: number; toMs: number }
export interface HarmonicRegion extends HarmonySpan { rootPc: number }

export interface HarmonicAnalysis {
  regions: HarmonicRegion[];
  barMs: number;
  beatMs: number;
  scale: Set<number>;
}

export function mergeSpans(spans: readonly HarmonySpan[], bridgeMs = 0): HarmonySpan[] {
  const sorted = [...spans].sort((a, b) => a.fromMs - b.fromMs);
  const out: HarmonySpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.fromMs <= last.toMs + bridgeMs) last.toMs = Math.max(last.toMs, span.toMs);
    else out.push({ ...span });
  }
  return out;
}

export function anchorLengthMs(beatMs: number): number {
  return Math.max(MIN_ANCHOR_MS, beatMs * 0.6);
}

const SUPPORT_BRIDGE_MS = 24;

export function barMsOf(parsed: ParsedMidi): number {
  const quarterMs = 60000 / Math.max(20, parsed.bpm || 120);
  const beats = Math.max(1, parsed.timeSignature[0] || 4);
  const unit = Math.max(1, parsed.timeSignature[1] || 4);
  return Math.max(500, (quarterMs * beats * 4) / unit);
}

export function windowNotes(parsed: ParsedMidi, endMs: number, includePercussion: boolean): MidiNote[] {
  const percussion = new Set(parsed.tracks.filter((track) => track.isPercussion).map((track) => track.index));
  const out: MidiNote[] = [];
  for (const note of parsed.notes) {
    if (!includePercussion && percussion.has(note.track)) continue;
    const startTimeMs = Math.max(0, note.startTimeMs);
    const durationMs = Math.min(note.startTimeMs + note.durationMs, endMs) - startTimeMs;
    if (durationMs <= 0) continue;
    out.push({ ...note, startTimeMs, durationMs });
  }
  return out.sort((a, b) => a.startTimeMs - b.startTimeMs);
}


type SlotBass = { pc: number; share: number };

/**
 * The bass of a window: the bass voice's pitch class sounding longest, if it
 * covers a quarter of the window; failing that, the lowest note anywhere that
 * does.
 */
function slotBass(bassLive: readonly MidiNote[], live: readonly MidiNote[], fromMs: number, toMs: number): SlotBass | null {
  const windowMs = toMs - fromMs;
  const { weights } = weighPitchClasses(bassLive, { window: { fromMs, toMs } });
  let bassPc: number | null = null;
  let bassBest = windowMs * 0.25;
  for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
    const weight = weights[pitchClass]!;
    if (weight > bassBest) {
      bassBest = weight;
      bassPc = pitchClass;
    }
  }
  if (bassPc === null) {
    const lowest = lowestOf(live.filter((note) => overlapMs(note, { fromMs, toMs }) >= windowMs * 0.25));
    if (!lowest) return null;
    bassPc = toPitchClass(lowest.midiNumber);
    bassBest = Math.min(windowMs, overlapMs(lowest, { fromMs, toMs }));
  }
  return { pc: bassPc, share: Math.min(1, bassBest / Math.max(1, windowMs)) };
}

/** Half a bar, doubled until it is long enough to hear a harmony in. */
function slotLengthMs(barMs: number): number {
  let slotMs = barMs / 2;
  while (slotMs < MIN_SLOT_MS) slotMs *= 2;
  return slotMs;
}

type HarmonySlot = { fromMs: number; toMs: number; rootPc: number | null; live: boolean };

/** Notes of a time-sorted list, admitted as the window reaches them and dropped once they have ended. */
class SoundingNotes {
  private cursor = 0;
  private sounding: MidiNote[] = [];

  constructor(private readonly notes: readonly MidiNote[]) {}

  advance(fromMs: number, toMs: number): readonly MidiNote[] {
    while (this.cursor < this.notes.length && this.notes[this.cursor]!.startTimeMs < toMs) {
      this.sounding.push(this.notes[this.cursor++]!);
    }
    this.sounding = this.sounding.filter((note) => note.startTimeMs + note.durationMs > fromMs);
    return this.sounding;
  }
}

/** A slot with no root of its own, but music in it, takes the nearest root before it, else after it. */
function carryRoots(slots: HarmonySlot[]): void {
  slots.forEach((slot, i) => {
    if (slot.rootPc !== null || !slot.live) return;
    let carried: number | null = null;
    for (let j = i - 1; j >= 0 && carried === null; j--) carried = slots[j]!.rootPc;
    for (let j = i + 1; j < slots.length && carried === null; j++) carried = slots[j]!.rootPc;
    slot.rootPc = carried;
  });
}

export function analyseHarmony(
  parsed: ParsedMidi, endMs: number, voice: readonly MidiNote[],
): HarmonicAnalysis {
  const barMs = barMsOf(parsed);
  const beatMs = barMs / Math.max(1, parsed.timeSignature[0] || 4);
  const pitched = windowNotes(parsed, endMs, false);
  const scale = new Set(detectKey(pitched).scale);
  if (pitched.length === 0) return { regions: [], barMs, beatMs, scale };

  const everything = windowNotes(parsed, endMs, true);
  const firstMs = everything[0]?.startTimeMs ?? 0;
  const lastMs = Math.min(endMs, everything.reduce(
    (max, note) => Math.max(max, note.startTimeMs + note.durationMs), 0,
  ));
  const active = mergeSpans(everything.map((note) => ({
    fromMs: note.startTimeMs, toMs: note.startTimeMs + note.durationMs + beatMs,
  })));

  const slotMs = slotLengthMs(barMs);
  const slots: HarmonySlot[] = [];
  const liveNotes = new SoundingNotes(pitched);
  const liveBass = new SoundingNotes(voice);
  let activeCursor = 0;
  for (let fromMs = firstMs; fromMs < lastMs; fromMs += slotMs) {
    const toMs = Math.min(lastMs, fromMs + slotMs);
    const live = liveNotes.advance(fromMs, toMs);
    const bassLive = liveBass.advance(fromMs, toMs);
    while (activeCursor < active.length && active[activeCursor]!.toMs <= fromMs) activeCursor++;
    const isLive = (active[activeCursor]?.fromMs ?? Infinity) < toMs;
    const harmony = weighPitchClasses(live, { window: { fromMs, toMs } });
    const bass = slotBass(bassLive, live, fromMs, toMs);
    slots.push({ fromMs, toMs, rootPc: likeliestRoot(harmony, { bass, scale }), live: isLive });
  }
  carryRoots(slots);

  const regions: HarmonicRegion[] = slots
    .filter((slot) => slot.live && slot.rootPc !== null)
    .map((slot) => ({ fromMs: slot.fromMs, toMs: slot.toMs, rootPc: slot.rootPc! }));
  return { regions, barMs, beatMs, scale };
}

export interface BassRun { pc: number; fromMs: number; toMs: number }

export function bassRuns(bass: readonly MidiNote[]): BassRun[] {
  const byPitchClass = new Map<number, HarmonySpan[]>();
  for (const note of bass) {
    const pc = toPitchClass(note.midiNumber);
    const spans = byPitchClass.get(pc) ?? [];
    spans.push({ fromMs: note.startTimeMs, toMs: note.startTimeMs + note.durationMs });
    byPitchClass.set(pc, spans);
  }
  const runs: BassRun[] = [];
  for (const [pc, spans] of byPitchClass) {
    for (const span of mergeSpans(spans, SUPPORT_BRIDGE_MS)) runs.push({ pc, ...span });
  }
  return runs.sort((a, b) => a.fromMs - b.fromMs || a.pc - b.pc);
}

export function longestRunIn(runs: readonly BassRun[], fromMs: number, toMs: number): number {
  let best = 0;
  for (const run of runs) {
    if (run.toMs <= fromMs) continue;
    if (run.fromMs >= toMs) break;
    best = Math.max(best, Math.min(toMs, run.toMs) - Math.max(fromMs, run.fromMs));
  }
  return best;
}

const FILL_VELOCITY = 96;
const MIN_FILL_MS = 60;

/** A pitch held from `fromMs` to `toMs`, re-struck every `holdMs` at most so a long hold does not fade. */
function restruck(midiNumber: number, fromMs: number, toMs: number, holdMs: number): MidiNote[] {
  const count = Math.max(1, Math.ceil((toMs - fromMs) / holdMs));
  const each = (toMs - fromMs) / count;
  return Array.from({ length: count }, (_, index) => ({
    midiNumber, startTimeMs: fromMs + index * each, durationMs: each, track: 0, channel: 0, velocity: FILL_VELOCITY,
  }));
}

function medianPitch(notes: readonly MidiNote[]): number {
  const sorted = notes.map((note) => note.midiNumber).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? OPEN_STRING_MIDI.G;
}

/** The pitch of the note nearest in time to `timeMs`, so a fill sits in the register around it. */
function nearbyPitch(notes: readonly MidiNote[], timeMs: number, fallback: number): number {
  let best = fallback;
  let bestDistance = Infinity;
  for (const note of notes) {
    const distance = Math.abs(note.startTimeMs <= timeMs
      ? timeMs - (note.startTimeMs + note.durationMs)
      : note.startTimeMs - timeMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = note.midiNumber;
    }
  }
  return best;
}

/** `rootPc` in the octave nearest `anchor`, folded into the bass-fill range. */
function rootNear(rootPc: number, anchor: number): number {
  let midiNumber = rootPc + 12 * Math.round((anchor - rootPc) / 12);
  while (midiNumber < BASS_FILL_RANGE.low) midiNumber += 12;
  while (midiNumber > BASS_FILL_RANGE.high) midiNumber -= 12;
  return midiNumber;
}

type HoleFill = { voice: MidiNote[]; median: number; holdMs: number; legatoMs: number };

/**
 * Closes the gaps a region's harmony has no bass under: a short gap by holding
 * the previous note on, a longer one with the region's root.
 */
function fillHoles(regions: readonly HarmonicRegion[], context: HoleFill): MidiNote[] {
  const { voice, median, holdMs, legatoMs } = context;
  const fills: MidiNote[] = [];
  const covered = mergeSpans(voice.map((note) => ({ fromMs: note.startTimeMs, toMs: note.startTimeMs + note.durationMs })));
  const fillHole = (fromMs: number, toMs: number, rootPc: number) => {
    if (toMs - fromMs <= 0) return;
    const previous = voice.find((note) => Math.abs(note.startTimeMs + note.durationMs - fromMs) <= 1);
    if (previous && toMs - fromMs <= legatoMs) {
      previous.durationMs = toMs - previous.startTimeMs;
      return;
    }
    if (toMs - fromMs < MIN_FILL_MS) return;
    fills.push(...restruck(rootNear(rootPc, nearbyPitch(voice, fromMs, median)), fromMs, toMs, holdMs));
  };
  for (const region of regions) {
    let cursor = region.fromMs;
    for (const span of covered) {
      if (span.toMs <= cursor) continue;
      if (span.fromMs >= region.toMs) break;
      if (span.fromMs > cursor) fillHole(cursor, span.fromMs, region.rootPc);
      cursor = Math.max(cursor, span.toMs);
    }
    if (cursor < region.toMs) fillHole(cursor, region.toMs, region.rootPc);
  }
  return fills;
}

type PedalChoice = { pc: number; onsetMs: number; lowest: number };

/** Of the pitch classes sounding in a region, the one best held as a pedal: long, and ideally its root or fifth. */
function pedalFor(region: HarmonicRegion, notes: readonly MidiNote[]): PedalChoice | null {
  const span = region.toMs - region.fromMs;
  const cover = new Array<number>(12).fill(0);
  const onset = new Array<number>(12).fill(Infinity);
  const lowest = new Array<number>(12).fill(Infinity);
  for (const note of notes) {
    if (note.startTimeMs >= region.toMs || note.startTimeMs + note.durationMs <= region.fromMs) continue;
    const pc = toPitchClass(note.midiNumber);
    cover[pc]! += overlapMs(note, region);
    onset[pc] = Math.min(onset[pc]!, Math.max(region.fromMs, note.startTimeMs));
    lowest[pc] = Math.min(lowest[pc]!, note.midiNumber);
  }
  let pedalPc: number | null = null;
  let bestScore = 0;
  for (let pc = 0; pc < 12; pc++) {
    if (cover[pc]! <= 0) continue;
    const score = cover[pc]! + span * rootOrFifthBonus(pc, region.rootPc, 0.6, 0.25);
    if (score > bestScore) {
      bestScore = score;
      pedalPc = pc;
    }
  }
  return pedalPc === null ? null : { pc: pedalPc, onsetMs: onset[pedalPc]!, lowest: lowest[pedalPc]! };
}

/** Extra weight for the region's root, less for its fifth, none otherwise. */
function rootOrFifthBonus(pc: number, rootPc: number, rootBonus: number, fifthBonus: number): number {
  if (pc === rootPc) return rootBonus;
  return pc === (rootPc + 7) % 12 ? fifthBonus : 0;
}

/** Regions long enough to want an anchor but with no single bass pitch held through them get a pedal. */
function pedalNotes(regions: readonly HarmonicRegion[], notes: readonly MidiNote[], beatMs: number, holdMs: number): MidiNote[] {
  const runs = bassRuns([...notes].sort((a, b) => a.startTimeMs - b.startTimeMs));
  const minAnchorMs = anchorLengthMs(beatMs);
  return regions.flatMap((region) => {
    const span = region.toMs - region.fromMs;
    if (span < minAnchorMs) return [];
    if (longestRunIn(runs, region.fromMs, region.toMs) >= Math.min(minAnchorMs, span)) return [];
    const pedal = pedalFor(region, notes);
    if (!pedal) return [];
    const fromMs = Math.min(region.toMs - minAnchorMs, pedal.onsetMs);
    return restruck(pedal.lowest, fromMs, region.toMs, holdMs);
  });
}

export function completeBassLine(
  voice: readonly MidiNote[], analysis: HarmonicAnalysis,
): MidiNote[] {
  const { regions, barMs, beatMs } = analysis;
  const out = [...voice].sort((a, b) => a.startTimeMs - b.startTimeMs).map((note) => ({ ...note }));
  if (regions.length === 0) return out;

  const holdMs = Math.min(MAX_HOLD_MS, Math.max(1200, barMs * 2));
  const fills = fillHoles(regions, { voice: out, median: medianPitch(out), holdMs, legatoMs: beatMs * 0.55 });
  const pedals = pedalNotes(regions, [...out, ...fills], beatMs, holdMs);
  return [...out, ...fills, ...pedals]
    .sort((a, b) => a.startTimeMs - b.startTimeMs || a.midiNumber - b.midiNumber);
}

export function closedFramePitches(pc: number, range: ArrangementRange): number[] {
  const out: number[] = [];
  for (let pitch = Math.ceil(range.low); pitch <= Math.floor(range.high); pitch++) {
    if (toPitchClass(pitch) !== pc) continue;
    try {
      if (firstPositionFingering(pitch).extension !== 'none') continue;
    } catch { continue; }
    out.push(pitch);
  }
  return out;
}

/** Highest pitch each string takes in first position; above the last, the A string. */
const STRING_TOPS = [42, 49, 56];

/** Which string, C = 0 to A = 3, a pitch falls on in first position. */
export function stringSlot(pitch: number): number {
  const slot = STRING_TOPS.findIndex((top) => pitch <= top);
  return slot < 0 ? STRING_TOPS.length : slot;
}

export interface GuideAnchor { pc: number; fromMs: number; toMs: number }

/** Everything the anchor search reads, gathered once. */
interface GuideContext {
  regions: readonly HarmonicRegion[];
  /** Per region, the longest bass run of each pitch class sounding in it. */
  options: readonly Map<number, BassRun>[];
  scale: ReadonlySet<number>;
  minAnchorMs: number;
  shortAnchorMs: number;
  maxLeapSemitones: number;
  /** Per pitch class, the closed-frame first-position seats in range. */
  seats: readonly number[][];
}

function lengthIn(region: HarmonySpan, run: BassRun): number {
  return Math.min(region.toMs, run.toMs) - Math.max(region.fromMs, run.fromMs);
}

function regionRunOptions(regions: readonly HarmonicRegion[], runs: readonly BassRun[]): Map<number, BassRun>[] {
  return regions.map((region) => {
    const best = new Map<number, BassRun>();
    for (const run of runs) {
      if (run.toMs <= region.fromMs) continue;
      if (run.fromMs >= region.toMs) break;
      const held = best.get(run.pc);
      if (!held || lengthIn(region, run) > lengthIn(region, held)) best.set(run.pc, run);
    }
    return best;
  });
}

/** Closest the hand can bring two pitch classes together in closed frame. */
function reach(context: GuideContext, a: number, b: number): number {
  let best = Infinity;
  for (const x of context.seats[a]!) for (const y of context.seats[b]!) best = Math.min(best, Math.abs(x - y));
  return best;
}

/** The root fits a region fully, its fifth partly, anything else a little. */
function anchorFit(pc: number, rootPc: number): number {
  if (pc === rootPc) return 1;
  return pc === (rootPc + 7) % 12 ? 0.6 : 0.3;
}

/** What anchoring region `index` on `pc` is worth: held long, the root, in the key, and on an open string all count. */
function anchorWorth(context: GuideContext, pc: number, index: number): number {
  const region = context.regions[index]!;
  const run = context.options[index]!.get(pc);
  if (!run) return 0;
  const length = lengthIn(region, run);
  if (length < Math.min(context.minAnchorMs, region.toMs - region.fromMs)) return 0;
  const fit = anchorFit(pc, region.rootPc);
  return length * fit
    * (context.scale.has(pc) ? 1.8 : 1)
    * (OPEN_PITCH_CLASSES.has(pc) ? 1.6 : 1);
}

function offeredPitchClasses(context: GuideContext): Set<number> {
  const offered = new Set<number>();
  for (const region of context.options) for (const pc of region.keys()) offered.add(pc);
  return offered;
}

/** Greedily picks up to six root pitch classes, each the one adding most worth over what is already covered. */
function greedyVocabulary(context: GuideContext): Set<number> {
  const vocabulary = new Set<number>();
  const standing = context.regions.map(() => 0);
  const offered = offeredPitchClasses(context);
  for (let slot = 0; slot < MAX_ROOT_PITCH_CLASSES; slot++) {
    let bestPc: number | null = null;
    let bestGain = 0;
    for (const pc of offered) {
      if (vocabulary.has(pc)) continue;
      const gain = standing.reduce((sum, held, index) => sum + Math.max(0, anchorWorth(context, pc, index) - held), 0);
      if (gain > bestGain) {
        bestGain = gain;
        bestPc = pc;
      }
    }
    if (bestPc === null) break;
    vocabulary.add(bestPc);
    standing.forEach((held, index) => { standing[index] = Math.max(held, anchorWorth(context, bestPc!, index)); });
  }
  return vocabulary;
}

type Coverage = { overMs: number; silentMs: number; value: number };

/**
 * Walks the regions with a vocabulary: how long the line goes unanchored
 * beyond what can be tolerated, how long it is silent, and what it is worth.
 */
function measureCoverage(context: GuideContext, vocabulary: ReadonlySet<number>, tolerateMs: number): Coverage {
  const coverage: Coverage = { overMs: 0, silentMs: 0, value: 0 };
  let runMs = 0;
  let sounding: number | null = null;
  context.regions.forEach((region, index) => {
    const span = region.toMs - region.fromMs;
    let best = 0;
    let bestPc: number | null = null;
    for (const pc of vocabulary) {
      if (sounding !== null && reach(context, sounding, pc) > context.maxLeapSemitones) continue;
      const candidate = anchorWorth(context, pc, index);
      if (candidate > best) {
        best = candidate;
        bestPc = pc;
      }
    }
    coverage.value += best;
    if (bestPc === null) {
      coverage.silentMs += span;
      runMs += span;
      return;
    }
    sounding = bestPc;
    coverage.overMs += Math.max(0, runMs - tolerateMs);
    runMs = 0;
  });
  coverage.overMs += Math.max(0, runMs - tolerateMs);
  return coverage;
}

/** Less time over the tolerance first, then less silence, then more worth. */
function coversBetter(a: Coverage, b: Coverage): boolean {
  if (a.overMs !== b.overMs) return a.overMs < b.overMs;
  if (a.silentMs !== b.silentMs) return a.silentMs < b.silentMs;
  return a.value > b.value;
}

const MAX_SWAP_PASSES = 8;

type Swap = { outgoing: number; incoming: number };

/** The single swap of one vocabulary pitch class for an offered one that most improves coverage, if any does. */
function bestSwap(context: GuideContext, vocabulary: ReadonlySet<number>, offered: ReadonlySet<number>, tolerateMs: number): Swap | null {
  let current = measureCoverage(context, vocabulary, tolerateMs);
  let best: Swap | null = null;
  for (const outgoing of vocabulary) {
    for (const incoming of offered) {
      if (vocabulary.has(incoming)) continue;
      const trial = new Set(vocabulary);
      trial.delete(outgoing);
      trial.add(incoming);
      const result = measureCoverage(context, trial, tolerateMs);
      if (coversBetter(result, current)) {
        current = result;
        best = { outgoing, incoming };
      }
    }
  }
  return best;
}

/** Swaps one pitch class at a time while that leaves fewer silent regions. */
function refineVocabulary(context: GuideContext, vocabulary: Set<number>, tolerateMs: number): void {
  const offered = offeredPitchClasses(context);
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    if (measureCoverage(context, vocabulary, tolerateMs).silentMs === 0) return;
    const swap = bestSwap(context, vocabulary, offered, tolerateMs);
    if (!swap) return;
    vocabulary.delete(swap.outgoing);
    vocabulary.add(swap.incoming);
  }
}

/** Scores a run as a region's anchor. `earlyBonus` favours a run already sounding as the region begins. */
function runScore(context: GuideContext, region: HarmonicRegion, pc: number, run: BassRun, earlyBonus: boolean): number {
  const span = region.toMs - region.fromMs;
  let score = lengthIn(region, run) + span * rootOrFifthBonus(pc, region.rootPc, 0.7, 0.3);
  if (context.scale.has(pc)) score += span * 0.6;
  if (OPEN_PITCH_CLASSES.has(pc)) score += span * 0.45;
  if (earlyBonus && run.fromMs <= region.fromMs + 40) score += span * 0.35;
  return score;
}

type RunFilter = (pc: number, run: BassRun) => boolean;

function bestRun(context: GuideContext, index: number, floorMs: number, accept: RunFilter, earlyBonus: boolean): BassRun | null {
  const region = context.regions[index]!;
  const span = region.toMs - region.fromMs;
  let best: BassRun | null = null;
  let bestScore = 0;
  for (const [pc, run] of context.options[index]!) {
    if (!accept(pc, run) || lengthIn(region, run) < Math.min(floorMs, span)) continue;
    const score = runScore(context, region, pc, run, earlyBonus);
    if (score > bestScore) {
      bestScore = score;
      best = run;
    }
  }
  return best;
}

type ChosenRun = { region: HarmonicRegion; run: BassRun | null };

/** Each region's anchor from the vocabulary: a full-length one if there is one, else a short one. */
function chooseRuns(context: GuideContext, vocabulary: ReadonlySet<number>): ChosenRun[] {
  const inVocabulary: RunFilter = (pc) => vocabulary.has(pc);
  return context.regions.map((region, index) => ({
    region,
    run: bestRun(context, index, context.minAnchorMs, inVocabulary, true)
      ?? bestRun(context, index, context.shortAnchorMs, inVocabulary, true),
  }));
}

/** Where an anchor is out of reach of the one before, swaps in the best one that is not. */
function keepWithinReach(context: GuideContext, chosen: ChosenRun[], vocabulary: ReadonlySet<number>): void {
  let standingPc: number | null = null;
  chosen.forEach((entry, index) => {
    const run = entry.run;
    if (!run) return;
    const from = standingPc;
    if (from !== null && reach(context, from, run.pc) > context.maxLeapSemitones) {
      const reachable: RunFilter = (pc) => vocabulary.has(pc) && pc !== run.pc && reach(context, from, pc) <= context.maxLeapSemitones;
      entry.run = bestRun(context, index, context.shortAnchorMs, reachable, false) ?? run;
    }
    standingPc = entry.run!.pc;
  });
}

/** Chosen runs clipped to their regions, with a pitch continuing across a region line merged into one span. */
function mergeChosen(chosen: readonly ChosenRun[]): GuideAnchor[] {
  const spans: GuideAnchor[] = [];
  for (const { region, run } of chosen) {
    if (!run) continue;
    const span = { pc: run.pc, fromMs: Math.max(region.fromMs, run.fromMs), toMs: Math.min(region.toMs, run.toMs) };
    if (span.toMs <= span.fromMs) continue;
    const last = spans.at(-1);
    if (last?.pc === span.pc && span.fromMs <= last.toMs + SUPPORT_BRIDGE_MS) last.toMs = Math.max(last.toMs, span.toMs);
    else spans.push(span);
  }
  return spans;
}

/** Re-strikes each span on the pulse, detached except for the last stroke, no closer together than a beginner can play. */
function pulseSpans(spans: readonly GuideAnchor[], pulseMs: number): GuideAnchor[] {
  return spans.flatMap((span) => {
    const length = span.toMs - span.fromMs;
    let count = Math.max(1, Math.round(length / pulseMs));
    while (count > 1 && length / count < GUIDE_SPACING_MS) count--;
    const each = length / count;
    return Array.from({ length: count }, (_, index) => {
      const fromMs = span.fromMs + index * each;
      const held = index === count - 1 ? each : each * DETACHED_SHARE;
      return { pc: span.pc, fromMs, toMs: fromMs + held };
    });
  });
}

/** Where two anchors crowd each other, keeps the longer one if that does not crowd the one before. */
function thinCrowded(pieces: readonly GuideAnchor[]): GuideAnchor[] {
  const out: GuideAnchor[] = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if (!last || piece.fromMs - last.fromMs >= GUIDE_SPACING_MS) {
      out.push(piece);
      continue;
    }
    const before = out.at(-2);
    const roomy = !before || piece.fromMs - before.fromMs >= GUIDE_SPACING_MS;
    if (roomy && piece.toMs - piece.fromMs > last.toMs - last.fromMs) out[out.length - 1] = piece;
  }
  return out;
}

export function guideAnchors(
  bass: readonly MidiNote[], analysis: HarmonicAnalysis,
  range: ArrangementRange, maxLeapSemitones: number,
): GuideAnchor[] {
  const { regions, barMs, beatMs, scale } = analysis;
  if (regions.length === 0) return [];
  const minAnchorMs = anchorLengthMs(beatMs);
  const context: GuideContext = {
    regions,
    options: regionRunOptions(regions, bassRuns(bass)),
    scale,
    minAnchorMs,
    shortAnchorMs: Math.max(150, minAnchorMs * 0.5),
    maxLeapSemitones,
    seats: Array.from({ length: 12 }, (_, pc) => closedFramePitches(pc, range)),
  };

  const vocabulary = greedyVocabulary(context);
  refineVocabulary(context, vocabulary, barMs * 3);
  const chosen = chooseRuns(context, vocabulary);
  keepWithinReach(context, chosen, vocabulary);
  return thinCrowded(pulseSpans(mergeChosen(chosen), pulseLengthMs(beatMs)));
}

const ANCHOR_VELOCITY = 112;
const MAX_SEAT_COMBINATIONS = 4096;

/** Open strings are free; below the G string costs more than above; far from the middle costs a little. */
function seatCost(pitch: number, centre: number): number {
  if (OPEN_PITCHES.has(pitch)) return 0;
  const belowGradeOne = pitch < OPEN_STRING_MIDI.G ? 12 : 6;
  return belowGradeOne + Math.abs(pitch - centre) * 0.06;
}

function moveCost(from: number, to: number): number {
  const skipsString = Math.abs(stringSlot(to) - stringSlot(from)) >= 2;
  return Math.abs(to - from) * 0.02 + (skipsString ? 2 : 0);
}

/** The cost of dropping an anchor the hand cannot reach: high, and higher the longer it was. */
function restCost(anchor: GuideAnchor): number {
  return 35 + (anchor.toMs - anchor.fromMs) / 200;
}

/** Candidate pitches per class, cheapest seat first; trimmed to two each while the search space is too large. */
function seatOptions(classes: readonly number[], range: ArrangementRange, centre: number): number[][] {
  const options = classes.map((pc) => {
    const closed = closedFramePitches(pc, range);
    const candidates = closed.length > 0 ? closed : octaveCandidates(pc + 60, range);
    if (candidates.length === 0) {
      throw new RangeError('Arrangement range must contain every source pitch class.');
    }
    return [...candidates].sort((a, b) => seatCost(a, centre) - seatCost(b, centre));
  });
  let combinations = options.reduce((total, list) => total * list.length, 1);
  for (let i = 0; combinations > MAX_SEAT_COMBINATIONS && i < options.length; i++) {
    combinations = (combinations / options[i]!.length) * Math.min(2, options[i]!.length);
    options[i] = options[i]!.slice(0, 2);
  }
  return options;
}

/** Plays the anchors through with one seat per pitch class and totals the cost. */
function walkCost(
  anchors: readonly GuideAnchor[], assignment: ReadonlyMap<number, number>, centre: number, maxLeapSemitones: number,
): number {
  let cost = 0;
  let standing: number | null = null;
  for (const anchor of anchors) {
    const pitch = assignment.get(anchor.pc)!;
    if (standing !== null && Math.abs(pitch - standing) > maxLeapSemitones) {
      cost += restCost(anchor);
      continue;
    }
    cost += seatCost(pitch, centre) + (standing === null ? 0 : moveCost(standing, pitch));
    standing = pitch;
  }
  return cost;
}

/** Exhaustively tries every seat per pitch class and keeps the cheapest assignment. */
function cheapestSeats(
  classes: readonly number[], options: readonly number[][], cost: (assignment: ReadonlyMap<number, number>) => number,
): Map<number, number> | null {
  let best: Map<number, number> | null = null;
  let bestCost = Infinity;
  const assignment = new Map<number, number>();
  const enumerate = (depth: number) => {
    if (depth === classes.length) {
      const total = cost(assignment);
      if (total < bestCost) {
        bestCost = total;
        best = new Map(assignment);
      }
      return;
    }
    for (const pitch of options[depth]!) {
      assignment.set(classes[depth]!, pitch);
      enumerate(depth + 1);
    }
  };
  enumerate(0);
  return best;
}

export function placeAnchors(
  anchors: readonly GuideAnchor[],
  range: ArrangementRange, maxLeapSemitones: number,
): MidiNote[] {
  if (anchors.length === 0) return [];
  const centre = (range.low + range.high) / 2;
  const classes = [...new Set(anchors.map((anchor) => anchor.pc))].sort((a, b) => a - b);
  const options = seatOptions(classes, range, centre);
  const seats = cheapestSeats(classes, options, (assignment) => walkCost(anchors, assignment, centre, maxLeapSemitones));
  if (!seats) return [];

  const out: MidiNote[] = [];
  let standing: number | null = null;
  for (const anchor of anchors) {
    const midiNumber = seats.get(anchor.pc)!;
    if (standing !== null && Math.abs(midiNumber - standing) > maxLeapSemitones) continue;
    standing = midiNumber;
    out.push({
      midiNumber,
      startTimeMs: anchor.fromMs,
      durationMs: Math.max(1, anchor.toMs - anchor.fromMs),
      track: 0,
      channel: 0,
      velocity: ANCHOR_VELOCITY,
    });
  }
  return out;
}

export function bassLine(parsed: ParsedMidi, endMs: number): MidiNote[] {
  const voice = sourceBassVoice(parsed, endMs);
  return completeBassLine(voice, analyseHarmony(parsed, endMs, voice));
}

export function harmonicGuide(parsed: ParsedMidi, endMs: number): MidiNote[] {
  const voice = sourceBassVoice(parsed, endMs);
  const analysis = analyseHarmony(parsed, endMs, voice);
  const bass = completeBassLine(voice, analysis);
  const profile = ARRANGEMENT_PROFILES.Beginner;
  const anchors = guideAnchors(bass, analysis, profile.range, profile.maxLeapSemitones);
  return placeAnchors(anchors, profile.range, profile.maxLeapSemitones);
}
