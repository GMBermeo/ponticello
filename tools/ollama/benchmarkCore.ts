/**
 * Pure building blocks for the model benchmark (tools/ollama-benchmark.ts).
 *
 * The existing arranger asks a model for a *blueprint* and then generates every
 * note and fingering deterministically, so two models only ever differ in the
 * prose of the arrangement notes. That is useless for comparing models. The
 * benchmark keeps the notes deterministic — every model is handed the exact
 * same line, which is what makes the comparison fair — and asks each model the
 * question where cellists actually disagree: *where on the fingerboard do you
 * play this?* Every answer is checked against the fingering model's legal
 * states, invalid or missing answers fall back to the solver, and the outcome
 * is measured.
 *
 * No network and no filesystem here, so all of it is testable.
 */

import {
  CelloFinger,
  CelloPosition,
  CelloString,
  OPEN_STRING_MIDI,
  POSITION_BASE_SEMITONES,
  POSITION_ORDER,
  STRING_ORDER,
  midiToPitchName,
} from "../../src/domain/cello";
import { candidateStates, CelloState, handSemitones, RawNoteEvent } from "../../src/domain/fingering";
import type { DifficultyTier } from "../../src/domain/schema";

// ─── Models ──────────────────────────────────────────────────────────────────

/** One entry of Ollama's `GET /api/tags`. Only the fields the benchmark reads. */
export interface OllamaTagModel {
  name: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
  capabilities?: string[];
}

export interface BenchmarkModel {
  name: string;
  slug: string;
  sizeBytes: number;
  parameterSize: string;
  quantization: string;
  family: string;
  /** The model can return separate reasoning (`think`). */
  thinking: boolean;
  contextLength: number | null;
  digest: string;
}

/** `gpt-oss:20b` → `gpt-oss-20b`: safe in a folder name, still recognisable. */
export function modelSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Picks the models to benchmark from `/api/tags`, smallest first.
 *
 * Embedding-only models cannot chat, so they are dropped. Smallest first
 * because the quick runs report back early: a broken prompt or an unreachable
 * host shows up in minutes rather than after the thirty-billion-parameter
 * model has spent an hour on it.
 */
export function selectBenchmarkModels(
  models: readonly OllamaTagModel[],
  filter: { only?: readonly string[]; skip?: readonly string[] } = {},
): BenchmarkModel[] {
  const wanted = (name: string) => {
    const keys = [name, modelSlug(name)];
    if (filter.only && filter.only.length > 0
      && !filter.only.some((entry) => keys.includes(entry) || keys.includes(modelSlug(entry)))) {
      return false;
    }
    return !filter.skip?.some((entry) => keys.includes(entry) || keys.includes(modelSlug(entry)));
  };

  return models
    .filter((model) => {
      const capabilities = model.capabilities;
      if (capabilities) return capabilities.includes("completion");
      // Older servers do not report capabilities; an embedding model is the
      // one kind that cannot answer, and it says so in its name.
      return !/embed/i.test(model.name);
    })
    .filter((model) => wanted(model.name))
    .map((model) => ({
      name: model.name,
      slug: modelSlug(model.name),
      sizeBytes: model.size ?? 0,
      parameterSize: model.details?.parameter_size ?? "?",
      quantization: model.details?.quantization_level ?? "?",
      family: model.details?.family ?? "?",
      thinking: model.capabilities?.includes("thinking") ?? false,
      contextLength: model.details?.context_length ?? null,
      digest: model.digest ?? "",
    }))
    .sort((a, b) => a.sizeBytes - b.sizeBytes || a.name.localeCompare(b.name));
}

// ─── Output folders ──────────────────────────────────────────────────────────

/**
 * Between the song id and the model slug. Song ids are slugs, which collapse
 * every run of punctuation to a single dash, so a double dash can never occur
 * inside one — the split is unambiguous.
 */
export const VARIANT_SEPARATOR = "--";

