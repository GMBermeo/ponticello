import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  estimateTokens,
  loadCelloScoringSkill,
  planContext,
  SKILL_PRECEDENCE,
  skillMessages,
  withCelloScoringSkill,
} from "./celloScoringSkill";

describe("the repo's cello-scoring skill", () => {
  const skill = loadCelloScoringSkill(process.cwd());

  it("loads SKILL.md first and its references in the order it links them", () => {
    expect(skill.files.map((file) => file.name)).toEqual([
      "SKILL.md", "INSTRUMENT.md", "ARRANGING.md", "PIPELINE.md",
    ]);
  });

  it("carries every file completely, byte for byte", () => {
    for (const file of skill.files) {
      const onDisk = readFileSync(join(skill.directory, file.name), "utf8");
      expect(file.content).toBe(onDisk);
      expect(skill.text).toContain(onDisk);
    }
  });

  it("puts the whole skill, then the precedence rules, in front of the system prompt", () => {
    const composed = withCelloScoringSkill("SYSTEM PROMPT BODY", skill);
    const at = (text: string) => composed.indexOf(text);
    expect(at(skill.text)).toBeGreaterThan(-1);
    expect(at(SKILL_PRECEDENCE)).toBeGreaterThan(at(skill.text));
    expect(at("SYSTEM PROMPT BODY")).toBeGreaterThan(at(SKILL_PRECEDENCE));
  });

  it("is added to every conversation, with or without a system message", () => {
    const withSystem = skillMessages([
      { role: "system", content: "rules" },
      { role: "user", content: "question" },
    ], skill);
    expect(withSystem[0]?.content).toContain(skill.text);
    expect(withSystem[0]?.content.endsWith("rules")).toBe(true);
    expect(withSystem[1]).toEqual({ role: "user", content: "question" });

    const withoutSystem = skillMessages([{ role: "user", content: "question" }], skill);
    expect(withoutSystem).toHaveLength(2);
    expect(withoutSystem[0]?.role).toBe("system");
    expect(withoutSystem[0]?.content).toContain(skill.text);
  });

  it("resolves the skill's advice to transpose against the app's backing tracks", () => {
    expect(skill.text).toMatch(/Move to C, G, D, A major/);
    expect(SKILL_PRECEDENCE).toContain("NEVER TRANSPOSE");
  });
});

describe("loading a skill folder", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function fixture(files: Record<string, string>): string {
    root = mkdtempSync(join(tmpdir(), "cello-skill-"));
    const dir = join(root, ".agents/skills/cello-scoring");
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return root;
  }

  it("follows link order, then adds unlinked files, skipping dotfiles", () => {
    const skill = loadCelloScoringSkill(fixture({
      "SKILL.md": "See [B](B.md), then [A](A.md#part) and [B again](B.md). [site](https://example.com)",
      "A.md": "a",
      "B.md": "b",
      "extra/Z.md": "z",
      ".DS_Store": "junk",
    }));
    expect(skill.files.map((file) => file.name)).toEqual(["SKILL.md", "B.md", "A.md", "extra/Z.md"]);
  });

  it("refuses to load a skill with a missing reference", () => {
    expect(() => loadCelloScoringSkill(fixture({ "SKILL.md": "See [A](A.md)." })))
      .toThrow(/links to A\.md, which is missing/);
  });

  it("refuses to run without the skill at all", () => {
    root = mkdtempSync(join(tmpdir(), "cello-no-skill-"));
    expect(() => loadCelloScoringSkill(root!)).toThrow(/cello-scoring skill was not found/);
  });
});

describe("planContext", () => {
  it("grows the window to fit the prompt and reply, never below the request", () => {
    const plan = planContext(30_000, { requested: 32_768, modelMax: 131_072, reserve: 12_000 });
    expect(plan.promptTokens).toBe(estimateTokens(30_000));
    expect(plan.numCtx).toBe(32_768);
    expect(plan.fits).toBe(true);

    const big = planContext(90_000, { requested: 32_768, modelMax: 131_072, reserve: 12_000 });
    expect(big.numCtx).toBe(42_000 % 1024 === 0 ? 42_000 : Math.ceil(42_000 / 1024) * 1024);
  });

  it("caps at the model's window and says when the skill cannot fit", () => {
    const plan = planContext(48_000, { requested: 32_768, modelMax: 16_384, reserve: 4_096 });
    expect(plan.numCtx).toBe(16_384);
    expect(plan.fits).toBe(false);
  });
});
