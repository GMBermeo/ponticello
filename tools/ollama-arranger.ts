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
import { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_MODEL } from './ollama/config';

import {
  ARRANGEMENT_WEIGHTS, CelloState, firstPositionFingering, RawNoteEvent, solveFingering,
  parseMidi, DifficultyTier, validateScore,
} from '@domain';
import {
  AmbiguousNoteAudit,
  auditFretboardNotes,
  buildMasterExpertNotes,
  buildSystemPrompt,
  buildUserPrompt,
  deriveAdvancedNotes,
  deriveBeginnerNotes,
  deriveIntermediateNotes,
  extractMidiFeatures,
  queryOllama,
  synthesizeScore,
} from "./ollama/arrangerCore";
import {
  CelloScoringSkill,
  estimateTokens,
  loadCelloScoringSkill,
} from "./ollama/celloScoringSkill";

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
    model: getFlag("model", process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL) ?? DEFAULT_OLLAMA_MODEL,
    host: getFlag("host", process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST) ?? DEFAULT_OLLAMA_HOST,
    outDir: getFlag("out-dir", "_MIDIS/arranged") ?? "_MIDIS/arranged",
    cacheFile:
      getFlag("cache", "_MIDIS/arrangements_cache.json") ??
      "_MIDIS/arrangements_cache.json",
  };
}


// ─── Single File Processing Pipeline ─────────────────────────────────────────

async function processFile(filePath: string, options: CliOptions, skill: CelloScoringSkill) {
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
    console.log(
      `\n[DRY RUN] Every request carries the complete cello-scoring skill: ${skill.files.map((file) => file.name).join(", ")} (${skill.chars} chars, ~${estimateTokens(skill.chars)} tokens).`,
    );
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
    skill,
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

type RunCache = Record<string, { status: string; timestamp: string }>;

function loadRunCache(file: string): RunCache {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    // A corrupt cache only costs a re-run of songs already done.
    return {};
  }
}

type RunOptions = Parameters<typeof processFile>[1];
type Skill = Parameters<typeof processFile>[2];

/** Arranges every downloaded MIDI file in turn, recording each outcome so a later run can resume. */
async function processAll(options: RunOptions, skill: Skill): Promise<void> {
  const midiFiles = globSync("_MIDIS/downloaded/*.{mid,midi}").sort();
  console.log(`Found ${midiFiles.length} files in _MIDIS/downloaded/`);
  const cache = loadRunCache(options.cacheFile);
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
    let status = "completed";
    try {
      await processFile(filePath, options, skill);
      processedCount++;
    } catch (err) {
      console.error(`  [ERROR] Failed processing ${fileName}:`, err);
      status = "failed";
    }
    cache[fileName] = { status, timestamp: new Date().toISOString() };
    writeFileSync(options.cacheFile, JSON.stringify(cache, null, 2));
  }
  console.log(`\nBatch run completed. Processed: ${processedCount} songs.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log("--- Ollama Serial Cello Arranger (qwen3.5:4b) ---");
  console.log(`Host: ${options.host} | Model: ${options.model}`);

  // Loaded before anything is sent: a missing skill stops the run here.
  const skill = loadCelloScoringSkill();
  console.log(
    `Skill: complete cello-scoring skill in every request — ${skill.files.map((file) => file.name).join(", ")} (${skill.chars} chars, ~${estimateTokens(skill.chars)} tokens)`,
  );

  if (options.file) {
    await processFile(resolve(options.file), options, skill);
    return;
  }

  if (options.all) {
    await processAll(options, skill);
    return;
  }

  console.error('Please specify either --file "<path>" or --all.');
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal pipeline error:", err);
  process.exit(1);
});