/** `coheed-and-cambria-welcome-home--gpt-oss-20b`. */
export function variantFolderName(songId: string, modelName: string): string {
  return `${songId}${VARIANT_SEPARATOR}${modelSlug(modelName)}`;
}

export function parseVariantFolder(name: string): { songId: string; modelSlug: string } | null {
  const at = name.indexOf(VARIANT_SEPARATOR);
  if (at <= 0) return null;
  const songId = name.slice(0, at);
  const slug = name.slice(at + VARIANT_SEPARATOR.length);
  if (!slug || slug.includes(VARIANT_SEPARATOR)) return null;
  return { songId, modelSlug: slug };
}

// ─── The position doctrine ───────────────────────────────────────────────────

/** Furthest position each tier may use. */
export const TIER_POSITION_CEILING: Record<DifficultyTier, CelloPosition> = {
  Beginner: "1st",
  Intermediate: "4th",
  Advanced: "Thumb",
  Expert: "Thumb",
};

const NECK_FOR_DOCTRINE: CelloPosition[] = ["Half", "1st", "2nd", "3rd", "4th"];

/**
 * Where finger 1 sits in each neck position, in semitones ("frets") above the
 * open string — read from the fingering model, so the prompt cannot disagree
 * with the app about what "4th position" means.
 */
function positionMap(): string {
  return NECK_FOR_DOCTRINE
    .map((position) => {
      const base = POSITION_BASE_SEMITONES[position];
      return `${position} position: finger 1 at fret ${base}, finger 4 at fret ${base + 3}`;
    })
    .join("; ");
}

/**
 * The guidance this benchmark exists to test: first position is a home, not a
 * cage. Appended to the arranger's system prompt and used again, verbatim, for
 * the fingering questions.
 */
export const POSITION_FREEDOM_DOCTRINE = `POSITION FREEDOM (DO NOT BE AFRAID TO LEAVE FIRST POSITION):
- First position is a home, not a cage. Above Beginner, 2nd, 3rd and 4th positions are ordinary, comfortable places for the left hand. Use them whenever they make a passage easier or more musical to play.
- "Fret" here means semitones above the open string. ${positionMap()}. An open string is fret 0.
- Prefer staying on ONE string over crossing strings when a figure moves by step or small leaps. An open string (fret 0) followed by fret 6 or 7 on that SAME string is often easier than hopping to the next string and back: open D3, then A3 as fret 7 on the D string (4th position, finger 1), keeps the bow and the tone colour on one string where D3 → open A3 would cross.
- Weigh the two costs honestly for each figure. A string crossing costs bow travel and a change of tone colour; a shift costs left-hand travel and time. Choose whichever is smaller for the passage, and place the hand so ONE frame covers a whole figure before moving.
- Open strings stay welcome as resonant anchors and as free time to shift, but do not force an open string into the middle of a same-string riff.
- Tier limits: Beginner stays in first position; Intermediate may use Half through 4th position; Advanced and Expert may use every neck position, and thumb position above D4.`;

// ─── Fingering options ───────────────────────────────────────────────────────

export interface FingeringOption {
  /** `D7-1`: string, fret, finger. What the model answers with. */
  code: string;
  state: CelloState;
  /** Frets above the open string. */
  fret: number;
  label: string;
}

function optionCode(string: CelloString, fret: number, finger: CelloFinger): string {
  return `${string}${fret}-${finger}`;
}

/** Plain states beat extensions, and the lower position wins a tie. */
function preference(state: CelloState): number {
  const extension = state.extension === "none" ? 0 : state.extension === "forward" ? 100 : 200;
  return extension + POSITION_ORDER[state.position] * 10 + (state.baseSemitones ?? 0) / 100;
}

function optionLabel(state: CelloState, fret: number): string {
  if (state.finger === "0") return `open ${state.string}`;
  const extension = state.extension === "none" ? "" : `, ${state.extension} extension`;
  const where = state.position === "Thumb" ? "thumb position" : `${state.position} position`;
  return `${state.string} string fret ${fret}, finger ${state.finger}, ${where}${extension}`;
}

