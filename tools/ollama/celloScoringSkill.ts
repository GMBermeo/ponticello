/**
 * The complete cello-scoring skill, for every prompt sent to an Ollama model.
 *
 * Both Ollama tools used to *name* the skill in their prompt ("adhere to the
 * cello-scoring doctrine from .claude/skills/cello-scoring") — which a local
 * model cannot open, so it was arranging from a file path. Now the skill is
 * read from the repo and sent, whole and verbatim, at the top of the system
 * message of every request. Nothing is summarised or trimmed: when a model's
 * context window cannot hold the skill plus the request, the request is
 * refused rather than sent with part of the doctrine missing.
 *
 * The skill sits *first* in the system message and is byte-identical across
 * requests, so Ollama can reuse the cached prompt prefix from one phrase to the
 * next instead of re-reading 22 KB of doctrine every time.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, normalize, resolve, sep } from "node:path";

/** Where the skill lives; `.claude/skills/cello-scoring` is a symlink to the first. */
export const SKILL_DIRECTORIES = [".agents/skills/cello-scoring", ".claude/skills/cello-scoring"] as const;

export interface SkillFile {
  /** Path inside the skill folder, e.g. `ARRANGING.md`. */
  name: string;
  content: string;
}

export interface CelloScoringSkill {
  directory: string;
  /** `SKILL.md` first, then the files it links in link order, then the rest. */
  files: SkillFile[];
  /** Every file, verbatim, between markers. */
  text: string;
  chars: number;
}

/**
 * How the skill and the app's own rules fit together.
 *
 * The skill is general cello-arranging doctrine and says, in four places, to
 * move a piece to C, G, D or A. This app plays the original MIDI as the
 * backing and never transposes it, so obeying the skill literally would put
 * the cello in a different key from its own accompaniment. The conflict is
 * resolved here, explicitly, rather than left for a model to guess at.
 */
export const SKILL_PRECEDENCE = `HOW TO USE THE CELLO-SCORING SKILL ABOVE:
It is the arranging doctrine for this task, included in full. Apply all of it. Where it conflicts with the Ponticello rules that follow, the Ponticello rules win:
1. KEY — NEVER TRANSPOSE. The skill recommends moving a piece to C, G, D or A major (SKILL.md quick start step 1, ARRANGING.md sections 1 and 3, the MuseScore transpose command in PIPELINE.md). In this app the backing tracks play the original MIDI in its ORIGINAL key and are never transposed, so the cello must stay in the original key. Use register, octave displacement and fingering for playability instead.
2. POSITIONS — the "first position only" library convention in PIPELINE.md applies to the Beginner tier only. Every other tier follows the tier position limits stated below.
3. TOOLS AND OUTPUT — the commands in PIPELINE.md (npm, MuseScore) describe the offline pipeline. You cannot run them and must not mention them. Answer only in the output format requested below.`;

/** Rough tokens for a length of text. Deliberately pessimistic: markdown tables and note names tokenise densely. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

/** The smallest reply worth waiting for. A request that cannot leave this much room is refused. */
export const MIN_RESPONSE_TOKENS = 1024;

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".")) continue; // .DS_Store and friends are not doctrine
    const full = join(dir, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, name));
    else out.push(name);
  }
  return out;
}

/** Relative links in SKILL.md, in the order the skill introduces them. */
function linkedFiles(skillMd: string): string[] {
  const names: string[] = [];
  for (const match of skillMd.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = match[1];
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    const name = normalize(target).split(sep).join("/");
    if (name.startsWith("..")) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function renderSkill(files: readonly SkillFile[]): string {
  const body = files
    .map((file) => `===== BEGIN FILE: ${file.name} =====\n${file.content}${file.content.endsWith("\n") ? "" : "\n"}===== END FILE: ${file.name} =====`)
    .join("\n\n");
  return `<cello_scoring_skill files="${files.length}">\n${body}\n</cello_scoring_skill>`;
}

/**
 * Reads the whole skill. Throws — so nothing is sent — when the skill or any
 * file SKILL.md links to is missing.
 */
export function loadCelloScoringSkill(root: string = process.cwd()): CelloScoringSkill {
  const found = SKILL_DIRECTORIES
    .map((dir) => resolve(root, dir))
    .find((dir) => existsSync(join(dir, "SKILL.md")));
  if (!found) {
    throw new Error(
      `The cello-scoring skill was not found: no SKILL.md in ${SKILL_DIRECTORIES.join(" or ")} under ${root}. `
        + "Every Ollama prompt must include the complete skill, so nothing was sent.",
    );
  }

  const directory = realpathSync(found);
  const skillMd = readFileSync(join(directory, "SKILL.md"), "utf8");
  const order = ["SKILL.md", ...linkedFiles(skillMd).filter((name) => name !== "SKILL.md")];
  const missing = order.filter((name) => !existsSync(join(directory, name)));
  if (missing.length > 0) {
    throw new Error(
      `SKILL.md links to ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} missing from ${directory}. `
        + "Refusing to send a partial skill.",
    );
  }

  const rest = listFiles(directory).filter((name) => !order.includes(name));
  const files = [...order, ...rest].map((name) => ({
    name,
    content: readFileSync(join(directory, name), "utf8"),
  }));
  const text = renderSkill(files);
  return { directory, files, text, chars: text.length };
}

/** The system prompt with the complete skill and its precedence note in front of it. */
export function withCelloScoringSkill(systemPrompt: string, skill: CelloScoringSkill): string {
  const intro = `The complete cello-scoring skill follows, verbatim — all ${skill.files.length} files (${skill.files.map((file) => file.name).join(", ")}). Read all of it before answering.`;
  return [intro, skill.text, SKILL_PRECEDENCE, systemPrompt].filter(Boolean).join("\n\n");
}

/**
 * A conversation with the skill in its system message.
 *
 * The first system message gets the skill in front of it; a conversation
 * without one gains a system message carrying just the skill. Either way the
 * model cannot receive a prompt without the doctrine.
 */
export function skillMessages<M extends { role: string; content: string }>(
  messages: readonly M[], skill: CelloScoringSkill,
): M[] {
  const index = messages.findIndex((message) => message.role === "system");
  if (index < 0) {
    return [{ role: "system", content: withCelloScoringSkill("", skill) } as M, ...messages];
  }
  return messages.map((message, i) =>
    (i === index ? { ...message, content: withCelloScoringSkill(message.content, skill) } : message));
}

export interface ContextPlan {
  /** What to send as `num_ctx`. */
  numCtx: number;
  promptTokens: number;
  /** False when the prompt cannot leave `MIN_RESPONSE_TOKENS` in the model's window. */
  fits: boolean;
}

/**
 * Sizes the context window for a request.
 *
 * Never below what was asked for, grown to hold the prompt plus the reply
 * budget, and capped at what the model supports — at which point the only
 * honest answer to "does the complete skill fit?" may be no.
 */
export function planContext(
  promptChars: number,
  options: { requested: number; modelMax: number | null; reserve: number },
): ContextPlan {
  const promptTokens = estimateTokens(promptChars);
  const wanted = Math.ceil((promptTokens + options.reserve) / 1024) * 1024;
  let numCtx = Math.max(options.requested, wanted);
  if (options.modelMax !== null && options.modelMax > 0) numCtx = Math.min(numCtx, options.modelMax);
  return { numCtx, promptTokens, fits: promptTokens + MIN_RESPONSE_TOKENS <= numCtx };
}
