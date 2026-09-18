/**
 * Ollama cello model benchmark (tools/ollama-benchmark.ts)
 *
 * Runs every chat-capable model on an Ollama server over the same four songs —
 * Coheed and Cambria's "Welcome Home", 30 Seconds to Mars' "The Kill",
 * System of a Down's "Aerials" and Tom Jobim's "Chega de Saudade" — and writes
 * one arrangement per song per model, so their choices can be played and
 * compared in the app.
 *
 * What is compared. The library arranger asks a model for a blueprint and then
 * generates notes and fingerings deterministically, so its output does not
 * change with the model. Here the notes stay deterministic — every model gets
 * the exact same line per tier, which is what makes the comparison fair — and
 * each model decides *where on the fingerboard* to play them, phrase by phrase,
 * under a prompt that tells it not to be afraid of 2nd–4th position or of
 * staying on one string. Every answer is checked against the fingering model;
 * illegal or missing answers fall back to the app's solver and are counted.
 *
 * Output, per song per model:
 *   _MIDIS/arranged/<song-id>--<model-slug>/
 *     expert.json advanced.json intermediate.json beginner.json
 *     thinking_log.md fretboard_audit.json benchmark.json
 * and a running comparison in _MIDIS/benchmarks/summary.md. When the run ends
 * the full library is rebuilt, so each result appears in the app as a
 * "<title> [<model>]" row whose arrangement levels are that model's tiers.
 *
 * Strictly sequential: one model loaded at a time, one request at a time. Each
 * model is loaded before its songs and unloaded before the next model starts.
 * Completed song/model pairs are skipped on the next run unless --force.
 *
 * Usage:
 *   yarn ollama:benchmark
 *   yarn ollama:benchmark --dry-run
 *   yarn ollama:benchmark --models gpt-oss:20b,gemma4:12b
 *   yarn ollama:benchmark --skip-models deepseek-coder:6.7b --force
 *   yarn ollama:benchmark --tiers Intermediate --chunk-notes 32
 *
 * Options:
 *   --host <url>               Ollama server (default http://100.124.192.6:11434)
 *   --models <a,b>             Only these models (name or slug)
 *   --skip-models <a,b>        Skip these models
 *   --file <path>              A MIDI file to arrange; repeatable (default: the four benchmark songs)
 *   --tiers <a,b>              Tiers the model fingers (default Expert,Advanced,Intermediate)
 *   --chunk-notes <n>          Most notes per fingering question (default 40)
 *   --num-ctx <n>              Context window per request (default 32768)
 *   --request-timeout-min <n>  Give up on one request after this long (default 45)
 *   --force                    Re-run pairs that already completed
 *   --no-library               Do not rebuild the app library at the end
 *   --dry-run                  List models and the work, without generating anything
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import { OPEN_STRING_MIDI } from "../src/domain/cello";
import {
  ARRANGEMENT_WEIGHTS,
  CelloState,
  firstPositionFingering,
  RawNoteEvent,
  solveFingering,
} from "../src/domain/fingering";
import { parseMidi } from "../src/domain/midi";
import {
  DifficultyTier,
  measureDurationMs,
  validateScore,
} from "../src/domain/schema";
import {
  AmbiguousNoteAudit,
  ArrangementBlueprint,
  auditFretboardNotes,
  buildMasterExpertNotes,
  buildSystemPrompt,
  buildUserPrompt,
  deriveAdvancedNotes,
  deriveBeginnerNotes,
  deriveIntermediateNotes,
  extractMidiFeatures,
  synthesizeScore,
} from "./ollama/arrangerCore";
import {
  addMetrics,
  applyFingeringAnswers,
  BenchmarkModel,
  BenchmarkRecord,
  buildFingeringSystemPrompt,
  buildFingeringUserPrompt,
  chunkByBars,
  emptyMetrics,
  extractJson,
  FINGERING_RESPONSE_SCHEMA,
  fingeringStats,
  OllamaTagModel,
  parseFingeringAnswers,
  parseVariantFolder,
  RequestMetrics,
  selectBenchmarkModels,
  summaryMarkdown,
  TierBenchmark,
  variantFolderName,
} from "./ollama/benchmarkCore";
import {
  CelloScoringSkill,
  estimateTokens,
  loadCelloScoringSkill,
  MIN_RESPONSE_TOKENS,
  planContext,
  skillMessages,
  withCelloScoringSkill,
} from "./ollama/celloScoringSkill";

// ─── Options ─────────────────────────────────────────────────────────────────

const DEFAULT_HOST = "http://100.124.192.6:11434";
const DEFAULT_FILES = [
  "_MIDIS/downloaded/Coheed and Cambria - Welcome Home.mid",
  "_MIDIS/downloaded/Tom Jobim - Chega de Saudade.mid",
  "_MIDIS/downloaded/30 Seconds to Mars - The Kill.mid",
  "_MIDIS/downloaded/System of a Down - Aerials.mid",
];
const ALL_TIERS: DifficultyTier[] = [
  "Expert",
  "Advanced",
  "Intermediate",
  "Beginner",
];
const DEFAULT_TIERS: DifficultyTier[] = ["Expert", "Advanced", "Intermediate"];
/** Long enough to cover a whole song's requests without the model unloading between them. */
const KEEP_ALIVE = "30m";

