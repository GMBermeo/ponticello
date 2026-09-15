import { OPEN_STRING_MIDI } from '../cello';
import { firstPositionFingering } from '../fingering';
import { detectKey } from '../key';
import { MelodyMetrics } from '../melody';
import { MidiNote, ParsedMidi } from '../midi';
import { ARRANGEMENT_PROFILES, ArrangementRange, ArrangementSourceKind } from './profiles';
import { octaveCandidates } from './rangeFitter';

export function isBassProgram(program: number | null): boolean {
  return program !== null && program >= 32 && program <= 39;
}

export function sourceKind(metrics: MelodyMetrics, program: number | null): ArrangementSourceKind {
  if (metrics.motifRecurrence >= 0.3) return 'riff';
  if (isBassProgram(program)) return 'bass';
  return 'melody';
}

const mod12 = (value: number) => ((value % 12) + 12) % 12;

/** A sounding lower voice, including note-offs and rests, before octave fitting. */
export function lowestVoice(notes: readonly MidiNote[], endMs: number): MidiNote[] {
  const events = notes.flatMap((note, id) => [
    { time: note.startTimeMs, id, note, on: true },
    { time: Math.min(endMs, note.startTimeMs + note.durationMs), id, note, on: false },
  ]).filter((event) => event.time >= 0 && event.time <= endMs)
    .sort((a, b) => a.time - b.time || Number(a.on) - Number(b.on));
  const active = new Map<number, MidiNote>();
  const out: MidiNote[] = [];
  for (let i = 0; i < events.length;) {
    const from = events[i]!.time;
    while (i < events.length && events[i]!.time === from) {
      const event = events[i++]!;
      if (event.on) active.set(event.id, event.note);
      else active.delete(event.id);
    }
    const to = events[i]?.time ?? endMs;
    if (to <= from || active.size === 0) continue;
    let lowest: MidiNote | undefined;
    for (const note of active.values()) {
      if (!lowest || note.midiNumber < lowest.midiNumber) lowest = note;
    }
    if (!lowest) continue;
    const previous = out[out.length - 1];
    if (previous && previous.midiNumber === lowest.midiNumber
      && previous.startTimeMs + previous.durationMs === from) {
      previous.durationMs = to - previous.startTimeMs;
    } else {
      out.push({ ...lowest, startTimeMs: from, durationMs: to - from });
    }
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

const OPEN_PITCH_CLASSES: ReadonlySet<number> =
  new Set(Object.values(OPEN_STRING_MIDI).map((pitch) => pitch % 12));

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

const ROOT_TEMPLATE: readonly (readonly [number, number])[] =
  [[0, 1.7], [7, 0.75], [4, 0.9], [3, 0.9], [10, 0.3]];

export function rootOfWeights(
  weights: readonly number[], total: number, bass: { pc: number; share: number } | null,
  scale: ReadonlySet<number>,
): number | null {
  if (total <= 0) return null;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    let score = 0;
    for (const [interval, weight] of ROOT_TEMPLATE) {
      score += (weights[(root + interval) % 12] ?? 0) * weight;
    }
    score -= (weights[(root + 1) % 12] ?? 0) * 0.45;
    if (bass && bass.pc === root) score += total * 0.45 * bass.share;
    if (scale.has(root)) score += total * 0.15;
    if ((weights[root] ?? 0) <= 0) score -= total * 0.7;
    if (score > bestScore) { bestScore = score; best = root; }
  }
  return best;
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

  let slotMs = barMs / 2;
  while (slotMs < MIN_SLOT_MS) slotMs *= 2;

  const slots: { fromMs: number; toMs: number; rootPc: number | null; live: boolean }[] = [];
  let noteCursor = 0;
  let voiceCursor = 0;
  let live: MidiNote[] = [];
  let bassLive: MidiNote[] = [];
  let activeCursor = 0;
  for (let fromMs = firstMs; fromMs < lastMs; fromMs += slotMs) {
    const toMs = Math.min(lastMs, fromMs + slotMs);
    while (noteCursor < pitched.length && pitched[noteCursor]!.startTimeMs < toMs) {
      live.push(pitched[noteCursor++]!);
    }
    while (voiceCursor < voice.length && voice[voiceCursor]!.startTimeMs < toMs) {
      bassLive.push(voice[voiceCursor++]!);
    }
    live = live.filter((note) => note.startTimeMs + note.durationMs > fromMs);
    bassLive = bassLive.filter((note) => note.startTimeMs + note.durationMs > fromMs);
    while (activeCursor < active.length && active[activeCursor]!.toMs <= fromMs) activeCursor++;
    const isLive = (active[activeCursor]?.fromMs ?? Infinity) < toMs;

    const weights = new Array<number>(12).fill(0);
    let total = 0;
    for (const note of live) {
      const overlap = Math.min(toMs, note.startTimeMs + note.durationMs) - Math.max(fromMs, note.startTimeMs);
      if (overlap <= 0) continue;
      const pitchClass = mod12(note.midiNumber);
      weights[pitchClass] = weights[pitchClass]! + overlap;
      total += overlap;
    }

    const bassWeights = new Array<number>(12).fill(0);
    for (const note of bassLive) {
      const overlap = Math.min(toMs, note.startTimeMs + note.durationMs) - Math.max(fromMs, note.startTimeMs);
      if (overlap <= 0) continue;
      bassWeights[mod12(note.midiNumber)] = bassWeights[mod12(note.midiNumber)]! + overlap;
    }
    let bassPc: number | null = null;
    let bassBest = (toMs - fromMs) * 0.25;
    for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
      if (bassWeights[pitchClass]! > bassBest) { bassBest = bassWeights[pitchClass]!; bassPc = pitchClass; }
    }
    if (bassPc === null) {
      let lowest: MidiNote | null = null;
      for (const note of live) {
        const overlap = Math.min(toMs, note.startTimeMs + note.durationMs) - Math.max(fromMs, note.startTimeMs);
        if (overlap < (toMs - fromMs) * 0.25) continue;
        if (!lowest || note.midiNumber < lowest.midiNumber) lowest = note;
      }
      if (lowest) {
        bassPc = mod12(lowest.midiNumber);
        bassBest = Math.min(toMs - fromMs,
          Math.min(toMs, lowest.startTimeMs + lowest.durationMs) - Math.max(fromMs, lowest.startTimeMs));
      }
    }
    const bass = bassPc === null ? null
      : { pc: bassPc, share: Math.min(1, bassBest / Math.max(1, toMs - fromMs)) };

    slots.push({ fromMs, toMs, rootPc: rootOfWeights(weights, total, bass, scale), live: isLive });
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot.rootPc !== null || !slot.live) continue;
    let carried: number | null = null;
    for (let j = i - 1; j >= 0 && carried === null; j--) carried = slots[j]!.rootPc;
    for (let j = i + 1; j < slots.length && carried === null; j++) carried = slots[j]!.rootPc;
    slot.rootPc = carried;
  }

  const regions: HarmonicRegion[] = slots
    .filter((slot) => slot.live && slot.rootPc !== null)
    .map((slot) => ({ fromMs: slot.fromMs, toMs: slot.toMs, rootPc: slot.rootPc! }));
  return { regions, barMs, beatMs, scale };
}