/**
 * Every distinct place a tier may play `midi`, as the model sees them.
 *
 * The fingering model enumerates states down to the hand anchor, which gives an
 * open string a dozen entries and a thumb note several. A player chooses a
 * string, a fret and a finger; the rest follows. So options are keyed on that
 * triple, keeping the most natural state behind each.
 */
export function fingeringOptions(midi: number, tier: DifficultyTier): FingeringOption[] {
  const ceiling = POSITION_ORDER[TIER_POSITION_CEILING[tier]];
  const byCode = new Map<string, FingeringOption>();

  for (const state of candidateStates(midi)) {
    if (POSITION_ORDER[state.position] > ceiling) continue;
    const fret = midi - OPEN_STRING_MIDI[state.string];
    const code = optionCode(state.string, fret, state.finger);
    const existing = byCode.get(code);
    if (existing && preference(existing.state) <= preference(state)) continue;
    byCode.set(code, { code, state, fret, label: optionLabel(state, fret) });
  }

  return [...byCode.values()].sort((a, b) =>
    STRING_ORDER.indexOf(b.state.string) - STRING_ORDER.indexOf(a.state.string) || a.fret - b.fret);
}

// ─── Chunking ────────────────────────────────────────────────────────────────

export interface NoteChunk {
  /** Inclusive. */
  from: number;
  /** Exclusive. */
  to: number;
}

/**
 * Splits a line into phrase-sized questions.
 *
 * Bar-aligned where possible, because fingering is decided by the figure and a
 * question cut mid-figure invites a shift nobody would make. Bounded in notes as
 * well as bars, so a dense riff does not blow a small model's attention.
 */
export function chunkByBars(
  notes: readonly RawNoteEvent[], barMs: number, maxNotes = 48, maxBars = 8,
): NoteChunk[] {
  const chunks: NoteChunk[] = [];
  const barOf = (index: number) => Math.floor((notes[index]?.startTimeMs ?? 0) / Math.max(1, barMs));
  let from = 0;
  while (from < notes.length) {
    const firstBar = barOf(from);
    let to = from + 1;
    while (to < notes.length && to - from < maxNotes && barOf(to) < firstBar + maxBars) to++;
    // A note cap that lands mid-bar backs off to the bar line, if that leaves a
    // real chunk behind.
    if (to < notes.length && to - from >= maxNotes && barOf(to) === barOf(to - 1)) {
      let back = to;
      while (back > from + 1 && barOf(back) === barOf(back - 1)) back--;
      if (back - from >= Math.ceil(maxNotes / 2)) to = back;
    }
    chunks.push({ from, to });
    from = to;
  }
  return chunks;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

export function buildFingeringSystemPrompt(): string {
  return `You are a concert cellist and cello teacher choosing left-hand fingerings for a practice app.
Standard tuning: C2 (MIDI 36), G2 (43), D3 (50), A3 (57). You choose WHERE each note is played; the notes themselves are fixed and must not change.

${POSITION_FREEDOM_DOCTRINE}

HOW TO ANSWER:
- Every note comes with its legal options, written as codes like "D7-1" (D string, fret 7, finger 1). "A0-0" is the open A string.
- Choose exactly one listed code for EVERY note index you are given. Never invent a code that is not listed for that note.
- Think in figures: look at the next several notes before choosing, keep one hand frame for a whole figure, and prefer the same string over crossings when that is easier.
- Output ONLY JSON: {"fingerings":[{"i":<note index>,"o":"<code>"}, ...], "reason":"<one or two sentences>"}`;
}

export interface FingeringPromptNote {
  index: number;
  midiNumber: number;
  startTimeMs: number;
  durationMs: number;
}

export function buildFingeringUserPrompt(input: {
  songTitle: string;
  tier: DifficultyTier;
  key: string;
  bpm: number;
  chunkNumber: number;
  chunkCount: number;
  /** Code chosen for the note just before this chunk, so phrases join up. */
  previousCode: string | null;
  directive: string;
  notes: readonly FingeringPromptNote[];
}): string {
  const lines = input.notes.map((note) => {
    const options = fingeringOptions(note.midiNumber, input.tier)
      .map((option) => `${option.code} (${option.label})`)
      .join(" | ");
    return `${note.index} | t=${(note.startTimeMs / 1000).toFixed(2)}s | ${(note.durationMs / 1000).toFixed(2)}s | ${midiToPitchName(note.midiNumber)} | ${options}`;
  });

  return `Song: ${input.songTitle} — ${input.key}, ${input.bpm} BPM
Tier: ${input.tier} (position limit: ${TIER_POSITION_CEILING[input.tier]})
Arrangement directive: ${input.directive || "—"}
Phrase ${input.chunkNumber} of ${input.chunkCount}. ${input.previousCode ? `The previous note was played as ${input.previousCode}.` : "This is the first phrase."}

Notes (index | onset | length | pitch | legal options):
${lines.join("\n")}

Return one code for every index from ${input.notes[0]?.index ?? 0} to ${input.notes[input.notes.length - 1]?.index ?? 0}.`;
}

/** JSON schema handed to Ollama's structured output (`format`). */
export const FINGERING_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    fingerings: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, o: { type: "string" } },
        required: ["i", "o"],
      },
    },
    reason: { type: "string" },
  },
  required: ["fingerings"],
} as const;