interface BenchmarkOptions {
  host: string;
  models: string[];
  skipModels: string[];
  files: string[];
  outDir: string;
  reportDir: string;
  tiers: DifficultyTier[];
  chunkNotes: number;
  numCtx: number;
  requestTimeoutMs: number;
  force: boolean;
  dryRun: boolean;
  rebuildLibrary: boolean;
}

function parseArgs(argv: string[]): BenchmarkOptions {
  const value = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : null;
  };
  const list = (name: string): string[] =>
    (value(name) ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const positive = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new Error(`--${name} must be a positive number, got "${raw}"`);
    return parsed;
  };

  const files: string[] = [];
  argv.forEach((arg, index) => {
    if (arg === "--file" && argv[index + 1]) files.push(argv[index + 1]);
  });

  const tierNames = list("tiers");
  const tiers =
    tierNames.length === 0
      ? DEFAULT_TIERS
      : tierNames.map((name) => {
          const tier = ALL_TIERS.find(
            (candidate) => candidate.toLowerCase() === name.toLowerCase(),
          );
          if (!tier)
            throw new Error(
              `Unknown tier "${name}". Use ${ALL_TIERS.join(", ")}.`,
            );
          return tier;
        });

  return {
    host: (value("host") ?? DEFAULT_HOST).replace(/\/+$/, ""),
    models: list("models"),
    skipModels: list("skip-models"),
    files: files.length > 0 ? files : DEFAULT_FILES,
    outDir: value("out-dir") ?? "_MIDIS/arranged",
    reportDir: value("report-dir") ?? "_MIDIS/benchmarks",
    tiers,
    chunkNotes: Math.round(positive("chunk-notes", 40)),
    numCtx: Math.round(positive("num-ctx", 32768)),
    requestTimeoutMs: positive("request-timeout-min", 45) * 60_000,
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
    rebuildLibrary: !argv.includes("--no-library"),
  };
}

// ─── Ollama client ───────────────────────────────────────────────────────────

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

/** The model's window cannot hold the complete skill plus the request. Never retried, never trimmed. */
class ContextError extends Error {}