export interface BassRun { pc: number; fromMs: number; toMs: number }

export function bassRuns(bass: readonly MidiNote[]): BassRun[] {
  const byPitchClass = new Map<number, HarmonySpan[]>();
  for (const note of bass) {
    const pc = mod12(note.midiNumber);
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

export function completeBassLine(
  voice: readonly MidiNote[], analysis: HarmonicAnalysis,
): MidiNote[] {
  const { regions, barMs, beatMs } = analysis;
  const out = [...voice].sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map((note) => ({ ...note }));
  if (regions.length === 0) return out;

  const sortedPitches = [...out].map((note) => note.midiNumber).sort((a, b) => a - b);
  const median = sortedPitches[Math.floor(sortedPitches.length / 2)] ?? OPEN_STRING_MIDI.G;
  const holdMs = Math.min(MAX_HOLD_MS, Math.max(1200, barMs * 2));
  const legatoMs = beatMs * 0.55;

  const anchorAt = (timeMs: number): number => {
    let best = median;
    let bestDistance = Infinity;
    for (const note of out) {
      const distance = note.startTimeMs <= timeMs
        ? timeMs - (note.startTimeMs + note.durationMs)
        : note.startTimeMs - timeMs;
      if (Math.abs(distance) < bestDistance) { bestDistance = Math.abs(distance); best = note.midiNumber; }
    }
    return best;
  };

  const fills: MidiNote[] = [];
  const emit = (fromMs: number, toMs: number, rootPc: number) => {
    if (toMs - fromMs < 60) return;
    const anchor = anchorAt(fromMs);
    let midiNumber = rootPc + 12 * Math.round((anchor - rootPc) / 12);
    while (midiNumber < BASS_FILL_RANGE.low) midiNumber += 12;
    while (midiNumber > BASS_FILL_RANGE.high) midiNumber -= 12;
    const count = Math.max(1, Math.ceil((toMs - fromMs) / holdMs));
    const each = (toMs - fromMs) / count;
    for (let index = 0; index < count; index++) {
      fills.push({
        midiNumber, startTimeMs: fromMs + index * each, durationMs: each,
        track: 0, channel: 0, velocity: 96,
      });
    }
  };

  const covered = mergeSpans(out.map((note) => ({
    fromMs: note.startTimeMs, toMs: note.startTimeMs + note.durationMs,
  })));
  const extendable = (timeMs: number) => out.find((note) =>
    Math.abs(note.startTimeMs + note.durationMs - timeMs) <= 1);

  for (const region of regions) {
    let cursor = region.fromMs;
    const hole = (fromMs: number, toMs: number) => {
      if (toMs - fromMs <= 0) return;
      const previous = extendable(fromMs);
      if (previous && toMs - fromMs <= legatoMs) {
        previous.durationMs = toMs - previous.startTimeMs;
        return;
      }
      emit(fromMs, toMs, region.rootPc);
    };
    for (const span of covered) {
      if (span.toMs <= cursor) continue;
      if (span.fromMs >= region.toMs) break;
      if (span.fromMs > cursor) hole(cursor, span.fromMs);
      cursor = Math.max(cursor, span.toMs);
    }
    if (cursor < region.toMs) hole(cursor, region.toMs);
  }

  const runs = bassRuns([...out, ...fills].sort((a, b) => a.startTimeMs - b.startTimeMs));
  const minAnchorMs = anchorLengthMs(beatMs);
  const pedals: MidiNote[] = [];
  for (const region of regions) {
    const span = region.toMs - region.fromMs;
    if (span < minAnchorMs) continue;
    if (longestRunIn(runs, region.fromMs, region.toMs) >= Math.min(minAnchorMs, span)) continue;

    const cover = new Array<number>(12).fill(0);
    const onset = new Array<number>(12).fill(Infinity);
    const lowest = new Array<number>(12).fill(Infinity);
    for (const note of [...out, ...fills]) {
      if (note.startTimeMs >= region.toMs) continue;
      if (note.startTimeMs + note.durationMs <= region.fromMs) continue;
      const pc = mod12(note.midiNumber);
      cover[pc] = cover[pc]! + Math.min(region.toMs, note.startTimeMs + note.durationMs)
        - Math.max(region.fromMs, note.startTimeMs);
      onset[pc] = Math.min(onset[pc]!, Math.max(region.fromMs, note.startTimeMs));
      lowest[pc] = Math.min(lowest[pc]!, note.midiNumber);
    }
    let pedalPc: number | null = null;
    let bestScore = 0;
    for (let pc = 0; pc < 12; pc++) {
      if (cover[pc]! <= 0) continue;
      let score = cover[pc]!;
      if (pc === region.rootPc) score += span * 0.6;
      else if (pc === (region.rootPc + 7) % 12) score += span * 0.25;
      if (score > bestScore) { bestScore = score; pedalPc = pc; }
    }
    if (pedalPc === null) continue;
    const fromMs = Math.min(region.toMs - minAnchorMs, onset[pedalPc]!);
    const count = Math.max(1, Math.ceil((region.toMs - fromMs) / holdMs));
    const each = (region.toMs - fromMs) / count;
    for (let index = 0; index < count; index++) {
      pedals.push({
        midiNumber: lowest[pedalPc]!, startTimeMs: fromMs + index * each, durationMs: each,
        track: 0, channel: 0, velocity: 96,
      });
    }
  }

  return [...out, ...fills, ...pedals]
    .sort((a, b) => a.startTimeMs - b.startTimeMs || a.midiNumber - b.midiNumber);
}

export function closedFramePitches(pc: number, range: ArrangementRange): number[] {
  const out: number[] = [];
  for (let pitch = Math.ceil(range.low); pitch <= Math.floor(range.high); pitch++) {
    if (mod12(pitch) !== pc) continue;
    try {
      if (firstPositionFingering(pitch).extension !== 'none') continue;
    } catch { continue; }
    out.push(pitch);
  }
  return out;
}

export function stringSlot(pitch: number): number {
  return pitch <= 42 ? 0 : pitch <= 49 ? 1 : pitch <= 56 ? 2 : 3;
}

export function guideAnchors(
  bass: readonly MidiNote[], analysis: HarmonicAnalysis,
  range: ArrangementRange, maxLeapSemitones: number,
): { pc: number; fromMs: number; toMs: number }[] {
  const { regions, barMs, beatMs, scale } = analysis;
  if (regions.length === 0) return [];
  const runs = bassRuns(bass);
  const minAnchorMs = anchorLengthMs(beatMs);
  const shortAnchorMs = Math.max(150, minAnchorMs * 0.5);
  const lengthIn = (region: HarmonicRegion, run: BassRun) =>
    Math.min(region.toMs, run.toMs) - Math.max(region.fromMs, run.fromMs);

  const options = regions.map((region) => {
    const best = new Map<number, BassRun>();
    for (const run of runs) {
      if (run.toMs <= region.fromMs) continue;
      if (run.fromMs >= region.toMs) break;
      const held = best.get(run.pc);
      if (!held || lengthIn(region, run) > lengthIn(region, held)) best.set(run.pc, run);
    }
    return best;
  });

  const worth = (pc: number, index: number): number => {
    const region = regions[index]!;
    const run = options[index]!.get(pc);
    if (!run) return 0;
    const length = lengthIn(region, run);
    if (length < Math.min(minAnchorMs, region.toMs - region.fromMs)) return 0;
    const fit = pc === region.rootPc ? 1
      : pc === (region.rootPc + 7) % 12 ? 0.6
        : 0.3;
    return length * fit
      * (scale.has(pc) ? 1.8 : 1)
      * (OPEN_PITCH_CLASSES.has(pc) ? 1.6 : 1);
  };

  const seatsOf = Array.from({ length: 12 }, (_, pc) => closedFramePitches(pc, range));
  const reach = (a: number, b: number) => {
    let best = Infinity;
    for (const x of seatsOf[a]!) for (const y of seatsOf[b]!) best = Math.min(best, Math.abs(x - y));
    return best;
  };

  const vocabulary = new Set<number>();
  const standing = regions.map(() => 0);
  for (let slot = 0; slot < MAX_ROOT_PITCH_CLASSES; slot++) {
    const offered = new Set<number>();
    for (const region of options) for (const pc of region.keys()) offered.add(pc);
    let bestPc: number | null = null;
    let bestGain = 0;
    for (const pc of offered) {
      if (vocabulary.has(pc)) continue;
      let gain = 0;
      for (let index = 0; index < regions.length; index++) {
        gain += Math.max(0, worth(pc, index) - standing[index]!);
      }
      if (gain > bestGain) { bestGain = gain; bestPc = pc; }
    }
    if (bestPc === null) break;
    vocabulary.add(bestPc);
    for (let index = 0; index < regions.length; index++) {
      standing[index] = Math.max(standing[index]!, worth(bestPc, index));
    }
  }

  const offeredAll = new Set<number>();
  for (const region of options) for (const pc of region.keys()) offeredAll.add(pc);

  const tolerateMs = barMs * 3;
  const measure = (set: ReadonlySet<number>) => {
    let overMs = 0;
    let silentMs = 0;
    let value = 0;
    let runMs = 0;
    let sounding: number | null = null;
    for (let index = 0; index < regions.length; index++) {
      const span = regions[index]!.toMs - regions[index]!.fromMs;
      let best = 0;
      let bestPc: number | null = null;
      for (const pc of set) {
        if (sounding !== null && reach(sounding, pc) > maxLeapSemitones) continue;
        const candidate = worth(pc, index);
        if (candidate > best) { best = candidate; bestPc = pc; }
      }
      value += best;
      if (bestPc === null) { silentMs += span; runMs += span; continue; }
      sounding = bestPc;
      overMs += Math.max(0, runMs - tolerateMs);
      runMs = 0;
    }
    overMs += Math.max(0, runMs - tolerateMs);
    return { overMs, silentMs, value };
  };
  const better = (
    a: { overMs: number; silentMs: number; value: number },
    b: { overMs: number; silentMs: number; value: number },
  ) => a.overMs < b.overMs
    || (a.overMs === b.overMs && a.silentMs < b.silentMs)
    || (a.overMs === b.overMs && a.silentMs === b.silentMs && a.value > b.value);
  for (let pass = 0; pass < 8; pass++) {
    let current = measure(vocabulary);
    if (current.silentMs === 0) break;
    let bestSwap: { out: number; in: number } | null = null;
    for (const outgoing of vocabulary) {
      for (const incoming of offeredAll) {
        if (vocabulary.has(incoming)) continue;
        const trial = new Set(vocabulary);
        trial.delete(outgoing);
        trial.add(incoming);
        const result = measure(trial);
        if (better(result, current)) { current = result; bestSwap = { out: outgoing, in: incoming }; }
      }
    }
    if (!bestSwap) break;
    vocabulary.delete(bestSwap.out);
    vocabulary.add(bestSwap.in);
  }

  const chosen: { region: HarmonicRegion; run: BassRun | null }[] = regions.map((region, index) => {
    const span = region.toMs - region.fromMs;
    const take = (floor: number): BassRun | null => {
      let best: BassRun | null = null;
      let bestScore = 0;
      for (const [pc, run] of options[index]!) {
        if (!vocabulary.has(pc)) continue;
        const overlap = lengthIn(region, run);
        if (overlap < Math.min(floor, span)) continue;
        let score = overlap;
        if (pc === region.rootPc) score += span * 0.7;
        else if (pc === (region.rootPc + 7) % 12) score += span * 0.3;
        if (scale.has(pc)) score += span * 0.6;
        if (OPEN_PITCH_CLASSES.has(pc)) score += span * 0.45;
        if (run.fromMs <= region.fromMs + 40) score += span * 0.35;
        if (score > bestScore) { bestScore = score; best = run; }
      }
      return best;
    };
    return { region, run: take(minAnchorMs) ?? take(shortAnchorMs) };
  });

  let standingPc: number | null = null;
  for (let index = 0; index < chosen.length; index++) {
    const entry = chosen[index]!;
    if (!entry.run) continue;
    if (standingPc !== null && reach(standingPc, entry.run.pc) > maxLeapSemitones) {
      const region = entry.region;
      const span = region.toMs - region.fromMs;
      let swap: BassRun | null = null;
      let bestScore = 0;
      for (const [pc, run] of options[index]!) {
        if (!vocabulary.has(pc) || pc === entry.run.pc) continue;
        if (reach(standingPc, pc) > maxLeapSemitones) continue;
        const overlap = lengthIn(region, run);
        if (overlap < Math.min(shortAnchorMs, span)) continue;
        let score = overlap;
        if (pc === region.rootPc) score += span * 0.7;
        else if (pc === (region.rootPc + 7) % 12) score += span * 0.3;
        if (scale.has(pc)) score += span * 0.6;
        if (OPEN_PITCH_CLASSES.has(pc)) score += span * 0.45;
        if (score > bestScore) { bestScore = score; swap = run; }
      }
      if (swap) entry.run = swap;
    }
    standingPc = entry.run.pc;
  }

  const spans: { pc: number; fromMs: number; toMs: number }[] = [];
  for (const { region, run } of chosen) {
    if (!run) continue;
    const span = {
      pc: run.pc,
      fromMs: Math.max(region.fromMs, run.fromMs),
      toMs: Math.min(region.toMs, run.toMs),
    };
    if (span.toMs <= span.fromMs) continue;
    const last = spans[spans.length - 1];
    if (last && last.pc === span.pc && span.fromMs <= last.toMs + SUPPORT_BRIDGE_MS) {
      last.toMs = Math.max(last.toMs, span.toMs);
      continue;
    }
    spans.push(span);
  }

  const pulseMs = pulseLengthMs(beatMs);
  const pieces: { pc: number; fromMs: number; toMs: number }[] = [];
  for (const span of spans) {
    const length = span.toMs - span.fromMs;
    let count = Math.max(1, Math.round(length / pulseMs));
    while (count > 1 && length / count < GUIDE_SPACING_MS) count--;
    const each = length / count;
    for (let index = 0; index < count; index++) {
      const fromMs = span.fromMs + index * each;
      const held = index === count - 1 ? each : each * DETACHED_SHARE;
      pieces.push({ pc: span.pc, fromMs, toMs: fromMs + held });
    }
  }

  const out: { pc: number; fromMs: number; toMs: number }[] = [];
  for (const piece of pieces) {
    const last = out[out.length - 1];
    if (!last || piece.fromMs - last.fromMs >= GUIDE_SPACING_MS) { out.push(piece); continue; }
    const before = out[out.length - 2];
    const roomy = !before || piece.fromMs - before.fromMs >= GUIDE_SPACING_MS;
    if (roomy && piece.toMs - piece.fromMs > last.toMs - last.fromMs) out[out.length - 1] = piece;
  }
  return out;
}

export function placeAnchors(
  anchors: readonly { pc: number; fromMs: number; toMs: number }[],
  range: ArrangementRange, maxLeapSemitones: number,
): MidiNote[] {
  if (anchors.length === 0) return [];
  const centre = (range.low + range.high) / 2;
  const opens = new Set<number>(Object.values(OPEN_STRING_MIDI));
  const seat = (pitch: number) => {
    if (opens.has(pitch)) return 0;
    const belowGradeOne = pitch < OPEN_STRING_MIDI.G ? 12 : 6;
    return belowGradeOne + Math.abs(pitch - centre) * 0.06;
  };
  const move = (from: number, to: number) =>
    Math.abs(to - from) * 0.02
    + (Math.abs(stringSlot(to) - stringSlot(from)) >= 2 ? 2 : 0);
  const rest = (index: number) =>
    35 + (anchors[index]!.toMs - anchors[index]!.fromMs) / 200;

  const classes = [...new Set(anchors.map((anchor) => anchor.pc))].sort((a, b) => a - b);
  const options = classes.map((pc) => {
    const closed = closedFramePitches(pc, range);
    const candidates = closed.length > 0 ? closed : octaveCandidates(pc + 60, range);
    if (candidates.length === 0) {
      throw new RangeError('Arrangement range must contain every source pitch class.');
    }
    return [...candidates].sort((a, b) => seat(a) - seat(b));
  });

  let combinations = options.reduce((total, list) => total * list.length, 1);
  for (let i = 0; combinations > 4096 && i < options.length; i++) {
    combinations = (combinations / options[i]!.length) * Math.min(2, options[i]!.length);
    options[i] = options[i]!.slice(0, 2);
  }

  const walk = (assignment: ReadonlyMap<number, number>) => {
    let cost = 0;
    let standing: number | null = null;
    for (let index = 0; index < anchors.length; index++) {
      const pitch = assignment.get(anchors[index]!.pc)!;
      if (standing !== null && Math.abs(pitch - standing) > maxLeapSemitones) {
        cost += rest(index);
        continue;
      }
      cost += seat(pitch) + (standing === null ? 0 : move(standing, pitch));
      standing = pitch;
    }
    return cost;
  };

  let best: Map<number, number> | null = null;
  let bestCost = Infinity;
  const assignment = new Map<number, number>();
  const enumerate = (depth: number) => {
    if (depth === classes.length) {
      const cost = walk(assignment);
      if (cost < bestCost) { bestCost = cost; best = new Map(assignment); }
      return;
    }
    for (const pitch of options[depth]!) {
      assignment.set(classes[depth]!, pitch);
      enumerate(depth + 1);
    }
  };
  enumerate(0);
  if (!best) return [];

  const seats: ReadonlyMap<number, number> = best;
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
      velocity: 112,
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