// ─── Reading answers ─────────────────────────────────────────────────────────

/**
 * The first JSON object in a model's reply.
 *
 * Models wrap JSON in `<think>` blocks, code fences and chatter, and some add
 * a sentence after it. This strips the reasoning, then scans for the first
 * balanced object, respecting strings — so a brace inside a "reason" does not
 * end it early.
 */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the response");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("unterminated JSON object in the response");
}

export interface FingeringAnswer {
  i: number;
  o: string;
}

/** Tolerant reader: `{fingerings:[...]}` or a bare array; `i`/`index`, `o`/`option`/`code`. */
export function parseFingeringAnswers(value: unknown): FingeringAnswer[] {
  const list = Array.isArray(value)
    ? value
    : (value as { fingerings?: unknown } | null)?.fingerings;
  if (!Array.isArray(list)) return [];
  const out: FingeringAnswer[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const index = Number(record.i ?? record.index);
    const code = record.o ?? record.option ?? record.code;
    if (Number.isInteger(index) && typeof code === "string") {
      out.push({ i: index, o: code.trim().toUpperCase().replace(/^([CGDA])(\d+)-(T)$/, "$1$2-T") });
    }
  }
  return out;
}

export interface ChunkOutcome {
  /** Notes the model placed on a legal option. */
  accepted: number;
  /** Notes answered with a code that is not legal for that pitch and tier. */
  invalid: number;
  /** Notes the model did not answer at all. */
  missing: number;
}

/**
 * Writes the model's choices for `chunk` into `into`, falling back to the
 * solver's state wherever the answer is missing or illegal.
 */
export function applyFingeringAnswers(
  notes: readonly RawNoteEvent[],
  chunk: NoteChunk,
  tier: DifficultyTier,
  answers: readonly FingeringAnswer[],
  fallback: readonly CelloState[],
  into: CelloState[],
): ChunkOutcome {
  const byIndex = new Map<number, string>();
  for (const answer of answers) if (!byIndex.has(answer.i)) byIndex.set(answer.i, answer.o);

  const outcome: ChunkOutcome = { accepted: 0, invalid: 0, missing: 0 };
  for (let index = chunk.from; index < chunk.to; index++) {
    const note = notes[index];
    const solver = fallback[index];
    if (!note || !solver) continue;
    const code = byIndex.get(index);
    const option = code === undefined
      ? undefined
      : fingeringOptions(note.midiNumber, tier).find((candidate) => candidate.code === code.toUpperCase());
    if (option) {
      into[index] = option.state;
      outcome.accepted++;
    } else {
      into[index] = solver;
      if (code === undefined) outcome.missing++;
      else outcome.invalid++;
    }
  }
  return outcome;
}

