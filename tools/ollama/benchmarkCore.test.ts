import { describe, expect, it } from "vitest";

import { solveFingering } from "../../src/domain/fingering";
import {
  applyFingeringAnswers,
  buildFingeringUserPrompt,
  chunkByBars,
  extractJson,
  fingeringOptions,
  fingeringStats,
  modelSlug,
  parseFingeringAnswers,
  parseVariantFolder,
  POSITION_FREEDOM_DOCTRINE,
  selectBenchmarkModels,
  variantFolderName,
} from "./benchmarkCore";

describe("models", () => {
  const tags = [
    { name: "qwen3-embedding:8b", size: 4_676_805_193, capabilities: ["embedding"] },
    { name: "gpt-oss:20b", size: 13_793_441_244, capabilities: ["completion", "tools", "thinking"] },
    { name: "deepseek-coder:6.7b", size: 3_827_834_503, capabilities: ["completion"] },
    { name: "granite3.3:8b", size: 4_942_891_653, capabilities: ["completion", "tools"] },
  ];

  it("drops embedding-only models and runs the smallest first", () => {
    const selected = selectBenchmarkModels(tags);
    expect(selected.map((model) => model.name)).toEqual([
      "deepseek-coder:6.7b", "granite3.3:8b", "gpt-oss:20b",
    ]);
    expect(selected.find((model) => model.name === "gpt-oss:20b")?.thinking).toBe(true);
    expect(selected.find((model) => model.name === "granite3.3:8b")?.thinking).toBe(false);
  });

  it("filters by name or slug", () => {
    expect(selectBenchmarkModels(tags, { only: ["gpt-oss-20b"] }).map((m) => m.name)).toEqual(["gpt-oss:20b"]);
    expect(selectBenchmarkModels(tags, { skip: ["gpt-oss:20b", "granite3.3:8b"] }).map((m) => m.name))
      .toEqual(["deepseek-coder:6.7b"]);
  });
});

describe("variant folders", () => {
  it("puts the model at the end of the folder and reads it back", () => {
    expect(modelSlug("qwen3.8:27b")).toBe("qwen3-8-27b");
    const folder = variantFolderName("tom-jobim-chega-de-saudade", "gpt-oss:20b");
    expect(folder).toBe("tom-jobim-chega-de-saudade--gpt-oss-20b");
    expect(parseVariantFolder(folder)).toEqual({
      songId: "tom-jobim-chega-de-saudade", modelSlug: "gpt-oss-20b",
    });
    expect(parseVariantFolder("tom-jobim-chega-de-saudade")).toBeNull();
  });
});

describe("the position doctrine", () => {
  it("states the fret map the fingering model uses", () => {
    expect(POSITION_FREEDOM_DOCTRINE).toContain("4th position: finger 1 at fret 7");
    expect(POSITION_FREEDOM_DOCTRINE).toContain("SAME string");
    expect(POSITION_FREEDOM_DOCTRINE).toContain("fret 6 or 7");
  });
});

describe("fingeringOptions", () => {
  it("offers A3 on the D string above first position once the tier allows it", () => {
    const intermediate = fingeringOptions(57, "Intermediate").map((option) => option.code);
    expect(intermediate).toContain("A0-0");
    expect(intermediate).toContain("D7-1");
    const beginner = fingeringOptions(57, "Beginner").map((option) => option.code);
    expect(beginner).toContain("A0-0");
    expect(beginner).not.toContain("D7-1");
  });

  it("gives each string/fret/finger one option, preferring the plain frame", () => {
    const options = fingeringOptions(56, "Intermediate");
    const codes = options.map((option) => option.code);
    expect(new Set(codes).size).toBe(codes.length);
    const d6 = options.find((option) => option.code === "D6-3");
    expect(d6?.state.extension).toBe("none");
  });

  it("offers thumb position only to the tiers that allow it", () => {
    expect(fingeringOptions(76, "Expert").some((option) => option.state.position === "Thumb")).toBe(true);
    expect(fingeringOptions(62, "Intermediate").some((option) => option.state.position === "Thumb")).toBe(false);
  });
});

describe("chunkByBars", () => {
  const notes = Array.from({ length: 130 }, (_, i) => ({
    midiNumber: 50, startTimeMs: i * 250, durationMs: 200,
  }));

  it("covers every note exactly once, within the limits", () => {
    const chunks = chunkByBars(notes, 2000, 48, 8);
    let expected = 0;
    for (const chunk of chunks) {
      expect(chunk.from).toBe(expected);
      expect(chunk.to - chunk.from).toBeLessThanOrEqual(48);
      expected = chunk.to;
    }
    expect(expected).toBe(notes.length);
  });

  it("backs a note cap off to the bar line", () => {
    const chunks = chunkByBars(notes, 2000, 30, 8);
    // Eight notes to a bar: a 30-note cap ends on a bar boundary at 24.
    expect(chunks[0]).toEqual({ from: 0, to: 24 });
  });
});