/** Reply budget beyond the prompt: thinking models spend thousands of tokens before answering. */
function replyReserve(model: BenchmarkModel): number {
  return model.thinking ? 12_000 : 4_096;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatReply {
  content: string;
  thinking: string;
  metrics: RequestMetrics;
}

async function fetchModels(host: string): Promise<OllamaTagModel[]> {
  const res = await fetch(`${host}/api/tags`);
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const json = (await res.json()) as { models?: OllamaTagModel[] };
  return json.models ?? [];
}

/**
 * One chat request, streamed.
 *
 * Streaming is not for show. Node's `fetch` gives up on a response whose
 * headers take more than five minutes, and a large thinking model can easily
 * think longer than that before a non-streamed reply begins. A stream starts
 * at once and keeps the connection demonstrably alive, and it lets the run
 * print progress so a long silence is not mistaken for a hang.
 */
async function chat(
  host: string,
  model: BenchmarkModel,
  messages: ChatMessage[],
  options: {
    format?: unknown;
    numCtx: number;
    timeoutMs: number;
    label: string;
    skill: CelloScoringSkill;
  },
): Promise<ChatReply> {
  // The complete cello-scoring skill goes into the system message here, in the
  // one function that posts to /api/chat, so no request can leave without it.
  const sent = skillMessages(messages, options.skill);
  const context = planContext(
    sent.reduce((total, message) => total + message.content.length, 0),
    {
      requested: options.numCtx,
      modelMax: model.contextLength,
      reserve: replyReserve(model),
    },
  );
  if (!context.fits) {
    throw new ContextError(
      `${options.label}: ~${context.promptTokens} prompt tokens with the complete cello-scoring skill do not fit ` +
        `${model.name}'s ${model.contextLength}-token window with room to answer.`,
    );
  }

  const attempt = async (
    useFormat: boolean,
    useThink: boolean,
  ): Promise<ChatReply> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const started = Date.now();
    try {
      const res = await fetch(`${host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: model.name,
          messages: sent,
          stream: true,
          keep_alive: KEEP_ALIVE,
          options: { temperature: 0.2, num_ctx: context.numCtx },
          ...(useFormat && options.format !== undefined
            ? { format: options.format }
            : {}),
          ...(useThink ? { think: true } : {}),
        }),
      });
      if (!res.ok || !res.body)
        throw new HttpError(res.status, await res.text().catch(() => ""));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let thinking = "";
      let pieces = 0;
      let final: Record<string, unknown> | null = null;
      let lastReport = Date.now();

      const consume = (line: string) => {
        if (!line.trim()) return;
        const chunk = JSON.parse(line) as {
          error?: string;
          done?: boolean;
          message?: { content?: string; thinking?: string };
        };
        if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
        content += chunk.message?.content ?? "";
        thinking += chunk.message?.thinking ?? "";
        pieces++;
        if (chunk.done) final = chunk as Record<string, unknown>;
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
        }
        if (Date.now() - lastReport > 20_000) {
          console.log(
            `      … ${options.label}: still generating (${pieces} chunks, ${Math.round((Date.now() - started) / 1000)}s)`,
          );
          lastReport = Date.now();
        }
      }
      consume(buffer + decoder.decode());

      const stats: Record<string, unknown> = final ?? {};
      const count = (key: string) =>
        typeof stats[key] === "number" ? (stats[key] as number) : 0;
      return {
        content,
        thinking,
        metrics: {
          requests: 1,
          failedRequests: 0,
          seconds: (Date.now() - started) / 1000,
          promptTokens: count("prompt_eval_count"),
          evalTokens: count("eval_count"),
          evalSeconds: count("eval_duration") / 1e9,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt(true, model.thinking);
  } catch (err) {
    // Some models refuse `think` or structured `format`; one plain retry.
    if (err instanceof HttpError && err.status === 400) {
      console.warn(
        `      ${options.label}: server refused the request (${err.message.slice(0, 160)}); retrying without think/format.`,
      );
      return attempt(false, false);
    }
    throw err;
  }
}

/** Loads the model before its first real request, so load time is measured apart from thinking time. */
async function loadModel(
  host: string,
  model: BenchmarkModel,
): Promise<number | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.name,
          prompt: "",
          keep_alive: KEEP_ALIVE,
          stream: false,
        }),
      });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      const json = (await res.json()) as { load_duration?: number };
      return typeof json.load_duration === "number"
        ? json.load_duration / 1e9
        : (Date.now() - started) / 1000;
    } catch (err) {
      // A very large model can outlast the client's header timeout while the
      // server keeps loading it; asking again picks up where it got to.
      console.warn(
        `  Load attempt ${attempt}/3 for ${model.name} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  return null;
}

/** Frees the server's memory before the next model loads. */
async function unloadModel(host: string, model: BenchmarkModel): Promise<void> {
  try {
    await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.name, keep_alive: 0 }),
    });
  } catch {
    // The run continues either way; the server evicts idle models itself.
  }
}

// ─── One song, one model ─────────────────────────────────────────────────────

type MidiFeatures = ReturnType<typeof extractMidiFeatures>;

function songIdFor(filePath: string): string {
  return basename(filePath)
    .replace(/\.midi?$/i, "")
    .replace(/[—–]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function enforceInvariants(
  blueprint: ArrangementBlueprint,
  features: MidiFeatures,
): ArrangementBlueprint {
  // The model advises; it does not get to move the song. Key, tempo and meter
  // come from the file, or the arrangement would drift off its own backing.
  return {
    ...blueprint,
    songTitle:
      typeof blueprint.songTitle === "string" && blueprint.songTitle
        ? blueprint.songTitle
        : features.title,
    sourceKey: features.detectedKey,
    recommendedKey: features.detectedKey,
    keyTranspositionSemitones: 0,
    tempoBpm: features.bpm,
    meter: features.timeSignature,
    analysis: {
      harmonicForm: blueprint.analysis?.harmonicForm ?? "",
      primaryBassTrackIndex: features.bassTrackIndex,
      primaryMelodyTrackIndex: features.melodyTrackIndex,
      inactiveBassBarsCount: features.inactiveBassBarsCount,
      chordProgressionSummary: blueprint.analysis?.chordProgressionSummary,
    },
  };
}

function fallbackBlueprint(features: MidiFeatures): ArrangementBlueprint {
  return enforceInvariants(
    {
      songTitle: features.title,
      sourceKey: features.detectedKey,
      recommendedKey: features.detectedKey,
      keyTranspositionSemitones: 0,
      tempoBpm: features.bpm,
      meter: features.timeSignature,
      analysis: {
        harmonicForm: "No valid blueprint was returned by the model.",
        primaryBassTrackIndex: features.bassTrackIndex,
        primaryMelodyTrackIndex: features.melodyTrackIndex,
        inactiveBassBarsCount: features.inactiveBassBarsCount,
      },
    },
    features,
  );
}

async function requestBlueprint(
  features: MidiFeatures,
  model: BenchmarkModel,
  options: BenchmarkOptions,
  skill: CelloScoringSkill,
) {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ positionFreedom: true }) },
    {
      role: "user",
      content: buildUserPrompt(features, { positionFreedom: true }),
    },
  ];
  const request = emptyMetrics();
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const turn =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "user" as const,
              content:
                "Your previous reply was not a valid JSON ArrangementBlueprint. Reply again with ONLY that JSON object.",
            },
          ];
    try {
      const reply = await chat(options.host, model, turn, {
        numCtx: options.numCtx,
        timeoutMs: options.requestTimeoutMs,
        label: "blueprint",
        skill,
      });
      addMetrics(request, reply.metrics);
      const thinking =
        reply.thinking ||
        (reply.content.match(/<think>([\s\S]*?)<\/think>/i)?.[1] ?? "").trim();
      const parsed = extractJson(reply.content);
      if (!parsed || typeof parsed !== "object")
        throw new Error("the reply was not a JSON object");
      return {
        blueprint: enforceInvariants(parsed as ArrangementBlueprint, features),
        thinking,
        ok: true,
        attempts: attempt,
        error: null,
        request,
      };
    } catch (err) {
      request.failedRequests++;
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `    Blueprint attempt ${attempt}/2 failed: ${lastError.slice(0, 200)}`,
      );
    }
  }

  return {
    blueprint: fallbackBlueprint(features),
    thinking: "",
    ok: false,
    attempts: 2,
    error: lastError,
    request,
  };
}