// ─── Measuring a fingering ───────────────────────────────────────────────────

export interface FingeringStats {
  notes: number;
  openStrings: number;
  /** Consecutive notes on different strings. */
  stringCrossings: number;
  /** Changes of hand anchor between stopped notes. */
  shifts: number;
  /** Stopped notes outside Half/1st position. */
  abovefirstPosition: number;
  thumbPosition: number;
  /**
   * Stopped notes that could have been an open string. The behaviour the
   * position doctrine asks for when it keeps a figure on one string.
   */
  stoppedWhereOpenExisted: number;
  positions: Record<string, number>;
}

export function fingeringStats(
  notes: readonly RawNoteEvent[], states: readonly CelloState[],
): FingeringStats {
  const stats: FingeringStats = {
    notes: notes.length,
    openStrings: 0,
    stringCrossings: 0,
    shifts: 0,
    abovefirstPosition: 0,
    thumbPosition: 0,
    stoppedWhereOpenExisted: 0,
    positions: {},
  };
  let previous: CelloState | null = null;
  let anchor: number | null = null;

  notes.forEach((note, index) => {
    const state = states[index];
    if (!state) return;
    const open = state.finger === "0";
    const label = open ? "open" : state.position;
    stats.positions[label] = (stats.positions[label] ?? 0) + 1;

    if (previous && previous.string !== state.string) stats.stringCrossings++;
    if (open) {
      stats.openStrings++;
    } else {
      const here = handSemitones(state);
      if (anchor !== null && here !== anchor) stats.shifts++;
      anchor = here;
      if (state.position === "Thumb") stats.thumbPosition++;
      if (state.position !== "Half" && state.position !== "1st") stats.abovefirstPosition++;
      if (STRING_ORDER.some((string) => OPEN_STRING_MIDI[string] === note.midiNumber)) {
        stats.stoppedWhereOpenExisted++;
      }
    }
    previous = state;
  });

  return stats;
}

// ─── Records and the summary ─────────────────────────────────────────────────

export interface RequestMetrics {
  requests: number;
  failedRequests: number;
  /** Wall-clock seconds spent waiting on the server. */
  seconds: number;
  promptTokens: number;
  evalTokens: number;
  /** Server-reported generation time, for tokens per second. */
  evalSeconds: number;
}

export function emptyMetrics(): RequestMetrics {
  return { requests: 0, failedRequests: 0, seconds: 0, promptTokens: 0, evalTokens: 0, evalSeconds: 0 };
}

export function addMetrics(into: RequestMetrics, more: RequestMetrics): RequestMetrics {
  into.requests += more.requests;
  into.failedRequests += more.failedRequests;
  into.seconds += more.seconds;
  into.promptTokens += more.promptTokens;
  into.evalTokens += more.evalTokens;
  into.evalSeconds += more.evalSeconds;
  return into;
}

export interface TierBenchmark {
  tier: DifficultyTier;
  notes: number;
  /** False for Beginner, which stays on the fixed first-position mapping. */
  askedModel: boolean;
  chunks: number;
  accepted: number;
  invalid: number;
  missing: number;
  request: RequestMetrics;
  model: FingeringStats;
  solver: FingeringStats;
  validationProblems: number;
  flaggedUnidiomatic: number;
}

export interface BenchmarkRecord {
  version: 1;
  status: "completed" | "failed";
  model: string;
  modelSlug: string;
  parameterSize: string;
  quantization: string;
  family: string;
  thinking: boolean;
  songId: string;
  songFile: string;
  folder: string;
  host: string;
  startedAt: string;
  finishedAt: string;
  seconds: number;
  loadSeconds: number | null;
  key: string;
  bpm: number;
  meter: [number, number];
  melodyTrackIndex: number;
  bassTrackIndex: number;
  /** The cello-scoring skill files sent, complete, with every request. */
  skillFiles?: string[];
  skillChars?: number;
  blueprint: { ok: boolean; attempts: number; error: string | null; request: RequestMetrics };
  tiers: TierBenchmark[];
  error: string | null;
}