describe("reading answers", () => {
  it("finds the JSON behind reasoning, fences and chatter", () => {
    const raw = '<think>maybe {"not": this}</think>\nHere you go:\n```json\n{"fingerings":[{"i":0,"o":"d7-1"}],"reason":"keep {one} string"}\n```\nDone.';
    const answers = parseFingeringAnswers(extractJson(raw));
    expect(answers).toEqual([{ i: 0, o: "D7-1" }]);
  });

  it("applies legal answers and falls back where an answer is missing or illegal", () => {
    const line = [
      { midiNumber: 50, startTimeMs: 0, durationMs: 400 },
      { midiNumber: 57, startTimeMs: 400, durationMs: 400 },
      { midiNumber: 55, startTimeMs: 800, durationMs: 400 },
    ];
    const solver = solveFingering(line).states;
    const into = [...solver];
    const outcome = applyFingeringAnswers(
      line, { from: 0, to: 3 }, "Intermediate",
      [{ i: 0, o: "D0-0" }, { i: 1, o: "D7-1" }, { i: 99, o: "A0-0" }],
      solver, into,
    );
    expect(outcome).toEqual({ accepted: 2, invalid: 0, missing: 1 });
    expect(into[1]?.string).toBe("D");
    expect(into[1]?.position).toBe("4th");

    const illegal = applyFingeringAnswers(
      line, { from: 1, to: 2 }, "Beginner", [{ i: 1, o: "D7-1" }], solver, into,
    );
    expect(illegal).toEqual({ accepted: 0, invalid: 1, missing: 0 });
  });

  it("builds a prompt that lists every note's options", () => {
    const prompt = buildFingeringUserPrompt({
      songTitle: "Test", tier: "Intermediate", key: "D major", bpm: 100,
      chunkNumber: 1, chunkCount: 1, previousCode: null, directive: "",
      notes: [{ index: 4, midiNumber: 57, startTimeMs: 1000, durationMs: 500 }],
    });
    expect(prompt).toContain("4 | t=1.00s");
    expect(prompt).toContain("D7-1");
  });
});

describe("fingeringStats", () => {
  it("counts the difference between crossing strings and staying on one", () => {
    const line = [
      { midiNumber: 50, startTimeMs: 0, durationMs: 400 },
      { midiNumber: 57, startTimeMs: 400, durationMs: 400 },
      { midiNumber: 50, startTimeMs: 800, durationMs: 400 },
    ];
    const crossing = fingeringStats(line, [
      fingeringOptions(50, "Intermediate").find((o) => o.code === "D0-0")!.state,
      fingeringOptions(57, "Intermediate").find((o) => o.code === "A0-0")!.state,
      fingeringOptions(50, "Intermediate").find((o) => o.code === "D0-0")!.state,
    ]);
    const sameString = fingeringStats(line, [
      fingeringOptions(50, "Intermediate").find((o) => o.code === "D0-0")!.state,
      fingeringOptions(57, "Intermediate").find((o) => o.code === "D7-1")!.state,
      fingeringOptions(50, "Intermediate").find((o) => o.code === "D0-0")!.state,
    ]);
    expect(crossing.stringCrossings).toBe(2);
    expect(sameString.stringCrossings).toBe(0);
    expect(sameString.abovefirstPosition).toBe(1);
    expect(sameString.stoppedWhereOpenExisted).toBe(1);
  });
});

describe("summaryMarkdown", () => {
  it("renders completed and failed runs side by side", async () => {
    const { emptyMetrics, summaryMarkdown } = await import("./benchmarkCore");
    const stats = fingeringStats([], []);
    const base = {
      version: 1 as const, modelSlug: "m", parameterSize: "8B", quantization: "Q4_K_M", family: "x",
      thinking: false, songFile: "a.mid", host: "h", startedAt: "", finishedAt: "", loadSeconds: 1,
      key: "D major", bpm: 100, meter: [4, 4] as [number, number], melodyTrackIndex: 0, bassTrackIndex: 1,
      blueprint: { ok: true, attempts: 1, error: null, request: { ...emptyMetrics(), evalTokens: 100, evalSeconds: 10 } },
    };
    const markdown = summaryMarkdown([
      {
        ...base, status: "completed", model: "gpt-oss:20b", songId: "song", folder: "song--gpt-oss-20b",
        seconds: 600, error: null,
        tiers: [{
          tier: "Intermediate", notes: 10, askedModel: true, chunks: 1, accepted: 8, invalid: 1, missing: 1,
          request: emptyMetrics(), model: { ...stats, stringCrossings: 2 }, solver: { ...stats, stringCrossings: 5 },
          validationProblems: 0, flaggedUnidiomatic: 0,
        }],
      },
      {
        ...base, status: "failed", model: "tiny:1b", songId: "song", folder: "song--tiny-1b",
        seconds: 30, error: "HTTP 500 | boom", tiers: [],
      },
    ], "now");
    expect(markdown).toContain("| song | gpt-oss:20b | 8B Q4_K_M | completed | 10.0 | 10.0 | ok | 80% | 2 / 5 |");
    expect(markdown).toContain("failed: HTTP 500 / boom");
  });
});