function codeFor(
  state: CelloState | undefined,
  note: RawNoteEvent | undefined,
): string | null {
  if (!state || !note) return null;
  return `${state.string}${note.midiNumber - OPEN_STRING_MIDI[state.string]}-${state.finger}`;
}

async function benchmarkSong(
  filePath: string,
  model: BenchmarkModel,
  options: BenchmarkOptions,
  loadSeconds: number | null,
  skill: CelloScoringSkill,
): Promise<BenchmarkRecord> {
  const songId = songIdFor(filePath);
  const folder = variantFolderName(songId, model.name);
  const dir = join(options.outDir, folder);
  const started = Date.now();
  const startedAt = new Date().toISOString();

  const parsed = parseMidi(new Uint8Array(readFileSync(filePath)));
  if (parsed.notes.length === 0)
    throw new Error(`${basename(filePath)} has no notes`);
  const features = extractMidiFeatures(parsed, basename(filePath));

  const base: Omit<
    BenchmarkRecord,
    "status" | "finishedAt" | "seconds" | "blueprint" | "tiers" | "error"
  > = {
    version: 1,
    model: model.name,
    modelSlug: model.slug,
    parameterSize: model.parameterSize,
    quantization: model.quantization,
    family: model.family,
    thinking: model.thinking,
    songId,
    songFile: filePath,
    skillFiles: skill.files.map((file) => file.name),
    skillChars: skill.chars,
    folder,
    host: options.host,
    startedAt,
    loadSeconds,
    key: features.detectedKey,
    bpm: features.bpm,
    meter: features.timeSignature,
    melodyTrackIndex: features.melodyTrackIndex,
    bassTrackIndex: features.bassTrackIndex,
  };

  mkdirSync(dir, { recursive: true });

  // 1. Blueprint — the arranging plan, written with the position doctrine.
  console.log(
    `    [1/3] Blueprint (${features.totalBars} bars, key ${features.detectedKey}, ${features.bpm} BPM)…`,
  );
  const plan = await requestBlueprint(features, model, options, skill);
  const { blueprint } = plan;

  // 2. Notes — deterministic, identical for every model.
  const expert = buildMasterExpertNotes(features, blueprint);
  const advanced = deriveAdvancedNotes(expert);
  const intermediate = deriveIntermediateNotes(advanced);
  const beginner = deriveBeginnerNotes(intermediate, features, blueprint);
  const tierNotes: Record<DifficultyTier, RawNoteEvent[]> = {
    Expert: expert,
    Advanced: advanced,
    Intermediate: intermediate,
    Beginner: beginner,
  };
  const barMs = measureDurationMs(blueprint.meter, blueprint.tempoBpm);

  // 3. Fingering — the model's choices, phrase by phrase.
  const tiers: TierBenchmark[] = [];
  const audits: Record<string, AmbiguousNoteAudit[]> = {};
  const reasons: string[] = [];

  for (const tier of ALL_TIERS) {
    const events = tierNotes[tier];
    const solver: CelloState[] =
      tier === "Beginner"
        ? events.map((event) => firstPositionFingering(event.midiNumber))
        : solveFingering(events, ARRANGEMENT_WEIGHTS).states;
    const states = [...solver];
    const askModel =
      tier !== "Beginner" && options.tiers.includes(tier) && events.length > 0;
    const chunks = askModel
      ? chunkByBars(events, barMs, options.chunkNotes)
      : [];
    const request = emptyMetrics();
    let accepted = 0;
    let invalid = 0;
    let missing = 0;

    if (askModel)
      console.log(
        `    [2/3] ${tier}: ${events.length} notes in ${chunks.length} phrases…`,
      );
    const directive = String(
      blueprint.topDownTierDirectives?.[tier.toLowerCase() as "expert"] ?? "",
    ).slice(0, 600);

    for (let k = 0; k < chunks.length; k++) {
      const chunk = chunks[k];
      const prompt = buildFingeringUserPrompt({
        songTitle: blueprint.songTitle,
        tier,
        key: features.detectedKey,
        bpm: features.bpm,
        chunkNumber: k + 1,
        chunkCount: chunks.length,
        previousCode: codeFor(states[chunk.from - 1], events[chunk.from - 1]),
        directive,
        notes: events
          .slice(chunk.from, chunk.to)
          .map((note, offset) => ({ index: chunk.from + offset, ...note })),
      });

      let answered = false;
      for (let attempt = 1; attempt <= 2 && !answered; attempt++) {
        try {
          const reply = await chat(
            options.host,
            model,
            [
              { role: "system", content: buildFingeringSystemPrompt() },
              {
                role: "user",
                content:
                  attempt === 1
                    ? prompt
                    : `${prompt}\n\nReply with ONLY the JSON object.`,
              },
            ],
            {
              format: FINGERING_RESPONSE_SCHEMA,
              skill,
              numCtx: options.numCtx,
              timeoutMs: options.requestTimeoutMs,
              label: `${tier} phrase ${k + 1}/${chunks.length}`,
            },
          );
          addMetrics(request, reply.metrics);
          const json = extractJson(reply.content);
          const outcome = applyFingeringAnswers(
            events,
            chunk,
            tier,
            parseFingeringAnswers(json),
            solver,
            states,
          );
          accepted += outcome.accepted;
          invalid += outcome.invalid;
          missing += outcome.missing;
          const reason = (json as { reason?: unknown } | null)?.reason;
          if (typeof reason === "string" && reason.trim())
            reasons.push(`- **${tier}, phrase ${k + 1}:** ${reason.trim()}`);
          const rate =
            reply.metrics.evalSeconds > 0
              ? (reply.metrics.evalTokens / reply.metrics.evalSeconds).toFixed(
                  1,
                )
              : "?";
          console.log(
            `      phrase ${k + 1}/${chunks.length}: ${outcome.accepted} placed, ${outcome.invalid} illegal, ${outcome.missing} missing (${reply.metrics.seconds.toFixed(0)}s, ${rate} tok/s)`,
          );
          answered = true;
        } catch (err) {
          request.failedRequests++;
          console.warn(
            `      phrase ${k + 1}/${chunks.length} attempt ${attempt}/2 failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
          );
          if (err instanceof ContextError) break; // a retry would not fit either
        }
      }
      if (!answered) missing += chunk.to - chunk.from; // solver fingering stays in place
    }

    const tierAudits = auditFretboardNotes(events, states, tier);
    audits[tier] = tierAudits;
    const score = synthesizeScore(
      folder,
      blueprint,
      events,
      states,
      tier,
      model.name,
    );
    const problems = validateScore(score);
    if (problems.length > 0)
      console.warn(
        `    [WARN] ${tier} score has ${problems.length} validation problems`,
        problems.slice(0, 2),
      );
    writeFileSync(
      join(dir, `${tier.toLowerCase()}.json`),
      JSON.stringify(score),
    );

    tiers.push({
      tier,
      notes: events.length,
      askedModel: askModel,
      chunks: chunks.length,
      accepted,
      invalid,
      missing,
      request,
      model: fingeringStats(events, states),
      solver: fingeringStats(events, solver),
      validationProblems: problems.length,
      flaggedUnidiomatic: tierAudits.filter(
        (audit) => audit.verdict === "FLAGGED_UNIDIOMATIC",
      ).length,
    });
  }

  writeFileSync(join(dir, "fretboard_audit.json"), JSON.stringify(audits));
  writeFileSync(
    join(dir, "thinking_log.md"),
    `# ${blueprint.songTitle} — ${model.name}\n\n## Blueprint reasoning\n\n${plan.thinking || "_(no separate reasoning returned)_"}\n\n` +
      `## Blueprint\n\n\`\`\`json\n${JSON.stringify(blueprint, null, 2)}\n\`\`\`\n\n` +
      `## Fingering reasons\n\n${reasons.join("\n") || "_(none returned)_"}\n`,
  );

  console.log("    [3/3] Written.");
  const record: BenchmarkRecord = {
    ...base,
    status: "completed",
    finishedAt: new Date().toISOString(),
    seconds: (Date.now() - started) / 1000,
    blueprint: {
      ok: plan.ok,
      attempts: plan.attempts,
      error: plan.error,
      request: plan.request,
    },
    tiers,
    error: null,
  };
  writeFileSync(join(dir, "benchmark.json"), JSON.stringify(record, null, 2));
  return record;
}

// ─── Will the complete skill fit? ────────────────────────────────────────────

/** Phrase sizes tried, largest first, when a model's window is tight. */
const CHUNK_LADDER = [40, 32, 24, 16, 12, 8];

/** Either how to run a model, or why it is left out. */
type ModelPlan =
  | { kind: "run"; chunkNotes: number }
  | { kind: "skip"; reason: string };

interface RequestSizes {
  file: string;
  /** The blueprint request, which cannot be split. */
  blueprintTokens: number;
  /** The largest fingering request when a phrase holds at most `chunkNotes` notes. */
  fingeringTokens: (chunkNotes: number) => number;
}

/**
 * How big this song's requests are with the complete skill in front of them.
 *
 * Built from the same prompt builders the run uses, with the tier directive at
 * its 600-character cap, so an estimate is never smaller than the real request.
 */
function requestSizes(
  file: string,
  options: BenchmarkOptions,
  skill: CelloScoringSkill,
): RequestSizes {
  const features = extractMidiFeatures(
    parseMidi(new Uint8Array(readFileSync(file))),
    basename(file),
  );
  const blueprint = fallbackBlueprint(features);
  const expert = buildMasterExpertNotes(features, blueprint);
  const advanced = deriveAdvancedNotes(expert);
  const intermediate = deriveIntermediateNotes(advanced);
  const perTier: Partial<Record<DifficultyTier, RawNoteEvent[]>> = {
    Expert: expert,
    Advanced: advanced,
    Intermediate: intermediate,
  };
  const barMs = measureDurationMs(features.timeSignature, features.bpm);
  const fingeringSystem = withCelloScoringSkill(
    buildFingeringSystemPrompt(),
    skill,
  ).length;

  return {
    file,
    blueprintTokens: estimateTokens(
      withCelloScoringSkill(buildSystemPrompt({ positionFreedom: true }), skill)
        .length + buildUserPrompt(features, { positionFreedom: true }).length,
    ),
    fingeringTokens: (chunkNotes: number) => {
      let largest = 0;
      for (const tier of options.tiers) {
        const events = perTier[tier];
        if (!events) continue;
        for (const chunk of chunkByBars(events, barMs, chunkNotes)) {
          const user = buildFingeringUserPrompt({
            songTitle: features.title,
            tier,
            key: features.detectedKey,
            bpm: features.bpm,
            chunkNumber: 99,
            chunkCount: 99,
            previousCode: "A12-T",
            directive: "x".repeat(600),
            notes: events
              .slice(chunk.from, chunk.to)
              .map((note, offset) => ({ index: chunk.from + offset, ...note })),
          });
          largest = Math.max(
            largest,
            estimateTokens(fingeringSystem + user.length + 60),
          );
        }
      }
      return largest;
    },
  };
}

/**
 * How a model can run these songs, or why it cannot.
 *
 * The skill is never trimmed, so a tight context window is answered by asking
 * about fewer notes at a time — the phrase is the only part of the request that
 * can shrink. `deepseek-coder:6.7b`'s 16k window holds the whole skill and a
 * 16-note phrase comfortably; it is the 40-note phrase that does not fit. A
 * model is left out only when the blueprint, which cannot be split, or even the
 * smallest phrase is too large.
 */
function planForModel(
  model: BenchmarkModel,
  sizes: readonly RequestSizes[],
  requestedChunkNotes: number,
): ModelPlan {
  if (model.contextLength === null)
    return { kind: "run", chunkNotes: requestedChunkNotes };
  const limit = model.contextLength - MIN_RESPONSE_TOKENS;
  const tooSmall = (what: string, tokens: number) =>
    `context window too small for the complete cello-scoring skill: ${what} needs ~${tokens} prompt tokens plus ` +
    `${MIN_RESPONSE_TOKENS} to answer, and ${model.name} has ${model.contextLength}. Not run, rather than trimming the skill.`;

  const blueprint = Math.max(...sizes.map((size) => size.blueprintTokens));
  if (blueprint > limit)
    return {
      kind: "skip",
      reason: tooSmall("the blueprint request", blueprint),
    };

  const ladder = [
    requestedChunkNotes,
    ...CHUNK_LADDER.filter((size) => size < requestedChunkNotes),
  ];
  for (const chunkNotes of ladder) {
    const largest = Math.max(
      ...sizes.map((size) => size.fingeringTokens(chunkNotes)),
    );
    if (largest <= limit) return { kind: "run", chunkNotes };
  }
  const smallest = ladder[ladder.length - 1] ?? requestedChunkNotes;
  return {
    kind: "skip",
    reason: tooSmall(
      `even a ${smallest}-note phrase`,
      Math.max(...sizes.map((size) => size.fingeringTokens(smallest))),
    ),
  };
}

// ─── Records and summary ─────────────────────────────────────────────────────

function failureRecord(
  file: string,
  model: BenchmarkModel,
  options: BenchmarkOptions,
  skill: CelloScoringSkill,
  message: string,
  startedMs: number,
  loadSeconds: number | null,
): BenchmarkRecord {
  const songId = songIdFor(file);
  return {
    version: 1,
    status: "failed",
    model: model.name,
    modelSlug: model.slug,
    parameterSize: model.parameterSize,
    quantization: model.quantization,
    family: model.family,
    thinking: model.thinking,
    songId,
    songFile: file,
    folder: variantFolderName(songId, model.name),
    host: options.host,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date().toISOString(),
    seconds: (Date.now() - startedMs) / 1000,
    loadSeconds,
    key: "",
    bpm: 0,
    meter: [4, 4],
    melodyTrackIndex: 0,
    bassTrackIndex: 0,
    skillFiles: skill.files.map((entry) => entry.name),
    skillChars: skill.chars,
    blueprint: {
      ok: false,
      attempts: 0,
      error: message,
      request: emptyMetrics(),
    },
    tiers: [],
    error: message,
  };
}

function writeRecord(options: BenchmarkOptions, record: BenchmarkRecord): void {
  mkdirSync(join(options.outDir, record.folder), { recursive: true });
  writeFileSync(
    join(options.outDir, record.folder, "benchmark.json"),
    JSON.stringify(record, null, 2),
  );
}

function readRecord(dir: string): BenchmarkRecord | null {
  const path = join(dir, "benchmark.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BenchmarkRecord;
  } catch {
    return null;
  }
}

function writeSummary(options: BenchmarkOptions): void {
  if (!existsSync(options.outDir)) return;
  const records = readdirSync(options.outDir)
    .filter((name) => parseVariantFolder(name) !== null)
    .map((name) => readRecord(join(options.outDir, name)))
    .filter((record): record is BenchmarkRecord => record !== null);
  mkdirSync(options.reportDir, { recursive: true });
  writeFileSync(
    join(options.reportDir, "summary.json"),
    JSON.stringify(records, null, 2),
  );
  writeFileSync(
    join(options.reportDir, "summary.md"),
    summaryMarkdown(records, new Date().toISOString()),
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = options.files.map((file) => resolve(file));
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`MIDI file not found: ${file}`);
  }

  console.log("--- Ponticello · Ollama cello benchmark ---");
  console.log(`Host: ${options.host}`);

  // Loaded before any model is touched: without the complete skill, nothing runs.
  const skill = loadCelloScoringSkill();
  console.log(
    `Skill: complete cello-scoring skill in every request — ${skill.files.map((file) => file.name).join(", ")} ` +
      `(${skill.chars} chars, ~${estimateTokens(skill.chars)} tokens)`,
  );
  const sizesByFile = new Map(
    files.map((file) => [file, requestSizes(file, options, skill)]),
  );

  const models = selectBenchmarkModels(await fetchModels(options.host), {
    only: options.models,
    skip: options.skipModels,
  });
  if (models.length === 0)
    throw new Error("No chat-capable models matched on the server.");

  console.log(`Models (${models.length}, smallest first, one at a time):`);
  for (const model of models) {
    console.log(
      `  - ${model.name.padEnd(22)} ${model.parameterSize.padEnd(6)} ${model.quantization.padEnd(7)} ${(model.sizeBytes / 1e9).toFixed(1)} GB${model.thinking ? "  thinking" : ""}`,
    );
  }
  console.log(`Songs: ${files.map((file) => basename(file)).join(" · ")}`);
  console.log(
    `Fingered tiers: ${options.tiers.filter((tier) => tier !== "Beginner").join(", ")} (Beginner stays on the fixed first-position map)`,
  );

  if (options.dryRun) {
    for (const file of files) {
      const features = extractMidiFeatures(
        parseMidi(new Uint8Array(readFileSync(file))),
        basename(file),
      );
      const expert = buildMasterExpertNotes(
        features,
        fallbackBlueprint(features),
      );
      const advanced = deriveAdvancedNotes(expert);
      const intermediate = deriveIntermediateNotes(advanced);
      const barMs = measureDurationMs(features.timeSignature, features.bpm);
      const perTier: Record<string, RawNoteEvent[]> = {
        Expert: expert,
        Advanced: advanced,
        Intermediate: intermediate,
      };
      const phrases = options.tiers
        .filter((tier) => tier !== "Beginner")
        .map(
          (tier) =>
            `${tier} ${perTier[tier].length} notes / ${chunkByBars(perTier[tier], barMs, options.chunkNotes).length} phrases`,
        );
      const requests =
        1 +
        options.tiers
          .filter((tier) => tier !== "Beginner")
          .reduce(
            (total, tier) =>
              total +
              chunkByBars(perTier[tier], barMs, options.chunkNotes).length,
            0,
          );
      console.log(`\n${basename(file)} → ${songIdFor(file)}--<model>`);
      console.log(
        `  ${features.totalBars} bars · ${features.detectedKey} · ${features.bpm} BPM · ${phrases.join(" · ")}`,
      );
      const sizes = sizesByFile.get(file);
      console.log(
        `  ${requests} requests per model (1 blueprint + fingering phrases); with the skill: blueprint ~${sizes?.blueprintTokens ?? 0} tokens, largest phrase ~${sizes?.fingeringTokens(options.chunkNotes) ?? 0} tokens`,
      );
    }
    console.log(
      "\nContext check (complete skill in every request, phrase size reduced where a window is tight):",
    );
    for (const model of models) {
      const plan = planForModel(
        model,
        [...sizesByFile.values()],
        options.chunkNotes,
      );
      console.log(
        `  - ${model.name.padEnd(22)} ${
          plan.kind === "skip"
            ? `WILL NOT RUN — ${plan.reason}`
            : `fits at ${plan.chunkNotes} notes per phrase${model.contextLength === null ? " (window not reported; the server decides)" : ` (${model.contextLength} tokens)`}`
        }`,
      );
    }
    console.log("\n[DRY RUN] Nothing was generated or written.");
    return;
  }

  let activeModel: BenchmarkModel | null = null;
  process.on("SIGINT", () => {
    console.log("\nInterrupted — unloading the current model before exiting…");
    const model = activeModel;
    void (model ? unloadModel(options.host, model) : Promise.resolve()).finally(
      () => process.exit(130),
    );
  });

  const runStarted = Date.now();
  let completed = 0;
  let failed = 0;

  // Sequential by construction: plain loops, one awaited request at a time.
  for (const [index, model] of models.entries()) {
    const pending = files.filter((file) => {
      if (options.force) return true;
      const record = readRecord(
        join(options.outDir, variantFolderName(songIdFor(file), model.name)),
      );
      return record?.status !== "completed";
    });

    console.log(
      `\n================================================================`,
    );
    console.log(`[MODEL ${index + 1}/${models.length}] ${model.name}`);
    console.log(
      `================================================================`,
    );
    if (pending.length === 0) {
      console.log(
        "  Already completed for every song — skipping (use --force to re-run).",
      );
      continue;
    }

    const plan = planForModel(
      model,
      pending
        .map((file) => sizesByFile.get(file))
        .filter((size): size is RequestSizes => size !== undefined),
      options.chunkNotes,
    );
    if (plan.kind === "skip") {
      console.warn(`  Skipping ${model.name}: ${plan.reason}`);
      for (const file of pending) {
        writeRecord(
          options,
          failureRecord(
            file,
            model,
            options,
            skill,
            plan.reason,
            Date.now(),
            null,
          ),
        );
        failed++;
      }
      writeSummary(options);
      continue;
    }
    const modelOptions: BenchmarkOptions =
      plan.chunkNotes === options.chunkNotes
        ? options
        : { ...options, chunkNotes: plan.chunkNotes };
    if (plan.chunkNotes !== options.chunkNotes) {
      console.log(
        `  Asking about ${plan.chunkNotes} notes per phrase instead of ${options.chunkNotes}, so the complete skill fits ${model.name}'s ${model.contextLength}-token window.`,
      );
    }

    activeModel = model;
    const modelStarted = Date.now();
    console.log(`  Loading ${model.name}…`);
    const loadSeconds = await loadModel(options.host, model);
    console.log(
      loadSeconds === null
        ? "  Load did not confirm; continuing."
        : `  Loaded in ${loadSeconds.toFixed(1)}s.`,
    );

    for (const file of pending) {
      console.log(`\n  [SONG] ${basename(file)}`);
      try {
        const record = await benchmarkSong(
          file,
          model,
          modelOptions,
          loadSeconds,
          skill,
        );
        completed++;
        console.log(
          `  Done in ${(record.seconds / 60).toFixed(1)} min → ${join(options.outDir, record.folder)}`,
        );
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `  [ERROR] ${basename(file)} with ${model.name}: ${message}`,
        );
        writeRecord(
          options,
          failureRecord(
            file,
            model,
            options,
            skill,
            message,
            modelStarted,
            loadSeconds,
          ),
        );
      }
      writeSummary(options);
    }

    console.log(
      `\n  Unloading ${model.name} (${((Date.now() - modelStarted) / 60_000).toFixed(1)} min for this model)…`,
    );
    await unloadModel(options.host, model);
    activeModel = null;
  }

  writeSummary(options);
  console.log(
    `\nBenchmark finished in ${((Date.now() - runStarted) / 60_000).toFixed(1)} min: ${completed} completed, ${failed} failed.`,
  );
  console.log(`Comparison: ${join(options.reportDir, "summary.md")}`);

  if (options.rebuildLibrary && completed > 0) {
    console.log(
      "\nRebuilding the full library so the results appear in the app…",
    );
    const build = spawnSync(
      "npx",
      [
        "vite-node",
        "--config",
        "vitest.config.ts",
        "tools/build-library.ts",
        "--",
        "--edition=full",
      ],
      { stdio: "inherit" },
    );
    if (build.status !== 0) {
      console.error(
        "Library rebuild failed; run `yarn build:library` once the error above is fixed.",
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