/** Totals over the tiers the model was asked about. */
export function aggregateRecord(record: BenchmarkRecord) {
  const asked = record.tiers.filter((tier) => tier.askedModel);
  const sum = (pick: (tier: TierBenchmark) => number) => asked.reduce((total, tier) => total + pick(tier), 0);
  const request = asked.reduce((total, tier) => addMetrics(total, tier.request), addMetrics(emptyMetrics(), record.blueprint.request));
  const notes = sum((tier) => tier.notes);
  return {
    notes,
    accepted: sum((tier) => tier.accepted),
    placedShare: notes === 0 ? 0 : sum((tier) => tier.accepted) / notes,
    crossings: [sum((tier) => tier.model.stringCrossings), sum((tier) => tier.solver.stringCrossings)] as const,
    shifts: [sum((tier) => tier.model.shifts), sum((tier) => tier.solver.shifts)] as const,
    aboveFirst: [sum((tier) => tier.model.abovefirstPosition), sum((tier) => tier.solver.abovefirstPosition)] as const,
    stoppedOverOpen: [sum((tier) => tier.model.stoppedWhereOpenExisted), sum((tier) => tier.solver.stoppedWhereOpenExisted)] as const,
    tokensPerSecond: request.evalSeconds > 0 ? request.evalTokens / request.evalSeconds : 0,
    failedRequests: request.failedRequests,
  };
}

/**
 * The comparison table, one row per song per model.
 *
 * Pairs read "model / solver": the same notes, fingered by the model and by the
 * app's own solver, so a column shows what the model changed rather than a
 * number without a reference.
 */
export function summaryMarkdown(records: readonly BenchmarkRecord[], generatedAt: string): string {
  const rows = [...records].sort((a, b) =>
    a.songId.localeCompare(b.songId)
    || aggregateRecord(b).placedShare - aggregateRecord(a).placedShare
    || a.model.localeCompare(b.model));

  const lines = [
    "# Ollama cello benchmark",
    "",
    `Generated ${generatedAt}. Every model received the same notes; the columns compare where each one put them.`,
    'Pairs read **model / solver** — the app\'s own fingering of the same notes. "Placed" is the share of notes the model',
    "answered with a legal fingering; the rest fell back to the solver. Open the `[model]` rows in the app to play them.",
    "",
    "| Song | Model | Size | Status | Minutes | Tok/s | Blueprint | Placed | Crossings | Shifts | Above 1st pos | Stopped instead of open | Failed requests |",
    "| --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const record of rows) {
    if (record.status !== "completed") {
      lines.push(`| ${record.songId} | ${record.model} | ${record.parameterSize} | failed: ${(record.error ?? "").replace(/\|/g, "/").slice(0, 80)} | ${(record.seconds / 60).toFixed(1)} | | | | | | | | |`);
      continue;
    }
    const total = aggregateRecord(record);
    lines.push([
      record.songId,
      record.model,
      `${record.parameterSize} ${record.quantization}`,
      "completed",
      (record.seconds / 60).toFixed(1),
      total.tokensPerSecond.toFixed(1),
      record.blueprint.ok ? "ok" : "fallback",
      `${Math.round(total.placedShare * 100)}%`,
      `${total.crossings[0]} / ${total.crossings[1]}`,
      `${total.shifts[0]} / ${total.shifts[1]}`,
      `${total.aboveFirst[0]} / ${total.aboveFirst[1]}`,
      `${total.stoppedOverOpen[0]} / ${total.stoppedOverOpen[1]}`,
      String(total.failedRequests),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return `${lines.join("\n")}\n`;
}
